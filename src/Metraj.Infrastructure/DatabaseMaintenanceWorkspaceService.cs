using System.Data;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.Data.Sqlite;

namespace Metraj.Infrastructure;

/// <summary>Creates verified SQLite online backups and performs validated, atomic restores.</summary>
public sealed class DatabaseMaintenanceWorkspaceService : IDatabaseMaintenanceWorkspace
{
    // Kullanıcının bilinçli aldığı yedekler ile uygulamanın her açılışta aldığı
    // otomatik yedekler AYNI kotayı paylaşamaz. Paylaştıklarında yirmi açılış,
    // kullanıcının kasıtlı olarak sakladığı bütün yedekleri siliyordu; yani
    // yedekleme özelliği normal kullanım sırasında kendi kendini yok ediyordu.
    private const int RetainedAutomaticBackupCount = 10;
    private const int RetainedUserBackupCount = 20;
    private readonly Func<string> databasePathProvider;
    private readonly string backupDirectory;
    private readonly ApplicationDatabaseGate? gate;

    /// <summary>Builds the service for a database path and its sibling backup directory.</summary>
    /// <param name="databasePathProvider">Uygulama veritabanının yolunu çözer.</param>
    /// <param name="backupDirectory">Yedek klasörü; verilmezse veritabanının yanındaki "backups".</param>
    /// <param name="gate">
    /// Verildiğinde geri yükleme, devam eden bütün veritabanı işlemleri bitene
    /// kadar bekler ve süresince yenilerini durdurur. Verilmezse (testler)
    /// eski davranış korunur.
    /// </param>
    public DatabaseMaintenanceWorkspaceService(
        Func<string> databasePathProvider, string? backupDirectory = null, ApplicationDatabaseGate? gate = null)
    {
        this.databasePathProvider = databasePathProvider ?? throw new ArgumentNullException(nameof(databasePathProvider));
        this.gate = gate;
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
    public Task<DatabaseBackupListItem> CreateBackupAsync(DatabaseBackupReason reason = DatabaseBackupReason.Manual, CancellationToken cancellationToken = default) =>
        CreateBackupAsync(reason, protectedBackupPath: null, cancellationToken);

    /// <summary>
    /// Yedek alır; <paramref name="protectedBackupPath"/> verildiğinde o dosya
    /// budamadan muaf tutulur.
    /// </summary>
    /// <remarks>
    /// Geri yükleme önce bir BeforeRestore yedeği alır ve bu budamayı tetikler.
    /// Saklama sınırındayken, geri yüklemek için seçilen EN ESKİ yedek daha
    /// kopyalanmadan silinebiliyordu.
    /// </remarks>
    private async Task<DatabaseBackupListItem> CreateBackupAsync(DatabaseBackupReason reason, string? protectedBackupPath, CancellationToken cancellationToken)
    {
        string databasePath = GetDatabasePath();
        if (!File.Exists(databasePath))
        {
            throw new FileNotFoundException("Yedeklenecek uygulama veritabanı bulunamadı.", databasePath);
        }

        Directory.CreateDirectory(backupDirectory);
        DateTime now = DateTime.UtcNow;
        // Ayırt edici belirteç, sebep etiketinin ÖNÜNE girer; dosya adı hâlâ
        // "-<sebep>.db" ile bittiği için ParseReason ve eski yedekler etkilenmez.
        // Yalnız zaman damgası kullanmak, aynı milisaniyeye denk gelen iki yedeğin
        // çakışmasına açık kapı bırakıyordu.
        string token = Guid.NewGuid().ToString("N")[..6];
        string stem = $"metraj-{now:yyyyMMdd-HHmmssfff}-{token}-{reason.ToString().ToLowerInvariant()}";
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
            PruneOldBackups(protectedBackupPath);
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
        // Dosyanın üzerine yazarken hiçbir istek veritabanına dokunmamalı.
        await using IAsyncDisposable? maintenance = gate is null
            ? null
            : await gate.EnterMaintenanceAsync(cancellationToken);

        string trustedBackupPath = ValidateBackupPath(backupPath);
        await VerifyDatabaseAsync(trustedBackupPath, cancellationToken);
        // Kimlik doğrulaması, güvenlik yedeği alınmadan ÖNCE yapılır: yanlış bir
        // dosya seçildiğinde kullanıcının yedek klasörü boş yere kalabalıklaşmasın.
        await EnsureRestorableMetrajDatabaseAsync(trustedBackupPath, cancellationToken);
        string databasePath = GetDatabasePath();
        if (File.Exists(databasePath))
        {
            // Geri yüklenecek yedek, güvenlik yedeğinin tetiklediği budamada
            // silinmemeli; aksi hâlde kaynağı okumadan kaybediyorduk.
            await CreateBackupAsync(DatabaseBackupReason.BeforeRestore, trustedBackupPath, cancellationToken);
        }

        string restoreTemporaryPath = $"{databasePath}.restore-{Guid.NewGuid():N}.tmp";
        try
        {
            await CopyDatabaseAsync(trustedBackupPath, restoreTemporaryPath, cancellationToken);
            await VerifyDatabaseAsync(restoreTemporaryPath, cancellationToken);
            // Aşama kopyası da doğrulanır: kopyalama sırasında bozulan bir dosya
            // asıl veritabanının yerine geçmemeli.
            await EnsureRestorableMetrajDatabaseAsync(restoreTemporaryPath, cancellationToken);
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

    /// <summary>
    /// Dosyanın gerçekten bu uygulamaya ait, geri yüklenebilir bir veritabanı
    /// olduğunu doğrular. PRAGMA quick_check yalnızca SQLite'ın kendi dosya
    /// yapısını denetler; uygulama kimliğini, şema uyumluluğunu ve ilişkileri
    /// denetlemez. Bu kontrol olmadan yabancı bir .db dosyası "Yedek geri
    /// yüklendi." mesajıyla kullanıcının bütün projelerinin yerine geçebiliyordu.
    /// </summary>
    internal static async Task EnsureRestorableMetrajDatabaseAsync(string databasePath, CancellationToken cancellationToken)
    {
        SqliteConnectionStringBuilder builder = new() { DataSource = databasePath, Mode = SqliteOpenMode.ReadOnly, ForeignKeys = true };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync(cancellationToken);

        var tables = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using (SqliteCommand command = connection.CreateCommand())
        {
            command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table';";
            await using SqliteDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                tables.Add(reader.GetString(0));
            }
        }

        string[] missing = ApplicationSchemaMigrator.RequiredTables.Where(table => !tables.Contains(table)).ToArray();
        if (missing.Length > 0)
        {
            throw new DomainRuleViolationException(
                "backup.not-metraj",
                $"Seçilen dosya bir Proje Metraj yedeği değil. Eksik tablolar: {string.Join(", ", missing)}.");
        }

        // Daha yeni bir uygulama sürümüyle üretilmiş yedek, sessizce açılmamalı;
        // bu sürümün tanımadığı şema adımları veri kaybına yol açabilir.
        if (tables.Contains("__AppSchemaVersions"))
        {
            var unknown = new List<string>();
            await using SqliteCommand command = connection.CreateCommand();
            command.CommandText = "SELECT \"Version\" FROM \"__AppSchemaVersions\";";
            await using SqliteDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                string version = reader.GetString(0);
                if (!ApplicationSchemaMigrator.KnownSchemaVersions.Contains(version, StringComparer.Ordinal))
                {
                    unknown.Add(version);
                }
            }

            if (unknown.Count > 0)
            {
                throw new DomainRuleViolationException(
                    "backup.newer-schema",
                    $"Bu yedek daha yeni bir Proje Metraj sürümüyle alınmış ({string.Join(", ", unknown)}). Güncel sürümle geri yükleyin.");
            }
        }

        await using (SqliteCommand command = connection.CreateCommand())
        {
            command.CommandText = "PRAGMA foreign_key_check;";
            await using SqliteDataReader reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(
                    "backup.broken-relations",
                    "Yedekteki kayıtlar arasındaki ilişkiler tutarsız; bu dosya güvenle geri yüklenemez.");
            }
        }
    }

