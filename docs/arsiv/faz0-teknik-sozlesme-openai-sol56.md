# Faz 0 — Teknik Ürün Sözleşmesi

> 🟢 **OPENAI-SOL56** — teknik lider; Terra 5.6 teknik incelemesi ve Luna 5.6 test incelemesi birleştirilmiştir — 2026-08-30 — Faz 0

**Durum:** `PHASE0 COMPLETE — USER APPROVED`  
**Dayanak:** `ROADMAP.md`, `docs/domain-sozlugu.md`, `docs/arsiv/faz0-ekran-akisi-taslak.md`, `docs/arsiv/faz0-kabul-senaryolari.md` ve `docs/arsiv/faz0-handoff-claude-ekibi.md` birlikte incelenmiştir.  
**Amaç:** Faz 1 başlamadan önce uygulamanın teknik ve hesaplama sözleşmesini test edilebilir biçimde dondurmak. Bu belge yeni bir ürün yol haritası açmaz.

---

## 1. Değişmeyen ürün sınırı

- Tek kullanıcıya ait, yerel çalışan, standalone Windows masaüstü uygulamasıdır.
- Teknoloji yığını C#/.NET, WPF ve SQLite; mimari modüler monolith'tir.
- İlk ve tek doğrulama dilimi **Temiz Su** projesidir. Gerçek Excel mevcut olmadığından geliştirme doğrulaması açıkça `SYNTHETIC` etiketli temsilî paketle yapılır; bu dilim doğrulanmadan başka tesisat türü ele alınmaz.
- Canvas, bulut, çoklu kullanıcı, stok/fiyat yönetimi, serbest kod/formül ve AutoCAD/DWG/DXF/PDF veri okuma kapsam dışıdır.
- `uses` ilişkisi yoktur. Bir katalog kartı farklı yerlerde kullanılacaksa aynı kart sürümünden yeni proje yerleşimleri oluşturulur.
- `calculated-from` kapsam içidir; ancak kart veya fitting keşfetmez. Kullanıcı ya da şablon hedef Ek Parça yerleşimini önceden oluşturur, sistem yalnızca sürümlü ve incelemeye tabi miktar önerir.
- Domain katmanının WPF'ten ayrılması mevcut uygulamanın kalite kuralıdır; bu uygulama için devam ürünü veya entegrasyon taahhüdü değildir.

## 2. Platform ve dağıtım sözleşmesi

### 2.1 Teknik hedef

- Desteklenen bir Windows 11 x64 bilgisayar için teknik tercih **.NET 10 LTS**, `net10.0-windows` ve `win-x64`dır.
- Dağıtım: self-contained klasör veya installer. Son kullanıcıda ayrıca .NET Runtime kurulması gerekmemelidir.
- “Tek fiziksel `.exe` dosyası” kabul şartı değildir. SQLite ve rapor kütüphanelerinin yerel dosyaları nedeniyle doğrulanabilir bir installer/klasör dağıtımı daha güvenlidir.

### 2.2 Tespit edilen ortam engeli

- Geliştirme bilgisayarı Windows 10 Home Single Language'dır.
- Microsoft'un güncel destek tablosunda Windows 10 desteği LTSC/Enterprise sürümleriyle sınırlıdır; bu bilgisayar .NET 10 için resmi destek hedefi değildir.
- Bilgisayarda .NET runtime'ları bulunmasına rağmen **hiç .NET SDK kurulu değildir**.
- Kullanıcı nihai çalışma hedefini 2026-08-30 tarihinde Windows 11 x64 olarak kesinleştirmiştir; framework/işletim sistemi kararı açık değildir.
- Mevcut Windows 10 Home geliştirme makinesi .NET 10 için desteklenen hedef sayılmaz. Faz 1 çalışması Windows 11 x64 ortamında veya destek durumu açıkça kabul edilmiş geçici geliştirme ortamında yürütülmelidir; nihai kabul Windows 11 x64 üzerinde yapılır.
- Uygun x64 .NET 10 SDK kurulur; `dotnet --info` çıktısında SDK görünmeden iskelet oluşturulmaz.

## 3. Katalog, proje ve sürümleme sözleşmesi

