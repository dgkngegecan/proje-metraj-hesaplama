namespace Metraj.Domain;

public enum CardType
{
    Category,
    Scope,
    System,
    Material,
    Accessory
}

public enum ItemKind
{
    Material,
    Equipment,
    Labor,
    Service,
    Other
}

public enum InputBehavior
{
    Manual,
    Boolean,
    Derived
}

public enum SalesConversion
{
    None,
    StandardLength,
    Package
}

public enum ReportBehavior
{
    Folder,
    Measurable,

    // ERTELENMİŞ KAPSAM -- bu iki değer hiçbir yerde ÜRETİLMİYOR.
    // Faz 0 sözleşmesinde tanımlılar; arayüz yalnızca Folder/Measurable
    // sunuyor. Silinmediler çünkü enum'lar veritabanına METİN olarak
    // yazılıyor: elle düzenlenmiş ya da ileride yazılmış bir satır,
    // değer kaldırılırsa okunamaz hâle gelir. Kod temizliği, veri
    // okunabilirliğinden önce gelmez.
    Auxiliary,
    Reference
}

/// <summary>How a catalog card exposes repeatable size or fitting choices in the project map.</summary>
public enum CatalogVariantMode
{
    None,
    Pipe,
    Fitting
}

public enum ProjectRevisionStatus
{
    Draft,
    Approved,

    // ERTELENMİŞ KAPSAM -- arşivleme akışı gerçekleşmedi, bu değer hiçbir
    // yerde üretilmiyor. Bkz. ReportBehavior'daki not.
    Archived
}

public enum SemanticLinkType
{
    // ERTELENMİŞ KAPSAM -- ComponentOf hiçbir yerde üretilmiyor.
    ComponentOf,
    CalculatedFrom,
    Reference
}

public enum ResponsibilityAssignmentState
{
    Assigned,
    Excluded,
    Optional,
    Unassigned
}

public enum CalculationResultStatus
{
    PendingReview,
    Approved,
    Overridden,
    Rejected,
    Stale,
    Superseded
}

public enum SourceQuantityKind
{
    Net,
    WithWaste
}

public sealed class CatalogCardDefinition
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public ICollection<CatalogCardVersion> Versions { get; } = new List<CatalogCardVersion>();
}

/// <summary>
/// Global, user-defined card type template. The base card type keeps the existing
/// calculation/reporting rules compatible while the JSON lists add project-tree
/// constraints without inventing a second hierarchy model.
/// </summary>
public sealed class CatalogCardTypeDefinition
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public CardType BaseCardType { get; set; }
    /// <summary>Catalog card definition ids that may be direct parents. Empty means no extra restriction.</summary>
    public string AllowedParentCardIdsJson { get; set; } = "[]";
    /// <summary>Catalog card definition ids that may be direct children. Empty means no extra restriction.</summary>
    public string AllowedChildCardIdsJson { get; set; } = "[]";
    /// <summary>Keys from the application card-attribute catalogue enabled by this type.</summary>
    public string AttributeKeysJson { get; set; } = "[]";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public ICollection<CatalogCardVersion> CardVersions { get; } = new List<CatalogCardVersion>();
}

