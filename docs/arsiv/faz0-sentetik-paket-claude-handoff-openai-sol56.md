# Faz 0 — Sentetik Temiz Su Paketi Claude Handoff

> 🟢 **OPENAI-SOL56** → 🔵 **CLAUDE-OPUS5 / CLAUDE-SONNET5** — 2026-08-30 — Faz 0

**Durum:** `HANDOFF COMPLETE / CLAUDE VALIDATION PASSED`

## 1. Kullanıcı kararı ve öncelik

Kullanıcı gerçek Temiz Su Excel'inin mevcut olmadığını ve şu anda temin edilemeyeceğini bildirmiş; sentetik referans paketle ilerlemeyi açıkça onaylamıştır.

- `ROADMAP.md` karar 17 bu değişikliği kanonik hâle getirir.
- `docs/arsiv/faz0-sentetik-referans-karari-openai-sol56.md` kararın kapsamını ve artık risklerini kaydeder.
- `docs/arsiv/faz0-referans-veri-istegi.md` tarihsel Claude talebi olarak korunur; gerçek Excel artık Faz 0 kapanış kapısı değildir.
- Paket hiçbir koşulda gerçek proje veya altın veri olarak adlandırılamaz.

## 2. İncelenecek paket

Kök:

`tests/Metraj.Tests/TestData/Phase0/CleanWater/`

İçerik:

- `manifest.json` — kaynak niteliği, varsayım sürümü, durum ve SHA-256 hash'leri.
- `provenance.md` — sentetik kaynağın sınırları ve artık riskler.
- `fixtures/catalog-card-versions.json` — 19 kart sürümü ve beş kart tipi.
- `fixtures/project-placements.json` — 26 yerleşim, tek ebeveynli ağaç, procurement scope ve türetme hedefleri.
- `fixtures/measurements.csv` — 36 atomik ölçüm satırı.
- `fixtures/calculation-rule-versions.json` — dört güvenli kelepçe türetme kuralı.
- `fixtures/responsibility-assignments.json` — dört boyut, üç taraf, kalıtım/override ve Hariç/Opsiyonel vakaları.
- `expected/line-results.json` — satır net ve bilgi amaçlı fire projeksiyonları.
- `expected/calculation-groups.json` — 13 otoritatif net/fireli grup sonucu.
- `expected/purchase-groups.json` — 14 satın alma grubu; manuel ve kabul edilmiş türetilmiş katkılar.
- `expected/aggregates.json` — birim, kart ve temin sorumlusu toplamları.
- `expected/report-membership.json` — `reference` alias ve çifte sayım testleri.
- `expected/state-transitions.json` — `calculated-from` durumları, input hash, idempotency ve revizyon onay engeli.
- `expected/validation-cases.json` — sınır, hata, kültür, scale/overflow, grouping ve unit vakaları.

## 3. OpenAI doğrulama sonucu

- Paket dosyaları: 11 JSON parse edildi, 1 CSV okundu; 12/12 dosya doğrulandı.
- Ölçüm satırları: 36; kararlı ve tekil ID: 36.
- Hesap grupları: 13.
- Satın alma grupları: 14.
- Kart sürümleri: 19.
- Proje yerleşimleri: 26.
- Türetilmiş sonuç kaydı: 7.
- CSV'den hesap gruplarına bağımsız yeniden hesaplamada uyuşmazlık: 0.
- Hesap/türetme sonuçlarından satın alma gruplarına yeniden hesaplamada uyuşmazlık: 0.
- Paket özetleriyle grup toplamı uyuşmazlığı: 0.
- Manifest dosya/hash eşlemesi OpenAI tarafında pinlendi.

Ana sentetik toplamlar:

| Birim | Net | Fireli | Satın alınan fiziksel | Artan |
|---|---:|---:|---:|---:|
| m | 275,600000 | 290,270000 | 298,000000 | 7,730000 |
| adet | 98,000000 kesin | — | 135,000000 | 37,000000 |

`adet` kesin net; 65 manuel + 33 Approved/Overridden türetilmiş katkıdır. `25` PendingReview, `13` Rejected ve tarihsel `14` Superseded kesin toplamdan dışlanır.

## 4. Claude Opus'tan istenen bağımsız doğrulama

Expected dosyalarındaki sayıları kaynak olarak kabul etmeyin. Şu sırayla bağımsız hesaplayın:

1. Önce manifestte listelenen dosyaların SHA-256 hash'lerini doğrulayın.
2. `measurements.csv` satırlarından 13 hesap grubunun net ve fireli miktarını yeniden hesaplayın.
3. `ProjectRevisionId`, kart sürümü, fiziksel birim, satış dönüşümü, kap parametresi, temin tarafı ve açık `ProcurementScope` uyumunu kontrol edin.
4. 14 satın alma grubunun `ceiling`, satın alınan fiziksel ve artan sonuçlarını yeniden hesaplayın.
5. Pending/Rejected/Stale/Superseded sonuçların kesin toplamdan dışlandığını doğrulayın.
6. Approved ve gerekçeli Overridden türetmelerin doğru miktarla satın almaya girdiğini doğrulayın.
7. `reference` eklendiğinde `Measurement:{id}` anahtarları nedeniyle genel toplamın değişmediğini doğrulayın.
8. Sorumluluk çözümlemesini `measurement override > nearest placement > project default > unassigned` sırasıyla kontrol edin.
9. Farklı proje revizyonlarının aynı hesap/satın alma/reference grubunda birleşemediğini kontrol edin.
10. `PendingReview/Stale` varken proje revizyonu onayının engellendiğini kontrol edin.
11. Sentetik malzeme ve miktar dağılımını domain gerçekçiliği açısından eleştirin; minicik şüpheyi dahi yazın.

Claude sonucu ayrı bir dosyaya yazmalıdır:

`docs/arsiv/faz0-sentetik-paket-inceleme-claude-opus5.md`

OpenAI dosyaları ve fixture'lar doğrudan değiştirilmemelidir. Hata varsa kimlik, beklenen/hesaplanan değer ve önerilen düzeltme raporda verilmelidir; OpenAI yeni paket sürümü üretir.

## 5. Claude Sonnet'ten istenen kullanılabilirlik kontrolü

- 36 satırın mevcut DataGrid taslağıyla kayıpsız gösterilip gösterilemediğini kontrol edin.
- Satır `Fireli Projeksiyon` değerinin bilgi amaçlı, grup fireli/satın alma değerlerinin otoritatif alt toplam olduğunu görsel olarak ayırt edecek ekran önerisini inceleyin.
- Blok/kat/mahal/pafta/zon/revizyon alanlarının klavye ve yapıştırma akışına uygunluğunu kontrol edin.
- `Yeni ölçüm ekle` ile `Mevcut ölçümü düzelt` eylemlerinin karışmamasını sağlayın.
- Renk olmadan da Pending/Overridden/Excluded durumlarının ayırt edilebilirliğini değerlendirin.

Sonnet bulguları Opus raporuna eklenebilir veya ayrı `CLAUDE-SONNET5` etiketli dosyaya yazılabilir.

## 6. Faz 0 kapanış koşulu

OpenAI üretim/doğrulama kolu ve Claude bağımsız incelemesi tamamlanmıştır. Claude Opus 5 sıfır aritmetik uyuşmazlık, 12/12 hash, 13/13 hesap grubu ve 14/14 satın alma grubu eşleşmesi raporlamıştır. Kullanıcı yönetici onayıyla manifest `PHASE0_COMPLETE` durumuna geçirilmiştir; resmî etiket `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` olarak korunur.
