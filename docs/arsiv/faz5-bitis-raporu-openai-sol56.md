# Faz 5 Bitiş Raporu — OpenAI 5.6 Sol

Durum: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`  
Tarih: 2026-08-30

## Tamamlananlar

- Güvenli, kod çalıştırmayan hesap kuralları: `Direct` ve sürümlü `FixedMultiplier`.
- `calculated-from` bağımlılığı, döngü engeli, `Kontrol bekliyor` önerisi, onay, gerekçeli manuel override ve ret akışı.
- Sonuçta kart sürümü/içerik özeti, kural sürümü, motor sürümü, birim politikası, kaynak ölçümler, girdi özeti ve hash sabitleniyor. Yeniden hesaplama eski sonucu ezmiyor; onu `Superseded` yapıp yeni snapshot oluşturuyor.
- Katalog ekranına bağımsız kart davranışları eklendi: `Manual` / `Boolean` / `Derived`, satış dönüşümü, rapor davranışı, fire ve boy/paket parametresi. `Derived` kartlara manuel ölçüm girişi engellendi; boolean kalemler 0/1 ile sınırlandı.
- Sorumluluklarda en yakın açık atama kuralı uygulandı. Üst dal ataması alt dallara kalıtılır; alt daldaki atama override olur. `Excluded` / `Optional` / `Unassigned` durumlarında taraf alanı temizlenerek çelişkili sahiplik engellendi.

## Doğrulama

- Otomatik test: **30/30 başarılı**.
- Hesap sınırları: sıfır, negatif, 6 ondalık üstü giriş, küsurat/fire/yuvarlama ve maksimum miktar kapsandı.
- Gerçek Windows UI kabulü:
  - Türkçe ondalık ayrıştırmada `0.1` ile v2 kuralı doğru olarak 3,05 adet ve 1 paket önerdi; eski v1 sonuç `Superseded` kaldı.
  - Katalog sürüm formunda mevcut kartın `StandardLength`, `%3` fire ve `4` standart boy parametreleri forma doğru yüklendi.
  - Kök yerleşimdeki sorumluluk ataması alt kalemlerde `Kalıtılmış` ve kaynak bilgisiyle gösterildi.
  - Bir alt boru kalemindeki `Excluded` override, tarafı boşaltıp kalıtımı kapattı.
- Self-contained yayın: `win-x64` publish başarılı.

## Açık sınır

Doğrulama yalnızca açıkça `SYNTHETIC` işaretli Temiz Su referans verisiyle yapıldı. Gerçek proje Excel metrajı henüz bulunmadığından gerçek saha verisiyle kabul yapılmadı.
