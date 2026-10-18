using Metraj.Application;
using Metraj.Domain;
using Microsoft.Data.Sqlite;

namespace Metraj.Host;

/// <summary>Rota tablosu: 68 uç nokta, alanlarına göre.</summary>
/// <remarks>
/// Rotalar, gövdeleri ve sıraları LocalApiHost'taki minimal API tanımlarından
/// birebir taşındı (oradaki <c>Map*Endpoints</c> metotlarıyla aynı bölümleme).
/// Yeni bir uç eklemek buraya bir satır eklemekten ibarettir; masaüstü ve
/// Android onu aynı anda kazanır. Tablonun tamamı <c>MetrajRequestRouterRouteTableTests</c>'te
/// ayrı yazılmış bir beklenen listeyle karşılaştırılır.
/// </remarks>
public sealed partial class MetrajRequestRouter
{
    private const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string PdfContentType = "application/pdf";
    private const string WordContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private const string WorkspaceContentType = "application/vnd.projemetraj.workspace";

    private static Route[] BuildRouteTable()
    {
        var api = new List<Route>(capacity: 68);
        MapHealthRoutes(api);
        MapProjectRoutes(api);
        MapCatalogRoutes(api);
        MapPlacementRoutes(api);
        MapPlacementContextNoteRoutes(api);
        MapMeasurementRoutes(api);
        MapCalculationRoutes(api);
        MapResponsibilityRoutes(api);
        MapReportRoutes(api);
        MapSyntheticDataRoutes(api);
        MapUiStateRoutes(api);
        MapDatabaseRoutes(api);
        MapWorkspaceTransferRoutes(api);
        return api.ToArray();
    }

    /// <summary>Canlılık yoklaması.</summary>
    private static void MapHealthRoutes(List<Route> api)
    {
        Map(api, "GET", "/health", _ => Task.FromResult(Ok(new { status = "ok" })));
    }

    /// <summary>Projeler ve revizyonlar.</summary>
    private static void MapProjectRoutes(List<Route> api)
    {
        Map(api, "GET", "/projects", call => OkAsync(call.Services.Projects.ListProjectsAsync(call.Token)));
        Map<CreateProjectRequest>(api, "POST", "/projects", (call, request) =>
            OkAsync(call.Services.Projects.CreateProjectAsync(request.Code, request.Name, request.Description, call.Token)));
        Map(api, "GET", "/projects/{projectId:guid}/revisions", call =>
            OkAsync(call.Services.Projects.ListRevisionsAsync(call.Id("projectId"), call.Token)));
        Map(api, "POST", "/projects/{projectId:guid}/revisions", call =>
            OkAsync(call.Services.Projects.CreateDraftRevisionAsync(call.Id("projectId"), call.Token)));
        Map(api, "POST", "/revisions/{revisionId:guid}/approve", call =>
            NoContentAsync(call.Services.Projects.ApproveRevisionAsync(call.Id("revisionId"), call.Token)));
    }