public sealed class CatalogCardVersion
{
    public Guid Id { get; set; }
    public Guid CatalogCardDefinitionId { get; set; }
    public Guid? CatalogCardTypeDefinitionId { get; set; }
    public int VersionNumber { get; set; }
    public string Name { get; set; } = string.Empty;
    public CardType CardType { get; set; }
    public ItemKind ItemKind { get; set; }
    public InputBehavior InputBehavior { get; set; }
    public SalesConversion SalesConversion { get; set; }
    public ReportBehavior ReportBehavior { get; set; }
    public string Unit { get; set; } = string.Empty;
    public decimal WasteRatePct { get; set; }
    public decimal? ContainerParameter { get; set; }
    public string? PositionNumber { get; set; }
    public string? ColorCode { get; set; }
    public string? PatternCode { get; set; }
    /// <summary>Optional card-level variant editor mode. The five stable card types remain unchanged.</summary>
    public CatalogVariantMode VariantMode { get; set; } = CatalogVariantMode.None;
    /// <summary>JSON list of pipe diameters/lengths or fitting options/compatibilities.</summary>
    public string VariantDefinitionsJson { get; set; } = "[]";
    /// <summary>Optional material family used to apply a centrally configured waste percentage.</summary>
    public string? MaterialType { get; set; }
    /// <summary>JSON string array of nominal sizes this fitting/accessory can connect to.</summary>
    public string CompatibleDiametersJson { get; set; } = "[]";
    /// <summary>Values captured for the optional attributes enabled by the card type template.</summary>
    public string AttributeValuesJson { get; set; } = "{}";
    public string ContentHash { get; set; } = string.Empty;
    /// <summary>
    /// ERTELENMİŞ KAPSAM: taslak/yayınlanmış sürüm ayrımı gerçekleşmedi.
    /// </summary>
    /// <remarks>
    /// Her yerde <c>true</c> atanıyor, hiçbir sorguda süzgeç olarak
    /// kullanılmıyor. Sürüm yayınlama akışı eklenirse anlam kazanır.
    /// </remarks>
    public bool IsPublished { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public CatalogCardDefinition? CatalogCardDefinition { get; set; }
    public CatalogCardTypeDefinition? CatalogCardTypeDefinition { get; set; }
}

public sealed class Project
{
    public Guid Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public ICollection<ProjectRevision> Revisions { get; } = new List<ProjectRevision>();
}

public sealed class ProjectRevision
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public int RevisionNumber { get; set; }
    public string Code { get; set; } = string.Empty;
    public ProjectRevisionStatus Status { get; set; } = ProjectRevisionStatus.Draft;
    public string EngineVersion { get; set; } = "SYN-CALC-ENGINE-CONTRACT-v1";
    public string UnitPolicyVersion { get; set; } = "SYN-UNIT-POLICY-v1";
    /// <summary>
    /// Onay anında dondurulan, projeye dışarıdan etki eden politika. Kart sürümleri
    /// ve varyant boyları zaten değişmez olduğu için burada yalnızca merkezi
    /// malzeme fire oranları saklanır. Taslak revizyonlarda null'dır: düzenlenebilir
    /// bir revizyon güncel ayarları izler.
    /// </summary>
    public string? EffectivePolicyJson { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAtUtc { get; set; }
    public Project? Project { get; set; }
    public ICollection<ProjectPlacement> Placements { get; } = new List<ProjectPlacement>();
    public ICollection<Measurement> Measurements { get; } = new List<Measurement>();
    public ICollection<ResponsibilityDimension> ResponsibilityDimensions { get; } = new List<ResponsibilityDimension>();
    public ICollection<ResponsibilityParty> ResponsibilityParties { get; } = new List<ResponsibilityParty>();
    public ICollection<CalculationRuleVersion> CalculationRules { get; } = new List<CalculationRuleVersion>();
    public ICollection<CalculationResult> CalculationResults { get; } = new List<CalculationResult>();
}

public sealed class ProjectPlacement
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public Guid CatalogCardVersionId { get; set; }
    public Guid? ParentPlacementId { get; set; }
    public string? DisplayNameOverride { get; set; }
    public string? Notes { get; set; }
    public string? ProcurementScope { get; set; }
    /// <summary>
    /// ERTELENMİŞ KAPSAM: tedarik havuzlaması gerçekleşmedi.
    /// </summary>
    /// <remarks>
    /// Bu alan YAZILIYOR ama hiçbir yerde OKUNMUYOR. Faz 0 sözleşmesindeki
    /// havuzlama kapsamı uygulanmadığı için bugün hiçbir hesabı etkilemiyor.
    /// Kaldırılmadı çünkü kullanıcı verisinde zaten saklı; açık bir boşluk
    /// notu, sessizce kaybolmasından iyidir.
    /// </remarks>
    public bool NoPool { get; set; }
    public ProjectRevision? ProjectRevision { get; set; }
    public CatalogCardVersion? CatalogCardVersion { get; set; }
    public ProjectPlacement? ParentPlacement { get; set; }
    public ICollection<ProjectPlacement> Children { get; } = new List<ProjectPlacement>();
    public ICollection<Measurement> Measurements { get; } = new List<Measurement>();
    public ICollection<PlacementLink> SourceLinks { get; } = new List<PlacementLink>();
    public ICollection<PlacementLink> TargetLinks { get; } = new List<PlacementLink>();
}

public sealed class PlacementLink
{
    public Guid Id { get; set; }
    public Guid SourcePlacementId { get; set; }
    public Guid TargetPlacementId { get; set; }
    public SemanticLinkType LinkType { get; set; }
    public string? Notes { get; set; }
    public ProjectPlacement? SourcePlacement { get; set; }
    public ProjectPlacement? TargetPlacement { get; set; }
}

