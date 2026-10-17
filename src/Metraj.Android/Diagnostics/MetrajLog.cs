using System.Globalization;
using Android.OS;
using Android.Util;
using Microsoft.Extensions.Logging;
using AndroidProcess = Android.OS.Process;

namespace Metraj.Mobile.Diagnostics;

/// <summary>Logcat (etiket <c>METRAJ</c>) ve FilesDir altındaki kalıcı günlük.</summary>
/// <remarks>
/// Her satır süreç başlangıcından bu yana geçen süreyle damgalanır ("t+1234 ms"):
/// açılış sırası ve köprü gidiş-dönüşleri logcat'ten doğrudan ölçülür.
/// Hatalar ayrıca <c>FilesDir/logs/metraj.log</c>'a yazılır; cihazda logcat'e
/// erişilemeyen bir kullanıcıdan bile başlangıç hatasının ayrıntısı alınabilsin.
/// Önceden (spike) hatalar yalnız ekrana yazılıyordu.
/// </remarks>
internal static class MetrajLog
{
    public const string Tag = "METRAJ";
    private const long MaxLogFileBytes = 256 * 1024;
    private static readonly object FileLock = new();
    private static string? logFilePath;

    /// <summary>Kalıcı günlüğün tam yolu (başlatılmadıysa <see langword="null"/>).</summary>
    public static string? LogFilePath => logFilePath;

    /// <summary>Süreç başlangıcından bu yana geçen süre (ms).</summary>
    public static long Elapsed => SystemClock.ElapsedRealtime() - AndroidProcess.StartElapsedRealtime;

    /// <summary>Kalıcı günlük dosyasını hazırlar; çok büyümüşse baştan başlatır.</summary>
    public static void Initialize(string filesDirectory)
    {
        try
        {
            string directory = Path.Combine(filesDirectory, "logs");
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, "metraj.log");
            var info = new FileInfo(path);
            if (info.Exists && info.Length > MaxLogFileBytes)
            {
                File.Delete(path);
            }

            logFilePath = path;
        }
        catch (IOException exception)
        {
            Log.Warn(Tag, $"Günlük dosyası hazırlanamadı: {exception.Message}");
        }
        catch (UnauthorizedAccessException exception)
        {
            Log.Warn(Tag, $"Günlük dosyası hazırlanamadı: {exception.Message}");
        }
    }

    /// <summary>Zaman damgalı bilgi satırı (açılış adımları, ölçümler).</summary>
    public static void Mark(string message) =>
        Log.Info(Tag, string.Create(CultureInfo.InvariantCulture, $"t+{Elapsed} ms {message}"));

    /// <summary>Zaman damgalı ayrıntı satırı (her köprü isteği).</summary>
    public static void Debug(string message) =>
        Log.Debug(Tag, string.Create(CultureInfo.InvariantCulture, $"t+{Elapsed} ms {message}"));

    /// <summary>Uyarı: logcat ve kalıcı günlük.</summary>
    public static void Warn(string message)
    {
        Log.Warn(Tag, message);
        Append("UYARI", message, exception: null);
    }

    /// <summary>Hata: logcat ve kalıcı günlük (istisnanın tamamıyla).</summary>
    public static void Error(string message, Exception? exception)
    {
        Log.Error(Tag, exception is null ? message : $"{message}{System.Environment.NewLine}{exception}");
        Append("HATA", message, exception);
    }

    private static void Append(string level, string message, Exception? exception)
    {
        string? path = logFilePath;
        if (path is null) return;
        string line = string.Create(CultureInfo.InvariantCulture,
            $"{DateTime.UtcNow:O} [{level}] t+{Elapsed} ms {message}{System.Environment.NewLine}{(exception is null ? string.Empty : exception + System.Environment.NewLine)}");
        lock (FileLock)
        {
            try
            {
                File.AppendAllText(path, line);
            }
            catch (IOException)
            {
                // Günlüğe yazamamak asıl hatayı gizlememeli; logcat'te zaten var.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}

/// <summary>Router'ın <see cref="ILogger"/>'ını logcat'e ve kalıcı günlüğe bağlar.</summary>
/// <remarks>
/// Router alan kuralı redlerini (bilgi) ve beklenmeyen hataları (hata) yazar.
/// Masaüstünde bunlar ASP.NET Core günlüğüne gidiyordu; Android'de DI ve günlük
/// altyapısı olmadığı için tek sınıflık bir köprü yeterli.
/// </remarks>
internal sealed class LogcatLogger : ILogger
{
    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);
        if (!IsEnabled(logLevel)) return;
        string message = formatter(state, exception);
        if (logLevel >= LogLevel.Error)
        {
            MetrajLog.Error(message, exception);
        }
        else if (logLevel == LogLevel.Warning)
        {
            MetrajLog.Warn(message);
        }
        else
        {
            MetrajLog.Debug(message);
        }
    }
}
