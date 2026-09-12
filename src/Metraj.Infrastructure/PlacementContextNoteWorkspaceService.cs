using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Persists independent context notes without changing placement notes or measurement quantities/context.</summary>
public sealed class PlacementContextNoteWorkspaceService(Func<MetrajDbContext> contextFactory) : IPlacementContextNoteWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory =
        contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));

    /// <inheritdoc />
    public async Task<IReadOnlyList<PlacementContextNoteListItem>> ListNotesAsync(Guid placementId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        if (!await context.ProjectPlacements.AnyAsync(x => x.Id == placementId, cancellationToken))
        {
            throw new DomainRuleViolationException("placement.not-found", "Project placement was not found.");
        }

        List<PlacementContextNote> notes = await context.PlacementContextNotes.AsNoTracking()
            .Where(x => x.PlacementId == placementId)
            .OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return notes.Select(ToListItem).ToList();
    }

    /// <inheritdoc />
    public async Task<PlacementContextNoteListItem> AddNoteAsync(PlacementContextNoteDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        await using MetrajDbContext context = contextFactory();
        // Keep the draft check and write in the same SQLite transaction so approval cannot interleave.
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        await EnsureDraftPlacementAsync(context, draft.PlacementId, cancellationToken);
        var note = new PlacementContextNote
        {
            Id = Guid.NewGuid(),
            PlacementId = draft.PlacementId,
            Text = TextRules.Required(draft.Text, 4_000, "context-note.text", "Note text must contain 1 to 4,000 characters."),
            Block = TextRules.Optional(draft.Block, 128, "context-note.block", "Block must contain at most 128 characters."),
            Floor = TextRules.Optional(draft.Floor, 128, "context-note.floor", "Floor must contain at most 128 characters."),
            Room = TextRules.Optional(draft.Room, 256, "context-note.room", "Room must contain at most 256 characters.")
        };
        context.PlacementContextNotes.Add(note);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToListItem(note);
    }

    /// <inheritdoc />
    public async Task DeleteNoteAsync(Guid placementId, Guid noteId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        await EnsureDraftPlacementAsync(context, placementId, cancellationToken);
        PlacementContextNote note = await context.PlacementContextNotes
            .SingleOrDefaultAsync(x => x.Id == noteId && x.PlacementId == placementId, cancellationToken)
            ?? throw new DomainRuleViolationException("context-note.not-found", "Context note was not found on this placement.");
        context.PlacementContextNotes.Remove(note);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task EnsureDraftPlacementAsync(MetrajDbContext context, Guid placementId, CancellationToken cancellationToken)
    {
        ProjectPlacement placement = await context.ProjectPlacements.AsNoTracking()
            .Include(x => x.ProjectRevision)
            .SingleOrDefaultAsync(x => x.Id == placementId, cancellationToken)
            ?? throw new DomainRuleViolationException("placement.not-found", "Project placement was not found.");
        ProjectRevision revision = placement.ProjectRevision
            ?? throw new DomainRuleViolationException("placement.revision", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);
    }

    private static PlacementContextNoteListItem ToListItem(PlacementContextNote note) => new(
        note.Id, note.PlacementId, note.Block, note.Floor, note.Room, note.Text,
        // SQLite stores DateTime values without their Kind; the wire contract always represents UTC.
        DateTime.SpecifyKind(note.CreatedAtUtc, DateTimeKind.Utc),
        note.UpdatedAtUtc is DateTime updated ? DateTime.SpecifyKind(updated, DateTimeKind.Utc) : null);
}
