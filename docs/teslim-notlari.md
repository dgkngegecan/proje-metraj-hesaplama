# Teslim notları

## Radyatör sayımı paketi — 2026-09-16

- Tip → yükseklik → hazır uzunluk sayaçları; Enter yalnız seçili tip/yüksekliği kaydeder. Özel tip ve ölçüler diğer projelerde tekrar seçilebilir.
- Radyatör raporu tip, yükseklik ve uzunluğa göre ayrılır; Excel/PDF/Word çıktılarında ara ve genel toplamlar bulunur. Adet ve dilim ayrı tutulur.
- Release derlemesi: 0 uyarı, 0 hata. .NET testleri: 153/153; Node arayüz mantık testleri: 31/31. Node testleri GitHub Actions akışına eklendi.
- Yeni tek EXE, ayrı test veritabanıyla doğrudan açıldı. Gömülü WebView2 ekranında hazır seçenekler, aktif grubu Enter ile kayıt, başarısız kayıtta tekrar deneme, rapor kapsamı ve projeler arası özel ölçü aktarımı doğrulandı. Gömülü JavaScript ile yerel üretim çıktısının SHA256 değerleri eşleşti.
- Teslim: `artifacts/ProjeMetraj-react-single-win-x64/Metraj.Desktop.exe`, 192598301 bayt. SHA256: `8C969DFBE35574F8FBF79BB91C58FDF20AB5703C2C3A3F8B1778C36099FC226A`.
- Önceki EXE yedeği: `tmp/UiReview/release-backup/Metraj.Desktop-before-radiator-20260916.exe`.
- EXE Git deposuna eklenmez. `main` push'u mevcut Actions akışıyla indirilebilir EXE artifact'ini üretir; GitHub Release yayını yalnız `v*` etiketiyle çalışır. Bu turda uzak yayın/etiket oluşturulmadı.

## Nihai paket

- Hedef: Windows 11 x64
- Çalıştırılabilir dosya: `artifacts/ProjeMetraj-react-single-win-x64/Metraj.Desktop.exe`
- Yayın tipi: self-contained, tek dosya, .NET runtime kurulumu gerektirmez. React/React Flow arayüzü `.exe` içine gömülüdür; paket klasörüne HTML/JS/CSS dosyası bırakılmaz. Windows 11'in standart WebView2 Runtime'ı kullanılır.
- Uygulama verileri: `%LOCALAPPDATA%\ProjeMetraj`
- Katalog: projelerden bağımsız tek global SQLite kataloğu. İlk açılışta 63 kartlık Türkçe saha adı + global karşılık başlangıç paketi idempotent olarak eklenir; kullanıcı kartları ve pasif kartlar değiştirilmez.

## Lisanslar

Uygulama Excel çıktısı için ClosedXML, PDF çıktısı için PDFsharp + MigraDoc kullanır. Bu paketler MIT lisanslıdır. EPPlus ve QuestPDF bu teslimde kullanılmamıştır; gelir/kullanım takibi gerektiren ticari lisans bağımlılığı eklenmemiştir.

## Son kabul özeti

- 61 otomatik test başarılı.
- Windows UI’da React Flow kart akışı, hızlı metraj, kartlık, rapor, ileri hesap/sorumluluk/yedek kontrolleri doğrulandı.
- Tek dosyalı nihai paket doğrudan başlatıldı, kapatıldı ve paket klasörünün yalnız `.exe` içerdiği doğrulandı.
- Doğrulama verisi sentetik Temiz Su referansıdır; gerçek Excel bulunmadığı için sonuç durumu `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` olarak korunur.

## Güncel kullanım düzeltme turu — 2026-09-03

- Her ölçüm satırı `CreatedAtUtc` ile kronolojik listelenir; haritadaki saat simgeli **Giriş geçmişi** kutusu, Enter ile eklenen her miktarı ayrı satır ve zaman bilgisiyle gösterir.
- Boru çap kutuları yerleşim kimliğine göre tarayıcı yerel durumunda korunur; karttan çıkıp dönüldüğünde seçilen çap kutuları ve sıraları geri gelir.
- Fitting ve adet girişlerinde artı/eksi yanında doğrudan sayısal adet alanı bulunur; radyatör satırları tür + yükseklik + genişlik anahtarlarıyla gruplanır ve kart özetinde boyutları görünür.
- Proje haritası sağındaki not alanı kart türünden bağımsız, seçili proje yerleşimine özeldir; kazan, pompa, eşanjör gibi ekipman notları katalog kartını değiştirmez.
- Satın alma özetlerinde kalan/fazla metre kaldırıldı; standart boy hesabı içte korunurken kullanıcıya yalnız satın alınacak boy/adet gösterilir. Excel özetinde `Satın alma (boy/adet)` başlığı kullanılır.
- React derlemesi, .NET derlemesi ve regresyon paketi yeniden üretildi; yayın klasörü yalnız `Metraj.Desktop.exe` içerir.

## Panel ve boru ölçüm balonu cilası — 2026-09-03

