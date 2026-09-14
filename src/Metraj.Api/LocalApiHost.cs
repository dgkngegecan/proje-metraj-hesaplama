using System.Net;
using System.Text.Json.Serialization;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.StaticFiles;

namespace Metraj.Api;

/// <summary>Loopback-only HTTP boundary that lets the React desktop surface use the existing application services.</summary>
public sealed partial class LocalApiHost : IAsyncDisposable
{
    private readonly WebApplication application;

    private LocalApiHost(WebApplication application, Uri baseUri)
    {
        this.application = application;
        BaseUri = baseUri;
    }

    /// <summary>Loopback address used by the desktop WebView and never exposed on the network.</summary>
    public Uri BaseUri { get; }

    /// <summary>Starts the local API on an operating-system-selected loopback port.</summary>
    public static async Task<LocalApiHost> StartAsync(string databasePath, CancellationToken cancellationToken = default)
    {
        var options = new WebApplicationOptions
        {
            ApplicationName = typeof(LocalApiHost).Assembly.GetName().Name,
            ContentRootPath = AppContext.BaseDirectory
        };
        WebApplicationBuilder builder = WebApplication.CreateBuilder(options);
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
        builder.WebHost.UseSetting("detailedErrors", "false");
        builder.Services.Configure<JsonOptions>(json =>
        {
            json.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
            // allowIntegerValues: false -> numaralandırmalar yalnızca adlarıyla
            // kabul edilir. Varsayılan davranış, karşılığı olmayan bir tam sayının
            // (örn. 99) sessizce enum değeri olarak kaydedilmesine izin veriyordu.
            json.SerializerOptions.Converters.Add(new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false));
        });
        RegisterWorkspaceServices(builder.Services, databasePath);

