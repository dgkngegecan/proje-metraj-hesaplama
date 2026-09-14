using Metraj.Application;

namespace Metraj.Infrastructure;

public sealed partial class StarterCatalogWorkspaceService
{
    // Explicit supplier ranges, checked 2026-09-13. The matrix is not a pressure × diameter cross product.
    // Kalde PN10: https://kalde.com/tr/urunler/pp-r-sistemler/pp-boru-pn-10
    // Kalde PN16: https://kalde.com/en/Belgeler/catalogs/67
    // Fırat PN20/25: https://www.firat.com/pprc-boru-fiyatlari-borular
    // Composite: https://www.firat.com/cmsfiles/certificates/firatboru-genel-urun-katalogu.pdf?v=100
    private static CatalogCardDraft ResearchPipeProfiles(CatalogCardDraft draft)
    {
        bool plain = draft.Code == "STDF-SU-PPRC-BORU-AILE";
        bool fiber = draft.Code == "STDF-SU-PPRC-BORU-FIBER";
        if (!plain && !fiber) return draft;
        string source = plain ? "STDX-SU-PPRC-BORU-AILE" : "STDX-SU-PPRC-BORU-FIBER";
        string name = plain ? "PP-R Boru" : "PP-R Cam Elyaf Takviyeli Boru";
        var options = new List<CatalogCardVariantDraft>();
        foreach ((string pressure, int[] sizes) in new (string, int[])[]
        {
            ("PN20", [20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160]),
            ("PN25", [20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160]),
            ("PN10", plain ? [20, 25, 32, 40, 50, 63, 75, 90, 110, 125] : []),
            ("PN16", plain ? [20, 25, 32, 40, 50, 63, 75, 90, 110] : [])
        })
        foreach (int size in sizes)
        {
            string diameter = $"DN{size}";
            options.Add(new(pressure == "PN20" ? diameter : $"{pressure}-{diameter}", $"Ø{size} mm · {pressure}", 4m,
                SourceCardCode: source, SourceVariantCode: diameter, SourceCardName: $"{name} · {pressure}",
                SourceNotes: CatalogProductText.CleanNotes(source, null), MaterialType: "PP-R"));
        }
        return draft with
        {
            Name = $"{name} · {(plain ? "PN10–25" : "PN20–25")} · Ø20–160 mm",
            Notes = CatalogProductText.CleanNotes(source, null),
            Variants = options
        };
    }
}
