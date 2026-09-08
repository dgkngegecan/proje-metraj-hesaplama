using System.Text.Json;
using Metraj.Domain;

namespace Metraj.Application;

/// <summary>Safe serialization helpers for catalog size/fitting variants.</summary>
public static class CatalogVariantCatalog
{
    public static IReadOnlyList<CatalogCardVariant> Normalize(IEnumerable<CatalogCardVariantDraft>? variants)
    {
        var result = new List<CatalogCardVariant>();
        foreach (CatalogCardVariantDraft? source in variants ?? [])
        {
            if (source is null) continue;
            string code = NormalizeText(source.Code, 64);
            string label = NormalizeText(source.Label, 128);
            decimal? standardLength = source.StandardLength is decimal length && length > 0m
                ? decimal.Round(length, QuantityRules.DecimalScale, MidpointRounding.ToEven)
                : null;
            string[] compatible = NormalizeDiameters(source.CompatibleDiameters);
            if (result.Any(item => item.Code.Equals(code, StringComparison.OrdinalIgnoreCase))) continue;
            result.Add(new CatalogCardVariant(code, label, standardLength, compatible));
        }
        return result;
    }

    public static IReadOnlyList<CatalogCardVariant> Normalize(IEnumerable<CatalogCardVariant>? variants)
    {
        return Normalize((variants ?? []).Select(item => new CatalogCardVariantDraft(item.Code, item.Label, item.StandardLength, item.CompatibleDiameters)));
    }

    public static IReadOnlyList<CatalogCardVariant> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            CatalogCardVariant[]? values = JsonSerializer.Deserialize<CatalogCardVariant[]>(json);
            return Normalize(values);
        }
        catch (Exception exception) when (exception is JsonException or DomainRuleViolationException)
        {
            return [];
        }
    }

    public static string Serialize(IEnumerable<CatalogCardVariant>? variants) =>
        JsonSerializer.Serialize(Normalize(variants));

    private static string NormalizeText(string? value, int maximumLength)
    {
        string text = value?.Trim() ?? string.Empty;
        if (text.Length == 0 || text.Length > maximumLength)
        {
            throw new DomainRuleViolationException("catalog.variant.text", $"Variant text must be filled within {maximumLength} characters.");
        }
        return text;
    }

    private static string[] NormalizeDiameters(IEnumerable<string>? values)
    {
        return (values ?? [])
            .Select(item => item?.Trim() ?? string.Empty)
            .Where(item => item.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(32)
            .ToArray();
    }
}
