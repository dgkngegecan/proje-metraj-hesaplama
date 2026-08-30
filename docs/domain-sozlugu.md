# Domain Sözlüğü — proje-metraj-hesaplama

> 🔵 **CLAUDE EKİBİ** — Opus (birincil, mimari/domain) — 2026-08-30 — Faz 0

Faz 0 çıktısı. Claude ekibi (Opus) tarafından hazırlandı. Terimler ROADMAP.md'deki kilitlenmiş kararlarla birebir tutarlıdır; burada amaç her terime tek, tartışmasız bir tanım vermek.

## Katalog katmanı

**Kart Tanımı (Card Definition)**
Kütüphanedeki tekrar kullanılabilir şablon. Bir projeye ait değildir. Taşıdığı alanlar: ad, kod, kart tipi (Kategori/Kapsam/Sistem/Malzeme/Ek Parça), birim, renk/desen, poz numarası. Tek başına hiçbir metraj satırı üretmez — bir yerleşime dönüşmeden anlamsızdır.

**Kart Sürümü (Card Version)**
Bir kart tanımının belirli bir andaki değişmez anlık görüntüsü. Kart tanımı düzenlendiğinde yeni bir sürüm oluşur, eskisi silinmez. Bir proje yerleşimi her zaman *belirli bir sürüme* bağlanır — bu sayede katalog güncellenince geçmiş projeler sessizce değişmez.

**Pasif (Inactive) Kart**
Yeni yerleşime eklenemeyen ama eski yerleşimlerde görünmeye devam eden kart durumu. Silme değildir — geri dönüşü olan bir kapatma.

## Proje katmanı

**Proje Yerleşimi (Placement)**
Bir kart sürümünün, proje ağacındaki tek bir konumu. Tek ebeveynlidir (`contains` ilişkisiyle bağlanır), döngü kuramaz. Aynı kart tanımından/sürümünden birden fazla bağımsız yerleşim oluşturulabilir — biri değişince diğeri etkilenmez. Üç bağımsız eksen taşır: Kalem türü (Malzeme/Cihaz/İşçilik/Hizmet), Hesap modu, Rapor davranışı (Klasör/Ölçülebilir/Yardımcı/Referans).

**Ölçüm (Measurement)**
Bir yerleşime bağlı, gerçek fiziksel miktarın kaydı. Kart/yerleşimden ayrıdır çünkü aynı malzeme birden fazla bağlamda (farklı mahal, farklı kat) ayrı ayrı ölçülür. Taşıdığı bağlam: blok, kat, mahal, zon, şaft, hat no, pafta, revizyon. Bir yerleşimin sıfır, bir veya çok sayıda ölçümü olabilir.

> ⚠️ **Açık domain sorusu (çözülmedi):** Bir Ölçüm kaydı, o kalemin **nihai/toplam miktarını** mı temsil ediyor, yoksa **belirli bir döneme ait kısmi ilerlemeyi** mi (hakediş: "bu ay %60 yapıldı")? Şu anki model bunu ayırt etmiyor. Bu netleşmeden Faz 2'de `measurements` şeması kilitlenmemeli — GPT Sol ile birlikte karara bağlanmalı.

## İlişki katmanı

**contains**
Hiyerarşiyi kurar. Proje ağacındaki tek geçerli ebeveyn-çocuk bağlantısı. Tek yönlü, döngüsüz, tek ebeveyn.

**component-of**
Bir yerleşimin başka bir yerleşimin bağlantı/yardımcı elemanı olduğunu belirtir (örn. Te, DN50 Boru'nun component-of'u). Hiyerarşiyi değiştirmez, sadece teknik ilişkiyi kaydeder.

**calculated-from**
Bir yerleşimin miktarının başka bir yerleşim/kuraldan türetildiğini belirtir. Bu bağlantıyla üretilen her sonuç `Kontrol bekliyor` durumunda doğar — kesin değildir, kullanıcı onaylamalı veya gerekçeyle ezmeli.

**reference**
Miktarı çoğaltmayan, salt bilgi amaçlı bağlantı. Bir kaynak *yerleşimin tamamını* (tek bir ölçümünü değil) ikincil bir rapor başlığında gösterir — o yerleşime ait tüm ölçümler ikinci başlıkta da görünür ama toplamda bir kez sayılır (`Measurement:{id}`/`CalculationResult:{id}` anahtarıyla tekilleştirilir). Doküman/pafta bağlama bu ilişki tipiyle karıştırılmamalı — o ayrı bir mekanizma, `attachments` tablosu. *(Düzeltme: 2026-08-30, `docs/faz0-inceleme-cevabi-claude-opus5.md` §3 — önceki sürümde bu ikisi yanlışlıkla birleştirilmişti.)*

**Kapsam dışı (bilinçli olarak yok):** `uses`, `alternative`.

## Hesap katmanı

**Net Miktar**
Kullanıcının girdiği, fireden ve yuvarlamadan önceki ham teknik ölçü. Örn: "52,4 m".

**Fireli Miktar**
Net miktara fire oranı uygulanmış hâli. Örn: %5 fire ile "55,02 m".

**Satın Alma Miktarı**
Fireli miktarın satış birimine (standart boy/paket) yukarı yuvarlanmış hâli — gerçekte sipariş edilecek miktar. Örn: 6 m'lik boydan "10 adet".

**Artan Miktar**
Satın alma miktarı ile fireli miktar arasındaki fark — kullanılmayacak artık. Örn: "4,98 m".

**Kontrol bekliyor (Pending Review)**
`calculated-from` ile otomatik önerilen bir miktarın doğduğu durum. Kabul edilene veya gerekçeli biçimde ezilene kadar kesin sayılmaz. **Kapsam içi.** (Kapsam dışı olan, bunu CAD/geometriden tam otomatik keşfetmektir — bu ikisi karıştırılmamalı.)

**Sürüm İzi**
Bir hesap sonucunun kart sürümü + kural sürümü + motor sürümü + birim politikası sürümüyle birlikte saklanması. Katalog sonradan düzeltilse bile geçmiş sonuç değişmez; yeniden hesaplama eskiyi ezmez, yenisini oluşturur.

## Sorumluluk katmanı

**Sorumluluk Boyutu (Responsibility Dimension)**
Sabit kolon değil, genişletilebilir bir liste öğesi (temin, montaj, izolasyon, test, devreye alma, nakliye, projelendirme, + kullanıcı tanımlı). Proje veya proje şablonu seviyesinde tanımlanır.

**Sorumluluk Ataması (Responsibility Assignment)**
Bir yerleşim × bir boyut × bir tarafın (Biz/Taşeron/İşveren/Tedarikçi/Hariç/Opsiyonel) eşleşmesi. Aynı yerleşimde birden fazla boyut, farklı taraflara atanabilir (örn. temin İşveren, montaj Biz).

## Proje meta katmanı

**Revizyon**
Projenin zaman içindeki durumu. Bir hesap sonucu ve ürettiği rapor, hangi revizyona ait olduğunu bilir. Onaylı bir revizyon kilitlenirse, sonraki katalog/kural değişiklikleri o revizyonun raporunu geriye dönük değiştirmez.

**Audit Kaydı**
Önemli kullanıcı işlemlerinin (kim, ne zaman, ne değişti) izi. Çok kullanıcılı bir sistem değil — amacı işbirliği değil, geriye dönük açıklanabilirlik (özellikle hakediş/keşif tartışmalarında).
