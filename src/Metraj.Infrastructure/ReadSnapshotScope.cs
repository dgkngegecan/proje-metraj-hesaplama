using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>
/// Birden çok okumayı TEK bir tutarlı veritabanı anlık görüntüsüne bağlar.
/// </summary>
/// <remarks>
/// Rapor, parçalarını ayrı ayrı çalışan servislerden toplar ve her biri kendi
/// bağlantısını açıyordu. Okumalar arasına giren bir yazma; kaynak satırları,
/// özetler, sorumluluklar ve hesapları farklı anlardan getirebiliyor, rapor
/// kendi içinde tutarsız olabiliyordu (kaynak toplamı ile özet net miktarı
/// birbirini tutmayabiliyordu).
///
/// Kapsam açıkken bütün alt servisler aynı bağlantıyı ve aynı okuma işlemini
/// paylaşır. Yalnızca OKUMA için kullanılır; denetim kaydı gibi yazmalar
/// kapsamın dışında, kendi bağlantılarıyla yapılmaya devam eder.
/// </remarks>
public sealed class ReadSnapshotScope : IAsyncDisposable
{
    private readonly SqliteConnection connection;
    private readonly DbTransaction transaction;

    private ReadSnapshotScope(SqliteConnection connection, DbTransaction transaction)
    {
        this.connection = connection;
        this.transaction = transaction;
    }

    /// <summary>Alt servislere verilecek, anlık görüntüye bağlı context üreticisi.</summary>
    public Func<MetrajDbContext> ContextFactory => () =>
    {
        MetrajDbContext scoped = MetrajDbContextFactory.Create(connection);
        scoped.Database.UseTransaction(transaction);
        return scoped;
    };

    /// <summary>Mevcut bir context üreticisinin veritabanı için okuma kapsamı açar.</summary>
    public static async Task<ReadSnapshotScope> OpenAsync(
        Func<MetrajDbContext> contextFactory, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(contextFactory);

        string connectionString;
        await using (MetrajDbContext probe = contextFactory())
        {
            connectionString = probe.Database.GetConnectionString()
                ?? throw new InvalidOperationException("Uygulama veritabanı bağlantı dizesi çözülemedi.");
        }

        var connection = new SqliteConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            DbTransaction transaction = await connection.BeginTransactionAsync(cancellationToken);
            return new ReadSnapshotScope(connection, transaction);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        // Yalnızca okuma yapıldı; geri alma en ucuz ve en güvenli kapanıştır.
        try
        {
            await transaction.RollbackAsync();
        }
        catch (InvalidOperationException)
        {
            // İşlem zaten kapanmışsa kapanış akışını bozmaz.
        }

        await transaction.DisposeAsync();
        await connection.DisposeAsync();
    }
}
