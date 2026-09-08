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
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? none = null;
        _ = none;
        System.Data.Common.DbConnection connection = context.Database.GetDbConnection();
        await connection.OpenAsync(cancellationToken);
        await using System.Data.Common.DbCommand command = connection.CreateCommand();
        command.CommandText = sql;
        object? value = await command.ExecuteScalarAsync(cancellationToken);
        return value is null or DBNull ? default : (T)Convert.ChangeType(value, typeof(T), System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        // ClearAllPools süreç genelindedir; test süiti bu yüzden seri çalışır
        // (bkz. TestAssemblyConfiguration). Yan dosyalar da temizlenmezse
        // her koşuda %TEMP% altında birikirler.
        SqliteConnection.ClearAllPools();
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
