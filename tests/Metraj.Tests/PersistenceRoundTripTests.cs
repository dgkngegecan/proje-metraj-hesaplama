using System.Data.Common;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class PersistenceRoundTripTests
{
    [Fact]
    public async Task CatalogProjectAndMeasurementRoundTripPreservesScaledDecimals()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase2-roundtrip-{Guid.NewGuid():N}.db");
        var cardDefinitionId = Guid.NewGuid();
        var cardVersionId = Guid.NewGuid();
        var projectId = Guid.NewGuid();
        var revisionId = Guid.NewGuid();
        var placementId = Guid.NewGuid();

        try
        {
            using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
                CatalogCardDefinition definition = new()
                {
                    Id = cardDefinitionId,
                    Code = "CW-PIPE-PEX",
                    Name = "PEX temiz su borusu"
                };
                CatalogCardVersion version = new()
                {
                    Id = cardVersionId,
                    CatalogCardDefinitionId = definition.Id,
                    VersionNumber = 1,
                    CardType = CardType.Material,
                    ItemKind = ItemKind.Material,
                    InputBehavior = InputBehavior.Manual,
                    SalesConversion = SalesConversion.StandardLength,
                    ReportBehavior = ReportBehavior.Measurable,
                    Unit = "m",
                    WasteRatePct = 7.125000m,
                    ContainerParameter = 5.500000m,
                    ContentHash = "fixture-card-v1"
                };
                Project project = new() { Id = projectId, Code = "P-001", Name = "Roundtrip" };
                ProjectRevision revision = new() { Id = revisionId, ProjectId = project.Id, RevisionNumber = 1, Code = "R0" };
                ProjectPlacement placement = new()
                {
                    Id = placementId,
                    ProjectRevisionId = revision.Id,
                    CatalogCardVersionId = version.Id,
                    DisplayNameOverride = "Temiz su borusu"
                };
                Measurement measurement = new()
                {
                    Id = Guid.NewGuid(),
                    ProjectRevisionId = revision.Id,
                    ProjectPlacementId = placement.Id,
                    InputQuantity = 123.456789m,
                    InputUnit = "m",
                    Block = "A",
                    Floor = "01",
                    Room = "Daire 1"
                };

                context.AddRange(definition, version, project, revision, placement, measurement);
                await context.SaveChangesAsync();
            }

            using (MetrajDbContext reopened = MetrajDbContextFactory.Create(databasePath))
            {
                CatalogCardVersion version = await reopened.CatalogCardVersions.FindAsync(cardVersionId)
                    ?? throw new InvalidOperationException("Card version was not persisted.");
                var measurementId = await reopened.Measurements.Select(x => x.Id).SingleAsync();
                Measurement measurement = await reopened.Measurements.FindAsync(measurementId)
                    ?? throw new InvalidOperationException("Measurement was not persisted.");

                Assert.Equal(7.125000m, version.WasteRatePct);
                Assert.Equal(5.500000m, version.ContainerParameter);
                Assert.Equal(123.456789m, measurement.InputQuantity);

                using DbConnection connection = reopened.Database.GetDbConnection();
                await connection.OpenAsync();
                using DbCommand command = connection.CreateCommand();
                command.CommandText = "SELECT InputQuantity FROM Measurements LIMIT 1";
                Assert.Equal(123456789L, (long)(await command.ExecuteScalarAsync())!);
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
