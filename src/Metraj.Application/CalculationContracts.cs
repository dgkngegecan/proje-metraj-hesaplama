using Metraj.Domain;

namespace Metraj.Application;

/// <summary>Small, auditable set of rule behaviours; arbitrary user code is intentionally unsupported.</summary>
public enum CalculationRuleMode
{
    Direct,
    FixedMultiplier
}

/// <summary>Immutable version content for a calculation rule.</summary>
public sealed record CalculationRuleDraft(
    string Code,
    string Name,
    CalculationRuleMode Mode,
    decimal Multiplier = 1m,
    SourceQuantityKind SourceQuantityKind = SourceQuantityKind.Net);

/// <summary>Readable calculation-rule version available in one project revision.</summary>
public sealed record CalculationRuleListItem(
    Guid Id,
    Guid RevisionId,
    string Code,
    string Name,
    int VersionNumber,
    CalculationRuleMode Mode,
    decimal Multiplier,
    SourceQuantityKind SourceQuantityKind,
    string ContentHash,
    bool IsActive)
{
    /// <summary>Selection label that makes rule code, version, and active state explicit.</summary>
    public string DisplayName => $"{Code} v{VersionNumber} — {Name}{(IsActive ? "" : " (eski sürüm)")}";
}

/// <summary>Stable snapshot of a calculation proposal and all versions that produced it.</summary>
public sealed record CalculationResultListItem(
    Guid Id,
    Guid RevisionId,
    Guid TargetPlacementId,
    string TargetPlacementCode,
    string TargetPlacementName,
    string Unit,
    Guid RuleVersionId,
    string RuleCode,
    int RuleVersionNumber,
    Guid CardVersionId,
    string CardContentHash,
    string SourceMeasurementIdsJson,
    string InputSummary,
    string InputHash,
    string EngineVersion,
    string UnitPolicyVersion,
    decimal ProposedQuantity,
    decimal NetQuantity,
    decimal WithWasteQuantity,
    decimal PurchaseQuantity,
    decimal RemainderQuantity,
    decimal? UsedQuantity,
    CalculationResultStatus Status,
    string? OverrideReason,
    Guid? SupersedesResultId,
    DateTime CreatedAtUtc);

/// <summary>Application boundary for versioned rules and reviewable calculation results.</summary>
public interface ICalculationWorkspace
{
    public Task<IReadOnlyList<CalculationRuleListItem>> ListRulesAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<CalculationRuleListItem> CreateRuleVersionAsync(Guid revisionId, CalculationRuleDraft draft, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<CalculationResultListItem>> ListResultsAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<CalculationResultListItem> CalculateAsync(Guid revisionId, Guid targetPlacementId, Guid ruleVersionId, CancellationToken cancellationToken = default);
    public Task ApproveAsync(Guid resultId, CancellationToken cancellationToken = default);
    public Task OverrideAsync(Guid resultId, decimal usedQuantity, string reason, CancellationToken cancellationToken = default);
    public Task RejectAsync(Guid resultId, string reason, CancellationToken cancellationToken = default);
}
