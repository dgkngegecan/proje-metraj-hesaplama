using Metraj.Domain;

namespace Metraj.Application;

/// <summary>
/// Alan kurallarının kullanıcıya gösterilecek Türkçe karşılıkları.
/// </summary>
/// <remarks>
/// <see cref="DomainRuleViolationException.Rule"/> kararlı makine kimliğidir;
/// istisnanın kendi mesajı ise geliştirici/günlük ayrıntısıdır. Kullanıcının
/// gördüğü metin buradan çözülür. Bu ayrım olmadan uygulama, Türkçe bir
/// arayüzün ortasında "Only measurable placements can receive quantity input."
/// gibi İngilizce mesajlar gösteriyordu.
///
/// Katalogda bulunmayan bir kural için ilgili alanın genel açıklaması döner; mesaj
/// hiçbir zaman boş kalmaz. Kural kodu teşhis için yanıtın "rule" alanında kalır.
/// Metinler docs/arayuz-metin-kilavuzu.md'ye göre yazılır.
/// </remarks>
public static class DomainMessageCatalog
{
    private static readonly Dictionary<string, string> Messages = new(StringComparer.Ordinal)
    {
        // Yedekleme ve geri yükleme
        ["backup.not-metraj"] = "Seçilen dosya bir Proje Metraj yedeği değil. Yedek klasöründeki bir yedeği seçin.",
        ["backup.newer-schema"] = "Bu yedek uygulamanın daha yeni bir sürümüyle alınmış. Uygulamayı güncelleyip tekrar deneyin.",
        ["backup.broken-relations"] = "Yedek dosyası bozuk; geri yüklenemez. Başka bir yedek seçin.",
        ["backup.outside-folder"] = "Yalnızca uygulamanın kendi yedekleri geri yüklenebilir.",

        // Taşınabilir çalışma alanı
        ["workspace-import.same-file"] = "Bu dosya şu an kullanılan verilerin kendisi; içe aktarılamaz.",
        ["workspace-import.id-collision"] = "Dosyadaki bazı kayıtlar mevcut verilerle çakışıyor; dosya içe aktarılamadı.",
        ["workspace-import.empty"] = "Seçilen dosyada içe aktarılacak proje yok.",

        // Miktar kuralları
        ["quantity.non-negative"] = "Miktar negatif olamaz.",
        ["quantity.range"] = "Miktar çok büyük.",
        ["quantity.scale"] = "Miktarda en fazla 6 ondalık basamak kullanılabilir.",
        ["quantity.whole"] = "Bu alana tam sayı girin.",

        // Revizyon
        ["revision.read-only"] = "Bu revizyon onaylı; değiştirilemez. Değişiklik için yeni revizyon açın.",
        ["revision.not-found"] = "Revizyon bulunamadı.",
        ["revision.project"] = "Proje bulunamadı.",
        ["revision.source"] = "Kopyalanacak revizyon yok.",
        ["revision.draft-exists"] = "Açık bir taslak revizyon var. Yeni revizyon açmadan önce onu onaylayın.",
        ["revision.pending-calculations"] = "Onaylamadan önce bekleyen hesap önerilerini onaylayın ya da reddedin.",
        ["revision.stale-calculations"] = "Kaynak miktarlar değiştiği için bazı hesap önerileri güncel değil. Onaylamadan önce yeniden hesaplayın ya da reddedin.",

        // Proje
        ["project.code"] = "Proje kodunu yazın (en fazla 64 karakter).",
        ["project.name"] = "Proje adını yazın (en fazla 256 karakter).",
        ["project.code-unique"] = "Bu proje kodu zaten kullanılıyor.",

        // Proje ağacı ve yerleşimler
        ["placement.not-found"] = "Kart bu projede bulunamadı.",
        ["placement.parent"] = "Üst kart bulunamadı.",
        ["placement.card"] = "Kart kütüphanede bulunamadı.",
        ["placement.card-definition"] = "Kart kütüphanede bulunamadı.",
        ["placement.revision"] = "Revizyon bulunamadı.",
        ["placement.inactive-card"] = "Pasif kart projeye eklenemez.",
        ["placement.display-name"] = "Görünen ad çok uzun.",
        ["placement.procurement-scope"] = "Satın alma kapsamı çok uzun.",
        ["placement.notes"] = "Not çok uzun.",
        ["context-note.not-found"] = "Not bulunamadı.",
        ["context-note.text"] = "Not metnini yazın (en fazla 4000 karakter).",
        ["context-note.block"] = "Blok adı en fazla 128 karakter olabilir.",
        ["context-note.floor"] = "Kat adı en fazla 128 karakter olabilir.",
        ["context-note.room"] = "Mahal adı en fazla 256 karakter olabilir.",
        ["tree.card-type"] = "Bu kart türü seçilen üst kartın altına yerleştirilemez.",
        ["tree.custom-parent"] = "Seçilen üst kart, bu kartın özel türü tarafından kabul edilmiyor.",
        ["tree.custom-child"] = "Bu kart, üst kartın özel türü tarafından kabul edilmiyor.",
        ["tree.self-parent"] = "Kart kendi altına taşınamaz.",
        ["tree.cycle"] = "Kart, kendi alt kartlarından birinin altına taşınamaz.",
        ["tree.cross-revision"] = "Kart başka bir revizyondaki kartın altına taşınamaz.",

        // Bağlantılar
        ["link.self"] = "Kart kendi miktarından hesaplanamaz.",
        ["link.source"] = "Kaynak kart bulunamadı.",
        ["link.target"] = "Hedef kart bulunamadı.",
        ["link.duplicate"] = "Bu hesap kaynağı zaten ekli.",
        ["link.cross-revision"] = "Hesap kaynağı aynı revizyonda olmalı.",
        ["link.calculated-from-cycle"] = "Bu kart, seçilen kaynağın hesabında zaten kullanılıyor; kaynak olarak seçilemez.",
        ["link.notes"] = "Not çok uzun.",

        // Metraj girişi
        ["measurement.not-found"] = "Giriş bulunamadı.",
        ["measurement.placement"] = "Girişin kartı bulunamadı.",
        ["measurement.card"] = "Kart kütüphanede bulunamadı.",
        ["measurement.revision"] = "Revizyon bulunamadı.",
        ["measurement.scope"] = "Giriş, seçili revizyondaki bir karta yapılmalı.",
        ["measurement.behavior"] = "Bu bir başlık kartı; miktar girilemez.",
        ["measurement.derived"] = "Bu kartın miktarı hesapla bulunur; elle girilemez.",
        ["measurement.boolean"] = "Bu kart yalnızca 0 (yapılmadı) veya 1 (yapıldı) kabul eder.",
        ["measurement.unit"] = "Girilen birim, kartın birimiyle aynı olmalıdır.",
        ["measurement.batch"] = "Kaydedilecek giriş yok.",
        ["measurement.source-kind"] = "Giriş kaydedilemedi. Tekrar deneyin.",
        ["measurement.block"] = "Blok adı çok uzun.",
        ["measurement.floor"] = "Kat adı çok uzun.",
        ["measurement.room"] = "Mahal adı çok uzun.",
        ["measurement.zone"] = "Zon adı çok uzun.",
        ["measurement.sheet"] = "Pafta adı çok uzun.",
        ["measurement.drawing-revision"] = "Çizim revizyonu çok uzun.",
        ["measurement.notes"] = "Not çok uzun.",
        ["measurement.variant"] = "Çap adı çok uzun.",
        ["measurement.secondary-variant"] = "Çeşit adı çok uzun.",

        // Katalog kartları
        ["catalog.required"] = "Kart kodu, adı ve birimi zorunlu.",
        ["catalog.version-content"] = "Kart adı ve birimi zorunlu.",
        ["catalog.code-unique"] = "Bu kart kodu zaten kullanılıyor.",
        ["catalog.definition"] = "Kart kütüphanede bulunamadı.",
        ["catalog.inactive"] = "Pasif kart düzenlenemez.",
        ["catalog.container-positive"] = "Boy ya da paket miktarı sıfırdan büyük olmalı.",
        ["catalog.optional-text"] = "Girilen metin çok uzun.",
        ["catalog.variant.empty"] = "En az bir çeşit ekleyin.",
        ["catalog.variant.pipe-length"] = "Her çap için sıfırdan büyük bir boy yazın.",
        ["catalog.variant.mode"] = "Çeşit eklemek için çeşit tipini Boru ya da Fitting seçin.",
        ["catalog.variant.text"] = "Her çeşidin kodunu ve adını yazın.",

        // Kart türü şablonları
        ["catalog-type.not-found"] = "Seçilen kart türü bulunamadı.",
        ["catalog-type.inactive"] = "Kaldırılmış kart türü yeni kartta kullanılamaz.",
        ["catalog-type.base-type"] = "Kartın temel türü, seçilen özel türün temel türüyle aynı olmalıdır.",
        ["catalog-type.code"] = "Tür kodunu yazın (en fazla 64 karakter).",
        ["catalog-type.code-unique"] = "Bu tür kodu zaten kullanılıyor.",
        ["catalog-type.required"] = "Zorunlu alanları doldurun.",
        ["catalog-type.optional"] = "Girilen metin çok uzun.",
        ["catalog-type.attribute-key"] = "Kart bilgileri kaydedilemedi. Tekrar deneyin.",
        ["catalog-type.attribute-not-enabled"] = "Bu bilgi seçilen kart türünde kullanılmıyor.",
        ["catalog-type.attribute-number"] = "Bu alan geçerli bir sayı olmalıdır.",
        ["catalog-type.attribute-enum"] = "Seçilen değer bu alan için geçerli değil.",
        ["catalog-type.parent-reference"] = "Seçilen üst kartlardan biri silinmiş ya da pasif.",
        ["catalog-type.child-reference"] = "Seçilen alt kartlardan biri silinmiş ya da pasif.",

        // Hesap kuralları ve önerileri
        ["calculation.revision"] = "Revizyon bulunamadı.",
        ["calculation.target"] = "Hesaplanacak kart bulunamadı.",
        ["calculation.card"] = "Kart kütüphanede bulunamadı.",
        ["calculation.behavior"] = "Yalnızca ölçülebilir kartlar için hesap yapılabilir.",
        ["calculation.scope"] = "Kart ve kural aynı revizyonda olmalı.",
        ["calculation.rule"] = "Hesap kuralı bulunamadı.",
        ["calculation.rule-parameters"] = "Hesap kuralının değerleri geçersiz.",
        ["calculation.direct-rule"] = "Doğrudan kuralda çarpan 1 olmalı.",
        ["calculation.multiplier"] = "Çarpan sıfırdan büyük olmalıdır.",
        ["calculation.parameter"] = "Boy ya da paket miktarı sıfırdan büyük olmalı.",
        ["calculation.calculated-from"] = "Önce bir hesap kaynağı seçin.",
        ["calculation.source-measurements"] = "Kaynak kartta henüz giriş yok.",
        ["calculation.source-card"] = "Kaynak kart kütüphanede bulunamadı.",
        ["calculation.source-unit"] = "Kaynak kartların birimi aynı olmalı.",
        ["calculation.result"] = "Hesap önerisi bulunamadı.",
        ["calculation.review-state"] = "Bu öneri zaten karara bağlanmış.",
        ["calculation.override-reason"] = "Gerekçeyi yazın (en fazla 2000 karakter).",
        ["calculation.reject-reason"] = "Gerekçeyi yazın (en fazla 2000 karakter).",

        // Sorumluluk
        ["responsibility.revision"] = "Revizyon bulunamadı.",
        ["responsibility.scope"] = "Sorumluluk türü, kart ve taraf aynı revizyonda olmalı.",
        ["responsibility.party-required"] = "“Sorumlu” durumu için bir taraf seçin.",
        ["responsibility.dimension"] = "Sorumluluk türünün kodunu ve adını yazın.",
        ["responsibility.dimension-code"] = "Bu sorumluluk türü kodu zaten kullanılıyor.",
        ["responsibility.party"] = "Tarafın kodunu ve adını yazın.",
        ["responsibility.party-code"] = "Bu taraf kodu zaten kullanılıyor.",
        ["responsibility.notes"] = "Not çok uzun.",

        // Fire politikası
        ["waste.material-type"] = "Malzeme ailesini yazın (en fazla 128 karakter).",
        ["waste.not-found"] = "Fire kuralı bulunamadı.",

        // Arayüz durumu (yarım kalmış girişler ve tercihler)
        ["ui-state.key"] = "Tercih kaydedilemedi.",
        ["ui-state.value"] = "Taslak çok büyük; kaydedilemedi.",

        // Rapor
        ["report.root"] = "Raporlanacak kart bu projede bulunamadı.",
        ["report.revision"] = "Raporlanacak revizyon bulunamadı.",
        ["report.project"] = "Raporlanacak proje bulunamadı."
    };