### 3.1 Katalog kartı ile proje yerleşimi

- `CatalogCardDefinition`, yeniden kullanılabilir kart kimliğidir.
- `CatalogCardVersion`, kartın yayımlandıktan sonra değiştirilemeyen sürümüdür.
- `ProjectPlacement`, seçilen kart sürümünün belirli bir proje ağacındaki kullanım yeridir.
- Bir katalog kartı güncellendiğinde yeni sürüm doğar; eski proje ve hesaplar sessizce değişmez.
- Kullanıcı bir yerleşimi yeni kart sürümüne geçirmek isterse bunu açıkça yapar. Yeni hesap sonucu üretilir, eski sonuç korunur ve arayüz eski sürümde kalan yerleşimi görünür biçimde işaretler.

### 3.2 Veri topolojisi

- İlk build tek bir uygulama SQLite veritabanı kullanır: katalog, kart sürümleri ve bütün projeler aynı veritabanındadır.
- Her proje `ProjectId` ile kesin olarak ayrılır; ayrı proje ağacı ve revizyonları vardır.
- `ProjectPlacement`, değişmez `CatalogCardVersionId` değerine bağlanır. Kart güncellemesi yeni sürüm oluşturduğu için ayrıca `ProjectCardSnapshot` katmanı gerekmez.
- Hesap sonucu; kart sürümü kimliğini ve kart sürümü içerik hash'ini birlikte pinler.
- Proje bazında taşınabilir dosya, içe/dışa aktarma ve isim çakışması çözümü ilk build kapsamına alınmaz. Bütün veritabanı yedeklenir ve geri yüklenir.
- Bu, kullanıcı tercihi değil; mevcut tek-makine ve tek-build kapsamını en az hareketli parçayla karşılayan teknik karardır.

### 3.3 Beş kart tipi ile davranışların ayrılması

Beş sabit kart tipi korunur:

1. Kategori
2. Kapsam
3. Sistem
4. Malzeme
5. Ek Parça

Kart tipi, davranışı tek başına belirlemez. Kart sürümünde birbirinden ayrı varsayımlar tutulur:

- Kalem türü: malzeme, cihaz, işçilik, hizmet veya diğer.
- Girdi davranışı: manuel miktar, evet/hayır veya türetilmiş miktar.
- Fire politikası.
- Satış dönüşümü: yok, standart boy veya paket.
- Yuvarlama politikası.
- Rapor davranışı: yalnızca grup, miktar satırı veya yardımcı satır.

Bu varsayımlar `CatalogCardVersion`'a aittir. `ProjectPlacement` yalnızca açıkça girilmiş proje özelindeki override'ları taşır. Manuel hesap düzeltmesi kart davranışı değildir; ayrı bir inceleme kararıdır.

### 3.4 Kart verisi sınırı

- İlk build genel amaçlı dinamik alan motoru içermez. Bu mekanizma; alan tanımı sürümleme, migration, filtre ve rapor tasarımıyla tek seferlik uygulamayı gereksiz büyütür.
- Katalog kartı; kod, ad, açıklama, kart tipi, kalem türü, birim, isteğe bağlı poz, etiketler, not ve hesap politikalarının sabit alanlarını taşır.
- Proje yerleşimi; görüntü adı override'ı, not, sorumluluk atamaları ve izin verilen hesap politikası override'larını taşır.
- Kullanıcı sınırsız sayıda kart ve yerleşim oluşturabilir; konfigürasyon ihtiyacı bu kayıtlar ve bileşebilir politikalarla karşılanır.
- Sentetik referans veya ileride bulunabilecek gerçek veri çekirdek alanlarla ifade edilemeyen zorunlu bir bilgi gösterirse yalnız o bilgi için tipli alan eklenir. Kanıt olmadan genel “özel alan tasarımcısı” yapılmaz.

## 4. Proje ağacı ve bağlantı sözleşmesi

