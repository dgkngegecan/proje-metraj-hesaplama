# Faz 0 Handoff — OpenAI Ekibi

> 🟢 **OPENAI-SOL56** — ekip yöneticisi; Terra 5.6 ve Luna 5.6 alt incelemeleri birleştirilmiştir — 2026-08-30 — Faz 0

**Handoff durumu:** `COMPLETE / USER APPROVED`  
**Faz durumu:** `PHASE0 COMPLETE — SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`  
**Kaynak snapshot:** `main @ 31e3b72fc17309adfcb2ecb07c2d55d466727fb7`; Faz 0 belgeleri henüz Git tarafından izlenmiyor ve bu çalışma kapsamında commit oluşturulmadı.

---

## 1. Yapılan iş

- `ROADMAP.md` ve Claude ekibinin tüm Faz 0 belgeleri bağımsız olarak incelendi.
- Teknik ürün sözleşmesi hazırlandı; ölçüm, sürüm, hesap, sorumluluk, bağlantı, rapor ve depolama semantiği netleştirildi.
- Claude ekibinin açık soruları tek tek cevaplandı.
- `calculated-from` durum makinesi, geçmişi koruma ve nihai rapor kapısı tanımlandı.
- Satın alma dönüşümünün satır yerine grup seviyesinde yapılmasıyla çifte yuvarlama riski kapatıldı.
- Satır fire projeksiyonu ile otoritatif hesap grubu sonucu ayrıldı; satır projeksiyonlarının yuvarlanarak yanlış toplam üretmesi engellendi.
- Altın veri paketi şeması, sentetik hesap vakaları, sınır/hata testleri ve gerçek veri çapraz doğrulama yöntemi hazırlandı.
- Faz 0 başarı ve kullanılabilirlik ölçütleri tanımlandı; performans değerleri gerçek proje/bilgisayar gelene kadar geçici benchmark olarak işaretlendi.
- İlk taslak ayrı bir katı kalite turundan geçirildi; grup hesabı, `reference` granülerliği, türetme durumları ve gereksiz kapsam katmanları düzeltildi.
- Kullanıcının gerçek Excel bulunmadığı kararı üzerine 36 ölçümlü `SYNTHETIC` Temiz Su referans paketi üretildi; gerçek veri doğrulaması Phase 8'e ertelendi ve teslimi bloke etmeyecek şekilde roadmap'e işlendi.
- Sentetik paketin 11 JSON + 1 CSV dosyası doğrulandı; 13 hesap ve 14 satın alma grubu CSV'den yeniden hesaplandı, aritmetik uyuşmazlık bulunmadı ve 12 paket dosyasının SHA-256 hash'leri manifeste pinlendi.
- Claude Opus 5 paketi expected sonuçlara dayanmadan bağımsız yeniden hesapladı; 12/12 hash, 13/13 hesap grubu ve 14/14 satın alma grubu sıfır uyuşmazlıkla geçti.
- Claude Sonnet 5 kullanılabilirlik incelemesinin bulguları bağlayıcı DataGrid kabul kurallarına dönüştürüldü; iki revizyon alanı, ham/net miktar, grup otoritesi, serbest metinli yapıştırma, düzenleme etkisi ve altı durum açıkça tanımlandı.
- Kullanıcı yönetici 2026-08-30 tarihinde faz bitişini onayladı.
- Yerel geliştirme ortamı kontrol edildi.

## 2. Oluşturulan OpenAI dosyaları

- `docs/faz0-teknik-sozlesme-openai-sol56.md`
- `docs/faz0-test-ve-altin-veri-plani-openai-sol56.md`
- `docs/faz0-claude-inceleme-cevabi-openai-sol56.md`
- `docs/faz0-handoff-openai-sol56.md`
- `docs/faz0-sentetik-referans-karari-openai-sol56.md`
- `docs/faz0-sentetik-paket-claude-handoff-openai-sol56.md`
- `tests/Metraj.Tests/TestData/Phase0/CleanWater/` altındaki sentetik fixture/expected paketi

Claude ekibine ait hiçbir `.md` dosyası değiştirilmedi.

