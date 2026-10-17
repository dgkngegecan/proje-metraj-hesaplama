# Temiz checkout'tan derleme

Bu depo tek bir komutla derlenir. Arayüz derlemesi build'in parçasıdır:
`dist/` sürüm kontrolünde değildir ve MSBuild tarafından üretilir.

## Gereksinimler

| Araç | Sürüm | Nereden sabitlendi |
|---|---|---|
| .NET SDK | 10.0.400 (`latestFeature` ileri sarma) | `global.json` |
| Node.js | 24.11.1 (kabul edilen aralık: >=22.12 <25) | `.nvmrc`, `package.json` → `engines` |
| npm | >=10.5.0 | `package.json` → `engines` |

Sürümler sabitlenmiştir çünkü `Directory.Build.props` içinde
`TreatWarningsAsErrors=true` ile `AnalysisLevel=latest-recommended`
birlikte kullanılıyor: farklı bir SDK'nın uyarı tabanı değiştiğinde build
kırılır.

## Komut

```bash
dotnet build Metraj.sln -c Release
```

Bu kadarı yeter. MSBuild sırasıyla:

1. `src/Metraj.Web/node_modules` yoksa `npm ci` çalıştırır,
2. arayüz kaynağı `dist/index.html`'den yeniyse `npm run build` çalıştırır
   (`tsc --noEmit` bu betiğin içindedir),
3. `dist/` altındaki her şeyi `Metraj.Api` içine gömer,
4. **`dist/index.html` yoksa build'i durdurur.**

Son madde bilinçlidir: arayüzsüz ya da eski arayüzlü bir `.exe` üretmek,
build'in kırılmasından çok daha kötüdür. Kullanıcı, düzeltildiğini sandığı
bir hatayı taşıyan bir uygulama alır ve bunu teşhis etmesinin bir yolu
yoktur.

## Arka uç döngüsünü hızlandırmak

Arayüz kaynağı değişmedikçe npm zaten çalışmaz (hedef artımlıdır).
Büsbütün atlamak için:

```bash
dotnet build Metraj.sln -p:BuildFrontend=false
```

Bu bayrakla bile **varlık doğrulaması çalışır**: `dist/` yoksa build yine
durur. Yani bayrak "arayüzü yeniden üretme" demektir, "arayüzsüz üret"
demek değildir.

## Testler

```bash
dotnet test Metraj.sln
```

## EF Core derlenmiş modeli

Uygulama EF Core modelini çalışma zamanında `OnModelCreating`'den kurmaz;
`src/Metraj.Infrastructure/CompiledModel/` altındaki, derleme anında üretilmiş
modeli kullanır (`MetrajDbContextFactory` → `UseModel(MetrajDbContextModel.Instance)`).
Önceden süreçteki ilk bağlam 17 varlığın modelini kurallarla baştan kuruyordu;
bu, Android'deki açılış süresinin büyük kalemlerinden biriydi.

**`MetrajDbContext` (`OnModelCreating`), bir varlık sınıfı, bir değer
dönüştürücüsü (ör. `ScaledDecimalConverter`) ya da `QuantityRules` ölçeği
değişirse derlenmiş model yenilenmelidir.** Derlenmiş model dönüştürücü
ifadelerini koda kopyalar (ölçek çarpanı `1000000M` sabit olarak yazılır);
yenilenmezse uygulama eski modelle ve eski ölçekle çalışır.
`CompiledModelConsistencyTests` bu durumda kırılır ve farkı listeler.

Araç bir kez kurulur (EF Core ile aynı sürüm; `Directory.Packages.props`):

```bash
dotnet tool install dotnet-ef --version 10.0.11 --tool-path <araç-klasörü>
```

Yenileme (depo kökünde):

```bash
dotnet build src/Metraj.Infrastructure/Metraj.Infrastructure.csproj -c Release
dotnet-ef dbcontext optimize \
  --project src/Metraj.Infrastructure/Metraj.Infrastructure.csproj \
  --startup-project src/Metraj.Infrastructure/Metraj.Infrastructure.csproj \
  --context MetrajDbContext --output-dir CompiledModel \
  --namespace Metraj.Infrastructure.CompiledModel \
  --configuration Release --no-build
```