- `contains`, ekranda görülen tek ebeveynli proje ağacını kurar. Kök dışındaki her yerleşimin tam bir ebeveyni vardır; döngü yasaktır.
- Beş kart tipi zorunlu beş katmanlı bir sıra değildir. Başlangıç şablonu `Kategori → Kapsam → Sistem → Malzeme → Ek Parça` olabilir, fakat gereksiz katmanlar atlanabilir.
- Bir miktar satırı olan yerleşim gerektiğinde çocuk yerleşim de barındırabilir; ebeveynin ve çocukların miktarları ayrı katkılardır.
- `component-of`, iki mevcut yerleşim arasındaki semantik parça ilişkisini ifade eder; yeni yerleşim veya miktar üretmez.
- `calculated-from`, hedef yerleşimin miktar önerisini kaynak yerleşimin sonuçlarından türeten yönlü bağımlılıktır.
- `reference`, ilk build'de yalnız **bir kaynak yerleşimin tamamını** ikincil bir rapor başlığında gösteren alias ilişkisidir: `SourcePlacementId → AliasPlacementId`. Tek bir ölçümü seçmez; kaynak yerleşimin bütün etkin katkılarını kapsar.
- Bütün genel toplamlar read-model üzerindeki `QuantityContributionKey` ile tekilleştirilir. Anahtar, manuel giriş için `Measurement:{MeasurementId}`; türetilmiş sonuç için `CalculationResult:{CalculationResultId}` biçimindedir. Bu ayrı bir veri tabanı tablosu değildir.
- Bir `reference` görünümü aynı katkıyı ikinci kez toplama hakkına sahip değildir. Yalnız belirli bir ölçümün başka başlıkta görünmesi gerekiyorsa ilk build'de ayrı birincil yerleşim kullanılır; ölçüm-seviyeli reference eklenmez.
- Ölçümün bir tek birincil yerleşimi vardır. Başka bir rapor görünümü gerekiyorsa ikinci ölçüm açılmaz; `reference` kullanılır.

## 5. Ölçüm ve revizyon sözleşmesi

### 5.1 Ölçümün anlamı

- `Measurement`, belirli bir proje revizyonunda, tek bir proje yerleşimine ve bağlama ait **atomik fiziksel miktar girdisidir**.
- Nihai toplam değildir; toplamlar ölçümlerden türetilir.
- Dönemsel hakediş veya ilerleme kaydı değildir. Ocak/Şubat imalat takibi bu uygulamanın kapsamı dışındadır.
- Aynı yerleşim ve bağlam için iki ölçüm girilirse ikisi de fiziksel katkı sayılır. Bir değeri düzeltme işlemi yeni miktar eklemek yerine mevcut taslak ölçümü günceller ve audit kaydı oluşturur.
- Arayüzde `Yeni ölçüm ekle` ile `Mevcut ölçümü düzelt` ayrı ve açık eylemlerdir; aynı komutun bağlama göre iki farklı anlam taşımasına izin verilmez.
- Bu nedenle Claude ekibinin önerdiği `kayıt_türü = nihai / dönemsel-ek` alanı eklenmez; alan uygulamanın kapsam dışındaki hakediş kavramını içeri taşır.

### 5.2 Ölçüm bağlamı

İlk build'de şu bağlam alanları sabittir:

- Blok
- Kat
- Mahal
- Pafta
- Hat/zon
- Kaynak çizim revizyonu

Sistem tarafından yönetilen `ProjectRevisionId` ile kullanıcının yazdığı kaynak çizim revizyonu aynı kavram değildir ve ayrı alanlarda tutulur.

### 5.3 Proje revizyonu

- Proje revizyonu durumları en az `Draft`, `Approved` ve `Archived` olur.
- `Approved` revizyon değişmez. Değişiklik gerektiğinde önceki revizyondan yeni `Draft` snapshot üretilir.
- Revizyon kapsamındaki herhangi bir `PendingReview`, `Stale` veya geçersiz hesap varken revizyon `Approved` yapılamaz. Onay işlemi bütün kontrol kalemlerinin çözülmesini zorunlu kılar.
- Yerleşimler, ölçümler, sorumluluklar ve geçerli hesap sonuçları proje revizyonuna bağlıdır.
- Nihai rapor yalnızca onaylanmış proje revizyonundan üretilir.

### 5.4 DataGrid satırının kimliği

