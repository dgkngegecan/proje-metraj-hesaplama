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
