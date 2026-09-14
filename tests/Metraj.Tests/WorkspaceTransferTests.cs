using Metraj.Domain;
using Metraj.Api;
using Metraj.Application;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Metraj.Tests;

public sealed class WorkspaceTransferTests
{
    [Fact]
    public async Task HttpEndpointsDownloadAndUploadPortableWorkspace()
    {
        await using TestDatabase sourceDatabase = await TestDatabase.CreateAsync("metraj-transfer-api-source");
        await using TestDatabase destinationDatabase = await TestDatabase.CreateAsync("metraj-transfer-api-destination");
        SeedIds sourceIds = await SeedCompleteWorkspaceAsync(sourceDatabase.Path, "API-SRC");
        byte[] package;
        await using (LocalApiHost sourceHost = await LocalApiHost.StartAsync(sourceDatabase.Path))
        {
            using var sourceClient = new HttpClient { BaseAddress = sourceHost.BaseUri };
            using HttpResponseMessage export = await sourceClient.GetAsync("api/workspace/export");
            Assert.Equal(HttpStatusCode.OK, export.StatusCode);
            Assert.Equal("application/vnd.projemetraj.workspace", export.Content.Headers.ContentType?.MediaType);
            Assert.EndsWith(".metraj", export.Content.Headers.ContentDisposition?.FileNameStar ?? export.Content.Headers.ContentDisposition?.FileName, StringComparison.OrdinalIgnoreCase);
            package = await export.Content.ReadAsByteArrayAsync();
        }

        await using LocalApiHost destinationHost = await LocalApiHost.StartAsync(destinationDatabase.Path);
        using var destinationClient = new HttpClient { BaseAddress = destinationHost.BaseUri };
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(package), "file", "aktarim.metraj");
        using HttpResponseMessage import = await destinationClient.PostAsync("api/workspace/import", form);
        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        WorkspaceImportResult? result = await import.Content.ReadFromJsonAsync<WorkspaceImportResult>();
        Assert.Equal(1, result?.ImportedProjects);
        ProjectListItem[] projects = (await destinationClient.GetFromJsonAsync<ProjectListItem[]>("api/projects"))!;
        Assert.Contains(projects, x => x.Id == sourceIds.ProjectId);
    }

    [Fact]
    public async Task ExportedWorkspaceMergesAdditivelyAndSecondImportIsIdempotent()
    {
        await using TestDatabase sourceDatabase = await TestDatabase.CreateAsync("metraj-transfer-source");
        await using TestDatabase destinationDatabase = await TestDatabase.CreateAsync("metraj-transfer-destination");
        string packagePath = Path.Combine(Path.GetTempPath(), $"metraj-transfer-{Guid.NewGuid():N}.metraj");
        try
        {
            SeedIds sourceIds = await SeedCompleteWorkspaceAsync(sourceDatabase.Path, "SRC");
            SeedIds destinationIds = await SeedCatalogAndProjectCodeCollisionAsync(destinationDatabase.Path, "SRC");

            var exporter = new WorkspaceTransferService(() => sourceDatabase.Path);
            await exporter.ExportAsync(packagePath);
            Assert.True(File.Exists(packagePath));
            Assert.True(new FileInfo(packagePath).Length > 0);

            var importer = new WorkspaceTransferService(() => destinationDatabase.Path);
            var first = await importer.ImportAsync(packagePath);
            Assert.Equal(1, first.ImportedProjects);
            Assert.Equal(0, first.SkippedProjects);
            Assert.Equal(0, first.ImportedCatalogCards);
            Assert.Equal(0, first.ImportedCardVersions);
            Assert.Equal(1, first.ImportedWasteSettings);

            await using (MetrajDbContext verification = MetrajDbContextFactory.Create(destinationDatabase.Path))
            {
                Assert.Equal(2, await verification.Projects.CountAsync());
                Project imported = await verification.Projects.SingleAsync(x => x.Id == sourceIds.ProjectId);
                Assert.Equal("SRC-IMPORT-1", imported.Code);
                Assert.Equal(destinationIds.CardVersionId,
                    await verification.ProjectPlacements.Where(x => x.Id == sourceIds.PlacementId)
                        .Select(x => x.CatalogCardVersionId).SingleAsync());
                Assert.Equal(1, await verification.PlacementContextNotes.CountAsync());
                Assert.Equal(1, await verification.Measurements.CountAsync());
                Assert.Equal(1, await verification.ResponsibilityAssignments.CountAsync());
                Assert.Equal(1, await verification.CalculationResults.CountAsync());
                Assert.Equal(1, await verification.AuditEntries.CountAsync());
            }

            var second = await importer.ImportAsync(packagePath);
            Assert.Equal(0, second.ImportedProjects);
            Assert.Equal(1, second.SkippedProjects);
            await using MetrajDbContext final = MetrajDbContextFactory.Create(destinationDatabase.Path);
            Assert.Equal(2, await final.Projects.CountAsync());
            Assert.Equal(1, await final.Measurements.CountAsync());
        }
        finally
        {
            using (var readOnly = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = packagePath, Mode = SqliteOpenMode.ReadOnly, ForeignKeys = true
            }.ToString()))
                SqliteConnection.ClearPool(readOnly);
            TestDatabase.ClearPoolFor(packagePath);
            if (File.Exists(packagePath)) File.Delete(packagePath);
        }
    }

    private static async Task<SeedIds> SeedCompleteWorkspaceAsync(string path, string projectCode)
    {
        var definitionId = Guid.NewGuid();
        var versionId = Guid.NewGuid();
        var projectId = Guid.NewGuid();
        var revisionId = Guid.NewGuid();
        var placementId = Guid.NewGuid();
        var measurementId = Guid.NewGuid();
        var dimensionId = Guid.NewGuid();
        var partyId = Guid.NewGuid();
        var ruleId = Guid.NewGuid();
        var resultId = Guid.NewGuid();

        await using MetrajDbContext context = MetrajDbContextFactory.Create(path);
        context.CatalogCardDefinitions.Add(new CatalogCardDefinition { Id = definitionId, Code = "TRANSFER-CARD", Name = "Transfer kartı" });
        context.CatalogCardVersions.Add(new CatalogCardVersion
        {
            Id = versionId, CatalogCardDefinitionId = definitionId, VersionNumber = 1, Name = "Transfer kartı",
            CardType = CardType.Material, ItemKind = ItemKind.Material, InputBehavior = InputBehavior.Manual,
            SalesConversion = SalesConversion.None, ReportBehavior = ReportBehavior.Measurable,
            Unit = "adet", ContentHash = "transfer-card-v1", IsPublished = true
        });
        context.Projects.Add(new Project { Id = projectId, Code = projectCode, Name = "Aktarılacak proje" });
        context.ProjectRevisions.Add(new ProjectRevision { Id = revisionId, ProjectId = projectId, RevisionNumber = 1, Code = "R1" });
        context.ProjectPlacements.Add(new ProjectPlacement { Id = placementId, ProjectRevisionId = revisionId, CatalogCardVersionId = versionId });
        context.Measurements.Add(new Measurement { Id = measurementId, ProjectRevisionId = revisionId, ProjectPlacementId = placementId, InputQuantity = 12, InputUnit = "adet" });
        context.PlacementContextNotes.Add(new PlacementContextNote { Id = Guid.NewGuid(), PlacementId = placementId, Floor = "1", Text = "Aktarılan not" });
        context.ResponsibilityDimensions.Add(new ResponsibilityDimension { Id = dimensionId, ProjectRevisionId = revisionId, Code = "MONTAJ", Name = "Montaj", SortOrder = 1 });
        context.ResponsibilityParties.Add(new ResponsibilityParty { Id = partyId, ProjectRevisionId = revisionId, Code = "A", Name = "Firma A" });
        context.CalculationRuleVersions.Add(new CalculationRuleVersion { Id = ruleId, ProjectRevisionId = revisionId, Code = "DIRECT", Name = "Doğrudan", VersionNumber = 1, ContentHash = "rule-v1" });
        await context.SaveChangesAsync();

        context.ResponsibilityAssignments.Add(new ResponsibilityAssignment
        {
            Id = Guid.NewGuid(), ProjectRevisionId = revisionId, ResponsibilityDimensionId = dimensionId,
            ProjectPlacementId = placementId, ResponsibilityPartyId = partyId, State = ResponsibilityAssignmentState.Assigned
        });
        context.CalculationResults.Add(new CalculationResult
        {
            Id = resultId, ProjectRevisionId = revisionId, TargetPlacementId = placementId,
            CalculationRuleVersionId = ruleId, CardVersionId = versionId,
            SourceMeasurementIdsJson = $"[\"{measurementId}\"]", InputSummary = "12 adet", InputHash = "input-v1",
            EngineVersion = "engine", UnitPolicyVersion = "units", ProposedQuantity = 12,
            NetQuantity = 12, WithWasteQuantity = 12, PurchaseQuantity = 12, RemainderQuantity = 0
        });
        context.AuditEntries.Add(new AuditEntry { Id = Guid.NewGuid(), ProjectRevisionId = revisionId, EntityType = "Project", EntityId = projectId, EventType = "ImportedSeed" });
        context.MaterialTypeWasteSettings.Add(new MaterialTypeWasteSetting { Id = Guid.NewGuid(), MaterialType = "Transfer malzemesi", WasteRatePct = 4 });
        await context.SaveChangesAsync();
        return new SeedIds(projectId, placementId, versionId);
    }

    private static async Task<SeedIds> SeedCatalogAndProjectCodeCollisionAsync(string path, string projectCode)
    {
        SeedIds ids = await SeedCompleteWorkspaceAsync(path, projectCode);
        await using MetrajDbContext context = MetrajDbContextFactory.Create(path);
        context.Measurements.RemoveRange(context.Measurements);
        context.PlacementContextNotes.RemoveRange(context.PlacementContextNotes);
        context.ResponsibilityAssignments.RemoveRange(context.ResponsibilityAssignments);
        context.CalculationResults.RemoveRange(context.CalculationResults);
        context.AuditEntries.RemoveRange(context.AuditEntries);
        context.MaterialTypeWasteSettings.RemoveRange(context.MaterialTypeWasteSettings);
        await context.SaveChangesAsync();
        return ids;
    }

    private sealed record SeedIds(Guid ProjectId, Guid PlacementId, Guid CardVersionId);
}
