using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Onaylanmış revizyon bir kayıttır: hiçbir yazma yolu onu değiştiremez.
/// Uygulama kullanıcıya "onaylandı ve kilitlendi" dediği için bu vaadin
/// her endpoint'te tutması gerekir.
/// </summary>
public sealed class ApprovedRevisionIntegrityTests
{
    [Fact]
    public async Task DuplicatingAMeasurementIsRejectedOnAnApprovedRevision()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-LOCK", "Kilit testi");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-LOCK", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        MeasurementListItem measurement = await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 12m, "m"));

        await projects.ApproveRevisionAsync(project.LatestRevisionId);

        DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(
            () => measurements.DuplicateMeasurementAsync(measurement.Id));
        Assert.Equal("revision.read-only", error.Rule);

        // Satır sayısı değişmemiş olmalı.
        Assert.Single(await measurements.ListMeasurementsAsync(project.LatestRevisionId));
    }

    [Fact]
    public async Task DuplicatingAMeasurementStillWorksOnADraftRevision()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-DRAFT", "Taslak testi");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-DRAFT", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        MeasurementListItem measurement = await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 12m, "m", Notes: "Kaynak satır"));

        MeasurementListItem copy = await measurements.DuplicateMeasurementAsync(measurement.Id);

        Assert.NotEqual(measurement.Id, copy.Id);
        Assert.Equal(12m, copy.InputQuantity);
        Assert.Equal("Kaynak satır", copy.Notes);
        Assert.Equal(2, (await measurements.ListMeasurementsAsync(project.LatestRevisionId)).Count);
    }
}
