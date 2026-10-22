using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Derlenmiş modelin Android'de (Mono) kilitlenmeden başlatıldığını koruyan testler.
/// </summary>
/// <remarks>
/// EF Core'un ürettiği model, varsayılan olarak ayrı bir iş parçacığında kurulup
/// beklenir; Mono'da bu bir statik başlatıcı kilitlenmesine yol açtı (emülatörde
/// göç adımı %0 işlemciyle asılı kaldı). Anahtar fabrikanın statik kurucusunda
/// açılır; bu test anahtarın sessizce kaybolmasını yakalar.
/// </remarks>
public sealed class CompiledModelInitializationTests
{
    [Fact]
    public async Task FactoryEnablesSameThreadCompiledModelInitializationBeforeFirstUse()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-compiled-model-init");
        await using MetrajDbContext context = MetrajDbContextFactory.Create(database.Path);

        Assert.True(AppContext.TryGetSwitch("Microsoft.EntityFrameworkCore.Issue31751", out bool enabled));
        Assert.True(enabled);
        Assert.NotNull(context.Model.FindEntityType(typeof(Project)));
    }
}
