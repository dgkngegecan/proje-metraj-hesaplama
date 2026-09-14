using Metraj.Application;

namespace Metraj.Infrastructure;

/// <summary>Filters concrete options without expanding their declared compatibility matrix.</summary>
internal static class CatalogCompatibility
{
    internal static CatalogCardListItem? Filter(CatalogCardListItem card, string? pipeSystem, string? material, IReadOnlySet<string> sizes)
    {
        if (card.SupersededByCode is not null) return null;
        bool managed = card.AttributeValues?.ContainsKey(CatalogFamilyMetadata.SeedRevision) == true;
        string[] cardSystems = (card.AttributeValues?.GetValueOrDefault(CatalogFamilyMetadata.CompatiblePipeSystems) ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        pipeSystem ??= DefaultSystem(material);
        bool SupportsSystem(IReadOnlyList<string>? systems)
        {
            IReadOnlyList<string> declared = systems is { Count: > 0 } ? systems : cardSystems;
            if (declared.Count > 0) return pipeSystem is not null && (declared.Contains("*") || declared.Contains(pipeSystem, StringComparer.OrdinalIgnoreCase));
            if (managed) return false; // Missing seed compatibility is not an assertion of universal compatibility.
            return string.IsNullOrWhiteSpace(card.MaterialType) || string.IsNullOrWhiteSpace(material) ||
                CanonicalMaterial(card.MaterialType) == CanonicalMaterial(material);
        }
        string[] AllowedSizes(IReadOnlyList<string>? declared)
        {
            IEnumerable<string> candidates = declared is { Count: > 0 } ? declared : card.CompatibleDiameters ?? [];
            return (sizes.Count == 0 ? candidates : candidates.Where(sizes.Contains)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }
        if (card.Variants is not { Count: > 0 })
        {
            if (!SupportsSystem(null)) return null;
            string[] allowed = AllowedSizes(card.CompatibleDiameters);
            if (sizes.Count > 0 && card.CompatibleDiameters is { Count: > 0 } && allowed.Length == 0) return null;
            return card with { CompatibleDiameters = allowed };
        }
        var options = new List<CatalogCardVariant>();
        foreach (CatalogCardVariant option in card.Variants)
        {
            if (!SupportsSystem(option.CompatiblePipeSystems)) continue;
            string[] allowed = AllowedSizes(option.CompatibleDiameters);
            bool restricted = option.CompatibleDiameters is { Count: > 0 } || card.CompatibleDiameters is { Count: > 0 };
            if (sizes.Count > 0 && restricted && allowed.Length == 0) continue;
            if (managed && !restricted) continue; // Equipment/model options are not pipe fittings.
            options.Add(option with { CompatibleDiameters = allowed });
        }
        return options.Count == 0 ? null : card with
        {
            Variants = options,
            CompatibleDiameters = options.SelectMany(x => x.CompatibleDiameters ?? []).Distinct(StringComparer.OrdinalIgnoreCase).ToArray()
        };
    }

    internal static string CanonicalMaterial(string material) => material.Trim().ToUpperInvariant() switch
    {
        "PPR" or "PPRC" or "PPR-C" or "PP-R" or "PP-R FITTING" => "PP-R",
        "CARBON STEEL" or "CARBON STEEL FITTING" or "ÇELİK" => "CARBON STEEL",
        "GALVANIZED STEEL" or "GALVANIZED STEEL FITTING" => "GALVANIZED STEEL",
        "COPPER" or "BAKIR" => "COPPER",
        string value => value
    };

    private static string? DefaultSystem(string? material) => material is null ? null : CanonicalMaterial(material) switch
    {
        "PP-R" => "water.ppr",
        "PEX" => "water.pex",
        "PEX-AL-PEX" => "water.multilayer",
        "GALVANIZED STEEL" => "water.galvanized.threaded",
        "CARBON STEEL" => "water.steel",
        "COPPER" => "water.copper",
        "PVC-U" => "drain.pvc",
        _ => null
    };
}
