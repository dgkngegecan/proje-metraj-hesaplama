using System.Diagnostics;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

public sealed class PerformanceRegressionTests
{
    private readonly Xunit.Abstractions.ITestOutputHelper output;

    /// <param name="output">Ölçülen süreyi teste iliştirir.</param>
    public PerformanceRegressionTests(Xunit.Abstractions.ITestOutputHelper output) => this.output = output;

    [Fact]
    public async Task LargeMeasurementReadAndReportSnapshotRemainResponsive()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-performance");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var reports = new ProjectReportWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-PERF", "Büyük veri testi");
        CatalogCardListItem card = await catalog.CreateCardAsync(new CatalogCardDraft(
            "MAT-PERF", "Performans borusu", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));

        await using (MetrajDbContext seed = MetrajDbContextFactory.Create(databasePath))
        {
            DateTime now = DateTime.UtcNow;
            seed.Measurements.AddRange(Enumerable.Range(1, 2_500).Select(index => new Measurement
            {
                Id = Guid.NewGuid(),
                ProjectRevisionId = project.LatestRevisionId,
                ProjectPlacementId = placement.Id,
                SourceKind = "PERF",
                InputQuantity = 1m,
                InputUnit = "m",
                Block = "A",
                Floor = $"Kat {index % 20}",
                Room = $"Mahal {index % 50}",
                CreatedAtUtc = now
            }));
            await seed.SaveChangesAsync();
        }

        var timer = Stopwatch.StartNew();
        var rows = await measurements.ListMeasurementsAsync(project.LatestRevisionId);
        var summaries = await measurements.ListSummariesAsync(project.LatestRevisionId);
        ProjectReportData report = await reports.BuildReportDataAsync(project.LatestRevisionId);
        timer.Stop();

        Assert.Equal(2_500, rows.Count);
        MeasurementSummaryItem summary = Assert.Single(summaries);
        Assert.Equal(2_500m, summary.NetQuantity);
        Assert.Equal(2_500, report.SourceMeasurements.Count);
        // Ölçülen süre her zaman rapora yazılır; eğilimi insan takip edebilsin.
        output.WriteLine($"2.500 satırlık okuma + rapor anlık görüntüsü: {timer.Elapsed.TotalMilliseconds:N0} ms");

        // Duvar saati eşiği bir performans ÖLÇÜTÜ değil, felaket koruması.
        //
        // Önceki 5 saniyelik sınır makineye bağlıydı: yavaş bir disk, meşgul
        // bir CI ajanı ya da araya giren bir virüs taraması testi kırmızıya
        // döndürüyordu -- kodda hiçbir şey değişmeden. Rastgele kırmızıya dönen
        // bir test, insanların bütün süiti ciddiye almayı bırakmasına yol açar.
        //
        // Buradaki sınır yalnızca BÜYÜKLÜK SIRASI bir gerilemeyi yakalar:
        // örneğin bir sorgunun N+1'e ya da bir döngünün O(n²)'ye dönmesi.
        // Gerçek performans takibi yukarıdaki çıktı satırından yapılır.
        Assert.True(
            timer.Elapsed < TimeSpan.FromSeconds(30),
            $"2.500 satırlık okuma ve rapor anlık görüntüsü {timer.Elapsed.TotalMilliseconds:N0} ms sürdü; " +
            "bu bir büyüklük sırası gerilemesine işaret ediyor.");
    }
}
