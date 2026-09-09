namespace Metraj.Infrastructure;

/// <summary>Resolves the single application database location for the current Windows user.</summary>
public static class ApplicationDatabasePaths
{
    private const string ApplicationFolderName = "ProjeMetraj";
    private const string DatabaseFileName = "metraj.db";

    /// <summary>Returns the database file path under the user's local application data folder.</summary>
    /// <remarks>
    /// Konum seçimi iki aşamalıdır. Önce MEVCUT bir veritabanı aranır: kullanıcı
    /// verisi varsa uygulama onu bulmak zorundadır. Yalnızca hiçbir yerde
    /// veritabanı yoksa yeni bir konum seçilir. Önceki sürüm sırayla ilk yazılabilir
    /// klasörü seçiyordu; erişim iki açılış arasında değişirse uygulama, verisi
    /// duruyorken projelerini kaybetmiş gibi görünüyordu.
    /// </remarks>
    public static string GetDatabasePath()
    {
        string? overriddenDirectory = Environment.GetEnvironmentVariable("METRAJ_DATA_DIRECTORY");
        if (!string.IsNullOrWhiteSpace(overriddenDirectory))
        {
            string directory = Path.GetFullPath(overriddenDirectory);
            Directory.CreateDirectory(directory);
            string overriddenDatabasePath = Path.Combine(directory, DatabaseFileName);
            VerifyWriteAccess(directory, overriddenDatabasePath);
            return overriddenDatabasePath;
        }

        string[] basePaths =
        [
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Path.GetTempPath()
        ];
        string[] candidates = basePaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => Path.Combine(path, ApplicationFolderName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        // 1) Var olan bir veritabanı her zaman kazanır.
        Exception? lastAccessFailure = null;
        foreach (string applicationPath in candidates)
        {
            string databasePath = Path.Combine(applicationPath, DatabaseFileName);
            if (!File.Exists(databasePath)) continue;
            try
            {
                Directory.CreateDirectory(applicationPath);
                VerifyWriteAccess(applicationPath, databasePath);
                return databasePath;
            }
            catch (Exception exception) when (exception is UnauthorizedAccessException or IOException)
            {
                // Mevcut veritabanına şu an yazılamıyor; başka bir konumda
                // kopyası olabilir. Yoksa aşağıdaki hata mesajı bunu bildirir.
                lastAccessFailure = exception;
            }
        }

        // 2) Hiç veritabanı yoksa yazılabilir ilk konumda yenisi oluşturulur.
        foreach (string applicationPath in candidates)
        {
            try
            {
                Directory.CreateDirectory(applicationPath);
                string databasePath = Path.Combine(applicationPath, DatabaseFileName);
                VerifyWriteAccess(applicationPath, databasePath);
                return databasePath;
            }
            catch (Exception exception) when (exception is UnauthorizedAccessException or IOException)
            {
                // Yalnızca yetki hatası değil; disk dolu gibi IO hataları da
                // kalan adayların denenmesini engellememelidir.
                lastAccessFailure = exception;
            }
        }

        throw new IOException(
            "Uygulama verisi için yazılabilir bir klasör bulunamadı. Disk alanını ve klasör izinlerini denetleyin.",
            lastAccessFailure);
    }

    private static void VerifyWriteAccess(string applicationPath, string databasePath)
    {
        string probePath = Path.Combine(applicationPath, $".write-probe-{Guid.NewGuid():N}.tmp");
        try
        {
            using (FileStream probe = File.Open(probePath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                probe.WriteByte(0);
            }

            if (File.Exists(databasePath))
            {
                using FileStream database = File.Open(databasePath, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite);
            }
        }
        finally
        {
            if (File.Exists(probePath)) File.Delete(probePath);
        }
    }
}
