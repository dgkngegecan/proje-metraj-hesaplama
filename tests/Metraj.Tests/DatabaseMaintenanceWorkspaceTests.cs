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
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-legacy-{Guid.NewGuid():N}.db");
        try
        {
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
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    [Fact]
    public async Task FailedLegacyMigrationRollsBackTheSchemaChange()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-migration-rollback-{Guid.NewGuid():N}.db");
        try
        {
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
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    [Fact]
    public async Task InterruptedUncommittedWriteLeavesTheDatabaseConsistent()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-interrupted-write-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext initialization = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(initialization);
            }

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
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    [Fact]
    public async Task VerifiedBackupRestoresTheCompleteSingleDatabaseAndKeepsSafetySnapshot()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-backup-{Guid.NewGuid():N}.db");
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
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
            if (Directory.Exists(backupDirectory))
            {
                Directory.Delete(backupDirectory, recursive: true);
            }
        }
    }

    [Fact]
    public async Task IntegrityCheckReportsCorruptDatabaseWithoutMutatingIt()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-corrupt-{Guid.NewGuid():N}.db");
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
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            if (Directory.Exists(backupDirectory))
            {
                Directory.Delete(backupDirectory, recursive: true);
            }
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
