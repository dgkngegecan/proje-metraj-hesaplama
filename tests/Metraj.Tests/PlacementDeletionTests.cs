using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Bir dalın silinmesi ya tamamen olur ya da hiç olmaz. Yarım kalmış bir silme,
/// kullanıcıya "silindi" denmesine rağmen haritada içi boşalmış bir kart
/// bırakıyordu ve geri alma yoktu.
/// </summary>
public sealed class PlacementDeletionTests
{
    [Fact]
    public async Task DeletingASubtreeRemovesEveryLevelAndItsMeasurements()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-DEL", "Silme testi");
        CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "SYS-DEL", "Sistem", CardType.System, ItemKind.Service, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Folder, "-"));
        CatalogCardListItem materialCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-DEL", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));

        // Üç seviyeli bir dal: sistem > malzeme > malzeme
        PlacementListItem system = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
        PlacementListItem branch = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId, system.Id));
        PlacementListItem leaf = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId, branch.Id));
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, branch.Id, 5m, "m"));
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, leaf.Id, 7m, "m"));

        // Dalın dışında kalan, silinmemesi gereken bir kart.
        PlacementListItem untouched = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId));
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, untouched.Id, 3m, "m"));

        await tree.DeletePlacementAsync(system.Id);

        IReadOnlyList<PlacementListItem> remaining = await tree.ListPlacementsAsync(project.LatestRevisionId);
        Assert.Equal(untouched.Id, Assert.Single(remaining).Id);

        MeasurementListItem survivor = Assert.Single(await measurements.ListMeasurementsAsync(project.LatestRevisionId));
        Assert.Equal(untouched.Id, survivor.PlacementId);
    }

    [Fact]
    public async Task DeletingASourceBranchInvalidatesResultsThatDependedOnIt()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        var calculations = new CalculationWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-DEL-CALC", "Silme ve hesap");
        CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-DEL-PIPE", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        CatalogCardListItem fittingCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "ACC-DEL-FIT", "Dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));

        PlacementListItem pipe = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId));
        // Dirsek, silinecek dalın DIŞINDA; hesabı silinen boruya dayanıyor.
        PlacementListItem fitting = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, fittingCard.LatestVersionId));
        await tree.AddLinkAsync(pipe.Id, fitting.Id, SemanticLinkType.CalculatedFrom);
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, pipe.Id, 10m, "m"));

        CalculationRuleListItem rule = await calculations.CreateRuleVersionAsync(
            project.LatestRevisionId,
            new CalculationRuleDraft("DIRSEK", "Dirsek payı", CalculationRuleMode.FixedMultiplier, 2m));
        CalculationResultListItem result = await calculations.CalculateAsync(
            project.LatestRevisionId, fitting.Id, rule.Id);
        await calculations.ApproveAsync(result.Id);

        await tree.DeletePlacementAsync(pipe.Id);

        // Dirseğin önerisi artık var olmayan ölçümlere dayanıyor: bayat olmalı.
        CalculationResultListItem current = Assert.Single(
            await calculations.ListResultsAsync(project.LatestRevisionId));
        Assert.Equal(CalculationResultStatus.Stale, current.Status);
    }

    [Fact]
    public async Task DeepTreesAreDeletedWithoutLeavingOrphans()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-DEEP", "Derin ağaç");
        CatalogCardListItem materialCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-DEEP", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));

        PlacementListItem root = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId));
        Guid parentId = root.Id;
        for (int depth = 0; depth < 25; depth++)
        {
            PlacementListItem child = await tree.AddPlacementAsync(
                new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId, parentId));
            parentId = child.Id;
        }

        await tree.DeletePlacementAsync(root.Id);

        Assert.Empty(await tree.ListPlacementsAsync(project.LatestRevisionId));
        await using MetrajDbContext context = database.ContextFactory();
        Assert.Equal(0, await context.ProjectPlacements.CountAsync());
    }
}
