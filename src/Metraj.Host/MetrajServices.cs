using Metraj.Application;
using Metraj.Infrastructure;

namespace Metraj.Host;

/// <summary>Router'ın kullandığı servislerin tamamı; DI kapsayıcısı olmadan kurulur.</summary>
/// <remarks>
/// Önceden bu kayıtlar LocalApiHost'ta <c>IServiceCollection</c> üzerinden
/// yapılıyordu ve uç noktalar servisleri DI'dan alıyordu. Android kabuğunun
/// aynı kurulumu ASP.NET Core'un DI'ı olmadan yapabilmesi için kurulum tek bir
/// fabrikaya (<see cref="Create"/>) taşındı; iki platform aynı metodu çağırır.
/// Bütün servisler tekil (singleton) ve iş parçacığı güvenlidir: her çağrı kendi
/// kısa ömürlü <see cref="MetrajDbContext"/>'ini açar.
/// </remarks>
public sealed class MetrajServices : IDisposable
{
    private const string SyntheticCleanWaterResource = "Metraj.Host.SampleData.CleanWaterSynthetic.csv";

    /// <summary>SQLite veritabanının tam yolu; <c>/api/health</c> klasörünü bildirir. Boşsa bildirilmez.</summary>
    public string DatabasePath { get; init; } = string.Empty;

    /// <summary>Bakım (geri yükleme, proje temizleme, içe aktarma) ile sıradan istekler arasındaki sınır.</summary>
    public required ApplicationDatabaseGate DatabaseGate { get; init; }

    /// <summary>Projeler ve revizyonlar.</summary>
    public required IProjectWorkspace Projects { get; init; }

    /// <summary>Kart kütüphanesi.</summary>
    public required ICatalogWorkspace Catalog { get; init; }

    /// <summary>Kullanıcı tanımlı kart türleri.</summary>
    public required ICatalogCardTypeWorkspace CatalogCardTypes { get; init; }

    /// <summary>Standart kart paketi.</summary>
    public required IStarterCatalogWorkspace StarterCatalog { get; init; }

    /// <summary>Proje ağacı ve hesap bağları.</summary>
    public required IProjectTreeWorkspace ProjectTree { get; init; }

    /// <summary>Yerleşimlere bağlı kat/mahal notları.</summary>
    public required IPlacementContextNoteWorkspace PlacementContextNotes { get; init; }

    /// <summary>Sorumluluk boyutları, tarafları ve atamaları.</summary>
    public required IResponsibilityWorkspace Responsibilities { get; init; }

    /// <summary>Metraj satırları.</summary>
    public required IMeasurementWorkspace Measurements { get; init; }

    /// <summary>Hesap kuralları ve sonuçları.</summary>
    public required ICalculationWorkspace Calculations { get; init; }

    /// <summary>Rapor verisi ve dışa aktarımlar.</summary>
    public required IProjectReportWorkspace Reports { get; init; }

    /// <summary>Merkezi malzeme fire ayarları.</summary>
    public required IMaterialTypeWasteWorkspace MaterialTypeWaste { get; init; }

    /// <summary>Arayüzün kalıcı taslakları ve tercihleri.</summary>
    public required IUiStateWorkspace UiState { get; init; }

    /// <summary>Tek dosyalık çalışma alanı dışa/içe aktarma.</summary>
    public required IWorkspaceTransfer WorkspaceTransfer { get; init; }

    /// <summary>Yedekleme, geri yükleme, bütünlük ve proje temizleme.</summary>
    public required IDatabaseMaintenanceWorkspace DatabaseMaintenance { get; init; }

    /// <summary>Sentetik örnek veri içe aktarımı.</summary>
    public required ISyntheticCleanWaterWorkspace SyntheticCleanWater { get; init; }

    /// <summary>Tek uygulama veritabanı için servislerin tamamını kurar.</summary>
    /// <remarks>
    /// Masaüstündeki eski <c>RegisterWorkspaceServices</c>'in birebir karşılığı:
    /// aynı somut sınıflar, aynı bağlam fabrikası ve aynı kapı örneği. Tek fark
    /// <see cref="StarterCatalogWorkspaceService"/>'in veritabanı yoluyla kurulmasıdır:
    /// standart paket değişmemişse açılış denetimi ve "Eksik standartları tamamla"
    /// EF Core'u hiç başlatmadan döner (davranış aynı, yalnız hız farklı).
    /// </remarks>
    /// <param name="databasePath">SQLite veritabanının tam yolu.</param>
    /// <param name="backupDirectory">
    /// Yedek klasörü. <see langword="null"/> ise veritabanının yanındaki "backups"
    /// (masaüstünün bugünkü davranışı); Android kendi uygulama klasörünü verebilir.
    /// </param>
    public static MetrajServices Create(string databasePath, string? backupDirectory = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        var gate = new ApplicationDatabaseGate();
        Func<MetrajDbContext> contextFactory = () => MetrajDbContextFactory.Create(databasePath);
        return new MetrajServices
        {
            DatabasePath = databasePath,
            DatabaseGate = gate,
            Projects = new ProjectWorkspaceService(contextFactory),
            Catalog = new CatalogWorkspaceService(contextFactory),
            CatalogCardTypes = new CatalogCardTypeWorkspaceService(contextFactory),
            StarterCatalog = new StarterCatalogWorkspaceService(databasePath),
            ProjectTree = new ProjectTreeWorkspaceService(contextFactory),
            PlacementContextNotes = new PlacementContextNoteWorkspaceService(contextFactory),
            Responsibilities = new ResponsibilityWorkspaceService(contextFactory),
            Measurements = new MeasurementWorkspaceService(contextFactory),
            Calculations = new CalculationWorkspaceService(contextFactory),
            Reports = new ProjectReportWorkspaceService(contextFactory),
            MaterialTypeWaste = new MaterialTypeWasteWorkspaceService(contextFactory),
            UiState = new UiStateWorkspaceService(contextFactory),
            WorkspaceTransfer = new WorkspaceTransferService(() => databasePath, gate),
            DatabaseMaintenance = new DatabaseMaintenanceWorkspaceService(() => databasePath, backupDirectory, gate),
            SyntheticCleanWater = new SyntheticCleanWaterWorkspaceService(contextFactory, OpenSyntheticCleanWaterFixture)
        };
    }

    /// <summary>Kapıyı bırakır. Servisler veritabanı bağlantısı tutmaz.</summary>
    public void Dispose() => DatabaseGate.Dispose();

    private static Stream OpenSyntheticCleanWaterFixture() =>
        typeof(MetrajServices).Assembly.GetManifestResourceStream(SyntheticCleanWaterResource)
            ?? throw new InvalidDataException("Uygulamaya gömülü sentetik Temiz Su örnek verisi bulunamadı.");
}