    /// <summary>
    /// Kuralın Türkçe karşılığını verir. Katalogda yoksa alan grubuna göre
    /// anlaşılır bir genel mesaj döner.
    /// </summary>
    public static string Resolve(string rule)
    {
        if (string.IsNullOrWhiteSpace(rule))
        {
            return "İşlem tamamlanamadı. Tekrar deneyin.";
        }

        if (Messages.TryGetValue(rule, out string? message))
        {
            return message;
        }

        string area = rule.Split('.')[0] switch
        {
            "quantity" => "Girilen miktar kabul edilmedi",
            "measurement" => "Giriş kaydedilemedi",
            "placement" or "tree" or "link" => "Proje ağacı güncellenemedi",
            "catalog" or "catalog-type" => "Kart kaydedilemedi",
            "calculation" => "Hesap işlemi tamamlanamadı",
            "responsibility" => "Sorumluluk kaydedilemedi",
            "revision" or "project" => "Proje işlemi tamamlanamadı",
            "waste" => "Fire kuralı kaydedilemedi",
            "backup" => "Yedek işlemi tamamlanamadı",
            "workspace-import" => "Dosya içe aktarılamadı",
            _ => "İşlem tamamlanamadı"
        };

        // Kural kodu kullanıcıya gösterilmez; API yanıtının "rule" alanında ve günlükte kalır.
        return $"{area}. Tekrar deneyin.";
    }
}
