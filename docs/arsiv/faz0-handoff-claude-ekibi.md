# Faz 0 Handoff — Claude Ekibi

> 🔵 **CLAUDE EKİBİ** — Opus (yönetici) — 2026-08-30 — Faz 0

**Amaç**
Faz 0'ın Claude ekibine düşen kısmını üretmek: domain sözlüğü, kapsam netliği, açık domain sorularının işaretlenmesi, ve temel ekran akışı taslağı (Sonnet, destek).

**Değiştirilen / oluşturulan dosyalar**
- `ROADMAP.md` — önceki turlarda zaten kilitlendi (14 madde + 9 fazlık plan + kapsam kontrol kapıları). Bu handoff'ta değiştirilmedi, referans alındı.
- `docs/domain-sozlugu.md` — yeni. 16 terimin tanımı (katalog, proje, ilişki, hesap, sorumluluk, meta katmanları).
- `docs/arsiv/faz0-ekran-akisi-taslak.md` — Sonnet tarafından tamamlandı. 10 ekran tanımlandı (Proje Aç/Oluştur, Katalog Yönetimi, Ana Çalışma Ekranı, Katalogdan Yerleştirme, Sorumluluk Atama, Hesap İzi Detayı, Revizyon Yönetimi, Rapor Önizleme, Yedekleme/Geri Yükleme, Proje Ayarları). Ana metraj DataGrid'i için 20 sütunluk somut bir taslak var.

**Uygulanan domain kuralları**
Yeni bir kural üretilmedi — mevcut kilitlenmiş kararlar (`ROADMAP.md`) sözlükte tutarlı biçimde tanımlara döküldü. Tek istisna: "Kontrol bekliyor" ve "otomatik fitting üretimi kapsam dışı" ayrımı sözlükte açıkça birbirinden ayrıldı (önceki bir netleştirme turunun sonucu).

**Çalıştırılan testler**
Yok — bu faz kod üretmiyor, sadece dokümantasyon. Test edilebilir bir şey yok.

**Bilinen riskler / açık domain soruları**
1. **(Opus, domain seviyesi)** `domain-sozlugu.md`'de işaretlendi: Ölçüm kaydı nihai/toplam miktarı mı temsil ediyor, yoksa dönemsel/kısmi hakediş ilerlemesini mi? Şu anki model bunu ayırt etmiyor. Faz 2'de `measurements` şeması kilitlenmeden önce GPT Sol ile birlikte karara bağlanmalı.
2. **(Sonnet, ekran seviyesi, `faz0-ekran-akisi-taslak.md` §5)** Beş küçük belirsizlik: poz numarasının nasıl üretileceği tanımsız; "mevcut dala kalem ekle" komutunun tam UX'i (inline arama mı, mini modal mı) belirsiz; bir DataGrid satırının 1 ölçüme mi yoksa ölçüm+hesap sonucu birleşimine mi karşılık geldiği net değil (madde 1'le doğrudan bağlantılı — aynı kökten); Rapor Önizleme ile Revizyon Karşılaştırma ekranlarının Faz 6 entegrasyonu belirsiz; Proje Ayarları'nın proje mi uygulama düzeyinde mi olduğu ayrılmamış. Faz 2/3'te netleştirilmeli, şimdilik varsayımla ilerlendi.
3. **(Opus, `faz0-kabul-senaryolari.md`)** Yedi kabul senaryosu gerçek sayılarla yürütüldü. Beşi (1,2,4,5,6) modeli doğruladı. İkisi yeni bulgu çıkardı: (a) Senaryo 3 — eski kart sürümüne bağlı yerleşimlerin arayüzde görünür işaretlenmesi gerekiyor, Faz 3 ekran gereksinimine eklenmeli; (b) Senaryo 7 — madde 1'deki dönemsel/nihai sorusu somutlaştırıldı, çözüm önerisi olarak `measurements` tablosuna bir `kayıt_türü` (nihai/dönemsel-ek) alanı önerildi — GPT Sol onayı bekliyor, tek taraflı karara bağlanmadı.

**Sonraki görev için varsayımlar**
- Kapsam/kapsam dışı listesi ve kabul kriterleri zaten `ROADMAP.md`'de mevcut ve yeterli sayılıyor — Faz 0 için ayrıca tekrar üretilmedi.
- Temiz Su referans projesi ve altın hesap veri seti GPT Luna'nın sorumluluğunda; Claude ekibi bunlara dokunmadı, bekleniyor.
- Teknik sözleşmeler ve uygulanabilirlik değerlendirmesi GPT Sol'un sorumluluğunda; Claude ekibi bağımsız olarak bunu incelemedi, GPT ekibinin çıktısı geldiğinde Opus bağımsız kontrol yapacak (RACI: "Opus ve Sol birbirlerinin sonuçlarını bağımsız kontrol eder").
- **Faz 1'e geçiş için:** hem GPT ekibinin Faz 0 çıktıları hem kullanıcı onayı gerekiyor — kural gereği bu ikisi olmadan ilerlenmeyecek.
