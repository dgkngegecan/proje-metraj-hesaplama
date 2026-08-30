# Yol Haritası — proje-metraj-hesaplama

Bu proje tek bir gerçek proje için tek seferlik geliştirilen standalone bir metraj (mekanik tesisat malzeme sayım) uygulamasıdır — büyüyen bir platform değildir. Aşağıdaki fazlar ayrı ürün sürümleri değil, **tek nihai standalone uygulamanın geliştirme ve kabul kapılarıdır**. Bir faz kendi testlerini geçmeden bir sonrakine başlanmaz.

Mimari gerekçe ve veri modeli detayı için: [Kart Sistemi Metraj Mimarisi](https://claude.ai/code/artifact/a8bf63e1-13c6-4e97-a88a-f3ce46cfce7d) (Rev 5).

## Kilitlenmiş kararlar

1. C#/.NET + WPF + SQLite kullanılacak.
2. Uygulama modüler monolith olarak kurulacak.
3. Katalog kartı ile proje yerleşimi ayrılacak.
4. Beş temel kart tipi korunacak.
5. Sorumluluklar genişletilebilir boyutlar olacak.
6. Proje ağacı tek ebeveynli olacak.
7. Metraj girişi Excel benzeri tabloda yapılacak.
8. Kat, mahal, blok, pafta ve revizyon metraj bağlamında tutulacak.
9. `uses` bağlantısı kullanılmayacak.
10. Hesaplar sınırlı, güvenli ve izlenebilir olacak.
11. Net, fireli ve satın alma miktarları ayrı tutulacak.
12. Canvas ilk sürümün temeli değil — yalnızca Temiz Su dikey diliminde ağaç arayüzünün çözemediği, tekrarlanan ve ölçülebilir bir sorun kanıtlanırsa mevcut build içinde değerlendirilir. Garanti edilmiş bir sonraki sürüm değildir.
13. AutoCAD/DWG/DXF/PDF'den veri okuma bu projenin kapsamı değildir. Domain katmanının WPF'ten ayrılması gelecekte bunu yapacak *farklı* bir aracın kütüphane olarak devralabilmesi içindir — bu projeye connector eklenmeyecektir.
14. İlk hedef, tek bir gerçek tesisat türünde (Temiz Su) uçtan uca çalışan güvenilir bir dikey dilimdir; bu doğrulanmadan diğer tesisat türlerine genişlenmez.
15. Veri topolojisi **tek uygulama SQLite veritabanıdır** — katalog, kart sürümleri ve tüm projeler aynı dosyada. Proje başına ayrı/taşınabilir dosya, içe/dışa aktarma **yok**. Gerekçe: veri hacmi küçük, gelecekte büyüme/çoklu proje paylaşımı kaygısı yok, karmaşıklığı en aza indirmek önceliklidir. Yedekleme/geri yükleme (Faz 7) tüm veritabanını kapsar, bu yeterli sayılır. (Karar: kullanıcı, 2026-08-30 — Claude/OpenAI çapraz incelemesinde ortaya çıkan tek gerçek anlaşmazlık buydu.)
16. Nihai işletim sistemi **Windows 11 x64**'tür (F0-G02 kapandı, karar: kullanıcı, 2026-08-30). `.NET 10 LTS / net10.0-windows / win-x64` hedefi doğrudan desteklenir, Windows 10 Home destek riski ortadan kalktı.
17. Gerçek Temiz Su Excel'i mevcut olmadığı için Faz 0, kaynağı açıkça `SYNTHETIC` olarak işaretlenmiş temsilî Temiz Su referans paketiyle kapanabilir (karar: kullanıcı, 2026-08-30). Paket iki ekip tarafından bağımsız hesaplanacak; gerçek veriyle doğrulanmış gibi sunulmayacak. Gerçek bir metraj daha sonra bulunursa Phase 8'de ek kabul/regresyon girdisi olur, geliştirmeyi bloke etmez.

---

**Faz 0 kapandı — 2026-08-30, kullanıcı yönetici onaylı.** Durum: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`. Kapanış raporları: `docs/faz0-bitis-raporu-openai-sol56.md` ve `docs/faz0-kapanis-raporu.md`.

## Faz 0 — Kapsamı dondurma ve referans proje

**Yapılacaklar**
- Nihai ürün kapsamı ve kapsam dışı özellikler kesinleştirilecek.
- Gerçek Excel bulunmadığı için temsilî, açıkça `SYNTHETIC` etiketli bir Temiz Su kaynak tablosu hazırlanacak.
- Domain sözlüğü hazırlanacak: Kart tanımı, Kart sürümü, Proje yerleşimi, Ölçüm, Sorumluluk, Net/fireli/satın alma miktarı, Revizyon.
- Birim, fire, paket, standart boy ve yuvarlama kuralları kesinleştirilecek.
- Beklenen hesap sonuçlarını içeren sentetik referans test paketi hazırlanacak; OpenAI ve Claude ekipleri sonuçları birbirinden bağımsız doğrulayacak.
- Başarı ve performans ölçütleri belirlenecek.

**Faz sonu testleri**
- Sentetik kaynak tablosundaki her satırın kart, yerleşim, ölçüm ve rapor karşılığı gösterilecek.
- Beklenen toplamlar bağımsız olarak ikinci kez hesaplanacak.
- Net, fireli ve satın alma miktarları arasında belirsizlik kalmayacak.
- Açık domain kararı ve kapsam belirsizliği bulunmayacak.
- Faz raporu açıkça `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED` durumunu taşıyacak.

## Faz 1 — Teknik temel ve kalite altyapısı

**Yapılacaklar**
- C#/.NET çözüm yapısı kurulacak: `Metraj.Domain`, `Metraj.Application`, `Metraj.Infrastructure`, `Metraj.Desktop`, `Metraj.Tests`.
- WPF, MVVM ve SQLite altyapısı hazırlanacak.
- Nullable kontrolleri, statik analiz ve uyarıların hata sayılması etkinleştirilecek.
- Veritabanı migration altyapısı kurulacak.
- Otomatik derleme, test ve publish akışı hazırlanacak.
- PDF ve Excel kütüphaneleri lisans, paketleme ve Türkçe desteği açısından doğrulanacak.
- Self-contained Windows yayını erken aşamada denenecek.
- Temel mimari ve ajan çalışma belgeleri oluşturulacak.

**Faz sonu testleri**
- Temiz bir checkout üzerinden tek komutla restore, build ve test tamamlanacak.
- Domain katmanının WPF, SQLite ve rapor kütüphanelerine bağımlı olmadığı otomatik kontrol edilecek.
- Uygulama açılış/kapanış smoke testi geçecek.
- Boş veritabanı oluşturulup yeniden açılabilecek.
- İlk Windows publish çıktısı temiz bir test ortamında başlatılabilecek.

## Faz 2 — Domain modeli ve veritabanı

**Yapılacaklar**
- Beş temel kart tipi uygulanacak: Kategori, Kapsam, Sistem, Malzeme, Ek Parça.
- Kart türünden bağımsız davranış eksenleri tanımlanacak: Kalem türü, Hesap modu, Rapor davranışı.
- Katalog kartı, kart sürümü ve proje yerleşimi ayrılacak.
- Tek ebeveynli proje ağacı modellenecek.
- Genişletilebilir sorumluluk boyutları ve atamaları oluşturulacak.
- Ölçüm bağlamları tanımlanacak: Blok, Kat, Mahal, Pafta, Hat/zon, Revizyon.
- `component-of`, `calculated-from` ve `reference` ilişkileri tanımlanacak. `uses` ilişkisi eklenmeyecek.
- Net, fireli ve satın alma miktarları ayrı modellenecek.
- SQLite tabloları, kısıtları, transaction ve migration'lar tamamlanacak.

**Faz sonu testleri**
- Geçersiz kart/davranış kombinasyonları reddedilecek.
- Çoklu ebeveyn, kendine bağlanma ve ağaç döngüsü engellenecek.
- `calculated-from` döngüleri yakalanacak.
- `reference` bağlantısının miktarı çoğaltmadığı doğrulanacak.
- Birim uyumsuzlukları reddedilecek.
- Bütün domain nesneleri SQLite'a yazılıp kayıpsız geri okunacak.
- Migration ve foreign-key kısıtları entegrasyon testlerinden geçecek.

## Faz 3 — Katalog ve proje yapılandırması

**Yapılacaklar**
- Kart oluşturma, düzenleme, arama ve pasife alma ekranları yapılacak.
- Kart değişikliklerinde yeni sürüm oluşturulacak.
- Proje oluşturma, açma ve kaydetme akışları geliştirilecek.
- Katalogdan projeye kart yerleştirme uygulanacak.
- WPF ağaç görünümünde: sıralama, taşıma, dal çoğaltma, projeye özel değer değiştirme, hızlı kalem ekleme geliştirilecek.
- Sorumluluk boyutu oluşturma ve atama ekranı eklenecek.
- Geçersiz bağlantı ve eksik alanlar kullanıcıya açıklanacak.
- Bu fazda canvas geliştirilmeyecek.

**Faz sonu testleri**
- Aynı katalog kartından farklı dallarda bağımsız yerleşimler oluşturulabilecek.
- Bir yerleşimdeki değişiklik diğer yerleşimleri etkilemeyecek.
- Katalog kartı güncellendiğinde eski proje sessizce değişmeyecek.
- Pasif kart eski projelerde görünmeye devam edecek, yeni yerleşime eklenemeyecek.
- Dal taşıma ve çoğaltma sonrasında ağaç aynı biçimde yeniden açılacak.
- Geçersiz ebeveyn ve döngü oluşturma girişimleri engellenecek.
- Temel kullanıcı akışları WPF smoke ve manuel görev testlerinden geçecek.

## Faz 4 — Temiz Su dikey dilimi

**Yapılacaklar**
- Sentetik referans Temiz Su projesi uygulamada oluşturulacak.
- Ana metraj çalışma ekranı geliştirilecek: sol panelde proje ağacı ve filtreler, ortada Excel benzeri DataGrid, sağda detay ve hesap izi.
- Ölçüm ekleme, düzenleme ve çoğaltma yapılacak.
- Klavye ile hızlı giriş ve Excel'den yapıştırma desteklenecek.
- Kat, mahal, blok, pafta, hat ve revizyon alanları kullanılacak.
- Tablo içinden mevcut dala hızlı kalem eklenebilecek.
- Doğrudan miktar ve temsilî standart boy/paket hesapları çalışacak.
- İlk işlevsel PDF ve Excel raporu üretilecek.

**Faz sonu testleri**
- Sentetik referans Temiz Su projesinin tüm satırları uygulamaya girilecek.
- Sonuçlar iki ekipçe bağımsız doğrulanmış sentetik beklenen sonuçlarla birebir karşılaştırılacak.
- Aynı yerleşime farklı kat ve mahallerde ölçüm girilebilecek.
- Filtreli ve filtresiz toplamlar doğru kalacak.
- Kaydet–kapat–yeniden aç akışında veri kaybı olmayacak.
- PDF ve Excel toplamları veritabanıyla eşleşecek.
- Gerçek kullanımda giriş süresi ve hata sayısı ölçülecek.
- **Bu faz kabul edilmeden diğer yapılandırma örneklerine geçilmeyecek.**

## Faz 5 — Hesap motoru ve günlük çalışma akışının tamamlanması

**Yapılacaklar**
- Sınırlı hesap modları tamamlanacak: Doğrudan miktar, Fire, Standart boy, Paket, Sabit çarpan, Yuvarlama, Yapıldı/yapılmadı, Manuel düzeltme.
- Sabit hesap sırası uygulanacak: Girdi → Birim normalizasyonu → Net miktar → Fire → Satış birimine dönüşüm → Yuvarlama → Satın alma miktarı → Artan miktar → Manuel düzeltme.
- `decimal` tabanlı hassas hesap kullanılacak.
- Hesap sonuçlarına şu bilgiler sabitlenecek: Kart sürümü, Kural sürümü, Birim politikası sürümü, Hesap motoru sürümü, Kaynak ölçümler, Girdi özeti/hash'i.
- Hesap izi ekranı tamamlanacak.
- Sorumluluk kalıtımı ve açık override kuralları uygulanacak.
- Toplu düzenleme, hata filtreleri ve hızlı giriş özellikleri tamamlanacak.

**Faz sonu testleri**
- Altın hesap veri setinin tamamı yüzde yüz eşleşecek.
- Sıfır, negatif, küsuratlı, çok büyük ve sınır girdileri test edilecek.
- Tam bölünme ve yuvarlama sınırları doğrulanacak.
- Birim uyumsuzluğu sessizce hesaplanmayacak.
- Kart veya kural güncellendiğinde geçmiş hesap değişmeyecek.
- Yeniden hesaplama eski sonucu ezmek yerine yeni sonuç oluşturacak.
- Manuel düzeltme gerekçesiz kaydedilemeyecek.
- Aynı girdi ve sürümler her çalıştırmada aynı sonucu üretecek.
- İkinci, farklı yapıdaki örnek bir tesisat kod değişikliği olmadan yapılandırılabilecek.

## Faz 6 — Nihai raporlama, revizyon ve audit

**Yapılacaklar**
- Ortak rapor modeli oluşturulacak.
- Nihai raporlar hazırlanacak: Detay metraj, Sistem/kategori özeti, Kat/mahal raporu, Sorumluluk özeti, Satın alma listesi, Eksik ve kontrol raporu.
- PDF ve Excel çıktıları tamamlanacak.
- Net, fireli ve satın alma miktarları açıkça ayrılacak.
- Poz numarası, pafta, revizyon ve hesap yöntemi raporlara eklenecek.
- Renk, desen, kod, girinti ve kenarlık birlikte kullanılacak.
- Proje revizyonu ve onaylı revizyon kilidi eklenecek.
- Önemli kullanıcı işlemleri için audit kaydı tutulacak.
- Üretilen raporun kullandığı revizyon ve hesap sonuçları kaydedilecek.

**Faz sonu testleri**
- Her rapor toplamı ölçüm ve hesap sonuçlarıyla mutabık olacak.
- PDF ve Excel aynı kayıtları ve toplamları içerecek.
- Aynı fiziksel ölçüm farklı rapor görünümlerinde çifte sayılmayacak.
- Eski revizyon raporu kart veya kural güncellendiğinde değişmeyecek.
- PDF sayfaları görsel olarak taşma, kırpılma ve üst üste binme açısından incelenecek.
- Siyah-beyaz baskıda kategoriler renk olmadan ayırt edilebilecek.
- Excel hücreleri doğru veri tipinde olacak ve onarım uyarısı vermeyecek.
- Kullanıcı metinleri Excel formül enjeksiyonuna karşı güvenli yazılacak.

## Faz 7 — Veri güvenliği, hata dayanımı ve performans

**Yapılacaklar**
- Otomatik yedekleme ve geri yükleme tamamlanacak.
- Migration öncesi güvenli snapshot alınacak.
- Soft delete ve temel veri bütünlüğü kontrolleri uygulanacak.
- Beklenmeyen kapanma ve başarısız yazma senaryoları ele alınacak.
- Aynı uygulama veritabanına iki uygulama örneğinin eşzamanlı yazması güvenli biçimde engellenecek veya tek-yazar politikasıyla yönetilecek.
- Bozuk, uyumsuz, salt okunur veya eksik uygulama veritabanı güvenli biçimde ele alınacak.
- Tablo sanallaştırma, filtreleme ve rapor üretimi optimize edilecek.
- Faz 0'da belirlenen performans sınırları hedef bilgisayarda ölçülecek.

**Faz sonu testleri**
- Kayıt sırasında uygulama zorla kapatılıp veri bütünlüğü kontrol edilecek.
- Yedekten geri yüklenen proje kaynak projeyle karşılaştırılacak.
- Desteklenen şema sürümleri migration fixture'larıyla test edilecek.
- Başarısız migration mevcut projeyi bozmayacak.
- İkinci uygulama örneğinin aynı uygulama veritabanına eşzamanlı yazması engellenecek.
- Büyük veri setinde açma, filtreleme, kaydetme ve rapor süreleri ölçülecek.
- Uzun kullanım sonunda bellek artışı ve açık dosya kilidi bulunmadığı kontrol edilecek.
- Önceki bütün regresyon testleri tekrar çalıştırılacak.

## Faz 8 — Paketleme, kullanıcı kabulü ve teslim

**Yapılacaklar**
- Self-contained Windows x64 uygulaması veya tüm bağımlılıkları içeren installer hazırlanacak.
- Kullanıcı verileri uygulama dosyalarından ayrı tutulacak.
- Başlangıç kartları, örnek proje ve rapor şablonları eklenecek.
- Kısa kullanım, yedekleme ve geri yükleme kılavuzu hazırlanacak.
- Kaynak kod, test fixture'ları, migration'lar ve yayın çıktısı arşivlenecek.
- Yeni özellik kabulü kapatılarak yalnızca kapsam içi hatalar düzeltilecek.

**Faz sonu testleri**
- .NET ve geliştirme araçları bulunmayan temiz Windows bilgisayarda çevrimdışı kurulum yapılacak.
- Proje oluşturma → kart yerleştirme → ölçüm → hesap → rapor → yedek → geri yükleme uçtan uca tamamlanacak.
- Türkçe Windows ayarlarında tarih, ondalık ve dosya adı işlemleri doğrulanacak.
- Uygulama kaldırıldığında kullanıcı projeleri silinmeyecek.
- Yeniden kurulum sonrası mevcut projeler açılabilecek.
- Sentetik Temiz Su referans paketi son kez uçtan uca çalıştırılacak; gerçek metraj dosyası o tarihe kadar bulunursa ayrıca karşılaştırılacak, bulunmaması teslimi bloke etmeyecek.
- Kritik ve yüksek öncelikli açık hata kalmadan nihai teslim yapılacak.
- Yayın paketi temiz checkout üzerinden yeniden üretilebilecek.

---

## Kapsam kontrol kapıları

- Canvas ayrı bir roadmap fazı değildir. Yalnızca Temiz Su dikey diliminde ağaç arayüzünün çözemediği, tekrarlanan ve ölçülebilir bir sorun kanıtlanırsa mevcut build içinde değerlendirilir.
- AutoCAD, DWG, DXF veya PDF'den veri okuma bu projenin kapsamı değildir.
- Bulut, çoklu kullanıcı, plugin sistemi, serbest kullanıcı kodu ve otomatik fitting üretimi eklenmeyecektir. Kapsam dışı olan: CAD/geometriden, boru uzunluğundan veya tanımsız varsayımlardan fitting türü ve kesin adedini otomatik keşfetmek. Kapsam dahilinde olan ve korunan mekanizma:
  1. Ek Parça yerleşimi kullanıcı veya proje şablonu tarafından oluşturulur.
  2. Kaynak kaleme `calculated-from` bağlantısıyla bağlanır.
  3. Tanımlı ve sürümlenmiş kural önerilen miktarı hesaplar.
  4. Sonuç `Kontrol bekliyor` durumunda oluşturulur.
  5. Kullanıcı sonucu kabul edebilir veya gerekçe yazarak manuel değiştirebilir.
  6. Hesap kaynağı, kural sürümü, ara değerler ve manuel değişiklik saklanır.
- Domain katmanının ayrılması gelecek ürün taahhüdü değil, hesap mantığını WPF arayüzünden bağımsız tutan kalite kuralıdır.

## Her faz için ortak tamamlanma şartı

- Kod uyarısız derlenmeli.
- İlgili birim, entegrasyon ve regresyon testleri geçmeli.
- Veritabanı değişikliği varsa migration bulunmalı.
- Yeni domain davranışı kısa biçimde belgelenmeli.
- Temiz Su sentetik referans testleri bozulmamalı.
- Kritik kullanım yolu testsiz bırakılmamalı.
- Faz kabul edilmeden sonraki faza geçilmemeli.

## Kısa akış

1. Kapsamı ve bağımsız doğrulanmış sentetik referans verisini dondur.
2. Teknik ve kalite temelini kur.
3. Domain modelini ve SQLite şemasını tamamla.
4. Katalog ve proje ağacını geliştir.
5. Temiz Su dikey dilimini uçtan uca doğrula.
6. Hesap motoru ve hızlı giriş akışını tamamla.
7. Rapor, revizyon ve audit yapısını bitir.
8. Veri güvenliği ve performansı doğrula.
9. Paketle, kullanıcı kabul testini yap ve teslim et.
