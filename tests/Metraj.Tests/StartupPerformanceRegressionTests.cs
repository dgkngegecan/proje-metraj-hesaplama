using System.Diagnostics;
using Metraj.Application;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Sıcak açılış: veritabanı zaten güncel ve standart paket zaten yüklü. Bu durumda
/// şema denetimi ve tohumlama hiçbir iş yapmaz; süreleri de ihmal edilebilir olmalı.
/// </summary>
/// <remarks>
/// Android'de tam AOT ile ölçülen hâl: şema denetimi 2,7 s (yalnız iki ham sorgu
/// için EF Core başlatılıyordu), tohumlama 1,1 s (733 kartlık manifest kuruluyor ve
/// aktif katalog sürümleriyle okunuyordu). Masaüstünde soğuk süreçte 0,9 s + 0,7 s.
/// </remarks>
public sealed class StartupPerformanceRegressionTests
{
    private readonly Xunit.Abstractions.ITestOutputHelper output;

    /// <param name="output">Ölçülen süreyi teste iliştirir.</param>
    public StartupPerformanceRegressionTests(Xunit.Abstractions.ITestOutputHelper output) => this.output = output;

    [Fact]
    public async Task WarmStartupSchemaCheckAndSeedShortcutStayWithinBudget()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-startup-performance");
        StarterCatalogSeedResult installed = await new StarterCatalogWorkspaceService(database.Path).SeedAsync();
        // Yeni bir açılışı taklit et: havuzdaki bağlantılar kapanır.
        TestDatabase.ClearPoolFor(database.Path);

        int contexts = 0;
        var starter = new StarterCatalogWorkspaceService(() =>
        {
            Interlocked.Increment(ref contexts);
            return MetrajDbContextFactory.Create(database.Path);
        }, database.Path);

        var timer = Stopwatch.StartNew();
        bool upToDate = await ApplicationSchemaMigrator.IsUpToDateAsync(database.Path);
        TimeSpan schema = timer.Elapsed;
        StarterCatalogSeedResult seed = await starter.SeedAsync();
        timer.Stop();
        TimeSpan seeding = timer.Elapsed - schema;

        Assert.True(upToDate);
        Assert.Equal((0, installed.AddedCount), (seed.AddedCount, seed.ExistingCount));
        output.WriteLine($"Sıcak açılış: şema denetimi {schema.TotalMilliseconds:N1} ms, tohumlama kısa yolu {seeding.TotalMilliseconds:N1} ms");

        // Asıl gerileme koruması yapısaldır ve makineden bağımsızdır: kısa yol hiçbir
        // EF Core bağlamı açmaz (dolayısıyla EF'in ilk kurulumunu, model kurulumunu ve
        // katalog okumasını tetiklemez). Biri kısa yolu bozarsa burası kırılır.
        Assert.Equal(0, contexts);

        // Duvar saati eşiği felaket korumasıdır, ölçüt değil (bkz. PerformanceRegressionTests):
        // meşgul bir CI ajanında rastgele kırmızıya dönmesin diye büyüklük sırası düzeyinde.
        // Ölçülen tipik değer onda biri bile değildir; eğilim çıktı satırından izlenir.
        Assert.True(timer.Elapsed < TimeSpan.FromSeconds(2),
            $"Sıcak açılışta şema denetimi + tohumlama {timer.Elapsed.TotalMilliseconds:N0} ms sürdü; " +
            "bu bir büyüklük sırası gerilemesine işaret ediyor.");
    }
}
