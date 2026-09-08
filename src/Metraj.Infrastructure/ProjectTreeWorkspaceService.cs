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
            card.VariantMode, CatalogVariantCatalog.Parse(card.VariantDefinitionsJson));
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
        var subtree = new HashSet<Guid> { root.Id };
        bool changed;
        do
        {
            changed = false;
            foreach (ProjectPlacement item in all.Where(x => x.ParentPlacementId is Guid parent && subtree.Contains(parent)))
                changed |= subtree.Add(item.Id);
        } while (changed);

        Guid[] measurementIds = await context.Measurements.Where(x => subtree.Contains(x.ProjectPlacementId)).Select(x => x.Id).ToArrayAsync(cancellationToken);
        await context.ResponsibilityAssignments.Where(x => (x.ProjectPlacementId != null && subtree.Contains(x.ProjectPlacementId.Value)) ||
            (x.MeasurementId != null && measurementIds.Contains(x.MeasurementId.Value))).ExecuteDeleteAsync(cancellationToken);
        await context.CalculationResults.Where(x => subtree.Contains(x.TargetPlacementId)).ExecuteDeleteAsync(cancellationToken);
        await context.PlacementLinks.Where(x => subtree.Contains(x.SourcePlacementId) || subtree.Contains(x.TargetPlacementId)).ExecuteDeleteAsync(cancellationToken);
        await context.Measurements.Where(x => subtree.Contains(x.ProjectPlacementId)).ExecuteDeleteAsync(cancellationToken);
        int maxDepth = all.Count;
        for (int depth = maxDepth; depth >= 0; depth--)
        {
            Guid[] leafIds = all.Where(x => subtree.Contains(x.Id) && !all.Any(child => subtree.Contains(child.Id) && child.ParentPlacementId == x.Id))
                .Select(x => x.Id).ToArray();
            if (leafIds.Length == 0) break;
            await context.ProjectPlacements.Where(x => leafIds.Contains(x.Id)).ExecuteDeleteAsync(cancellationToken);
            all.RemoveAll(x => leafIds.Contains(x.Id));
        }
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
            CatalogVariantCatalog.Parse(card.VariantDefinitionsJson));
    }
}