## 3. OpenAI tarafında kilitlenen teknik öneriler

1. Ölçüm, dönemsel hakediş değil; proje revizyonuna bağlı atomik fiziksel miktar girdisidir.
2. Bir DataGrid satırı bir ölçüm ve güncel hesap projeksiyonudur.
3. Kart davranış varsayımları kart sürümüne; yalnız açık override'lar proje yerleşimine aittir.
4. Fire, standart boy, paket ve yuvarlama tek bir enum değil, bileşebilir politikalardır.
5. Proje revizyonu onaylandığında değişmez snapshot olur; değişiklik yeni draft revizyonda yapılır.
6. Katalog ve projeler tek uygulama SQLite veritabanında tutulur; yerleşim immutable kart sürümüne doğrudan bağlanır. Ayrı `ProjectCardSnapshot` ve taşınabilir proje dosyası yoktur.
7. Domain'de `decimal`, SQLite'ta sabit ölçekli integer dönüşümü kullanılır; `REAL` kullanılmaz.
8. Satış kabı yuvarlaması ölçüm satırında değil satın alma grubunda yapılır; sentetik pakette açık `ProcurementScope` kullanılır ve gerçek pratik doğrulaması artık risk olarak Phase 8'e bırakılır.
9. `reference` kaynak yerleşimin tamamı için alias'tır; miktar üretmez. Rapor toplamı `Measurement:{id}` / `CalculationResult:{id}` anahtarıyla tekilleştirilir.
10. `calculated-from` yeni fitting keşfetmez; yalnız önceden oluşturulmuş hedef yerleşim için incelemeye tabi öneri üretir. İlk build'de türetilmiş sonuç başka bir türetmenin kaynağı olamaz.
11. `calculated-from` durumları `PendingReview/Approved/Overridden/Rejected/Stale/Superseded` olarak tanımlıdır; seçili rapor kapsamındaki bekleyen/geçersiz sonuç nihai raporu bloke eder ve gerekçesiz override yapılamaz.
12. Poz numarası isteğe bağlı metindir; otomatik numaralandırma yoktur.
13. Genel dinamik özel alan motoru ilk build'den çıkarılmıştır; gerçek veri yalnız somut alan ihtiyacı doğurursa sabit tipli alan eklenir.

## 4. Claude handoff'una verilen sonuç

- Kabul senaryoları 1, 2, 4, 5 ve 6 mimariyi doğru doğruluyor.
- Eski kart sürümünde kalan yerleşimin arayüzde görünür işaretlenmesi kabul edildi.
- `measurements.kayıt_türü = nihai / dönemsel-ek` önerisi kabul edilmedi; hakediş kavramını kapsam içine taşıyor.
- Ekran akışındaki beş belirsizlik teknik sözleşmede çözüldü.
- Claude sözlüğü ile OpenAI önerisi arasındaki davranış sahibi, hesap modu, `reference`, sorumluluk durumu ve satın alma gösterimi çelişkileri açık bir uzlaşma tablosuna yazıldı; kanonik belge oluşmadan kod başlanmayacak.
- Claude Opus'tan OpenAI belgeleri üzerinde katı bir karşı inceleme istendi; yanıtın ayrı `CLAUDE-OPUS5` etiketli dosyada verilmesi bekleniyor.

## 5. Doğrulamalar

### 5.1 Doküman ve kapsam kontrolü

- `ROADMAP.md` içindeki 14 kilit kararla çelişki tarandı.
- `uses` hiçbir öneride yeniden eklenmedi.
- CAD/geometri tabanlı otomatik fitting keşfi kapsam dışı tutulurken `calculated-from` orta yolu korundu.
- Canvas ve connector başlıkları yeni faz veya gelecek ürün olarak eklenmedi.
- Claude ekibi dosyalarında değişiklik yapılmadı.

### 5.2 Sentetik aritmetik kontrolü

