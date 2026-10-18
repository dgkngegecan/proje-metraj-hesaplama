using System.IO.Compression;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Host;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Android açılış hatası ekranındaki kurtarma (son kod incelemesi, bulgu 4):
/// router'sız, doğrudan bakım servisiyle son yedeği geri yükleme ve ham veriyi
/// dışa aktarma. Bozuk dosya silinmez, yan klasöre taşınır.
/// </summary>
public sealed class DatabaseRecoveryTests
{
    private static readonly byte[] Garbage = "bu bir SQLite dosyası değil, bozulmuş"u8.ToArray();

    [Fact]
    public async Task CorruptDatabaseIsQuarantinedAndTheLatestBackupIsRestored()
    {
        using var folder = new RecoveryFolder();
        await folder.CreateDatabaseAsync();
        var projects = new ProjectWorkspaceService(folder.ContextFactory);
        ProjectListItem kept = await projects.CreateProjectAsync("P-YEDEKTE", "Yedekte olan");
        DatabaseBackupListItem backup = await folder.Maintenance().CreateBackupAsync(DatabaseBackupReason.Manual);
        await projects.CreateProjectAsync("P-SONRA", "Yedekten sonra");
        folder.Corrupt();

        var recovery = new DatabaseRecovery(folder.DatabasePath, folder.BackupDirectory);
        DatabaseRecoveryResult result = await recovery.RestoreLatestBackupAsync();

        Assert.Equal(backup.FileName, result.Backup.FileName);
        Assert.Empty(result.SkippedBackups);
        Assert.NotNull(result.QuarantineDirectory);
        Assert.Equal(Garbage, File.ReadAllBytes(Path.Combine(result.QuarantineDirectory!, "metraj.db")));
        Assert.StartsWith(Path.Combine(folder.Root, DatabaseRecovery.QuarantineFolderName), result.QuarantineDirectory);

        IReadOnlyList<ProjectListItem> restored = await new ProjectWorkspaceService(folder.ContextFactory).ListProjectsAsync();
        Assert.Equal([kept.Id], restored.Select(project => project.Id));
        Assert.True((await folder.Maintenance().CheckIntegrityAsync()).IsHealthy);
    }

    [Fact]
    public async Task UnrestorableNewestBackupIsSkippedForTheNextOne()
    {
        using var folder = new RecoveryFolder();
        await folder.CreateDatabaseAsync();
        DatabaseBackupListItem good = await folder.Maintenance().CreateBackupAsync(DatabaseBackupReason.Manual);
        string broken = Path.Combine(folder.BackupDirectory, "metraj-20991231-235959000-ffffff-manual.db");
        File.WriteAllBytes(broken, Garbage);
        File.SetCreationTimeUtc(broken, DateTime.UtcNow.AddHours(1));
        folder.Corrupt();

        DatabaseRecoveryResult result = await new DatabaseRecovery(folder.DatabasePath, folder.BackupDirectory).RestoreLatestBackupAsync();

        Assert.Equal(good.FileName, result.Backup.FileName);
        Assert.Single(result.SkippedBackups);
        Assert.Contains(Path.GetFileName(broken), result.SkippedBackups[0]);
        Assert.True((await folder.Maintenance().CheckIntegrityAsync()).IsHealthy);
    }

    [Fact]
    public async Task WithoutBackupsNothingIsMoved()
    {
        using var folder = new RecoveryFolder();
        Directory.CreateDirectory(folder.BackupDirectory);
        File.WriteAllBytes(folder.DatabasePath, Garbage);

        DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(
            () => new DatabaseRecovery(folder.DatabasePath, folder.BackupDirectory).RestoreLatestBackupAsync());

        Assert.Equal("recovery.no-backup", error.Rule);
        Assert.Equal(Garbage, File.ReadAllBytes(folder.DatabasePath));
        Assert.False(Directory.Exists(Path.Combine(folder.Root, DatabaseRecovery.QuarantineFolderName)));
    }

