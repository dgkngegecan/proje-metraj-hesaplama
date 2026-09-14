namespace Metraj.Application;

/// <summary>A persistent placement exception note, independent of measurements and the placement's general note.</summary>
public sealed record PlacementContextNoteListItem(
    Guid Id,
    Guid PlacementId,
    string? Block,
    string? Floor,
    string? Room,
    string Text,
    DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc);

/// <summary>Text is required (up to 4,000 characters); block/floor allow 128 and room 256 characters.</summary>
public sealed record PlacementContextNoteDraft(
    Guid PlacementId,
    string Text,
    string? Block = null,
    string? Floor = null,
    string? Room = null);

/// <summary>Lists notes on any revision and adds/deletes individual notes only on draft revisions.</summary>
public interface IPlacementContextNoteWorkspace
{
    /// <summary>Returns notes in creation order, with identity as the tie breaker.</summary>
    public Task<IReadOnlyList<PlacementContextNoteListItem>> ListNotesAsync(Guid placementId, CancellationToken cancellationToken = default);
    public Task<PlacementContextNoteListItem> AddNoteAsync(PlacementContextNoteDraft draft, CancellationToken cancellationToken = default);
    /// <summary>Deletes only the identified note after checking its owning placement's revision.</summary>
    public Task DeleteNoteAsync(Guid noteId, CancellationToken cancellationToken = default);
    /// <summary>Deletes the note only when it belongs to the supplied placement.</summary>
    public Task DeleteNoteAsync(Guid placementId, Guid noteId, CancellationToken cancellationToken = default);
}
