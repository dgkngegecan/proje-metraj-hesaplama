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
| T0 — Emek kaybı / yanlış sayı (10 madde) | 🔄 Sürüyor | — |
| T1 — Şaşırtıcı/engelleyici (21 madde) | ⬜ Bekliyor | — |
| T2 — Gizli doğruluk boşlukları (18 madde) | ⬜ Bekliyor | — |
| T3 — Hissedilen yavaşlık (6 madde) | ⬜ Bekliyor | — |
| T4 — Teslim riski (4 madde) | 🔄 Kısmen (T4-2, T4-4 tamam) | `5e55407` |
| T5 — Yapı ve temizlik (9 alt bölüm) | ⬜ Bekliyor | — |

**Test tabanı:** Değişiklik öncesi `dotnet test Metraj.sln` → **68 başarılı, 0 başarısız**.
Her bölüm sonunda bu sayının artması (yeni regresyon testleri) ve hiç
başarısız olmaması beklenir.

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

## Sürmekte olan bölüm

### T0 — Kullanıcı emeğini kaybeder veya yanlış sayıya güvenir
**Durum:** 🔄 Başlandı

| # | Madde | Durum |
|---|---|---|
| T0-1 | Harf çakışması bütün özetleri çökertiyor | 🔄 Sürüyor |
| T0-2 | Açılış yedeği manuel yedekleri siliyor | ⬜ |
| T0-3 | Geri yükleme yabancı SQLite dosyasını kabul ediyor | ⬜ |
| T0-4 | Onaylı revizyon genel ayarla değişiyor | ⬜ |
| T0-5 | Hesap önerileri bayatlamıyor | ⬜ |
| T0-6 | Çoğaltma onaylı revizyonu değiştiriyor | ⬜ |
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
