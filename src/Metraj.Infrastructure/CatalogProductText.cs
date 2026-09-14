using System.Globalization;
using System.Text.RegularExpressions;
using Metraj.Application;

namespace Metraj.Infrastructure;

internal static partial class CatalogProductText
{
    private static readonly Dictionary<string, string> ProductNotes = new(StringComparer.Ordinal)
    {
        ["PIPE-PPRC"] = "Sıcak ve soğuk su tesisatı için PP-R boru. Dış çap, et kalınlığı ve basınç sınıfı proje şartlarına göre birlikte belirtilir. Ticari boy 4 m; ek parçalar, yalıtım ve askılar ayrıca metrajlandırılır.",
        ["PIPE-STEEL"] = "Çelik tesisat borusu. DN ile diş ölçüsü birlikte kontrol edilir; et kalınlığı ve bağlantı tipi proje şartlarına göre seçilir. Ticari boy 6 m; dirsek, te, redüksiyon, bağlantı ve mesnetler ayrıca sayılır.",
        ["PIPE-GALV"] = "Galvaniz kaplı çelik boru. DN, diş ölçüsü ve et kalınlığı birlikte belirtilir; ticari boy 6 m. Dişli bağlantı parçaları, askılar ve yalıtım ayrı metraj kalemleridir.",
        ["PIPE-COPPER-SIZES"] = "Bakır boru; dış çap ve et kalınlığı ile tanımlanır. Metraj metre üzerinden, satın alma 5 m ticari boy üzerinden alınır. Lehimli veya pres bağlantılar boru serisiyle eşleştirilir ve ayrı sayılır.",
        ["HAV-KLIMA-SANTRALI-PAKET"] = "Filtre, ısıtma/soğutma bataryası, fan ve karıştırma damperi kademelerini içeren paket klima santrali. Debi, dış statik basınç, filtre sınıfı ve batarya kapasitesi proje şartlarına göre birlikte belirlenir. Cihaz, kanal bağlantıları, vana grubu ve otomasyon kapsamı ayrı belirtilir.",
        ["SU-PPRC-BORU-AILE"] = "Sıcak ve soğuk su dağıtımı için PP-R boru. Basınç sınıfları PN10–25; sınıf seçenekleri PN10, PN16, PN20 ve PN25'tir. Polifüzyon kaynaklı bağlantı; ticari boy 4 m. TS EN ISO 15874 / DIN 8077. PN, dış çap ve et kalınlığı birlikte belirtilmelidir; çalışma sıcaklığına uygun basınç değeri üreticinin tablosundan seçilir.",
        ["SU-PPRC-BORU-FIBER"] = "Cam elyaf takviyeli PP-R boru; sıcak su ve ısıtma dağıtımında düşük ısıl uzama için kullanılır. Basınç sınıfları PN20–25; ticari boy 4 m. Genleşme payı, sabit/kayar mesnetler ve yalıtım ayrıca metrajlandırılır. Et kalınlığı ve çalışma basıncı üretici serisine göre seçilir.",
        ["SU-PPRC-FITTING-AILE-EK"] = "PP-R borular için dirsek, te, manşon, redüksiyon, rakor ve geçiş parçaları. Polifüzyon kaynaklı bağlantı; TS EN ISO 15874. Parça tipi ve boru dış çapı birlikte seçilir; redüksiyonlarda iki uç ölçüsü, dişli geçişlerde diş ölçüsü de belirtilir. Her bağlantı parçası adet olarak sayılır.",
        ["ASK-THREADED-RODS"] = "Askı ve mesnet bağlantıları için metrik dişli çubuk. Vida ölçüsü, çubuk boyu, malzeme ve kaplama birlikte seçilir. Somun, pul, dübel ve profil bağlantıları ayrıca sayılır; taşıma kapasitesi ve askı aralığı proje detayına göre belirlenir.",
        ["ASK-STRUT"] = "Montaj rayı; kesit aralığı 41×21–41×41 mm, ticari boy aralığı 3–6 m. Düz, delikli, çift kanal ve paslanmaz seçenekler ürün kapsamına göre seçilir. Askı yükü, açıklık, kaplama ve bağlantı somunları birlikte değerlendirilir; metraj metre üzerinden alınır.",
        ["HAV-PANEL-FILTRE-G4"] = "Klima santrali giriş kademesi için piliseli ön filtre; ISO 16890 Coarse sınıfı. En aralığı 287–592 mm, yükseklik aralığı 490–592 mm, derinlik 48 mm. Seçenekler 287×592, 490×490 ve 592×592 mm'dir. Filtre yuvası ölçüsüyle eşleştirilir ve adet olarak sayılır.",
        ["ASK-TRAPEZ-ASKI-KONSOLU"] = "Birden fazla boruyu veya kanalı taşıyan trapez askı takımı. Taşıyıcı profil, dişli çubuk, bağlantı elemanları ve ankrajlar proje detayına göre seçilir. Açıklık ve taşıma yükü birlikte değerlendirilir; takım kapsamındaki parçalar ikinci kez sayılmaz.",
        ["SU-SICAK-SU-BOYLERI"] = "Kullanım sıcak suyunu depolayan elektrikli veya indirekt ısıtmalı boyler. Hacim, serpantin sayısı, ısıtma gücü ve çalışma basıncı birlikte seçilir. Emniyet grubu, genleşme tankı, sirkülasyon bağlantısı ve yalıtımın ürün kapsamına dahil olup olmadığı metrajda belirtilir.",
        ["SU-PEX-BORU-AILE"] = "PE-Xa/b/c boru; TS EN ISO 15875. Küçük çaplar kangal, büyük çaplar kangal veya düz boy olarak temin edilir. Metraj metre üzerinden alınır; satın alma için seçilen çapın kangal veya çubuk uzunluğu kullanılır. Bağlantı parçası boru serisiyle birlikte seçilir.",
        ["SU-PEXALPEX-BORU"] = "Alüminyum ara katmanlı çok katmanlı boru; TS EN ISO 21003. Pres bağlantılı sıcak/soğuk su ve ısıtma dağıtımı. Metraj metre üzerinden; ticari çubuk veya kangal boyu tedarik edilecek seriye göre seçilir.",
        ["SU-BAKIR-BORU-AILE-EK"] = "TS EN 1057 bakır boru. Dış çap ve et kalınlığı ile tanımlanır. Sert/yarı sert çubuk veya yumuşak kangal olarak temin edilir; lehimli ve pres bağlantılar ayrı parça olarak metrajlandırılır.",
        ["SU-YALITIM-PEX-BORU"] = "Kapalı hücreli boru yalıtımı. Elastomerik köpük için TS EN 14304, polietilen köpük için TS EN 14313. Boru dış çapı ve yalıtım kalınlığı birlikte seçilir; vana ve dirsek yalıtımları ayrıca değerlendirilir.",
        ["ISI-PEX-A-YERDEN-ISITMA"] = "TS EN ISO 15875; oksijen difüzyon bariyerli PE-Xa boru. Yerden ısıtma devreleri metre üzerinden, tedarik ise seçilen kangal boyuna göre hesaplanır.",
        ["VITR-FLEKSIBL-HORTUM"] = "Ara musluk ile batarya arasındaki esnek bağlantı; paslanmaz örgülü hortum. Bağlantı dişleri ve hortum boyu birlikte seçilir; her hortum ayrı sayılır.",
        ["VITR-SIFON-KLOZET-BAGLANTI"] = "Klozet çıkışı ile pis su hattı arasında esnek veya rijit bağlantı elemanı. Bağlantı çap aralığı DN100–110; çıkış ekseni ve conta tipiyle birlikte seçilir.",
        ["ATIK-ACC-KORUGE-MANSON"] = "Koruge boruları conta ile birleştiren manşon. Borunun iç/dış çap serisi ve conta profili ile birlikte seçilir; birleşim başına adet olarak sayılır.",
        ["ATIK-ACC-POMPA-ISTASYONU-VANA-SETI"] = "Terfi pompası basma hattında geri akışı önleyen çekvalf ve bakım için hattı ayıran kapatma vanasından oluşur. Pompa bağlantı çapı ve basınç sınıfına göre seçilir.",
        ["ATIK-ACC-YAGMUR-INIS-DIRSEK"] = "Cephe çıkıntılarında ofset geçişi veya iniş sonunda tahliye yönü için kullanılır. İniş borusunun çapı, dirsek açısı ve bağlantı tipi birlikte seçilir.",
        ["ATIK-ACC-YATAY-BORU-ASKI-KELEPCE"] = "Yatay pis su ve yağmur suyu hatları için kelepçe, dişli çubuk ve dübel takımı. Askı aralığı boru malzemesi, çapı ve üretici montaj tablosuna göre belirlenir.",
        ["ATIK-MAT-DRENAJ-FILTRE-KUM-CAKIL"] = "Perfore drenaj borusu çevresinde filtre dolgusu. Temel drenajında jeotekstil ile birlikte kullanılır; dolgu hacmi üzerinden metrajlandırılır.",
        ["ATIK-MAT-ROGAR-MERDIVEN"] = "Muayene bacasında erişim için gövdeye bağlanan basamak veya merdiven. Baca derinliği, basamak aralığı ve malzeme proje detayına göre belirlenir.",
        ["VANA-IGNE-VANA"] = "Manometre hattında izolasyon ve hassas kısma için iğne vana. Gerektiğinde sifon borusu ile birlikte kullanılır. Diş ölçüsü, akışkan ve çalışma basıncı birlikte seçilir."
    };

