using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Onaylanmış bir hesap önerisi, dayandığı kaynak metraj değiştiğinde artık
/// doğru değildir. Ekranda "Onaylandı" etiketiyle duran yanlış bir miktar,
/// doğrudan sipariş hatasına giden yoldur; bu yüzden bayatlama görünür olmalıdır.
/// </summary>
public sealed class CalculationFreshnessTests
{
    private sealed record Scenario(
        ProjectListItem Project,
        PlacementListItem Pipe,
        PlacementListItem Fitting,
        MeasurementListItem PipeMeasurement,
        CalculationRuleListItem Rule,
        MeasurementWorkspaceService Measurements,
        CalculationWorkspaceService Calculations,
        ProjectReportWorkspaceService Reports,
        ProjectWorkspaceService Projects);

    private static async Task<Scenario> BuildAsync(TestDatabase database)
    {
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        var calculations = new CalculationWorkspaceService(database.ContextFactory);
        var reports = new ProjectReportWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-STALE", "Bayatlama testi");
        CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-STALE-PIPE", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        CatalogCardListItem fittingCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "ACC-STALE-FIT", "Dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));

        PlacementListItem pipe = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId));
        PlacementListItem fitting = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, fittingCard.LatestVersionId));
        await tree.AddLinkAsync(pipe.Id, fitting.Id, SemanticLinkType.CalculatedFrom);

        MeasurementListItem pipeMeasurement = await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, pipe.Id, 10m, "m"));
        CalculationRuleListItem rule = await calculations.CreateRuleVersionAsync(
            project.LatestRevisionId,
            new CalculationRuleDraft("DIRSEK", "Dirsek payı", CalculationRuleMode.FixedMultiplier, 2m));

        return new Scenario(project, pipe, fitting, pipeMeasurement, rule, measurements, calculations, reports, projects);
    }

    [Fact]
    public async Task ApprovedResultGoesStaleWhenItsSourceMeasurementChanges()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        Scenario scenario = await BuildAsync(database);

        CalculationResultListItem result = await scenario.Calculations.CalculateAsync(
            scenario.Project.LatestRevisionId, scenario.Fitting.Id, scenario.Rule.Id);
        Assert.Equal(20m, result.ProposedQuantity);
        await scenario.Calculations.ApproveAsync(result.Id);

        // Kaynak metraj düzeltilir: 10 -> 20. Taze bir hesap 40 verirdi.
        await scenario.Measurements.UpdateMeasurementAsync(
            scenario.PipeMeasurement.Id,
            new MeasurementDraft(scenario.Project.LatestRevisionId, scenario.Pipe.Id, 20m, "m"));

        CalculationResultListItem current = Assert.Single(
            await scenario.Calculations.ListResultsAsync(scenario.Project.LatestRevisionId));
        Assert.Equal(CalculationResultStatus.Stale, current.Status);

        // Bayatlamış öneri satın alma listesine yanlış miktarla girmemeli.
        ProjectReportData report = await scenario.Reports.BuildReportDataAsync(scenario.Project.LatestRevisionId);
        Assert.DoesNotContain(report.PurchaseItems, item => item.PlacementId == scenario.Fitting.Id);
    }

    [Fact]
    public async Task DeletingASourceMeasurementAlsoInvalidatesTheResult()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        Scenario scenario = await BuildAsync(database);

        CalculationResultListItem result = await scenario.Calculations.CalculateAsync(
            scenario.Project.LatestRevisionId, scenario.Fitting.Id, scenario.Rule.Id);
        await scenario.Calculations.ApproveAsync(result.Id);

        await scenario.Measurements.DeleteMeasurementAsync(scenario.PipeMeasurement.Id);

        CalculationResultListItem current = Assert.Single(
            await scenario.Calculations.ListResultsAsync(scenario.Project.LatestRevisionId));
        Assert.Equal(CalculationResultStatus.Stale, current.Status);
    }

    [Fact]
    public async Task AddingASourceMeasurementAlsoInvalidatesTheResult()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        Scenario scenario = await BuildAsync(database);

        CalculationResultListItem result = await scenario.Calculations.CalculateAsync(
            scenario.Project.LatestRevisionId, scenario.Fitting.Id, scenario.Rule.Id);
        await scenario.Calculations.ApproveAsync(result.Id);

        await scenario.Measurements.CreateMeasurementAsync(
            new MeasurementDraft(scenario.Project.LatestRevisionId, scenario.Pipe.Id, 7m, "m"));

        CalculationResultListItem current = Assert.Single(
            await scenario.Calculations.ListResultsAsync(scenario.Project.LatestRevisionId));
        Assert.Equal(CalculationResultStatus.Stale, current.Status);
    }

    [Fact]
    public async Task ARevisionCannotBeApprovedWhileAResultIsStale()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        Scenario scenario = await BuildAsync(database);

        CalculationResultListItem result = await scenario.Calculations.CalculateAsync(
            scenario.Project.LatestRevisionId, scenario.Fitting.Id, scenario.Rule.Id);
        await scenario.Calculations.ApproveAsync(result.Id);
        await scenario.Measurements.UpdateMeasurementAsync(
            scenario.PipeMeasurement.Id,
            new MeasurementDraft(scenario.Project.LatestRevisionId, scenario.Pipe.Id, 20m, "m"));

        DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(
            () => scenario.Projects.ApproveRevisionAsync(scenario.Project.LatestRevisionId));
        Assert.Equal("revision.stale-calculations", error.Rule);

        // Yeniden hesaplayıp onaylayınca revizyon onaylanabilmeli.
        CalculationResultListItem fresh = await scenario.Calculations.CalculateAsync(
            scenario.Project.LatestRevisionId, scenario.Fitting.Id, scenario.Rule.Id);
        Assert.Equal(40m, fresh.ProposedQuantity);
        await scenario.Calculations.ApproveAsync(fresh.Id);
        await scenario.Projects.ApproveRevisionAsync(scenario.Project.LatestRevisionId);
    }

    [Fact]
    public async Task UnrelatedMeasurementChangesDoNotInvalidateAResult()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        Scenario scenario = await BuildAsync(database);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);

        CalculationResultListItem result = await scenario.Calculations.CalculateAsync(
            scenario.Project.LatestRevisionId, scenario.Fitting.Id, scenario.Rule.Id);
        await scenario.Calculations.ApproveAsync(result.Id);

        // Hesaba hiç girmeyen, bağlantısız başka bir kartta ölçüm değişikliği.
        CatalogCardListItem otherCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-STALE-OTHER", "İlgisiz", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem other = await tree.AddPlacementAsync(
            new PlacementDraft(scenario.Project.LatestRevisionId, otherCard.LatestVersionId));
        await scenario.Measurements.CreateMeasurementAsync(
            new MeasurementDraft(scenario.Project.LatestRevisionId, other.Id, 5m, "m"));

        CalculationResultListItem current = Assert.Single(
            await scenario.Calculations.ListResultsAsync(scenario.Project.LatestRevisionId));
        Assert.Equal(CalculationResultStatus.Approved, current.Status);
    }
}