public sealed class Measurement
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public Guid ProjectPlacementId { get; set; }
    public string SourceKind { get; set; } = "USER";
    public string? SourceRowId { get; set; }
    public decimal InputQuantity { get; set; }
    public string InputUnit { get; set; } = string.Empty;
    public string? Block { get; set; }
    public string? Floor { get; set; }
    public string? Room { get; set; }
    public string? Zone { get; set; }
    public string? Sheet { get; set; }
    public string? DrawingRevision { get; set; }
    public string? Notes { get; set; }
    /// <summary>Primary size label, such as DN25, 1 inch or radiator width.</summary>
    public string? Variant { get; set; }
    /// <summary>Secondary size label, such as radiator height.</summary>
    public string? SecondaryVariant { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAtUtc { get; set; }
    public ProjectRevision? ProjectRevision { get; set; }
    public ProjectPlacement? ProjectPlacement { get; set; }
}

/// <summary>Global, user-editable waste policy for a named material family.</summary>
public sealed class MaterialTypeWasteSetting
{
    public Guid Id { get; set; }
    public string MaterialType { get; set; } = string.Empty;
    public decimal WasteRatePct { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class ResponsibilityDimension
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public ProjectRevision? ProjectRevision { get; set; }
    public ICollection<ResponsibilityAssignment> Assignments { get; } = new List<ResponsibilityAssignment>();
}

public sealed class ResponsibilityParty
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public ProjectRevision? ProjectRevision { get; set; }
}

public sealed class ResponsibilityAssignment
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public Guid ResponsibilityDimensionId { get; set; }
    public Guid? ProjectPlacementId { get; set; }
    public Guid? MeasurementId { get; set; }
    public Guid? ResponsibilityPartyId { get; set; }
    public ResponsibilityAssignmentState State { get; set; } = ResponsibilityAssignmentState.Unassigned;
    public string? Notes { get; set; }
    public ResponsibilityDimension? ResponsibilityDimension { get; set; }
    public ResponsibilityParty? ResponsibilityParty { get; set; }
}

public sealed class CalculationRuleVersion
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int VersionNumber { get; set; }
    public SourceQuantityKind SourceQuantityKind { get; set; } = SourceQuantityKind.Net;
    public string ParametersJson { get; set; } = "{}";
    public string ContentHash { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public ProjectRevision? ProjectRevision { get; set; }
}

public sealed class CalculationResult
{
    public Guid Id { get; set; }
    public Guid ProjectRevisionId { get; set; }
    public Guid TargetPlacementId { get; set; }
    public Guid CalculationRuleVersionId { get; set; }
    public Guid CardVersionId { get; set; }
    public string SourceMeasurementIdsJson { get; set; } = "[]";
    public string InputSummary { get; set; } = string.Empty;
    public string InputHash { get; set; } = string.Empty;
    public string EngineVersion { get; set; } = string.Empty;
    public string UnitPolicyVersion { get; set; } = string.Empty;
    public decimal ProposedQuantity { get; set; }
    public decimal NetQuantity { get; set; }
    public decimal WithWasteQuantity { get; set; }
    public decimal PurchaseQuantity { get; set; }
    public decimal RemainderQuantity { get; set; }
    public decimal? UsedQuantity { get; set; }
    public CalculationResultStatus Status { get; set; } = CalculationResultStatus.PendingReview;
    public string? OverrideReason { get; set; }
    public Guid? SupersedesResultId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public ProjectRevision? ProjectRevision { get; set; }
    public ProjectPlacement? TargetPlacement { get; set; }
    public CalculationRuleVersion? CalculationRuleVersion { get; set; }
    public CatalogCardVersion? CardVersion { get; set; }
}

/// <summary>
/// Arayüzün kalıcı olması gereken küçük durumu (yarım kalmış fitting sayımları,
/// açık çap kutuları, kenar çubuğu tercihi).
/// </summary>
/// <remarks>
/// Bu veri localStorage'da tutulamaz: yerel API her açılışta işletim sisteminin
/// seçtiği bir loopback portu dinler, port değişince WebView için origin değişir
/// ve localStorage boş gelir. Arayüz kullanıcıya "Bekleyen adetler bu kart,
/// diğer kartlar ve ekranlar arasında saklanır" dediği için bu söz tutulmalı.
/// </remarks>
public sealed class UiState
{
    public string Key { get; set; } = string.Empty;
    public string ValueJson { get; set; } = "{}";
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class AuditEntry
{
    public Guid Id { get; set; }
    public Guid? ProjectRevisionId { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string DetailsJson { get; set; } = "{}";
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
}
