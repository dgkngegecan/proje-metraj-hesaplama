namespace Metraj.Domain;

/// <summary>
/// Serbest metin alanlarının kırpılması ve uzunluk doğrulaması için tek yer.
/// </summary>
/// <remarks>
/// Aynı gövde beş serviste ayrı ayrı yazılıydı (artı <c>NormalizeRequired</c>'ın
/// iki kopyası). Kopyalar birebir aynı DEĞİLDİ: üçü kural kodunu çağırandan
/// alıyor, ikisi sabit bir kural koduyla alan adını iletiye gömüyordu. Kural
/// kodları arayüzün hata iletisini seçtiği sözleşme olduğu için (bkz.
/// <c>DomainMessageCatalog</c>) burada ikisi de korunur: kural kodu ve ileti
/// her zaman çağırandan gelir.
/// </remarks>
public static class TextRules
{
    /// <summary>Zorunlu alan: kırpar, boş veya çok uzunsa kuralı ihlal eder.</summary>
    /// <param name="value">Ham girdi.</param>
    /// <param name="maxLength">İzin verilen en fazla karakter.</param>
    /// <param name="rule">Arayüzün dallandığı kararlı kural kodu.</param>
    /// <param name="message">Kural ihlali iletisi.</param>
    public static string Required(string? value, int maxLength, string rule, string message)
    {
        string normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0 || normalized.Length > maxLength)
        {
            throw new DomainRuleViolationException(rule, message);
        }

        return normalized;
    }

    /// <summary>İsteğe bağlı alan: boşsa null, doluysa kırpılmış ve uzunluğu doğrulanmış.</summary>
    /// <param name="value">Ham girdi.</param>
    /// <param name="maxLength">İzin verilen en fazla karakter.</param>
    /// <param name="rule">Arayüzün dallandığı kararlı kural kodu.</param>
    /// <param name="message">Kural ihlali iletisi.</param>
    public static string? Optional(string? value, int maxLength, string rule, string message)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        string normalized = value.Trim();
        if (normalized.Length > maxLength)
        {
            throw new DomainRuleViolationException(rule, message);
        }

        return normalized;
    }

    /// <summary>Kod alanı: kırpar, büyük harfe çevirir, uzunluğu doğrular.</summary>
    /// <param name="value">Ham girdi.</param>
    /// <param name="maxLength">İzin verilen en fazla karakter.</param>
    /// <param name="rule">Arayüzün dallandığı kararlı kural kodu.</param>
    /// <param name="message">Kural ihlali iletisi.</param>
    public static string Code(string? value, int maxLength, string rule, string message) =>
        Required(value, maxLength, rule, message).ToUpperInvariant();
}
