using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Creates EF Core contexts for the single application SQLite database.</summary>
public static class MetrajDbContextFactory
{
    /// <summary>Bir veritabanı yolu için kullanılan bağlantı dizesini üretir.</summary>
    /// <remarks>
    /// Bağlantı dizesi elle birleştirilmez: noktalı virgül bir ayraçtır ve
    /// yolun içinde geçtiğinde "Data Source" değerini erkenden bitirir.
    /// Kullanıcının klasör adında noktalı virgül bulunması yeterlidir.
    ///
    /// Ayrı bir metot olmasının nedeni, aynı veritabanının bağlantı HAVUZUNU
    /// hedefleyebilmek: <c>SqliteConnection.ClearPool</c> eşleşmeyi bağlantı
    /// dizesi üzerinden yapar, dolayısıyla birebir aynı dize gerekir.
    /// </remarks>
    /// <param name="databasePath">SQLite dosyasının tam yolu.</param>
    public static string BuildConnectionString(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        return new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            Pooling = true
        }.ToString();
    }

    /// <summary>Creates a context configured for a local SQLite database path.</summary>
    public static MetrajDbContext Create(string databasePath)
    {
        string connectionString = BuildConnectionString(databasePath);

        var options = new DbContextOptionsBuilder<MetrajDbContext>()
            .UseSqlite(connectionString)
            .Options;

        return new MetrajDbContext(options);
    }

    /// <summary>
    /// Dışarıdan sahiplenilen açık bir bağlantı üzerinde context oluşturur.
    /// </summary>
    /// <remarks>
    /// Birden çok okumanın TEK bir tutarlı anlık görüntüden yapılması için
    /// kullanılır: bağlantı ve işlem çağırana aittir, context kapanınca
    /// bağlantı kapanmaz.
    /// </remarks>
    public static MetrajDbContext Create(SqliteConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        var options = new DbContextOptionsBuilder<MetrajDbContext>()
            .UseSqlite(connection)
            .Options;

        return new MetrajDbContext(options);
    }
}
