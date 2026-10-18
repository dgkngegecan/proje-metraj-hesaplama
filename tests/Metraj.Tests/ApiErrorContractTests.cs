using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Metraj.Api;
using Metraj.Application;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Hata sözleşmesi: kullanıcının düzeltebileceği durumlar 400 ve Türkçe mesajla,
/// sunucu arızaları 500 ve genel mesajla döner. Kural kodu her zaman taşınır.
/// </summary>
public sealed class ApiErrorContractTests
{
    [Fact]
    public async Task DomainRuleViolationsReturn400WithTurkishMessageAndStableRuleCode()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        // Boş proje kodu bir alan kuralı ihlalidir.
        var response = await client.PostAsJsonAsync("api/projects", new
        {
            code = "   ",
            name = "Geçersiz proje",
            description = (string?)null
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        string message = body.RootElement.GetProperty("message").GetString()!;
        string rule = body.RootElement.GetProperty("rule").GetString()!;

        Assert.Equal("project.code", rule);
        Assert.Equal(DomainMessageCatalog.Resolve("project.code"), message);
        // Kullanıcıya İngilizce çekirdek mesaj gitmemeli.
        Assert.DoesNotContain("must contain", message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task EveryKnownRuleResolvesToATurkishMessage()
    {
        // Katalogda olmayan bir kural bile anlaşılır Türkçe bir metin üretmeli.
        Assert.Equal("Bu revizyon onaylı; değiştirilemez. Değişiklik için yeni revizyon açın.",
            DomainMessageCatalog.Resolve("revision.read-only"));
        // Kural kodu kullanıcı metnine girmez; teşhis için API yanıtının "rule" alanında kalır.
        Assert.Equal("Giriş kaydedilemedi. Tekrar deneyin.",
            DomainMessageCatalog.Resolve("measurement.bilinmeyen-kural"));
        Assert.Equal("İşlem tamamlanamadı. Tekrar deneyin.", DomainMessageCatalog.Resolve(""));

        // Türkçe olmayan (ASCII) bir mesaj kalmamalı: her katalog girdisi kullanıcıya gider.
        foreach (string rule in new[]
        {
            "measurement.behavior", "measurement.derived", "measurement.unit",
            "revision.stale-calculations", "backup.not-metraj", "calculation.source-unit",
            "tree.card-type", "catalog.code-unique"
        })
        {
            string message = DomainMessageCatalog.Resolve(rule);
            Assert.DoesNotContain($"({rule})", message, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(message));
        }
    }

    [Fact]
    public async Task UnknownRoutesUnderApiStillReturn404RatherThanAGenericFault()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        HttpResponseMessage response = await client.GetAsync("api/boyle-bir-uc-nokta-yok");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
