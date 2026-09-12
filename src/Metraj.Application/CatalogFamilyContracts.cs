namespace Metraj.Application;

/// <summary>Version-owned catalogue metadata; no database schema or historical reference changes.</summary>
public static class CatalogFamilyMetadata
{
    public const string FamilyCode = "CatalogFamilyCode";
    public const string PipeSystem = "CatalogPipeSystem";
    public const string CompatiblePipeSystems = "CatalogCompatiblePipeSystems";
    public const string SeedRevision = "CatalogSeedRevision";
    public const string SourceCards = "CatalogSourceCards";

    public static bool IsKnown(string key) => key is FamilyCode or PipeSystem or CompatiblePipeSystems or SeedRevision or SourceCards;
}

/// <summary>Every original seed has an explicit disposition, including retained standalone cards.</summary>
public sealed record CatalogSeedAuditItem(string SourceCode, string? FamilyCode, string Disposition);
