using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using Metraj.Api;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Host;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Router doğrudan (HTTP olmadan, Android'in çağıracağı gibi) çağrıldığında, aynı
/// istek için Kestrel üzerinden dönenle aynı durum kodunu ve gövdeyi üretmeli.
/// </summary>
/// <remarks>
/// Kestrel yolu artık router'ın üzerinde ince bir adaptör olduğu için bu test,
/// adaptörün (gövde okuma, multipart, karakter kümesi, Allow başlığı, dosya akışı)
/// hiçbir şeyi değiştirmediğini ve Android köprüsünün masaüstüyle aynı sözleşmeyi
/// göreceğini doğrular. Eski minimal API'ye karşı mutlak beklentiler
/// <see cref="LocalApiHttpContractTests"/>'tedir.
/// </remarks>
public sealed partial class MetrajRequestRouterParityTests
{
    [Fact]
    public async Task RepresentativeRequestsProduceTheSameStatusAndBodyWithAndWithoutHttp()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-parity");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);

        string rev = seed.RevisionId.ToString();
        (string Method, string Path, string? Body, string ContentType)[] requests =
        [
            // Okumalar (ondalık ve enum içeren gövdeler dâhil).
            ("GET", "/api/health", null, "application/json"),
            ("GET", "/api/projects", null, "application/json"),
            ("GET", $"/api/revisions/{rev}/measurements", null, "application/json"),
            ("GET", $"/api/revisions/{rev}/measurement-summaries", null, "application/json"),
            ("GET", "/api/catalog/cards", null, "application/json"),
            ("GET", "/api/catalog/attributes", null, "application/json"),
            ("GET", $"/api/revisions/{rev}/placements", null, "application/json"),
            // Hata sözleşmesi: alan kuralı, beklenmeyen hata, bulunamayan kayıt.
            ("POST", "/api/projects", """{"code":"   ","name":"Geçersiz"}""", "application/json"),
            ("POST", $"/api/revisions/{rev}/measurements/batch", "[null]", "application/json"),
            ("GET", $"/api/placements/{Guid.NewGuid()}/compatible-fittings", null, "application/json"),
            // Bağlama hataları.
            ("POST", "/api/projects", null, "application/json"),
            ("POST", "/api/projects", "{", "application/json"),
            ("POST", "/api/projects", "null", "application/json"),
            ("POST", "/api/projects", "kod=P", "text/plain"),
            ("POST", "/api/catalog/cards", CardJson("\"Materyal\""), "application/json"),
            ("POST", "/api/catalog/cards", CardJson("0"), "application/json"),
            // Yönlendirme: 404 ve 405.
            ("GET", "/api/projects/not-a-guid/revisions", null, "application/json"),
            ("POST", "/api/projects/not-a-guid/revisions", null, "application/json"),
            ("GET", "/api/boyle-bir-uc-nokta-yok", null, "application/json"),
            ("PUT", "/api/projects", null, "application/json"),
            ("PATCH", $"/api/placements/{seed.PlacementId}", null, "application/json"),
            ("GET", "/api/projects/", null, "application/json"),
            ("GET", $"/API/REVISIONS/{rev.ToUpperInvariant()}/measurements", null, "application/json"),
            // Sorgu parametreleri: ui-state DELETE key ve rapor placementId.
            ("DELETE", "/api/ui-state", null, "application/json"),
            ("DELETE", "/api/ui-state?key=", null, "application/json"),
            ("DELETE", "/api/ui-state?key=hic%20olmayan+anahtar", null, "application/json"),
            ("GET", $"/api/revisions/{rev}/report/excel?placementId=abc", null, "application/json"),
            ("GET", $"/api/revisions/{rev}/report/excel?placementId=", null, "application/json"),
            // İçe aktarma: dosya yok.
            ("POST", "/api/workspace/import", "{}", "application/json")
        ];

        foreach ((string method, string path, string? body, string contentType) in requests)
        {
            Exchange viaHttp = await ViaKestrelAsync(client, method, path, body, contentType);
            Exchange direct = await ViaRouterAsync(router, method, path, body, contentType);
            Assert.True(viaHttp == direct, $"{method} {path}{Environment.NewLine}  Kestrel: {viaHttp}{Environment.NewLine}  Router:  {direct}");
        }

        // Yazma uçları yeni kimlik ve zaman damgası üretir; onlar dışında gövde aynıdır.
        string measurement = $$"""{"placementId":"{{seed.PlacementId}}","inputQuantity":"4.25","inputUnit":"m","variant":"DN25"}""";
        Exchange createdViaHttp = await ViaKestrelAsync(client, "POST", $"/api/revisions/{rev}/measurements", measurement, "application/json");
        Exchange createdDirect = await ViaRouterAsync(router, "POST", $"/api/revisions/{rev}/measurements", measurement, "application/json");
        Assert.Equal(200, createdViaHttp.Status);
        Assert.Contains("\"inputQuantity\":4.25,", createdViaHttp.Body, StringComparison.Ordinal);
        Assert.Equal(createdViaHttp with { Body = Normalize(createdViaHttp.Body) }, createdDirect with { Body = Normalize(createdDirect.Body) });

        string card(string code) =>
            $$"""{"code":"{{code}}","name":"Enum kartı","cardType":"material","unit":"m","inputBehavior":"Manual","salesConversion":"None","reportBehavior":"Measurable","wasteRatePct":2.5}""";
        Exchange cardViaHttp = await ViaKestrelAsync(client, "POST", "/api/catalog/cards", card("PARITY-A"), "application/json");
        Exchange cardDirect = await ViaRouterAsync(router, "POST", "/api/catalog/cards", card("PARITY-B"), "application/json");
        Assert.Contains("\"cardType\":\"Material\"", cardViaHttp.Body, StringComparison.Ordinal);
        Assert.Equal(
            Normalize(cardViaHttp.Body).Replace("PARITY-A", "PARITY-?", StringComparison.Ordinal),
            Normalize(cardDirect.Body).Replace("PARITY-B", "PARITY-?", StringComparison.Ordinal));

        // 204: gövdesiz, içerik türsüz.
        Assert.Equal(await ViaKestrelAsync(client, "PUT", "/api/ui-state", """{"key":"a","valueJson":"1"}""", "application/json") with { Body = "" },
            await ViaRouterAsync(router, "PUT", "/api/ui-state", """{"key":"a","valueJson":"1"}""", "application/json") with { Body = "" });
        Assert.Equal(await ViaKestrelAsync(client, "DELETE", "/api/ui-state?key=a", null, "application/json"),
            new Exchange(204, null, "", null));
        Assert.Equal(await ViaRouterAsync(router, "DELETE", "/api/ui-state?key=a", null, "application/json"),
            new Exchange(204, null, "", null));
    }

    [Fact]
    public async Task FileDownloadsCarryTheSameMetadataAndTheRouterHandsOverATemporaryFile()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-router-parity-files");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);

        foreach ((string path, string pattern, string signature) in new[]
        {
            ($"/api/revisions/{seed.RevisionId}/report/excel", $"^metraj-{seed.RevisionId:N}-[0-9a-f]{{32}}\\.xlsx$", "PK"),
            ($"/api/revisions/{seed.RevisionId}/report/word?placementId={seed.PlacementId}", $"^metraj-{seed.RevisionId:N}-{seed.PlacementId:N}-[0-9a-f]{{32}}\\.docx$", "PK"),
            ("/api/workspace/export", "^ProjeMetraj-\\d{8}-\\d{6}\\.metraj$", "SQLite format 3")
        })
        {
            using HttpResponseMessage viaHttp = await client.GetAsync(path.TrimStart('/'));
            byte[] httpBytes = await viaHttp.Content.ReadAsByteArrayAsync();
            RouterResponse direct = await router.DispatchAsync(new RouterRequest("GET", path, null, null, null), CancellationToken.None);

            Assert.Equal(200, (int)viaHttp.StatusCode);
            Assert.Equal(200, direct.Status);
            Assert.Null(direct.BodyJson);
            RouterFile file = Assert.IsType<RouterFile>(direct.File);
            Assert.Equal(viaHttp.Content.Headers.ContentType?.ToString(), file.ContentType);
            Assert.Equal(file.ContentType, direct.ContentType);
            Assert.Matches(pattern, viaHttp.Content.Headers.ContentDisposition?.FileName ?? "");
            Assert.Matches(pattern, file.DownloadName);
            Assert.True(file.DeleteWhenDone);

            // İkili içerik bellekte taşınmadı: router diske yazdı, tüketici akıtıp silecek.
            byte[] fileBytes = await File.ReadAllBytesAsync(file.Path);
            Assert.StartsWith(signature, Encoding.ASCII.GetString(fileBytes, 0, signature.Length), StringComparison.Ordinal);
            Assert.StartsWith(signature, Encoding.ASCII.GetString(httpBytes, 0, signature.Length), StringComparison.Ordinal);
            File.Delete(file.Path);
        }
    }

    [Fact]
    public async Task WorkspaceImportFromARawStreamMatchesTheMultipartUpload()
    {
        await using TestDatabase source = await TestDatabase.CreateAsync("metraj-router-parity-import-source");
        await using TestDatabase viaHttpTarget = await TestDatabase.CreateAsync("metraj-router-parity-import-http");
        await using TestDatabase directTarget = await TestDatabase.CreateAsync("metraj-router-parity-import-direct");
        await SeedAsync(source);

        byte[] package;
        using (var sourceServices = MetrajServices.Create(source.Path))
        {
            RouterResponse export = await new MetrajRequestRouter(sourceServices)
                .DispatchAsync(new RouterRequest("GET", "/api/workspace/export", null, null, null), CancellationToken.None);
            package = await File.ReadAllBytesAsync(export.File!.Path);
            File.Delete(export.File.Path);
        }

        Exchange viaHttp;
        await using (LocalApiHost host = await LocalApiHost.StartAsync(viaHttpTarget.Path))
        using (var client = new HttpClient { BaseAddress = host.BaseUri })
        using (var form = new MultipartFormDataContent())
        {
            form.Add(new ByteArrayContent(package), "file", "aktarim.metraj");
            using HttpResponseMessage response = await client.PostAsync("api/workspace/import", form);
            viaHttp = new Exchange((int)response.StatusCode, response.Content.Headers.ContentType?.ToString(),
                await response.Content.ReadAsStringAsync(), null);
        }

        Exchange direct;
        using (var services = MetrajServices.Create(directTarget.Path))
        {
            RouterResponse response = await new MetrajRequestRouter(services).DispatchAsync(
                new RouterRequest("POST", "/api/workspace/import", null, () => new MemoryStream(package), "application/vnd.projemetraj.workspace"),
                CancellationToken.None);
            direct = ToExchange(response);
        }

        Assert.Equal(200, viaHttp.Status);
        Assert.Contains("\"importedProjects\":1", viaHttp.Body, StringComparison.Ordinal);
        Assert.Equal(viaHttp, direct);
    }

    private static string CardJson(string cardType) =>
        $$"""{"code":"ENUM-PARITY","name":"Enum kartı","cardType":{{cardType}},"unit":"m","inputBehavior":"Manual","salesConversion":"None","reportBehavior":"Measurable","wasteRatePct":0}""";

    /// <summary>Her yeni kaydın kimliği ve zaman damgası farklıdır; karşılaştırmadan çıkarılır.</summary>
    private static string Normalize(string json) =>
        TimestampPattern().Replace(GuidPattern().Replace(json, "<guid>"), "<zaman>");

    [GeneratedRegex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex GuidPattern();

    [GeneratedRegex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z?")]
    private static partial Regex TimestampPattern();

    private static async Task<Exchange> ViaKestrelAsync(HttpClient client, string method, string path, string? body, string contentType)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path.TrimStart('/'));
        if (body is not null)
        {
            request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body));
            request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        }

        using HttpResponseMessage response = await client.SendAsync(request);
        string? allow = response.Content.Headers.Allow.Count == 0 ? null : string.Join(", ", response.Content.Headers.Allow);
        return new Exchange((int)response.StatusCode, response.Content.Headers.ContentType?.ToString(),
            await response.Content.ReadAsStringAsync(), allow);
    }

    private static async Task<Exchange> ViaRouterAsync(MetrajRequestRouter router, string method, string path, string? body, string contentType)
    {
        RouterResponse response = await router.DispatchAsync(
            new RouterRequest(method, path, body, null, body is null ? null : contentType), CancellationToken.None);
        return ToExchange(response);
    }

    private static Exchange ToExchange(RouterResponse response)
    {
        Assert.Null(response.File);
        return new Exchange(response.Status, response.ContentType.Length == 0 ? null : response.ContentType,
            response.BodyJson ?? string.Empty, response.Allow);
    }

    private static async Task<Seed> SeedAsync(TestDatabase database)
    {
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("P-PARITY", "Eşdeğerlik Şişli");
        CatalogCardListItem card = await new CatalogWorkspaceService(database.ContextFactory).CreateCardAsync(new CatalogCardDraft(
            "PIPE-PARITY", "Eşdeğerlik borusu", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.StandardLength, ReportBehavior.Measurable, "m", WasteRatePct: 7.5m, ContainerParameter: 6m));
        PlacementListItem placement = await new ProjectTreeWorkspaceService(database.ContextFactory)
            .AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        await new MeasurementWorkspaceService(database.ContextFactory)
            .CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id, 12.345678m, "m", Block: "A", Floor: "1"));
        return new Seed(project.LatestRevisionId, placement.Id);
    }

    private sealed record Seed(Guid RevisionId, Guid PlacementId);

    private sealed record Exchange(int Status, string? ContentType, string Body, string? Allow);
}
