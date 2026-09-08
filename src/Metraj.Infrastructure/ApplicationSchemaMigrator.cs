using System.Data.Common;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Metraj.Infrastructure;

/// <summary>Applies the application database schema in a deterministic, versioned transaction.</summary>
public static class ApplicationSchemaMigrator
{
    private const string InitialSchemaVersion = "20260830_initial";
    private const string CalculationQuantitiesVersion = "20260830_calculation_quantities";
    private const string CardVersionNamesVersion = "20260830_card-version-names";
    private const string CalculationResultSnapshotIndexVersion = "20260830_calculation-result-snapshot-index";
    private const string VariantAndMaterialPolicyVersion = "20260901_variant-material-policy";
    private const string ConfigurableCatalogTypesVersion = "20260901-configurable-catalog-types";
    private const string CatalogVariantProfilesVersion = "20260901-catalog-variant-profiles";
    private const string MaterialWasteCaseInsensitiveVersion = "20260908-material-waste-nocase";

    /// <summary>Creates or upgrades the single application database.</summary>
    public static async Task MigrateAsync(MetrajDbContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        await using Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction =
            await context.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);

        await context.Database.EnsureCreatedAsync(cancellationToken).ConfigureAwait(false);
        await EnsureCalculationQuantityColumnsAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureCardVersionNameColumnAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureCalculationResultSnapshotIndexAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureVariantAndMaterialPolicyAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureCatalogVariantProfilesAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureConfigurableCatalogTypesAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureMaterialWasteCaseInsensitiveAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "__AppSchemaVersions" (
                "Version" TEXT NOT NULL CONSTRAINT "PK___AppSchemaVersions" PRIMARY KEY,
                "AppliedAtUtc" TEXT NOT NULL
            );
            """, cancellationToken).ConfigureAwait(false);

        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({InitialSchemaVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({CalculationQuantitiesVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({CardVersionNamesVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({CalculationResultSnapshotIndexVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({VariantAndMaterialPolicyVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({ConfigurableCatalogTypesVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({CatalogVariantProfilesVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({MaterialWasteCaseInsensitiveVersion}, {DateTime.UtcNow:O});",
            cancellationToken).ConfigureAwait(false);

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureVariantAndMaterialPolicyAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "MaterialType", "TEXT NULL", cancellationToken);
        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "CompatibleDiametersJson", "TEXT NOT NULL DEFAULT '[]'", cancellationToken);
        await EnsureColumnAsync(connection, transaction, "Measurements", "Variant", "TEXT NULL", cancellationToken);
        await EnsureColumnAsync(connection, transaction, "Measurements", "SecondaryVariant", "TEXT NULL", cancellationToken);
        await using DbCommand create = connection.CreateCommand();
        create.Transaction = transaction.GetDbTransaction();
        create.CommandText =
            "CREATE TABLE IF NOT EXISTS \"MaterialTypeWasteSettings\" (\"Id\" TEXT NOT NULL CONSTRAINT \"PK_MaterialTypeWasteSettings\" PRIMARY KEY, \"MaterialType\" TEXT NOT NULL, \"WasteRatePct\" INTEGER NOT NULL, \"UpdatedAtUtc\" TEXT NOT NULL);";
        await create.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await using DbCommand index = connection.CreateCommand();
        index.Transaction = transaction.GetDbTransaction();
        index.CommandText = "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_MaterialTypeWasteSettings_MaterialType\" ON \"MaterialTypeWasteSettings\" (\"MaterialType\");";
        await index.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureConfigurableCatalogTypesAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await using DbCommand create = connection.CreateCommand();
        create.Transaction = transaction.GetDbTransaction();
        create.CommandText =
            "CREATE TABLE IF NOT EXISTS \"CatalogCardTypeDefinitions\" (\"Id\" TEXT NOT NULL CONSTRAINT \"PK_CatalogCardTypeDefinitions\" PRIMARY KEY, \"Code\" TEXT NOT NULL, \"Name\" TEXT NOT NULL, \"Description\" TEXT NULL, \"BaseCardType\" TEXT NOT NULL, \"AllowedParentCardIdsJson\" TEXT NOT NULL DEFAULT '[]', \"AllowedChildCardIdsJson\" TEXT NOT NULL DEFAULT '[]', \"AttributeKeysJson\" TEXT NOT NULL DEFAULT '[]', \"IsActive\" INTEGER NOT NULL DEFAULT 1, \"CreatedAtUtc\" TEXT NOT NULL);";
        await create.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);

        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "CatalogCardTypeDefinitionId", "TEXT NULL", cancellationToken).ConfigureAwait(false);
        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "AttributeValuesJson", "TEXT NOT NULL DEFAULT '{}'", cancellationToken).ConfigureAwait(false);

        await using DbCommand index = connection.CreateCommand();
        index.Transaction = transaction.GetDbTransaction();
        index.CommandText = "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_CatalogCardTypeDefinitions_Code\" ON \"CatalogCardTypeDefinitions\" (\"Code\");";
        await index.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureCatalogVariantProfilesAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "VariantMode", "TEXT NOT NULL DEFAULT 'None'", cancellationToken).ConfigureAwait(false);
        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "VariantDefinitionsJson", "TEXT NOT NULL DEFAULT '[]'", cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Malzeme fire tablosunu büyük/küçük harf duyarsız hâle getirir ve eski
    /// kurulumlardaki yazım çakışmalarını birleştirir. Çakışma, metraj özetini
    /// çökerttiği için bu adım bir veri onarımıdır, yalnızca şema değişikliği değil.
    /// SQLite sütun harmanlaması değiştirilemediğinden tablo yeniden kurulur.
    /// </summary>
    private static async Task EnsureMaterialWasteCaseInsensitiveAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (DbCommand probe = connection.CreateCommand())
        {
            probe.Transaction = transaction.GetDbTransaction();
            // Tablo tanımında harmanlama zaten varsa yeniden kurmaya gerek yok.
            probe.CommandText =
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'MaterialTypeWasteSettings' AND sql LIKE '%NOCASE%';";
            if (Convert.ToInt64(await probe.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) == 1L)
            {
                return;
            }
        }

        string[] statements =
        [
            """
            CREATE TABLE "MaterialTypeWasteSettings_rebuilt" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_MaterialTypeWasteSettings" PRIMARY KEY,
                "MaterialType" TEXT NOT NULL COLLATE NOCASE,
                "WasteRatePct" INTEGER NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL
            );
            """,
            """
            CREATE UNIQUE INDEX "IX_MaterialTypeWasteSettings_MaterialType_rebuilt"
                ON "MaterialTypeWasteSettings_rebuilt" ("MaterialType");
            """,
            // Artan tarih sırasıyla yazıp OR REPLACE kullanınca, aynı aileyi farklı
            // yazımla taşıyan satırlardan en güncel olan hayatta kalır.
            """
            INSERT OR REPLACE INTO "MaterialTypeWasteSettings_rebuilt" ("Id", "MaterialType", "WasteRatePct", "UpdatedAtUtc")
            SELECT "Id", "MaterialType", "WasteRatePct", "UpdatedAtUtc"
            FROM "MaterialTypeWasteSettings"
            ORDER BY "UpdatedAtUtc" ASC, "Id" ASC;
            """,
            "DROP INDEX IF EXISTS \"IX_MaterialTypeWasteSettings_MaterialType\";",
            "DROP TABLE \"MaterialTypeWasteSettings\";",
            "ALTER TABLE \"MaterialTypeWasteSettings_rebuilt\" RENAME TO \"MaterialTypeWasteSettings\";",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_MaterialTypeWasteSettings_MaterialType"
                ON "MaterialTypeWasteSettings" ("MaterialType");
            """,
            "DROP INDEX IF EXISTS \"IX_MaterialTypeWasteSettings_MaterialType_rebuilt\";"
        ];

        foreach (string statement in statements)
        {
            await using DbCommand command = connection.CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = statement;
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task EnsureColumnAsync(DbConnection connection, IDbContextTransaction transaction, string table, string column, string definition, CancellationToken cancellationToken)
    {
        await using DbCommand probe = connection.CreateCommand();
        probe.Transaction = transaction.GetDbTransaction();
        probe.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = $name";
        DbParameter parameter = probe.CreateParameter();
        parameter.ParameterName = "$name";
        parameter.Value = column;
        probe.Parameters.Add(parameter);
        bool exists = Convert.ToInt64(await probe.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) == 1L;
        if (exists) return;
        await using DbCommand alter = connection.CreateCommand();
        alter.Transaction = transaction.GetDbTransaction();
        alter.CommandText = $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition};";
        await alter.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureCalculationQuantityColumnsAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        string[] columns = ["NetQuantity", "WithWasteQuantity", "PurchaseQuantity", "RemainderQuantity"];
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        foreach (string column in columns)
        {
            await using DbCommand probe = connection.CreateCommand();
            probe.Transaction = transaction.GetDbTransaction();
            probe.CommandText = "SELECT COUNT(*) FROM pragma_table_info('CalculationResults') WHERE name = $name";
            DbParameter parameter = probe.CreateParameter();
            parameter.ParameterName = "$name";
            parameter.Value = column;
            probe.Parameters.Add(parameter);
            bool exists = Convert.ToInt64(await probe.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) == 1L;
            if (!exists)
            {
                await using DbCommand alter = connection.CreateCommand();
                alter.Transaction = transaction.GetDbTransaction();
                alter.CommandText = $"ALTER TABLE \"CalculationResults\" ADD COLUMN \"{column}\" INTEGER NOT NULL DEFAULT 0;";
                await alter.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private static async Task EnsureCardVersionNameColumnAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await using DbCommand probe = connection.CreateCommand();
        probe.Transaction = transaction.GetDbTransaction();
        probe.CommandText = "SELECT COUNT(*) FROM pragma_table_info('CatalogCardVersions') WHERE name = 'Name'";
        bool exists = Convert.ToInt64(await probe.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) == 1L;
        if (!exists)
        {
            await using DbCommand alter = connection.CreateCommand();
            alter.Transaction = transaction.GetDbTransaction();
            alter.CommandText = "ALTER TABLE \"CatalogCardVersions\" ADD COLUMN \"Name\" TEXT NOT NULL DEFAULT '';";
            await alter.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using DbCommand backfill = connection.CreateCommand();
        backfill.Transaction = transaction.GetDbTransaction();
        backfill.CommandText =
            "UPDATE \"CatalogCardVersions\" SET \"Name\" = (SELECT \"Name\" FROM \"CatalogCardDefinitions\" WHERE \"CatalogCardDefinitions\".\"Id\" = \"CatalogCardVersions\".\"CatalogCardDefinitionId\") WHERE \"Name\" = '';";
        await backfill.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureCalculationResultSnapshotIndexAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await using DbCommand drop = connection.CreateCommand();
        drop.Transaction = transaction.GetDbTransaction();
        drop.CommandText = "DROP INDEX IF EXISTS \"IX_CalculationResults_ProjectRevisionId_InputHash\";";
        await drop.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);

        await using DbCommand create = connection.CreateCommand();
        create.Transaction = transaction.GetDbTransaction();
        create.CommandText = "CREATE INDEX IF NOT EXISTS \"IX_CalculationResults_ProjectRevisionId_InputHash\" ON \"CalculationResults\" (\"ProjectRevisionId\", \"InputHash\");";
        await create.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }
}
