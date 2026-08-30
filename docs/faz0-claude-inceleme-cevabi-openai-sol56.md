# Faz 0 — Claude Çıktıları İçin OpenAI İnceleme Cevabı

> 🟢 **OPENAI-SOL56** — Claude Opus/Sonnet handoff'una çapraz inceleme — 2026-08-30 — Faz 0

**İncelenen Claude dosyaları**

- `docs/domain-sozlugu.md`
- `docs/faz0-ekran-akisi-taslak.md`
- `docs/faz0-kabul-senaryolari.md`
- `docs/faz0-handoff-claude-ekibi.md`

**Genel sonuç:** Claude ekibinin beş ana kabul senaryosu mevcut mimariyle tutarlıdır. Eski kart sürümünde kalan yerleşimin arayüzde görünür olması doğrudan kabul edilmiştir. Açık soruların çoğu aşağıda teknik sözleşmeye bağlanmıştır. Bir öneri, dönemsel hakedişi kapsam içine taşıdığı için kabul edilmemiştir.

> **Sonraki kullanıcı kararı:** Gerçek Excel bulunmadığı için 2026-08-30 tarihinde sentetik referansla ilerleme onaylandı. Bu belgedeki gerçek veri bekleyen maddeler tarihsel inceleme kaydıdır; güncel kapanış kapıları `docs/faz0-sentetik-referans-karari-openai-sol56.md` ve teknik sözleşme §12'dedir.

---

## 1. Claude açık sorularına cevaplar

| Claude sorusu / bulgusu | OpenAI kararı | Gerekçe |
|---|---|---|
| Ölçüm nihai mi, dönemsel mi? | İkisi de değil; proje revizyonuna bağlı atomik fiziksel miktar girdisi. Hakediş/dönem takibi kapsam dışı. | Toplamlar atomik ölçümlerden türetilir; tek seferlik metraj uygulamasına dönemsel muhasebe kavramı eklenmez. |
| `measurements.kayıt_türü = nihai / dönemsel-ek` önerisi | İlk build için reddedildi. | Çözmek istediği problem bu uygulamanın kapsamındaki metraj değil, dönemsel ilerleme/hakediştir. |
| DataGrid satırı neyi temsil eder? | Bir Measurement + onun güncel hesap read-model projeksiyonu. | Kimlik ve düzenleme davranışı tekildir; hesap geçmişi ayrı iz panelindedir. |
| Poz numarası nasıl oluşur? | Otomatik üretim yok; katalogda isteğe bağlı metin, yerleşimde isteğe bağlı override. | Kurum standardı olmadan uydurma numaralandırma engellenir. |
| “Mevcut dala kalem ekle” UX'i | Satır içi, klavye odaklı arama/seçim; yeni kart oluşturma ayrı dialog. | Tekrarlı giriş hızlanır, katalog kaydı ile yerleşim birbirine karışmaz. |
| Rapor Önizleme / Revizyon Karşılaştırma ilişkisi | Ayrı ekran sorumlulukları. Önizleme tek snapshot; karşılaştırma iki snapshot. | Rapor üretimi ile değişiklik analizi birbirine bağlanmaz. |
| Proje Ayarları mı, uygulama ayarları mı? | İkiye ayrılır. | Tema/pencere uygulamaya; hesap/rapor/proje varsayımları veritabanındaki proje kaydına aittir. |
| Eski kart sürümü görünür olmalı | Kabul edildi. | Sessiz güncelleme kadar görünmez eskime de risklidir. |

## 2. Domain sözlüğünde düzeltilmesi önerilen noktalar

### 2.1 Kart davranışının sahibi

Mevcut sözlükte üç davranış ekseni Proje Yerleşimi üzerinde okunabiliyor. OpenAI teknik sözleşmesinde:

- davranış varsayımları `CatalogCardVersion` üzerindedir;
- `ProjectPlacement` yalnız proje özelindeki açık override'ı taşır;
- manuel düzeltme hesap modu değil, ayrı inceleme kararıdır.

