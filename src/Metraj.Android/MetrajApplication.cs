using Android.Runtime;
using Metraj.Mobile.Bridge;
using Metraj.Mobile.Diagnostics;

namespace Metraj.Mobile;

/// <summary>Süreç düzeyindeki giriş noktası.</summary>
/// <remarks>
/// Veritabanı hazırlığı etkinlik oluşturulmadan, sürecin ilk yönetilen kodunda
/// başlatılır: etkinliğin, açılış ekranının ve WebView'ın kurulumu (birkaç yüz
/// ms) göç/tohumlama/ısındırma ile üst üste biner.
/// </remarks>
// Tam nitelikli: Metraj ad alanı içinde "Application" önce Metraj.Application ad alanına çözülür.
[global::Android.App.Application(Name = "dev.projemetraj.app.MetrajApplication")]
internal sealed class MetrajApplication : global::Android.App.Application
{
    /// <summary>Derlemede üretilen şablon veritabanının varlık adı (Metraj.Android.csproj → GenerateStarterDatabaseTemplate).</summary>
    private const string StarterTemplateAsset = "metraj-template.db";

    public MetrajApplication(IntPtr handle, JniHandleOwnership ownership)
        : base(handle, ownership)
    {
    }

    public override void OnCreate()
    {
        base.OnCreate();
        string filesDirectory = FilesDir!.AbsolutePath;
        MetrajLog.Initialize(filesDirectory);
        MetrajLog.Mark("süreç: Application.OnCreate");
        AppStartup.Start(filesDirectory, () => Assets!.Open(StarterTemplateAsset));
        ExportStore.Initialize(Path.Combine(CacheDir!.AbsolutePath, "exports"));
    }
}
