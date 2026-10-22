using System.Text.Json;
using Metraj.Application;
using Metraj.Host;
using Metraj.Infrastructure;
using Metraj.Mobile.Diagnostics;

namespace Metraj.Mobile;

/// <summary>Hazır çekirdek: servisler ve router.</summary>
internal sealed record MetrajRuntime(MetrajServices Services, MetrajRequestRouter Router, string DatabasePath);

/// <summary>Veritabanı hazırlığı; süreç başlar başlamaz arka planda bir kez çalışır.</summary>
/// <remarks>
/// Sıra masaüstüyle (App.xaml.cs) aynı: şema güncel değilse ve veritabanı
/// varsa önce <see cref="DatabaseBackupReason.BeforeMigration"/> yedeği, sonra
/// göç, sonra standart katalog tohumlama (damga kısa yolu). Fark ikiyle sınırlı:
/// <list type="number">
/// <item>Ardından bir ısındırma sorgusu çalışır. EF Core'un ilk servis/model
/// kurulumu (~1,75 s, Dalga 1 ölçümü) böylece WebView'ın oluşturulup sayfayı
/// yüklemesiyle PARALEL geçer; arayüzün ilk isteği hazır bir EF'e düşer.</item>
/// <item>Bütünlük denetimi açılışı geciktirmez: arayüz <c>ready</c> dedikten
/// sonra arka planda çalışır (<see cref="CheckIntegrityAsync"/>). Masaüstünde
/// açılışı bekletiyordu; telefonda ilk veri bütçesi (&lt; 3,5 s) buna izin vermiyor.</item>
/// </list>
/// Köprüye gelen her istek <see cref="Ready"/>'yi bekler. Hazırlık başarısız
/// olursa hata sessiz kalmaz: kalıcı günlüğe yazılır ve etkinlik yerel bir hata
/// ekranı gösterir.
/// </remarks>
internal static class AppStartup
{
    private static readonly object Sync = new();
    private static Task<MetrajRuntime>? startup;
    private static Task<DatabaseIntegrityCheckResult>? integrity;
    private static Func<Stream>? templateOpener;
    private static string? startedFilesDirectory;

    /// <summary>Hazırlık görevi. <see cref="Start"/> çağrılmadan okunamaz.</summary>
    public static Task<MetrajRuntime> Ready =>
        startup ?? throw new InvalidOperationException("Açılış hazırlığı başlatılmadı.");

    /// <summary>
    /// Açılış hatası ekranının kurtarma işleri (son yedeği geri yükle, ham veriyi
    /// dışa aktar). Router'a ve <see cref="MetrajServices"/>'e dokunmaz: hazırlık
    /// başarısız olduğunda ikisi de yoktur.
    /// </summary>
    public static DatabaseRecovery CreateRecovery()
    {
        string filesDirectory = startedFilesDirectory ?? throw new InvalidOperationException("Açılış hazırlığı başlatılmadı.");
        return new DatabaseRecovery(Path.Combine(filesDirectory, "metraj.db"), Path.Combine(filesDirectory, "backups"));
    }

    /// <summary>Kurtarmadan sonra hazırlığı baştan başlatır; yalnız önceki hazırlık başarısız bittiyse.</summary>
    public static void Restart()
    {
        lock (Sync)
        {
            if (startup is not { IsFaulted: true } || startedFilesDirectory is null)
            {
                throw new InvalidOperationException("Yalnız başarısız bir açılış yeniden başlatılabilir.");
            }

            startup = null;
            integrity = null;
            MetrajLog.Mark("hazırlık kurtarmadan sonra yeniden başlatılıyor");
            Start(startedFilesDirectory, templateOpener);
        }
    }

