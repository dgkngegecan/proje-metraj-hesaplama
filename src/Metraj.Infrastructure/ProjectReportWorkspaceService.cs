using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using Metraj.Application;
using Metraj.Domain;
using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;
using Microsoft.EntityFrameworkCore;
using PdfSharp.Fonts;
using System.Globalization;
using System.Text.Json;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace Metraj.Infrastructure;

/// <summary>Writes initial, format-consistent quantity reports without requiring Microsoft Office.</summary>
public sealed class ProjectReportWorkspaceService : IProjectReportWorkspace
{
    private static readonly Lock PdfFontConfigurationLock = new();
    private static bool pdfFontsConfigured;
    private readonly Func<MetrajDbContext> contextFactory;

    /// <summary>Creates a report workspace that uses short-lived database contexts.</summary>
    public ProjectReportWorkspaceService(Func<MetrajDbContext> contextFactory)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
    }

    /// <inheritdoc />
    public async Task<ProjectReportData> BuildReportDataAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        // Raporun bütün parçaları TEK bir tutarlı anlık görüntüden okunur.
        // Önceden her alt servis kendi bağlantısını açıyordu; okumalar arasına
        // giren bir yazma, kaynak satırları ile özetleri farklı anlardan
        // getirebiliyor ve rapor kendi içinde tutarsız olabiliyordu.
        await using ReadSnapshotScope snapshot = await ReadSnapshotScope.OpenAsync(contextFactory, cancellationToken);
        Func<MetrajDbContext> snapshotFactory = snapshot.ContextFactory;

        await using MetrajDbContext context = snapshotFactory();
        ProjectRevision revision = await context.ProjectRevisions.AsNoTracking()
            .Include(x => x.Project)
            .SingleOrDefaultAsync(x => x.Id == revisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("report.revision", "Reported project revision was not found.");
        Project project = revision.Project
            ?? throw new DomainRuleViolationException("report.project", "Reported project was not found.");

        var measurementWorkspace = new MeasurementWorkspaceService(snapshotFactory);
        IReadOnlyList<MeasurementListItem> sources = await measurementWorkspace.ListMeasurementsAsync(revisionId, cancellationToken);
        IReadOnlyList<MeasurementSummaryItem> summaries = await measurementWorkspace.ListSummariesAsync(revisionId, cancellationToken);
        var treeWorkspace = new ProjectTreeWorkspaceService(snapshotFactory);
        IReadOnlyList<PlacementListItem> placements = await treeWorkspace.ListPlacementsAsync(revisionId, cancellationToken);
        var calculationWorkspace = new CalculationWorkspaceService(snapshotFactory);
        IReadOnlyList<CalculationResultListItem> calculationResults = await calculationWorkspace.ListResultsAsync(revisionId, cancellationToken);
        var responsibilityWorkspace = new ResponsibilityWorkspaceService(snapshotFactory);
        IReadOnlyList<ResponsibilityAssignmentListItem> responsibilities = await responsibilityWorkspace.ListAssignmentsAsync(revisionId, cancellationToken);
        return new ProjectReportData(
            revisionId,
            project.Code,
            project.Name,
            revision.Code,
            DateTime.UtcNow,
            sources,
            summaries,
            BuildClassificationSummaries(summaries, placements),
            BuildContextSummaries(sources, placements),
            BuildPurchaseItems(summaries, calculationResults),
            responsibilities,
            calculationResults.Select(result => new ReportCalculationCheckItem(
                result.Id,
                result.TargetPlacementId,
                result.TargetPlacementCode,
                result.TargetPlacementName,
                result.RuleCode,
                result.RuleVersionNumber,
                result.Status,
                result.ProposedQuantity,
                result.PurchaseQuantity,
                result.UsedQuantity,
                result.OverrideReason)).ToList());
    }

    /// <inheritdoc />
    public async Task<ProjectReportExportResult> ExportExcelAsync(Guid revisionId, string outputPath, CancellationToken cancellationToken = default) =>
        await ExportAsync(await BuildReportDataAsync(revisionId, cancellationToken), outputPath, ReportFormat.Excel, "Excel", cancellationToken);

    /// <inheritdoc />
    public async Task<ProjectReportExportResult> ExportPdfAsync(Guid revisionId, string outputPath, CancellationToken cancellationToken = default) =>
        await ExportAsync(await BuildReportDataAsync(revisionId, cancellationToken), outputPath, ReportFormat.Pdf, "PDF", cancellationToken);

    /// <inheritdoc />
    public async Task<ProjectReportExportResult> ExportWordAsync(Guid revisionId, string outputPath, CancellationToken cancellationToken = default) =>
        await ExportAsync(await BuildReportDataAsync(revisionId, cancellationToken), outputPath, ReportFormat.Word, "Word", cancellationToken);

    public async Task<ProjectReportData> BuildSubtreeReportDataAsync(Guid revisionId, Guid rootPlacementId, CancellationToken cancellationToken = default)
    {
        ProjectReportData full = await BuildReportDataAsync(revisionId, cancellationToken);
        var tree = new ProjectTreeWorkspaceService(contextFactory);
        IReadOnlyList<PlacementListItem> placements = await tree.ListPlacementsAsync(revisionId, cancellationToken);
        if (!placements.Any(x => x.Id == rootPlacementId)) throw new DomainRuleViolationException("report.root", "Report root placement was not found.");
        var ids = new HashSet<Guid> { rootPlacementId };
        bool changed;
        do
        {
            changed = false;
            foreach (PlacementListItem placement in placements.Where(x => x.ParentPlacementId is Guid parent && ids.Contains(parent)))
                changed |= ids.Add(placement.Id);
        } while (changed);
        IReadOnlyList<MeasurementListItem> sources = full.SourceMeasurements.Where(x => ids.Contains(x.PlacementId)).ToList();
        IReadOnlyList<MeasurementSummaryItem> summaries = full.Summaries.Where(x => ids.Contains(x.PlacementId)).ToList();
        // Seçilenlerin bütün üst kartları bir kez toplanıyor. Önceki hâl bunu
        // her yerleşim için yeniden hesaplıyor ve her çağrıda placements'ın
        // tamamından yeni bir sözlük kuruyordu.
        HashSet<Guid> ancestorsOfSelected = CollectAncestors(ids, placements);
        IReadOnlyList<PlacementListItem> selectedPlacements = placements.Where(x => ids.Contains(x.Id) || ancestorsOfSelected.Contains(x.Id)).ToList();
        return full with
        {
            SourceMeasurements = sources,
            Summaries = summaries,
            ClassificationSummaries = BuildClassificationSummaries(summaries, selectedPlacements),
            ContextSummaries = BuildContextSummaries(sources, selectedPlacements),
            PurchaseItems = full.PurchaseItems.Where(x => ids.Contains(x.PlacementId)).ToList(),
            Responsibilities = full.Responsibilities.Where(x => x.PlacementId is Guid id && ids.Contains(id)).ToList(),
            CalculationChecks = full.CalculationChecks.Where(x => ids.Contains(x.TargetPlacementId)).ToList()
        };
    }

    /// <inheritdoc />
    public async Task<ProjectReportExportResult> ExportSubtreeExcelAsync(Guid revisionId, Guid rootPlacementId, string outputPath, CancellationToken cancellationToken = default) =>
        await ExportAsync(await BuildSubtreeReportDataAsync(revisionId, rootPlacementId, cancellationToken), outputPath, ReportFormat.Excel, "Excel-Subtree", cancellationToken);

    /// <inheritdoc />
    public async Task<ProjectReportExportResult> ExportSubtreePdfAsync(Guid revisionId, Guid rootPlacementId, string outputPath, CancellationToken cancellationToken = default) =>
        await ExportAsync(await BuildSubtreeReportDataAsync(revisionId, rootPlacementId, cancellationToken), outputPath, ReportFormat.Pdf, "PDF-Subtree", cancellationToken);

    /// <inheritdoc />
    public async Task<ProjectReportExportResult> ExportSubtreeWordAsync(Guid revisionId, Guid rootPlacementId, string outputPath, CancellationToken cancellationToken = default) =>
        await ExportAsync(await BuildSubtreeReportDataAsync(revisionId, rootPlacementId, cancellationToken), outputPath, ReportFormat.Word, "Word-Subtree", cancellationToken);

    private enum ReportFormat
    {
        Excel,
        Pdf,
        Word
    }

    /// <summary>Altı dışa aktarım yolunun ortak gövdesi.</summary>
    /// <remarks>
    /// Bu altı metot birbirinin kopyasıydı; yalnızca hangi yazıcıyı çağırdıkları
    /// ve denetim kaydındaki etiket farklıydı. Üstelik ikisi aynı işi iki farklı
    /// yazım stilinde yapıyordu.
    /// </remarks>
    private async Task<ProjectReportExportResult> ExportAsync(
        ProjectReportData report,
        string outputPath,
        ReportFormat format,
        string auditLabel,
        CancellationToken cancellationToken)
    {
        string path = ValidateOutputPath(outputPath, format switch
        {
            ReportFormat.Excel => ".xlsx",
            ReportFormat.Pdf => ".pdf",
            _ => ".docx"
        });

        switch (format)
        {
            case ReportFormat.Excel:
                WriteWorkbook(path, report);
                break;
            case ReportFormat.Pdf:
                WritePdf(path, report);
                break;
            default:
                WriteDocx(path, report);
                break;
        }

        await AddExportAuditAsync(report, path, auditLabel, cancellationToken);
        return ToExportResult(report, path);
    }

    private static void WriteWorkbook(string path, ProjectReportData report)
    {
        using var workbook = new XLWorkbook();
        WriteSummaryWorksheet(workbook, report);
        WriteClassificationWorksheet(workbook, report);
        WriteContextWorksheet(workbook, report);
        WriteSourceWorksheet(workbook, report);
        WritePurchaseWorksheet(workbook, report);
        WriteResponsibilityWorksheet(workbook, report);
        WriteCalculationCheckWorksheet(workbook, report);
        workbook.SaveAs(path);
    }

    private static void WritePdf(string path, ProjectReportData report)
    {
        EnsurePdfFontsConfigured();
        var renderer = new PdfDocumentRenderer { Document = BuildPdfDocument(report) };
        renderer.RenderDocument();
        renderer.PdfDocument.Save(path);
    }

    /// <summary>Seçili yerleşimlerin bütün üst kartlarını tek geçişte toplar.</summary>
    private static HashSet<Guid> CollectAncestors(HashSet<Guid> selected, IReadOnlyList<PlacementListItem> placements)
    {
        var parentById = placements.ToDictionary(x => x.Id, x => x.ParentPlacementId);
        var ancestors = new HashSet<Guid>();
        foreach (Guid id in selected)
        {
            Guid? cursor = parentById.GetValueOrDefault(id);
            // `ancestors`'a ekleyemediğimiz an ya zaten yürüdüğümüz bir zincire
            // girmişizdir ya da bozuk veri bir döngü oluşturmuştur; ikisinde de
            // durmak doğru. Önceki hâlde döngü korumasi yoktu.
            while (cursor is Guid parent && ancestors.Add(parent))
            {
                cursor = parentById.GetValueOrDefault(parent);
            }
        }

        return ancestors;
    }

    private static void WriteDocx(string path, ProjectReportData report)
    {
        using var document = WordprocessingDocument.Create(
            path,
            DocumentFormat.OpenXml.WordprocessingDocumentType.Document);
        MainDocumentPart mainPart = document.AddMainDocumentPart();
        mainPart.Document = new W.Document(new W.Body());
        W.Body body = mainPart.Document.Body!;

        body.Append(CreateWordParagraph("Proje Metraj Özeti", 34, bold: true, color: "1F4E78"));
        body.Append(CreateWordParagraph(
            $"{report.ProjectCode} — {report.ProjectName} | {report.RevisionCode} | Üretim (UTC): {report.GeneratedAtUtc:yyyy-MM-dd HH:mm:ss}",
            18,
            bold: false,
            color: "4B5563"));

        AddWordTable(body, "Malzeme özeti",
            ["Malzeme", "Kod", "Çap / Boyut", "Çeşit", "Satır", "Birim", "Net", "Fireli", "Satın alma"],
            report.Summaries.Select(item => (IReadOnlyList<string?>)
            [
                item.PlacementName, item.PlacementCode, item.Variant, item.SecondaryVariant,
                item.MeasurementCount.ToString(CultureInfo.InvariantCulture), item.Unit,
                FormatQuantity(item.NetQuantity), FormatQuantity(item.WithWasteQuantity), FormatQuantity(item.PurchaseQuantity)
            ]));
        AddWordTable(body, "Sistem ve kategori özeti",
            ["Kategori", "Sistem", "Poz", "Kod", "Malzeme", "Çap / Boyut", "Çeşit", "Satır", "Birim", "Net", "Fireli", "Satın alma"],
            report.ClassificationSummaries.Select(item => (IReadOnlyList<string?>)
            [
                item.Category, item.System, item.PositionNumber, item.Code, item.Name, item.Variant, item.SecondaryVariant,
                item.MeasurementCount.ToString(CultureInfo.InvariantCulture), item.Unit,
                FormatQuantity(item.NetQuantity), FormatQuantity(item.WithWasteQuantity), FormatQuantity(item.PurchaseQuantity)
            ]), pageBreakBefore: true);
        AddWordTable(body, "Kat ve mahal özeti",
            ["Blok", "Kat", "Mahal", "Bölge", "Pafta", "Çizim rev.", "Poz", "Kod", "Malzeme", "Satır", "Birim", "Net"],
            report.ContextSummaries.Select(item => (IReadOnlyList<string?>)
            [
                item.Block, item.Floor, item.Room, item.Zone, item.Sheet, item.DrawingRevision, item.PositionNumber,
                item.Code, item.Name, item.SourceLineCount.ToString(CultureInfo.InvariantCulture), item.Unit, FormatQuantity(item.NetQuantity)
            ]), pageBreakBefore: true);
        AddWordTable(body, "Satın alma listesi",
            ["Malzeme", "Kod", "Çap / Boyut", "Çeşit", "Kaynak", "Kural", "Birim", "Net", "Fireli", "Satın alma", "Satın alma birimi", "Kullanılan"],
            report.PurchaseItems.Select(item => (IReadOnlyList<string?>)
            [
                item.Name, item.Code, item.Variant, item.SecondaryVariant, item.QuantitySource, item.CalculationRule, item.Unit,
                FormatQuantity(item.NetQuantity), FormatQuantity(item.WithWasteQuantity), FormatQuantity(item.PurchaseQuantity),
                item.PurchaseUnit ?? item.Unit,
                item.UsedQuantity is decimal used ? FormatQuantity(used) : null
            ]), pageBreakBefore: true);
        AddWordTable(body, "Sorumluluk özeti",
            ["Yerleşim", "Boyut", "Taraf", "Durum", "Atama kaynağı", "Not"],
            report.Responsibilities.Select(item => (IReadOnlyList<string?>)
            [
                item.PlacementName, item.DimensionName, item.PartyName, item.State.ToString(),
                item.IsInherited ? $"Kalıtılmış: {item.SourcePlacementName}" : "Doğrudan", item.Notes
            ]), pageBreakBefore: true);
        AddWordTable(body, "Hesap kontrol listesi",
            ["Hedef", "Kod", "Kural", "Sürüm", "Durum", "Öneri", "Satın alma", "Kullanılan", "Gerekçe"],
            report.CalculationChecks.Select(item => (IReadOnlyList<string?>)
            [
                item.TargetName, item.TargetCode, item.Rule, item.RuleVersion.ToString(CultureInfo.InvariantCulture), item.Status.ToString(),
                FormatQuantity(item.ProposedQuantity), FormatQuantity(item.PurchaseQuantity),
                item.UsedQuantity is decimal used ? FormatQuantity(used) : null, item.Reason
            ]), pageBreakBefore: true);
        AddWordTable(body, "Metraj kaynak satırları",
            ["Malzeme", "Kod", "Çap / Boyut", "Çeşit", "Kaynak", "Miktar", "Birim", "Blok", "Kat", "Mahal", "Bölge", "Pafta", "Çizim rev.", "Not"],
            report.SourceMeasurements.Select(item => (IReadOnlyList<string?>)
            [
                item.PlacementName, item.PlacementCode, item.Variant, item.SecondaryVariant, item.SourceKind,
                FormatQuantity(item.InputQuantity), item.InputUnit, item.Block, item.Floor, item.Room, item.Zone,
                item.Sheet, item.DrawingRevision, item.Notes
            ]), pageBreakBefore: true);

        body.Append(new W.SectionProperties(
            new W.PageSize { Width = 15840U, Height = 12240U, Orient = W.PageOrientationValues.Landscape },
            new W.PageMargin { Top = 576, Right = 576U, Bottom = 576, Left = 576U, Header = 288U, Footer = 288U, Gutter = 0U }));
        mainPart.Document.Save();
    }

    private static void AddWordTable(
        W.Body body,
        string title,
        IReadOnlyList<string> headers,
        IEnumerable<IReadOnlyList<string?>> rows,
        bool pageBreakBefore = false)
    {
        W.Paragraph titleParagraph = CreateWordParagraph(title, 26, bold: true, color: "1F4E78");
        if (pageBreakBefore)
        {
            titleParagraph.ParagraphProperties!.InsertAt(new W.PageBreakBefore(), 0);
        }

        body.Append(titleParagraph);
        var table = new W.Table();
        table.Append(new W.TableProperties(
            new W.TableWidth { Width = "5000", Type = W.TableWidthUnitValues.Pct },
            new W.TableBorders(
                new W.TopBorder { Val = W.BorderValues.Single, Size = 4U, Color = "9AA8BC" },
                new W.LeftBorder { Val = W.BorderValues.Single, Size = 4U, Color = "9AA8BC" },
                new W.BottomBorder { Val = W.BorderValues.Single, Size = 4U, Color = "9AA8BC" },
                new W.RightBorder { Val = W.BorderValues.Single, Size = 4U, Color = "9AA8BC" },
                new W.InsideHorizontalBorder { Val = W.BorderValues.Single, Size = 3U, Color = "CBD5E1" },
                new W.InsideVerticalBorder { Val = W.BorderValues.Single, Size = 3U, Color = "CBD5E1" }),
            new W.TableLayout { Type = W.TableLayoutValues.Autofit }));
        table.Append(new W.TableGrid(headers.Select(_ => new W.GridColumn())));

        var headerRow = new W.TableRow(new W.TableRowProperties(new W.TableHeader()));
        foreach (string header in headers)
        {
            headerRow.Append(CreateWordCell(header, header: true));
        }

        table.Append(headerRow);
        var materializedRows = rows.ToList();
        if (materializedRows.Count == 0)
        {
            var emptyRow = new W.TableRow();
            for (int index = 0; index < headers.Count; index++)
            {
                emptyRow.Append(CreateWordCell(index == 0 ? "Kayıt yok" : string.Empty, header: false));
            }

            table.Append(emptyRow);
        }
        else
        {
            foreach (IReadOnlyList<string?> values in materializedRows)
            {
                var row = new W.TableRow();
                foreach (string? value in values)
                {
                    row.Append(CreateWordCell(value, header: false));
                }

                table.Append(row);
            }
        }

        body.Append(table);
    }

    private static W.TableCell CreateWordCell(string? text, bool header)
    {
        var properties = new W.TableCellProperties();
        if (header)
        {
            properties.Append(new W.Shading { Fill = "1F4E78", Val = W.ShadingPatternValues.Clear });
        }

        properties.Append(
            new W.TableCellMargin(
                new W.TopMargin { Width = "60", Type = W.TableWidthUnitValues.Dxa },
                new W.LeftMargin { Width = "70", Type = W.TableWidthUnitValues.Dxa },
                new W.BottomMargin { Width = "60", Type = W.TableWidthUnitValues.Dxa },
                new W.RightMargin { Width = "70", Type = W.TableWidthUnitValues.Dxa }),
            new W.TableCellVerticalAlignment { Val = W.TableVerticalAlignmentValues.Center });

        return new W.TableCell(properties, CreateWordParagraph(text ?? string.Empty, 15, header, header ? "FFFFFF" : "111827"));
    }

    private static W.Paragraph CreateWordParagraph(string text, int halfPointSize, bool bold, string color)
    {
        var runProperties = new W.RunProperties(new W.RunFonts { Ascii = "Aptos", HighAnsi = "Aptos" });
        if (bold)
        {
            runProperties.Append(new W.Bold());
        }

        runProperties.Append(
            new W.Color { Val = color },
            new W.FontSize { Val = halfPointSize.ToString(CultureInfo.InvariantCulture) });

        return new W.Paragraph(
            new W.ParagraphProperties(new W.SpacingBetweenLines { After = "80", Line = "220", LineRule = W.LineSpacingRuleValues.Auto }),
            new W.Run(runProperties, new W.Text(text) { Space = DocumentFormat.OpenXml.SpaceProcessingModeValues.Preserve }));
    }

    private static List<ReportClassificationSummaryItem> BuildClassificationSummaries(
        IReadOnlyList<MeasurementSummaryItem> summaries,
        IReadOnlyList<PlacementListItem> placements)
    {
        var byPlacementId = placements.ToDictionary(item => item.Id);
        return summaries.Select(summary =>
            {
                List<PlacementListItem> lineage = GetLineage(summary.PlacementId, byPlacementId);
                PlacementListItem? category = lineage.FirstOrDefault(item => item.CardType == CardType.Category);
                PlacementListItem? system = lineage.FirstOrDefault(item => item.CardType == CardType.System);
                PlacementListItem? placement = byPlacementId.GetValueOrDefault(summary.PlacementId);
                return new ReportClassificationSummaryItem(
                    category?.DisplayName ?? "Sınıflandırılmamış",
                    system?.DisplayName ?? "Sınıflandırılmamış",
                    placement?.PositionNumber,
                    summary.PlacementCode,
                    summary.PlacementName,
                    summary.Unit,
                    summary.MeasurementCount,
                    summary.NetQuantity,
                    summary.WithWasteQuantity,
                    summary.PurchaseQuantity,
                    summary.Variant,
                    summary.SecondaryVariant);
            })
            .OrderBy(item => item.Category, StringComparer.Ordinal)
            .ThenBy(item => item.System, StringComparer.Ordinal)
            .ThenBy(item => item.Code, StringComparer.Ordinal)
            .ToList();
    }

    private static List<ReportContextSummaryItem> BuildContextSummaries(
        IReadOnlyList<MeasurementListItem> sources,
        IReadOnlyList<PlacementListItem> placements)
    {
        var placementsById = placements.ToDictionary(item => item.Id);
        return sources
            .Select(source => new
            {
                Source = source,
                PositionNumber = placementsById.GetValueOrDefault(source.PlacementId)?.PositionNumber
            })
            .GroupBy(item => new
            {
                Block = DisplayContext(item.Source.Block),
                Floor = DisplayContext(item.Source.Floor),
                Room = DisplayContext(item.Source.Room),
                Zone = DisplayContext(item.Source.Zone),
                Sheet = DisplayContext(item.Source.Sheet),
                DrawingRevision = DisplayContext(item.Source.DrawingRevision),
                item.PositionNumber,
                item.Source.PlacementCode,
                item.Source.PlacementName,
                item.Source.InputUnit
            })
            .Select(group => new ReportContextSummaryItem(
                group.Key.Block,
                group.Key.Floor,
                group.Key.Room,
                group.Key.Zone,
                group.Key.Sheet,
                group.Key.DrawingRevision,
                group.Key.PositionNumber,
                group.Key.PlacementCode,
                group.Key.PlacementName,
                group.Key.InputUnit,
                group.Count(),
                group.Sum(item => item.Source.InputQuantity)))
            .OrderBy(item => item.Block, StringComparer.Ordinal)
            .ThenBy(item => item.Floor, StringComparer.Ordinal)
            .ThenBy(item => item.Room, StringComparer.Ordinal)
            .ThenBy(item => item.Code, StringComparer.Ordinal)
            .ToList();
    }

    private static List<PlacementListItem> GetLineage(Guid placementId, Dictionary<Guid, PlacementListItem> placementsById)
    {
        var lineage = new List<PlacementListItem>();
        var visited = new HashSet<Guid>();
        Guid? currentId = placementId;
        while (currentId is Guid id && visited.Add(id) && placementsById.TryGetValue(id, out PlacementListItem? placement))
        {
            lineage.Add(placement);
            currentId = placement.ParentPlacementId;
        }

        return lineage;
    }

    private static string DisplayContext(string? value) => string.IsNullOrWhiteSpace(value) ? "—" : value;

    private static List<ReportPurchaseItem> BuildPurchaseItems(
        IReadOnlyList<MeasurementSummaryItem> summaries,
        IReadOnlyList<CalculationResultListItem> calculationResults)
    {
        // Satın alma birimi girdi biriminden ayrıdır: 13 boy boru 13 metre değildir.
        // Önceden rapora girdi birimi yazılıyordu ve tedarikçiye yanlış birim gidiyordu.
        var direct = summaries.Select(item => new ReportPurchaseItem(
            item.PlacementId, item.PlacementCode, item.PlacementName, item.Unit, "Kaynak metraj",
            item.NetQuantity, item.WithWasteQuantity, item.PurchaseQuantity, item.PurchaseQuantity, null,
            item.Variant, item.SecondaryVariant, item.PurchaseUnit ?? item.Unit));
        var directlyMeasuredPlacementIds = summaries.Select(x => x.PlacementId).ToHashSet();
        var derived = calculationResults
            .Where(result => result.Status is CalculationResultStatus.Approved or CalculationResultStatus.Overridden)
            .Where(result => !directlyMeasuredPlacementIds.Contains(result.TargetPlacementId))
            .Where(result => IsFixedMultiplier(result.InputSummary))
            .GroupBy(result => result.TargetPlacementId)
            .Select(group => group.OrderByDescending(result => result.CreatedAtUtc).ThenByDescending(result => result.Id).First())
            .Select(result => new ReportPurchaseItem(
                result.TargetPlacementId,
                result.TargetPlacementCode,
                result.TargetPlacementName,
                result.Unit,
                "Onaylı hesap önerisi",
                result.NetQuantity,
                result.WithWasteQuantity,
                result.PurchaseQuantity,
                result.UsedQuantity,
                $"{result.RuleCode} v{result.RuleVersionNumber}",
                null,
                null,
                result.Unit));
        return direct.Concat(derived)
            .OrderBy(item => item.Code, StringComparer.Ordinal)
            .ThenBy(item => item.Name, StringComparer.Ordinal)
            .ToList();
    }

    private static bool IsFixedMultiplier(string inputSummary)
    {
        try
        {
            using var document = JsonDocument.Parse(inputSummary);
            return document.RootElement.TryGetProperty("Mode", out JsonElement mode) &&
                string.Equals(mode.GetString(), CalculationRuleMode.FixedMultiplier.ToString(), StringComparison.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task AddExportAuditAsync(ProjectReportData report, string path, string format, CancellationToken cancellationToken)
    {
        await using MetrajDbContext context = contextFactory();
        context.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.NewGuid(),
            ProjectRevisionId = report.RevisionId,
            EntityType = "ProjectReport",
            EntityId = Guid.NewGuid(),
            EventType = "report-exported",
            DetailsJson = JsonSerializer.Serialize(new
            {
                Format = format,
                FileName = Path.GetFileName(path),
                report.RevisionCode,
                SourceMeasurementCount = report.SourceMeasurements.Count,
                SummaryCount = report.Summaries.Count,
                CalculationResultIds = report.CalculationChecks.Select(x => x.ResultId)
            }),
            OccurredAtUtc = DateTime.UtcNow
        });
        await context.SaveChangesAsync(cancellationToken);
    }

    private static void WriteSummaryWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Özet");
        sheet.Cell(1, 1).Value = "Proje Metraj Özeti";
        sheet.Range(1, 1, 1, 9).Merge();
        sheet.Cell(2, 1).Value = "Proje";
        sheet.Cell(2, 2).Value = SafeCellText($"{report.ProjectCode} — {report.ProjectName}");
        sheet.Cell(3, 1).Value = "Revizyon";
        sheet.Cell(3, 2).Value = SafeCellText(report.RevisionCode);
        sheet.Cell(4, 1).Value = "Üretim (UTC)";
        sheet.Cell(4, 2).Value = report.GeneratedAtUtc;
        sheet.Cell(4, 2).Style.DateFormat.Format = "yyyy-MM-dd HH:mm:ss";

        ExcelColumn[] columns =
        [
            Text("Malzeme", 32),
            Text("Kod", 19),
            Quantity("Satır", 11),
            Text("Birim", 11),
            Quantity("Net", 14),
            Quantity("Fireli", 14),
            Quantity("Satın alma (boy/adet)", 14),
            Text("Çap / Boyut", 17),
            Text("Çeşit", 17)
        ];
        WriteHeaderRow(sheet, 6, columns);

        int row = 7;
        foreach (MeasurementSummaryItem item in report.Summaries)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.PlacementName);
            sheet.Cell(row, 2).Value = SafeCellText(item.PlacementCode);
            sheet.Cell(row, 3).Value = item.MeasurementCount;
            sheet.Cell(row, 4).Value = SafeCellText(item.Unit);
            sheet.Cell(row, 5).Value = item.NetQuantity;
            sheet.Cell(row, 6).Value = item.WithWasteQuantity;
            sheet.Cell(row, 7).Value = item.PurchaseQuantity;
            sheet.Cell(row, 8).Value = SafeCellText(item.Variant);
            sheet.Cell(row, 9).Value = SafeCellText(item.SecondaryVariant);
            row++;
        }

        ApplyWorksheetStyle(sheet, 6, row - 1, columns);
    }

    private static void EnsurePdfFontsConfigured()
    {
        lock (PdfFontConfigurationLock)
        {
            if (pdfFontsConfigured)
            {
                return;
            }

            if (!OperatingSystem.IsWindows())
            {
                throw new PlatformNotSupportedException("PDF raporu bu masaüstü uygulamasında Windows yazı tiplerini kullanır.");
            }

            GlobalFontSettings.UseWindowsFontsUnderWindows = true;
            pdfFontsConfigured = true;
        }
    }

    private static void WriteClassificationWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Sistem-Kategori");
        sheet.Cell(1, 1).Value = "Sistem ve Kategori Özeti";
        sheet.Range(1, 1, 1, 12).Merge();
        ExcelColumn[] columns =
        [
            Text("Kategori", 22),
            Text("Sistem", 22),
            Text("Poz", 14),
            Text("Kod", 19),
            Text("Malzeme", 32),
            Quantity("Satır", 11),
            Text("Birim", 11),
            Quantity("Net", 14),
            Quantity("Fireli", 14),
            Quantity("Satın alma", 14),
            Text("Çap / Boyut", 17),
            Text("Çeşit", 17)
        ];
        WriteHeaderRow(sheet, 3, columns);

        int row = 4;
        foreach (ReportClassificationSummaryItem item in report.ClassificationSummaries)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.Category);
            sheet.Cell(row, 2).Value = SafeCellText(item.System);
            sheet.Cell(row, 3).Value = SafeCellText(item.PositionNumber);
            sheet.Cell(row, 4).Value = SafeCellText(item.Code);
            sheet.Cell(row, 5).Value = SafeCellText(item.Name);
            sheet.Cell(row, 6).Value = item.MeasurementCount;
            sheet.Cell(row, 7).Value = SafeCellText(item.Unit);
            sheet.Cell(row, 8).Value = item.NetQuantity;
            sheet.Cell(row, 9).Value = item.WithWasteQuantity;
            sheet.Cell(row, 10).Value = item.PurchaseQuantity;
            sheet.Cell(row, 11).Value = SafeCellText(item.Variant);
            sheet.Cell(row, 12).Value = SafeCellText(item.SecondaryVariant);
            row++;
        }

        ApplyWorksheetStyle(sheet, 3, row - 1, columns);
    }

    private static void WriteContextWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Kat-Mahal");
        sheet.Cell(1, 1).Value = "Kat ve Mahal Metraj Özeti";
        sheet.Range(1, 1, 1, 12).Merge();
        ExcelColumn[] columns =
        [
            Text("Blok", 14),
            Text("Kat", 14),
            Text("Mahal", 14),
            Text("Bölge", 14),
            Text("Pafta", 14),
            Text("Çizim rev.", 14),
            Text("Poz", 14),
            Text("Kod", 19),
            Text("Malzeme", 32),
            Quantity("Satır", 11),
            Text("Birim", 11),
            Quantity("Net", 14)
        ];
        WriteHeaderRow(sheet, 3, columns);

        int row = 4;
        foreach (ReportContextSummaryItem item in report.ContextSummaries)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.Block);
            sheet.Cell(row, 2).Value = SafeCellText(item.Floor);
            sheet.Cell(row, 3).Value = SafeCellText(item.Room);
            sheet.Cell(row, 4).Value = SafeCellText(item.Zone);
            sheet.Cell(row, 5).Value = SafeCellText(item.Sheet);
            sheet.Cell(row, 6).Value = SafeCellText(item.DrawingRevision);
            sheet.Cell(row, 7).Value = SafeCellText(item.PositionNumber);
            sheet.Cell(row, 8).Value = SafeCellText(item.Code);
            sheet.Cell(row, 9).Value = SafeCellText(item.Name);
            sheet.Cell(row, 10).Value = item.SourceLineCount;
            sheet.Cell(row, 11).Value = SafeCellText(item.Unit);
            sheet.Cell(row, 12).Value = item.NetQuantity;
            row++;
        }

        ApplyWorksheetStyle(sheet, 3, row - 1, columns);
    }

    private static void WriteSourceWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Kaynak Satırları");
        sheet.Cell(1, 1).Value = "Metraj Kaynak Satırları";
        sheet.Range(1, 1, 1, 14).Merge();
        // Çap ve çeşit, bu uygulamanın metrajındaki temel ayrımdır; denetim için
        // kaynak satırlarını çıkaran kullanıcı hangi satırın hangi çapa ait
        // olduğunu göremiyordu (Word'de vardı, PDF ve Excel'de yoktu).
        ExcelColumn[] columns =
        [
            Text("Malzeme", 32),
            Text("Kod", 19),
            Text("Çap / Boyut", 17),
            Text("Çeşit", 17),
            Text("Kaynak", 18),
            Quantity("Miktar", 14),
            Text("Birim", 11),
            Text("Blok", 14),
            Text("Kat", 14),
            Text("Mahal", 14),
            Text("Bölge", 14),
            Text("Pafta", 14),
            Text("Çizim rev.", 14),
            Text("Not", 28)
        ];
        WriteHeaderRow(sheet, 3, columns);

        int row = 4;
        foreach (MeasurementListItem item in report.SourceMeasurements)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.PlacementName);
            sheet.Cell(row, 2).Value = SafeCellText(item.PlacementCode);
            sheet.Cell(row, 3).Value = SafeCellText(item.Variant);
            sheet.Cell(row, 4).Value = SafeCellText(item.SecondaryVariant);
            sheet.Cell(row, 5).Value = SafeCellText(item.SourceKind);
            sheet.Cell(row, 6).Value = item.InputQuantity;
            sheet.Cell(row, 7).Value = SafeCellText(item.InputUnit);
            sheet.Cell(row, 8).Value = SafeCellText(item.Block);
            sheet.Cell(row, 9).Value = SafeCellText(item.Floor);
            sheet.Cell(row, 10).Value = SafeCellText(item.Room);
            sheet.Cell(row, 11).Value = SafeCellText(item.Zone);
            sheet.Cell(row, 12).Value = SafeCellText(item.Sheet);
            sheet.Cell(row, 13).Value = SafeCellText(item.DrawingRevision);
            sheet.Cell(row, 14).Value = SafeCellText(item.Notes);
            row++;
        }

        ApplyWorksheetStyle(sheet, 3, row - 1, columns);
    }

    private static void WritePurchaseWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Satın Alma");
        sheet.Cell(1, 1).Value = "Satın Alma Listesi";
        sheet.Range(1, 1, 1, 12).Merge();
        ExcelColumn[] columns =
        [
            Text("Malzeme", 32),
            Text("Kod", 19),
            Text("Kaynak", 18),
            Text("Kural", 18),
            Text("Birim", 11),
            Quantity("Net", 14),
            Quantity("Fireli", 14),
            Quantity("Satın alma", 14),
            Text("Satın alma birimi", 15),
            Quantity("Kullanılan", 14),
            Text("Çap / Boyut", 17),
            Text("Çeşit", 17)
        ];
        WriteHeaderRow(sheet, 3, columns);

        int row = 4;
        foreach (ReportPurchaseItem item in report.PurchaseItems)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.Name);
            sheet.Cell(row, 2).Value = SafeCellText(item.Code);
            sheet.Cell(row, 3).Value = SafeCellText(item.QuantitySource);
            sheet.Cell(row, 4).Value = SafeCellText(item.CalculationRule);
            sheet.Cell(row, 5).Value = SafeCellText(item.Unit);
            sheet.Cell(row, 6).Value = item.NetQuantity;
            sheet.Cell(row, 7).Value = item.WithWasteQuantity;
            sheet.Cell(row, 8).Value = item.PurchaseQuantity;
            sheet.Cell(row, 9).Value = SafeCellText(item.PurchaseUnit ?? item.Unit);
            sheet.Cell(row, 10).Value = item.UsedQuantity;
            sheet.Cell(row, 11).Value = SafeCellText(item.Variant);
            sheet.Cell(row, 12).Value = SafeCellText(item.SecondaryVariant);
            row++;
        }

        ApplyWorksheetStyle(sheet, 3, row - 1, columns);
    }

    private static void WriteResponsibilityWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Sorumluluk");
        sheet.Cell(1, 1).Value = "Sorumluluk Özeti";
        sheet.Range(1, 1, 1, 7).Merge();
        ExcelColumn[] columns =
        [
            Text("Boyut", 14),
            Text("Yerleşim", 22),
            Text("Taraf", 14),
            Text("Durum", 11),
            Text("Kaynak", 18),
            Text("Kalıtılmış", 14),
            Text("Not", 28)
        ];
        WriteHeaderRow(sheet, 3, columns);

        int row = 4;
        foreach (ResponsibilityAssignmentListItem item in report.Responsibilities)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.DimensionName);
            sheet.Cell(row, 2).Value = SafeCellText(item.PlacementName);
            sheet.Cell(row, 3).Value = SafeCellText(item.PartyName);
            sheet.Cell(row, 4).Value = item.State.ToString();
            sheet.Cell(row, 5).Value = SafeCellText(item.SourcePlacementName);
            sheet.Cell(row, 6).Value = item.IsInherited ? "Evet" : "Hayır";
            sheet.Cell(row, 7).Value = SafeCellText(item.Notes);
            row++;
        }

        ApplyWorksheetStyle(sheet, 3, row - 1, columns);
    }

    private static void WriteCalculationCheckWorksheet(XLWorkbook workbook, ProjectReportData report)
    {
        IXLWorksheet sheet = workbook.Worksheets.Add("Hesap Kontrol");
        sheet.Cell(1, 1).Value = "Hesap Önerisi ve Kontrol Listesi";
        sheet.Range(1, 1, 1, 9).Merge();
        ExcelColumn[] columns =
        [
            Text("Hedef", 32),
            Text("Kod", 19),
            Text("Kural", 18),
            Text("Sürüm", 11),
            Text("Durum", 11),
            Text("Öneri", 14),
            Quantity("Satın alma", 14),
            Quantity("Kullanılan", 14),
            Text("Gerekçe", 28)
        ];
        WriteHeaderRow(sheet, 3, columns);

        int row = 4;
        foreach (ReportCalculationCheckItem item in report.CalculationChecks)
        {
            sheet.Cell(row, 1).Value = SafeCellText(item.TargetName);
            sheet.Cell(row, 2).Value = SafeCellText(item.TargetCode);
            sheet.Cell(row, 3).Value = SafeCellText(item.Rule);
            sheet.Cell(row, 4).Value = item.RuleVersion;
            sheet.Cell(row, 5).Value = item.Status.ToString();
            sheet.Cell(row, 6).Value = item.ProposedQuantity;
            sheet.Cell(row, 7).Value = item.PurchaseQuantity;
            sheet.Cell(row, 8).Value = item.UsedQuantity;
            sheet.Cell(row, 9).Value = SafeCellText(item.Reason);
            row++;
        }

        ApplyWorksheetStyle(sheet, 3, row - 1, columns);
    }

    private static void ApplyWorksheetStyle(IXLWorksheet sheet, int headerRow, int finalRow, IReadOnlyList<ExcelColumn> columns)
    {
        int finalColumn = columns.Count;
        IXLRange title = sheet.Range(1, 1, 1, finalColumn);
        title.Style.Font.Bold = true;
        title.Style.Font.FontSize = 15;
        title.Style.Fill.BackgroundColor = XLColor.FromHtml("1F4E78");
        title.Style.Font.FontColor = XLColor.White;
        title.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        sheet.Row(1).Height = 25;
        IXLRange header = sheet.Range(headerRow, 1, headerRow, finalColumn);
        header.Style.Font.Bold = true;
        header.Style.Font.FontColor = XLColor.FromHtml("17324D");
        header.Style.Fill.BackgroundColor = XLColor.FromHtml("D9EAF7");
        header.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        header.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        header.Style.Alignment.WrapText = true;
        header.Style.Border.BottomBorder = XLBorderStyleValues.Medium;
        sheet.Row(headerRow).Height = 32;
        if (finalRow >= headerRow)
        {
            IXLRange dataRange = sheet.Range(headerRow, 1, finalRow, finalColumn);
            dataRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            dataRange.Style.Border.InsideBorder = XLBorderStyleValues.Hair;
            dataRange.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            dataRange.Style.Alignment.WrapText = true;
            for (int row = headerRow + 1; row <= finalRow; row++)
            {
                if ((row - headerRow) % 2 == 0)
                {
                    sheet.Range(row, 1, row, finalColumn).Style.Fill.BackgroundColor = XLColor.FromHtml("F4F8FB");
                }
            }
            for (int row = headerRow + 1; row <= finalRow; row++)
            {
                sheet.Row(row).AdjustToContents(1, finalColumn);
                // Tavan 42 punto iken sarılmış uzun notlar hücrede kalıyor ama
                // ne ekranda ne baskıda görünüyordu; teslim edilen belge eksik
                // oluyordu. Sınır, birkaç satırlık nota yetecek kadar yükseltildi.
                sheet.Row(row).Height = Math.Clamp(sheet.Row(row).Height, 18d, 120d);
            }
        }

        sheet.Range(headerRow, 1, Math.Max(finalRow, headerRow), finalColumn).SetAutoFilter();
        sheet.SheetView.FreezeRows(headerRow);
        sheet.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        sheet.PageSetup.FitToPages(1, 0);
        sheet.PageSetup.CenterHorizontally = true;
        sheet.PageSetup.Margins.Left = 0.25;
        sheet.PageSetup.Margins.Right = 0.25;
        sheet.PageSetup.Margins.Top = 0.5;
        sheet.PageSetup.Margins.Bottom = 0.5;

        // İçeriğe göre ayarla ama uzun ad/not sütunlarının tüm sayfayı
        // büyütmesine izin verme; çıktı ekranda ve baskıda dengeli kalır.
        sheet.Columns(1, finalColumn).AdjustToContents(1, Math.Max(finalRow, headerRow), 8, 46);
        // Sayı biçimi ve genişlik artık BAŞLIK METNİNDEN çıkarılmıyor. Önceden
        // bir başlığı yeniden adlandırmak, o sütunun sayı biçimini sessizce
        // düşürüyordu -- ve "Satın alma birimi" bir metin sütunu olduğu için
        // kuralın içinde ayrıca bir istisna taşınıyordu.
        for (int column = 1; column <= finalColumn; column++)
        {
            ExcelColumn descriptor = columns[column - 1];
            if (descriptor.Kind == ExcelColumnKind.Quantity)
            {
                sheet.Column(column).Style.NumberFormat.Format = QuantityNumberFormat;
                sheet.Column(column).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            }

            sheet.Column(column).Width = Math.Clamp(Math.Max(sheet.Column(column).Width, descriptor.PreferredWidth), 9d, 46d);
        }
    }

    /// <summary>Excel sütununun ne taşıdığı: biçimlendirmeyi bu belirler.</summary>
    private enum ExcelColumnKind
    {
        Text,
        Quantity
    }

    /// <summary>Bir Excel sütununun başlığı, türü ve tercih edilen genişliği.</summary>
    /// <remarks>
    /// Sütun tanımları önceden yalnızca <c>string[] headers</c> idi; tür ve
    /// genişlik <c>ApplyWorksheetStyle</c> içinde başlık metnine bakılarak
    /// tahmin ediliyordu. Aynı bilgi böylece iki yerde duruyor ve bir başlık
    /// değiştiğinde sessizce ayrışıyordu.
    /// </remarks>
    private sealed record ExcelColumn(string Header, ExcelColumnKind Kind, double PreferredWidth);

    private static ExcelColumn Text(string header, double preferredWidth) =>
        new(header, ExcelColumnKind.Text, preferredWidth);

    private static ExcelColumn Quantity(string header, double preferredWidth) =>
        new(header, ExcelColumnKind.Quantity, preferredWidth);

    /// <summary>Başlık satırını yazar. Bu döngü yedi sayfada tekrar ediyordu.</summary>
    private static void WriteHeaderRow(IXLWorksheet sheet, int headerRow, IReadOnlyList<ExcelColumn> columns)
    {
        for (int column = 0; column < columns.Count; column++)
        {
            sheet.Cell(headerRow, column + 1).Value = columns[column].Header;
        }
    }

    private static Document BuildPdfDocument(ProjectReportData report)
    {
        var document = new Document();
        Style normal = document.Styles["Normal"] ?? throw new InvalidOperationException("MigraDoc normal stili bulunamadı.");
        normal.Font.Name = "Arial";
        normal.Font.Size = 7.4;
        normal.ParagraphFormat.SpaceAfter = Unit.FromPoint(1.5);
        Style heading = document.Styles["Heading1"] ?? throw new InvalidOperationException("MigraDoc başlık stili bulunamadı.");
        heading.Font.Name = "Arial";
        heading.Font.Size = 15;
        heading.Font.Bold = true;
        heading.Font.Color = Color.FromArgb(255, 31, 78, 120);

        Section summarySection = document.AddSection();
        ConfigureLandscape(summarySection);
        summarySection.AddParagraph("Proje Metraj Özeti", "Heading1");
        summarySection.AddParagraph($"{report.ProjectCode} — {report.ProjectName} | {report.RevisionCode} | Üretim (UTC): {report.GeneratedAtUtc:yyyy-MM-dd HH:mm:ss}");
        AddSummaryTable(summarySection, report.Summaries);

        Section classificationSection = document.AddSection();
        ConfigureLandscape(classificationSection);
        classificationSection.AddParagraph("Sistem ve Kategori Özeti", "Heading1");
        classificationSection.AddParagraph("Her metraj kalemi, proje ağacındaki en yakın kategori ve sistem üst dalıyla birlikte gösterilir.");
        AddClassificationTable(classificationSection, report.ClassificationSummaries);

        Section contextSection = document.AddSection();
        ConfigureLandscape(contextSection);
        contextSection.AddParagraph("Kat ve Mahal Metraj Özeti", "Heading1");
        contextSection.AddParagraph("Kaynak satırları, fiziksel ölçüm bağlamına göre gruplanır; farklı birimler birbirine karıştırılmaz.");
        AddContextTable(contextSection, report.ContextSummaries);

        Section purchaseSection = document.AddSection();
        ConfigureLandscape(purchaseSection);
        purchaseSection.AddParagraph("Satın Alma Listesi", "Heading1");
        purchaseSection.AddParagraph("Doğrudan kaynak metraj ve yalnızca kaynak satırı bulunmayan onaylı türetilmiş kalemler birlikte gösterilir.");
        AddPurchaseTable(purchaseSection, report.PurchaseItems);

        Section responsibilitySection = document.AddSection();
        ConfigureLandscape(responsibilitySection);
        responsibilitySection.AddParagraph("Sorumluluk Özeti", "Heading1");
        responsibilitySection.AddParagraph("Genişletilebilir sorumluluk boyutları, kalıtımın kaynağı ve açık istisnalar raporda görünür tutulur.");
        AddResponsibilityTable(responsibilitySection, report.Responsibilities);

        Section checkSection = document.AddSection();
        ConfigureLandscape(checkSection);
        checkSection.AddParagraph("Hesap Kontrol Listesi", "Heading1");
        checkSection.AddParagraph("Kontrol bekleyen, onaylanan, değiştirilmiş ve reddedilen hesap önerileri izlenir.");
        AddCalculationCheckTable(checkSection, report.CalculationChecks);

        Section sourceSection = document.AddSection();
        ConfigureLandscape(sourceSection);
        sourceSection.AddParagraph("Metraj Kaynak Satırları", "Heading1");
        sourceSection.AddParagraph($"{report.ProjectCode} — {report.ProjectName} | {report.RevisionCode}");
        AddSourceTable(sourceSection, report.SourceMeasurements);
        return document;
    }

    private static void ConfigureLandscape(Section section)
    {
        section.PageSetup.PageFormat = PageFormat.A4;
        section.PageSetup.Orientation = Orientation.Landscape;
        section.PageSetup.TopMargin = Unit.FromCentimeter(0.8);
        section.PageSetup.BottomMargin = Unit.FromCentimeter(0.8);
        section.PageSetup.LeftMargin = Unit.FromCentimeter(0.8);
        section.PageSetup.RightMargin = Unit.FromCentimeter(0.8);
        section.PageSetup.HeaderDistance = Unit.FromCentimeter(0.35);
        section.PageSetup.FooterDistance = Unit.FromCentimeter(0.35);
    }

    private static void AddSummaryTable(Section section, IReadOnlyList<MeasurementSummaryItem> summaries)
    {
        Table table = CreateTable(section, [4.5, 1.8, 2.0, 2.0, 1.0, 1.1, 1.6, 1.8, 2.3]);
        AddHeader(table, ["Malzeme", "Kod", "Çap / Boyut", "Çeşit", "Satır", "Birim", "Net", "Fireli", "Satın alma (boy/adet)"]);
        foreach (MeasurementSummaryItem item in summaries)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.PlacementName);
            SetCell(row, 1, item.PlacementCode);
            SetCell(row, 2, item.Variant);
            SetCell(row, 3, item.SecondaryVariant);
            SetCell(row, 4, item.MeasurementCount.ToString(CultureInfo.InvariantCulture), ParagraphAlignment.Right);
            SetCell(row, 5, item.Unit);
            SetCell(row, 6, FormatQuantity(item.NetQuantity), ParagraphAlignment.Right);
            SetCell(row, 7, FormatQuantity(item.WithWasteQuantity), ParagraphAlignment.Right);
            SetCell(row, 8, FormatQuantity(item.PurchaseQuantity), ParagraphAlignment.Right);
        }
    }

    private static void AddSourceTable(Section section, IReadOnlyList<MeasurementListItem> sources)
    {
        Table table = CreateTable(section, [3.5, 1.7, 1.7, 1.5, 1.3, 1.2, 0.9, 1.2, 1.3, 1.6, 1.1, 1.3, 1.2, 2.1]);
        AddHeader(table, ["Malzeme", "Kod", "Çap / Boyut", "Çeşit", "Kaynak", "Miktar", "Birim", "Blok", "Kat", "Mahal", "Bölge", "Pafta", "Çizim rev.", "Not"]);
        foreach (MeasurementListItem item in sources)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.PlacementName);
            SetCell(row, 1, item.PlacementCode);
            SetCell(row, 2, item.Variant);
            SetCell(row, 3, item.SecondaryVariant);
            SetCell(row, 4, item.SourceKind);
            SetCell(row, 5, FormatQuantity(item.InputQuantity), ParagraphAlignment.Right);
            SetCell(row, 6, item.InputUnit);
            SetCell(row, 7, item.Block);
            SetCell(row, 8, item.Floor);
            SetCell(row, 9, item.Room);
            SetCell(row, 10, item.Zone);
            SetCell(row, 11, item.Sheet);
            SetCell(row, 12, item.DrawingRevision);
            SetCell(row, 13, item.Notes);
        }
    }

    private static void AddClassificationTable(Section section, IReadOnlyList<ReportClassificationSummaryItem> items)
    {
        Table table = CreateTable(section, [2.5, 2.5, 1.1, 1.8, 3.4, 1.8, 1.8, 0.9, 1.0, 1.4, 1.4, 1.7]);
        AddHeader(table, ["Kategori", "Sistem", "Poz", "Kod", "Malzeme", "Çap / Boyut", "Çeşit", "Satır", "Birim", "Net", "Fireli", "Satın alma"]);
        foreach (ReportClassificationSummaryItem item in items)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.Category);
            SetCell(row, 1, item.System);
            SetCell(row, 2, item.PositionNumber);
            SetCell(row, 3, item.Code);
            SetCell(row, 4, item.Name);
            SetCell(row, 5, item.Variant);
            SetCell(row, 6, item.SecondaryVariant);
            SetCell(row, 7, item.MeasurementCount.ToString(CultureInfo.InvariantCulture), ParagraphAlignment.Right);
            SetCell(row, 8, item.Unit);
            SetCell(row, 9, FormatQuantity(item.NetQuantity), ParagraphAlignment.Right);
            SetCell(row, 10, FormatQuantity(item.WithWasteQuantity), ParagraphAlignment.Right);
            SetCell(row, 11, FormatQuantity(item.PurchaseQuantity), ParagraphAlignment.Right);
        }
    }

    private static void AddContextTable(Section section, IReadOnlyList<ReportContextSummaryItem> items)
    {
        Table table = CreateTable(section, [1.1, 1.5, 1.9, 1.1, 1.3, 1.3, 1.1, 1.9, 3.4, 1.0, 1.0, 1.6]);
        AddHeader(table, ["Blok", "Kat", "Mahal", "Bölge", "Pafta", "Çizim rev.", "Poz", "Kod", "Malzeme", "Satır", "Birim", "Net"]);
        foreach (ReportContextSummaryItem item in items)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.Block);
            SetCell(row, 1, item.Floor);
            SetCell(row, 2, item.Room);
            SetCell(row, 3, item.Zone);
            SetCell(row, 4, item.Sheet);
            SetCell(row, 5, item.DrawingRevision);
            SetCell(row, 6, item.PositionNumber);
            SetCell(row, 7, item.Code);
            SetCell(row, 8, item.Name);
            SetCell(row, 9, item.SourceLineCount.ToString(CultureInfo.InvariantCulture), ParagraphAlignment.Right);
            SetCell(row, 10, item.Unit);
            SetCell(row, 11, FormatQuantity(item.NetQuantity), ParagraphAlignment.Right);
        }
    }

    private static void AddPurchaseTable(Section section, IReadOnlyList<ReportPurchaseItem> items)
    {
        // Keep the name column below the PDF renderer's problematic 4.5 cm boundary.
        // It also keeps the table visually aligned with the source-line report.
        Table table = CreateTable(section, [3.4, 1.7, 1.7, 1.7, 2.0, 1.8, 0.9, 1.4, 1.4, 1.6, 1.5, 1.5]);
        AddHeader(table, ["Malzeme", "Kod", "Çap / Boyut", "Çeşit", "Kaynak", "Kural", "Birim", "Net", "Fireli", "Satın alma", "Satın alma birimi", "Kullanılan"]);
        foreach (ReportPurchaseItem item in items)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.Name);
            SetCell(row, 1, item.Code);
            SetCell(row, 2, item.Variant);
            SetCell(row, 3, item.SecondaryVariant);
            SetCell(row, 4, item.QuantitySource);
            SetCell(row, 5, item.CalculationRule);
            SetCell(row, 6, item.Unit);
            SetCell(row, 7, FormatQuantity(item.NetQuantity), ParagraphAlignment.Right);
            SetCell(row, 8, FormatQuantity(item.WithWasteQuantity), ParagraphAlignment.Right);
            SetCell(row, 9, FormatQuantity(item.PurchaseQuantity), ParagraphAlignment.Right);
            SetCell(row, 10, item.PurchaseUnit ?? item.Unit);
            SetCell(row, 11, item.UsedQuantity is decimal used ? FormatQuantity(used) : string.Empty, ParagraphAlignment.Right);
        }
    }

    private static void AddResponsibilityTable(Section section, IReadOnlyList<ResponsibilityAssignmentListItem> items)
    {
        Table table = CreateTable(section, [4.5, 2.5, 2.8, 2.1, 3.0, 4.0]);
        AddHeader(table, ["Yerleşim", "Boyut", "Taraf", "Durum", "Atama kaynağı", "Not"]);
        foreach (ResponsibilityAssignmentListItem item in items)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.PlacementName);
            SetCell(row, 1, item.DimensionName);
            SetCell(row, 2, item.PartyName);
            SetCell(row, 3, item.State.ToString());
            SetCell(row, 4, item.IsInherited ? $"Kalıtılmış: {item.SourcePlacementName}" : "Doğrudan");
            SetCell(row, 5, item.Notes);
        }
    }

    private static void AddCalculationCheckTable(Section section, IReadOnlyList<ReportCalculationCheckItem> items)
    {
        Table table = CreateTable(section, [4.5, 1.8, 1.8, 0.9, 1.7, 1.7, 2.0, 2.0, 3.0]);
        AddHeader(table, ["Hedef", "Kod", "Kural", "Sürüm", "Durum", "Öneri", "Satın alma", "Kullanılan", "Gerekçe"]);
        foreach (ReportCalculationCheckItem item in items)
        {
            Row row = table.AddRow();
            SetCell(row, 0, item.TargetName);
            SetCell(row, 1, item.TargetCode);
            SetCell(row, 2, item.Rule);
            SetCell(row, 3, item.RuleVersion.ToString(CultureInfo.InvariantCulture), ParagraphAlignment.Right);
            SetCell(row, 4, item.Status.ToString());
            SetCell(row, 5, FormatQuantity(item.ProposedQuantity), ParagraphAlignment.Right);
            SetCell(row, 6, FormatQuantity(item.PurchaseQuantity), ParagraphAlignment.Right);
            SetCell(row, 7, item.UsedQuantity is decimal used ? FormatQuantity(used) : string.Empty, ParagraphAlignment.Right);
            SetCell(row, 8, item.Reason);
        }
    }

    private static Table CreateTable(Section section, IReadOnlyList<double> columnWidths)
    {
        Table table = section.AddTable();
        table.Borders.Width = Unit.FromPoint(0.25);
        table.KeepTogether = false;
        table.Format.Font.Name = "Arial";
        table.Format.Font.Size = 7.2;
        table.Format.SpaceBefore = Unit.FromPoint(2);
        table.Format.SpaceAfter = Unit.FromPoint(2);
        table.Rows.LeftIndent = Unit.Zero;
        foreach (double width in columnWidths)
        {
            table.AddColumn(Unit.FromCentimeter(width));
        }

        return table;
    }

    private static void AddHeader(Table table, IReadOnlyList<string> headers)
    {
        Row header = table.AddRow();
        header.HeadingFormat = true;
        header.Shading.Color = Color.FromArgb(255, 31, 78, 120);
        foreach ((string text, int index) in headers.Select((text, index) => (text, index)))
        {
            Cell cell = header.Cells[index];
            cell.VerticalAlignment = VerticalAlignment.Center;
            Paragraph paragraph = cell.AddParagraph(text);
            paragraph.Format.Font.Bold = true;
            paragraph.Format.Font.Size = 7.1;
            paragraph.Format.Font.Color = Colors.White;
            paragraph.Format.SpaceAfter = Unit.Zero;
        }
    }

    private static void SetCell(Row row, int index, string? text, ParagraphAlignment alignment = ParagraphAlignment.Left)
    {
        Cell cell = row.Cells[index];
        cell.VerticalAlignment = VerticalAlignment.Center;
        Paragraph paragraph = cell.AddParagraph(text ?? string.Empty);
        paragraph.Format.Alignment = alignment;
        paragraph.Format.Font.Size = 7.2;
        paragraph.Format.SpaceAfter = Unit.Zero;
        paragraph.Format.LineSpacing = 1;
    }

    /// <summary>
    /// Bütün çıktı biçimleri aynı hassasiyeti kullanır. Önceden Excel ve arayüz
    /// 3, PDF ve Word 6 ondalık gösteriyordu; 0,0004 gibi küçük ama geçerli bir
    /// miktar ekranda ve Excel'de 0 görünüp PDF'te görünüyordu.
    /// </summary>
    internal const string QuantityNumberFormat = "#,##0.######";

    private static string FormatQuantity(decimal value) => value.ToString("0.######", CultureInfo.InvariantCulture);

    private static ProjectReportExportResult ToExportResult(ProjectReportData report, string path) => new(
        path,
        report.SourceMeasurements.Count,
        report.Summaries.Count,
        report.GeneratedAtUtc);

    private static string ValidateOutputPath(string outputPath, string expectedExtension)
    {
        if (string.IsNullOrWhiteSpace(outputPath))
        {
            throw new ArgumentException("Çıktı yolu zorunludur.", nameof(outputPath));
        }

        string path = Path.GetFullPath(outputPath);
        if (!string.Equals(Path.GetExtension(path), expectedExtension, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"Çıktı uzantısı '{expectedExtension}' olmalıdır.", nameof(outputPath));
        }

        string? directory = Path.GetDirectoryName(path);
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException("Çıktı klasörü bulunamadı.");
        }

        return path;
    }

    /// <summary>Hücre metnini Excel formülü olarak yorumlanmaktan korur.</summary>
    /// <remarks>
    /// Kullanıcının yazdığı bir kart adı <c>=</c>, <c>+</c>, <c>-</c> veya
    /// <c>@</c> ile başlıyorsa Excel onu FORMÜL sayar (CSV/formül enjeksiyonu).
    /// Tek tırnak ön eki, hücreyi metin olarak işaretler ve ekranda görünmez.
    /// </remarks>
    private static string SafeCellText(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        return value[0] is '=' or '+' or '-' or '@' ? $"'{value}" : value;
    }
}
