# Faz 0 — Sentetik Temiz Su Paketi, Bağımsız İnceleme

> 🔵 **CLAUDE-OPUS5** — bağımsız ikinci hesap ve domain incelemesi — 2026-08-30 — Faz 0

**Sonuç: Bağımsız doğrulama geçti. Aritmetik uyuşmazlık bulunamadı — sıfır.** Paket, `expected/`'deki 12 dosyanın hiçbirini kaynak olarak kullanmadan, doğrudan `measurements.csv` ve `fixtures/`'tan elle yeniden hesaplanarak kontrol edildi. Beş küçük domain-gerçekçiliği gözlemi var (§11), hiçbiri veriyi geçersiz kılmıyor.

---

## 1. Hash doğrulaması

`sha256sum` ile 12 dosyanın tamamı hesaplandı, manifest.json'daki değerlerle karakter karakter eşleşti. **0 uyuşmazlık.**

## 2. 13 hesap grubunun bağımsız yeniden hesabı

`measurements.csv`'deki 36 satırı gruplarına göre elle topladım:

| Grup | Üye ölçümler (toplam) | Net (benim) | Net (expected) | Fire% | Fireli (benim) | Fireli (expected) |
|---|---|---:|---:|---:|---:|---:|
| CG-PPR25-A | 12.4+18.6+9.0+5.25 | 45.25 | 45.250000 | 5.0 | 47.5125 | 47.512500 |
| CG-PPR25-B | 14.4+8.2+11.75+6.0 | 40.35 | 40.350000 | 5.0 | 42.3675 | 42.367500 |
| CG-PPR25-C | 7.8+3.2+9.0 | 20.0 | 20.000000 | 5.0 | 21.0 | 21.000000 |
| CG-PPR32-A | 21.5+16.25+7.0 | 44.75 | 44.750000 | 5.0 | 46.9875 | 46.987500 |
| CG-PPR32-B | 12.0+18.5+4.25 | 34.75 | 34.750000 | 5.0 | 36.4875 | 36.487500 |
| CG-PPR50-A | 30.0+18.4+11.6 | 60.0 | 60.000000 | 7.5 | 64.5 | 64.500000 |
| CG-PPR20-A | 6.5+8.75+5.25+10.0 | 30.5 | 30.500000 | 3.0 | 31.415 | 31.415000 |
| CG-ELB25-A | 8+6+10 | 24 | 24.000000 | 0 | 24 | 24.000000 |
| CG-TEE25-A | 3+4+5 | 12 | 12.000000 | 0 | 12 | 12.000000 |
| CG-VAL25-A | 4+6 | 10 | 10.000000 | 0 | 10 | 10.000000 |
| CG-ELB32-A | 4+7 | 11 | 11.000000 | 0 | 11 | 11.000000 |
| CG-VAL50-A | 5 | 5 | 5.000000 | 0 | 5 | 5.000000 |
| CG-TEE32-A | 3 | 3 | 3.000000 | 0 | 3 | 3.000000 |

**13/13 eşleşti.**

## 3. Uyum kontrolü (revizyon, kart sürümü, birim, dönüşüm, kap, temin, ProcurementScope)

Her satın alma grubunun üyeleri tek `ProjectRevisionId` (`PRJ-CW-SYN-REV-001`), tek `CardVersionId`, tek fiziksel birim, tek satış dönüşümü ve tek kap parametresi taşıyor — `fixtures/project-placements.json` ve `measurements.csv` çapraz kontrol edildi, sapma yok. `NoPool=true` olan yerleşimler (`PL-PPR25-C`, tüm ek parça/kelepçe yerleşimleri) hiçbir zaman başka bir yerleşimle aynı grupta değil — `validation-cases.json`'daki `VAL-PURCHASE-NOPOOL-001` de bunu açıkça test ediyor.

## 4. 14 satın alma grubunun bağımsız yeniden hesabı

