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
            string databasePath = ApplicationDatabasePaths.GetDatabasePath();
            writeLock = ApplicationWriteLock.TryAcquire("ProjeMetraj.SingleWriter.v1");
            if (!writeLock.IsAcquired)
            {
                writeLock.Dispose();
                writeLock = null;
                MessageBox.Show("Proje Metraj zaten açık. Aynı veritabanına aynı anda iki uygulama yazamaz.", "Proje Metraj", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown(0);
                return;
            }

            if (File.Exists(databasePath))
            {
                var maintenance = new DatabaseMaintenanceWorkspaceService(() => databasePath);
                maintenance.CreateBackupAsync(DatabaseBackupReason.BeforeMigration).GetAwaiter().GetResult();
            }

            using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
            ApplicationSchemaMigrator.MigrateAsync(context).GetAwaiter().GetResult();
            // Katalog proje kapsamından bağımsız, bu kullanıcıdaki tek SQLite veritabanında
            // tutulur. Uygulama ilk açılışta standart terim paketini bir kez ekler; sonraki
            // projeler aynı kartları kullanır ve hiçbir katalog kaydı sıfırlanmaz.
            new StarterCatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath))
                .SeedAsync()
                .GetAwaiter()
                .GetResult();
            DatabaseIntegrityCheckResult integrity = new DatabaseMaintenanceWorkspaceService(() => databasePath).CheckIntegrityAsync().GetAwaiter().GetResult();
            if (!integrity.IsHealthy)
            {
                throw new InvalidDataException(integrity.Details);
            }

            localApiHost = LocalApiHost.StartAsync(databasePath).GetAwaiter().GetResult();
            var window = new MainWindow(localApiHost.BaseUri);
            // WebView2'nin barındırdığı pencere kapanırken uygulamanın arka planda
            // kalmaması için kapanış akışını açıkça uygulama yaşam döngüsüne bağlıyoruz.
            window.Closed += (_, _) => Shutdown();
            MainWindow = window;
            window.Show();
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
