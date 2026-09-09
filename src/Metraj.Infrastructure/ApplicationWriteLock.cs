using System.Collections.Concurrent;

namespace Metraj.Infrastructure;

/// <summary>Process-wide single-writer guard for one user's local application database.</summary>
public sealed class ApplicationWriteLock : IDisposable
{
    // Adlandırılmış mutex SÜREÇLER arasında koruma sağlar, ama aynı iş
    // parçacığında yeniden girişe (reentrancy) izin verir. Bu küme, aynı süreç
    // içindeki ikinci bir edinme denemesinin de reddedilmesini sağlar.
    private static readonly ConcurrentDictionary<string, byte> HeldIdentities = new(StringComparer.Ordinal);

    private readonly Mutex? mutex;
    private readonly string identity;
    private bool ownsMutex;

    private ApplicationWriteLock(Mutex? mutex, string identity, bool ownsMutex)
    {
        this.mutex = mutex;
        this.identity = identity;
        this.ownsMutex = ownsMutex;
    }

    /// <summary>Attempts to reserve the database for one desktop application instance.</summary>
    /// <remarks>
    /// "Oluşturuldu" ile "sahiplenildi" aynı şey değildir. Önceki sürüm
    /// <c>createdNew</c> bayrağına bakıyordu: adlandırılmış mutex'i oluşturan
    /// süreç çökmüşse ve mutex hâlâ ayaktaysa bu bayrak kalıcı olarak false
    /// kalıyor, kullanıcı "Proje Metraj zaten açık" mesajını görüp uygulamayı
    /// bir daha hiç açamıyordu. Sahiplik artık açıkça beklenerek alınır ve
    /// sahipsiz kalmış (abandoned) bir mutex de devralınır.
    /// </remarks>
    public static ApplicationWriteLock TryAcquire(string applicationIdentity)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(applicationIdentity);

        // Bu süreçte zaten tutuluyorsa ikinci bir sahiplik verilmez.
        if (!HeldIdentities.TryAdd(applicationIdentity, 0))
        {
            return new ApplicationWriteLock(mutex: null, applicationIdentity, ownsMutex: false);
        }

        var mutex = new Mutex(initiallyOwned: false, $@"Local\{applicationIdentity}");
        bool acquired;
        try
        {
            acquired = mutex.WaitOne(TimeSpan.Zero, exitContext: false);
        }
        catch (AbandonedMutexException)
        {
            // Önceki sahibi kilidi bırakmadan sonlandı; sahiplik bize geçti.
            acquired = true;
        }

        if (!acquired)
        {
            HeldIdentities.TryRemove(applicationIdentity, out _);
            mutex.Dispose();
            return new ApplicationWriteLock(mutex: null, applicationIdentity, ownsMutex: false);
        }

        return new ApplicationWriteLock(mutex, applicationIdentity, ownsMutex: true);
    }

    /// <summary>True when this process owns the single-writer reservation.</summary>
    public bool IsAcquired => ownsMutex;

    /// <inheritdoc />
    public void Dispose()
    {
        if (ownsMutex)
        {
            try
            {
                mutex?.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                // Mutex iş parçacığına bağlıdır; farklı bir iş parçacığından
                // bırakma denemesi kapanışı engellememelidir.
            }

            HeldIdentities.TryRemove(identity, out _);
            ownsMutex = false;
        }

        mutex?.Dispose();
    }
}
