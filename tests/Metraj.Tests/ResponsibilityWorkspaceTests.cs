using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

public sealed class ResponsibilityWorkspaceTests
{
    [Fact]
    public async Task ProjectScopedDimensionsAndAssignmentsAreConfigurableAndUpserted()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-responsibility-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var responsibilities = new ResponsibilityWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-RESP", "Sorumluluk testi");
            CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
                "MAT-RESP", "Boru", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m"));
            PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));

            ResponsibilityDimensionListItem dimension = await responsibilities.CreateDimensionAsync(project.LatestRevisionId, "montaj", "Montaj");
            ResponsibilityPartyListItem party = await responsibilities.CreatePartyAsync(project.LatestRevisionId, "tas-01", "Test Taşeronu");
            await responsibilities.AssignPlacementAsync(
                project.LatestRevisionId, dimension.Id, placement.Id, party.Id,
                ResponsibilityAssignmentState.Assigned, "Saha montajı");

            ResponsibilityAssignmentListItem assignment = Assert.Single(await responsibilities.ListAssignmentsAsync(project.LatestRevisionId));
            Assert.Equal("Montaj", assignment.DimensionName);
            Assert.Equal("Test Taşeronu", assignment.PartyName);
            Assert.Equal(ResponsibilityAssignmentState.Assigned, assignment.State);

            await responsibilities.AssignPlacementAsync(
                project.LatestRevisionId, dimension.Id, placement.Id, party.Id,
                ResponsibilityAssignmentState.Excluded, "Kapsam dışı");
            ResponsibilityAssignmentListItem updated = Assert.Single(await responsibilities.ListAssignmentsAsync(project.LatestRevisionId));
            Assert.Null(updated.PartyId);
            Assert.Equal(ResponsibilityAssignmentState.Excluded, updated.State);
            await Assert.ThrowsAsync<DomainRuleViolationException>(() => responsibilities.AssignPlacementAsync(
                project.LatestRevisionId, dimension.Id, placement.Id, null, ResponsibilityAssignmentState.Assigned));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task NearestPlacementAssignmentIsInheritedAndCanBeExplicitlyOverridden()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-responsibility-inheritance-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var responsibilities = new ResponsibilityWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-RESP-INHERIT", "Sorumluluk kalıtımı");
            CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "SYS-RESP", "Temiz su", CardType.System, ItemKind.Service,
                InputBehavior.Manual, SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem materialCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "MAT-RESP-INHERIT", "Boru", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m"));
            PlacementListItem system = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId, system.Id));
            ResponsibilityDimensionListItem dimension = await responsibilities.CreateDimensionAsync(project.LatestRevisionId, "montaj", "Montaj");
            ResponsibilityPartyListItem party = await responsibilities.CreatePartyAsync(project.LatestRevisionId, "tas-01", "Test Taşeronu");

            await responsibilities.AssignPlacementAsync(
                project.LatestRevisionId, dimension.Id, system.Id, party.Id,
                ResponsibilityAssignmentState.Assigned, "Sistem seviyesi");

            ResponsibilityAssignmentListItem inherited = Assert.Single(
                await responsibilities.ListAssignmentsAsync(project.LatestRevisionId), x => x.PlacementId == pipe.Id);
            Assert.True(inherited.IsInherited);
            Assert.Equal("Temiz su", inherited.SourcePlacementName);
            Assert.Equal("Test Taşeronu", inherited.PartyName);
            Assert.Equal(ResponsibilityAssignmentState.Assigned, inherited.State);

            await responsibilities.AssignPlacementAsync(
                project.LatestRevisionId, dimension.Id, pipe.Id, null,
                ResponsibilityAssignmentState.Excluded, "Boru tedarik kapsamı dışında");
            ResponsibilityAssignmentListItem overridden = Assert.Single(
                await responsibilities.ListAssignmentsAsync(project.LatestRevisionId), x => x.PlacementId == pipe.Id);
            Assert.False(overridden.IsInherited);
            Assert.Equal("Boru", overridden.SourcePlacementName);
            Assert.Null(overridden.PartyName);
            Assert.Equal(ResponsibilityAssignmentState.Excluded, overridden.State);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
