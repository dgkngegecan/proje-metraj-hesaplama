using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Malzeme ailesi fire kuralları, metraj özetinde büyük/küçük harf duyarsız
/// olarak aranır. Depolama tarafı da aynı politikayı uygulamak zorundadır;
/// aksi halde "Steel" ve "steel" iki satır olur ve özet sorgusu çöker.
/// </summary>
public sealed class MaterialTypeWasteWorkspaceTests
{
    [Fact]
    public async Task UpsertTreatsMaterialTypeCaseInsensitivelyAndKeepsSummariesWorking()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var waste = new MaterialTypeWasteWorkspaceService(database.ContextFactory);

        MaterialTypeWasteSettingItem first = await waste.UpsertAsync("Steel", 5m);
        MaterialTypeWasteSettingItem second = await waste.UpsertAsync("steel", 10m);

        // Aynı aile: ikinci yazma yeni satır açmaz, mevcut satırı günceller.
        Assert.Equal(first.Id, second.Id);
        Assert.Equal(10m, second.WasteRatePct);
        MaterialTypeWasteSettingItem single = Assert.Single(await waste.ListAsync());
        Assert.Equal(10m, single.WasteRatePct);

        // Asıl kullanıcı etkisi: özet artık çökmemelidir.
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-WASTE", "Fire testi");
        CatalogCardListItem pipe = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-WASTE", "Çelik boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m, MaterialType: "Steel"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, pipe.LatestVersionId));
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 100m, "m"));

        MeasurementSummaryItem summary = Assert.Single(
            await measurements.ListSummariesAsync(project.LatestRevisionId));
        Assert.Equal(100m, summary.NetQuantity);
        // Merkezi aile kuralı (%10), kartın kendi oranının (%0) yerine geçer.
        Assert.Equal(10m, summary.AppliedWasteRatePct);
        Assert.Equal(110m, summary.WithWasteQuantity);
    }

    [Fact]
    public async Task LegacyCaseCollisionIsMergedDuringMigrationInsteadOfBreakingSummaries()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();

        // Harf duyarlı ESKİ şemayı birebir yeniden kur: NOCASE harmanlaması yokken
        // "Steel" ve "steel" iki ayrı satır olarak kaydedilebiliyordu.
        await database.ExecuteAsync(
            """
            DROP INDEX IF EXISTS "IX_MaterialTypeWasteSettings_MaterialType";
            DROP TABLE IF EXISTS "MaterialTypeWasteSettings";
            CREATE TABLE "MaterialTypeWasteSettings" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_MaterialTypeWasteSettings" PRIMARY KEY,
                "MaterialType" TEXT NOT NULL,
                "WasteRatePct" INTEGER NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL
            );
            CREATE UNIQUE INDEX "IX_MaterialTypeWasteSettings_MaterialType"
                ON "MaterialTypeWasteSettings" ("MaterialType");
            INSERT INTO "MaterialTypeWasteSettings" ("Id", "MaterialType", "WasteRatePct", "UpdatedAtUtc")
            VALUES ('11111111-1111-1111-1111-111111111111', 'Steel', 5000000, '2026-01-01T00:00:00.0000000Z');
            INSERT INTO "MaterialTypeWasteSettings" ("Id", "MaterialType", "WasteRatePct", "UpdatedAtUtc")
            VALUES ('22222222-2222-2222-2222-222222222222', 'steel', 12000000, '2026-02-01T00:00:00.0000000Z');
            """);

        // Yeniden migrate: çakışma sessizce birleşmeli, en güncel kayıt kazanmalı.
        await database.MigrateAsync();

        var waste = new MaterialTypeWasteWorkspaceService(database.ContextFactory);
        MaterialTypeWasteSettingItem merged = Assert.Single(await waste.ListAsync());
        Assert.Equal(12m, merged.WasteRatePct);
    }
}
