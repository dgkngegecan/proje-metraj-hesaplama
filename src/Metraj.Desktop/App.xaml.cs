using Metraj.Application;
using Metraj.Api;
using Metraj.Infrastructure;
using System.Windows;
using System.Windows.Threading;
using System.IO;

namespace Metraj.Desktop;

/// <summary>Application entry point.</summary>
public partial class App : System.Windows.Application
{
    private LocalApiHost? localApiHost;
    private ApplicationWriteLock? writeLock;

    /// <inheritdoc />
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        try
        {
            writeLock = ApplicationWriteLock.TryAcquire("ProjeMetraj.SingleWriter.v1");
            if (!writeLock.IsAcquired)
            {
                writeLock.Dispose();
                writeLock = null;
                MessageBox.Show("Proje Metraj zaten açık. Aynı veritabanına aynı anda iki uygulama yazamaz.", "Proje Metraj", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown(0);
                return;
            }

            // Pencere ÖNCE gösterilir. Hazırlık işleri arkasında yürür ve her
            // adım yükleme ekranına yazılır; kullanıcı hiçbir zaman boş ekranla
            // kalmaz. Önceden bütün hazırlık senkron bekleniyor, pencere ancak
            // sonunda açılıyordu.
            var window = new MainWindow();
            // WebView2'nin barındırdığı pencere kapanırken uygulamanın arka planda
            // kalmaması için kapanış akışını açıkça uygulama yaşam döngüsüne bağlıyoruz.
            window.Closed += (_, _) => Shutdown();
            MainWindow = window;
            window.Show();

            _ = InitializeApplicationAsync(window);
        }
        catch (Exception exception)
        {
            LogStartupFailure(exception);
            MessageBox.Show(
                "Uygulama güvenli şekilde başlatılamadı. Ayrıntı kaydı: proje-metraj-startup-error.log",
                "Proje Metraj başlangıç hatası",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    /// <summary>
    /// Veritabanı hazırlığını arka planda yürütür ve her adımı yükleme ekranına
    /// bildirir. Dispatcher bloklanmadığı için pencere baştan sona yanıt verir.
    /// </summary>
    private async Task InitializeApplicationAsync(MainWindow window)
    {
        try
        {
            window.ReportProgress("Veri konumu hazırlanıyor…");
            string databasePath = await Task.Run(ApplicationDatabasePaths.GetDatabasePath);

            // Yedek yalnızca şema gerçekten değişecekse alınır. Her açılışta
            // koşulsuz yedek almak hem açılışı uzatıyor hem de kullanıcının
            // kasıtlı yedeklerini kotadan düşürüyordu.
            bool schemaUpToDate = await ApplicationSchemaMigrator.IsUpToDateAsync(databasePath);
            if (File.Exists(databasePath) && !schemaUpToDate)
            {
                window.ReportProgress("Güncelleme öncesi yedek alınıyor…");
                await new DatabaseMaintenanceWorkspaceService(() => databasePath)
                    .CreateBackupAsync(DatabaseBackupReason.BeforeMigration);
            }

            if (!schemaUpToDate)
            {
                window.ReportProgress("Veritabanı hazırlanıyor…");
                await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            // Katalog proje kapsamından bağımsız, bu kullanıcıdaki tek SQLite veritabanında
            // tutulur. Uygulama ilk açılışta standart terim paketini bir kez ekler; sonraki
            // projeler aynı kartları kullanır ve hiçbir katalog kaydı sıfırlanmaz.
            window.ReportProgress("Standart kart kütüphanesi denetleniyor…");
            await new StarterCatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath)).SeedAsync();

            window.ReportProgress("Veri bütünlüğü denetleniyor…");
            DatabaseIntegrityCheckResult integrity =
                await new DatabaseMaintenanceWorkspaceService(() => databasePath).CheckIntegrityAsync();
            if (!integrity.IsHealthy)
            {
                throw new InvalidDataException(integrity.Details);
            }

            window.ReportProgress("Çalışma ekranı açılıyor…");
            localApiHost = await LocalApiHost.StartAsync(databasePath);
            window.NavigateWhenReady(localApiHost.BaseUri);
        }
        catch (Exception exception)
        {
            LogStartupFailure(exception);
            window.ReportStartupFailure(exception.Message);
            MessageBox.Show(
                "Uygulama güvenli şekilde başlatılamadı. Ayrıntı kaydı: proje-metraj-startup-error.log",
                "Proje Metraj başlangıç hatası",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    /// <inheritdoc />
    protected override void OnExit(ExitEventArgs e)
    {
        // Kestrel yalnızca bu süreç içindeki WebView2'ye loopback üzerinden hizmet eder.
        // WPF kapanışında eşzamanlı StopAsync beklemek, bazı WebView2 sürümlerinde iletiyi
        // canlı tutabiliyor. Süreç sonlanırken işletim sistemi soketi ve belleği güvenle
        // temizler; test barındırıcısı ise IAsyncDisposable yolunu kullanmaya devam eder.
        localApiHost = null;
        writeLock?.Dispose();
        writeLock = null;
        base.OnExit(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        LogStartupFailure(e.Exception);
        MessageBox.Show(
            "Beklenmeyen bir hata oluştu. Uygulama kapatılacak; ayrıntı kaydı: proje-metraj-startup-error.log",
            "Proje Metraj hatası",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        e.Handled = true;
        Shutdown(1);
    }

    private static void LogStartupFailure(Exception exception)
    {
        string message = $"{DateTime.UtcNow:O}{Environment.NewLine}{exception}{Environment.NewLine}";
        Console.Error.WriteLine(message);
        try
        {
            string tempPath = Path.Combine(Path.GetTempPath(), "proje-metraj-startup-error.log");
            File.WriteAllText(tempPath, message);
            string basePath = Path.Combine(AppContext.BaseDirectory, "proje-metraj-startup-error.log");
            File.WriteAllText(basePath, message);
        }
        catch
        {
            // Startup logging must never hide the original failure.
        }
    }
}
