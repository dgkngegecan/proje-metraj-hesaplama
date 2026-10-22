# Arayüz Metin Kılavuzu

Uygulamada kullanıcının görebileceği her metin (başlık, düğme, ipucu, bildirim, hata, onay penceresi, ekran okuyucu etiketi, Android'in kendi ekranları ve sunucudan gelen mesajlar) bu kılavuza göre yazılır.

## Kullanıcı kim, ne istiyor?

Sahada ya da ofiste metraj çıkaran mühendis veya teknik eleman. Uygulamanın nasıl çalıştığıyla ilgilenmez; miktarı girip raporu alıp işini bitirmek ister. Her metin bu soruya göre yazılır: **"Bunu okuyan kişi şimdi ne yapacak?"**

## Ses

- **"Siz" dili, kısa ve net.** Açıklamalar "Kartı seçin.", düğmeler emir kipinde tek fiil: **Kaydet, Sil, Geri al, Paylaş**.
- Övgü, özür ve dolgu yok: "Harika!", "Maalesef", "Lütfen dikkat edin ki…" kullanılmaz. "Lütfen" yalnız gerçekten rica edilen nadir durumda.
- Ünlem, emoji ve büyük harfle vurgu yok.
- Uygulama kendini anlatmaz: "Önceden … oluyordu", "Bu sayede …", "güvenli bir çarpan" gibi geliştirici açıklamaları arayüze girmez. Bunlar yalnız kod yorumunda kalır.

## Hata mesajı biçimi

**Ne oldu + ne yapılmalı.** En fazla iki kısa cümle. Kullanıcı suçlanmaz, teknik ayrıntı gösterilmez (ayrıntı günlüğe yazılır).

| Kötü | İyi |
|---|---|
| Bir şey ters gitti. | İşlem tamamlanamadı. Tekrar deneyin. |
| Uygulamanın yerel servisine ulaşılamadı. | Uygulama yanıt vermiyor. Kapatıp yeniden açın. |
| Veritabanı hazırlanırken bir hata oluştu: SqliteException… | Veriler açılamadı. Son yedeği geri yükleyebilir ya da verilerinizi dışa aktarabilirsiniz. |
| Bu bağlantı döngü oluşturur. | Bir kart kendi alt kartının altına taşınamaz. |

## Onay pencereleri

Başlık eylemi soru olarak tekrarlar, düğme aynı fiili kullanır: **"Kart silinsin mi?" → [Vazgeç] [Sil]**. "Emin misiniz?" ve "Tamam" kullanılmaz. Geri alınamayan işlem açıkça "Bu işlem geri alınamaz." der.

## Bildirimler (alt çubuk)

Sonucu bildirir, geçmiş zaman, nokta ile biter: "Kaydedildi.", "“Dirsek” silindi." Gerekirse tek eylem: **Geri al**.

## Boş durumlar

Başlık durumu söyler, alt metin tek bir sonraki adımı: "Henüz giriş yok" / "Miktar girmek için **Miktar gir**'e dokunun."

## Terim sözlüğü

Aynı kavram her yerde aynı adla geçer.

| Kullan | Kullanma | Not |
|---|---|---|
| revizyon (R0, R1…) | sürüm, proje sürümü, düzenleme kopyası | "Yeni revizyon aç" |
| taslak / onaylı | kilitlenmiş, arşiv (yalnız durum etiketi) | Onaylı revizyon değiştirilemez |
| kart | yerleşim, düğüm, kayıt | Projedeki her kalem |
| üst kart / alt kart | ebeveyn, çocuk, kök | En üst: "en üst seviye" |
| giriş | ölçüm, metraj satırı, kayıt | "5 giriş", "Giriş geçmişi" |
| kütüphane | katalog, global kütüphane | |
| kart sürümü (v1, v2) | | Yalnız kütüphane kartlarının değişiklik geçmişi için |
| çeşit | varyant | Boru çapları, fitting çeşitleri |
| ek bilgiler | nitelikler, öznitelik | |
| filtre | süzgeç | |
| veriler | veritabanı, çalışma alanı | "Verileri dışa aktar", "Veri dosyası (.metraj)" |
| hesap kaynağı | calculated-from, hesap bağı | "Miktarı başka bir karttan hesapla" |
| elle düzelt | ezme, override | |
| sorumluluk türü | boyut | Montaj, malzeme temini… |
| pasife al / pasif | devre dışı | Yeni projelerde seçilemez |
| örnek proje | sentetik, referans paketi | "Gerçek veri değildir" notuyla |

## Sayı ve birim

Türkçe ondalık virgül (12,5 m), binlik ayırıcı nokta. Birim sayıdan bir boşlukla ayrılır (12,5 m, 600 mm); yüzde işareti başta (%5).
