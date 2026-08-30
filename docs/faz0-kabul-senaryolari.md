# Faz 0 — Kabul Senaryoları

> 🔵 **CLAUDE EKİBİ** — Opus (birincil, domain) — 2026-08-30 — Faz 0

Bu belge `ROADMAP.md`'deki kabul *kriterlerini* (pass/fail test listesi) tamamlar — burada amaç domain modelini gerçek sayılarla adım adım yürütüp modelin gerçekten tutarlı olduğunu (veya olmadığını) somut örneklerle göstermek. Her senaryo `domain-sozlugu.md`'deki terimlerle yazılmıştır.

---

## Senaryo 1 — Temel akış: tanımdan rapora

1. Katalogda `PPRC Boru DN50` kart tanımı oluşturulur (birim: m, hesap modu: Doğrudan). Kart Sürümü v1 doğar.
2. Bu kart, projede `Temiz Su` sisteminin altına bir Proje Yerleşimi olarak eklenir (`contains`).
3. Üç ayrı Ölçüm kaydı girilir, aynı yerleşime bağlı:
   - Blok A / Kat 1 / Mahal 101 → 32 m
   - Blok A / Kat 2 / Mahal 201 → 52,4 m
   - Blok B / Bodrum / Mahal — → 18 m
4. Rapor, bu üç ölçümü hem ayrı ayrı hem toplamda (102,4 m) gösterebilmeli.

**Kabul:** Tek yerleşim, çok ölçüm — malzeme bir kere tanımlanır, mahal bazında çoğalır. §1'deki "Ölçüm, kart/yerleşimden ayrıdır" tanımı burada doğrulanıyor.

---

## Senaryo 2 — Standart boy + fire

