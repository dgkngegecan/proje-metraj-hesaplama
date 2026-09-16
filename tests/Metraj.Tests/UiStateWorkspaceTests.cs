using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Metraj.Api;
using Metraj.Application;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Yarım kalmış girişler ve tercihler uygulamanın yeniden başlatılmasından
/// sağ çıkmalıdır. localStorage bunu yapamaz: yerel API her açılışta farklı bir
/// loopback portu dinler, origin değişir ve tarayıcı deposu boş gelir.
/// </summary>
public sealed class UiStateWorkspaceTests
{
    [Fact]
    public async Task ConcurrentDraftAndPreferenceWritesPreserveEveryKey()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var workspace = new UiStateWorkspaceService(database.ContextFactory);
        await Task.WhenAll(Enumerable.Range(0, 24).Select(index => Task.Run(async () =>
        {
            string key = $"radiator-draft.v1.{index}";
            await workspace.SetAsync(key, "{\"count\":1}");
            await workspace.SetAsync(key, "{\"count\":2}");
        })));
        IReadOnlyList<UiStateItem> states = await workspace.ListAsync();
        Assert.Equal(24, states.Count);
        Assert.All(states, state => Assert.Equal("{\"count\":2}", state.ValueJson));
    }

    [Fact]
    public async Task PendingDraftsSurviveAnApplicationRestartOnADifferentPort()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        const string key = "fitting-draft.v1.11111111-1111-1111-1111-111111111111";
        const string value = """[{"id":"a","diameter":"DN25","countsByDiameter":{"DN25":{"ELBOW-90":3}}}]""";

        // Birinci oturum: kullanıcı yarım bir fitting sayımı bırakır.
        Uri firstUri;
        await using (LocalApiHost first = await LocalApiHost.StartAsync(database.Path))
        {
            firstUri = first.BaseUri;
            using var client = new HttpClient { BaseAddress = first.BaseUri };
            HttpResponseMessage saved = await client.PutAsJsonAsync("api/ui-state", new { key, valueJson = value });
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        }

        // İkinci oturum: işletim sistemi başka bir port seçer, yani origin değişir.
        await using LocalApiHost second = await LocalApiHost.StartAsync(database.Path);
        Assert.NotEqual(firstUri.Port, second.BaseUri.Port);

        using var secondClient = new HttpClient { BaseAddress = second.BaseUri };
        using var body = JsonDocument.Parse(await secondClient.GetStringAsync("api/ui-state"));
        JsonElement entry = Assert.Single(body.RootElement.EnumerateArray(), item => item.GetProperty("key").GetString() == key);
        Assert.Equal(value, entry.GetProperty("valueJson").GetString());
    }

    [Fact]
    public async Task SavedDraftsCanBeClearedOnceTheMeasurementsArePersisted()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var workspace = new UiStateWorkspaceService(database.ContextFactory);

        await workspace.SetAsync("fitting-draft.v1.abc", "[1]");
        await workspace.SetAsync("sidebar-collapsed", "1");
        Assert.Equal(2, (await workspace.ListAsync()).Count);

        // Aynı anahtara ikinci yazma yeni satır açmaz, günceller.
        await workspace.SetAsync("fitting-draft.v1.abc", "[2]");
        UiStateItem draft = Assert.Single(await workspace.ListAsync(), item => item.Key == "fitting-draft.v1.abc");
        Assert.Equal("[2]", draft.ValueJson);

        await workspace.DeleteAsync("fitting-draft.v1.abc");
        UiStateItem remaining = Assert.Single(await workspace.ListAsync());
        Assert.Equal("sidebar-collapsed", remaining.Key);
    }
}
