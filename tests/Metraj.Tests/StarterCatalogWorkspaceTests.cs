using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

public sealed class StarterCatalogWorkspaceTests
{
    [Fact]
    public async Task StarterCatalogIsGlobalIdempotentAndReusableAcrossProjects()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-starter-catalog");
        string databasePath = database.Path;
        var starter = new StarterCatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        StarterCatalogSeedResult first = await starter.SeedAsync();

        Assert.True(first.AddedCount >= 40, "Başlangıç paketi mekanik tesisat için anlamlı bir katalog çekirdeği sağlamalıdır.");
        Assert.Contains("STD-CAT-MEK", first.AddedCodes);
        Assert.Contains("STD-PPRC-DN25", first.AddedCodes);
        Assert.Contains("STD-EQ-BOILER", first.AddedCodes);

        var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        IReadOnlyList<CatalogCardListItem> seededCards = await catalog.ListCardsAsync();
        Assert.Equal(first.AddedCount, seededCards.Count);

        CatalogCardListItem pprc25 = Assert.Single(seededCards, card => card.Code == "STD-PPRC-DN25");
        Assert.Equal(SalesConversion.StandardLength, pprc25.SalesConversion);
        Assert.Equal(4m, pprc25.ContainerParameter);
        Assert.Equal("PP-R", pprc25.MaterialType);
        Assert.False(string.IsNullOrWhiteSpace(pprc25.Notes));

        CatalogCardListItem elbow25 = Assert.Single(seededCards, card => card.Code == "STD-PPRC-ELBOW-25");
        Assert.Contains(elbow25.CompatibleDiameters!, diameter => diameter.Equals("DN25", StringComparison.OrdinalIgnoreCase));

        CatalogCardListItem custom = await catalog.CreateCardAsync(new CatalogCardDraft(
            "USER-CUSTOM-VALVE", "Özel vana", CardType.Accessory, ItemKind.Material,
            InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet"));
        int globalCount = (await catalog.ListCardsAsync()).Count;

        StarterCatalogSeedResult second = await starter.SeedAsync();
        Assert.Equal(0, second.AddedCount);
        Assert.Equal(first.AddedCount, second.ExistingCount);
        Assert.Equal(globalCount, (await catalog.ListCardsAsync()).Count);
        Assert.Contains(await catalog.ListCardsAsync(), card => card.Id == custom.Id);

        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem projectOne = await projects.CreateProjectAsync("P-GLOBAL-1", "Global katalog birinci proje");
        ProjectListItem projectTwo = await projects.CreateProjectAsync("P-GLOBAL-2", "Global katalog ikinci proje");
        PlacementListItem firstPlacement = await tree.AddPlacementAsync(new PlacementDraft(projectOne.LatestRevisionId, pprc25.LatestVersionId));
        PlacementListItem secondPlacement = await tree.AddPlacementAsync(new PlacementDraft(projectTwo.LatestRevisionId, pprc25.LatestVersionId));

        Assert.Equal(pprc25.LatestVersionId, firstPlacement.CardVersionId);
        Assert.Equal(pprc25.LatestVersionId, secondPlacement.CardVersionId);
        Assert.Equal(globalCount, (await catalog.ListCardsAsync()).Count);
    }
}
