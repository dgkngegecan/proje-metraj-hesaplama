# Kod İncelemesi — Kullanıcı Deneyimi Öncelikli

**Tarih:** 2026-09-08
**Kapsam:** `src/` (Domain, Application, Infrastructure, Api, Desktop, Web), `tests/`, build yapılandırması, dokümantasyon.
**Kaynaklar:** Bu rapor iki bağımsız incelemeyi birleştirir — bir yapısal/kod kalitesi incelemesi (Claude Opus 5) ve bir doğruluk/çalışma zamanı incelemesi (Codex, izole probe'larla yeniden üretilmiş bulgular). Çakışan bulgular tek maddede birleştirilmiştir.

---

## Sıralama ilkesi

Maddeler **kullanıcı deneyimine verdiği zarara göre** sıralanmıştır — kod temizliğine, mimari saflığa, güvenlik sertleştirmesine veya test kapsamına göre değil.

Sıralama sorusu her madde için aynıdır: *"Metraj çıkaran bir mühendis bunu ne kadar acı hisseder?"*

| Katman | Anlamı |
|---|---|
| **T0** | Kullanıcı emeğini kaybeder veya yanlış sayıya güvenir. Gerçek bir teklifte kullanılmadan önce düzeltilmeli. |
| **T1** | Kullanıcı şaşırır, engellenir veya yanlış anlar. Günlük kullanımda sürtünme. |
| **T2** | Henüz görünmeyen ama bir adım ötede olan doğruluk boşlukları. |
| **T3** | Kullanıcının hissettiği yavaşlık. |
| **T4** | Teslim/paketleme riski — yanlış sürüm kullanıcıya gidebilir. |
| **T5** | Yalnızca geliştiriciyi ilgilendiren yapı ve temizlik. |

**Etiketler:** `[Yeniden üretildi]` = izole bir probe ile çalıştırılarak gösterildi. `[Kaynakta doğrulandı]` = kontrol akışı kodda okunarak teyit edildi, UI üzerinden çalıştırılmadı.

---

# T0 — Kullanıcı emeğini kaybeder veya yanlış sayıya güvenir

Bu on maddenin her biri tek başına "uygulama bozuk" hissi yaratır. Diğer her şeyden önce gelirler.

### T0-1. Aynı malzeme ailesini farklı büyük/küçük harfle yazmak **bütün metraj özetini çökertir**
`[Yeniden üretildi]`

`MaterialTypeWasteWorkspaceService.UpsertAsync` `x.MaterialType == normalized` ile arar; SQLite'ta TEXT karşılaştırması ve `IX_MaterialTypeWasteSettings_MaterialType` benzersiz indeksi varsayılan olarak **büyük/küçük harf duyarlıdır**. Yani `Steel` ve `steel` iki ayrı satır olarak kaydedilir.

Sonra `MeasurementWorkspaceService.ListSummariesAsync` şunu yapar:

```csharp
.ToDictionaryAsync(x => x.MaterialType, x => x.WasteRatePct, StringComparer.OrdinalIgnoreCase, ct)
```

`OrdinalIgnoreCase` iki satırı aynı anahtar sayar → `ArgumentException: An item with the same key has already been added. Key: steel`.

**Kullanıcı ne görür:** Ayarlar ekranında fire oranı girdikten sonra proje haritası, metraj çıktısı ve bütün raporlar kalıcı olarak "Bir şey ters gitti" hatası verir. Uygulama ölmüş görünür ve kullanıcının nedeni bulma şansı yoktur — üstelik hatayı tetikleyen ekran ile bozulan ekran farklıdır.

**Çözüm:** Tek bir kanonik anahtar politikası seçin ve depolama, arama ve benzersizlikte aynısını uygulayın (`COLLATE NOCASE` indeksi + normalize edilmiş yazım). Görünen etiketi ayrı bir sütunda saklayın. Mevcut çakışmaları migration sırasında açıkça birleştirin.

`src/Metraj.Infrastructure/MaterialTypeWasteWorkspaceService.cs:17`, `src/Metraj.Infrastructure/MeasurementWorkspaceService.cs:52`, `src/Metraj.Infrastructure/MetrajDbContext.cs:234`

---

### T0-2. Uygulamayı 20 kez açmak **kullanıcının bütün manuel yedeklerini siler**
`[Kaynakta doğrulandı]`

`App.OnStartup` her açılışta koşulsuz bir `BeforeMigration` yedeği alır:

```csharp
if (File.Exists(databasePath))
{
    var maintenance = new DatabaseMaintenanceWorkspaceService(() => databasePath);
    maintenance.CreateBackupAsync(DatabaseBackupReason.BeforeMigration).GetAwaiter().GetResult();
}
```

`CreateBackupAsync` bitince `PruneOldBackups()` çağırır ve `RetainedBackupCount = 20` dışındaki her şeyi siler. Açılış yedekleri ile kullanıcının "Şimdi yedekle" düğmesiyle aldığı yedekler **aynı kotayı paylaşır**.

**Kullanıcı ne görür:** Önemli bir aşamada bilinçli olarak yedek alır. Yirmi kez uygulamayı açıp kapatır. Yedek listesi artık yalnızca yirmi otomatik açılış yedeği içerir; kasıtlı olarak aldığı yedek yoktur. Yedekleme özelliğinin varlık sebebi ortadan kalkmıştır.

**Çözüm:** Açılış yedeklerini ayrı bir kotada tutun (veya yalnızca şema gerçekten değişecekse alın). Manuel yedekleri asla otomatik yedekler yüzünden budamayın. Kullanıcının bir yedeği "sabitleyebilmesi" en basit çözümdür.

`src/Metraj.Desktop/App.xaml.cs:34`, `src/Metraj.Infrastructure/DatabaseMaintenanceWorkspaceService.cs:57`, `:193`

---

### T0-3. Geri yükleme, Metraj veritabanı **olmayan** herhangi bir SQLite dosyasını kabul eder
`[Yeniden üretildi]`

`RestoreBackupAsync` doğrulama olarak yalnızca şunu yapar:

```csharp
command.CommandText = "PRAGMA quick_check;";
```

`quick_check` SQLite'ın **dosya yapısını** kontrol eder; uygulama kimliğini, şema uyumluluğunu veya alan ilişkilerini değil. Probe'da yalnızca alakasız bir tablo içeren bir dosya kabul edildi, uygulama veritabanının yerine geçti ve sonrasında "sağlıklı" olarak raporlandı.

**Kullanıcı ne görür:** Yanlış bir `.db` dosyası seçer (klasörde birden fazla program yedek bırakıyor olabilir), uygulama "Yedek geri yüklendi." der ve bütün projeleri kaybolur. Üstelik bütünlük denetimi hâlâ yeşil gösterir.

**Çözüm:** Aşama kopyasında (staging) değiştirmeden önce doğrulayın: zorunlu tabloların varlığı, `__AppSchemaVersions` içinde desteklenen bir sürüm, `PRAGMA foreign_key_check`, ve en az bir alan invaryantı. Desteklenen eski yedekleri staging'de yükseltin; gelecekteki veya alakasız şemaları reddedin.

`src/Metraj.Infrastructure/DatabaseMaintenanceWorkspaceService.cs:68`, `:127`

---

### T0-4. **Onaylanmış** bir revizyonun fireli miktarları, sonradan değiştirilen genel ayarla birlikte değişir
`[Yeniden üretildi]`

`ListSummariesAsync` her çağrıda güncel `MaterialTypeWasteSettings` tablosunu okur — revizyonun durumuna bakmadan. Probe'da kilitli bir revizyonun fireli miktarı, Steel fire oranı %10 yapıldıktan sonra `40` → `44` oldu.

**Kullanıcı ne görür:** Bir revizyonu onaylar (uygulamanın vaadi: "Onaylanan sürüm korunur"), müşteriye PDF gönderir, üç hafta sonra ilgisiz bir ayar değişikliği yapar ve aynı onaylı revizyonun PDF'i artık farklı sayılar üretir. Onaylı sürümün ne anlama geldiğine dair güven tamamen kaybolur.

**Çözüm:** Onay anında **etkin politikayı** (malzeme fire oranları, varyant boy uzunlukları) revizyona ait bir snapshot olarak yazın ve onaylı revizyonlarda o snapshot'ı kullanın. Genel ayarlar düzenlenebilir taslaklar için varsayılan olmaya devam edebilir. Bu, README'deki değişmezlik iddiasının doğru olması için gereklidir.

`src/Metraj.Infrastructure/MeasurementWorkspaceService.cs:52`, `src/Metraj.Infrastructure/ProjectWorkspaceService.cs:243`

---

### T0-5. Hesap önerileri kaynak metraj değişince **asla bayatlamaz**
`[Yeniden üretildi]`

`CalculationResultStatus.Stale` enum'da tanımlıdır ama kod tabanının hiçbir yerinde **bu değere atama yapılmaz** (grep: 1 sonuç = enum bildiriminin kendisi). `UpdateMeasurementAsync`, `DeleteMeasurementAsync` ve `CreateMeasurementAsync` yollarının hiçbiri ilgili `CalculationResults` satırlarına dokunmaz.

Probe: `10 × 2` hesaplanır, onaylanır, kaynak ölçüm `20`'ye çıkarılır. Satın alma raporu hâlâ `20` kullanır ve durum `Approved` görünür; taze bir hesap `40` verirdi.

**Kullanıcı ne görür:** Boru metrajını düzeltir. Dirsek sayısı eski borudan hesaplanmış hâliyle onaylı kalır ve satın alma listesine öyle girer. Ekranda hiçbir uyarı yoktur — sayı yanlış ama "Onaylandı" etiketi taşır. Bu, sipariş hatasına doğrudan giden yoldur.

**Çözüm:** Kaynak ölçüm ve bağımlılık değişikliklerinde etkilenen sonuçları aynı işlem içinde `Stale` yapın; eski snapshot'ı geçmiş olarak koruyun. İnceleme ve revizyon onayı öncesinde tazeliği yeniden doğrulayın. Bütün kaynak mutasyon yolları için regresyon testi ekleyin.

`src/Metraj.Domain/Model.cs:79`, `src/Metraj.Infrastructure/MeasurementWorkspaceService.cs:176`, `src/Metraj.Infrastructure/CalculationWorkspaceService.cs:283`, `src/Metraj.Infrastructure/ProjectWorkspaceService.cs:243`

---

### T0-6. Bir ölçümü çoğaltmak **onaylanmış revizyonu değiştirir**
`[Yeniden üretildi]`

`DuplicateMeasurementAsync` revizyonu hiç yüklemez, dolayısıyla `ProjectRevisionRules.EnsureDraft` çağırmaz — oysa `Create`, `Update` ve `Delete` yollarının üçü de çağırır. Probe: onaydan sonra satır sayısı 1'den 2'ye çıktı.

**Kullanıcı ne görür:** "Onaylandı ve kilitlendi" mesajını görür, sonra bir satırı kopyalar ve bu sessizce çalışır. Kilit vaadi delinir; onaylı revizyon artık bir kayıt değil, sızdıran bir kaptır.

**Çözüm:** Çoğaltmayı oluşturma ile aynı revizyon/kapsam doğrulamasından geçirin. Mevcut kaynak/köken (`SourceKind`, `SourceRowId`) semantiğini bilinçli olarak koruyun.

`src/Metraj.Infrastructure/MeasurementWorkspaceService.cs:194`

---

### T0-7. Boru panelindeki "boy" sayısı, arkadaki gerçek sayıdan farklı olabilir
`[Aritmetik yeniden üretildi]`

Inspector, backend özetini kullanmak yerine satın alma adedini kendisi, JavaScript kayan noktalı sayılarla yeniden hesaplar:

```typescript
const withWaste = entered * (1 + (summary?.appliedWasteRatePct ?? 0) / 100);
const bars = stockLength > 0 ? Math.ceil(withWaste / stockLength) : 0;
```

Kırk adet `0.1` girişi JavaScript'te `4.000000000000002` toplar. 4 m boy ile `Math.ceil` **2 boy** verir; backend'in `decimal` aritmetiği **1 boy** verir.

**Kullanıcı ne görür:** Metrajı girdiği panelde "2 boy" yazar, çıktı aldığı raporda "1 boy" yazar. Hangisine güveneceğini bilemez. Ekran ile rapor arasındaki bu tür bir çelişki, tüm aracın güvenilirliğini sorgulatır.

**Çözüm:** Panelde her varyant için backend özetini gösterin; fire/dönüşüm mantığını görünüm katmanında tekrarlamayın. Biçimlendirmeyi aritmetikten ayrı tutun.

`src/Metraj.Web/src/App.tsx:1239`

---

### T0-8. Boru, radyatör ve basit sayaç girişleri **kayıt başarılı olmadan temizlenir**
`[Kaynakta doğrulandı]`

```typescript
const submitPipeBox = (box: PipeBox) => {
  ...
  onSubmitRows([{ quantity: parsed, ... }]);                     // await YOK
  setPipeBoxes((current) => current.map(... pending: '' ...));   // yine de temizle
  onDraft({ ...draft, quantity: '' });
};
```

`submitRadiator` aynı şekilde `radiatorWidth`'i hemen sıfırlar; basit sayaç paneli de `setFittingCounts({...0})` ile anında temizler. **Yalnızca fitting yolu doğru yapar** — `const saved = await onSubmitRows(rows); if (saved) { ... }`.

**Kullanıcı ne görür:** Sahadan okuduğu bir dizi metreyi hızla girer. Bir doğrulama veya yazma hatası olur (birim uyuşmazlığı, onaylı revizyon, disk hatası). Kutu boşalmıştır, kısa bir toast geçer, ve girdiği sayı hiçbir yerde yoktur. Hızlı giriş akışı bu uygulamanın ana vaadi — burada veri kaybı en pahalı hatadır.

**Çözüm:** Fitting yolundaki `await saved` desenini üçüne de uygulayın. Enter ile arka arkaya gönderimi in-flight bayrağıyla koruyun. Önceki kayıt sürerken yazılan yeni metni ezmeyin.

`src/Metraj.Web/src/App.tsx:1173`, `:1181`, `:1265`

---

### T0-9. Bir dalı silmek projeyi **yarı silinmiş** durumda bırakabilir
`[Yeniden üretildi]`

`DeletePlacementAsync` beş ayrı toplu silme + bir döngü çalıştırır ve **hiçbiri ortak bir transaction içinde değildir**:

```csharp
await context.ResponsibilityAssignments.Where(...).ExecuteDeleteAsync(ct);
await context.CalculationResults.Where(...).ExecuteDeleteAsync(ct);
await context.PlacementLinks.Where(...).ExecuteDeleteAsync(ct);
await context.Measurements.Where(...).ExecuteDeleteAsync(ct);
for (...) { await context.ProjectPlacements.Where(...).ExecuteDeleteAsync(ct); }
```

EF Core'da `ExecuteDelete` anında ve bağımsız çalışır; birden çok toplu işlem otomatik olarak tek transaction paylaşmaz. Probe'da son yerleşim silmesi reddedildiğinde, yerleşim ayakta kaldı ama bütün ölçümleri gitti.

**Kullanıcı ne görür:** "Seçili kart ve altındaki kartlar silindi." mesajını görür ama haritada kart durmaktadır — içi boşalmış hâlde. Metrajı yok olmuştur ve geri alma yoktur.

**Çözüm:** Bütün işlemi tek bir açık transaction'a alın. Yaprak soyma döngüsü ayrıca O(n²)'dir ve hiç `SaveChangesAsync` çağırmaz (doğru ama kafa karıştırıcı — bir yorum satırı hak ediyor).

`src/Metraj.Infrastructure/ProjectTreeWorkspaceService.cs:150`

---

### T0-10. Bir kartın **yalnızca adını** değiştirmek, dokunulmayan davranışlarını sıfırlar
`[Kaynakta doğrulandı]`

Katalog düzenleyicisi her kayıtta payload'ı sıfırdan kurar:

```typescript
inputBehavior: 'Manual',
salesConversion: cardDraft.variantMode === 'Pipe' ? 'StandardLength' : 'None',
reportBehavior: (…) === 'Material' || (…) === 'Accessory' ? 'Measurable' : 'Folder',
positionNumber: null,
```

Yani `Derived` veya `Boolean` giriş davranışı, `Package` satış dönüşümü, `Auxiliary`/`Reference` rapor davranışı ve poz numarası — düzenleyicide hiç gösterilmeyen bu alanlar — yeni sürümde varsayılana döner.

**Kullanıcı ne görür:** Bir kartın yazım hatasını düzeltir. Kart artık paket dönüşümünü, poz numarasını veya türetilmiş davranışını kaybetmiştir. Hiçbir uyarı yoktur ve düzenleyici o alanları hiç göstermediği için kullanıcının kaybettiğini fark etme şansı da yoktur.

**Çözüm:** Düzenleme başlarken kartın **tam** düzenlenebilir snapshot'ını alın ve yalnızca kullanıcının değiştirdiği alanları değiştirin. Desteklenen her davranış için "yalnızca ad değişikliği" testi yazın.

`src/Metraj.Web/src/App.tsx:562`, `:604`

---

# T1 — Şaşırtıcı, engelleyici veya kafa karıştırıcı

### T1-1. Kullanıcının gördüğü **her hata mesajı İngilizce**
`[Kaynakta doğrulandı]`

118 `DomainRuleViolationException` mesajının tamamı İngilizcedir ve API bunları doğrudan kullanıcıya iletir:

```csharp
catch (DomainRuleViolationException exception) {
    context.Response.StatusCode = 400;
    await context.Response.WriteAsJsonAsync(new ApiError(exception.Message), ...);
}
```

Frontend `body.message`'ı toast'ta gösterir. Kullanıcı `"Only measurable placements can receive quantity input."` görür. İronik olarak, kullanıcının görme ihtimali **daha düşük** olan framework hataları (`"Yedeklenecek uygulama veritabanı bulunamadı."`) Türkçedir.

**Çözüm:** Her domain hatası zaten makine-okunur bir `Rule` kodu taşıyor (`"measurement.unit"`, `"tree.cycle"`) — ama API bunu **atıyor**. `Rule`'u `ApiError`'a ekleyin ve frontend'de Türkçe mesaja çözün. Bedava bir kazanç: hem yerelleştirme hem de UI'ın hata türüne göre dallanabilmesi.

`src/Metraj.Api/LocalApiHost.cs:52`, `:382`, `src/Metraj.Domain/DomainRules.cs:6`

---

### T1-2. İç hatalar, kullanıcının kendi hatasıymış gibi gösterilir
`[Kaynakta doğrulandı]`

Middleware `InvalidOperationException`'ı da yakalayıp **400** döndürür. Bu kova şunları içerir: `"MigraDoc normal stili bulunamadı."`, `"Uygulamaya gömülü sentetik Temiz Su örnek verisi bulunamadı."`, `"Raporlanacak proje bulunamadı."` — hepsi gerçek sunucu arızası.

**Kullanıcı ne görür:** Bir yazı tipi/kaynak sorunu yüzünden rapor üretilemez, ama mesaj kendi girdisinde bir hata varmış gibi sunulur. Ne yapması gerektiğine dair hiçbir ipucu almaz ve iç detay sızar.

**Çözüm:** Ayırın — `DomainRuleViolationException` → 400 + `Rule` + mesaj; diğer her şey → 500 + genel gövde + log. `DomainRuleViolationException`'ın `InvalidOperationException`'dan türememesi bunu kendiliğinden doğru hâle getirir.

`src/Metraj.Api/LocalApiHost.cs:57`

---

### T1-3. Bütün taslaklar ve tercihler **her açılışta sıfırlanır**
`[Kaynakta doğrulandı]`

API her başlangıçta işletim sisteminin seçtiği bir loopback portu dinler:

```csharp
builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
```

Port değişince WebView için **origin değişir**. `localStorage` origin'e bağlıdır. Dolayısıyla `metraj.sidebar-collapsed`, `metraj.pipe-boxes.v1.*` ve `metraj.fitting-draft.v1.*` her açılışta boş gelir.

**Kullanıcı ne görür:** Uygulama arayüzünde açıkça şu yazar: *"Bekleyen adetler bu kart, diğer kartlar ve ekranlar arasında saklanır"*. Kullanıcı yarım kalmış bir fitting sayımını ertesi güne bırakır, uygulamayı kapatır — ve her şey gitmiştir. Uygulama kendi verdiği sözü tutmuyor.

**Çözüm:** Kalıcı taslakları veritabanında (veya host üzerinden) saklayın. Alternatif olarak WebView2'nin sanal host eşlemesiyle sabit bir origin kurun. Sabit port tek başına çakışma sorunu getirir.

`src/Metraj.Api/LocalApiHost.cs:36`, `src/Metraj.Web/src/App.tsx:1054`, `:1059`, `:237`

**İlgili:** Bu taslak anahtarları yerleşim silinince **hiç temizlenmez** — `deletePlacement` yalnızca `expandedPlacementIds`'i temizler. WebView profilinde sınırsız birikme.

---

### T1-4. Varyantlı kartlarda büyük "Şu ana kadar" rakamı **yalnızca ilk çapı** gösterir
`[Kaynakta doğrulandı]`

```typescript
const activeSummary = summaries.find((item) => item.placementId === selectedPlacementId);
```

Özetler `(placementId, variant, secondaryVariant)` bazında gruplanır. Dört çaplı bir boru kartında dört satır vardır; `.find` ilkini alır.

**Kullanıcı ne görür:** DN25, DN32, DN40 ve DN50 girdiği bir boru kartını seçer. Inspector'daki en büyük, en görünür rakam yalnızca DN25'in toplamıdır ama "Şu ana kadar" başlığıyla toplam gibi sunulur. Kart üzerindeki genişletilmiş görünüm ise (`aggregateQuantity`) doğru toplamı gösterir — yani iki farklı yerde iki farklı sayı.

**Çözüm:** Yerleşim toplamı ile tek varyant özetini açıkça ayırın. Toplam gösterilecekse `.filter(...).reduce(...)` kullanın; varyant gösterilecekse etiketleyin.

`src/Metraj.Web/src/App.tsx:758`, `:1237`

---

### T1-5. Haritada düğüm sürüklemek veya klavyeyle silmek **sessizce geri alınır**
`[Kaynakta doğrulandı]`

```tsx
onNodesChange={(changes) => setNodes((current) => applyNodeChanges<PlacementNode>(changes, current))}
onEdgesChange={(changes) => setEdges((current) => applyEdgeChanges<Edge>(changes, current))}
```

Bu değişiklikler yalnızca yerel state'e uygulanır; kalıcılaştırma yoktur. Ayrıca `buildFlow` her `loadRevision`'da pozisyonları sıfırdan üretir.

**Kullanıcı ne görür:** Haritayı beğendiği gibi düzenler. Bir ölçüm kaydeder → `loadRevision` çalışır → bütün kartlar eski yerine sıçrar. Bir düğümü Delete tuşuyla siler, silinmiş görünür, sonraki yenilemede geri gelir. Haritanın "gerçek" olup olmadığı belirsizleşir.

**Çözüm:** Desteklenmeyen kaldırma değişikliklerini filtreleyin veya mevcut backend işlemlerine yönlendirin. Pozisyonları yerleşim kimliğine göre yenileme sırasında koruyun.

`src/Metraj.Web/src/App.tsx:792`, `:358`

---

### T1-6. Ekrandaki rapor ile indirilen dosya farklı olabilir
`[Kaynakta doğrulandı]`

Fire ayarı kaydetmek/silmek yalnızca `loadAdvanced()` çağırır; `summaries` önbellekte kalır. Ama `/report/excel` isteği sunucuda yeni ayarlarla yeniden kurulur.

**Kullanıcı ne görür:** Fire oranını değiştirir, Metraj çıktısı ekranındaki tablo eski sayıları gösterir, "Excel al" der ve dosyada başka sayılar bulur. Hangisinin doğru olduğunu anlamasının yolu yoktur.

**Çözüm:** Politika değişikliğinden sonra etkilenen revizyon verisini geçersiz kılın (`loadRevision`).

`src/Metraj.Web/src/App.tsx:503`, `:513`

---

### T1-7. Raporda satın alma birimi `m` yazar, ekranda `boy` yazar
`[Kaynakta doğrulandı]`

`MeasurementSummaryItem.PurchaseUnit` hesaplanır (`"boy"` / `"paket"` / birim) ve UI onu kullanır. Ama `ReportPurchaseItem`'da satın alma birimi alanı **yoktur**; `BuildPurchaseItems` girdi birimini (`item.Unit`) taşır.

**Kullanıcı ne görür:** Ekranda "Satın alma: 13 boy" görür. Satın alma listesi PDF'inde aynı satır "13 m" olarak çıkar ve tedarikçiye öyle gider. 13 metre ile 13 boy (52 metre) arasındaki fark doğrudan sipariş hatasıdır.

**Çözüm:** `ReportPurchaseItem`'a açık bir satın alma birimi alanı ekleyin ve üç yazıcıda da kullanın.

`src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:467`, `src/Metraj.Application/MeasurementContracts.cs:56`

---

### T1-8. Ondalık hassasiyeti çıktı biçimine göre değişir
`[Kaynakta doğrulandı]`

| Yüzey | Biçim | Etkin ondalık |
|---|---|---|
| UI | `Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 })` | 3 |
| Excel | `"#,##0.###"` | 3 |
| PDF / Word | `value.ToString("0.######", InvariantCulture)` | 6 |

**Kullanıcı ne görür:** `0.0004 m²` gibi küçük ama geçerli bir miktar ekranda ve Excel'de **0** görünür, PDF'te `0.0004` görünür. Kullanıcı ya sıfır sanıp veriyi siler ya da iki çıktının çeliştiğini görür.

**Çözüm:** Tek bir hassasiyet politikası belirleyin ve geçerli küçük değerlerin sıfır olarak görünmemesini sağlayın.

`src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:1109`, `:833`, `src/Metraj.Web/src/App.tsx:216`

---

### T1-9. PDF ve Excel kaynak satırlarında **çap ve çeşit sütunları yok**
`[Kaynakta doğrulandı — düzeltme]`

Word'ün "Metraj kaynak satırları" tablosu `Çap / Boyut` ve `Çeşit` içerir. PDF'in `AddSourceTable` ve Excel'in `WriteSourceWorksheet` başlıkları **ikisi de** bu iki sütunu atlar.

> *Not: Bu maddenin kaynak incelemesinde yalnızca PDF'in eksik olduğu belirtilmişti; kaynak kodda Excel sayfası da eksik.*

**Kullanıcı ne görür:** Denetim için kaynak satırlarını PDF veya Excel olarak çıkarır ve hangi satırın hangi çapa ait olduğunu göremez — oysa çap, bu uygulamanın metrajının temel ayrımıdır.

`src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:939`, `:662`, `:263`

---

### T1-10. Uzun notlar Excel çıktısında görsel olarak kesilir
`[Kaynakta doğrulandı]`

```csharp
sheet.Row(row).AdjustToContents(1, finalColumn);
sheet.Row(row).Height = Math.Clamp(sheet.Row(row).Height, 18d, 42d);
```

`WrapText` açıkken satır yüksekliği 42 punto ile sınırlanır. İçerik sığmazsa hücrede kalır ama görünmez ve baskıda çıkmaz.

**Kullanıcı ne görür:** Kartın notuna "120 kW, marka X, pompa basıncı 3 bar, mahal 204'e özel" yazar. Excel'i basar, notun yarısı yoktur. Veri kaybı değil ama teslim edilen belge eksiktir.

**Çözüm:** Sınırı temsili içeriğe göre belirleyin veya uzun metin sütunlarını kısıtlamadan muaf tutun. Uzun metinle test edin, küçük fixture'larla değil.

`src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:808`

---

### T1-11. Proje değiştirmek, önceki projenin seçimlerini geride bırakır
`[Kaynakta doğrulandı]`

`clearProjectView` şunları temizler: revizyonlar, yerleşimler, ölçümler, özetler, rapor, seçili yerleşim, düğümler, kenarlar, genişletilmişler. **Temizlemez:** `reportScopeId`, `calculationTargetId`, `calculationSourceId`, `assignmentDraft.placementId`, `rules`, `calculationResults`, `responsibilities`.

Ayrıca `loadAdvanced`, `loadRevision`'daki `revisionLoadSequence` yarış korumasına sahip değildir.

**Kullanıcı ne görür:** A projesinde bir dal seçip "Bu daldan metraj" der, B projesine geçer — Metraj çıktısı ekranı hâlâ A'nın dal başlığını gösterir ve boş çıkar. Ya da hesap komutunu eski projenin kart kimliğiyle gönderir.

**Çözüm:** Proje/revizyon seçim state'ini merkezileştirin, bağımlı seçimleri birlikte temizleyin, `loadAdvanced`'e de sıra korumasını ekleyin.

`src/Metraj.Web/src/App.tsx:299`, `:390`

---

### T1-12. Geri yüklemeden sonra uygulama **var olmayan bir projede** kalabilir
`[Kaynakta doğrulandı]`

```typescript
setSelectedProjectId((current) => current || next[0]?.id || '');
```

`current` boş değilse korunur — geri yüklenen listede olmasa bile. `reload()` aynı anda eski revizyonu yenilemeye çalışır.

**Kullanıcı ne görür:** Mevcut projeden önceki bir yedeğe döner. Üst çubukta hâlâ silinmiş projenin adı yazar, ekranlar boş veya hatalıdır ve nedenini anlamaz.

**Çözüm:** Geri yüklemeden sonra otoriter listeyi yeniden yükleyin, geçerli bir seçim yapın, sonra bağımlı veriyi yükleyin.

`src/Metraj.Web/src/App.tsx:324`, `:498`

---

### T1-13. Yıkıcı işlemler için `window.prompt` / `window.confirm`
`[Kaynakta doğrulandı]`

Red gerekçesi, elle düzeltme miktarı, kart silme, yedek geri yükleme — hepsi native tarayıcı diyalogları. Uygulama başka her yerde özenle tasarlanmış (bağlam menüleri ve dev tools kapalı, özel modal'lar, yükleme ekranı).

Ayrıca `enteredQuantity.replace(',', '.')` yalnızca **ilk** virgülü değiştirir.

**Kullanıcı ne görür:** Akıcı, özel tasarımlı bir arayüzde ilerlerken aniden Windows'un çirkin sistem kutusu çıkar. Kopyalanamaz, biçimlendirilemez, tema ile uyumsuz ve tüm uygulamayı bloklar.

`src/Metraj.Web/src/App.tsx:464`, `:471`, `:499`, `:633`

---

### T1-14. Açılış, hiçbir ilerleme göstermeden bloklar
`[Kaynakta doğrulandı]`

`OnStartup` sırayla ve **senkron olarak** bekler: yedek alma, şema migration, starter katalog seeding, bütünlük denetimi, API başlatma. Ancak bundan sonra pencere gösterilir.

**Kullanıcı ne görür:** `.exe`'ye çift tıklar. Büyük bir veritabanında hiçbir şey olmaz — pencere yok, imleç yok, geri bildirim yok. İki kez daha tıklar (ki tek-örnek kilidi bunu "zaten açık" mesajıyla karşılar). Uygulamanın açılmadığını sanır.

**Çözüm:** Pencereyi ve yükleme ekranını önce gösterin, ağır işi arkasında yürütün ve adımı yazın. `MainWindow.xaml` zaten güzel bir `LoadingScreen` içeriyor — sadece çok geç görünüyor.

`src/Metraj.Desktop/App.xaml.cs:17`

---

### T1-15. Toast'lar birbirini erken siliyor
`[Kaynakta doğrulandı]`

```typescript
const notify = (message: string) => {
  setToast(message);
  window.setTimeout(() => setToast(''), 3200);
};
```

Zamanlayıcı saklanmıyor ve iptal edilmiyor. Arka arkaya iki bildirimde ilkinin zamanlayıcısı ikincisini erken siler.

**Kullanıcı ne görür:** Hızlı çalışırken onay mesajlarının yarısını okuyamaz — özellikle hata mesajlarını.

*Not: Aynı dosyadaki `nudgeNodeIntoView` bu deseni `viewportNudgeTimers` ref'i ile doğru yapıyor; aynı düzeltme buraya da uygulanabilir.*

`src/Metraj.Web/src/App.tsx:293`

---

### T1-16. Klavye ve ekran okuyucu desteği eksik
`[Kaynakta doğrulandı]`

Modal'lar `role="dialog"` / `aria-modal` taşımıyor, odak tuzağı ve odak geri yükleme yok, Escape yolu tutarsız. Toast `aria-live` bölgesi değil. Tek global `busy` bayrağı örtüşen işlemleri temsil edemiyor.

**Kullanıcı ne görür:** Klavyeyle çalışmayı seven bir kullanıcı (metraj girişi yoğun klavye işi) modal açıldığında sekmeyle arka plandaki forma düşer. Bildirimler ekran okuyucuya hiç ulaşmaz.

**Çözüm:** Yeniden kullanılabilir erişilebilir bir dialog ve bildirim bileşeni; içerik ve aksiyonlar aynı kalsın. CSS'te zaten `prefers-reduced-motion` kuralları var — aynı politikayı programatik harita animasyonuna da uygulayın.

`src/Metraj.Web/src/App.tsx:830`, `:696`

---

### T1-17. Yükleyiciler hataları yutuyor, çağıran başarı mesajı gösteriyor
`[Kaynakta doğrulandı]`

`loadProjects`, `loadCards`, `loadRevision`, `loadAdvanced` hepsi `catch (error) { fail(error); }` ile biter ve normal döner. Çağıran `await`'ten sonra "Kart akışa eklendi." der.

**Kullanıcı ne görür:** Arka arkaya bir hata toast'ı ve bir başarı toast'ı görür. Hangisinin geçerli olduğunu bilemez.

**Çözüm:** Yapılandırılmış işlem sonuçları döndürün; başarı mesajını yalnızca tüm zincir başarılıysa gösterin.

`src/Metraj.Web/src/App.tsx:320`, `:423`

---

### T1-18. Kart adını değiştirmek hangi giriş panelinin açılacağını değiştirebilir
`[Kaynakta doğrulandı]`

```typescript
const isRadiator = /radyat[öo]r/i.test(placement.displayName);
const isCount = !isFitting && (placement.cardType === 'Accessory' || /adet/i.test(placement.unit));
```

Editör seçimi, kartın **görünen adının** regex'i ile yapılıyor.

**Kullanıcı ne görür:** "Panel Radyatör" kartını "PR-600 Panel" olarak yeniden adlandırır ve tür/yükseklik/genişlik giriş paneli kaybolur, yerine genel metre kutusu gelir. Neden olduğuna dair hiçbir ipucu yoktur.

**Çözüm:** Mevcut çıkarım kurallarını önce tek yere kapsülleyin, sonra karta açık metadata ekleyin (eski veri için geriye dönük çıkarım fallback'i kalsın). Mevcut katalog verisini sessizce yeniden yorumlamayın.

`src/Metraj.Web/src/App.tsx:1141`, `:1144`

---

### T1-19. Kullanıma kapalı kartlar UI'da kod öneki ile gizleniyor
`[Kaynakta doğrulandı]`

```typescript
const legacySteelFitting = code.startsWith('STD-STEEL-')
  && /ELBOW|TEE|FLANGE|VALVE|DIRSEK|TE|VANA/.test(`${code} ${card.name.toUpperCase()}`)
  && hasFamily('STD-FIT-STEEL');
```

**Kullanıcı ne görür:** Kendi oluşturduğu bir kartın adında "TE" veya "VANA" geçiyorsa ve kodu `STD-STEEL-` ile başlıyorsa, kart kütüphaneden **sessizce kaybolur**. Bulunamayan kart hata vermez, sadece yoktur.

**Çözüm:** Bu iş kuralı backend'e ait. Karta `supersededByCode` alanı ekleyin veya eski kartları hiç seed etmeyin.

`src/Metraj.Web/src/App.tsx:880`

---

### T1-20. Kullanıcı girdiği bir metraj satırını arayüzden düzeltemiyor/silemiyor
`[Kaynakta doğrulandı]`

Backend `PUT /measurements/{id}` ve `DELETE /measurements/{id}` endpoint'lerini sunuyor ve `MeasurementWorkspaceService` her ikisini de tam olarak uyguluyor. Frontend **hiçbirini çağırmıyor**. Inspector'daki "Giriş geçmişi" paneli satırları listeliyor ama satır başına hiçbir aksiyon sunmuyor.

**Kullanıcı ne görür:** 12,4 yerine yanlışlıkla 124 girer. Enter'a basar. Artık o satırı düzeltmenin veya silmenin bir yolu yoktur — yanlış sayı toplamda kalır. Tek çare kartın tamamını (ve altındaki her şeyi) silip baştan girmektir.

**Çözüm:** Giriş geçmişi satırlarına düzenle/sil aksiyonu ekleyin. Backend zaten hazır; iş yalnızca UI'da.

`src/Metraj.Api/LocalApiHost.cs:197`, `:202`, `src/Metraj.Web/src/App.tsx:1238`

---

### T1-21. README, ekrandaki gerçekle uyuşmuyor
`[Kaynakta doğrulandı]`

- README adım 6: **"⚙ İleri kontroller"** — düğme `⚙ Ayarlar`, nav öğesi `Ayarlar`.
- README adım 5: **"Metraj ekranında"** — böyle bir ekran yok; giriş, *Proje haritası* üzerindeki Inspector'da yapılır.

**Kullanıcı ne görür:** Kılavuzu takip eder ve tarif edilen ekranı bulamaz. Kılavuza olan güveni ilk beş dakikada kaybolur.

`README.md:9`, `src/Metraj.Web/src/App.tsx:773`, `:785`

---

# T2 — Henüz görünmeyen ama bir adım ötede doğruluk boşlukları

### T2-1. Özet hesabı ile hesap önerisi **farklı politikalar** çözüyor
`[Kaynakta doğrulandı]`

`ListSummariesAsync` malzeme fire geçersiz kılmalarını ve varyant bazlı boy uzunluklarını uygular. `CalculateAsync` ve `BuildSourceSnapshotAsync` motoru **ham katalog kartıyla** çağırır ve kaynak ölçümleri yalnızca yerleşime göre gruplar.

Aynı veri için özet ekranı ile hesap önerisi farklı sayı üretebilir. Ortak bir "etkin politika çözücü" çıkarın ve mevcut yuvarlama/gruplama sözleşmelerini koruyun.

`src/Metraj.Infrastructure/MeasurementWorkspaceService.cs:58`, `src/Metraj.Infrastructure/CalculationWorkspaceService.cs:119`, `:255`

---

### T2-2. Rapor, **birbirinden bağımsız birkaç veritabanı anlık görüntüsünden** kuruluyor
`[Kaynakta doğrulandı]`

`BuildReportDataAsync` dört ayrı servis örneği oluşturur, her biri kendi context'ini açar. Okumalar arasına giren bir yazma, kaynak satırları / özetler / sorumluluklar / hesapları farklı anlardan getirebilir.

Tek bir tutarlı okuma bağlamından değişmez bir rapor modeli kurun ve aynı modeli üç yazıcıya da verin.

`src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:30`

---

### T2-3. Taslak kontrolleri ve inceleme kararları **oku-sonra-yaz** işlemleri
`[Eşzamanlılık riski]`

Ayrı HTTP istekleri `Draft` / `PendingReview` durumunu aynı anda görüp çelişkili kararlar yazabilir. SQLite fiziksel yazmaları sıralar ama önceki uygulama kontrollerini atomik yapmaz. Süreç mutex'i veya React `busy` bayrağı komut serileştirmesi değildir.

Veritabanı kapsamlı bir komut kapısı veya koşullu güncellemeli transaction/eşzamanlılık kontrolü kullanın.

`src/Metraj.Infrastructure/ProjectWorkspaceService.cs:243`, `src/Metraj.Infrastructure/CalculationWorkspaceService.cs:283`

---

### T2-4. Geri yükleme sırasında **bakım sınırı yok**
`[Kaynakta doğrulandı]`

Kestrel, geri yükleme bağlantı havuzlarını temizlerken, dosyanın üzerine yazarken ve WAL/SHM dosyalarını silerken okuma/yazma isteklerine hizmet etmeye devam edebilir. Masaüstü mutex'i yalnızca ikinci bir uygulama örneğini engeller.

Aktif veritabanı işlemlerini drenaj eden, yenilerini duraklatan, geri yüklemeyi yapan ve doğrulamadan sonra devam ettiren paylaşılan bir bakım koordinatörü ekleyin. Geri alma yolu bırakın.

`src/Metraj.Infrastructure/DatabaseMaintenanceWorkspaceService.cs:68`, `src/Metraj.Api/LocalApiHost.cs:82`

---

### T2-5. Geri yükleme, seçilen kaynağı budayabilir
`[Kaynakta doğrulandı]`

`RestoreBackupAsync` önce `BeforeRestore` yedeği alır; bu da `PruneOldBackups()` tetikler. 20 dosya sınırındaysanız, geri yüklemek üzere seçtiğiniz **en eski yedek kopyalanmadan önce silinebilir**.

Seçilen kaynağı önce staging'e alın veya budamadan muaf tutun. Yedek adlarına benzersizlik ekleyin — mevcut zaman damgası eşzamanlı aynı-sebep istekleri için çakışabilir.

`src/Metraj.Infrastructure/DatabaseMaintenanceWorkspaceService.cs:68`, `:193`

---

### T2-6. Yeni ve yükseltilmiş veritabanları **aynı kısıtlara sahip olmak zorunda değil**
`[Kaynakta doğrulandı]`

Yeni veritabanları EF modelinden gelir; yükseltmeler elle sütun/tablo ekler. Özel tür yükseltmesi `CatalogCardTypeDefinitionId`'yi düz TEXT olarak ekler — yeni veritabanı için üretilen ilişki kısıtı ve indeksi olmadan.

Sıralı, bir-kez-çalışan migration adımları kullanın ve yeni/yükseltilmiş fixture'ların şemalarını karşılaştıran bir test ekleyin. Mevcut kurulumlar EF migration'a geçilecekse açık bir baseline geçişine ihtiyaç duyar; `EnsureCreated`'ı doğrudan `Migrate` ile değiştirmeyin.

`src/Metraj.Infrastructure/ApplicationSchemaMigrator.cs:90`, `src/Metraj.Infrastructure/MetrajDbContext.cs:79`

---

### T2-7. Sorumluluk benzersiz indeksi benzersizliği garanti etmiyor
`[Kaynakta doğrulandı]`

```csharp
assignments.HasIndex(x => new { x.ProjectRevisionId, x.ResponsibilityDimensionId, x.ProjectPlacementId, x.MeasurementId }).IsUnique();
```

Nullable `MeasurementId` içeriyor ve SQLite NULL'ları benzersizlik açısından **birbirinden farklı** sayar. İki eşzamanlı ekleme aynı doğrudan atamayı iki kez oluşturabilir. Okuma yolu GUID sırasıyla birini seçerek gizler; sonraki upsert ise tam bir satır bekler (`SingleOrDefaultAsync` → exception).

Yerleşim ve ölçüm kapsamları için ayrı filtrelenmiş benzersiz indeksler ekleyin.

`src/Metraj.Infrastructure/MetrajDbContext.cs:165`, `src/Metraj.Infrastructure/ResponsibilityWorkspaceService.cs:194`

---

### T2-8. Yeni kart sürümü **ham** container parametresini doğruluyor, çözülmüşü değil
`[Yeniden üretildi]`

`CreateVersionAsync` `draft.ContainerParameter`'ı doğrular ama çözülmüş `containerParameter`'ı kaydeder. `AttributeValues["ContainerParameter"] = "-1"` ile `ContainerParameter = -1` olan bir sürüm kaydedildi.

Bu daha sonra `CalculationEngine.Calculate` içinde patlar — yani kullanıcı hatayı kartı kaydederken değil, **rapor alırken** görür.

Ayrıca `CreateCardAsync` aynı doğrulamayı iki kez yapar (satır 51-59 ve 81-89), `CreateVersionAsync` ise farklı bir değeri doğrular. Tam etkin kartı bir kez normalize edin, onu doğrulayın, sonra kaydedin — her iki işlemde de.

`src/Metraj.Infrastructure/CatalogWorkspaceService.cs:128`, `:51`, `:153`

---

### T2-9. Kural içerik hash'i **işletim sistemi diline göre değişiyor**
`[Kaynakta doğrulandı]`

```csharp
ContentHash = ComputeHash($"...|{normalized.Multiplier:F6}|...")
```

String interpolation `CurrentCulture` kullanır. `InvariantGlobalization` ayarlanmamıştır ve hedef kitle Türkçe Windows'tur. Aynı kural tr-TR'de `1,000000`, en-US'ta `1.000000` üretir → **farklı hash**. Hash kalıcı olarak saklandığı ve izlenebilirlik iddiasının temeli olduğu için bu sessiz bir bozulmadır.

`CultureInfo.InvariantCulture` ile biçimlendirin.

`src/Metraj.Infrastructure/CalculationWorkspaceService.cs:64`

---

### T2-10. Katalog içerik hash'i, **kaydedilen** içeriği değil taslağı hash'liyor
`[Kaynakta doğrulandı]`

`ComputeContentHash` `draft.WasteRatePct`, `draft.ItemKind`, `draft.SalesConversion` kullanır — ama entity çözülmüş değerlerden kurulur (attribute geçersiz kılmaları kazanır). Gerçekten farklı içeriğe sahip iki sürüm aynı `ContentHash`'i üretebilir.

Ayrıca kalıcı bir kanonik biçim için anonim tip serileştirmesi üye sıralamasına güvenir; `record` veya `SortedDictionary` daha dayanıklıdır. Biçimlendirme de sıra dışı (`,notes = …` şeklinde baştan virgüllü).

`src/Metraj.Infrastructure/CatalogWorkspaceService.cs:248`

---

### T2-11. API ve servis sınırlarında doğrulama düzensiz
`[Kaynakta doğrulandı]`

- Non-nullable C# string'ler açık JSON `null` alabilir; birçok servis hemen `Trim()` çağırır → `NullReferenceException`.
- `ResolveEnumAttribute` `Enum.TryParse` kullanır ama `Enum.IsDefined` kontrol etmez → tanımsız enum değeri kabul edilir.
- API'nin `JsonStringEnumConverter`'ı varsayılan olarak tam sayı enum değerlerine izin verir.
- `AddPlacementAsync`, `DisplayNameOverride` ve `ProcurementScope` için uzunluk kontrolü yapmaz; `UpdatePlacementAsync` yapar.

İstek değerlerini açıkça normalize edip doğrulayın — enum üyeliği ve çözülmüş sayısal aralık dahil.

`src/Metraj.Api/LocalApiHost.cs:383`, `src/Metraj.Infrastructure/CatalogWorkspaceService.cs:417`, `src/Metraj.Infrastructure/ProjectTreeWorkspaceService.cs:32`

---

### T2-12. Bağlantı doğrulaması **bütün projelerin** bağlantılarını yüklüyor
`[Kaynakta doğrulandı]`

```csharp
var existing = await context.PlacementLinks.AsNoTracking().ToListAsync(cancellationToken);
```

Revizyon filtresi yok. `EnsureLinkAllowed` bunların tamamı üzerinde döngü kurup çevrim tespiti yapar. Hem performans hem de kapsam sorunu.

`src/Metraj.Infrastructure/ProjectTreeWorkspaceService.cs:144`, `src/Metraj.Domain/DomainRules.cs:146`

---

### T2-13. Tek-örnek kilidi "oluşturuldu" ile "alındı"yı karıştırıyor
`[Kaynakta doğrulandı]`

```csharp
var mutex = new Mutex(initiallyOwned: true, $"Local\\{applicationIdentity}", out bool createdNew);
return new ApplicationWriteLock(mutex, createdNew);
```

Önceki bir süreç mutex'i oluşturup çöktüyse `createdNew` kalıcı olarak `false` olur ve **uygulama bir daha hiç açılmaz** — kullanıcı "Proje Metraj zaten açık" mesajını görüp hiçbir şey yapamaz. `WaitOne(0)` (+ `AbandonedMutexException` yakalama) standart desendir.

Ayrıca `Mutex` thread-affine'dir; `Dispose`'un `ReleaseMutex()` çağırması yalnızca `OnStartup` ve `OnExit`'in aynı dispatcher thread'inde olması sayesinde çalışır.

`src/Metraj.Infrastructure/ApplicationWriteLock.cs:16`

---

### T2-14. Veritabanı sessizce geçici klasöre taşınabilir
`[Kaynakta doğrulandı]`

Yol çözümü `LocalApplicationData` → `ApplicationData` → **`Path.GetTempPath()`** sırasıyla düşer. Erişim iki açılış arasında değişirse uygulama projeleri kaybetmiş gibi görünür veya onları temizlenmeye açık bir konumda saklar.

Ayrıca fallback döngüsü yalnızca `UnauthorizedAccessException` yakalar; `VerifyWriteAccess` `IOException` de fırlatabilir (disk dolu, paylaşım ihlali) ve bu kalan fallback'leri atlayarak dışarı sızar.

Seçilen kalıcı konumu kaydedin ve kullanılamadığında kurtarılabilir bir depolama hatası bildirin.

`src/Metraj.Infrastructure/ApplicationDatabasePaths.cs:19`, `:36`

---

### T2-15. EF bağlantı dizesi elle birleştiriliyor
`[Kaynakta doğrulandı]`

```csharp
.UseSqlite($"Data Source={databasePath};Foreign Keys=True")
```

İki dosya ötede `SqliteConnectionFactory` zaten `SqliteConnectionStringBuilder` kullanıyor (ve yalnızca testlerden çağrılıyor — üretimde ölü). Noktalı virgül içeren geçerli bir yol burada yanlış ayrıştırılır.

`src/Metraj.Infrastructure/MetrajDbContextFactory.cs:13`, `src/Metraj.Infrastructure/SqliteConnectionFactory.cs:6`

---

### T2-16. Ondalık değerler için uçtan uca temsil sözleşmesi yok
`[Kaynakta doğrulandı]`

SQLite'ın ölçekli INTEGER tasarımı sağlamdır, ancak JSON sayıları ve TypeScript `number` backend'in desteklediği tam aralıkta her altı-ondalık değeri korumaz (`MaximumQuantity = 9_223_372_036_854.775807`). Gerektiği yerde ondalık-string DTO'lar veya belgelenmiş bir ölçekli temsil seçin.

Bunu T0-7'deki acil inspector düzeltmesinden ayrı tutun; bir tel-format değişikliği uyumluluk testi ister.

`src/Metraj.Domain/DomainRules.cs:14`, `src/Metraj.Infrastructure/ScaledDecimalConverter.cs:6`, `src/Metraj.Web/src/types.ts`

---

### T2-17. Frontend tipleri backend'den **çoktan sapmış**
`[Kaynakta doğrulandı]`

- `RevisionStatus = 'Draft' | 'Approved'` — backend'de `Archived` de var.
- `CatalogCard.reportBehavior = 'Folder' | 'Measurable'` — backend'de dört değer var.
- `Placement extends Record<string, unknown>` — React Flow için, ama `expanded` / `uiSummary` / `uiBreakdown`'un tipsiz sokulup `as` cast'lerle okunmasına kapı açıyor.

Tüm `types.ts` elle aynalanmış. Üretilmiş bir istemci veya en azından kaynak record'u işaret eden bir başlık yorumu bir sonraki sapmayı önler.

`src/Metraj.Web/src/types.ts:3`, `:59`, `:79`

---

### T2-18. `api.ts` başlıkları sessizce düşürebilir
`[Kaynakta doğrulandı]`

```typescript
const response = await fetch(`/api${path}`, {
  headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  ...init,   // <-- init.headers varsa yukarıdakini EZER
});
```

Bugün yalnızca hiçbir çağıranın `headers` geçirmemesi sayesinde doğru. `init`'i önce yayın, `headers`'ı sonra. Ayrıca: timeout / `AbortSignal` yok ve 204'te `return undefined as T` tip sistemine söylenmiş kontrolsüz bir yalan.

`src/Metraj.Web/src/api.ts:3`

---

# T3 — Kullanıcının hissettiği yavaşlık

### T3-1. Her ölçüm kaydından sonra **tüm revizyon** yeniden yükleniyor

`loadRevision` paralel olarak yerleşimleri, ölçümleri, özetleri ve **tam raporu** çeker. Rapor kendi içinde bu verinin çoğunu dört ayrı servisle tekrar yükler — yani her Enter'da veri iki kez okunur. Ardından frontend her düğüm için bütün ölçüm ve özet listelerini tarar.

**Kullanıcı ne hisseder:** Hızlı metraj girişi — uygulamanın ana vaadi — her satırda takılır. Büyük projede bu fark edilir bir gecikmedir.

**Çözüm:** Satırları ve özetleri yerleşime göre bir kez indeksleyin; rapor ve gelişmiş veriyi tembel yükleyin; yazmadan sonra yalnızca etkilenen veriyi güncelleyin veya geçersiz kılın.

`src/Metraj.Web/src/App.tsx:342`, `src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:39`

---

### T3-2. `loadRevision` her mount'ta iki kez çalışıyor
`[Kaynakta doğrulandı]`

`loadRevision` `useCallback(..., [flow])` ile tanımlı ve `flow`, ReactFlow mount olduğunda `onInit={setFlow}` ile set ediliyor. Yani kimliği değişiyor → `useEffect([loadRevision, selectedRevisionId])` tekrar tetikleniyor → dört endpoint ikinci kez yükleniyor. `flow`'u bir ref'e alın.

`src/Metraj.Web/src/App.tsx:342`, `:417`, `:792`

---

### T3-3. Karşılaştırıcıların içinde ağaç yürüyüşü

- `ListSummariesAsync`'teki yerel `Depth()` fonksiyonu ebeveyn zincirini yürür ve `OrderBy` her karşılaştırmada çağırır.
- `VariantSize()` her karşılaştırmada `SkipWhile` / `TakeWhile` + `new string(...)` tahsis eder.
- `IsAncestorOfSelected` **her çağrıda** `placements.ToDictionary(...)` yeniden kurar — ve bir `.Where()` içinden çağrılır.
- Frontend `SummaryTable.depthOf` aynı deseni tekrarlar.

Hepsini sıralamadan önce sözlüğe önceden hesaplayın.

`src/Metraj.Infrastructure/MeasurementWorkspaceService.cs:106`, `:117`, `src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs:186`, `src/Metraj.Web/src/App.tsx:1277`

---

### T3-4. Liste sorguları gereğinden fazlasını yüklüyor

- `ListCardsAsync` en son sürümü bellekte seçmek için **her kartın her sürümünü** yükler. Sürümleme bu modelin amacı olduğu için bu küme sürekli büyür.
- `ListCompatibleFittingsAsync` sonra `ListCardsAsync`'i çağırıp bellekte tekrar filtreler.
- `ListProjectsAsync` bütün revizyonları yükler.

Ortaya çıkan SQL'i ölçün, DTO içeriğini ve sıralamayı birebir koruyun.

`src/Metraj.Infrastructure/CatalogWorkspaceService.cs:21`, `:230`, `src/Metraj.Infrastructure/ProjectWorkspaceService.cs:17`

---

### T3-5. Starter katalog döngü içinde servis oluşturuyor

```csharp
foreach (StarterCard card in Cards) {
    ...
    var catalog = new CatalogWorkspaceService(contextFactory);   // <-- döngü içinde
```

~60 kart için 60 servis örneği. Döngü dışına alın (ve `ICatalogWorkspace`'e bağımlı olun).

`src/Metraj.Infrastructure/StarterCatalogWorkspaceService.cs:35`

---

### T3-6. Rapor indirmeleri tüm belgeyi belleğe alıyor

`CreateDownloadAsync` diske yazar, sonra `File.ReadAllBytesAsync` ile tamamını ikinci bir `byte[]`'e okur. Yanıt-sahipli bir stream (`FileOptions.DeleteOnClose`) hem akıtır hem kendini temizler.

`src/Metraj.Api/LocalApiHost.cs:347`

---

# T4 — Teslim riski: yanlış sürüm kullanıcıya gidebilir

### T4-1. Frontend derlemesi **build'in parçası değil**
`[Kaynakta doğrulandı]`

```xml
<EmbeddedResource Include="..\Metraj.Web\dist\**\*" LogicalName="Metraj.Api.Web.%(RecursiveDir)%(Filename)%(Extension)" />
```

`dist`'i üreten hiçbir MSBuild target'ı veya check-in edilmiş build script'i yok. Klasör yoksa **arayüzü olmayan** bir assembly çıkar; klasör bayatsa **eski arayüz** teslim edilir.

Bunu doğrulayan somut kanıt: `src/Metraj.Api/WebAssets/` diye ikinci bir üretilmiş kopya var, hiçbir yerden referans edilmiyor ve **eski bir JS bundle** içeriyor:

```
src/Metraj.Api/WebAssets/assets/index-Du4tW2oc.js   <-- eski, referanssız
src/Metraj.Web/dist/assets/index-sx1PO7dj.js        <-- güncel, gömülen
```

(CSS hash'i aynı, JS hash'i farklı — yani gerçekten farklı sürümler.)

**Kullanıcı ne görür:** Düzeltilmiş sanılan bir hatayı taşıyan `.exe`. Bunu teşhis etmenin yolu yoktur.

**Çözüm:** Tek, belgelenmiş bir temiz-checkout build komutu: bağımlılık restore → TS kontrolü → frontend build → kaynak doğrulama → desktop build/test/publish. Beklenen varlıklar yoksa **açıkça başarısız olun**. `WebAssets` klasörünü silin.

`src/Metraj.Api/Metraj.Api.csproj:15`, `src/Metraj.Web/vite.config.ts:4`

---

### T4-2. `artifacts/` 533 MB ve ignore edilmiyor
`[Kaynakta doğrulandı]`

`git status` bunu untracked gösteriyor ve içinde tam bir WebView2 tarayıcı profili var:

```
artifacts/ProjeMetraj-react-win-x64/metraj.desktop.exe.WebView2/EBWebView/Crashpad/...
artifacts/ProjeMetraj-react-win-x64/metraj.desktop.exe.WebView2/EBWebView/Default/AutofillAiModelCache/...
```

Crash dump'ları, autofill önbellekleri, LOCK dosyaları. Bir `git add .` uzaklıkta.

`.gitignore`'a `artifacts/`, `TestResults/` ve `src/Metraj.Web/dist/` ekleyin. Yayınlanan sürümleri bir release kanalında tutun.

`.gitignore`

---

### T4-3. Araç zinciri sabitlenmemiş, CI yok
`[Kaynakta doğrulandı]`

`global.json` yok, Node sürüm politikası yok, CI yok. `LangVersion=latest` + `AnalysisLevel=latest-recommended` + `TreatWarningsAsErrors=true` birleşimi, farklı bir SDK'nın uyarı tabanını değiştirip build'i kırabileceği anlamına gelir.

`Directory.Build.props:3`, `src/Metraj.Web/package.json:6`

---

### T4-4. Bütün uygulama **hâlâ versiyon kontrolü dışında**
`[Kaynakta doğrulandı]`

`git status`: `src/`, `tests/`, `Metraj.sln`, `Directory.Build.props` ve 20 doküman `??` olarak işaretli; geçmişte yalnızca iki commit var. Bu raporda anlatılan hiçbir şey henüz geri alınabilir değil.

Değişikliklere başlamadan önce kasıtlı bir kaynak baseline'ı oluşturun.

---

# T5 — Yapı ve temizlik (yalnızca geliştirici görür)

Bu bölümdeki hiçbir madde kullanıcıya görünmez. Yukarıdakiler bittikten sonra ele alın.

## 5.1 Build yapılandırması

- Her `.csproj` MSBuild'in zaten varsaydığını tekrar ediyor: `AssemblyName` ve `RootNamespace` proje dosya adından türer — beş bildirimin tamamı gürültü. `<TargetFramework>net10.0</TargetFramework>` dört kez, `<NoWarn>$(NoWarn);CS1591</NoWarn>` dört kez tekrarlanıyor; ikisi de `Directory.Build.props`'a ait.
- `GenerateDocumentationFile=true` global, ama her projede `CS1591` susturuluyor — yani XML doc üretilip eksik olduğunu söyleyen uyarı bastırılıyor. Birini seçin.
- Merkezi paket yönetimi (`Directory.Packages.props`) yok. `Microsoft.Data.Sqlite` bir yerde, geçişli güvenlik açığı geçersiz kılması (`SQLitePCLRaw.lib.e_sqlite3`) başka yerde sabitli.
- `.editorconfig`'de TypeScript bölümü yok — `[*]` `indent_size = 4` diyor, React kodu 2 boşluk.
- Solution'da `src` / `tests` klasörleri yok.

## 5.2 Domain katmanı

- `CalculationEngine` tek statik metotlu `sealed class` → `static class` olmalı.
- Üç boş `AssemblyMarker` sınıfı. Testler `typeof(CatalogCardDefinition).Assembly` kullanabilir.
- Ölçek sabiti iki yerde ve birbirinden habersiz: `QuantityRules.MaximumQuantity` tam olarak `long.MaxValue / 1e6`, `ScaledDecimalConverter` `1_000_000m`'ı dört kez sabit yazıyor, ve `ScaledDecimalConverter.Scale = 6` **hiçbir yerde kullanılmıyor** (gerçekte kullanılan `QuantityRules.DecimalScale`).
- Navigation koleksiyonları `{ get; set; }` — EF `{ get; }` ile de çalışır.
- Yedi `…Json` string özelliği ve her okuma noktasında elle ayrıştırma → altı neredeyse aynı `try { Deserialize } catch (JsonException) { return []; }` yardımcısı, `ParseIds(string json)`'ın iki birebir kopyası dahil (`DomainRules.cs:201` ve `CatalogCardTypeWorkspaceService.cs:154`). Tek bir `JsonListConverter<T>` altısını da siler.
- `DomainRules.cs:175`'te gölgelenen değişken: `.Select(link => link.TargetPlacementId)` — metodun parametresi de `link`.
- **Ölü enum üyeleri** (hiçbir yerde üretilmiyor): `ReportBehavior.Auxiliary`, `ReportBehavior.Reference`, `SemanticLinkType.ComponentOf`, `SemanticLinkType.Reference`, `ProjectRevisionStatus.Archived`, `CalculationResultStatus.Stale` (bkz. T0-5). `ProjectPlacement.NoPool` yazılıyor ama okunmuyor — Faz 0 sözleşmesindeki havuzlama kapsamı gerçekleşmemiş, açık bir "ertelenmiş kapsam" notu hak ediyor. `CatalogCardVersion.IsPublished` her yerde `true` atanıyor, hiç sorgulanmıyor.

## 5.3 `ApplicationSchemaMigrator` (216 satır — repodaki en dağınık dosya)

- **Sürüm defteri yalnızca yazılıyor:** yedi `INSERT OR IGNORE` ilgili adım çalışsın çalışmasın koşulsuz yürütülüyor ve tablo hiç **okunmuyor**. `foreach (string version in AppliedVersions)` ile 21 satır → 4 satır.
- **`EnsureColumnAsync` var ama iki çağıran kullanmıyor:** `EnsureCalculationQuantityColumnsAsync` ve `EnsureCardVersionNameColumnAsync` aynı pragma probe + `ALTER TABLE` işini 25'er satırda yeniden yazıyor.
- **Bağlantı açma preamble'ının beş kopyası** — `GetOpenConnectionAsync(context, ct)` olarak çıkarın.
- **Aynı metotta karışık parametreleme:** `EnsureColumnAsync` `$name`'i düzgün bind ediyor, iki satır sonra `{table}` ve `{column}`'u doğrudan SQL'e enterpole ediyor. Bugün güvenli (hepsi literal), ama tutarsızlık dinamik bir çağıran eklendiğinde güvenli olmaktan çıkar.
- `ConfigureAwait(false)` bu dosyada bile tutarsız (satır 75-78 yok, 104-105 var) ve 20 infrastructure dosyasının yalnızca ikisinde kullanılıyor. Burada normalden önemli: `App.OnStartup` WPF dispatcher thread'inde `.GetAwaiter().GetResult()` ile blokluyor, yani migrator'daki `ConfigureAwait(false)` stilistik değil **yük taşıyan** bir detay.

## 5.4 Servislerdeki tekrar

- **Aynı string normalize edicinin beş kopyası**, farklı isimlerle ve birebir aynı gövdeyle: `MeasurementWorkspaceService.cs:354`, `ProjectTreeWorkspaceService.cs:184`, `ResponsibilityWorkspaceService.cs:228`, `CatalogCardTypeWorkspaceService.cs:112`, `CatalogWorkspaceService.cs:435`. Artı `NormalizeRequired`'ın iki kopyası. Tek bir `TextRules` statik sınıfı yeter.
- `this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));` **on bir kez**. `MaterialTypeWasteWorkspaceService` zaten primary constructor kullanıyor ve çok daha okunaklı.
- `CatalogWorkspaceService.CreateCardAsync` ve `CreateVersionAsync` ~50 satırı birebir paylaşıyor. `ResolveCardContent(draft, customType)` çıkarımı hem tekrarı hem T2-8'deki doğrulama sapmasını görünür kılar.
- `CatalogCardAttributeCatalog.NormalizeKeys`, `OrderBy` anahtar seçicisinin **içinde** `All.ToArray()` çağırıyor — eleman başına tam dizi tahsisi. Sınıf zaten `KnownKeys` HashSet'i kuruyor; yanına bir indeks sözlüğü ekleyin. `NormalizeAttributeValues` de aynı şekilde anahtar başına `FirstOrDefault` lineer taraması yapıyor.

## 5.5 `ProjectReportWorkspaceService` (1.148 satır)

- **Kendi DI kaydını atlayan tek yer:** dört somut servisi `new`'liyor (`new MeasurementWorkspaceService(contextFactory)` vb.) — oysa dördü de `LocalApiHost`'ta üç satır arayla interface olarak kayıtlı. Constructor ile enjekte edin (T2-2'yi de çözer).
- **Altı export metodu üç kopya-yapıştır çifti:** `ExportExcelAsync` / `ExportSubtreeExcelAsync` yalnızca hangi builder'ı çağırdıklarında farklı. Tek `ExportAsync(data, path, format)` çekirdeği + altı ince sarmalayıcı ~60 satır siler.
- **Sütun tanımları üç kez yazılmış** ve **zaten sapmış**: Excel özet sayfası `… Satın alma, Çap/Boyut, Çeşit` sırasında; PDF `… Çap/Boyut, Çeşit, Satır, … Satın alma` sırasında. `(header, pdfWidth, excelWidth, accessor)` içeren tek bir `ReportTable` record'u üç yazıcıyı yapısal olarak senkron tutar (ve T1-9'u imkânsız kılar).
- **`ApplyWorksheetStyle` anlamı UI etiketinden çıkarıyor:**
  ```csharp
  if (headerText is "Satır" or "Net" or "Fireli" or "Kullanılan" or "Miktar" || headerText.StartsWith("Satın alma", ...))
  ```
  Bir başlığı yeniden adlandırın, sayı biçimlendirmesi sessizce kaybolsun.
- Yedi birebir aynı `for (int column = 0; ...) sheet.Cell(headerRow, column + 1).Value = headers[column];` döngüsü.
- `SafeCellText`'in formül-enjeksiyon koruması iyi bir detay — `'` ön ekinin neden orada olduğunu söyleyen tek satırlık bir yorum hak ediyor.
- `EnsurePdfFontsConfigured` platform kontrolünü elle yapıyor; `[SupportedOSPlatform("windows")]` bunu analiz edici ile zorunlu kılar ve imzada belgeler.

## 5.6 API katmanı

- `MapWorkspaceEndpoints` tek bir **185 satırlık** metot. Alan bazlı `IEndpointRouteBuilder` extension'larına bölün.
- **On iki birebir aynı DI kaydı:** `() => MetrajDbContextFactory.Create(databasePath)` lambda'sı on iki kez yazılmış. Bir kez `AddSingleton<Func<MetrajDbContext>>(...)` kaydedin, hepsi `AddSingleton<IX, X>()` olsun.
- **UI'ın hiç çağırmadığı endpoint'ler:** `/health`, `/placements/{id}/compatible-fittings`, `POST /measurements/{id}/duplicate`, `PUT /measurements/{id}`, `DELETE /measurements/{id}` ve dört `/report/subtree/{id}/{format}` rotası — sonuncu grup, frontend'in gerçekten kullandığı `/report/{format}?placementId=`'nin ikinci bir yazımı. Aynı özellik için iki paralel rota şeması. (`PUT`/`DELETE /measurements/{id}` ayrıca bir UX boşluğu — bkz. T1-20.)
- `CreateDownloadAsync` ve `CreateSubtreeDownloadAsync` aynı metot, tek fazla `Guid` ile — ve iki farklı stilde yazılmış.
- **`OpenEmbeddedWebAsset` build makinesinin yol ayıracını çalışma zamanına gömüyor:**
  ```csharp
  string resourceName = "Metraj.Api.Web." + assetPath.Replace('/', '\\');
  ```
  `?? GetManifestResourceStream("Metraj.Api.Web.assets\\" + ...)` fallback'i ve yorumu bunun daha önce ısırdığını düşündürüyor. Başlangıçta `GetManifestResourceNames()`'den bir `Dictionary<string, byte[]>` kurun: ayıraç tahmini kalkar, `..` traversal kontrolü gereksizleşir (sözlük araması traversal yapamaz), ve sabit bir bundle istek başına stream açmak yerine bellekten servis edilir.
- **24 request record'u** Application draft'larını neredeyse alan alan tekrarlıyor; `CreateMeasurementRequest` ile `UpdateMeasurementRequest` tam olarak bir alanla farklı.
- **Hiç loglama yok** — `builder.Logging` dokunulmamış, hiçbir servise `ILogger` enjekte edilmemiş. Üründeki tek teşhis aracı `proje-metraj-startup-error.log` ve toast'lar.

## 5.7 Frontend yapısı

- **`App.tsx` 1.356 satır**, tek bileşende 40+ `useState`. Semptomlar: `AdvancedControls` **40 prop** alıyor, `CatalogPage` 22 prop alıyor. Görünüm bazlı bölme (`FlowPage`, `SettingsPage`, `ControlPage`) + iki custom hook (`useProjectData`, `useRevisionData`) bu listeleri üçte ikisi kadar kısaltır.
- **Birkaç JSX satırı 1.000 karakteri aşıyor** — satır 826, 1239, 1264, 1265, 1273, 1280. Satır 1239 tek satırda bütün bir boru ölçüm panelini, iç içe `.map()`, üç `.filter()` ve satır içi `Math.ceil` ile barındırıyor. Repodaki en büyük okunabilirlik sorunu ve **mekanik olarak** düzeltilebilir: `printWidth: 120` ile Prettier, sıfır davranış değişikliği.
- **ESLint yok, Prettier yok, `lint` script'i yok, frontend testi yok.** `package.json`'da yalnızca `dev` / `build` / `preview` var. Metraj aritmetiği ve hidrasyon mantığı içeren 1.300 satır sıfır testle; C# tarafında 19 test dosyası var. `eslint-plugin-react-hooks` özellikle T3-2 ve aşağıdaki maddeyi yakalardı.
- **Inspector hidrasyon efekti `placement?.variants`'a bağımlı** (satır 1137) — her fetch'te yeni dizi kimliği, yani 85 satırlık localStorage ayrıştırma her ölçüm kaydından sonra yeniden çalışıyor.
- **`expandedPlacementIds` state'i ile `expandedPlacementIdsRef` dört yerde elle senkronlanıyor** ve sapabilir.
- **Yapılandırılmış veri serbest metin üzerinden gidip geliyor:** `measurement.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim()` Inspector'da **beş ayrı kez** geçiyor; `measurementLabel()` de radyatör bilgisini Türkçe düzyazıdan regex'le ayıklıyor. Aynı değerler zaten `variant` / `secondaryVariant` alanlarında ve oradan yazılıyorlar.
- **Referans verisi dil sınırında çoğaltılmış:** `App.tsx`'teki `STEEL_DIAMETERS`, `PPRC_DIAMETERS`, `FITTING_PRESETS`, `StarterCatalogWorkspaceService.cs`'teki `SteelPipeVariants`, `PprcPipeVariants`, `FittingVariants`'ın değer-değer kopyası. Uygulama zaten `/api/catalog/attributes` ile bu tür bir sözlüğü sunuyor.
- **`buildFlow`'un özyinelemesinde çevrim koruması yok** — oysa bu kod tabanındaki diğer her ağaç yürüyüşünde var (`guard++ < 24`, `depth < 64`, `visited` seti). Bozuk bir ebeveyn zinciri render'ı stack overflow'a sokar.
- `Number(x.replace(',', '.'))` ~10 kez, her seferinde biraz farklı korumayla. Tek bir `parseDecimal(input): number | null`.
- `tsconfig.json`: `strict: true` iyi; `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` ekleyin. Sonuncusu `options[attribute.key].map(...)` (satır 960) ve `radiator[1]` (satır 231) hatalarını yakalar.
- `styles.css` 742 düz satır ve palet dört ayrı yerde: `#1F4E78` `ProjectReportWorkspaceService.cs`'te (Excel **ve** PDF **ve** Word), `#080D18` hem `MainWindow.xaml`'de hem CSS'te, `#7787a7` `App.tsx`'te.

## 5.8 Testler

- **Aynı iskeletin ~30 kopyası.** Her `[Fact]` şöyle başlıyor:
  ```csharp
  string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-x-{Guid.NewGuid():N}.db");
  try {
      await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
          await ApplicationSchemaMigrator.MigrateAsync(context);
      ...
  } finally { SqliteConnection.ClearAllPools(); File.Delete(databasePath); }
  ```
  `EnhancedWorkflowRegressionTests` bu yardımcıları (`NewDatabasePath` / `InitializeAsync` / `Cleanup`) **zaten çıkarmış** — paylaşılan bir `TempDatabase : IAsyncDisposable`'a terfi ettirin, ~250 satır gider.
- Temizlik tutarsız: yalnızca `EnhancedWorkflowRegressionTests.Cleanup` `-wal` ve `-shm` yan dosyalarını siliyor; diğer her test her çalıştırmada `%TEMP%`'e iki dosya sızdırıyor.
- Assembly geneli `DisableTestParallelization`, `ClearAllPools()` süreç-genelinde olduğu için. Gerekçe belgelenmiş ve makul — ama tüm süiti kalıcı olarak sıralı hâle getiriyor. Havuz temizleyen testleri tek bir `[Collection]`'a almak diğer 17 dosyanın paralel çalışmasına izin verir.
- **Kapsam boşlukları:** yeniden üretilen yedi vakanın hiçbiri mevcut 68 testle yakalanmıyor. Ekleyin: her endpoint üzerinden onaylı-revizyon mutasyonu, etkin politika eşitliği, istek null/enum doğrulaması, proje-değiştirme yanıt yarışları, başarısız kayıtta taslağın korunması, harita kaldırma/yenileme davranışı.
- Performans testleri 50.000 satıra kadar çıkıyor ama çoğunlukla çok az yerleşimle. Gerçekçi çok-yerleşimli ağaçlar ve tarayıcı render ölçümü ekleyin — backend yük testi DOM ve harita maliyetini ölçmüyor.
- Rapor testi Excel içeriğini kontrol ediyor ama PDF için ağırlıklı olarak varlık/sayı kontrolü yapıyor; Word testleri OpenXML yapısını doğruluyor, görsel sayfalamayı değil. Uzun adlar, Türkçe metin, varyant-yoğun veri ve çok sayfalı tablolar için render edilmiş örnekler ekleyin.

## 5.9 Dokümantasyon

- `docs/` içinde 27 faz dokümanı, dosya adlarında ajan isimleriyle (`-openai-sol56`, `-claude-opus5`). Arşiv olarak sorun değil, ama yaşayan referansı (`domain-sozlugu.md`, `kullanim-ve-yedekleme-kilavuzu.md`) tarihsel devirlerden ayıran hiçbir şey yok. Bir `docs/README.md` indeksi veya `docs/archive/` alt klasörü.
- Faz 0 teknik sözleşmesi, kodun tam olarak gerçekleştirmediği stale geçişlerini ve tedarik havuzlamasını tarif ediyor. Bunları **açık boşluk / ertelenmiş kapsam** olarak koruyun — temizlik sırasında özellik ekleme davetiyesi olarak değil.
- Mevcut `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` niteliği korunmalı.

---

# Önerilen uygulama sırası

**1. Önce ağı gerin.** Kaynak baseline'ını commit'leyin (T4-4), `artifacts/` ve `dist/`'i ignore edin (T4-2), tek bir temiz build komutu kurun (T4-1). Bunlar olmadan aşağıdaki hiçbir düzeltme güvenle geri alınamaz veya güvenle teslim edilemez.

**2. Sonra T0'ı, madde madde, ayrı değişikliklerle.** Her biri için önce başarısız durumu gösteren bir test yazın. Mevcut kullanıcı verisinin kopyaları üzerinde migration test edin. Sıra önerisi:

| # | Madde | Neden bu sırada |
|---|---|---|
| 1 | T0-1 (harf çakışması) | Uygulamayı tamamen kullanılamaz hâle getiriyor, düzeltmesi küçük |
| 2 | T0-8 (girişler kayıp) | Doğrudan emek kaybı, düzeltme deseni zaten kodda var |
| 3 | T0-2, T0-3 | Yedek/geri yükleme güvenilir olmadan diğer düzeltmeler risk altında |
| 4 | T0-5, T0-4, T0-6 | Onaylı revizyon bütünlüğü — üçü birlikte tek bir tutarlı hikâye |
| 5 | T0-7 | Ekran/rapor çelişkisi, tek dosyada küçük değişiklik |
| 6 | T0-9, T0-10 | Transaction ve tam-snapshot düzenleme |

**3. Sonra T1'i.** T1-1 ve T1-2 birlikte tek bir küçük değişiklik (`Rule` kodunu API'den geçirmek) ve algılanan kaliteyi orantısız yükseltir. T1-20 (satır düzenle/sil) backend hazır olduğu için düşük maliyetli, yüksek etkili. T1-3 mimari bir karar gerektirir; erken planlayın.

**4. T2 ve T3 ölçüme dayalı ilerlesin.** T2'deki eşzamanlılık ve şema maddeleri gerçek kullanım profiline göre önceliklendirilebilir (tek kullanıcılı çevrimdışı bir uygulamada eşzamanlılık riski düşüktür ama sıfır değildir — WebView aynı anda birden çok istek atar).

**5. T5 en son ve fırsat buldukça.** Yapısal çıkarımlar (React modüllerini bölmek, rapor yazıcılarını ayırmak) yukarıdaki korkuluklar kurulduktan **sonra** yapılmalı; öncesinde davranış değişikliğini fark etmenin yolu yok. Prettier ve `TextRules` gibi mekanik temizlikler ise doğruluk çalışmasıyla yarışmadan herhangi bir anda yapılabilir.

**Ayrı tutulması gerekenler:** Kusur düzeltmeleri (T0–T2) davranışı bilerek değiştirir; saf refactor'lar (T5) değiştirmemelidir. İkisini aynı commit'te birleştirmeyin.

---

# Not edilen sınırlar

- Bu bir kaynak ve çalışma-zamanı-probe incelemesidir; her görsel durumun veya olası her arızanın denendiği iddia edilmez.
- `[Yeniden üretildi]` bulguları izole, yeni oluşturulmuş veritabanlarında çalıştırılmıştır; kullanıcının gerçek veritabanı ve paketlenmiş `.exe` açılmamıştır.
- Mevcut test süiti bu inceleme sırasında geçmektedir (68 passed, 0 failed) — yani buradaki bulguların hiçbiri mevcut testlerle yakalanmıyor.
- Paket güvenlik açığı taraması NuGet endpoint'ine erişilemediği için yapılamadı; **güncel bir bağımlılık güvenlik yargısı yoktur**.
- Bu inceleme hiçbir uygulama kaynağını, testi, yapılandırmasını veya veritabanını değiştirmemiştir.
