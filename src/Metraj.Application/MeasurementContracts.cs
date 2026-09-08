namespace Metraj.Application;

/// <summary>A user-entered source measurement with its placement and context.</summary>
public sealed record MeasurementListItem(
    Guid Id,
    Guid RevisionId,
    Guid PlacementId,
    string PlacementCode,
    string PlacementName,
    string SourceKind,
    decimal InputQuantity,
    string InputUnit,
    string? Block,
    string? Floor,
    string? Room,
    string? Zone,
    string? Sheet,
    string? DrawingRevision,
    string? Notes,
    DateTime CreatedAtUtc,
    DateTime? UpdatedAtUtc,
    string? Variant = null,
    string? SecondaryVariant = null);

/// <summary>Editable data required to create or update a source measurement.</summary>
public sealed record MeasurementDraft(
    Guid RevisionId,
    Guid PlacementId,
    decimal InputQuantity,
    string InputUnit,
    string? Block = null,
    string? Floor = null,
    string? Room = null,
    string? Zone = null,
    string? Sheet = null,
    string? DrawingRevision = null,
    string? Notes = null,
    string SourceKind = "USER",
    string? Variant = null,
    string? SecondaryVariant = null);

/// <summary>Authoritative placement-level quantity result calculated from source measurements.</summary>
public sealed record MeasurementSummaryItem(
    Guid PlacementId,
    string PlacementCode,
    string PlacementName,
    string Unit,
    int MeasurementCount,
    decimal NetQuantity,
    decimal WithWasteQuantity,
    decimal PurchaseQuantity,
    decimal RemainderQuantity,
    string? Variant = null,
    string? SecondaryVariant = null,
    decimal AppliedWasteRatePct = 0m,
    string? PurchaseUnit = null);

/// <summary>Application boundary for fast measurement entry and deterministic per-placement summaries.</summary>
public interface IMeasurementWorkspace
{
    public Task<IReadOnlyList<MeasurementListItem>> ListMeasurementsAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<MeasurementSummaryItem>> ListSummariesAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<MeasurementListItem> CreateMeasurementAsync(MeasurementDraft draft, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<MeasurementListItem>> CreateMeasurementsAsync(IReadOnlyList<MeasurementDraft> drafts, CancellationToken cancellationToken = default);
    public Task UpdateMeasurementAsync(Guid measurementId, MeasurementDraft draft, CancellationToken cancellationToken = default);
    public Task<MeasurementListItem> DuplicateMeasurementAsync(Guid measurementId, CancellationToken cancellationToken = default);
    public Task DeleteMeasurementAsync(Guid measurementId, CancellationToken cancellationToken = default);
}
