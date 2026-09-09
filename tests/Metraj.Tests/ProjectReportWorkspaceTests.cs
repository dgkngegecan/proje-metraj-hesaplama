using ClosedXML.Excel;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class ProjectReportWorkspaceTests
{
    [Fact]
    public async Task ExcelAndPdfUseTheSameRevisionSnapshotAndPreserveSafeSourceText()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-phase4-report");
        string databasePath = database.Path;
        string outputDirectory = Path.Combine(Path.GetTempPath(), $"metraj-phase4-report-{Guid.NewGuid():N}");
        Directory.CreateDirectory(outputDirectory);
        string excelPath = Path.Combine(outputDirectory, "metraj.xlsx");
        string pdfPath = Path.Combine(outputDirectory, "metraj.pdf");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var calculations = new CalculationWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var responsibilities = new ResponsibilityWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var reports = new ProjectReportWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            ProjectListItem project = await projects.CreateProjectAsync("P-REPORT", "Rapor testi");
            CatalogCardListItem category = await cards.CreateCardAsync(new CatalogCardDraft(
                "CAT-REPORT", "Mekanik", CardType.Category, ItemKind.Service, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem system = await cards.CreateCardAsync(new CatalogCardDraft(
                "SYS-REPORT", "Temiz Su", CardType.System, ItemKind.Service, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Folder, "-"));
            CatalogCardListItem material = await cards.CreateCardAsync(new CatalogCardDraft(
                "MAT-REPORT", "PPRC Boru DN25", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 5m, 4m, PositionNumber: "15.01"));
            CatalogCardListItem accessory = await cards.CreateCardAsync(new CatalogCardDraft(
                "ACC-REPORT", "PPRC Dirsek DN25", CardType.Accessory, ItemKind.Material, InputBehavior.Derived,
                SalesConversion.Package, ReportBehavior.Measurable, "adet", 0m, 10m, PositionNumber: "15.02"));
            PlacementListItem categoryPlacement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, category.LatestVersionId));
            PlacementListItem systemPlacement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, system.LatestVersionId, categoryPlacement.Id));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, material.LatestVersionId, systemPlacement.Id));
            PlacementListItem elbow = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, accessory.LatestVersionId, systemPlacement.Id));
            ResponsibilityDimensionListItem dimension = await responsibilities.CreateDimensionAsync(project.LatestRevisionId, "MONTAJ", "Montaj");
            ResponsibilityPartyListItem party = await responsibilities.CreatePartyAsync(project.LatestRevisionId, "TASERON", "Test Taşeronu");
            await responsibilities.AssignPlacementAsync(project.LatestRevisionId, dimension.Id, systemPlacement.Id, party.Id, ResponsibilityAssignmentState.Assigned);
            await tree.AddLinkAsync(pipe.Id, elbow.Id, SemanticLinkType.CalculatedFrom);
            await measurements.CreateMeasurementAsync(new MeasurementDraft(
                project.LatestRevisionId, pipe.Id, 12.4m, "m", "A", "Kat 1", "101", "Z1", "M-01", "R1", "=metin"));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(
                project.LatestRevisionId, pipe.Id, 18.6m, "m", "A", "Kat 2", "201"));
            CalculationRuleListItem elbowRule = await calculations.CreateRuleVersionAsync(project.LatestRevisionId,
                new CalculationRuleDraft("ELB-PER-M", "Metre başına dirsek", CalculationRuleMode.FixedMultiplier, 0.1m, SourceQuantityKind.WithWaste));
            CalculationResultListItem elbowResult = await calculations.CalculateAsync(project.LatestRevisionId, elbow.Id, elbowRule.Id);
            await calculations.ApproveAsync(elbowResult.Id);

            ProjectReportData reportData = await reports.BuildReportDataAsync(project.LatestRevisionId);
            Assert.Equal("P-REPORT", reportData.ProjectCode);
            Assert.Equal(2, reportData.SourceMeasurements.Count);
            MeasurementSummaryItem summary = Assert.Single(reportData.Summaries);
            Assert.Equal(31m, summary.NetQuantity);
            Assert.Equal(32.55m, summary.WithWasteQuantity);
            Assert.Equal(9m, summary.PurchaseQuantity);
            Assert.Equal(3.45m, summary.RemainderQuantity);
            ReportClassificationSummaryItem classification = Assert.Single(reportData.ClassificationSummaries);
            Assert.Equal("Mekanik", classification.Category);
            Assert.Equal("Temiz Su", classification.System);
            Assert.Equal("15.01", classification.PositionNumber);
            Assert.Equal(2, reportData.ContextSummaries.Count);
            Assert.Contains(reportData.Responsibilities, item => item.PlacementId == pipe.Id && item.IsInherited && item.PartyName == "Test Taşeronu");
            Assert.Equal(2, reportData.PurchaseItems.Count);
            ReportPurchaseItem purchase = Assert.Single(reportData.PurchaseItems, item => item.Code == "MAT-REPORT");
            Assert.Equal("Kaynak metraj", purchase.QuantitySource);
            Assert.Equal(9m, purchase.PurchaseQuantity);
            ReportPurchaseItem derivedPurchase = Assert.Single(reportData.PurchaseItems, item => item.Code == "ACC-REPORT");
            Assert.Equal("Onaylı hesap önerisi", derivedPurchase.QuantitySource);
            Assert.Equal(1m, derivedPurchase.UsedQuantity);
            ReportCalculationCheckItem check = Assert.Single(reportData.CalculationChecks);
            Assert.Equal(CalculationResultStatus.Approved, check.Status);

            ProjectReportExportResult excel = await reports.ExportExcelAsync(project.LatestRevisionId, excelPath);
            ProjectReportExportResult pdf = await reports.ExportPdfAsync(project.LatestRevisionId, pdfPath);
            Assert.Equal(2, excel.SourceMeasurementCount);
            Assert.Equal(1, excel.SummaryCount);
            Assert.Equal(excel.SourceMeasurementCount, pdf.SourceMeasurementCount);
            Assert.Equal(excel.SummaryCount, pdf.SummaryCount);
            Assert.True(File.Exists(excelPath));
            Assert.True(File.Exists(pdfPath));

            using (var workbook = new XLWorkbook(excelPath))
            {
                IXLWorksheet summarySheet = workbook.Worksheet("Özet");
                Assert.Equal("PPRC Boru DN25", summarySheet.Cell(7, 1).GetString());
                Assert.Equal(31m, summarySheet.Cell(7, 5).GetValue<decimal>());
                Assert.Equal(9m, summarySheet.Cell(7, 7).GetValue<decimal>());
                Assert.Equal("Çap / Boyut", summarySheet.Cell(6, 8).GetString());
                Assert.Equal("Çeşit", summarySheet.Cell(6, 9).GetString());
                Assert.DoesNotContain("Kalan/Fazla", summarySheet.Row(6).CellsUsed().Select(cell => cell.GetString()));
                IXLWorksheet purchaseSheet = workbook.Worksheet("Satın Alma");
                Assert.Contains("Kaynak metraj", purchaseSheet.Column(3).CellsUsed().Select(cell => cell.GetString()));
                Assert.Contains("Onaylı hesap önerisi", purchaseSheet.Column(3).CellsUsed().Select(cell => cell.GetString()));
                Assert.Equal(9m, purchaseSheet.Cell(5, 8).GetValue<decimal>());
                Assert.Equal(string.Empty, purchaseSheet.Cell(5, 4).GetString());
                // Satın alma birimi, girdi biriminden ayrı bir sütun olarak taşınır:
                // 13 boy boru 13 metre değildir.
                Assert.Equal("Satın alma birimi", purchaseSheet.Cell(3, 9).GetString());
                Assert.Equal("boy", purchaseSheet.Cell(5, 9).GetString());
                IXLWorksheet classificationSheet = workbook.Worksheet("Sistem-Kategori");
                Assert.Equal("Mekanik", classificationSheet.Cell(4, 1).GetString());
                Assert.Equal("15.01", classificationSheet.Cell(4, 3).GetString());
                Assert.NotNull(workbook.Worksheet("Kat-Mahal"));
                Assert.NotNull(workbook.Worksheet("Sorumluluk"));
                IXLWorksheet calculationSheet = workbook.Worksheet("Hesap Kontrol");
                Assert.Equal("Approved", calculationSheet.Cell(4, 5).GetString());
                IXLWorksheet sourceSheet = workbook.Worksheet("Kaynak Satırları");
                // Çap ve çeşit sütunları eklendiği için "Not" 12'den 14'e kaydı.
                Assert.Equal("Çap / Boyut", sourceSheet.Cell(3, 3).GetString());
                Assert.Equal("Çeşit", sourceSheet.Cell(3, 4).GetString());
                Assert.Equal("Not", sourceSheet.Cell(3, 14).GetString());
                Assert.Equal("=metin", sourceSheet.Cell(4, 14).GetString());
                Assert.Equal(XLDataType.Text, sourceSheet.Cell(4, 14).DataType);
                Assert.True(string.IsNullOrEmpty(sourceSheet.Cell(4, 14).FormulaA1));
                Assert.Equal(string.Empty, sourceSheet.Cell(5, 14).GetString());
            }

            byte[] pdfHeader = new byte[5];
            await using (FileStream pdfStream = File.OpenRead(pdfPath))
            {
                int bytesRead = await pdfStream.ReadAsync(pdfHeader);
                Assert.Equal(pdfHeader.Length, bytesRead);
            }

            Assert.Equal("%PDF-", System.Text.Encoding.ASCII.GetString(pdfHeader));
            await using MetrajDbContext verification = MetrajDbContextFactory.Create(databasePath);
            Assert.Equal(2, await verification.AuditEntries.CountAsync(x => x.ProjectRevisionId == project.LatestRevisionId && x.EventType == "report-exported"));
        }
        finally
        {
            if (Directory.Exists(outputDirectory))
            {
                Directory.Delete(outputDirectory, recursive: true);
        }
        }
    }
}
