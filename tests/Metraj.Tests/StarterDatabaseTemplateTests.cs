using System.Security.Cryptography;
using Metraj.Application;
using Metraj.Host;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Android APK'sına şablon olarak giren veritabanı (<see cref="StarterDatabaseTemplate"/>), aynı sürümün
/// boş veritabanında göç + tohumlama ile ürettiğiyle aynı olmalı: şema, satırlar, tohumlama damgası ve
/// bütünlük. Aksi hâlde "ilk açılış hızlandı" iddiası, farklı bir veritabanıyla açılan uygulamaya dönüşür.
/// </summary>
public sealed class StarterDatabaseTemplateTests
{
    // Her çalıştırmada değişen sütunlar: kimlikler (Guid) ve zaman damgaları.
    private static bool IsVolatileColumn(string name) =>
        name.Equals("Id", StringComparison.Ordinal)
        || name.EndsWith("Id", StringComparison.Ordinal)
        || name.EndsWith("Utc", StringComparison.Ordinal);

    [Fact]
    public async Task TemplateMatchesMigrationPlusSeedingOnAnEmptyDatabase()
    {
        await using var reference = TestDatabase.Reserve("metraj-template-reference");
        await using var template = TestDatabase.Reserve("metraj-template-built");
        await StarterDatabaseTemplate.CreateAsync(template.Path);

        // Referans: uygulamanın boş veritabanında ilk kurulumda yaptığı iş (AppStartup / DevServer sırası).
        Assert.False(await ApplicationSchemaMigrator.IsUpToDateAsync(reference.Path));
        await using (MetrajDbContext context = MetrajDbContextFactory.Create(reference.Path))
        {
            await ApplicationSchemaMigrator.MigrateAsync(context);
        }

        StarterCatalogSeedResult seeded = await new StarterCatalogWorkspaceService(reference.Path).SeedAsync();
        Assert.True(seeded.AddedCount > 700, "Referans tohumlama standart kartları eklemeliydi.");
        SqliteConnection.ClearAllPools();

        // 1) Şema: tablolar, dizinler, tetikleyiciler ve metinleri birebir.
        Assert.Equal(await ReadSchemaAsync(reference.Path), await ReadSchemaAsync(template.Path));
        Assert.Equal(await ScalarAsync(reference.Path, "PRAGMA user_version;"), await ScalarAsync(template.Path, "PRAGMA user_version;"));

        // 2) Satırlar: her tabloda aynı sayıda ve (kimlik/zaman damgası dışında) aynı içerikte.
        IReadOnlyList<string> tables = await ReadTableNamesAsync(reference.Path);
        Assert.Contains("CatalogCardDefinitions", tables);
        foreach (string table in tables)
        {
            IReadOnlyList<string> expected = await ReadRowsAsync(reference.Path, table);
            IReadOnlyList<string> actual = await ReadRowsAsync(template.Path, table);
            Assert.True(expected.SequenceEqual(actual), $"{table} tablosu şablonda farklı ({expected.Count} / {actual.Count} satır).");
        }

        long cards = long.Parse(await ScalarAsync(template.Path, "SELECT COUNT(*) FROM \"CatalogCardDefinitions\";"), System.Globalization.CultureInfo.InvariantCulture);
        Assert.True(cards >= 733, $"Şablonda {cards} kart var; standart paket eksik.");

        // 3) Tohumlama damgası: manifest özeti geçerli, hedef sayısı aynı.
        Assert.Equal(StarterCatalogWorkspaceService.ManifestDigest, await ScalarAsync(template.Path, "SELECT \"ManifestDigest\" FROM \"__StarterCatalogSeedStamp\" WHERE \"Id\" = 1;"));
        Assert.Equal(
            await ScalarAsync(reference.Path, "SELECT \"TargetCount\" FROM \"__StarterCatalogSeedStamp\" WHERE \"Id\" = 1;"),
            await ScalarAsync(template.Path, "SELECT \"TargetCount\" FROM \"__StarterCatalogSeedStamp\" WHERE \"Id\" = 1;"));

        // 4) Bütünlük: veritabanı sağlam, yabancı anahtarlar tutarlı, kullanıcı verisi yok.
        Assert.Equal("ok", await ScalarAsync(template.Path, "PRAGMA integrity_check;"));
        Assert.Equal(0, await CountRowsAsync(template.Path, "PRAGMA foreign_key_check;"));
        Assert.Equal("0", await ScalarAsync(template.Path, "SELECT COUNT(*) FROM \"Projects\";"));
    }

