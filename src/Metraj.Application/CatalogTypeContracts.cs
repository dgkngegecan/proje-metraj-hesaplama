using Metraj.Domain;

namespace Metraj.Application;

/// <summary>Stable keys shown in the configurable card-type editor.</summary>
public sealed record CatalogCardAttributeDescriptor(
    string Key,
    string Label,
    string Description,
    bool IsRequired = false);

/// <summary>
/// The finite, safe attribute vocabulary accepted by the application. Keeping this
/// list explicit prevents arbitrary code or unbounded schema changes from entering
/// the calculation engine while still letting users tailor each card type.
/// </summary>
public static class CatalogCardAttributeCatalog
{
    public static IReadOnlyList<CatalogCardAttributeDescriptor> All { get; } =
    [
        new("Code", "Kart kodu", "Katalogda benzersiz kısa kod.", true),
        new("Name", "Kart adı", "Kartın görünen adı.", true),
        new("Unit", "Birim", "m, adet, takım gibi ölçü birimi.", true),
        new("Notes", "Not", "Sahada görünen açıklama veya üretici notu."),
        new("ItemKind", "Kalem türü", "Malzeme, cihaz, işçilik veya hizmet."),
        new("InputBehavior", "Giriş davranışı", "Elle giriş, onay kutusu veya türetilmiş giriş."),
        new("SalesConversion", "Satın alma dönüşümü", "Standart boy veya paket dönüşümü."),
        new("ReportBehavior", "Rapor davranışı", "Başlık, ölçülebilir, yardımcı veya referans."),
        new("WasteRatePct", "Fire oranı", "Varsayılan fire yüzdesi."),
        new("ContainerParameter", "Boy/paket kapasitesi", "Standart boy uzunluğu veya paket içi adet."),
        new("PositionNumber", "Poz numarası", "Teknik şartname/pafta poz numarası."),
        new("MaterialType", "Malzeme ailesi", "Merkezi fire politikası için malzeme ailesi."),
        new("CompatibleDiameters", "Uyumlu çaplar", "Fitting veya adaptörün bağlanabildiği nominal çaplar.")
    ];

    /// <summary>Anahtardan kanonik yazımına ve katalogdaki sırasına.</summary>
    /// <remarks>
    /// Sıralama anahtarı önceden <c>Array.FindIndex(All.ToArray(), ...)</c> ile
    /// hesaplanıyordu: OrderBy anahtarı her karşılaştırmada istediği için
    /// ELEMAN BAŞINA tam bir dizi tahsisi ve lineer tarama demekti. Aynı
    /// sözlük, <c>Canonical</c> ile birlikte doğrulamada da kullanılıyor;
    /// orada da anahtar başına lineer tarama vardı.
    /// </remarks>
    private static readonly Dictionary<string, (string Canonical, int Order)> KeyIndex = All
        .Select((descriptor, order) => (descriptor.Key, order))
        .ToDictionary(x => x.Key, x => (x.Key, x.order), StringComparer.OrdinalIgnoreCase);

    public static bool IsKnown(string key) => !string.IsNullOrWhiteSpace(key) && KeyIndex.ContainsKey(key);

    /// <summary>Bilinen bir anahtarın katalogdaki kanonik yazımı; bilinmiyorsa null.</summary>
    /// <param name="key">Aranan anahtar (büyük/küçük harf duyarsız).</param>
    public static string? Canonical(string key) =>
        !string.IsNullOrWhiteSpace(key) && KeyIndex.TryGetValue(key.Trim(), out (string Canonical, int Order) entry)
            ? entry.Canonical
            : null;

    public static IReadOnlyList<string> NormalizeKeys(IEnumerable<string>? keys)
    {
        return (keys ?? [])
            .Where(IsKnown)
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => KeyIndex[x].Order)
            .ToArray();
    }
}

public sealed record CatalogCardTypeListItem(
    Guid Id,
    string Code,
    string Name,
    CardType BaseCardType,
    IReadOnlyList<Guid> AllowedParentCardIds,
    IReadOnlyList<Guid> AllowedChildCardIds,
    IReadOnlyList<string> AttributeKeys,
    bool IsActive,
    string? Description = null);

public sealed record CatalogCardTypeDraft(
    string Code,
    string Name,
    CardType BaseCardType,
    IReadOnlyList<Guid>? AllowedParentCardIds = null,
    IReadOnlyList<Guid>? AllowedChildCardIds = null,
    IReadOnlyList<string>? AttributeKeys = null,
    string? Description = null);

public interface ICatalogCardTypeWorkspace
{
    public Task<IReadOnlyList<CatalogCardTypeListItem>> ListTypesAsync(CancellationToken cancellationToken = default);
    public Task<CatalogCardTypeListItem> CreateTypeAsync(CatalogCardTypeDraft draft, CancellationToken cancellationToken = default);
    public Task DeleteTypeAsync(Guid typeId, CancellationToken cancellationToken = default);
}
