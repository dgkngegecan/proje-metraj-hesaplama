# Faz 0 — Ekran Akışı Taslağı

> 🔵 **CLAUDE EKİBİ** — Sonnet (destek görevi) — 2026-08-30 — Faz 0

> **Durum: TASLAK.** Bu belge kod/XAML değildir; Faz 3 ve Faz 4'te uygulanacak ekranların
> erken bir "sözleşmesi"dir. Amaç, ROADMAP.md'deki 14 kilitli karar ile tutarlı bir ekran
> envanteri ve akış üzerinde hizalanmaktır. Burada listelenen alan/sütun/eylem adları
> bağlayıcı değildir; Faz 2 (domain modeli) netleştikçe ve Faz 3/4 uygulama sırasında
> değişebilir. Görsel tasarım (renk, spacing, XAML stil) bu taslağın konusu değildir.

---

## 1. Ekran Listesi

### 1.1 Başlangıç — Proje Aç / Oluştur
- **Amaç:** Uygulama açıldığında kullanıcının mevcut bir proje dosyasını (SQLite) açmasını
  veya yeni bir proje oluşturmasını sağlamak. Uygulamanın tek giriş kapısıdır.
- **Ana bileşenler:**
  - Orta alan: "Son açılan projeler" listesi (dosya yolu, son değiştirme tarihi).
  - Üst/araç çubuğu: "Yeni Proje", "Proje Aç (dosyadan)", "Örnek Proje" (Faz 8'de eklenecek).
  - Alt bilgi çubuğu: uygulama sürümü, şema/migration sürümü.
- **Desteklenen eylemler:**
  - Yeni proje oluşturma (isim, kayıt konumu seçimi).
  - Var olan `.db`/proje dosyasını açma.
  - Bozuk/uyumsuz şema durumunda hata mesajı gösterme (Faz 7 kapsamı, ama ekran burada
    hata durumunu barındırır).
  - Son projeler listesinden hızlı açma.

### 1.2 Katalog Yönetimi (kütüphane)
- **Amaç:** Projeden bağımsız, tekrar kullanılabilir kart tanımlarını (Kategori, Kapsam,
  Sistem, Malzeme, Ek Parça) oluşturmak, düzenlemek, aramak, pasife almak. Katalog kartı ile
  proje yerleşimi burada net biçimde ayrışır — bu ekranda **hiçbir ölçüm veya proje-özel
  değer yoktur**.
- **Ana bileşenler:**
  - Sol panel: kart tipine göre filtre (Kategori/Kapsam/Sistem/Malzeme/Ek Parça) + arama
    kutusu + "yalnızca aktif kartlar" anahtarı.
  - Orta panel: kart listesi (tablo) — kart adı, tür, kalem türü, hesap modu, rapor
    davranışı, sürüm no, durum (aktif/pasif).
  - Sağ panel: seçili kartın düzenleme formu — temel alanlar (ad, birim, kalem türü, hesap
    modu, rapor davranışı) + "yeni sürüm oluştur" uyarısı (değişiklik yeni kart sürümü
    doğurur, eski sürümü kullanan projeler etkilenmez).
- **Desteklenen eylemler:**
  - Kart oluşturma / düzenleme / pasife alma (silme yok — pasif kartlar eski projelerde
    görünmeye devam eder).
  - Kart tipine göre 3 eksenin (kalem türü, hesap modu, rapor davranışı) atanması.
  - Arama ve filtreleme.
  - Kart sürüm geçmişini görüntüleme (salt okunur liste).

### 1.3 Ana Çalışma Ekranı — Proje Ağacı + Metraj Tablosu (KRİTİK EKRAN)
- **Amaç:** Kullanıcının günlük çalışmasının merkezi. Proje yerleşim ağacını gezme, ölçüm
  girme/düzenleme, hesap sonuçlarını ve izini görme. Bu ekranın detaylı taslağı §3'tedir.
- **Ana bileşenler (üç panel):**
  - Sol panel: proje ağacı (tek ebeveynli, WPF TreeView) + filtreler.
  - Orta panel: Excel benzeri DataGrid — seçili ağaç dalına ait metraj/ölçüm satırları.
  - Sağ panel: seçili satırın detayı ve hesap izi (calculated-from zinciri, kural sürümü,
    ara değerler).
- **Desteklenen eylemler:** §3'te detaylandırılıyor (ölçüm ekleme/düzenleme/çoğaltma, hızlı
  kalem ekleme, klavye ile gezinme, Excel yapıştırma, filtreleme, toplu düzenleme).