        WebApplication app = builder.Build();
        ApplicationDatabaseGate databaseGate = app.Services.GetRequiredService<ApplicationDatabaseGate>();
        app.Use(async (context, next) =>
        {
            // Geri yükleme ucu bakım sınırını KENDİSİ alır; burada da bir yuva
            // tutulsaydı kendi kendini bekleyip kilitlenirdi.
            bool isMaintenanceRequest = context.Request.Path.StartsWithSegments("/api/database/backups/restore");
            await using IAsyncDisposable? operation = isMaintenanceRequest
                ? null
                : await databaseGate.EnterOperationAsync(context.RequestAborted);
            try
            {
                await next(context);
            }
            catch (DomainRuleViolationException exception) when (!context.Response.HasStarted)
            {
                // Kullanıcının düzeltebileceği bir durum. Kural kodu kararlı makine
                // kimliğidir; gösterilen metin Türkçe katalogdan çözülür. Önceden
                // istisnanın kendi İngilizce mesajı doğrudan kullanıcıya gidiyordu.
                Log.DomainRuleRejected(app.Logger, exception.Rule);
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(
                    new ApiError(DomainMessageCatalog.Resolve(exception.Rule), exception.Rule),
                    cancellationToken: context.RequestAborted);
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
            {
                // Kullanıcı sayfadan ayrıldı veya isteği iptal etti; hata değildir.
            }
            catch (Exception exception) when (!context.Response.HasStarted)
            {
                // Sunucu arızası kullanıcının kendi hatasıymış gibi sunulmamalı ve
                // iç ayrıntı sızmamalı. Önceden her InvalidOperationException 400
                // dönüyordu; eksik yazı tipi veya gömülü kaynak gibi gerçek
                // arızalar "hatalı istek" gibi görünüyordu.
                Log.UnexpectedFault(app.Logger, context.Request.Path, exception);
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsJsonAsync(
                    new ApiError("Beklenmeyen bir hata oluştu. Sorun sürerse uygulamayı yeniden başlatın.", "server.error"),
                    cancellationToken: context.RequestAborted);
            }
        });

        MapWorkspaceEndpoints(app);
        MapStaticReactApplication(app);
        await app.StartAsync(cancellationToken);

        IServer server = app.Services.GetRequiredService<IServer>();
        IServerAddressesFeature? addresses = server.Features.Get<IServerAddressesFeature>();
        string address = addresses?.Addresses.SingleOrDefault(value => value.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("Yerel React arayüzü için loopback adresi oluşturulamadı.");
        return new LocalApiHost(app, new Uri(address, UriKind.Absolute));
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await application.StopAsync(TimeSpan.FromSeconds(2));
        await application.DisposeAsync();
    }

    private static void RegisterWorkspaceServices(IServiceCollection services, string databasePath)
    {
        // Bakım (geri yükleme) ile sıradan istekler arasındaki sınır.
        services.AddSingleton<ApplicationDatabaseGate>();

        // Bağlam fabrikası bir kez kaydediliyor. Önceden aynı lambda on iki
        // kayıtta ayrı ayrı yazılıydı; veritabanı yolunun nasıl açıldığını
        // değiştirmek on iki satıra dokunmayı gerektiriyordu.
        services.AddSingleton<Func<MetrajDbContext>>(_ => () => MetrajDbContextFactory.Create(databasePath));

        services.AddSingleton<IProjectWorkspace, ProjectWorkspaceService>();
        services.AddSingleton<ICatalogWorkspace, CatalogWorkspaceService>();
        services.AddSingleton<ICatalogCardTypeWorkspace, CatalogCardTypeWorkspaceService>();
        services.AddSingleton<IStarterCatalogWorkspace, StarterCatalogWorkspaceService>();
        services.AddSingleton<IProjectTreeWorkspace, ProjectTreeWorkspaceService>();
        services.AddSingleton<IPlacementContextNoteWorkspace, PlacementContextNoteWorkspaceService>();
        services.AddSingleton<IResponsibilityWorkspace, ResponsibilityWorkspaceService>();
        services.AddSingleton<IMeasurementWorkspace, MeasurementWorkspaceService>();
        services.AddSingleton<ICalculationWorkspace, CalculationWorkspaceService>();
        services.AddSingleton<IProjectReportWorkspace, ProjectReportWorkspaceService>();
        services.AddSingleton<IMaterialTypeWasteWorkspace, MaterialTypeWasteWorkspaceService>();
        services.AddSingleton<IUiStateWorkspace, UiStateWorkspaceService>();

        // Bu ikisi bağlam fabrikasının yanında başka bağımlılık da alıyor.
        services.AddSingleton<IDatabaseMaintenanceWorkspace>(provider =>
            new DatabaseMaintenanceWorkspaceService(() => databasePath, backupDirectory: null,
                provider.GetRequiredService<ApplicationDatabaseGate>()));
        services.AddSingleton<ISyntheticCleanWaterWorkspace>(provider => new SyntheticCleanWaterWorkspaceService(
            provider.GetRequiredService<Func<MetrajDbContext>>(), OpenSyntheticCleanWaterFixture));
    }

    /// <summary>Uç noktaları alan alan bağlar.</summary>
    /// <remarks>
    /// Bu metot tek parça hâlinde 185 satırdı ve on bir ayrı alanı bir arada
    /// tutuyordu; bir uç noktayı bulmak için tamamını okumak gerekiyordu.
    /// Rotalar, gövdeleri ve sıraları birebir korunarak alanlarına ayrıldı.
    /// </remarks>
    private static void MapWorkspaceEndpoints(WebApplication app)
    {
        RouteGroupBuilder api = app.MapGroup("/api");
        MapHealthEndpoints(api);
        MapProjectEndpoints(api);
        MapCatalogEndpoints(api);
        MapPlacementEndpoints(api);
        MapPlacementContextNoteEndpoints(api);
        MapMeasurementEndpoints(api);
        MapCalculationEndpoints(api);
        MapResponsibilityEndpoints(api);
        MapReportEndpoints(api);
        MapSyntheticDataEndpoints(api);
        MapUiStateEndpoints(api);
        MapDatabaseEndpoints(api);
    }

    /// <summary>Canlılık yoklaması.</summary>
    private static void MapHealthEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/health", () => Results.Ok(new { status = "ok" }));
    }

