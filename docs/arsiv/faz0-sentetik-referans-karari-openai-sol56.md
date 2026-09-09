# Faz 0 — Sentetik Referansla İlerleme Kararı

> 🟢 **OPENAI-SOL56** — kullanıcı kararı kaydı — 2026-08-30 — Faz 0

**Karar:** Gerçek bir Temiz Su projesine ait Excel metrajı şu anda mevcut değildir ve kısa sürede temin edilememektedir. Kullanıcı, 2026-08-30 tarihinde Faz 0'ın açıkça sentetik olarak etiketlenmiş temsilî referans paketle ilerlemesini onaylamıştır.

## Kararın etkisi

- `F0-G01 = gerçek Excel sağlanması` zorunlu kapanış kapısı kaldırılmıştır.
- Yerine `F0-S01 = bağımsız doğrulanmış sentetik Temiz Su referans paketi` kapısı açılmıştır.
- Sentetik paket hiçbir belgede “gerçek proje”, “mevcut şirket Excel'i” veya gerçek veriyle doğrulanmış altın veri olarak tanıtılamaz.
- Resmî durum etiketi `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` olacaktır.
- Gerçek bir metraj daha sonra bulunursa Phase 8'de ek kabul/regresyon girdisi olarak kullanılır; bulunmaması geliştirmeyi veya teslimi bloke etmez.
- Gerçek veriye bağlı olduğu için bilinmeyen satın alma gruplaması, rapor başlığı ve alan ihtiyaçları açık varsayım olarak sürümlenir; kod içinde gizli varsayım hâline getirilmez.

## Sentetik paketin kabul şartları

1. En az 30 atomik ölçüm satırı içermeli.
2. Beş kart tipini ve birden fazla proje ağacı dalını göstermeli.
3. Metre, adet, standart boy, paket ve fire hesaplarını kapsamalı.
4. Aynı kartın farklı yerleşimlerde kullanımını ve satın alma grubu birleştirme/ayırma davranışını kapsamalı.
5. Blok, kat, mahal, pafta, hat/zon ve kaynak çizim revizyonu bağlamlarını içermeli.
6. Genişletilebilir sorumluluk boyutu, farklı taraf ve `Hariç/Opsiyonel` durumlarını kapsamalı.
7. `reference` çifte sayım önleme vakası içermeli.
8. `calculated-from` için `PendingReview`, `Approved`, `Overridden`, `Rejected`, `Stale` ve `Superseded` geçişlerini kapsamalı.
9. Satır sonucu, hesap grubu ve satın alma grubu beklentilerini ayrı fixture'larda tutmalı.
10. Bütün ondalık sonuçlar OpenAI ve Claude ekipleri tarafından birbirinden bağımsız hesaplanmalı.
11. Değişmez kurallar ve sınır/hata vakaları örnek tablodan bağımsız otomatik test sözleşmesi olarak korunmalı.
12. Varsayımlar, veri kaynağı ve bilinmeyen gerçek-saha riskleri `provenance.md` içinde açıkça yazılmalı.

## Bilinçli olarak kabul edilen artık risk

- Gerçek firma Excel'indeki sütunlar, yazım hataları, boş hücre alışkanlıkları ve yerel jargon bilinmiyor.
- Gerçek satın alma siparişlerinin hangi seviyede gruplanacağı doğrulanmış değil.
- `reference` ilişkisinin yalnız tüm yerleşimi aliaslama sınırı gerçek rapor ihtiyacıyla sınanmış değil.
- Hakediş/dönem takibinin kapsam dışı bırakılması gerçek proje üzerinden doğrulanmış değil.
- Gerçek rapor şablonunun görsel yapısı bilinmiyor.

Bu riskler gizlenmez; tek seferlik uygulamanın sade kapsamı içinde kabul edilir.

## Ekip görevleri

- **OPENAI-LUNA56:** sentetik kaynak tablo, fixture ve beklenen sayısal sonuçların ilk üretimi.
- **OPENAI-TERRA56:** değişmez kurallar, sınır testleri ve sentetik verinin gerçek veri gibi sunulmadığının red-team kontrolü.
- **OPENAI-SOL56:** kanonik sözleşme, dosya entegrasyonu, hesap doğrulaması ve handoff.
- **CLAUDE-SONNET5:** kaynak tablo/rapor okunabilirliği ve ekran akışı uygunluğu için bağımsız kontrol.
- **CLAUDE-OPUS5:** domain gerçekçiliği, ikinci hesap ve Faz 0 kapanış incelemesi.
- **Kullanıcı:** iki ekip çelişirse nihai karar.