### 1.4 Katalogdan Projeye Yerleştirme (dialog / yan panel)
- **Amaç:** Ana ekrandaki ağaçta seçili bir dala, katalogdan kart seçip yerleştirmek.
  Bağımsız bir tam ekran değil, Ana Ekran'dan açılan modal/yan panel olarak düşünülüyor;
  ayrı madde olarak listelenmesinin sebebi kendine has bir akışı olması (arama → seçim →
  yerleştirme onayı).
- **Ana bileşenler:**
  - Arama/filtre kutusu (katalogdakiyle aynı mantık, salt aktif kartlar).
  - Kart önizleme (ad, tür, birim, varsayılan hesap modu).
  - Hedef dal göstergesi ("şuraya eklenecek: ... > ... > ...").
- **Desteklenen eylemler:**
  - Kart arama/seçme, hedef dala yerleştirme, projeye özel değer override etme (katalog
    kartının kendisini değiştirmeden).
  - Çoklu seçim ile birden fazla kartı aynı dala art arda ekleme.

### 1.5 Sorumluluk Boyutu Tanımlama ve Atama
- **Amaç:** Genişletilebilir sorumluluk boyutlarını (temin/montaj/izolasyon/test/nakliye/...)
  tanımlamak ve bunları proje ağacındaki dallara veya doğrudan metraj kalemlerine atamak.
