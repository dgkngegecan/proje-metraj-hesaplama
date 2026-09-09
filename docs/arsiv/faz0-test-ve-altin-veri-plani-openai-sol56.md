# Faz 0 — Sentetik Referans Test Planı

> 🟢 **OPENAI-SOL56 / OPENAI-LUNA56** — 2026-08-30 — Faz 0

**Durum:** `PHASE0 COMPLETE — SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`  
**Kritik not:** Kullanıcı gerçek Temiz Su Excel'inin mevcut olmadığını bildirmiş ve 2026-08-30 tarihinde sentetik referansla ilerlemeyi onaylamıştır. Bu paket **altın veri veya gerçek proje değildir**; resmî etiketi `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` olacaktır.

---

## 1. Altın veri paketinin yapısı

Faz 0 kapsamında aşağıdaki sürümlü paket hazırlanacaktır:

```text
tests/Metraj.Tests/TestData/Phase0/CleanWater/
├── manifest.json
├── provenance.md
├── fixtures/
│   ├── catalog-card-versions.json
│   ├── project-placements.json
│   ├── measurements.csv
│   ├── calculation-rule-versions.json
│   └── responsibility-assignments.json
├── expected/
│   ├── line-results.json
│   ├── calculation-groups.json
│   ├── purchase-groups.json
│   ├── aggregates.json
│   ├── report-membership.json
│   └── state-transitions.json
└── provenance.md
```

- `manifest.json`, `SourceKind=SYNTHETIC` ve `NotRepresentativeOfAnyCustomerProject=true` değerlerini zorunlu taşır.
- Her fixture `SYNTHETIC` olarak etiketlenir; ileride bulunabilecek `REAL` veri aynı kabul sonucuna karıştırılmaz.
- Ondalıklar JSON'da kültürden bağımsız string olarak saklanır: `"52.400000"`.
- Her sentetik kaynak satırı kararlı bir `SourceRowId` alır.
- Her beklenen sonuç; kaynak satır, kart sürümü, yerleşim, ölçüm ve kural sürümüyle ilişkilidir.
- Beklenen sonuçlar uygulama koduyla üretilmez. İkinci ekip bağımsız hesaplar ve çapraz kontrol eder.
- Fixture ve expected dosyalarının SHA-256 hash'leri bağımsız doğrulama tamamlandığında manifestte sabitlenir.

## 2. Sentetik kaynak satırı şablonu

Sentetik tablonun her satırı için en az şu alanlar doldurulmalıdır:

| Alan | Açıklama |
|---|---|
| `SourceRowId` | Sentetik satırın kararlı kimliği |
| `SourceDescription` | Sentetik kalemin açıklaması |
| `CardCode` / `CardVersion` | Katalog kartı ve sabitlenen sürüm |
| `CardType` | Kategori/Kapsam/Sistem/Malzeme/Ek Parça |
| `PlacementPath` | Tek ebeveynli proje ağacındaki tam yol |
| `Block/Floor/Room/Sheet/Zone` | Ölçüm bağlamı |
| `DrawingRevision` | Kaynak çizim revizyonu; proje revizyonundan ayrı |
| `InputQuantity` / `InputUnit` | Atomik fiziksel girdi |
| `WasteRate` | Uygulanan fire yüzdesi |
| `SalesConversion` | Yok/standart boy/paket |
| `StandardLength` / `PackageSize` | Varsa satış kabı parametresi |
| `ExpectedNet` | Beklenen net sonuç |
| `ExpectedWithWasteProjection` | Bilgi amaçlı satır projeksiyonu; otoritatif değildir ve toplanmaz |
| `PurchaseGroupId` | Satırın üye olduğu satın alma grubu; sonuç satırın kendisine ait değildir |
| `ExpectedReviewState` | Varsa türetilmiş sonucun durumu |
| `ExpectedReportGroups` | Satırın görünmesi gereken rapor başlıkları |

Otoritatif fireli sonuç satır fixture'ında tutulmaz. `calculation-groups.json` içinde en az şu alanlar bulunur:

| Alan | Açıklama |
|---|---|
| `CalculationGroupId` | Aynı yerleşim ve etkin fire politikasındaki grubun kimliği |
| `MemberContributionKeys` | Gruba giren özgün katkılar |
| `WasteRate` | Gruba uygulanan fire oranı |
| `ExpectedNet` | Otoritatif grup net toplamı |
| `ExpectedWithWaste` | Otoritatif grup fireli toplamı |

Satın alma sonuçları da satır fixture'ında tutulmaz. `purchase-groups.json` içinde en az şu alanlar bulunur:

