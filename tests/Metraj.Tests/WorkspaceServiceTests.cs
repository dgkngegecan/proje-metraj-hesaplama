using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

public sealed class WorkspaceServiceTests
{
    [Fact]
    public async Task WorkspaceCreatesProjectAndVersionedCatalogCard()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-phase3-workspace");
        string databasePath = database.Path;
        var projectService = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var catalogService = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var project = await projectService.CreateProjectAsync(" p-001 ", "Temiz Su Demo");
        var card = await catalogService.CreateCardAsync(new CatalogCardDraft(
            "cw-pex-16", "PEX Boru 16 mm", CardType.Material, ItemKind.Material,
            InputBehavior.Manual, SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 5m, 4m));

        Assert.Equal("P-001", project.Code);
        Assert.Equal(1, project.RevisionCount);
        Assert.Equal("CW-PEX-16", card.Code);
        Assert.Equal(1, card.LatestVersion);
        var nextCard = await catalogService.CreateVersionAsync(card.Id, new CatalogCardDraft(
            "ignored", "ignored", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.Package, ReportBehavior.Measurable, "adet", 2m, 10m));
        Assert.Equal(2, nextCard.LatestVersion);
        await catalogService.DeactivateCardAsync(card.Id);
        Assert.False((await catalogService.ListCardsAsync()).Single(x => x.Id == card.Id).IsActive);
        Assert.Contains((await catalogService.ListCardsAsync()), item => item.Id == card.Id);
        Assert.Contains((await projectService.ListProjectsAsync()), item => item.Id == project.Id);
    }
}
