using System.Text.Encodings.Web;
using System.Text.Json;
using Metraj.Application;
using Metraj.Host;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Hata eşlemesi ve bakım kapısı router seviyesinde: Android köprüsü HTTP
/// katmanı olmadan da aynı korumaları almalı.
/// </summary>
public sealed class MetrajRequestRouterErrorMappingTests
{
    private static readonly JsonSerializerOptions RelaxedJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private const string GenericFault = """{"message":"Beklenmeyen bir hata oluştu. Sorun sürerse uygulamayı yeniden başlatın.","rule":"server.error"}""";

    [Fact]
    public async Task DomainRuleViolationsBecome400WithTheTurkishCatalogMessageAndAreLogged()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-errors-domain");
        using var services = MetrajServices.Create(database.Path);
        var logger = new RecordingLogger();
        var router = new MetrajRequestRouter(services, logger);

        RouterResponse response = await router.DispatchAsync(
            Json("POST", "/api/projects", """{"code":"   ","name":"x"}"""), CancellationToken.None);

        Assert.Equal(400, response.Status);
        Assert.Equal("application/json; charset=utf-8", response.ContentType);
        Assert.Equal(JsonSerializer.Serialize(
            new { message = DomainMessageCatalog.Resolve("project.code"), rule = "project.code" },
            RelaxedJson), response.BodyJson);
        LogEntry entry = Assert.Single(logger.Entries);
        Assert.Equal((LogLevel.Information, 1000, "Alan kuralı reddi: project.code"), (entry.Level, entry.EventId, entry.Message));
        Assert.Null(entry.Exception);
    }

    [Fact]
    public async Task UnexpectedFaultsBecomeAGeneric500WithoutLeakingDetailsAndAreLoggedWithTheException()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-errors-fault");
        using var services = WithProjects(MetrajServices.Create(database.Path),
            new ThrowingProjectWorkspace(new InvalidOperationException("gizli iç ayrıntı: C:\\Users\\x\\veri.db")));
        var logger = new RecordingLogger();
        var router = new MetrajRequestRouter(services, logger);

        RouterResponse response = await router.DispatchAsync(new RouterRequest("GET", "/api/projects?a=1", null, null, null), CancellationToken.None);

        Assert.Equal(500, response.Status);
        Assert.Equal(GenericFault, response.BodyJson);
        Assert.DoesNotContain("gizli", response.BodyJson, StringComparison.Ordinal);
        LogEntry entry = Assert.Single(logger.Entries);
        Assert.Equal((LogLevel.Error, 1001, "Beklenmeyen sunucu hatası: /api/projects"), (entry.Level, entry.EventId, entry.Message));
        Assert.IsType<InvalidOperationException>(entry.Exception);

        // Önceden de böyleydi: InvalidOperationException kullanıcı hatası (400) sayılmaz.
        // İptal edilmemiş bir istekte yükselen iptal istisnası da sunucu arızasıdır.
        using var canceledInside = WithProjects(MetrajServices.Create(database.Path),
            new ThrowingProjectWorkspace(new OperationCanceledException()));
        RouterResponse timeout = await new MetrajRequestRouter(canceledInside)
            .DispatchAsync(new RouterRequest("GET", "/api/projects", null, null, null), CancellationToken.None);
        Assert.Equal(500, timeout.Status);
        Assert.Equal(GenericFault, timeout.BodyJson);
    }

    [Fact]
    public async Task ACanceledRequestPropagatesCancellationInsteadOfWritingAnError()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-errors-cancel");
        using var services = WithProjects(MetrajServices.Create(database.Path),
            new ThrowingProjectWorkspace(new OperationCanceledException()));
        var logger = new RecordingLogger();
        var router = new MetrajRequestRouter(services, logger);
        using var canceled = new CancellationTokenSource();
        await canceled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            router.DispatchAsync(new RouterRequest("GET", "/api/projects", null, null, null), canceled.Token));
        Assert.Empty(logger.Entries);
    }

    [Fact]
    public async Task OrdinaryRequestsWaitForMaintenanceButMaintenanceEndpointsTakeTheGateThemselves()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-gate");
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);

        // Sıradan istek, devam eden bir bakım bitene kadar bekler.
        Task<RouterResponse> waiting;
        await using (await services.DatabaseGate.EnterMaintenanceAsync())
        {
            waiting = router.DispatchAsync(new RouterRequest("GET", "/api/health", null, null, null), CancellationToken.None);
            await Task.Delay(200);
            Assert.False(waiting.IsCompleted, "Bakım sürerken sıradan bir istek veritabanına ulaşmamalı.");
        }

        Assert.Equal(200, (await waiting.WaitAsync(TimeSpan.FromSeconds(10))).Status);

        // Bakım uçları kapıyı KENDİLERİ alır. Router onlar için de sıradan bir yuva
        // tutsaydı, bakım bütün yuvaları beklerken kendi yuvasını da bekler ve
        // kilitlenirdi; burada süre aşımıyla yakalanır. Büyük/küçük harf yol eşleşmesini
        // değiştirmez (önceki StartsWithSegments da duyarsızdı).
        RouterResponse restore = await router.DispatchAsync(
            Json("POST", "/API/Database/Backups/Restore", """{"fullPath":"C:\\\\baska-klasor\\\\yedek.db"}"""),
            CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(400, restore.Status);
        Assert.Contains("\"rule\":\"backup.outside-folder\"", restore.BodyJson, StringComparison.Ordinal);

        RouterResponse reset = await router.DispatchAsync(new RouterRequest("DELETE", "/api/database/projects", null, null, null),
            CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Equal(200, reset.Status);
        Assert.Contains("\"deletedProjectCount\":0", reset.BodyJson, StringComparison.Ordinal);

        RouterResponse export = await router.DispatchAsync(new RouterRequest("GET", "/api/workspace/export", null, null, null), CancellationToken.None);
        byte[] package = await File.ReadAllBytesAsync(export.File!.Path);
        File.Delete(export.File.Path);
        RouterResponse import = await router.DispatchAsync(
            new RouterRequest("POST", "/api/workspace/import", null, () => new MemoryStream(package), null),
            CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Equal(200, import.Status);

        Assert.True(MetrajRequestRouter.IsMaintenanceRequest("/api/workspace/import?x=1"));
        Assert.True(MetrajRequestRouter.IsMaintenanceRequest("/api/database/projects/"));
        Assert.False(MetrajRequestRouter.IsMaintenanceRequest("/api/database/projectsx"));
        Assert.False(MetrajRequestRouter.IsMaintenanceRequest("/api/database/backups"));
    }

    [Fact]
    public async Task WorkspaceImportWithoutAFileOrWithAnEmptyFileIsTheSameDomainError()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-import-empty");
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);
        string expected = JsonSerializer.Serialize(
            new { message = DomainMessageCatalog.Resolve("workspace-import.empty"), rule = "workspace-import.empty" },
            RelaxedJson);
        string temporaryDirectory = Path.GetTempPath();
        int importFilesBefore = Directory.EnumerateFiles(temporaryDirectory, "proje-metraj-import-*.metraj").Count();

        RouterResponse missing = await router.DispatchAsync(new RouterRequest("POST", "/api/workspace/import", null, null, null), CancellationToken.None);
        RouterResponse empty = await router.DispatchAsync(
            new RouterRequest("POST", "/api/workspace/import", null, () => new MemoryStream(), null), CancellationToken.None);

        Assert.Equal((400, expected), (missing.Status, missing.BodyJson));
        Assert.Equal((400, expected), (empty.Status, empty.BodyJson));
        Assert.True(Directory.EnumerateFiles(temporaryDirectory, "proje-metraj-import-*.metraj").Count() <= importFilesBefore,
            "Boş içe aktarmanın geçici dosyası silinmeliydi.");
    }

    [Fact]
    public void BodyKindTellsTheHttpAdapterWhenToReadTheBody()
    {
        var id = Guid.NewGuid();
        Assert.Equal(RouterBodyKind.Json, MetrajRequestRouter.ResolveBodyKind("POST", "/api/projects"));
        Assert.Equal(RouterBodyKind.Json, MetrajRequestRouter.ResolveBodyKind("put", $"/api/measurements/{id}"));
        Assert.Equal(RouterBodyKind.File, MetrajRequestRouter.ResolveBodyKind("POST", "/api/workspace/import"));
        Assert.Equal(RouterBodyKind.None, MetrajRequestRouter.ResolveBodyKind("GET", "/api/projects"));
        Assert.Equal(RouterBodyKind.None, MetrajRequestRouter.ResolveBodyKind("POST", $"/api/revisions/{id}/approve"));
        // Eşleşmeyen istekte gövde okunmaz: bozuk bir gövde 404/405 alır, 400 değil.
        Assert.Equal(RouterBodyKind.None, MetrajRequestRouter.ResolveBodyKind("POST", "/api/revisions/not-a-guid/placements"));
        Assert.Equal(RouterBodyKind.None, MetrajRequestRouter.ResolveBodyKind("PUT", "/api/projects"));
    }

    private static RouterRequest Json(string method, string path, string body) => new(method, path, body, null, "application/json");

    private static MetrajServices WithProjects(MetrajServices real, IProjectWorkspace projects) => new()
    {
        DatabaseGate = real.DatabaseGate,
        Projects = projects,
        Catalog = real.Catalog,
        CatalogCardTypes = real.CatalogCardTypes,
        StarterCatalog = real.StarterCatalog,
        ProjectTree = real.ProjectTree,
        PlacementContextNotes = real.PlacementContextNotes,
        Responsibilities = real.Responsibilities,
        Measurements = real.Measurements,
        Calculations = real.Calculations,
        Reports = real.Reports,
        MaterialTypeWaste = real.MaterialTypeWaste,
        UiState = real.UiState,
        WorkspaceTransfer = real.WorkspaceTransfer,
        DatabaseMaintenance = real.DatabaseMaintenance,
        SyntheticCleanWater = real.SyntheticCleanWater
    };

    private sealed class ThrowingProjectWorkspace(Exception exception) : IProjectWorkspace
    {
        public Task<IReadOnlyList<ProjectListItem>> ListProjectsAsync(CancellationToken cancellationToken = default) =>
            Task.FromException<IReadOnlyList<ProjectListItem>>(exception);

        public Task<ProjectListItem> CreateProjectAsync(string code, string name, string? description = null, CancellationToken cancellationToken = default) =>
            Task.FromException<ProjectListItem>(exception);

        public Task<IReadOnlyList<ProjectRevisionListItem>> ListRevisionsAsync(Guid projectId, CancellationToken cancellationToken = default) =>
            Task.FromException<IReadOnlyList<ProjectRevisionListItem>>(exception);

        public Task<ProjectRevisionListItem> CreateDraftRevisionAsync(Guid projectId, CancellationToken cancellationToken = default) =>
            Task.FromException<ProjectRevisionListItem>(exception);

        public Task ApproveRevisionAsync(Guid revisionId, CancellationToken cancellationToken = default) => Task.FromException(exception);
    }

    private sealed record LogEntry(LogLevel Level, int EventId, string Message, Exception? Exception);

    private sealed class RecordingLogger : ILogger
    {
        public List<LogEntry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add(new LogEntry(logLevel, eventId.Id, formatter(state, exception), exception));
    }
}
