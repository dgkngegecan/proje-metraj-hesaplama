using System.Globalization;
using System.Text;
using Metraj.Application;

namespace Metraj.Host;

/// <summary>Rapor indirmelerinin kullanıcıya görünen, okunur dosya adları.</summary>
/// <remarks>
/// Önceden indirme adı geçici dosyanın adıydı: <c>metraj-&lt;revizyonGuid&gt;-&lt;guid&gt;.pdf</c>.
/// Kullanıcı bunu masaüstünde, tarayıcıda ve Android paylaşım ekranında görüyor ve
/// hangi projenin, hangi revizyonun, hangi kapsamın raporu olduğunu çıkaramıyordu.
/// Yeni biçim: <c>{ProjeKodu}_R{RevizyonNo}[_{Kapsam}]_{yyyy-MM-dd_HHmm}.{uzantı}</c>.
/// Yalnız indirme adı değişir; geçici dosya yolu (GUID'li) benzersiz kalmaya devam
/// eder, bu yüzden aynı anda üretilen iki rapor birbirinin dosyasını ezmez.
/// </remarks>
public static class ReportFileNames
{
    /// <summary>Proje kodu ve kapsam parçalarının en çok uzunluğu.</summary>
    public const int MaxSegmentLength = 40;

    private const int MaxRevisionLength = 12;
    private const string FallbackProject = "Proje";
    private const string FallbackRevision = "R0";

    /// <summary>Dışa aktarım sonucundan dosya adı üretir.</summary>
    /// <param name="export">Rapor servisinin sonucu (proje, revizyon ve kapsam bilgisini taşır).</param>
    /// <param name="localTime">Dosya adındaki yerel zaman (kullanıcının saati).</param>
    /// <param name="extension">Noktalı uzantı: ".pdf", ".xlsx", ".docx".</param>
    public static string For(ProjectReportExportResult export, DateTime localTime, string extension)
    {
        ArgumentNullException.ThrowIfNull(export);
        return Build(export.ProjectCode, export.RevisionCode, export.ScopeCode, export.ScopeName, localTime, extension);
    }

    /// <summary>Parçalardan dosya adı kurar; geçersiz karakterleri temizler, uzunluğu sınırlar.</summary>
    /// <param name="projectCode">Proje kodu.</param>
    /// <param name="revisionCode">Revizyon kodu ("R0", "R2") ya da yalnız sayı ("2").</param>
    /// <param name="scopeCode">Alt ağaç kökünün kodu; yalnız ad boşsa kullanılır.</param>
    /// <param name="scopeName">Alt ağaç kökünün görünen adı. İkisi de boşsa kapsam parçası hiç yazılmaz (tam rapor).</param>
    /// <param name="localTime">Yerel zaman.</param>
    /// <param name="extension">Noktalı uzantı.</param>
    public static string Build(
        string? projectCode,
        string? revisionCode,
        string? scopeCode,
        string? scopeName,
        DateTime localTime,
        string extension)
    {
        string project = Sanitize(projectCode, MaxSegmentLength);
        if (project.Length == 0) project = FallbackProject;

        string revision = NormalizeRevision(revisionCode);

        // Önce görünen ad, yoksa kod; ikisi de yoksa tam rapor. Ağaçta kullanıcının
        // gördüğü ad budur ("A Blok" / "B Blok"); kart kodu aynı kartın iki
        // yerleşimini ayırt edemez, bu yüzden yalnız ad boşken kullanılır.
        string scope = Sanitize(scopeName, MaxSegmentLength);
        if (scope.Length == 0) scope = Sanitize(scopeCode, MaxSegmentLength);

        string stamp = localTime.ToString("yyyy-MM-dd_HHmm", CultureInfo.InvariantCulture);
        string cleanExtension = SanitizeExtension(extension);
        return scope.Length == 0
            ? $"{project}_{revision}_{stamp}{cleanExtension}"
            : $"{project}_{revision}_{scope}_{stamp}{cleanExtension}";
    }

    /// <summary>Bir metni dosya adı parçası olarak güvenli hâle getirir (Türkçe harfler korunur).</summary>
    /// <remarks>
    /// Dosya sistemi için geçersiz karakterler, denetim ve biçim karakterleri (sağdan sola
    /// geçersiz kılma gibi uzantıyı gizleyen hileler dahil) ve çiftsiz vekil çiftler atılır
    /// ya da tireye çevrilir; boşluk dizileri tek tire olur; baştaki/sondaki ayraçlar ve
    /// noktalar kırpılır; sonuç <paramref name="maxLength"/> karakteri aşmaz.
    /// </remarks>
    public static string Sanitize(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value) || maxLength <= 0) return string.Empty;

        char[] invalid = Path.GetInvalidFileNameChars();
        var builder = new StringBuilder(Math.Min(value.Length, maxLength + 8));
        bool pendingSeparator = false;
        for (int index = 0; index < value.Length; index++)
        {
            char character = value[index];
            UnicodeCategory category = char.GetUnicodeCategory(value, index);

            // Çiftsiz vekil karakter dosya adında geçersizdir; geçerli çift (emoji) kalır.
            if (char.IsHighSurrogate(character) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
            {
                AppendPending(builder, ref pendingSeparator);
                builder.Append(character).Append(value[++index]);
                continue;
            }

            if (char.IsSurrogate(character))
            {
                pendingSeparator = true;
                continue;
            }

            if (category is UnicodeCategory.Control or UnicodeCategory.Format
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                // Satır sonları ayraç sayılır; görünmez biçim karakterleri hiç yazılmaz.
                if (category is not UnicodeCategory.Format) pendingSeparator = true;
                continue;
            }

            if (char.IsWhiteSpace(character) || Array.IndexOf(invalid, character) >= 0
                || character is '"' or '<' or '>' or '|' or ':' or '*' or '?' or '/' or '\\')
            {
                pendingSeparator = true;
                continue;
            }

            AppendPending(builder, ref pendingSeparator);
            builder.Append(character);
        }

        string cleaned = builder.ToString();
        if (cleaned.Length > maxLength)
        {
            int length = maxLength;
            // Vekil çiftin ortasından kesme.
            if (char.IsHighSurrogate(cleaned[length - 1])) length--;
            cleaned = cleaned[..length];
        }

        return cleaned.Trim('-', '_', '.', ' ');
    }

    private static void AppendPending(StringBuilder builder, ref bool pendingSeparator)
    {
        if (pendingSeparator && builder.Length > 0 && builder[^1] != '-') builder.Append('-');
        pendingSeparator = false;
    }

    /// <summary>"2" → "R2", "r1" → "r1" korunur, boş → "R0"; her durumda güvenli ve kısa.</summary>
    private static string NormalizeRevision(string? revisionCode)
    {
        string cleaned = Sanitize(revisionCode, MaxRevisionLength);
        if (cleaned.Length == 0) return FallbackRevision;
        return cleaned.All(char.IsAsciiDigit) ? "R" + cleaned : cleaned;
    }

    private static string SanitizeExtension(string extension)
    {
        string cleaned = Sanitize(extension, 8).TrimStart('.');
        return cleaned.Length == 0 ? string.Empty : "." + cleaned;
    }
}
