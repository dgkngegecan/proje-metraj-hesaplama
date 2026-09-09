using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>
/// Idempotent starter vocabulary for common Turkish field terms and their global equivalents.
/// The pack is deliberately a catalog only: it creates no projects or placements.
/// </summary>
public sealed class StarterCatalogWorkspaceService(Func<MetrajDbContext> contextFactory) : IStarterCatalogWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory =
        contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));

    public async Task<StarterCatalogSeedResult> SeedAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        var existing = (await context.CatalogCardDefinitions.AsNoTracking()
                .Select(card => card.Code).ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var added = new List<string>();
        // Servis döngünün dışında bir kez kuruluyor: içeride kurulduğunda ~60
        // kart için ~60 örnek yaratılıyordu.
        var catalog = new CatalogWorkspaceService(contextFactory);
        foreach (StarterCard card in Cards)
        {
            if (!existing.Add(card.Code))
            {
                continue;
            }

            await catalog.CreateCardAsync(new CatalogCardDraft(
                card.Code,
                card.Name,
                card.CardType,
                card.ItemKind,
                InputBehavior.Manual,
                card.SalesConversion,
                card.ReportBehavior,
                card.Unit,
                card.WasteRatePct,
                card.ContainerParameter,
                null,
                card.Notes,
                card.MaterialType,
                card.CompatibleDiameters,
                VariantMode: card.VariantMode,
                Variants: card.Variants), cancellationToken);
            added.Add(card.Code);
        }

        return new StarterCatalogSeedResult(added.Count, Cards.Count - added.Count, added);
    }

    private sealed record StarterCard(
        string Code,
        string Name,
        CardType CardType,
        ItemKind ItemKind,
        string Unit,
        ReportBehavior ReportBehavior,
        SalesConversion SalesConversion = SalesConversion.None,
        decimal? ContainerParameter = null,
        decimal WasteRatePct = 0m,
        string? Notes = null,
        string? MaterialType = null,
        IReadOnlyList<string>? CompatibleDiameters = null,
        CatalogVariantMode VariantMode = CatalogVariantMode.None,
        IReadOnlyList<CatalogCardVariantDraft>? Variants = null);

    private static readonly IReadOnlyList<CatalogCardVariantDraft> SteelPipeVariants =
    [
        new("DN15", "DN15 / 1/2\"", 6m), new("DN20", "DN20 / 3/4\"", 6m),
        new("DN25", "DN25 / 1\"", 6m), new("DN32", "DN32 / 1 1/4\"", 6m),
        new("DN40", "DN40 / 1 1/2\"", 6m), new("DN50", "DN50 / 2\"", 6m),
        new("DN65", "DN65 / 2 1/2\"", 6m), new("DN80", "DN80 / 3\"", 6m),
        new("DN100", "DN100 / 4\"", 6m), new("DN125", "DN125 / 5\"", 6m),
        new("DN150", "DN150 / 6\"", 6m)
    ];

    private static readonly IReadOnlyList<CatalogCardVariantDraft> PprcPipeVariants =
    [
        new("DN16", "DN16 / 1/2\"", 4m), new("DN20", "DN20 / 1/2\"", 4m),
        new("DN25", "DN25 / 3/4\"", 4m), new("DN32", "DN32 / 1\"", 4m),
        new("DN40", "DN40 / 1 1/4\"", 4m), new("DN50", "DN50 / 1 1/2\"", 4m),
        new("DN63", "DN63 / 2\"", 4m), new("DN75", "DN75 / 2 1/2\"", 4m),
        new("DN90", "DN90 / 3\"", 4m), new("DN110", "DN110 / 4\"", 4m)
    ];

    private static IReadOnlyList<CatalogCardVariantDraft> FittingVariants(IReadOnlyList<string> diameters) =>
    [
        new("ELBOW-90", "90° Dirsek", CompatibleDiameters: diameters),
        new("ELBOW-45", "45° Dirsek", CompatibleDiameters: diameters),
        new("TEE", "Te", CompatibleDiameters: diameters),
        new("REDUCER", "Redüksiyon", CompatibleDiameters: diameters),
        new("UNION", "Rakor", CompatibleDiameters: diameters),
        new("NIPPLE", "Muşon", CompatibleDiameters: diameters),
        new("VALVE", "Vana", CompatibleDiameters: diameters),
        new("FLANGE", "Flanş", CompatibleDiameters: diameters)
    ];

    private static readonly IReadOnlyList<StarterCard> Cards =
    [
        // Ana gruplar
        new("STD-CAT-MEK", "Mekanik Tesisat / Mechanical Services", CardType.Category, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR: Mekanik tesisat ana grubu · EN: Mechanical building services"),
        new("STD-CAT-PLB", "Sıhhi Tesisat / Plumbing", CardType.Category, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR: Temiz su, sıcak su ve drenaj · EN: Plumbing and sanitary services"),
        new("STD-CAT-HVAC", "HVAC / İklimlendirme", CardType.Category, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN: Heating, ventilation and air conditioning"),
        new("STD-CAT-FIRE", "Yangın Tesisatı / Fire Protection", CardType.Category, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR: Yangın söndürme ve sprinkler · EN: Fire protection systems"),

        // İş paketleri / scopes
        new("STD-SCP-CW", "Temiz Su / Domestic Cold Water", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Temiz su · EN: DCW / Potable cold water"),
        new("STD-SCP-DHW", "Sıcak Kullanım Suyu / Domestic Hot Water", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Sıcak su · EN: DHW"),
        new("STD-SCP-SAN", "Atık Su / Sanitary Drainage", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Pis su / atık su · EN: Sanitary drainage"),
        new("STD-SCP-RW", "Yağmur Suyu / Rainwater", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN: Rainwater drainage"),
        new("STD-SCP-HTG", "Isıtma / Heating", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Isıtma tesisatı · EN: Heating system"),
        new("STD-SCP-CLG", "Soğutma / Chilled Water", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Soğutma suyu · EN: Chilled-water system"),
        new("STD-SCP-VEN", "Havalandırma / Ventilation", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN: Ventilation and exhaust"),
        new("STD-SCP-FP", "Yangın Sprinkler / Fire Sprinkler", CardType.Scope, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Yangın hattı · EN: Fire sprinkler"),

        // Teknik sistemler
        new("STD-SYS-CW-DIST", "Temiz Su Dağıtımı / Domestic Water Distribution", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "Bina içi soğuk kullanım suyu dağıtımı"),
        new("STD-SYS-DHW-LOOP", "Sıcak Su Sirkülasyonu / DHW Recirculation", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "DHW circulation loop"),
        new("STD-SYS-SAN-STACK", "Pis Su Düşey Kolonu / Sanitary Stack", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "Atık su düşey kolon ve branşmanlar"),
        new("STD-SYS-RAD", "Radyatörlü Isıtma / Radiator Heating", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "TR saha: Panel radyatör devresi · EN: Hydronic radiator circuit"),
        new("STD-SYS-UFH", "Yerden Isıtma / Underfloor Heating", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN: UFH manifold circuits"),
        new("STD-SYS-CHW", "Soğutulmuş Su Dağıtımı / Chilled Water Distribution", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN: CHW primary/secondary distribution"),
        new("STD-SYS-AHU", "Klima Santrali / Air Handling Unit", CardType.System, ItemKind.Equipment, "-", ReportBehavior.Folder, Notes: "TR: Klima santrali · EN: AHU"),
        new("STD-SYS-EXH", "Egzoz Havalandırma / Exhaust Ventilation", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN: Extract and exhaust air"),
        new("STD-SYS-SPR", "Sprinkler Sistemi / Sprinkler System", CardType.System, ItemKind.Service, "-", ReportBehavior.Folder, Notes: "EN 12845 / NFPA 13 terminology reference"),
        new("STD-SYS-PUMP", "Pompa Grubu / Pump Set", CardType.System, ItemKind.Equipment, "-", ReportBehavior.Folder, Notes: "TR saha: Hidrofor/pompa grubu · EN: Pump set"),

        // Borular: metraj + standart ticari boy
        new("STD-PIPE-PPRC", "PPRC Boru / PP-R Pipe (çap seçilebilir)", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, Notes: "Tek kart içinde standart ve özel çaplar; her çap için ticari boy tanımlanabilir.", MaterialType: "PP-R", VariantMode: CatalogVariantMode.Pipe, Variants: PprcPipeVariants),
        new("STD-PIPE-STEEL", "Siyah Çelik Boru / Carbon Steel Pipe (çap seçilebilir)", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, Notes: "Tek kart içinde DN ve inç seçenekleri; standart boy 6 m, gerektiğinde karttan değiştirilebilir.", MaterialType: "Carbon Steel", VariantMode: CatalogVariantMode.Pipe, Variants: SteelPipeVariants),
        new("STD-PIPE-GALV", "Galvanizli Çelik Boru / Galvanized Steel Pipe (çap seçilebilir)", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, Notes: "Galvaniz boru ölçüleri çelik standardına göre; ticari boy varyant bazında tanımlıdır.", MaterialType: "Galvanized Steel", VariantMode: CatalogVariantMode.Pipe, Variants: SteelPipeVariants),
        new("STD-PPRC-DN20", "PPRC Boru DN20 / PP-R Pipe DN20", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR yaygın: PP-R / PPRC · EN: PP-R · nominal 4 m boy", MaterialType: "PP-R"),
        new("STD-PPRC-DN25", "PPRC Boru DN25 / PP-R Pipe DN25", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR yaygın: PPRC · EN: PP-R · 4 m boy", MaterialType: "PP-R"),
        new("STD-PPRC-DN32", "PPRC Boru DN32 / PP-R Pipe DN32", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR yaygın: PPRC · EN: PP-R · 4 m boy", MaterialType: "PP-R"),
        new("STD-PPRC-DN40", "PPRC Boru DN40 / PP-R Pipe DN40", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR yaygın: PPRC · EN: PP-R · 4 m boy", MaterialType: "PP-R"),
        new("STD-PPRC-DN50", "PPRC Boru DN50 / PP-R Pipe DN50", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR yaygın: PPRC · EN: PP-R · 4 m boy", MaterialType: "PP-R"),
        new("STD-STEEL-DN25", "Siyah Çelik Boru DN25 / Carbon Steel Pipe DN25", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 6m, Notes: "TR saha: Siyah boru · EN: Carbon steel · 6 m boy", MaterialType: "Carbon Steel"),
        new("STD-STEEL-DN32", "Siyah Çelik Boru DN32 / Carbon Steel Pipe DN32", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 6m, Notes: "TR saha: Siyah boru · EN: Carbon steel · 6 m boy", MaterialType: "Carbon Steel"),
        new("STD-STEEL-DN40", "Siyah Çelik Boru DN40 / Carbon Steel Pipe DN40", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 6m, Notes: "TR saha: Siyah boru · EN: Carbon steel · 6 m boy", MaterialType: "Carbon Steel"),
        new("STD-STEEL-DN50", "Siyah Çelik Boru DN50 / Carbon Steel Pipe DN50", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 6m, Notes: "TR saha: Siyah boru · EN: Carbon steel · 6 m boy", MaterialType: "Carbon Steel"),
        new("STD-STEEL-DN65", "Siyah Çelik Boru DN65 / Carbon Steel Pipe DN65", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 6m, Notes: "TR saha: Siyah boru · EN: Carbon steel · 6 m boy", MaterialType: "Carbon Steel"),
        new("STD-CU-15", "Bakır Boru 15 mm / Copper Tube 15 mm", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 5m, Notes: "EN/ISO: Copper tube · TR saha: Bakır boru · 5 m kangal/boy varsayımı", MaterialType: "Copper"),
        new("STD-CU-22", "Bakır Boru 22 mm / Copper Tube 22 mm", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 5m, Notes: "EN/ISO: Copper tube · 5 m boy varsayımı", MaterialType: "Copper"),
        new("STD-PVC-DN50", "PVC-U Pis Su Borusu DN50 / Sanitary Drain Pipe DN50", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR saha: PVC pis su · EN: PVC-U · 4 m boy", MaterialType: "PVC-U"),
        new("STD-PVC-DN75", "PVC-U Pis Su Borusu DN75 / Sanitary Drain Pipe DN75", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR saha: PVC pis su · EN: PVC-U · 4 m boy", MaterialType: "PVC-U"),
        new("STD-PVC-DN100", "PVC-U Pis Su Borusu DN100 / Sanitary Drain Pipe DN100", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, SalesConversion.StandardLength, 4m, Notes: "TR saha: PVC pis su · EN: PVC-U · 4 m boy", MaterialType: "PVC-U"),

        // PP-R fittingler
        new("STD-PPRC-ELBOW-20", "PPRC Dirsek DN20 / PP-R Elbow DN20", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "90° dirsek · EN ISO 15874 / TR saha: PPRC dirsek", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN20"]),
        new("STD-PPRC-ELBOW-25", "PPRC Dirsek DN25 / PP-R Elbow DN25", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "90° dirsek · EN ISO 15874", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN25"]),
        new("STD-PPRC-ELBOW-32", "PPRC Dirsek DN32 / PP-R Elbow DN32", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "90° dirsek · EN ISO 15874", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN32"]),
        new("STD-PPRC-TEE-25", "PPRC Te DN25 / PP-R Tee DN25", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "Eşit te · EN ISO 15874", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN25"]),
        new("STD-PPRC-TEE-32", "PPRC Te DN32 / PP-R Tee DN32", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "Eşit te · EN ISO 15874", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN32"]),
        new("STD-PPRC-RED-25-20", "PPRC Redüksiyon DN25×20 / PP-R Reducer DN25×20", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "Redüksiyon · TR saha / EN: reducer", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN25", "DN20"]),
        new("STD-PPRC-UNION-25", "PPRC Rakor DN25 / PP-R Union DN25", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "Sökülebilir bağlantı · union", MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN25"]),
        new("STD-PPRC-VALVE-25", "PPRC Küresel Vana DN25 / PP-R Ball Valve DN25", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "TR saha: Küresel vana · EN: ball valve", MaterialType: "Valve", CompatibleDiameters: ["DN25"]),
        new("STD-PPRC-VALVE-32", "PPRC Küresel Vana DN32 / PP-R Ball Valve DN32", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "TR saha: Küresel vana · EN: ball valve", MaterialType: "Valve", CompatibleDiameters: ["DN32"]),

        // Çelik fitting ve tesisat yardımcıları
        new("STD-FIT-PPRC", "PPRC Boru Fittings / PP-R Fittings (çap seçilebilir)", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, MaterialType: "PP-R Fitting", CompatibleDiameters: ["DN16", "DN20", "DN25", "DN32", "DN40", "DN50", "DN63", "DN75", "DN90", "DN110"], VariantMode: CatalogVariantMode.Fitting, Variants: FittingVariants(PprcPipeVariants.Select(x => x.Code).ToArray())),
        new("STD-FIT-STEEL", "Siyah Çelik Boru Fittings / Carbon Steel Fittings (çap seçilebilir)", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, MaterialType: "Carbon Steel Fitting", CompatibleDiameters: ["DN15", "DN20", "DN25", "DN32", "DN40", "DN50", "DN65", "DN80", "DN100", "DN125", "DN150"], VariantMode: CatalogVariantMode.Fitting, Variants: FittingVariants(SteelPipeVariants.Select(x => x.Code).ToArray())),
        new("STD-STEEL-ELBOW-25", "Çelik Dirsek DN25 / Steel Elbow DN25", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "Dişli/kaynaklı dirsek seçimi projeye göre yapılır", MaterialType: "Carbon Steel Fitting", CompatibleDiameters: ["DN25"]),
        new("STD-STEEL-TEE-25", "Çelik Te DN25 / Steel Tee DN25", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "TR saha: Te · EN: tee", MaterialType: "Carbon Steel Fitting", CompatibleDiameters: ["DN25"]),
        new("STD-STEEL-FLANGE-50", "Çelik Flanş DN50 / Steel Flange DN50", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "PN sınıfı ayrıca proje notuna yazılır", MaterialType: "Carbon Steel Fitting", CompatibleDiameters: ["DN50"]),
        new("STD-STEEL-VALVE-50", "Kelebek Vana DN50 / Butterfly Valve DN50", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "TR saha: Kelebek vana · EN: butterfly valve", MaterialType: "Valve", CompatibleDiameters: ["DN50"]),
        new("STD-UNIVERSAL-HANGER", "Boru Askısı / Pipe Hanger", CardType.Accessory, ItemKind.Material, "adet", ReportBehavior.Measurable, Notes: "Çap ve yük sınıfı proje notunda belirtilir", MaterialType: "Support"),
        new("STD-INSULATION", "Boru İzolasyonu / Pipe Insulation", CardType.Material, ItemKind.Material, "m", ReportBehavior.Measurable, Notes: "Kalınlık, ısı iletkenliği ve kaplama notlara yazılır", MaterialType: "Insulation"),

        // Cihaz ve ekipmanlar
        new("STD-EQ-BOILER", "Doğalgazlı Kazan / Gas Boiler", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Marka/model, kW veya kcal/h, pompa basıncı ve yakıt bilgisi nota yazılır", MaterialType: "Heating Equipment"),
        new("STD-EQ-COMBI", "Kombi / Combi Boiler", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Marka/model, kapasite (kW veya kcal/h) ve özel şartlar nota yazılır", MaterialType: "Heating Equipment"),
        new("STD-EQ-RADIATOR", "Panel Radyatör / Panel Radiator", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Tür, yükseklik ve genişlik varyantları metraj girişinde seçilir", MaterialType: "Radiator"),
        new("STD-EQ-FANCOIL", "Fancoil / Fan Coil Unit", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "2 borulu/4 borulu, kapasite ve marka/model nota yazılır", MaterialType: "HVAC Equipment"),
        new("STD-EQ-AHU", "Klima Santrali / Air Handling Unit", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Debi, dış statik basınç, filtre sınıfı ve marka/model nota yazılır", MaterialType: "HVAC Equipment"),
        new("STD-EQ-PUMP", "Sirkülasyon Pompası / Circulation Pump", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Debi, basma yüksekliği, motor gücü ve marka/model nota yazılır", MaterialType: "Pump"),
        new("STD-EQ-EXPANSION", "Genleşme Tankı / Expansion Vessel", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Hacim, ön basınç ve çalışma basıncı nota yazılır", MaterialType: "Heating Equipment"),
        new("STD-EQ-WATER-TANK", "Su Deposu / Water Storage Tank", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Hacim, malzeme ve bağlantı çapları nota yazılır", MaterialType: "Plumbing Equipment"),
        new("STD-EQ-FIRE-PUMP", "Yangın Pompası / Fire Pump", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Debi, basınç, elektrik/dizel ve NFPA/EN şartı nota yazılır", MaterialType: "Fire Equipment"),
        new("STD-EQ-SPRINKLER", "Sprinkler Başlığı / Sprinkler Head", CardType.Accessory, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "K-factor, sıcaklık sınıfı, tip ve standart (EN 12259/NFPA) nota yazılır", MaterialType: "Fire Fitting"),
        new("STD-EQ-FIRE-CABINET", "Yangın Dolabı / Fire Hose Cabinet", CardType.Material, ItemKind.Equipment, "adet", ReportBehavior.Measurable, Notes: "Hortum çapı, makara tipi ve standart nota yazılır", MaterialType: "Fire Equipment")
    ];
}
