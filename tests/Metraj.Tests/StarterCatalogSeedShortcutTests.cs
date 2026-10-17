using System.Globalization;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Host;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Standart kart paketinin tohumlama kısa yolu: manifest özeti ve damga değişmemişse
/// tohumlama hiçbir şey okumadan döner; sonuç ve katalog, tam tohumlamanınkiyle aynıdır.
/// </summary>
/// <remarks>
/// Eşdeğerlik testleri aynı senaryoyu iki veritabanında yürütür: birinde damga
/// mekanizması normal çalışır, diğerinde (başvuru) damga her tohumlamadan önce
/// silinir ve böylece daima damgadan önceki tam algoritma çalışır. İkisinin sonucu
/// ve kataloğu birebir aynı olmalı; tetikleyici bir değişikliği kaçırırsa damgalı
/// veritabanı eksik kartı eklemez ve fark yakalanır.
/// </remarks>
public sealed class StarterCatalogSeedShortcutTests
{
    [Fact]
    public async Task AStampedCatalogIsAnsweredWithoutOpeningAnEfContext()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-seed-shortcut");
        int contexts = 0;
        Func<MetrajDbContext> counting = () =>
        {
            Interlocked.Increment(ref contexts);
            return MetrajDbContextFactory.Create(database.Path);
        };
        var starter = new StarterCatalogWorkspaceService(counting, database.Path);

        StarterCatalogSeedResult first = await starter.SeedAsync();
        Assert.True(first.AddedCount > 700, $"İlk tohumlama paketin tamamını eklemeli ({first.AddedCount}).");
        Assert.True(contexts > 0);
        Assert.Equal(StarterCatalogWorkspaceService.ManifestDigest, await StampDigestAsync(database.Path));

        int afterFirst = contexts;
        StarterCatalogSeedResult second = await starter.SeedAsync();
        Assert.Equal(afterFirst, contexts);
        Assert.Equal((0, first.AddedCount), (second.AddedCount, second.ExistingCount));
        Assert.Empty(second.AddedCodes);

