namespace Metraj.Application;

/// <summary>Why a complete single-database snapshot was created.</summary>
public enum DatabaseBackupReason
{
    Manual,
    BeforeMigration,
    BeforeRestore
}

/// <summary>One complete, independently restorable SQLite snapshot.</summary>
public sealed record DatabaseBackupListItem(
    string FullPath,
    string FileName,
    DatabaseBackupReason Reason,
    DateTime CreatedAtUtc,
    long SizeBytes);

/// <summary>Read-only result of SQLite's quick consistency validation.</summary>
public sealed record DatabaseIntegrityCheckResult(bool IsHealthy, string Details);

/// <summary>Owns safe snapshot, restore, and integrity operations for the single application database.</summary>
public interface IDatabaseMaintenanceWorkspace
{
    public Task<IReadOnlyList<DatabaseBackupListItem>> ListBackupsAsync(CancellationToken cancellationToken = default);
    public Task<DatabaseBackupListItem> CreateBackupAsync(DatabaseBackupReason reason = DatabaseBackupReason.Manual, CancellationToken cancellationToken = default);
    public Task RestoreBackupAsync(string backupPath, CancellationToken cancellationToken = default);
    public Task<DatabaseIntegrityCheckResult> CheckIntegrityAsync(CancellationToken cancellationToken = default);
}
