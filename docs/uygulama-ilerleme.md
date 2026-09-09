# Uygulama İlerlemesi — UX Öncelikli Düzeltmeler

Bu dosya, `docs/kod-inceleme-ux-oncelikli.md` içindeki maddelerin uygulanma
durumunu izler. **Her bölüm bittiğinde güncellenir** — böylece oturum
kesilse, kullanım limiti dolsa veya bilgisayar kapansa bile bir sonraki
oturum tam olarak nerede kalındığını görebilir.

**Öncelik sırası (kullanıcı tarafından belirlendi):**
1. Kullanıcı deneyimi ve kullanım kolaylığı
2. Uygulama kararlılığı
3. Veri bozulması ve güvenlik önleme
4. Sonrası (performans, yapı, temizlik)

---

## Durum özeti

| Bölüm | Durum | Commit |
|---|---|---|
| Hazırlık: kaynak baseline + .gitignore | ✅ Tamam | `5e55407` |
| T0 — Emek kaybı / yanlış sayı (10 madde) | ✅ **10/10 TAMAM** | aşağıda |
| T1 — Şaşırtıcı/engelleyici (21 madde) | ✅ **21/21 TAMAM** | aşağıda |
| T2 — Gizli doğruluk boşlukları (18 madde) | 🔄 12/18 tamam | aşağıda |
| T3 — Hissedilen yavaşlık (6 madde) | ⬜ Bekliyor | — |
| T4 — Teslim riski (4 madde) | 🔄 2/4 tamam (T4-2, T4-4) | `5e55407` |
| T5 — Yapı ve temizlik (9 alt bölüm) | 🔄 Kısmen (aşağıya bak) | — |

**Test tabanı:** Değişiklik öncesi `dotnet test Metraj.sln` → **68 başarılı, 0 başarısız**.
Her bölüm sonunda bu sayının artması (yeni regresyon testleri) ve hiç
başarısız olmaması beklenir. **Güncel: 104 başarılı, 0 başarısız.**

---

## Tamamlanan bölümler

### Hazırlık — Kaynak baseline ve ignore politikası
**Commit:** `5e55407` · **Durum:** ✅ Tamam

**Yapılanlar:**
- Sürüm kontrolü dışında kalan tüm uygulama kaynağı, testler, build
  yapılandırması ve faz dokümanları tek bir baseline commit'ine alındı
  (104 dosya). Artık her düzeltme geri alınabilir. *(T4-4)*
