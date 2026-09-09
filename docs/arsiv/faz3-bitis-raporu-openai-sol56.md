# Faz 3 Bitiş Raporu — Katalog ve Proje Yapılandırması

Tarih: 2026-08-30  
Durum: TAMAMLANDI — yapılandırma kabul kapısı geçti

## Tamamlanan kapsam

- Katalog kartı oluşturma, arama, pasife alma ve immutable yeni sürüm üretimi tamamlandı.
- Kart adı kart sürümüne taşındı. Böylece yeni kart sürümünün adı değiştirilse bile mevcut proje yerleşimi eski sürümün adını korur.
- Uygulama şema yükseltmesi mevcut veritabanlarındaki kart sürümü adını tanımdan güvenli şekilde geri doldurur.
- Katalogdan proje ağacına kök/alt yerleşim ekleme, aynı yerleşimi çoğaltma, yeniden açılışta kalıcı ağaç görünümü ve kararlı ad sıralaması tamamlandı.
- Proje yerleşiminde görünen ad değişikliği, tedarik kapsamı ve not; ayrıca seçili üst dala veya köke güvenli taşıma eklendi.
- Sorumluluklar sabit kolon değildir: proje revizyonu için boyut, taraf ve yerleşim-seviyesi atama oluşturulabiliyor.
- Pasif kartlar eski yerleşimlerde görünmeye devam ediyor; yeni yerleşime eklenmeleri uygulama servisinde reddediliyor.

## UI kullanım doğrulaması

- Self-contained `win-x64` yayın, eski kullanıcı veritabanını yükselterek gerçek Windows oturumunda açıldı.
- Proje seçimi, kalıcı ağaç yükleme, kök kart yerleştirme, dal çoğaltma ve alt yerleşim akışları denendi.
- Katalog üzerinden test kartı oluşturuldu, v2 üretildi, pasife alındı ve pasif kartla yeni yerleşim girişiminin doğru biçimde reddedildiği görüldü.
- Sorumluluk sekmesinde test boyutu, tarafı ve yerleşim ataması kaydedilip tabloda gösterildi.

## Kullanım testinde bulunup düzeltilen sorunlar

- Yazılabilirliği doğrulanmadan seçilen kullanıcı veri klasörü, bazı Windows izinlerinde salt-okunur SQLite hatası üretiyordu. Uygulama artık yazma denemesi ve veritabanı açma kontrolü yaparak güvenli fallback yolunu seçiyor.
- Proje ağacı altındaki eylem düğmeleri varsayılan pencere boyunda kesiliyordu. Çalışma alanı kaydırılabilir hale getirildi.
- Ağaç satırı seçimi farklı erişilebilirlik/tema yollarında komut durumuna güvenilir geçmiyordu. Aynı veriyle bağlı açık `İşlem yapılacak dal` seçicisi eklendi.
- Alt yerleşim kayıt edildikten sonra ekran yenilemesinin seçimi sıfırlaması, başarılı işlemi yanlış hata gibi gösteriyordu. Üst düğüm adı yenilemeden önce saklanarak düzeltildi.

## Kabul kanıtı

- Release build: başarılı, 0 uyarı / 0 hata.
- Test: **19/19 başarılı**.
- Publish: self-contained Windows x64 başarılı.
- Yeni entegrasyon testleri: kart sürümü sabitleme, aynı karttan bağımsız yerleşim, yerleşim override/taşıma/döngü engeli, pasif kart engeli, sorumluluk ataması ve upsert davranışı.

## Bilinçli kapsam sınırı

- Canvas, CAD/PDF/DWG/DXF okuma ve serbest hesap kodu eklenmedi.
- Faz 4'te odak, Temiz Su sentetik referansını Excel-benzeri metraj girişine geçirmek, ölçümleri hesaplamak ve sonuçları referans toplamlarla karşılaştırmaktır.
