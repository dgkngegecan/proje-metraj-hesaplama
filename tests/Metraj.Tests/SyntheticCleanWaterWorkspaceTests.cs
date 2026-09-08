using Metraj.Application;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

public sealed class SyntheticCleanWaterWorkspaceTests
{
    [Fact]
    public async Task ImportsTheSameFixtureWhenItIsProvidedAsAnEmbeddedStyleStream()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-synthetic-cw-stream-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            string csvPath = Path.Combine(AppContext.BaseDirectory, "TestData", "Phase0", "CleanWater", "fixtures", "measurements.csv");
            var sample = new SyntheticCleanWaterWorkspaceService(
                () => MetrajDbContextFactory.Create(databasePath),
                () => File.OpenRead(csvPath));
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));

            SyntheticCleanWaterImportResult imported = await sample.ImportAsync();
            Assert.Equal(14, imported.ImportedPlacementCount);
            Assert.Equal(36, imported.ImportedMeasurementCount);

            ProjectRevisionListItem initial = Assert.Single(await projects.ListRevisionsAsync(imported.Project.Id));
            Assert.Equal(1, initial.RevisionNumber);
            Assert.Equal("R0", initial.Code);
            await projects.ApproveRevisionAsync(initial.Id);
            ProjectRevisionListItem copy = await projects.CreateDraftRevisionAsync(imported.Project.Id);
            Assert.Equal(2, copy.RevisionNumber);
            Assert.Equal("R1", copy.Code);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task ImportsAllSyntheticRowsOnceAndPreservesAuthoritativeGroupCalculations()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-synthetic-cw-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            string csvPath = Path.Combine(AppContext.BaseDirectory, "TestData", "Phase0", "CleanWater", "fixtures", "measurements.csv");
            var sample = new SyntheticCleanWaterWorkspaceService(() => MetrajDbContextFactory.Create(databasePath), csvPath);
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));

            SyntheticCleanWaterImportResult imported = await sample.ImportAsync();
            Assert.False(imported.AlreadyExisted);
            Assert.Equal(14, imported.ImportedPlacementCount);
            Assert.Equal(36, imported.ImportedMeasurementCount);

            MeasurementSummaryItem ppr25A = (await measurements.ListSummariesAsync(imported.Project.LatestRevisionId))
                .Single(x => x.PlacementName == "PPRC Boru DN25 — A Blok");
            Assert.Equal(4, ppr25A.MeasurementCount);
            Assert.Equal(45.25m, ppr25A.NetQuantity);
            Assert.Equal(47.5125m, ppr25A.WithWasteQuantity);
            Assert.Equal(12m, ppr25A.PurchaseQuantity);
            Assert.Equal(0.4875m, ppr25A.RemainderQuantity);

            SyntheticCleanWaterImportResult again = await sample.ImportAsync();
            Assert.True(again.AlreadyExisted);
            Assert.Equal(36, again.ImportedMeasurementCount);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