- Ana tabloda bir veri satırı = bir `Measurement` + ona ait güncel hesap read-model projeksiyonudur.
- Hesap geçmişi aynı satıra çoğaltılmaz; sağ panelde veya ayrı hesap izi ekranında gösterilir.
- `calculated-from` hedefleri fiziksel ölçüm üretmez. Hedef yerleşim için etkin `CalculationResult` ayrı bir katkı projeksiyonu olarak görünür.

## 6. Sorumluluk sözleşmesi

- Sorumluluk boyutları kullanıcı tarafından genişletilebilir; Temin, Montaj, İzolasyon ve Test yalnızca başlangıç örnekleridir.
- Sorumlu taraflar proje içinde adlandırılır: Biz, İşveren, ABC Taşeron gibi.
- Hariç ve Opsiyonel bir taraf değil, atama durumudur.
- Her sorumluluk boyutu bağımsız çözülür. Öncelik sırası:
  1. Ölçüm üzerindeki açık override
  2. En yakın ata yerleşimdeki açık atama
  3. Proje varsayılanı
  4. Atanmamış
- Sorumluluk görünümü bir miktarı farklı tarafların altında gösterebilir; ancak fiziksel katkıyı bölmez veya genel toplamda çoğaltmaz.

## 7. Hesaplama sözleşmesi

### 7.1 Sayısal temsil

- Domain hesaplarında C# `decimal` kullanılır; `double` ve `float` kullanılmaz.
- SQLite `REAL` alanında miktar saklanmaz. Altı ondalık basamaklı sabit ölçekli `INTEGER` değer dönüştürücüsü kullanılır.
- Kullanıcı girdisi en fazla altı ondalık basamak kabul eder. Daha hassas giriş sessizce yuvarlanmaz; doğrulama hatası verir.
- Canonical miktar aralığı `0` ile `9.223.372.036.854,775807` arasındadır. Bu aralığın dışındaki giriş veya hesap sonucu `QTY_OUT_OF_RANGE` hatası verir.
- Ara hesaplar yuvarlanmaz. Görsel basamak sayısı ile hesap hassasiyeti ayrı ayardır.
- Son ondalık sonuç altı basamağa taşarsa yalnızca sözleşmeli sonuç sınırında `MidpointRounding.AwayFromZero` ile altı basamağa alınır.

### 7.2 Sabit işlem sırası

1. Girdiyi doğrula ve birimi normalize et.
2. Ölçümün net miktarını oluştur.
3. Aynı yerleşim ve aynı etkin fire politikasındaki net miktarları topla; fireli miktarı hesapla.
4. Uyumlu fireli miktarları satın alma grubunda topla.
5. Satış birimine dönüştür.
6. Gerekliyse yalnızca satış kabı sayısını yukarı yuvarla.
7. Satın alma miktarını ve fiziksel karşılığını hesapla.
8. Artan miktarı hesapla.
9. Varsa gerekçeli manuel düzeltme kararını uygula.

Formüller:

```text
fireli = net × (1 + fire_orani / 100)

standart_boy_adedi = ceil(fireli / standart_boy)
alinan_fiziksel_uzunluk = standart_boy_adedi × standart_boy
artan = alinan_fiziksel_uzunluk - fireli

paket_adedi = ceil(fireli / paket_ici_adet)
alinan_fiziksel_adet = paket_adedi × paket_ici_adet
artan = alinan_fiziksel_adet - fireli
```

### 7.3 Hesap ve satın alma grupları

