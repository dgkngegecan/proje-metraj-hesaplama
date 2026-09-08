using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Project placement and semantic-link operations with invariant checks.</summary>
public sealed class ProjectTreeWorkspaceService : IProjectTreeWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory;

    public ProjectTreeWorkspaceService(Func<MetrajDbContext> contextFactory)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
    }

    public async Task<IReadOnlyList<PlacementListItem>> ListPlacementsAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        List<ProjectPlacement> placements = await context.ProjectPlacements
            .AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .Include(x => x.CatalogCardVersion)
            .ThenInclude(x => x!.CatalogCardDefinition)
            .OrderBy(x => x.ParentPlacementId)
            .ThenBy(x => x.DisplayNameOverride ?? x.CatalogCardVersion!.Name)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return placements.Select(ToListItem).ToList();
    }

    public async Task<PlacementListItem> AddPlacementAsync(PlacementDraft draft, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        ProjectRevision revision = await context.ProjectRevisions
            .Include(x => x.Placements)
            .SingleOrDefaultAsync(x => x.Id == draft.RevisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("placement.revision", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);
        CatalogCardVersion card = await context.CatalogCardVersions
            .Include(x => x.CatalogCardDefinition)
            .SingleOrDefaultAsync(x => x.Id == draft.CardVersionId, cancellationToken)
            ?? throw new DomainRuleViolationException("placement.card", "Catalog card version was not found.");
        if (card.CatalogCardDefinition is null || !card.CatalogCardDefinition.IsActive)
        {
            throw new DomainRuleViolationException("placement.inactive-card", "An inactive catalog card cannot be placed in a new project tree.");
        }

        ProjectPlacement placement = new()
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revision.Id,
            CatalogCardVersionId = card.Id,
            ParentPlacementId = draft.ParentPlacementId,
            DisplayNameOverride = string.IsNullOrWhiteSpace(draft.DisplayNameOverride) ? null : draft.DisplayNameOverride.Trim(),
            ProcurementScope = string.IsNullOrWhiteSpace(draft.ProcurementScope) ? null : draft.ProcurementScope.Trim()
        };
        if (draft.ParentPlacementId is Guid parentId)
        {
            ProjectPlacement parent = revision.Placements.SingleOrDefault(x => x.Id == parentId)
                ?? throw new DomainRuleViolationException("placement.parent", "Parent placement was not found in this revision.");
            ProjectTreeRules.EnsureParentAllowed(placement, parent, revision.Placements.Append(placement));
            CatalogCardVersion parentCard = await context.CatalogCardVersions
                .Include(x => x.CatalogCardTypeDefinition)
                .SingleAsync(x => x.Id == parent.CatalogCardVersionId, cancellationToken);
            card.CatalogCardTypeDefinition = await context.CatalogCardTypeDefinitions
                .SingleOrDefaultAsync(x => x.Id == card.CatalogCardTypeDefinitionId, cancellationToken);
            ProjectTreeRules.EnsureCardTypeCompatible(card.CardType, parentCard.CardType);
            ProjectTreeRules.EnsureCustomTypeCompatible(card, parentCard);
        }

        context.ProjectPlacements.Add(placement);
        await context.SaveChangesAsync(cancellationToken);
        CatalogCardDefinition definition = card.CatalogCardDefinition
            ?? throw new DomainRuleViolationException("placement.card-definition", "Catalog card definition was not found.");
        string displayName = placement.DisplayNameOverride ?? card.Name;
        return new PlacementListItem(placement.Id, revision.Id, placement.ParentPlacementId, card.Id,
            definition.Code, card.Name, card.Unit, card.InputBehavior, card.CardType, card.PositionNumber, card.ReportBehavior == ReportBehavior.Measurable, displayName,
            placement.DisplayNameOverride, placement.ProcurementScope, placement.Notes,
            card.VariantMode, CatalogVariantCatalog.Parse(card.VariantDefinitionsJson), card.MaterialType);
    }

    public async Task UpdatePlacementAsync(Guid placementId, PlacementUpdateDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        await using MetrajDbContext context = contextFactory();
        ProjectPlacement placement = await context.ProjectPlacements.SingleOrDefaultAsync(x => x.Id == placementId, cancellationToken)
            ?? throw new DomainRuleViolationException("placement.not-found", "Project placement was not found.");
        ProjectRevision revision = await context.ProjectRevisions.SingleAsync(x => x.Id == placement.ProjectRevisionId, cancellationToken);
        ProjectRevisionRules.EnsureDraft(revision);

        placement.DisplayNameOverride = NormalizeOptional(draft.DisplayNameOverride, 256, "placement.display-name");
        placement.ProcurementScope = NormalizeOptional(draft.ProcurementScope, 128, "placement.procurement-scope");
        placement.Notes = NormalizeOptional(draft.Notes, 2_000, "placement.notes");
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task MovePlacementAsync(Guid placementId, Guid? parentPlacementId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        ProjectPlacement placement = await context.ProjectPlacements.SingleOrDefaultAsync(x => x.Id == placementId, cancellationToken)
            ?? throw new DomainRuleViolationException("placement.not-found", "Project placement was not found.");
        ProjectRevision revision = await context.ProjectRevisions
            .Include(x => x.Placements)
            .SingleAsync(x => x.Id == placement.ProjectRevisionId, cancellationToken);
        ProjectRevisionRules.EnsureDraft(revision);

        if (parentPlacementId is Guid targetParentId)
        {
            ProjectPlacement parent = revision.Placements.SingleOrDefault(x => x.Id == targetParentId)
                ?? throw new DomainRuleViolationException("placement.parent", "Parent placement was not found in this revision.");
            ProjectTreeRules.EnsureParentAllowed(placement, parent, revision.Placements);
            CatalogCardVersion childCard = await context.CatalogCardVersions.SingleAsync(x => x.Id == placement.CatalogCardVersionId, cancellationToken);
            CatalogCardVersion parentCard = await context.CatalogCardVersions
                .Include(x => x.CatalogCardTypeDefinition)
                .SingleAsync(x => x.Id == parent.CatalogCardVersionId, cancellationToken);
            childCard.CatalogCardTypeDefinition = await context.CatalogCardTypeDefinitions
                .SingleOrDefaultAsync(x => x.Id == childCard.CatalogCardTypeDefinitionId, cancellationToken);
            ProjectTreeRules.EnsureCardTypeCompatible(childCard.CardType, parentCard.CardType);
            ProjectTreeRules.EnsureCustomTypeCompatible(childCard, parentCard);
        }

        placement.ParentPlacementId = parentPlacementId;
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task AddLinkAsync(Guid sourcePlacementId, Guid targetPlacementId, SemanticLinkType linkType, string? notes = null, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        ProjectPlacement source = await context.ProjectPlacements.SingleOrDefaultAsync(x => x.Id == sourcePlacementId, cancellationToken)
            ?? throw new DomainRuleViolationException("link.source", "Source placement was not found.");
        ProjectPlacement target = await context.ProjectPlacements.SingleOrDefaultAsync(x => x.Id == targetPlacementId, cancellationToken)
            ?? throw new DomainRuleViolationException("link.target", "Target placement was not found.");
        ProjectRevision revision = await context.ProjectRevisions.SingleAsync(x => x.Id == source.ProjectRevisionId, cancellationToken);
        ProjectRevisionRules.EnsureDraft(revision);
        PlacementLink link = new()
        {
            Id = Guid.NewGuid(),
            SourcePlacementId = source.Id,
            TargetPlacementId = target.Id,
            LinkType = linkType,
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim()
        };
        var existing = await context.PlacementLinks.AsNoTracking().ToListAsync(cancellationToken);
        ProjectTreeRules.EnsureLinkAllowed(link, source, target, existing);
        context.PlacementLinks.Add(link);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeletePlacementAsync(Guid placementId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        ProjectPlacement root = await context.ProjectPlacements.SingleOrDefaultAsync(x => x.Id == placementId, cancellationToken)
            ?? throw new DomainRuleViolationException("placement.not-found", "Project placement was not found.");
        ProjectRevision revision = await context.ProjectRevisions.SingleAsync(x => x.Id == root.ProjectRevisionId, cancellationToken);
        ProjectRevisionRules.EnsureDraft(revision);
        var all = await context.ProjectPlacements.Where(x => x.ProjectRevisionId == revision.Id).ToListAsync(cancellationToken);

        // Alt ağacı ebeveyn->çocuk haritası üzerinden tek geçişte topla.
        var childrenByParent = all
            .Where(x => x.ParentPlacementId is not null)
            .GroupBy(x => x.ParentPlacementId!.Value)
            .ToDictionary(group => group.Key, group => group.Select(item => item.Id).ToArray());
        var subtree = new HashSet<Guid> { root.Id };
        var pending = new Stack<Guid>();
        pending.Push(root.Id);
        while (pending.TryPop(out Guid current))
        {
            if (!childrenByParent.TryGetValue(current, out Guid[]? children)) continue;
            foreach (Guid child in children)
            {
                if (subtree.Add(child)) pending.Push(child);
            }
        }

        // Tüm silme adımları TEK işlemde yürür. Önceden her ExecuteDelete kendi
        // başına ve anında çalışıyordu; ortada bir hata olduğunda kullanıcıya
        // "silindi" deniyor ama haritada ölçümleri yok edilmiş boş bir kart
        // kalıyordu ve geri alma yoktu.
        await using Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction =
            await context.Database.BeginTransactionAsync(cancellationToken);

        // Silinen dala dayanan ama dalın DIŞINDA kalan hesap önerileri, artık var
        // olmayan ölçümlere dayanır: bağlantılar silinmeden önce bayat işaretlenir.
        await CalculationFreshness.MarkStaleForPlacementsAsync(context, revision.Id, subtree, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        Guid[] measurementIds = await context.Measurements.Where(x => subtree.Contains(x.ProjectPlacementId)).Select(x => x.Id).ToArrayAsync(cancellationToken);
        await context.ResponsibilityAssignments.Where(x => (x.ProjectPlacementId != null && subtree.Contains(x.ProjectPlacementId.Value)) ||
            (x.MeasurementId != null && measurementIds.Contains(x.MeasurementId.Value))).ExecuteDeleteAsync(cancellationToken);
        await context.CalculationResults.Where(x => subtree.Contains(x.TargetPlacementId)).ExecuteDeleteAsync(cancellationToken);
        await context.PlacementLinks.Where(x => subtree.Contains(x.SourcePlacementId) || subtree.Contains(x.TargetPlacementId)).ExecuteDeleteAsync(cancellationToken);
        await context.Measurements.Where(x => subtree.Contains(x.ProjectPlacementId)).ExecuteDeleteAsync(cancellationToken);

        // Ebeveyn ilişkisi Restrict olduğu için yapraktan köke doğru silinir.
        // Derinlik bir kez hesaplanır; önceki sürüm her turda bütün ağacı tarıyordu.
        var parentById = all.ToDictionary(x => x.Id, x => x.ParentPlacementId);
        foreach (IGrouping<int, Guid> level in subtree
                     .GroupBy(id => DepthOf(id, parentById))
                     .OrderByDescending(group => group.Key))
        {
            Guid[] levelIds = level.ToArray();
            await context.ProjectPlacements.Where(x => levelIds.Contains(x.Id)).ExecuteDeleteAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private static int DepthOf(Guid placementId, Dictionary<Guid, Guid?> parentById)
    {
        int depth = 0;
        Guid? cursor = parentById.GetValueOrDefault(placementId);
        var visited = new HashSet<Guid> { placementId };
        while (cursor is Guid parentId && visited.Add(parentId))
        {
            depth++;
            cursor = parentById.GetValueOrDefault(parentId);
        }

        return depth;
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

    private static PlacementListItem ToListItem(ProjectPlacement placement)
    {
        CatalogCardVersion card = placement.CatalogCardVersion
            ?? throw new DomainRuleViolationException("placement.card", "Placement card version was not loaded.");
        CatalogCardDefinition definition = card.CatalogCardDefinition
            ?? throw new DomainRuleViolationException("placement.card-definition", "Placement card definition was not loaded.");
        return new PlacementListItem(
            placement.Id,
            placement.ProjectRevisionId,
            placement.ParentPlacementId,
            card.Id,
            definition.Code,
            card.Name,
            card.Unit,
            card.InputBehavior,
            card.CardType,
            card.PositionNumber,
            card.ReportBehavior == ReportBehavior.Measurable,
            placement.DisplayNameOverride ?? card.Name,
            placement.DisplayNameOverride,
            placement.ProcurementScope,
            placement.Notes,
            card.VariantMode,
            CatalogVariantCatalog.Parse(card.VariantDefinitionsJson),
            card.MaterialType);
    }
}
