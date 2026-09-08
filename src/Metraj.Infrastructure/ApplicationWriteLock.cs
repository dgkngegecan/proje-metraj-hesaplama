namespace Metraj.Infrastructure;

/// <summary>Process-wide single-writer guard for one user's local application database.</summary>
public sealed class ApplicationWriteLock : IDisposable
{
    private readonly Mutex mutex;
    private bool ownsMutex;

    private ApplicationWriteLock(Mutex mutex, bool ownsMutex)
    {
        this.mutex = mutex;
        this.ownsMutex = ownsMutex;
    }

    /// <summary>Attempts to reserve the database for one desktop application instance.</summary>
    public static ApplicationWriteLock TryAcquire(string applicationIdentity)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(applicationIdentity);
        var mutex = new Mutex(initiallyOwned: true, $"Local\\{applicationIdentity}", out bool createdNew);
        return new ApplicationWriteLock(mutex, createdNew);
    }

    /// <summary>True when this process owns the single-writer reservation.</summary>
    public bool IsAcquired => ownsMutex;

    /// <inheritdoc />
    public void Dispose()
    {
        if (ownsMutex)
        {
            mutex.ReleaseMutex();
            ownsMutex = false;
        }

        mutex.Dispose();
    }
}
