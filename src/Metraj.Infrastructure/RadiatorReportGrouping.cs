using System.Globalization;
using System.Text.RegularExpressions;
using Metraj.Application;
using Metraj.Domain;

namespace Metraj.Infrastructure;

internal static class RadiatorReportGrouping
{
    public static IReadOnlyList<ReportRadiatorSummaryItem> Build(
        IReadOnlyList<MeasurementSummaryItem> summaries, IReadOnlyList<PlacementListItem> placements)
    {
        var byId = placements.ToDictionary(x => x.Id);
        var rows = new List<ReportRadiatorSummaryItem>();
        foreach (var summary in summaries)
        {
            if (!byId.TryGetValue(summary.PlacementId, out var placement) || !IsRadiator(placement)) continue;
            var size = ParseCatalog(summary.SecondaryVariant) ?? ParseCatalog(summary.Variant) ?? ParseSize(summary.Variant, summary.SecondaryVariant);
            if (size is null) continue;
            var (type, height, length) = size.Value;
            var canonical = CanonicalType(type);
            bool sectional = length is null && (type is "Döküm" or "Alüminyum" ||
                Regex.IsMatch(placement.CardCode + " " + placement.CardName, "DILIM|dilim|sectional", RegexOptions.IgnoreCase));
            string unit = sectional ? "dilim" : summary.Unit;
            string purchaseUnit = summary.PurchaseUnit is null || summary.PurchaseUnit == summary.Unit ? unit : summary.PurchaseUnit;
            rows.Add(new(canonical.Type, canonical.Label, height, length, unit, summary.NetQuantity,
                summary.WithWasteQuantity, summary.PurchaseQuantity, purchaseUnit, [summary.PlacementId]));
        }

        return rows.GroupBy(x => new { x.Type, x.TypeLabel, x.HeightMm, x.LengthMm, x.Unit, x.PurchaseUnit })
            .Select(g => new ReportRadiatorSummaryItem(g.Key.Type, g.Key.TypeLabel, g.Key.HeightMm, g.Key.LengthMm,
                g.Key.Unit, g.Sum(x => x.NetQuantity), g.Sum(x => x.WithWasteQuantity), g.Sum(x => x.PurchaseQuantity),
                g.Key.PurchaseUnit, g.SelectMany(x => x.PlacementIds).Distinct().Order().ToArray()))
            .OrderBy(x => TypeOrder(x.Type)).ThenBy(x => x.Type, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.HeightMm).ThenBy(x => x.LengthMm).ThenBy(x => x.Unit, StringComparer.Ordinal)
            .ThenBy(x => x.PurchaseUnit, StringComparer.Ordinal).ToList();
    }

    private static bool IsRadiator(PlacementListItem placement)
    {
        if (placement.CardType != CardType.Material || !placement.IsMeasurable || placement.VariantMode == CatalogVariantMode.Pipe) return false;
        string name = placement.CardCode + " " + placement.CardName + " " + placement.DisplayName;
        if (Regex.IsMatch(name, "vana|valve|purj[öo]r|konsol|ask[ıi]|aksesuar|tapa|rakor|bracket|trv", RegexOptions.IgnoreCase)) return false;
        return Regex.IsMatch(placement.MaterialType ?? "", "radiator|radyat[öo]r", RegexOptions.IgnoreCase) ||
            Regex.IsMatch(placement.CardCode, "(^|-)(RAD|RADYATOR|RADIATOR|HAVLUPAN|PETEK)(-|$)", RegexOptions.IgnoreCase) ||
            Regex.IsMatch(name, "radiator|radyat[öo]r|petek|havlupan", RegexOptions.IgnoreCase);
    }

    private static (string Type, decimal Height, decimal? Length)? ParseCatalog(string? value)
    {
        var panel = Regex.Match(value ?? "", @"^T(\d+)-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$", RegexOptions.IgnoreCase);
        if (panel.Success && Dimension(panel.Groups[2].Value) is decimal height && Dimension(panel.Groups[3].Value) is decimal length)
            return ($"Tip {panel.Groups[1].Value}", height, length);
        var towel = Regex.Match(value ?? "", @"^HP-(ELEKTRIKLI-)?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$", RegexOptions.IgnoreCase);
        if (towel.Success && Dimension(towel.Groups[3].Value) is decimal towelHeight && Dimension(towel.Groups[2].Value) is decimal towelLength)
            return (towel.Groups[1].Success ? "Elektrikli havlupan" : "Havlupan", towelHeight, towelLength);
        var sectional = Regex.Match(value ?? "", @"^(DR|ALU)-(\d+(?:\.\d+)?)$", RegexOptions.IgnoreCase);
        if (sectional.Success && Dimension(sectional.Groups[2].Value) is decimal sectionHeight)
            return (sectional.Groups[1].Value.Equals("DR", StringComparison.OrdinalIgnoreCase) ? "Döküm" : "Alüminyum", sectionHeight, null);
        return null;
    }

    private static (string Type, decimal Height, decimal? Length)? ParseSize(string? variant, string? secondary)
    {
        var primary = Regex.Match(variant ?? "", @"^(?:(.+) · )?H(\d+(?:[.,]\d+)?)$", RegexOptions.IgnoreCase);
        if (!primary.Success || Dimension(primary.Groups[2].Value) is not decimal height) return null;
        var width = Regex.Match(secondary ?? "", @"^[WL](\d+(?:[.,]\d+)?)$", RegexOptions.IgnoreCase);
        if (!string.IsNullOrWhiteSpace(secondary) && !width.Success) return null;
        decimal? length = width.Success ? Dimension(width.Groups[1].Value) : null;
        if (width.Success && length is null) return null;
        return (primary.Groups[1].Success ? primary.Groups[1].Value.Trim() : "Panel", height, length);
    }

    private static decimal? Dimension(string value) =>
        decimal.TryParse(value.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out decimal number)
        && number > 0 && number <= 100000 ? number : null;

    private static (string Type, string Label) CanonicalType(string type) => Regex.Replace(type.Trim().ToUpperInvariant(), @"\s+", "") switch
    {
        "P" or "T10" or "TIP10" or "TİP10" => ("Tip 10", "P · Tip 10"),
        "PK" or "T11" or "TIP11" or "TİP11" => ("Tip 11", "PK · Tip 11"),
        "PKP" or "T21" or "TIP21" or "TİP21" => ("Tip 21", "PKP · Tip 21"),
        "PKKP" or "T22" or "TIP22" or "TİP22" => ("Tip 22", "PKKP · Tip 22"),
        "PKKPKP" or "DKEK" or "T33" or "TIP33" or "TİP33" => ("Tip 33", "PKKPKP · Tip 33"),
        _ => (type.Trim(), type.Trim())
    };

    private static int TypeOrder(string type) => int.TryParse(type.Replace("Tip ", ""), out int value) ? value : int.MaxValue;
}
