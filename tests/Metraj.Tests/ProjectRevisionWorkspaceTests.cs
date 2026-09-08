using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class ProjectRevisionWorkspaceTests
{
    [Fact]
    public async Task ApprovedRevisionIsClonedIntoASeparateDraftWithMappedProjectData()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-revision-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var responsibilities = new ResponsibilityWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var calculations = new CalculationWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-REV", "Revizyon testi");
            CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "SYS-REV", "Temiz su", CardType.System, ItemKind.Service, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "MAT-REV", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 3m, 4m));
            PlacementListItem system = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId, system.Id));
            await tree.AddLinkAsync(system.Id, pipe.Id, SemanticLinkType.Reference, "Kopya denetimi");
            await measurements.CreateMeasurementAsync(new MeasurementDraft(
                project.LatestRevisionId, pipe.Id, 12m, "m", Floor: "1", Variant: "DN25", SecondaryVariant: "Hat A"));
            ResponsibilityDimensionListItem dimension = await responsibilities.CreateDimensionAsync(project.LatestRevisionId, "montaj", "Montaj");
            ResponsibilityPartyListItem party = await responsibilities.CreatePartyAsync(project.LatestRevisionId, "tas", "Taşeron");
            await responsibilities.AssignPlacementAsync(project.LatestRevisionId, dimension.Id, system.Id, party.Id, ResponsibilityAssignmentState.Assigned);
            await calculations.CreateRuleVersionAsync(project.LatestRevisionId,
                new CalculationRuleDraft("FIX", "Sabit", CalculationRuleMode.FixedMultiplier, 1m));

            await projects.ApproveRevisionAsync(project.LatestRevisionId);
            ProjectRevisionListItem approved = Assert.Single(await projects.ListRevisionsAsync(project.Id));
            Assert.Equal(ProjectRevisionStatus.Approved, approved.Status);
            await Assert.ThrowsAsync<DomainRuleViolationException>(() => measurements.CreateMeasurementAsync(
                new MeasurementDraft(project.LatestRevisionId, pipe.Id, 1m, "m")));

            ProjectRevisionListItem draft = await projects.CreateDraftRevisionAsync(project.Id);
            Assert.Equal("R1", draft.Code);
            Assert.Equal(ProjectRevisionStatus.Draft, draft.Status);
            Assert.Equal(2, (await projects.ListRevisionsAsync(project.Id)).Count);

            await using MetrajDbContext verification = MetrajDbContextFactory.Create(databasePath);
            Assert.Equal(2, await verification.ProjectPlacements.CountAsync(x => x.ProjectRevisionId == draft.Id));
            Assert.Equal(1, await verification.Measurements.CountAsync(x => x.ProjectRevisionId == draft.Id));
            Measurement copiedMeasurement = await verification.Measurements.SingleAsync(x => x.ProjectRevisionId == draft.Id);
            Assert.Equal("DN25", copiedMeasurement.Variant);
            Assert.Equal("Hat A", copiedMeasurement.SecondaryVariant);
            Assert.Equal(2, await verification.PlacementLinks.CountAsync());
            Assert.Equal(1, await verification.ResponsibilityDimensions.CountAsync(x => x.ProjectRevisionId == draft.Id));
            Assert.Equal(1, await verification.ResponsibilityAssignments.CountAsync(x => x.ProjectRevisionId == draft.Id));
            Assert.Equal(1, await verification.CalculationRuleVersions.CountAsync(x => x.ProjectRevisionId == draft.Id));
            Assert.Equal(0, await verification.CalculationResults.CountAsync(x => x.ProjectRevisionId == draft.Id));
            Assert.True(await verification.AuditEntries.AnyAsync(x => x.ProjectRevisionId == draft.Id && x.EventType == "revision-created-from-approved"));
            Guid copiedPipeId = await verification.ProjectPlacements
                .Where(x => x.ProjectRevisionId == draft.Id && x.CatalogCardVersionId == pipe.CardVersionId)
                .Select(x => x.Id)
                .SingleAsync();
            await measurements.CreateMeasurementAsync(new MeasurementDraft(draft.Id, copiedPipeId, 1m, "m"));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
