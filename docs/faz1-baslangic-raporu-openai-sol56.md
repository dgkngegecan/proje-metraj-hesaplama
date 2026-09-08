# Faz 1 — Başlangıç Raporu

> 🟢 **OPENAI-SOL56** — Faz 1 teknik temel ve kalite altyapısı — 2026-08-30

**Durum:** `IN PROGRESS — INITIAL CHECKPOINT PASSED`

**Checkpoint sonucu:** `PASSED — 2026-08-30`

## Başlatılan kapsam

- `Metraj.sln` çözümü ve beş proje sınırı oluşturuldu: Domain, Application, Infrastructure, Desktop ve Tests.
- Modüler monolith proje referans yönü kuruldu: Desktop → Application/Infrastructure → Domain.
- WPF masaüstü giriş ekranı ve ilk açılış smoke yüzeyi eklendi.
- Nullable, implicit usings, analyzer, deterministic build ve warnings-as-errors kalite ayarları eklendi.
- SQLite bağlantı fabrikası ve EF Core SQLite context sınırı eklendi; ilk migration/entity modeli Faz 2 kapsamındadır.
- WPF shell, CommunityToolkit.Mvvm ViewModel binding'iyle ayrıştırıldı.
- Mimari yükleme, Domain bağımlılık sınırı, ham SQLite ve EF Core SQLite açılış smoke testleri eklendi.

## İlk checkpoint doğrulaması

SDK `10.0.400` ile restore, Release build, test ve `win-x64` self-contained publish çalıştırıldı. Güvenlik denetimi, `SQLitePCLRaw.lib.e_sqlite3` 2.1.11 bağımlılığını yüksek önem dereceli açık olarak raporladığı için doğrudan güvenli `2.1.13` sürümüne sabitlendi; güvenlik denetimi kapatılmadı.

```text
dotnet restore Metraj.sln --configfile NuGet.Config
dotnet build Metraj.sln --configuration Release --no-restore
dotnet test Metraj.sln --configuration Release --no-build
dotnet publish src/Metraj.Desktop/Metraj.Desktop.csproj --configuration Release --runtime win-x64 --self-contained true
```

## Faz 1 devam koşulu

1. Windows 11 x64 hedef ortamında .NET 10 SDK'nın `dotnet --info` ile doğrulanması (mevcut geliştirme ortamında SDK `10.0.400` görünür; nihai kabul Windows 11'de yapılacak).
2. Paket restore ve warnings-as-errors Release build — **geçti, 0 uyarı / 0 hata**.
3. Mimari, Domain sınırı, ham SQLite ve EF Core SQLite smoke testleri — **4/4 geçti**.
4. Self-contained `win-x64` publish çıktısı — **üretildi**: `src/Metraj.Desktop/bin/Release/net10.0-windows/win-x64/publish/Metraj.Desktop.exe`.
5. WPF açılış testi Windows masaüstü oturumunda çalıştırılacak; derleme ve `StartupUri` doğrulaması tamamdır.

## Faz 1 paket kararları

- Veri erişimi: migration gereksinimi nedeniyle `Microsoft.EntityFrameworkCore.Sqlite`; ham `Microsoft.Data.Sqlite` yalnız düşük seviyeli bağlantı/sağlık kontrolleri için tutulur.
- MVVM: `CommunityToolkit.Mvvm`.
- Decimal saklama politikası: Faz 2 entity mapping'inde açık `decimal × 1_000_000 → INTEGER` converter; EF Core SQLite varsayılanına bırakılmayacak.
- Excel/PDF kararı: `ClosedXML` ve `PDFsharp + MigraDoc`; paketler Faz 6'da Türkçe çıktı, desen ve taşma testleriyle uygulanacak. QuestPDF/EPPlus kullanılmayacak. Ayrıntı: `docs/faz1-lisans-ve-paket-karari-openai-sol56.md`.

Bu rapor, Faz 1'in başlatıldığını ve ilk teknik checkpoint'in geçtiğini gösterir. Domain modeli, migration ve gerçek ekran akışları tamamlanmadan Faz 1 tamamlanmış sayılmaz.
