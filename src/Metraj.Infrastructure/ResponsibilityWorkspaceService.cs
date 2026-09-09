using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Persists project-scoped, extensible responsibility configuration.</summary>
public sealed class ResponsibilityWorkspaceService(Func<MetrajDbContext> contextFactory) : IResponsibilityWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory =
        contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));

    /// <inheritdoc />
    public async Task<IReadOnlyList<ResponsibilityDimensionListItem>> ListDimensionsAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return await context.ResponsibilityDimensions.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.Code)
            .Select(x => new ResponsibilityDimensionListItem(x.Id, x.ProjectRevisionId, x.Code, x.Name, x.SortOrder, x.IsActive))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ResponsibilityPartyListItem>> ListPartiesAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return await context.ResponsibilityParties.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .OrderBy(x => x.Code)
            .Select(x => new ResponsibilityPartyListItem(x.Id, x.ProjectRevisionId, x.Code, x.Name))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ResponsibilityAssignmentListItem>> ListAssignmentsAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        List<ResponsibilityDimension> dimensions = await context.ResponsibilityDimensions.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId && x.IsActive)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.Code)
            .ToListAsync(cancellationToken);
        List<ProjectPlacement> placements = await context.ProjectPlacements.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId)
            .Include(x => x.CatalogCardVersion).ThenInclude(x => x!.CatalogCardDefinition)
            .OrderBy(x => x.DisplayNameOverride ?? x.CatalogCardVersion!.Name).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        List<ResponsibilityAssignment> assignments = await context.ResponsibilityAssignments.AsNoTracking()
            .Where(x => x.ProjectRevisionId == revisionId && x.MeasurementId == null && x.ProjectPlacementId != null)
            .Include(x => x.ResponsibilityDimension)
            .Include(x => x.ResponsibilityParty)
            .OrderBy(x => x.ResponsibilityDimension!.SortOrder).ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        // A nearest explicit assignment wins. This lets a system/category-level responsibility
        // cover its entire branch while a material or accessory can deliberately override it.
        var placementsById = placements.ToDictionary(x => x.Id);
        var placementNames = placements.ToDictionary(
            x => x.Id,
            x => x.DisplayNameOverride ?? x.CatalogCardVersion!.Name);
        var directByDimensionAndPlacement = assignments
            .GroupBy(x => (x.ResponsibilityDimensionId, PlacementId: x.ProjectPlacementId!.Value))
            .ToDictionary(x => x.Key, x => x.OrderByDescending(assignment => assignment.Id).First());

        var result = new List<ResponsibilityAssignmentListItem>(dimensions.Count * placements.Count);
        foreach (ResponsibilityDimension dimension in dimensions)
        {
            foreach (ProjectPlacement placement in placements)
            {
                ResponsibilityAssignment? effective = FindNearestAssignment(
                    placement,
                    dimension.Id,
                    placementsById,
                    directByDimensionAndPlacement);
                Guid? sourcePlacementId = effective?.ProjectPlacementId;
                result.Add(new ResponsibilityAssignmentListItem(
                    effective?.Id ?? Guid.Empty,
                    revisionId,
                    dimension.Id,
                    dimension.Name,
                    placement.Id,
                    placementNames[placement.Id],
                    effective?.ResponsibilityPartyId,
                    effective?.ResponsibilityParty?.Name,
                    effective?.State ?? ResponsibilityAssignmentState.Unassigned,
                    effective?.Notes,
                    sourcePlacementId is Guid sourceId && sourceId != placement.Id,
                    sourcePlacementId is Guid sourceNameId && placementNames.TryGetValue(sourceNameId, out string? sourceName)
                        ? sourceName
                        : null));
            }
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<ResponsibilityDimensionListItem> CreateDimensionAsync(Guid revisionId, string code, string name, CancellationToken cancellationToken = default)
    {
        (string normalizedCode, string normalizedName) = NormalizeCodeAndName(code, name, "responsibility.dimension");
        await using MetrajDbContext context = contextFactory();
        await EnsureDraftRevisionAsync(context, revisionId, cancellationToken);

        bool alreadyExists = await context.ResponsibilityDimensions.AnyAsync(
            x => x.ProjectRevisionId == revisionId && x.Code == normalizedCode, cancellationToken);
        if (alreadyExists)
        {
            throw new DomainRuleViolationException("responsibility.dimension-code", "A responsibility dimension with this code already exists.");
        }

        int nextSortOrder = (await context.ResponsibilityDimensions
            .Where(x => x.ProjectRevisionId == revisionId)
            .Select(x => (int?)x.SortOrder)
            .MaxAsync(cancellationToken) ?? -1) + 1;
        var dimension = new ResponsibilityDimension
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revisionId,
            Code = normalizedCode,
            Name = normalizedName,
            SortOrder = nextSortOrder
        };
        context.ResponsibilityDimensions.Add(dimension);
        await context.SaveChangesAsync(cancellationToken);
        return new ResponsibilityDimensionListItem(dimension.Id, revisionId, dimension.Code, dimension.Name, dimension.SortOrder, dimension.IsActive);
    }

    /// <inheritdoc />
    public async Task<ResponsibilityPartyListItem> CreatePartyAsync(Guid revisionId, string code, string name, CancellationToken cancellationToken = default)
    {
        (string normalizedCode, string normalizedName) = NormalizeCodeAndName(code, name, "responsibility.party");
        await using MetrajDbContext context = contextFactory();
        await EnsureDraftRevisionAsync(context, revisionId, cancellationToken);

        bool alreadyExists = await context.ResponsibilityParties.AnyAsync(
            x => x.ProjectRevisionId == revisionId && x.Code == normalizedCode, cancellationToken);
        if (alreadyExists)
        {
            throw new DomainRuleViolationException("responsibility.party-code", "A responsibility party with this code already exists.");
        }

        var party = new ResponsibilityParty
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = revisionId,
            Code = normalizedCode,
            Name = normalizedName
        };
        context.ResponsibilityParties.Add(party);
        await context.SaveChangesAsync(cancellationToken);
        return new ResponsibilityPartyListItem(party.Id, revisionId, party.Code, party.Name);
    }

    /// <inheritdoc />
    public async Task AssignPlacementAsync(
        Guid revisionId,
        Guid dimensionId,
        Guid placementId,
        Guid? partyId,
        ResponsibilityAssignmentState state,
        string? notes = null,
        CancellationToken cancellationToken = default)
    {
        if (state == ResponsibilityAssignmentState.Assigned && partyId is null)
        {
            throw new DomainRuleViolationException("responsibility.party-required", "An assigned responsibility needs a party.");
        }

        // Excluded, optional, and unassigned are scope decisions rather than an ownership claim.
        // Keeping a party on those rows would make responsibility summaries contradictory.
        if (state != ResponsibilityAssignmentState.Assigned)
        {
            partyId = null;
        }

        await using MetrajDbContext context = contextFactory();
        await EnsureDraftRevisionAsync(context, revisionId, cancellationToken);
        bool dimensionExists = await context.ResponsibilityDimensions.AnyAsync(
            x => x.Id == dimensionId && x.ProjectRevisionId == revisionId && x.IsActive, cancellationToken);
        bool placementExists = await context.ProjectPlacements.AnyAsync(
            x => x.Id == placementId && x.ProjectRevisionId == revisionId, cancellationToken);
        bool partyExists = partyId is null || await context.ResponsibilityParties.AnyAsync(
            x => x.Id == partyId && x.ProjectRevisionId == revisionId, cancellationToken);
        if (!dimensionExists || !placementExists || !partyExists)
        {
            throw new DomainRuleViolationException("responsibility.scope", "Dimension, placement, and party must belong to the same project revision.");
        }

        ResponsibilityAssignment? assignment = await context.ResponsibilityAssignments.SingleOrDefaultAsync(
            x => x.ProjectRevisionId == revisionId && x.ResponsibilityDimensionId == dimensionId &&
                 x.ProjectPlacementId == placementId && x.MeasurementId == null,
            cancellationToken);
        if (assignment is null)
        {
            assignment = new ResponsibilityAssignment
            {
                Id = Guid.NewGuid(),
                ProjectRevisionId = revisionId,
                ResponsibilityDimensionId = dimensionId,
                ProjectPlacementId = placementId
            };
            context.ResponsibilityAssignments.Add(assignment);
        }

        assignment.ResponsibilityPartyId = partyId;
        assignment.State = state;
        assignment.Notes = NormalizeOptional(notes, 2_000, "responsibility.notes");
        await context.SaveChangesAsync(cancellationToken);
    }

    private static (string Code, string Name) NormalizeCodeAndName(string code, string name, string rule)
    {
        string normalizedCode = code.Trim().ToUpperInvariant();
        string normalizedName = name.Trim();
        if (normalizedCode.Length is 0 or > 64 || normalizedName.Length is 0 or > 128)
        {
            throw new DomainRuleViolationException(rule, "Code and name must be filled within their supported lengths.");
        }

        return (normalizedCode, normalizedName);
    }

    // Gövde TextRules'ta; kural kodu ve ileti buradan geliyor ki arayüzün
    // dallandığı kod sözleşmesi değişmesin.
    private static string? NormalizeOptional(string? value, int maxLength, string rule) =>
        TextRules.Optional(value, maxLength, rule, $"Value must not exceed {maxLength} characters.");

    private static ResponsibilityAssignment? FindNearestAssignment(
        ProjectPlacement placement,
        Guid dimensionId,
        Dictionary<Guid, ProjectPlacement> placementsById,
        Dictionary<(Guid DimensionId, Guid PlacementId), ResponsibilityAssignment> directAssignments)
    {
        ProjectPlacement? current = placement;
        while (current is not null)
        {
            if (directAssignments.TryGetValue((dimensionId, current.Id), out ResponsibilityAssignment? assignment))
            {
                return assignment;
            }

            current = current.ParentPlacementId is Guid parentId && placementsById.TryGetValue(parentId, out ProjectPlacement? parent)
                ? parent
                : null;
        }

        return null;
    }

    private static async Task EnsureDraftRevisionAsync(MetrajDbContext context, Guid revisionId, CancellationToken cancellationToken)
    {
        ProjectRevision revision = await context.ProjectRevisions.SingleOrDefaultAsync(x => x.Id == revisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("responsibility.revision", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);
    }
}
