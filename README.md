# Proje Metraj

Windows 11 x64 için hazırlanmış, tek kullanıcılı ve çevrimdışı çalışan mekanik tesisat metraj uygulaması. Yerel .NET/SQLite çekirdeği; modern kart akışı için React + React Flow görsel çalışma alanıyla birleştirilmiştir.

Uygulama; katalog kartlarını proje yerleşimlerinden ayırır, tek ebeveynli proje ağacında metraj girmenizi sağlar, sınırlı/izlenebilir hesap kuralları uygular ve PDF, Excel ile Word raporları üretir.

## Teslim paketi

Çalıştırılacak dosya:

`artifacts/ProjeMetraj-react-single-win-x64/Metraj.Desktop.exe`

Klasörde yalnızca bu tek, self-contained `.exe` bulunur; .NET kurulumu gerektirmez. Hedef işletim sistemi Windows 11 x64’tür. Windows 11’de standart olarak bulunan Microsoft Edge WebView2 Runtime gereklidir; arayüz bunun üzerinde yerel olarak açılır, internet veya bulut bağlantısı kullanmaz.

## Hızlı başlangıç

1. `Metraj.Desktop.exe` dosyasını çalıştırın.
2. Uygulama ilk açılışta Türkiye’de yaygın saha adlarını ve global karşılıklarını içeren standart mekanik tesisat kartlarını **global kütüphaneye** ekler. Daha önce eklenmiş kartlar ve kullanıcı kartları korunur; paket tekrar çalıştırılsa da çoğaltma yapılmaz.
3. **Yeni proje** ile işe başlayın; **Kütüphane** sekmesindeki kartlar projelerden bağımsızdır ve bütün projelerde tekrar kullanılabilir. İhtiyaç halinde Kategori, Kapsam, Sistem, Malzeme veya Ek Parça kartı ekleyin.
4. **Proje haritası** ekranında kartı sahneye sürükleyin veya `+ Kart ekle` ile ekleyin. Kart uçlarından sürükleyerek tek ebeveynli ilişkisini kurun.
5. **Metraj** ekranında malzemeyi seçip yalnız miktarı yazın; gerekirse açılan alana blok, kat, mahal ve paftayı ekleyin.
6. Gerekirse `⚙ İleri kontroller` alanında sürüm, `calculated-from` tabanlı hesap önerisi, sorumluluk ve yedekleme işlerini yürütün.
7. **Metraj çıktısı** ekranından PDF, Excel veya Word çıktısını alın.

Sentetik Temiz Su örneği yalnız kabul/regresyon verisidir; gerçek metraj değildir.

## Veri güvenliği

Yerel veriler uygulama dosyasından bağımsız olarak şu konumda tutulur:

`%LOCALAPPDATA%\ProjeMetraj\metraj.db`

Yedekler aynı klasördeki `backups` dizinine kaydedilir. Ayrıntılı işlem adımları için [kullanım ve yedekleme kılavuzuna](docs/kullanim-ve-yedekleme-kilavuzu.md) bakın.

## Global katalog

Katalog kartları `Projects` tablosunun içinde tutulmaz; aynı SQLite dosyasındaki global `CatalogCardDefinitions` ve sürüm tablolarında tutulur. Bu nedenle yeni proje açmak kütüphaneyi sıfırlamaz. Bir kartın projede kullanılması yalnızca o kart sürümüne bir **yerleşim** referansı ekler; aynı kart başka projelerde tekrar seçilebilir. Projeye özel görünen ad, not, tedarik kapsamı ve ağaç ilişkisi ise yerleşimde kalır.

İlk açılışta eklenen standart paket; mekanik tesisat, sıhhi tesisat/plumbing, HVAC, yangın koruma, PP-R/PPRC, karbon çelik, bakır, PVC-U, fitting/vanalar, izolasyon ve yaygın ekipman terimlerini Türkçe saha adı + global karşılık biçiminde içerir. Kütüphane sekmesindeki **Eksik standartları tamamla** düğmesi yalnızca eksik kodları ekler; mevcut veya pasife alınmış kullanıcı kartlarını değiştirmez.

## Kapsam

- Dahil: katalog, proje ağacı, metraj, sorumluluklar, izlenebilir hesaplar, PDF/Excel raporlama, onaylı revizyonlar ve yerel yedekleme.
- Hariç: AutoCAD/DWG/DXF/PDF’den veri okuma, bulut/çoklu kullanıcı, serbest kod, eklenti sistemi ve CAD geometrisinden otomatik fitting keşfi.

## Doğrulama durumu

Uygulama sentetik Temiz Su referans paketiyle doğrulanmıştır: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`. Gerçek proje Excel’i bu teslimde bulunmamaktadır.