    /// <summary>Kart kütüphanesi, kart türleri ve merkezi fire ayarları.</summary>
    private static void MapCatalogRoutes(List<Route> api)
    {
        Map(api, "GET", "/catalog/cards", call => OkAsync(call.Services.Catalog.ListCardsAsync(call.Token)));
        Map(api, "GET", "/catalog/attributes", _ => Task.FromResult(Ok(CatalogCardAttributeCatalog.All)));
        Map(api, "GET", "/catalog/types", call => OkAsync(call.Services.CatalogCardTypes.ListTypesAsync(call.Token)));
        Map<CreateCatalogTypeRequest>(api, "POST", "/catalog/types", (call, request) =>
            OkAsync(call.Services.CatalogCardTypes.CreateTypeAsync(new CatalogCardTypeDraft(request.Code, request.Name, request.BaseCardType,
                request.AllowedParentCardIds, request.AllowedChildCardIds, request.AttributeKeys, request.Description), call.Token)));
        Map(api, "DELETE", "/catalog/types/{typeId:guid}", call =>
            NoContentAsync(call.Services.CatalogCardTypes.DeleteTypeAsync(call.Id("typeId"), call.Token)));
        Map(api, "POST", "/catalog/starter-pack", call => OkAsync(call.Services.StarterCatalog.SeedAsync(call.Token)));
        Map<CreateCardRequest>(api, "POST", "/catalog/cards", (call, request) =>
            OkAsync(call.Services.Catalog.CreateCardAsync(ToCatalogCardDraft(request), call.Token)));
        Map(api, "GET", "/catalog/cards/{cardId:guid}/versions", call =>
            OkAsync(call.Services.Catalog.ListVersionsAsync(call.Id("cardId"), call.Token)));
        Map<CreateCardRequest>(api, "POST", "/catalog/cards/{cardId:guid}/versions", (call, request) =>
            OkAsync(call.Services.Catalog.CreateVersionAsync(call.Id("cardId"), ToCatalogCardDraft(request), call.Token)));
        Map(api, "POST", "/catalog/cards/{cardId:guid}/deactivate", call =>
            NoContentAsync(call.Services.Catalog.DeactivateCardAsync(call.Id("cardId"), call.Token)));
        Map(api, "DELETE", "/catalog/cards/{cardId:guid}", call =>
            NoContentAsync(call.Services.Catalog.DeleteCardAsync(call.Id("cardId"), call.Token)));
        Map(api, "GET", "/placements/{pipePlacementId:guid}/compatible-fittings", call =>
            OkAsync(call.Services.Catalog.ListCompatibleFittingsAsync(call.Id("pipePlacementId"), call.Token)));
        Map(api, "GET", "/settings/material-waste", call => OkAsync(call.Services.MaterialTypeWaste.ListAsync(call.Token)));
        Map<MaterialWasteRequest>(api, "PUT", "/settings/material-waste", (call, request) =>
            OkAsync(call.Services.MaterialTypeWaste.UpsertAsync(request.MaterialType, request.WasteRatePct, call.Token)));
        Map(api, "DELETE", "/settings/material-waste/{id:guid}", call =>
            NoContentAsync(call.Services.MaterialTypeWaste.DeleteAsync(call.Id("id"), call.Token)));
    }

    /// <summary>Proje haritasındaki kartlar ve aralarındaki bağlantılar.</summary>
    private static void MapPlacementRoutes(List<Route> api)
    {
        Map(api, "GET", "/revisions/{revisionId:guid}/placements", call =>
            OkAsync(call.Services.ProjectTree.ListPlacementsAsync(call.Id("revisionId"), call.Token)));
        Map<AddPlacementRequest>(api, "POST", "/revisions/{revisionId:guid}/placements", (call, request) =>
            OkAsync(call.Services.ProjectTree.AddPlacementAsync(new PlacementDraft(call.Id("revisionId"), request.CardVersionId,
                request.ParentPlacementId, request.DisplayNameOverride, request.ProcurementScope), call.Token)));
        Map<UpdatePlacementRequest>(api, "PUT", "/placements/{placementId:guid}", (call, request) =>
            NoContentAsync(call.Services.ProjectTree.UpdatePlacementAsync(call.Id("placementId"),
                new PlacementUpdateDraft(request.DisplayNameOverride, request.ProcurementScope, request.Notes), call.Token)));
        Map<MovePlacementRequest>(api, "PUT", "/placements/{placementId:guid}/parent", (call, request) =>
            NoContentAsync(call.Services.ProjectTree.MovePlacementAsync(call.Id("placementId"), request.ParentPlacementId, call.Token)));
        Map<AddCalculatedFromRequest>(api, "POST", "/placements/{placementId:guid}/calculated-from", (call, request) =>
            NoContentAsync(call.Services.ProjectTree.AddLinkAsync(request.SourcePlacementId, call.Id("placementId"),
                SemanticLinkType.CalculatedFrom, request.Notes, call.Token)));
        Map(api, "DELETE", "/placements/{placementId:guid}", call =>
            NoContentAsync(call.Services.ProjectTree.DeletePlacementAsync(call.Id("placementId"), call.Token)));
    }

