# Yol Haritası — proje-metraj-hesaplama

Bu proje tek bir gerçek proje için tek seferlik geliştirilen standalone bir metraj (mekanik tesisat malzeme sayım) uygulamasıdır — büyüyen bir platform değildir. Aşağıdaki fazlar ayrı ürün sürümleri değil, **tek nihai standalone uygulamanın geliştirme ve kabul kapılarıdır**. Bir faz kendi testlerini geçmeden bir sonrakine başlanmaz.

Mimari gerekçe ve veri modeli detayı için: [Kart Sistemi Metraj Mimarisi](https://claude.ai/code/artifact/a8bf63e1-13c6-4e97-a88a-f3ce46cfce7d) (Rev 5).

## Kilitlenmiş kararlar

1. C#/.NET + WPF masaüstü kabuğu + SQLite kullanılacak; görsel çalışma alanı React + React Flow olacaktır.
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
12. Kullanılabilirlik değerlendirmesinden sonra canvas, ilk sürümün ana yapılandırma yüzeyi olarak React Flow ile uygulanmıştır; veri modeli yine tek ebeveynli ağaçtır.
13. AutoCAD/DWG/DXF/PDF'den veri okuma bu projenin kapsamı değildir. Domain katmanının WPF'ten ayrılması gelecekte bunu yapacak *farklı* bir aracın kütüphane olarak devralabilmesi içindir — bu projeye connector eklenmeyecektir.
14. İlk hedef, tek bir gerçek tesisat türünde (Temiz Su) uçtan uca çalışan güvenilir bir dikey dilimdir; bu doğrulanmadan diğer tesisat türlerine genişlenmez.
15. Veri topolojisi **tek uygulama SQLite veritabanıdır** — katalog, kart sürümleri ve tüm projeler aynı dosyada. Proje başına ayrı/taşınabilir dosya, içe/dışa aktarma **yok**. Gerekçe: veri hacmi küçük, gelecekte büyüme/çoklu proje paylaşımı kaygısı yok, karmaşıklığı en aza indirmek önceliklidir. Yedekleme/geri yükleme (Faz 7) tüm veritabanını kapsar, bu yeterli sayılır. (Karar: kullanıcı, 2026-08-30 — Claude/OpenAI çapraz incelemesinde ortaya çıkan tek gerçek anlaşmazlık buydu.)
16. Nihai işletim sistemi **Windows 11 x64**'tür (F0-G02 kapandı, karar: kullanıcı, 2026-08-30). `.NET 10 LTS / net10.0-windows / win-x64` hedefi doğrudan desteklenir, Windows 10 Home destek riski ortadan kalktı.
17. Gerçek Temiz Su Excel'i mevcut olmadığı için Faz 0, kaynağı açıkça `SYNTHETIC` olarak işaretlenmiş temsilî Temiz Su referans paketiyle kapanabilir (karar: kullanıcı, 2026-08-30). Paket iki ekip tarafından bağımsız hesaplanacak; gerçek veriyle doğrulanmış gibi sunulmayacak. Gerçek bir metraj daha sonra bulunursa Phase 8'de ek kabul/regresyon girdisi olur, geliştirmeyi bloke etmez.

---

**Faz 0 kapandı — 2026-08-30, kullanıcı yönetici onaylı.** Durum: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`. Kapanış raporları: `docs/arsiv/faz0-bitis-raporu-openai-sol56.md` ve `docs/arsiv/faz0-kapanis-raporu.md`.

**Faz 1 tamamlandı — 2026-08-30.** Çözüm iskeleti, kalite ayarları, EF Core/SQLite altyapısı, WPF host, lisans kararı ve self-contained yayın doğrulandı. Faz 1 kabul kapısı build/test/publish komutlarıyla geçildi.
**Faz 2 tamamlandı — 2026-08-30.** Domain modeli, sabit ölçekli miktar saklama, hesap motoru, ağaç/link kuralları, workspace servisleri ve gerçek WPF UI smoke doğrulaması tamamlandı. Kabul: 17/17 test, self-contained publish başarılı. Bitiş kaydı: `docs/arsiv/faz2-bitis-raporu-openai-sol56.md`.
**Faz 3 tamamlandı — 2026-08-30.** Katalog sürümleme, proje yerleşimi, genişletilebilir sorumluluklar ve WPF yapılandırma ekranı kabul edildi. Kabul: 19/19 test, gerçek Windows UI smoke ve self-contained `win-x64` publish başarılı. Bitiş kaydı: `docs/arsiv/faz3-bitis-raporu-openai-sol56.md`.
**Faz 4 tamamlandı — 2026-08-30.** Sentetik Temiz Su dikey diliminde kaynak metraj girişi, yerleşim-bazlı hesap özeti, ilk PDF/Excel raporları ve Windows UI kabulü tamamlandı. Kabul: 22/22 test, self-contained `win-x64` publish, 36 satırlık `SYNTHETIC` referansın uygulama içi rapor çıktısı. Durum: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`. Bitiş kaydı: `docs/arsiv/faz4-bitis-raporu-openai-sol56.md`.
**Faz 5 tamamlandı — 2026-08-30.** Sürümlü ve izlenebilir hesap önerileri, `calculated-from` bağımlılıkları, manuel onay/override, kart davranışı yapılandırması ve sorumluluk kalıtımı tamamlandı. Kabul: 30/30 test, self-contained `win-x64` publish ve gerçek Windows UI akışı. Bitiş kaydı: `docs/arsiv/faz5-bitis-raporu-openai-sol56.md`.
**Faz 6 tamamlandı — 2026-08-31.** Onaylı revizyon kilidi/kopyası, audit, ortak PDF/Excel rapor modeli, sistem-kategori ve kat-mahal raporları, sorumluluk ve hesap kontrol çıktıları tamamlandı. Kabul: 31/31 test, self-contained `win-x64` publish, gerçek Windows UI’dan üretilen 9 sayfalık PDF’nin görsel incelemesi ve Excel hücre/doğrulama kontrolü. Durum: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`. Bitiş kaydı: `docs/arsiv/faz6-bitis-raporu-openai-sol56.md`.
**Faz 7 tamamlandı — 2026-08-31.** Çevrimiçi SQLite tam yedek/geri yükleme, migration öncesi snapshot, bütünlük denetimi, tek-yazıcı kilidi, güvenli hata bildirimi ve büyük veri regresyonu tamamlandı. Kabul: 38/38 test, self-contained `win-x64` publish; gerçek Windows UI’da başlangıç/mekanik yedek, geri yükleme onayı ve ikinci örnek engeli doğrulandı. Bitiş kaydı: `docs/arsiv/faz7-bitis-raporu-openai-sol56.md`.
**Faz 8 tamamlandı — 2026-08-31.** Son teslim paketi Windows 11 x64 için tek dosyalı, self-contained `.exe` olarak üretildi; sentetik fixture exe içine gömüldü, kullanıcı verisi uygulamadan ayrı tutuldu ve kısa kullanım/yedekleme belgeleri eklendi. Kabul: 39/39 test, tek dosyalı paketin doğrudan gerçek Windows UI’da başlatılması ve paket içeriğinin denetimi. Bitiş kaydı: `docs/arsiv/faz8-bitis-raporu-openai-sol56.md`.

**Arayüz değişimi tamamlandı — 2026-08-31.** Kullanılabilirlik geri bildirimiyle WPF içerik yüzeyi React + React Flow kart akışına taşındı; WPF yalnızca yerel WebView2 kabuğu olarak kaldı. React dosyaları exe içine gömüldü, uygulama dizinine önbellek/varlık klasörü bırakmayan yeni tek dosyalı paket üretildi. Kabul: 40/40 otomatik test, yerel API + gömülü varlık entegrasyon testi, Windows UI ve yayın paketinin doğrudan açılış/kapanış doğrulaması.

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

**Durum: COMPLETE — build/test/publish kapısı geçti.**

**Yapılacaklar**
- C#/.NET çözüm yapısı kurulacak: `Metraj.Domain`, `Metraj.Application`, `Metraj.Infrastructure`, `Metraj.Desktop`, `Metraj.Tests`.
- WPF, MVVM ve SQLite altyapısı hazırlanacak.
- Nullable kontrolleri, statik analiz ve uyarıların hata sayılması etkinleştirilecek.
- Veritabanı migration altyapısı kurulacak.
- Otomatik derleme, test ve publish akışı hazırlanacak.
- PDF/Excel paket kararı kilitlendi: PDFsharp + MigraDoc ve ClosedXML. Faz 1'de lisans/NOTICE kaydı; Faz 6'da paketleme, Türkçe çıktı ve baskı testleri yapılacak.
- Self-contained Windows yayını erken aşamada denenecek.
- Temel mimari ve ajan çalışma belgeleri oluşturulacak.

**Faz sonu testleri**
- Temiz bir checkout üzerinden tek komutla restore, build ve test tamamlanacak.
- Domain katmanının WPF, SQLite ve rapor kütüphanelerine bağımlı olmadığı otomatik kontrol edilecek.
- Uygulama açılış/kapanış smoke testi geçecek.
- Boş veritabanı oluşturulup yeniden açılabilecek.
- İlk Windows publish çıktısı temiz bir test ortamında başlatılabilecek.

## Faz 2 — Domain modeli ve veritabanı

**Durum: COMPLETE — domain, şema, hesap çekirdeği, workspace servisleri ve UI smoke kapısı geçti.**

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

**Durum: COMPLETE — katalog sürümleme, proje yerleşimi, genişletilebilir sorumluluk ataması ve WPF yapılandırma kabul kapısı geçti.**

**Yapılacaklar**
- Kart oluşturma, arama, pasife alma ve seçili karttan immutable yeni sürüm oluşturma ekranları tamamlandı.
- Kart sürümünün adı da sürüm içinde saklanıyor; eski proje yerleşimleri yeni sürümden etkilenmiyor.
- Proje oluşturma/açma ve SQLite'a anlık kaydetme akışları tamamlandı.
- Katalogdan köke veya seçili dalın altına yerleştirme, dal çoğaltma ve yeniden açıldığında kararlı sıralama tamamlandı.
- Projeye özel görünen ad, tedarik kapsamı ve not değerleri; güvenli üst dala/köke taşıma işlemleri eklendi.
- Sorumluluk boyutu, taraf ve yerleşim-seviyesi atama ekranı eklendi.
- Geçersiz/eksik seçimler ve pasif kartla yeni yerleşim girişimleri açıklayıcı hata ile engelleniyor.
- Bu fazda canvas geliştirilmedi.

**Faz sonu testleri**
- Aynı kart sürümünün kökte/alt dallarda bağımsız yerleşimleri entegrasyon ve WPF smoke ile doğrulandı.
- Proje-özel değişikliklerin seçili yerleşimle sınırlı olduğu test edildi.
- Kart v2 oluşturulduğunda v1 ile yerleştirilmiş satırın adının ve sürüm kimliğinin korunduğu test edildi.
- Pasif kartın eski proje yerleşiminde görünmeye devam ettiği, yeni yerleşime eklenemediği WPF smoke ile doğrulandı.
- Dal taşıma/çoğaltma ve döngü engeli entegrasyon testiyle doğrulandı; ağaç uygulama yeniden açıldığında kalıcı olarak yüklendi.
- Sorumluluk boyutu, taraf ve atama gerçek Windows oturumunda oluşturulup listede doğrulandı.
- WPF kullanıcı akışları test edildi; test sırasında bulunan erişim, kesilen eylem alanı ve yenileme sonrası yanlış hata metni sorunları düzeltilip yeniden doğrulandı.

## Faz 4 — Temiz Su dikey dilimi

**Durum: COMPLETE — sentetik referans, hızlı kaynak girişi, hesap özeti, ilk raporlar ve WPF kabulü geçti.**

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
- Domain katmanının ayrılması gelecek ürün taahhüdü değil, hesap mantığını görsel arayüzden bağımsız tutan kalite kuralıdır.

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
