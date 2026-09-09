# Faz 0 — OpenAI Çıktıları İçin Claude İnceleme Cevabı

> 🔵 **CLAUDE-OPUS5** — OpenAI Sol/Terra/Luna handoff'una çapraz inceleme — 2026-08-30 — Faz 0

**İncelenen OpenAI dosyaları**
- `docs/arsiv/faz0-teknik-sozlesme-openai-sol56.md`
- `docs/arsiv/faz0-test-ve-altin-veri-plani-openai-sol56.md`
- `docs/arsiv/faz0-handoff-openai-sol56.md`
- `docs/arsiv/faz0-claude-inceleme-cevabi-openai-sol56.md`

**Genel sonuç:** Teknik sözleşme yüksek kalitede ve iki gerçek hata/boşluğu kapatıyor. Yedi çelişkiden altısını kabul ediyorum — biri (§3) benim kendi imzalı yanlışım. **Bir maddede (§4, tek veritabanı topolojisi) itirazım var ve bunu kullanıcıya sormadan tek taraflı kabul etmiyorum** — bu, önceki turlarda kilitlenmiş bir tasarım hedefinden sessiz bir sapma.

---

## 1. İstenen altı soruya cevaplar

### 1.1 Atomik ölçüm kararı domain sözlüğüyle çelişiyor mu?

**Çelişmiyor — benim açık bıraktığım soruyu kapatıyor, koşullu kabul ediyorum.**

`domain-sozlugu.md` bu soruyu bilerek açık bırakmıştı, bir taraf seçmemişti. OpenAI'nin çözümü ("Measurement = atomik fiziksel girdi, düzeltme = mevcut kaydı güncelle + audit, yeni imalat = yeni kayıt") teknik olarak tutarlı ve doğru.

Ama bu bir *veri modeli netleştirmesi* değil, gizlenmiş bir **kapsam kararı**: "dönemsel hakediş takibi kapsam dışı" cümlesi, mekanik tesisat hakediş sürecinin gerçek bir parçasını (bkz. bu projenin çok önceki eleştiri turlarında domain ajanının işaretlediği "%60 tamamlandı" senaryosu) kalıcı olarak dışarıda bırakıyor. ROADMAP.md'nin "tek seferlik, sade tut" felsefesiyle tutarlı — ama **gerçek Temiz Su projesi aylık hakediş gerektiriyorsa bu karar F0-G01'den sonra yeniden açılmalı.** Şimdilik kabul, ama koşulsuz değil.

**Ek risk (yeni):** "Düzeltme mi, yeni ekleme mi" ayrımı kullanıcı niyetine bağlı — arayüz bu ikisini net bir eylemle ayırmazsa (örn. "Mevcut ölçümü düzelt" vs "Yeni ölçüm ekle" iki ayrı buton), kullanıcı yanlışlıkla birini diğeri yerine yapıp ya veri kaybeder ya da fiziksel miktarı çift sayar. **Faz 3 ekran gereksinimine eklenmeli.**

### 1.2 İki aşamalı hesap grubu → satın alma grubu → `ceiling` kuralı doğru mu?

**Doğru, ve gerçek bir hatayı kapatıyor.** Bu projenin çok daha erken bir eleştiri turunda (mimari red-team bulgusu) tam olarak şu senaryo işaretlenmişti: "Aynı malzeme kartına 5 ayrı ölçümle 1.2m, 1.3m, 1.1m, 0.9m, 1.0m girilir (toplam 5.5m, standart boy 6m ise 1 boy yeter); ayrı ayrı yuvarlanırsa her biri 1 standart boy sayılıp toplamda 5 boy önerilir." O bulgu hiçbir revizyonda çözülmemişti. `SYN-AGG-01` bunu tam olarak test ediyor ve sözleşme (§7.3) satır bazında değil grup bazında `ceiling` uygulanmasını zorunlu kılıyor. **Kabul, teşekkür — bu gerçek bir düzeltme.**

Tek açık soru: satın alma grubu anahtarı proje revizyonunu kapsamıyor gibi görünüyor (§7.3 listesinde yok). Bir `Approved` revizyonla bir `Draft` revizyonun ölçümleri aynı satın alma grubunda birleşebilir mi? Muhtemelen hayır olmalı (immutable geçmişle mutable taslak karışmamalı) ama sözleşmede açıkça yazılmamış — **F0-V03 kanonik sözleşmesine eklenecek küçük bir netleştirme.**

### 1.3 Proje revizyonu snapshot yaklaşımı orantılı mı?

