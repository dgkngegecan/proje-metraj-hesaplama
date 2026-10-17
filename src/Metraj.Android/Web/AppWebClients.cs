using Android.Content;
using Android.Webkit;
using AndroidX.WebKit;
using Metraj.Mobile.Diagnostics;

namespace Metraj.Mobile.Web;

/// <summary>Arayüz yalnız APK'dan, tek bir https origin'inden sunulur; başka hiçbir yere gidilmez.</summary>
/// <remarks>
/// <c>https://appassets.androidplatform.net</c> WebViewAssetLoader'ın ayrılmış
/// alan adıdır; istekler ağa çıkmadan burada karşılanır. Arayüz derlemesi mutlak
/// yollar kullanır (<c>/assets/mobile-….js</c>); bu yüzden iki önek aynı APK
/// klasörüne (<c>web/</c>) bağlanır:
/// <list type="bullet">
/// <item><c>/web/mobile.html</c> → APK <c>assets/web/mobile.html</c></item>
/// <item><c>/assets/x.js</c> → APK <c>assets/web/assets/x.js</c></item>
/// </list>
/// Karşılanamayan her istek ağa düşmek yerine 404 alır (uygulamanın INTERNET
/// izni de yok). Origin dışına her gezinme engellenir.
/// </remarks>
internal sealed class AppAssetsWebViewClient : WebViewClient
{
    public const string Host = "appassets.androidplatform.net";

    private readonly WebViewAssetLoader assetLoader;
    private readonly IWebPageHost page;

    public AppAssetsWebViewClient(Context context, IWebPageHost page)
    {
        this.page = page;
        var assets = new WebViewAssetLoader.AssetsPathHandler(context);
        var builder = new WebViewAssetLoader.Builder();
        builder.SetDomain(Host);
        builder.AddPathHandler("/web/", new PrefixedAssetsHandler(assets, "web/"));
        builder.AddPathHandler("/assets/", new PrefixedAssetsHandler(assets, "web/assets/"));
        assetLoader = builder.Build()!;
    }

    /// <summary>Adres uygulamanın kendi origin'inde mi?</summary>
    public static bool IsAppOrigin(global::Android.Net.Uri? uri) =>
        uri is not null &&
        string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(uri.Host, Host, StringComparison.OrdinalIgnoreCase) &&
        uri.Port is -1 or 443;

    public override WebResourceResponse? ShouldInterceptRequest(WebView? view, IWebResourceRequest? request)
    {
        global::Android.Net.Uri? url = request?.Url;
        if (url is not null && assetLoader.ShouldInterceptRequest(url) is WebResourceResponse response)
        {
            return response;
        }

        MetrajLog.Warn($"Karşılanmayan istek engellendi: {url}");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new MemoryStream([]));
    }

    public override bool ShouldOverrideUrlLoading(WebView? view, IWebResourceRequest? request)
    {
        if (IsAppOrigin(request?.Url)) return false;
        MetrajLog.Warn($"Uygulama dışına gezinme engellendi: {request?.Url}");
        return true;
    }

    public override void OnPageStarted(WebView? view, string? url, global::Android.Graphics.Bitmap? favicon)
    {
        base.OnPageStarted(view, url, favicon);
        page.OnPageStarted();
    }

    public override void OnPageCommitVisible(WebView? view, string? url)
    {
        base.OnPageCommitVisible(view, url);
        page.OnPageCommitVisible();
    }

    public override void OnPageFinished(WebView? view, string? url)
    {
        base.OnPageFinished(view, url);
        page.OnPageFinished();
    }

    public override void OnReceivedError(WebView? view, IWebResourceRequest? request, WebResourceError? error)
    {
        base.OnReceivedError(view, request, error);
        if (request?.IsForMainFrame == true)
        {
            page.OnMainFrameError($"{error?.ErrorCode}: {error?.Description}");
        }
    }

    public override void OnReceivedHttpError(WebView? view, IWebResourceRequest? request, WebResourceResponse? errorResponse)
    {
        base.OnReceivedHttpError(view, request, errorResponse);
        if (request?.IsForMainFrame == true)
        {
            page.OnMainFrameError($"HTTP {errorResponse?.StatusCode} {request.Url}");
        }
    }

    public override bool OnRenderProcessGone(WebView? view, RenderProcessGoneDetail? detail)
    {
        // false dönmek bütün uygulama sürecini öldürür. Sayfa yeniden kurulur;
        // kalıcı taslaklar sayesinde kullanıcı en fazla son birkaç saniyeyi kaybeder.
        MetrajLog.Error($"WebView işleyici süreci sonlandı (çöktü: {detail?.DidCrash()}).", null);
        page.OnRendererGone();
        return true;
    }
}

/// <summary>WebView'dan sayfa yaşam döngüsü bildirimleri alan taraf (etkinlik).</summary>
internal interface IWebPageHost
{
    public void OnPageStarted();

    public void OnPageCommitVisible();

    public void OnPageFinished();

    public void OnMainFrameError(string description);

    public void OnRendererGone();
}

/// <summary><see cref="WebViewAssetLoader.AssetsPathHandler"/>'a APK içi bir klasör öneki ekler.</summary>
internal sealed class PrefixedAssetsHandler : Java.Lang.Object, WebViewAssetLoader.IPathHandler
{
    private readonly WebViewAssetLoader.AssetsPathHandler inner;
    private readonly string prefix;

    public PrefixedAssetsHandler(WebViewAssetLoader.AssetsPathHandler inner, string prefix)
    {
        this.inner = inner;
        this.prefix = prefix;
    }

    // Açık arabirim uygulaması: Java.Lang.Object'in Handle (JNI tutamacı) özelliğiyle ad çakışıyor.
    WebResourceResponse? WebViewAssetLoader.IPathHandler.Handle(string? path)
    {
        // APK varlıklarının dışına çıkılamaz ama ".." ile web/ klasörünün dışındaki varlıklar da sunulmasın.
        if (path is null || path.Contains("..", StringComparison.Ordinal)) return null;
        return inner.Handle(prefix + path);
    }
}

/// <summary>Konum, kamera vb. izin isteklerini reddeder; konsol iletilerini logcat'e yazar.</summary>
internal sealed class LockedDownChromeClient : WebChromeClient
{
    public override bool OnConsoleMessage(ConsoleMessage? consoleMessage)
    {
        if (consoleMessage is not null)
        {
            MetrajLog.Debug($"konsol [{consoleMessage.InvokeMessageLevel()}] {consoleMessage.Message()} ({consoleMessage.SourceId()}:{consoleMessage.LineNumber()})");
        }

        return true;
    }

    public override void OnGeolocationPermissionsShowPrompt(string? origin, GeolocationPermissions.ICallback? callback) =>
        callback?.Invoke(origin, false, false);

    public override void OnPermissionRequest(PermissionRequest? request) => request?.Deny();
}

/// <summary><c>evaluateJavascript</c> sonucunu yönetilen bir eyleme verir.</summary>
internal sealed class JavascriptResult : Java.Lang.Object, IValueCallback
{
    private readonly Action<string?> onResult;

    public JavascriptResult(Action<string?> onResult)
    {
        this.onResult = onResult;
    }

    public void OnReceiveValue(Java.Lang.Object? value) => onResult(value?.ToString());
}
