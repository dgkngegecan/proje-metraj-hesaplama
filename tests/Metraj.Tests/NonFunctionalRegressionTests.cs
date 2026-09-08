using System.Diagnostics;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;
using Xunit.Abstractions;

namespace Metraj.Tests;

/// <summary>
/// Exercises realistic and deliberately oversized local-desktop workloads against
/// an isolated SQLite file. The row-count assertions are the primary contract;
/// generous timing and retained-memory ceilings catch major regressions without
/// turning ordinary machine-load variance into false failures.
/// </summary>
public sealed class NonFunctionalRegressionTests(ITestOutputHelper output)
{
    private const int NormalVolume = 10_000;
    private const int StressVolume = 50_000;

    [Fact]
    [Trait("Category", "NonFunctional")]
    public async Task LocalLoadGrowthStressAndEnduranceRemainStable()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-nonfunctional-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            Workload workload = await CreateWorkloadAsync(databasePath);
            await SeedMeasurementsAsync(databasePath, workload, 0, NormalVolume);

            // Performance/scalability baseline: an intentionally large project is
            // read through the same application services used by the local API.
            var normalReadTimer = Stopwatch.StartNew();
            IReadOnlyList<MeasurementListItem> normalRows = await workload.Measurements.ListMeasurementsAsync(workload.RevisionId);
            IReadOnlyList<MeasurementSummaryItem> normalSummaries = await workload.Measurements.ListSummariesAsync(workload.RevisionId);
            normalReadTimer.Stop();
            var normalReportTimer = Stopwatch.StartNew();
            ProjectReportData normalReport = await workload.Reports.BuildReportDataAsync(workload.RevisionId);
            normalReportTimer.Stop();
            var normalElapsed = normalReadTimer.Elapsed + normalReportTimer.Elapsed;
            Assert.Equal(NormalVolume, normalRows.Count);
            Assert.Equal(NormalVolume, normalReport.SourceMeasurements.Count);
            Assert.Equal(12, normalSummaries.Count);
            Assert.Equal(NormalVolume, normalSummaries.Sum(item => item.NetQuantity));
            Assert.True(normalElapsed < TimeSpan.FromSeconds(25),
                $"10,000-row read/summary/report workload took {normalElapsed.TotalSeconds:N2} s.");

            // Expected local load is one user, but UI refresh, summary and export
            // can overlap. Four simultaneous read pipelines deliberately exceed it.
            var readLoadTimer = Stopwatch.StartNew();
            Task<(int Rows, decimal Net)>[] readers = Enumerable.Range(0, 4)
                .Select(_ => ReadSnapshotAsync(workload))
                .ToArray();
            (int Rows, decimal Net)[] readSnapshots = await Task.WhenAll(readers);
            readLoadTimer.Stop();
            Assert.All(readSnapshots, snapshot =>
            {
                Assert.Equal(NormalVolume, snapshot.Rows);
                Assert.Equal(NormalVolume, snapshot.Net);
            });
            Assert.True(readLoadTimer.Elapsed < TimeSpan.FromSeconds(30),
                $"Four concurrent 10,000-row readers took {readLoadTimer.Elapsed.TotalSeconds:N2} s.");

            // Rapid Enter presses can briefly overlap even in a single-user app.
            // Each write owns a short-lived DbContext and must survive contention.
            const int rapidWriteCount = 12;
            var writeLoadTimer = Stopwatch.StartNew();
            Task<MeasurementListItem>[] writers = Enumerable.Range(0, rapidWriteCount)
                .Select(index => workload.Measurements.CreateMeasurementAsync(new MeasurementDraft(
                    workload.RevisionId,
                    workload.PlacementId,
                    1m,
                    "m",
                    Floor: $"Hızlı giriş {index + 1}")))
                .ToArray();
            await Task.WhenAll(writers);
            writeLoadTimer.Stop();
            IReadOnlyList<MeasurementSummaryItem> afterWrites = await workload.Measurements.ListSummariesAsync(workload.RevisionId);
            Assert.Equal(NormalVolume + rapidWriteCount, afterWrites.Sum(item => item.NetQuantity));
            Assert.True(writeLoadTimer.Elapsed < TimeSpan.FromSeconds(30),
                $"Twelve concurrent writes took {writeLoadTimer.Elapsed.TotalSeconds:N2} s.");

            // A bounded endurance loop detects retained-context/result growth. This
            // is a repeatable CI guard, not a substitute for a multi-hour field soak.
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            long memoryBefore = GC.GetTotalMemory(forceFullCollection: true);
            var enduranceTimer = Stopwatch.StartNew();
            const int enduranceIterations = 200;
            for (int iteration = 0; iteration < enduranceIterations; iteration++)
            {
                IReadOnlyList<MeasurementSummaryItem> snapshot = await workload.Measurements.ListSummariesAsync(workload.RevisionId);
                Assert.Equal(NormalVolume + rapidWriteCount, snapshot.Sum(item => item.NetQuantity));
            }
            enduranceTimer.Stop();
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            long memoryAfter = GC.GetTotalMemory(forceFullCollection: true);
            long retainedBytes = Math.Max(0, memoryAfter - memoryBefore);
            Assert.True(enduranceTimer.Elapsed < TimeSpan.FromSeconds(30),
                $"{enduranceIterations} repeated summaries took {enduranceTimer.Elapsed.TotalSeconds:N2} s.");
            Assert.True(retainedBytes < 128L * 1024 * 1024,
                $"Repeated summaries retained {retainedBytes / 1024d / 1024d:N1} MiB.");

