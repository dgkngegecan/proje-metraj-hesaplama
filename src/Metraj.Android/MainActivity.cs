using System.Globalization;
using Android.Content;
using Android.Content.PM;
using Android.Graphics;
using Android.OS;
using Android.Runtime;
using Android.Views;
using Android.Webkit;
using AndroidX.Activity;
using AndroidX.Activity.Result;
using AndroidX.Activity.Result.Contract;
using AndroidX.Core.Content;
using AndroidX.Core.View;
using AndroidX.WebKit;
using Metraj.Application;
using Metraj.Host;
using Metraj.Mobile.Bridge;
using Metraj.Mobile.Diagnostics;
using Metraj.Mobile.Web;
using AndroidUri = Android.Net.Uri;
// Activity'nin kendi SplashScreen özelliği (API 31, platform) adı gölgeliyor; AndroidX uyumluluk sınıfı kastediliyor.
using CompatSplashScreen = AndroidX.Core.SplashScreen.SplashScreen;
using IntentFlags = Android.Content.ActivityFlags;

namespace Metraj.Mobile;

/// <summary>Tek etkinlik: açılış ekranı, WebView, köprü ve dosya akışları.</summary>
/// <remarks>
/// Açılış sırası (performans kritik):
/// <list type="number">
/// <item><see cref="MetrajApplication"/> çekirdek hazırlığını zaten başlattı (göç, tohumlama, ısındırma).</item>
/// <item>Burada açılış ekranı kurulur, WebView oluşturulur ve sayfa yüklenir;
/// bu, çekirdek hazırlığıyla paralel yürür. Sayfanın ilk istekleri hazırlığı bekler.</item>
/// <item>Arayüz ilk veriyle <c>ready</c> der; açılış ekranı kalkar (en geç ~4 s).</item>
/// <item>Bütünlük denetimi <c>ready</c>'den sonra arka planda çalışır.</item>
/// </list>
/// Köprü modunda WebView geçmişine dokunulmaz: geri tuşu <c>back</c> olayı olarak
/// arayüze gider, arayüzün yığını boşsa arayüz <c>exitApp</c> gönderir.
/// </remarks>
[Activity(
    Name = "dev.projemetraj.app.MainActivity",
    Label = "@string/app_name",
    MainLauncher = true,
    Exported = true,
    Theme = "@style/Theme.Metraj.Starting",
    LaunchMode = LaunchMode.SingleTask,
    WindowSoftInputMode = SoftInput.AdjustResize,
    // Döndürme ve klavye değişiminde etkinlik (ve WebView) yeniden kurulmaz; arayüz
    // kendi düzenini yeniden hesaplar. Gece modu bilerek dışarıda: tema yeniden
    // yüklenmeli ki WebView prefers-color-scheme'i doğru görsün.
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.ScreenLayout |
        ConfigChanges.SmallestScreenSize | ConfigChanges.Keyboard | ConfigChanges.KeyboardHidden | ConfigChanges.Navigation)]
internal sealed class MainActivity : ComponentActivity, IBridgeHost, IWebPageHost
{
    private const string StartUrl = "https://appassets.androidplatform.net/web/mobile.html";
    private const string FileProviderAuthority = "dev.projemetraj.app.fileprovider";

    /// <summary>Arayüz <c>ready</c> demese bile açılış ekranı en fazla bu kadar kalır.</summary>
    private const long SplashSafetyTimeoutMs = 4000;

    private WebView? webView;
    private MetrajBridge? bridge;
    private ActivityResultLauncher? openDocumentLauncher;
    private ActivityResultLauncher? createDocumentLauncher;
    private ActivityResultLauncher? recoveryExportLauncher;
    private DatabaseRecovery? pendingRecoveryExport;
    private (string Id, JavaScriptReplyProxy Proxy)? pendingPick;
    private ExportedFile? pendingSave;
    private long splashShownAt;
    private long pageLoadRequestedAt;
    private bool readyReceived;
    private bool splashReleased;
    private bool fatal;
    private bool pageLoaded;
    private float safeTop;
    private float safeRight;
    private float safeBottom;
    private float safeLeft;