- **Ana bileşenler:**
  - Sol panel: tanımlı sorumluluk boyutları listesi (ekle/yeniden adlandır/pasife al).
  - Orta panel: seçili boyut için atama matrisi — ağaç dalı/kalem × sorumlu taraf.
  - Sağ panel: kalıtım özeti ("bu değer üst daldan miras alındı" / "bu dalda override
    edildi") — Faz 5 kapsamındaki kalıtım kurallarının UI karşılığı.
- **Desteklenen eylemler:**
  - Yeni sorumluluk boyutu tanımlama.
  - Dal bazında veya kalem bazında atama, açık override.
  - Kalıtım zincirini görüntüleme.

### 1.6 Hesap İzi Detayı (dialog)
- **Amaç:** Ana ekranın sağ panelindeki özet hesap izinin genişletilmiş, tam ekran/dialog
  hâli. Karmaşık `calculated-from` zincirlerini (örn. Ek Parça'nın kaynak kalemden türetilen
  "Kontrol bekliyor" miktarı) adım adım incelemek için.
- **Ana bileşenler:**
  - Adım listesi: Girdi → Birim normalizasyonu → Net miktar → Fire → Satış birimine
    dönüşüm → Yuvarlama → Satın alma miktarı → Artan miktar → Manuel düzeltme (Faz 5'teki
    sabit hesap sırası).
  - Her adımda: kullanılan kural sürümü, ara değer, kaynak ölçüm referansı.
  - Manuel düzeltme alanı: değer + zorunlu gerekçe metni.
- **Desteklenen eylemler:**
  - Hesap adımlarını inceleme (salt okunur).
  - "Kontrol bekliyor" sonucu kabul etme veya gerekçeli manuel değiştirme.
  - Kaynak ölçüme gitme (ana ekranda ilgili satırı seçili hale getirme).

### 1.7 Revizyon Yönetimi ve Karşılaştırma
- **Amaç:** Proje revizyonlarını yönetmek (yeni revizyon açma, revizyonu onaylayıp
  kilitleme) ve iki revizyon arasındaki farkları görüntülemek.
- **Ana bileşenler:**
  - Üst çubuk: revizyon seçici (aktif revizyon + karşılaştırılacak revizyon).
  - Orta panel: fark tablosu — değişen/eklenen/silinen ölçümler ve hesap sonuçları,
    yeşil/kırmızı/sarı ile eklenen/çıkarılan/değişen ayrımı.
  - Alt bilgi: onay durumu ve kilit bilgisi (onaylı revizyon değiştirilemez).
- **Desteklenen eylemler:**
  - Yeni revizyon açma, mevcut revizyonu onaylayıp kilitleme.
  - İki revizyon arasında fark görüntüleme (rapor değil, ekran içi önizleme).
  - Kilitli revizyonda düzenlemenin engellendiğini gösterme.

### 1.8 Rapor Önizleme ve Üretim
- **Amaç:** Ortak rapor modelinden PDF/Excel çıktısı üretmeden önce önizlemek, rapor
  tipini ve kapsamını (hangi dal/revizyon) seçmek.
- **Ana bileşenler:**
  - Sol panel: rapor tipi listesi (Detay metraj, Sistem/Kategori özeti, Kat/Mahal raporu,
    Sorumluluk özeti, Satın alma listesi, Eksik ve kontrol raporu).
  - Orta panel: canlı önizleme (sayfalanmış, renk+doku kodlu — ton=sistem türü,
    doku=sorumluluk).
  - Sağ panel: rapor parametreleri (kapsam/dal filtresi, revizyon seçimi, dahil edilecek
    sütunlar, poz numarası gösterimi).
- **Desteklenen eylemler:**
  - Rapor tipi ve kapsam seçme.
  - Önizleme, PDF/Excel olarak dışa aktarma.
  - "Kontrol bekliyor" durumundaki kalemleri raporda vurgulama/hariç tutma seçeneği.

### 1.9 Yedekleme / Geri Yükleme
- **Amaç:** Faz 7 kapsamındaki otomatik yedekleme ve manuel geri yükleme akışlarının
  kullanıcı arayüzü.
- **Ana bileşenler:**
  - Yedek listesi (tarih, boyut, otomatik/manuel etiketi).
  - "Şimdi yedekle" eylemi.
  - Geri yükleme onay diyaloğu (mevcut projenin üzerine yazılacağı açık uyarı).
- **Desteklenen eylemler:**
  - Manuel yedek alma, otomatik yedek sıklığını görüntüleme (ayar değişikliği Ayarlar
    ekranında olabilir).
  - Bir yedekten geri yükleme, geri yükleme öncesi mevcut durumun snapshot'ının alınması.

### 1.10 Proje Ayarları
- **Amaç:** Proje düzeyindeki politika ayarlarını (birim politikası sürümü, varsayılan
  fire kuralları, yuvarlama kuralları) görüntülemek ve — sürüm oluşturma disiplini
  içinde — değiştirmek.
- **Ana bileşenler:**
  - Sekmeli/gruplu form: Birim politikası, Fire/Paket/Standart boy varsayılanları,
    Yedekleme sıklığı, Uygulama tercihleri (dil, tarih/ondalık biçimi — Türkçe Windows
    uyumu Faz 8 testi).
- **Desteklenen eylemler:**
  - Politika görüntüleme/değiştirme (değişikliğin geçmiş hesapları etkilemediği net
    biçimde belirtilir — Faz 5 kuralı: "kart veya kural güncellendiğinde geçmiş hesap
    değişmeyecek").

---

## 2. Ekranlar Arası Geçiş Akışı

```
[Proje Aç / Oluştur] ──(yeni proje / proje aç)──▶ [Ana Ekran: Ağaç + Metraj Tablosu]
        ▲                                                  │
        │                                                  ├──(menü: Katalog Yönetimi)──▶ [Katalog Yönetimi]
        │                                                  │         │
        │                                                  │         └──(geri dön)────────┘
        │                                                  │
        │                                                  ├──(ağaçta sağ tık / araç çubuğu: "Kart Ekle")
        │                                                  │         ▼
        │                                                  │   [Katalogdan Projeye Yerleştirme] ──(yerleştir / iptal)──▶ (Ana Ekran'a döner)
        │                                                  │
        │                                                  ├──(menü: Sorumluluk Atama)──▶ [Sorumluluk Boyutu Tanımlama/Atama] ──(kaydet/kapat)──▶ (Ana Ekran)
        │                                                  │
        │                                                  ├──(sağ panelde "Hesap İzini Genişlet")──▶ [Hesap İzi Detayı] ──(kapat / kaynağa git)──▶ (Ana Ekran, ilgili satır seçili)
        │                                                  │
        │                                                  ├──(menü: Revizyonlar)──▶ [Revizyon Yönetimi ve Karşılaştırma] ──(kapat)──▶ (Ana Ekran)
        │                                                  │
        │                                                  ├──(menü/araç çubuğu: Rapor Al)──▶ [Rapor Önizleme ve Üretim] ──(PDF/Excel üret veya kapat)──▶ (Ana Ekran)
        │                                                  │
        │                                                  ├──(menü: Yedekle/Geri Yükle)──▶ [Yedekleme / Geri Yükleme]
        │                                                  │         │
        │                                                  │         └──(geri yükle → onay)──▶ proje yeniden yüklenir ──▶ (Ana Ekran, yenilenmiş veriyle)
        │                                                  │
        │                                                  └──(menü: Ayarlar)──▶ [Proje Ayarları] ──(kaydet/kapat)──▶ (Ana Ekran)
        │
        └──(Ana Ekran'da "Projeyi Kapat" / "Farklı Proje Aç")───────────────────────────────────┘
```

**Notlar:**
- Ana Ekran, "ev" (home) ekranıdır — diğer tüm ekranlar (1.4–1.10) buradan açılır ve
  buraya döner. Bu, tek ebeveynli ağaç + tek DataGrid etrafında kurulan iş akışını
  yansıtır.
- Katalog Yönetimi hem bağımsız bir üst menü öğesi hem de dolaylı olarak Katalogdan
  Projeye Yerleştirme ekranının "veri kaynağı"dır; ama iki ekran birbirinden ayrıdır —
  biri kart tanımlar, diğeri var olan tanımları bir dala bağlar (karar 3 ile tutarlı).
- Hesap İzi Detayı ve Katalogdan Projeye Yerleştirme, "geri dönüş" davranışı olan
  modallerdir; Ana Ekran'ın durumunu (seçili dal, seçili satır, filtreler) korur.
- Revizyon Yönetimi'nden Rapor Önizleme'ye doğrudan bir kısayol da düşünülebilir
  ("bu revizyonu raporla") — Faz 3/4'te değerlendirilecek, bu taslakta zorunlu değil.

---

## 3. Ana Metraj Çalışma Ekranı — Detaylı Taslak

Bu, uygulamanın en kritik ekranıdır (ROADMAP Faz 4). Üç panelli düzen:

```
┌───────────────────┬──────────────────────────────────────────────┬────────────────────┐
│  SOL PANEL         │  ORTA PANEL                                    │  SAĞ PANEL          │
│  Proje Ağacı        │  Metraj DataGrid                               │  Detay / Hesap İzi   │
│  + Filtreler        │                                                 │                     │
└───────────────────┴──────────────────────────────────────────────┴────────────────────┘
```

### 3.1 Sol Panel — Ağaç + Filtreler
- **Ağaç (TreeView):** Kategori → Kapsam → Sistem → Malzeme/Ek Parça hiyerarşisi, tek
  ebeveynli. Düğüm ikonları kart tipine göre (5 tip). Sürükle-bırak ile taşıma, sağ tık
  menüsünde: "Kart Ekle" (→ 1.4), "Dalı Çoğalt", "Yeniden Adlandır (proje-özel)", "Sil
  (yalnızca yerleşim, katalog kartı etkilenmez)".
- **Filtreler (ağacın üstünde, sabit):**
  - Blok / Kat / Mahal / Zon / Şaft / Hat No / Pafta (çoklu seçim dropdown'ları).
  - Revizyon seçici.
  - Sorumluluk boyutu filtresi (örn. yalnızca "montaj: Firma X" olan kalemler).
  - "Yalnızca Kontrol Bekleyenler" hızlı anahtarı.
  - Metin arama kutusu (kart adı / poz no).
- **Davranış:** Ağaçta bir dal seçildiğinde orta paneldeki DataGrid, o dala (ve varsayılan
  olarak alt dallarına) ait ölçüm satırlarıyla filtrelenir. Aktif filtreler DataGrid
  başlığında özet olarak gösterilir ("12 filtre aktif" gibi).

### 3.2 Orta Panel — Metraj DataGrid (Excel benzeri)
**Önerilen sütunlar (soldan sağa):**

| # | Sütun | Açıklama |
|---|-------|----------|
| 1 | Poz No | Otomatik/atanabilir poz numarası |
| 2 | Kart Adı | Seçili malzeme/sistem/ek parça adı (salt okunur, katalogdan gelir) |
| 3 | Tür İkonu | Kart tipi (Kategori/Kapsam/Sistem/Malzeme/Ek Parça) küçük simge |
| 4 | Blok | Ölçüm bağlamı |
| 5 | Kat | Ölçüm bağlamı |
| 6 | Mahal | Ölçüm bağlamı |
| 7 | Zon/Hat No | Ölçüm bağlamı |
| 8 | Şaft | Ölçüm bağlamı (varsa) |
| 9 | Pafta | Ölçüm bağlamı |
| 10 | Birim | Kart biriminden gelir (salt okunur) |
| 11 | Net Miktar | Girilen/hesaplanan net miktar |
| 12 | Fire % | Hesap modu "Fire" ise düzenlenebilir |
| 13 | Fireli Miktar | Hesap sonucu (salt okunur, hesap izine bağlı) |
| 14 | Satış Birimi/Paket | Standart Boy / Paket modlarında görünür |
| 15 | Satın Alma Miktarı | Hesap sonucu (salt okunur) |
| 16 | Hesap Modu | Doğrudan / Fire / Standart Boy / Paket / Sabit Çarpan / Yuvarlama / Yapıldı-Yapılmadı / Manuel Düzeltme |
| 17 | Durum | Onaylı / **Kontrol Bekliyor** / Manuel Düzeltildi |
| 18 | Sorumluluk | Kısa etiket/chip listesi (temin, montaj, izolasyon, test, nakliye...) |
| 19 | Revizyon | Kalemin ait olduğu revizyon |
| 20 | Not | Serbest metin |

Not: "Kart Adı, Birim, Hesap Modu" gibi katalogdan gelen alanlar DataGrid'de salt okunur
gösterilir; yalnızca "projeye özel değer override" açıkça işaretlenmiş hücrelerde
düzenlenebilir (karar 3 ile tutarlı — katalog kartı sessizce değişmez).

**Hızlı eylemler ve klavye akışı:**
- **Tab / Shift+Tab:** hücreler arası soldan sağa/sağdan sola gezinme, satır sonunda bir
  sonraki satırın ilk düzenlenebilir hücresine geçiş.
- **Enter:** hücreyi onaylar, bir alt satırın aynı sütununa geçer (Excel alışkanlığı).
- **Ctrl+Enter (veya araç çubuğunda "Kalem Ekle" düğmesi):** "mevcut dala kalem ekle"
  komutu — kullanıcı tablodan çıkmadan, o an seçili ağaç dalına yeni bir metraj satırı
  ekler (yeni satır, aynı Blok/Kat/Mahal bağlamını bir önceki satırdan devralır, kart adı
  hücresi odakla açılır — hızlı kart arama/seçim inline dropdown). Bu komut hem klavye
  kısayolu hem de DataGrid'in altında sabit bir "+ Kalem Ekle" satırı/düğmesi olarak
  durur.
- **Ctrl+D:** seçili satırı çoğalt (aynı bağlamla, miktar sıfırlanır veya kullanıcı
  girer).
- **Ctrl+V (Excel'den yapıştırma):** panodaki sekmeli veriyi seçili hücreden başlayarak
  çoklu satır/sütuna dağıtır; birim/tip uyumsuzluğunda satır kırmızı işaretlenir ve
  "Eksik ve Kontrol" filtresine düşer.
- **Sağ tık menüsü:** "Hesap İzini Aç" (→ 1.6), "Sorumluluk Ata" (→ 1.5, satır bağlamıyla
  açılır), "Satırı Sil", "Revizyon Geçmişini Gör".
- **Alt bilgi çubuğu (grid altında):** seçili/filtrelenmiş satırların toplamı (Net,
  Fireli, Satın Alma) — filtre değiştikçe canlı güncellenir (Faz 4 kabul testi: "Filtreli
  ve filtresiz toplamlar doğru kalacak").

### 3.3 Sağ Panel — Detay / Hesap İzi
- **Üst blok:** seçili satırın kart bilgisi özeti (ad, kart sürümü, kalem türü, rapor
  davranışı).
- **Orta blok — Hesap izi özeti (kısaltılmış):** sabit hesap sırasının adımlarından
  yalnızca dolu olanlar, tek satırlık özet halinde ("Net 12,5 m → Fire %5 → 13,13 m →
  Standart Boy 6m → 3 adet"). "Detayı Aç" bağlantısı → 1.6 Hesap İzi Detayı dialogunu
  açar.
- **Alt blok — Sorumluluk özeti:** satıra atanmış sorumluluk boyutları ve değerleri,
  kalıtım kaynağı ("üst dal: Sistem > Temiz Su'dan miras") ile birlikte; "Düzenle"
  bağlantısı → 1.5'i satır bağlamıyla açar.
- **Durum rozetlerinin (Kontrol Bekliyor / Onaylı / Manuel Düzeltildi) burada da tekrar
  gösterilmesi:** kullanıcı satırı seçtiğinde grid'e geri dönmeden durumu görsün diye.

### 3.4 Tasarım gerekçesi (kısa)
- Sol panel filtreleri ölçüm bağlamı alanlarıyla (Blok/Kat/Mahal/Zon/Şaft/Hat No/Pafta)
  birebir örtüşüyor — karar 8 ile tutarlı.
- Orta panelin salt okunur/düzenlenebilir hücre ayrımı, katalog kartı ile proje
  yerleşiminin ayrı tutulması kararını (karar 3) UI seviyesinde yansıtıyor.
- "Kontrol Bekliyor" durumu hem sütun hem sağ panelde tekrar ediyor çünkü Ek Parça
  otomatik öneri mekanizması (kapsam kontrol kapılarındaki 6 adımlı mekanizma) kullanıcı
  onayı gerektiriyor ve bunun gözden kaçmaması gerekiyor.

---

## 4. Bu Taslağın Kapsamı ve Sınırları

- Bu belge **kod, XAML veya kesin UI spesifikasyonu değildir**. Faz 0 destek görevi
  kapsamında hazırlanmış, ekranların ne olduğunu ve aralarındaki geçişleri betimleyen
  **erken bir sözleşme** taslağıdır.
- Faz 2'de domain modeli (kart, sürüm, yerleşim, ölçüm, sorumluluk ilişkileri) netleştikçe
  bu taslaktaki alan/sütun adları değişebilir.
- Faz 3'te önce Katalog + Proje Yapılandırması ekranları (1.1, 1.2, 1.4, 1.5) uygulanacak;
  Ana Metraj Çalışma Ekranı (1.3, §3) Faz 4'te Temiz Su dikey dilimiyle birlikte hayata
  geçecek. Rapor (1.8) Faz 6'da, Revizyon (1.7) Faz 6'da, Yedekleme (1.9) Faz 7'de
  netleşecek.
- Canvas (kilitli karar 12 gereği) bu taslakta yer almıyor; sol panel yalnızca TreeView
  olarak tasarlandı.

---

## 5. Açık Noktalar / Belirsizlikler (çağıran ajana not)

Aşağıdaki noktalar ROADMAP.md'de doğrudan cevaplanmamış, bu taslak sırasında varsayımla
doldurulmuştur — Faz 2/3 planlamasında netleştirilmesi önerilir:

1. **Poz numarası üretimi:** Otomatik mi atanıyor, kullanıcı elle mi giriyor, yoksa
   rapor üretimi sırasında mı hesaplanıyor? Taslakta DataGrid'de bir sütun olarak
   varsayıldı ama kaynağı ROADMAP'te tanımlı değil.
2. **"Mevcut dala kalem ekle" komutunun tam kapsamı:** ROADMAP "tablodan çıkmadan"
   diyor ama yeni satırın kart seçimini nasıl yapacağı (inline arama mı, mini modal mı)
   belirtilmemiş; taslakta inline dropdown varsayıldı.
3. **Ölçüm ile metraj satırı ilişkisi:** ROADMAP "aynı malzeme birden fazla ölçüme
   sahip olabilir" diyor; DataGrid'de her satırın bir ölçüme mi yoksa bir
   ölçüm+hesap sonucu birleşimine mi karşılık geldiği domain modeli netleşmeden tam
   emin değiliz. Bu taslakta 1 satır = 1 ölçüm + o ölçümün hesap sonucu varsayıldı.
4. **Rapor Önizleme ile Revizyon Karşılaştırma arasındaki ilişki:** ayrı ekranlar
   olarak modellendi ama Faz 6'da "üretilen raporun kullandığı revizyon ve hesap
   sonuçları kaydedilecek" maddesiyle nasıl bütünleşeceği netleştirilmeli.
5. **Ayarlar ekranının proje-düzeyi mi yoksa uygulama-düzeyi mi olduğu:** taslakta
   proje-özel varsayıldı (birim politikası sürümü proje ile taşınıyor gibi göründüğü
   için), ancak uygulama genelinde bir "varsayılan tercihler" ekranına da ihtiyaç
   olabilir — ROADMAP bunu ayırmıyor.