            // Stress/volume ceiling: grow the same project five-fold. The test does
            // not claim this is the breaking point; it proves the maximum exercised
            // volume remains correct and responsive on this architecture.
            await SeedMeasurementsAsync(databasePath, workload, NormalVolume, StressVolume - NormalVolume);
            var stressTimer = Stopwatch.StartNew();
            IReadOnlyList<MeasurementListItem> stressRows = await workload.Measurements.ListMeasurementsAsync(workload.RevisionId);
            IReadOnlyList<MeasurementSummaryItem> stressSummaries = await workload.Measurements.ListSummariesAsync(workload.RevisionId);
            stressTimer.Stop();
            int expectedStressRows = StressVolume + rapidWriteCount;
            Assert.Equal(expectedStressRows, stressRows.Count);
            Assert.Equal(expectedStressRows, stressSummaries.Sum(item => item.NetQuantity));
            Assert.True(stressTimer.Elapsed < TimeSpan.FromSeconds(35),
                $"50,000-row stress read/summary took {stressTimer.Elapsed.TotalSeconds:N2} s.");
            Assert.True(stressTimer.Elapsed <= normalReadTimer.Elapsed * 8 + TimeSpan.FromSeconds(2),
                $"Five-fold growth regressed from {normalReadTimer.Elapsed.TotalSeconds:N2} s to {stressTimer.Elapsed.TotalSeconds:N2} s.");

            FileInfo database = new(databasePath);
            output.WriteLine(
                "normal-read={0:N2}s; normal-report={1:N2}s; concurrent-read={2:N2}s; rapid-write={3:N2}s; " +
                "endurance-{4}={5:N2}s; retained={6:N1}MiB; stress={7:N2}s; rows={8:N0}; db={9:N1}MiB",
                normalReadTimer.Elapsed.TotalSeconds,
                normalReportTimer.Elapsed.TotalSeconds,
                readLoadTimer.Elapsed.TotalSeconds,
                writeLoadTimer.Elapsed.TotalSeconds,
                enduranceIterations,
                enduranceTimer.Elapsed.TotalSeconds,
                retainedBytes / 1024d / 1024d,
                stressTimer.Elapsed.TotalSeconds,
                expectedStressRows,
                database.Length / 1024d / 1024d);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete($"{databasePath}-wal");
            File.Delete($"{databasePath}-shm");
        }
    }

    private static async Task<(int Rows, decimal Net)> ReadSnapshotAsync(Workload workload)
    {
        IReadOnlyList<MeasurementListItem> rows = await workload.Measurements.ListMeasurementsAsync(workload.RevisionId);
        IReadOnlyList<MeasurementSummaryItem> summaries = await workload.Measurements.ListSummariesAsync(workload.RevisionId);
        return (rows.Count, summaries.Sum(item => item.NetQuantity));
    }

    private static async Task<Workload> CreateWorkloadAsync(string databasePath)
    {
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var reports = new ProjectReportWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-NFR", "İzole yük testi");
        CatalogCardListItem card = await catalog.CreateCardAsync(new CatalogCardDraft(
            "MAT-NFR",
            "Yük testi borusu",
            CardType.Material,
            ItemKind.Material,
            InputBehavior.Manual,
            SalesConversion.None,
            ReportBehavior.Measurable,
            "m"));
        PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        return new Workload(project.LatestRevisionId, placement.Id, measurements, reports);
    }

    private static async Task SeedMeasurementsAsync(string databasePath, Workload workload, int start, int count)
    {
        const int batchSize = 5_000;
        DateTime createdAt = DateTime.UtcNow;
        for (int offset = 0; offset < count; offset += batchSize)
        {
            int currentBatch = Math.Min(batchSize, count - offset);
            await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
            context.Measurements.AddRange(Enumerable.Range(start + offset, currentBatch).Select(index => new Measurement
            {
                Id = Guid.NewGuid(),
                ProjectRevisionId = workload.RevisionId,
                ProjectPlacementId = workload.PlacementId,
                SourceKind = "NFR",
                InputQuantity = 1m,
                InputUnit = "m",
                Block = $"Blok {index % 4 + 1}",
                Floor = $"Kat {index % 40 + 1}",
                Room = $"Mahal {index % 250 + 1}",
                Variant = $"DN{15 + index % 12 * 5}",
                CreatedAtUtc = createdAt.AddTicks(index)
            }));
            await context.SaveChangesAsync();
        }
    }

    private sealed record Workload(
        Guid RevisionId,
        Guid PlacementId,
        MeasurementWorkspaceService Measurements,
        ProjectReportWorkspaceService Reports);
}
