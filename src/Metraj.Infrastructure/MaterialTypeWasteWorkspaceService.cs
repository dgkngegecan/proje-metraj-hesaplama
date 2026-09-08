using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

public sealed class MaterialTypeWasteWorkspaceService(Func<MetrajDbContext> contextFactory) : IMaterialTypeWasteWorkspace
{
    public async Task<IReadOnlyList<MaterialTypeWasteSettingItem>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return await context.MaterialTypeWasteSettings.AsNoTracking().OrderBy(x => x.MaterialType)
            .Select(x => new MaterialTypeWasteSettingItem(x.Id, x.MaterialType, x.WasteRatePct, x.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public async Task<MaterialTypeWasteSettingItem> UpsertAsync(string materialType, decimal wasteRatePct, CancellationToken cancellationToken = default)
    {
        string normalized = (materialType ?? string.Empty).Trim();
        if (normalized.Length is 0 or > 128) throw new DomainRuleViolationException("waste.material-type", "Material type must contain 1 to 128 characters.");
        QuantityRules.EnsureValid(wasteRatePct, "waste rate");
        await using MetrajDbContext context = contextFactory();

        // Aile adı eşleştirmesi, metraj özetindeki sözlükle birebir aynı kuralı
        // (OrdinalIgnoreCase) kullanmak zorundadır. SQLite'ın NOCASE harmanlaması
        // yalnızca ASCII'yi kapsadığından, "ÇELİK" / "çelik" gibi Türkçe yazımlar
        // veritabanı seviyesinde ayrışabilir; bu yüzden eşleştirme burada yapılır.
        // Tablo bir avuç satır tuttuğu için tamamını okumak güvenli ve ucuzdur.
        var matches = (await context.MaterialTypeWasteSettings.ToListAsync(cancellationToken))
            .Where(x => string.Equals(x.MaterialType, normalized, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.UpdatedAtUtc).ThenByDescending(x => x.Id)
            .ToList();

        MaterialTypeWasteSetting setting;
        if (matches.Count == 0)
        {
            setting = new MaterialTypeWasteSetting { Id = Guid.NewGuid(), MaterialType = normalized };
            context.Add(setting);
        }
        else
        {
            // Eski bir kurulumdan gelen yazım çakışmalarını sessizce onar: en güncel
            // kayıt kalır, kullanıcının son yazdığı biçim görünen etiket olur.
            setting = matches[0];
            setting.MaterialType = normalized;
            context.MaterialTypeWasteSettings.RemoveRange(matches.Skip(1));
        }

        setting.WasteRatePct = wasteRatePct;
        setting.UpdatedAtUtc = DateTime.UtcNow;
        await context.SaveChangesAsync(cancellationToken);
        return new(setting.Id, setting.MaterialType, setting.WasteRatePct, setting.UpdatedAtUtc);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        MaterialTypeWasteSetting setting = await context.MaterialTypeWasteSettings.SingleOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new DomainRuleViolationException("waste.not-found", "Material type waste setting was not found.");
        context.Remove(setting);
        await context.SaveChangesAsync(cancellationToken);
    }
}
