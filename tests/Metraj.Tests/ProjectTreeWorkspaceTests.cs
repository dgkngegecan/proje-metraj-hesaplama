using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

public sealed class ProjectTreeWorkspaceTests
{
    [Fact]
    public async Task PlacementAndLinkFlowPreservesSingleParentTree()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase2-tree-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var project = await projects.CreateProjectAsync("P-TREE", "Ağaç testi");
            var systemCard = await cards.CreateCardAsync(new CatalogCardDraft("SYS-CW", "Temiz Su", CardType.System, ItemKind.Service, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Folder, "-"));
            var materialCard = await cards.CreateCardAsync(new CatalogCardDraft("MAT-CW", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m"));

            var root = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
            var child = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, materialCard.LatestVersionId, root.Id));
            await tree.AddLinkAsync(child.Id, root.Id, SemanticLinkType.Reference);
            var placements = await tree.ListPlacementsAsync(project.LatestRevisionId);

            Assert.Equal(2, placements.Count);
            Assert.Equal(root.Id, placements.Single(x => x.Id == child.Id).ParentPlacementId);
            Assert.False(placements.Single(x => x.Id == root.Id).IsMeasurable);
            Assert.True(placements.Single(x => x.Id == child.Id).IsMeasurable);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task PlacementsKeepTheirCardVersionAndSupportSafeProjectSpecificChanges()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase3-tree-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-PH3", "Faz 3 testi");
            CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
                "MAT-PH3", "Test borusu", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m"));

            PlacementListItem firstRoot = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
            PlacementListItem secondRoot = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
            PlacementListItem child = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId, firstRoot.Id));
            CatalogCardListItem v2 = await cards.CreateVersionAsync(card.Id, new CatalogCardDraft(
                "ignored", "Test borusu güncel", CardType.Material, ItemKind.Material,
                InputBehavior.Manual, SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 10m, 6m));

            Assert.NotEqual(firstRoot.Id, secondRoot.Id);
            PlacementListItem preservedPlacement = (await tree.ListPlacementsAsync(project.LatestRevisionId)).Single(x => x.Id == firstRoot.Id);
            Assert.Equal(card.LatestVersionId, preservedPlacement.CardVersionId);
            Assert.Equal("Test borusu", preservedPlacement.CardName);
            Assert.NotEqual(card.LatestVersionId, v2.LatestVersionId);
            Assert.Equal("Test borusu güncel", v2.Name);

            await tree.UpdatePlacementAsync(firstRoot.Id, new PlacementUpdateDraft("Ana kolon", "Montaj", "Test notu"));
            PlacementListItem updated = (await tree.ListPlacementsAsync(project.LatestRevisionId)).Single(x => x.Id == firstRoot.Id);
            Assert.Equal("Ana kolon", updated.DisplayName);
            Assert.Equal("Ana kolon", updated.DisplayNameOverride);
            Assert.Equal("Montaj", updated.ProcurementScope);
            Assert.Equal("Test notu", updated.Notes);

            await Assert.ThrowsAsync<DomainRuleViolationException>(() => tree.MovePlacementAsync(firstRoot.Id, child.Id));
            await tree.MovePlacementAsync(child.Id, null);
            Assert.Null((await tree.ListPlacementsAsync(project.LatestRevisionId)).Single(x => x.Id == child.Id).ParentPlacementId);

            await cards.DeactivateCardAsync(card.Id);
            await Assert.ThrowsAsync<DomainRuleViolationException>(() =>
                tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, v2.LatestVersionId)));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
