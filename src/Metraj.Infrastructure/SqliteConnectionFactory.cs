using Microsoft.Data.Sqlite;

namespace Metraj.Infrastructure;

/// <summary>Creates SQLite connections; schema and migrations are introduced in Phase 2.</summary>
public sealed class SqliteConnectionFactory(string databasePath)
{
    /// <summary>Creates a configured connection to the application database.</summary>
    public SqliteConnection Create()
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        return new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            Pooling = true
        }.ToString());
    }
}