- Standart boy veya paket yuvarlaması her ölçüm satırında ayrı ayrı yapılmaz; aksi hâlde kat/mahal parçalanması gereksiz fazla satın alma üretir.
- Önce aynı yerleşim ve aynı etkin fire politikasındaki ölçümler toplanır; fire bu **hesap grubuna** uygulanır.
- Sonra uyumlu hesap gruplarının fireli sonuçları bir **satın alma grubunda** birleştirilir; standart boy/paket dönüşümü ve `ceiling` bir kez uygulanır.
- Bir satın alma grubundaki bütün üyelerin `ProjectRevisionId`, kart sürümü, fiziksel birim ailesi, satış dönüşümü, standart boy/paket parametresi ve ilgili temin sorumluluğu uyumlu olmalıdır. Farklı revizyonların ölçümleri hiçbir koşulda aynı satın alma grubunda birleşmez.
- Güvenli varsayılan, farklı yerleşimleri ayrı satın alma gruplarında tutmaktır. Yalnız aynı açık `ProcurementScope` değerini taşıyan ve diğer bütün özellikleri uyumlu yerleşimler birlikte gruplanır; `NoPool` işareti her zaman ayrı grup zorlar.
- Gerçek sipariş pratiği bilinmediğinden sentetik pakette kullanılan `ProcurementScope` değerleri açık varsayım ve sürüm olarak kaydedilir.
- DataGrid satırı yalnız net ve bilgi amaçlı `Fireli Projeksiyon` değerini gösterebilir. Bu projeksiyon yuvarlama nedeniyle toplanmaz; otoritatif fireli değer hesap grubu alt toplamıdır. Satın alma kabı, satın alınan fiziksel miktar ve artan miktar da ayrı satın alma grubu alt toplamında gösterilir.
- Farklı birimler tek bir toplamda toplanamaz. Toplamlar ürün/yerleşim ve birim bazında gruplanır.

### 7.4 Doğrulama kuralları

- Negatif ölçüm reddedilir; boş değer sıfır sayılmaz.
- Fire oranı negatif olamaz. `%100` üzeri değer engellenmez fakat açık uyarı ve kullanıcı teyidi ister; sistem sessiz üst sınır uygulamaz.
- Standart boy ve paket içi adet sıfırdan büyük olmalıdır.
- Adet ailesindeki manuel fiziksel ölçüm tam sayı olmalıdır.
- Birim ailesi uyuşmayan işlemler reddedilir; örtük metre/adet dönüşümü yapılmaz.
- Satış kabı sayısında `ceiling` kullanılır; tam bölünmede ilave kap üretilmez.

## 8. `calculated-from` ve inceleme sözleşmesi

- Kaynak ve hedef proje yerleşimleri önceden vardır. Kural yeni kart, yerleşim veya fitting keşfetmez.
- Kural sürümü; kaynak miktar türünü (`Net`, `Fireli` gibi), bağlam gruplama anahtarını, oranı ve yuvarlama politikasını sabitler. Varsayılan kaynak miktar türü `Net`tir.
- Üretilen sonuç en az şu bilgileri taşır:
  - Kart sürümü
  - Kural sürümü
  - Birim politikası sürümü
  - Hesap motoru sürümü
  - Kaynak ölçüm/sonuç kimlikleri
  - Girdi özeti veya hash'i
  - Ara hesap adımları
  - Önerilen miktar
  - Kullanılan miktar
  - İnceleme durumu ve gerekçe
- İlk durum `PendingReview` olur; öneri kesin toplam sayılmaz.
- İlk build'de bir `calculated-from` hedefi başka bir `calculated-from` kuralının kaynağı olamaz. Böylece bekleyen/geçersiz durum zinciri oluşmaz. Sentetik veya ileride bulunabilecek gerçek referans zorunlu kılmadıkça zincirli türetme eklenmez.
- Aynı kaynak kimlikleri, sürüm seti ve input hash'iyle kuralın tekrar çalışması ikinci bir etkin sonuç üretmez; işlem idempotenttir.
- Durum geçişleri:

| Mevcut durum | Olay | Yeni durum | Sonuç |
|---|---|---|---|
| — | Hesap önerisi üretildi | `PendingReview` | Kesin toplama girmez |
| `PendingReview` | Kullanıcı kabul etti | `Approved` | Etkin katkı olur |
| `PendingReview` | Kullanıcı yeni değer ve gerekçe girdi | `Overridden` | Öneri korunur, kullanıcı değeri etkin katkı olur |
| `PendingReview` | Kullanıcı reddetti | `Rejected` | Katkı üretmez |
| `PendingReview` / `Approved` / `Overridden` / `Rejected` | Kaynak, kart, kural veya birim politikası değişti ya da kaynak silindi | `Stale` | Kesin katkı olmaktan çıkar; önceki karar geçmişte korunur |
| `Stale` | Geçerli yeni öneri üretildi | `Superseded` | Eski kayıt yalnız hesap izi/audit'te kalır; yeni kayıt `PendingReview` doğar |

