using Metraj.Application;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Yedek saklama politikası. Kullanıcının bilinçli olarak aldığı yedekler,
/// uygulamanın her açılışta aldığı otomatik yedekler yüzünden silinemez.
/// </summary>
public sealed class DatabaseBackupRetentionTests
{
    [Fact]
    public async Task StartupBackupsNeverEvictUserInitiatedBackups()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-retention-{Guid.NewGuid():N}");
        try
        {
            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);

            // Kullanıcı önemli bir aşamada bilinçli olarak yedek alır.
            DatabaseBackupListItem manual = await maintenance.CreateBackupAsync(DatabaseBackupReason.Manual);

            // Ardından uygulama, saklama sınırının çok üzerinde sayıda açılıp kapanır.
            for (int launch = 0; launch < 30; launch++)
            {
                await maintenance.CreateBackupAsync(DatabaseBackupReason.BeforeMigration);
            }

            IReadOnlyList<DatabaseBackupListItem> backups = await maintenance.ListBackupsAsync();

            // Asıl beklenti: manuel yedek hâlâ orada.
            Assert.Contains(backups, item => item.FullPath == manual.FullPath);
            Assert.True(File.Exists(manual.FullPath), "Kullanıcının aldığı yedek otomatik yedekler tarafından silinmiş.");

            // Otomatik yedekler ise kendi kotasıyla sınırlı kalmalı ki disk şişmesin.
            int automatic = backups.Count(item => item.Reason == DatabaseBackupReason.BeforeMigration);
            Assert.InRange(automatic, 1, 30);
            Assert.True(automatic < 30, "Otomatik yedekler hiç budanmamış.");
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }

    [Fact]
    public async Task RapidBackupsGetDistinctFileNames()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-names-{Guid.NewGuid():N}");
        try
        {
            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);

            // Aynı milisaniyeye denk gelen iki yedek birbirinin üzerine yazmamalı.
            var created = new List<DatabaseBackupListItem>();
            for (int index = 0; index < 5; index++)
            {
                created.Add(await maintenance.CreateBackupAsync(DatabaseBackupReason.Manual));
            }

            Assert.Equal(created.Count, created.Select(item => item.FullPath).Distinct(StringComparer.OrdinalIgnoreCase).Count());
            Assert.All(created, item => Assert.True(File.Exists(item.FullPath)));
            // Sebep etiketi dosya adından hâlâ doğru okunabilmeli.
            Assert.All(created, item => Assert.Equal(DatabaseBackupReason.Manual, item.Reason));
            Assert.All(await maintenance.ListBackupsAsync(), item => Assert.Equal(DatabaseBackupReason.Manual, item.Reason));
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }
}