| Alan | Açıklama |
|---|---|
| `PurchaseGroupId` | Kararlı grup kimliği |
| `MemberCalculationGroupIds` | Gruba giren hesap grupları |
| `CardVersionId` | Satın alınan ürün sürümü |
| `PhysicalUnit` | Grubun fiziksel birimi |
| `SalesConversion` | Yok/standart boy/paket |
| `ContainerParameter` | Standart boy veya paket içi miktar |
| `SupplyResponsibility` | Varsa temin sorumlusu |
| `ExpectedNet` / `ExpectedWithWaste` | Grup toplamları |
| `ExpectedPurchaseContainers` | Beklenen boy/paket adedi |
| `ExpectedPurchasedPhysical` | Satın alınan fiziksel karşılık |
| `ExpectedExcess` | Beklenen artan miktar |

## 3. Sentetik hesap sözleşmesi

| Kimlik | Senaryo | Girdi | Beklenen kesin sonuç |
|---|---|---|---|
| SYN-DIR-01 | Doğrudan adet | `12 adet` | Net `12`; fireli `12`; alınan `12 adet`; artan `0` |
| SYN-FIRE-01 | Fire | `100 m`, `%7,5` | Net `100 m`; fireli `107,5 m` |
| SYN-FIRE-GRP-01 | Satır projeksiyonu toplanmaz | İki satır `0,000001 m`, `%50` fire | Satır projeksiyonları `0,000002 + 0,000002`; otoritatif grup sonucu `(0,000001 + 0,000001) × 1,5 = 0,000003 m` |
| SYN-LEN-01 | Fire + standart boy | `52,4 m`, `%5`, `6 m/boy` | Fireli `55,02 m`; `10 boy`; alınan `60 m`; artan `4,98 m` |
| SYN-LEN-02 | Tam bölünme | `54 m`, `6 m/boy` | `9 boy`; alınan `54 m`; artan `0` |
| SYN-PACK-01 | Paket | `138 adet`, `25 adet/paket` | `6 paket`; alınan `150 adet`; artan `12 adet` |
| SYN-AGG-01 | Satır değil grup yuvarlama | Aynı satın alma grubunda `3,1 m` + `2,9 m`, `6 m/boy` | Toplam `6 m`; **1 boy**; satır başına yuvarlanıp 2 boy oluşmaz |
| SYN-CF-01 | Türetilmiş öneri | Kaynak net `52,4 m`; her `3 m` için `1 kelepçe` | `18 adet`; `PendingReview` |
| SYN-CF-02 | Öneriyi onaylama | SYN-CF-01 | Kullanılan `18`; `Approved` |
| SYN-CF-03 | Gerekçeli override | Öneri `18`, kullanıcı `20` | Öneri `18` korunur; kullanılan `20`; `Overridden`; gerekçe zorunlu |
| SYN-CF-04 | Kaynak değişimi | Kaynak `60,1 m` olur | Önceki sonuç `Stale`, sonra yeni öneri `21/PendingReview` doğunca eski sonuç `Superseded` |

Sentetik örneklerin bağımsız aritmetik kontrolü:

```text
52,4 × 1,05 = 55,02
ceil(55,02 / 6) = 10
10 × 6 - 55,02 = 4,98

ceil(138 / 25) = 6
6 × 25 - 138 = 12

ceil(52,4 / 3) = 18
ceil(60,1 / 3) = 21
```

## 4. Sınır ve doğrulama testleri

### 4.1 Sayısal giriş

- `0` miktar, `0` sonuç üretir; gereksiz paket veya boy üretmez.
- Negatif fiziksel ölçüm reddedilir.
- Boş miktar sıfır kabul edilmez; “eksik veri” olarak kalır.
- Altı ondalık basamaktan hassas giriş açık hata verir; sessiz yuvarlama yapılmaz.
- Türkçe `52,4` ile kültürden bağımsız `52.4` girişleri aynı canonical decimal'a dönüşür.
- Binlik ayırıcı içeren belirsiz giriş kullanıcıya doğrulatılmadan kabul edilmez.
- `9.223.372.036.854,775807` canonical miktar kabul edilir.
- `9.223.372.036.854,775808` ve hesapla bu sınırı aşan sonuç `QTY_OUT_OF_RANGE` ile reddedilir.

### 4.2 Satış kabı ve yuvarlama

