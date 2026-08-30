> 🔵 **CLAUDE-SONNET5** — kullanılabilirlik kontrolü — 2026-08-30 — Faz 0

# Faz 0 — Sentetik Temiz Su Paketi Kullanılabilirlik İncelemesi

Bu belge `docs/faz0-sentetik-paket-claude-handoff-openai-sol56.md` §5'te istenen beş
kontrolü kapsar. Referans alınan dosyalar:

- `docs/faz0-ekran-akisi-taslak.md` (§3.2 — 20 sütunluk DataGrid taslağı)
- `tests/Metraj.Tests/TestData/Phase0/CleanWater/fixtures/measurements.csv` (36 satır, 24 sütun)
- `tests/Metraj.Tests/TestData/Phase0/CleanWater/fixtures/project-placements.json` (26 yerleşim)
- `tests/Metraj.Tests/TestData/Phase0/CleanWater/expected/state-transitions.json` (6 durum)

**Özet yargı:** Taslak genel iskelet olarak sağlam, ancak 5 kontrolden **4'ünde somut,
düzeltilmesi gereken bir bulgu** var (1, 2, 3, 5). Yalnızca kontrol 4'te taslağın önerdiği
mekanizma (Ctrl+Enter ile ayrı "kalem ekle" komutu) doğru yönde ama eksik detaylı; asıl risk
orada da hâlâ mevcut ve aşağıda somutlaştırıldı.

---

## Kontrol 1 — 36 satır, 20 sütunla kayıpsız gösterilebiliyor mu?

**Bulgu: Hayır, tam kayıpsız değil.** CSV'de 24 sütun var, taslakta 20 sütun var; eşleme
büyük ölçüde çalışıyor ama üç somut sorun var.

### 1a. Eksik sütunlar (CSV'de var, taslakta hiç yok)

| CSV sütunu | Taslakta karşılığı | Sorun |
|---|---|---|
| `ProcurementScope` | **yok** | Satın alma gruplaması bu alana göre kuruluyor (`POOL-PPR25-BIZ` vs `NOPOOL-PPR25-EMP`). Kullanıcı, bir satırın hangi satın alma havuzuna girdiğini ana ekranda hiçbir yerde göremiyor — yalnızca Hesap İzi Detayı'na (1.6) girip çıkararak anlayabilir. |
| `CalculationGroupId` / `PurchaseGroupId` | **yok** (dolaylı: Hesap İzi paneli) | Aynı sorun: satırın hangi hesap/satın alma grubuna dahil olduğu grid'de görünmüyor. 13 hesap grubu + 14 satın alma grubu olduğu için, kullanıcı "bu satır hangi alt toplama giriyor" sorusunu satır bazında cevaplayamıyor. |
| `MeasurementId` | **yok** (görünür sütun olarak) | `state-transitions.json`'daki `sourceMeasurementIds` gibi izleme senaryolarında (örn. "CW-SYN-021 hangi kelepçe sonucuna kaynaklık etti") kullanıcı bu kimliği grid'de göremiyor; destek/denetim senaryosunda arama yapılamıyor. |
| `SourceKind` | **yok** | Sentetik/gerçek/tarihsel-göç ayrımı (Faz 0 özelinde önemli, ama üretimde de tarihsel veri göçü senaryosunda gerekebilir) hiçbir sütunda yok. |

### 1b. Anlam çakışması (aynı taslak sütununa iki farklı CSV kavramı düşüyor)

