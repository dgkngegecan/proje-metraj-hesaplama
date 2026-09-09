using System.Text.RegularExpressions;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Arayüzdeki yedek çap/çeşit listeleri ile başlangıç kataloğundakiler aynı
/// kalmalıdır.
/// </summary>
/// <remarks>
/// Aynı referans veri iki dilde ayrı ayrı yazılı: <c>App.tsx</c> içinde
/// <c>STEEL_DIAMETERS</c> / <c>PPRC_DIAMETERS</c> / <c>FITTING_PRESETS</c>,
/// <c>StarterCatalogWorkspaceService</c> içinde <c>SteelPipeVariants</c> /
/// <c>PprcPipeVariants</c> / <c>FittingVariants</c>.
///
/// Arayüzü API'den beslemek daha temiz olurdu, ama bu listeler kartın kendi
/// varyantı tanımlı olmadığında kullanılan YEDEK değerler; API'ye bağlamak
/// yükleme sırasını ve çevrimdışı davranışı değiştirir. Bunun yerine ikisi
/// burada birbirine kilitleniyor: biri değişip öteki değişmezse test kırılır
/// ve kullanıcı iki farklı çap listesi görmez.
/// </remarks>
public sealed class ReferenceDataParityTests
{
    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Metraj.sln")))
        {
            directory = directory.Parent;
        }

        Assert.True(directory is not null, "Depo kökü bulunamadı (Metraj.sln aranıyordu).");
        return directory!.FullName;
    }

    private static string ReadSource(params string[] relativeParts)
    {
        string path = Path.Combine([RepositoryRoot(), .. relativeParts]);
        Assert.True(File.Exists(path), $"Kaynak dosya bulunamadı: {path}");
        return File.ReadAllText(path);
    }

    private static string[] CodesBetween(string source, string startMarker, string endMarker)
    {
        int start = source.IndexOf(startMarker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"'{startMarker}' kaynakta bulunamadı; sabit yeniden adlandırılmış olabilir.");
        int end = source.IndexOf(endMarker, start, StringComparison.Ordinal);
        Assert.True(end > start, $"'{endMarker}' '{startMarker}' sonrasında bulunamadı.");

        return Regex.Matches(source[start..end], @"['""](DN\d+)['""]")
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    [Theory]
    [InlineData("STEEL_DIAMETERS", "PPRC_DIAMETERS", "SteelPipeVariants", "PprcPipeVariants")]
    [InlineData("PPRC_DIAMETERS", "FITTING_PRESETS", "PprcPipeVariants", "FittingVariants")]
    public void FrontendFallbackDiametersMatchTheStarterCatalog(
        string frontendStart, string frontendEnd, string backendStart, string backendEnd)
    {
        string frontend = ReadSource("src", "Metraj.Web", "src", "App.tsx");
        string backend = ReadSource("src", "Metraj.Infrastructure", "StarterCatalogWorkspaceService.cs");

        string[] fromUi = CodesBetween(frontend, $"const {frontendStart}", $"const {frontendEnd}");
        string[] fromCatalog = CodesBetween(backend, backendStart, backendEnd);

        Assert.NotEmpty(fromUi);
        Assert.Equal(fromCatalog, fromUi);
    }
}
