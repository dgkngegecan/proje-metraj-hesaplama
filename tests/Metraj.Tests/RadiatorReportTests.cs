using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace Metraj.Tests;

public sealed class RadiatorReportTests
{
    [Fact]
    public async Task RadiatorGroupingPreservesSourceIdentitiesAndSeparatesTypesDimensionsUnitsAndSubtrees()
    {
        await using var database = await TestDatabase.CreateAsync("radiator-report");
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        var measurements = new MeasurementWorkspaceService(database.ContextFactory);
        var reports = new ProjectReportWorkspaceService(database.ContextFactory);
        var project = await projects.CreateProjectAsync("RAD-REPORT", "Radyatör raporu");
        async Task<PlacementListItem> Add(string code, string name, CardType cardType = CardType.Material,
            SalesConversion conversion = SalesConversion.None, decimal? packageSize = null)
        {
            var card = await cards.CreateCardAsync(new CatalogCardDraft(code, name, cardType, ItemKind.Equipment,
                InputBehavior.Manual, conversion, ReportBehavior.Measurable, "adet", ContainerParameter: packageSize));
            return await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        }
        async Task Measure(PlacementListItem placement, string? primary, string? secondary, decimal count) =>
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id,
                count, "adet", Variant: primary, SecondaryVariant: secondary));

        var first = await Add("RAD-PANEL-A", "Panel radyatör");
        var second = await Add("RAD-PANEL-B", "Panel radyatör");
        await Measure(first, null, "T22-600-1200", 2);
        await Measure(first, "PKKP · H600", "W1200", 3);
        await Measure(second, "Tip 22 · H600", "W1200", 4);
        await Measure(first, "PKP · H600", "W1200", 5);
        await Measure(first, "Tip 22 · H500", "W1200", 6);
        await Measure(first, "Tip 22 · H600", "W1000", 7);
        await Measure(first, "H600", "W1200", 8);
        await Measure(first, "Dekoratif · H650", "W1250.5", 9);
        await Measure(first, "PKKPKP · H600", "W1200", 1);
        await Measure(first, "DKEK · H600", "W1200", 2);
        await Measure(first, "PK · H600", "W1200", 3);
        await Measure(first, "P · H600", "W1200", 4);
        foreach (string alias in new[] { "T10", "T11", "T21", "T22", "T33" })
            await Measure(first, $"{alias} · H600", "W1200", 1);
        var cast = await Add("STDX-ISI-DOKUM-RAD-DILIM", "Döküm radyatör");
        await Measure(cast, null, "DR-600", 12);
        var aluminium = await Add("STDX-ISI-ALU-RAD-DILIM", "Alüminyum radyatör");
        await Measure(aluminium, null, "ALU-600", 13);
        var towel = await Add("STDX-ISI-HAVLUPAN", "Havlupan");
        await Measure(towel, null, "HP-500-800", 2);
        var valve = await Add("RAD-VALVE", "Radyatör vana", CardType.Accessory);
        await Measure(valve, null, "T22-600-1200", 100);
        var packaged = await Add("RAD-PACK", "Panel radyatör", conversion: SalesConversion.Package, packageSize: 2);
        await Measure(packaged, null, "T22-600-1200", 3);

        var before = await measurements.ListMeasurementsAsync(project.LatestRevisionId);
        var report = await reports.BuildReportDataAsync(project.LatestRevisionId);
        var common = Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 22" && x.HeightMm == 600 && x.LengthMm == 1200 && x.PurchaseUnit == "adet");
        Assert.Equal(10, common.NetQuantity);
        Assert.Equal(6, Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 22" && x.HeightMm == 500).NetQuantity);
        Assert.Equal(7, Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 22" && x.LengthMm == 1000).NetQuantity);
        Assert.Equal("PKKP · Tip 22", common.TypeLabel);
        Assert.Equal(2, common.PlacementIds.Count);
        Assert.Equal(4, Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 33").NetQuantity);
        Assert.Equal(6, Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 21").NetQuantity);
        Assert.Equal(4, Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 11").NetQuantity);
        Assert.Equal(5, Assert.Single(report.RadiatorSummaries, x => x.Type == "Tip 10").NetQuantity);
        Assert.Equal(8, Assert.Single(report.RadiatorSummaries, x => x.Type == "Panel").NetQuantity);
        Assert.Equal(1250.5m, Assert.Single(report.RadiatorSummaries, x => x.Type == "Dekoratif").LengthMm);
        Assert.Equal(2, report.RadiatorSummaries.Count(x => x.Unit == "dilim"));
        Assert.All(report.RadiatorSummaries.Where(x => x.Unit == "dilim"), x => { Assert.Null(x.LengthMm); Assert.Equal("dilim", x.PurchaseUnit); });
        Assert.Equal(800, Assert.Single(report.RadiatorSummaries, x => x.Type == "Havlupan").HeightMm);
        Assert.Equal(500, Assert.Single(report.RadiatorSummaries, x => x.Type == "Havlupan").LengthMm);
        Assert.Equal(2, Assert.Single(report.RadiatorSummaries, x => x.PurchaseUnit == "paket").PurchaseQuantity);
        Assert.DoesNotContain(report.RadiatorSummaries, x => x.PlacementIds.Contains(valve.Id));
        Assert.Equal(before, await measurements.ListMeasurementsAsync(project.LatestRevisionId));
        Assert.Contains(report.Summaries, x => x.Variant == "PKKP · H600" && x.SecondaryVariant == "W1200");
        Assert.Contains(report.Summaries, x => x.Variant is null && x.SecondaryVariant == "T22-600-1200");
        var subtree = await reports.BuildSubtreeReportDataAsync(project.LatestRevisionId, first.Id);
        Assert.Equal(6, Assert.Single(subtree.RadiatorSummaries, x => x.Type == "Tip 22" && x.HeightMm == 600 && x.LengthMm == 1200).NetQuantity);
        Assert.All(subtree.RadiatorSummaries, x => Assert.Equal(first.Id, Assert.Single(x.PlacementIds)));

        string directory = Path.Combine(Path.GetTempPath(), $"radiator-exports-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            string xlsx = Path.Combine(directory, "radiators.xlsx"), docx = Path.Combine(directory, "radiators.docx"), pdf = Path.Combine(directory, "radiators.pdf");
            await reports.ExportExcelAsync(project.LatestRevisionId, xlsx);
            await reports.ExportWordAsync(project.LatestRevisionId, docx);
            await reports.ExportPdfAsync(project.LatestRevisionId, pdf);
            using (var workbook = new XLWorkbook(xlsx))
            {
                var sheet = workbook.Worksheet("Radyatörler");
                Assert.Equal("Yükseklik (mm)", sheet.Cell(3, 2).GetString());
                Assert.Equal("Uzunluk (mm)", sheet.Cell(3, 3).GetString());
                var totals = sheet.RowsUsed().Where(x => x.Cell(1).GetString() == "GENEL TOPLAM").ToList();
                Assert.Equal(3, totals.Count);
                Assert.Equal(25, totals.Single(x => x.Cell(4).GetString() == "dilim").Cell(5).GetValue<decimal>());
                Assert.Contains(sheet.RowsUsed(), x => x.Cell(1).GetString().Contains("tip toplamı"));
                Assert.Contains(sheet.RowsUsed(), x => x.Cell(1).GetString().Contains("yükseklik toplamı"));
                Assert.Contains(workbook.Worksheet("Özet").RowsUsed(), x => x.Cell(9).GetString() == "T22-600-1200");
            }
            using (var word = WordprocessingDocument.Open(docx, false))
            {
                var body = word.MainDocumentPart!.Document!.Body!;
                Assert.Contains("Radyatörler", body.InnerText);
                Assert.Contains("PKKP · Tip 22", body.InnerText);
                Assert.Contains("GENEL TOPLAM", body.InnerText);
                var table = Assert.Single(body.Elements<W.Table>(), x => x.Elements<W.TableRow>().First().InnerText.StartsWith("TipYükseklik", StringComparison.Ordinal));
                Assert.Contains(table.Elements<W.TableRow>(), x => x.InnerText.Contains("dilim"));
                var totalRows = table.Elements<W.TableRow>().Where(x => x.InnerText.Contains("toplamı") || x.InnerText.Contains("GENEL TOPLAM")).ToList();
                Assert.NotEmpty(totalRows);
                Assert.All(totalRows.SelectMany(x => x.Elements<W.TableCell>()), cell =>
                {
                    Assert.Equal("E8F0F7", cell.TableCellProperties?.Shading?.Fill?.Value);
                    Assert.NotEmpty(cell.Descendants<W.Bold>());
                });
                var genericTable = body.Elements<W.Table>().First();
                Assert.All(genericTable.Elements<W.TableRow>().Skip(1).SelectMany(x => x.Elements<W.TableCell>()), cell =>
                {
                    Assert.Null(cell.TableCellProperties?.Shading);
                    Assert.Empty(cell.Descendants<W.Bold>());
                });
            }
            Assert.True(new FileInfo(pdf).Length > 1000);
        }
        finally { Directory.Delete(directory, true); }
    }
}