    /// <summary>Yerleşimlere ait kalıcı kat/mahal istisna notları.</summary>
    private static void MapPlacementContextNoteRoutes(List<Route> api)
    {
        Map(api, "GET", "/placements/{placementId:guid}/context-notes", call =>
            OkAsync(call.Services.PlacementContextNotes.ListNotesAsync(call.Id("placementId"), call.Token)));
        Map<AddPlacementContextNoteRequest>(api, "POST", "/placements/{placementId:guid}/context-notes", (call, request) =>
            OkAsync(call.Services.PlacementContextNotes.AddNoteAsync(new PlacementContextNoteDraft(
                call.Id("placementId"), request.Text, request.Block, request.Floor, request.Room), call.Token)));
        Map(api, "DELETE", "/placement-context-notes/{noteId:guid}", call =>
            NoContentAsync(call.Services.PlacementContextNotes.DeleteNoteAsync(call.Id("noteId"), call.Token)));
        Map(api, "DELETE", "/placements/{placementId:guid}/context-notes/{noteId:guid}", call =>
            NoContentAsync(call.Services.PlacementContextNotes.DeleteNoteAsync(call.Id("placementId"), call.Id("noteId"), call.Token)));
    }

    /// <summary>Metraj satırları.</summary>
    private static void MapMeasurementRoutes(List<Route> api)
    {
        Map(api, "GET", "/revisions/{revisionId:guid}/measurements", call =>
            OkAsync(call.Services.Measurements.ListMeasurementsAsync(call.Id("revisionId"), call.Token)));
        Map(api, "GET", "/revisions/{revisionId:guid}/measurement-summaries", call =>
            OkAsync(call.Services.Measurements.ListSummariesAsync(call.Id("revisionId"), call.Token)));
        Map<CreateMeasurementRequest>(api, "POST", "/revisions/{revisionId:guid}/measurements", (call, request) =>
            OkAsync(call.Services.Measurements.CreateMeasurementAsync(ToMeasurementDraft(call.Id("revisionId"), request), call.Token)));
        Map<IReadOnlyList<CreateMeasurementRequest>>(api, "POST", "/revisions/{revisionId:guid}/measurements/batch", (call, requests) =>
        {
            Guid revisionId = call.Id("revisionId");
            return OkAsync(call.Services.Measurements.CreateMeasurementsAsync(
                requests.Select(request => ToMeasurementDraft(revisionId, request)).ToList(), call.Token));
        });
        Map(api, "POST", "/measurements/{measurementId:guid}/duplicate", call =>
            OkAsync(call.Services.Measurements.DuplicateMeasurementAsync(call.Id("measurementId"), call.Token)));
        Map(api, "DELETE", "/measurements/{measurementId:guid}", call =>
            NoContentAsync(call.Services.Measurements.DeleteMeasurementAsync(call.Id("measurementId"), call.Token)));
        Map<UpdateMeasurementRequest>(api, "PUT", "/measurements/{measurementId:guid}", (call, request) =>
            NoContentAsync(call.Services.Measurements.UpdateMeasurementAsync(call.Id("measurementId"), new MeasurementDraft(
                request.RevisionId, request.PlacementId, request.InputQuantity, request.InputUnit, request.Block,
                request.Floor, request.Room, request.Zone, request.Sheet, request.DrawingRevision, request.Notes,
                request.SourceKind ?? "USER", request.Variant, request.SecondaryVariant), call.Token)));
    }