        // Yalnız bağlam fabrikası verilen kurucu (masaüstü açılışı) da kısa yolu kullanır:
        // damgayı bağlamın bağlantısıyla okur, kataloğu okumaz.
        StarterCatalogSeedResult viaContext = await new StarterCatalogWorkspaceService(counting).SeedAsync();
        Assert.Equal(afterFirst + 1, contexts);
        Assert.Equal((0, first.AddedCount, 0), (viaContext.AddedCount, viaContext.ExistingCount, viaContext.AddedCodes.Count));
    }

    [Fact]
    public async Task ADeletedStandardCardIsAddedBackExactlyAsBefore()
    {
        StarterCatalogSeedResult result = await AssertEquivalentAsync("metraj-seed-deleted", async database =>
        {
            var catalog = new CatalogWorkspaceService(database.ContextFactory);
            CatalogCardListItem card = Assert.Single(await catalog.ListCardsAsync(), item => item.Code == "STD-CAT-MEK");
            await catalog.DeleteCardAsync(card.Id);
        });

        Assert.Equal(["STD-CAT-MEK"], result.AddedCodes);
    }

    [Fact]
    public async Task ADeactivatedFamilyBringsBackItsSourceCardsExactlyAsBefore()
    {
        StarterCatalogSeedResult result = await AssertEquivalentAsync("metraj-seed-family", async database =>
        {
            var catalog = new CatalogWorkspaceService(database.ContextFactory);
            CatalogCardListItem family = Assert.Single(await catalog.ListCardsAsync(), item => item.Code == "STDF-PIPE-PPRC");
            await catalog.DeactivateCardAsync(family.Id);
        });

        Assert.NotEmpty(result.AddedCodes);
    }

    [Fact]
    public async Task UserCardsPassiveCardsAndNewVersionsStayUntouched()
    {
        StarterCatalogSeedResult result = await AssertEquivalentAsync("metraj-seed-untouched", async database =>
        {
            var catalog = new CatalogWorkspaceService(database.ContextFactory);
            IReadOnlyList<CatalogCardListItem> cards = await catalog.ListCardsAsync();
            await catalog.CreateCardAsync(new CatalogCardDraft("USER-OWN-VALVE", "Kullanıcı vanası", CardType.Accessory,
                ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet"));
            // Pasife alınan standart kart pasif kalmalı (yeniden etkinleştirilmez, kopyası eklenmez).
            await catalog.DeactivateCardAsync(Assert.Single(cards, item => item.Code == "STD-EQ-BOILER").Id);
            // Standart karta kullanıcı sürümü: yeni sürüm satırı damgayı geçersiz kılmaz, kart değişmez.
            CatalogCardListItem combi = Assert.Single(cards, item => item.Code == "STD-EQ-COMBI");
            await catalog.CreateVersionAsync(combi.Id, new CatalogCardDraft(combi.Code, "Kombi — kullanıcı düzenlemesi",
                combi.CardType, ItemKind.Equipment, combi.InputBehavior, combi.SalesConversion, combi.ReportBehavior, combi.Unit));
        });

        Assert.Equal(0, result.AddedCount);
    }

    [Fact]
    public async Task AChangedManifestDigestForcesAFullSeedAndRestamps()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-seed-digest");
        var starter = new StarterCatalogWorkspaceService(database.Path);
        StarterCatalogSeedResult first = await starter.SeedAsync();
        await ExecuteAsync(database.Path, "UPDATE \"__StarterCatalogSeedStamp\" SET \"ManifestDigest\" = 'onceki-surum';");

        int contexts = 0;
        var counting = new StarterCatalogWorkspaceService(() =>
        {
            Interlocked.Increment(ref contexts);
            return MetrajDbContextFactory.Create(database.Path);
        }, database.Path);
        StarterCatalogSeedResult afterUpgrade = await counting.SeedAsync();

        Assert.True(contexts > 0, "Özet değiştiğinde tam tohumlama çalışmalı.");
        Assert.Equal((0, first.AddedCount), (afterUpgrade.AddedCount, afterUpgrade.ExistingCount));
        Assert.Equal(StarterCatalogWorkspaceService.ManifestDigest, await StampDigestAsync(database.Path));
    }

    [Fact]
    public async Task WithoutTheStampTableOrATriggerTheSeedRunsFullyAndWritesNoStamp()
    {
        await using TestDatabase withoutTrigger = await TestDatabase.CreateAsync("metraj-seed-no-trigger");
        await ExecuteAsync(withoutTrigger.Path, "DROP TRIGGER \"TR_CatalogCardVersions_StarterSeedStamp_Delete\";");
        var starter = new StarterCatalogWorkspaceService(withoutTrigger.Path);
        StarterCatalogSeedResult first = await starter.SeedAsync();
        Assert.True(first.AddedCount > 700);
        // Tetikleyicisiz bir damga, sonradan silinen bir kartı gizleyebilirdi: yazılmaz.
        Assert.Null(await StampDigestAsync(withoutTrigger.Path));
        Assert.Equal(first.AddedCount, (await starter.SeedAsync()).ExistingCount);

        await using TestDatabase withoutTable = await TestDatabase.CreateAsync("metraj-seed-no-table");
        await ExecuteAsync(withoutTable.Path, "DROP TABLE \"__StarterCatalogSeedStamp\";");
        StarterCatalogSeedResult unmigrated = await new StarterCatalogWorkspaceService(withoutTable.Path).SeedAsync();
        Assert.Equal(first.AddedCount, unmigrated.AddedCount);
    }

    [Fact]
    public async Task MigrationInstallsTheStampTableAndTriggersOnFreshAndUpgradedDatabases()
    {
        Assert.Contains("20261017-starter-catalog-seed-stamp", ApplicationSchemaMigrator.KnownSchemaVersions);
        Assert.Matches("^[0-9a-f]{64}$", StarterCatalogWorkspaceService.ManifestDigest);

        await using TestDatabase fresh = await TestDatabase.CreateAsync("metraj-seed-stamp-fresh");
        Assert.Equal(5L, await ScalarAsync(fresh.Path, StampObjectsSql));

        await using TestDatabase upgraded = await TestDatabase.CreateAsync("metraj-seed-stamp-upgraded");
        await ExecuteAsync(upgraded.Path,
            """
            DROP TABLE "__StarterCatalogSeedStamp";
            DROP TRIGGER "TR_CatalogCardDefinitions_StarterSeedStamp_Delete";
            DROP TRIGGER "TR_CatalogCardDefinitions_StarterSeedStamp_Update";
            DROP TRIGGER "TR_CatalogCardVersions_StarterSeedStamp_Delete";
            DROP TRIGGER "TR_CatalogCardVersions_StarterSeedStamp_Update";
            DELETE FROM "__AppSchemaVersions" WHERE "Version" = '20261017-starter-catalog-seed-stamp';
            """);
        TestDatabase.ClearPoolFor(upgraded.Path);
        Assert.False(await ApplicationSchemaMigrator.IsUpToDateAsync(upgraded.Path));
        await upgraded.MigrateAsync();
        Assert.True(await ApplicationSchemaMigrator.IsUpToDateAsync(upgraded.Path));
        Assert.Equal(5L, await ScalarAsync(upgraded.Path, StampObjectsSql));
    }

    [Fact]
    public async Task TheStarterPackButtonReturnsTheSameBodyAsTheFullSeed()
    {
        await using TestDatabase stamped = await TestDatabase.CreateAsync("metraj-seed-button");
        await using TestDatabase reference = await TestDatabase.CreateAsync("metraj-seed-button-reference");
        using var stampedServices = MetrajServices.Create(stamped.Path);
        using var referenceServices = MetrajServices.Create(reference.Path);
        var stampedRouter = new MetrajRequestRouter(stampedServices);
        var referenceRouter = new MetrajRequestRouter(referenceServices);
        var press = new RouterRequest("POST", "/api/catalog/starter-pack", null, null, null);

        RouterResponse firstStamped = await stampedRouter.DispatchAsync(press, CancellationToken.None);
        RouterResponse firstReference = await referenceRouter.DispatchAsync(press, CancellationToken.None);
        await ExecuteAsync(reference.Path, "DELETE FROM \"__StarterCatalogSeedStamp\";");
        RouterResponse secondStamped = await stampedRouter.DispatchAsync(press, CancellationToken.None);
        RouterResponse secondReference = await referenceRouter.DispatchAsync(press, CancellationToken.None);

        Assert.Equal(firstReference.BodyJson, firstStamped.BodyJson);
        Assert.Equal(200, secondStamped.Status);
        Assert.Equal(secondReference.BodyJson, secondStamped.BodyJson);
        Assert.Contains("\"addedCount\":0,", secondStamped.BodyJson, StringComparison.Ordinal);
    }

    private const string StampObjectsSql =
        "SELECT COUNT(*) FROM sqlite_master WHERE (type = 'table' AND name = '__StarterCatalogSeedStamp') OR " +
        "(type = 'trigger' AND name LIKE 'TR_%_StarterSeedStamp_%');";

    /// <summary>
    /// Senaryoyu damgalı ve başvuru veritabanında yürütür; tohumlama sonuçlarının ve
    /// kataloğun aynı olduğunu doğrular, değişiklik sonrası tohumlamanın sonucunu döner.
    /// </summary>
    private static async Task<StarterCatalogSeedResult> AssertEquivalentAsync(string prefix, Func<TestDatabase, Task> change)
    {
        await using TestDatabase stamped = await TestDatabase.CreateAsync(prefix);
        await using TestDatabase reference = await TestDatabase.CreateAsync(prefix + "-reference");
        var stampedStarter = new StarterCatalogWorkspaceService(stamped.Path);
        var referenceStarter = new StarterCatalogWorkspaceService(reference.Path);

        await stampedStarter.SeedAsync();
        await referenceStarter.SeedAsync();
        await change(stamped);
        await change(reference);

        await ExecuteAsync(reference.Path, "DELETE FROM \"__StarterCatalogSeedStamp\";");
        StarterCatalogSeedResult viaStamp = await stampedStarter.SeedAsync();
        StarterCatalogSeedResult viaFullSeed = await referenceStarter.SeedAsync();
        AssertSameResult(viaFullSeed, viaStamp);
        Assert.Equal(await CatalogSnapshotAsync(reference.Path), await CatalogSnapshotAsync(stamped.Path));

        // Değişiklikten sonraki tam tohumlama damgayı yeniden yazdı; bir sonraki kısa yoldur.
        await ExecuteAsync(reference.Path, "DELETE FROM \"__StarterCatalogSeedStamp\";");
        AssertSameResult(await referenceStarter.SeedAsync(), await stampedStarter.SeedAsync());
        Assert.Equal(StarterCatalogWorkspaceService.ManifestDigest, await StampDigestAsync(stamped.Path));
        return viaStamp;
    }

    private static void AssertSameResult(StarterCatalogSeedResult expected, StarterCatalogSeedResult actual)
    {
        Assert.Equal(expected.AddedCount, actual.AddedCount);
        Assert.Equal(expected.ExistingCount, actual.ExistingCount);
        Assert.Equal(expected.AddedCodes.Order(StringComparer.Ordinal), actual.AddedCodes.Order(StringComparer.Ordinal));
    }

    /// <summary>Kimliklerden bağımsız katalog dökümü: kod, etkinlik ve sürümlerin adları.</summary>
    private static async Task<string[]> CatalogSnapshotAsync(string path)
    {
        await using SqliteConnection connection = await OpenAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT d."Code", d."IsActive", v."VersionNumber", v."Name"
            FROM "CatalogCardDefinitions" d JOIN "CatalogCardVersions" v ON v."CatalogCardDefinitionId" = d."Id"
            ORDER BY d."Code", v."VersionNumber";
            """;
        var rows = new List<string>();
        await using SqliteDataReader reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(string.Create(CultureInfo.InvariantCulture,
                $"{reader.GetString(0)}|{reader.GetInt64(1)}|{reader.GetInt64(2)}|{reader.GetString(3)}"));
        }

        return rows.ToArray();
    }

    private static async Task<string?> StampDigestAsync(string path)
    {
        await using SqliteConnection connection = await OpenAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = "SELECT \"ManifestDigest\" FROM \"__StarterCatalogSeedStamp\" WHERE \"Id\" = 1;";
        return await command.ExecuteScalarAsync() as string;
    }

    private static async Task<long> ScalarAsync(string path, string sql)
    {
        await using SqliteConnection connection = await OpenAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    }

    private static async Task ExecuteAsync(string path, string sql)
    {
        await using SqliteConnection connection = await OpenAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<SqliteConnection> OpenAsync(string path)
    {
        var connection = new SqliteConnection(MetrajDbContextFactory.BuildConnectionString(path));
        await connection.OpenAsync();
        return connection;
    }
}
