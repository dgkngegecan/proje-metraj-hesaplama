using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Windows;

namespace Metraj.Desktop;

/// <summary>Thin native shell that displays the local React application in WebView2.</summary>
public partial class MainWindow : Window
{
    private readonly Uri localApplicationUri;

    /// <summary>Creates the shell for an already-started loopback React application.</summary>
    public MainWindow(Uri localApplicationUri)
    {
        this.localApplicationUri = localApplicationUri ?? throw new ArgumentNullException(nameof(localApplicationUri));
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            string userDataDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ProjeMetraj",
                "webview2");
            Directory.CreateDirectory(userDataDirectory);
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataDirectory);
            await MetrajBrowser.EnsureCoreWebView2Async(environment);
            CoreWebView2Settings settings = MetrajBrowser.CoreWebView2.Settings;
            settings.AreDevToolsEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.IsStatusBarEnabled = false;
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
