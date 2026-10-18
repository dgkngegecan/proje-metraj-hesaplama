using Metraj.Application;
using Microsoft.Data.Sqlite;

namespace Metraj.Infrastructure;

/// <summary>
/// Göç edilmiş ve standart katalogla tohumlanmış, boş bir uygulama veritabanını üretir
/// (Android APK'sına "şablon" varlığı olarak girer).
/// </summary>
/// <remarks>
/// Önceden ilk kurulumda telefon boş bir veritabanına göçü (EF Core'un ilk kurulumu
/// dahil) ve 733 kartlık tohumlamayı kendisi yapıyordu; emülatörde 15-30 s boyunca
/// arayüz boş bir kabukla bekliyordu. Aynı iki adım (<c>MigrateAsync</c> →
/// <c>SeedAsync</c>) artık derlemede bir kez çalışır ve ilk açılışta dosya kopyalanır.
/// Şablonun, aynı sürümün boş veritabanında göç + tohumlama ile ürettiğiyle
/// aynı olduğu <c>StarterDatabaseTemplateTests</c>'te kanıtlanır; ikilisi depoya
/// girmez, her derlemede üretilir.
/// </remarks>
public static class StarterDatabaseTemplate
{
    /// <summary>
    /// <paramref name="databasePath"/> yoluna şablonu yazar (varsa önce silinir) ve doğrular.
    /// Doğrulama başarısızsa istisna fırlatır: derleme bozuk bir şablonla sessizce devam etmesin.
    /// </summary>
    /// <param name="databasePath">Üretilecek SQLite dosyasının tam yolu.</param>
    /// <param name="cancellationToken">İptal belirteci.</param>
    public static async Task CreateAsync(string databasePath, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        string? directory = Path.GetDirectoryName(Path.GetFullPath(databasePath));
        if (directory is not null) Directory.CreateDirectory(directory);
        DeleteDatabaseFiles(databasePath);

        // Uygulamanın ilk kurulumda izlediği sıranın aynısı (AppStartup / DevServer):
        // şema güncel değilse göç, sonra tohumlama (damga yazılır).
        if (!await ApplicationSchemaMigrator.IsUpToDateAsync(databasePath, cancellationToken))
        {
            await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
            await ApplicationSchemaMigrator.MigrateAsync(context, cancellationToken);
        }

        await new StarterCatalogWorkspaceService(databasePath).SeedAsync(cancellationToken);

        // Havuzdaki bağlantılar dosyayı açık tutar; kopyalanmadan önce kapanmalı.
        SqliteConnection.ClearAllPools();
        await VerifyAsync(databasePath, cancellationToken);
        SqliteConnection.ClearAllPools();
    }

    private static async Task VerifyAsync(string databasePath, CancellationToken cancellationToken)
    {
        if (!await ApplicationSchemaMigrator.IsUpToDateAsync(databasePath, cancellationToken))
        {
            throw new InvalidOperationException("Şablon veritabanında şema güncel değil.");
        }

        // Damga eşleşiyorsa tohumlama hiçbir şey eklemez ve katalogu okumaz.
        StarterCatalogSeedResult seed = await new StarterCatalogWorkspaceService(databasePath).SeedAsync(cancellationToken);
        if (seed.AddedCount != 0)
        {
            throw new InvalidOperationException("Şablon tohumlama damgası geçerli değil: ikinci tohumlama kart ekledi.");
        }

        await using var connection = new SqliteConnection(MetrajDbContextFactory.BuildConnectionString(databasePath));
        await connection.OpenAsync(cancellationToken);
        await using SqliteCommand integrity = connection.CreateCommand();
        integrity.CommandText = "PRAGMA integrity_check;";
        string? result = (string?)await integrity.ExecuteScalarAsync(cancellationToken);
        if (!string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Şablon veritabanı bütünlük denetiminden geçmedi: {result}");
        }
    }

    private static void DeleteDatabaseFiles(string databasePath)
    {
        foreach (string file in new[] { databasePath, databasePath + "-journal", databasePath + "-wal", databasePath + "-shm" })
        {
            if (File.Exists(file)) File.Delete(file);
        }
    }
}
