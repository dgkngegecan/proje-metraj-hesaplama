using PdfSharp.Fonts;
using System.Collections.Concurrent;
using System.Reflection;

namespace Metraj.Infrastructure;

/// <summary>
/// PDF raporunun yazı tiplerini işletim sisteminden değil, derlemeye gömülü
/// Liberation Sans'tan (Arial ile metrik uyumlu, SIL Open Font License 1.1) alır.
/// </summary>
/// <remarks>
/// Önceden PDF, Windows sistem yazı tiplerine (<c>UseWindowsFontsUnderWindows</c>)
/// bağlıydı ve Windows dışında <see cref="PlatformNotSupportedException"/>
/// fırlatıyordu; Android'de PDF bu yüzden üretilemedi. Çözücü tek bir yazı
/// tipi ailesi sunar: MigraDoc stillerindeki "Arial" dâhil her aile isteği
/// Liberation Sans'a eşlenir, kalın/italik doğru dosyaya gider. Böylece
/// masaüstü ve Android aynı sayfa düzenini üretir. Yazı tipi dosyaları ve
/// lisans metni <c>Fonts</c> klasöründedir ve gömülü kaynak olarak taşınır.
/// </remarks>
public sealed class EmbeddedFontResolver : IFontResolver
{
    private const string ResourcePrefix = "Metraj.Infrastructure.Fonts.";

    private static readonly string[] FaceNames =
    [
        "LiberationSans-Regular",
        "LiberationSans-Bold",
        "LiberationSans-Italic",
        "LiberationSans-BoldItalic"
    ];

    private readonly ConcurrentDictionary<string, byte[]> cache = new(StringComparer.Ordinal);

    /// <inheritdoc />
    /// <remarks>
    /// Aile adı bilerek yok sayılır: uygulamada tek bir aile gömülüdür ve eski
    /// raporlardaki "Arial" ile istenen her ad aynı yazı tipine gitmelidir.
    /// Gerçek kalın/italik yüz bulunduğu için sentetik eğriltme istenmez.
    /// </remarks>
    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic)
    {
        string face = (bold, italic) switch
        {
            (false, false) => "LiberationSans-Regular",
            (true, false) => "LiberationSans-Bold",
            (false, true) => "LiberationSans-Italic",
            (true, true) => "LiberationSans-BoldItalic"
        };
        return new FontResolverInfo(face, mustSimulateBold: false, mustSimulateItalic: false);
    }

    /// <inheritdoc />
    /// <exception cref="ArgumentException">Yüz adı gömülü yüzlerden biri değil.</exception>
    public byte[]? GetFont(string faceName)
    {
        if (Array.IndexOf(FaceNames, faceName) < 0)
        {
            throw new ArgumentException($"Gömülü yazı tipi yüzü bulunamadı: '{faceName}'.", nameof(faceName));
        }

        return cache.GetOrAdd(faceName, static name =>
        {
            Assembly assembly = typeof(EmbeddedFontResolver).Assembly;
            using Stream stream = assembly.GetManifestResourceStream($"{ResourcePrefix}{name}.ttf")
                ?? throw new InvalidOperationException($"Gömülü yazı tipi kaynağı eksik: '{name}'.");
            using var buffer = new MemoryStream(capacity: (int)stream.Length);
            stream.CopyTo(buffer);
            return buffer.ToArray();
        });
    }
}
