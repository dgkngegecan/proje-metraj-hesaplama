namespace Metraj.Infrastructure;

/// <summary>Resolves the single application database location for the current Windows user.</summary>
public static class ApplicationDatabasePaths
{
    /// <summary>Returns the database file path under the user's local application data folder.</summary>
    public static string GetDatabasePath()
    {
        string? overriddenDirectory = Environment.GetEnvironmentVariable("METRAJ_DATA_DIRECTORY");
        if (!string.IsNullOrWhiteSpace(overriddenDirectory))
        {
            string directory = Path.GetFullPath(overriddenDirectory);
            Directory.CreateDirectory(directory);
            string overriddenDatabasePath = Path.Combine(directory, "metraj.db");
            VerifyWriteAccess(directory, overriddenDatabasePath);
            return overriddenDatabasePath;
        }

        string[] basePaths =
        [
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Path.GetTempPath()
        ];
        UnauthorizedAccessException? lastAccessException = null;
        foreach (string basePath in basePaths.Where(path => !string.IsNullOrWhiteSpace(path)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                string applicationPath = Path.Combine(basePath, "ProjeMetraj");
                Directory.CreateDirectory(applicationPath);
                string databasePath = Path.Combine(applicationPath, "metraj.db");
                VerifyWriteAccess(applicationPath, databasePath);
                return databasePath;
            }
            catch (UnauthorizedAccessException exception)
            {
                lastAccessException = exception;
            }
        }

        throw new IOException("No writable application data directory is available.", lastAccessException);
    }

    private static void VerifyWriteAccess(string applicationPath, string databasePath)
    {
        string probePath = Path.Combine(applicationPath, $".write-probe-{Guid.NewGuid():N}.tmp");
        try
        {
            using (FileStream probe = File.Open(probePath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                probe.WriteByte(0);
            }

            if (File.Exists(databasePath))
            {
                using FileStream database = File.Open(databasePath, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite);
            }
        }
        finally
        {
            File.Delete(probePath);
        }
    }
}