1. `PPRC Boru DN50` kartı, hesap modu Standart Boy + Fire olarak güncellenir (yeni Kart Sürümü v2 doğar — bkz Senaryo 3, eski yerleşimler v1'de kalmaya devam eder).
2. Yeni bir yerleşim, standart boy 6 m, fire oranı %5 ile kurulur.
3. Net miktar: 52,4 m girilir.
4. Hesap sırası (ROADMAP Faz 5): Girdi (52,4 m) → Fire (%5) → Fireli Miktar (55,02 m) → Satış birimine dönüşüm (÷6) → Yuvarlama (9,17 → 10) → Satın Alma Miktarı (10 adet) → Artan Miktar (60 − 55,02 = 4,98 m).

**Kabul:** Net, fireli ve satın alma miktarları üç ayrı, birbirinden okunabilir alan olarak raporda görünür — hiçbiri diğerinin yerini almaz.

---

## Senaryo 3 — Katalog güncellemesi geçmişi bozmaz

1. Senaryo 1'deki yerleşim Kart Sürümü v1'e bağlıdır.
2. Kart tanımı düzenlenir (örn. birim yanlış girilmiş, düzeltiliyor) → Kart Sürümü v2 doğar.
3. Senaryo 1'in yerleşimi **hâlâ v1'e bağlı** — hesap sonucu değişmez.
4. Kullanıcı isterse bu yerleşimi elle "güncel sürüme geç" ile v2'ye taşıyabilir; bu taşıma yeni bir hesap sonucu üretir, eskisini silmez.

**Kabul:** "Kart sürümü + kural sürümü + motor sürümü ile hesap sonucu sabitlenir" kuralı (ROADMAP Faz 5) burada uçtan uca doğrulanıyor. Kritik red-team sorusu: kullanıcı arayüzü, bir yerleşimin "eski sürümde kaldığını" görünür şekilde göstermeli — aksi halde kullanıcı fark etmeden yanlış bilgiyle çalışabilir. **Bu, Faz 3 ekran tasarımına (`faz0-ekran-akisi-taslak.md`, Katalog Yönetimi ekranı) somut bir gereksinim olarak eklenmeli.**

---

## Senaryo 4 — `calculated-from` + Kontrol Bekliyor + manuel düzeltme

1. `DN50 Çelik Boru` yerleşimine 100 m ölçüm girilir.
2. Kullanıcı veya proje şablonu, `Askı` adlı bir Ek Parça yerleşimi oluşturur; bu yerleşim `calculated-from` ile boru yerleşimine bağlanır, kural: "her 6 metrede 1 askı".
3. Sistem önerir: 17 adet askı, durum = **Kontrol bekliyor**.
4. Kullanıcı sahada gerçek sayıyı görür (örn. 15 adet — bazı noktalarda çift askı gerekmemiş) ve gerekçeyle ("kolon aralığı standarttan farklı") manuel düzeltir.
5. Hesap sonucu artık: kaynak = manuel, önerilen değer = 17 (saklanır), kullanılan değer = 15, gerekçe = kayıtlı.

**Kabul:** Otomatik öneri hiçbir zaman sessizce "kesin" sayılmaz; öneri ve manuel düzeltme birlikte, ikisi de görünür saklanır. Bu, CAD/geometri tabanlı otomatik keşfin (kapsam dışı) yerine geçmez — kullanıcı hâlâ karar verici.

---

## Senaryo 5 — Çifte sayım riski ve `reference`

1. `DN50 Çelik Boru`, `Temiz Su` sisteminin altına yerleştirilir, 42 m ölçülür.
2. İşveren raporu ayrıca "Ana Dağıtım Hattı" başlığı altında da bu boruyu görmek istiyor — ama bu **aynı fiziksel boru**, ikinci bir ölçüm değil.
3. Doğru çözüm: "Ana Dağıtım Hattı" yerleşiminden, Senaryo'daki yerleşime `reference` bağlantısı kurulur. İkinci bir Ölçüm kaydı **açılmaz**.
4. Rapor, "Ana Dağıtım Hattı" başlığı altında bu satırı gösterirken toplam miktara ikinci kez eklemez.

**Kabul:** Toplam metraj her zaman ölçüm kayıtlarının tekil toplamıdır; `reference` bağlantıları bu toplama hiç girmez. Faz 6 rapor motorunun bunu test etmesi gerekiyor (ROADMAP Faz 6 kabul testinde zaten var: "Aynı fiziksel ölçüm farklı rapor görünümlerinde çifte sayılmayacak").

---

## Senaryo 6 — Sorumluluk ataması, tek kalemde çok taraf

1. `Klima Santrali` yerleşiminde dört Sorumluluk Boyutu atanır:
   - Malzeme temini → İşveren
   - Montaj → Biz
   - İzolasyon → Taşeron
   - Devreye alma → Biz
2. Rapor "Sorumluluk Özeti" görünümünde bu kalem dört kez, her seferinde farklı boyutla, doğru tarafın altında listelenir.
3. Metraj miktarı (adet: 1) her dört görünümde de aynıdır — sorumluluk ataması miktarı bölmez, sadece kimin ne yaptığını etiketler.

**Kabul:** Sorumluluk Ataması, Ölçüm'den bağımsız bir katman — aynı fiziksel miktar, farklı sorumluluk kesitlerinde tekrar sayılmadan görünebilir.

---

## Senaryo 7 — Açık domain sorusunun somutlaştırılması: dönemsel mi, nihai mi?

Bu senaryo bir **çözüm değil**, `domain-sozlugu.md`'de işaretlenen açık soruyu somut bir çatışmayla göstermek için:

1. Ocak ayında `DN50 Boru` yerleşimine 40 m ölçüm girilir. Rapor: "40 m yapıldı."
2. Şubat ayında aynı hat üzerinde 30 m daha döşenir. Kullanıcı ne yapmalı?
   - **Okuma A (nihai/kümülatif):** Ölçüm kaydını 40'tan 70'e günceller — eski "40 m" değeri kaybolur, sadece "70 m nihai" kalır.
   - **Okuma B (dönemsel):** Şubat için AYRI bir 30 m'lik ikinci Ölçüm kaydı açar — "Ocak: 40 m, Şubat: 30 m" ayrı ayrı görünür kalır, hakediş bu ikisini toplar.
3. Şu anki şema (Faz 2'de henüz kilitlenmedi) her iki okumayı da teknik olarak kabul eder — çünkü `measurements` tablosunda "dönem" veya "bu bir güncelleme mi yoksa ek mi" bilgisi yok. Bu, iki farklı kullanıcının aynı durumda iki farklı şey yapmasına ve raporların tutarsız olmasına yol açar.

**Kabul edilemez durum:** Faz 2 şeması, bu iki okuma arasında sistemin hangisini desteklediğini belirtmeden kilitlenirse, Faz 4'teki Temiz Su dikey dilimi testleri bu belirsizliği farklı biçimde yorumlayabilir ve altın veri setiyle uyuşmayabilir.

**Öneri (GPT Sol'a iletilecek, tek taraflı karar verilmedi):** `measurements` tablosuna bir `kayıt_türü` (nihai / dönemsel-ek) alanı eklenmesi, ROADMAP Faz 2'ye net bir kural olarak girmeli.

---

## Özet — bu senaryolardan çıkan yeni bulgular

| # | Bulgu | Nereye eklenmeli |
|---|---|---|
| 3 | Eski sürüme bağlı yerleşimlerin arayüzde görünür şekilde işaretlenmesi gerekiyor | Faz 3 ekran gereksinimi |
| 7 | Ölçüm kaydının nihai mi dönemsel mi olduğu şemada belirtilmeli (`kayıt_türü` alanı önerisi) | Faz 2 şema kararı, GPT Sol onayı gerekli |

Diğer beş senaryo (1, 2, 4, 5, 6) mevcut modeli **doğruladı** — yeni bir çelişki çıkarmadılar.
