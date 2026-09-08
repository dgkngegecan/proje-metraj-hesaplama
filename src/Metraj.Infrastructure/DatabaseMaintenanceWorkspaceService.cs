using System.Data;
using Metraj.Application;
using Microsoft.Data.Sqlite;

namespace Metraj.Infrastructure;

/// <summary>Creates verified SQLite online backups and performs validated, atomic restores.</summary>
public sealed class DatabaseMaintenanceWorkspaceService : IDatabaseMaintenanceWorkspace
{
    private const int RetainedBackupCount = 20;
    private readonly Func<string> databasePathProvider;
    private readonly string backupDirectory;

    /// <summary>Builds the service for a database path and its sibling backup directory.</summary>
    public DatabaseMaintenanceWorkspaceService(Func<string> databasePathProvider, string? backupDirectory = null)
    {
        this.databasePathProvider = databasePathProvider ?? throw new ArgumentNullException(nameof(databasePathProvider));
        string databasePath = GetDatabasePath();
        this.backupDirectory = backupDirectory ?? Path.Combine(Path.GetDirectoryName(databasePath)!, "backups");
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<DatabaseBackupListItem>> ListBackupsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Directory.CreateDirectory(backupDirectory);
        IReadOnlyList<DatabaseBackupListItem> items = Directory.EnumerateFiles(backupDirectory, "metraj-*.db", SearchOption.TopDirectoryOnly)
            .Select(path => ToListItem(path))
            .OrderByDescending(item => item.CreatedAtUtc)
            .ThenByDescending(item => item.FileName, StringComparer.Ordinal)
            .ToList();
        return Task.FromResult(items);
    }

    /// <inheritdoc />
    public async Task<DatabaseBackupListItem> CreateBackupAsync(DatabaseBackupReason reason = DatabaseBackupReason.Manual, CancellationToken cancellationToken = default)
    {
        string databasePath = GetDatabasePath();
        if (!File.Exists(databasePath))
        {
            throw new FileNotFoundException("Yedeklenecek uygulama veritabanı bulunamadı.", databasePath);
        }

        Directory.CreateDirectory(backupDirectory);
        DateTime now = DateTime.UtcNow;
        string stem = $"metraj-{now:yyyyMMdd-HHmmssfff}-{reason.ToString().ToLowerInvariant()}";
        string finalPath = Path.Combine(backupDirectory, $"{stem}.db");
        string temporaryPath = Path.Combine(backupDirectory, $".{stem}-{Guid.NewGuid():N}.tmp");
        try
        {
            await CopyDatabaseAsync(databasePath, temporaryPath, cancellationToken);
            await VerifyDatabaseAsync(temporaryPath, cancellationToken);
            // Microsoft.Data.Sqlite may keep a pooled handle after the short-lived
            // validation connection. Release it before the atomic rename on Windows.
            SqliteConnection.ClearAllPools();
            File.Move(temporaryPath, finalPath, overwrite: false);
            PruneOldBackups();
            return ToListItem(finalPath, reason);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            DeleteIfExists(temporaryPath);
        }
    }

    /// <inheritdoc />
    public async Task RestoreBackupAsync(string backupPath, CancellationToken cancellationToken = default)
    {
        string trustedBackupPath = ValidateBackupPath(backupPath);
        await VerifyDatabaseAsync(trustedBackupPath, cancellationToken);
        string databasePath = GetDatabasePath();
        if (File.Exists(databasePath))
        {
            await CreateBackupAsync(DatabaseBackupReason.BeforeRestore, cancellationToken);
        }

        string restoreTemporaryPath = $"{databasePath}.restore-{Guid.NewGuid():N}.tmp";
        try
        {
            await CopyDatabaseAsync(trustedBackupPath, restoreTemporaryPath, cancellationToken);
            await VerifyDatabaseAsync(restoreTemporaryPath, cancellationToken);
            SqliteConnection.ClearAllPools();
            File.Move(restoreTemporaryPath, databasePath, overwrite: true);
            DeleteIfExists($"{databasePath}-wal");
            DeleteIfExists($"{databasePath}-shm");
            await VerifyDatabaseAsync(databasePath, cancellationToken);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            DeleteIfExists(restoreTemporaryPath);
        }
    }

