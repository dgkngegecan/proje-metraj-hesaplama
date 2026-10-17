using System.Diagnostics;
using Android.Webkit;
using AndroidX.WebKit;
using Metraj.Host;
using Metraj.Mobile.Diagnostics;

namespace Metraj.Mobile.Bridge;

/// <summary>Köprünün etkinlikten istediği işler (hepsi UI iş parçacığında çağrılır).</summary>
internal interface IBridgeHost
{
    /// <summary>Bir işi UI iş parçacığına gönderir.</summary>
    public void RunOnUi(Action action);

    /// <summary>Arayüz ilk veriyle hazır: açılış ekranı kalkar.</summary>
    public void OnReady();

    /// <summary>JS geri yığını boş: uygulamadan çık.</summary>
    public void ExitApp();

    /// <summary>Dokunsal geri bildirim (tick | confirm | reject).</summary>
    public void Haptic(string? kind);

    /// <summary>Android paylaşım sayfası.</summary>
    public void Share(ExportedFile file);

    /// <summary>SAF "farklı kaydet".</summary>
    public void SaveAs(ExportedFile file);

    /// <summary>SAF ile dosya seçip içe aktarır; yanıtı köprüye kendisi verir.</summary>
    public void PickAndImport(string commandId, JavaScriptReplyProxy replyProxy);

    /// <summary>Tutamacı süresi dolmuş bir dosya istendi.</summary>
    public void FileUnavailable();
}

/// <summary><c>window.MetrajBridge</c>'in yerel tarafı (WebMessageListener).</summary>
/// <remarks>
/// Mesajlar UI iş parçacığında gelir; ayrıştırma ve router çağrısı arka planda
/// yapılır, yanıt <see cref="JavaScriptReplyProxy"/> ile yine UI iş parçacığından
/// döner (WebView API'si yalnız orada çağrılabilir). İstekler çekirdeğin hazırlık
/// görevini (<see cref="AppStartup.Ready"/>) bekler: sayfa veriden önce yüklenebilir.
///
/// Yalnız ana çerçeveden gelen mesajlar işlenir; origin kuralı zaten
/// <see cref="Origin"/> ile sınırlı (addWebMessageListener). Olaylar (back,
/// pause, resume) son mesajı gönderen sayfanın proxy'sine gider.
/// </remarks>
internal sealed class MetrajBridge : Java.Lang.Object, WebViewCompat.IWebMessageListener
{
    /// <summary>JS'deki nesne adı.</summary>
    public const string ObjectName = "MetrajBridge";

    /// <summary>Köprünün eklendiği tek origin.</summary>
    public const string Origin = "https://appassets.androidplatform.net";

    private const string JsonContentType = "application/json";
    private static readonly HashSet<string> Methods = new(StringComparer.Ordinal) { "GET", "POST", "PUT", "DELETE" };

    private readonly IBridgeHost host;
    private JavaScriptReplyProxy? latestProxy;

    public MetrajBridge(IBridgeHost host)
    {
        this.host = host;
    }

    /// <summary>Köprü en az bir mesaj aldı mı (olay gönderilebilir mi)?</summary>
    public bool IsConnected => latestProxy is not null;

    /// <inheritdoc />
    public void OnPostMessage(WebView? view, WebMessageCompat? message, global::Android.Net.Uri? sourceOrigin, bool isMainFrame, JavaScriptReplyProxy? replyProxy)
    {
        if (message is null || replyProxy is null) return;
        if (!isMainFrame)
        {
            MetrajLog.Warn("Alt çerçeveden gelen köprü mesajı yok sayıldı.");
            return;
        }

        if (latestProxy is null) MetrajLog.Mark("köprü: sayfadan ilk mesaj geldi");
        latestProxy = replyProxy;
        string? data = message.Data;
        long receivedAt = Stopwatch.GetTimestamp();
        _ = Task.Run(() => HandleAsync(data, replyProxy, receivedAt));
    }

    /// <summary>Yerel olayı sayfaya gönderir; köprü henüz bağlanmadıysa <see langword="false"/>.</summary>
    /// <remarks>UI iş parçacığında çağrılmalı.</remarks>
    public bool TrySendEvent(string name)
    {
        JavaScriptReplyProxy? proxy = latestProxy;
        if (proxy is null) return false;
        try
        {
            proxy.PostMessage(BridgeProtocol.Event(name));
            return true;
        }
        catch (Java.Lang.Exception exception)
        {
            MetrajLog.Warn($"Köprü olayı gönderilemedi ({name}): {exception.Message}");
            return false;
        }
    }

