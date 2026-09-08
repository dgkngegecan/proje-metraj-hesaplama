using System.Text.Json;

namespace Metraj.Domain;

/// <summary>Raised when an aggregate would violate an invariant.</summary>
public sealed class DomainRuleViolationException(string rule, string message) : InvalidOperationException(message)
{
    public string Rule { get; } = rule;
}

public static class QuantityRules
{
    public const int DecimalScale = 6;
    public const decimal MaximumQuantity = 9_223_372_036_854.775807m;

    public static void EnsureValid(decimal value, string fieldName = "quantity")
    {
        if (value < 0m)
        {
            throw new DomainRuleViolationException("quantity.non-negative", $"{fieldName} cannot be negative.");
        }

        if (value > MaximumQuantity)
        {
            throw new DomainRuleViolationException("quantity.range", $"{fieldName} exceeds the supported range.");
        }

        decimal scaled = decimal.Round(value, DecimalScale, MidpointRounding.ToEven);
        if (scaled != value)
        {
            throw new DomainRuleViolationException("quantity.scale", $"{fieldName} supports at most {DecimalScale} decimal places.");
        }
    }

    public static void EnsureWhole(decimal value, string fieldName = "quantity")
    {
        EnsureValid(value, fieldName);
        if (decimal.Truncate(value) != value)
        {
            throw new DomainRuleViolationException("quantity.whole", $"{fieldName} must be a whole number.");
        }
    }
}

/// <summary>Guards the immutable boundary of an approved project revision.</summary>
public static class ProjectRevisionRules
{
    public static void EnsureDraft(ProjectRevision revision)
    {
        ArgumentNullException.ThrowIfNull(revision);
        if (revision.Status != ProjectRevisionStatus.Draft)
        {
            throw new DomainRuleViolationException(
                "revision.read-only",
                $"Project revision '{revision.Code}' is {revision.Status} and cannot be changed. Create a new draft revision first.");
        }
    }
}

public static class ProjectTreeRules
{
    public static void EnsureCardTypeCompatible(CardType childType, CardType parentType)
    {
        bool allowed = parentType switch
        {
            CardType.Category => true,
            CardType.Scope => childType is CardType.Scope or CardType.System or CardType.Material or CardType.Accessory,
            CardType.System => childType is CardType.Material or CardType.Accessory,
            CardType.Material => childType is CardType.Material or CardType.Accessory,
            CardType.Accessory => false,
            _ => false
        };
        if (!allowed)
        {
            throw new DomainRuleViolationException(
                "tree.card-type",
                $"A {childType} card cannot be placed below a {parentType} card.");
        }
    }

    public static void EnsureParentAllowed(ProjectPlacement child, ProjectPlacement parent, IEnumerable<ProjectPlacement> placements)
    {
        ArgumentNullException.ThrowIfNull(child);
        ArgumentNullException.ThrowIfNull(parent);

        if (child.Id == parent.Id)
        {
            throw new DomainRuleViolationException("tree.self-parent", "A placement cannot be its own parent.");
        }

        if (child.ProjectRevisionId != parent.ProjectRevisionId)
        {
            throw new DomainRuleViolationException("tree.cross-revision", "A placement and its parent must belong to the same project revision.");
        }

        var byId = placements.ToDictionary(x => x.Id);
        Guid? cursor = parent.ParentPlacementId;
        while (cursor is Guid ancestorId)
        {
            if (ancestorId == child.Id)
            {
                throw new DomainRuleViolationException("tree.cycle", "The requested parent would create a cycle.");
            }

            cursor = byId.TryGetValue(ancestorId, out ProjectPlacement? ancestor)
                ? ancestor.ParentPlacementId
                : null;
        }
    }

    /// <summary>
    /// Applies the optional global card-type template constraints in addition to
    /// the five stable base card-type rules. An empty list deliberately means
    /// "no extra restriction", so existing cards and projects remain compatible.
    /// </summary>
    public static void EnsureCustomTypeCompatible(CatalogCardVersion child, CatalogCardVersion parent)
    {
        ArgumentNullException.ThrowIfNull(child);
        ArgumentNullException.ThrowIfNull(parent);

        CatalogCardTypeDefinition? childType = child.CatalogCardTypeDefinition;
        if (childType is not null)
        {
            Guid[] allowedParents = ParseIds(childType.AllowedParentCardIdsJson);
            if (allowedParents.Length > 0 && !allowedParents.Contains(parent.CatalogCardDefinitionId))
            {
                throw new DomainRuleViolationException(
                    "tree.custom-parent",
                    $"The parent card is not allowed by custom card type '{childType.Name}'.");
            }
        }

        CatalogCardTypeDefinition? parentType = parent.CatalogCardTypeDefinition;
        if (parentType is not null)
        {
            Guid[] allowedChildren = ParseIds(parentType.AllowedChildCardIdsJson);
            if (allowedChildren.Length > 0 && !allowedChildren.Contains(child.CatalogCardDefinitionId))
            {
                throw new DomainRuleViolationException(
                    "tree.custom-child",
                    $"The child card is not allowed by custom card type '{parentType.Name}'.");
            }
        }
    }

    public static void EnsureLinkAllowed(PlacementLink link, ProjectPlacement source, ProjectPlacement target, IEnumerable<PlacementLink> existingLinks)
    {
        ArgumentNullException.ThrowIfNull(link);
        if (source.Id == target.Id)
        {
            throw new DomainRuleViolationException("link.self", "A placement cannot link to itself.");
        }

        if (source.ProjectRevisionId != target.ProjectRevisionId)
        {
            throw new DomainRuleViolationException("link.cross-revision", "Linked placements must belong to the same project revision.");
        }

        if (existingLinks.Any(x => x.Id != link.Id && x.SourcePlacementId == link.SourcePlacementId &&
                                  x.TargetPlacementId == link.TargetPlacementId && x.LinkType == link.LinkType))
        {
            throw new DomainRuleViolationException("link.duplicate", "The same semantic link already exists.");
        }

        if (link.LinkType != SemanticLinkType.CalculatedFrom)
        {
            return;
        }

        // Calculated-from is a directed dependency: source placement -> derived target.
        // Adding A -> B is invalid when B already reaches A through dependencies.
        var targetsBySource = existingLinks
            .Where(x => x.Id != link.Id && x.LinkType == SemanticLinkType.CalculatedFrom)
            .GroupBy(x => x.SourcePlacementId)
            .ToDictionary(x => x.Key, x => x.Select(link => link.TargetPlacementId).ToArray());
        var pending = new Stack<Guid>();
        var visited = new HashSet<Guid>();
        pending.Push(link.TargetPlacementId);
        while (pending.TryPop(out Guid current))
        {
            if (!visited.Add(current))
            {
                continue;
            }

            if (current == link.SourcePlacementId)
            {
                throw new DomainRuleViolationException("link.calculated-from-cycle", "Calculated-from links cannot form a dependency cycle.");
            }

            if (targetsBySource.TryGetValue(current, out Guid[]? next))
            {
                foreach (Guid targetId in next)
                {
                    pending.Push(targetId);
                }
            }
        }
    }

    private static Guid[] ParseIds(string json)
    {
        try
        {
            return (JsonSerializer.Deserialize<Guid[]>(json) ?? [])
                .Distinct()
                .ToArray();
        }
        catch (JsonException)
        {
            // A malformed optional template should not make an otherwise valid
            // legacy tree uneditable; the template service never writes malformed JSON.
            return [];
        }
    }
}
