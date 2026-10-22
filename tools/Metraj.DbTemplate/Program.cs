using Metraj.Infrastructure;

// Kullanım: dotnet run --project tools/Metraj.DbTemplate -- --out <yol>
// Göç edilmiş + standart katalogla tohumlanmış şablon veritabanını <yol>'a yazar ve doğrular.
string? output = null;
for (int index = 0; index < args.Length; index++)
{
    if (args[index] == "--out" && index + 1 < args.Length)
    {
        output = Path.GetFullPath(args[++index]);
    }
    else
    {
        Console.Error.WriteLine($"Bilinmeyen bağımsız değişken: {args[index]}");
        return 2;
    }
}

if (output is null)
{
    Console.Error.WriteLine("Kullanım: Metraj.DbTemplate --out <yol>");
    return 2;
}

var watch = System.Diagnostics.Stopwatch.StartNew();
await StarterDatabaseTemplate.CreateAsync(output);
Console.WriteLine($"Şablon veritabanı hazır: {output} ({new FileInfo(output).Length / 1024} KB, {watch.Elapsed.TotalSeconds:0.0} s)");
return 0;