    // --- Yaşam döngüsü ------------------------------------------------------

    protected override void OnCreate(Bundle? savedInstanceState)
    {
        MetrajLog.Mark("etkinlik: OnCreate");
        var splash = CompatSplashScreen.InstallSplashScreen(this);
        base.OnCreate(savedInstanceState);
        splashShownAt = SystemClock.ElapsedRealtime();
        splash.SetKeepOnScreenCondition(new KeepSplashCondition(this));
        EdgeToEdge.Enable(this);

        // Etkinlik sonuçları STARTED'dan önce kaydedilmeli.
        openDocumentLauncher = RegisterForActivityResult(new ActivityResultContracts.StartActivityForResult(),
            new ActivityResultCallback(OnOpenDocumentResult));
        createDocumentLauncher = RegisterForActivityResult(new ActivityResultContracts.StartActivityForResult(),
            new ActivityResultCallback(OnCreateDocumentResult));
        recoveryExportLauncher = RegisterForActivityResult(new ActivityResultContracts.StartActivityForResult(),
            new ActivityResultCallback(OnRecoveryExportResult));
        OnBackPressedDispatcher.AddCallback(this, new BackCallback(this));

        if (!WebViewFeature.IsFeatureSupported(WebViewFeature.WebMessageListener))
        {
            ShowFatalError(
                "Güncelleme gerekiyor",
                "Proje Metraj'ın çalışması için Google Play'den \"Android System WebView\" ve \"Chrome\" " +
                "uygulamalarını güncelleyin, ardından uygulamayı yeniden açın.");
            return;
        }

        CreateWebView();
        _ = ObserveStartupAsync();
    }

    protected override void OnPause()
    {
        // Önce olay: arayüz bekleyen taslak yazımlarını hemen gönderir. WebView.OnPause
        // JavaScript'i durdurmaz (yalnız PauseTimers durdurur; o bilerek çağrılmaz).
        bridge?.TrySendEvent("pause");
        webView?.OnPause();
        base.OnPause();
    }

    protected override void OnResume()
    {
        base.OnResume();
        webView?.OnResume();
        bridge?.TrySendEvent("resume");
    }

    protected override void OnDestroy()
    {
        webView?.Destroy();
        webView = null;
        base.OnDestroy();
    }

    // --- WebView ------------------------------------------------------------

