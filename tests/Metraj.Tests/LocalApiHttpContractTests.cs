using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Metraj.Api;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Yerel HTTP sınırının ayrıntılı sözleşmesi: bağlama hataları, 404/405 ayrımı,
/// sorgu parametreleri, hata gövdeleri ve dosya yanıtları.
/// </summary>
/// <remarks>
/// Uç nokta mantığı ASP.NET Core minimal API'lerinden taşıma katmanından bağımsız
/// bir router'a taşınırken bu beklentiler ÖNCE eski minimal API uygulamasına karşı
/// çalıştırılarak elde edildi. Yani buradaki her durum kodu ve gövde "olması
/// gereken" değil, "kullanıcının bugüne kadar gördüğü" davranıştır; router bunu
/// birebir korumak zorundadır. Önceden bu ayrıntıların hiçbiri test edilmiyordu:
/// örneğin boş gövdeli bir POST'un 400 (gövdesiz), yanlış içerik türünün 415,
/// bilinmeyen yöntemin 405 + Allow döndüğü yalnızca çerçevenin varsayılanıydı.
/// </remarks>
public sealed class LocalApiHttpContractTests
{
    private const string JsonContentType = "application/json; charset=utf-8";

    private static readonly JsonSerializerOptions RelaxedJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    [Fact]
    public async Task JsonBodyBindingFailuresKeepTheirStatusCodesAndEmptyBodies()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-http-contract-binding");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        Reply health = await SendAsync(client, "GET", "api/health");
        Assert.Equal(HttpStatusCode.OK, health.Status);
        Assert.Equal(JsonContentType, health.ContentType);
        // Bilinçli sözleşme değişikliği: eskiden yalnız {"status":"ok"} dönerdi; sürüm ve veri
        // klasörü eklendi. "status" yerinde ve ilk alan olarak kalır (eski istemciler yalnız onu okur).
        using (var healthJson = JsonDocument.Parse(health.Body))
        {
            Assert.Equal(["status", "version", "dataLocation"],
                healthJson.RootElement.EnumerateObject().Select(property => property.Name));
            Assert.Equal("ok", healthJson.RootElement.GetProperty("status").GetString());
            Assert.False(string.IsNullOrWhiteSpace(healthJson.RootElement.GetProperty("version").GetString()));
            Assert.Equal(Path.GetDirectoryName(Path.GetFullPath(database.Path)),
                healthJson.RootElement.GetProperty("dataLocation").GetString());
        }

        // Gövde yok -> 400, gövdesiz.
        AssertEmpty(await SendAsync(client, "POST", "api/projects"), HttpStatusCode.BadRequest);
        // JSON olmayan içerik türü -> 415.
        AssertEmpty(await SendAsync(client, "POST", "api/projects", "kod=P1", "text/plain"), HttpStatusCode.UnsupportedMediaType);
        // Bozuk JSON, JSON null ve boşluk -> 400.
        AssertEmpty(await SendAsync(client, "POST", "api/projects", "{"), HttpStatusCode.BadRequest);
        AssertEmpty(await SendAsync(client, "POST", "api/projects", "null"), HttpStatusCode.BadRequest);
        AssertEmpty(await SendAsync(client, "POST", "api/projects", "   "), HttpStatusCode.BadRequest);
        // Dizi bekleyen uçta nesne -> 400.
        AssertEmpty(await SendAsync(client, "POST", $"api/revisions/{seed.RevisionId}/measurements/batch", "{}"), HttpStatusCode.BadRequest);

        // Numaralandırmalar yalnız adla: bilinmeyen ad da tam sayı da 400.
        string cardJson(string cardType) =>
            $$"""{"code":"ENUM-{{Guid.NewGuid():N}}","name":"Enum kartı","cardType":{{cardType}},"unit":"m","inputBehavior":"Manual","salesConversion":"None","reportBehavior":"Measurable","wasteRatePct":0}""";
        AssertEmpty(await SendAsync(client, "POST", "api/catalog/cards", cardJson("\"Materyal\"")), HttpStatusCode.BadRequest);
        AssertEmpty(await SendAsync(client, "POST", "api/catalog/cards", cardJson("0")), HttpStatusCode.BadRequest);
        Reply enumCard = await SendAsync(client, "POST", "api/catalog/cards", cardJson("\"material\""));
        Assert.Equal(HttpStatusCode.OK, enumCard.Status);
        Assert.Contains("\"cardType\":\"Material\"", enumCard.Body, StringComparison.Ordinal);

