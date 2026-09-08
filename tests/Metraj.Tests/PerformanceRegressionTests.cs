using System.Diagnostics;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

public sealed class PerformanceRegressionTests
{
    [Fact]
    public async Task LargeMeasurementReadAndReportSnapshotRemainResponsive()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-performance-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

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
            Assert.True(timer.Elapsed < TimeSpan.FromSeconds(5), $"2,500 satırlık okuma ve rapor anlık görüntüsü {timer.Elapsed.TotalMilliseconds:N0} ms sürdü.");
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }
}
