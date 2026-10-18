using System.Collections.Concurrent;
using Metraj.Host;
using Metraj.Mobile.Diagnostics;

namespace Metraj.Mobile.Bridge;

/// <summary>Arayüze tutamaçla verilen indirme dosyası.</summary>
/// <param name="Handle">Opak tutamaç (32 onaltılık karakter).</param>
/// <param name="Path">Dosyanın tam yolu (<c>CacheDir/exports/&lt;tutamaç&gt;/&lt;ad&gt;</c>).</param>
/// <param name="Name">Kullanıcıya gösterilen dosya adı.</param>
/// <param name="Mime">MIME türü.</param>
/// <param name="Size">Bayt cinsinden boyut.</param>
internal sealed record ExportedFile(string Handle, string Path, string Name, string Mime, long Size);

/// <summary>Router'ın ürettiği dosyaları paylaşım/kaydetme için tutar.</summary>
/// <remarks>
/// Sözleşme gereği ikili içerik köprüden geçmez: router dosyayı geçici klasöre
/// yazar, burada <c>CacheDir/exports/&lt;tutamaç&gt;/&lt;ad&gt;</c>'a taşınır ve
/// arayüze yalnız tutamaç gider. Ayrı klasör, FileProvider'ın paylaşılan dosyaya
/// gerçek adını (rapor adı) vermesini sağlar; aynı adlı iki rapor çakışmaz.
/// Tutamaç yalnız onaltılık karakterlerden oluşur ve klasör adı olarak
/// kullanılmadan önce doğrulanır: arayüzden gelen bir değer yol olarak
/// yorumlanıp önbellek dışına çıkamaz.
///
/// Paylaşım hedefi dosyayı ne zaman okuyacağını bilmediğimiz için paylaşılan
/// dosya hemen silinemez. Kullanılmayan tutamaçlar 1 saatten eskiyse açılışta
/// ve 15 dakikada bir silinir; "Cihaza kaydet" kopyası bitince ve "Dosya hazır"
/// panelinden vazgeçilince (<c>release</c> komutu) hemen silinir.
/// </remarks>
internal static class ExportStore
{
    private static readonly TimeSpan MaxAge = TimeSpan.FromHours(1);
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(15);
    private static readonly ConcurrentDictionary<string, ExportedFile> Files = new(StringComparer.Ordinal);
    private static string? root;
    private static Timer? sweepTimer;

    /// <summary>Kök klasörü ayarlar ve süresi dolmuş dışa aktarımları arka planda temizler.</summary>
    public static void Initialize(string exportsDirectory)
    {
        root = exportsDirectory;
        // İlk tarama hemen (arka planda), sonra periyodik.
        sweepTimer ??= new Timer(_ => Sweep(), null, TimeSpan.Zero, SweepInterval);
    }

    /// <summary>Router dosyasını tutamaç klasörüne alır.</summary>
    public static ExportedFile Store(RouterFile file)
    {
        ArgumentNullException.ThrowIfNull(file);
        string exportsRoot = root ?? throw new InvalidOperationException("Dışa aktarım klasörü ayarlanmadı.");
        string handle = Guid.NewGuid().ToString("N");
        string directory = Path.Combine(exportsRoot, handle);
        Directory.CreateDirectory(directory);
        string name = SafeFileName(file.DownloadName, file.Path);
        string target = Path.Combine(directory, name);
        try
        {
            if (file.DeleteWhenDone)
            {
                File.Move(file.Path, target);
            }
            else
            {
                File.Copy(file.Path, target);
            }
        }
        catch
        {
            TryDeleteDirectory(directory);
            if (file.DeleteWhenDone) TryDeleteFile(file.Path);
            throw;
        }

        var exported = new ExportedFile(handle, target, name, file.ContentType, new FileInfo(target).Length);
        Files[handle] = exported;
        return exported;
    }

    /// <summary>Arayüzden gelen tutamacı çözer; geçersiz ya da süresi dolmuşsa <see langword="false"/>.</summary>
    public static bool TryGet(string? handle, out ExportedFile file)
    {
        file = null!;
        if (!IsValidHandle(handle)) return false;
        if (!Files.TryGetValue(handle!, out ExportedFile? found) || !File.Exists(found.Path))
        {
            Files.TryRemove(handle!, out _);
            return false;
        }

        file = found;
        return true;
    }

    /// <summary>Tutamacı ve dosyasını hemen siler ("Cihaza kaydet" bittiğinde ya da arayüz <c>release</c> gönderdiğinde).</summary>
    /// <remarks>Tutamaç arayüzden gelebilir: önce doğrulanır, geçersizse hiçbir şey silinmez.</remarks>
    public static void Release(string? handle)
    {
        if (!IsValidHandle(handle) || root is null) return;
        Files.TryRemove(handle!, out _);
        if (TryDeleteDirectory(Path.Combine(root, handle!))) MetrajLog.Mark($"dışa aktarım bırakıldı: {handle}");
    }

    private static void Sweep()
    {
        string? exportsRoot = root;
        if (exportsRoot is null || !Directory.Exists(exportsRoot)) return;
        DateTime threshold = DateTime.UtcNow - MaxAge;
        int removed = 0;
        try
        {
            foreach (string directory in Directory.EnumerateDirectories(exportsRoot))
            {
                if (Directory.GetLastWriteTimeUtc(directory) >= threshold) continue;
                Files.TryRemove(Path.GetFileName(directory), out _);
                if (TryDeleteDirectory(directory)) removed++;
            }
        }
        catch (IOException exception)
        {
            MetrajLog.Warn($"Dışa aktarım temizliği yarım kaldı: {exception.Message}");
        }

        if (removed > 0) MetrajLog.Mark($"{removed} eski dışa aktarım silindi");
    }

    private static bool IsValidHandle(string? handle) =>
        handle is { Length: 32 } && handle.All(character => char.IsAsciiHexDigitLower(character));

    /// <summary>Dosya adından yol ve geçersiz karakterleri ayıklar; boşsa üretilen dosyanın adına düşer.</summary>
    private static string SafeFileName(string? downloadName, string fallbackPath)
    {
        string name = Path.GetFileName(downloadName ?? string.Empty);
        foreach (char invalid in Path.GetInvalidFileNameChars())
        {
            name = name.Replace(invalid, '_');
        }

        name = name.Trim().TrimStart('.');
        if (name.Length == 0) name = Path.GetFileName(fallbackPath);
        return name.Length == 0 ? "dosya" : name;
    }

    private static bool TryDeleteDirectory(string directory)
    {
        try
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