    private void CreateWebView()
    {
#if METRAJ_WEBVIEW_DEBUGGING
        WebView.SetWebContentsDebuggingEnabled(true);
#else
        WebView.SetWebContentsDebuggingEnabled(false);
#endif
        Color background = BackgroundColor();
        var view = new WebView(this);
        view.SetBackgroundColor(background);
        WebSettings settings = view.Settings!;
        settings.JavaScriptEnabled = true;
        settings.DomStorageEnabled = true;
        settings.AllowFileAccess = false;
        settings.AllowContentAccess = false;
        settings.MixedContentMode = MixedContentHandling.NeverAllow;
        settings.SetGeolocationEnabled(false);
        settings.SetSupportMultipleWindows(false);
        settings.JavaScriptCanOpenWindowsAutomatically = false;
        view.SetWebViewClient(new AppAssetsWebViewClient(this, this));
        view.SetWebChromeClient(new LockedDownChromeClient());

        bridge = new MetrajBridge(this);
        // Nesne yalnız bu origin'e eklenir; sayfa yüklenmeden ÖNCE kaydedilmeli.
        WebViewCompat.AddWebMessageListener(view, MetrajBridge.ObjectName,
            new HashSet<string>(StringComparer.Ordinal) { MetrajBridge.Origin }, bridge);

        var root = new FrameLayout(this);
        root.SetBackgroundColor(background);
        root.AddView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MatchParent, ViewGroup.LayoutParams.MatchParent));
        SetContentView(root);
        ViewCompat.SetOnApplyWindowInsetsListener(root, new InsetsListener(this));
        webView = view;

        pageLoadRequestedAt = MetrajLog.Elapsed;
        MetrajLog.Mark("WebView kuruldu, sayfa yükleniyor");
        view.LoadUrl(StartUrl);
    }

    private Color BackgroundColor() => new(ContextCompat.GetColor(this, Resource.Color.metraj_bg));

    /// <summary>
    /// Kenardan kenara düzen. Sistem çubukları ve kesik payı arayüzün kendi
    /// değişkenlerine (<c>--safe-top/right/bottom/left</c>) verilir; klavye açıkken
    /// WebView klavyenin üstüne kadar küçülür (adjustResize'ın kenardan kenara
    /// karşılığı) ve alt pay sıfırlanır (gezinme çubuğu klavyenin altında kalır).
    /// </summary>
    /// <remarks>
    /// Arayüz <c>env(safe-area-inset-*)</c> kullanıyor; WebView bu değerleri
    /// sistem çubukları için her sürümde doldurmuyor. Değişkenler
    /// <c>max(env(...), Npx)</c> olarak yazılır: WebView değeri biliyorsa onu,
    /// bilmiyorsa yerel değeri kullanır, iki kez sayılmaz. Pencere payları burada
    /// tüketilir ki WebView aynı payı bir kez daha uygulamasın.
    /// </remarks>
    private void ApplyInsets(View root, WindowInsetsCompat insets)
    {
        AndroidX.Core.Graphics.Insets bars = insets.GetInsets(WindowInsetsCompat.Type.SystemBars() | WindowInsetsCompat.Type.DisplayCutout())
            ?? AndroidX.Core.Graphics.Insets.None!;
        bool imeVisible = insets.IsVisible(WindowInsetsCompat.Type.Ime());
        int imeBottom = imeVisible ? insets.GetInsets(WindowInsetsCompat.Type.Ime())?.Bottom ?? 0 : 0;
        root.SetPadding(0, 0, 0, imeBottom);

        float density = Resources?.DisplayMetrics?.Density ?? 1f;
        safeTop = bars.Top / density;
        safeRight = bars.Right / density;
        safeBottom = imeVisible ? 0 : bars.Bottom / density;
        safeLeft = bars.Left / density;
        PushSafeArea();
    }

    private void PushSafeArea()
    {
        if (webView is null || !pageLoaded) return;
        string script = string.Create(CultureInfo.InvariantCulture,
            $"(function(t,r,b,l){{var s=document.documentElement&&document.documentElement.style;if(!s)return;" +
            $"s.setProperty('--safe-top','max(env(safe-area-inset-top, 0px), '+t+'px)');" +
            $"s.setProperty('--safe-right','max(env(safe-area-inset-right, 0px), '+r+'px)');" +
            $"s.setProperty('--safe-bottom','max(env(safe-area-inset-bottom, 0px), '+b+'px)');" +
            $"s.setProperty('--safe-left','max(env(safe-area-inset-left, 0px), '+l+'px)');}})" +
            $"({safeTop:0.##},{safeRight:0.##},{safeBottom:0.##},{safeLeft:0.##})");
        webView.EvaluateJavascript(script, null);
    }

    public void OnPageStarted()
    {
        pageLoaded = false;
        // Yeniden yüklenen sayfa yeni bir köprü bağlamıdır; eski proxy'ye olay gönderilmez.
        bridge?.ResetConnection();
    }

    public void OnPageCommitVisible()
    {
        pageLoaded = true;
        PushSafeArea();
        MetrajLog.Mark($"sayfa görünür oldu (yükleme {MetrajLog.Elapsed - pageLoadRequestedAt} ms)");
    }

    public void OnPageFinished()
    {
        pageLoaded = true;
        PushSafeArea();
        MetrajLog.Mark("sayfa yüklendi");
    }

    public void OnMainFrameError(string description)
    {
        MetrajLog.Error($"Arayüz yüklenemedi: {description}", null);
        ShowFatalError("Uygulama açılamadı",
            "Uygulamayı güncelleyin ya da kaldırıp yeniden yükleyin.");
    }

    public void OnRendererGone()
    {
        webView?.Destroy();
        webView = null;
        if (!IsFinishing) Recreate();
    }

    // --- Açılış ve bütünlük -------------------------------------------------

    private async Task ObserveStartupAsync()
    {
        try
        {
            await AppStartup.Ready;
        }
        catch (Exception exception)
        {
            // Ayrıntı kullanıcıya değil günlüğe gider.
            MetrajLog.Error("Açılış hazırlığı başarısız.", exception);
            ShowFatalError("Veriler açılamadı",
                "Verileriniz silinmedi. Son yedeği geri yükleyebilir ya da verilerinizi dışa aktarabilirsiniz.",
                AddRecoveryActions);
        }
    }

    // --- Açılış kurtarma ----------------------------------------------------
    //
    // Hata ekranında önceden yalnız "Kapat" vardı: veritabanı bozulduysa kullanıcı
    // yedeklerine (uygulamanın özel klasöründe, dışarıdan görünmez) hiç ulaşamıyordu.
    // Ayarlar → Yedekler router'dan geçer; router'ı kuran hazırlık başarısız
    // olduğu için burada DatabaseRecovery doğrudan bakım servisiyle çalışır.

    private void AddRecoveryActions(LinearLayout layout, TextView status)
    {
        DatabaseRecovery recovery = AppStartup.CreateRecovery();
        Button restore = PlainButton("Son yedeği geri yükle");
        restore.Enabled = false;
        Button export = PlainButton("Veriyi dışa aktar");
        restore.Click += (_, _) => ConfirmRestore(recovery, restore, export, status);
        export.Click += (_, _) => StartRecoveryExport(recovery);
        layout.AddView(restore);
        layout.AddView(export);

        // Yedek listesi dosya sistemi taraması; UI iş parçacığını bekletmez.
        _ = Task.Run(async () =>
        {
            IReadOnlyList<DatabaseBackupListItem> backups;
            try
            {
                backups = await recovery.ListBackupsAsync();
            }
            catch (Exception exception)
            {
                MetrajLog.Error("Kurtarma: yedekler listelenemedi.", exception);
                backups = [];
            }

            RunOnUiThread(() =>
            {
                if (backups.Count == 0)
                {
                    restore.Text = "Geri yüklenecek yedek yok";
                    return;
                }

                restore.Enabled = true;
                restore.Text = $"Son yedeği geri yükle ({FormatLocal(backups[0].CreatedAtUtc)})";
            });
        });
    }

    private void ConfirmRestore(DatabaseRecovery recovery, Button restore, Button export, TextView status) =>
        new AlertDialog.Builder(this)
            .SetTitle("Son yedek geri yüklensin mi?")!
            .SetMessage("Yedekten sonra girilen kayıtlar kaybolur. Mevcut veriler silinmez, ayrıca saklanır; " +
                "\"Veriyi dışa aktar\" ile alabilirsiniz.")!
            .SetPositiveButton("Geri yükle", (sender, args) => _ = RestoreLatestBackupAsync(recovery, restore, export, status))!
            .SetNegativeButton("Vazgeç", (IDialogInterfaceOnClickListener?)null)!
            .Show();

    private async Task RestoreLatestBackupAsync(DatabaseRecovery recovery, Button restore, Button export, TextView status)
    {
        restore.Enabled = false;
        export.Enabled = false;
        status.Text = "Yedek geri yükleniyor…";
        try
        {
            DatabaseRecoveryResult result = await Task.Run(() => recovery.RestoreLatestBackupAsync());
            MetrajLog.Mark($"kurtarma: {result.Backup.FileName} geri yüklendi; bozuk dosya: {result.QuarantineDirectory ?? "(yoktu)"}" +
                (result.SkippedBackups.Count > 0 ? $"; atlanan: {string.Join(" | ", result.SkippedBackups)}" : string.Empty));
            Toast.MakeText(this, $"{FormatLocal(result.Backup.CreatedAtUtc)} yedeği geri yüklendi.", ToastLength.Long)?.Show();
            // Hazırlık yeni veritabanıyla baştan başlar; etkinlik yeniden kurulup onu bekler.
            AppStartup.Restart();
            Recreate();
        }
        catch (Exception exception)
        {
            MetrajLog.Error("Kurtarma: yedek geri yüklenemedi.", exception);
            status.Text = "Yedek geri yüklenemedi. Verilerinizi dışa aktarın.";
            restore.Enabled = true;
            export.Enabled = true;
        }
    }

    private void StartRecoveryExport(DatabaseRecovery recovery)
    {
        var intent = new Intent(Intent.ActionCreateDocument);
        intent.AddCategory(Intent.CategoryOpenable);
        intent.SetType("application/zip");
        intent.PutExtra(Intent.ExtraTitle, recovery.SuggestedArchiveName());
        try
        {
            pendingRecoveryExport = recovery;
            recoveryExportLauncher!.Launch(intent);
        }
        catch (ActivityNotFoundException exception)
        {
            pendingRecoveryExport = null;
            MetrajLog.Error("Kurtarma: belge kaydetme ekranı açılamadı.", exception);
            Toast.MakeText(this, "Bu cihazda dosya kaydedilemiyor.", ToastLength.Long)?.Show();
        }
    }

    private void OnRecoveryExportResult(ActivityResult? result)
    {
        DatabaseRecovery? recovery = pendingRecoveryExport;
        pendingRecoveryExport = null;
        AndroidUri? uri = result?.ResultCode == (int)Result.Ok ? result.Data?.Data : null;
        if (recovery is null || uri is null) return;

        ContentResolver resolver = ContentResolver!;
        _ = Task.Run(async () =>
        {
            try
            {
                int count;
                await using (Stream output = resolver.OpenOutputStream(uri, "wt") ?? throw new IOException("Hedef açılamadı."))
                {
                    count = await recovery.WriteRecoveryArchiveAsync(output);
                }

                MetrajLog.Mark($"kurtarma: ham veri dışa aktarıldı ({count} dosya)");
                RunOnUiThread(() => Toast.MakeText(this, $"Veri dışa aktarıldı ({count} dosya).", ToastLength.Long)?.Show());
            }
            catch (Exception exception)
            {
                MetrajLog.Error("Kurtarma: veri dışa aktarılamadı.", exception);
                RunOnUiThread(() => Toast.MakeText(this, "Veri dışa aktarılamadı.", ToastLength.Long)?.Show());
            }
        });
    }

    /// <summary>
    /// Büyük harfe çevrilmeyen düğme. Tema metni cihaz diliyle büyütüyor; İngilizce
    /// cihazda "Veriyi" → "VERIYI", "geri" → "GERI" oluyordu (Türkçe İ kayboluyor).
    /// </summary>
    private Button PlainButton(string text)
    {
        var button = new Button(this) { Text = text };
        button.SetAllCaps(false);
        return button;
    }

    private static string FormatLocal(DateTime utc) =>
        DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture);

    private bool ShouldKeepSplash()
    {
        if (readyReceived || fatal) return false;
        if (SystemClock.ElapsedRealtime() - splashShownAt < SplashSafetyTimeoutMs) return true;
        if (!splashReleased)
        {
            splashReleased = true;
            MetrajLog.Warn("Açılış ekranı güvenlik süresiyle kapandı: arayüz 4 s içinde ready demedi.");
            _ = CheckIntegrityAsync();
        }

        return false;
    }

    public void OnReady()
    {
        if (readyReceived) return;
        readyReceived = true;
        MetrajLog.Mark($"ready alındı (açılış ekranı {SystemClock.ElapsedRealtime() - splashShownAt} ms kaldı)");
        ReportFullyDrawn();
        LogPageTimings();
        _ = CheckIntegrityAsync();
    }

    /// <summary>Ölçüm: sayfanın kendi zaman çizelgesi (ilk boyama = kabuk görünür, metraj:ready).</summary>
    private void LogPageTimings()
    {
        const string Script =
            "(function(){var p=performance,f=p.getEntriesByName('first-contentful-paint')[0],r=p.getEntriesByName('metraj:ready')[0];" +
            "return JSON.stringify({fcp:f?Math.round(f.startTime):null,ready:r?Math.round(r.startTime):null});})()";
        long navigationAt = pageLoadRequestedAt;
        webView?.EvaluateJavascript(Script, new JavascriptResult(value =>
            MetrajLog.Mark($"sayfa zamanları (sayfa yüklemesi t+{navigationAt} ms'de istendi, değerler ona göre): {value}")));
    }

    private async Task CheckIntegrityAsync()
    {
        try
        {
            DatabaseIntegrityCheckResult result = await AppStartup.CheckIntegrityAsync();
            if (result.IsHealthy || IsFinishing || IsDestroyed) return;
            new AlertDialog.Builder(this)
                .SetTitle("Verilerde sorun bulundu")!
                .SetMessage("Yeni kayıt girmeden önce Ayarlar > Yedekler'den son yedeği geri yükleyin.")!
                .SetPositiveButton("Anladım", (IDialogInterfaceOnClickListener?)null)!
                .Show();
        }
        catch (Exception exception)
        {
            // Açılış hatası ayrıca hata ekranında gösteriliyor; burada yalnız denetimin kendisi düştü.
            MetrajLog.Error("Bütünlük denetimi çalıştırılamadı.", exception);
        }
    }

    /// <param name="addActions">"Kapat"tan önce eklenecek düğmeler; ikinci parametre durum satırıdır.</param>
    private void ShowFatalError(string title, string message, Action<LinearLayout, TextView>? addActions = null)
    {
        if (fatal) return;
        fatal = true;
        webView?.Destroy();
        webView = null;

        float density = Resources?.DisplayMetrics?.Density ?? 1f;
        int padding = (int)(24 * density);
        var layout = new LinearLayout(this) { Orientation = Orientation.Vertical };
        layout.SetPadding(padding, padding * 3, padding, padding);
        var heading = new TextView(this) { Text = title, TextSize = 22 };
        heading.SetTextColor(new Color(ContextCompat.GetColor(this, Resource.Color.metraj_text)));
        var body = new TextView(this) { Text = message, TextSize = 16 };
        body.SetTextColor(new Color(ContextCompat.GetColor(this, Resource.Color.metraj_text_muted)));
        body.SetPadding(0, padding, 0, padding);
        body.SetTextIsSelectable(true);
        Button close = PlainButton("Kapat");
        close.Click += (_, _) => FinishAndRemoveTask();
        layout.AddView(heading);
        layout.AddView(body);
        if (addActions is not null)
        {
            var status = new TextView(this) { TextSize = 14 };
            status.SetTextColor(new Color(ContextCompat.GetColor(this, Resource.Color.metraj_text_muted)));
            status.SetPadding(0, 0, 0, padding / 2);
            layout.AddView(status);
            addActions(layout, status);
        }

        layout.AddView(close);
        var scroll = new ScrollView(this);
        scroll.SetBackgroundColor(BackgroundColor());
        scroll.AddView(layout);
        SetContentView(scroll);
    }

    // --- Köprü komutları ----------------------------------------------------

    public void RunOnUi(Action action) => RunOnUiThread(action);

    public void ExitApp()
    {
        // Android 12+ kök etkinlikte geri tuşunun sistem davranışı: görevi arka plana
        // al, süreci öldürme. Çekirdek ısınmış kalır; bir sonraki açılış anında olur.
        if (!MoveTaskToBack(true)) Finish();
    }

    private void HandleBack()
    {
        if (!fatal && bridge?.TrySendEvent("back") == true) return;
        ExitApp();
    }

    public void Haptic(string? kind)
    {
        View? target = webView ?? Window?.DecorView;
        if (target is null) return;
        FeedbackConstants feedback = FeedbackConstants.KeyboardTap;
        if (kind == "confirm")
        {
            feedback = OperatingSystem.IsAndroidVersionAtLeast(30) ? FeedbackConstants.Confirm : FeedbackConstants.VirtualKey;
        }
        else if (kind == "reject")
        {
            feedback = OperatingSystem.IsAndroidVersionAtLeast(30) ? FeedbackConstants.Reject : FeedbackConstants.LongPress;
        }

        target.PerformHapticFeedback(feedback);
    }

    public void Share(ExportedFile file)
    {
        try
        {
            AndroidUri uri = FileProvider.GetUriForFile(this, FileProviderAuthority, new Java.IO.File(file.Path))!;
            var send = new Intent(Intent.ActionSend);
            send.SetType(ShareMimeType(file.Mime));
            send.PutExtra(Intent.ExtraStream, uri);
            // ClipData, okuma izninin seçici üzerinden hedef uygulamaya geçmesini sağlar.
            send.ClipData = ClipData.NewRawUri(file.Name, uri);
            send.AddFlags(IntentFlags.GrantReadUriPermission);
            StartActivity(Intent.CreateChooser(send, file.Name));
            MetrajLog.Mark($"paylaşım sayfası açıldı: {file.Name} ({file.Mime}, {file.Size} bayt)");
        }
        catch (Exception exception)
        {
            MetrajLog.Error("Paylaşım sayfası açılamadı.", exception);
            Toast.MakeText(this, "Paylaşım açılamadı.", ToastLength.Long)?.Show();
        }
    }

    public void SaveAs(ExportedFile file)
    {
        var intent = new Intent(Intent.ActionCreateDocument);
        intent.AddCategory(Intent.CategoryOpenable);
        intent.SetType(file.Mime);
        intent.PutExtra(Intent.ExtraTitle, file.Name);
        try
        {
            pendingSave = file;
            createDocumentLauncher!.Launch(intent);
        }
        catch (ActivityNotFoundException exception)
        {
            pendingSave = null;
            MetrajLog.Error("Belge kaydetme ekranı açılamadı.", exception);
            Toast.MakeText(this, "Bu cihazda dosya kaydedilemiyor.", ToastLength.Long)?.Show();
        }
    }

    public void PickAndImport(string commandId, JavaScriptReplyProxy replyProxy)
    {
        // Yanıt HER durumda verilir: JS tarafında bu komutun zaman aşımı yok.
        if (pendingPick is not null)
        {
            bridge!.Reply(replyProxy, BridgeProtocol.Error(commandId, 409, "Dosya seçici zaten açık.", "android.picker-busy"));
            return;
        }

        var intent = new Intent(Intent.ActionOpenDocument);
        intent.AddCategory(Intent.CategoryOpenable);
        // .metraj için kayıtlı bir MIME türü yok; sağlayıcılar onu çoğunlukla octet-stream olarak bildirir.
        intent.SetType("*/*");
        try
        {
            pendingPick = (commandId, replyProxy);
            openDocumentLauncher!.Launch(intent);
        }
        catch (ActivityNotFoundException exception)
        {
            pendingPick = null;
            MetrajLog.Error("Dosya seçici açılamadı.", exception);
            bridge!.Reply(replyProxy, BridgeProtocol.Error(commandId, 500,
                "Bu cihazda dosya seçilemiyor.", "android.picker-unavailable"));
        }
    }

    public void FileUnavailable() =>
        Toast.MakeText(this, "Dosyanın süresi doldu. Raporu yeniden oluşturun.", ToastLength.Long)?.Show();

    private void OnOpenDocumentResult(ActivityResult? result)
    {
        if (pendingPick is not (string id, JavaScriptReplyProxy proxy))
        {
            return;
        }

        pendingPick = null;
        AndroidUri? uri = result?.ResultCode == (int)Result.Ok ? result.Data?.Data : null;
        if (uri is null)
        {
            MetrajLog.Mark("içe aktarma: dosya seçiminden vazgeçildi");
            bridge!.Reply(proxy, BridgeProtocol.Empty(id, 204));
            return;
        }

        MetrajBridge activeBridge = bridge!;
        ContentResolver resolver = ContentResolver!;
        _ = Task.Run(async () =>
        {
            // Akış router'da bir kez açılıp kapanır; dosya belleğe alınmaz.
            var request = new RouterRequest("POST", "/api/workspace/import", null,
                () => resolver.OpenInputStream(uri) ?? throw new FileNotFoundException("Seçilen dosya açılamadı."), null);
            string json = await MetrajBridge.ExecuteAsync(id, request);
            activeBridge.Reply(proxy, json);
            MetrajLog.Mark("içe aktarma: yanıt verildi");
        });
    }

    private void OnCreateDocumentResult(ActivityResult? result)
    {
        ExportedFile? file = pendingSave;
        pendingSave = null;
        AndroidUri? uri = result?.ResultCode == (int)Result.Ok ? result.Data?.Data : null;
        if (file is null || uri is null) return;

        ContentResolver resolver = ContentResolver!;
        _ = Task.Run(() =>
        {
            try
            {
                // "wt": bazı sağlayıcılar "w" ile var olan dosyayı kırpmadan üstüne yazıyor.
                using (Stream output = resolver.OpenOutputStream(uri, "wt") ?? throw new IOException("Hedef açılamadı."))
                using (FileStream input = File.OpenRead(file.Path))
                {
                    input.CopyTo(output);
                }

                ExportStore.Release(file.Handle);
                MetrajLog.Mark($"cihaza kaydedildi: {file.Name}");
                RunOnUiThread(() => Toast.MakeText(this, $"{file.Name} kaydedildi.", ToastLength.Short)?.Show());
            }
            catch (Exception exception)
            {
                MetrajLog.Error("Dosya cihaza kaydedilemedi.", exception);
                RunOnUiThread(() => Toast.MakeText(this, "Dosya kaydedilemedi.", ToastLength.Long)?.Show());
            }
        });
    }

    /// <summary>Uygulamaya özgü MIME türünü paylaşım hedefleri tanımaz; genel ikili tür daha çok hedef açar.</summary>
    private static string ShareMimeType(string mime) =>
        mime.StartsWith("application/vnd.projemetraj", StringComparison.OrdinalIgnoreCase) ? "application/octet-stream" : mime;

    // --- Java geri çağırma sarmalayıcıları ----------------------------------

    private sealed class KeepSplashCondition(MainActivity activity) : Java.Lang.Object, CompatSplashScreen.IKeepOnScreenCondition
    {
        public bool ShouldKeepOnScreen() => activity.ShouldKeepSplash();
    }

    private sealed class BackCallback(MainActivity activity) : OnBackPressedCallback(true)
    {
        public override void HandleOnBackPressed() => activity.HandleBack();
    }

    private sealed class InsetsListener(MainActivity activity) : Java.Lang.Object, IOnApplyWindowInsetsListener
    {
        public WindowInsetsCompat? OnApplyWindowInsets(View? v, WindowInsetsCompat? insets)
        {
            if (v is null || insets is null) return insets;
            activity.ApplyInsets(v, insets);
            return WindowInsetsCompat.Consumed;
        }
    }

    private sealed class ActivityResultCallback(Action<ActivityResult?> onResult) : Java.Lang.Object, IActivityResultCallback
    {
        public void OnActivityResult(Java.Lang.Object? result) => onResult(result?.JavaCast<ActivityResult>());
    }
}
