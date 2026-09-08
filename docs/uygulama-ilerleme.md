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
| T1 — Şaşırtıcı/engelleyici (21 madde) | 🔄 1/21 (T1-4) · sıradaki bölüm | `4df4856` |
| T2 — Gizli doğruluk boşlukları (18 madde) | 🔄 Kısmen (T2-5 ad, T2-17 tipler) | — |
| T3 — Hissedilen yavaşlık (6 madde) | ⬜ Bekliyor | — |
| T4 — Teslim riski (4 madde) | 🔄 2/4 tamam (T4-2, T4-4) | `5e55407` |
| T5 — Yapı ve temizlik (9 alt bölüm) | 🔄 Kısmen (aşağıya bak) | — |

**Test tabanı:** Değişiklik öncesi `dotnet test Metraj.sln` → **68 başarılı, 0 başarısız**.
Her bölüm sonunda bu sayının artması (yeni regresyon testleri) ve hiç
başarısız olmaması beklenir. **Güncel: 86 başarılı, 0 başarısız.**

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
**Durum:** 🔄 1/21 tamam (T1-4, T0-7 ile birlikte yapıldı)

Öncelikli sıra (etki/maliyet oranına göre):

| # | Madde | Durum | Not |
|---|---|---|---|
| T1-1 | Hata mesajları İngilizce | ⬜ **Sıradaki** | `Rule` kodunu API'den geçir, UI'da Türkçeye çöz |
| T1-2 | İç hatalar 400 dönüyor | ⬜ **Sıradaki** | T1-1 ile aynı değişiklik |
| T1-20 | Metraj satırı düzenlenemiyor/silinemiyor | ⬜ | Backend hazır, yalnız UI işi |
| T1-15 | Toast'lar birbirini siliyor | ⬜ | Tek satır (timer ref) |
| T1-17 | Yükleyici hatayı yutuyor | ⬜ | |
| T1-6 | Ekran ile indirilen dosya farklı | ⬜ | |
| T1-11 | Proje değişince eski seçimler kalıyor | ⬜ | |
| T1-12 | Geri yükleme sonrası geçersiz seçim | ⬜ | |
| T1-5 | Harita düzeni geri alınıyor | ⬜ | |
| T1-7 | Rapordaki satın alma birimi yanlış | ⬜ | |
| T1-9 | PDF/Excel'de çap-çeşit sütunu yok | ⬜ | |
| T1-8 | Ondalık hassasiyeti tutarsız | ⬜ | |
| T1-10 | Excel'de uzun not kesiliyor | ⬜ | |
| T1-3 | Taslaklar her açılışta sıfırlanıyor | ⬜ | Mimari karar gerekir |
| T1-14 | Açılış ilerleme göstermiyor | ⬜ | |
| T1-13 | window.prompt/confirm | ⬜ | |
| T1-16 | Klavye/ekran okuyucu | ⬜ | |
| T1-18 | Kart adı editörü değiştiriyor | ⬜ | |
| T1-19 | Kartlar kod önekiyle gizleniyor | ⬜ | |
| T1-21 | README ekranla uyuşmuyor | ⬜ | |
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
