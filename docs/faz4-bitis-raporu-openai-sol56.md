# Faz 4 Bitiş Raporu — Temiz Su Dikey Dilimi

**Tarih:** 2026-08-30  
**Durum:** `COMPLETE / SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`

## Teslim edilen dikey dilim

- Açıkça `SYNTHETIC` işaretli `SYN-CW-001` Temiz Su referans projesi idempotent biçimde yükleniyor: 14 yerleşim (kök dahil), 36 kaynak satırı ve 13 hesaplanmış özet kalemi.
- Metraj ekranı; yerleşim seçimi, miktar/birim, blok, kat, mahal, bölge, pafta, çizim revizyonu ve not alanlarıyla hızlı kaynak satırı girişi sağlıyor.
- Kaynak satırları Excel-benzeri DataGrid'de; `Kaynak` sütunuyla `USER` ve `SYNTHETIC` kökenini açıkça gösteriyor.
- Seçili satır forma yüklenebiliyor, güncellenebiliyor veya çoğaltılabiliyor. Düzenleme sırasında mevcut kaynak etiketi korunur; sentetik satır sessizce `USER` kaynağına dönüşmez.
- Yapıştırma, seçili yerleşime sekmeyle ayrılmış `Miktar, Blok, Kat, Mahal, Bölge, Pafta, Çizim rev., Not` sütunlarını atomik olarak kaydediyor. `Ctrl+Enter` satır kaydetme kısayoludur.
- Kaynak filtresi yalnızca üst tabloyu daraltır. Alt özet, yanlış kısmi satın alma hesabı üretmemek için her zaman tüm proje net miktarından hesaplanır; bu davranış ekranda açıkça yazılıdır.
- Yerleşim bazlı özet net, fireli, satın alma ve kalan/fazla miktarlarını ayrı gösterir. Seçilen özet kalemi için `kaynak satırı → net → fireli → satın alma → kalan/fazla` hesap izi gösterilir.
- Hızlı girişteki yerleşim seçicisi yalnızca `Measurable` davranışlı malzeme ve ek parça yerleşimlerini sunar. Klasör/sistem düğümü seçilemediği için kullanıcı geçersiz seçimden kaynaklanan kayıt hatasına yönlendirilmez.
- İlk rapor sınırı tamamlandı:
  - **Excel:** `Özet` ve `Kaynak Satırları` sayfaları; sayısal hücreler sayı olarak, kullanıcı metinleri formül enjeksiyonuna karşı metin olarak yazılır.
  - **PDF:** A4 yatay özet ve sayfalı kaynak tablosu; koyu başlık + kenarlıklar renk olmadan da tablonun ayrımını korur.

## Lisans ve çalışma zamanı kararı

- `ClosedXML 0.105.1` ve `PDFsharp-MigraDoc 6.2.4` kullanıldı. Her ikisi MIT lisanslıdır; QuestPDF/EPPlus bu üründe kullanılmadı.
- PDFsharp Core paketi için Windows yerleşik yazı tiplerini etkinleştiren kontrollü font yapılandırması eklendi. Bu uygulamanın kilitli hedefi Windows 11 x64 olduğundan rapor üretimi platform sınırıyla uyumludur.

## Doğrulama sonuçları

- `dotnet test Metraj.sln --configuration Release --no-restore`: **22/22 başarılı**.
  - Kaynak ölçüm bağlamı, kopyalama, güncelleme, birim/doğrudan ölçülebilirlik kuralları ve fire dönüşümü test edildi.
  - Çoklu yapıştırmanın tek yazma işlemi olarak geçersiz satırda hiçbir veri bırakmadığı test edildi.
  - Karttan gelen sentetik `SourceKind` güncellemede korunduğu test edildi.
  - Rapor testi, aynı revizyon anından PDF ve Excel üretiyor; Excel'de `31 → 32.55 → 9 → 3.45` hesap zincirini ve formül enjeksiyonu güvenliğini doğruluyor.
- Self-contained yayın başarıyla üretildi: `win-x64`.
- Gerçek Windows UI denetimi:
  - Uygulama yeni self-contained paketten açıldı ve kalıcı sentetik proje yeniden yüklendi.
  - Kaynak tablosunda `SYNTHETIC` ve bağlam sütunları; özet tablosunda ayrı net/fireli/satın alma/kalan miktarları görüldü.
  - Hesap izi örneği: `3 kaynak satırı → Net 24 adet → Fireli 24 adet → Satın alma 3 adet → Kalan/Fazla 6 adet`.
  - Satır düzenleme forma yüklendi, ardından iptal edilerek veri değişikliği yapılmadığı doğrulandı.
  - PDF ve Excel kaydetme pencereleri açıldı; uygulama üzerinden PDF (13 özet kalemi) ve Excel (36 kaynak satırı) başarıyla üretildi.
  - Güncel yayımdan yeniden açılan uygulamada 13 ölçülebilir yerleşimin listelendiği, seçilen boru yerleşiminin `m` birimini getirdiği, `Kelebek` kaynak filtresinin yalnızca bir kaynak satırını gösterdiği ve alt özet tablosunu daraltmadığı doğrulandı. Filtre tekrar temizlendi.
- PDF görsel denetimi:
  - A4 yatay, 3 sayfa; özet sayfası ve iki sayfalı kaynak tablosu incelendi.
  - İlk incelemede `SYNTHETIC` kaynak sütunu dar bulundu; sütun genişletildi, ikinci üretim görsel olarak tekrar incelendi. Kesilme, taşma veya üst üste binme kalmadı.

## Bilinen sınırlar ve sonraki faza giriş koşulu

- Bu kabul gerçek proje verisi değil, temsilî `SYNTHETIC` veri üzerindedir. Gerçek Temiz Su Excel'i geldiğinde ayrı kabul/regresyon girdisi olacaktır; bu durum Faz 4'ü geriye dönük gerçek veri doğrulaması yapmaz.
- Nihai revizyon kilidi, kalıcı hesap sonucu sürüm seti, sorumluluk kalıtımı, manuel override/audit ve nihai rapor kümeleri Faz 5–6 kapsamındadır.