- Kaynak artık hesaplanamıyorsa kayıt `Stale` kalır ve kullanıcıya hata gösterilir; sahte bir sıfır öneri üretilmez.
- `calculated-from` grafiğinde döngü yasaktır.
- `reference` yalnız aynı proje revizyonundaki yerleşimleri bağlayabilir; self-reference ve reference döngüsü reddedilir.

## 9. Rapor ve izlenebilirlik sözleşmesi

- Taslak rapor, seçili rapor kapsamındaki `PendingReview` ve `Stale` sonuçları durum etiketiyle gösterebilir; bunları kesin satın alma toplamına katmaz. `Superseded` kayıtlar yalnız hesap izi/audit ekranında görünür.
- Nihai rapor üretimi yalnız **seçili rapor kapsamı içinde** `PendingReview`, `Stale` veya geçersiz hesap varken engellenir ve eksik/kontrol listesi gösterilir. Rapor filtresinin dışındaki bekleyen kayıt ilgisiz raporu bloke etmez.
- Nihai toplam yalnızca doğrulanmış manuel ölçümleri ve `Approved`/`Overridden` etkin türetilmiş sonuçları içerir.
- Her rapor; proje revizyonu, filtreler, şablon sürümü ve kullanılan katkı/hesap sonucu kimlikleriyle snapshot olarak kaydedilir.
- `reference` ve sorumluluk görünümleri aynı katkıyı farklı başlıklarda gösterebilir; genel toplam `QuantityContributionKey` üzerinden bir kez hesaplanır.
- Net, fireli, satın alma kabı, satın alınan fiziksel karşılık ve artan miktar farklı sütun ve birimlerle gösterilir.

## 10. Ekran akışı için netleşen noktalar

- Poz numarası otomatik üretilmez. Katalogda isteğe bağlı metin alanı ve projede isteğe bağlı override bulunur.
- “Mevcut dala kalem ekle” için varsayılan UX, klavyeyle açılan satır içi arama/seçim alanıdır; ayrıntılı kart oluşturma ayrı dialogda yapılır.
- Uygulama ayarları ile proje ayarları ayrıdır. Tema/pencere gibi tercihler uygulama ayarına; birim/rapor/proje varsayımları veritabanındaki ilgili proje kaydına aittir.
- Başlangıç ekranı dosya yolu seçmez; tek uygulama veritabanındaki proje listesinden açar veya yeni proje kaydı oluşturur.
- Yedekleme ve geri yükleme ilk build'de tek bir projeyi değil, katalog ve bütün projeleri içeren uygulama veritabanının tamamını kapsar. Geri yükleme ekranı bu etkiyi açıkça gösterir ve onay ister.
- Revizyon karşılaştırma mevcut iki snapshot'ı kıyaslar; rapor önizleme seçili tek snapshot'tan çıktı üretir. Bunlar ayrı sorumluluklardır.
- Eski katalog sürümünde kalan yerleşimler ağaçta ve satır detayında uyarı rozeti taşır; kendiliğinden güncellenmez.

### 10.1 Bağımsız kullanılabilirlik incelemesiyle kilitlenen DataGrid kuralları