    /// <summary>Hesap kuralları, sonuçları ve inceleme kararları.</summary>
    private static void MapCalculationRoutes(List<Route> api)
    {
        Map(api, "GET", "/revisions/{revisionId:guid}/calculations/rules", call =>
            OkAsync(call.Services.Calculations.ListRulesAsync(call.Id("revisionId"), call.Token)));
        Map<CreateRuleRequest>(api, "POST", "/revisions/{revisionId:guid}/calculations/rules", (call, request) =>
            OkAsync(call.Services.Calculations.CreateRuleVersionAsync(call.Id("revisionId"), new CalculationRuleDraft(
                request.Code, request.Name, request.Mode, request.Multiplier, request.SourceQuantityKind), call.Token)));
        Map(api, "GET", "/revisions/{revisionId:guid}/calculations/results", call =>
            OkAsync(call.Services.Calculations.ListResultsAsync(call.Id("revisionId"), call.Token)));
        Map<CalculateRequest>(api, "POST", "/revisions/{revisionId:guid}/calculations/results", (call, request) =>
            OkAsync(call.Services.Calculations.CalculateAsync(call.Id("revisionId"), request.TargetPlacementId, request.RuleVersionId, call.Token)));
        Map(api, "POST", "/calculations/results/{resultId:guid}/approve", call =>
            NoContentAsync(call.Services.Calculations.ApproveAsync(call.Id("resultId"), call.Token)));
        Map<ReviewReasonRequest>(api, "POST", "/calculations/results/{resultId:guid}/reject", (call, request) =>
            NoContentAsync(call.Services.Calculations.RejectAsync(call.Id("resultId"), request.Reason, call.Token)));
        Map<OverrideCalculationRequest>(api, "POST", "/calculations/results/{resultId:guid}/override", (call, request) =>
            NoContentAsync(call.Services.Calculations.OverrideAsync(call.Id("resultId"), request.UsedQuantity, request.Reason, call.Token)));
    }

    /// <summary>Sorumluluk boyutları, tarafları ve atamaları.</summary>
    private static void MapResponsibilityRoutes(List<Route> api)
    {
        Map(api, "GET", "/revisions/{revisionId:guid}/responsibilities", async call =>
        {
            Guid revisionId = call.Id("revisionId");
            IResponsibilityWorkspace workspace = call.Services.Responsibilities;
            return Ok(new ResponsibilityView(
                await workspace.ListDimensionsAsync(revisionId, call.Token),
                await workspace.ListPartiesAsync(revisionId, call.Token),
                await workspace.ListAssignmentsAsync(revisionId, call.Token)));
        });
        Map<CreateNamedRequest>(api, "POST", "/revisions/{revisionId:guid}/responsibilities/dimensions", (call, request) =>
            OkAsync(call.Services.Responsibilities.CreateDimensionAsync(call.Id("revisionId"), request.Code, request.Name, call.Token)));
        Map<CreateNamedRequest>(api, "POST", "/revisions/{revisionId:guid}/responsibilities/parties", (call, request) =>
            OkAsync(call.Services.Responsibilities.CreatePartyAsync(call.Id("revisionId"), request.Code, request.Name, call.Token)));
        Map<AssignResponsibilityRequest>(api, "POST", "/revisions/{revisionId:guid}/responsibilities/assignments", (call, request) =>
            NoContentAsync(call.Services.Responsibilities.AssignPlacementAsync(call.Id("revisionId"), request.DimensionId,
                request.PlacementId, request.PartyId, request.State, request.Notes, call.Token)));
    }

    /// <summary>Rapor verisi ve dışa aktarımlar.</summary>
    private static void MapReportRoutes(List<Route> api)
    {
        Map(api, "GET", "/revisions/{revisionId:guid}/report", call =>
            OkAsync(call.Services.Reports.BuildReportDataAsync(call.Id("revisionId"), call.Token)));
        // İsteğe bağlı ?placementId=... raporu alt ağaca daraltır (önceden Guid? sorgu parametresiydi).
        Map(api, "GET", "/revisions/{revisionId:guid}/report/excel", call =>
            ScopedDownloadAsync(call, ".xlsx", ExcelContentType, call.Services.Reports.ExportExcelAsync, call.Services.Reports.ExportSubtreeExcelAsync));
        Map(api, "GET", "/revisions/{revisionId:guid}/report/pdf", call =>
            ScopedDownloadAsync(call, ".pdf", PdfContentType, call.Services.Reports.ExportPdfAsync, call.Services.Reports.ExportSubtreePdfAsync));
        Map(api, "GET", "/revisions/{revisionId:guid}/report/word", call =>
            ScopedDownloadAsync(call, ".docx", WordContentType, call.Services.Reports.ExportWordAsync, call.Services.Reports.ExportSubtreeWordAsync));
        Map(api, "GET", "/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}", call =>
            OkAsync(call.Services.Reports.BuildSubtreeReportDataAsync(call.Id("revisionId"), call.Id("rootPlacementId"), call.Token)));
        Map(api, "GET", "/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/excel", call =>
            CreateSubtreeDownloadAsync(call.Id("revisionId"), call.Id("rootPlacementId"), ".xlsx", ExcelContentType, call.Services.Reports.ExportSubtreeExcelAsync, call.Token));
        Map(api, "GET", "/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/pdf", call =>
            CreateSubtreeDownloadAsync(call.Id("revisionId"), call.Id("rootPlacementId"), ".pdf", PdfContentType, call.Services.Reports.ExportSubtreePdfAsync, call.Token));
        Map(api, "GET", "/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/word", call =>
            CreateSubtreeDownloadAsync(call.Id("revisionId"), call.Id("rootPlacementId"), ".docx", WordContentType, call.Services.Reports.ExportSubtreeWordAsync, call.Token));
    }

    /// <summary>Sentetik örnek veri içe aktarımı.</summary>
    private static void MapSyntheticDataRoutes(List<Route> api)
    {
        Map(api, "POST", "/synthetic-clean-water", call => OkAsync(call.Services.SyntheticCleanWater.ImportAsync(call.Token)));
    }

    /// <summary>Arayüzün kalıcı taslakları ve tercihleri.</summary>
    private static void MapUiStateRoutes(List<Route> api)
    {
        // Arayüzün kalıcı taslakları ve tercihleri. localStorage kullanılamaz:
        // loopback portu her açılışta değiştiği için origin, dolayısıyla
        // localStorage da sıfırlanıyor.
        Map(api, "GET", "/ui-state", call => OkAsync(call.Services.UiState.ListAsync(call.Token)));
        Map<UiStateRequest>(api, "PUT", "/ui-state", (call, request) =>
            OkAsync(call.Services.UiState.SetAsync(request.Key, request.ValueJson, call.Token)));
        // key zorunlu sorgu parametresi: hiç yoksa gövdesiz 400; boş da olsa
        // verilmişse servise gider ve alan kuralı karar verir.
        Map(api, "DELETE", "/ui-state", call => call.Query.Get("key") is string key
            ? NoContentAsync(call.Services.UiState.DeleteAsync(key, call.Token))
            : Task.FromResult(Empty(400)));
    }

    /// <summary>Yedekleme, geri yükleme ve bütünlük.</summary>
    private static void MapDatabaseRoutes(List<Route> api)
    {
        Map(api, "GET", "/database/backups", call => OkAsync(call.Services.DatabaseMaintenance.ListBackupsAsync(call.Token)));
        Map(api, "POST", "/database/backups", call =>
            OkAsync(call.Services.DatabaseMaintenance.CreateBackupAsync(DatabaseBackupReason.Manual, call.Token)));
        Map<RestoreBackupRequest>(api, "POST", "/database/backups/restore", (call, request) =>
            NoContentAsync(call.Services.DatabaseMaintenance.RestoreBackupAsync(request.FullPath, call.Token)));
        Map(api, "GET", "/database/integrity", call => OkAsync(call.Services.DatabaseMaintenance.CheckIntegrityAsync(call.Token)));
        Map(api, "DELETE", "/database/projects", call => OkAsync(call.Services.DatabaseMaintenance.ResetProjectDataAsync(call.Token)));
    }

