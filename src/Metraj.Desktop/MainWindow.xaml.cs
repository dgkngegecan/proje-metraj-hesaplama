using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Windows;

namespace Metraj.Desktop;

/// <summary>Thin native shell that displays the local React application in WebView2.</summary>
public partial class MainWindow : Window
{
    // Pencere, hazırlık işleri bitmeden gösterilir. Adres hazır olunca bu
    // kaynak tamamlanır. Önceden pencere ancak yedekleme, göç, tohumlama,
    // bütünlük denetimi ve API başlatma bittikten SONRA açılıyordu: kullanıcı
    // .exe'ye çift tıklayıp saniyelerce hiçbir şey görmüyor, uygulamanın
    // açılmadığını sanıp tekrar tıklıyordu.
    private readonly TaskCompletionSource<Uri> applicationUri =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Creates the shell; the local application address arrives later.</summary>
    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    /// <summary>Shows the current start-up step on the loading screen.</summary>
    public void ReportProgress(string message) => Dispatcher.Invoke(() => LoadingStatus.Text = message);

    /// <summary>Supplies the loopback address once the local API is listening.</summary>
    public void NavigateWhenReady(Uri uri) => applicationUri.TrySetResult(uri);

    /// <summary>Reports a start-up failure without leaving the user on a silent screen.</summary>
    public void ReportStartupFailure(string message) =>
        applicationUri.TrySetException(new InvalidOperationException(message));

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            string userDataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ProjeMetraj",
                "webview2");
            Directory.CreateDirectory(userDataDirectory);
            // WebView2 çalışma zamanı, veritabanı hazırlığıyla aynı anda ısınır.
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataDirectory);
            await MetrajBrowser.EnsureCoreWebView2Async(environment);
            CoreWebView2Settings settings = MetrajBrowser.CoreWebView2.Settings;
            settings.AreDevToolsEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.IsStatusBarEnabled = false;

            Uri localApplicationUri = await applicationUri.Task;
            MetrajBrowser.Source = localApplicationUri;
            LoadingScreen.Visibility = Visibility.Collapsed;
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                $"Görsel çalışma ekranı başlatılamadı. WebView2 Runtime'ın Windows'ta hazır olduğundan emin olun.\n\n{exception.Message}",
                "Proje Metraj",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }
}
