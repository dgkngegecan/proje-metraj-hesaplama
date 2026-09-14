using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class PlacementContextNoteWorkspaceTests
{
    [Fact]
    public async Task MultipleNotesSurviveNavigationAndReopeningWithoutChangingExistingNotesOrMeasurements()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (project, placement, other) = await CreatePlacementsAsync(database);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        await tree.UpdatePlacementAsync(placement.Id, new PlacementUpdateDraft(null, null, "Genel kart notu"));
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        MeasurementListItem measurement = await measurements.CreateMeasurementAsync(new MeasurementDraft(
            project.LatestRevisionId, placement.Id, 12m, "m", Block: "Eski blok", Floor: "Eski kat",
            Room: "Eski mahal", Notes: "Ölçüm notu"));
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);

        PlacementContextNoteListItem first = await notes.AddNoteAsync(new(
            placement.Id, "  Bu katta farklı boru kullanılacak.  ", " A ", " 2 ", " Mutfak "));
        PlacementContextNoteListItem second = await notes.AddNoteAsync(new(
            placement.Id, "Aynı mahalde ilave vana planlandı.", "A", "2", "Mutfak"));
        PlacementContextNoteListItem third = await notes.AddNoteAsync(new(placement.Id, "Kontrol yapılacak.", " ", "", "\t"));
        Assert.Empty(await notes.ListNotesAsync(other.Id));
        IReadOnlyList<PlacementContextNoteListItem> beforeReopening = await notes.ListNotesAsync(placement.Id);
        Assert.Equal(3, beforeReopening.Count);
        Assert.Equal(3, beforeReopening.Select(x => x.Id).Distinct().Count());
        Assert.Equal("Bu katta farklı boru kullanılacak.", first.Text);
        Assert.Equal(("A", "2", "Mutfak"), (first.Block, first.Floor, first.Room));
        Assert.Null(third.Block);
        Assert.Null(third.Floor);
        Assert.Null(third.Room);
        Assert.All(beforeReopening, note =>
        {
            Assert.Equal(placement.Id, note.PlacementId);
            Assert.Equal(DateTimeKind.Utc, note.CreatedAtUtc.Kind);
            Assert.Null(note.UpdatedAtUtc);
        });
        Assert.True(first.CreatedAtUtc <= second.CreatedAtUtc && second.CreatedAtUtc <= third.CreatedAtUtc);

        TestDatabase.ClearPoolFor(database.Path);
        var reopened = new PlacementContextNoteWorkspaceService(() => MetrajDbContextFactory.Create(database.Path));
        Assert.Equal(beforeReopening, await reopened.ListNotesAsync(placement.Id));
        Assert.Equal(measurement, Assert.Single(await measurements.ListMeasurementsAsync(project.LatestRevisionId)));
        await using MetrajDbContext verification = database.ContextFactory();
        Assert.Equal("Genel kart notu", (await verification.ProjectPlacements.SingleAsync(x => x.Id == placement.Id)).Notes);
    }

    [Fact]
    public async Task DeletingOneOfSeveralNotesIsIndependentAndRejectsMissingIds()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (_, placement, other) = await CreatePlacementsAsync(database);
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        PlacementContextNoteListItem first = await notes.AddNoteAsync(new(placement.Id, "Aynı not", Floor: "1"));
        PlacementContextNoteListItem second = await notes.AddNoteAsync(new(placement.Id, "Aynı not", Floor: "1"));
        PlacementContextNoteListItem third = await notes.AddNoteAsync(new(placement.Id, "Üçüncü not"));
        PlacementContextNoteListItem unrelated = await notes.AddNoteAsync(new(other.Id, "Başka kartın notu"));

        await AssertRuleAsync("context-note.not-found", () => notes.DeleteNoteAsync(other.Id, second.Id));
        await AssertRuleAsync("context-note.not-found", () => notes.DeleteNoteAsync(Guid.NewGuid()));
        await notes.DeleteNoteAsync(second.Id);
        await AssertRuleAsync("context-note.not-found", () => notes.DeleteNoteAsync(second.Id));

        var reopened = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        Assert.Equal(new[] { first, third }, await reopened.ListNotesAsync(placement.Id));
        Assert.Equal(unrelated, Assert.Single(await reopened.ListNotesAsync(other.Id)));
    }

    [Fact]
    public async Task ApprovedNotesRemainReadableAndCannotBeAddedDeletedOrRemovedWithTheirPlacement()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (project, placement, _) = await CreatePlacementsAsync(database);
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        PlacementContextNoteListItem note = await notes.AddNoteAsync(new(placement.Id, "Onaylanmış not", Floor: "3"));
        await new ProjectWorkspaceService(database.ContextFactory).ApproveRevisionAsync(project.LatestRevisionId);

        await AssertRuleAsync("revision.read-only", () => notes.AddNoteAsync(new(placement.Id, "Yeni not")));
        await AssertRuleAsync("revision.read-only", () => notes.DeleteNoteAsync(note.Id));
        await AssertRuleAsync("revision.read-only", () => new ProjectTreeWorkspaceService(database.ContextFactory).DeletePlacementAsync(placement.Id));
        Assert.Equal(note, Assert.Single(await notes.ListNotesAsync(placement.Id)));
    }

    [Fact]
    public async Task DraftRevisionCopiesEveryNoteToItsMappedPlacementAndEditsDoNotChangeApprovedSource()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (project, placement, other) = await CreatePlacementsAsync(database);
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        await notes.AddNoteAsync(new(placement.Id, "Birinci not", "A", "1", "Salon"));
        await notes.AddNoteAsync(new(placement.Id, "İkinci not", "B", "2", "Mutfak"));
        await notes.AddNoteAsync(new(other.Id, "Diğer kartın notu"));
        await projects.ApproveRevisionAsync(project.LatestRevisionId);

        ProjectRevisionListItem draft = await projects.CreateDraftRevisionAsync(project.Id);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        IReadOnlyList<PlacementListItem> copiedPlacements = await tree.ListPlacementsAsync(draft.Id);
        foreach (PlacementListItem original in new[] { placement, other })
        {
            PlacementListItem copied = Assert.Single(copiedPlacements, x => x.DisplayName == original.DisplayName);
            IReadOnlyList<PlacementContextNoteListItem> sourceNotes = await notes.ListNotesAsync(original.Id);
            IReadOnlyList<PlacementContextNoteListItem> copiedNotes = await notes.ListNotesAsync(copied.Id);
            Assert.Equal(sourceNotes.Count, copiedNotes.Count);
            foreach (PlacementContextNoteListItem sourceNote in sourceNotes)
            {
                PlacementContextNoteListItem copy = Assert.Single(copiedNotes, x => x.Text == sourceNote.Text);
                Assert.NotEqual(sourceNote.Id, copy.Id);
                Assert.Equal(sourceNote with { Id = copy.Id, PlacementId = copied.Id }, copy);
            }

            await AssertRuleAsync("revision.read-only", () => notes.DeleteNoteAsync(sourceNotes[0].Id));
            await notes.DeleteNoteAsync(copiedNotes[0].Id);
            await notes.AddNoteAsync(new(copied.Id, "Yalnız yeni revizyonda"));
            Assert.Equal(sourceNotes, await notes.ListNotesAsync(original.Id));
            await tree.DeletePlacementAsync(copied.Id);
            Assert.Equal(sourceNotes, await notes.ListNotesAsync(original.Id));
        }
    }

    [Fact]
    public async Task DeletingPlacementSubtreeCascadesNotesAndPreservesOtherPlacementsNotes()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (project, placement, other) = await CreatePlacementsAsync(database);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        PlacementListItem child = await tree.AddPlacementAsync(new PlacementDraft(
            project.LatestRevisionId, placement.CardVersionId, placement.Id));
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        await notes.AddNoteAsync(new(placement.Id, "Üst kart"));
        await notes.AddNoteAsync(new(child.Id, "Alt kart bir"));
        await notes.AddNoteAsync(new(child.Id, "Alt kart iki"));
        PlacementContextNoteListItem survivor = await notes.AddNoteAsync(new(other.Id, "Kalacak"));

        await tree.DeletePlacementAsync(placement.Id);

        await using MetrajDbContext verification = database.ContextFactory();
        Assert.Equal(survivor.Id, (await verification.PlacementContextNotes.SingleAsync()).Id);
        Assert.Equal(other.Id, (await verification.ProjectPlacements.SingleAsync()).Id);
        Assert.Equal(survivor, Assert.Single(await notes.ListNotesAsync(other.Id)));
    }

    [Fact]
    public async Task ExistingDatabaseUpgradeIsAdditiveAndRepeatableAndPreservesLegacyContext()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (project, placement, _) = await CreatePlacementsAsync(database);
        await new ProjectTreeWorkspaceService(database.ContextFactory).UpdatePlacementAsync(
            placement.Id, new PlacementUpdateDraft(null, null, "Eski kart notu"));
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        MeasurementListItem measurement = await measurements.CreateMeasurementAsync(new(
            project.LatestRevisionId, placement.Id, 5m, "m", "Eski blok", "Eski kat", "Eski mahal", Notes: "Eski ölçüm notu"));
        await database.ExecuteAsync("""
            DROP TABLE "PlacementContextNotes";
            DELETE FROM "__AppSchemaVersions" WHERE "Version" = '20260912-placement-context-notes';
            """);
        Assert.False(await ApplicationSchemaMigrator.IsUpToDateAsync(database.Path));

        await database.MigrateAsync();
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        Assert.Empty(await notes.ListNotesAsync(placement.Id));
        PlacementContextNoteListItem added = await notes.AddNoteAsync(new(placement.Id, "Yükseltme sonrası"));
        await database.MigrateAsync();

        Assert.True(await ApplicationSchemaMigrator.IsUpToDateAsync(database.Path));
        Assert.Equal(added, Assert.Single(await notes.ListNotesAsync(placement.Id)));
        Assert.Equal(measurement, Assert.Single(await measurements.ListMeasurementsAsync(project.LatestRevisionId)));
        await using (MetrajDbContext verification = database.ContextFactory())
        {
            Assert.Equal("Eski kart notu", (await verification.ProjectPlacements.SingleAsync(x => x.Id == placement.Id)).Notes);
        }
        Assert.Equal(1L, await database.ScalarAsync<long>("""
            SELECT COUNT(*) FROM pragma_index_list('PlacementContextNotes')
            WHERE name = 'IX_PlacementContextNotes_PlacementId_CreatedAtUtc_Id' AND "unique" = 0;
            """));
        Assert.Equal(1L, await database.ScalarAsync<long>("""
            SELECT COUNT(*) FROM pragma_foreign_key_list('PlacementContextNotes')
            WHERE "table" = 'ProjectPlacements' AND "from" = 'PlacementId' AND on_delete = 'CASCADE';
            """));
        await new ProjectTreeWorkspaceService(database.ContextFactory).DeletePlacementAsync(placement.Id);
        await using MetrajDbContext afterDelete = database.ContextFactory();
        Assert.Empty(await afterDelete.PlacementContextNotes.ToListAsync());
    }

    [Fact]
    public async Task DatabaseBackupAndRestoreIncludeEveryContextNote()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (_, placement, other) = await CreatePlacementsAsync(database);
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        PlacementContextNoteListItem first = await notes.AddNoteAsync(new(placement.Id, "Yedek bir", "A", "1", "Salon"));
        await notes.AddNoteAsync(new(placement.Id, "Yedek iki"));
        PlacementContextNoteListItem unrelated = await notes.AddNoteAsync(new(other.Id, "Başka kart"));
        IReadOnlyList<PlacementContextNoteListItem> expected = await notes.ListNotesAsync(placement.Id);
        string backupDirectory = Path.Combine(Path.GetTempPath(), $"metraj-context-note-backups-{Guid.NewGuid():N}");
        try
        {
            var maintenance = new DatabaseMaintenanceWorkspaceService(() => database.Path, backupDirectory);
            DatabaseBackupListItem backup = await maintenance.CreateBackupAsync();
            var backupNotes = new PlacementContextNoteWorkspaceService(() => MetrajDbContextFactory.Create(backup.FullPath));
            Assert.Equal(expected, await backupNotes.ListNotesAsync(placement.Id));
            await notes.DeleteNoteAsync(first.Id);
            await notes.AddNoteAsync(new(placement.Id, "Yedekten sonra"));

            await maintenance.RestoreBackupAsync(backup.FullPath);

            var restored = new PlacementContextNoteWorkspaceService(database.ContextFactory);
            Assert.Equal(expected, await restored.ListNotesAsync(placement.Id));
            Assert.Equal(unrelated, Assert.Single(await restored.ListNotesAsync(other.Id)));
        }
        finally
        {
            TestDatabase.DeleteDirectoryWithDatabases(backupDirectory);
        }
    }

    [Theory]
    [InlineData("text", 0)]
    [InlineData("text", 4001)]
    [InlineData("block", 129)]
    [InlineData("floor", 129)]
    [InlineData("room", 257)]
    public async Task InvalidNoteFieldsAreRejectedWithoutChangingExistingNotes(string field, int length)
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (_, placement, _) = await CreatePlacementsAsync(database);
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        PlacementContextNoteListItem existing = await notes.AddNoteAsync(new(placement.Id, "Önceden kayıtlı"));
        string invalid = length == 0 ? " \t\r\n " : new string('x', length);
        PlacementContextNoteDraft draft = new(placement.Id,
            field == "text" ? invalid : "Not", field == "block" ? invalid : null,
            field == "floor" ? invalid : null, field == "room" ? invalid : null);

        await AssertRuleAsync($"context-note.{field}", () => notes.AddNoteAsync(draft));
        Assert.Equal(existing, Assert.Single(await notes.ListNotesAsync(placement.Id)));
    }

    [Fact]
    public async Task MissingTextAndPlacementAreRejectedAndMaximumFieldLengthsAreAccepted()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (_, placement, _) = await CreatePlacementsAsync(database);
        var notes = new PlacementContextNoteWorkspaceService(database.ContextFactory);
        await AssertRuleAsync("context-note.text", () => notes.AddNoteAsync(new(placement.Id, null!)));
        await AssertRuleAsync("placement.not-found", () => notes.AddNoteAsync(new(Guid.NewGuid(), "Not")));
        await AssertRuleAsync("placement.not-found", () => notes.ListNotesAsync(Guid.NewGuid()));
        PlacementContextNoteListItem saved = await notes.AddNoteAsync(new(
            placement.Id, new string('x', 4000), new string('b', 128), new string('f', 128), new string('r', 256)));
        Assert.Equal(saved, Assert.Single(await notes.ListNotesAsync(placement.Id)));
    }

    private static async Task AssertRuleAsync(string rule, Func<Task> action)
    {
        DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(action);
        Assert.Equal(rule, error.Rule);
    }

    private static async Task<(ProjectListItem Project, PlacementListItem Placement, PlacementListItem Other)> CreatePlacementsAsync(TestDatabase database)
    {
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("P-NOTES", "Kat ve mahal notları");
        CatalogCardListItem card = await new CatalogWorkspaceService(database.ContextFactory).CreateCardAsync(new CatalogCardDraft(
            "MAT-NOTES", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(
            project.LatestRevisionId, card.LatestVersionId, DisplayNameOverride: "Birinci boru"));
        PlacementListItem other = await tree.AddPlacementAsync(new PlacementDraft(
            project.LatestRevisionId, card.LatestVersionId, DisplayNameOverride: "İkinci boru"));
        return (project, placement, other);
    }
}