    /// <summary>Hazırlığı arka planda başlatır; ikinci çağrı aynı görevi kullanır.</summary>
    /// <param name="filesDirectory">Uygulamanın özel klasörü (<c>Context.FilesDir</c>).</param>
    /// <param name="openTemplate">
    /// APK'daki şablon veritabanını (göç edilmiş + tohumlanmış) açar; yoksa <see langword="null"/>.
    /// Yalnız veritabanı dosyası YOKSA (ilk kurulum) kullanılır.
    /// </param>
    public static void Start(string filesDirectory, Func<Stream>? openTemplate = null)
    {
        lock (Sync)
        {
            if (startup is not null) return;
            string databasePath = Path.Combine(filesDirectory, "metraj.db");
            templateOpener = openTemplate;
            startedFilesDirectory = filesDirectory;
            // İki iş parçacığı: veritabanına dokunmayan altyapı ısındırması, şema
            // denetimi ve tohumlamayla üst üste biner.
            Task infrastructure = RunOnPriorityThread("metraj-isindirma", () => WarmInfrastructure(databasePath));
            startup = RunOnPriorityThread("metraj-hazirlik", () => PrepareAsync(filesDirectory, databasePath, infrastructure).GetAwaiter().GetResult());
        }
    }

    /// <summary>İşi yükseltilmiş öncelikli, ayrılmış bir iş parçacığında çalıştırır.</summary>
    /// <remarks>
    /// Hazırlık, WebView'ın kendi iş parçacıklarıyla (süreç içi GPU, işleyici
    /// süreci) aynı anda koşar. Emülatörde (4 çekirdek) varsayılan öncelikle
    /// ilk EF sorgusu, WebView'sız duruma göre ~1,7 kat uzuyordu; çekirdek
    /// t+6,9-9,4 s'de hazır oluyordu. "Display" önceliğiyle (UI iş parçacığının
    /// altında) t+5,6-5,9 s. SQLite çağrıları eşzamanlı olduğundan iş çoğunlukla
    /// bu iş parçacığında kalır; havuz iş parçacığının önceliği değiştirilmez.
    /// </remarks>
    private static Task<T> RunOnPriorityThread<T>(string name, Func<T> work)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            global::Android.OS.Process.SetThreadPriority(global::Android.OS.ThreadPriority.Display);
            try
            {
                completion.SetResult(work());
            }
            catch (Exception exception)
            {
                completion.SetException(exception);
            }
        })
        {
            IsBackground = true,
            Name = name
        };
        thread.Start();
        return completion.Task;
    }

    /// <summary>Eşzamansız bir işi normal öncelikli, ayrılmış bir iş parçacığında sonuna kadar çalıştırır.</summary>
    private static Task RunOnThread(string name, Func<Task> work)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                work().GetAwaiter().GetResult();
                completion.SetResult();
            }
            catch (Exception exception)
            {
                completion.SetException(exception);
            }
        })
        {
            IsBackground = true,
            Name = name
        };
        thread.Start();
        return completion.Task;
    }

    /// <summary>
    /// Veritabanı dosyasına dokunmadan EF Core'un iç servis sağlayıcısını ve
    /// derlenmiş modelini, System.Text.Json'ın da açılış yanıtlarının tür
    /// bilgisini kurar. Bağlam bağlantı açmaz; şema henüz güncel olmasa da güvenli.
    /// </summary>
    private static bool WarmInfrastructure(string databasePath)
    {
        try
        {
            using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                _ = context.Model;
            }

            MetrajLog.Mark("ısındırma: EF altyapısı hazır");
            JsonSerializerOptions options = MetrajRequestRouter.SerializerOptions;
            _ = JsonSerializer.Serialize(new List<ProjectListItem> { new(Guid.Empty, "-", "-", 0, Guid.Empty, DateTime.UnixEpoch) }, options);
            _ = JsonSerializer.Serialize(new List<UiStateItem> { new("-", "{}", DateTime.UnixEpoch) }, options);
            MetrajLog.Mark("ısındırma: JSON tür bilgisi hazır");
        }
        catch (Exception exception)
        {
            // Yalnız bir hız işi: başarısız olursa asıl hazırlık aynı maliyeti kendisi öder.
            MetrajLog.Warn($"Altyapı ısındırması atlandı: {exception.Message}");
        }

        return true;
    }

    /// <summary>Bütünlük denetimi; süreç başına bir kez çalışır, sonraki çağrılar aynı sonucu alır.</summary>
    public static Task<DatabaseIntegrityCheckResult> CheckIntegrityAsync()
    {
        lock (Sync)
        {
            return integrity ??= Task.Run(RunIntegrityCheckAsync);
        }
    }

    private static async Task<MetrajRuntime> PrepareAsync(string filesDirectory, string databasePath, Task infrastructure)
    {
        try
        {
            string backupDirectory = Path.Combine(filesDirectory, "backups");
            Directory.CreateDirectory(backupDirectory);
            MetrajLog.Mark("hazırlık başladı");

            // İlk kurulum: göç + 733 kartlık tohumlama yerine derlemede hazırlanmış şablon kopyalanır
            // (emülatörde 15-30 s'lik boş kabuk). Şablon yoksa ya da kopya başarısızsa eski yol
            // (göç + tohumlama) aynen çalışır; şablon da aynı kontrollerden geçer (şema güncel mi, damga).
            if (!File.Exists(databasePath)) CopyTemplateDatabase(databasePath);

            bool databaseExists = File.Exists(databasePath);
            bool upToDate = await ApplicationSchemaMigrator.IsUpToDateAsync(databasePath);
            MetrajLog.Mark(upToDate ? "şema güncel" : databaseExists ? "şema eski: göç gerekli" : "veritabanı yok: ilk kurulum");

            var services = MetrajServices.Create(databasePath, backupDirectory);
            if (!upToDate)
            {
                // Yedek yalnız şema gerçekten değişecekse ve elde veri varsa alınır
                // (masaüstüyle aynı kural: koşulsuz yedek açılışı uzatıp kotayı dolduruyordu).
                if (databaseExists)
                {
                    await services.DatabaseMaintenance.CreateBackupAsync(DatabaseBackupReason.BeforeMigration);
                    MetrajLog.Mark("göç öncesi yedek alındı");
                }

                await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
                {
                    await ApplicationSchemaMigrator.MigrateAsync(context);
                }

                MetrajLog.Mark("göç tamamlandı");
            }

            StarterCatalogSeedResult seed = await services.StarterCatalog.SeedAsync();
            MetrajLog.Mark($"standart katalog denetlendi ({seed.AddedCount} kart eklendi)");

            // Isındırma: EF Core'un ilk sorgu derlemesi burada ödenir (altyapı paralelde kuruldu).
            await infrastructure;
            IReadOnlyList<ProjectListItem> projects = await services.Projects.ListProjectsAsync();
            MetrajLog.Mark($"ısındırma: ilk EF sorgusu bitti ({projects.Count} proje)");

            // Isındırma router'ın kendisinden de geçer: emülatör ölçümünde arayüzün ilk
            // GET /api/projects isteği, EF ısındıktan SONRA bile 1,5-2,7 s sürüyordu
            // (rota eşleme, kapı ve System.Text.Json'ın yansımalı tür bilgisinin ilk
            // kurulumu). Arayüzün açılışta yaptığı iki istek burada bir kez çalıştırılır.
            var router = new MetrajRequestRouter(services, new LogcatLogger());
            if (projects.Count > 0)
            {
                // İkinci aşama, beklenmez: proje ağacının açılış istekleri ilk kullanımda
                // her biri ayrı bir EF sorgu derlemesi ödüyordu (emülatörde revizyonlar
                // 0,76 s, ölçümler 0,75 s, yerleşimler 2,0 s, özetler 2,1 s; ağaç t+7,5 s).
                // Derleme maliyeti sorgunun biçimine bağlı, kimliğe değil: en yeni projenin
                // son revizyonuyla paralel ısındırılır.
                _ = WarmProjectTreeAsync(router, projects[0]);
            }

            await WarmRouteAsync(router, "/api/projects");
            await WarmRouteAsync(router, "/api/ui-state");
            MetrajLog.Mark("çekirdek hazır");

            return new MetrajRuntime(services, router, databasePath);
        }
        catch (Exception exception)
        {
            MetrajLog.Error("Açılış hazırlığı başarısız oldu.", exception);
            throw;
        }
    }

    /// <summary>Şablonu geçici dosyaya kopyalayıp yeniden adlandırır; yarım kalan kopya asıl dosya olmaz.</summary>
    private static void CopyTemplateDatabase(string databasePath)
    {
        Func<Stream>? open = templateOpener;
        if (open is null) return;
        string partial = databasePath + ".kopya";
        try
        {
            long startedAt = MetrajLog.Elapsed;
            if (File.Exists(partial)) File.Delete(partial);
            using (Stream source = open())
            using (var target = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                source.CopyTo(target);
                target.Flush(flushToDisk: true);
            }

            File.Move(partial, databasePath);
            MetrajLog.Mark($"ilk kurulum: şablon veritabanı kopyalandı ({MetrajLog.Elapsed - startedAt} ms)");
        }
        catch (Exception exception)
        {
            // Kopya yalnız bir hız işi: başarısızsa boş veritabanına göç + tohumlama devralır.
            MetrajLog.Warn($"Şablon veritabanı kopyalanamadı, standart kurulum yapılacak: {exception.Message}");
            try
            {
                if (File.Exists(partial)) File.Delete(partial);
            }
            catch (IOException)
            {
                // Artık dosya bir sonraki kopyada silinir.
            }
        }
    }

    /// <summary>Proje ağacının açılış isteklerini iki ayrılmış iş parçacığında ısındırır; hata yalnız günlüğe yazılır.</summary>
    /// <remarks>
    /// İş parçacığı havuzu bilerek kullanılmaz: dört Task.Run 4 çekirdekli emülatörde
    /// havuzu doldurdu ve arayüzün kendi ilk isteği (GET /api/projects) sırada
    /// bekleyip 1,1 s gecikti. Ağır iki sorgu (yerleşimler, özetler) ayrı
    /// iş parçacıklarında, normal öncelikte.
    /// </remarks>
    private static async Task WarmProjectTreeAsync(MetrajRequestRouter router, ProjectListItem project)
    {
        try
        {
            string revision = $"/api/revisions/{project.LatestRevisionId}";
            await Task.WhenAll(
                RunOnThread("metraj-isindirma-agac1", async () =>
                {
                    await WarmRouteAsync(router, $"/api/projects/{project.Id}/revisions");
                    await WarmRouteAsync(router, $"{revision}/placements");
                }),
                RunOnThread("metraj-isindirma-agac2", async () =>
                {
                    await WarmRouteAsync(router, $"{revision}/measurements");
                    await WarmRouteAsync(router, $"{revision}/measurement-summaries");
                }));
            MetrajLog.Mark("ısındırma: proje ağacı hazır");
        }
        catch (Exception exception)
        {
            MetrajLog.Warn($"Proje ağacı ısındırması atlandı: {exception.Message}");
        }
    }

    /// <summary>Salt okunur bir GET'i router'dan geçirir; sonucu atılır.</summary>
    private static async Task WarmRouteAsync(MetrajRequestRouter router, string path)
    {
        RouterResponse response = await router.DispatchAsync(new RouterRequest("GET", path, null, null, null), CancellationToken.None);
        MetrajLog.Mark($"ısındırma: router GET {path} → {response.Status}");
    }

    private static async Task<DatabaseIntegrityCheckResult> RunIntegrityCheckAsync()
    {
        MetrajRuntime runtime = await Ready;
        DatabaseIntegrityCheckResult result = await runtime.Services.DatabaseMaintenance.CheckIntegrityAsync();
        if (result.IsHealthy)
        {
            MetrajLog.Mark("bütünlük denetimi: sağlıklı");
        }
        else
        {
            MetrajLog.Error($"Bütünlük denetimi sorun buldu: {result.Details}", exception: null);
        }

        return result;
    }
}
