using Metraj.Application;
using Metraj.Infrastructure;
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
            // Proje veritabanının havuzunu TestDatabase kendisi boşaltıyor.
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
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
        // finally havuzu boşaltabilsin diye kapsam dışında tanımlı.
        string path = string.Empty;
        try
        {
            Environment.SetEnvironmentVariable("METRAJ_DATA_DIRECTORY", preferred);
            path = ApplicationDatabasePaths.GetDatabasePath();
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
            if (path.Length > 0) TestDatabase.ClearPoolFor(path);
            TestDatabase.DeleteDirectoryWithDatabases(preferred);
        }
    }

    [Fact]
    public async Task DuplicateResponsibilityAssignmentsAreRejectedByTheDatabase()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var responsibilities = new ResponsibilityWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-RESP", "Sorumluluk benzersizliği");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-RESP", "Boru", Metraj.Domain.CardType.Material, Metraj.Domain.ItemKind.Material,
            Metraj.Domain.InputBehavior.Manual, Metraj.Domain.SalesConversion.None,
            Metraj.Domain.ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        ResponsibilityDimensionListItem dimension =
            await responsibilities.CreateDimensionAsync(project.LatestRevisionId, "MONTAJ", "Montaj");

        await responsibilities.AssignPlacementAsync(project.LatestRevisionId, dimension.Id, placement.Id,
            partyId: null, Metraj.Domain.ResponsibilityAssignmentState.Optional);

        // Aynı boyut/yerleşim çifti için ikinci bir SATIR yazılamamalı. Nullable
        // MeasurementId içeren eski tek indeks bunu engellemiyordu: SQLite
        // NULL'ları benzersizlik açısından farklı sayar.
        await using (MetrajDbContext context = database.ContextFactory())
        {
            context.ResponsibilityAssignments.Add(new Metraj.Domain.ResponsibilityAssignment
            {
                Id = Guid.NewGuid(),
                ProjectRevisionId = project.LatestRevisionId,
                ResponsibilityDimensionId = dimension.Id,
                ProjectPlacementId = placement.Id,
                MeasurementId = null,
                State = Metraj.Domain.ResponsibilityAssignmentState.Excluded
            });
            await Assert.ThrowsAsync<Microsoft.EntityFrameworkCore.DbUpdateException>(
                () => context.SaveChangesAsync());
        }

        // Servis yolu ise mevcut satırı güncelleyerek çalışmaya devam etmeli.
        await responsibilities.AssignPlacementAsync(project.LatestRevisionId, dimension.Id, placement.Id,
            partyId: null, Metraj.Domain.ResponsibilityAssignmentState.Excluded);
        IReadOnlyList<ResponsibilityAssignmentListItem> assignments =
            await responsibilities.ListAssignmentsAsync(project.LatestRevisionId);
        ResponsibilityAssignmentListItem entry = Assert.Single(assignments, item => item.PlacementId == placement.Id);
        Assert.Equal(Metraj.Domain.ResponsibilityAssignmentState.Excluded, entry.State);
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
            TestDatabase.ClearPoolFor(path);
            TestDatabase.DeleteDirectoryWithDatabases(directory);
        }
    }
}
