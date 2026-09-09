# Faz 1 — Teknik Checkpoint Handoff

> 🟢 **OPENAI-SOL56** — Faz 1 teknik temel ve kalite altyapısı — 2026-08-30

**Handoff durumu:** `READY FOR CLAUDE REVIEW`  
**Faz durumu:** `IN PROGRESS — INITIAL CHECKPOINT PASSED`  
**Kapsam:** Çözüm iskeleti, WPF shell, MVVM sınırı, SQLite/EF Core bağlantı altyapısı ve ilk kalite kapısı.

## 1. Oluşturulan yapı

- `Metraj.sln`
- `src/Metraj.Domain` — dış bağımlılığı olmayan domain sınırı
- `src/Metraj.Application` — use-case sınırı
- `src/Metraj.Infrastructure` — EF Core SQLite context/factory ve düşük seviye bağlantı factory
- `src/Metraj.Desktop` — WPF shell + `CommunityToolkit.Mvvm` ViewModel
- `tests/Metraj.Tests` — mimari, bağımlılık ve SQLite smoke testleri
- `Directory.Build.props`, `.editorconfig`, `NuGet.Config`

## 2. Bağımlılık kararları

- EF Core SQLite runtime eklendi; migration Design tooling Faz 2’ye bırakıldı.
- `Microsoft.Data.Sqlite` düşük seviye bağlantı sağlık testi için tutuldu.
- `SQLitePCLRaw.lib.e_sqlite3` 2.1.13’e doğrudan sabitlendi; 2.1.11 güvenlik uyarısı nedeniyle kullanılmıyor.
- `CommunityToolkit.Mvvm` 8.4.0 WPF shell’de kaynak üretici tabanlı ViewModel için kullanıldı.
- EF Core SQLite’ın varsayılan decimal saklama davranışı kabul edilmedi; Faz 2’de açık ölçekli `decimal → INTEGER` converter zorunlu.
- Rapor paketleri kesinleştirildi: PDF için PDFsharp + MigraDoc, Excel için ClosedXML. QuestPDF ve EPPlus lisans takip riski nedeniyle kullanılmayacak. Ayrıntı: `docs/arsiv/faz1-lisans-ve-paket-karari-openai-sol56.md`.
- Rapor paketleri kesinleştirildi: PDF için PDFsharp + MigraDoc, Excel için ClosedXML. QuestPDF ve EPPlus lisans takip riski nedeniyle kullanılmayacak. Ayrıntı: `docs/arsiv/faz1-lisans-ve-paket-karari-openai-sol56.md`.

## 3. Doğrulama sonucu

SDK: `.NET 10.0.400`  
Target: `net10.0`, `net10.0-windows`, `win-x64`

- Restore: başarılı.
- Release build: başarılı, **0 uyarı / 0 hata**.
- Test: **4/4 başarılı**.
  - Katman assembly yükleme
  - Domain’in UI/SQLite referansı taşımaması
  - Ham SQLite bağlantısı
  - EF Core SQLite context bağlantısı
- Self-contained publish: başarılı.
  - `src/Metraj.Desktop/bin/Release/net10.0-windows/win-x64/publish/Metraj.Desktop.exe`

## 4. Claude incelemesi için kontrol listesi

- Proje referans yönünün tek yönlü ve Domain’in temiz olup olmadığını kontrol et.
- EF Core SQLite seçiminin migration hedefiyle uyumunu kontrol et.
- `SQLitePCLRaw.lib.e_sqlite3` 2.1.13 sabitlemesinin güvenlik/uyumluluk etkisini kontrol et.
- WPF `StartupUri` ve ViewModel binding iskeletini kontrol et.
- Faz 2’ye taşınan kararları kontrol et: migration tooling, entity mapping, sabit ölçekli decimal converter, ilk şema.

## 5. Faz 1’de kalan işler

- EF Core migration ve gerçek domain entity’leri (Faz 2).
- DI/host yapılandırması ve use-case servisleri.
- Katalog/proje ağacı WPF ekranları.
- Gerçek Temiz Su dikey dilimi ve DataGrid.
- CI/publish otomasyonu ve Windows masaüstü açılış kabul testi.

Claude geri bildirimi ayrı `CLAUDE-OPUS5` etiketli dosyada tutulmalıdır; bu dosya değiştirilmemelidir.