    /// <summary>Tek dosyalık çalışma alanı dışa aktarma ve mevcut veriye ekleyerek içe aktarma.</summary>
    private static void MapWorkspaceTransferRoutes(List<Route> api)
    {
        Map(api, "GET", "/workspace/export", ExportWorkspaceAsync);
        api.Add(new Route("POST", "/api/workspace/import", bodyType: null, acceptsFile: true, ImportWorkspaceAsync));
    }

    private static void Map(List<Route> api, string method, string template, Func<RouteCall, Task<RouterResponse>> handler) =>
        api.Add(new Route(method, "/api" + template, bodyType: null, acceptsFile: false, handler));

    private static void Map<TBody>(List<Route> api, string method, string template, Func<RouteCall, TBody, Task<RouterResponse>> handler)
        where TBody : class =>
        api.Add(new Route(method, "/api" + template, typeof(TBody), acceptsFile: false, call => handler(call, (TBody)call.Body!)));

    private static async Task<RouterResponse> ExportWorkspaceAsync(RouteCall call)
    {
        string downloadName = $"ProjeMetraj-{DateTime.Now:yyyyMMdd-HHmmss}.metraj";
        string temporaryPath = Path.Combine(Path.GetTempPath(), $"proje-metraj-export-{Guid.NewGuid():N}.metraj");
        try
        {
            await call.Services.WorkspaceTransfer.ExportAsync(temporaryPath, call.Token);
            return new RouterResponse(200, WorkspaceContentType, null,
                new RouterFile(temporaryPath, WorkspaceContentType, downloadName, DeleteWhenDone: true));
        }
        catch
        {
            TryDeleteTemporaryFile(temporaryPath);
            throw;
        }
    }

    /// <summary>Ham dosya akışından içe aktarma.</summary>
    /// <remarks>
    /// Önceden uç noktanın kendisi multipart formu okuyordu; bu HTTP'ye özgü kısım
    /// Kestrel adaptörüne kaldı, router yalnız dosya içeriğini görür. Dosya diske
    /// yazılır (çalışma alanı yüzlerce MB olabilir; belleğe alınmaz), içe aktarılır
    /// ve her durumda silinir. Android'den gelen boş bir dosya da masaüstündeki
    /// boş yükleme gibi "workspace-import.empty" alır.
    /// </remarks>
    private static async Task<RouterResponse> ImportWorkspaceAsync(RouteCall call)
    {
        if (call.BodyStream is null)
            throw new DomainRuleViolationException("workspace-import.empty", "A workspace file is required.");

        string temporaryPath = Path.Combine(Path.GetTempPath(), $"proje-metraj-import-{Guid.NewGuid():N}.metraj");
        try
        {
            await using (Stream input = call.BodyStream())
            await using (FileStream output = new(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                bufferSize: 64 * 1024, FileOptions.Asynchronous))
            {
                await input.CopyToAsync(output, call.Token);
                if (output.Length == 0)
                    throw new DomainRuleViolationException("workspace-import.empty", "A workspace file is required.");
            }

            return Ok(await call.Services.WorkspaceTransfer.ImportAsync(temporaryPath, call.Token));
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            TryDeleteTemporaryFile(temporaryPath);
        }
    }