- Grid bütün teknik alanları aynı anda göstermek zorunda değildir; iş sütunları varsayılan görünümde, denetim sütunları isteğe bağlı görünür. `MeasurementId` kopyalanabilir/aranabilir biçimde detay panelinde; `ProcurementScope` iş etiketi olarak gridde; `CalculationGroupId` ve `PurchaseGroupId` grup özeti ile detay panelinde gösterilir. `SourceKind` yalnız fixture/provenance metadata'sıdır ve üretim grid sütunu değildir.
- Sistem `ProjectRevisionId` ile kullanıcı kaynaklı `DrawingRevision` aynı sütuna düşmez. Gridde **Proje Revizyonu** salt okunur, **Pafta Rev.** ayrı düzenlenebilir bağlam alanıdır.
- Kullanıcının yazdığı ham `InputQuantity` ile normalize edilmiş/hesaplanmış `NetQuantity` ayrı alanlardır. Birim dönüşümü yoksa eşit görünebilirler; aynı hücrenin iki anlam taşımasına izin verilmez.
- Şaft ilk build'in ayrı çekirdek bağlam alanı değildir; gerekli bilgi Mahal veya Hat/Zon içinde tutulur. Gerçek kullanım açık bir ihtiyaç kanıtlarsa sabit tipli ayrı alan olarak ayrıca kararlaştırılır.
- Satır `Fireli Projeksiyon`u yalnız bilgi amaçlıdır; italik metin + bilgi simgesi + açıklama ile gösterilir ve toplama alınmaz. `CalculationGroup` özeti, normal/kalın yazı ve renkten bağımsız tarama/kenarlıkla otoritatif net/fireli toplamı gösterir. Başka dala türetme varsa kaynak satırdan hedef yerleşime gidilebilen metinli bir gösterge bulunur.
- Blok, Kat, Mahal, Pafta, Hat/Zon ve Pafta Rev. hücreleri serbest metin + kısıtlamayan öneri listesi kullanır. Excel yapıştırmasında sözlükte olmayan değer reddedilmez veya sessizce kaybolmaz; değer kaydedilir, yeni öneriye dönüşür ve gerekiyorsa uyarı alır.
- Mevcut ölçüm değiştirilirken etkilenecek onaylı/override edilmiş türetilmiş sonuç sayısı kaydetmeden önce gösterilir; kaydetme ilgili sonuçları `Stale` yapar. Yeni/kaydedilmemiş satır ile mevcut satırdaki kaydedilmemiş değişiklik farklı desen, çerçeve ve metin/ikonla ayrılır. Tam aynı yerleşim + bağlam + miktar kopyasında engellemeyen yinelenen ölçüm uyarısı verilir.
- Durum görünümü altı durumu kapsar: `PendingReview`, `Approved`, `Overridden`, `Rejected`, `Stale`, `Superseded`. Renk tek taşıyıcı değildir; kategori kenarlığı/deseni ile durum kısaltması ve tam Türkçe metin birlikte kullanılır. Kesin toplama girme durumu ilk bakışta görünürdür.
- `Rejected` sonuç tarihsel ve değişmez kalır. Kaynak değiştiğinde uygun kural hâlâ geçerliyse yeni kimlikli bir `PendingReview` önerisi oluşturulabilir; önceki reddedilmiş kayıt audit zincirinde korunur ve hiçbir kesin/satın alma toplamına girmez.
- İşçilik/Hizmet kalem türleri ile Evet/Hayır girdi davranışı mevcut sentetik paketin kapsam boşluğudur. Bu davranışlar uygulanacağı fazda ayrı sentetik testlerle kabul edilmeden tamamlanmış sayılmaz; doğrulanmış pakete sonradan sessizce satır eklenmez.

## 11. Başarı ve performans ölçütleri

Gerçek proje hacmi bilinmediğinden aşağıdaki performans hedefleri **geçici sentetik benchmark sözleşmesidir**. Sonuçlar gerçek veri performansı gibi sunulamaz.

### 11.1 Doğruluk

- Sentetik referans satırlarının `%100`ü kart sürümü, yerleşim, ölçüm bağlamı ve rapor satırıyla eşlenir. Gerçek Excel eşlemesi Phase 8'e ertelenmiş koşullu ek kontroldür.
- Altın veri; satır düzeyinde net, hesap grubu düzeyinde otoritatif fireli ve satın alma grubu düzeyinde kap/fiziksel satın alma/artan sonuçlarında tam canonical `decimal` eşitliğiyle geçer; yaklaşık tolerans kullanılmaz.
- Referans toplamları bağımsız ikinci hesapla aynı çıkar.
- Her rapor miktarından kaynak kayda ve kullanılan sürüm setine geri izlenebilir.
- Açık domain kararı veya açıklamasız manuel override kalmaz.

### 11.2 Kullanılabilirlik

