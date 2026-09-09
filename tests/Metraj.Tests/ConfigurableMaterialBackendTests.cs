using System.IO.Compression;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

public sealed class ConfigurableMaterialBackendTests
{
    [Fact]
    public async Task PipeProfilesPersistPerDiameterAndSelectTheirOwnStockLength()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-pipe-profile");
        string databasePath = database.Path;
        await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            await ApplicationSchemaMigrator.MigrateAsync(context);
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("PIPE-PROFILES", "Çap profili testi");
        CatalogCardListItem pipeCard = await catalog.CreateCardAsync(new CatalogCardDraft(
            "PIPE-PROFILE", "Siyah çelik boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.StandardLength, ReportBehavior.Measurable, "m", Variants: [
                new CatalogCardVariantDraft("DN25", "DN25 / 1\"", 6m),
                new CatalogCardVariantDraft("DN40", "DN40 / 1 1/2\"", 12m)
            ], VariantMode: CatalogVariantMode.Pipe));
        Assert.Equal(CatalogVariantMode.Pipe, pipeCard.VariantMode);
        Assert.Equal(2, pipeCard.Variants!.Count);
        PlacementListItem placement = await tree.AddPlacementAsync(new(project.LatestRevisionId, pipeCard.LatestVersionId));
        Assert.Equal(CatalogVariantMode.Pipe, placement.VariantMode);
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 7m, "m", Variant: "DN25"));
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 7m, "m", Variant: "DN40"));
        IReadOnlyList<MeasurementSummaryItem> summaries = await measurements.ListSummariesAsync(project.LatestRevisionId);
        Assert.Equal(2, summaries.Count);
        Assert.Equal(2m, Assert.Single(summaries, x => x.Variant == "DN25").PurchaseQuantity);
        Assert.Equal(1m, Assert.Single(summaries, x => x.Variant == "DN40").PurchaseQuantity);
    }

    [Fact]
    public async Task FittingProfilesKeepDiameterAndKindAsSeparateSummaryKeys()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-fitting-profile");
        string databasePath = database.Path;
        await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            await ApplicationSchemaMigrator.MigrateAsync(context);
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("FIT-PROFILES", "Fitting profili testi");
        CatalogCardListItem pipeCard = await catalog.CreateCardAsync(new CatalogCardDraft(
            "PIPE-PARENT", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", VariantMode: CatalogVariantMode.Pipe,
            Variants: [new CatalogCardVariantDraft("DN25", "DN25", 6m), new CatalogCardVariantDraft("DN40", "DN40", 6m)]));
        CatalogCardListItem fittingCard = await catalog.CreateCardAsync(new CatalogCardDraft(
            "FIT-PROFILE", "Siyah çelik fittings", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "adet", VariantMode: CatalogVariantMode.Fitting,
            CompatibleDiameters: ["DN25", "DN40"], Variants: [
                new CatalogCardVariantDraft("ELBOW", "Dirsek", CompatibleDiameters: ["DN25", "DN40"]),
                new CatalogCardVariantDraft("TEE", "Te", CompatibleDiameters: ["DN40"])
            ]));
        PlacementListItem pipe = await tree.AddPlacementAsync(new(project.LatestRevisionId, pipeCard.LatestVersionId));
        PlacementListItem fittings = await tree.AddPlacementAsync(new(project.LatestRevisionId, fittingCard.LatestVersionId, pipe.Id));
        Assert.Equal(CatalogVariantMode.Fitting, fittings.VariantMode);
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, fittings.Id, 7m, "adet", Variant: "DN25", SecondaryVariant: "ELBOW"));
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, fittings.Id, 2m, "adet", Variant: "DN40", SecondaryVariant: "ELBOW"));
        await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, fittings.Id, 3m, "adet", Variant: "DN40", SecondaryVariant: "TEE"));
        IReadOnlyList<MeasurementSummaryItem> summaries = await measurements.ListSummariesAsync(project.LatestRevisionId);
        Assert.Equal(3, summaries.Count);
        Assert.Equal(7m, Assert.Single(summaries, x => x.Variant == "DN25" && x.SecondaryVariant == "ELBOW").NetQuantity);
        Assert.Equal(3m, Assert.Single(summaries, x => x.Variant == "DN40" && x.SecondaryVariant == "TEE").NetQuantity);
    }

    [Fact]
    public async Task VariantMeasurementsAggregateSeparatelyAndUseMaterialWastePolicy()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-variant-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath)) await ApplicationSchemaMigrator.MigrateAsync(context);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var waste = new MaterialTypeWasteWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("VARIANT", "Varyant testi");
            CatalogCardListItem pipeCard = await catalog.CreateCardAsync(new CatalogCardDraft(
                "PIPE", "Siyah boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 0m, 6m,
                Notes: "Dikişli çelik", MaterialType: "Çelik Boru"));
            Assert.Equal("Dikişli çelik", pipeCard.Notes);
            await waste.UpsertAsync("Çelik Boru", 10m);
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId));
            await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, pipe.Id, 5m, "m", Variant: "1 inç"));
            await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, pipe.Id, 7m, "m", Variant: "1 inç"));
            await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, pipe.Id, 4m, "m", Variant: "2 inç"));

            IReadOnlyList<MeasurementSummaryItem> summaries = await measurements.ListSummariesAsync(project.LatestRevisionId);
            Assert.Equal(2, summaries.Count);
            MeasurementSummaryItem oneInch = Assert.Single(summaries, x => x.Variant == "1 inç");
            Assert.Equal(12m, oneInch.NetQuantity);
            Assert.Equal(13.2m, oneInch.WithWasteQuantity);
            Assert.Equal(3m, oneInch.PurchaseQuantity);
            Assert.Equal(10m, oneInch.AppliedWasteRatePct);
        }
        finally { SqliteConnection.ClearAllPools(); File.Delete(databasePath); }
    }

    [Fact]
    public async Task FittingsFilterByEnteredDiameterAndSubtreeExportsExcelAndWord()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-fitting-{Guid.NewGuid():N}.db");
        string directory = Path.Combine(Path.GetTempPath(), $"metraj-export-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath)) await ApplicationSchemaMigrator.MigrateAsync(context);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var reports = new ProjectReportWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("FITTING", "Fitting testi");
            CatalogCardListItem systemCard = await catalog.CreateCardAsync(new("SYS", "Isıtma", CardType.System, ItemKind.Service, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem pipeCard = await catalog.CreateCardAsync(new("PIPE-F", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "m"));
            await catalog.CreateCardAsync(new("ELBOW", "Dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet", CompatibleDiameters: ["DN25"]));
            await catalog.CreateCardAsync(new("TEE", "Te", CardType.Accessory, ItemKind.Material, InputBehavior.Manual, SalesConversion.None, ReportBehavior.Measurable, "adet", CompatibleDiameters: ["DN50"]));
            PlacementListItem system = await tree.AddPlacementAsync(new(project.LatestRevisionId, systemCard.LatestVersionId));
            PlacementListItem pipe = await tree.AddPlacementAsync(new(project.LatestRevisionId, pipeCard.LatestVersionId, system.Id));
            await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, pipe.Id, 8m, "m", Variant: "DN25"));
            IReadOnlyList<CatalogCardListItem> fittings = await catalog.ListCompatibleFittingsAsync(pipe.Id);
            Assert.Contains(fittings, x => x.Code == "ELBOW");
            Assert.DoesNotContain(fittings, x => x.Code == "TEE");
            await Assert.ThrowsAsync<DomainRuleViolationException>(() => tree.MovePlacementAsync(system.Id, pipe.Id));

            string xlsx = Path.Combine(directory, "pipe.xlsx");
            string docx = Path.Combine(directory, "all.docx");
            ProjectReportExportResult subtree = await reports.ExportSubtreeExcelAsync(project.LatestRevisionId, pipe.Id, xlsx);
            await reports.ExportWordAsync(project.LatestRevisionId, docx);
            Assert.Equal(1, subtree.SummaryCount);
            Assert.True(File.Exists(xlsx));
            using ZipArchive word = ZipFile.OpenRead(docx);
            Assert.NotNull(word.GetEntry("word/document.xml"));

            await tree.DeletePlacementAsync(system.Id);
            Assert.Empty(await tree.ListPlacementsAsync(project.LatestRevisionId));
            Assert.Empty(await measurements.ListMeasurementsAsync(project.LatestRevisionId));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