- Standart boy veya paket içeriği `0` ya da negatifse kural geçersizdir.
- `54 / 6 = 9`; ilave boy yoktur.
- `54,000001 / 6` sonucu `10 boy`dur; ara değer erken yuvarlanmaz.
- `25 / 25 = 1 paket`; `25,000001 / 25 = 2 paket`.
- Önce yerleşim/fire hesap grubu; sonra uyumlu fireli sonuçlardan satın alma grubu kurulur ve en son `ceiling` uygulanır.
- Satır fire projeksiyonları toplanmaz. `SYN-FIRE-GRP-01`, altı basamaklı satır yuvarlamasının grup sonucunu değiştirmediğini doğrular.
- Farklı kart sürümü, fiziksel birim, satış dönüşümü, kap parametresi veya uyumsuz temin sorumluluğu aynı satın alma grubunda birleşmez.
- Aynı kartın iki farklı yerleşimi uyumluysa birlikte gruplanabildiği; politika veya temin sorumlusu farklıysa ayrıldığı sınanır.

### 4.3 Birim ve kural güvenliği

- Metre ile adet sessizce toplanamaz veya birbirine çevrilemez.
- Standart boy yalnız uzunluk ailesinde, paket yalnız uyumlu fiziksel birimde çalışır.
- Fire oranı negatifse reddedilir.
- `%100` üzeri fire, uyarı ve açık teyit olmadan kaydedilemez.
- Serbest metin, script veya kullanıcı kodu hesap olarak çalıştırılamaz.

## 5. İlişki, sayım ve sorumluluk testleri

- Bir yerleşimin en fazla bir `contains` ebeveyni olabilir.
- `contains` ağacı döngü oluşturamaz.
- `calculated-from` bağımlılık grafiği döngü oluşturamaz.
- İlk build'de türetilmiş bir sonuç başka bir `calculated-from` kuralına kaynak olamaz.
- Kaynak ölçüm silinir veya pasifleşirse etkin türetilmiş sonuç `Stale` olur ve kesin sayılmaz.
- `component-of` tek başına miktar üretmez.
- Yerleşim alias'ı olan `reference` ikinci bir miktar katkısı üretmez.
- İki ölçümü olan tek yerleşim başka başlığa `reference` edildiğinde iki ölçüm de alias altında görünür; genel toplam `Measurement:{id}` anahtarlarıyla yine yalnız iki özgün katkıyı sayar.
- `CalculationResult:{id}` anahtarı da referans ve sorumluluk görünümlerinde aynı türetilmiş katkının tekrar toplanmasını engeller.
- Sorumluluk görünümü aynı miktarı birden fazla boyutta gösterebilir; fiziksel genel toplam değişmez.
- Sorumluluk çözümlemesi ölçüm override → en yakın ata → proje varsayılanı → atanmamış sırasını izler.
- `Hariç` ve `Opsiyonel`, sorumlu taraf gibi raporlanmaz.

## 6. Sürüm ve geçmişi koruma testleri

- Yayımlanmış kart sürümü yerinde değiştirilemez.
- Yeni katalog sürümü eski proje yerleşimini kendiliğinden güncellemez.
- İki proje aynı immutable kart sürümünü kullanabilir; ağaçları, ölçümleri ve revizyonları birbirine karışmaz.
- Bir projenin silinmesi başka projeyi veya paylaşılan katalog kartı sürümünü silmez.
- Kart sürümü, kural sürümü, birim politikası veya motor sürümü değişince yeni hesap sonucu oluşur.
- Eski hesap sonucu ve kullandığı kaynak kimlikleri değişmeden kalır.
- Kaynak değişince daha önce onaylanmış türetilmiş sonuç sessizce yeniden yazılmaz; önce `Stale` olur, geçerli yeni öneri üretildiğinde eski sonuç `Superseded`, yenisi `PendingReview` olur.
- Manuel override gerekçesiz kaydedilemez; önerilen ve kullanılan değer birlikte saklanır.
- `Rejected` sonuç etkin katkı üretmez; reddetme kararı hesap izinde kalır.
- `Approved` proje revizyonu değiştirilemez; yeni düzenleme için yeni `Draft` snapshot gerekir.
- Saklanmış nihai raporun dosya hash'i katalog veya kural güncellendikten sonra değişmez; rapordaki her değer pinlenmiş girdiler ve sürüm setiyle yeniden açıklanabilir.
- Uygulama veritabanı yedeği geri yüklendiğinde katalog sürümleri, bütün proje sınırları ve hesap geçmişi korunur.

## 7. Rapor testleri

