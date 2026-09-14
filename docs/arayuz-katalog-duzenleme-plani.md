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

## Tamamlanan doğrulama — 13 Eylül 2026

- Dört alt ajan kullanıldı. Görsel/etkileşim ve veri/işlev incelemelerindeki bulgular ana çalışma içinde giderildi.
- Release test paketi: 148/148 başarılı. Son ürün metni ve ölçü ayrıştırma değişikliklerinden sonra katalog regresyonları tekrar çalıştırıldı: 8/8 başarılı. Harita yerleşimi ve fitting seçimi: 20/20 Node testi başarılı.
- TypeScript ve Vite üretim derlemesi, Windows x64 self-contained single-file yayını başarılı.
- Tarayıcıda deste açma/kapama, tam genişlik, aynı satırdaki kart alt kenarları, iki bağımsız kat/mahal notunun korunması ve tekil silinmesi denetlendi. PN10 Ø25 boruya bağlı fitting seçenekleri filtrelendi; 3 adet kayıt ekran değiştirince korundu ve bekleyen sayaçlar temizlendi. Konsol hata/uyarı kaydı ve yatay taşma yok.
- Gerçek masaüstü EXE açıldı. Mevcut proje ve ölçümler yüklendi; kartı çift tıklayarak büyütme komşu sütunu kaydırdı, sınırlar korundu. Kütüphane pencere genişliğini kullandı ve kapalı destelerle açıldı.
- Verilen hedef güncellendi: `artifacts/ProjeMetraj-react-single-win-x64/Metraj.Desktop.exe` (192487709 bayt).
- SHA256: `2F80A7D7261806E3B801EBFB7764574025FEBC0411C3D779B0C016EEB664D7E7`. Kopyalanan dosyanın özeti doğrulanmış yayınla eşleşti.
- Önceki EXE: `tmp/UiReview/release-backup/Metraj.Desktop-20260913-214620.exe`.
- Ürün açıklaması ilkeleri, araştırma kaynakları ve kısa kullanım: [katalog-olcu-kaynaklari.md](katalog-olcu-kaynaklari.md).

### Arka plan ışıklarının hareketi

Test ortamında `prefers-reduced-motion: reduce` etkin. `layout.css` içindeki genel kapatma kuralı, iki ortam ışığının önceden istenen istisnasını geçersiz kılmıştı. Önceki görsel kontrolde bu hareket ayrıca ölçülmediği için hata atlandı. İki pseudo-element için özgül kurallarla istisna geri getirildi; diğer azaltılmış hareket davranışı korundu.

Aynı ortamda önce iki ışık için `animation-name: none`, `duration: 0s`, `transform: none` ölçüldü. Düzeltmeden sonra `ambientBlueBounce / 54s` ve `ambientRoseBounce / 63s` çalışıyor; iki ayrı okumada her iki dönüşüm matrisi değişti, diğer animasyon `none` kaldı. TypeScript/Vite ve single-file yayın başarılı. Son EXE SHA256: `A98C1D1CFA8D87C22074C79499E9B63C85CB5F27CAE82A170BB461263587C454`.

### Kartlık ve yüzen proje haritası — 14 Eylül 2026

- `+ Kart ekle` görünümü harita alanının tamamını kullanan kartlık çalışma alanına dönüştürüldü; proje haritası aynı alanın üzerinde yarı saydam ve etkileşimli kalıyor.
- Harita sol üst tutamaçtan sürükleniyor, bırakıldığında kısa bir ataletle süzülüyor ve çalışma alanının kenarlarında duruyor. Dört kenar ve dört köşeden yeniden boyutlandırılabiliyor.
- Kaydırma çubuğunun üst/alt ok düğmeleri kaldırıldı; kaydırma izi ve sürüklenebilir tutamak korundu.
- Gerçek Windows EXE üzerinde sürükleme, kenara sınırlama, köşeden büyütme ve harita içi yakınlaştırma doğrulandı. Kartlık 746 kartı 69 deste halinde gösterdi. Web üretim derlemesi ve 20/20 yerleşim/seçim testi başarılı.
- Ana yayın güncellendi: `artifacts/ProjeMetraj-react-single-win-x64/Metraj.Desktop.exe` (192491805 bayt), SHA256 `A9AECE57FD97483CC0A4723DCAA946694CEE5FEDE56509CC4694CFCCA868C02D`.
- Önceki yayın yedeği: `tmp/UiReview/release-backup/Metraj.Desktop-before-floating-map-20260914-070735.exe`.
