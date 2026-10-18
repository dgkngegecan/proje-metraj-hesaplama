namespace Metraj.Host;

/// <summary>Aynı idempotency anahtarıyla gelen isteği ikinci kez işlemez.</summary>
/// <remarks>
/// Android köprüsünde JS bir mutasyonu 60 sn sonra "zaman aşımı" sayar, ama
/// yerel taraf isteği işlemeyi sürdürür ve veritabanına yazabilir. Kullanıcı
/// "tekrar dene" dediğinde aynı ölçüm iki kez giriliyordu. JS, zaman aşımına
/// uğrayan isteğin anahtarını aynı istek yeniden denendiğinde tekrar gönderir
/// (src/Metraj.Web/src/lib/retryKeys.ts); burada:
/// <list type="bullet">
/// <item>ilk istek hâlâ sürüyorsa yeniden deneme AYNI işin sonucunu bekler,</item>
/// <item>ilk istek başarıyla bittiyse sonucu <see cref="DefaultRetention"/> boyunca saklanır ve yeniden döner,</item>
/// <item>başarısız biten (2xx dışı) ya da dosya üreten iş saklanmaz: yeniden deneme işi baştan yapar.</item>
/// </list>
/// Anahtar yöntem ve yolla birlikte eşlenir: aynı anahtar başka bir uca gelirse ayrı işlemdir.
/// Bellek içidir; süreç ölürse yarım kalan yazma zaten veritabanı işlemiyle geri alınmıştır.
/// </remarks>
public sealed class IdempotentRequestCache
{
    /// <summary>Biten işin sonucunun saklandığı süre; JS'in anahtarı hatırladığı süreden (10 dk) uzun.</summary>
    public static readonly TimeSpan DefaultRetention = TimeSpan.FromMinutes(15);

    private readonly object sync = new();
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private readonly TimeProvider time;
    private readonly TimeSpan retention;

    public IdempotentRequestCache(TimeProvider? time = null, TimeSpan? retention = null)
    {
        this.time = time ?? TimeProvider.System;
        this.retention = retention ?? DefaultRetention;
    }

    /// <summary>Saklanan ve süren iş sayısı (süresi dolanlar düşüldükten sonra).</summary>
    public int Count
    {
        get
        {
            lock (sync)
            {
                Prune();
                return entries.Count;
            }
        }
    }

    /// <summary>İsteği bir kez çalıştırır; aynı anahtarlı tekrarlar ilk işin sonucunu alır.</summary>
    /// <param name="idempotencyKey">JS'in istek başına ürettiği anahtar.</param>
    /// <param name="request">Anahtarın eşlendiği yöntem ve yol buradan okunur.</param>
    /// <param name="execute">İşin kendisi; tekrarda çağrılmaz.</param>
    /// <param name="replayed">Bu çağrı önceki bir işe mi bağlandı?</param>
    public Task<RouterResponse> RunAsync(
        string idempotencyKey, RouterRequest request, Func<Task<RouterResponse>> execute, out bool replayed)
    {
        ArgumentException.ThrowIfNullOrEmpty(idempotencyKey);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(execute);
        string key = $"{request.Method.ToUpperInvariant()} {request.PathAndQuery}\n{idempotencyKey}";
        TaskCompletionSource<RouterResponse> completion;
        lock (sync)
        {
            Prune();
            if (entries.TryGetValue(key, out Entry? existing))
            {
                replayed = true;
                return existing.Response;
            }

            // Kayıt işten ÖNCE girer: iş eşzamanlı biterse de tekrarlar onu bulur.
            completion = new TaskCompletionSource<RouterResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            entries[key] = new Entry(completion.Task);
        }

        replayed = false;
        _ = CompleteAsync(key, completion, execute);
        return completion.Task;
    }

    private async Task CompleteAsync(string key, TaskCompletionSource<RouterResponse> completion, Func<Task<RouterResponse>> execute)
    {
        RouterResponse response;
        try
        {
            response = await execute().ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            Forget(key);
            completion.SetException(exception);
            return;
        }

        lock (sync)
        {
            if (response.Status is >= 200 and <= 299 && response.File is null)
            {
                entries[key].CompletedAt = time.GetUtcNow();
            }
            else
            {
                entries.Remove(key);
            }
        }

        completion.SetResult(response);
    }

    private void Forget(string key)
    {
        lock (sync)
        {
            entries.Remove(key);
        }
    }

    /// <summary>Kilit altında çağrılır. Süren işler düşürülmez.</summary>
    private void Prune()
    {
        DateTimeOffset threshold = time.GetUtcNow() - retention;
        List<string>? expired = null;
        foreach ((string key, Entry entry) in entries)
        {
            if (entry.CompletedAt is DateTimeOffset completedAt && completedAt < threshold)
            {
                (expired ??= []).Add(key);
            }
        }

        if (expired is null) return;
        foreach (string key in expired)
        {
            entries.Remove(key);
        }
    }

    private sealed class Entry(Task<RouterResponse> response)
    {
        public Task<RouterResponse> Response { get; } = response;

        public DateTimeOffset? CompletedAt { get; set; }
    }
}