Araç bağlamı `MetrajDesignTimeDbContextFactory` ile kurar (veritabanına
bağlanmaz). `Microsoft.EntityFrameworkCore.Design` yalnız Infrastructure'da ve
`PrivateAssets="all"` ile durur; uygulamaya ve tüketici projelere akmaz. EF Core
sürümü yükseltildiğinde de model yeniden üretilmelidir (üretilen kod EF'in iç
API'lerini kullanır).

## Standart kart paketi damgası

Açılıştaki "standart kart kütüphanesi denetimi" (`StarterCatalogWorkspaceService.SeedAsync`)
eklenecek bir şey yoksa kataloğu okumadan döner. Tam tohumlama bittiğinde
manifestin özeti (`ManifestDigest`, `StarterCatalogFamilyManifest.cs` metninden
ve `FamilyRevision`/`SeedRevision`'dan hesaplanır) `__StarterCatalogSeedStamp`
tablosuna yazılır; kart silmek, pasife almak, kodunu ya da aile kartının
1. sürüm niteliklerini değiştirmek SQLite tetikleyicileriyle damgayı siler.
Manifestte kart eklemek/çıkarmak özeti kendiliğinden değiştirir; elle bir şey
yapmak gerekmez. `SeedAsync`'in **ekleme kuralı** değişirse `SeedRevision`
artırılmalıdır.

## Yayın çıktısı

```bash
dotnet publish src/Metraj.Desktop/Metraj.Desktop.csproj -c Release -r win-x64 -o artifacts/ProjeMetraj-react-win-x64
```

`artifacts/` sürüm kontrolünde değildir.

## Android

Android kabuğu (`src/Metraj.Android`, saf .NET for Android `net10.0-android`)
ayrı bir çözümdedir: `Metraj.Mobile.sln` (Domain, Application, Infrastructure,
Host, Android). `Metraj.sln` ve masaüstü CI'ı Android iş yükü gerektirmez.

### Gereksinimler

| Araç | Sürüm |
|---|---|
| .NET SDK + `android` iş yükü | 10.0.400, iş yükü 36.1.x (`dotnet workload install android`) |
| Android SDK | platform `android-36`, build-tools 36.0.0 |
| JDK | 17 |
| minSdk / targetSdk | 26 / 36 |

Bu makinede araç zinciri tamamen `D:\toolchain` altındadır; her komuttan önce
`. D:\toolchain\env.ps1` çalıştırılır ve `dotnet` olarak
`D:\toolchain\dotnet\dotnet.exe` kullanılır (C: dolu).

### İmzalama anahtarı

Android'in varsayılan debug anahtarı `%LOCALAPPDATA%` (C:) altına üretilir; bu
proje onu **kullanmaz** ve anahtar depoya girmez. Anahtar her yapılandırmada
dışarıdan verilir, verilmezse derleme imzalamadan önce açık bir hatayla durur:

| Ortam değişkeni / MSBuild özelliği | Anlamı |
|---|---|
| `METRAJ_ANDROID_KEYSTORE` / `-p:MetrajAndroidKeystore` | anahtar deposunun yolu |
| `METRAJ_ANDROID_KEYSTORE_PASSWORD` / `-p:MetrajAndroidKeystorePassword` | parola; MSBuild'e `env:AD` biçiminde verin. `file:YOL` yalnız betikte geçerlidir: apksigner aynı dosyayı iki parola için okuyamıyor, betik dosyayı kendi ortamına alıp `env:` verir |
| `METRAJ_ANDROID_KEY_ALIAS` / `-p:MetrajAndroidKeyAlias` | takma ad (varsayılan `metraj`) |

Test anahtarı (JDK `keytool`, PKCS12'de anahtar parolası = depo parolası):

```powershell
keytool -genkeypair -keystore D:\toolchain\android-keys\metraj-debug.keystore -storetype PKCS12 `
        -alias metraj -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Proje Metraj Test, C=TR"
```

### Komut

```powershell
./scripts/build-android.ps1 -KeyStore D:\toolchain\android-keys\metraj-debug.keystore `
    -KeyStorePassword file:D:\toolchain\android-keys\metraj-debug.password       # arm64 (yayın)
./scripts/build-android.ps1 -Abi x64                                               # emülatör; anahtar ortamdan
./scripts/build-android.ps1 -Abi x64 -WebViewDebugging                             # ölçüm: chrome://inspect açık
```

Çıktı: `artifacts/ProjeMetraj-android/ProjeMetraj-<abi>-release.apk`. Betik
derleme günlüğünde XA0141 (16 KB sayfa hizalaması) görürse başarısız olur.

Derleme ayrıntıları (`Metraj.Android.csproj`):

- **Tam AOT** (`AndroidEnableProfiledAot=false`) ve **kısmi kırpma**
  (`TrimMode=partial`; EF Core, System.Text.Json, ClosedXML ve PDFsharp
  ayrıntılı kırpmaya dayanıklı değil). Tek mimarili APK; yayın `android-arm64`.
- **Arayüz varlıkları:** `src/Metraj.Web/dist/**` APK'nın `assets/web/` klasörüne
  girer ve `https://appassets.androidplatform.net/web/mobile.html` olarak sunulur.
  `Metraj.Api` ile aynı artımlı npm deseni: dist yoksa ya da kaynaktan eskiyse
  `npm run build` çalışır; `-p:BuildFrontend=false` ile atlanır. Her durumda
  `dist/mobile.html` ya da `dist/assets/*.js` yoksa build **durur**.
- **SQLite:** `SQLitePCLRaw.lib.e_sqlite3.android` (bionic ikilisi) ve
  `SQLitePCLRaw.lib.e_sqlite3` için `ExcludeAssets="native"`. İkincisi olmadan
  linux-x64 (glibc) ikilisi APK'ya girip Android ikilisini eziyor
  (`DllNotFoundException: e_sqlite3`) ve XA0141 uyarısı çıkıyordu.
- **WebView hata ayıklaması** Debug'da açık, Release'te kapalı;
  `-p:MetrajWebViewDebugging=true` yalnız ölçüm derlemeleri içindir.
- **İzinler:** manifestte `INTERNET` yok; Release derlemesine .NET de eklemez
  (Debug derlemesi hata ayıklayıcı için kendiliğinden ekler, bu yüzden izin
  denetimi Release APK'sında yapılır).

### Emülatörde çalıştırma

```powershell
D:\toolchain\android-sdk\emulator\emulator.exe -avd metraj35 -no-snapshot -no-audio -no-boot-anim
adb install -r artifacts\ProjeMetraj-android\ProjeMetraj-x64-release.apk
adb shell am start -W -n dev.projemetraj.app/dev.projemetraj.app.MainActivity
adb logcat -s METRAJ        # açılış adımları süreç başlangıcına göre "t+… ms" damgalı
```

Veri `FilesDir` altındadır (`metraj.db`, `backups/`); kalıcı hata günlüğü
`FilesDir/logs/metraj.log`.
