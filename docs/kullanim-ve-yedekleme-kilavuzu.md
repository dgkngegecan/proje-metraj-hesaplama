# Kullanım ve yedekleme kılavuzu

## İlk kurulum ve açılış

`Metraj.Desktop.exe` tek başına çalışır. Uygulama verileri exe’nin yanına değil, kullanıcının yerel uygulama klasörüne yazılır:

`%LOCALAPPDATA%\ProjeMetraj\metraj.db`

İlk açılışta veritabanı otomatik hazırlanır. Sonraki açılışlarda şema denetiminden önce güvenlik snapshot’ı alınır. Aynı veritabanı aynı anda yalnız bir uygulama örneği tarafından yazılabilir.

## Temel çalışma sırası

1. **Katalog**: Kart kodu, adı, poz numarası, kart tipi, birim, giriş davranışı, satış dönüşümü, rapor davranışı ve gerekiyorsa fire/paket/standart boy değerini kaydedin.
2. **Projeler**: Yeni proje oluşturun; katalog kartlarını köke veya seçili dalın altına ekleyin. Her yerleşim proje için bağımsızdır; kart tanımını değiştirmez.
3. **Sorumluluk**: Boyut (ör. Temin, Montaj), taraf ve yerleşim bazındaki atamayı tanımlayın. En yakın üst yerleşimin ataması kalıtılır; alt dalda açık override yapılabilir.
4. **Metraj**: Malzeme yerleşimini seçin, satırları girin ve bağlam alanlarını doldurun. Türetilmiş girişli kalemlere manuel kaynak satırı girilmez.
5. **Hesaplar**: Ek Parça için `calculated-from` bağını ve sürümlü kuralı tanımlayın. Öneri `Kontrol bekliyor` durumunda gelir; kabul, ret veya gerekçeli manuel düzeltme yapılır.
6. **Revizyon/rapor**: Taslağı onaylayın; gerekirse onaylı revizyondan yeni taslak oluşturun. PDF ve Excel raporları net, fireli ve satın alma miktarlarını ayrı gösterir.

## Yedek alma

1. **Projeler** sekmesini açın.
2. **Veri güvenliği ve yedek** bölümünü genişletin.
3. `Tam yedek al` düğmesine basın.
4. Üst durum satırında oluşan yedek dosyası adı görünür.

Yedek tüm projeleri, katalogları, kart sürümlerini, ölçümleri, hesap sonuçlarını ve audit kayıtlarını birlikte içerir. Son 20 otomatik/manuel yedek tutulur.

## Geri yükleme

1. **Veri güvenliği ve yedek** bölümündeki listeden geri dönülecek yedeği seçin.
2. `Seçili yedeği geri yükle` düğmesine basın.
3. Dosya adı ve etkisi yazan uyarıyı dikkatle okuyun; doğru yedekse **Evet** seçin.

Geri yükleme mevcut veritabanını değiştirmeden önce `BeforeRestore` güvenlik yedeği oluşturur. İşlem sonunda çalışma ekranı temizlenir ve güncel veri yeniden yüklenir.

## Güvenlik notları

- `metraj.db` dosyasını uygulama çalışırken elle kopyalamayın veya değiştirmeyin; uygulamadaki tam yedek işlevini kullanın.
- Uygulama açılmıyorsa `proje-metraj-startup-error.log` hata kaydını saklayın; veritabanını silmeden önce yedek klasörünü kopyalayın.
- Uygulama bozuk veritabanını `quick_check` ile güvenli olmayan olarak bildirir; sağlıklı bir uygulama yedeğini geri yükleyin.
- Geri yükleme yalnız uygulamanın kendi `backups` klasöründeki doğrulanmış `.db` dosyalarına izin verir.