- Sol menü, büyütülmüş kart özeti, giriş geçmişi ve kat/mahal ayrıntıları için iki yönlü, azaltılmış hareket ayarına saygılı açılış-kapanış geçişleri eklendi.
- Büyütülmüş boru kartındaki çap satırları 900 ms beklemeli bilgi balonu açar; hızlı fare geçişleri balonu tetiklemez ve imleç satırdan ayrılınca balon hemen kapanır.
- Balonda yalnızca üzerine gelinen çapa ait ölçüler, giriş sırası ve zamanlarıyla tek tek listelenir; toplam ayrıca gösterilir.
- Balon React Flow yüzeyinin taşma sınırlarından etkilenmemesi ve ekran kenarında kalması için geçici bir üst katmanda konumlandırılır; kalıcı panel veya yeni pencere oluşturmaz.
- TypeScript üretim derlemesi ve 61 testlik .NET regresyon paketi başarılıdır; tek dosyalı Windows yayını yeniden üretilmiştir.

## Kart geneli giriş özeti — 2026-09-03

- Çift tıklanan her ölçülebilir kart, girilen değerleri kartın içinde ürün/ölçü kırılımıyla gösterir; boru çapları, fitting çap ve çeşitleri ile diğer ölçüm türleri aynı davranışı kullanır.
- Her özet satırı 900 ms beklemeli **Giriş geçmişi** balonu açar; balonda tek tek miktarlar, giriş zamanları ve varsa ölçüm notları kronolojik olarak listelenir.
- Proje yerleşimine özel not, büyütülen kartta ayrıca gösterilir. Girişi veya notu olmayan kartta boş durum açıklaması yer alır.
- Kart kapatıldığında açık bilgi balonu da kapanır; özet listeleri büyük veri kümelerinde kartı kontrolsüz büyütmeden kaydırılabilir kalır.

## Yapısal animasyon ve akıllı harita kaydırma — 2026-09-03

- Sistem hareket tercihi açık olsa bile kart, panel ve sol menü geçişlerinin tek kareye düşmesine neden olan genel kural kaldırıldı; sürekli dekoratif hareketler yine kapatılabilir kaldı.
- Kart açılışı güçlü ease-out, kapanışı daha kısa ease-in eğrisiyle çalışır. İç özetler, sağ denetim paneli ve seçim çerçevesi kısa katmanlı geçişlerle görünür.
- Seçilen kartın herhangi bir köşesi proje haritası sınırında kırpılıyorsa görünüm zoom değiştirmeden yalnız gerekli piksel kadar kaydırılır. Büyüme sırasında ve sonunda sınır yeniden kontrol edilir.
- Seri kart seçimlerinde önceki karta ait bekleyen kaydırmalar iptal edilir; görünüm daima son seçilen kartı izler.

## Fitting giriş taslakları — 2026-09-03

- Gönderilmemiş fitting adetleri kart yerleşimi ve çap bazında yerel taslak olarak saklanır; çap, kart veya ana ekran değişimi değerleri sıfırlamaz.
- Aynı kutuda farklı çaplara girilen adetler birbirinden bağımsız korunur. Çap düğmesindeki rozet o çapta bekleyen toplam adedi gösterir.
- **Hepsini ekle** düğmesi veya adet alanındaki Enter bütün bekleyen çap/çeşitleri birlikte gönderir; aynı çap ve çeşit birden fazla kutuda bulunursa tek satırda toplanır.
- Taslak yalnız kayıt işlemi başarıyla tamamlanınca temizlenir; API hatasında kullanıcının girdiği adetler korunur.

## Standart kart düzenleme ve genel test turu — 2026-09-03

- Sistem başlangıç paketiyle gelen veya kullanıcı tarafından eklenen standart kartlar, özel kart türüne bağlı olmadan fire payı, malzeme ailesi ve not gibi yerleşik alanlarda güncellenebilir. Arayüz standart kartlarda gereksiz özel nitelik yükü göndermediği için `attribute values require a custom card type` hatası kaldırılmıştır.
- Backend eski istemcilerden gelebilecek bilinen yerleşik nitelikleri kabul eder; bilinmeyen alanları reddetmeye ve özel kart türlerinin alan izin listesini uygulamaya devam eder.
- Geçici SQLite üzerinde proje, kart, kart sürümü, yerleşim, çoklu ölçüm, fire ve satın alma hesabı, JSON/Excel/PDF/Word raporu, ölçüm silme ve revizyon kilidi HTTP üzerinden uçtan uca sınanmıştır.
- Birleşik işlevsel/regresyon paketi 66/66 başarılıdır. Sentetik iç kabul başarılıdır; gerçek mekanik tesisat dosyasıyla dış kullanıcı kabulü henüz yapılmamıştır.
- Yük turunda 10.000 satır normal veri, dört eşzamanlı okuyucu, 12 eşzamanlı hızlı yazım, 200 tekrar sorgusu ve 50.012 satır stres/hacim senaryosu doğrulanmıştır. Çok kullanıcılı ağ yükü ve saatler süren saha dayanıklılık testi ürünün tek kullanıcılı yerel kapsamı dışında tutulmuştur.
