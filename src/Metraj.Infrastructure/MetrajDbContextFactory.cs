using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Creates EF Core contexts for the single application SQLite database.</summary>
public static class MetrajDbContextFactory
{
    /// <summary>Creates a context configured for a local SQLite database path.</summary>
    public static MetrajDbContext Create(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        var options = new DbContextOptionsBuilder<MetrajDbContext>()
            .UseSqlite($"Data Source={databasePath};Foreign Keys=True")
            .Options;

        return new MetrajDbContext(options);
    }
}