    private static Task<RouterResponse> ScopedDownloadAsync(
        RouteCall call,
        string extension,
        string contentType,
        Func<Guid, string, CancellationToken, Task<ProjectReportExportResult>> export,
        Func<Guid, Guid, string, CancellationToken, Task<ProjectReportExportResult>> subtreeExport)
    {
        if (!call.Query.TryGetOptionalId("placementId", out Guid? placementId))
        {
            return Task.FromResult(Empty(400));
        }

        Guid revisionId = call.Id("revisionId");
        return placementId is Guid root
            ? CreateSubtreeDownloadAsync(revisionId, root, extension, contentType, subtreeExport, call.Token)
            : CreateDownloadAsync(revisionId, extension, contentType, export, call.Token);
    }

    private static Task<RouterResponse> CreateDownloadAsync(
        Guid revisionId,
        string extension,
        string contentType,
        Func<Guid, string, CancellationToken, Task<ProjectReportExportResult>> export,
        CancellationToken cancellationToken)
    {
        string temporaryPath = Path.Combine(Path.GetTempPath(), $"metraj-{revisionId:N}-{Guid.NewGuid():N}{extension}");
        return ExportToFileAsync(temporaryPath, contentType, (path, token) => export(revisionId, path, token), cancellationToken);
    }

    private static Task<RouterResponse> CreateSubtreeDownloadAsync(Guid revisionId, Guid rootPlacementId, string extension, string contentType,
        Func<Guid, Guid, string, CancellationToken, Task<ProjectReportExportResult>> exporter, CancellationToken cancellationToken)
    {
        string temporaryPath = Path.Combine(Path.GetTempPath(), $"metraj-{revisionId:N}-{rootPlacementId:N}-{Guid.NewGuid():N}{extension}");
        return ExportToFileAsync(temporaryPath, contentType, (path, token) => exporter(revisionId, rootPlacementId, path, token), cancellationToken);
    }

    /// <summary>Belgeyi geçici dosyaya üretir; yanıt dosyanın yolunu taşır, içeriğini değil.</summary>
    /// <remarks>
    /// Belge belleğe alınmaz: önceki hâllerden biri <c>File.ReadAllBytesAsync</c> ile
    /// tamamını ikinci bir <c>byte[]</c>'e kopyalıyordu. Tüketici (Kestrel adaptörü
    /// ya da Android paylaşım sayfası) dosyayı akıtır ve
    /// <see cref="RouterFile.DeleteWhenDone"/> gereği siler. Üretim başarısız olursa
    /// yarım dosya burada silinir.
    /// </remarks>
    private static async Task<RouterResponse> ExportToFileAsync(
        string temporaryPath,
        string contentType,
        Func<string, CancellationToken, Task<ProjectReportExportResult>> export,
        CancellationToken cancellationToken)
    {
        ProjectReportExportResult result;
        try
        {
            result = await export(temporaryPath, cancellationToken);
        }
        catch
        {
            TryDeleteTemporaryFile(temporaryPath);
            throw;
        }

        // Geçici yol GUID'li ve benzersiz kalır; yalnız kullanıcıya önerilen ad okunurdur.
        // Önceden ad olarak geçici dosyanın adı (metraj-<guid>-<guid>.pdf) dönüyordu.
        string downloadName = ReportFileNames.For(result, DateTime.Now, Path.GetExtension(result.OutputPath));
        return new RouterResponse(200, contentType, null,
            new RouterFile(result.OutputPath, contentType, downloadName, DeleteWhenDone: true));
    }

    private static void TryDeleteTemporaryFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // Geçici dosyayı silememek indirmeyi bozmamalı.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static ItemKind GetItemKind(CardType cardType) => cardType is CardType.Material or CardType.Accessory
        ? ItemKind.Material
        : ItemKind.Service;

    private static CatalogCardDraft ToCatalogCardDraft(CreateCardRequest request) => new(
        request.Code, request.Name, request.CardType, GetItemKind(request.CardType), request.InputBehavior,
        request.SalesConversion, request.ReportBehavior, request.Unit, request.WasteRatePct,
        request.ContainerParameter, request.PositionNumber, request.Notes, request.MaterialType, request.CompatibleDiameters,
        request.CustomTypeId, request.AttributeValues, request.VariantMode, request.Variants);