- `.gitignore`: `artifacts/`, `TestResults/`, `tmp/review-probes/` eklendi.
  533 MB'lik yayın çıktısı ve içindeki WebView2 tarayıcı profili
  (crash dump'ları, autofill önbellekleri) artık izlenmiyor. *(T4-2)*
- `src/Metraj.Api/WebAssets/` silindi — hiçbir yerden referans edilmeyen,
  `dist/` ile senkron olmayan eski bir JS bundle kopyasıydı. *(T4-1'in bir parçası)*

**Bilinçli olarak ertelendi:**
- `src/Metraj.Web/dist/` hâlâ izleniyor. Ignore edilmesi, T4-1'deki
  MSBuild build wiring'i yapılmadan **temiz checkout'ta arayüzsüz bir
  uygulama** üretir. İkisi birlikte yapılacak.

---

### T0-1 — Malzeme ailesi harf çakışması özetleri çökertiyordu
**Commit:** `41426f7` · **Durum:** ✅ Tamam · **Testler:** +2 (68 → 70)

Üç katman: (1) `ListSummariesAsync` artık çakışmada istisna atmıyor, en güncel
kayıt kazanıyor — kullanıcıyı her koşulda çalışır durumda tutan asıl güvence.
(2) `UpsertAsync` eşleştirmeyi C# `OrdinalIgnoreCase` ile yapıyor (SQLite NOCASE
Türkçe karakterleri kapsamıyor) ve eski çakışmaları yazma sırasında birleştiriyor.
(3) `MaterialType` sütunu NOCASE aldı; `20260908-material-waste-nocase` migration
adımı mevcut kurulumlarda tabloyu yeniden kurup çakışan satırları birleştiriyor.

Ayrıca `tests/Metraj.Tests/TestDatabase.cs` eklendi (T5.8'in paylaşılan fixture'ı) —
`-wal`/`-shm` yan dosyalarını da temizliyor.

### T0-2 — Açılış yedekleri kullanıcının yedeklerini siliyordu
**Commit:** `c7fdc9e` · **Durum:** ✅ Tamam · **Testler:** +2 (70 → 72)

Saklama kotaları ayrıldı: otomatik (BeforeMigration) 10, kullanıcı kaynaklı
(Manual + BeforeRestore) 20. Yedek adlarına ayırt edici belirteç eklendi
(sebep etiketinin önüne, `ParseReason` bozulmasın diye). `PruneOldBackups`
artık `FileInfo`'yu bir kez üretiyor ve kilitli dosyada çökmüyor.

### T0-3 — Geri yükleme yabancı SQLite dosyasını kabul ediyordu
**Commit:** `abb1a49` · **Durum:** ✅ Tamam · **Testler:** +2 (72 → 74)

`EnsureRestorableMetrajDatabaseAsync`: çekirdek tabloların varlığı
(`backup.not-metraj`), tanınmayan şema sürümü (`backup.newer-schema`),
`PRAGMA foreign_key_check` (`backup.broken-relations`). Hem seçilen dosyada hem
aşama kopyasında çalışır; kimlik kontrolü güvenlik yedeğinden ÖNCE yapılır.

Yan etki: `ApplicationSchemaMigrator.KnownSchemaVersions` / `RequiredTables`
eklendi ve sürüm defterine yazan 8 kopya-yapıştır blok tek foreach'e indi
(T5.3'ün bir kısmı — doğrulama için tek doğruluk kaynağı gerekiyordu).

### T0-6 — Ölçüm çoğaltma onaylı revizyonu değiştiriyordu
**Commit:** `4e5ec4e` · **Durum:** ✅ Tamam · **Testler:** +2 (74 → 76)

`DuplicateMeasurementAsync` artık `ProjectRevisionRules.EnsureDraft` çağırıyor;
oluşturma/güncelleme/silme ile aynı korumadan geçiyor.

### T0-4 — Onaylı revizyon genel ayarla değişiyordu
**Commit:** `d38e736` · **Durum:** ✅ Tamam · **Testler:** +2 (76 → 78)

`ProjectRevision.EffectivePolicyJson` + şema adımı
`20260908-revision-effective-policy`. Onay anında merkezi fire oranları
donduruluyor. Yeni `RevisionWastePolicy` hem dondurma hem çözme mantığını
tek yerde topluyor. Kart sürümleri ve varyant boyları zaten değişmez.
Geriye dönük: eski onaylı revizyonlarda alan boş → eski davranış korunur.

### T0-5 — Hesap önerileri bayatlamıyordu
**Commit:** `45e269c` · **Durum:** ✅ Tamam · **Testler:** +5 (78 → 83)

Yeni `CalculationFreshness`. Beş yazma yoluna bağlandı (create, batch, update,
delete, duplicate) ve ölçüm yazmasıyla AYNI SaveChanges içinde çalışıyor.
Etkilenen hedefler: yerleşimin kendisi + calculated-from ile bağlı hedefler.
`ApproveRevisionAsync` artık bayat öneri varken onaylamıyor
(`revision.stale-calculations`). Rejected/Superseded kararlar korunuyor.

### T0-9 — Dal silme yarım kalabiliyordu
**Commit:** `2c7014d` · **Durum:** ✅ Tamam · **Testler:** +3 (83 → 86)

Bütün silme adımları tek transaction'da. Dalın dışında kalan bağımlı öneriler
bağlantılar silinmeden önce bayat işaretleniyor. O(n²) yaprak soyma yerine
ebeveyn→çocuk haritası + bir kez hesaplanan derinlik; çevrim koruması var.

### T0-7, T0-8, T0-10 — Hızlı giriş ve katalog düzenleme (frontend)
**Commit:** `4df4856` · **Durum:** ✅ Tamam · **Doğrulama:** tsc temiz, vite build başarılı

- **T0-8:** `submitPipeBox` / `submitRadiator` / basit sayaç artık `await saved`
  bekliyor; hata durumunda kullanıcının yazdığı sayı kutuda kalıyor. Enter ile
  çift gönderim `busy` ile korunuyor. Ayrıca blok/kat/mahal/pafta artık her
  kayıttan sonra silinmiyor (yalnız miktar temizleniyor).
- **T0-7:** Boru paneli backend'in decimal özetini gösteriyor; JS kayan nokta
  aritmetiği kaldırıldı.
- **T0-10:** Düzenlemeye başlarken kartın tam anlık görüntüsü (`carried`)
  alınıyor; yalnız kullanıcının değiştirdiği kontrollere bağlı alanlar yeniden
  çıkarılıyor. Gizli alanlar (inputBehavior, positionNumber, salesConversion,
  reportBehavior, containerParameter) korunuyor.
- **T1-4 (yan):** Inspector artık bütün varyant özetlerini alıyor; "Şu ana
  kadar" gerçek toplamı gösteriyor.
- **T2-17 (kısmi):** `types.ts` enum'ları backend ile hizalandı.

---

---

## Sürmekte olan bölüm

### T1 — Şaşırtıcı, engelleyici veya kafa karıştırıcı
**Durum:** ✅ 21/21 tamam

Öncelikli sıra (etki/maliyet oranına göre):

| # | Madde | Durum | Not |
|---|---|---|---|
| T1-1 | Hata mesajları İngilizce | ✅ `e5cf2d7` | 106 kural için Türkçe katalog |
| T1-2 | İç hatalar 400 dönüyor | ✅ `e5cf2d7` | Alan kuralı 400, arıza 500 + log |
| T1-20 | Metraj satırı düzenlenemiyor/silinemiyor | ✅ `4bca53b` | Satır içi düzelt/sil |
| T1-15 | Toast'lar birbirini siliyor | ✅ `fbc3218` | |
| T1-17 | Yükleyici hatayı yutuyor | ✅ `fbc3218` | notifySuccess |
| T1-6 | Ekran ile indirilen dosya farklı | ✅ `fbc3218` | |
| T1-11 | Proje değişince eski seçimler kalıyor | ✅ `fbc3218` | + loadAdvanced yarış koruması |
| T1-12 | Geri yükleme sonrası geçersiz seçim | ✅ `fbc3218` | |
| T1-5 | Harita düzeni geri alınıyor | ✅ `309beac` | Konum hafızası + silme koruması |
| T1-7 | Rapordaki satın alma birimi yanlış | ✅ `e2b643e` | Üç formatta ayrı sütun |
| T1-9 | PDF/Excel'de çap-çeşit sütunu yok | ✅ `e2b643e` | Excel de eksikmiş |
| T1-8 | Ondalık hassasiyeti tutarsız | ✅ `e2b643e` | Her yüzey 6 ondalık |
| T1-10 | Excel'de uzun not kesiliyor | ✅ `e2b643e` | Satır yüksekliği 42→120 |
| T1-3 | Taslaklar her açılışta sıfırlanıyor | ✅ `69d19eb` | UiStates tablosu + /api/ui-state |
| T1-14 | Açılış ilerleme göstermiyor | ✅ `309beac` | Pencere önce, adımlar yazılıyor |
| T1-13 | window.prompt/confirm | ✅ `8c5f806` | 7 çağrı yeri AskDialog'a taşındı |
| T1-16 | Klavye/ekran okuyucu | ✅ `8c5f806` | Odak tuzağı, Escape, aria-live |
| T1-18 | Kart adı editörü değiştiriyor | ✅ `cad7317` | Aile → kod → (son çare) ad |
| T1-19 | Kartlar kod önekiyle gizleniyor | ✅ `cad7317` | Kesin kod listesi |
| T1-21 | README ekranla uyuşmuyor | ✅ `309beac` | |
| T1-4 | Varyantlı kartta toplam yanlış | ✅ `4df4856` | |

---

## Sonraki oturum için not

Kaldığın yeri bu dosyadaki "Sürmekte olan bölüm" tablosundan bul.
Her madde için izlenen yöntem:

1. Önce hatayı gösteren bir regresyon testi yaz (kırmızı).
2. Düzeltmeyi uygula (yeşil).
3. `dotnet test Metraj.sln` — tüm süit yeşil olmalı.
4. Tek maddelik commit; mesajda madde numarası (`T0-x`) geçsin.
5. Bu dosyayı güncelle.

Kusur düzeltmeleri (T0–T2) ile saf refactor'lar (T5) **aynı commit'te
birleştirilmez**.


---

## T0 bölüm kapanışı

**10/10 madde tamam.** Test tabanı 68 → 86 (18 yeni regresyon testi).
Backend maddelerinin hepsinde önce kırmızı test yazıldı, sonra düzeltildi.

**Bu bölümde ortaya çıkan yeni altyapı** (sonraki bölümlerde kullanılacak):
- `tests/Metraj.Tests/TestDatabase.cs` — paylaşılan geçici veritabanı fixture'ı
- `src/Metraj.Infrastructure/RevisionWastePolicy.cs` — etkin politika çözücü
- `src/Metraj.Infrastructure/CalculationFreshness.cs` — bayatlama işaretleyici
- `ApplicationSchemaMigrator.KnownSchemaVersions` / `RequiredTables`

**Bilinçli olarak T0'da yapılmayanlar** (ilgili bölümlere bırakıldı):
- Açılış yedeğinin yalnızca şema gerçekten değişecekse alınması → T1-14
  (açılış hızı) ile birlikte yapılacak.
- Geri yükleme sırasında bakım sınırı (Kestrel'in duraklatılması) → T2-4.
- Geri yüklemenin kendi kaynağını budaması → T2-5 (ad benzersizliği kısmı
  T0-2'de yapıldı, budama sırası kısmı kaldı).

---

## T1 bölüm kapanışı

**21/21 madde tamam.** Test tabanı 86 → 92.
Commit'ler: `e5cf2d7`, `4bca53b`, `fbc3218`, `e2b643e`, `309beac`, `8c5f806`,
`cad7317`, `69d19eb` (+ T1-4 `4df4856` içinde).

**Bu bölümde ortaya çıkan yeni altyapı** (sonraki bölümlerde kullanılacak):
- `src/Metraj.Application/DomainMessageCatalog.cs` — 106 kural kodunun Türkçe
  karşılığı. **Yeni bir kural eklenirse buraya da bir satır eklenmeli**; eksikse
  alan grubuna göre genel mesaj + kural kodu döner (asla boş kalmaz).
- `src/Metraj.Web/src/AskDialog.tsx` — söz tabanlı, erişilebilir soru/onay
  penceresi (`useAsk` + `AskDialog`). `window.confirm`/`window.prompt` artık
  kod tabanında YOK; yeni onaylar bunu kullanmalı.
- `src/Metraj.Web/src/uiState.ts` + `UiStates` tablosu — kalıcı arayüz durumu.
  `window.localStorage` uygulama kodunda artık doğrudan kullanılmıyor.
- `ApplicationSchemaMigrator.IsUpToDateAsync` — gereksiz açılış yedeği/göçü önler.
- `notifySuccess` — yalnızca işlem boyunca hiç hata olmadıysa mesaj gösterir.
- `nodePositions` ref'i — harita konumlarını yerleşim kimliğine göre hatırlar.
- `PlacementListItem.MaterialType` — arayüzün ada değil açık özelliğe bakması için.

**Kalan borç (ilgili bölümlere bırakıldı):**
- T1-19'daki gizleme listesi hâlâ frontend'de. Asıl yeri backend (`supersededBy`
  alanı veya bu kartların hiç seed edilmemesi) — T5'te ele alınacak.
- Performans testi kararsız (aşağıdaki nota bakın) — T5.8.

**Dikkat:** Frontend değişikliklerinden sonra `npm run build` çalıştırılmalı;
`src/Metraj.Web/dist` gömülü kaynak olduğu için build edilmezse değişiklik
uygulamaya ulaşmaz. **Bu, T4-1'de MSBuild'e bağlanacak.**

---

## Sıradaki bölüm: T2 — Gizli doğruluk boşlukları (18 madde)

Öncelik önerisi (kullanıcıya en yakın olandan uzağa):

| # | Madde | Not |
|---|---|---|
| T2-1 | Özet ile hesap önerisi farklı politika çözüyor | ✅ `b921b4a` — `ResolveEffectiveCard` |
| T2-2 | Rapor birden çok anlık görüntüden kuruluyor | ✅ `119ee4d` — `ReadSnapshotScope` |
| T2-8 | Ham container parametresi doğrulanıyor | ✅ `8e6cc2a` — `ResolveContentAsync` |
| T2-9 | Kural hash'i işletim sistemi diline göre değişiyor | ✅ `8e6cc2a` — InvariantCulture |
| T2-10 | Katalog hash'i taslağı hash'liyor | ✅ `8e6cc2a` — çözülmüş içerik + sıralı kanonik biçim |
| T2-4 | Geri yükleme sırasında bakım sınırı yok | |
| T2-5 | Geri yükleme kendi kaynağını budayabilir | ✅ `01c059b` |
| T2-7 | Sorumluluk benzersiz indeksi garanti vermiyor | ✅ `119ee4d` — filtreli indeksler |
| T2-6 | Yeni/yükseltilmiş şema ayrışabiliyor | |
| T2-13 | Tek-örnek kilidi "oluşturuldu"yu "alındı" sanıyor | ✅ `01c059b` |
| T2-14 | Veritabanı sessizce geçici klasöre düşebiliyor | ✅ `01c059b` — mevcut veritabanı öncelikli |
| T2-11 | API/servis doğrulaması düzensiz | |
| T2-3 | Oku-sonra-yaz eşzamanlılığı | |
| T2-12 | Bağlantı doğrulaması tüm projeleri yüklüyor | |
| T2-15 | EF bağlantı dizesi elle birleştiriliyor | ✅ `01c059b` |
| T2-16 | Ondalık temsil sözleşmesi yok | |
| T2-17 | Frontend tipleri sapmış | Kısmen yapıldı (`cad7317`, `4df4856`) |
| T2-18 | api.ts başlıkları düşürebilir | ✅ `e5cf2d7`'de yapıldı |

---

## ⛔ ORTAM ENGELİ — Kaspersky yanlış pozitifi (sonraki oturumun İLK işi)

**Kök neden bulundu:** Makinede **Kaspersky** kurulu ve etkin (Windows Defender
bu yüzden devre dışı). Kaspersky, derlenen `Metraj.Infrastructure.dll`
dosyasını **yanlış pozitif olarak karantinaya alıyor**.

**Kanıt zinciri:**
- `Get-CimInstance root/SecurityCenter2 AntiVirusProduct` → Kaspersky etkin.
- Derleme başarılı olduktan sonra bile
  `src/Metraj.Infrastructure/bin/Debug/net10.0/Metraj.Infrastructure.dll`
  **dosyası ortadan kayboluyor** (silinmiş/karantinaya alınmış).
- `obj` altındaki kopya **yazmak için açılabiliyor ama okunamıyor** — bu, bir
  süreç kilidi değil, çekirdek seviyesinde bir filtre sürücüsü davranışıdır.
- Restart Manager dosyayı tutan hiçbir süreç bulamıyor.
- Test barındırıcısı `FileNotFoundException: Could not load file or assembly
  'Metraj.Infrastructure'` veriyor (104 testin 82'si bu yüzden düşüyor).
- **Aynı kaynak bu oturumun başında 101 test yeşil geçti.** Ayrıca doğrulanmış
  `01c059b` commit'i, farklı bir yola açılan temiz bir `git worktree` içinde de
  artık derlenemiyor. Yani sorun kodda değil.
- Küçük projeler (Domain, Application) sorunsuz derleniyor; yalnızca ~500 KB'lık,
  SQLite yerel birlikte çalışma ve Office/PDF kitaplıkları içeren
  Infrastructure derlemesi hedef alınıyor.
- Dosya bazen ~3 dakika sonra serbest bırakılıyor, sonra yeniden kilitleniyor.

**Çözüm (kullanıcının yapması gerekir — güvenlik ayarı):**
1. Kaspersky → Ayarlar → Tehditler ve İstisnalar → **İstisnaları yönet**
2. Şu klasörü güvenilir listeye ekle:
   `D:\github_repo\proje-metraj-hesaplama`
   (en azından `src\**in`, `src\**\obj`, `tests\**in`, `tests\**\obj`)
3. Ayrıca "Güvenilir uygulamalar"a `dotnet.exe` eklenebilir.
4. Karantinadan `Metraj.Infrastructure.dll` geri yüklenmeli
   (Kaspersky → Karantina).
5. Sonra: `dotnet test Metraj.sln`

**Geçici çözüm (istisna eklenemiyorsa):** Derleme başarılı olana kadar
tekrar dene, sonra ~3 dakika bekleyip `dotnet test --no-build` çalıştır.
Bu oturumda derleme bu yolla başarıldı ama testler yine karantina yüzünden
çalışmadı.

**ÇALIŞAN GEÇİCİ YÖNTEM (istisna eklenene kadar bunu kullan):**

```bash
# 1) Derleme temiz olana kadar tekrar dene (Kaspersky ~90-120 sn tutuyor)
for i in 1 2 3 4 5; do
  n=$(dotnet build Metraj.sln --nologo -v q 2>&1 | grep -cE "error")
  [ "$n" = "0" ] && break
  sleep 90
done

# 2) Test ikilileri serbest kalana kadar bekle (~6-7 dakika sürebilir)
P="tests/Metraj.Tests/bin/Debug/net10.0/Metraj.Infrastructure.dll"
until head -c 2 "$P" > /dev/null 2>&1; do sleep 45; done

# 3) YENIDEN DERLEMEDEN test et
dotnet test Metraj.sln --nologo --no-build
```

Bu yöntemle **104 test yeşil** doğrulandı.

**Doğrulama durumu:**
- `01c059b` ve öncesi: **101 test yeşil**.
- `119ee4d` (T2-2, T2-7): **104 test yeşil** — doğrulandı.
- Frontend: `npm run build` **çalışıyor** (Kaspersky etkilemiyor).

**Not:** Bu oturumda yapılan bir temizlik komutu (`Get-ChildItem -Include obj,bin
-Recurse`) yanlışlıkla `src/Metraj.Web/node_modules/*/bin` klasörlerini de
sildi; `npm ci` ile geri yüklendi ve frontend derlemesi doğrulandı.
