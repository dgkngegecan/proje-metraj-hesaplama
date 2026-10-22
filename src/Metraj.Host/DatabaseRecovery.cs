using System.IO.Compression;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;

namespace Metraj.Host;

/// <summary>Son yedeğin geri yüklenmesinin sonucu.</summary>
/// <param name="Backup">Geri yüklenen yedek.</param>
/// <param name="QuarantineDirectory">Bozuk veritabanının taşındığı klasör; taşınacak dosya yoksa <see langword="null"/>.</param>
/// <param name="SkippedBackups">Doğrulanamadığı için atlanan daha yeni yedekler.</param>
public sealed record DatabaseRecoveryResult(DatabaseBackupListItem Backup, string? QuarantineDirectory, IReadOnlyList<string> SkippedBackups);

/// <summary>Açılış başarısız olduğunda (bozuk ya da açılamayan veritabanı) kurtarma işleri.</summary>
/// <remarks>
/// Android'de açılış hatası ekranında yalnız "Kapat" vardı; kullanıcının
/// yedeklerine ulaşma yolu yoktu (yedekler uygulamanın özel klasöründe, dışarıdan
/// görünmez). Ayarlar → Yedekler router'dan geçer ve router'ı kuran hazırlık
/// zaten başarısız olmuştur. Bu sınıf bu yüzden router'a ve
/// <see cref="MetrajServices"/>'e dokunmaz; doğrudan
/// <see cref="DatabaseMaintenanceWorkspaceService"/> ve dosya sistemiyle çalışır.
///
/// Bozuk dosya silinmez: geri yüklemeden önce yan klasöre taşınır (destek ya da
/// elle kurtarma için). Hiçbir yedek geri yüklenemezse yerine geri konur ve
/// durum değişmeden kalır.
/// </remarks>
public sealed class DatabaseRecovery
{
    /// <summary>Bozuk veritabanlarının taşındığı klasörün adı (veritabanının yanında).</summary>
    public const string QuarantineFolderName = "bozuk-veritabani";

    private static readonly string[] DatabaseFileSuffixes = ["", "-wal", "-shm", "-journal"];

    private readonly string databasePath;
    private readonly string backupDirectory;
    private readonly string quarantineRoot;
    private readonly DatabaseMaintenanceWorkspaceService maintenance;
    private readonly TimeProvider time;

    /// <param name="databasePath">Uygulama veritabanı.</param>
    /// <param name="backupDirectory">Yedek klasörü (<see cref="MetrajServices.Create"/>'e verilenle aynı).</param>
    /// <param name="time">Karantina klasörü adı için saat (testler).</param>
    public DatabaseRecovery(string databasePath, string backupDirectory, TimeProvider? time = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(backupDirectory);
        this.databasePath = Path.GetFullPath(databasePath);
        this.backupDirectory = Path.GetFullPath(backupDirectory);
        quarantineRoot = Path.Combine(Path.GetDirectoryName(this.databasePath)!, QuarantineFolderName);
        this.time = time ?? TimeProvider.System;
        // Kapı verilmez: açılış başarısız olduğu için veritabanını kullanan istek yok.
        maintenance = new DatabaseMaintenanceWorkspaceService(() => this.databasePath, this.backupDirectory);
    }

    /// <summary>Yedekler, en yenisi önce.</summary>
    public Task<IReadOnlyList<DatabaseBackupListItem>> ListBackupsAsync(CancellationToken cancellationToken = default) =>
        maintenance.ListBackupsAsync(cancellationToken);

