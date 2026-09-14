using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Metraj.Application;
using Metraj.Domain;

namespace Metraj.Infrastructure;

public sealed partial class StarterCatalogWorkspaceService
{
    private const string FamilyRevision = "families-1";
    private sealed record Mapping(string Source, string Family, string PipeSystem, string CompatibleSystems, string Material, string SingleOption);
    private sealed record ConsolidationPlan(
        IReadOnlyDictionary<string, CatalogCardDraft> Legacy,
        IReadOnlyDictionary<string, Mapping> Mappings,
        IReadOnlyList<CatalogCardDraft> Targets);

    private static readonly Lazy<ConsolidationPlan> Consolidation = new(BuildConsolidation);

    public static IReadOnlyList<CatalogSeedAuditItem> Audit => Consolidation.Value.Mappings.Values
        .Select(x => new CatalogSeedAuditItem(x.Source, NullIfEmpty(x.Family),
            x.SingleOption.StartsWith("alias", StringComparison.Ordinal) ? "alias" : x.Family.Length > 0 ? "family" : "retain-distinct-card"))
        .ToArray();

    private static CatalogCardDraft LegacyDraft(StarterCard card) => new(
        card.Code, card.Name, card.CardType, card.ItemKind, InputBehavior.Manual,
        card.SalesConversion, card.ReportBehavior, card.Unit, card.WasteRatePct, card.ContainerParameter,
        Notes: card.Notes, MaterialType: card.MaterialType, CompatibleDiameters: card.CompatibleDiameters,
        VariantMode: card.VariantMode, Variants: card.Variants);

    private static ConsolidationPlan BuildConsolidation()
    {
        var legacy = Cards.Select(LegacyDraft).ToDictionary(x => x.Code, StringComparer.Ordinal);
        var mappings = ConsolidationManifest.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim().Split('|'))
            .Select(x => new Mapping(x[0], x[1], x[2], x[3], x[4], x[5]))
            .ToDictionary(x => x.Source, StringComparer.Ordinal);
        if (!legacy.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(mappings.Keys))
            throw new InvalidOperationException("Every starter source must have exactly one reviewed consolidation mapping.");