    /// <summary>Sayfa yeniden yüklenince eski proxy geçersizdir.</summary>
    public void ResetConnection() => latestProxy = null;

    /// <summary>Yanıtı UI iş parçacığından sayfaya gönderir.</summary>
    public void Reply(JavaScriptReplyProxy proxy, string json) =>
        host.RunOnUi(() =>
        {
            try
            {
                proxy.PostMessage(json);
            }
            catch (Java.Lang.Exception exception)
            {
                // Sayfa bu arada yeniden yüklendiyse proxy geçersizdir; istek zaten sahipsiz.
                MetrajLog.Warn($"Köprü yanıtı gönderilemedi: {exception.Message}");
            }
        });

    /// <summary>Bir isteği router'a verir ve köprü yanıtını üretir; hiçbir zaman istisna fırlatmaz.</summary>
    public static async Task<string> ExecuteAsync(string id, RouterRequest request)
    {
        MetrajRuntime runtime;
        try
        {
            runtime = await AppStartup.Ready;
        }
        catch (Exception)
        {
            // Ayrıntı açılışta günlüğe yazıldı; etkinlik yerel hata ekranını gösteriyor.
            return BridgeProtocol.Error(id, 500, "Uygulama başlatılamadı. Uygulamayı kapatıp yeniden açın.", "startup.failed");
        }

        RouterResponse response;
        try
        {
            response = await runtime.Router.DispatchAsync(request, CancellationToken.None);
        }
        catch (Exception exception)
        {
            // Router kendi hatalarını yanıta çevirir; buraya yalnız taşıma kaynaklı bir şey düşer.
            response = runtime.Router.CreateErrorResponse(exception, request.PathAndQuery);
        }

        if (response.File is not RouterFile file)
        {
            return BridgeProtocol.Response(id, response, null);
        }

        try
        {
            ExportedFile exported = ExportStore.Store(file);
            return BridgeProtocol.Response(id, response, exported);
        }
        catch (Exception exception)
        {
            return BridgeProtocol.Response(id, runtime.Router.CreateErrorResponse(exception, request.PathAndQuery), null);
        }
    }

    private async Task HandleAsync(string? data, JavaScriptReplyProxy proxy, long receivedAt)
    {
        BridgeInbound? message = BridgeProtocol.Parse(data, out string? error);
        if (message is null)
        {
            MetrajLog.Warn($"Sözleşmeye uymayan köprü mesajı yok sayıldı: {error}");
            return;
        }

        if (message.Kind == "command")
        {
            HandleCommand(message, proxy);
            return;
        }

        if (message.Method is not string method || !Methods.Contains(method) ||
            message.Path is not string path || !path.StartsWith('/'))
        {
            Reply(proxy, BridgeProtocol.Empty(message.Id, 400));
            return;
        }

        bool startupPending = !AppStartup.Ready.IsCompleted;
        var request = new RouterRequest(method, path, message.Body, null, message.Body is null ? null : JsonContentType);
        string json = await ExecuteAsync(message.Id, request).ConfigureAwait(false);
        Reply(proxy, json);
        MetrajLog.Debug($"köprü {method} {path} işlendi: {Stopwatch.GetElapsedTime(receivedAt).TotalMilliseconds:F1} ms{(startupPending ? " (çekirdek hazırlığı beklendi)" : string.Empty)}");
    }

    private void HandleCommand(BridgeInbound message, JavaScriptReplyProxy proxy)
    {
        switch (message.Command)
        {
            case "ready":
                host.RunOnUi(host.OnReady);
                break;
            case "exitApp":
                host.RunOnUi(host.ExitApp);
                break;
            case "haptic":
                host.RunOnUi(() => host.Haptic(message.HapticKind));
                break;
            case "share":
            case "saveAs":
                if (!ExportStore.TryGet(message.Handle, out ExportedFile file))
                {
                    MetrajLog.Warn($"{message.Command}: tutamaç bulunamadı ya da süresi doldu.");
                    host.RunOnUi(host.FileUnavailable);
                    break;
                }

                host.RunOnUi(message.Command == "share" ? () => host.Share(file) : () => host.SaveAs(file));
                break;
            case "pickAndImport":
                host.RunOnUi(() => host.PickAndImport(message.Id, proxy));
                break;
            default:
                MetrajLog.Warn($"Bilinmeyen köprü komutu yok sayıldı: {message.Command}");
                break;
        }
    }
}