    /// <inheritdoc />
    public async Task<DatabaseIntegrityCheckResult> CheckIntegrityAsync(CancellationToken cancellationToken = default)
    {
        string databasePath = GetDatabasePath();
        if (!File.Exists(databasePath))
        {
            return new DatabaseIntegrityCheckResult(false, "Uygulama veritabanı bulunamadı.");
        }

        try
        {
            await VerifyDatabaseAsync(databasePath, cancellationToken);
            return new DatabaseIntegrityCheckResult(true, "SQLite quick_check sonucu: ok.");
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or SqliteException)
        {
            return new DatabaseIntegrityCheckResult(false, $"Bütünlük denetimi başarısız: {exception.Message}");
        }
    }

    private static async Task CopyDatabaseAsync(string sourcePath, string destinationPath, CancellationToken cancellationToken)
    {
        SqliteConnectionStringBuilder sourceBuilder = new() { DataSource = sourcePath, Mode = SqliteOpenMode.ReadOnly, ForeignKeys = true };
        SqliteConnectionStringBuilder destinationBuilder = new() { DataSource = destinationPath, Mode = SqliteOpenMode.ReadWriteCreate, ForeignKeys = true };
        await using var source = new SqliteConnection(sourceBuilder.ToString());
        await using var destination = new SqliteConnection(destinationBuilder.ToString());
        await source.OpenAsync(cancellationToken);
        await destination.OpenAsync(cancellationToken);
        source.BackupDatabase(destination);
    }

    private static async Task VerifyDatabaseAsync(string databasePath, CancellationToken cancellationToken)
    {
        SqliteConnectionStringBuilder builder = new() { DataSource = databasePath, Mode = SqliteOpenMode.ReadOnly, ForeignKeys = true };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync(cancellationToken);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = "PRAGMA quick_check;";
        object? value = await command.ExecuteScalarAsync(cancellationToken);
        string result = Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
        if (!string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"SQLite quick_check başarısız: {result}");
        }
    }

    private string GetDatabasePath()
    {
        string path = Path.GetFullPath(databasePathProvider());
        string? directory = Path.GetDirectoryName(path);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new IOException("Uygulama veritabanı yolu geçersiz.");
        }

        return path;
    }

    private string ValidateBackupPath(string backupPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(backupPath);
        string fullPath = Path.GetFullPath(backupPath);
        string expectedDirectory = Path.GetFullPath(backupDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(expectedDirectory, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Path.GetExtension(fullPath), ".db", StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(fullPath))
        {
            throw new InvalidOperationException("Yalnızca uygulamanın yedek klasöründeki .db yedekleri geri yüklenebilir.");
        }

        return fullPath;
    }

    private static DatabaseBackupListItem ToListItem(string path, DatabaseBackupReason? reasonOverride = null)
    {
        FileInfo info = new(path);
        return new DatabaseBackupListItem(
            info.FullName,
            info.Name,
            reasonOverride ?? ParseReason(info.Name),
            info.CreationTimeUtc,
            info.Length);
    }

    private static DatabaseBackupReason ParseReason(string name)
    {
        foreach (DatabaseBackupReason reason in Enum.GetValues<DatabaseBackupReason>())
        {
            if (name.Contains($"-{reason.ToString().ToLowerInvariant()}.db", StringComparison.OrdinalIgnoreCase))
            {
                return reason;
            }
        }

        return DatabaseBackupReason.Manual;
    }

    private void PruneOldBackups()
    {
        foreach (string obsolete in Directory.EnumerateFiles(backupDirectory, "metraj-*.db", SearchOption.TopDirectoryOnly)
                     .OrderByDescending(File.GetCreationTimeUtc)
                     .ThenByDescending(path => path, StringComparer.Ordinal)
                     .Skip(RetainedBackupCount))
        {
            File.Delete(obsolete);
        }
    }

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }
}
