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
| T0 — Emek kaybı / yanlış sayı (10 madde) | 🔄 4/10 tamam | aşağıda |
| T1 — Şaşırtıcı/engelleyici (21 madde) | ⬜ Bekliyor | — |
| T2 — Gizli doğruluk boşlukları (18 madde) | ⬜ Bekliyor | — |
| T3 — Hissedilen yavaşlık (6 madde) | ⬜ Bekliyor | — |
| T4 — Teslim riski (4 madde) | 🔄 2/4 tamam (T4-2, T4-4) | `5e55407` |
| T5 — Yapı ve temizlik (9 alt bölüm) | 🔄 Kısmen (aşağıya bak) | — |

**Test tabanı:** Değişiklik öncesi `dotnet test Metraj.sln` → **68 başarılı, 0 başarısız**.
Her bölüm sonunda bu sayının artması (yeni regresyon testleri) ve hiç
başarısız olmaması beklenir. **Güncel: 76 başarılı, 0 başarısız.**

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

---

## Sürmekte olan bölüm

### T0 — Kullanıcı emeğini kaybeder veya yanlış sayıya güvenir
**Durum:** 🔄 4/10 tamam

| # | Madde | Durum |
|---|---|---|
| T0-1 | Harf çakışması bütün özetleri çökertiyor | ✅ `41426f7` |
| T0-2 | Açılış yedeği manuel yedekleri siliyor | ✅ `c7fdc9e` |
| T0-3 | Geri yükleme yabancı SQLite dosyasını kabul ediyor | ✅ `abb1a49` |
| T0-4 | Onaylı revizyon genel ayarla değişiyor | 🔄 Sıradaki |
| T0-5 | Hesap önerileri bayatlamıyor | ⬜ |
| T0-6 | Çoğaltma onaylı revizyonu değiştiriyor | ✅ `4e5ec4e` |
| T0-7 | Boru panelindeki boy sayısı yanlış (float) | ⬜ |
| T0-8 | Girişler kayıt başarılı olmadan temizleniyor | ⬜ |
| T0-9 | Dal silme yarım kalabiliyor (transaction yok) | ⬜ |
| T0-10 | Kart adı değişince davranışlar sıfırlanıyor | ⬜ |

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

## T0-4 ve T0-5 için plan (sıradaki iş)

İkisi de "onaylı revizyon dondurulmuş olmalı" başlığının parçası ve ortak
altyapı gerektiriyor:

- **T0-4:** Onay anında etkin politikanın (malzeme fire oranları, varyant boy
  uzunlukları) revizyona ait snapshot'ı yazılacak; `ListSummariesAsync` onaylı
  revizyonlarda genel ayar yerine bu snapshot'ı kullanacak. Yeni bir şema adımı
  ve muhtemelen `ProjectRevision` üzerinde bir `EffectivePolicyJson` alanı gerekir.
- **T0-5:** Kaynak ölçüm değişince (`Create`/`Update`/`Delete`) etkilenen
  `CalculationResult` satırları aynı işlem içinde `Stale` yapılacak; eski
  snapshot geçmiş olarak korunacak. İnceleme ve revizyon onayı öncesinde
  tazelik yeniden doğrulanacak.

Not: `CalculationResultStatus.Stale` şu anda enum'da var ama koda hiç
atanmıyor — T0-5 bu boşluğu dolduruyor.
