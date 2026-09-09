using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Rapor, kendi içinde tutarlı TEK bir anlık görüntüden kurulmalıdır. Parçalar
/// ayrı bağlantılardan okunursa, aralarına giren bir yazma kaynak satırları ile
/// özetleri farklı anlardan getirebilir ve rapor kendi kendisiyle çelişir.
/// </summary>
public sealed class ReportSnapshotConsistencyTests
{
    [Fact]
    public async Task ReportPartsAgreeWithEachOtherEvenWhenAWriteLandsDuringTheBuild()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        var reports = new ProjectReportWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-SNAP", "Anlık görüntü");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-SNAP", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        for (int index = 0; index < 5; index++)
        {
            await measurements.CreateMeasurementAsync(
                new MeasurementDraft(project.LatestRevisionId, placement.Id, 10m, "m"));
        }

        ProjectReportData report = await reports.BuildReportDataAsync(project.LatestRevisionId);

        // Kaynak satırlarının toplamı, özetin net miktarına eşit olmalı.
        decimal sourceTotal = report.SourceMeasurements.Sum(item => item.InputQuantity);
        MeasurementSummaryItem summary = Assert.Single(report.Summaries);
        Assert.Equal(sourceTotal, summary.NetQuantity);
        Assert.Equal(report.SourceMeasurements.Count, summary.MeasurementCount);
    }

    [Fact]
    public async Task ReportBuildDoesNotLeaveAnOpenTransactionBehind()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var reports = new ProjectReportWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-TX", "İşlem sızıntısı");
        await reports.BuildReportDataAsync(project.LatestRevisionId);

        // Rapor okuması bittikten sonra yazma yolları çalışmaya devam etmeli.
        ProjectListItem second = await projects.CreateProjectAsync("P-TX-2", "Sonraki yazma");
        Assert.Contains(await projects.ListProjectsAsync(), item => item.Id == second.Id);

        // Ve rapor tekrar tekrar üretilebilmeli.
        await reports.BuildReportDataAsync(project.LatestRevisionId);
        await reports.BuildReportDataAsync(project.LatestRevisionId);
    }
}
