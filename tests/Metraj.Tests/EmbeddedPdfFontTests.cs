using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using PdfSharp.Fonts;
using System.Text;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// PDF raporu Windows sistem fontlarına bağlı olmamalı: önceden
/// <c>UseWindowsFontsUnderWindows</c> açıktı ve Windows dışında
/// <see cref="PlatformNotSupportedException"/> fırlatılıyordu (Android'de PDF
/// bu yüzden üretilemedi). Artık uygulamanın gömülü Liberation Sans'ı
/// (Arial ile metrik uyumlu, SIL OFL 1.1) kullanılır.
/// </summary>
/// <remarks>
/// <c>GlobalFontSettings</c> süreç geneli ve tek seferliktir. Bu yüzden
/// çözücünün kendi davranışını sınayan testler hiçbir zaman global duruma
/// dokunmaz (kendi örneklerini kullanır); yalnızca PDF üretimi testi global
/// ayarı ihtiyaç duyar ve ayar ilk rapor üretiminde (hangi testin ilk olduğu
/// fark etmeksizin) aynı biçimde kurulur.
/// </remarks>
public sealed class EmbeddedPdfFontTests
{
    private const string TurkishLetters = "çğıİöşüÇĞÖŞÜ";

    [Fact]
    public async Task PdfEmbedsLiberationSansAndNeverFallsBackToWindowsFonts()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-embedded-font");
        string outputDirectory = Path.Combine(Path.GetTempPath(), $"metraj-embedded-font-{Guid.NewGuid():N}");
        Directory.CreateDirectory(outputDirectory);
        string pdfPath = Path.Combine(outputDirectory, "font.pdf");
        try
        {
            var projects = new ProjectWorkspaceService(database.ContextFactory);
            var cards = new CatalogWorkspaceService(database.ContextFactory);
            var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
            var measurements = new MeasurementWorkspaceService(database.ContextFactory);
            var reports = new ProjectReportWorkspaceService(database.ContextFactory);
            ProjectListItem project = await projects.CreateProjectAsync("P-FONT", "Yazı tipi testi " + TurkishLetters);
            CatalogCardListItem material = await cards.CreateCardAsync(new CatalogCardDraft(
                "MAT-FONT", "Çelik Boru Ğ Ş İ ı ö ü", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 5m, 4m, PositionNumber: "15.01"));
            PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, material.LatestVersionId));
            await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, pipe.Id, 12.4m, "m"));

            await reports.ExportPdfAsync(project.LatestRevisionId, pdfPath);

            byte[] pdf = await File.ReadAllBytesAsync(pdfPath);
            // PDF yazı tipi sözlükleri ASCII olduğundan Latin1 çözümü bayt eşlemesi için yeterli.
            string text = Encoding.Latin1.GetString(pdf);
            // PDF ad nesnelerinde boşluk "#20" olarak yazılır: /BaseFont /ABCDEF+Liberation#20Sans,Bold
            Assert.Matches(@"/BaseFont\s*/[A-Z]{6}\+Liberation(#20| )?Sans", text);
            // Yazı tipi yalnız adıyla anılmamalı, dosyanın kendisi (alt küme) PDF'e gömülmeli.
            Assert.Contains("/FontFile2", text, StringComparison.Ordinal);
            Assert.DoesNotContain("Arial", text, StringComparison.OrdinalIgnoreCase);

            Assert.False(GlobalFontSettings.UseWindowsFontsUnderWindows,
                "PDF üretimi Windows sistem fontlarına bağlı kalmamalı.");
            Assert.IsType<EmbeddedFontResolver>(GlobalFontSettings.FontResolver);
        }
        finally
        {
            if (Directory.Exists(outputDirectory))
            {
                Directory.Delete(outputDirectory, recursive: true);
            }
        }
    }

    [Fact]
    public async Task RepeatedPdfExportsReuseTheSameResolverInstance()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-embedded-font-repeat");
        string outputDirectory = Path.Combine(Path.GetTempPath(), $"metraj-embedded-font-{Guid.NewGuid():N}");
        Directory.CreateDirectory(outputDirectory);
        try
        {
            var projects = new ProjectWorkspaceService(database.ContextFactory);
            var reports = new ProjectReportWorkspaceService(database.ContextFactory);
            ProjectListItem project = await projects.CreateProjectAsync("P-FONT2", "Tekrar");

            await reports.ExportPdfAsync(project.LatestRevisionId, Path.Combine(outputDirectory, "a.pdf"));
            IFontResolver? first = GlobalFontSettings.FontResolver;
            await reports.ExportPdfAsync(project.LatestRevisionId, Path.Combine(outputDirectory, "b.pdf"));

            Assert.NotNull(first);
            Assert.Same(first, GlobalFontSettings.FontResolver);
        }
        finally
        {
            if (Directory.Exists(outputDirectory))
            {
                Directory.Delete(outputDirectory, recursive: true);
            }
        }
    }

    [Theory]
    [InlineData("Arial", false, false, "LiberationSans-Regular")]
    [InlineData("Arial", true, false, "LiberationSans-Bold")]
    [InlineData("Arial", false, true, "LiberationSans-Italic")]
    [InlineData("Arial", true, true, "LiberationSans-BoldItalic")]
    [InlineData("arial", false, false, "LiberationSans-Regular")]
    [InlineData("Liberation Sans", true, false, "LiberationSans-Bold")]
    [InlineData("Segoe UI", false, true, "LiberationSans-Italic")]
    [InlineData("", false, false, "LiberationSans-Regular")]
    [InlineData(null, true, true, "LiberationSans-BoldItalic")]
    public void ResolverMapsEveryFamilyRequestToTheMatchingLiberationSansFace(
        string? family, bool bold, bool italic, string expectedFace)
    {
        var resolver = new EmbeddedFontResolver();

        FontResolverInfo? info = resolver.ResolveTypeface(family!, bold, italic);

        Assert.NotNull(info);
        Assert.Equal(expectedFace, info.FaceName);
        Assert.False(info.MustSimulateBold);
        Assert.False(info.MustSimulateItalic);
    }

    [Theory]
    [InlineData("LiberationSans-Regular")]
    [InlineData("LiberationSans-Bold")]
    [InlineData("LiberationSans-Italic")]
    [InlineData("LiberationSans-BoldItalic")]
    public void EveryEmbeddedFaceIsAValidTrueTypeFontWithTurkishGlyphs(string faceName)
    {
        var resolver = new EmbeddedFontResolver();

        byte[]? data = resolver.GetFont(faceName);

        Assert.NotNull(data);
        Assert.True(data.Length > 100_000, $"{faceName} gömülü kaynağı beklenenden küçük: {data.Length} bayt.");
        // sfnt sürüm etiketi: TrueType için 0x00010000.
        Assert.Equal([0x00, 0x01, 0x00, 0x00], data.AsSpan(0, 4).ToArray());

        var cmap = TrueTypeCharacterMap.Read(data);
        foreach (char letter in TurkishLetters)
        {
            Assert.True(cmap.HasGlyph(letter), $"{faceName} yazı tipinde '{letter}' (U+{(int)letter:X4}) glifi yok.");
        }
        // Rapor metinlerinde sık geçen temel karakterler de gerçekten bulunmalı.
        // Not: Liberation Sans 2.1.5'te Türk lirası simgesi (U+20BA) yoktur; raporlar
        // para birimini bugün bu simgeyle yazmıyor. İleride gerekirse yazı tipi
        // yükseltilmeli ya da simge "TL" yazılmalıdır.
        foreach (char letter in "AZaz09.,:;()/-%+=°²³×")
        {
            Assert.True(cmap.HasGlyph(letter), $"{faceName} yazı tipinde '{letter}' (U+{(int)letter:X4}) glifi yok.");
        }
        // Sağlamlık kontrolü: ayrıştırıcı var olmayan glifi yok olarak raporlamalı.
        Assert.False(cmap.HasGlyph('￿'));
    }

    [Fact]
    public void ResolverReturnsTheSameBytesOnRepeatedCallsAndRejectsUnknownFaces()
    {
        var resolver = new EmbeddedFontResolver();

        byte[]? first = resolver.GetFont("LiberationSans-Regular");
        byte[]? second = resolver.GetFont("LiberationSans-Regular");

        Assert.NotNull(first);
        Assert.Equal(first, second);
        Assert.Throws<ArgumentException>(() => resolver.GetFont("Arial"));
    }

    [Fact]
    public void FontLicenseTravelsWithTheBinary()
    {
        var assembly = typeof(EmbeddedFontResolver).Assembly;
        using Stream? license = assembly.GetManifestResourceStream("Metraj.Infrastructure.Fonts.LICENSE");

        Assert.NotNull(license);
        using var reader = new StreamReader(license);
        string text = reader.ReadToEnd();
        Assert.Contains("SIL OPEN FONT LICENSE Version 1.1", text, StringComparison.Ordinal);
    }

    /// <summary>
    /// Yalnızca bir TrueType 'cmap' tablosunun (biçim 4 ve 12) glif var mı
    /// sorusunu yanıtlayan küçük ayrıştırıcı. Üretim koduna bağımlı değildir;
    /// font verisini bağımsız doğrular.
    /// </summary>
    private sealed class TrueTypeCharacterMap
    {
        private readonly byte[] data;
        private readonly int subtableOffset;
        private readonly int format;

        private TrueTypeCharacterMap(byte[] data, int subtableOffset, int format)
        {
            this.data = data;
            this.subtableOffset = subtableOffset;
            this.format = format;
        }

        public static TrueTypeCharacterMap Read(byte[] data)
        {
            int tableCount = U16(data, 4);
            int cmapOffset = -1;
            for (int index = 0; index < tableCount; index++)
            {
                int record = 12 + index * 16;
                if (Encoding.ASCII.GetString(data, record, 4) == "cmap")
                {
                    cmapOffset = (int)U32(data, record + 8);
                    break;
                }
            }

            Assert.True(cmapOffset >= 0, "cmap tablosu bulunamadı.");
            int subtableCount = U16(data, cmapOffset + 2);
            int best = -1;
            int bestFormat = 0;
            for (int index = 0; index < subtableCount; index++)
            {
                int record = cmapOffset + 4 + index * 8;
                int platform = U16(data, record);
                int encoding = U16(data, record + 2);
                int offset = cmapOffset + (int)U32(data, record + 4);
                int subtableFormat = U16(data, offset);
                bool unicode = (platform == 3 && (encoding == 1 || encoding == 10)) || platform == 0;
                if (unicode && (subtableFormat == 4 || subtableFormat == 12) && subtableFormat >= bestFormat)
                {
                    best = offset;
                    bestFormat = subtableFormat;
                }
            }

            Assert.True(best >= 0, "Unicode cmap alt tablosu (biçim 4/12) bulunamadı.");
            return new TrueTypeCharacterMap(data, best, bestFormat);
        }

        public bool HasGlyph(int codePoint) => format == 4 ? HasGlyphFormat4(codePoint) : HasGlyphFormat12(codePoint);

        private bool HasGlyphFormat4(int codePoint)
        {
            if (codePoint > 0xFFFF)
            {
                return false;
            }

            int segmentCount = U16(data, subtableOffset + 6) / 2;
            int endCodes = subtableOffset + 14;
            int startCodes = endCodes + segmentCount * 2 + 2;
            int deltas = startCodes + segmentCount * 2;
            int rangeOffsets = deltas + segmentCount * 2;
            for (int segment = 0; segment < segmentCount; segment++)
            {
                if (U16(data, endCodes + segment * 2) < codePoint)
                {
                    continue;
                }

                if (U16(data, startCodes + segment * 2) > codePoint)
                {
                    return false;
                }

                int delta = U16(data, deltas + segment * 2);
                int rangeOffset = U16(data, rangeOffsets + segment * 2);
                int glyph;
                if (rangeOffset == 0)
                {
                    glyph = (codePoint + delta) & 0xFFFF;
                }
                else
                {
                    int address = rangeOffsets + segment * 2 + rangeOffset + (codePoint - U16(data, startCodes + segment * 2)) * 2;
                    glyph = U16(data, address);
                    if (glyph != 0)
                    {
                        glyph = (glyph + delta) & 0xFFFF;
                    }
                }

                return glyph != 0;
            }

            return false;
        }

        private bool HasGlyphFormat12(int codePoint)
        {
            uint groupCount = U32(data, subtableOffset + 12);
            for (uint group = 0; group < groupCount; group++)
            {
                int record = subtableOffset + 16 + (int)group * 12;
                if (codePoint >= U32(data, record) && codePoint <= U32(data, record + 4))
                {
                    return U32(data, record + 8) + (uint)codePoint - U32(data, record) != 0;
                }
            }

            return false;
        }

        private static int U16(byte[] bytes, int offset) => (bytes[offset] << 8) | bytes[offset + 1];

        private static uint U32(byte[] bytes, int offset) =>
            ((uint)bytes[offset] << 24) | ((uint)bytes[offset + 1] << 16) | ((uint)bytes[offset + 2] << 8) | bytes[offset + 3];
    }
}