- Taslak rapor, seçili kapsamdaki `PendingReview` ve `Stale` kayıtları görünür uyarıyla listeler; kesin satın alma toplamına katmaz. `Superseded` yalnız geçmiş/hesap izinde görünür.
- Seçili rapor kapsamında bekleyen veya geçersiz sonuç varken nihai rapor üretimi engellenir; filtre dışındaki kayıt ilgisiz raporu bloke etmez.
- Nihai rapor yalnız manuel kesin katkıları ve etkin `Approved`/`Overridden` türetilmiş sonuçları toplar.
- Detay, sistem/kategori, kat/mahal, sorumluluk ve satın alma raporları aynı kaynak katkılardan türetilir.
- Detay rapordaki `Fireli Projeksiyon` değerleri bilgi amaçlı etiketlenir; rapor fireli toplamı `calculation-groups.json` sonucundan alır ve projeksiyonları toplamaz.
- Net, fireli, satın alma kabı, satın alınan fiziksel miktar ve artan değer sütunları birbirine karışmaz.
- Her rapor hücresinden kaynak ölçüm/sonuç ve sürüm setine geri izleme yapılabilir.
- Renk kullanılmadığında başlık seviyesi; çizgi kalınlığı, boşluk, tipografi ve desenle ayırt edilir.
- PDF ve belge çıktısı Türkçe karakter, sayfa sonu, tekrar eden başlık, toplam taşıması ve siyah-beyaz baskı açısından görsel olarak kontrol edilir.

## 8. Kullanılabilirlik ve performans testleri

- Kullanıcı ilk dalı seçtikten sonra 100 ardışık ölçümü fare kullanmadan girebilir.
- Satır ekleme, aşağı kopyalama, çoklu hücre yapıştırma, geri alma ve doğrulama klavye akışında sınanır.
- 500 satır yapıştırma sırasında geçerli satırlar ve hatalı hücreler açıkça ayrılır; hiçbir satır sessizce kaybolmaz.
- `SYN-SMOKE`, `SYN-ENTRY-500` ve `SYN-STRESS-1500` profillerinde açma, filtreleme, yeniden hesaplama ve rapor ölçümleri teknik sözleşmedeki geçici eşikleri geçer.
- Soğuk açılış/rapor beş kez çalıştırılır ve ortanca süre; etkileşimler en az 30 kez çalıştırılır ve p95 süre raporlanır.
- Testler Release/self-contained build üzerinde nihai kullanım bilgisayarında çalıştırılır.

## 9. Sentetik referans üretme yöntemi

1. OpenAI Luna 30–50 açıklanabilir atomik ölçüm satırı üretir.
2. Kaynak satırlar kart sürümü, yerleşim, bağlam, hesap grubu ve satın alma grubuyla eşlenir.
3. OpenAI ekibi expected dosyalarını uygulama kodundan bağımsız hesaplar.
4. Claude ekibi kaynak fixture'dan bağımsız ikinci hesap ve domain gerçekçilik kontrolü yapar.
5. Uyuşmazlıklar iki ayrı etiketli raporda kullanıcıya sunulur; kullanıcı nihai kararı verir.
6. Kabul edilen fixture ve expected dosyaları SHA-256 hash'leriyle manifestte pinlenir.
7. Faz 4, 5, 6 ve 8 kabul testleri aynı sürümlü paketi tekrar kullanır.
8. Gerçek bir Excel daha sonra bulunursa ayrı `SourceKind=REAL` paketi oluşturulur; sentetik sonuçlarla karıştırılmaz.

## 10. Faz 0 test kolunun tamamlanma kapısı

- [x] `manifest.json` ve `provenance.md` sentetik kaynağı ve artık riskleri açıkça tanımlıyor.
- [x] 36 sentetik kaynak satırının tamamı eşlendi; `UNRESOLVED` satır kalmadı.
- [x] Net, fireli, satış kabı, fiziksel satın alma ve artan miktar tanımları kullanıcı yönetici onayıyla kabul edildi.
- [x] Satın alma gruplama kuralı sürümlü sentetik varsayım olarak manifestte açıklandı.
- [x] `calculated-from` durumlarının tamamı ve `reference` çifte sayım vakası fixture'da bulunuyor.
- [x] Beklenen toplamlar Claude Opus 5 tarafından bağımsız hesaplandı; sıfır uyuşmazlık raporlandı.
- [x] Fixture ve expected dosyalarının SHA-256 hash'leri manifestte pinlendi.
- [x] Bütün bloke edici Faz 0 karar kapıları iki ekip ve kullanıcı onayıyla kapandı.

Bu listenin tamamı geçince durum yalnız `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` olabilir; `GOLDEN DATA COMPLETE` veya `REAL-WORLD VALIDATED` etiketi kullanılamaz.
