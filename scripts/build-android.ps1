<#
.SYNOPSIS
    Proje Metraj Android APK'sını derler ve imzalar.

.DESCRIPTION
    src/Metraj.Android'i (net10.0-android, tam AOT, kısmi kırpma) tek mimari için
    derler, imzalı APK'yı artifacts/ProjeMetraj-android/ altına kopyalar.

    Araç zinciri: D:\toolchain\env.ps1 varsa önce yüklenir (DOTNET_ROOT, NuGet
    önbelleği, TEMP, Android SDK ve JDK yolları; hiçbir şey C:'ye yazılmaz).
    dotnet olarak $env:METRAJ_DOTNET, yoksa D:\toolchain\dotnet\dotnet.exe,
    yoksa PATH'teki dotnet kullanılır.

    İMZALAMA: Android'in varsayılan debug anahtarı (%LOCALAPPDATA%, C:) KULLANILMAZ.
    Anahtar parametreyle ya da ortam değişkeniyle verilir:
        -KeyStore           / METRAJ_ANDROID_KEYSTORE
        -KeyStorePassword   / METRAJ_ANDROID_KEYSTORE_PASSWORD   ("file:YOL" ya da "env:AD" önerilir)
        -KeyAlias           / METRAJ_ANDROID_KEY_ALIAS           (varsayılan: metraj)
    Test anahtarı üretmek (JDK keytool, depo DIŞINDA):
        keytool -genkeypair -keystore D:\toolchain\android-keys\metraj-debug.keystore -storetype PKCS12 `
                -alias metraj -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Proje Metraj Test, C=TR"
    PKCS12'de anahtar parolası depo parolasıyla aynıdır. Anahtar ve parola dosyası depoya girmez.

.PARAMETER Abi
    arm64 (yayın, varsayılan) ya da x64 (emülatör testi).

.PARAMETER WebViewDebugging
    Release derlemesinde WebView hata ayıklamasını açar (chrome://inspect; ölçüm için).
    Yayın APK'sı bu bayrakla ÜRETİLMEZ.

.PARAMETER SkipFrontend
    Arayüzü yeniden derleme (-p:BuildFrontend=false). dist/ yoksa derleme yine durur.

.EXAMPLE
    ./scripts/build-android.ps1 -KeyStore D:\toolchain\android-keys\metraj-debug.keystore `
        -KeyStorePassword file:D:\toolchain\android-keys\metraj-debug.password

.EXAMPLE
    ./scripts/build-android.ps1 -Abi x64 -WebViewDebugging   # anahtar ortam değişkenlerinden
#>
[CmdletBinding()]
param(
    [ValidateSet('arm64', 'x64')]
    [string] $Abi = 'arm64',
    [ValidateSet('Release', 'Debug')]
    [string] $Configuration = 'Release',
    [string] $KeyStore = $env:METRAJ_ANDROID_KEYSTORE,
    [string] $KeyStorePassword = $env:METRAJ_ANDROID_KEYSTORE_PASSWORD,
    [string] $KeyAlias = $(if ($env:METRAJ_ANDROID_KEY_ALIAS) { $env:METRAJ_ANDROID_KEY_ALIAS } else { 'metraj' }),
    [switch] $WebViewDebugging,
    [switch] $SkipFrontend
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (Test-Path 'D:\toolchain\env.ps1') { . 'D:\toolchain\env.ps1' }

$dotnet = if ($env:METRAJ_DOTNET) { $env:METRAJ_DOTNET }
          elseif (Test-Path 'D:\toolchain\dotnet\dotnet.exe') { 'D:\toolchain\dotnet\dotnet.exe' }
          else { 'dotnet' }

if (-not $KeyStore) { throw 'İmzalama anahtarı verilmedi: -KeyStore ya da METRAJ_ANDROID_KEYSTORE.' }
if (-not (Test-Path $KeyStore)) { throw "İmzalama anahtarı bulunamadı: $KeyStore" }
if (-not $KeyStorePassword) { throw 'İmzalama parolası verilmedi: -KeyStorePassword ya da METRAJ_ANDROID_KEYSTORE_PASSWORD (file:YOL önerilir).' }

# "file:YOL" → bu sürecin ortamına alınır ve MSBuild'e "env:AD" verilir. apksigner
# aynı dosyayı hem depo hem anahtar parolası için okuyamıyor (ikincisini 2. satırda
# arıyor); düz parola ise komut satırına ve ayrıntılı derleme günlüğüne düşerdi.
if ($KeyStorePassword.StartsWith('file:')) {
    $passwordFile = $KeyStorePassword.Substring(5)
    if (-not (Test-Path $passwordFile)) { throw "Parola dosyası bulunamadı: $passwordFile" }
    $env:METRAJ_ANDROID_SIGNING_SECRET = (Get-Content -Raw $passwordFile).Trim()
    $KeyStorePassword = 'env:METRAJ_ANDROID_SIGNING_SECRET'
}
elseif (-not ($KeyStorePassword.StartsWith('env:') -or $KeyStorePassword.StartsWith('pass:'))) {
    $env:METRAJ_ANDROID_SIGNING_SECRET = $KeyStorePassword
    $KeyStorePassword = 'env:METRAJ_ANDROID_SIGNING_SECRET'
}

$rid = "android-$Abi"
$project = Join-Path $repoRoot 'src\Metraj.Android\Metraj.Android.csproj'
$outDir = Join-Path $repoRoot 'artifacts\ProjeMetraj-android'
$log = Join-Path $outDir "build-$Abi.log"
New-Item -ItemType Directory -Force $outDir | Out-Null

$arguments = @(
    'build', $project,
    '-c', $Configuration,
    "-p:RuntimeIdentifier=$rid",
    "-p:MetrajAndroidKeystore=$KeyStore",
    "-p:MetrajAndroidKeystorePassword=$KeyStorePassword",
    "-p:MetrajAndroidKeyAlias=$KeyAlias",
    '-nologo', '-v:m'
)
if ($WebViewDebugging) { $arguments += '-p:MetrajWebViewDebugging=true' }
if ($SkipFrontend) { $arguments += '-p:BuildFrontend=false' }

Write-Host "Derleniyor: $Configuration $rid (günlük: $log)"
$watch = [Diagnostics.Stopwatch]::StartNew()
& $dotnet @arguments 2>&1 | Out-File -Encoding utf8 $log
$exitCode = $LASTEXITCODE
Select-String -Path $log -Pattern ': (error|warning) ' | ForEach-Object { $_.Line } | Sort-Object -Unique | Out-Host
if ($exitCode -ne 0) { throw "Derleme başarısız (çıkış kodu $exitCode). Günlük: $log" }

# 16 KB sayfa hizalaması (Android 15+ cihazlar): uyarı yalnız yanlış yerel ikili
# (ör. glibc SQLite) APK'ya girdiğinde çıkıyordu; çıkarsa yayın kabul edilmez.
if (Select-String -Path $log -Pattern 'XA0141' -Quiet) { throw "XA0141 (16 KB sayfa hizalaması) uyarısı çıktı. Günlük: $log" }

$built = Get-ChildItem (Join-Path $repoRoot "src\Metraj.Android\bin\$Configuration\net10.0-android\$rid") -Filter '*-Signed.apk' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $built) { throw 'İmzalı APK bulunamadı.' }

$suffix = if ($WebViewDebugging) { '-webviewdebug' } else { '' }
$target = Join-Path $outDir "ProjeMetraj-$Abi-$($Configuration.ToLowerInvariant())$suffix.apk"
Copy-Item $built.FullName $target -Force
$sizeMb = [Math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host ("APK: {0} ({1} MB, {2:N0} s)" -f $target, $sizeMb, $watch.Elapsed.TotalSeconds)