- **`Revizyon` sütunu (taslak #19) iki farklı kavramı karıştırıyor:** CSV'de hem
  `ProjectRevisionId` (proje geneli, kilitlenebilir revizyon — `PRJ-CW-SYN-REV-001`) hem de
  `DrawingRevision` (satır bazlı, çizim paftasının revizyon kodu — `R02`) var. Taslakta tek
  bir "Revizyon" sütunu bu ikisinden hangisini gösterecek belirsiz. Bunlar farklı yaşam
  döngülerine sahip: `ProjectRevisionId` onay/kilit ile değişir (bkz. §2 Revizyon Yönetimi
  ekranı), `DrawingRevision` ise mühendisin çizimi güncellemesiyle satır bazında değişir ve
  proje revizyonundan bağımsızdır. İkisinin tek sütuna sıkıştırılması, kullanıcının "bu satır
  hangi proje revizyonunda kilitli" ile "bu satır hangi pafta revizyonundan alındı" sorularını
  ayırt etmesini engeller. **Öneri:** `Pafta` sütununun (taslak #9) hemen yanına satır bazlı
  "Pafta Rev." sütunu eklenmeli; mevcut `Revizyon` sütunu yalnızca proje revizyonu için
  kalmalı (muhtemelen salt okunur, dropdown/rozet, serbest metin değil).

- **`Net Miktar` sütunu (taslak #11) `InputQuantity` (kullanıcının girdiği ham değer) ile
  `ExpectedNet` (sistemin normalize ettiği net değer) arasındaki farkı gizliyor.** Bu sentetik
  pakette ikisi her satırda birebir eşit çıkıyor (ör. `CW-SYN-001`: InputQuantity=12.4,
  ExpectedNet=12.4), bu yüzden fark bugün görünmüyor — ama birim dönüşümü gerektiren bir
  girişte (örn. kullanıcı cm girip sistem m'ye çeviriyorsa) tek sütun hangi değerin
  gösterildiğini belirsizleştirir. Taslağın kendi açıklaması da bunu itiraf ediyor:
  "Girilen/hesaplanan net miktar" — iki farklı şey aynı hücrede.

### 1c. Fazladan/karşılıksız sütun (taslakta var, CSV'de karşılığı yok)

- **`Şaft` sütunu (taslak #8)** CSV'de ayrı bir alan olarak yok. Sentetik veride "şaft" bilgisi
  `Room` (Mahal) alanının içine serbest metin olarak gömülü (`Şaft-01`, `Şaft-02`, `Şaft`
  değerleri `Room` sütununda, ör. `CW-SYN-013`: Room=`Şaft-01`). Bu iki olasılıktan birine
  işaret ediyor: (a) gerçek üretim şemasında Şaft hiç ayrı alan olmayacak ve taslaktaki bu
  sütun kaldırılmalı, ya da (b) sentetik veri paketi Şaft alanını eksik doldurmuş ve gerçek
  şemada ayrı kalması gerekiyor. Bu belirsizlik OpenAI/Faz 2 domain modeliyle netleştirilmeli;
  şu an taslak ile fixture birbirini doğrulamıyor.

**Sonuç:** 36 satırın *değerleri* kayıpsız taşınabilir (veri kaybı yok), ama taslak grid
kullanıcıya satırların **hangi hesap/satın alma grubuna ve hangi pafta revizyonuna ait
olduğunu göstermiyor** — bu, "kayıpsız gösterim" ölçütünü tam karşılamıyor. Üretim-öncesi
Faz 2/3'te en az `ProcurementScope`, satır bazlı pafta revizyonu ve bir grup-üyeliği
göstergesi (bkz. Kontrol 2 önerisi) eklenmeli.

---

## Kontrol 2 — Satır "Fireli Projeksiyon" vs. grup otoritatif fireli/satın alma değeri

**Bulgu: Taslakta bu ayrım hiç yapılmıyor — gerçek bir risk.**

`expected/state-transitions.json` şunu gösteriyor: `CG-PPR25-A` grubundaki 4 kaynak ölçüm
(`CW-SYN-001..004`), Kelepçe DN25 kartına (`CW-CLAMP25-v1`, `PL-CLAMP25-A` — **farklı bir ağaç
dalı**) türetilmiş bir sonuç üretiyor (`CR-CLAMP25-A-001`, durum `PendingReview`). Yani satır
düzeyindeki `ExpectedLineWasteProjection` (satırın kendi fireli projeksiyonu, örn. boru
metresi + %5 fire) ile bu satırların besleştiği **türetilmiş** grup sonucu (kelepçe adedi)
tamamen farklı bir kart/dal altında, farklı bir birimde yaşıyor. Kullanıcı ana ekranda PPR25-A
borusunu filtrelediğinde alt bilgi çubuğunda gördüğü "toplam" bu türetilmiş kelepçe katkısını
içermez — ama kullanıcı bunu otomatik olarak beklemez, çünkü grid içinde hiçbir işaret bu
ikisini birbirinden ayırmıyor.

Somut öneri (üç katmanlı):

1. **Satır düzeyi (col 13, Fireli Miktar):** İtalik + gri (veya düşük opaklık) metin, hücrenin
   solunda küçük bir "ⓘ" ikonu; tooltip: *"Bilgi amaçlı satır projeksiyonu — otoritatif grup
   toplamı için grup satırına bakın."* Renk tek başına yeterli değil (bkz. Kontrol 5 ile aynı
   ilke) — italik/ikon kombinasyonu B&W baskıda da ayırt edilir kalmalı.
2. **Grup özeti satırı:** DataGrid'de `CalculationGroupId` bazlı gruplama (Excel'in "subtotal
   satırı" mantığı) — her grubun altına/üstüne kalın, normal (italik olmayan) yazı tipiyle,
   arka planı hafif taralı/gölgeli bir "Grup Toplamı" satırı eklenmeli. Bu satır salt okunur,
   `expected/calculation-groups.json`'daki otoritatif net/fireli değerle birebir eşleşmeli
   (satırların basit toplamı değil — çünkü Rejected/PendingReview/Stale sonuçlar dışlanıyor).
3. **Çapraz-dal türetim göstergesi:** Bir satırın başka bir karta/dala türetilmiş sonuç
   ürettiği durumlarda (yukarıdaki kelepçe örneği), satırda küçük bir "→ türetilmiş sonuç var"
   rozeti/linki gösterilmeli; tıklanınca ağaçta hedef dala (`PL-CLAMP25-A`) atlanmalı. Aksi
   halde kullanıcı "borunun fire toplamı doğru ama kelepçe sayısı nereden geliyor" sorusunu
   ana ekranda hiç cevaplayamaz.

Taslağın mevcut hâli (§3.2, col 13 açıklaması: *"Hesap sonucu (salt okunur, hesap izine
bağlı)"*) bu üç noktanın hiçbirini karşılamıyor; yalnızca "salt okunur" olması otoritatif
olduğu izlenimini güçlendiriyor, tam tersini yapması gerekirken.

---

## Kontrol 3 — Blok/Kat/Mahal/Pafta/Zon/Revizyon: klavye ve Excel yapıştırma uygunluğu

**Bulgu: Kısmi risk — taslak bu 6 sütunun hücre kontrol tipini (serbest metin mi, kapalı
dropdown mu) tanımlamıyor, ve fixture verisi bu ayrımın kritik olduğunu gösteriyor.**

Taslak, aynı alan adlarını (Blok/Kat/Mahal/Zon/Şaft/Pafta) hem §3.1'de **sol panel
filtresi** ("çoklu seçim dropdown'ları") hem de §3.2'de **DataGrid hücresi** olarak
kullanıyor, ama grid hücrelerinin kontrol tipini ayrıca belirtmiyor. Bu önemli çünkü
`measurements.csv`'deki gerçek değerler alan bazında çok farklı serbestlik dereceleri
gösteriyor:

| Alan | Fixture'daki gözlemlenen değerler | Serbestlik |
|---|---|---|
| Block | `A`, `B` (2 farklı değer) | Neredeyse sabit liste |
| Floor | `Kat 1`, `Kat 2`, `Kat 3`, `Bodrum`, `Çatı` | Yarı yapılandırılmış (~5 değer) |
| Room | `101`, `102`, `Kolon-01`, `Şaft-01`, `Ana Hat`, `Pompa`, `Depo`, `Hidrofor`... | **Tamamen serbest metin** |
| Zone | `Z1`, `Z2`, `Z3`, `ZB` | Kısa kod, yarı sabit |
| Sheet (Pafta) | `M-01`...`M-20` | Yarı yapılandırılmış ama genişleyebilir |
| DrawingRevision | `R02` (fixture'da tek değer) | Bilinmiyor — örneklemde çeşitlilik yok |

Eğer bu sütunlar §3.1'deki filtre bileşenleriyle aynı WPF kontrolü paylaşacak şekilde
(`ComboBox`/kapalı liste) uygulanırsa, **Excel'den çok-satır yapıştırma akışı kırılır**:
standart bir `DataGridComboBoxColumn`, yapıştırılan hücre değeri mevcut liste öğeleriyle
birebir eşleşmediğinde ya reddeder ya da sessizce boş bırakır. `Room` gibi tamamen serbest
metin alanı için bu özellikle yıkıcı olur (`Kolon-01`, `Şaft-01` gibi değerler önceden listede
olmayacaktır).

**Somut öneri:**
- Grid hücreleri için varsayılan **serbest metin + öneri-listeli autocomplete** (kullanıcı
  yazmaya devam edebilir, liste sadece öneri sunar, kısıtlama yapmaz) kullanılmalı — özellikle
  `Room`/Mahal için.
- Yapıştırma (Ctrl+V) sırasında, hedef sütun autocomplete listesinde olmayan bir değer
  gelirse, hücre **reddedilmemeli**; değer olduğu gibi yazılmalı ve o değer otomatik olarak
  autocomplete listesine eklenmeli (aksi halde toplu yapıştırma sessizce veri kaybına yol
  açar — bu, taslağın §3.2'de zaten "birim/tip uyumsuzluğunda satır kırmızı işaretlenir" dediği
  hata yakalama mantığına eklenmeli: *sözlük dışı değer* de aynı şekilde görünür işaretlenmeli,
  ama satırı reddetmemeli).
- `DrawingRevision` (Pafta Rev.) alanı fixture'da örneklemde çeşitlilik göstermediği için
  format varsayımı (örn. her zaman `R\d+`) yapılmamalı; serbest metin kalmalı.

---

## Kontrol 4 — "Yeni ölçüm ekle" vs "Mevcut ölçümü düzelt" karışması

**Bulgu: Taslağın mekanizması (Ctrl+Enter / "+ Kalem Ekle") doğru yönde, ama üç somut boşluk
var — özellikle `state-transitions.json`'daki `Stale` geçişiyle bağlantı kurulmamış.**

Taslak zaten "ekleme"yi ayrı bir komuta bağlamış (Ctrl+Enter, yeni satır) — bu iyi bir temel.
Ama "düzeltme" tarafı, var olan bir hücreye doğrudan yazmakla aynı davranışta ve üç risk
taşıyor:

1. **Geriye dönük etkisi görünmeyen düzeltme.** `state-transitions.json`'daki
   `CF-TRANS-001` senaryosu tam olarak bunu gösteriyor: bir ölçüm (`CR-CLAMP25-A-000`)
   `Approved` durumdayken kaynağı değiştiriliyor ve otomatik olarak `Stale` durumuna
   düşüyor, ardından yeni bir sonuç (`Superseded` ilişkisiyle) üretiliyor. Taslakta, bir
   kullanıcı `Net Miktar` hücresini düzenlediğinde, bu düzenlemenin **kaç onaylı/override'lı
   türetilmiş sonucu etkileyeceğine dair hiçbir uyarı yok**. Kullanıcı bir yazım hatasını
   düzeltiyor sanırken, aslında onaylanmış bir kelepçe hesabını "Stale" durumuna
   düşürebilir — bu, düzenleme anında görünür olmalı ("Bu ölçüm 1 onaylı sonucu etkiliyor,
   kaydedersen o sonuç 'Güncel Değil' durumuna düşecek" gibi bir satır-içi uyarı).
2. **Ctrl+D (çoğalt) ile kazara çift sayım.** Taslak, çoğaltılan satırın "aynı bağlamı"
   (Blok/Kat/Mahal vb.) koruduğunu söylüyor. Kullanıcı yeni bir ölçüm eklemek isteyip
   Ctrl+D kullanırsa ve Mahal/Miktar alanını değiştirmeyi unutursa, tamamen aynı bağlamda
   ikinci bir satır `CalculationGroupId`'ye sessizce eklenir ve grup toplamı şişer — hiçbir
   doğrulama bunu yakalamaz. **Öneri:** aynı `PlacementId + Blok + Kat + Mahal + Miktar`
   kombinasyonuyla ikinci bir satır kaydedilmeye çalışıldığında pasif bir uyarı (engelleyici
   olmayan, ama fark edilir) gösterilmeli: "Bu satır, XX numaralı satırla birebir aynı görünüyor
   — yeni bir ölçüm mü, yoksa kopya mı?"
3. **Görsel ayrım eksik.** Yeni eklenen (henüz kaydedilmemiş) satır ile var olan bir satırda
   yapılan düzenleme, taslakta aynı görünüyor. **Öneri:** yeni satır kaydedilene kadar farklı
   bir arka plan (ör. açık sarı) taşımalı; var olan bir hücrede yapılan ama henüz kaydedilmemiş
   değişiklik farklı bir gösterge (kalın kenarlık + "değiştirildi" ikonu) taşımalı — ikisi asla
   aynı görsel dili paylaşmamalı.

Bunların hiçbiri taslağı temelden değiştirmiyor (Ctrl+Enter/Ctrl+D modeli makul), ama mevcut
haliyle "Stale" durumuna düşme riski kullanıcıya hiç gösterilmiyor — bu, önceki turda
işaretlenen riskin (veri kaybı/çift sayım) hâlâ açık olduğu anlamına geliyor.

---

## Kontrol 5 — 6 `calculated-from` durumunun renksiz ayırt edilebilirliği

**Bulgu: İki katmanlı sorun var — önce taslağın kendi "Durum" sütunu 6 durumun yarısını bile
kapsamıyor; ayrıca 6 durumu renksiz ayırt etmek gerçekten zor ve tek-katmanlı bir çözüm
yetersiz kalır.**

### 5a. Taslak eksikliği

Taslak §3.2, col 17 "Durum" için yalnızca üç değer sayıyor: *Onaylı / Kontrol Bekliyor /
Manuel Düzeltildi* — bunlar `state-transitions.json`'daki `Approved` / `PendingReview` /
`Overridden` durumlarına karşılık geliyor. **`Rejected`, `Stale` ve `Superseded` için
taslakta hiçbir karşılık yok.** Bu üç durum gerçek veride önemli: paketin 36 satırından
türeyen 7 sonuçtan 1'i `Rejected`, 1'i `Stale`→`Superseded` zinciri, 2'si `PendingReview` —
yani örneklemin yarısından fazlası "eksik" üç durumdan birinde. Bu, taslağın en somut,
öncelikli düzeltmesi olmalı.

### 5b. Renksiz ayırt edilebilirlik önerisi

6 durumu tek düzeyde 6 farklı ikonla ayırmak, küçük hücrelerde ve düşük görmede gerçekçi
değil — bunu doğrudan kabul etmek gerekiyor. Bunun yerine **iki eksenli (2 katmanlı)
kodlama** öneriyorum, çünkü 6 durum aslında 3 anlamsal kategoriye ayrılıyor:

| Kategori | Durumlar | Anlamı |
|---|---|---|
| **İşlem Gerekli** | PendingReview, Stale, Rejected | Kullanıcı eylemi bekliyor / kesin toplama dahil değil |
| **Yerleşik** | Approved, Overridden | Kesin toplama dahil |
| **Tarihsel** | Superseded | Kesin toplama dahil değil, artık geçerli değil (yenisi var) |

- **Dış katman (kategori):** hücrenin/rozetin kenarlığı — İşlem Gerekli = kalın kesikli
  kenarlık, Yerleşik = düz ince kenarlık, Tarihsel = üstü çizili (strikethrough) metin. Kenarlık
  deseni renkten bağımsız, baskıda ve düşük görmede ayırt edilebilir.
- **İç katman (durum):** her durumun kendi şekli/kısaltması — daire içinde tek harf/kısa kod
  kullanılabilir, örn. `PR` (PendingReview), `ON` (Approved/Onaylı), `MD` (Overridden/Manuel
  Düzeltildi), `RD` (Rejected/Reddedildi), `GD` (Stale/Güncel Değil), `YA` (Superseded/Yerini
  Aldı). Kısaltma + tam metin **her zaman birlikte** (hücrede kısaltma, tooltip'te ve sağ
  panelde tam metin) — ISO/erişilebilirlik pratiğiyle uyumlu (yalnızca ikon/yalnızca renk asla
  tek başına kullanılmamalı).
- **Rapor/baskı görünümü:** taslağın §1.8 Rapor Önizleme ekranı zaten "ton=sistem türü,
  doku=sorumluluk" diyor — aynı doku mantığı durum rozetine de uygulanmalı: 3 kategori için 3
  farklı desen (düz dolgu / çizgili / noktalı), 6 durum için üstüne kısaltma metni.
- **Dürüst sınırlama:** Bu şema bile 6 durumu birbirinden ayırt etmeyi "kolay" hale
  getirmiyor — sadece 6'yı 3×2'ye indirgeyerek bilişsel yükü azaltıyor. Kullanıcının en sık
  ihtiyacı olan ayrım muhtemelen "bu satır kesin toplama giriyor mu" sorusudur (kategori
  katmanı bunu tek bakışta çözer); "hangi durumdan dolayı" sorusu (durum katmanı) ikinci
  öncelikli bilgidir ve tooltip/sağ panele bırakılabilir. Grid hücresinde her zaman 6 ayrı
  görsel öğeyi eşit ağırlıkla göstermeye çalışmak, özellikle B&W baskıda, muhtemelen başarısız
  olur.

---

## Genel Değerlendirme Tablosu

| # | Kontrol | Sonuç |
|---|---|---|
| 1 | 36 satır / 20 sütun kayıpsız gösterim | **Sorun var** — `ProcurementScope`, grup kimlikleri, `MeasurementId` eksik; `Revizyon` sütunu iki farklı kavramı karıştırıyor; `Şaft` sütunu fixture ile uyuşmuyor |
| 2 | Satır projeksiyonu vs grup otoritatif değeri | **Sorun var** — taslakta hiç ayrım yok; çapraz-dal türetim (kelepçe örneği) hiç gösterilmiyor |
| 3 | Blok/Kat/Mahal/Pafta/Zon/Revizyon klavye+yapıştırma uygunluğu | **Kısmi sorun** — hücre kontrol tipi tanımsız; `Room` gibi serbest alanlarda kapalı dropdown kullanılırsa yapıştırma kırılır |
| 4 | Yeni ölçüm ekle vs düzelt ayrımı | **Kısmi sorun** — temel mekanizma doğru ama `Stale` geçişi ve kazara çift sayım için görünür uyarı yok |
| 5 | 6 durumun renksiz ayırt edilebilirliği | **Sorun var** — taslak yalnızca 3/6 durumu kapsıyor; ayrıca 6 durum tek katmanlı ikonla güvenilir ayırt edilemez, 2 katmanlı (kategori+durum) şema önerildi |

**En yüksek öncelikli iki düzeltme:** (a) Durum sütununun 6 duruma genişletilmesi (Kontrol 5a)
— bu basit bir liste eksikliği ve düzeltmesi ucuz; (b) satır projeksiyonu ile grup otoritatif
değeri arasındaki görsel ayrımın hiç yapılmamış olması (Kontrol 2) — bu, kullanıcının yanlış
toplamla karar vermesine yol açabilecek en somut kullanılabilirlik riski.
