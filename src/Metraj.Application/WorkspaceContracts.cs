using Metraj.Domain;

namespace Metraj.Application;

public sealed record ProjectListItem(Guid Id, string Code, string Name, int RevisionCount, Guid LatestRevisionId, DateTime CreatedAtUtc);

/// <summary>Selectable immutable project revision snapshot.</summary>
public sealed record ProjectRevisionListItem(
    Guid Id,
    Guid ProjectId,
    int RevisionNumber,
    string Code,
    ProjectRevisionStatus Status,
    DateTime CreatedAtUtc,
    DateTime? ApprovedAtUtc);

public interface IProjectWorkspace
{
    public Task<IReadOnlyList<ProjectListItem>> ListProjectsAsync(CancellationToken cancellationToken = default);
    public Task<ProjectListItem> CreateProjectAsync(string code, string name, string? description = null, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<ProjectRevisionListItem>> ListRevisionsAsync(Guid projectId, CancellationToken cancellationToken = default);
    public Task<ProjectRevisionListItem> CreateDraftRevisionAsync(Guid projectId, CancellationToken cancellationToken = default);
    public Task ApproveRevisionAsync(Guid revisionId, CancellationToken cancellationToken = default);
}

public sealed record PlacementListItem(
    Guid Id,
    Guid RevisionId,
    Guid? ParentPlacementId,
    Guid CardVersionId,
    string CardCode,
    string CardName,
    string Unit,
    InputBehavior InputBehavior,
    CardType CardType,
    string? PositionNumber,
    bool IsMeasurable,
    string DisplayName,
    string? DisplayNameOverride,
    string? ProcurementScope,
    string? Notes,
    CatalogVariantMode VariantMode = CatalogVariantMode.None,
    IReadOnlyList<CatalogCardVariant>? Variants = null,
    // MaterialType: kartın malzeme ailesi. Arayüz, giriş panelini seçerken
    // kullanıcının serbestçe değiştirebildiği görünen ad yerine bu açık
    // özelliği kullanır.
    string? MaterialType = null);

public sealed record PlacementDraft(Guid RevisionId, Guid CardVersionId, Guid? ParentPlacementId = null, string? DisplayNameOverride = null, string? ProcurementScope = null);

public sealed record PlacementUpdateDraft(string? DisplayNameOverride, string? ProcurementScope, string? Notes);

public interface IProjectTreeWorkspace
{
    public Task<IReadOnlyList<PlacementListItem>> ListPlacementsAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<PlacementListItem> AddPlacementAsync(PlacementDraft draft, CancellationToken cancellationToken = default);
    public Task UpdatePlacementAsync(Guid placementId, PlacementUpdateDraft draft, CancellationToken cancellationToken = default);
    public Task MovePlacementAsync(Guid placementId, Guid? parentPlacementId, CancellationToken cancellationToken = default);
    public Task AddLinkAsync(Guid sourcePlacementId, Guid targetPlacementId, SemanticLinkType linkType, string? notes = null, CancellationToken cancellationToken = default);
    public Task DeletePlacementAsync(Guid placementId, CancellationToken cancellationToken = default);
}

/// <summary>A repeatable pipe diameter or fitting option stored with a catalog card version.</summary>
public sealed record CatalogCardVariant(
    string Code,
    string Label,
    decimal? StandardLength = null,
    IReadOnlyList<string>? CompatibleDiameters = null);

public sealed record CatalogCardVariantDraft(
    string Code,
    string Label,
    decimal? StandardLength = null,
    IReadOnlyList<string>? CompatibleDiameters = null);

public sealed record CatalogCardListItem(
    Guid Id,
    Guid LatestVersionId,
    string Code,
    string Name,
    CardType CardType,
    string Unit,
    InputBehavior InputBehavior,
    SalesConversion SalesConversion,
    ReportBehavior ReportBehavior,
    decimal WasteRatePct,
    decimal? ContainerParameter,
    string? PositionNumber,
    int LatestVersion,
    bool IsActive,
    string? Notes = null,
    string? MaterialType = null,
    IReadOnlyList<string>? CompatibleDiameters = null,
    Guid? CustomTypeId = null,
    string? CustomTypeCode = null,
    string? CustomTypeName = null,
    IReadOnlyList<string>? AttributeKeys = null,
    IReadOnlyDictionary<string, string>? AttributeValues = null,
    CatalogVariantMode VariantMode = CatalogVariantMode.None,
    IReadOnlyList<CatalogCardVariant>? Variants = null);

public sealed record CatalogCardDraft(
    string Code,
    string Name,
    CardType CardType,
    ItemKind ItemKind,
    InputBehavior InputBehavior,
    SalesConversion SalesConversion,
    ReportBehavior ReportBehavior,
    string Unit,
    decimal WasteRatePct = 0m,
    decimal? ContainerParameter = null,
    string? PositionNumber = null,
    string? Notes = null,
    string? MaterialType = null,
    IReadOnlyList<string>? CompatibleDiameters = null,
    Guid? CustomTypeId = null,
    IReadOnlyDictionary<string, string>? AttributeValues = null,
    CatalogVariantMode VariantMode = CatalogVariantMode.None,
    IReadOnlyList<CatalogCardVariantDraft>? Variants = null);

public interface ICatalogWorkspace
{
    public Task<IReadOnlyList<CatalogCardListItem>> ListCardsAsync(CancellationToken cancellationToken = default);
    public Task<CatalogCardListItem> CreateCardAsync(CatalogCardDraft draft, CancellationToken cancellationToken = default);
    public Task<CatalogCardListItem> CreateVersionAsync(Guid definitionId, CatalogCardDraft draft, CancellationToken cancellationToken = default);
    public Task DeactivateCardAsync(Guid definitionId, CancellationToken cancellationToken = default);
    public Task DeleteCardAsync(Guid definitionId, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<CatalogCardListItem>> ListCompatibleFittingsAsync(Guid pipePlacementId, CancellationToken cancellationToken = default);
}

public sealed record MaterialTypeWasteSettingItem(Guid Id, string MaterialType, decimal WasteRatePct, DateTime UpdatedAtUtc);

public interface IMaterialTypeWasteWorkspace
{
    public Task<IReadOnlyList<MaterialTypeWasteSettingItem>> ListAsync(CancellationToken cancellationToken = default);
    public Task<MaterialTypeWasteSettingItem> UpsertAsync(string materialType, decimal wasteRatePct, CancellationToken cancellationToken = default);
    public Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
