using Metraj.Domain;

namespace Metraj.Application;

/// <summary>Immutable data snapshot shared by every report format.</summary>
public sealed record ProjectReportData(
    Guid RevisionId,
    string ProjectCode,
    string ProjectName,
    string RevisionCode,
    DateTime GeneratedAtUtc,
    IReadOnlyList<MeasurementListItem> SourceMeasurements,
    IReadOnlyList<MeasurementSummaryItem> Summaries,
    IReadOnlyList<ReportClassificationSummaryItem> ClassificationSummaries,
    IReadOnlyList<ReportContextSummaryItem> ContextSummaries,
    IReadOnlyList<ReportPurchaseItem> PurchaseItems,
    IReadOnlyList<ResponsibilityAssignmentListItem> Responsibilities,
    IReadOnlyList<ReportCalculationCheckItem> CalculationChecks)
{
    public IReadOnlyList<ReportRadiatorSummaryItem> RadiatorSummaries { get; init; } = [];
}

/// <summary>Display-only radiator grouping; original measurement identities and policies remain unchanged.</summary>
public sealed record ReportRadiatorSummaryItem(
    string Type,
    string TypeLabel,
    decimal HeightMm,
    decimal? LengthMm,
    string Unit,
    decimal NetQuantity,
    decimal WithWasteQuantity,
    decimal PurchaseQuantity,
    string PurchaseUnit,
    IReadOnlyList<Guid> PlacementIds);

/// <summary>Placement-level quantities labelled with their nearest configured category and system ancestors.</summary>
public sealed record ReportClassificationSummaryItem(
    string Category,
    string System,
    string? PositionNumber,
    string Code,
    string Name,
    string Unit,
    int MeasurementCount,
    decimal NetQuantity,
    decimal WithWasteQuantity,
    decimal PurchaseQuantity,
    string? Variant = null,
    string? SecondaryVariant = null);

/// <summary>Source quantities grouped by explicit on-drawing context without mixing units.</summary>
public sealed record ReportContextSummaryItem(
    string Block,
    string Floor,
    string Room,
    string Zone,
    string Sheet,
    string DrawingRevision,
    string? PositionNumber,
    string Code,
    string Name,
    string Unit,
    int SourceLineCount,
    decimal NetQuantity);

/// <summary>One purchase-facing quantity, sourced either from direct measurement or a reviewed derived calculation.</summary>
public sealed record ReportPurchaseItem(
    Guid PlacementId,
    string Code,
    string Name,
    string Unit,
    string QuantitySource,
    decimal NetQuantity,
    decimal WithWasteQuantity,
    decimal PurchaseQuantity,
    decimal? UsedQuantity,
    string? CalculationRule,
    string? Variant = null,
    string? SecondaryVariant = null,
    // PurchaseUnit: satın alma miktarının birimi ("boy", "paket" veya ölçü
    // birimi). Girdi biriminden ayrıdır: 13 boy boru 13 metre değildir.
    string? PurchaseUnit = null);

/// <summary>Visible calculation review state included in the control report.</summary>
public sealed record ReportCalculationCheckItem(
    Guid ResultId,
    Guid TargetPlacementId,
    string TargetCode,
    string TargetName,
    string Rule,
    int RuleVersion,
    CalculationResultStatus Status,
    decimal ProposedQuantity,
    decimal PurchaseQuantity,
    decimal? UsedQuantity,
    string? Reason);

/// <summary>Result of writing one report artifact from an immutable data snapshot.</summary>
public sealed record ProjectReportExportResult(
    string OutputPath,
    int SourceMeasurementCount,
    int SummaryCount,
    DateTime GeneratedAtUtc)
{
    // Aşağıdaki dört alan yalnız indirme dosyasına okunur bir ad vermek içindir.
    // Önceden indirme adı geçici dosyanın GUID'li adıydı (metraj-<guid>-<guid>.pdf)
    // ve kullanıcı bunu masaüstünde, tarayıcıda ve Android paylaşım ekranında
    // görüyordu. Bilgi zaten rapor verisinin içinde olduğundan ek sorgu gerekmez.
    // Konumsal sözleşmenin dışında, isteğe bağlı ek: mevcut çağıranlar etkilenmez.

    /// <summary>Raporun proje kodu.</summary>
    public string ProjectCode { get; init; } = string.Empty;

    /// <summary>Raporun revizyon kodu (ör. "R0").</summary>
    public string RevisionCode { get; init; } = string.Empty;

    /// <summary>Alt ağaç raporunda kök yerleşimin kodu; tam raporda <see langword="null"/>.</summary>
    public string? ScopeCode { get; init; }

    /// <summary>Alt ağaç raporunda kök yerleşimin görünen adı; tam raporda <see langword="null"/>.</summary>
    public string? ScopeName { get; init; }
}

/// <summary>Creates consistent PDF and Excel reports from one project revision.</summary>
public interface IProjectReportWorkspace
{
    /// <summary>Loads the source and calculated data shared by all report formats.</summary>
    public Task<ProjectReportData> BuildReportDataAsync(Guid revisionId, CancellationToken cancellationToken = default);

    /// <summary>Writes a workbook with summary and source measurement sheets.</summary>
    public Task<ProjectReportExportResult> ExportExcelAsync(Guid revisionId, string outputPath, CancellationToken cancellationToken = default);

    /// <summary>Writes a print-oriented PDF with the same summary and source rows.</summary>
    public Task<ProjectReportExportResult> ExportPdfAsync(Guid revisionId, string outputPath, CancellationToken cancellationToken = default);

    /// <summary>Writes an editable Word Open XML document.</summary>
    public Task<ProjectReportExportResult> ExportWordAsync(Guid revisionId, string outputPath, CancellationToken cancellationToken = default);

    /// <summary>Builds a report limited to a placement and all descendants.</summary>
    public Task<ProjectReportData> BuildSubtreeReportDataAsync(Guid revisionId, Guid rootPlacementId, CancellationToken cancellationToken = default);

    public Task<ProjectReportExportResult> ExportSubtreeExcelAsync(Guid revisionId, Guid rootPlacementId, string outputPath, CancellationToken cancellationToken = default);

    /// <summary>Writes a print-oriented PDF limited to a placement and all descendants.</summary>
    public Task<ProjectReportExportResult> ExportSubtreePdfAsync(Guid revisionId, Guid rootPlacementId, string outputPath, CancellationToken cancellationToken = default);

    /// <summary>Writes an editable Word document limited to a placement and all descendants.</summary>
    public Task<ProjectReportExportResult> ExportSubtreeWordAsync(Guid revisionId, Guid rootPlacementId, string outputPath, CancellationToken cancellationToken = default);
}
