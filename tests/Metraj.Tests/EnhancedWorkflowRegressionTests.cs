using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using System.IO.Compression;
using Xunit;

namespace Metraj.Tests;

public sealed class EnhancedWorkflowRegressionTests
{
    [Fact]
    public async Task VariantMeasurementsAggregateIndependentlyAndUseMaterialTypeWaste()
    {
        string databasePath = NewDatabasePath();
        try
        {
            await InitializeAsync(databasePath);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var waste = new MaterialTypeWasteWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-VARIANT", "Varyant toplama");
            CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "PIPE-BLACK", "Siyah boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 2m, 6m,
                Notes: "Kaynaklı çelik boru", MaterialType: "Siyah Boru"));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId));
            await waste.UpsertAsync("Siyah Boru", 10m);

            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 2.25m, "m", Variant: "1 inç"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 3.75m, "m", Variant: "1 inç"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 7m, "m", Variant: "1 1/4 inç"));

            IReadOnlyList<MeasurementSummaryItem> summaries = await measurements.ListSummariesAsync(project.LatestRevisionId);
            MeasurementSummaryItem oneInch = Assert.Single(summaries, x => x.Variant == "1 inç");
            Assert.Equal(2, oneInch.MeasurementCount);
            Assert.Equal(6m, oneInch.NetQuantity);
            Assert.Equal(6.6m, oneInch.WithWasteQuantity);
            Assert.Equal(2m, oneInch.PurchaseQuantity);
            Assert.Equal(5.4m, oneInch.RemainderQuantity);
            Assert.Equal(10m, oneInch.AppliedWasteRatePct);
            Assert.Equal(7m, Assert.Single(summaries, x => x.Variant == "1 1/4 inç").NetQuantity);
        }
        finally
        {
            Cleanup(databasePath);
        }
    }

    [Fact]
    public async Task CatalogNotesAndCompatibleDiametersRoundTripAndFilterFittings()
    {
        string databasePath = NewDatabasePath();
        try
        {
            await InitializeAsync(databasePath);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-FILTER", "Fitting filtresi");
            CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "PIPE-PPR", "PPR-C boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "m", Notes: "PN20 boru", MaterialType: "PPR-C"));
            CatalogCardListItem matching = await cards.CreateCardAsync(new CatalogCardDraft(
                "FIT-25", "Dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "adet", CompatibleDiameters: [" DN25 ", "dn25"]));
            await cards.CreateCardAsync(new CatalogCardDraft(
                "FIT-32", "Te", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "adet", CompatibleDiameters: ["DN32"]));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 4m, "m", Variant: "DN25"));

            CatalogCardListItem persisted = Assert.Single(await cards.ListCardsAsync(), x => x.Id == pipeCard.Id);
            Assert.Equal("PN20 boru", persisted.Notes);
            Assert.Equal("PPR-C", persisted.MaterialType);
            CatalogCardListItem normalized = Assert.Single(await cards.ListCardsAsync(), x => x.Id == matching.Id);
            Assert.Single(normalized.CompatibleDiameters!);
            Assert.Equal("DN25", normalized.CompatibleDiameters![0], ignoreCase: true);
            IReadOnlyList<CatalogCardListItem> fittings = await cards.ListCompatibleFittingsAsync(pipe.Id);
            Assert.Contains(fittings, x => x.Code == "FIT-25");
            Assert.DoesNotContain(fittings, x => x.Code == "FIT-32");

            await cards.DeleteCardAsync(matching.Id);
            Assert.DoesNotContain(await cards.ListCardsAsync(), x => x.Id == matching.Id);
            await cards.DeleteCardAsync(pipeCard.Id);
            Assert.False(Assert.Single(await cards.ListCardsAsync(), x => x.Id == pipeCard.Id).IsActive);
        }
        finally
        {
            Cleanup(databasePath);
        }
    }

    [Fact]
    public async Task RadiatorHeightAndWidthRowsAggregateOnlyWhenBothVariantsMatch()
    {
        string databasePath = NewDatabasePath();
        try
        {
            await InitializeAsync(databasePath);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-RAD", "Radyatör varyantları");
            CatalogCardListItem radiatorCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "RAD-PANEL", "Panel radyatör", CardType.Material, ItemKind.Equipment, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "adet"));
            PlacementListItem radiator = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, radiatorCard.LatestVersionId));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, radiator.Id, 1m, "adet", Variant: "H600", SecondaryVariant: "W1000"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, radiator.Id, 2m, "adet", Variant: "H600", SecondaryVariant: "W1000"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, radiator.Id, 4m, "adet", Variant: "H600", SecondaryVariant: "W1200"));

            IReadOnlyList<MeasurementSummaryItem> summaries = await measurements.ListSummariesAsync(project.LatestRevisionId);
            MeasurementSummaryItem width1000 = Assert.Single(summaries, x => x.Variant == "H600" && x.SecondaryVariant == "W1000");
            Assert.Equal(2, width1000.MeasurementCount);
            Assert.Equal(3m, width1000.NetQuantity);
            Assert.Equal(4m, Assert.Single(summaries, x => x.SecondaryVariant == "W1200").NetQuantity);
        }
        finally
        {
            Cleanup(databasePath);
        }
    }

    [Fact]
    public async Task DeletingPlacementRemovesItsWholeSubtreeAndMeasurements()
    {
        string databasePath = NewDatabasePath();
        try
        {
            await InitializeAsync(databasePath);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-DELETE", "Silme testi");
            CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "SYS-HEAT", "Isıtma", CardType.System, ItemKind.Service, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "PIPE-HEAT", "Isıtma borusu", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "m"));
            CatalogCardListItem fittingCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "FIT-HEAT", "Dirsek", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "adet"));
            PlacementListItem system = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId, system.Id));
            PlacementListItem fitting = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, fittingCard.LatestVersionId, pipe.Id));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 4m, "m"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, fitting.Id, 2m, "adet"));

            await tree.DeletePlacementAsync(pipe.Id);

            Assert.Equal(system.Id, Assert.Single(await tree.ListPlacementsAsync(project.LatestRevisionId)).Id);
            Assert.Empty(await measurements.ListMeasurementsAsync(project.LatestRevisionId));
        }
        finally
        {
            Cleanup(databasePath);
        }
    }

    [Fact]
    public async Task SubtreeReportExcludesSiblingBranchAndWordExportIsReadableOpenXml()
    {
        string databasePath = NewDatabasePath();
        string outputDirectory = Path.Combine(Path.GetTempPath(), $"metraj-enhanced-report-{Guid.NewGuid():N}");
        Directory.CreateDirectory(outputDirectory);
        try
        {
            await InitializeAsync(databasePath);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var reports = new ProjectReportWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-SUBTREE", "Alt ağaç raporu");
            CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "SYS-SUB", "Sistem", CardType.System, ItemKind.Service, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "PIPE-SUB", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "m"));
            PlacementListItem firstSystem = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId, DisplayNameOverride: "Birinci sistem"));
            PlacementListItem secondSystem = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId, DisplayNameOverride: "İkinci sistem"));
            PlacementListItem included = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId, firstSystem.Id, "Dahil boru"));
            PlacementListItem excluded = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId, secondSystem.Id, "Hariç boru"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, included.Id, 8m, "m", Variant: "DN25"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, excluded.Id, 99m, "m", Variant: "DN50"));

            ProjectReportData subtree = await reports.BuildSubtreeReportDataAsync(project.LatestRevisionId, firstSystem.Id);
            Assert.Equal(8m, Assert.Single(subtree.Summaries).NetQuantity);
            Assert.DoesNotContain(subtree.SourceMeasurements, x => x.PlacementId == excluded.Id);

            string excelPath = Path.Combine(outputDirectory, "subtree.xlsx");
            string pdfPath = Path.Combine(outputDirectory, "subtree.pdf");
            string wordPath = Path.Combine(outputDirectory, "subtree.docx");
            await reports.ExportSubtreeExcelAsync(project.LatestRevisionId, firstSystem.Id, excelPath);
            await reports.ExportSubtreePdfAsync(project.LatestRevisionId, firstSystem.Id, pdfPath);
            await reports.ExportSubtreeWordAsync(project.LatestRevisionId, firstSystem.Id, wordPath);
            using (var workbook = new XLWorkbook(excelPath))
            {
                Assert.Contains(workbook.Worksheet("Özet").CellsUsed(), cell => cell.GetString() == "Dahil boru");
                Assert.DoesNotContain(workbook.Worksheet("Özet").CellsUsed(), cell => cell.GetString() == "Hariç boru");
            }
            using (ZipArchive archive = ZipFile.OpenRead(wordPath))
            {
                ZipArchiveEntry documentEntry = Assert.IsType<ZipArchiveEntry>(archive.GetEntry("word/document.xml"));
                using var reader = new StreamReader(documentEntry.Open());
                string documentXml = await reader.ReadToEndAsync();
                Assert.Contains("<w:tbl", documentXml, StringComparison.Ordinal);
                Assert.Contains("Dahil boru", documentXml, StringComparison.Ordinal);
                Assert.DoesNotContain("Hariç boru", documentXml, StringComparison.Ordinal);
            }

            using (var wordDocument = WordprocessingDocument.Open(wordPath, false))
            {
                var validationErrors = new OpenXmlValidator().Validate(wordDocument).ToList();
                Assert.True(validationErrors.Count == 0, string.Join(
                    Environment.NewLine,
                    validationErrors.Select(error => $"{error.Description}{Environment.NewLine}{error.Node?.OuterXml}")));
            }
            Assert.True(File.ReadAllBytes(pdfPath).AsSpan().StartsWith("%PDF"u8));
        }
        finally
        {
            Cleanup(databasePath);
            Directory.Delete(outputDirectory, recursive: true);
        }
    }

    [Fact]
    public async Task SubtreeReportUsesPlacementIdentityWhenTheSameCatalogCardsExistInSiblingBranches()
    {
        string databasePath = NewDatabasePath();
        try
        {
            await InitializeAsync(databasePath);
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var calculations = new CalculationWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var reports = new ProjectReportWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));

            ProjectListItem project = await projects.CreateProjectAsync("P-IDENTITY", "Yerleşim kimliği raporu");
            CatalogCardListItem systemCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "SYS-SHARED", "Ortak sistem", CardType.System, ItemKind.Service, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "PIPE-SHARED", "Ortak boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "m"));
            CatalogCardListItem fittingCard = await cards.CreateCardAsync(new CatalogCardDraft(
                "FIT-SHARED", "Ortak fitting", CardType.Accessory, ItemKind.Material, InputBehavior.Derived,
                SalesConversion.None, ReportBehavior.Measurable, "adet"));

            PlacementListItem firstSystem = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
            PlacementListItem secondSystem = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, systemCard.LatestVersionId));
            PlacementListItem firstPipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId, firstSystem.Id));
            PlacementListItem secondPipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId, secondSystem.Id));
            PlacementListItem firstFitting = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, fittingCard.LatestVersionId, firstPipe.Id));
            PlacementListItem secondFitting = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, fittingCard.LatestVersionId, secondPipe.Id));
            await tree.AddLinkAsync(firstPipe.Id, firstFitting.Id, SemanticLinkType.CalculatedFrom);
            await tree.AddLinkAsync(secondPipe.Id, secondFitting.Id, SemanticLinkType.CalculatedFrom);
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, firstPipe.Id, 8m, "m", Variant: "DN25"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, secondPipe.Id, 99m, "m", Variant: "DN50"));

            CalculationRuleListItem rule = await calculations.CreateRuleVersionAsync(project.LatestRevisionId,
                new CalculationRuleDraft("FIT-PER-M", "Metre başına fitting", CalculationRuleMode.FixedMultiplier, 0.5m));
            CalculationResultListItem firstResult = await calculations.CalculateAsync(project.LatestRevisionId, firstFitting.Id, rule.Id);
            CalculationResultListItem secondResult = await calculations.CalculateAsync(project.LatestRevisionId, secondFitting.Id, rule.Id);
            await calculations.ApproveAsync(firstResult.Id);
            await calculations.ApproveAsync(secondResult.Id);

            ProjectReportData subtree = await reports.BuildSubtreeReportDataAsync(project.LatestRevisionId, firstSystem.Id);

            Assert.Equal(firstPipe.Id, Assert.Single(subtree.Summaries).PlacementId);
            Assert.Equal(2, subtree.PurchaseItems.Count);
            Assert.Contains(subtree.PurchaseItems, item => item.PlacementId == firstPipe.Id && item.QuantitySource == "Kaynak metraj");
            Assert.Contains(subtree.PurchaseItems, item => item.PlacementId == firstFitting.Id && item.QuantitySource == "Onaylı hesap önerisi");
            Assert.DoesNotContain(subtree.PurchaseItems, item => item.PlacementId == secondPipe.Id || item.PlacementId == secondFitting.Id);
            Assert.Equal(firstFitting.Id, Assert.Single(subtree.CalculationChecks).TargetPlacementId);
        }
        finally
        {
            Cleanup(databasePath);
        }
    }

    private static string NewDatabasePath() => Path.Combine(Path.GetTempPath(), $"metraj-enhanced-{Guid.NewGuid():N}.db");

    private static async Task InitializeAsync(string databasePath)
    {
        await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
        await ApplicationSchemaMigrator.MigrateAsync(context);
    }

    private static void Cleanup(string databasePath)
    {
        SqliteConnection.ClearAllPools();
        File.Delete(databasePath);
        File.Delete($"{databasePath}-wal");
        File.Delete($"{databasePath}-shm");
    }
}
