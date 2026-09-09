# Belgeler

Bu klasörde iki tür belge var ve **karıştırılmamalıdır**: bugünü anlatan
*yaşayan referanslar* ve o gün ne kararlaştırıldığını kaydeden *tarihsel
faz belgeleri*. Önceden hepsi yan yana duruyordu; hangisinin hâlâ geçerli
olduğunu ayırt etmenin bir yolu yoktu.

## Yaşayan referanslar

Bunlar güncel tutulur; bir şey değiştiğinde bunlar da değişir.

| Belge | Ne için |
|---|---|
| [derleme.md](derleme.md) | Temiz checkout'tan tek komutla derleme; araç sürümleri |
| [kullanim-ve-yedekleme-kilavuzu.md](kullanim-ve-yedekleme-kilavuzu.md) | Son kullanıcı: kurulum, günlük kullanım, yedekleme/geri yükleme |
| [domain-sozlugu.md](domain-sozlugu.md) | Alan terimleri ve aralarındaki ilişkiler |
| [teslim-notlari.md](teslim-notlari.md) | Paketleme ve teslim |
| [kod-inceleme-ux-oncelikli.md](kod-inceleme-ux-oncelikli.md) | Kullanıcı deneyimi önceliğine göre sıralanmış kod incelemesi |
| [uygulama-ilerleme.md](uygulama-ilerleme.md) | O incelemenin uygulanma durumu ve bölüm devir notları |

## Arşiv

[`arsiv/`](arsiv/) altındaki 26 belge Faz 0-8 boyunca üretilen kapanış
raporları, devir notları ve inceleme cevaplarıdır. Dosya adlarındaki
`-openai-sol56`, `-claude-opus5`, `-claude-sonnet5` ekleri o belgeyi
hangi ekibin yazdığını gösterir.

**Bunlar tarihsel kayıttır.** O gün alınan kararları ve gerekçelerini
anlamak için okunur; bugünkü davranışın kaynağı olarak değil. Kod ile
arşivdeki bir belge çelişiyorsa, doğru olan koddur.

## Doğrulama durumu

> **`SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`**

Bu nitelendirme **hâlâ geçerlidir ve korunmalıdır.** Uygulama, sentetik
Temiz Su referans veri paketiyle uçtan uca doğrulanmıştır; **gerçek bir
projenin gerçek verisiyle doğrulanmamıştır.** Kabul iddiaları bu sınırın
içinde okunmalıdır.

## Gerçekleşmemiş kapsam

Faz 0 teknik sözleşmesi, kodun tam olarak gerçekleştirmediği iki şeyi
tarif ediyor. Bunlar **açık boşluk** olarak korunuyor; temizlik sırasında
özellik ekleme davetiyesi değildir:

- **Tedarik havuzlaması.** `ProjectPlacement.NoPool` alanı yazılıyor ama
  hiçbir yerde okunmuyor; satın alma toplamaları havuzlama yapmıyor.
- **Arşivleme ve bazı durum geçişleri.** `ProjectRevisionStatus.Archived`,
  `ReportBehavior.Auxiliary/Reference`, `SemanticLinkType.ComponentOf` ve
  `CatalogCardVersion.IsPublished` tanımlı ama hiçbir yerde üretilmiyor.

İkisi de `src/Metraj.Domain/Model.cs` içinde "ERTELENMİŞ KAPSAM" notlarıyla
işaretlidir. Enum üyeleri veritabanına METİN olarak yazıldığı için
silinmediler: bir değeri kaldırmak, o metni taşıyan bir satırı okunamaz
hâle getirir.
