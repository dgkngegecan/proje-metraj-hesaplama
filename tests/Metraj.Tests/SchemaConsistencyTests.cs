using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Yeni kurulan bir veritabanı ile yükseltilen bir veritabanı AYNI kısıtlara
/// sahip olmalıdır. Yeni veritabanları EF modelinden üretilir, yükseltmeler ise
/// elle sütun/tablo ekler; ikisi ayrıştığında aynı uygulamanın iki kurulumu
/// farklı davranır ve bu yalnızca sahada ortaya çıkar.
/// </summary>
public sealed class SchemaConsistencyTests
{
    private static async Task<HashSet<string>> ReadIndexNamesAsync(string databasePath)
    {
        await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
        System.Data.Common.DbConnection connection = context.Database.GetDbConnection();
        await connection.OpenAsync();
        await using System.Data.Common.DbCommand command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%';";
        var names = new HashSet<string>(StringComparer.Ordinal);
        await using System.Data.Common.DbDataReader reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) names.Add(reader.GetString(0));
        return names;
    }

    private static async Task<HashSet<string>> ReadColumnsAsync(string databasePath, string table)
    {
        await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
        System.Data.Common.DbConnection connection = context.Database.GetDbConnection();
        await connection.OpenAsync();
        await using System.Data.Common.DbCommand command = connection.CreateCommand();
        command.CommandText = $"SELECT name FROM pragma_table_info('{table}');";
        var names = new HashSet<string>(StringComparer.Ordinal);
        await using System.Data.Common.DbDataReader reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) names.Add(reader.GetString(0));
        return names;
    }

    [Fact]
    public async Task AFreshDatabaseCarriesEveryExpectedIndex()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        HashSet<string> indexes = await ReadIndexNamesAsync(database.Path);

        string[] missing = ApplicationSchemaMigrator.ExpectedIndexes.Where(name => !indexes.Contains(name)).ToArray();
        Assert.True(missing.Length == 0, $"Eksik indeksler: {string.Join(", ", missing)}");
    }

    [Fact]
    public async Task AnUpgradedDatabaseEndsUpWithTheSameShapeAsAFreshOne()
    {
        // 1) Yeni kurulum
        await using TestDatabase fresh = await TestDatabase.CreateAsync("metraj-fresh");

        // 2) Yükseltme: eski bir kurulumu taklit et -- sürüm defteri ve sonradan
        //    eklenen yapılar silinir, sonra göç yeniden çalıştırılır.
        await using TestDatabase upgraded = await TestDatabase.CreateAsync("metraj-upgraded");
        await upgraded.ExecuteAsync(
            """
            DROP INDEX IF EXISTS "IX_CatalogCardVersions_CatalogCardTypeDefinitionId";
            DROP INDEX IF EXISTS "IX_ResponsibilityAssignments_PlacementScope";
            DROP INDEX IF EXISTS "IX_ResponsibilityAssignments_MeasurementScope";
            DROP TABLE IF EXISTS "UiStates";
            DELETE FROM "__AppSchemaVersions";
            """);
        await upgraded.MigrateAsync();

        HashSet<string> freshIndexes = await ReadIndexNamesAsync(fresh.Path);
        HashSet<string> upgradedIndexes = await ReadIndexNamesAsync(upgraded.Path);
        string[] missingAfterUpgrade = freshIndexes.Where(name => !upgradedIndexes.Contains(name)).ToArray();
        Assert.True(missingAfterUpgrade.Length == 0,
            $"Yükseltilmiş veritabanında eksik indeksler: {string.Join(", ", missingAfterUpgrade)}");

        // Sonradan eklenen tablo ve sütunlar da geri gelmeli.
        foreach (string table in new[] { "UiStates", "ProjectRevisions", "CatalogCardVersions", "MaterialTypeWasteSettings" })
        {
            HashSet<string> freshColumns = await ReadColumnsAsync(fresh.Path, table);
            HashSet<string> upgradedColumns = await ReadColumnsAsync(upgraded.Path, table);
            string[] missingColumns = freshColumns.Where(name => !upgradedColumns.Contains(name)).ToArray();
            Assert.True(missingColumns.Length == 0,
                $"{table} tablosunda eksik sütunlar: {string.Join(", ", missingColumns)}");
        }
    }
}