    internal static string CleanNotes(string code, string? notes)
    {
        string key = code.StartsWith("STDF-", StringComparison.Ordinal) || code.StartsWith("STDX-", StringComparison.Ordinal) ? code[5..]
            : code.StartsWith("STD-", StringComparison.Ordinal) ? code[4..] : code;
        if (ProductNotes.TryGetValue(key, out string? replacement)) return replacement;
        string text = (notes ?? "").Replace("Hata bulunmadı.", "", StringComparison.OrdinalIgnoreCase);
        text = NewCardPrefix().Replace(text, "");
        text = EditorialParenthesis().Replace(text, "");
        text = EditorialTail().Replace(text, "");
        string[] sentences = SentenceBoundary().Split(text);
        text = string.Join(' ', sentences.Where(sentence => !EditorialLanguage().IsMatch(sentence)));
        return Spaces().Replace(text, " ").Trim(' ', ';', ',');
    }

    internal static string CleanName(string name) => name.Replace(" (Genişletilmiş)", "", StringComparison.OrdinalIgnoreCase)
        .Replace(" (Extended)", "", StringComparison.OrdinalIgnoreCase);

    internal static IReadOnlyList<CatalogCardVariant> CleanOptions(string code, IReadOnlyList<CatalogCardVariant> options) =>
        options.Select(option => option with
        {
            Label = CleanName(option.Label),
            SourceCardName = option.SourceCardName is null ? null : CleanName(option.SourceCardName),
            SourceNotes = CleanNotes(option.SourceCardCode ?? code, option.SourceNotes)
        }).ToArray();

    internal static string Description(string code, string? notes, IReadOnlyList<CatalogCardVariant> variants, string? material)
    {
        string clean = CleanNotes(code, notes);
        string range = SizeRange(variants, material);
        return range.Length == 0 ? clean : $"{range}. {clean}".Trim();
    }

    internal static string SizeRange(IReadOnlyList<CatalogCardVariant> variants, string? material)
    {
        var sizes = new SortedSet<decimal>();
        bool outer = material is "PP-R" or "PEX" or "PEX-AL-PEX" or "Copper" or "Bakır" or "PVC-U" or "HDPE";
        foreach (string code in variants.SelectMany(option => option.CompatibleDiameters is { Count: > 0 }
            ? option.CompatibleDiameters : new[] { option.SourceVariantCode ?? option.Code }))
        {
            Match match = Diameter().Match(code);
            if (!match.Success) continue;
            if (decimal.TryParse(match.Groups[2].Value.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out decimal size)) sizes.Add(size);
            if (match.Groups[1].Value == "D") outer = true;
        }
        foreach (CatalogCardVariant option in variants)
        foreach (Match match in LabeledDiameter().Matches(option.Label))
        {
            if (decimal.TryParse(match.Groups[2].Value.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out decimal size)) sizes.Add(size);
            if (match.Groups[1].Value == "Ø") outer = true;
        }
        if (sizes.Count > 1)
            return outer ? $"Dış çap aralığı: Ø{Number(sizes.Min)}–{Number(sizes.Max)} mm" : $"Bağlantı çap aralığı: DN{Number(sizes.Min)}–DN{Number(sizes.Max)}";
        var byUnit = new Dictionary<string, SortedSet<decimal>>(StringComparer.OrdinalIgnoreCase);
        var threads = new SortedSet<int>();
        var inches = new SortedSet<decimal>();
        foreach (CatalogCardVariant option in variants)
        foreach (Match match in InchSize().Matches(option.Label))
        {
            string wholeText = match.Groups[1].Success ? match.Groups[1].Value : match.Groups[4].Value;
            decimal whole = wholeText.Length > 0 ? decimal.Parse(wholeText, CultureInfo.InvariantCulture) : 0m;
            decimal fraction = match.Groups[2].Success
                ? decimal.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture) / decimal.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture)
                : match.Groups[5].Value switch { "½" => 0.5m, "¼" => 0.25m, "¾" => 0.75m, _ => 0m };
            if (whole + fraction > 0m) inches.Add(whole + fraction);
        }
        foreach (CatalogCardVariant option in variants)
        foreach (Match match in ThreadSize().Matches(option.Label)) threads.Add(int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture));
        foreach (CatalogCardVariant option in variants)
        foreach (Match match in DimensionWithUnit().Matches(option.Label))
        {
            string unit = match.Groups[2].Value;
            if (!byUnit.TryGetValue(unit, out SortedSet<decimal>? values)) byUnit[unit] = values = [];
            string number = match.Groups[1].Value;
            if (Thousands().IsMatch(number)) number = number.Replace(".", "", StringComparison.Ordinal);
            if (decimal.TryParse(number.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out decimal size)) values.Add(size);
        }
        IEnumerable<string> ranges = byUnit.Where(x => x.Value.Count > 1).Select(x => $"Ölçü aralığı: {Number(x.Value.Min)}–{Number(x.Value.Max)} {x.Key}");
        if (threads.Count > 1) ranges = ranges.Prepend($"Vida ölçüsü: M{threads.Min}–M{threads.Max}");
        if (inches.Count > 1) ranges = ranges.Prepend($"Diş / bağlantı ölçüsü aralığı: {Number(inches.Min)}–{Number(inches.Max)} inç");
        return string.Join(" · ", ranges);
    }

    private static string Number(decimal value) => value.ToString("0.###", CultureInfo.InvariantCulture);
    [GeneratedRegex(@"\bYENİ KART\s*[.:]\s*", RegexOptions.IgnoreCase)]
    private static partial Regex NewCardPrefix();
    [GeneratedRegex(@"\([^()]*(?:eklendi|taslak|düzeltme|düzeltildi|kaldırıldı)[^()]*\)", RegexOptions.IgnoreCase)]
    private static partial Regex EditorialParenthesis();
    [GeneratedRegex(@"[;,]\s*(?:önceki taslak|standardLength|variantMode|cardType|unit\b|çap varyantları|(?:listede|katalogda)\s+[^.;]*(?:eksikti|yoktu|bulunmuyordu)|eksikti)[^.]*\.?", RegexOptions.IgnoreCase)]
    private static partial Regex EditorialTail();
    [GeneratedRegex(@"(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])")]
    private static partial Regex SentenceBoundary();
    [GeneratedRegex(@"DÜZELTME:|DÜZELTİLDİ|\bEK:|taslak|eklendi|eksikti|listede yoktu|bulunmuyordu|hizalandı|netleştirildi|kodlama doğru|standardLength|variantMode|cardType|\bslug\b|tüm variant|özgün açıklamaları|ayrı karttadır|kartından farklı|kullanıldı", RegexOptions.IgnoreCase)]
    private static partial Regex EditorialLanguage();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
    [GeneratedRegex(@"^(DN|D)\s*(\d+(?:[.,]\d+)?)$", RegexOptions.IgnoreCase)]
    private static partial Regex Diameter();
    [GeneratedRegex(@"(DN|Ø)\s*(\d+(?:[.,]\d+)?)(?=mm\b|\b)", RegexOptions.IgnoreCase)]
    private static partial Regex LabeledDiameter();
    [GeneratedRegex("(?<![\\d/])(?:(\\d+)\\s+)?(\\d+)/(\\d+)\\s*\"|(?<![\\d/])(\\d+)?([½¼¾])?\\s*\"")]
    private static partial Regex InchSize();
    [GeneratedRegex(@"(?<![\d.,])(\d+(?:[.,]\d+)*)\s*(mm|cm|kW|m³/h|m3/h|litre|L|bar|kg|m|CFM|N|kcal/h)\b", RegexOptions.IgnoreCase)]
    private static partial Regex DimensionWithUnit();
    [GeneratedRegex(@"^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$")]
    private static partial Regex Thousands();
    [GeneratedRegex(@"\bM(\d+)\b")]
    private static partial Regex ThreadSize();
}