| Grup | Net/Fireli girdi | Kap | `ceiling` (benim) | Beklenen | Satın alınan (benim) | Beklenen | Artan (benim) | Beklenen |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PG-PPR25-BIZ | 89.88 | 4 | 23 | 23 | 92 | 92.0 | 2.12 | 2.12 |
| PG-PPR25-EMP | 21 | 4 | 6 | 6 | 24 | 24.0 | 3 | 3.0 |
| PG-PPR32-BIZ | 83.475 | 4 | 21 | 21 | 84 | 84.0 | 0.525 | 0.525 |
| PG-PPR50-EMP | 64.5 | 6 | 11 | 11 | 66 | 66.0 | 1.5 | 1.5 |
| PG-PPR20-BIZ | 31.415 | 4 | 8 | 8 | 32 | 32.0 | 0.585 | 0.585 |
| PG-ELB25-BIZ | 24 | 10 | 3 | 3 | 30 | 30.0 | 6 | 6.0 |
| PG-TEE25-BIZ | 12 | 5 | 3 | 3 | 15 | 15.0 | 3 | 3.0 |
| PG-VAL25-BIZ | 10 | 1 | 10 | 10 | 10 | 10.0 | 0 | 0.0 |
| PG-ELB32-BIZ | 11 | 10 | 2 | 2 | 20 | 20.0 | 9 | 9.0 |
| PG-VAL50-EMP | 5 | 1 | 5 | 5 | 5 | 5.0 | 0 | 0.0 |
| PG-TEE32-BIZ | 3 | 5 | 1 | 1 | 5 | 5.0 | 2 | 2.0 |
| PG-CLAMP25-BIZ | 14 (kullanılan) | 20 | 1 | 1 | 20 | 20.0 | 6 | 6.0 |
| PG-CLAMP32-BIZ | 11 (kullanılan) | 20 | 1 | 1 | 20 | 20.0 | 9 | 9.0 |
| PG-CLAMP50-EMP | 8 (kullanılan) | 10 | 1 | 1 | 10 | 10.0 | 2 | 2.0 |

**14/14 eşleşti.** `VAL-GROUP-SPLIT-001` ile aynı prensip (grup önce toplanır, sonra `ceiling`) burada da tutarlı uygulanmış.

## 5. Pending/Rejected/Stale/Superseded dışlama kontrolü

`state-transitions.json`'daki 7 türetilmiş sonuçtan 4'ü (`CR-CLAMP20-A-001` Rejected, `CR-CLAMP25-A-000` Superseded, `CR-CLAMP25-A-001` PendingReview, `CR-CLAMP32-B-001` PendingReview) `purchase-groups.json`'ın `excludedResults` listesinde birebir var ve hiçbir satın alma grubunun `memberIds`'inde geçmiyor. **Doğrulandı.**

## 6. Approved/Overridden türetmelerin doğru miktarla girmesi

- `CR-CLAMP32-A-001`: önerilen 12, kullanılan **11** (gerekçeli override) → `PG-CLAMP32-BIZ` expectedNet **11**. ✓ Öneri değil, kullanılan değer girmiş.
- `CR-CLAMP50-A-001`: önerilen 10, kullanılan **8** → `PG-CLAMP50-EMP` expectedNet **8**. ✓
- `CR-CLAMP25-B-001`: önerilen=kullanılan=14 (düz kabul) → `PG-CLAMP25-BIZ` expectedNet **14**. ✓

**Üçü de doğru.** Bu, önceki turda işaretlediğim "öneri mi kullanılan mı satın almaya giriyor" belirsizliğini (Rev1 eleştirisi, madde 6) somut olarak kapatıyor.

## 7. `reference` çifte sayım kontrolü

`report-membership.json`: `PL-PPR25-A`'nın 4 ölçümü `PL-REF-ANA-DAGITIM` altında da görünüyor (`aliasVisibleNet: 45.25`), ama global net toplam alias öncesi/sonrası aynı (**275.6 → 275.6**, değişmiyor). Bağımsız kontrol: `Measurement:{id}` anahtarları alias'ta tekrar sayılmıyor, doğru. **Doğrulandı.**

## 8. Sorumluluk çözümleme sırası

`measurement override > nearest placement > project default > unassigned` sırası üç ayrı seviyede somut örnekle test edilmiş:
- **Measurement override:** `CW-SYN-019` (Pompa), `DIM-INSTALL` için proje varsayılanı (Biz) yerine `PARTY-SUB` kullanıyor — gerekçeli.
- **Nearest placement:** `PL-PPR50-A`, `DIM-INSULATION`'da proje varsayılanı (Optional/atanmamış) yerine kendi atamasını (`PARTY-SUB`) kullanıyor.
- **Hariç:** `PL-VAL50-A`, `DIM-TEST`'te `Excluded`, `partyId: null` — taraf değil, durum olarak modellenmiş (önceki turda kapattığımız çelişki #4 ile tutarlı).