    private static MeasurementDraft ToMeasurementDraft(Guid revisionId, CreateMeasurementRequest request) => new(
        revisionId, request.PlacementId, request.InputQuantity, request.InputUnit, request.Block, request.Floor,
        request.Room, request.Zone, request.Sheet, request.DrawingRevision, request.Notes, request.SourceKind ?? "USER",
        request.Variant, request.SecondaryVariant);

    private sealed record CreateProjectRequest(string Code, string Name, string? Description);
    private sealed record CreateCardRequest(string Code, string Name, CardType CardType, string Unit, InputBehavior InputBehavior,
        SalesConversion SalesConversion, ReportBehavior ReportBehavior, decimal WasteRatePct, decimal? ContainerParameter, string? PositionNumber,
        string? Notes = null, string? MaterialType = null, IReadOnlyList<string>? CompatibleDiameters = null,
        Guid? CustomTypeId = null, IReadOnlyDictionary<string, string>? AttributeValues = null,
        CatalogVariantMode VariantMode = CatalogVariantMode.None, IReadOnlyList<CatalogCardVariantDraft>? Variants = null);
    private sealed record CreateCatalogTypeRequest(string Code, string Name, CardType BaseCardType,
        IReadOnlyList<Guid>? AllowedParentCardIds = null, IReadOnlyList<Guid>? AllowedChildCardIds = null,
        IReadOnlyList<string>? AttributeKeys = null, string? Description = null);
    private sealed record AddPlacementRequest(Guid CardVersionId, Guid? ParentPlacementId, string? DisplayNameOverride, string? ProcurementScope);
    private sealed record UpdatePlacementRequest(string? DisplayNameOverride, string? ProcurementScope, string? Notes);
    private sealed record AddPlacementContextNoteRequest(string Text, string? Block = null, string? Floor = null, string? Room = null);
    private sealed record MovePlacementRequest(Guid? ParentPlacementId);
    private sealed record AddCalculatedFromRequest(Guid SourcePlacementId, string? Notes);
    private sealed record CreateMeasurementRequest(Guid PlacementId, decimal InputQuantity, string InputUnit, string? Block, string? Floor,
        string? Room, string? Zone, string? Sheet, string? DrawingRevision, string? Notes, string? SourceKind, string? Variant = null, string? SecondaryVariant = null);
    private sealed record UpdateMeasurementRequest(Guid RevisionId, Guid PlacementId, decimal InputQuantity, string InputUnit, string? Block, string? Floor,
        string? Room, string? Zone, string? Sheet, string? DrawingRevision, string? Notes, string? SourceKind, string? Variant = null, string? SecondaryVariant = null);
    private sealed record MaterialWasteRequest(string MaterialType, decimal WasteRatePct);
    private sealed record CreateRuleRequest(string Code, string Name, CalculationRuleMode Mode, decimal Multiplier, SourceQuantityKind SourceQuantityKind);
    private sealed record CalculateRequest(Guid TargetPlacementId, Guid RuleVersionId);
    private sealed record ReviewReasonRequest(string Reason);
    private sealed record OverrideCalculationRequest(decimal UsedQuantity, string Reason);
    private sealed record CreateNamedRequest(string Code, string Name);
    private sealed record AssignResponsibilityRequest(Guid DimensionId, Guid PlacementId, Guid? PartyId, ResponsibilityAssignmentState State, string? Notes);
    private sealed record RestoreBackupRequest(string FullPath);
    private sealed record UiStateRequest(string Key, string ValueJson);
    private sealed record ResponsibilityView(IReadOnlyList<ResponsibilityDimensionListItem> Dimensions,
        IReadOnlyList<ResponsibilityPartyListItem> Parties, IReadOnlyList<ResponsibilityAssignmentListItem> Assignments);
}