    [Fact]
    public async Task TemplateOpensAsAnUpToDateSeededDatabaseWithoutWritingAnything()
    {
        await using var template = TestDatabase.Reserve("metraj-template-open");
        await StarterDatabaseTemplate.CreateAsync(template.Path);
        string before = await HashAsync(template.Path);

        // Uygulamanın açılışta yaptığı: şema güncel mi? → hayır göç yok; tohumlama damgası → hiçbir şey eklenmez.
        Assert.True(await ApplicationSchemaMigrator.IsUpToDateAsync(template.Path));
        StarterCatalogSeedResult seed = await new StarterCatalogWorkspaceService(template.Path).SeedAsync();
        Assert.Equal(0, seed.AddedCount);
        Assert.True(seed.ExistingCount > 0);

        // Gerçek servislerle de açılır ve okunur (EF yolu): proje yok, kütüphane dolu.
        using (var services = MetrajServices.Create(template.Path))
        {
            Assert.Empty(await services.Projects.ListProjectsAsync());
            Assert.True((await services.Catalog.ListCardsAsync()).Count >= 733);
        }

        SqliteConnection.ClearAllPools();
        Assert.Equal(before, await HashAsync(template.Path));
        Assert.False(File.Exists(template.Path + "-journal"));
    }

    [Fact]
    public async Task CreateReplacesAnExistingFileAndLeavesNoSidecarFiles()
    {
        await using var template = TestDatabase.Reserve("metraj-template-replace");
        await File.WriteAllTextAsync(template.Path, "bozuk içerik");

        await StarterDatabaseTemplate.CreateAsync(template.Path);

        Assert.Equal("ok", await ScalarAsync(template.Path, "PRAGMA integrity_check;"));
        SqliteConnection.ClearAllPools();
        Assert.False(File.Exists(template.Path + "-wal"));
        Assert.False(File.Exists(template.Path + "-shm"));
        Assert.False(File.Exists(template.Path + "-journal"));
    }

    // --- Yardımcılar --------------------------------------------------------

    private static async Task<SqliteConnection> OpenReadOnlyAsync(string path)
    {
        var connection = new SqliteConnection($"Data Source={path};Mode=ReadOnly;Pooling=False");
        await connection.OpenAsync();
        return connection;
    }

    private static async Task<string> ScalarAsync(string path, string sql)
    {
        await using SqliteConnection connection = await OpenReadOnlyAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToString(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
    }

    private static async Task<int> CountRowsAsync(string path, string sql)
    {
        await using SqliteConnection connection = await OpenReadOnlyAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = sql;
        await using SqliteDataReader reader = await command.ExecuteReaderAsync();
        int count = 0;
        while (await reader.ReadAsync()) count++;
        return count;
    }

    private static async Task<IReadOnlyList<string>> ReadSchemaAsync(string path)
    {
        await using SqliteConnection connection = await OpenReadOnlyAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;";
        var rows = new List<string>();
        await using SqliteDataReader reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add($"{reader.GetString(0)}|{reader.GetString(1)}|{reader.GetString(2)}|{reader.GetString(3)}");
        }

        return rows;
    }

    private static async Task<IReadOnlyList<string>> ReadTableNamesAsync(string path)
    {
        await using SqliteConnection connection = await OpenReadOnlyAsync(path);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;";
        var names = new List<string>();
        await using SqliteDataReader reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) names.Add(reader.GetString(0));
        return names;
    }

    /// <summary>Tablonun kimlik ve zaman damgası dışındaki sütunları, satır metni olarak sıralı.</summary>
    private static async Task<IReadOnlyList<string>> ReadRowsAsync(string path, string table)
    {
        await using SqliteConnection connection = await OpenReadOnlyAsync(path);
        var columns = new List<string>();
        await using (SqliteCommand info = connection.CreateCommand())
        {
            info.CommandText = $"SELECT name FROM pragma_table_info('{table}') ORDER BY cid;";
            await using SqliteDataReader reader = await info.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                string name = reader.GetString(0);
                if (!IsVolatileColumn(name)) columns.Add(name);
            }
        }

        if (columns.Count == 0)
        {
            // Yalnız kimlik/zaman sütunları olan tabloda satır sayısı karşılaştırılır.
            return [await ScalarAsync(path, $"SELECT COUNT(*) FROM \"{table}\";")];
        }

        await using SqliteCommand select = connection.CreateCommand();
        select.CommandText = $"SELECT {string.Join(", ", columns.Select(column => $"\"{column}\""))} FROM \"{table}\";";
        var rows = new List<string>();
        await using SqliteDataReader data = await select.ExecuteReaderAsync();
        while (await data.ReadAsync())
        {
            string[] cells = new string[data.FieldCount];
            for (int index = 0; index < cells.Length; index++)
            {
                cells[index] = data.IsDBNull(index) ? "∅" : Convert.ToString(data.GetValue(index), System.Globalization.CultureInfo.InvariantCulture) ?? "∅";
            }

            rows.Add(string.Join("\u001f", cells));
        }

        rows.Sort(StringComparer.Ordinal);
        return rows;
    }

    private static async Task<string> HashAsync(string path)
    {
        SqliteConnection.ClearAllPools();
        await using FileStream stream = new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream));
    }
}
