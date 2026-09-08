using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>
/// Hesap önerilerinin kaynak metrajla tutarlılığını korur.
/// </summary>
/// <remarks>
/// Bir öneri, dayandığı kaynak satırlar değiştiği anda artık doğru değildir.
/// Bu geçiş işaretlenmezse ekranda "Onaylandı" etiketiyle duran yanlış bir
/// miktar satın alma listesine girer. Snapshot'lar ekleme-esaslıdır: eski
/// sonuç silinmez, yalnızca <see cref="CalculationResultStatus.Stale"/> olarak
/// işaretlenir ve geçmişte görünür kalır.
/// </remarks>
public static class CalculationFreshness
{
    /// <summary>Bayatlamaya konu olabilecek durumlar; verilmiş kararlar (Rejected) korunur.</summary>
    private static readonly CalculationResultStatus[] InvalidatableStatuses =
    [
        CalculationResultStatus.PendingReview,
        CalculationResultStatus.Approved,
        CalculationResultStatus.Overridden
    ];

    /// <summary>
    /// Kaynak metrajı değişen yerleşimlere dayanan önerileri bayat işaretler.
    /// Değişiklikler çağıranın <c>SaveChangesAsync</c> çağrısıyla aynı işlem
    /// içinde kaydedilir; ölçüm ile öneri durumu asla ayrışmaz.
    /// </summary>
    public static async Task MarkStaleForPlacementsAsync(
        MetrajDbContext context,
        Guid revisionId,
        IReadOnlyCollection<Guid> changedPlacementIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(changedPlacementIds);
        if (changedPlacementIds.Count == 0) return;

        Guid[] sources = changedPlacementIds.Distinct().ToArray();

        // Doğrudan kurallar hedefin kendi ölçümlerini kullanır; sabit çarpanlı
        // kurallar ise "calculated-from" ile bağlı kaynakları kullanır. Her iki
        // yol da etkilenir.
        Guid[] derivedTargets = await context.PlacementLinks.AsNoTracking()
            .Where(x => x.LinkType == SemanticLinkType.CalculatedFrom && sources.Contains(x.SourcePlacementId))
            .Select(x => x.TargetPlacementId)
            .Distinct()
            .ToArrayAsync(cancellationToken);

        Guid[] affected = [.. sources, .. derivedTargets];

        List<CalculationResult> results = await context.CalculationResults
            .Where(x => x.ProjectRevisionId == revisionId
                        && affected.Contains(x.TargetPlacementId)
                        && InvalidatableStatuses.Contains(x.Status))
            .ToListAsync(cancellationToken);

        foreach (CalculationResult result in results)
        {
            result.Status = CalculationResultStatus.Stale;
        }
    }

    /// <summary>Tek bir yerleşim için kısayol.</summary>
    public static Task MarkStaleForPlacementAsync(
        MetrajDbContext context, Guid revisionId, Guid changedPlacementId, CancellationToken cancellationToken = default) =>
        MarkStaleForPlacementsAsync(context, revisionId, [changedPlacementId], cancellationToken);
}
