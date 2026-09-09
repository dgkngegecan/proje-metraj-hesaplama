# Faz 2 Bitiş Raporu

Tarih: 2026-08-30  
Durum: TAMAMLANDI — UI smoke doğrulaması ve kabul testleri başarılı

## Tamamlanan kapsam

- Beş kart tipi ve bağımsız davranış eksenleri kalıcı modele alındı.
- Katalog kart tanımı ile immutable kart sürümü ayrıştırıldı.
- Proje, revizyon, tek ebeveynli yerleşim ağacı ve semantic link modeli uygulandı.
- `component-of`, `calculated-from` ve `reference` link türleri desteklendi; `uses` eklenmedi.
- Genişletilebilir sorumluluk boyutu/atama tabloları eklendi.
- Blok, kat, mahal, zon, pafta ve çizim revizyonu ölçüm bağlamı olarak saklanıyor.
- Decimal miktarlar SQLite'ta 1.000.000 ölçekli INTEGER olarak saklanıyor.
- Net, fireli, satın alma ve artık miktarları ayrı alanlar olarak tutuluyor.
- Sınırlı ve deterministik hesap motoru eklendi.
- İdempotent uygulama şema yükseltmesi eklendi.
- Proje/katalog/yerleşim workspace servisleri ve WPF başlangıç ekranı tamamlandı.

## UI doğrulaması

- Self-contained `win-x64` uygulaması gerçek Windows oturumunda başlatıldı.
- Proje sekmesinden kod/ad girilerek R0 proje oluşturuldu.
- Katalog sekmesine geçildi, malzeme kartı oluşturuldu ve DataGrid'de görüntülendi.
- Açılışta tespit edilen erişim problemi düzeltildi: LocalApplicationData yazılamıyorsa ApplicationData ve Temp fallback zinciri kullanılıyor.

## Kabul testleri

- Build: başarılı, 0 warning / 0 error
- Test: 17/17 başarılı
- Publish: self-contained Windows x64 başarılı
- Şema migrator: iki kez çalıştırmada marker ve kolonlar tekrarlanmıyor
- Kalıcı round-trip: kart, proje, revizyon, yerleşim ve ölçüm değerleri kayıpsız okunuyor

## Sonraki faz

Faz 3 başlatıldı. Öncelik: katalog düzenleme/sürümleme, proje ağacında kart yerleştirme ve ağaç UI'sinin gerçek çalışma ekranına dönüştürülmesi.
