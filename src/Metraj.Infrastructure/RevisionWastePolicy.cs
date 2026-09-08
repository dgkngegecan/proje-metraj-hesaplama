using System.Text.Json;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>
/// Bir proje revizyonuna uygulanan merkezi malzeme fire oranları.
/// </summary>
/// <remarks>
/// Kart sürümleri ve varyant boy uzunlukları zaten değişmezdir (yerleşim belirli
/// bir <see cref="CatalogCardVersion"/> sürümüne bağlıdır), bu yüzden dondurulması
/// gereken tek şey global <see cref="MaterialTypeWasteSetting"/> tablosudur.
/// Onaylanmış bir revizyon kendi anlık görüntüsünü kullanır; taslak revizyon
/// düzenlenebilir olduğu için güncel ayarları izler.
/// </remarks>
public static class RevisionWastePolicy
{
    private static readonly JsonSerializerOptions SerializerOptions = new() { WriteIndented = false };

    /// <summary>Bu revizyon için geçerli fire oranlarını çözer.</summary>
    public static async Task<IReadOnlyDictionary<string, decimal>> ResolveAsync(
        MetrajDbContext context, ProjectRevision revision, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(revision);

        // Taslak dışındaki bir revizyonda anlık görüntü varsa o kullanılır.
        // Bu değişiklikten önce onaylanmış revizyonlarda alan boştur; o durumda
        // eski davranış (güncel ayarlar) korunur, böylece mevcut veri bozulmaz.
        if (revision.Status != ProjectRevisionStatus.Draft && revision.EffectivePolicyJson is { Length: > 0 } snapshot)
        {
            return Deserialize(snapshot);
        }

        return await ReadCurrentAsync(context, cancellationToken);
    }

    /// <summary>Onay anında dondurulacak anlık görüntüyü üretir.</summary>
    public static async Task<string> CaptureAsync(MetrajDbContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        IReadOnlyDictionary<string, decimal> current = await ReadCurrentAsync(context, cancellationToken);
        return JsonSerializer.Serialize(
            current.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase).ToDictionary(pair => pair.Key, pair => pair.Value),
            SerializerOptions);
    }

    private static async Task<IReadOnlyDictionary<string, decimal>> ReadCurrentAsync(MetrajDbContext context, CancellationToken cancellationToken)
    {
        // Aynı aileyi farklı yazımla taşıyan eski kayıtlar özet üretimini ASLA
        // engellememelidir; doğrudan ToDictionary çağrısı çakışan anahtarda
        // istisna atardı ve kullanıcı harita, özet ve raporların tamamını
        // kaybederdi. En güncel kayıt kazanır.
        return (await context.MaterialTypeWasteSettings.AsNoTracking()
                .OrderBy(x => x.UpdatedAtUtc).ThenBy(x => x.Id)
                .ToListAsync(cancellationToken))
            .GroupBy(x => x.MaterialType, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last().WasteRatePct, StringComparer.OrdinalIgnoreCase);
    }

    private static Dictionary<string, decimal> Deserialize(string json)
    {
        try
        {
            Dictionary<string, decimal>? values = JsonSerializer.Deserialize<Dictionary<string, decimal>>(json);
            return values is null
                ? new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, decimal>(values, StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            // Bozuk bir anlık görüntü, raporu tamamen erişilemez yapmamalı:
            // kart üzerindeki kendi fire oranıyla devam edilir.
            return new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        }
    }
}