**Üç seviye de doğru örneklenmiş.**

## 9. Farklı revizyonların birleşmemesi

Bu paket tek revizyon içerdiği için doğrudan aritmetikle sınanamıyor, ama `validation-cases.json`'daki `VAL-PURCHASE-CROSS-REV-001` bunu açık bir beklenen-hata vakası olarak tanımlıyor (`PURCHASE_GROUP_CROSS_REVISION`). Bu, önceki incelememde (§1.2) sorduğum "satın alma grubu revizyonu kapsıyor mu" sorusuna doğrudan cevap — **evet, kapsıyor, ve şimdi test sözleşmesinde açıkça var.**

## 10. Onay, bekleyen sonuç varken engellenmesi

`state-transitions.json`'daki `REV-APPROVE-001` vakası: `blockingResultIds: [CR-CLAMP25-A-001, CR-CLAMP32-B-001]` (ikisi de PendingReview), beklenen hata `REVISION_HAS_UNRESOLVED_RESULTS`. Bu da önceki incelememde (§1.3) açık bıraktığım soruya doğrudan cevap. **Kapandı.**

## 11. Domain gerçekçiliği eleştirisi — minicik şüpheler dahil

Veri seti dahilen tamamen tutarlı (yukarıdaki hiçbir kontrolde hata yok). Ama gerçekçilik açısından beş küçük gözlem:

1. **Kalem türü kapsamı eksik.** Teknik sözleşme "Kalem türü: malzeme, cihaz, işçilik, hizmet" diyor ama fixture'da yalnızca `Material`, `Equipment`, `Other` var — **hiçbir İşçilik veya Hizmet örneği yok**. Bu iki tür end-to-end hiç test edilmemiş.
2. **Boolean/Tik Kutusu girdi davranışı hiç örneklenmemiş.** "Girdi davranışı: manuel miktar, evet/hayır veya türetilmiş miktar" deniyor ama 19 kart sürümünün hiçbirinde `inputBehavior: Boolean` (veya eşdeğeri) yok — sadece `Manual` ve `Derived` var.
3. **Fire oranlarının çapa göre artması (%3→%5→%7,5) teknik bir standarda dayanmıyor**, `provenance.md` zaten bunu "doğrulanmamış varsayım" diye işaretlemiş — ek bir itirazım yok, sadece bunun gerçek veriyle mutlaka sınanması gerektiğini tekrar vurguluyorum.
4. **`CR-CLAMP25-A-000`'ın kaynak ölçümü `HISTORICAL-SYNTHETIC-SOURCE` placeholder'ı** — gerçek bir ölçüm kimliğine bağlı değil. Bu, geçmiş/Stale/Superseded senaryosunu test etmek için makul bir kısayol, ama bir okuyucunun "bu tarihsel kayıt nereden geldi" diye sorabileceği tek nokta.
5. **`Rejected` bir sonucun (`CR-CLAMP20-A-001`) yeniden değerlendirilip değerlendirilemeyeceği test edilmemiş** — reddedilen bir öneri kalıcı mı, yoksa kaynak değişince yeni bir `PendingReview` doğurabiliyor mu, sözleşmede net değil. Küçük bir boşluk, kritik değil.

Bunların hiçbiri veriyi geçersiz kılmıyor — sentetik paketin amacı zaten "gerçek veri değil, sözleşmeyi test edilebilir kılmak" (`provenance.md`). Ama 1 ve 2, ROADMAP'te vaat edilen kalem türü/girdi davranışı çeşitliliğinin **hiç test edilmediği** anlamına geliyor; gerçek veri gelmeden önce bile, ikinci bir sentetik ek (İşçilik + Tik Kutusu örneği) paketi güçlendirir.

## Sonuç

Manifest durumu Claude tarafında **onaylanabilir** — bağımsız hesap sıfır uyuşmazlıkla geçti, dört önceki açık sorum (§1.2, §1.3 satın alma revizyon kapsamı ve onay engeli) bu pakette açıkça test edilerek kapatılmış. Manifest'in kendisini değiştirmiyorum (OpenAI'nin dosyası); durumun `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` olarak güncellenmesini onaylıyorum, ve §11'deki iki maddenin (İşçilik/Hizmet, Tik Kutusu örneği) bir sonraki pakette eklenmesini öneriyorum — bloke edici değil, iyileştirme.
