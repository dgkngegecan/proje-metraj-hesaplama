using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using Xunit;

namespace Metraj.Tests;

public sealed class DatabaseMaintenanceWorkspaceTests
{
    [Fact]
    public async Task LegacyCardVersionFixtureMigratesAndBackfillsTheSnapshotName()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-legacy");
        string databasePath = database.Path;
        await CreateDatabaseWithCardAsync(databasePath, "Legacy kart adı");
        await ExecuteSqlAsync(databasePath, "ALTER TABLE \"CatalogCardVersions\" DROP COLUMN \"Name\";");

        await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
        {
            await ApplicationSchemaMigrator.MigrateAsync(context);
        }

        await using MetrajDbContext verification = MetrajDbContextFactory.Create(databasePath);
        string? snapshotName = await verification.CatalogCardVersions.Select(version => version.Name).SingleAsync();
        Assert.Equal("Legacy kart adı", snapshotName);
        Assert.True(await HasColumnAsync(databasePath, "CatalogCardVersions", "Name"));
    }

    [Fact]
    public async Task FailedLegacyMigrationRollsBackTheSchemaChange()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-migration-rollback");
        string databasePath = database.Path;
        await CreateDatabaseWithCardAsync(databasePath, "Geri alınacak kart");
        await ExecuteSqlAsync(databasePath, "ALTER TABLE \"CatalogCardVersions\" DROP COLUMN \"Name\";");
        await ExecuteSqlAsync(databasePath,
            "CREATE TRIGGER \"AbortCardVersionBackfill\" BEFORE UPDATE ON \"CatalogCardVersions\" BEGIN SELECT RAISE(ABORT, 'forced migration failure'); END;");

        await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
        {
            await Assert.ThrowsAsync<SqliteException>(() => ApplicationSchemaMigrator.MigrateAsync(context));
        }

        Assert.False(await HasColumnAsync(databasePath, "CatalogCardVersions", "Name"));
    }

    [Fact]
    public async Task InterruptedUncommittedWriteLeavesTheDatabaseConsistent()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-interrupted-write");
        string databasePath = database.Path;
        await using (MetrajDbContext interrupted = MetrajDbContextFactory.Create(databasePath))
        {
            await using Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction =
                await interrupted.Database.BeginTransactionAsync();
            interrupted.Projects.Add(new Project
            {
                Id = Guid.NewGuid(),
                Code = "P-INTERRUPTED",
                Name = "Yarım kalan yazma"
            });
            await interrupted.SaveChangesAsync();
            // Simulate a process ending before CommitAsync: disposal must roll the write back.
        }

        await using MetrajDbContext verification = MetrajDbContextFactory.Create(databasePath);
        Assert.Empty(await verification.Projects.ToListAsync());
        DatabaseIntegrityCheckResult integrity = await new DatabaseMaintenanceWorkspaceService(() => databasePath).CheckIntegrityAsync();
        Assert.True(integrity.IsHealthy, integrity.Details);
    }

    [Fact]
    public async Task VerifiedBackupRestoresTheCompleteSingleDatabaseAndKeepsSafetySnapshot()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-backup");
        string databasePath = database.Path;
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-backups-{Guid.NewGuid():N}");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            await projects.CreateProjectAsync("P-BACKUP-1", "İlk proje");
            var maintenance = new DatabaseMaintenanceWorkspaceService(() => databasePath, backupDirectory);
            DatabaseBackupListItem backup = await maintenance.CreateBackupAsync(DatabaseBackupReason.BeforeMigration);
            Assert.True(File.Exists(backup.FullPath));
            Assert.Equal(DatabaseBackupReason.BeforeMigration, backup.Reason);
            Assert.True((await maintenance.CheckIntegrityAsync()).IsHealthy);

            await projects.CreateProjectAsync("P-BACKUP-2", "Sonradan eklenen proje");
            await maintenance.RestoreBackupAsync(backup.FullPath);

            await using MetrajDbContext verification = MetrajDbContextFactory.Create(databasePath);
            Assert.Equal(1, await verification.Projects.CountAsync());
            Assert.Equal("P-BACKUP-1", await verification.Projects.Select(project => project.Code).SingleAsync());
            IReadOnlyList<DatabaseBackupListItem> backups = await maintenance.ListBackupsAsync();
            Assert.Contains(backups, item => item.Reason == DatabaseBackupReason.BeforeRestore);
            Assert.True((await maintenance.CheckIntegrityAsync()).IsHealthy);
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }

    [Fact]
    public async Task IntegrityCheckReportsCorruptDatabaseWithoutMutatingIt()
    {
        // Bu test dosyanın SQLite OLMAYAN bir içerikle bozulmasını gerektiriyor.
        // CreateAsync gerçek bir veritabanı açtığı için dosya havuzda tutuluyor
        // ve üzerine yazılamıyor; burada yalnızca yol ayıran Reserve kullanılır.
        await using var database = TestDatabase.Reserve("metraj-corrupt");
        string databasePath = database.Path;
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-corrupt-backups-{Guid.NewGuid():N}");
        try
        {
            await File.WriteAllTextAsync(databasePath, "this is not sqlite");
            var maintenance = new DatabaseMaintenanceWorkspaceService(() => databasePath, backupDirectory);
            DatabaseIntegrityCheckResult result = await maintenance.CheckIntegrityAsync();
            Assert.False(result.IsHealthy);
            Assert.Contains("başarısız", result.Details, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }

    [Fact]
    public async Task ProjectResetKeepsCatalogAndCreatesRestorableSafetyBackup()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-project-reset");
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-reset-backups-{Guid.NewGuid():N}");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(database.Path))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(database.Path));
            await catalog.CreateCardAsync(new CatalogCardDraft(
                "RESET-KEEP", "Korunacak kart", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet"));
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(database.Path));
            await projects.CreateProjectAsync("RESET-1", "Silinecek proje");

            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);
            ProjectDataResetResult result = await maintenance.ResetProjectDataAsync();

            Assert.Equal(1, result.DeletedProjectCount);
            Assert.Equal(DatabaseBackupReason.BeforeProjectReset, result.SafetyBackup.Reason);
            Assert.True(File.Exists(result.SafetyBackup.FullPath));
            await using MetrajDbContext verification = MetrajDbContextFactory.Create(database.Path);
            Assert.Empty(await verification.Projects.ToListAsync());
            Assert.Equal("RESET-KEEP", await verification.CatalogCardDefinitions.Select(card => card.Code).SingleAsync());
            Assert.True((await maintenance.CheckIntegrityAsync()).IsHealthy);
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }

    [Fact]
    public async Task ProjectResetRemovesNestedPlacementTreesAndTheirMeasurements()
    {
        // Önceki test yalnız yerleşimsiz bir projeyi siliyordu. Gerçek projelerde
        // yerleşimler iç içedir; ProjectPlacements kendi üst kaydını RESTRICT ile
        // işaret ettiği için toplu DELETE "FOREIGN KEY constraint failed" ile
        // düşüyor ve kullanıcı 500 hatası görüyordu.
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-project-reset-tree");
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-reset-tree-backups-{Guid.NewGuid():N}");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(database.Path))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            string csvPath = Path.Combine(AppContext.BaseDirectory, "TestData", "Phase0", "CleanWater", "fixtures", "measurements.csv");
            SyntheticCleanWaterImportResult sample = await new SyntheticCleanWaterWorkspaceService(
                () => MetrajDbContextFactory.Create(database.Path), csvPath).ImportAsync();
            Assert.True(sample.ImportedPlacementCount > 1);
            await using (MetrajDbContext before = MetrajDbContextFactory.Create(database.Path))
            {
                Assert.True(await before.ProjectPlacements.AnyAsync(placement => placement.ParentPlacementId != null));
            }

            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);
            ProjectDataResetResult result = await maintenance.ResetProjectDataAsync();

            Assert.Equal(1, result.DeletedProjectCount);
            await using MetrajDbContext verification = MetrajDbContextFactory.Create(database.Path);
            Assert.Empty(await verification.Projects.ToListAsync());
            Assert.Empty(await verification.ProjectPlacements.ToListAsync());
            Assert.Empty(await verification.Measurements.ToListAsync());
            Assert.True((await maintenance.CheckIntegrityAsync()).IsHealthy);
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }

    [Fact]
    public void SingleWriterGuardRejectsSecondApplicationInstanceUntilReleased()
    {
        string identity = $"Metraj.Tests.{Guid.NewGuid():N}";
        using var first = ApplicationWriteLock.TryAcquire(identity);
        using var second = ApplicationWriteLock.TryAcquire(identity);

        Assert.True(first.IsAcquired);
        Assert.False(second.IsAcquired);
    }

    private static async Task CreateDatabaseWithCardAsync(string databasePath, string cardName)
    {
        await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
        {
            await ApplicationSchemaMigrator.MigrateAsync(context);
        }

        var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        await catalog.CreateCardAsync(new CatalogCardDraft(
            $"LEGACY-{Guid.NewGuid():N}", cardName, Metraj.Domain.CardType.Material,
            Metraj.Domain.ItemKind.Material, Metraj.Domain.InputBehavior.Manual,
            Metraj.Domain.SalesConversion.None, Metraj.Domain.ReportBehavior.Measurable, "adet"));
    }

    private static async Task ExecuteSqlAsync(string databasePath, string sql)
    {
        SqliteConnectionStringBuilder builder = new() { DataSource = databasePath, ForeignKeys = true };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync();
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<bool> HasColumnAsync(string databasePath, string table, string column)
    {
        SqliteConnectionStringBuilder builder = new() { DataSource = databasePath, ForeignKeys = true };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync();
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = $column;";
        command.Parameters.AddWithValue("$column", column);
        return Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture) == 1L;
    }
}
