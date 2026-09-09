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
    private const string RevisionEffectivePolicyVersion = "20260908-revision-effective-policy";
    private const string UiStateVersion = "20260909-ui-state";
    private const string ResponsibilityScopedIndexesVersion = "20260909-responsibility-scoped-indexes";

    /// <summary>
    /// Bu uygulama sürümünün tanıdığı şema adımları. Geri yükleme doğrulaması da
    /// bu listeyi kullanır: tanınmayan bir sürüm, gelecekten gelen (daha yeni bir
    /// uygulamayla üretilmiş) bir yedeğin sessizce yüklenmesini engeller.
    /// </summary>
    public static IReadOnlyList<string> KnownSchemaVersions { get; } =
    [
        InitialSchemaVersion,
        CalculationQuantitiesVersion,
        CardVersionNamesVersion,
        CalculationResultSnapshotIndexVersion,
        VariantAndMaterialPolicyVersion,
        ConfigurableCatalogTypesVersion,
        CatalogVariantProfilesVersion,
        MaterialWasteCaseInsensitiveVersion,
        RevisionEffectivePolicyVersion,
        UiStateVersion,
        ResponsibilityScopedIndexesVersion
    ];

    /// <summary>
    /// Göç sonrası bulunması beklenen indeksler. Yeni kurulan bir veritabanı ile
    /// yükseltilmiş bir veritabanının aynı kısıtlara sahip olmasını güvence altına
    /// alır; ikisi ayrıştığında sorgular kurulumdan kuruluma farklı davranır.
    /// </summary>
    public static IReadOnlyList<string> ExpectedIndexes { get; } =
    [
        "IX_CatalogCardDefinitions_Code",
        "IX_CatalogCardTypeDefinitions_Code",
        "IX_CatalogCardVersions_CatalogCardTypeDefinitionId",
        "IX_MaterialTypeWasteSettings_MaterialType",
        "IX_Projects_Code",
        "IX_ResponsibilityAssignments_MeasurementScope",
        "IX_ResponsibilityAssignments_PlacementScope"
    ];

    /// <summary>Bir Metraj veritabanında bulunması zorunlu çekirdek tablolar.</summary>
    public static IReadOnlyList<string> RequiredTables { get; } =
    [
        "Projects",
        "ProjectRevisions",
        "ProjectPlacements",
        "Measurements",
        "CatalogCardDefinitions",
        "CatalogCardVersions",
        "CalculationResults"
    ];

    /// <summary>
    /// Şemanın zaten güncel olup olmadığını söyler. Açılışta yedek almadan önce
    /// sorulur: her açılışta koşulsuz yedek almak, kullanıcının kasıtlı
    /// yedeklerini kotadan düşürüyor ve açılışı gereksiz yere uzatıyordu.
    /// </summary>
    public static async Task<bool> IsUpToDateAsync(string databasePath, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        if (!File.Exists(databasePath)) return false;

        await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
        DbConnection connection = context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

        await using (DbCommand probe = connection.CreateCommand())
        {
            probe.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '__AppSchemaVersions';";
            if (Convert.ToInt64(await probe.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) != 1L)
            {
                return false;
            }
        }

        var applied = new HashSet<string>(StringComparer.Ordinal);
        await using (DbCommand read = connection.CreateCommand())
        {
            read.CommandText = "SELECT \"Version\" FROM \"__AppSchemaVersions\";";
            await using DbDataReader reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                applied.Add(reader.GetString(0));
            }
        }

        return KnownSchemaVersions.All(applied.Contains);
    }

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
        await EnsureRevisionEffectivePolicyAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureUiStateAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await EnsureResponsibilityScopedIndexesAsync(context, transaction, cancellationToken).ConfigureAwait(false);
        await context.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "__AppSchemaVersions" (
                "Version" TEXT NOT NULL CONSTRAINT "PK___AppSchemaVersions" PRIMARY KEY,
                "AppliedAtUtc" TEXT NOT NULL
            );
            """, cancellationToken).ConfigureAwait(false);

        // Uygulanan adımlar tek listeden yazılır; yeni bir şema sürümü eklemek
        // artık KnownSchemaVersions'a bir satır eklemekten ibarettir.
        DateTime appliedAtUtc = DateTime.UtcNow;
        foreach (string version in KnownSchemaVersions)
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT OR IGNORE INTO \"__AppSchemaVersions\" (\"Version\", \"AppliedAtUtc\") VALUES ({version}, {appliedAtUtc:O});",
                cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureVariantAndMaterialPolicyAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "MaterialType", "TEXT NULL", cancellationToken);
        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "CompatibleDiametersJson", "TEXT NOT NULL DEFAULT '[]'", cancellationToken);
        await EnsureColumnAsync(connection, transaction, "Measurements", "Variant", "TEXT NULL", cancellationToken);
        await EnsureColumnAsync(connection, transaction, "Measurements", "SecondaryVariant", "TEXT NULL", cancellationToken);
        await ExecuteAsync(connection, transaction,
            "CREATE TABLE IF NOT EXISTS \"MaterialTypeWasteSettings\" (\"Id\" TEXT NOT NULL CONSTRAINT \"PK_MaterialTypeWasteSettings\" PRIMARY KEY, \"MaterialType\" TEXT NOT NULL, \"WasteRatePct\" INTEGER NOT NULL, \"UpdatedAtUtc\" TEXT NOT NULL);",
            cancellationToken).ConfigureAwait(false);
        await ExecuteAsync(connection, transaction,
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_MaterialTypeWasteSettings_MaterialType\" ON \"MaterialTypeWasteSettings\" (\"MaterialType\");",
            cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureConfigurableCatalogTypesAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        await ExecuteAsync(connection, transaction,
            "CREATE TABLE IF NOT EXISTS \"CatalogCardTypeDefinitions\" (\"Id\" TEXT NOT NULL CONSTRAINT \"PK_CatalogCardTypeDefinitions\" PRIMARY KEY, \"Code\" TEXT NOT NULL, \"Name\" TEXT NOT NULL, \"Description\" TEXT NULL, \"BaseCardType\" TEXT NOT NULL, \"AllowedParentCardIdsJson\" TEXT NOT NULL DEFAULT '[]', \"AllowedChildCardIdsJson\" TEXT NOT NULL DEFAULT '[]', \"AttributeKeysJson\" TEXT NOT NULL DEFAULT '[]', \"IsActive\" INTEGER NOT NULL DEFAULT 1, \"CreatedAtUtc\" TEXT NOT NULL);",
            cancellationToken).ConfigureAwait(false);

        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "CatalogCardTypeDefinitionId", "TEXT NULL", cancellationToken).ConfigureAwait(false);
        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "AttributeValuesJson", "TEXT NOT NULL DEFAULT '{}'", cancellationToken).ConfigureAwait(false);

        await ExecuteAsync(connection, transaction,
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_CatalogCardTypeDefinitions_Code\" ON \"CatalogCardTypeDefinitions\" (\"Code\");",
            cancellationToken).ConfigureAwait(false);

        // Yükseltme yolu bu ilişki indeksini oluşturmuyordu; yeni bir veritabanı
        // EF modelinden ürettiği için ONDA vardı. Aynı uygulamanın iki kurulumu
        // farklı indekslere sahip olabiliyor, sorgular farklı davranabiliyordu.
        await ExecuteAsync(connection, transaction,
            "CREATE INDEX IF NOT EXISTS \"IX_CatalogCardVersions_CatalogCardTypeDefinitionId\" ON \"CatalogCardVersions\" (\"CatalogCardTypeDefinitionId\");",
            cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureCatalogVariantProfilesAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

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
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

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
            await ExecuteAsync(connection, transaction, statement, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Onay anında dondurulan etkin politika alanını ekler. Bu alan olmadan
    /// onaylanmış bir revizyonun fireli miktarları, sonradan değiştirilen merkezi
    /// ayarlarla birlikte değişiyordu.
    /// </summary>
    private static async Task EnsureRevisionEffectivePolicyAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        await EnsureColumnAsync(connection, transaction, "ProjectRevisions", "EffectivePolicyJson", "TEXT NULL", cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Arayüzün kalıcı taslak ve tercih tablosunu oluşturur.</summary>
    private static async Task EnsureUiStateAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        await ExecuteAsync(connection, transaction,
            "CREATE TABLE IF NOT EXISTS \"UiStates\" (\"Key\" TEXT NOT NULL CONSTRAINT \"PK_UiStates\" PRIMARY KEY, \"ValueJson\" TEXT NOT NULL, \"UpdatedAtUtc\" TEXT NOT NULL);",
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Sorumluluk atamalarının benzersizliğini gerçekten uygulayan filtreli
    /// indeksleri kurar ve çakışan eski satırları temizler.
    /// </summary>
    /// <remarks>
    /// Önceki tek indeks nullable MeasurementId içeriyordu; SQLite NULL'ları
    /// benzersizlik açısından farklı saydığı için aynı yerleşim/boyut çifti
    /// birden çok kez kaydedilebiliyordu.
    /// </remarks>
    private static async Task EnsureResponsibilityScopedIndexesAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        string[] statements =
        [
            // Çakışan eski satırlardan en yenisi (en büyük Id) korunur.
            """
            DELETE FROM "ResponsibilityAssignments"
            WHERE "MeasurementId" IS NULL AND "ProjectPlacementId" IS NOT NULL AND "Id" NOT IN (
                SELECT MAX("Id") FROM "ResponsibilityAssignments"
                WHERE "MeasurementId" IS NULL AND "ProjectPlacementId" IS NOT NULL
                GROUP BY "ProjectRevisionId", "ResponsibilityDimensionId", "ProjectPlacementId");
            """,
            """
            DELETE FROM "ResponsibilityAssignments"
            WHERE "MeasurementId" IS NOT NULL AND "Id" NOT IN (
                SELECT MAX("Id") FROM "ResponsibilityAssignments"
                WHERE "MeasurementId" IS NOT NULL
                GROUP BY "ProjectRevisionId", "ResponsibilityDimensionId", "MeasurementId");
            """,
            "DROP INDEX IF EXISTS \"IX_ResponsibilityAssignments_ProjectRevisionId_ResponsibilityDimensionId_ProjectPlacementId_MeasurementId\";",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ResponsibilityAssignments_PlacementScope"
                ON "ResponsibilityAssignments" ("ProjectRevisionId", "ResponsibilityDimensionId", "ProjectPlacementId")
                WHERE "MeasurementId" IS NULL AND "ProjectPlacementId" IS NOT NULL;
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ResponsibilityAssignments_MeasurementScope"
                ON "ResponsibilityAssignments" ("ProjectRevisionId", "ResponsibilityDimensionId", "MeasurementId")
                WHERE "MeasurementId" IS NOT NULL;
            """
        ];

        foreach (string statement in statements)
        {
            await ExecuteAsync(connection, transaction, statement, cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Bağlantıyı açık hâlde döndürür.</summary>
    /// <remarks>
    /// Bu dört satır dosyadaki her göç adımının başında tekrar ediyordu (on kopya).
    /// </remarks>
    private static async Task<DbConnection> GetOpenConnectionAsync(MetrajDbContext context, CancellationToken cancellationToken)
    {
        DbConnection connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        return connection;
    }

    /// <summary>Göçü yürüten transaction içinde tek bir ifade çalıştırır.</summary>
    private static async Task ExecuteAsync(DbConnection connection, IDbContextTransaction transaction, string sql, CancellationToken cancellationToken)
    {
        await using DbCommand command = connection.CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>SQL metnine doğrudan yazılacak bir tablo/sütun adını doğrular.</summary>
    /// <remarks>
    /// Tablo ve sütun adları SQL'de parametre olarak bağlanamaz, bu yüzden metne
    /// gömülmek zorundalar; oysa aynı metotta iki satır aşağıda sütun ADI düzgün
    /// bind ediliyordu. Bugün bütün çağrılar sabit metin geçtiği için güvenli,
    /// ama tutarsızlık dinamik bir çağıran eklendiğinde güvenli olmaktan çıkar.
    /// </remarks>
    private static string SafeIdentifier(string identifier)
    {
        foreach (char character in identifier)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character != '_')
            {
                throw new InvalidOperationException($"Şema tanımlayıcısı beklenen biçimde değil: '{identifier}'.");
            }
        }

        return identifier;
    }

    private static async Task EnsureColumnAsync(DbConnection connection, IDbContextTransaction transaction, string table, string column, string definition, CancellationToken cancellationToken)
    {
        string safeTable = SafeIdentifier(table);
        string safeColumn = SafeIdentifier(column);

        bool exists;
        await using (DbCommand probe = connection.CreateCommand())
        {
            probe.Transaction = transaction.GetDbTransaction();
            probe.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{safeTable}') WHERE name = $name";
            DbParameter parameter = probe.CreateParameter();
            parameter.ParameterName = "$name";
            parameter.Value = safeColumn;
            probe.Parameters.Add(parameter);
            exists = Convert.ToInt64(await probe.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) == 1L;
        }

        if (exists)
        {
            return;
        }

        await ExecuteAsync(connection, transaction,
            $"ALTER TABLE \"{safeTable}\" ADD COLUMN \"{safeColumn}\" {definition};",
            cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureCalculationQuantityColumnsAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);
        foreach (string column in new[] { "NetQuantity", "WithWasteQuantity", "PurchaseQuantity", "RemainderQuantity" })
        {
            await EnsureColumnAsync(connection, transaction, "CalculationResults", column, "INTEGER NOT NULL DEFAULT 0", cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task EnsureCardVersionNameColumnAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        await EnsureColumnAsync(connection, transaction, "CatalogCardVersions", "Name", "TEXT NOT NULL DEFAULT ''", cancellationToken).ConfigureAwait(false);
        await ExecuteAsync(connection, transaction,
            "UPDATE \"CatalogCardVersions\" SET \"Name\" = (SELECT \"Name\" FROM \"CatalogCardDefinitions\" WHERE \"CatalogCardDefinitions\".\"Id\" = \"CatalogCardVersions\".\"CatalogCardDefinitionId\") WHERE \"Name\" = '';",
            cancellationToken).ConfigureAwait(false);
    }

    private static async Task EnsureCalculationResultSnapshotIndexAsync(MetrajDbContext context, IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        DbConnection connection = await GetOpenConnectionAsync(context, cancellationToken).ConfigureAwait(false);

        await ExecuteAsync(connection, transaction,
            "DROP INDEX IF EXISTS \"IX_CalculationResults_ProjectRevisionId_InputHash\";",
            cancellationToken).ConfigureAwait(false);

        await ExecuteAsync(connection, transaction,
            "CREATE INDEX IF NOT EXISTS \"IX_CalculationResults_ProjectRevisionId_InputHash\" ON \"CalculationResults\" (\"ProjectRevisionId\", \"InputHash\");",
            cancellationToken).ConfigureAwait(false);
    }
}
