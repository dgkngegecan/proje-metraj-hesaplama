using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using System.Data.Common;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>Verifies that the initial solution layers can be loaded together.</summary>
public sealed class ArchitectureSmokeTests
{
    /// <summary>Checks that each initial assembly has a loadable marker type.</summary>
    [Fact]
    public void AllInitialLayersAreLoadable()
    {
        Assert.NotNull(typeof(Metraj.Domain.AssemblyMarker).Assembly);
        Assert.NotNull(typeof(Metraj.Application.AssemblyMarker).Assembly);
        Assert.NotNull(typeof(Metraj.Infrastructure.AssemblyMarker).Assembly);
    }

    /// <summary>Ensures the domain assembly has no UI or persistence dependency.</summary>
    [Fact]
    public void DomainAssemblyDoesNotReferenceUiOrSqlite()
    {
        string[] forbidden = ["PresentationFramework", "PresentationCore", "Microsoft.Data.Sqlite"];
        var references = typeof(Metraj.Domain.AssemblyMarker).Assembly
            .GetReferencedAssemblies()
            .Select(static assembly => assembly.Name)
            .OfType<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.All(forbidden, item => Assert.DoesNotContain(item, references));
    }

    /// <summary>Opens a temporary SQLite database through the infrastructure boundary.</summary>
    [Fact]
    public void SqliteConnectionFactoryCanOpenDatabase()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase1-{Guid.NewGuid():N}.db");
        try
        {
            using (SqliteConnection connection = new SqliteConnectionFactory(databasePath).Create())
            {
                connection.Open();
                using SqliteCommand command = connection.CreateCommand();
                command.CommandText = "SELECT 1";

                Assert.Equal(1L, command.ExecuteScalar());
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    /// <summary>Ensures the EF Core SQLite context can be created for the application database.</summary>
    [Fact]
    public void EfCoreContextCanConnectToDatabase()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase1-ef-{Guid.NewGuid():N}.db");
        try
        {
            using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            using (DbConnection connection = context.Database.GetDbConnection())
            {
                connection.Open();
                Assert.True(context.Database.CanConnect());
                connection.Close();
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    /// <summary>Verifies that EF creates the quantity column as an exact INTEGER provider type.</summary>
    [Fact]
    public void EfCoreModelUsesIntegerForQuantities()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase2-schema-{Guid.NewGuid():N}.db");
        try
        {
            using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                Assert.True(context.Database.EnsureCreated());
                using DbConnection connection = context.Database.GetDbConnection();
                connection.Open();
                using DbCommand command = connection.CreateCommand();
                command.CommandText = "SELECT type FROM pragma_table_info('Measurements') WHERE name = 'InputQuantity'";

                Assert.Equal("INTEGER", command.ExecuteScalar());
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }

    /// <summary>Verifies the versioned application schema initializer creates its marker.</summary>
    [Fact]
    public async Task SchemaMigratorCreatesVersionMarker()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-phase2-migration-{Guid.NewGuid():N}.db");
        try
        {
            using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
                await ApplicationSchemaMigrator.MigrateAsync(context);
                using DbConnection connection = context.Database.GetDbConnection();
                await connection.OpenAsync();
                using DbCommand command = connection.CreateCommand();
                command.CommandText = "SELECT COUNT(*) FROM \"__AppSchemaVersions\" WHERE \"Version\" IN ('20260830_initial', '20260830_calculation_quantities')";

                Assert.Equal(2L, await command.ExecuteScalarAsync());
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
        }
    }
}
