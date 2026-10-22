namespace Metraj.Host;

/// <summary>Taşıma katmanından bağımsız tek bir yerel API isteği.</summary>
/// <remarks>
/// Masaüstünde Kestrel adaptörü (LocalApiHost) HTTP isteğini, Android'de WebView
/// köprüsü JS mesajını bu biçime çevirir. Router HTTP'ye özgü hiçbir şeyi
/// (başlık, bağlantı, akış) bilmez; böylece iki platform aynı rota tablosunu
/// ve aynı hata sözleşmesini paylaşır.
/// </remarks>
/// <param name="Method">HTTP yöntemi: GET, POST, PUT, DELETE. Büyük/küçük harf duyarsız.</param>
/// <param name="PathAndQuery">
/// "/api/..." ile başlayan yol ve isteğe bağlı sorgu ("?key=a"). Yol bölümleri ve
/// sorgu yüzde kodlamalı olabilir; router her birini BİR KEZ çözer.
/// </param>
/// <param name="BodyJson">
/// İstek gövdesinin metni; gövde yoksa <see langword="null"/>. Boş olmayan bir gövde
/// için <paramref name="ContentType"/> JSON değilse router 415 döner (minimal API
/// davranışı). <see langword="null"/> ile boş metin farklıdır: boş metin "gövde var
/// ama JSON değil" demektir ve JSON bekleyen uçta 400 üretir.
/// </param>
/// <param name="BodyStream">
/// Yalnız <c>/api/workspace/import</c> için: yüklenen .metraj dosyasının HAM içeriğini
/// açan fabrika (multipart değil). Kestrel adaptörü multipart'ı kendisi açar; Android
/// SAF akışını verir. Router akışı bir kez açar ve kapatır. Dosya yoksa <see langword="null"/>.
/// </param>
/// <param name="ContentType">Gövdenin içerik türü; JSON gövde için <c>application/json</c>.</param>
public sealed record RouterRequest(string Method, string PathAndQuery, string? BodyJson, Func<Stream>? BodyStream, string? ContentType);

/// <summary>Router yanıtı.</summary>
/// <param name="Status">HTTP durum kodu (200, 204, 400, 404, 405, 415, 500).</param>
/// <param name="ContentType">
/// Gövdenin içerik türü (JSON için <c>application/json; charset=utf-8</c>); gövdesiz
/// yanıtlarda boş metin.
/// </param>
/// <param name="BodyJson">JSON gövde; 204 ve bağlama hataları gibi gövdesiz yanıtlarda <see langword="null"/>.</param>
/// <param name="File">
/// İkili içerik (rapor, .metraj). Bellekte taşınmaz: router diske yazar ve yolunu
/// döner; tüketici dosyayı akıtır ve <see cref="RouterFile.DeleteWhenDone"/> ise siler.
/// </param>
public sealed record RouterResponse(int Status, string ContentType, string? BodyJson, RouterFile? File)
{
    /// <summary>405 yanıtında desteklenen yöntemler ("GET, POST"); HTTP <c>Allow</c> başlığına yazılır.</summary>
    /// <remarks>
    /// Konumsal sözleşmenin dışında, isteğe bağlı bir ek: minimal API 405 ile birlikte
    /// Allow başlığı gönderiyordu ve masaüstü adaptörü bunu korumak zorunda.
    /// </remarks>
    public string? Allow { get; init; }
}

/// <summary>Diske yazılmış bir indirme.</summary>
/// <param name="Path">Dosyanın tam yolu (genellikle geçici klasörde).</param>
/// <param name="ContentType">İndirmenin MIME türü.</param>
/// <param name="DownloadName">Kullanıcıya önerilecek dosya adı.</param>
/// <param name="DeleteWhenDone">Tüketici dosyayı gönderdikten (veya gönderemedikten) sonra silmeli mi.</param>
public sealed record RouterFile(string Path, string ContentType, string DownloadName, bool DeleteWhenDone);

/// <summary>Rota tablosundaki bir uç nokta.</summary>
/// <param name="Method">HTTP yöntemi.</param>
/// <param name="Template">Kısıtlarıyla birlikte yol şablonu, ör. <c>/api/projects/{projectId:guid}/revisions</c>.</param>
public sealed record RouterRoute(string Method, string Template);

/// <summary>Bir isteğin gövdesinin nasıl okunacağı; HTTP adaptörü gövdeyi buna göre hazırlar.</summary>
public enum RouterBodyKind
{
    /// <summary>Uç gövde beklemiyor (veya istek hiçbir uca eşleşmiyor): gövde okunmaz.</summary>
    None = 0,

    /// <summary>Uç bir JSON gövde bekliyor: <see cref="RouterRequest.BodyJson"/>.</summary>
    Json = 1,

    /// <summary>Uç ham bir dosya akışı bekliyor: <see cref="RouterRequest.BodyStream"/>.</summary>
    File = 2
}
