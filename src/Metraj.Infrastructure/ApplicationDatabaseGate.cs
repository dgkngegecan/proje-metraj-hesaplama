namespace Metraj.Infrastructure;

/// <summary>
/// Sıradan veritabanı işlemleri ile bakım işlemleri (geri yükleme) arasında
/// bir sınır kurar.
/// </summary>
/// <remarks>
/// Geri yükleme; bağlantı havuzlarını temizler, veritabanı dosyasının üzerine
/// yazar ve WAL/SHM dosyalarını siler. Bu sırada Kestrel istekleri sunmaya
/// devam ediyordu: masaüstü mutex'i yalnızca İKİNCİ BİR UYGULAMA ÖRNEĞİNİ
/// engeller, aynı süreç içindeki eşzamanlı istekleri değil.
///
/// Sıradan işlemler paylaşımlı, bakım işlemi dışlayıcı olarak girer. Bakım,
/// devam eden bütün işlemler bitene kadar bekler ve süresince yenilerini durdurur.
/// </remarks>
public sealed class ApplicationDatabaseGate : IDisposable
{
    // Aynı anda yürüyebilecek sıradan işlem sayısı. Tek kullanıcılı bir masaüstü
    // uygulamasında WebView en fazla bir avuç paralel istek açar; bu sınır
    // yalnızca bakımın hepsini toplayabilmesi için gerekli.
    private const int ConcurrentOperationLimit = 64;

    private readonly SemaphoreSlim slots = new(ConcurrentOperationLimit, ConcurrentOperationLimit);

    /// <summary>Sıradan bir okuma/yazma işlemi için paylaşımlı giriş.</summary>
    public async Task<IAsyncDisposable> EnterOperationAsync(CancellationToken cancellationToken = default)
    {
        await slots.WaitAsync(cancellationToken);
        return new Releaser(slots, 1);
    }

    /// <summary>
    /// Bakım için dışlayıcı giriş: devam eden işlemler biter, yenileri bekler.
    /// </summary>
    public async Task<IAsyncDisposable> EnterMaintenanceAsync(CancellationToken cancellationToken = default)
    {
        int acquired = 0;
        try
        {
            for (; acquired < ConcurrentOperationLimit; acquired++)
            {
                await slots.WaitAsync(cancellationToken);
            }
        }
        catch
        {
            // Kısmen alınmış yuvalar bırakılmazsa uygulama kilitlenir.
            if (acquired > 0) slots.Release(acquired);
            throw;
        }

        return new Releaser(slots, ConcurrentOperationLimit);
    }

    /// <inheritdoc />
    public void Dispose() => slots.Dispose();

    private sealed class Releaser(SemaphoreSlim slots, int count) : IAsyncDisposable
    {
        private int released;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref released, 1) == 0)
            {
                slots.Release(count);
            }

            return ValueTask.CompletedTask;
        }
    }
}