**Orantılı, aşırı mühendislik değil** — çünkü revizyon karşılaştırma (hakediş/keşif artışı anlaşmazlıkları için) ROADMAP Faz 6'da zaten korunan bir gereksinim. Bu gereksinim olmasaydı `Draft/Approved/Archived` durum makinesi gereksiz olurdu; var olduğu için karşılığı var.

**Test edilmesi gereken ek senaryo:** Bir revizyon `PendingReview` kalemler varken `Approved` edilebiliyor mu, yoksa Approve etmek otomatik olarak tüm bekleyenlerin çözülmesini mi zorluyor? Sözleşme bunu açıkça ayırmamış (rapor üretimi engelleniyor ama revizyon onayının kendisi engellenmiyor gibi okunuyor) — **F0-V03'e eklenecek bir test vakası.**

### 1.4 `reference` + `QuantityContributionKey` çifte saymayı gerçekten engelliyor mu?

**Mekanizma doğru çalışıyor, ama granülerlik sınırlı.** `Measurement:{id}` / `CalculationResult:{id}` anahtarlı tekilleştirme sağlam — aynı katkı iki başlıkta görünse bile toplamda bir kez sayılıyor, test ettim (§5, iki ölçümlü tek yerleşim örneği).

Ama `reference` **yerleşimin tamamını** aliaslıyor, tek bir ölçümü değil ("Tek bir ölçümü seçmez"). Benim Senaryo 5'im tesadüfen bu sınırla örtüşüyordu (tek ölçüm) ama gerçek Temiz Su raporlarında bir yerleşimin *bazı* mahallerdeki ölçümlerinin ikinci bir başlıkta görünmesi, *diğerlerinin* görünmemesi gerekebilir (örn. "Ana Dağıtım Hattı" sadece belirli bir bölümü kapsıyorsa). Bu, ilk build'de desteklenmiyor. **Kabul edilebilir bir v1 sınırlaması — ama F0-G01 sonrası gerçek rapor başlıklarıyla test edilmeli, sözleşmede risk olarak işaretli kalsın.**

### 1.5 Genel özel alan motorunu çıkarmak yeterli mi?

**Yeterli, kanıta dayalı doğru bir karar.** Bu projenin çok erken bir aşamasında (fikrin ilk tarifinde) sınırsız kullanıcı tanımlı alan tipleri istenmişti; ama proje "tek seferlik, sade tut" kararına geçtikten sonra bu istek zaten geriletilmişti. OpenAI'nin "kanıt olmadan genel alan tasarımcısı yapılmaz, ihtiyaç çıkarsa tek tipli alan eklenir" yaklaşımı bu çizgiyle tutarlı ve riski düşük — eksik bir alan çıkarsa eklemek ucuz, spekülatif bir motor inşa etmekten çok daha ucuz.

### 1.6 Tek SQLite veritabanı, immutable kart sürümüne doğrudan bağlanma yeterli mi?

**Teknik olarak yeterli — ama bu, önceden kilitlenmiş bir tasarım hedefinden sessiz bir sapma. İtirazım var, bkz §2.**

---

## 2. Tek gerçek itirazım: proje başına tek dosya mı, tek uygulama veritabanı mı?

Bu projenin en ilk mimari taslağından beri (ve sonraki her revizyonda tekrarlanarak) şu ilke vardı: **"Her proje = ayrı proje dosyası... proje-adi.metraj... e-postayla gönderilir, yedeklenir, şantiyeye taşınır."** Bu, kullanıcı ihtiyacından (taşınabilirlik, paylaşım, arşivleme) doğan bilinçli bir karardı, rastgele bir teknik detay değildi.

> **Karar (kullanıcı, 2026-08-30): Seçenek A — tek uygulama veritabanı.** Gerekçe: veri hacmi küçük, gelecekte büyüme/çoklu proje kaygısı yok, karmaşıklığı en aza indirmek önceliklidir. `ROADMAP.md` madde 15'e işlendi. Aşağıdaki tartışma tarihsel kayıt olarak korunuyor.

OpenAI'nin teknik sözleşmesi bunu değiştiriyor: "İlk build tek bir uygulama SQLite veritabanı kullanır: katalog, kart sürümleri ve bütün projeler aynı veritabanındadır... Proje bazında taşınabilir dosya, içe/dışa aktarma... ilk build kapsamına alınmaz." Gerekçe ("en az hareketli parça, `ProjectCardSnapshot` katmanına gerek kalmaması") mühendislik açısından sağlam — ama kullanıcının orijinal ihtiyacını karşılamıyor olabilir.

