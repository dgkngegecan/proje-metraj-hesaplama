namespace Metraj.Application;

/// <summary>Result of merging a portable workspace into the active workspace.</summary>
public sealed record WorkspaceImportResult(
    int ImportedProjects,
    int SkippedProjects,
    int ImportedCatalogCards,
    int ImportedCardVersions,
    int ImportedWasteSettings);

/// <summary>Exports and additively imports complete portable workspaces.</summary>
public interface IWorkspaceTransfer
{
    public Task ExportAsync(string outputPath, CancellationToken cancellationToken = default);
    public Task<WorkspaceImportResult> ImportAsync(string packagePath, CancellationToken cancellationToken = default);
}
