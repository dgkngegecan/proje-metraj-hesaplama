# Faz 6 Bitiş Raporu — Nihai Raporlama, Revizyon ve Audit

Tarih: 2026-08-31  
Durum: `COMPLETE — SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`

## Teslim edilenler

- Revizyon yaşam döngüsü tamamlandı: R0 taslağı onaylanabiliyor; onaylı revizyon değiştirilemiyor; yalnızca onaylı revizyondan bağımsız R1 taslağı oluşturulabiliyor.
- R1 kopyası; yerleşim ağacını, bağlantıları, kaynak ölçümleri, sorumluluk yapılandırmasını ve hesap kuralı sürümlerini yeni kimliklerle klonluyor. Hesap sonuçları kopyalanmıyor; yeni revizyonda yeniden hesaplanmaları gerekiyor.
- Hesap sonucu, kart/rule/motor/birim politikası sürümleriyle birlikte rapor kontrol listesine eklendi. Rapor dışa aktarma işlemleri revizyon, dosya adı ve kullanılan hesap sonucu kimlikleriyle audit kaydı oluşturuyor.
- Ortak rapor modeli PDF ve Excel tarafından aynı revizyon anlık görüntüsünden kullanılıyor.
- Excel çalışma sayfaları: `Özet`, `Sistem-Kategori`, `Kat-Mahal`, `Kaynak Satırları`, `Satın Alma`, `Sorumluluk`, `Hesap Kontrol`.
- PDF bölümleri: özet, sistem/kategori, kat/mahal, satın alma, sorumluluk, hesap kontrolü ve kaynak satırları.
- Kart sürümüne isteğe bağlı poz numarası eklendi; katalog ekranından giriliyor, listede görünüyor ve sistem/kategori ile kat/mahal raporlarına taşınıyor.
- Raporlar net, fireli ve satın alma miktarlarını ayrı gösteriyor. Doğrudan ölçülen kalemler ile yalnızca onaylanmış türetilmiş kalemler satın alma listesinde çifte sayım olmadan birleştiriliyor.
- PDF şablonu; renkli başlık, metin etiketi, kod, kenarlık ve bölümlendirmeyi birlikte kullanır. Böylece siyah-beyaz baskıda da tablo ve bölüm ayrımı korunur.

## Kabul ve doğrulama

- Tam regresyon: `31/31` test başarılı.
- Self-contained `win-x64` publish başarılı.
- Gerçek Windows arayüzünde poz numaralı `POS-UI-01` kartı oluşturuldu ve katalog listesinde `15.90` ile geri okundu.
- Gerçek Windows arayüzünden sentetik Temiz Su R0 için 36 kaynak satırlı Excel ve 13 özet kalemli PDF üretildi.
- 9 sayfalık PDF render edilerek başlıklar, tablo sınırları, çok sayfalı kat/mahal dökümü, sorumluluk kalıtımı, hesap kontrolü ve kaynak satırlarında taşma/kırpılma/üst üste binme denetlendi.
- Satın alma PDF tablosunda ilk sütunun 4.5 cm genişlikte kaybolduğu görsel hata bulundu; 4.1 cm’e çekilerek düzeltildi, yeniden publish edilip UI’dan tekrar PDF üretilerek doğrulandı.
- Excel, ClosedXML ile yeniden açıldı; 7 çalışma sayfası, sayısal miktarlar, metin biçimindeki `=metin` girdisi ve boş hücreler doğrulandı. Formül hatası taramasında eşleşme yoktur.

## Bilinen sınır

Bu kabul yalnızca açıkça `SYNTHETIC` işaretli Temiz Su referans paketiyle yapılmıştır. Gerçek proje Excel’iyle saha doğrulaması yapılmamıştır ve bu durum teslimde de korunacaktır.
