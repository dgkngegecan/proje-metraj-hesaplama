using Metraj.Api;
using Metraj.Infrastructure;

// Geliştirme sunucusu: masaüstü uygulamasının açılış sırasını (göç → standart
// katalog → API) pencere olmadan çalıştırır ve adresi yazdırır.
//
//   dotnet run --project tools/Metraj.DevServer -- [--db <yol>] [--url-file <yol>] [--fresh]
//
// --db        SQLite dosyası (varsayılan: %TEMP%\metraj-dev\metraj.db). Gerçek
//             kullanıcı veritabanına (%LOCALAPPDATA%\ProjeMetraj) hiç dokunulmaz.
// --url-file  Adres bu dosyaya da yazılır; betikler ve Playwright buradan okur.
// --fresh     Başlamadan önce veritabanını ve yan dosyalarını siler.
//
// Arayüz, gömülü dist'ten {adres}/ (masaüstü) ve {adres}/mobile.html (telefon)
// olarak sunulur. Canlı geliştirme için: METRAJ_API_URL={adres} npm run dev
string databasePath = Path.Combine(Path.GetTempPath(), "metraj-dev", "metraj.db");
string? urlFile = null;
bool fresh = false;
for (int index = 0; index < args.Length; index++)
{
    switch (args[index])
    {
        case "--db" when index + 1 < args.Length:
            databasePath = Path.GetFullPath(args[++index]);
            break;
        case "--url-file" when index + 1 < args.Length:
            urlFile = Path.GetFullPath(args[++index]);
            break;
        case "--fresh":
            fresh = true;
            break;
        default:
            Console.Error.WriteLine($"Bilinmeyen bağımsız değişken: {args[index]}");
            return 2;
    }
}

Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);
if (fresh)
{
    foreach (string file in new[] { databasePath, databasePath + "-wal", databasePath + "-shm" })
    {
        File.Delete(file);
    }
}

if (!await ApplicationSchemaMigrator.IsUpToDateAsync(databasePath))
{
    await using MetrajDbContext context = MetrajDbContextFactory.Create(databasePath);
    await ApplicationSchemaMigrator.MigrateAsync(context);
}

await new StarterCatalogWorkspaceService(databasePath).SeedAsync();

await using LocalApiHost host = await LocalApiHost.StartAsync(databasePath);
string address = host.BaseUri.ToString().TrimEnd('/');
if (urlFile is not null)
{
    Directory.CreateDirectory(Path.GetDirectoryName(urlFile)!);
    await File.WriteAllTextAsync(urlFile, address);
}

Console.WriteLine($"Veritabanı: {databasePath}");
Console.WriteLine($"METRAJ_API_URL={address}");
Console.WriteLine($"Masaüstü: {address}/   Telefon: {address}/mobile.html");
Console.WriteLine("Durdurmak için Ctrl+C.");

using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    stop.Cancel();
};
try
{
    await Task.Delay(Timeout.Infinite, stop.Token);
}
catch (OperationCanceledException)
{
    // Ctrl+C: normal kapanış.
}

return 0;
