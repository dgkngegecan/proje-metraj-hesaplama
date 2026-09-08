using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Persists source measurements and derives deterministic placement summaries.</summary>
public sealed class MeasurementWorkspaceService : IMeasurementWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory;

    /// <summary>Creates the workspace with a short-lived database context factory.</summary>
    public MeasurementWorkspaceService(Func<MetrajDbContext> contextFactory)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<MeasurementListItem>> ListMeasurementsAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        List<Measurement> measurements = await context.Measurements.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .Include(x => x.ProjectPlacement).ThenInclude(x => x!.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            // Giriş geçmişi, kullanıcının AutoCAD'den okuduğu sırayı korumalıdır.
            // Konum alanları yalnızca satırın içinde gösterilir; sıralama kaynağı
            // her zaman oluşturulma zamanı (eşitlikte kimlik) olur.
            .OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return measurements.Select(ToListItem).ToList();
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<MeasurementSummaryItem>> ListSummariesAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        var groups = await context.Measurements.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .GroupBy(x => new { x.ProjectPlacementId, x.Variant, x.SecondaryVariant })
            .Select(x => new { PlacementId = x.Key.ProjectPlacementId, x.Key.Variant, x.Key.SecondaryVariant, Count = x.Count(), Net = x.Sum(row => row.InputQuantity) })
            .ToListAsync(cancellationToken);
        if (groups.Count == 0)
        {
            return [];
        }

        Guid[] placementIds = groups.Select(x => x.PlacementId).ToArray();
        Dictionary<Guid, ProjectPlacement> placements = await context.ProjectPlacements.AsNoTracking()
            .Where(x => placementIds.Contains(x.Id))
            .Include(x => x.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            .ToDictionaryAsync(x => x.Id, cancellationToken);
        // Aynı malzeme ailesini farklı yazımla taşıyan (eski kurulumlardan kalan)
        // kayıtlar, metraj özetinin üretilmesini ASLA engellememelidir. Doğrudan
        // ToDictionary çağrısı burada çakışan anahtarda istisna atardı ve kullanıcı
        // harita, özet ve raporların tamamını kaybederdi. En güncel kayıt kazanır.
        var materialWaste = (await context.MaterialTypeWasteSettings.AsNoTracking()
                .OrderBy(x => x.UpdatedAtUtc).ThenBy(x => x.Id)
                .ToListAsync(cancellationToken))
            .GroupBy(x => x.MaterialType, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last().WasteRatePct, StringComparer.OrdinalIgnoreCase);

        var summaries = new List<MeasurementSummaryItem>(groups.Count);
        foreach (var group in groups)
        {
            ProjectPlacement placement = placements[group.PlacementId];
            CatalogCardVersion card = placement.CatalogCardVersion
                ?? throw new DomainRuleViolationException("measurement.card", "Placement catalog card version was not found.");
            decimal effectiveWaste = card.MaterialType is string materialType && materialWaste.TryGetValue(materialType, out decimal configured)
                ? configured : card.WasteRatePct;
            var effectiveCard = new CatalogCardVersion
            {
                WasteRatePct = effectiveWaste,
                SalesConversion = card.SalesConversion,
                ContainerParameter = card.ContainerParameter
            };
            // Pipe cards can define a different stock length for every nominal diameter.
            // The measurement variant is the immutable key that selects that policy.
            if (card.SalesConversion == SalesConversion.StandardLength && !string.IsNullOrWhiteSpace(group.Variant))
            {
                CatalogCardVariant? profile = CatalogVariantCatalog.Parse(card.VariantDefinitionsJson)
                    .FirstOrDefault(item => item.Code.Equals(group.Variant, StringComparison.OrdinalIgnoreCase) ||
                        item.Label.Equals(group.Variant, StringComparison.OrdinalIgnoreCase));
                if (profile?.StandardLength is decimal standardLength && standardLength > 0m)
                {
                    effectiveCard.ContainerParameter = standardLength;
                }
            }
            CalculationOutput calculated = CalculationEngine.Calculate(effectiveCard, group.Net);
            string name = placement.DisplayNameOverride ?? card.Name;
            string code = card.CatalogCardDefinition?.Code ?? "?";
            summaries.Add(new MeasurementSummaryItem(
                placement.Id,
                code,
                name,
                card.Unit,
                group.Count,
                calculated.NetQuantity,
                calculated.WithWasteQuantity,
                calculated.PurchaseQuantity,
                calculated.RemainderQuantity,
                group.Variant,
                group.SecondaryVariant,
                effectiveWaste,
                card.SalesConversion switch
                {
                    SalesConversion.StandardLength => "boy",
                    SalesConversion.Package => "paket",
                    _ => card.Unit
                }));
        }

        var parentByPlacement = placements.Values.ToDictionary(x => x.Id, x => x.ParentPlacementId);
        int Depth(Guid placementId)
        {
            int depth = 0;
            Guid? cursor = parentByPlacement.TryGetValue(placementId, out Guid? parent) ? parent : null;
            while (cursor is Guid parentId && depth < 64)
            {
                depth++;
                cursor = parentByPlacement.TryGetValue(parentId, out Guid? next) ? next : null;
            }
            return depth;
        }
        static decimal VariantSize(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return 0m;
            string token = new string(value.SkipWhile(ch => !char.IsDigit(ch)).TakeWhile(char.IsDigit).ToArray());
            return decimal.TryParse(token, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out decimal size) ? size : 0m;
        }
        return summaries
            .OrderBy(x => Depth(x.PlacementId))
            .ThenByDescending(x => VariantSize(x.Variant))
            .ThenBy(x => x.PlacementName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.Variant, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.SecondaryVariant, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <inheritdoc />
    public async Task<MeasurementListItem> CreateMeasurementAsync(MeasurementDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        await using MetrajDbContext context = contextFactory();
        (ProjectRevision revision, ProjectPlacement placement) = await ResolveScopeAsync(context, draft.RevisionId, draft.PlacementId, cancellationToken);
        Measurement measurement = CreateEntity(draft, revision, placement);
        context.Measurements.Add(measurement);
        await context.SaveChangesAsync(cancellationToken);
        return ToListItem(measurement);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<MeasurementListItem>> CreateMeasurementsAsync(IReadOnlyList<MeasurementDraft> drafts, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(drafts);
        if (drafts.Count == 0)
        {
            throw new DomainRuleViolationException("measurement.batch", "At least one measurement row is required.");
        }

        await using MetrajDbContext context = contextFactory();
        var measurements = new List<Measurement>(drafts.Count);
        var scopes = new Dictionary<(Guid RevisionId, Guid PlacementId), (ProjectRevision Revision, ProjectPlacement Placement)>();
        foreach (MeasurementDraft draft in drafts)
        {
            ArgumentNullException.ThrowIfNull(draft);
            var scopeKey = (draft.RevisionId, draft.PlacementId);
            if (!scopes.TryGetValue(scopeKey, out (ProjectRevision Revision, ProjectPlacement Placement) scope))
            {
                scope = await ResolveScopeAsync(context, draft.RevisionId, draft.PlacementId, cancellationToken);
                scopes.Add(scopeKey, scope);
            }

            (ProjectRevision revision, ProjectPlacement placement) = scope;
            measurements.Add(CreateEntity(draft, revision, placement));
        }

        context.Measurements.AddRange(measurements);
        await context.SaveChangesAsync(cancellationToken);
        return measurements.Select(ToListItem).ToList();
    }

    /// <inheritdoc />
    public async Task UpdateMeasurementAsync(Guid measurementId, MeasurementDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        await using MetrajDbContext context = contextFactory();
        Measurement measurement = await context.Measurements.SingleOrDefaultAsync(x => x.Id == measurementId, cancellationToken)
            ?? throw new DomainRuleViolationException("measurement.not-found", "Measurement was not found.");
        (ProjectRevision revision, ProjectPlacement placement) = await ResolveScopeAsync(context, draft.RevisionId, draft.PlacementId, cancellationToken);
        if (measurement.ProjectRevisionId != revision.Id)
        {
            throw new DomainRuleViolationException("measurement.revision", "A measurement cannot be moved between project revisions.");
        }

        ApplyDraft(measurement, draft, placement, updateSourceKind: false);
        measurement.UpdatedAtUtc = DateTime.UtcNow;
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<MeasurementListItem> DuplicateMeasurementAsync(Guid measurementId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        Measurement source = await context.Measurements
            .Include(x => x.ProjectPlacement).ThenInclude(x => x!.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            .SingleOrDefaultAsync(x => x.Id == measurementId, cancellationToken)
            ?? throw new DomainRuleViolationException("measurement.not-found", "Measurement was not found.");
        var copy = new Measurement
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = source.ProjectRevisionId,
            ProjectPlacementId = source.ProjectPlacementId,
            SourceKind = source.SourceKind,
            InputQuantity = source.InputQuantity,
            InputUnit = source.InputUnit,
            Block = source.Block,
            Floor = source.Floor,
            Room = source.Room,
            Zone = source.Zone,
            Sheet = source.Sheet,
            DrawingRevision = source.DrawingRevision,
            Notes = source.Notes,
            Variant = source.Variant,
            SecondaryVariant = source.SecondaryVariant,
            CreatedAtUtc = DateTime.UtcNow,
            ProjectPlacement = source.ProjectPlacement
        };
        context.Measurements.Add(copy);
        await context.SaveChangesAsync(cancellationToken);
        return ToListItem(copy);
    }

    public async Task DeleteMeasurementAsync(Guid measurementId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        Measurement measurement = await context.Measurements.SingleOrDefaultAsync(x => x.Id == measurementId, cancellationToken)
            ?? throw new DomainRuleViolationException("measurement.not-found", "Measurement was not found.");
        ProjectRevision revision = await context.ProjectRevisions.SingleAsync(x => x.Id == measurement.ProjectRevisionId, cancellationToken);
        ProjectRevisionRules.EnsureDraft(revision);
        await context.ResponsibilityAssignments.Where(x => x.MeasurementId == measurementId).ExecuteDeleteAsync(cancellationToken);
        context.Measurements.Remove(measurement);
        await context.SaveChangesAsync(cancellationToken);
    }

    private static async Task<(ProjectRevision Revision, ProjectPlacement Placement)> ResolveScopeAsync(
        MetrajDbContext context, Guid revisionId, Guid placementId, CancellationToken cancellationToken)
    {
        ProjectRevision revision = await context.ProjectRevisions.SingleOrDefaultAsync(x => x.Id == revisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("measurement.revision", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);
        ProjectPlacement placement = await context.ProjectPlacements
            .Include(x => x.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            .SingleOrDefaultAsync(x => x.Id == placementId, cancellationToken)
            ?? throw new DomainRuleViolationException("measurement.placement", "Project placement was not found.");
        if (placement.ProjectRevisionId != revision.Id)
        {
            throw new DomainRuleViolationException("measurement.scope", "Measurement placement must belong to the selected project revision.");
        }

        if (placement.CatalogCardVersion?.ReportBehavior != ReportBehavior.Measurable)
        {
            throw new DomainRuleViolationException("measurement.behavior", "Only measurable placements can receive quantity input.");
        }

        if (placement.CatalogCardVersion.InputBehavior == InputBehavior.Derived)
        {
            throw new DomainRuleViolationException("measurement.derived", "A derived item cannot receive manual source quantity; create a reviewable calculation proposal instead.");
        }

        return (revision, placement);
    }

    private static Measurement CreateEntity(MeasurementDraft draft, ProjectRevision revision, ProjectPlacement placement)
    {
        var measurement = new Measurement
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revision.Id,
            ProjectPlacementId = placement.Id,
            CreatedAtUtc = DateTime.UtcNow,
            ProjectPlacement = placement
        };
        ApplyDraft(measurement, draft, placement);
        return measurement;
    }

    private static void ApplyDraft(Measurement measurement, MeasurementDraft draft, ProjectPlacement placement, bool updateSourceKind = true)
    {
        CatalogCardVersion card = placement.CatalogCardVersion
            ?? throw new DomainRuleViolationException("measurement.card", "Placement catalog card version was not found.");
        QuantityRules.EnsureValid(draft.InputQuantity, "input quantity");
        if (card.InputBehavior == InputBehavior.Boolean && draft.InputQuantity is not 0m and not 1m)
        {
            throw new DomainRuleViolationException("measurement.boolean", "A boolean item accepts only 0 (not done) or 1 (done).");
        }

        string unit = NormalizeRequired(draft.InputUnit, 32, "measurement.unit");
        if (!string.Equals(unit, card.Unit, StringComparison.OrdinalIgnoreCase))
        {
            throw new DomainRuleViolationException("measurement.unit", $"Input unit '{unit}' must match placement unit '{card.Unit}'.");
        }

        measurement.ProjectPlacementId = placement.Id;
        if (updateSourceKind)
        {
            measurement.SourceKind = NormalizeRequired(draft.SourceKind, 32, "measurement.source-kind");
        }
        measurement.InputQuantity = draft.InputQuantity;
        measurement.InputUnit = unit;
        measurement.Block = NormalizeOptional(draft.Block, 128, "measurement.block");
        measurement.Floor = NormalizeOptional(draft.Floor, 128, "measurement.floor");
        measurement.Room = NormalizeOptional(draft.Room, 256, "measurement.room");
        measurement.Zone = NormalizeOptional(draft.Zone, 128, "measurement.zone");
        measurement.Sheet = NormalizeOptional(draft.Sheet, 128, "measurement.sheet");
        measurement.DrawingRevision = NormalizeOptional(draft.DrawingRevision, 64, "measurement.drawing-revision");
        measurement.Notes = NormalizeOptional(draft.Notes, 2_000, "measurement.notes");
        measurement.Variant = NormalizeOptional(draft.Variant, 64, "measurement.variant");
        measurement.SecondaryVariant = NormalizeOptional(draft.SecondaryVariant, 64, "measurement.secondary-variant");
    }

    private static MeasurementListItem ToListItem(Measurement measurement)
    {
        ProjectPlacement placement = measurement.ProjectPlacement
            ?? throw new DomainRuleViolationException("measurement.placement", "Measurement placement was not loaded.");
        CatalogCardVersion card = placement.CatalogCardVersion
            ?? throw new DomainRuleViolationException("measurement.card", "Placement card version was not loaded.");
        return new MeasurementListItem(
            measurement.Id,
            measurement.ProjectRevisionId,
            measurement.ProjectPlacementId,
            card.CatalogCardDefinition?.Code ?? "?",
            placement.DisplayNameOverride ?? card.Name,
            measurement.SourceKind,
            measurement.InputQuantity,
            measurement.InputUnit,
            measurement.Block,
            measurement.Floor,
            measurement.Room,
            measurement.Zone,
            measurement.Sheet,
            measurement.DrawingRevision,
            measurement.Notes,
            measurement.CreatedAtUtc,
            measurement.UpdatedAtUtc,
            measurement.Variant,
            measurement.SecondaryVariant);
            
    }

    private static string NormalizeRequired(string value, int maxLength, string rule)
    {
        string normalized = value.Trim();
        if (normalized.Length == 0 || normalized.Length > maxLength)
        {
            throw new DomainRuleViolationException(rule, $"Value must contain 1 to {maxLength} characters.");
        }

        return normalized;
    }

    private static string? NormalizeOptional(string? value, int maxLength, string rule)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        string normalized = value.Trim();
        if (normalized.Length > maxLength)
        {
            throw new DomainRuleViolationException(rule, $"Value must not exceed {maxLength} characters.");
        }

        return normalized;
    }
}