    /// <summary>
    /// Bozuk veritabanını karantinaya alır ve en yeni geri yüklenebilir yedeği
    /// yerine koyar. En yeni yedek de doğrulanamazsa bir öncekine geçilir.
    /// </summary>
    /// <exception cref="DomainRuleViolationException">
    /// Yedek yok (<c>recovery.no-backup</c>) ya da hiçbiri geri yüklenemedi
    /// (<c>recovery.all-backups-failed</c>); ikinci durumda bozuk dosya yerine geri konmuştur.
    /// </exception>
    public async Task<DatabaseRecoveryResult> RestoreLatestBackupAsync(CancellationToken cancellationToken = default)
    {
        IReadOnlyList<DatabaseBackupListItem> backups = await maintenance.ListBackupsAsync(cancellationToken);
        if (backups.Count == 0)
        {
            throw new DomainRuleViolationException("recovery.no-backup", "Bu cihazda geri yüklenecek bir yedek yok.");
        }

        string? quarantine = QuarantineDatabase();
        var skipped = new List<string>();
        foreach (DatabaseBackupListItem backup in backups)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                // Önceki denemeden kalan yarım kopya: asıl dosya karantinada, bu bizim ürettiğimiz.
                DeleteDatabaseFiles();
                await maintenance.RestoreBackupAsync(backup.FullPath, cancellationToken);
                return new DatabaseRecoveryResult(backup, quarantine, skipped);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                skipped.Add($"{backup.FileName}: {exception.Message}");
            }
        }

        // Hiçbiri olmadı: bozuk dosya yerine döner, kullanıcı en azından dışa aktarabilir.
        DeleteDatabaseFiles();
        RestoreFromQuarantine(quarantine);
        throw new DomainRuleViolationException(
            "recovery.all-backups-failed",
            $"Hiçbir yedek geri yüklenemedi. Veriyi dışa aktarıp destekle paylaşın.\n{string.Join("\n", skipped)}");
    }

    /// <summary>
    /// Veritabanını (bozuk olsa bile ham dosyalar olarak), bütün yedekleri ve
    /// karantinadaki eski dosyaları bir zip arşivine yazar. Hedef akış SAF'tan
    /// gelir; arama yapılamaz olabilir, arşiv baştan sona yazılır.
    /// </summary>
    /// <returns>Arşive giren dosya sayısı.</returns>
    public async Task<int> WriteRecoveryArchiveAsync(Stream output, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(output);
        SqliteConnection.ClearAllPools();
        int count = 0;
        await using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (string suffix in DatabaseFileSuffixes)
            {
                string path = databasePath + suffix;
                if (File.Exists(path))
                {
                    await AddFileAsync(archive, path, $"veritabani/{Path.GetFileName(path)}", cancellationToken);
                    count++;
                }
            }

            if (Directory.Exists(backupDirectory))
            {
                foreach (string path in Directory.EnumerateFiles(backupDirectory, "metraj-*.db", SearchOption.TopDirectoryOnly).Order(StringComparer.Ordinal))
                {
                    await AddFileAsync(archive, path, $"yedekler/{Path.GetFileName(path)}", cancellationToken);
                    count++;
                }
            }

            if (Directory.Exists(quarantineRoot))
            {
                foreach (string path in Directory.EnumerateFiles(quarantineRoot, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
                {
                    string relative = Path.GetRelativePath(quarantineRoot, path).Replace('\\', '/');
                    await AddFileAsync(archive, path, $"{QuarantineFolderName}/{relative}", cancellationToken);
                    count++;
                }
            }
        }

        await output.FlushAsync(cancellationToken);
        return count;
    }

    /// <summary>Önerilen arşiv adı: <c>ProjeMetraj-kurtarma-2026-10-18_1015.zip</c>.</summary>
    public string SuggestedArchiveName() =>
        $"ProjeMetraj-kurtarma-{time.GetLocalNow():yyyy-MM-dd_HHmm}.zip";

    private static async Task AddFileAsync(ZipArchive archive, string path, string entryName, CancellationToken cancellationToken)
    {
        ZipArchiveEntry entry = archive.CreateEntry(entryName, CompressionLevel.Fastest);
        entry.LastWriteTime = File.GetLastWriteTime(path);
        // ReadWrite paylaşımı: dosyayı açık tutan bir SQLite bağlantısı kalmışsa da okunabilsin.
        await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        await using Stream target = await entry.OpenAsync(cancellationToken);
        await input.CopyToAsync(target, cancellationToken);
    }

    /// <summary>Veritabanı dosyalarını (wal/shm/journal dahil) yeni bir karantina klasörüne taşır.</summary>
    private string? QuarantineDatabase()
    {
        SqliteConnection.ClearAllPools();
        string[] existing = DatabaseFileSuffixes.Select(suffix => databasePath + suffix).Where(File.Exists).ToArray();
        if (existing.Length == 0) return null;

        string directory = Path.Combine(quarantineRoot, $"{time.GetUtcNow():yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..6]}");
        Directory.CreateDirectory(directory);
        foreach (string path in existing)
        {
            File.Move(path, Path.Combine(directory, Path.GetFileName(path)));
        }

        return directory;
    }

    private void RestoreFromQuarantine(string? directory)
    {
        if (directory is null) return;
        string databaseDirectory = Path.GetDirectoryName(databasePath)!;
        foreach (string path in Directory.EnumerateFiles(directory))
        {
            File.Move(path, Path.Combine(databaseDirectory, Path.GetFileName(path)), overwrite: true);
        }

        Directory.Delete(directory);
    }

    private void DeleteDatabaseFiles()
    {
        SqliteConnection.ClearAllPools();
        foreach (string suffix in DatabaseFileSuffixes)
        {
            string path = databasePath + suffix;
            if (File.Exists(path)) File.Delete(path);
        }
    }
}