        // +json son ekli içerik türü de JSON sayılır; sayı metin olarak da okunur (web varsayılanları).
        Reply measurement = await SendAsync(client, "POST", $"api/revisions/{seed.RevisionId}/measurements",
            $$"""{"placementId":"{{seed.PlacementId}}","inputQuantity":"4.25","inputUnit":"m"}""", "application/merge-patch+json");
        Assert.Equal(HttpStatusCode.OK, measurement.Status);
        Assert.Equal(JsonContentType, measurement.ContentType);
        Assert.Contains("\"inputQuantity\":4.25,", measurement.Body, StringComparison.Ordinal);

        // UTF-16 gövde, içerik türündeki karakter kümesine göre çözülür.
        using (var utf16 = new HttpRequestMessage(HttpMethod.Put, "api/ui-state"))
        {
            utf16.Content = new ByteArrayContent(Encoding.Unicode.GetBytes("""{"key":"utf16-anahtar","valueJson":"\"Şişli\""}"""));
            utf16.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json; charset=utf-16");
            using HttpResponseMessage response = await client.SendAsync(utf16);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("\\\"Şişli\\\"", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        // Türkçe metin kaçışsız yazılır (UnsafeRelaxedJsonEscaping).
        Reply project = await SendAsync(client, "POST", "api/projects", """{"code":"P-ŞİŞLİ","name":"Şişli Ğ Ü Ö Ç","description":null}""");
        Assert.Equal(HttpStatusCode.OK, project.Status);
        Assert.Contains("\"name\":\"Şişli Ğ Ü Ö Ç\"", project.Body, StringComparison.Ordinal);
        Assert.DoesNotContain("\\u", project.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnknownRoutesMethodsAndConstraintsKeepTheir404And405Semantics()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-http-contract-routing");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        // :guid kısıtı tutmayan yol 404 (GET de POST da).
        AssertEmpty(await SendAsync(client, "GET", "api/projects/not-a-guid/revisions"), HttpStatusCode.NotFound);
        AssertEmpty(await SendAsync(client, "POST", "api/projects/not-a-guid/revisions"), HttpStatusCode.NotFound);
        AssertEmpty(await SendAsync(client, "DELETE", "api/catalog/types/not-a-guid"), HttpStatusCode.NotFound);

        // Bilinmeyen yol: GET 404, diğer yöntemler 405 (statik arayüz GET'i her yolu karşılar).
        AssertEmpty(await SendAsync(client, "GET", "api/boyle-bir-uc-nokta-yok"), HttpStatusCode.NotFound);
        AssertEmpty(await SendAsync(client, "GET", "api/"), HttpStatusCode.NotFound);
        AssertAllow(await SendAsync(client, "POST", "api/boyle-bir-uc-nokta-yok"), "GET");
        AssertAllow(await SendAsync(client, "POST", "api/"), "GET");

        // Bilinen yol, desteklenmeyen yöntem: 405 + Allow (sıralı).
        AssertAllow(await SendAsync(client, "PUT", "api/projects"), "GET, POST");
        AssertAllow(await SendAsync(client, "DELETE", "api/health"), "GET");
        AssertAllow(await SendAsync(client, "HEAD", "api/health"), "GET");
        AssertAllow(await SendAsync(client, "POST", $"api/catalog/cards/{Guid.NewGuid()}"), "DELETE, GET");
        AssertAllow(await SendAsync(client, "PATCH", $"api/placements/{seed.PlacementId}"), "DELETE, GET, PUT");
        AssertAllow(await SendAsync(client, "PUT", "api/workspace/import"), "GET, POST");
        AssertAllow(await SendAsync(client, "PUT", "api/projects/not-a-guid/revisions"), "GET, POST");
        // Yalnız DELETE tanımlı yolda GET 405 değil 404'tür.
        AssertEmpty(await SendAsync(client, "GET", "api/database/projects"), HttpStatusCode.NotFound);

        // Sondaki eğik çizgi ve büyük/küçük harf yol eşleşmesini değiştirmez.
        Reply trailing = await SendAsync(client, "GET", "api/projects/");
        Assert.Equal(HttpStatusCode.OK, trailing.Status);
        Assert.StartsWith("[", trailing.Body, StringComparison.Ordinal);
        Reply upper = await SendAsync(client, "GET", $"API/Revisions/{seed.RevisionId.ToString().ToUpperInvariant()}/MEASUREMENTS");
        Assert.Equal(HttpStatusCode.OK, upper.Status);
        Assert.Contains(seed.MeasurementId.ToString(), upper.Body, StringComparison.Ordinal);

        // "/api" (eğik çizgisiz) API değil, arayüzün kendisidir.
        Reply bare = await SendAsync(client, "GET", "api");
        Assert.Equal(HttpStatusCode.OK, bare.Status);
        Assert.Contains("id=\"root\"", bare.Body, StringComparison.Ordinal);
        AssertAllow(await SendAsync(client, "POST", "api"), "GET");

        // 204 gövdesiz ve içerik türsüz döner.
        AssertEmpty(await SendAsync(client, "POST", $"api/revisions/{seed.RevisionId}/approve"), HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task QueryParametersBindLikeTheMinimalApiDid()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-http-contract-query");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        // ui-state DELETE: key zorunlu sorgu parametresi.
        AssertEmpty(await SendAsync(client, "DELETE", "api/ui-state"), HttpStatusCode.BadRequest);
        AssertEmpty(await SendAsync(client, "DELETE", "api/ui-state?baska=1"), HttpStatusCode.BadRequest);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(client, "PUT", "api/ui-state", """{"key":"silinecek anahtar","valueJson":"1"}""")).Status);
        AssertEmpty(await SendAsync(client, "DELETE", "api/ui-state?KEY=silinecek+anahtar"), HttpStatusCode.NoContent);
        Reply remaining = await SendAsync(client, "GET", "api/ui-state");
        Assert.DoesNotContain("silinecek anahtar", remaining.Body, StringComparison.Ordinal);
        AssertEmpty(await SendAsync(client, "DELETE", "api/ui-state?key=yok%20b%C3%B6yle"), HttpStatusCode.NoContent);

        // Boş anahtar bağlamadan geçer ("verilmiş" sayılır) ve alan kuralına takılır;
        // anahtarın hiç olmaması ise gövdesiz bağlama hatasıdır.
        string emptyKey = JsonSerializer.Serialize(
            new { message = DomainMessageCatalog.Resolve("ui-state.key"), rule = "ui-state.key" }, RelaxedJson);
        Assert.Equal((HttpStatusCode.BadRequest, emptyKey), Pair(await SendAsync(client, "DELETE", "api/ui-state?key=")));
        Assert.Equal((HttpStatusCode.BadRequest, emptyKey), Pair(await SendAsync(client, "DELETE", "api/ui-state?key")));
        Assert.Equal((HttpStatusCode.BadRequest, emptyKey), Pair(await SendAsync(client, "DELETE", "api/ui-state?key=+")));

        // Rapor indirmede isteğe bağlı placementId: yoksa tüm rapor; geçersiz ya da BOŞ ise 400.
        AssertEmpty(await SendAsync(client, "GET", $"api/revisions/{seed.RevisionId}/report/excel?placementId=abc"), HttpStatusCode.BadRequest);
        AssertEmpty(await SendAsync(client, "GET", $"api/revisions/{seed.RevisionId}/report/excel?placementId="), HttpStatusCode.BadRequest);
        AssertEmpty(await SendAsync(client, "GET", $"api/revisions/{seed.RevisionId}/report/pdf?placementId={seed.PlacementId}&placementId={seed.PlacementId}"), HttpStatusCode.BadRequest);
        Reply whole = await SendAsync(client, "GET", $"api/revisions/{seed.RevisionId}/report/excel?baska=1");
        Assert.Equal(HttpStatusCode.OK, whole.Status);
        // Kapsam artık dosya adında kök yerleşimin görünen adıyla görünür (önceden GUID'iyle).
        Assert.DoesNotContain("Sözleşme-borusu", whole.Message.Content.Headers.ContentDisposition?.FileNameStar ?? "", StringComparison.Ordinal);
        Reply scoped = await SendAsync(client, "GET", $"api/revisions/{seed.RevisionId}/report/word?placementId={seed.PlacementId}");
        Assert.Equal(HttpStatusCode.OK, scoped.Status);
        Assert.Contains("Sözleşme-borusu", scoped.Message.Content.Headers.ContentDisposition?.FileNameStar ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public async Task ErrorBodiesUseRelaxedJsonAndStableRuleCodes()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-http-contract-errors");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        Reply domain = await SendAsync(client, "POST", "api/projects", """{"code":"   ","name":"Geçersiz"}""");
        Assert.Equal(HttpStatusCode.BadRequest, domain.Status);
        Assert.Equal(JsonContentType, domain.ContentType);
        Assert.Equal(
            JsonSerializer.Serialize(new { message = DomainMessageCatalog.Resolve("project.code"), rule = "project.code" }, RelaxedJson),
            domain.Body);

        // Beklenmeyen hata: 500, genel Türkçe metin, iç ayrıntı yok.
        Reply fault = await SendAsync(client, "POST", $"api/revisions/{seed.RevisionId}/measurements/batch", "[null]");
        Assert.Equal(HttpStatusCode.InternalServerError, fault.Status);
        Assert.Equal(JsonContentType, fault.ContentType);
        Assert.Equal("""{"message":"Beklenmeyen bir hata oluştu. Sorun sürerse uygulamayı yeniden başlatın.","rule":"server.error"}""", fault.Body);

        // Tanınmayan karakter kümesi gövde çözülürken arızadır (400 değil).
        Reply charset = await SendAsync(client, "POST", "api/projects", """{"code":"X","name":"Y"}""", "application/json; charset=klingon");
        Assert.Equal(HttpStatusCode.InternalServerError, charset.Status);
        Assert.Contains("\"rule\":\"server.error\"", charset.Body, StringComparison.Ordinal);

        // Bulunamayan kayıt alan kuralıdır.
        Reply missing = await SendAsync(client, "GET", $"api/placements/{Guid.NewGuid()}/compatible-fittings");
        Assert.Equal(HttpStatusCode.BadRequest, missing.Status);
        Assert.Contains("\"rule\":\"placement.not-found\"", missing.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DownloadsCarryTheirContentTypeAndAttachmentNamesAndLeaveNoTemporaryFile()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-http-contract-downloads");
        Seed seed = await SeedAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        using HttpResponseMessage excel = await client.GetAsync($"api/revisions/{seed.RevisionId}/report/excel");
        Assert.Equal(HttpStatusCode.OK, excel.StatusCode);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", excel.Content.Headers.ContentType?.ToString());
        ContentDispositionHeaderValue? disposition = excel.Content.Headers.ContentDisposition;
        Assert.Equal("attachment", disposition?.DispositionType);
        // Okunur ad: {ProjeKodu}_R{RevizyonNo}_{yyyy-MM-dd_HHmm}.{uzantı}; GUID'li geçici ad kullanıcıya sızmaz.
        Assert.Matches("^P-HTTP_R0_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.xlsx$", disposition?.FileName ?? "");
        Assert.Equal(disposition?.FileName, disposition?.FileNameStar);
        byte[] excelBytes = await excel.Content.ReadAsByteArrayAsync();
        Assert.Equal(excel.Content.Headers.ContentLength, excelBytes.Length);
        Assert.Equal("PK", Encoding.ASCII.GetString(excelBytes, 0, 2));
        // İndirme adı artık geçici dosyanın adı değil: geçici dosyalar revizyon GUID'iyle aranır.
        Assert.True(await NoTemporaryFilesAsync(seed.RevisionId),
            "Geçici rapor dosyası yanıttan sonra silinmeliydi.");

        using HttpResponseMessage subtree = await client.GetAsync($"api/revisions/{seed.RevisionId}/report/subtree/{seed.PlacementId}/pdf");
        Assert.Equal(HttpStatusCode.OK, subtree.StatusCode);
        Assert.Equal("application/pdf", subtree.Content.Headers.ContentType?.ToString());
        // Alt ağaç adı kök yerleşimin görünen adıdır; Türkçe harfler korunur (RFC 6266 filename*).
        Assert.Matches("^P-HTTP_R0_Sözleşme-borusu_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.pdf$",
            subtree.Content.Headers.ContentDisposition?.FileNameStar ?? "");
        _ = await subtree.Content.ReadAsByteArrayAsync();
        Assert.True(await NoTemporaryFilesAsync(seed.RevisionId), "Alt ağaç geçici dosyası da silinmeliydi.");

        using HttpResponseMessage export = await client.GetAsync("api/workspace/export");
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        Assert.Equal("application/vnd.projemetraj.workspace", export.Content.Headers.ContentType?.ToString());
        Assert.Matches("^ProjeMetraj-\\d{8}-\\d{6}\\.metraj$", export.Content.Headers.ContentDisposition?.FileName ?? "");
        byte[] package = await export.Content.ReadAsByteArrayAsync();
        Assert.Equal("SQLite format 3", Encoding.ASCII.GetString(package, 0, 15));

        // Rapor üretimi bir alan kuralıyla reddedilirse JSON hata döner.
        Reply missingRoot = await SendAsync(client, "GET", $"api/revisions/{seed.RevisionId}/report/subtree/{Guid.NewGuid()}/excel");
        Assert.Equal(HttpStatusCode.BadRequest, missingRoot.Status);
        Assert.Equal(JsonContentType, missingRoot.ContentType);
    }

    [Fact]
    public async Task WorkspaceImportRequiresAMultipartFile()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-http-contract-import");
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };
        string emptyImport = JsonSerializer.Serialize(
            new { message = DomainMessageCatalog.Resolve("workspace-import.empty"), rule = "workspace-import.empty" }, RelaxedJson);

        Reply notMultipart = await SendAsync(client, "POST", "api/workspace/import", "{}");
        Assert.Equal(HttpStatusCode.BadRequest, notMultipart.Status);
        Assert.Equal(emptyImport, notMultipart.Body);

        Reply noBody = await SendAsync(client, "POST", "api/workspace/import");
        Assert.Equal(HttpStatusCode.BadRequest, noBody.Status);
        Assert.Equal(emptyImport, noBody.Body);

        using (var form = new MultipartFormDataContent())
        {
            form.Add(new StringContent("deger"), "baska-alan");
            using HttpResponseMessage response = await client.PostAsync("api/workspace/import", form);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(emptyImport, await response.Content.ReadAsStringAsync());
        }

        using (var form = new MultipartFormDataContent())
        {
            form.Add(new ByteArrayContent([]), "file", "bos.metraj");
            using HttpResponseMessage response = await client.PostAsync("api/workspace/import", form);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(emptyImport, await response.Content.ReadAsStringAsync());
        }

        // Metraj veritabanı olmayan dosya: SQLite arızası, kullanıcıya genel metin.
        using (var form = new MultipartFormDataContent())
        {
            form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("bu bir veritabanı değil")), "file", "bozuk.metraj");
            using HttpResponseMessage response = await client.PostAsync("api/workspace/import", form);
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Contains("\"rule\":\"server.error\"", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    /// <summary>Sunucu akışı istemci son baytı aldıktan hemen sonra kapatır; kısa bir süre beklenir.</summary>
    /// <summary>Bu revizyonun GUID'li geçici rapor dosyalarının hiçbiri kalmadı mı (silme akış kapanınca olur).</summary>
    private static async Task<bool> NoTemporaryFilesAsync(Guid revisionId)
    {
        string pattern = $"metraj-{revisionId:N}-*";
        for (int attempt = 0; attempt < 40 && Directory.GetFiles(Path.GetTempPath(), pattern).Length > 0; attempt++)
        {
            await Task.Delay(50);
        }

        return Directory.GetFiles(Path.GetTempPath(), pattern).Length == 0;
    }

    private static (HttpStatusCode Status, string Body) Pair(Reply reply) => (reply.Status, reply.Body);

    private static void AssertEmpty(Reply reply, HttpStatusCode expected)
    {
        Assert.Equal(expected, reply.Status);
        Assert.Equal(string.Empty, reply.Body);
        Assert.Null(reply.ContentType);
    }

    private static void AssertAllow(Reply reply, string? allow)
    {
        if (allow is null)
        {
            Assert.NotEqual(HttpStatusCode.MethodNotAllowed, reply.Status);
            return;
        }

        AssertEmpty(reply, HttpStatusCode.MethodNotAllowed);
        Assert.Equal(allow, string.Join(", ", reply.Message.Content.Headers.Allow));
    }

    private static async Task<Reply> SendAsync(HttpClient client, string method, string path, string? body = null, string contentType = "application/json")
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (body is not null)
        {
            request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body));
            request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        }

        HttpResponseMessage response = await client.SendAsync(request);
        string text = await response.Content.ReadAsStringAsync();
        return new Reply(response.StatusCode, response.Content.Headers.ContentType?.ToString(), text, response);
    }

    private static async Task<Seed> SeedAsync(TestDatabase database)
    {
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("P-HTTP", "HTTP sözleşmesi");
        CatalogCardListItem card = await new CatalogWorkspaceService(database.ContextFactory).CreateCardAsync(new CatalogCardDraft(
            "PIPE-HTTP", "Sözleşme borusu", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await new ProjectTreeWorkspaceService(database.ContextFactory)
            .AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        MeasurementListItem measurement = await new MeasurementWorkspaceService(database.ContextFactory)
            .CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id, 2.5m, "m"));
        return new Seed(project.LatestRevisionId, placement.Id, measurement.Id);
    }

    private sealed record Seed(Guid RevisionId, Guid PlacementId, Guid MeasurementId);

    private sealed record Reply(HttpStatusCode Status, string? ContentType, string Body, HttpResponseMessage Message);
}
