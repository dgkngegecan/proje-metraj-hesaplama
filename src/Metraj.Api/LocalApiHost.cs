using System.Net;
using System.Text;
using Metraj.Host;
using Metraj.Infrastructure;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace Metraj.Api;

/// <summary>Loopback-only HTTP boundary that lets the React desktop surface use the existing application services.</summary>
/// <remarks>
/// Bu sınıf artık yalnız bir HTTP adaptörüdür. 67 uç noktanın mantığı (rota
/// tablosu, bağlama, JSON sözleşmesi, hata eşlemesi, bakım kapısı) Metraj.Host'taki
/// <see cref="MetrajRequestRouter"/>'a taşındı; Android kabuğu aynı router'ı
/// Kestrel olmadan çağırır. Önceden bu dosya 712 satırdı ve uç noktaları minimal
/// API olarak tanımlıyordu: mantık ASP.NET Core'a bağlıydı ve ikinci bir platform
/// ancak bir kopyayla desteklenebilirdi.
///
/// Burada kalanlar HTTP'ye özgüdür: Kestrel sınırları, gövdenin okunması
/// (karakter kümesi, multipart), <see cref="RouterResponse"/>'un yazılması
/// (Allow başlığı, dosya akışı ve geçici dosyanın silinmesi) ve gömülü React
/// arayüzünün sunumu.
/// </remarks>
public sealed class LocalApiHost : IAsyncDisposable
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private readonly WebApplication application;
    private readonly MetrajServices services;

    private LocalApiHost(WebApplication application, MetrajServices services, Uri baseUri)
    {
        this.application = application;
        this.services = services;
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
        builder.WebHost.ConfigureKestrel(server =>
        {
            // Çalışma alanı dosyası katalog ve proje geçmişi büyüdükçe yüzlerce MB olabilir.
            // Sunucu yalnız loopback'te dinlediği için içe aktarma gövdesine yapay bir sınır koymuyoruz.
            server.Limits.MaxRequestBodySize = null;
            server.Listen(IPAddress.Loopback, 0);
        });
        builder.WebHost.UseSetting("detailedErrors", "false");

        WebApplication app = builder.Build();
        // Servis kurulumu iki platformda aynı fabrikadan geçer (önceden burada
        // RegisterWorkspaceServices vardı). Günlük, eski minimal API'nin
        // kullandığı app.Logger'a yazılmaya devam eder.
        var services = MetrajServices.Create(databasePath);
        try
        {
            var router = new MetrajRequestRouter(services, app.Logger);
            ApplicationDatabaseGate databaseGate = services.DatabaseGate;
            app.Use(async (context, next) =>
            {
                if (IsApiRequest(context.Request.Path))
                {
                    await ForwardToRouterAsync(context, router, databaseGate);
                    return;
                }

                // Statik arayüz sunumu önceden de kapının içindeydi; aynen korunuyor.
                await using IAsyncDisposable operation = await databaseGate.EnterOperationAsync(context.RequestAborted);
                try
                {
                    await next(context);
                }
                catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
                {
                    // Kullanıcı sayfadan ayrıldı veya isteği iptal etti; hata değildir.
                }
                catch (Exception exception) when (!context.Response.HasStarted)
                {
                    await WriteJsonAsync(context, router.CreateErrorResponse(exception, context.Request.Path));
                }
            });

            MapStaticReactApplication(app);
            await app.StartAsync(cancellationToken);

            IServer server = app.Services.GetRequiredService<IServer>();
            IServerAddressesFeature? addresses = server.Features.Get<IServerAddressesFeature>();
            string address = addresses?.Addresses.SingleOrDefault(value => value.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Yerel React arayüzü için loopback adresi oluşturulamadı.");
            return new LocalApiHost(app, services, new Uri(address, UriKind.Absolute));
        }
        catch
        {
            await app.DisposeAsync();
            services.Dispose();
            throw;
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await application.StopAsync(TimeSpan.FromSeconds(2));
        await application.DisposeAsync();
        services.Dispose();
    }

    /// <summary>
    /// "/api/" ile başlayan her yol router'a gider. Eğik çizgisiz "/api" önceden de
    /// API değildi (statik yakalayıcı onu arayüzün kendisi olarak sunuyordu).
    /// </summary>
    private static bool IsApiRequest(PathString path) =>
        path.Value is string value && value.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);

    /// <summary>Bir HTTP isteğini router'a aktarır ve yanıtını HTTP'ye yazar.</summary>
    private static async Task ForwardToRouterAsync(HttpContext context, MetrajRequestRouter router, ApplicationDatabaseGate databaseGate)
    {
        CancellationToken aborted = context.RequestAborted;
        // Kestrel yolu çözülmüş verir; yeniden kodlanır ki router onu bir kez çözsün.
        // Günlükteki yol da önceki gibi PathString'in kodlu biçimidir.
        string path = context.Request.Path.ToUriComponent();
        string pathAndQuery = path + context.Request.QueryString.ToUriComponent();
        RouterResponse? response;
        try
        {
            (RouterRequest? request, RouterResponse? early) = await ReadRequestAsync(context, pathAndQuery);
            response = request is null ? early : await router.DispatchAsync(request, aborted);
        }
        catch (OperationCanceledException) when (aborted.IsCancellationRequested)
        {
            // Kullanıcı sayfadan ayrıldı veya isteği iptal etti; hata değildir.
            return;
        }
        catch (Exception exception) when (!context.Response.HasStarted)
        {
            response = router.CreateErrorResponse(exception, path);
        }

        if (response is null)
        {
            return;
        }

        // Önceden kapı, yanıt (dosya akışı dâhil) yazılana kadar tutuluyordu;
        // router kapıyı dağıtım bitince bıraktığı için yazım süresince yeniden alınır.
        await using IAsyncDisposable? operation = MetrajRequestRouter.IsMaintenanceRequest(pathAndQuery)
            ? null
            : await databaseGate.EnterOperationAsync(aborted);
        await WriteResponseAsync(context, response, router, path);
    }

    /// <summary>
    /// Gövdeyi, minimal API'nin okuduğu durumlarda ve okuduğu biçimde okur.
    /// </summary>
    /// <remarks>
    /// JSON bekleyen uçta: gövde yoksa <c>null</c>, JSON olmayan içerik türünde boş
    /// metin (router 415 döner), JSON içerik türünde karakter kümesine göre
    /// çözülmüş metin. İçe aktarma ucunda: multipart formdaki "file" dosyası.
    /// Gövde okunurken bağlantı koparsa ya da istek bozuksa minimal API'nin
    /// verdiği yanıt (<c>early</c>) döner.
    /// </remarks>
    private static async Task<(RouterRequest? Request, RouterResponse? Early)> ReadRequestAsync(HttpContext context, string pathAndQuery)
    {
        HttpRequest request = context.Request;
        string? bodyJson = null;
        Func<Stream>? bodyStream = null;
        switch (MetrajRequestRouter.ResolveBodyKind(request.Method, pathAndQuery))
        {
            case RouterBodyKind.Json when context.Features.Get<IHttpRequestBodyDetectionFeature>()?.CanHaveBody == true:
                if (!request.HasJsonContentType())
                {
                    bodyJson = string.Empty;
                    break;
                }

                try
                {
                    bodyJson = await ReadJsonTextAsync(request, context.RequestAborted);
                }
                catch (BadHttpRequestException exception)
                {
                    return (null, new RouterResponse(exception.StatusCode, string.Empty, null, null));
                }
                catch (IOException)
                {
                    // Minimal API bu durumda durum kodu yazmadan dönüyordu (istemci gitmişti).
                    return (null, null);
                }
                catch (DecoderFallbackException)
                {
                    // Geçersiz UTF-8, System.Text.Json için okunamayan JSON'dur: 400.
                    return (null, new RouterResponse(StatusCodes.Status400BadRequest, string.Empty, null, null));
                }

                break;
            case RouterBodyKind.File when request.HasFormContentType:
                IFormCollection form = await request.ReadFormAsync(context.RequestAborted);
                IFormFile? file = form.Files.GetFile("file");
                if (file is { Length: > 0 })
                {
                    bodyStream = file.OpenReadStream;
                }

                break;
        }

        return (new RouterRequest(request.Method, pathAndQuery, bodyJson, bodyStream, request.ContentType), null);
    }

    /// <summary>
    /// <c>HttpRequest.ReadFromJsonAsync</c>'in gövde çözümü: UTF-8 dışındaki karakter
    /// kümeleri UTF-8'e çevrilir, tanınmayan karakter kümesi sunucu arızasıdır
    /// (önceden de 500 dönüyordu) ve baştaki UTF-8 BOM atlanır.
    /// </summary>
    private static async Task<string> ReadJsonTextAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        Encoding? encoding = null;
        if (MediaTypeHeaderValue.TryParse(request.ContentType, out MediaTypeHeaderValue? mediaType) &&
            mediaType.Charset.HasValue && !mediaType.Charset.Equals("utf-8", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                encoding = Encoding.GetEncoding(mediaType.Charset.Value!);
            }
            catch (Exception exception) when (exception is ArgumentException or NotSupportedException)
            {
                throw new InvalidOperationException(
                    $"Unable to read the request as JSON because the request content type charset '{mediaType.Charset}' is not a known encoding.",
                    exception);
            }
        }

        using var buffer = new MemoryStream();
        if (encoding is null)
        {
            await request.Body.CopyToAsync(buffer, cancellationToken);
        }
        else
        {
            await using Stream transcoded = Encoding.CreateTranscodingStream(request.Body, encoding, Encoding.UTF8, leaveOpen: true);
            await transcoded.CopyToAsync(buffer, cancellationToken);
        }

        ReadOnlySpan<byte> bytes = buffer.GetBuffer().AsSpan(0, (int)buffer.Length);
        if (bytes.StartsWith(Encoding.UTF8.Preamble))
        {
            bytes = bytes[Encoding.UTF8.Preamble.Length..];
        }

        return StrictUtf8.GetString(bytes);
    }

    /// <summary>Router yanıtını HTTP yanıtına yazar.</summary>
    private static async Task WriteResponseAsync(HttpContext context, RouterResponse response, MetrajRequestRouter router, string path)
    {
        if (response.File is RouterFile file)
        {
            await WriteFileAsync(context, file, router, path);
            return;
        }

        if (response.Allow is string allow)
        {
            context.Response.Headers.Allow = allow;
        }

        if (response.BodyJson is null)
        {
            context.Response.StatusCode = response.Status;
            return;
        }

        await WriteJsonAsync(context, response);
    }

    private static async Task WriteJsonAsync(HttpContext context, RouterResponse response)
    {
        context.Response.StatusCode = response.Status;
        context.Response.ContentType = response.ContentType;
        await context.Response.WriteAsync(response.BodyJson ?? string.Empty, context.RequestAborted);
    }

    /// <summary>Dosyayı belleğe almadan akıtır; geçici dosya akış kapanınca kendini siler.</summary>
    /// <remarks>
    /// <c>DeleteOnClose</c> sayesinde dosya yanıt tamamlandığında (ya da istemci
    /// koptuğunda) silinir. Dosya açılamazsa yine silinir ve istek, önceki gibi
    /// genel bir sunucu hatasıyla yanıtlanır.
    /// </remarks>
    private static async Task WriteFileAsync(HttpContext context, RouterFile file, MetrajRequestRouter router, string path)
    {
        FileStream content;
        try
        {
            content = new FileStream(
                file.Path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 64 * 1024,
                FileOptions.Asynchronous | (file.DeleteWhenDone ? FileOptions.DeleteOnClose : FileOptions.None));
        }
        catch (Exception exception) when (!context.Response.HasStarted)
        {
            if (file.DeleteWhenDone) TryDeleteTemporaryFile(file.Path);
            await WriteJsonAsync(context, router.CreateErrorResponse(exception, path));
            return;
        }

        try
        {
            await Results.File(content, file.ContentType, file.DownloadName).ExecuteAsync(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // İstemci indirmeyi bıraktı; akış kapandığı için dosya da silindi.
        }
        catch (Exception exception) when (!context.Response.HasStarted)
        {
            await content.DisposeAsync();
            await WriteJsonAsync(context, router.CreateErrorResponse(exception, path));
        }
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
            // Geçici dosyayı silememek isteği bozmamalı.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
