using Metraj.Host;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Köprü zaman aşımında çift kayıt (son kod incelemesi, bulgu 3): JS zaman
/// aşımına uğrayan mutasyonu aynı anahtarla yeniden denediğinde yerel taraf
/// işi ikinci kez yapmamalı.
/// </summary>
public sealed class IdempotentRequestCacheTests
{
    private static readonly RouterRequest SaveMeasurement =
        new("POST", "/api/revisions/r1/measurements/batch", "[{\"quantity\":2.5}]", null, "application/json");

    private static RouterResponse Ok(string body) => new(200, "application/json; charset=utf-8", body, null);

    [Fact]
    public async Task RetryWhileTheFirstRequestIsStillRunningJoinsItInsteadOfWritingAgain()
    {
        var cache = new IdempotentRequestCache();
        var release = new TaskCompletionSource<RouterResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        int executions = 0;
        Func<Task<RouterResponse>> execute = () =>
        {
            Interlocked.Increment(ref executions);
            return release.Task;
        };

        Task<RouterResponse> first = cache.RunAsync("k1", SaveMeasurement, execute, out bool firstReplayed);
        Task<RouterResponse> retry = cache.RunAsync("k1", SaveMeasurement, execute, out bool retryReplayed);
        Assert.False(firstReplayed);
        Assert.True(retryReplayed);
        Assert.False(retry.IsCompleted);

        release.SetResult(Ok("[{\"id\":\"m1\"}]"));
        Assert.Equal("[{\"id\":\"m1\"}]", (await first).BodyJson);
        Assert.Equal("[{\"id\":\"m1\"}]", (await retry).BodyJson);
        Assert.Equal(1, executions);
    }

    [Fact]
    public async Task CompletedSuccessIsReplayedUntilTheRetentionExpires()
    {
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 18, 10, 0, 0, TimeSpan.Zero));
        var cache = new IdempotentRequestCache(clock, TimeSpan.FromMinutes(15));
        int executions = 0;
        Func<Task<RouterResponse>> execute = () => Task.FromResult(Ok($"{Interlocked.Increment(ref executions)}"));

        Assert.Equal("1", (await cache.RunAsync("k1", SaveMeasurement, execute, out _)).BodyJson);
        clock.Advance(TimeSpan.FromMinutes(14));
        Assert.Equal("1", (await cache.RunAsync("k1", SaveMeasurement, execute, out bool replayed)).BodyJson);
        Assert.True(replayed);
        Assert.Equal(1, executions);

        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.Equal(0, cache.Count);
        Assert.Equal("2", (await cache.RunAsync("k1", SaveMeasurement, execute, out _)).BodyJson);
    }

    [Fact]
    public async Task FailedOrThrowingWorkIsNotCachedSoTheRetryRunsAgain()
    {
        var cache = new IdempotentRequestCache();
        int executions = 0;

        Func<Task<RouterResponse>> failing = () =>
        {
            Interlocked.Increment(ref executions);
            return Task.FromResult(new RouterResponse(500, "application/json; charset=utf-8", "{}", null));
        };
        Assert.Equal(500, (await cache.RunAsync("k1", SaveMeasurement, failing, out _)).Status);
        Assert.Equal(500, (await cache.RunAsync("k1", SaveMeasurement, failing, out bool replayed)).Status);
        Assert.False(replayed);
        Assert.Equal(2, executions);

        Func<Task<RouterResponse>> throwing = () => throw new IOException("disk");
        await Assert.ThrowsAsync<IOException>(() => cache.RunAsync("k2", SaveMeasurement, throwing, out _));
        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public async Task TheSameKeyOnAnotherEndpointIsADifferentOperation()
    {
        var cache = new IdempotentRequestCache();
        int executions = 0;
        Func<Task<RouterResponse>> execute = () => Task.FromResult(Ok($"{Interlocked.Increment(ref executions)}"));
        var other = SaveMeasurement with { PathAndQuery = "/api/revisions/r2/measurements/batch" };

        await cache.RunAsync("k1", SaveMeasurement, execute, out _);
        await cache.RunAsync("k1", other, execute, out bool replayed);
        Assert.False(replayed);
        Assert.Equal(2, executions);
    }

    private sealed class ManualTimeProvider(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset now = start;

        public override DateTimeOffset GetUtcNow() => now;

        public void Advance(TimeSpan by) => now += by;
    }
}
