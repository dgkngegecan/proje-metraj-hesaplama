using System.Text.Json;

namespace Metraj.Domain;

/// <summary>
/// İsteğe bağlı JSON alanlarını okumak için tek yer.
/// </summary>
/// <remarks>
/// Model, yedi ayrı <c>…Json</c> string özelliği taşıyor ve her okuma
/// noktası aynı "çöz, bozuksa boş dön" kalıbını kendi elle yazıyordu --
/// altı neredeyse aynı yardımcı, <c>ParseIds</c>'in iki birebir kopyası
/// dahil. Kalıbın kendisi doğru: bozuk ya da eski bir isteğe bağlı alan,
/// geçerli bir projeyi düzenlenemez hâle getirmemeli. Tek yerde durunca
/// bir kopyanın sessizce farklı davranması da mümkün olmuyor.
/// </remarks>
public static class JsonStore
{
    /// <summary>Çözer; alan boş ya da bozuksa <paramref name="fallback"/> döner.</summary>
    /// <typeparam name="T">Beklenen tür.</typeparam>
    /// <param name="json">Saklanan JSON metni.</param>
    /// <param name="fallback">Okunamadığında dönecek değer.</param>
    public static T Read<T>(string? json, T fallback)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return fallback;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(json) ?? fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    /// <summary>Benzersiz kimlik listesi okur; okunamayan alan boş liste sayılır.</summary>
    /// <param name="json">Saklanan JSON metni.</param>
    public static Guid[] ReadIds(string? json) =>
        Read<Guid[]>(json, []).Distinct().ToArray();
}
