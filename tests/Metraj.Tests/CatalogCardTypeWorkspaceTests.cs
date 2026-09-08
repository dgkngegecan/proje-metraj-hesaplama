using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

public sealed class CatalogCardTypeWorkspaceTests
{
    [Fact]
    public async Task StandardCardAcceptsAndUpdatesSupportedBuiltInAttributesWithoutCustomType()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-standard-card-attributes-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
                await ApplicationSchemaMigrator.MigrateAsync(context);

            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            CatalogCardListItem created = await cards.CreateCardAsync(new CatalogCardDraft(
                "STANDARD-PIPE", "Standart boru", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.StandardLength, ReportBehavior.Measurable, "m",
                AttributeValues: new Dictionary<string, string>
                {
                    ["Notes"] = "İlk not",
                    ["MaterialType"] = "Siyah Çelik Boru",
                    ["WasteRatePct"] = "5,5"
                }));

            Assert.Null(created.CustomTypeId);
            Assert.Equal("İlk not", created.Notes);
            Assert.Equal("Siyah Çelik Boru", created.MaterialType);
            Assert.Equal(5.5m, created.WasteRatePct);

            CatalogCardListItem updated = await cards.CreateVersionAsync(created.Id, new CatalogCardDraft(
                created.Code, "Güncel standart boru", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.StandardLength, ReportBehavior.Measurable, "m",
                WasteRatePct: 8m,
                Notes: "Güncel not",
                MaterialType: "Galvaniz Çelik Boru"));

            Assert.Null(updated.CustomTypeId);
            Assert.Equal(2, updated.LatestVersion);
            Assert.Equal("Güncel standart boru", updated.Name);
            Assert.Equal("Güncel not", updated.Notes);
            Assert.Equal("Galvaniz Çelik Boru", updated.MaterialType);
            Assert.Equal(8m, updated.WasteRatePct);
            Assert.Empty(updated.AttributeValues ?? new Dictionary<string, string>());
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task StandardCardStillRejectsUnknownAttributeKeys()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-standard-card-unknown-attribute-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
                await ApplicationSchemaMigrator.MigrateAsync(context);

            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(() =>
                cards.CreateCardAsync(new CatalogCardDraft(
                    "UNKNOWN-ATTRIBUTE", "Bilinmeyen alan", CardType.Material, ItemKind.Material,
                    InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet",
                    AttributeValues: new Dictionary<string, string> { ["ArbitraryScript"] = "unsafe" })));

            Assert.Equal("catalog-type.attribute-key", error.Rule);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task CustomTypePersistsSelectedAttributesAndTreeConstraints()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-card-type-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
                await ApplicationSchemaMigrator.MigrateAsync(context);

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var types = new CatalogCardTypeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("TYPE", "Kart türü testi");
            CatalogCardListItem system = await cards.CreateCardAsync(new("SYS-TYPE", "Isıtma sistemi", CardType.System, ItemKind.Service, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem fitting = await cards.CreateCardAsync(new("FIT-TYPE", "Dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet"));
            CatalogCardListItem unrelated = await cards.CreateCardAsync(new("UNRELATED-TYPE", "Başka parça", CardType.Accessory, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet"));

            CatalogCardTypeListItem type = await types.CreateTypeAsync(new CatalogCardTypeDraft(
                "PIPE-TYPE", "Özel boru", CardType.Material,
                AllowedParentCardIds: [system.Id],
                AllowedChildCardIds: [fitting.Id],
                AttributeKeys: ["Notes", "WasteRatePct", "MaterialType", "CompatibleDiameters", "InputBehavior"]));

            Assert.Contains("Code", type.AttributeKeys);
            Assert.Contains("Unit", type.AttributeKeys);
            Assert.Contains("Notes", type.AttributeKeys);
            Assert.Contains(system.Id, type.AllowedParentCardIds);
            Assert.Contains(fitting.Id, type.AllowedChildCardIds);

            CatalogCardListItem pipe = await cards.CreateCardAsync(new CatalogCardDraft(
                "PIPE-CUSTOM", "Özel DN25 boru", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m",
                CustomTypeId: type.Id,
                AttributeValues: new Dictionary<string, string>
                {
                    ["Notes"] = "Saha notu",
                    ["WasteRatePct"] = "7,5",
                    ["MaterialType"] = "Çelik",
                    ["CompatibleDiameters"] = "DN25, DN32"
                }));

            Assert.Equal(type.Id, pipe.CustomTypeId);
            Assert.Equal("Özel boru", pipe.CustomTypeName);
            Assert.Equal(7.5m, pipe.WasteRatePct);
            Assert.Equal("Çelik", pipe.MaterialType);
            Assert.Equal(["DN25", "DN32"], pipe.CompatibleDiameters);
            Assert.Equal("Saha notu", pipe.Notes);

            PlacementListItem systemPlacement = await tree.AddPlacementAsync(new(project.LatestRevisionId, system.LatestVersionId));
            PlacementListItem pipePlacement = await tree.AddPlacementAsync(new(project.LatestRevisionId, pipe.LatestVersionId, systemPlacement.Id));
            await tree.AddPlacementAsync(new(project.LatestRevisionId, fitting.LatestVersionId, pipePlacement.Id));
            await Assert.ThrowsAsync<DomainRuleViolationException>(() =>
                tree.AddPlacementAsync(new(project.LatestRevisionId, unrelated.LatestVersionId, pipePlacement.Id)));

            ProjectListItem secondProject = await projects.CreateProjectAsync("TYPE2", "Kart türü ikinci proje");
            PlacementListItem otherRoot = await tree.AddPlacementAsync(new(secondProject.LatestRevisionId, unrelated.LatestVersionId));
            await Assert.ThrowsAsync<DomainRuleViolationException>(() =>
                tree.AddPlacementAsync(new(secondProject.LatestRevisionId, pipe.LatestVersionId, otherRoot.Id)));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task DeletingReferencedCustomTypeKeepsExistingCardsAndDisablesFutureSelection()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-card-type-delete-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
                await ApplicationSchemaMigrator.MigrateAsync(context);
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var types = new CatalogCardTypeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            CatalogCardTypeListItem type = await types.CreateTypeAsync(new("TYPE-DELETE", "Silinecek tür", CardType.Material));
            await cards.CreateCardAsync(new CatalogCardDraft("TYPE-CARD", "Tür kartı", CardType.Material, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m", CustomTypeId: type.Id));

            await types.DeleteTypeAsync(type.Id);
            CatalogCardTypeListItem persisted = Assert.Single(await types.ListTypesAsync(), x => x.Id == type.Id);
            Assert.False(persisted.IsActive);
            Assert.Equal(type.Id, Assert.Single(await cards.ListCardsAsync(), x => x.Code == "TYPE-CARD").CustomTypeId);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
