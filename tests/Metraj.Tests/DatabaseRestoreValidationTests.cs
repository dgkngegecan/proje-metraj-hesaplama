using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Geri yükleme, seçilen dosyanın gerçekten bir Metraj veritabanı olduğunu
/// doğrulamak zorundadır. PRAGMA quick_check yalnızca SQLite dosya yapısını
/// denetler; uygulama kimliğini, şema uyumluluğunu veya ilişkileri denetlemez.
/// </summary>
public sealed class DatabaseRestoreValidationTests
{
    [Fact]
    public async Task ForeignSqliteFileIsRejectedAndLeavesTheProjectDatabaseUntouched()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-foreign-{Guid.NewGuid():N}");
        Directory.CreateDirectory(backupDirectory);
        try
        {
            var projects = new ProjectWorkspaceService(database.ContextFactory);
            ProjectListItem project = await projects.CreateProjectAsync("P-KEEP", "Korunmalı proje");

            // Yapısal olarak sağlam ama Metraj'a ait olmayan bir SQLite dosyası.
            string foreignPath = Path.Combine(backupDirectory, "metraj-20260101-000000000-aaaaaa-manual.db");
            await using (var foreign = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = foreignPath,
                Mode = SqliteOpenMode.ReadWriteCreate
            }.ToString()))
            {
                await foreign.OpenAsync();
                await using SqliteCommand command = foreign.CreateCommand();
                command.CommandText = "CREATE TABLE \"Alakasiz\" (\"Id\" INTEGER PRIMARY KEY, \"Deger\" TEXT);";
                await command.ExecuteNonQueryAsync();
            }
            SqliteConnection.ClearAllPools();

            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);
            DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(
                () => maintenance.RestoreBackupAsync(foreignPath));
            Assert.Equal("backup.not-metraj", error.Rule);

            // Kullanıcının projesi hâlâ yerinde olmalı.
            IReadOnlyList<ProjectListItem> remaining = await projects.ListProjectsAsync();
            Assert.Contains(remaining, item => item.Id == project.Id);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(backupDirectory)) Directory.Delete(backupDirectory, recursive: true);
        }
    }

    [Fact]
    public async Task GenuineBackupStillRestores()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-genuine-{Guid.NewGuid():N}");
        try
        {
            var projects = new ProjectWorkspaceService(database.ContextFactory);
            ProjectListItem project = await projects.CreateProjectAsync("P-REAL", "Gerçek proje");

            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);
            DatabaseBackupListItem backup = await maintenance.CreateBackupAsync(DatabaseBackupReason.Manual);

            // Yedekten sonra ikinci bir proje eklenir; geri yükleme onu geri almalı.
            await projects.CreateProjectAsync("P-SONRA", "Yedekten sonraki proje");
            await maintenance.RestoreBackupAsync(backup.FullPath);

            IReadOnlyList<ProjectListItem> restored = await projects.ListProjectsAsync();
            Assert.Contains(restored, item => item.Id == project.Id);
            Assert.DoesNotContain(restored, item => item.Code == "P-SONRA");
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(backupDirectory)) Directory.Delete(backupDirectory, recursive: true);
        }
    }
}
