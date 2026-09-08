using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Creates immutable calculation-rule versions and reviewable result snapshots without executing user code.</summary>
public sealed class CalculationWorkspaceService : ICalculationWorkspace
{
    private const string SnapshotContractVersion = "CALC-SNAPSHOT-v1";
    private static readonly JsonSerializerOptions SnapshotJsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() }
    };
    private readonly Func<MetrajDbContext> contextFactory;

    public CalculationWorkspaceService(Func<MetrajDbContext> contextFactory)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CalculationRuleListItem>> ListRulesAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        List<CalculationRuleVersion> rules = await context.CalculationRuleVersions.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .OrderBy(x => x.Code).ThenByDescending(x => x.VersionNumber)
            .ToListAsync(cancellationToken);
        return rules.Select(ToRuleListItem).ToList();
    }

    /// <inheritdoc />
    public async Task<CalculationRuleListItem> CreateRuleVersionAsync(Guid revisionId, CalculationRuleDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        NormalizedRule normalized = NormalizeRule(draft);
        await using MetrajDbContext context = contextFactory();
        ProjectRevision revision = await context.ProjectRevisions.SingleOrDefaultAsync(x => x.Id == revisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("calculation.revision", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);

        List<CalculationRuleVersion> priorVersions = await context.CalculationRuleVersions
            .Where(x => x.ProjectRevisionId == revisionId && x.Code == normalized.Code)
            .ToListAsync(cancellationToken);
        foreach (CalculationRuleVersion prior in priorVersions.Where(x => x.IsActive))
        {
            prior.IsActive = false;
        }

        var rule = new CalculationRuleVersion
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revisionId,
            Code = normalized.Code,
            Name = normalized.Name,
            VersionNumber = (priorVersions.Count == 0 ? 0 : priorVersions.Max(x => x.VersionNumber)) + 1,
            SourceQuantityKind = normalized.SourceQuantityKind,
            ParametersJson = SerializeParameters(normalized),
            // Parmak izi kalıcı olarak saklanır ve izlenebilirlik iddiasının
            // temelidir; işletim sistemi diline göre değişmemelidir. Düz string
            // interpolation CurrentCulture kullanıyordu: aynı kural Türkçe
            // Windows'ta "1,000000", İngilizce'de "1.000000" üretip FARKLI
            // hash'leniyordu.
            ContentHash = ComputeHash(string.Create(CultureInfo.InvariantCulture,
                $"{SnapshotContractVersion}|RULE|{normalized.Code}|{normalized.Name}|{normalized.Mode}|{normalized.Multiplier:F6}|{normalized.SourceQuantityKind}")),
            IsActive = true
        };
        context.CalculationRuleVersions.Add(rule);
        await AddAuditAsync(context, revisionId, "CalculationRuleVersion", rule.Id, "calculation-rule-version-created",
            JsonSerializer.Serialize(new { rule.Code, rule.VersionNumber, normalized.Mode, normalized.Multiplier, normalized.SourceQuantityKind }), cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return ToRuleListItem(rule);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CalculationResultListItem>> ListResultsAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        List<CalculationResult> results = await context.CalculationResults.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .Include(x => x.TargetPlacement).ThenInclude(x => x!.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            .Include(x => x.CalculationRuleVersion)
            .Include(x => x.CardVersion)
            .OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return results.Select(ToResultListItem).ToList();
    }

    /// <inheritdoc />
    public async Task<CalculationResultListItem> CalculateAsync(Guid revisionId, Guid targetPlacementId, Guid ruleVersionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        ProjectRevision revision = await context.ProjectRevisions
            .SingleOrDefaultAsync(x => x.Id == revisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("calculation.revision", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);
        ProjectPlacement target = await context.ProjectPlacements
            .Include(x => x.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            .SingleOrDefaultAsync(x => x.Id == targetPlacementId, cancellationToken)
            ?? throw new DomainRuleViolationException("calculation.target", "Target placement was not found.");
        if (target.ProjectRevisionId != revisionId)
        {
            throw new DomainRuleViolationException("calculation.scope", "Target placement must belong to the selected project revision.");
        }

        CatalogCardVersion targetCard = target.CatalogCardVersion
            ?? throw new DomainRuleViolationException("calculation.card", "Target placement card version was not found.");
        if (targetCard.ReportBehavior != ReportBehavior.Measurable)
        {
            throw new DomainRuleViolationException("calculation.behavior", "Only measurable placements can have a quantity calculation.");
        }

        CalculationRuleVersion rule = await context.CalculationRuleVersions
            .SingleOrDefaultAsync(x => x.Id == ruleVersionId, cancellationToken)
            ?? throw new DomainRuleViolationException("calculation.rule", "Calculation rule version was not found.");
        if (rule.ProjectRevisionId != revisionId)
        {
            throw new DomainRuleViolationException("calculation.scope", "Calculation rule must belong to the selected project revision.");
        }

        ParsedRule parsedRule = ParseRule(rule);
        // Metraj özetiyle AYNI etkin politika kullanılır. Önceden motor ham
        // katalog kartıyla çağrılıyordu; merkezi malzeme fire oranı tanımlıysa
        // özet ekranı ile hesap önerisi aynı veri için farklı sayı üretiyordu.
        IReadOnlyDictionary<string, decimal> materialWaste =
            await RevisionWastePolicy.ResolveAsync(context, revision, cancellationToken);
        SourceSnapshot source = await BuildSourceSnapshotAsync(context, revisionId, target, parsedRule, materialWaste, cancellationToken);
        decimal proposedQuantity = decimal.Round(source.Quantity * parsedRule.Multiplier, QuantityRules.DecimalScale, MidpointRounding.ToEven);
        QuantityRules.EnsureValid(proposedQuantity, "proposed quantity");
        CalculationOutput output = CalculationEngine.Calculate(
            RevisionWastePolicy.ResolveEffectiveCard(targetCard, materialWaste), proposedQuantity);
        string inputSummary = JsonSerializer.Serialize(new CalculationInputSummary(
            SnapshotContractVersion,
            parsedRule.Mode,
            parsedRule.Multiplier,
            parsedRule.SourceQuantityKind,
            source.SourceRows,
            source.Quantity,
            targetCard.Unit), SnapshotJsonOptions);
        string sourceIds = JsonSerializer.Serialize(source.Measurements.Select(x => x.Id.ToString("D")).OrderBy(x => x, StringComparer.Ordinal));
        string inputHash = ComputeHash(string.Join("|", SnapshotContractVersion, revision.EngineVersion, revision.UnitPolicyVersion,
            target.Id, targetCard.Id, targetCard.ContentHash, rule.Id, rule.ContentHash, inputSummary, sourceIds));

        List<CalculationResult> previous = await context.CalculationResults
            .Where(x => x.ProjectRevisionId == revisionId && x.TargetPlacementId == targetPlacementId &&
                        (x.Status == CalculationResultStatus.PendingReview || x.Status == CalculationResultStatus.Approved ||
                         x.Status == CalculationResultStatus.Overridden || x.Status == CalculationResultStatus.Stale))
            .ToListAsync(cancellationToken);
        foreach (CalculationResult old in previous)
        {
            old.Status = CalculationResultStatus.Superseded;
        }

        var result = new CalculationResult
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revisionId,
            TargetPlacementId = target.Id,
            CalculationRuleVersionId = rule.Id,
            CardVersionId = targetCard.Id,
            SourceMeasurementIdsJson = sourceIds,
            InputSummary = inputSummary,
            InputHash = inputHash,
            EngineVersion = revision.EngineVersion,
            UnitPolicyVersion = revision.UnitPolicyVersion,
            ProposedQuantity = proposedQuantity,
            NetQuantity = output.NetQuantity,
            WithWasteQuantity = output.WithWasteQuantity,
            PurchaseQuantity = output.PurchaseQuantity,
            RemainderQuantity = output.RemainderQuantity,
            Status = CalculationResultStatus.PendingReview,
            SupersedesResultId = previous.OrderByDescending(x => x.CreatedAtUtc).Select(x => (Guid?)x.Id).FirstOrDefault(),
            CreatedAtUtc = DateTime.UtcNow,
            TargetPlacement = target,
            CalculationRuleVersion = rule,
            CardVersion = targetCard
        };
        context.CalculationResults.Add(result);
        await AddAuditAsync(context, revisionId, "CalculationResult", result.Id, "calculation-result-created",
            JsonSerializer.Serialize(new { result.TargetPlacementId, result.CalculationRuleVersionId, result.CardVersionId, result.InputHash, result.Status }), cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return ToResultListItem(result);
    }

    /// <inheritdoc />
    public async Task ApproveAsync(Guid resultId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        CalculationResult result = await LoadReviewableResultAsync(context, resultId, cancellationToken);
        result.Status = CalculationResultStatus.Approved;
        result.UsedQuantity = result.PurchaseQuantity;
        result.OverrideReason = null;
        await AddAuditAsync(context, result.ProjectRevisionId, "CalculationResult", result.Id, "calculation-result-approved",
            JsonSerializer.Serialize(new { result.UsedQuantity }), cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task OverrideAsync(Guid resultId, decimal usedQuantity, string reason, CancellationToken cancellationToken = default)
    {
        QuantityRules.EnsureValid(usedQuantity, "manual purchase quantity");
        string normalizedReason = NormalizeReason(reason, "calculation.override-reason");
        await using MetrajDbContext context = contextFactory();
        CalculationResult result = await LoadReviewableResultAsync(context, resultId, cancellationToken);
        result.Status = CalculationResultStatus.Overridden;
        result.UsedQuantity = usedQuantity;
        result.OverrideReason = normalizedReason;
        await AddAuditAsync(context, result.ProjectRevisionId, "CalculationResult", result.Id, "calculation-result-overridden",
            JsonSerializer.Serialize(new { result.UsedQuantity, result.OverrideReason }), cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task RejectAsync(Guid resultId, string reason, CancellationToken cancellationToken = default)
    {
        string normalizedReason = NormalizeReason(reason, "calculation.reject-reason");
        await using MetrajDbContext context = contextFactory();
        CalculationResult result = await LoadReviewableResultAsync(context, resultId, cancellationToken);
        result.Status = CalculationResultStatus.Rejected;
        result.UsedQuantity = null;
        result.OverrideReason = normalizedReason;
        await AddAuditAsync(context, result.ProjectRevisionId, "CalculationResult", result.Id, "calculation-result-rejected",
            JsonSerializer.Serialize(new { result.OverrideReason }), cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task<SourceSnapshot> BuildSourceSnapshotAsync(
        MetrajDbContext context,
        Guid revisionId,
        ProjectPlacement target,
        ParsedRule rule,
        IReadOnlyDictionary<string, decimal> materialWaste,
        CancellationToken cancellationToken)
    {
        Guid[] sourcePlacementIds;
        if (rule.Mode == CalculationRuleMode.Direct)
        {
            sourcePlacementIds = [target.Id];
        }
        else
        {
            sourcePlacementIds = await context.PlacementLinks.AsNoTracking()
                .Where(x => x.TargetPlacementId == target.Id && x.LinkType == SemanticLinkType.CalculatedFrom)
                .Select(x => x.SourcePlacementId)
                .Distinct()
                .OrderBy(x => x)
                .ToArrayAsync(cancellationToken);
            if (sourcePlacementIds.Length == 0)
            {
                throw new DomainRuleViolationException("calculation.calculated-from", "A fixed-multiplier rule requires at least one calculated-from source placement.");
            }
        }

        List<Measurement> measurements = await context.Measurements.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId && sourcePlacementIds.Contains(x.ProjectPlacementId))
            .OrderBy(x => x.ProjectPlacementId).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        if (measurements.Count == 0)
        {
            throw new DomainRuleViolationException("calculation.source-measurements", "The calculation has no source measurement rows.");
        }

        Dictionary<Guid, ProjectPlacement> sourcePlacements = await context.ProjectPlacements.AsNoTracking()
            .Where(x => sourcePlacementIds.Contains(x.Id))
            .Include(x => x.CatalogCardVersion)
            .ToDictionaryAsync(x => x.Id, cancellationToken);
        var sourceRows = new List<CalculationSourceRow>();
        foreach (IGrouping<Guid, Measurement> group in measurements.GroupBy(x => x.ProjectPlacementId).OrderBy(x => x.Key))
        {
            ProjectPlacement sourcePlacement = sourcePlacements[group.Key];
            CatalogCardVersion sourceCard = sourcePlacement.CatalogCardVersion
                ?? throw new DomainRuleViolationException("calculation.source-card", "Source placement card version was not found.");
            decimal net = group.Sum(x => x.InputQuantity);
            decimal sourceQuantity = rule.SourceQuantityKind == SourceQuantityKind.Net
                ? net
                : CalculationEngine.Calculate(
                    RevisionWastePolicy.ResolveEffectiveCard(sourceCard, materialWaste), net).WithWasteQuantity;
            sourceRows.Add(new CalculationSourceRow(sourcePlacement.Id, sourceCard.Unit, group.Count(), sourceQuantity));
        }

        string[] units = sourceRows.Select(x => x.Unit).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (units.Length != 1)
        {
            throw new DomainRuleViolationException("calculation.source-unit", "Calculated source placements must use one common source unit.");
        }

        decimal quantity = sourceRows.Sum(x => x.Quantity);
        QuantityRules.EnsureValid(quantity, "source quantity");
        return new SourceSnapshot(quantity, measurements, sourceRows);
    }

    private static async Task<CalculationResult> LoadReviewableResultAsync(MetrajDbContext context, Guid resultId, CancellationToken cancellationToken)
    {
        CalculationResult result = await context.CalculationResults.SingleOrDefaultAsync(x => x.Id == resultId, cancellationToken)
            ?? throw new DomainRuleViolationException("calculation.result", "Calculation result was not found.");
        ProjectRevision revision = await context.ProjectRevisions.SingleAsync(x => x.Id == result.ProjectRevisionId, cancellationToken);
        ProjectRevisionRules.EnsureDraft(revision);
        if (result.Status != CalculationResultStatus.PendingReview)
        {
            throw new DomainRuleViolationException("calculation.review-state", "Only a pending-review calculation result can be reviewed.");
        }

        return result;
    }

    private static NormalizedRule NormalizeRule(CalculationRuleDraft draft)
    {
        string code = draft.Code.Trim().ToUpperInvariant();
        string name = draft.Name.Trim();
        if (code.Length is 0 or > 64 || name.Length is 0 or > 256)
        {
            throw new DomainRuleViolationException("calculation.rule", "Rule code and name must be filled within their supported lengths.");
        }

        QuantityRules.EnsureValid(draft.Multiplier, "rule multiplier");
        if (draft.Mode == CalculationRuleMode.Direct && (draft.Multiplier != 1m || draft.SourceQuantityKind != SourceQuantityKind.Net))
        {
            throw new DomainRuleViolationException("calculation.direct-rule", "A direct rule always uses multiplier 1 and net source quantity.");
        }

        if (draft.Mode == CalculationRuleMode.FixedMultiplier && draft.Multiplier <= 0m)
        {
            throw new DomainRuleViolationException("calculation.multiplier", "A fixed-multiplier rule needs a positive multiplier.");
        }

        return new NormalizedRule(code, name, draft.Mode, draft.Multiplier, draft.SourceQuantityKind);
    }

    private static string SerializeParameters(NormalizedRule rule) => JsonSerializer.Serialize(new RuleParameters(rule.Mode, rule.Multiplier), SnapshotJsonOptions);

    private static ParsedRule ParseRule(CalculationRuleVersion rule)
    {
        try
        {
            RuleParameters? parameters = JsonSerializer.Deserialize<RuleParameters>(rule.ParametersJson, SnapshotJsonOptions);
            if (parameters is null)
            {
                throw new JsonException("Missing rule parameters.");
            }

            return NormalizeRule(new CalculationRuleDraft(rule.Code, rule.Name, parameters.Mode, parameters.Multiplier, rule.SourceQuantityKind))
                .ToParsed();
        }
        catch (JsonException exception)
        {
            throw new DomainRuleViolationException("calculation.rule-parameters", $"Calculation rule parameters are invalid: {exception.Message}");
        }
    }

    private static CalculationRuleListItem ToRuleListItem(CalculationRuleVersion rule)
    {
        ParsedRule parameters = ParseRule(rule);
        return new CalculationRuleListItem(rule.Id, rule.ProjectRevisionId, rule.Code, rule.Name, rule.VersionNumber,
            parameters.Mode, parameters.Multiplier, rule.SourceQuantityKind, rule.ContentHash, rule.IsActive);
    }

    private static CalculationResultListItem ToResultListItem(CalculationResult result)
    {
        ProjectPlacement target = result.TargetPlacement
            ?? throw new DomainRuleViolationException("calculation.target", "Calculation result target placement was not loaded.");
        CatalogCardVersion card = result.CardVersion
            ?? throw new DomainRuleViolationException("calculation.card", "Calculation result card version was not loaded.");
        CalculationRuleVersion rule = result.CalculationRuleVersion
            ?? throw new DomainRuleViolationException("calculation.rule", "Calculation result rule version was not loaded.");
        return new CalculationResultListItem(result.Id, result.ProjectRevisionId, result.TargetPlacementId,
            target.CatalogCardVersion?.CatalogCardDefinition?.Code ?? "?", target.DisplayNameOverride ?? target.CatalogCardVersion?.Name ?? "?", card.Unit,
            result.CalculationRuleVersionId, rule.Code, rule.VersionNumber, result.CardVersionId, card.ContentHash,
            result.SourceMeasurementIdsJson, result.InputSummary, result.InputHash, result.EngineVersion, result.UnitPolicyVersion,
            result.ProposedQuantity, result.NetQuantity, result.WithWasteQuantity, result.PurchaseQuantity, result.RemainderQuantity,
            result.UsedQuantity, result.Status, result.OverrideReason, result.SupersedesResultId, result.CreatedAtUtc);
    }

    private static async Task AddAuditAsync(MetrajDbContext context, Guid revisionId, string entityType, Guid entityId, string eventType, string detailsJson, CancellationToken cancellationToken)
    {
        context.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revisionId,
            EntityType = entityType,
            EntityId = entityId,
            EventType = eventType,
            DetailsJson = detailsJson,
            OccurredAtUtc = DateTime.UtcNow
        });
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static string NormalizeReason(string reason, string rule)
    {
        string normalized = reason.Trim();
        if (normalized.Length is 0 or > 2_000)
        {
            throw new DomainRuleViolationException(rule, "A reason of 1 to 2000 characters is required.");
        }

        return normalized;
    }

    private static string ComputeHash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private sealed record RuleParameters(CalculationRuleMode Mode, decimal Multiplier);
    private sealed record ParsedRule(CalculationRuleMode Mode, decimal Multiplier, SourceQuantityKind SourceQuantityKind);
    private sealed record NormalizedRule(string Code, string Name, CalculationRuleMode Mode, decimal Multiplier, SourceQuantityKind SourceQuantityKind)
    {
        public ParsedRule ToParsed() => new(Mode, Multiplier, SourceQuantityKind);
    }

    private sealed record CalculationSourceRow(Guid PlacementId, string Unit, int MeasurementCount, decimal Quantity);
    private sealed record CalculationInputSummary(
        string ContractVersion,
        CalculationRuleMode Mode,
        decimal Multiplier,
        SourceQuantityKind SourceQuantityKind,
        IReadOnlyList<CalculationSourceRow> Sources,
        decimal SourceQuantity,
        string TargetUnit);
    private sealed record SourceSnapshot(decimal Quantity, IReadOnlyList<Measurement> Measurements, IReadOnlyList<CalculationSourceRow> SourceRows);
}