    /// <summary>Projeler ve revizyonlar.</summary>
    private static void MapProjectEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/projects", async (IProjectWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListProjectsAsync(token)));
        api.MapPost("/projects", async (CreateProjectRequest request, IProjectWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateProjectAsync(request.Code, request.Name, request.Description, token)));
        api.MapGet("/projects/{projectId:guid}/revisions", async (Guid projectId, IProjectWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListRevisionsAsync(projectId, token)));
        api.MapPost("/projects/{projectId:guid}/revisions", async (Guid projectId, IProjectWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateDraftRevisionAsync(projectId, token)));
        api.MapPost("/revisions/{revisionId:guid}/approve", async (Guid revisionId, IProjectWorkspace workspace, CancellationToken token) =>
        {
            await workspace.ApproveRevisionAsync(revisionId, token);
            return Results.NoContent();
        });
    }

    /// <summary>Kart kütüphanesi, kart türleri ve merkezi fire ayarları.</summary>
    private static void MapCatalogEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/catalog/cards", async (ICatalogWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListCardsAsync(token)));
        api.MapGet("/catalog/attributes", () => Results.Ok(CatalogCardAttributeCatalog.All));
        api.MapGet("/catalog/types", async (ICatalogCardTypeWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListTypesAsync(token)));
        api.MapPost("/catalog/types", async (CreateCatalogTypeRequest request, ICatalogCardTypeWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateTypeAsync(new CatalogCardTypeDraft(request.Code, request.Name, request.BaseCardType,
                request.AllowedParentCardIds, request.AllowedChildCardIds, request.AttributeKeys, request.Description), token)));
        api.MapDelete("/catalog/types/{typeId:guid}", async (Guid typeId, ICatalogCardTypeWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteTypeAsync(typeId, token);
            return Results.NoContent();
        });
        api.MapPost("/catalog/starter-pack", async (IStarterCatalogWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.SeedAsync(token)));
        api.MapPost("/catalog/cards", async (CreateCardRequest request, ICatalogWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateCardAsync(ToCatalogCardDraft(request), token)));
        api.MapPost("/catalog/cards/{cardId:guid}/versions", async (Guid cardId, CreateCardRequest request, ICatalogWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateVersionAsync(cardId, ToCatalogCardDraft(request), token)));
        api.MapPost("/catalog/cards/{cardId:guid}/deactivate", async (Guid cardId, ICatalogWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeactivateCardAsync(cardId, token);
            return Results.NoContent();
        });
        api.MapDelete("/catalog/cards/{cardId:guid}", async (Guid cardId, ICatalogWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteCardAsync(cardId, token);
            return Results.NoContent();
        });
        api.MapGet("/placements/{pipePlacementId:guid}/compatible-fittings", async (Guid pipePlacementId, ICatalogWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListCompatibleFittingsAsync(pipePlacementId, token)));
        api.MapGet("/settings/material-waste", async (IMaterialTypeWasteWorkspace workspace, CancellationToken token) => Results.Ok(await workspace.ListAsync(token)));
        api.MapPut("/settings/material-waste", async (MaterialWasteRequest request, IMaterialTypeWasteWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.UpsertAsync(request.MaterialType, request.WasteRatePct, token)));
        api.MapDelete("/settings/material-waste/{id:guid}", async (Guid id, IMaterialTypeWasteWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteAsync(id, token);
            return Results.NoContent();
        });
    }

    /// <summary>Proje haritasındaki kartlar ve aralarındaki bağlantılar.</summary>
    private static void MapPlacementEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/revisions/{revisionId:guid}/placements", async (Guid revisionId, IProjectTreeWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListPlacementsAsync(revisionId, token)));
        api.MapPost("/revisions/{revisionId:guid}/placements", async (Guid revisionId, AddPlacementRequest request, IProjectTreeWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.AddPlacementAsync(new PlacementDraft(revisionId, request.CardVersionId, request.ParentPlacementId, request.DisplayNameOverride, request.ProcurementScope), token)));
        api.MapPut("/placements/{placementId:guid}", async (Guid placementId, UpdatePlacementRequest request, IProjectTreeWorkspace workspace, CancellationToken token) =>
        {
            await workspace.UpdatePlacementAsync(placementId, new PlacementUpdateDraft(request.DisplayNameOverride, request.ProcurementScope, request.Notes), token);
            return Results.NoContent();
        });
        api.MapPut("/placements/{placementId:guid}/parent", async (Guid placementId, MovePlacementRequest request, IProjectTreeWorkspace workspace, CancellationToken token) =>
        {
            await workspace.MovePlacementAsync(placementId, request.ParentPlacementId, token);
            return Results.NoContent();
        });
        api.MapPost("/placements/{placementId:guid}/calculated-from", async (Guid placementId, AddCalculatedFromRequest request, IProjectTreeWorkspace workspace, CancellationToken token) =>
        {
            await workspace.AddLinkAsync(request.SourcePlacementId, placementId, SemanticLinkType.CalculatedFrom, request.Notes, token);
            return Results.NoContent();
        });
        api.MapDelete("/placements/{placementId:guid}", async (Guid placementId, IProjectTreeWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeletePlacementAsync(placementId, token);
            return Results.NoContent();
        });
    }

    /// <summary>Persistent floor/room exception notes belonging to individual placements.</summary>
    private static void MapPlacementContextNoteEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/placements/{placementId:guid}/context-notes", async (Guid placementId, IPlacementContextNoteWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListNotesAsync(placementId, token)));
        api.MapPost("/placements/{placementId:guid}/context-notes", async (Guid placementId, AddPlacementContextNoteRequest request, IPlacementContextNoteWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.AddNoteAsync(new PlacementContextNoteDraft(
                placementId, request.Text, request.Block, request.Floor, request.Room), token)));
        api.MapDelete("/placement-context-notes/{noteId:guid}", async (Guid noteId, IPlacementContextNoteWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteNoteAsync(noteId, token);
            return Results.NoContent();
        });
        api.MapDelete("/placements/{placementId:guid}/context-notes/{noteId:guid}", async (Guid placementId, Guid noteId, IPlacementContextNoteWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteNoteAsync(placementId, noteId, token);
            return Results.NoContent();
        });
    }

    /// <summary>Metraj satırları.</summary>
    private static void MapMeasurementEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/revisions/{revisionId:guid}/measurements", async (Guid revisionId, IMeasurementWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListMeasurementsAsync(revisionId, token)));
        api.MapGet("/revisions/{revisionId:guid}/measurement-summaries", async (Guid revisionId, IMeasurementWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListSummariesAsync(revisionId, token)));
        api.MapPost("/revisions/{revisionId:guid}/measurements", async (Guid revisionId, CreateMeasurementRequest request, IMeasurementWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateMeasurementAsync(new MeasurementDraft(
                revisionId, request.PlacementId, request.InputQuantity, request.InputUnit, request.Block, request.Floor,
                request.Room, request.Zone, request.Sheet, request.DrawingRevision, request.Notes, request.SourceKind ?? "USER", request.Variant, request.SecondaryVariant), token)));
        api.MapPost("/revisions/{revisionId:guid}/measurements/batch", async (Guid revisionId, IReadOnlyList<CreateMeasurementRequest> requests, IMeasurementWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateMeasurementsAsync(requests.Select(request => new MeasurementDraft(
                revisionId, request.PlacementId, request.InputQuantity, request.InputUnit, request.Block, request.Floor,
                request.Room, request.Zone, request.Sheet, request.DrawingRevision, request.Notes, request.SourceKind ?? "USER", request.Variant, request.SecondaryVariant)).ToList(), token)));
        api.MapPost("/measurements/{measurementId:guid}/duplicate", async (Guid measurementId, IMeasurementWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.DuplicateMeasurementAsync(measurementId, token)));
        api.MapDelete("/measurements/{measurementId:guid}", async (Guid measurementId, IMeasurementWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteMeasurementAsync(measurementId, token);
            return Results.NoContent();
        });
        api.MapPut("/measurements/{measurementId:guid}", async (Guid measurementId, UpdateMeasurementRequest request, IMeasurementWorkspace workspace, CancellationToken token) =>
        {
            await workspace.UpdateMeasurementAsync(measurementId, new MeasurementDraft(
                request.RevisionId, request.PlacementId, request.InputQuantity, request.InputUnit, request.Block,
                request.Floor, request.Room, request.Zone, request.Sheet, request.DrawingRevision, request.Notes,
                request.SourceKind ?? "USER", request.Variant, request.SecondaryVariant), token);
            return Results.NoContent();
        });
    }

    /// <summary>Hesap kuralları, sonuçları ve inceleme kararları.</summary>
    private static void MapCalculationEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/revisions/{revisionId:guid}/calculations/rules", async (Guid revisionId, ICalculationWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListRulesAsync(revisionId, token)));
        api.MapPost("/revisions/{revisionId:guid}/calculations/rules", async (Guid revisionId, CreateRuleRequest request, ICalculationWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateRuleVersionAsync(revisionId, new CalculationRuleDraft(request.Code, request.Name, request.Mode, request.Multiplier, request.SourceQuantityKind), token)));
        api.MapGet("/revisions/{revisionId:guid}/calculations/results", async (Guid revisionId, ICalculationWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListResultsAsync(revisionId, token)));
        api.MapPost("/revisions/{revisionId:guid}/calculations/results", async (Guid revisionId, CalculateRequest request, ICalculationWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CalculateAsync(revisionId, request.TargetPlacementId, request.RuleVersionId, token)));
        api.MapPost("/calculations/results/{resultId:guid}/approve", async (Guid resultId, ICalculationWorkspace workspace, CancellationToken token) =>
        {
            await workspace.ApproveAsync(resultId, token);
            return Results.NoContent();
        });
        api.MapPost("/calculations/results/{resultId:guid}/reject", async (Guid resultId, ReviewReasonRequest request, ICalculationWorkspace workspace, CancellationToken token) =>
        {
            await workspace.RejectAsync(resultId, request.Reason, token);
            return Results.NoContent();
        });
        api.MapPost("/calculations/results/{resultId:guid}/override", async (Guid resultId, OverrideCalculationRequest request, ICalculationWorkspace workspace, CancellationToken token) =>
        {
            await workspace.OverrideAsync(resultId, request.UsedQuantity, request.Reason, token);
            return Results.NoContent();
        });
    }

    /// <summary>Sorumluluk boyutları, tarafları ve atamaları.</summary>
    private static void MapResponsibilityEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/revisions/{revisionId:guid}/responsibilities", async (Guid revisionId, IResponsibilityWorkspace workspace, CancellationToken token) =>
            Results.Ok(new ResponsibilityView(
                await workspace.ListDimensionsAsync(revisionId, token),
                await workspace.ListPartiesAsync(revisionId, token),
                await workspace.ListAssignmentsAsync(revisionId, token))));
        api.MapPost("/revisions/{revisionId:guid}/responsibilities/dimensions", async (Guid revisionId, CreateNamedRequest request, IResponsibilityWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateDimensionAsync(revisionId, request.Code, request.Name, token)));
        api.MapPost("/revisions/{revisionId:guid}/responsibilities/parties", async (Guid revisionId, CreateNamedRequest request, IResponsibilityWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreatePartyAsync(revisionId, request.Code, request.Name, token)));
        api.MapPost("/revisions/{revisionId:guid}/responsibilities/assignments", async (Guid revisionId, AssignResponsibilityRequest request, IResponsibilityWorkspace workspace, CancellationToken token) =>
        {
            await workspace.AssignPlacementAsync(revisionId, request.DimensionId, request.PlacementId, request.PartyId, request.State, request.Notes, token);
            return Results.NoContent();
        });
    }

    /// <summary>Rapor verisi ve dışa aktarımlar.</summary>
    private static void MapReportEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/revisions/{revisionId:guid}/report", async (Guid revisionId, IProjectReportWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.BuildReportDataAsync(revisionId, token)));
        api.MapGet("/revisions/{revisionId:guid}/report/excel", async (Guid revisionId, Guid? placementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            placementId is Guid root
                ? await CreateSubtreeDownloadAsync(revisionId, root, ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", workspace.ExportSubtreeExcelAsync, token)
                : await CreateDownloadAsync(revisionId, ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", workspace.ExportExcelAsync, token));
        api.MapGet("/revisions/{revisionId:guid}/report/pdf", async (Guid revisionId, Guid? placementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            placementId is Guid root
                ? await CreateSubtreeDownloadAsync(revisionId, root, ".pdf", "application/pdf", workspace.ExportSubtreePdfAsync, token)
                : await CreateDownloadAsync(revisionId, ".pdf", "application/pdf", workspace.ExportPdfAsync, token));
        api.MapGet("/revisions/{revisionId:guid}/report/word", async (Guid revisionId, Guid? placementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            placementId is Guid root
                ? await CreateSubtreeDownloadAsync(revisionId, root, ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", workspace.ExportSubtreeWordAsync, token)
                : await CreateDownloadAsync(revisionId, ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", workspace.ExportWordAsync, token));
        api.MapGet("/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}", async (Guid revisionId, Guid rootPlacementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.BuildSubtreeReportDataAsync(revisionId, rootPlacementId, token)));
        api.MapGet("/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/excel", async (Guid revisionId, Guid rootPlacementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            await CreateSubtreeDownloadAsync(revisionId, rootPlacementId, ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", workspace.ExportSubtreeExcelAsync, token));
        api.MapGet("/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/pdf", async (Guid revisionId, Guid rootPlacementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            await CreateSubtreeDownloadAsync(revisionId, rootPlacementId, ".pdf", "application/pdf", workspace.ExportSubtreePdfAsync, token));
        api.MapGet("/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/word", async (Guid revisionId, Guid rootPlacementId, IProjectReportWorkspace workspace, CancellationToken token) =>
            await CreateSubtreeDownloadAsync(revisionId, rootPlacementId, ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", workspace.ExportSubtreeWordAsync, token));
    }

    /// <summary>Sentetik örnek veri içe aktarımı.</summary>
    private static void MapSyntheticDataEndpoints(RouteGroupBuilder api)
    {
        api.MapPost("/synthetic-clean-water", async (ISyntheticCleanWaterWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ImportAsync(token)));
    }

    /// <summary>Arayüzün kalıcı taslakları ve tercihleri.</summary>
    private static void MapUiStateEndpoints(RouteGroupBuilder api)
    {
        // Arayüzün kalıcı taslakları ve tercihleri. localStorage kullanılamaz:
        // loopback portu her açılışta değiştiği için origin, dolayısıyla
        // localStorage da sıfırlanıyor.
        api.MapGet("/ui-state", async (IUiStateWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListAsync(token)));
        api.MapPut("/ui-state", async (UiStateRequest request, IUiStateWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.SetAsync(request.Key, request.ValueJson, token)));
        api.MapDelete("/ui-state", async (string key, IUiStateWorkspace workspace, CancellationToken token) =>
        {
            await workspace.DeleteAsync(key, token);
            return Results.NoContent();
        });
    }

    /// <summary>Yedekleme, geri yükleme ve bütünlük.</summary>
    private static void MapDatabaseEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/database/backups", async (IDatabaseMaintenanceWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.ListBackupsAsync(token)));
        api.MapPost("/database/backups", async (IDatabaseMaintenanceWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CreateBackupAsync(DatabaseBackupReason.Manual, token)));
        api.MapPost("/database/backups/restore", async (RestoreBackupRequest request, IDatabaseMaintenanceWorkspace workspace, CancellationToken token) =>
        {
            await workspace.RestoreBackupAsync(request.FullPath, token);
            return Results.NoContent();
        });
        api.MapGet("/database/integrity", async (IDatabaseMaintenanceWorkspace workspace, CancellationToken token) =>
            Results.Ok(await workspace.CheckIntegrityAsync(token)));
    }

    private static void MapStaticReactApplication(WebApplication app)
    {
        FileExtensionContentTypeProvider contentTypes = new();
        app.MapGet("/{**assetPath}", async context =>
        {
            string requestPath = context.Request.Path.Value?.TrimStart('/') ?? string.Empty;
            if (requestPath.StartsWith("api/", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            string assetPath = string.IsNullOrWhiteSpace(requestPath) || !Path.HasExtension(requestPath)
                ? "index.html"
                : requestPath;
            if (assetPath.Contains("..", StringComparison.Ordinal) || assetPath.Contains('\\'))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            await using Stream? asset = OpenEmbeddedWebAsset(assetPath);
            if (asset is null)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            context.Response.ContentType = contentTypes.TryGetContentType(assetPath, out string? contentType)
                ? contentType
                : "application/octet-stream";
            await asset.CopyToAsync(context.Response.Body, context.RequestAborted);
        });
    }

    /// <summary>İstek yolundan gömülü kaynak adına: bir kez kurulur, bellekten servis edilir.</summary>
    /// <remarks>
    /// Önceki hâl kaynak adını istek başına tahmin ediyordu:
    /// <c>"Metraj.Api.Web." + assetPath.Replace('/', '\\')</c> -- yani DERLEME
    /// MAKİNESİNİN yol ayıracını çalışma zamanına gömüyordu, üstelik ikinci bir
    /// tahminle (assets\ ön eki) yedekleniyordu. Gerçek kaynak adları
    /// derlemeden okununca tahmin ortadan kalkıyor; ".." kontrolü de gereksizleşir
    /// çünkü sözlük araması dizinde gezinemez (kontrol yine de yerinde tutuldu).
    /// </remarks>
    private static readonly Dictionary<string, string> EmbeddedWebAssets = BuildEmbeddedWebAssetIndex();

    private static Dictionary<string, string> BuildEmbeddedWebAssetIndex()
    {
        const string prefix = "Metraj.Api.Web.";
        var index = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string resourceName in typeof(LocalApiHost).Assembly.GetManifestResourceNames())
        {
            if (!resourceName.StartsWith(prefix, StringComparison.Ordinal))
            {
                continue;
            }

            // Gömme sırasında dizin ayıracı olarak ne kullanıldıysa ('/' ya da
            // '\\') istek yolunun biçimine ('/') normalleştirilir.
            string relativePath = resourceName[prefix.Length..].Replace('\\', '/');
            index[relativePath] = resourceName;

            // "assets/index-abc.js" yerine yalnızca "index-abc.js" istendiğinde de
            // bulunabilsin: önceki hâlin ikinci tahmini bunu karşılıyordu.
            int lastSeparator = relativePath.LastIndexOf('/');
            if (lastSeparator >= 0)
            {
                index.TryAdd(relativePath[(lastSeparator + 1)..], resourceName);
            }
        }

        return index;
    }

    private static Stream? OpenEmbeddedWebAsset(string assetPath) =>
        EmbeddedWebAssets.TryGetValue(assetPath, out string? resourceName)
            ? typeof(LocalApiHost).Assembly.GetManifestResourceStream(resourceName)
            : null;

    private static Stream OpenSyntheticCleanWaterFixture()
    {
        return typeof(LocalApiHost).Assembly.GetManifestResourceStream("Metraj.Api.SampleData.CleanWaterSynthetic.csv")
            ?? throw new InvalidDataException("Uygulamaya gömülü sentetik Temiz Su örnek verisi bulunamadı.");
    }

    private static ItemKind GetItemKind(CardType cardType) => cardType is CardType.Material or CardType.Accessory
        ? ItemKind.Material
        : ItemKind.Service;

    private static CatalogCardDraft ToCatalogCardDraft(CreateCardRequest request) => new(
        request.Code, request.Name, request.CardType, GetItemKind(request.CardType), request.InputBehavior,
        request.SalesConversion, request.ReportBehavior, request.Unit, request.WasteRatePct,
        request.ContainerParameter, request.PositionNumber, request.Notes, request.MaterialType, request.CompatibleDiameters,
        request.CustomTypeId, request.AttributeValues, request.VariantMode, request.Variants);

    private static async Task<IResult> CreateDownloadAsync(
        Guid revisionId,
        string extension,
        string contentType,
        Func<Guid, string, CancellationToken, Task<ProjectReportExportResult>> export,
        CancellationToken cancellationToken)
    {
        string temporaryPath = Path.Combine(Path.GetTempPath(), $"metraj-{revisionId:N}-{Guid.NewGuid():N}{extension}");
        return await StreamExportAsync(
            temporaryPath,
            contentType,
            (path, token) => export(revisionId, path, token),
            cancellationToken);
    }

    private static async Task<IResult> CreateSubtreeDownloadAsync(Guid revisionId, Guid rootPlacementId, string extension, string contentType,
        Func<Guid, Guid, string, CancellationToken, Task<ProjectReportExportResult>> exporter, CancellationToken cancellationToken)
    {
        string temporaryPath = Path.Combine(Path.GetTempPath(), $"metraj-{revisionId:N}-{rootPlacementId:N}-{Guid.NewGuid():N}{extension}");
        return await StreamExportAsync(
            temporaryPath,
            contentType,
            (path, token) => exporter(revisionId, rootPlacementId, path, token),
            cancellationToken);
    }

    /// <summary>Üretilen belgeyi belleğe almadan akıtır ve ardından temizler.</summary>
    /// <remarks>
    /// Önceki hâl belgeyi diske yazıp <c>File.ReadAllBytesAsync</c> ile
    /// tamamını ikinci bir <c>byte[]</c>'e kopyalıyordu: büyük bir projenin
    /// raporu için indirme başlamadan önce belgenin tamamının hem diske hem
    /// belleğe sığması gerekiyordu. <c>DeleteOnClose</c> sayesinde geçici
    /// dosya, yanıt tamamlandığında kendini siler.
    /// </remarks>
    private static async Task<IResult> StreamExportAsync(
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

        try
        {
            var content = new FileStream(
                result.OutputPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 64 * 1024,
                FileOptions.Asynchronous | FileOptions.DeleteOnClose);
            return Results.File(content, contentType, Path.GetFileName(result.OutputPath));
        }
        catch
        {
            TryDeleteTemporaryFile(result.OutputPath);
            TryDeleteTemporaryFile(temporaryPath);
            throw;
        }
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

    /// <summary>Kaynak üreteçli günlük iletileri (analizörler çalışma zamanı biçimlendirmesini yasaklıyor).</summary>
    private static partial class Log
    {
        [LoggerMessage(EventId = 1000, Level = LogLevel.Information,
            Message = "Alan kuralı reddi: {Rule}")]
        public static partial void DomainRuleRejected(ILogger logger, string rule);

        [LoggerMessage(EventId = 1001, Level = LogLevel.Error,
            Message = "Beklenmeyen sunucu hatası: {Path}")]
        public static partial void UnexpectedFault(ILogger logger, string path, Exception exception);
    }

    /// <summary>Kullanıcıya gösterilecek metin ve dallanma için kararlı kural kodu.</summary>
    private sealed record ApiError(string Message, string Rule);
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
