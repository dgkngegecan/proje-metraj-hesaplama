namespace Metraj.Application;

/// <summary>Result of adding the curated Turkish/global mechanical-installation starter catalog.</summary>
public sealed record StarterCatalogSeedResult(int AddedCount, int ExistingCount, IReadOnlyList<string> AddedCodes);

/// <summary>Adds the built-in catalog vocabulary without changing user-created cards.</summary>
public interface IStarterCatalogWorkspace
{
    public Task<StarterCatalogSeedResult> SeedAsync(CancellationToken cancellationToken = default);
}
