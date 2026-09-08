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
        string normalized = materialType.Trim();
        if (normalized.Length is 0 or > 128) throw new DomainRuleViolationException("waste.material-type", "Material type must contain 1 to 128 characters.");
        QuantityRules.EnsureValid(wasteRatePct, "waste rate");
        await using MetrajDbContext context = contextFactory();
        MaterialTypeWasteSetting? setting = await context.MaterialTypeWasteSettings.SingleOrDefaultAsync(x => x.MaterialType == normalized, cancellationToken);
        if (setting is null)
        {
            setting = new MaterialTypeWasteSetting { Id = Guid.NewGuid(), MaterialType = normalized };
            context.Add(setting);
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