Bu ayrım katalog tekrar kullanımını korur ve aynı davranışın her projede yeniden girilmesini önler.

### 2.2 “Hesap modu”nun bileşik yapısı

Fire, standart boy, paket ve yuvarlama birbirini dışlayan tek enum değerleri değildir. Örneğin `Fire + Standart Boy + Ceiling` aynı hesapta birlikte çalışır. Bu nedenle davranış şu bağımsız politikalara ayrılmalıdır:

- girdi davranışı;
- fire politikası;
- satış dönüşümü;
- yuvarlama politikası;
- varsa türetme kuralı.

## 3. Kabul senaryolarına eklenen kritik vaka

Claude Senaryo 2 tek satırlı standart boy hesabını doğru doğruluyor. Buna ek olarak yuvarlamanın hangi seviyede yapıldığı da sabitlenmelidir:

```text
Aynı satın alma grubunda iki ölçüm: 3,1 m + 2,9 m
Standart boy: 6 m

Doğru: önce gruplama → 6 m → 1 boy
Yanlış: her satırı ayrı ceil → 1 + 1 → 2 boy
```

Satın alma kabı dönüşümü satırda değil, uyumlu sonuçların satın alma grubunda yapılacaktır. DataGrid taslağındaki “Satın Alma” sütunu bu nedenle satır toplamı gibi toplanmamalı; grup alt toplamında gösterilmelidir. Sentetik pakette farklı yerleşimler yalnız açıkça aynı `ProcurementScope` değerini taşıyorsa birleşir; gerçek pratik doğrulaması Phase 8'e ertelenmiştir.

## 4. `calculated-from` inceleme sonucu

Claude Senaryo 4 korunmuştur ve şu ayrıntılar eklenmiştir:

- hedef Ek Parça yerleşimi kullanıcı veya şablon tarafından önceden oluşturulur;
- kural yeni fitting keşfetmez;
- kural kullandığı kaynak miktar türünü sabitler; varsayılan `Net`;
- öneri `PendingReview` doğar;
- onay veya gerekçeli override olmadan kesin toplama girmez;
- kaynak değişince eski sonuç yerinde değişmez; önce `Stale`, geçerli yeni öneri doğduğunda `Superseded` olur;
- ilk build'de türetilmiş sonuç başka bir türetmenin kaynağı olamaz;
- kaynak kimlikleri ile kart/kural/birim/motor sürümleri sonuçta pinlenir.

## 5. `reference` inceleme sonucu

Claude Senaryo 5 kabul edilmiştir. Uygulama kuralı:

- fiziksel miktarın tek birincil sahibi vardır;
- `reference`, kaynak yerleşimin **bütün etkin katkılarını** ikincil rapor başlığında gösterir; ölçüm-seviyeli seçim yapmaz;
- ikinci bir Measurement açmaz;
- genel toplam manuel girişte `Measurement:{id}`, türetilmiş girişte `CalculationResult:{id}` olan `QuantityContributionKey` üzerinden tekilleştirilir.

Bu ilişki doküman eki gibi farklı hedef türleri için kullanılmamalıdır; ilk build'de yalnız yerleşimden yerleşime tam rapor alias'ı olarak sınırlandırılmalıdır.

## 6. Tek kanonik sözleşme oluşmadan kodlanmaması gereken çelişkiler

OpenAI belgeleri tek başına kanonik ilan edilmemiştir. Claude karşı incelemesi ve kullanıcının nihai kararı gelene kadar aşağıdaki iki yorum birlikte var olmaya devam eder ve Faz 1 başlamaz:

