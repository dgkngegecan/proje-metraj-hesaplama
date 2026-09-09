# Faz 1 — Rapor/Veri Erişim Paketi Kararı

> 🟢 **OPENAI-SOL56** — kullanıcı geri bildirimi ve Claude Faz 1 incelemesiyle kilitlenen karar — 2026-08-30

## Karar

- **PDF:** `PDFsharp + MigraDoc`.
- **Excel:** `ClosedXML`.
- **Kullanılmayacaklar:** `QuestPDF` ve `EPPlus`.
- **Veri erişimi:** `Microsoft.EntityFrameworkCore.Sqlite`; mevcut Faz 1 iskeletinde EF Core context kuruldu.

## Gerekçe

- PDFsharp ve MigraDoc resmi lisans dokümanında MIT olarak yayımlanıyor.
- ClosedXML deposu MIT lisanslıdır.
- QuestPDF Community lisansı gelir/kurum uygunluğu ve geçiş yükümlülüğü içeriyor; tek seferlik iç araç için bu takip riski gereksizdir.
- EPPlus ticari kullanım için ticari lisans gerektirebilen Polyform/ticari lisans modelindedir.
- Bu karar lisans belirsizliğini azaltır; yine de nihai dağıtımda üçüncü taraf lisans/NOTICE dosyaları arşivlenecektir.

## Uygulama zamanı

- Bu paketler Faz 1’de uygulama bağımlılığı olarak eklenmez; raporlama Faz 6 kapsamındadır.
- Faz 6 başında seçilen sürümler, Türkçe karakter/font, siyah-beyaz desen ve tablo taşması testleriyle birlikte pinlenir.
- EF Core SQLite’ın `decimal` desteği SQLite sorgu sınırlamaları nedeniyle varsayılan davranışa bırakılmaz. Faz 2’de bütün miktar alanları için açık `ValueConverter<decimal,long>` uygulanır:
  - model: `decimal`
  - provider: ölçeklenmiş `long` (`× 1_000_000`)
  - SQLite kolon tipi: `INTEGER`
  - dönüşüm ve taşma/yuvarlama sınırları birim testleriyle doğrulanır.

## Kaynaklar

- PDFsharp/MigraDoc MIT: https://docs.pdfsharp.net/General/License/License.html
- ClosedXML lisansı: https://github.com/ClosedXML/ClosedXML/blob/develop/LICENSE
- QuestPDF Community License: https://www.questpdf.com/license/community.html
- EPPlus lisans FAQ: https://www.epplussoftware.com/LicenseOverview/LicenseFAQ
- EF Core SQLite sınırlamaları: https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations
