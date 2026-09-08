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
/// Katalogda bulunmayan bir kural için, ilgili alanın genel açıklaması ve kural
/// kodu döner; mesaj hiçbir zaman boş kalmaz ve teşhis edilebilirliğini korur.
/// </remarks>
public static class DomainMessageCatalog
{
    private static readonly Dictionary<string, string> Messages = new(StringComparer.Ordinal)
    {
        // Yedekleme ve geri yükleme
        ["backup.not-metraj"] = "Seçilen dosya bir Proje Metraj yedeği değil. Yedek klasöründeki bir yedeği seçin.",
        ["backup.newer-schema"] = "Bu yedek daha yeni bir Proje Metraj sürümüyle alınmış. Güncel sürümle geri yükleyin.",
        ["backup.broken-relations"] = "Yedekteki kayıtlar tutarsız; bu dosya güvenle geri yüklenemez.",

        // Miktar kuralları
        ["quantity.non-negative"] = "Miktar negatif olamaz.",
        ["quantity.range"] = "Miktar desteklenen aralığın dışında.",
        ["quantity.scale"] = "Miktarda en fazla 6 ondalık basamak kullanılabilir.",
        ["quantity.whole"] = "Bu alan tam sayı olmalıdır.",

        // Revizyon
        ["revision.read-only"] = "Bu sürüm onaylanmış ve kilitlenmiştir. Değişiklik için yeni bir düzenleme kopyası açın.",
        ["revision.not-found"] = "Proje sürümü bulunamadı.",
        ["revision.project"] = "Proje bulunamadı.",
        ["revision.source"] = "Kopyalanacak bir sürüm yok.",
        ["revision.draft-exists"] = "Yeni kopya açmadan önce mevcut düzenleme kopyasını onaylayın.",
        ["revision.pending-calculations"] = "Onaydan önce bekleyen bütün hesap önerilerini onaylayın veya reddedin.",
        ["revision.stale-calculations"] = "Kaynak metrajı değiştiği için güncelliğini yitirmiş hesap önerileri var. Onaydan önce yeniden hesaplayın veya reddedin.",

        // Proje
        ["project.code"] = "Proje kodu 1 ile 64 karakter arasında olmalıdır.",
        ["project.name"] = "Proje adı 1 ile 256 karakter arasında olmalıdır.",
        ["project.code-unique"] = "Bu proje kodu zaten kullanılıyor.",

        // Proje ağacı ve yerleşimler
        ["placement.not-found"] = "Kart bu projede bulunamadı.",
        ["placement.parent"] = "Üst kart bu sürümde bulunamadı.",
        ["placement.card"] = "Kartın katalog sürümü bulunamadı.",
        ["placement.card-definition"] = "Katalog kartı bulunamadı.",
        ["placement.revision"] = "Proje sürümü bulunamadı.",
        ["placement.inactive-card"] = "Kütüphaneden kaldırılmış bir kart yeni projeye eklenemez.",
        ["placement.display-name"] = "Görünen ad çok uzun.",
        ["placement.procurement-scope"] = "Tedarik kapsamı çok uzun.",
        ["placement.notes"] = "Not çok uzun.",
        ["tree.card-type"] = "Bu kart türü seçilen üst kartın altına yerleştirilemez.",
        ["tree.custom-parent"] = "Seçilen üst kart, bu kartın özel türü tarafından kabul edilmiyor.",
        ["tree.custom-child"] = "Bu kart, üst kartın özel türü tarafından kabul edilmiyor.",
        ["tree.self-parent"] = "Bir kart kendi üstü olamaz.",
        ["tree.cycle"] = "Bu bağlantı döngü oluşturur.",
        ["tree.cross-revision"] = "Kart ve üst kartı aynı proje sürümünde olmalıdır.",

        // Bağlantılar
        ["link.self"] = "Bir kart kendisine bağlanamaz.",
        ["link.source"] = "Kaynak kart bulunamadı.",
        ["link.target"] = "Hedef kart bulunamadı.",
        ["link.duplicate"] = "Bu bağlantı zaten var.",
        ["link.cross-revision"] = "Bağlanan kartlar aynı proje sürümünde olmalıdır.",
        ["link.calculated-from-cycle"] = "Hesap kaynağı bağlantıları döngü oluşturamaz.",

        // Metraj girişi
        ["measurement.not-found"] = "Metraj satırı bulunamadı.",
        ["measurement.placement"] = "Metrajın kartı bulunamadı.",
        ["measurement.card"] = "Kartın katalog sürümü bulunamadı.",
        ["measurement.revision"] = "Proje sürümü bulunamadı.",
        ["measurement.scope"] = "Metraj, seçili proje sürümündeki bir karta girilmelidir.",
        ["measurement.behavior"] = "Bu kart bir başlık kartıdır; metraj yalnızca ölçülebilir kartlara girilir.",
        ["measurement.derived"] = "Bu kartın miktarı hesapla türetilir; elle metraj girilemez.",
        ["measurement.boolean"] = "Bu kart yalnızca 0 (yapılmadı) veya 1 (yapıldı) kabul eder.",
        ["measurement.unit"] = "Girilen birim, kartın birimiyle aynı olmalıdır.",
        ["measurement.batch"] = "En az bir metraj satırı gerekir.",
        ["measurement.source-kind"] = "Kaynak türü geçersiz.",
        ["measurement.block"] = "Blok adı çok uzun.",
        ["measurement.floor"] = "Kat adı çok uzun.",
        ["measurement.room"] = "Mahal adı çok uzun.",
        ["measurement.zone"] = "Bölge adı çok uzun.",
        ["measurement.sheet"] = "Pafta adı çok uzun.",
        ["measurement.drawing-revision"] = "Çizim revizyonu çok uzun.",
        ["measurement.notes"] = "Not çok uzun.",
        ["measurement.variant"] = "Çap/boyut etiketi çok uzun.",
        ["measurement.secondary-variant"] = "Çeşit etiketi çok uzun.",

        // Katalog kartları
        ["catalog.required"] = "Kod, ad ve birim doldurulmalı ve uzunluk sınırlarını aşmamalıdır.",
        ["catalog.version-content"] = "Ad ve birim doldurulmalı ve uzunluk sınırlarını aşmamalıdır.",
        ["catalog.code-unique"] = "Bu katalog kodu zaten kullanılıyor.",
        ["catalog.definition"] = "Katalog kartı bulunamadı.",
        ["catalog.inactive"] = "Kütüphaneden kaldırılmış bir karta yeni sürüm eklenemez.",
        ["catalog.container-positive"] = "Boy/paket kapasitesi sıfırdan büyük olmalıdır.",
        ["catalog.optional-text"] = "Girilen metin çok uzun.",
        ["catalog.variant.empty"] = "Boru ve fitting kartlarında en az bir varyant tanımlanmalıdır.",
        ["catalog.variant.pipe-length"] = "Her boru çapının pozitif bir ticari boyu olmalıdır.",
        ["catalog.variant.mode"] = "Varyant tanımları için Boru veya Fitting davranışı seçilmelidir.",
        ["catalog.variant.text"] = "Varyant kodu ve etiketi doldurulmalıdır.",

        // Kart türü şablonları
        ["catalog-type.not-found"] = "Seçilen kart türü bulunamadı.",
        ["catalog-type.inactive"] = "Kaldırılmış bir kart türü yeni kart için kullanılamaz.",
        ["catalog-type.base-type"] = "Kartın temel türü, seçilen özel türün temel türüyle aynı olmalıdır.",
        ["catalog-type.code"] = "Tür kodu doldurulmalı ve en fazla 64 karakter olmalıdır.",
        ["catalog-type.code-unique"] = "Bu tür kodu zaten kullanılıyor.",
        ["catalog-type.required"] = "Zorunlu alanları doldurun.",
        ["catalog-type.optional"] = "Girilen metin çok uzun.",
        ["catalog-type.attribute-key"] = "Tanınmayan bir kart bilgisi gönderildi.",
        ["catalog-type.attribute-not-enabled"] = "Bu bilgi alanı seçilen kart türü için etkin değil.",
        ["catalog-type.attribute-number"] = "Bu alan geçerli bir sayı olmalıdır.",
        ["catalog-type.attribute-enum"] = "Bu alan için desteklenmeyen bir değer seçildi.",
        ["catalog-type.parent-reference"] = "Seçilen üst kartların hepsi kütüphanede ve etkin olmalıdır.",
        ["catalog-type.child-reference"] = "Seçilen alt kartların hepsi kütüphanede ve etkin olmalıdır.",

        // Hesap kuralları ve önerileri
        ["calculation.revision"] = "Proje sürümü bulunamadı.",
        ["calculation.target"] = "Hesaplanacak kart bulunamadı.",
        ["calculation.card"] = "Kartın katalog sürümü bulunamadı.",
        ["calculation.behavior"] = "Yalnızca ölçülebilir kartlar için hesap yapılabilir.",
        ["calculation.scope"] = "Kart ve kural aynı proje sürümünde olmalıdır.",
        ["calculation.rule"] = "Hesap kuralı bulunamadı; kural kodu ve adı doldurulmalıdır.",
        ["calculation.rule-parameters"] = "Hesap kuralının parametreleri geçersiz.",
        ["calculation.direct-rule"] = "Doğrudan kural her zaman 1 çarpanı ve net miktarı kullanır.",
        ["calculation.multiplier"] = "Çarpan sıfırdan büyük olmalıdır.",
        ["calculation.parameter"] = "Boy veya paket dönüşümü için pozitif bir kapasite gerekir.",
        ["calculation.calculated-from"] = "Çarpanlı kural için en az bir kaynak kart bağlanmalıdır.",
        ["calculation.source-measurements"] = "Hesabın dayanacağı kaynak metraj satırı yok.",
        ["calculation.source-card"] = "Kaynak kartın katalog sürümü bulunamadı.",
        ["calculation.source-unit"] = "Kaynak kartların hepsi aynı birimi kullanmalıdır.",
        ["calculation.result"] = "Hesap önerisi bulunamadı.",
        ["calculation.review-state"] = "Yalnızca kontrol bekleyen bir öneri incelenebilir.",
        ["calculation.override-reason"] = "Değiştirme gerekçesi 1 ile 2000 karakter arasında olmalıdır.",
        ["calculation.reject-reason"] = "Red gerekçesi 1 ile 2000 karakter arasında olmalıdır.",

        // Sorumluluk
        ["responsibility.revision"] = "Proje sürümü bulunamadı.",
        ["responsibility.scope"] = "Boyut, kart ve taraf aynı proje sürümünde olmalıdır.",
        ["responsibility.party-required"] = "Sorumlu durumu için bir taraf seçilmelidir.",
        ["responsibility.dimension"] = "Boyut kodu ve adı doldurulmalıdır.",
        ["responsibility.dimension-code"] = "Bu boyut kodu zaten kullanılıyor.",
        ["responsibility.party"] = "Taraf kodu ve adı doldurulmalıdır.",
        ["responsibility.party-code"] = "Bu taraf kodu zaten kullanılıyor.",
        ["responsibility.notes"] = "Not çok uzun.",

        // Fire politikası
        ["waste.material-type"] = "Malzeme ailesi 1 ile 128 karakter arasında olmalıdır.",
        ["waste.not-found"] = "Fire kuralı bulunamadı.",

        // Arayüz durumu (yarım kalmış girişler ve tercihler)
        ["ui-state.key"] = "Arayüz durumu anahtarı geçersiz.",
        ["ui-state.value"] = "Saklanacak arayüz durumu çok büyük.",

        // Rapor
        ["report.root"] = "Raporlanacak kart bu projede bulunamadı."
    };

    /// <summary>
    /// Kuralın Türkçe karşılığını verir. Katalogda yoksa alan grubuna göre
    /// anlaşılır bir genel mesaj ve kural kodu döner.
    /// </summary>
    public static string Resolve(string rule)
    {
        if (string.IsNullOrWhiteSpace(rule))
        {
            return "İşlem tamamlanamadı.";
        }

        if (Messages.TryGetValue(rule, out string? message))
        {
            return message;
        }

        string area = rule.Split('.')[0] switch
        {
            "quantity" => "Girilen miktar kabul edilmedi",
            "measurement" => "Metraj satırı kaydedilemedi",
            "placement" or "tree" or "link" => "Proje haritası güncellenemedi",
            "catalog" or "catalog-type" => "Katalog kartı kaydedilemedi",
            "calculation" => "Hesap işlemi tamamlanamadı",
            "responsibility" => "Sorumluluk kaydedilemedi",
            "revision" or "project" => "Proje işlemi tamamlanamadı",
            "waste" => "Fire kuralı kaydedilemedi",
            "backup" => "Yedekleme işlemi tamamlanamadı",
            _ => "İşlem tamamlanamadı"
        };

        return $"{area} ({rule}).";
    }
}