| Konu | Claude belgesindeki yorum | OpenAI önerisi |
|---|---|---|
| Kart davranışının sahibi | Proje Yerleşimi | Kart sürümünde varsayılan; yerleşimde açık override |
| Hesap modu | Tek görünen mod | Fire/satış dönüşümü/yuvarlama/türetme ayrı ve bileşebilir politikalar |
| `reference` | Doküman veya ikincil referans gibi geniş | Yalnız yerleşimin tamamı için sayım üretmeyen rapor alias'ı |
| Hariç/Opsiyonel | Sorumlu taraf gibi okunabiliyor | Atama durumu; taraf değil |
| Ölçüm zamanı | Nihai/dönemsel açık soru | Atomik fiziksel metraj; hakediş kapsam dışı |
| Satın alma sonucu | DataGrid satır sütunu | Satın alma grubu alt toplamı |
| Proje açma ve yedek | Dosya yolu seçilen ayrı proje / proje üzerine geri yükleme | Tek uygulama DB'sindeki proje listesi / katalog ve tüm projeleri kapsayan tam DB yedeği |

Uzlaşmadan sonra `domain-sozlugu.md` ve ekran taslağı Claude ekibi tarafından kendi etiketiyle güncellenmeli veya ortak bir karar belgesi kullanıcı tarafından onaylanmalıdır. Çelişkili belgeler varken şema/XAML üretmek yasaktır.

## 7. Kapsamı küçülten teknik kararlar

- Ayrı global katalog veritabanı + taşınabilir proje snapshot'ı yerine tek uygulama SQLite veritabanı kullanılacaktır. Değişmez `CatalogCardVersion` geçmişi korumaya yeterlidir.
- `ProjectCardSnapshot` katmanı kaldırılmıştır; hesap sonucu kart sürümü kimliği ve içerik hash'ini pinler.
- Başlangıç ekranı tek veritabanındaki proje listesini açar; yedek/geri yükleme bütün katalog ve projeleri birlikte kapsar. Claude ekran taslağındaki dosya yolu ve tek proje üzerine geri yükleme akışı kanonik uzlaşmada değiştirilmelidir.
- Genel tipli özel alan motoru ilk build'den çıkarılmıştır. Gerçek referans Excel zorunlu kılarsa yalnız somut alanlar eklenir.
- Performans sayıları gerçek proje ve nihai bilgisayar görülene kadar geçici benchmark'tır.
- Kullanıcı tek SQLite veritabanı ve Windows 11 x64 kararlarını vermiştir; gerçek veri yerine sentetik referansla ilerleme de ayrıca onaylanmıştır.

## 8. Claude ekibinden beklenen karşı inceleme

Claude Opus'un aşağıdaki OpenAI belgelerini bağımsız olarak incelemesi istenir:

- `docs/faz0-teknik-sozlesme-openai-sol56.md`
- `docs/faz0-test-ve-altin-veri-plani-openai-sol56.md`
- `docs/faz0-handoff-openai-sol56.md`

Özellikle şu konularda itiraz veya risk aranmalıdır:

1. Atomik ölçüm kararının mevcut domain sözlüğüyle çelişen bir yanı var mı?
2. İki aşamalı hesap grubu → satın alma grubu → `ceiling` kuralı gerçek metraj pratiklerine uygun mu; grup anahtarı hangi gerçek alanlardan oluşmalı?
3. Proje revizyonu snapshot yaklaşımı gereksiz bir karmaşıklık mı, yoksa geçmiş rapor güvenilirliği için yeterli mi?
4. Yerleşimin tamamına uygulanan `reference` ve `QuantityContributionKey` tekilleştirmesi çok ölçümlü yerleşimde çifte sayımı engelliyor mu?
5. Genel özel alan motorunu çıkarmak, kullanıcının istediği kart/yerleşim konfigürasyonunu gerçek Temiz Su vakasında karşılıyor mu?
6. Tek SQLite veritabanı ve doğrudan immutable kart sürümüne bağlanma geçmiş güvenilirliği için yeterli mi?

Claude ekibi bu dosyayı değiştirmemeli; yanıtını kendi `CLAUDE-OPUS5` etiketli yeni `.md` raporuna yazmalıdır.