    internal static async Task VerifyDatabaseAsync(string databasePath, CancellationToken cancellationToken)
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
            throw new DomainRuleViolationException(
                "backup.outside-folder",
                "Yalnızca uygulamanın yedek klasöründeki .db yedekleri geri yüklenebilir.");
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

    /// <summary>
    /// Otomatik ve kullanıcı kaynaklı yedekleri ayrı kotalarda budar. Böylece
    /// açılış yedekleri hiçbir zaman kullanıcının sakladığı bir yedeği düşüremez.
    /// </summary>
    private void PruneOldBackups(string? protectedBackupPath = null)
    {
        // FileInfo bir kez oluşturulur: önceki sürüm her karşılaştırmada
        // File.GetCreationTimeUtc çağırarak dosya sistemine gidiyordu.
        IEnumerable<IGrouping<bool, FileInfo>> groups = Directory
            .EnumerateFiles(backupDirectory, "metraj-*.db", SearchOption.TopDirectoryOnly)
            .Where(path => protectedBackupPath is null ||
                !string.Equals(Path.GetFullPath(path), protectedBackupPath, StringComparison.OrdinalIgnoreCase))
            .Select(path => new FileInfo(path))
            .GroupBy(file => ParseReason(file.Name) == DatabaseBackupReason.BeforeMigration);

        foreach (IGrouping<bool, FileInfo> group in groups)
        {
            int retained = group.Key ? RetainedAutomaticBackupCount : RetainedUserBackupCount;
            foreach (FileInfo obsolete in group
                         .OrderByDescending(file => file.CreationTimeUtc)
                         .ThenByDescending(file => file.Name, StringComparer.Ordinal)
                         .Skip(retained))
            {
                try
                {
                    obsolete.Delete();
                }
                catch (IOException)
                {
                    // Kilitli bir eski yedek, yeni yedeğin alınmasını engellememeli.
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
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
