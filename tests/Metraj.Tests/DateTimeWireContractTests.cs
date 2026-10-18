using System.Globalization;
using System.Text.Json;
using Metraj.Application;
using Metraj.Host;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Zamanların tel sözleşmesi: sunucu bütün <c>*AtUtc</c> alanlarını UTC olarak ve
/// "Z" ekiyle yazar ("2026-10-17T14:45:38.41Z").
/// </summary>
/// <remarks>
/// Önceden EF Core SQLite'tan okunan zamanları <see cref="DateTimeKind.Unspecified"/>
/// verirdi ve JSON eksiz çıkardı; tarayıcı bunu yerel saat sayardı. Mobil arayüz
/// eksiz değerleri UTC kabul eden bir geçici çözüm taşıyordu, masaüstü arayüzü ise
/// saatleri UTC farkı kadar kayık gösteriyordu. Sözleşme bilerek değiştirildi; bu
/// testler hem yeni hâli hem de saklanan metnin DEĞİŞMEDİĞİNİ (göç gerekmez) sabitler.
/// </remarks>
public sealed class DateTimeWireContractTests
{
    [Fact]
    public async Task TimestampsReadFromTheDatabaseAreUtcAndCarryZOnTheWire()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-utc-wire");
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);
        ProjectListItem created = await services.Projects.CreateProjectAsync("UTC-1", "Saat dilimi");
        await services.Projects.ApproveRevisionAsync(created.LatestRevisionId);

        Assert.Equal(DateTimeKind.Utc, Assert.Single(await services.Projects.ListProjectsAsync()).CreatedAtUtc.Kind);
        ProjectRevisionListItem revision = Assert.Single(await services.Projects.ListRevisionsAsync(created.Id));
        Assert.Equal(DateTimeKind.Utc, revision.CreatedAtUtc.Kind);
        Assert.Equal(DateTimeKind.Utc, revision.ApprovedAtUtc!.Value.Kind);

        RouterResponse response = await router.DispatchAsync(
            new RouterRequest("GET", $"/api/projects/{created.Id}/revisions", null, null, null), CancellationToken.None);
        using var body = JsonDocument.Parse(response.BodyJson!);
        JsonElement wire = Assert.Single(body.RootElement.EnumerateArray());
        string createdOnWire = wire.GetProperty("createdAtUtc").GetString()!;
        Assert.EndsWith("Z", createdOnWire, StringComparison.Ordinal);
        Assert.EndsWith("Z", wire.GetProperty("approvedAtUtc").GetString(), StringComparison.Ordinal);
        Assert.Equal(revision.CreatedAtUtc,
            DateTime.Parse(createdOnWire, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));
    }

    [Fact]
    public async Task StoredTextIsUnchangedAndExistingRowsReadAsTheSameUtcInstant()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-utc-storage");
        using var services = MetrajServices.Create(database.Path);
        ProjectListItem created = await services.Projects.CreateProjectAsync("UTC-2", "Eski satır");

        await using (var connection = new SqliteConnection($"Data Source={database.Path};Pooling=False"))
        {
            await connection.OpenAsync();
            await using SqliteCommand read = connection.CreateCommand();
            read.CommandText = "SELECT CreatedAtUtc FROM Projects";
            string stored = (string)(await read.ExecuteScalarAsync())!;
            // EF Core SQLite biçimi: saat dilimi eki yok; dönüştürücü bunu değiştirmez.
            Assert.Matches(@"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,7})?$", stored);

            // Dönüştürücüden önce yazılmış bir satır.
            await using SqliteCommand legacy = connection.CreateCommand();
            legacy.CommandText = "UPDATE Projects SET CreatedAtUtc = '2026-10-17 14:45:38.41'";
            await legacy.ExecuteNonQueryAsync();
        }

        ProjectListItem project = Assert.Single(await services.Projects.ListProjectsAsync());
        Assert.Equal(created.Id, project.Id);
        Assert.Equal(new DateTime(2026, 10, 17, 14, 45, 38, 410, DateTimeKind.Utc), project.CreatedAtUtc);
        Assert.Equal(DateTimeKind.Utc, project.CreatedAtUtc.Kind);
        Assert.Contains("\"createdAtUtc\":\"2026-10-17T14:45:38.41Z\"",
            JsonSerializer.Serialize(project, MetrajRequestRouter.SerializerOptions), StringComparison.Ordinal);
    }

    [Fact]
    public void TheConverterMarksReadsAsUtcAndNormalisesLocalWrites()
    {
        var converter = new UtcDateTimeConverter();
        var toStore = (Func<DateTime, DateTime>)converter.ConvertToProviderExpression.Compile();
        var fromStore = (Func<DateTime, DateTime>)converter.ConvertFromProviderExpression.Compile();

        var stored = new DateTime(2026, 10, 17, 14, 45, 38, DateTimeKind.Unspecified);
        DateTime read = fromStore(stored);
        Assert.Equal(DateTimeKind.Utc, read.Kind);
        Assert.Equal(stored.Ticks, read.Ticks);

        DateTime utc = DateTime.UtcNow;
        Assert.Equal(utc, toStore(utc));
        DateTime local = utc.ToLocalTime();
        Assert.Equal(utc.Ticks, toStore(local).Ticks);
    }
}