- İlk dal seçildikten sonra tekrarlı ölçüm girişi yalnız klavyeyle tamamlanabilir.
- 500 satırlık tablo yapıştırması doğrulama sonuçlarıyla birlikte veri kaybetmeden tamamlanır.
- Hatalı hücre, bütün kaydı reddetmek yerine satır/hücre düzeyinde açık Türkçe mesaj verir.
- Kullanıcı; kart ekleme → ölçüm → hesap izi → taslak rapor akışını yardım almadan tamamlayabildiğini kabul testinde gösterir.

### 11.3 Geçici performans hedefleri

- Deterministik benchmark profilleri: `SYN-SMOKE` (30–50 satır), `SYN-ENTRY-500` (500 giriş satırı) ve `SYN-STRESS-1500` (1.500 ölçüm).
- Soğuk uygulama açılışı ve referans proje açma: ortanca en çok 5 saniye.
- Filtre, sıralama ve satır geçişi: 30 tekrarda p95 en çok 300 ms.
- Tek satır kaydetme geri bildirimi: 30 tekrarda p95 en çok 500 ms.
- `SYN-SMOKE` paketinin tüm etkin sonuçlarını yeniden hesaplama: ortanca en çok 3 saniye; `SYN-STRESS-1500` en çok 10 saniye.
- 500 satır yapıştırma ve doğrulama: ortanca en çok 3 saniye.
- `SYN-STRESS-1500` nihai raporunu üretme: ortanca en çok 15 saniye; uzun işlemde ilerleme göstergesi zorunludur.
- Soğuk açılış ve rapor için beş çalıştırmanın ortancası; etkileşim gecikmeleri için en az 30 örneğin p95 değeri raporlanır.
- Ölçümler Windows 11 x64 nihai kullanım bilgisayarında Release/self-contained build ile alınır. Gerçek veri daha sonra bulunursa gerçek iş yükü Phase 8'de ayrıca ölçülür.

## 12. Faz 0 kapanış kapıları

| Kimlik | Girdi / doğrulama | Sahip | Durum |
|---|---|---|---|
| F0-G02 | Nihai hedef Windows 11 x64 | Kullanıcı | Kapalı |
| F0-S01 | En az 30 satırlık sürümlü sentetik Temiz Su referans paketi | OpenAI | Kapalı: 36 satır, OpenAI doğrulaması geçti |
| F0-S02 | Expected sonuçların uygulama kodundan bağımsız ikinci ekip hesabı | Claude | Kapalı: 0 uyuşmazlık; 12/12 hash, 13/13 hesap ve 14/14 satın alma grubu eşleşti |
| F0-S03 | Satın alma grup anahtarı ve bütün iş varsayımlarının manifestte açık olması | İki ekip | Kapalı: Claude bağımsız incelemesi teyit etti |
| F0-S04 | Kanonik sözleşme ve sentetik paket üzerinde Claude/OpenAI uzlaşması | İki ekip + kullanıcı nihai kararı | Kapalı: iki ekip onayı + kullanıcı yönetici onayı, 2026-08-30 |
| REAL-R01 | Değiştirilmemiş gerçek Excel hash'i ve `%100` satır eşleme | Kullanıcı + iki ekip | Phase 8'e ertelendi; teslimi bloke etmez |
| REAL-R02 | Gerçek satın alma/rapor/hakediş pratiği ve zorunlu alan doğrulaması | Kullanıcı + iki ekip | Phase 8'e ertelendi; veri bulunmazsa artık risk olarak kalır |
| REAL-R03 | Gerçek iş yükü performans ve kullanıcı kabul testi | Kullanıcı + iki ekip | Phase 8'e ertelendi; veri bulunmazsa sentetik kabul kullanılır |

`F0-S01–S04` kapanmıştır; Faz 0 `COMPLETE` durumundadır. `REAL-*` kapıları sentetik doğrulamadan farklıdır ve gerçek veri yokken Phase 0'ı bloke etmez.

## 13. Teknik kaynaklar

- [.NET destek politikası](https://dotnet.microsoft.com/en-us/platform/support/policy)
- [Windows için .NET kurulum ve destek matrisi](https://learn.microsoft.com/en-us/dotnet/core/install/windows)
- [EF Core SQLite sağlayıcısının sınırlamaları](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations)
- [WPF genel bakış](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/)
