using System.Collections;
using System.Reflection;
using System.Text.Json;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class CatalogConsolidationTests
{
    private static readonly string[] EditorialTerms = ["Hata bulunmadı", "DÜZELTME:", "DÜZELTİLDİ", "YENİ KART", "taslak", "eklendi", "eksikti", "bulunmuyordu", "standardLength", "variantMode", "cardType", "slug", "kartından farklı"];
    [Fact]
    public async Task FreshSeedHasExhaustiveMappingsAndConcreteSharedFamilies()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var seed = new StarterCatalogWorkspaceService(database.ContextFactory);
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        StarterCatalogSeedResult result = await seed.SeedAsync();
        IReadOnlyList<CatalogCardListItem> cards = await catalog.ListCardsAsync();
        Assert.Equal(799, StarterCatalogWorkspaceService.Audit.Count);
        Assert.Equal(731, StarterCatalogWorkspaceService.Audit.Count(x => x.SourceCode.StartsWith("STDX-", StringComparison.Ordinal)));
        Assert.Equal(799, StarterCatalogWorkspaceService.Audit.Select(x => x.SourceCode).Distinct().Count());
        Assert.Equal(result.AddedCount, cards.Count);
        Assert.All(StarterCatalogWorkspaceService.Audit, entry => Assert.Contains(cards,
            card => card.Code == (entry.FamilyCode ?? entry.SourceCode)));
        Assert.DoesNotContain(cards, card => card.Name == "placeholder" || card.SupersededByCode is not null);

        CatalogCardListItem ppr = Assert.Single(cards, x => x.Code == "STDF-SU-PPRC-FITTING-AILE-EK");
        Assert.Equal(ppr.Code, ppr.FamilyCode);
        Assert.Equal("PP-R Ek Parça Ailesi / PP-R Fitting Family", ppr.Name);
        Assert.Equal("adet", ppr.Unit);
        Assert.Equal("PP-R", ppr.MaterialType);
        Assert.Contains(ppr.Variants!, x => x.SourceCardCode == "STD-PPRC-ELBOW-25");
        Assert.Contains(ppr.Variants!, x => x.SourceCardCode == "STD-PPRC-TEE-25");
        Assert.Contains(ppr.Variants!, x => x.SourceVariantCode == "REDUKSIYON-MANSON");
        Assert.All(ppr.Variants!, x => Assert.Equal(["water.ppr"], x.CompatiblePipeSystems));
        Assert.Equal(18, ppr.Variants!.Count); // Seven legacy items + eleven explicitly defined STDX options.

        CatalogCardListItem pvc = Assert.Single(cards, x => x.Code == "STDF-ATIK-PVCU-FITTINGS");
        Assert.Equal(8, pvc.Variants!.Select(x => x.SourceCardCode).Distinct().Count());
        Assert.Contains(pvc.Variants!, x => x.SourceCardCode == "STDX-ATIK-ACC-PVCU-REDUKSIYON");
        CatalogCardListItem rods = Assert.Single(cards, x => x.Code == "STDF-ASK-THREADED-RODS");
        Assert.Equal(12, rods.Variants!.Count);
        Assert.Contains(rods.Variants!, x => x.Label.Contains("M20", StringComparison.Ordinal) && x.StandardLength == 3m);
        Assert.Contains(cards, x => x.Code == "STDF-GAZ-PE-BORU-SDR11-DG");
        Assert.Contains(cards, x => x.Code == "STDF-GAZ-PE-BORU-SDR17-DG");
        Assert.Contains(cards, x => x.Code == "STDF-YAN-GROOVE-FITTINGS");
        Assert.Contains(cards, x => x.Code == "STDF-YAN-WELDED-FITTINGS");
        CatalogCardListItem copper = Assert.Single(cards, x => x.Code == "STDF-PIPE-COPPER-SIZES");
        Assert.Equal(CatalogVariantMode.Pipe, copper.VariantMode);
        Assert.Equal(["D15", "D22"], copper.Variants!.Select(x => x.Code));
        Assert.All(copper.Variants!, x => Assert.Equal(5m, x.StandardLength));
        Assert.Contains("Dış çap aralığı: Ø15–22 mm", copper.Notes, StringComparison.Ordinal);
        CatalogCardListItem pressurePipe = Assert.Single(cards, x => x.Code == "STDF-SU-PPRC-BORU-AILE");
        Assert.Contains("PN10–25", pressurePipe.Name, StringComparison.Ordinal);
        Assert.Contains("Ø20–160 mm", pressurePipe.Notes, StringComparison.Ordinal);
        Assert.Contains(pressurePipe.Variants!, x => x.Code == "PN10-DN125" && x.SourceVariantCode == "DN125");
        Assert.DoesNotContain(pressurePipe.Variants!, x => x.Code == "PN10-DN160" || x.Code == "DN16");
        Assert.Contains("Dış çap aralığı: Ø20–160 mm", Assert.Single(cards, x => x.Code == "STDF-GAZ-PE-BORU-SDR11-DG").Notes, StringComparison.Ordinal);
        Assert.Contains("0.5–1 inç", Assert.Single(cards, x => x.Code == "STDF-VITR-TERMOSTATIK-KARISTIRMA-VANASI").Notes, StringComparison.Ordinal);
        Assert.Contains("2000–20000 m3/h", Assert.Single(cards, x => x.Code == "STDF-HAV-KLIMA-SANTRALI-PAKET").Notes, StringComparison.Ordinal);
        Assert.Contains("Ø100–400 mm", Assert.Single(cards, x => x.Code == "STDF-HAV-FLEX-KANAL-IZOLELI").Notes, StringComparison.Ordinal);
        Assert.All(cards, card =>
        {
            foreach (string notes in new[] { card.Notes ?? "" }.Concat(card.Variants?.Select(x => x.SourceNotes ?? "") ?? []))
            {
                foreach (string editorial in EditorialTerms)
                    Assert.DoesNotContain(editorial, notes, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotMatch(@"\bEK:", notes);
            }
        });

        // Every published option preserves the source's labels, notes, units and declared size edges.
        var legacy = LegacyDrafts().ToDictionary(x => x.Code);
        foreach (CatalogCardListItem family in cards.Where(x => x.FamilyCode is not null))
        {
            Assert.Equal(family.Variants!.Count, family.Variants.Select(x => x.Code).Distinct(StringComparer.OrdinalIgnoreCase).Count());
            foreach (CatalogCardVariant option in family.Variants)
            {
                CatalogCardDraft original = legacy[option.SourceCardCode!];
                Assert.Equal(original.Unit, family.Unit);
                Assert.DoesNotContain("Hata bulunmadı", option.SourceNotes ?? "", StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("taslak", option.SourceNotes ?? "", StringComparison.OrdinalIgnoreCase);
                if (family.Code is "STDF-SU-PPRC-BORU-AILE" or "STDF-SU-PPRC-BORU-FIBER")
                {
                    Assert.Contains("PN", option.SourceCardName, StringComparison.Ordinal);
                    Assert.Equal(4m, option.StandardLength);
                    continue;
                }
                Assert.Equal(original.Name.Replace(" (Genişletilmiş)", "", StringComparison.Ordinal).Replace(" (Extended)", "", StringComparison.Ordinal), option.SourceCardName);
                CatalogCardVariantDraft? sourceOption = original.Variants?.Single(x => x.Code == option.SourceVariantCode);
                if (sourceOption is null) continue;
                Assert.Contains(sourceOption.Label, option.Label, StringComparison.Ordinal);
                Assert.Equal(sourceOption.StandardLength, option.StandardLength);
                Assert.Equal(sourceOption.CompatibleDiameters ?? original.CompatibleDiameters ?? [], option.CompatibleDiameters);
            }
        }
        await using MetrajDbContext context = database.ContextFactory();
        Assert.Empty(await context.ProjectPlacements.ToListAsync());
        Assert.Empty(await context.Measurements.ToListAsync());
    }

    [Fact]
    public async Task ExistingDatabaseUpgradePreservesAllOriginalRowsPlacementsAndUserEdits()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        await InstallLegacyAsync(database);
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        CatalogCardListItem oldPipe = Assert.Single(await catalog.ListCardsAsync(), x => x.Code == "STD-PPRC-DN25");
        ProjectListItem project = await projects.CreateProjectAsync("LEGACY", "Legacy measurements");
        PlacementListItem placement = await tree.AddPlacementAsync(new(project.LatestRevisionId, oldPipe.LatestVersionId));
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 17m, "m", Variant: "DN25", SecondaryVariant: "Historical label"));
        CatalogCardDraft original = LegacyDrafts().Single(x => x.Code == "STDX-SU-PPRC-FITTING-AILE-EK");
        CatalogCardListItem edited = Assert.Single(await catalog.ListCardsAsync(), x => x.Code == original.Code);
        await catalog.CreateVersionAsync(edited.Id, original with { Name = "My edited fitting family", WasteRatePct = 9m });
        CatalogCardListItem collision = await catalog.CreateCardAsync(original with
        { Code = "STDF-SU-PPRC-BORU-AILE", Name = "User-owned family code", VariantMode = CatalogVariantMode.None, Variants = null });
        CatalogCardListItem custom = await catalog.CreateCardAsync(original with
        { Code = "STDX-MY-CUSTOM", Name = "Custom prefix card", VariantMode = CatalogVariantMode.None, Variants = null });
        await using (MetrajDbContext editContext = database.ContextFactory())
        {
            CatalogCardDefinition noteEdited = await editContext.CatalogCardDefinitions.SingleAsync(x => x.Code == "STDX-SU-PEX-BORU-AILE");
            noteEdited.Description = "My edited note";
            await editContext.SaveChangesAsync();
        }
        string before = await SnapshotAsync(database);
        var seed = new StarterCatalogWorkspaceService(database.ContextFactory);
        StarterCatalogSeedResult upgraded = await seed.SeedAsync();
        Assert.True(upgraded.AddedCount > 0);
        Assert.Equal(before, await SnapshotAsync(database));
        IReadOnlyList<CatalogCardListItem> cards = await catalog.ListCardsAsync();
        Assert.Equal("STDF-PIPE-PPRC", Assert.Single(cards, x => x.Id == oldPipe.Id).SupersededByCode);
        Assert.Null(Assert.Single(cards, x => x.Id == edited.Id).SupersededByCode);
        Assert.Equal("My edited fitting family", Assert.Single(cards, x => x.Id == edited.Id).Name);
        Assert.Null(Assert.Single(cards, x => x.Code == "STDX-SU-PEX-BORU-AILE").SupersededByCode);
        Assert.Null(Assert.Single(cards, x => x.Code == "STDX-SU-PPRC-BORU-AILE").SupersededByCode);
        Assert.Equal(collision.LatestVersionId, Assert.Single(cards, x => x.Id == collision.Id).LatestVersionId);
        Assert.Equal(custom.LatestVersionId, Assert.Single(cards, x => x.Id == custom.Id).LatestVersionId);
        int count = cards.Count;
        StarterCatalogSeedResult repeated = await seed.SeedAsync();
        Assert.Equal(0, repeated.AddedCount);
        Assert.Equal(count, (await catalog.ListCardsAsync()).Count);
        Assert.Equal(before, await SnapshotAsync(database));
    }

    [Fact]
    public async Task FamilySelectionUsesPlacedPipeMaterialAndOnlyDeclaredDiameterOptions()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        await new StarterCatalogWorkspaceService(database.ContextFactory).SeedAsync();
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("COMPAT", "Compatibility");
        IReadOnlyList<CatalogCardListItem> cards = await catalog.ListCardsAsync();
        CatalogCardListItem pipe = Assert.Single(cards, x => x.Code == "STDF-SU-PPRC-BORU-FIBER");
        PlacementListItem placement = await tree.AddPlacementAsync(new(project.LatestRevisionId, pipe.LatestVersionId));
        IReadOnlyList<CatalogCardListItem> beforeMeasurements = await catalog.ListCompatibleFittingsAsync(placement.Id);
        CatalogCardListItem before = Assert.Single(beforeMeasurements, x => x.Code == "STDF-SU-PPRC-FITTING-AILE-EK");
        Assert.DoesNotContain(before.CompatibleDiameters!, x => x == "DN16"); // Not in this pipe's option set.
        Assert.DoesNotContain(beforeMeasurements, x => x.Code == "STDF-SU-GALVANIZ-FITTING-AILE-EK");
        Assert.DoesNotContain(beforeMeasurements, x => x.Code == "STDF-ATIK-PVCU-FITTINGS");
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 4m, "m", Variant: "DN63"));
        CatalogCardListItem filtered = Assert.Single(await catalog.ListCompatibleFittingsAsync(placement.Id), x => x.Code == before.Code);
        Assert.All(filtered.Variants!, x => Assert.Equal(["DN63"], x.CompatibleDiameters));
        Assert.DoesNotContain(filtered.Variants!, x => x.SourceVariantCode == "DIRSEK-45");
        Assert.Contains(filtered.Variants!, x => x.SourceVariantCode == "DIRSEK-90");

        // Editing the catalogue's latest pipe material cannot retroactively change the placed version.
        await catalog.CreateVersionAsync(pipe.Id, new(pipe.Code, "Edited to steel", CardType.Material, ItemKind.Material,
            InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m", MaterialType: "Carbon Steel"));
        Assert.Contains(await catalog.ListCompatibleFittingsAsync(placement.Id), x => x.Code == before.Code);
        await using MetrajDbContext context = database.ContextFactory();
        CatalogCardVersion placedVersion = await context.CatalogCardVersions.SingleAsync(x => x.Id == pipe.LatestVersionId);
        Assert.Equal("water.ppr", StarterCatalogWorkspaceService.ResolvePipeSystem(placedVersion, pipe.Code));
    }

    [Fact]
    public async Task LegacyMeasurementNotesFilterSizesAndStructuredVariantTakesPrecedence()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        await new StarterCatalogWorkspaceService(database.ContextFactory).SeedAsync();
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("LEGACY-SIZE", "Legacy sizes");
        CatalogCardListItem pipe = Assert.Single(await catalog.ListCardsAsync(), x => x.Code == "STDF-SU-PPRC-BORU-AILE");
        PlacementListItem placement = await new ProjectTreeWorkspaceService(database.ContextFactory).AddPlacementAsync(new(project.LatestRevisionId, pipe.LatestVersionId));
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 4m, "m", Notes: "Çap: DN25 · Kolon"));
        CatalogCardListItem fitting = Assert.Single(await catalog.ListCompatibleFittingsAsync(placement.Id), x => x.Code == "STDF-SU-PPRC-FITTING-AILE-EK");
        Assert.All(fitting.Variants!, x => Assert.Equal(["DN25"], x.CompatibleDiameters));
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 3m, "m", Notes: "Çap: DN50", Variant: "DN32"));
        fitting = Assert.Single(await catalog.ListCompatibleFittingsAsync(placement.Id), x => x.Code == "STDF-SU-PPRC-FITTING-AILE-EK");
        Assert.Equal(["DN25", "DN32"], fitting.Variants!.SelectMany(x => x.CompatibleDiameters!).Distinct().Order());
    }

    [Fact]
    public async Task MixedGasFamilyDoesNotOfferWeldedOptionsToThreadedPipe()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        await new StarterCatalogWorkspaceService(database.ContextFactory).SeedAsync();
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("GAS", "Gas options");
        foreach ((string code, string system) in new[]
        {
            ("STDF-GAZ-CELIK-BORU-DISLI-DG", "gas.steel.threaded"),
            ("STDF-GAZ-CELIK-BORU-KAYNAK-DG", "gas.steel.welded")
        })
        {
            CatalogCardListItem pipe = Assert.Single(await catalog.ListCardsAsync(), x => x.Code == code);
            PlacementListItem placement = await tree.AddPlacementAsync(new(project.LatestRevisionId, pipe.LatestVersionId));
            await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 2m, "m", Variant: "DN50"));
            CatalogCardListItem fittings = Assert.Single(await catalog.ListCompatibleFittingsAsync(placement.Id), x => x.Code == "STDF-GAZ-STEEL-FITTINGS");
            Assert.All(fittings.Variants!, x => Assert.Equal([system], x.CompatiblePipeSystems));
            Assert.All(fittings.Variants!, x => Assert.Equal(["DN50"], x.CompatibleDiameters));
            Assert.DoesNotContain(await catalog.ListCompatibleFittingsAsync(placement.Id), x => x.Code == "STDF-SU-PPRC-FITTING-AILE-EK");
        }
    }

    [Fact]
    public async Task FreshSeedCollisionKeepsUserCardAndRestoresItsSourceVocabularyIdempotently()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        CatalogCardListItem userCard = await catalog.CreateCardAsync(new("STDF-ATIK-PVCU-FITTINGS", "My unrelated card",
            CardType.Material, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "kg"));
        var seed = new StarterCatalogWorkspaceService(database.ContextFactory);
        await seed.SeedAsync();
        IReadOnlyList<CatalogCardListItem> cards = await catalog.ListCardsAsync();
        Assert.Equal(userCard.LatestVersionId, Assert.Single(cards, x => x.Id == userCard.Id).LatestVersionId);
        Assert.Null(Assert.Single(cards, x => x.Code == "STDX-ATIK-ACC-PVCU-TE").SupersededByCode);
        Assert.Equal(0, (await seed.SeedAsync()).AddedCount);
        Assert.Equal(cards.Count, (await catalog.ListCardsAsync()).Count);
    }

    [Fact]
    public async Task ReseedingDoesNotPublishNewVersionsOfEditedOrInactiveFamilies()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var seed = new StarterCatalogWorkspaceService(database.ContextFactory);
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        await seed.SeedAsync();
        CatalogCardListItem family = Assert.Single(await catalog.ListCardsAsync(), x => x.Code == "STDF-ATIK-PVCU-FITTINGS");
        CatalogCardListItem edited = await catalog.CreateVersionAsync(family.Id, new(family.Code, "User family", family.CardType,
            ItemKind.Material, family.InputBehavior, family.SalesConversion, family.ReportBehavior, family.Unit, WasteRatePct: 12m,
            VariantMode: CatalogVariantMode.Fitting, Variants: [new("CUSTOM-OPTION", "Only my option", CompatibleDiameters: ["DN100"])]));
        CatalogCardListItem inactive = Assert.Single(await catalog.ListCardsAsync(), x => x.Code == "STDF-SU-PEX-PRESFITTING-AILE");
        await catalog.DeactivateCardAsync(inactive.Id);
        await seed.SeedAsync();
        IReadOnlyList<CatalogCardListItem> cards = await catalog.ListCardsAsync();
        CatalogCardListItem retained = Assert.Single(cards, x => x.Id == family.Id);
        Assert.Equal(edited.LatestVersionId, retained.LatestVersionId);
        Assert.Equal("User family", retained.Name);
        Assert.Equal("CUSTOM-OPTION", Assert.Single(retained.Variants!).Code);
        Assert.False(Assert.Single(cards, x => x.Id == inactive.Id).IsActive);
        Assert.Equal(inactive.LatestVersionId, Assert.Single(cards, x => x.Id == inactive.Id).LatestVersionId);
        Assert.Equal(0, (await seed.SeedAsync()).AddedCount);
    }

    [Fact]
    public async Task CustomPipeMaterialAndVariantRestrictionsAreRespected()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var catalog = new CatalogWorkspaceService(database.ContextFactory);
        CatalogCardListItem pipe = await catalog.CreateCardAsync(new("CUSTOM-PIPE", "Custom PP-R", CardType.Material, ItemKind.Material,
            InputBehavior.Manual, SalesConversion.StandardLength, ReportBehavior.Measurable, "m", MaterialType: "PP-R",
            VariantMode: CatalogVariantMode.Pipe, Variants: [new("DN25", "DN25", 4m)]));
        await catalog.CreateCardAsync(new("CUSTOM-STEEL", "Steel fitting", CardType.Accessory, ItemKind.Material,
            InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet", MaterialType: "Carbon Steel Fitting",
            VariantMode: CatalogVariantMode.Fitting, Variants: [new("ELBOW", "Steel elbow", CompatibleDiameters: ["DN25"])]));
        await catalog.CreateCardAsync(new("CUSTOM-PPR", "PP-R fitting", CardType.Accessory, ItemKind.Material,
            InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet", MaterialType: "PP-R Fitting",
            VariantMode: CatalogVariantMode.Fitting, Variants:
            [new("ELBOW", "Elbow", CompatibleDiameters: ["DN25", "DN32"]), new("TEE", "Tee", CompatibleDiameters: ["DN32"])]));
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("CUSTOM", "Custom compatibility");
        PlacementListItem placement = await new ProjectTreeWorkspaceService(database.ContextFactory).AddPlacementAsync(new(project.LatestRevisionId, pipe.LatestVersionId));
        CatalogCardListItem fitting = Assert.Single(await catalog.ListCompatibleFittingsAsync(placement.Id));
        Assert.Equal("CUSTOM-PPR", fitting.Code);
        CatalogCardVariant option = Assert.Single(fitting.Variants!);
        Assert.Equal("ELBOW", option.Code);
        Assert.Equal(["DN25"], option.CompatibleDiameters);
    }

    private static CatalogCardDraft[] LegacyDrafts()
    {
        // Exercise the frozen production baseline, not a second copied test dataset.
        var cards = (IEnumerable)typeof(StarterCatalogWorkspaceService)
            .GetField("Cards", BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!;
        MethodInfo method = typeof(StarterCatalogWorkspaceService).GetMethod("LegacyDraft", BindingFlags.Static | BindingFlags.NonPublic)!;
        return cards.Cast<object>().Select(card => (CatalogCardDraft)method.Invoke(null, [card])!).ToArray();
    }

    private static async Task InstallLegacyAsync(TestDatabase database)
    {
        await using MetrajDbContext context = database.ContextFactory();
        foreach (CatalogCardDraft card in LegacyDrafts())
        {
            var definition = new CatalogCardDefinition { Id = Guid.NewGuid(), Code = card.Code, Name = card.Name, Description = card.Notes };
            var version = new CatalogCardVersion
            {
                Id = Guid.NewGuid(), CatalogCardDefinitionId = definition.Id, VersionNumber = 1,
                Name = card.Name, CardType = card.CardType, ItemKind = card.ItemKind, InputBehavior = card.InputBehavior,
                SalesConversion = card.SalesConversion, ReportBehavior = card.ReportBehavior, Unit = card.Unit,
                WasteRatePct = card.WasteRatePct, ContainerParameter = card.ContainerParameter, MaterialType = card.MaterialType,
                VariantMode = card.VariantMode, VariantDefinitionsJson = CatalogVariantCatalog.Serialize(CatalogVariantCatalog.Normalize(card.Variants)),
                CompatibleDiametersJson = JsonSerializer.Serialize(card.CompatibleDiameters ?? []),
                ContentHash = "older-seed-hash-format", IsPublished = true
            };
            context.AddRange(definition, version);
        }
        await context.SaveChangesAsync();
    }

    private static async Task<string> SnapshotAsync(TestDatabase database)
    {
        await using MetrajDbContext context = database.ContextFactory();
        return JsonSerializer.Serialize(new
        {
            Definitions = await context.CatalogCardDefinitions.AsNoTracking().Where(x => !x.Code.StartsWith("STDF-"))
                .OrderBy(x => x.Id).Select(x => new { x.Id, x.Code, x.Name, x.Description, x.IsActive, x.CreatedAtUtc }).ToListAsync(),
            Versions = await context.CatalogCardVersions.AsNoTracking().Where(x => !x.CatalogCardDefinition!.Code.StartsWith("STDF-"))
                .OrderBy(x => x.Id).Select(x => new
                {
                    x.Id, x.CatalogCardDefinitionId, x.VersionNumber, x.Name, x.CardType, x.ItemKind, x.Unit,
                    x.WasteRatePct, x.ContainerParameter, x.MaterialType, x.VariantMode, x.VariantDefinitionsJson,
                    x.AttributeValuesJson, x.CompatibleDiametersJson, x.ContentHash, x.CreatedAtUtc
                }).ToListAsync(),
            Placements = await context.ProjectPlacements.AsNoTracking().OrderBy(x => x.Id)
                .Select(x => new { x.Id, x.CatalogCardVersionId, x.ParentPlacementId }).ToListAsync(),
            Measurements = await context.Measurements.AsNoTracking().OrderBy(x => x.Id)
                .Select(x => new { x.Id, x.ProjectPlacementId, x.InputQuantity, x.Variant, x.SecondaryVariant }).ToListAsync()
        });
    }
}