    [Fact]
    public async Task WhenNoBackupCanBeRestoredTheOriginalFileGoesBack()
    {
        using var folder = new RecoveryFolder();
        Directory.CreateDirectory(folder.BackupDirectory);
        File.WriteAllBytes(Path.Combine(folder.BackupDirectory, "metraj-20261018-100000000-aaaaaa-manual.db"), Garbage);
        File.WriteAllBytes(folder.DatabasePath, Garbage);
        File.WriteAllBytes(folder.DatabasePath + "-wal", [1, 2, 3]);

        DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(
            () => new DatabaseRecovery(folder.DatabasePath, folder.BackupDirectory).RestoreLatestBackupAsync());

        Assert.Equal("recovery.all-backups-failed", error.Rule);
        Assert.Equal(Garbage, File.ReadAllBytes(folder.DatabasePath));
        Assert.Equal([1, 2, 3], File.ReadAllBytes(folder.DatabasePath + "-wal"));
        Assert.Empty(Directory.EnumerateFileSystemEntries(Path.Combine(folder.Root, DatabaseRecovery.QuarantineFolderName)));
    }

    [Fact]
    public async Task RecoveryArchiveHoldsTheRawDatabaseBackupsAndQuarantine()
    {
        using var folder = new RecoveryFolder();
        await folder.CreateDatabaseAsync();
        DatabaseBackupListItem backup = await folder.Maintenance().CreateBackupAsync(DatabaseBackupReason.Manual);
        folder.Corrupt();
        var recovery = new DatabaseRecovery(folder.DatabasePath, folder.BackupDirectory);
        DatabaseRecoveryResult result = await recovery.RestoreLatestBackupAsync();
        File.WriteAllBytes(folder.DatabasePath + "-journal", [9]);

        using var output = new MemoryStream();
        int count = await recovery.WriteRecoveryArchiveAsync(output);

        output.Position = 0;
        using var archive = new ZipArchive(output, ZipArchiveMode.Read);
        string quarantineFolder = Path.GetFileName(result.QuarantineDirectory!);
        string[] names = archive.Entries.Select(entry => entry.FullName).ToArray();
        Assert.Equal(count, names.Length);
        Assert.Contains("veritabani/metraj.db", names);
        Assert.Contains("veritabani/metraj.db-journal", names);
        Assert.Contains($"yedekler/{backup.FileName}", names);
        string quarantined = $"{DatabaseRecovery.QuarantineFolderName}/{quarantineFolder}/metraj.db";
        Assert.Contains(quarantined, names);
        using var reader = new MemoryStream();
        await using (Stream entry = await archive.GetEntry(quarantined)!.OpenAsync())
        {
            await entry.CopyToAsync(reader);
        }

        Assert.Equal(Garbage, reader.ToArray());
        Assert.Matches(@"^ProjeMetraj-kurtarma-\d{4}-\d{2}-\d{2}_\d{4}\.zip$", recovery.SuggestedArchiveName());
    }

    /// <summary>Uygulamanın özel klasörünü taklit eder: metraj.db, backups/ ve karantina aynı kökte.</summary>
    private sealed class RecoveryFolder : IDisposable
    {
        public RecoveryFolder()
        {
            Root = Path.Combine(Path.GetTempPath(), $"metraj-recovery-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public string DatabasePath => Path.Combine(Root, "metraj.db");

        public string BackupDirectory => Path.Combine(Root, "backups");

        public Func<MetrajDbContext> ContextFactory => () => MetrajDbContextFactory.Create(DatabasePath);

        public DatabaseMaintenanceWorkspaceService Maintenance() => new(() => DatabasePath, BackupDirectory);

        public async Task CreateDatabaseAsync()
        {
            await using MetrajDbContext context = MetrajDbContextFactory.Create(DatabasePath);
            await ApplicationSchemaMigrator.MigrateAsync(context);
        }

        /// <summary>Veritabanının üzerine çöp yazar (cihazda yarım kalan yazma / bozuk depolama).</summary>
        public void Corrupt()
        {
            TestDatabase.ClearPoolFor(DatabasePath);
            File.Delete(DatabasePath + "-wal");
            File.Delete(DatabasePath + "-shm");
            File.WriteAllBytes(DatabasePath, Garbage);
        }

        public void Dispose()
        {
            TestDatabase.ClearPoolFor(DatabasePath);
            TestDatabase.DeleteDirectoryWithDatabases(Root);
        }
    }
}