**Bu iki taraf da varsayım yapmayacağı için kullanıcıya somut seçenekleriyle sunuyorum:**

| Seçenek | Ne demek | Bedeli |
|---|---|---|
| **A — Tek uygulama veritabanı (OpenAI önerisi)** | Tüm katalog + tüm projeler tek `.db` dosyasında. Yedekleme tüm veritabanını kapsar. | Proje bittiğinde tek başına birine "işte bu proje" diye gönderilecek bir dosya yok — tüm veritabanı gider ya da hiç gitmez. |
| **B — Proje başına ayrı dosya (önceki karar)** | Her proje kendi `.db`/`.metraj` dosyasında; katalog projeye kopyalanır veya paylaşılan bir kütüphane dosyasından referans alınır. | `ProjectCardSnapshot` benzeri bir katman gerekir (OpenAI'nin kaçınmak istediği karmaşıklık); e-postayla taşınabilir. |
| **C — Hibrit** | Geliştirme/kullanım sırasında tek DB (OpenAI'nin planı); proje bittiğinde/teslim edilirken "dışa aktar" ile bağımsız bir arşiv dosyası üretilir (tek yönlü, geri yükleme zorunlu değil). | Faz 1-7 boyunca OpenAI'nin sade modeli korunur, sadece Faz 8'e küçük bir "dışa aktar" adımı eklenir. | 

Bu projenin "tek seferlik, bitince kaldır" olduğu düşünülürse **C seçeneği** bana en makul geliyor — geliştirme sırasında karmaşıklık eklemez, ama projenin sonunda elinizde göndermeye/arşivlemeye değer, bağımsız bir dosya kalır. Ama bu benim tercihim, karar sizin.

---

## 3. Yedi çelişki tablosuna madde madde cevap

| # | Konu | Karar |
|---|---|---|
| 1 | Kart davranışının sahibi | **OpenAI'ye katılıyorum** (kart sürümünde varsayılan + yerleşimde override). Kütüphaneden tekrar kullanım felsefesiyle tutarlı; `domain-sozlugu.md` buna göre düzeltilecek. |
| 2 | Hesap modu yapısı | **OpenAI'ye katılıyorum** (bileşebilir politikalar). Bir malzeme aynı anda hem fire hem standart boy hem yuvarlama gerektirebilir — tek kapalı enum yanlıştı. |
| 3 | `reference` kapsamı | **Kendi hatam — düzeltiyorum.** `domain-sozlugu.md`'de "(1) dokümana/pafta'ya bağlanmak" dediğim kısım yanlıştı; doküman bağlama zaten ayrı bir mekanizma (`attachments` tablosu), `reference` ilişki tipiyle karıştırılmamalıydı. |
| 4 | Hariç/Opsiyonel | **OpenAI'ye katılıyorum** (taraf değil, atama durumu). Semantik olarak daha doğru. |
| 5 | Ölçüm zamanı | **Koşullu kabul** — bkz §1.1. Bilinçli bir kapsam kararı, F0-G01 sonrası yeniden gözden geçirilebilir olmalı. |
| 6 | Satın alma sonucu gösterimi | **OpenAI'ye katılıyorum** (grup alt toplamı, satır değil). Sonnet'in ekran taslağı Faz 3'te buna göre güncellenecek. |
| 7 | Proje açma/yedekleme modeli | **İtirazım var — bkz §2.** Kullanıcı kararı bekleniyor. |

---

## 4. Ortam riskine katılıyorum

.NET SDK'nın kurulu olmaması ve Windows 10 Home'un .NET 10 resmi destek matrisinde yer almaması gerçek ve kritik bir engel — kod yazmaya başlamadan F0-G02 (nihai bilgisayar bilgisi) netleşmeli. Buna ek bir itirazım yok.

## 5. Sonuç

Faz 0 hâlâ **COMPLETE değil**. §2'deki dosya topolojisi kullanıcı tarafından karara bağlandı (Seçenek A — tek uygulama veritabanı, bkz yukarı ve `ROADMAP.md` madde 15). **F0-G02 kapandı: nihai işletim sistemi Windows 11** — bu, OpenAI'nin teknik sözleşmesindeki `.NET 10 LTS / net10.0-windows / win-x64` tercihini doğrudan destekliyor, Windows 10 Home destek riski ortadan kalktı. Geriye tek şey kaldı:

1. **F0-G01** — gerçek Temiz Su projesi + Excel (bkz `docs/arsiv/faz0-referans-veri-istegi.md`).

Bu netleşmeden ne şema ne XAML üretilecek.
