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
    public async Task ApprovedQuantitiesDoNotChangeWhenGlobalWastePolicyChangesLater()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        var waste = new MaterialTypeWasteWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-FREEZE", "Dondurma testi");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-FREEZE", "Çelik boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m, MaterialType: "Steel"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 100m, "m"));

        await waste.UpsertAsync("Steel", 5m);
        MeasurementSummaryItem beforeApproval = Assert.Single(
            await measurements.ListSummariesAsync(project.LatestRevisionId));
        Assert.Equal(105m, beforeApproval.WithWasteQuantity);

        await projects.ApproveRevisionAsync(project.LatestRevisionId);

        // Onaydan SONRA merkezi politika değişiyor.
        await waste.UpsertAsync("Steel", 25m);

        MeasurementSummaryItem afterPolicyChange = Assert.Single(
            await measurements.ListSummariesAsync(project.LatestRevisionId));
        Assert.Equal(5m, afterPolicyChange.AppliedWasteRatePct);
        Assert.Equal(105m, afterPolicyChange.WithWasteQuantity);
    }

    [Fact]
    public async Task DraftRevisionsStillFollowTheCurrentGlobalWastePolicy()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        var waste = new MaterialTypeWasteWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-LIVE", "Canlı politika");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-LIVE", "Çelik boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m, MaterialType: "Steel"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 100m, "m"));

        await waste.UpsertAsync("Steel", 5m);
        Assert.Equal(105m, Assert.Single(await measurements.ListSummariesAsync(project.LatestRevisionId)).WithWasteQuantity);

        // Taslak revizyon düzenlenebilir olduğu için güncel politikayı izlemeli.
        await waste.UpsertAsync("Steel", 25m);
        Assert.Equal(125m, Assert.Single(await measurements.ListSummariesAsync(project.LatestRevisionId)).WithWasteQuantity);
    }

    [Fact]
    public async Task AMistypedMeasurementRowCanBeCorrectedAndDeleted()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-FIX", "Satır düzeltme");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-FIX", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));

        // Kullanıcı 12,4 yerine yanlışlıkla 124 yazar.
        MeasurementListItem typo = await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 124m, "m", Block: "A", Room: "101"));
        MeasurementListItem keep = await measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 18.6m, "m"));

        // Düzeltme, satırın diğer alanlarını korumalı.
        await measurements.UpdateMeasurementAsync(typo.Id, new MeasurementDraft(
            project.LatestRevisionId, placement.Id, 12.4m, "m", Block: "A", Room: "101"));

        IReadOnlyList<MeasurementListItem> afterFix = await measurements.ListMeasurementsAsync(project.LatestRevisionId);
        MeasurementListItem corrected = Assert.Single(afterFix, item => item.Id == typo.Id);
        Assert.Equal(12.4m, corrected.InputQuantity);
        Assert.Equal("A", corrected.Block);
        Assert.Equal("101", corrected.Room);
        Assert.NotNull(corrected.UpdatedAtUtc);
        Assert.Equal(31m, Assert.Single(await measurements.ListSummariesAsync(project.LatestRevisionId)).NetQuantity);

        // Yanlış satır tamamen silinebilmeli; diğeri kalmalı.
        await measurements.DeleteMeasurementAsync(typo.Id);
        MeasurementListItem survivor = Assert.Single(await measurements.ListMeasurementsAsync(project.LatestRevisionId));
        Assert.Equal(keep.Id, survivor.Id);
        Assert.Equal(18.6m, Assert.Single(await measurements.ListSummariesAsync(project.LatestRevisionId)).NetQuantity);
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
