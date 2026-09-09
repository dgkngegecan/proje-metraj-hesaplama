# Faz 0 — Referans Veri İsteği (F0-G01)

> 🔵 **CLAUDE-OPUS5** — kullanıcıdan beklenen girdinin tanımı — 2026-08-30 — Faz 0

`docs/arsiv/faz0-test-ve-altin-veri-plani-openai-sol56.md` §2 ve §9'daki plana göre asıl ihtiyaç şu:

## Kesin gerekli — bunlar olmadan Faz 0 kapanmaz

1. **Gerçek bir Temiz Su tesisatı metrajının Excel dosyası, olduğu gibi.**
   - Elinizde hâlâ kullandığınız veya geçmişte tamamlanmış gerçek bir proje metrajı Excel'i olmalı — hayali/örnek veri değil.
   - **Değiştirilmeden**, üzerinde hiçbir temizlik/düzenleme yapılmadan gönderilsin — satır sırası, boş hücreler, tutarsız birimler, elle yazılmış notlar dahil, olduğu gibi. Bu dosyanın hash'i alınıp `provenance.md`'de saklanacak (§2), yani "temiz" bir kopya değil kaynağın kendisi lazım.
   - Birden fazla sekme/dosya varsa (örn. ayrı "Malzeme Listesi" + "Hakediş Cetveli" sekmeleri) hepsi.

2. **Kısa bir bağlam notu (birkaç cümle yeter, resmi olmasına gerek yok):**
   - Bu hangi projeydi (isim gizlenebilir, "AVM projesi" gibi genel bir tarif yeterli), kaç blok/kat/mahal içeriyordu?
   - Excel'deki sütunlar ne anlama geliyor — özellikle kısaltmalar, sizin ekibinizin kendi jargonu (örn. "St.Boy" standart boy mu, "Fr%" fire yüzdesi mi gibi başkasının tahmin edemeyeceği şeyler).
   - Bu projede kapsam neydi — siz temin mi ettiniz, sadece montaj mı, karışık mı?
   - Fire/standart boy/paket hesaplarını şu an nasıl yapıyorsunuz — elle mi, Excel formülüyla mi, kafadan mı?

## Faydalı ama zorunlu değil

3. Bu projenin **son teslim edilen rapor/hakediş cetveli** çıktısı (PDF veya Excel) — varsa, gerçek rapor formatını (hangi sütunlar, nasıl gruplanmış) bire bir hedefleyebiliriz.
4. Poz numarası kullanıyorsanız, hangi poz listesine göre (Bayındırlık, sözleşmeye özel, kendi numaralandırmanız) — bir örnek satır yeterli.

## Neden bu kadar spesifik isteniyor

OpenAI ekibinin planı (§9), her Excel satırını domain kayıtlarına eşleyip iki ekibin **bağımsız olarak** aynı toplamları hesaplamasını gerektiriyor. Sentetik/uydurma veriyle bu doğrulama anlamsızlaşır — amaç, gerçek bir projenin gerçek tuhaflıklarıyla (yuvarlama alışkanlıklarınız, boş bırakılan hücreler, tutarsız birimler) modeli sınamak, sonra o modele göre kod yazmak.

## Nasıl iletebilirsiniz

- Dosyayı doğrudan bana gönderebilirsiniz (bu konuşmaya ekleyin), ben repoya `docs/arsiv/faz0/referans-temiz-su/` altına yerleştiririm.
- Ya da repoya (`D:\github_repo\proje-metraj-hesaplama\docs\faz0\referans-temiz-su\`) elle kopyalayıp bana haber verin.

## Bir gizlilik notu

Bu repo GitHub'a bağlı (`dgkngegecan/proje-metraj-hesaplama`). Excel'de işveren adı, fiyat bilgisi veya başka hassas veri varsa ve bu repoyu GitHub'a push etmeyi düşünüyorsanız, göndermeden önce isim/fiyat gibi alanları maskelemek isteyebilirsiniz — miktar ve birim verisi (asıl ihtiyacımız olan) bundan etkilenmez. İsterseniz repo push edilmeden önce ben de bu konuda hatırlatırım; şimdilik dosyayı elden geçirmedim, sadece isteği netleştiriyorum.
