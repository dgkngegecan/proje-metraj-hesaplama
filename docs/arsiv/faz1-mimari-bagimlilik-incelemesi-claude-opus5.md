# Faz 1 — Mimari Bağımlılık İncelemesi

> 🔵 **CLAUDE-OPUS5** — destek görevi (Faz 1 RACI) — 2026-08-30 — Faz 1

Kod yazılmadan önce, teknik sözleşmede (`docs/arsiv/faz0-teknik-sozlesme-openai-sol56.md` §13) "doğrulanacak" diye işaretlenen kütüphane kararlarını lisans/uygunluk açısından inceledim. Güncel lisans bilgisi web aramasıyla doğrulandı (2026-08-30).

## 1. PDF kütüphanesi

| Aday | Lisans | Kısıt |
|---|---|---|
| QuestPDF | Community MIT — **yıllık brüt geliri 1.000.000 $ altındaki şirketler için ücretsiz**, üstünde ticari lisans zorunlu | Şirketinizin gelecekteki geliri bilinmiyor; bu sınırı takip etmek gerekir |
| EPPlus (PDF değil ama karşılaştırma için) | Polyform Noncommercial — **gelire bakılmaksızın her ticari kullanım ücretli lisans ister** | — |
| **PDFsharp + MigraDoc** | **MIT, tam serbest, gelir eşiği yok** | Daha az "modern" API, ama fluent değil imperative |

**Öneri: PDFsharp + MigraDoc.** Tek seferlik bir iç araç için gelir eşiğine bağlı bir lisansla (QuestPDF) uzun vadeli takip yükü almanın anlamı yok — proje "sade tut" ilkesiyle de çelişir. PDFsharp'ın API'si QuestPDF kadar rahat değil ama rapor ihtiyacımız (tablo, başlık, renk/desen rozetleri) karmaşık değil.

**Kaynak:** [QuestPDF Community License](https://www.questpdf.com/license/community.html), [EPPlus Lisans Genel Bakış](https://www.epplussoftware.com/en/LicenseOverview), [PDFsharp Lisans](https://docs.pdfsharp.net/General/License/License.html)

## 2. Excel kütüphanesi

| Aday | Lisans |
|---|---|
| **ClosedXML** | **MIT, tam serbest** |
| EPPlus | Polyform Noncommercial — ticari kullanımda ücretli |

**Öneri: ClosedXML.** Tartışmasız — MIT, aktif bakımlı, formatlama/renk/stil desteği bizim ihtiyacımızı (renk kodlu kategorize rapor) karşılıyor.

**Kaynak:** [ClosedXML NuGet](https://www.nuget.org/packages/closedxml/)

## 3. Veri erişim katmanı — EF Core mu, ham `Microsoft.Data.Sqlite` mı?

**Öneri: EF Core (SQLite sağlayıcısı).** Gerekçe: proje migration altyapısı istiyor (Faz 1 ve Faz 2 yapılacaklar listesinde açıkça var) — ham `Microsoft.Data.Sqlite` bunu bedava vermez, ayrı bir migration aracı (FluentMigrator/DbUp) gerekir; bu da "az hareketli parça" ilkesiyle çelişir. EF Core, ORM+LINQ+migration'ı tek pakette veriyor.

**Kritik teknik detay:** Teknik sözleşme (`decimal`, SQLite'ta `REAL` değil, altı ondalık basamaklı sabit ölçekli `INTEGER`) EF Core'un varsayılanıyla **birebir uyuşmuyor** — EF Core'un SQLite sağlayıcısı `decimal`'i varsayılan olarak `TEXT`'e yazar (REAL'e yazıp hassasiyet kaybetmemek için), `INTEGER`'a değil. Sözleşmedeki "sabit ölçekli INTEGER" isteniyorsa, her miktar alanı için özel bir `ValueConverter<decimal, long>` (× 10⁶ ölçekleme) yazılmalı — EF Core bunu `HasConversion()` ile destekliyor, ekstra bir kütüphane gerekmiyor, ama **varsayılan davranış değil, açıkça kodlanmalı.** Bunu GPT Terra'nın (SQLite şeması sorumlusu) bilmesi gerekiyor.

**Bilinen kısıt:** SQLite'ın `ALTER TABLE` desteği sınırlı; EF Core migration'ları bazı şema değişikliklerinde tablo-yeniden-oluşturma deseni kullanır (otomatik, ama migration dosyaları büyür). Bloke edici değil, bilinmesi gereken bir gerçek.

**Kaynak:** [EF Core SQLite sağlayıcısının sınırlamaları](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations)

## 4. MVVM

**Öneri: `CommunityToolkit.Mvvm`** — MIT, Microsoft bakımlı, kaynak üretici (source generator) tabanlı, boilerplate azaltıyor. Alternatif yok denecek kadar standart, tartışmaya gerek yok.

## 5. Nullable / statik analiz / uyarı-hata

Harici kütüphane gerekmiyor — `.csproj`'da `<Nullable>enable</Nullable>` ve `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`, .NET SDK'nın kendi Roslyn analizcileriyle (`<EnableNETAnalyzers>true</EnableNETAnalyzers>`) yeterli.

## Sonuç — GPT Terra/Sol'a önerilen paket listesi

```text
Microsoft.EntityFrameworkCore.Sqlite
CommunityToolkit.Mvvm
ClosedXML
PDFsharp-MigraDoc (empira paketleri)
```

Hepsi MIT/serbest, gelir eşiği veya ticari lisans takibi gerektirmiyor. Tek açık nokta: `decimal→INTEGER` value converter'ının EF Core'un varsayılanı olmadığı, Faz 2 şema çalışmasına açıkça not düşülmeli.
