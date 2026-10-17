using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Metraj.Host;

/// <summary>Yerel API'nin tek rota tablosu ve taşıma katmanından bağımsız dağıtıcısı.</summary>
/// <remarks>
/// Uç noktalar önceden LocalApiHost içinde ASP.NET Core minimal API'leri olarak
/// tanımlıydı; bağlama, 404/405 ve hata gövdeleri çerçevenin varsayılanlarından
/// geliyordu. Android'de Kestrel olmadığı için bu mantık buraya taşındı ve
/// çerçevenin ürettiği yanıtlar elle, birebir yeniden üretildi:
/// <list type="bullet">
/// <item>Gövde yoksa 400, JSON olmayan içerik türü 415, okunamayan/<c>null</c> JSON 400 (hepsi gövdesiz).</item>
/// <item><c>:guid</c> kısıtı tutmayan yol 404; yol bilinip yöntem desteklenmiyorsa 405 + Allow.</item>
/// <item><see cref="DomainRuleViolationException"/> 400 + <c>ApiError</c>; beklenmeyen hata 500 + genel Türkçe metin.</item>
/// <item>Bakım uçları (geri yükleme, proje temizleme, içe aktarma) kapıyı kendileri alır.</item>
/// </list>
/// Sözleşme <c>LocalApiHttpContractTests</c> (eski minimal API'ye karşı elde edildi) ve
/// router ile Kestrel'i aynı isteklerle karşılaştıran testlerle korunur.
/// </remarks>
public sealed partial class MetrajRequestRouter
{
    private const string JsonContentType = "application/json; charset=utf-8";
    private const string GenericFaultMessage = "Beklenmeyen bir hata oluştu. Sorun sürerse uygulamayı yeniden başlatın.";

    // Bu yollar ApplicationDatabaseGate'in bakım sınırını KENDİLERİ alır. Router
    // burada da sıradan bir yuva tutsaydı, bakım bütün yuvaları beklerken kendi
    // tuttuğu yuvayı da bekler ve kilitlenirdi.
    private static readonly string[][] MaintenancePrefixes =
    [
        ["api", "database", "backups", "restore"],
        ["api", "database", "projects"],
        ["api", "workspace", "import"]
    ];

    private static readonly IReadOnlyDictionary<string, Guid> NoRouteValues = new Dictionary<string, Guid>();
    private static readonly Route[] Table = BuildRouteTable();

    private readonly MetrajServices services;
    private readonly ILogger logger;

    /// <summary>Router'ı servis kaydıyla kurar; DI kapsayıcısı gerekmez.</summary>
    /// <param name="services">Uç noktaların kullandığı servisler (<see cref="MetrajServices.Create"/>).</param>
    /// <param name="logger">
    /// Alan kuralı redleri ve beklenmeyen hatalar için günlük. Masaüstü eski
    /// minimal API'nin kullandığı <c>app.Logger</c>'ı verir; verilmezse günlük tutulmaz.
    /// </param>
    public MetrajRequestRouter(MetrajServices services, ILogger? logger = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        this.services = services;
        this.logger = logger ?? NullLogger.Instance;
    }

    /// <summary>İstek ve yanıt gövdelerinin JSON ayarları.</summary>
    /// <remarks>
    /// ASP.NET Core'un minimal API varsayılanlarıyla aynı: web varsayılanları
    /// (camelCase, büyük/küçük harf duyarsız okuma, metin olarak yazılmış sayıları
    /// kabul), <see cref="JavaScriptEncoder.UnsafeRelaxedJsonEscaping"/> (Türkçe
    /// karakterler kaçırılmaz) ve yalnız adla okunan numaralandırmalar.
    /// </remarks>
    public static JsonSerializerOptions SerializerOptions { get; } = CreateSerializerOptions();

    /// <summary>Rota tablosu: bütün uç noktalar, yöntem ve kısıtlı şablonlarıyla.</summary>
    public static IReadOnlyList<RouterRoute> Routes { get; } =
        Array.AsReadOnly(Table.Select(route => new RouterRoute(route.Method, route.Template)).ToArray());

    /// <summary>Bir isteği rota tablosuna göre çalıştırır.</summary>
    /// <remarks>
    /// Hiçbir zaman istisna fırlatmaz; tek istisna <paramref name="cancellationToken"/>
    /// iptal edildiğinde yükselen <see cref="OperationCanceledException"/>'dır
    /// (istemci gitti, yanıt yazılmamalı).
    /// </remarks>
    /// <param name="request">Taşımadan bağımsız istek.</param>
    /// <param name="cancellationToken">İstemci isteği bıraktığında iptal edilir.</param>
    public async Task<RouterResponse> DispatchAsync(RouterRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var target = RequestTarget.Parse(request.PathAndQuery);
        await using IAsyncDisposable? operation = IsMaintenance(target.Segments)
            ? null
            : await services.DatabaseGate.EnterOperationAsync(cancellationToken);
        try
        {
            return await RouteAsync(request, target, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Kullanıcı sayfadan ayrıldı veya isteği iptal etti; hata değildir.
            throw;
        }
        catch (Exception exception)
        {
            return CreateErrorResponse(exception, target.RawPath);
        }
    }

    /// <summary>Bir istisnayı kullanıcıya gösterilecek hata yanıtına çevirir ve günlüğe yazar.</summary>
    /// <remarks>
    /// Router'ın kendi hata eşlemesi; HTTP adaptörü gövde okurken ya da dosya
    /// açarken yakaladığı istisnaları da aynı sözleşmeyle yanıtlamak için çağırır.
    /// Kural kodu kararlı makine kimliğidir; gösterilen metin Türkçe katalogdan
    /// çözülür. Sunucu arızası kullanıcının kendi hatasıymış gibi sunulmaz ve iç
    /// ayrıntı (istisna metni, yığın) yanıta sızmaz.
    /// </remarks>
    /// <param name="exception">Yakalanan istisna.</param>
    /// <param name="path">Günlüğe yazılacak istek yolu.</param>
    public RouterResponse CreateErrorResponse(Exception exception, string path)
    {
        ArgumentNullException.ThrowIfNull(exception);
        if (exception is DomainRuleViolationException violation)
        {
            Log.DomainRuleRejected(logger, violation.Rule);
            return Json(400, new ApiError(DomainMessageCatalog.Resolve(violation.Rule), violation.Rule));
        }

        Log.UnexpectedFault(logger, path, exception);
        return Json(500, new ApiError(GenericFaultMessage, "server.error"));
    }

    /// <summary>HTTP adaptörü için: bu istek eşleştiği uçta hangi gövdeyi bekliyor?</summary>
    /// <remarks>
    /// Minimal API gövdeyi yalnız eşleşen uç bir gövde parametresi aldığında
    /// okuyordu; bilinmeyen bir yola giden bozuk bir gövde 404/405 alıyordu, 400
    /// değil. Adaptör de gövdeyi yalnız gerektiğinde okur.
    /// </remarks>
    /// <param name="method">HTTP yöntemi.</param>
    /// <param name="pathAndQuery">Yol ve isteğe bağlı sorgu.</param>
    public static RouterBodyKind ResolveBodyKind(string method, string pathAndQuery)
    {
        ArgumentNullException.ThrowIfNull(method);
        ArgumentNullException.ThrowIfNull(pathAndQuery);
        Route? route = Match(method, RequestTarget.Parse(pathAndQuery).Segments).Route;
        if (route is null) return RouterBodyKind.None;
        if (route.AcceptsFile) return RouterBodyKind.File;
        return route.BodyType is null ? RouterBodyKind.None : RouterBodyKind.Json;
    }

    /// <summary>İstek, bakım sınırını kendisi alan bir uca mı gidiyor?</summary>
    /// <param name="pathAndQuery">Yol ve isteğe bağlı sorgu.</param>
    public static bool IsMaintenanceRequest(string pathAndQuery)
    {
        ArgumentNullException.ThrowIfNull(pathAndQuery);
        return IsMaintenance(RequestTarget.Parse(pathAndQuery).Segments);
    }

    private async Task<RouterResponse> RouteAsync(RouterRequest request, RequestTarget target, CancellationToken cancellationToken)
    {
        RouteMatch match = Match(request.Method, target.Segments);
        if (match.Route is not Route route)
        {
            return match.Allow is string allow ? Empty(405) with { Allow = allow } : Empty(404);
        }

        object? body = null;
        if (route.BodyType is Type bodyType)
        {
            // Minimal API'nin sırası: gövde yoksa 400, JSON değilse 415,
            // okunamıyor ya da JSON null ise 400 -- hepsi gövdesiz.
            if (request.BodyJson is null) return Empty(400);
            if (!IsJsonContentType(request.ContentType)) return Empty(415);
            try
            {
                body = JsonSerializer.Deserialize(request.BodyJson, bodyType, SerializerOptions);
            }
            catch (JsonException)
            {
                return Empty(400);
            }

            if (body is null) return Empty(400);
        }

        var call = new RouteCall(services, match.Values, target.Query, body, request.BodyStream, cancellationToken);
        return await route.Handler(call);
    }

    /// <summary>ASP.NET Core yönlendirmesinin eşleştirmesini taklit eder.</summary>
    /// <remarks>
    /// Yol bölümleri şablonla biçimce (sabit bölümler büyük/küçük harf duyarsız eşit,
    /// parametre her bölümü karşılar) eşleşen uçlar arasında yöntem aranır. Yöntem
    /// tutan uç varsa <c>:guid</c> kısıtı denetlenir; tutmazsa 404. Yöntem tutan uç
    /// yoksa 405 ve Allow. Masaüstünde statik arayüzün GET yakalayıcısı her yolu
    /// karşıladığı için GET hiçbir zaman 405 almaz (404 alır) ve Allow her zaman GET
    /// içerir; bu yanıtlar minimal API'nin ürettiğiyle aynıdır.
    /// </remarks>
    private static RouteMatch Match(string method, string[] segments)
    {
        SortedSet<string>? otherMethods = null;
        bool methodMatched = false;
        foreach (Route route in Table)
        {
            if (!route.HasShapeOf(segments)) continue;
            if (!string.Equals(route.Method, method, StringComparison.OrdinalIgnoreCase))
            {
                (otherMethods ??= new SortedSet<string>(StringComparer.Ordinal)).Add(route.Method);
                continue;
            }

            methodMatched = true;
            if (route.TryBind(segments, out IReadOnlyDictionary<string, Guid> values))
            {
                return new RouteMatch(route, values, null);
            }
        }

        if (methodMatched || string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
        {
            return new RouteMatch(null, NoRouteValues, null);
        }

        otherMethods ??= new SortedSet<string>(StringComparer.Ordinal);
        otherMethods.Add("GET");
        return new RouteMatch(null, NoRouteValues, string.Join(", ", otherMethods));
    }

    private static bool IsMaintenance(string[] segments)
    {
        foreach (string[] prefix in MaintenancePrefixes)
        {
            if (segments.Length < prefix.Length) continue;
            bool matches = true;
            for (int index = 0; index < prefix.Length && matches; index++)
            {
                matches = string.Equals(segments[index], prefix[index], StringComparison.OrdinalIgnoreCase);
            }

            if (matches) return true;
        }

        return false;
    }

    /// <summary>ASP.NET Core'un <c>HasJsonContentType</c> kuralı: application/json ya da +json son eki.</summary>
    private static bool IsJsonContentType(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out MediaTypeHeaderValue? parsed) || parsed.MediaType is not string mediaType)
        {
            return false;
        }

        return mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase) ||
            mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase);
    }

    private static RouterResponse Empty(int status) => new(status, string.Empty, null, null);

    private static RouterResponse Json(int status, object value) =>
        new(status, JsonContentType, JsonSerializer.Serialize(value, value.GetType(), SerializerOptions), null);

    /// <summary><c>Results.Ok(value)</c> karşılığı: çalışma zamanı türüyle yazılır; <c>null</c> gövdesiz 200'dür.</summary>
    private static RouterResponse Ok(object? value) => value is null ? Empty(200) : Json(200, value);

    private static async Task<RouterResponse> OkAsync<T>(Task<T> operation) => Ok(await operation);

    private static async Task<RouterResponse> NoContentAsync(Task operation)
    {
        await operation;
        return Empty(204);
    }

    private static JsonSerializerOptions CreateSerializerOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            // ASP.NET Core JsonOptions varsayılanı: yanıt bir HTML sayfasına gömülmeden
            // doğrudan istemciye gittiği için Türkçe karakterler \uXXXX'e kaçırılmaz.
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        // allowIntegerValues: false -> numaralandırmalar yalnızca adlarıyla
        // kabul edilir. Varsayılan davranış, karşılığı olmayan bir tam sayının
        // (örn. 99) sessizce enum değeri olarak kaydedilmesine izin veriyordu.
        options.Converters.Add(new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false));
        options.MakeReadOnly();
        return options;
    }

    /// <summary>Kullanıcıya gösterilecek metin ve dallanma için kararlı kural kodu.</summary>
    private sealed record ApiError(string Message, string Rule);

    private sealed record RouteMatch(Route? Route, IReadOnlyDictionary<string, Guid> Values, string? Allow);

    /// <summary>Bir uç noktanın çağrı bağlamı: servisler, rota değerleri, sorgu ve gövde.</summary>
    private sealed class RouteCall(
        MetrajServices services,
        IReadOnlyDictionary<string, Guid> values,
        QueryValues query,
        object? body,
        Func<Stream>? bodyStream,
        CancellationToken token)
    {
        public MetrajServices Services { get; } = services;

        public QueryValues Query { get; } = query;

        public object? Body { get; } = body;

        public Func<Stream>? BodyStream { get; } = bodyStream;

        public CancellationToken Token { get; } = token;

        /// <summary><c>:guid</c> kısıtlı bir rota değeri (eşleşmede doğrulandı).</summary>
        public Guid Id(string name) => values[name];
    }

    private sealed class Route
    {
        private readonly TemplateSegment[] segments;

        public Route(string method, string template, Type? bodyType, bool acceptsFile, Func<RouteCall, Task<RouterResponse>> handler)
        {
            Method = method;
            Template = template;
            BodyType = bodyType;
            AcceptsFile = acceptsFile;
            Handler = handler;
            segments = ParseTemplate(template);
        }

        public string Method { get; }

        public string Template { get; }

        public Type? BodyType { get; }

        public bool AcceptsFile { get; }

        public Func<RouteCall, Task<RouterResponse>> Handler { get; }

        public bool HasShapeOf(string[] path)
        {
            if (path.Length != segments.Length) return false;
            for (int index = 0; index < segments.Length; index++)
            {
                if (!segments[index].IsParameter &&
                    !string.Equals(segments[index].Text, path[index], StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            return true;
        }

        public bool TryBind(string[] path, out IReadOnlyDictionary<string, Guid> values)
        {
            Dictionary<string, Guid>? bound = null;
            for (int index = 0; index < segments.Length; index++)
            {
                if (!segments[index].IsParameter) continue;
                // GuidRouteConstraint ile aynı: Guid.TryParse'ın kabul ettiği her biçim (D, N, B, P, X).
                if (!Guid.TryParse(path[index], CultureInfo.InvariantCulture, out Guid value))
                {
                    values = NoRouteValues;
                    return false;
                }

                (bound ??= new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase))[segments[index].Text] = value;
            }

            values = bound ?? NoRouteValues;
            return true;
        }

        private static TemplateSegment[] ParseTemplate(string template)
        {
            string[] parts = template.TrimStart('/').Split('/');
            var parsed = new TemplateSegment[parts.Length];
            for (int index = 0; index < parts.Length; index++)
            {
                string part = parts[index];
                if (!part.StartsWith('{'))
                {
                    parsed[index] = new TemplateSegment(part, IsParameter: false);
                    continue;
                }

                // Tabloda yalnız :guid kısıtı kullanılıyor; başka bir kısıt eklenirse
                // eşleştirme sessizce yanlış davranmak yerine tablo kurulamaz.
                if (!part.EndsWith(":guid}", StringComparison.Ordinal))
                {
                    throw new InvalidOperationException($"Desteklenmeyen rota parametresi: {part} ({template}).");
                }

                parsed[index] = new TemplateSegment(part[1..^":guid}".Length], IsParameter: true);
            }

            return parsed;
        }
    }

    private readonly record struct TemplateSegment(string Text, bool IsParameter);

    /// <summary>Yol ve sorgu; yol bölümleri ASP.NET Core yönlendiricisinin böldüğü gibi bölünür.</summary>
    private sealed record RequestTarget(string RawPath, string[] Segments, QueryValues Query)
    {
        public static RequestTarget Parse(string pathAndQuery)
        {
            int queryStart = pathAndQuery.IndexOf('?', StringComparison.Ordinal);
            string rawPath = queryStart < 0 ? pathAndQuery : pathAndQuery[..queryStart];
            string query = queryStart < 0 ? string.Empty : pathAndQuery[(queryStart + 1)..];
            return new RequestTarget(rawPath, Tokenize(rawPath), QueryValues.Parse(query));
        }

        /// <summary>
        /// ASP.NET Core'un yol bölücüsüyle aynı: baştaki '/' atılır, yalnız SONDAKİ
        /// boş bölüm düşer ("/api/projects/" iki bölümdür), aradaki boş bölümler kalır.
        /// Her bölüm ayrı ayrı yüzde kodundan çözülür; böylece kodlanmış bir '/'
        /// (%2F) yeni bir bölüm yaratmaz -- Kestrel de onu çözmeden bırakır.
        /// </summary>
        private static string[] Tokenize(string rawPath)
        {
            string trimmed = rawPath.StartsWith('/') ? rawPath[1..] : rawPath;
            if (trimmed.Length == 0) return [];
            string[] parts = trimmed.Split('/');
            int count = parts[^1].Length == 0 ? parts.Length - 1 : parts.Length;
            string[] segments = new string[count];
            for (int index = 0; index < count; index++)
            {
                segments[index] = Uri.UnescapeDataString(parts[index]);
            }

            return segments;
        }
    }

    /// <summary>Sorgu dizesi; ASP.NET Core'un sorgu koleksiyonu gibi okunur.</summary>
    private sealed class QueryValues
    {
        private readonly Dictionary<string, List<string>> values = new(StringComparer.OrdinalIgnoreCase);

        public static QueryValues Parse(string query)
        {
            var parsed = new QueryValues();
            foreach (string pair in query.Split('&'))
            {
                if (pair.Length == 0) continue;
                int separator = pair.IndexOf('=', StringComparison.Ordinal);
                // "?key" (eşittirsiz) anahtarı boş değerle verir.
                string name = Decode(separator < 0 ? pair : pair[..separator]);
                string value = separator < 0 ? string.Empty : Decode(pair[(separator + 1)..]);
                if (!parsed.values.TryGetValue(name, out List<string>? list))
                {
                    list = [];
                    parsed.values[name] = list;
                }

                list.Add(value);
            }

            return parsed;
        }

        /// <summary>
        /// Minimal API'nin <c>StringValues</c> → <c>string</c> dönüşümü: anahtar yoksa
        /// <see langword="null"/>, birden çok değer varsa virgülle birleşik.
        /// </summary>
        public string? Get(string name) => values.TryGetValue(name, out List<string>? list) ? string.Join(',', list) : null;

        /// <summary>
        /// İsteğe bağlı <c>Guid?</c> sorgu parametresi. Yoksa <see langword="null"/>;
        /// varsa (boş da olsa) Guid olmak zorunda, değilse bağlama hatasıdır (400).
        /// </summary>
        public bool TryGetOptionalId(string name, out Guid? id)
        {
            id = null;
            string? text = Get(name);
            if (text is null) return true;
            if (!Guid.TryParse(text, CultureInfo.InvariantCulture, out Guid parsed)) return false;
            id = parsed;
            return true;
        }

        private static string Decode(string text) => Uri.UnescapeDataString(text.Replace('+', ' '));
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
}
