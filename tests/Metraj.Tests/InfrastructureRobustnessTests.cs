using Metraj.Application;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Altyapı katmanının sessiz arıza yolları: geri yüklemenin kendi kaynağını
/// budaması, tek-örnek kilidinin kalıcı olarak takılması, veritabanının sessizce
/// başka bir klasöre taşınması ve bağlantı dizesinin elle birleştirilmesi.
/// </summary>
public sealed class InfrastructureRobustnessTests
{
    [Fact]
    public async Task RestoringTheOldestBackupDoesNotPruneItBeforeItIsRead()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-prune-{Guid.NewGuid():N}");
        try
        {
            var projects = new ProjectWorkspaceService(database.ContextFactory);
            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);

            ProjectListItem original = await projects.CreateProjectAsync("P-OLDEST", "En eski yedek");
            DatabaseBackupListItem oldest = await maintenance.CreateBackupAsync(DatabaseBackupReason.Manual);

            // Kullanıcı kotasını TAM doldur (20). Sıradan yedekleme henüz hiçbir
            // şeyi budamaz; ama geri yüklemenin aldığı BeforeRestore yedeği
            // sayıyı 21'e çıkarıp en eskiyi -- yani geri yüklenecek olanı --
            // budamayı tetikler.
            for (int index = 0; index < 19; index++)
            {
                await maintenance.CreateBackupAsync(DatabaseBackupReason.Manual);
            }

            Assert.Contains(await maintenance.ListBackupsAsync(), item => item.FullPath == oldest.FullPath);

            await projects.CreateProjectAsync("P-SONRA", "Yedekten sonraki proje");

            // En eski yedeğe dönmek, o yedek okunmadan silinmesi yüzünden
            // başarısız olmamalı.
            await maintenance.RestoreBackupAsync(oldest.FullPath);

            IReadOnlyList<ProjectListItem> restored = await projects.ListProjectsAsync();
            Assert.Contains(restored, item => item.Id == original.Id);
            Assert.DoesNotContain(restored, item => item.Code == "P-SONRA");
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(backupDirectory)) Directory.Delete(backupDirectory, recursive: true);
        }
    }

    [Fact]
    public void AbandonedSingleWriterLockDoesNotBlockTheApplicationForever()
    {
        string identity = $"ProjeMetraj.Test.{Guid.NewGuid():N}";

        // Önceki bir süreç kilidi oluşturup serbest bıraktı (veya çöktü).
        using (var first = ApplicationWriteLock.TryAcquire(identity))
        {
            Assert.True(first.IsAcquired);
        }

        // Aynı kimlikle yeniden açılış kilidi ALABİLMELİ. Önceki sürüm
        // "createdNew" bayrağına bakıyordu; adlandırılmış mutex hâlâ mevcutsa
        // bu kalıcı olarak false kalıyor ve uygulama bir daha hiç açılmıyordu.
        using var second = ApplicationWriteLock.TryAcquire(identity);
        Assert.True(second.IsAcquired);
    }

    [Fact]
    public void ASecondInstanceStillCannotAcquireTheLockWhileTheFirstHoldsIt()
    {
        string identity = $"ProjeMetraj.Test.{Guid.NewGuid():N}";
        using var holder = ApplicationWriteLock.TryAcquire(identity);
        Assert.True(holder.IsAcquired);

        // Aynı süreçte ikinci bir edinme denemesi başarısız olmalı (tek yazar).
        using var second = ApplicationWriteLock.TryAcquire(identity);
        Assert.False(second.IsAcquired);
    }

    [Fact]
    public async Task AnExistingDatabaseIsPreferredOverCreatingANewOneElsewhere()
    {
        string preferred = Path.Combine(Path.GetTempPath(), $"metraj-pref-{Guid.NewGuid():N}");
        Directory.CreateDirectory(preferred);
        string? originalOverride = Environment.GetEnvironmentVariable("METRAJ_DATA_DIRECTORY");
        try
        {
            Environment.SetEnvironmentVariable("METRAJ_DATA_DIRECTORY", preferred);
            string path = ApplicationDatabasePaths.GetDatabasePath();
            Assert.Equal(Path.Combine(preferred, "metraj.db"), path);

            await using (MetrajDbContext context = MetrajDbContextFactory.Create(path))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            // Aynı konum ikinci çağrıda da seçilmeli.
            Assert.Equal(path, ApplicationDatabasePaths.GetDatabasePath());
        }
        finally
        {
            Environment.SetEnvironmentVariable("METRAJ_DATA_DIRECTORY", originalOverride);
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(preferred)) Directory.Delete(preferred, recursive: true);
        }
    }

    [Fact]
    public async Task DatabasePathsContainingASemicolonAreNotMisparsed()
    {
        // Noktalı virgül, bağlantı dizesinde ayraçtır. Elle birleştirilen bir
        // dizede böyle bir yol "Data Source" değerini erkenden bitirir.
        string directory = Path.Combine(Path.GetTempPath(), $"metraj;noktali-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, "metraj.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(path))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(path));
            ProjectListItem project = await projects.CreateProjectAsync("P-SEMI", "Noktalı virgül");
            Assert.Contains(await projects.ListProjectsAsync(), item => item.Id == project.Id);
            Assert.True(File.Exists(path));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }
}
