using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Tests;

/// <summary>
/// Tek kullanımlık, göç edilmiş bir SQLite veritabanı. Testlerin her birinde
/// tekrarlanan "geçici yol üret / migrate et / finally'de havuzları temizle ve
/// yan dosyaları sil" iskeletini tek yerde toplar.
/// </summary>
public sealed class TestDatabase : IAsyncDisposable
{
    private TestDatabase(string path) => Path = path;

    /// <summary>Bu teste ait yalıtılmış veritabanı dosyasının tam yolu.</summary>
    public string Path { get; }

    /// <summary>Servislerin beklediği kısa ömürlü context üreticisi.</summary>
    public Func<MetrajDbContext> ContextFactory => () => MetrajDbContextFactory.Create(Path);

    /// <summary>
    /// Yalnızca kullanılmamış bir dosya YOLU ayırır; veritabanını oluşturmaz.
    /// </summary>
    /// <remarks>
    /// Bazı testler veritabanının o an oluşturulduğunu doğrular (ör.
    /// <c>EnsureCreated()</c>'in true dönmesi). <see cref="CreateAsync"/>
    /// şemayı zaten uyguladığı için o testlerde anlamı bozar. Bu üretici,
    /// paylaşılan temizliği (havuz boşaltma + WAL/SHM yan dosyaları)
    /// korurken dosyayı dokunulmamış bırakır.
    /// </remarks>
    /// <param name="prefix">Geçici dosya adının ön eki.</param>
    public static TestDatabase Reserve(string prefix = "metraj-test") =>
        new(System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"{prefix}-{Guid.NewGuid():N}.db"));

    /// <summary>Yeni bir geçici veritabanı oluşturur ve şemayı uygular.</summary>
    public static async Task<TestDatabase> CreateAsync(string prefix = "metraj-test")
    {
        var database = new TestDatabase(System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), $"{prefix}-{Guid.NewGuid():N}.db"));
        await database.MigrateAsync();
        return database;
    }

    /// <summary>Şema göçünü (yeniden) çalıştırır; yükseltme adımlarını test etmek için de kullanılır.</summary>
    public async Task MigrateAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = MetrajDbContextFactory.Create(Path);
        await ApplicationSchemaMigrator.MigrateAsync(context, cancellationToken);
    }

    /// <summary>Eski şema durumlarını kurmak için ham SQL çalıştırır.</summary>
    public async Task ExecuteAsync(string sql, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = MetrajDbContextFactory.Create(Path);
        await context.Database.ExecuteSqlRawAsync(sql, cancellationToken);
    }

    /// <summary>Tek bir skaler değer okur.</summary>
    public async Task<T?> ScalarAsync<T>(string sql, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = MetrajDbContextFactory.Create(Path);
        System.Data.Common.DbConnection connection = context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        await using System.Data.Common.DbCommand command = connection.CreateCommand();
        command.CommandText = sql;
        object? value = await command.ExecuteScalarAsync(cancellationToken);
        return value is null or DBNull ? default : (T)Convert.ChangeType(value, typeof(T), System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Yalnızca verilen veritabanının bağlantı havuzunu boşaltır.</summary>
    /// <remarks>
    /// <c>SqliteConnection.ClearAllPools()</c> SÜREÇ GENELİNDE bütün havuzları
    /// boşaltır; paralel çalışan başka bir testin açık yerel tanıtıcısını
    /// geçersiz kılabilir. Eşleşme bağlantı dizesi üzerinden yapıldığı için
    /// dize, üretimde kullanılanın birebir aynısı olmalıdır.
    /// </remarks>
    /// <param name="databasePath">Havuzu boşaltılacak veritabanının yolu.</param>
    public static void ClearPoolFor(string databasePath)
    {
        using var pooled = new SqliteConnection(MetrajDbContextFactory.BuildConnectionString(databasePath));
        SqliteConnection.ClearPool(pooled);
    }

    /// <summary>
    /// Bir klasördeki bütün SQLite dosyalarının havuzunu boşaltır ve klasörü siler.
    /// </summary>
    /// <remarks>
    /// Yedek klasörleri, ana veritabanından FARKLI bağlantı dizelerine sahip
    /// dosyalar içerir; onların havuzu ayrıca boşaltılmazsa klasör silinemez
    /// ("dosya başka bir işlem tarafından kullanılıyor"). Süreç geneli
    /// <c>ClearAllPools</c> yerine dosya dosya boşaltılır.
    /// </remarks>
    /// <param name="directory">Silinecek klasör.</param>
    public static void DeleteDirectoryWithDatabases(string directory)
    {
        if (!Directory.Exists(directory)) return;

        foreach (string file in Directory.EnumerateFiles(directory, "*.db", SearchOption.AllDirectories))
        {
            ClearPoolFor(file);
        }

        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
            // Sızan bir geçici klasör, geçen bir testi başarısız yapmamalı.
        }
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        // Yalnızca BU veritabanının havuzu temizlenir.
        //
        // Önceden `ClearAllPools()` çağrılıyordu; o çağrı SÜREÇ GENELİNDE
        // bütün havuzları boşaltır, yani bir testin temizliği başka bir
        // testin açık yerel tanıtıcısını geçersiz kılabilir. Süitin tamamının
        // seri çalışmak zorunda kalmasının nedeni buydu. `ClearPool`
        // eşleşmeyi bağlantı dizesi üzerinden yaptığı ve her testin dosya
        // yolu benzersiz olduğu için testler artık birbirini etkilemiyor.
        //
        // Havuzun boşaltılması gerekiyor: yerel tanıtıcı açık kaldığı sürece
        // dosya silinemez ve yan dosyalar %TEMP% altında birikir.
        ClearPoolFor(Path);

        Delete(Path);
        Delete($"{Path}-wal");
        Delete($"{Path}-shm");
        return ValueTask.CompletedTask;
    }

    private static void Delete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException)
        {
            // Sızan bir geçici dosya, geçen bir testi başarısız yapmamalı.
        }
    }
}