        var targets = mappings.Values.Where(x => x.Family.Length == 0).Select(x => legacy[x.Source]).ToList();
        foreach (IGrouping<string, Mapping> family in mappings.Values.Where(x => x.Family.Length > 0).GroupBy(x => x.Family))
        {
            Mapping[] members = family.Where(x => !x.SingleOption.StartsWith("alias", StringComparison.Ordinal)).ToArray();
            if (members.Length == 0) throw new InvalidOperationException($"Family {family.Key} has no concrete options.");
            CatalogCardDraft first = legacy[members[0].Source];
            // A family cannot silently change quantity accounting for any source option.
            if (members.Select(x => legacy[x.Source]).Any(x => x.Unit != first.Unit || x.CardType != first.CardType ||
                x.ItemKind != first.ItemKind || x.SalesConversion != first.SalesConversion ||
                x.ReportBehavior != first.ReportBehavior || x.WasteRatePct != first.WasteRatePct || x.ContainerParameter != first.ContainerParameter))
                throw new InvalidOperationException($"Family {family.Key} mixes incompatible accounting policies.");

            bool pipe = members.All(x => legacy[x.Source].VariantMode == CatalogVariantMode.Pipe || (x.PipeSystem.Length > 0 && x.SingleOption.Length > 0));
            var options = new List<CatalogCardVariantDraft>();
            foreach (Mapping member in members)
            {
                CatalogCardDraft source = legacy[member.Source];
                IReadOnlyList<CatalogCardVariantDraft> sourceOptions = source.Variants is { Count: > 0 } ? source.Variants :
                    [new(member.SingleOption.Length > 0 ? member.SingleOption : source.Code, source.Name,
                        pipe ? source.ContainerParameter : null, source.CompatibleDiameters)];
                foreach (CatalogCardVariantDraft option in sourceOptions)
                {
                    string code = members.Length == 1 || pipe ? option.Code : StableOptionCode(source.Code, option.Code);
                    string label = members.Length == 1 || source.Variants is not { Count: > 0 }
                        ? option.Label : $"{source.Name.Split(" / ", StringSplitOptions.None)[0]} · {option.Label}";
                    string[] diameters = (option.CompatibleDiameters ?? source.CompatibleDiameters ?? []).ToArray();
                    string[] systems = OptionSystems(member, option.Code);
                    options.Add(new(code, label, option.StandardLength, diameters,
                        source.Code, source.Variants is { Count: > 0 } ? option.Code : null,
                        source.Name, source.Notes, source.MaterialType ?? NullIfEmpty(member.Material), systems));
                }
            }
            if (options.Select(x => x.Code).Distinct(StringComparer.OrdinalIgnoreCase).Count() != options.Count)
                throw new InvalidOperationException($"Family {family.Key} has duplicate option codes; explicitly map them before publishing.");

            string[] pipeSystems = members.Select(x => x.PipeSystem).Where(x => x.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
            if (pipeSystems.Length > 1) throw new InvalidOperationException($"Family {family.Key} mixes different pipe systems.");
            var attributes = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [CatalogFamilyMetadata.FamilyCode] = family.Key,
                [CatalogFamilyMetadata.SeedRevision] = FamilyRevision,
                [CatalogFamilyMetadata.SourceCards] = JsonSerializer.Serialize(family.Select(x => legacy[x.Source]).Select(x => new
                { x.Code, x.Name, x.Notes, x.MaterialType, x.Unit, x.WasteRatePct, x.ContainerParameter }))
            };
            if (pipeSystems.Length > 0) attributes[CatalogFamilyMetadata.PipeSystem] = pipeSystems[0];
            string compatible = string.Join(',', options.SelectMany(x => x.CompatiblePipeSystems ?? []).Distinct(StringComparer.Ordinal));
            if (compatible.Length > 0) attributes[CatalogFamilyMetadata.CompatiblePipeSystems] = compatible;
            string[] materials = members.Select(x => NullIfEmpty(x.Material) ?? legacy[x.Source].MaterialType)
                .OfType<string>().Distinct(StringComparer.Ordinal).ToArray();
            targets.Add(first with
            {
                Code = family.Key,
                Name = FamilyNames.GetValueOrDefault(family.Key) ?? first.Name,
                Notes = members.Length == 1 ? first.Notes : string.Join(' ', members.Select(member => CatalogProductText.CleanNotes(member.Source, legacy[member.Source].Notes)).Distinct()),
                MaterialType = materials.Length == 1 ? materials[0] : first.MaterialType,
                CompatibleDiameters = options.SelectMany(x => x.CompatibleDiameters ?? []).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
                VariantMode = pipe ? CatalogVariantMode.Pipe : CatalogVariantMode.Fitting,
                Variants = options,
                AttributeValues = attributes
            });
        }
        return new(legacy, mappings, targets.Select(ResearchPipeProfiles).OrderBy(x => x.Code, StringComparer.Ordinal).ToArray());
    }

    private static string StableOptionCode(string source, string option) =>
        "OPT-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source + "\n" + option)))[..32];

    // Exact option mappings for sources containing both threaded and welded gas fittings.
    // These lists are from the present dataset, not a generated diameter cross product.
    private static string[] OptionSystems(Mapping member, string optionCode)
    {
        if (member.Source is "STDX-GAZ-CELIK-DIRSEK-DG" or "STDX-GAZ-CELIK-TE-DG")
            return optionCode switch
            {
                "DN15" or "DN20" or "DN25" or "DN32" or "DN40" or "DN50" or "DN25-45" or "DN50-45" => ["gas.steel.threaded"],
                "DN65" or "DN80" or "DN100" or "DN150" or "DN200" or "DN100-45" => ["gas.steel.welded"],
                _ => throw new InvalidOperationException($"Unreviewed gas fitting option {member.Source}/{optionCode}.")
            };
        if (member.Source == "STDX-GAZ-CELIK-REDUKSIYON-DG")
            return optionCode switch
            {
                "DN20-15" or "DN25-20" or "DN32-25" or "DN40-32" or "DN50-40" => ["gas.steel.threaded"],
                "DN65-50" or "DN80-65" or "DN100-80" or "DN150-100" or "DN200-150" => ["gas.steel.welded"],
                _ => throw new InvalidOperationException($"Unreviewed gas reducer option {optionCode}.")
            };
        return member.CompatibleSystems.Split(',', StringSplitOptions.RemoveEmptyEntries);
    }

    internal static bool IsManagedFamily(CatalogCardDefinition definition) => definition.Versions.Any(version =>
        version.VersionNumber == 1 && JsonStore.Read(version.AttributeValuesJson, new Dictionary<string, string>())
            .GetValueOrDefault(CatalogFamilyMetadata.SeedRevision) == FamilyRevision &&
        JsonStore.Read(version.AttributeValuesJson, new Dictionary<string, string>())
            .GetValueOrDefault(CatalogFamilyMetadata.FamilyCode) == definition.Code);

    internal static string? SupersededBy(CatalogCardDefinition definition, CatalogCardVersion version, int versionCount)
    {
        if (versionCount != 1 || !IsOriginal(definition, version)) return null;
        return Consolidation.Value.Mappings.TryGetValue(definition.Code, out Mapping? mapping) ? NullIfEmpty(mapping.Family) : null;
    }

    internal static bool IsOriginal(CatalogCardDefinition definition, CatalogCardVersion version)
    {
        if (!Consolidation.Value.Legacy.TryGetValue(definition.Code, out CatalogCardDraft? draft)) return false;
        // Comparing the complete normalized snapshot also handles older content-hash implementations.
        // Code-prefix ownership alone is never enough to suppress a user card.
        return version.VersionNumber == 1 && version.CatalogCardTypeDefinitionId is null &&
            definition.Name == draft.Name && definition.Description == draft.Notes && version.Name == draft.Name &&
            version.CardType == draft.CardType && version.ItemKind == draft.ItemKind && version.Unit == draft.Unit &&
            version.InputBehavior == draft.InputBehavior && version.SalesConversion == draft.SalesConversion &&
            version.ReportBehavior == draft.ReportBehavior && version.WasteRatePct == draft.WasteRatePct &&
            version.ContainerParameter == draft.ContainerParameter && version.PositionNumber == draft.PositionNumber &&
            version.ColorCode is null && version.PatternCode is null && version.IsPublished &&
            version.MaterialType == draft.MaterialType && version.VariantMode == draft.VariantMode &&
            JsonStore.Read(version.AttributeValuesJson, new Dictionary<string, string>()).Count == 0 &&
            JsonStore.Read(version.CompatibleDiametersJson, Array.Empty<string>()).ToHashSet(StringComparer.OrdinalIgnoreCase)
                .SetEquals(draft.CompatibleDiameters ?? []) &&
            CatalogVariantCatalog.Serialize(CatalogVariantCatalog.Parse(version.VariantDefinitionsJson)) ==
            CatalogVariantCatalog.Serialize(CatalogVariantCatalog.Normalize(draft.Variants));
    }

    public static string? ResolvePipeSystem(CatalogCardVersion version, string definitionCode) =>
        ParentProfile(new CatalogCardDefinition { Code = definitionCode }, version).System;

    internal static (string? System, string? Material) ParentProfile(CatalogCardDefinition definition, CatalogCardVersion version)
    {
        var attributes = JsonStore.Read(version.AttributeValuesJson, new Dictionary<string, string>());
        if (attributes.TryGetValue(CatalogFamilyMetadata.PipeSystem, out string? system))
        {
            string? expectedMaterial = Consolidation.Value.Mappings.Values.FirstOrDefault(x => x.PipeSystem == system)?.Material;
            if (expectedMaterial is not null && (version.MaterialType is null ||
                CatalogCompatibility.CanonicalMaterial(expectedMaterial) != CatalogCompatibility.CanonicalMaterial(version.MaterialType)))
                return (null, version.MaterialType);
            return (system, version.MaterialType);
        }
        // Use the placed immutable version, not the definition's newest edited version.
        if (Consolidation.Value.Legacy.TryGetValue(definition.Code, out CatalogCardDraft? legacy) &&
            IsOriginal(new CatalogCardDefinition { Code = definition.Code, Name = legacy.Name, Description = legacy.Notes }, version))
        {
            Mapping mapping = Consolidation.Value.Mappings[definition.Code];
            return (NullIfEmpty(mapping.PipeSystem), NullIfEmpty(mapping.Material) ?? version.MaterialType);
        }
        return (null, version.MaterialType);
    }

    internal static IReadOnlyList<string> ParentSizes(CatalogCardDefinition definition, CatalogCardVersion version)
    {
        IReadOnlyList<CatalogCardVariant> variants = CatalogVariantCatalog.Parse(version.VariantDefinitionsJson);
        if (variants.Count > 0) return variants.Select(x => x.Code).ToArray();
        if (Consolidation.Value.Mappings.TryGetValue(definition.Code, out Mapping? entry))
        {
            if (entry.PipeSystem.Length > 0 && entry.SingleOption.Length > 0 && !entry.SingleOption.StartsWith("alias", StringComparison.Ordinal)) return [entry.SingleOption];
            if (entry.SingleOption.StartsWith("alias:DN", StringComparison.Ordinal)) return [entry.SingleOption[6..]];
        }
        return [];
    }

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;
}
