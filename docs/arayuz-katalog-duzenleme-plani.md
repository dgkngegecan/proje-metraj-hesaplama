# Arayüz ve katalog düzenleme

## İş bölümü

1. Katalog: tüm başlangıç kartlarını aile/varyant yapısı ve üst boru uyumu açısından düzenleme; mevcut veriyi koruyan geçiş.
2. Desteler: kütüphane ve kart ekle alanında isim önizlemesi, aynı yerde açılıp kapanan kategoriler.
3. Kat/mahal notları: karta bağlı, bağımsız eklenip silinen kalıcı kayıtlar ve revizyon davranışı.
4. Ana çalışma: gerçek kart ölçülerine göre harita yerleşimi, taşma/sınırlar, not arayüzü ve açılış animasyonu; entegrasyon.
5. Doğrulama: görsel/etkileşim incelemesi ve ayrı veri/işlev regresyon incelemesi.

Toplam en fazla 5 alt ajan. Veri ve arayüz işleri ayrı dosyalarda yürütülür.

## Kabul kontrolleri

- Eski kart/ölçüm referansları ve kullanıcı değişiklikleri korunur; başlangıç yüklemesi tekrarlanabilir.
- Aile içindeki seçenekler malzeme ve çap uyumunu korur.
- Desteler başlangıçta kapalıdır; hover yalnız isimleri gösterir, açılan kartlar destenin hemen ardından aynı alandadır.
- Büyüyen harita kartları komşularına taşmaz; yan/alt kenarlar görünür; kütüphane kullanılabilir genişliği doldurur.
- Birden fazla kat/mahal notu navigasyon ve yeniden açılışta kalır, bağımsız silinir; onaylı revizyon değiştirilemez.
- Açılış animasyonu yükleme durumuna bağlıdır, azaltılmış hareket ayarına uyar.
- Web derlemesi, ilgili testler, iki doğrulama incelemesi ve tek EXE yayını tamamlanır.