- `52,4 × 1,05 = 55,02`
- `ceil(55,02 / 6) = 10 boy`
- `10 × 6 − 55,02 = 4,98 m`
- `ceil(138 / 25) = 6 paket`; artan `12 adet`
- `ceil(52,4 / 3) = 18`; `ceil(60,1 / 3) = 21`
- `3,1 + 2,9 = 6,0`; grup dönüşümünde `1 boy`, satır başına dönüşümde oluşacak yanlış `2 boy` engellendi.
- İki adet `0,000001 m` satırda `%50` fire için otoritatif grup sonucu `0,000003 m`dir; ayrı yuvarlanan `0,000002 + 0,000002` satır projeksiyonları toplam olarak kullanılmaz.

Bu hesaplar test sözleşmesini doğrular; gerçek altın veri yerine geçmez.

### 5.3 Ortam kontrolü

- Host RID: `win-x64`.
- İşletim sistemi: Windows 10 Home Single Language.
- Kurulu .NET SDK: **yok**.
- Mevcut çalışma zamanları kod derlemeye yetmez.
- Microsoft'un güncel matrisine göre Windows 10 Home, .NET 10'un resmi destek hedefleri arasında değildir.

## 6. Açık riskler

| Öncelik | Risk | Etki | Kapatma yolu |
|---|---|---|---|
| Kabul edilmiş artık risk | Gerçek Temiz Su projesi ve Excel yok | Gerçek sütun/jargon/satın alma/rapor pratiği doğrulanamıyor | Sentetik sözleşme kullanılır; gerçek veri bulunursa Phase 8'de ek kabul yapılır |
| Kritik | .NET SDK yok | Faz 1 iskeleti derlenemez | Nihai bilgisayar bilgisi sonrası teknik ekibin seçtiği x64 SDK kurulur |
| Kapalı | Nihai işletim sistemi | Windows 11 x64 kullanıcı tarafından seçildi | `.NET 10 LTS / win-x64` hedefi |
| Yüksek | Satın alma gruplama kuralı gerçek Excel'le sınanmadı | Paket/boy sayısı gerçek pratikten farklı olabilir | Sentetik pakette explicit `ProcurementScope`; gerçek veri bulunursa Phase 8 doğrulaması |
| Kapalı | Claude/OpenAI belgeleri bazı kavramlarda farklı sözleşme sunuyor | Şema ve XAML iki ayrı yoruma göre yazılabilirdi | Karşı inceleme, UI ek sözleşmesi ve kullanıcı nihai kararıyla kapandı |
| Orta | Gerçek alan listesi bilinmiyor | Sabit çekirdek alanlar eksik kalabilir | Excel kolonları incelenir; yalnız kanıtlı alan eklenir |
| Orta | Belgeler ve `ROADMAP.md` untracked | Handoff snapshot'ı kalıcı değil | Kullanıcı onayından sonra kontrollü commit |
| Düşük | `tmp/pdf-review` untracked | Repo gürültüsü ve yanlışlıkla commit | Faz 1'de `.gitignore` kapsamına alınır; mevcut dosyalar silinmez |

## 7. Kullanıcı durumu

- `F0-G01` gerçek Excel zorunluluğu kullanıcı kararıyla sentetik referans kapısına çevrildi.
- `F0-G02` kapandı: Windows 11 x64.
- Şu anda kullanıcıdan yeni veri veya Faz 0 kararı beklenmiyor. Kullanıcı faz bitişini onayladı.

## 8. Sonraki ekip hareketi

- Faz 0 için yeni çalışma yoktur; bütün bloke edici kapılar kapandı.
- Faz 1'e, kullanıcı başlatma talimatı verdiğinde çözüm iskeleti ve kalite altyapısıyla başlanır.
- İlk teknik önkoşul Windows 11 x64 geliştirme ortamında .NET 10 SDK'nın kurulup `dotnet --info` ile doğrulanmasıdır.
- Kullanılabilirlik incelemesinden çıkan kurallar Faz 2 domain/read-model ve Faz 4 DataGrid kabul testlerine izlenebilir gereksinim olarak taşınır.
- Nihai OpenAI kapanış kanıtı: `docs/faz0-bitis-raporu-openai-sol56.md`.
