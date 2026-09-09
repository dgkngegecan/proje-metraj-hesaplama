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

## Yayın çıktısı

```bash
dotnet publish src/Metraj.Desktop/Metraj.Desktop.csproj -c Release -r win-x64 -o artifacts/ProjeMetraj-react-win-x64
```

`artifacts/` sürüm kontrolünde değildir.
