namespace Metraj.Application;

/// <summary>Result of loading the explicitly synthetic Clean Water reference package.</summary>
public sealed record SyntheticCleanWaterImportResult(
    ProjectListItem Project,
    bool AlreadyExisted,
    int ImportedPlacementCount,
    int ImportedMeasurementCount);

/// <summary>Imports the packaged synthetic Clean Water acceptance data into the local database.</summary>
public interface ISyntheticCleanWaterWorkspace
{
    public Task<SyntheticCleanWaterImportResult> ImportAsync(CancellationToken cancellationToken = default);
}
