using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class MeasurementWorkspaceTests
{
    [Fact]
    public async Task MeasurementsKeepContextAndCalculateWasteOncePerPlacement()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-phase4-measurements");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-MEAS", "Metraj testi");
        CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "SYS-MEAS", "Temiz su", CardType.System, ItemKind.Service, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Folder, "-"));
        CatalogCardListItem materialCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-MEAS", "PPRC DN25", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 5m, 4m));
        PlacementListItem system = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
        PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId, system.Id));

        MeasurementListItem first = await measurements.CreateMeasurementAsync(new MeasurementDraft(
            project.LatestRevisionId, pipe.Id, 12.4m, "m", "A", "1", "101", "Z-1", "M-01", "R1", "Kolon"));
        await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 18.6m, "m", "A", "1", "102"));
        MeasurementListItem copy = await measurements.DuplicateMeasurementAsync(first.Id);
        await measurements.UpdateMeasurementAsync(copy.Id, new MeasurementDraft(
            project.LatestRevisionId, pipe.Id, 1m, "m", "B", "2", "201", Notes: "Düzeltildi"));

        // Konum alanları değişse de geçmiş, girişin oluşturulma zamanına göre
        // kronolojik kalmalıdır. İlk satırı bilerek geleceğe taşıyarak
        // konuma göre sıralama yapılmadığını doğrula.
        await using (MetrajDbContext reorderContext = MetrajDbContextFactory.Create(databasePath))
        {
            Measurement firstEntity = await reorderContext.Measurements.SingleAsync(item => item.Id == first.Id);
            firstEntity.CreatedAtUtc = DateTime.UtcNow.AddHours(1);
            await reorderContext.SaveChangesAsync();
        }

        IReadOnlyList<MeasurementListItem> lines = await measurements.ListMeasurementsAsync(project.LatestRevisionId);
        Assert.Equal(lines.OrderBy(item => item.CreatedAtUtc).ThenBy(item => item.Id).Select(item => item.Id), lines.Select(item => item.Id));
        Assert.Equal(first.Id, lines[^1].Id);
        MeasurementListItem persisted = Assert.Single(lines, x => x.Id == first.Id);
        Assert.Equal("A", persisted.Block);
        Assert.Equal("101", persisted.Room);
        Assert.Equal("M-01", persisted.Sheet);
        Assert.Equal("R1", persisted.DrawingRevision);

        MeasurementSummaryItem summary = Assert.Single(await measurements.ListSummariesAsync(project.LatestRevisionId));
        Assert.Equal(3, summary.MeasurementCount);
        Assert.Equal(32m, summary.NetQuantity);
        Assert.Equal(33.6m, summary.WithWasteQuantity);
        Assert.Equal(9m, summary.PurchaseQuantity);
        Assert.Equal(2.4m, summary.RemainderQuantity);

        await Assert.ThrowsAsync<DomainRuleViolationException>(() => measurements.CreateMeasurementsAsync([
            new MeasurementDraft(project.LatestRevisionId, pipe.Id, 2m, "m"),
            new MeasurementDraft(project.LatestRevisionId, pipe.Id, 1m, "adet")
        ]));
        Assert.Equal(3, (await measurements.ListMeasurementsAsync(project.LatestRevisionId)).Count);

        MeasurementListItem synthetic = await measurements.CreateMeasurementAsync(new MeasurementDraft(
            project.LatestRevisionId, pipe.Id, 1m, "m", SourceKind: "SYNTHETIC"));
        await measurements.UpdateMeasurementAsync(synthetic.Id, new MeasurementDraft(
            project.LatestRevisionId, pipe.Id, 2m, "m"));
        Assert.Equal("SYNTHETIC", Assert.Single(await measurements.ListMeasurementsAsync(project.LatestRevisionId), x => x.Id == synthetic.Id).SourceKind);

        await Assert.ThrowsAsync<DomainRuleViolationException>(() => measurements.CreateMeasurementAsync(new MeasurementDraft(
            project.LatestRevisionId, pipe.Id, 1m, "adet")));
        await Assert.ThrowsAsync<DomainRuleViolationException>(() => measurements.CreateMeasurementAsync(new MeasurementDraft(
            project.LatestRevisionId, system.Id, 1m, "-")));
    }

    [Fact]
    public async Task BooleanMeasurementsAcceptOnlyDoneOrNotDoneValues()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-boolean-measurements");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-BOOL", "Boolean testi");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "CHK-DONE", "Test yapıldı", CardType.Accessory, ItemKind.Service, InputBehavior.Boolean,
            SalesConversion.None, ReportBehavior.Measurable, "adet"));
        PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));

        await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id, 1m, "adet"));
        await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id, 0m, "adet"));
        await Assert.ThrowsAsync<DomainRuleViolationException>(() => measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 2m, "adet")));
    }

    [Fact]
    public async Task DerivedMeasurementsRejectManualSourceRows()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-derived-measurements");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-DER", "Türetilmiş kalem testi");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "ACC-DER", "Türetilmiş dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Derived,
            SalesConversion.Package, ReportBehavior.Measurable, "adet", 0m, 10m));
        PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));

        await Assert.ThrowsAsync<DomainRuleViolationException>(() => measurements.CreateMeasurementAsync(
            new MeasurementDraft(project.LatestRevisionId, placement.Id, 1m, "adet")));
    }
}
