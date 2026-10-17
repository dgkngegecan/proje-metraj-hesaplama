using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Metraj.Host;

namespace Metraj.Mobile.Bridge;

/// <summary>JS'den gelen bir köprü mesajı.</summary>
/// <param name="Kind">"request" ya da "command".</param>
/// <param name="Id">Yanıtın eşleştirileceği kimlik.</param>
/// <param name="Method">İstek yöntemi (büyük harf).</param>
/// <param name="Path">"/api/..." yolu ve sorgusu.</param>
/// <param name="Body">İstek gövdesi (JSON metni) ya da <see langword="null"/>.</param>
/// <param name="Command">Komut adı.</param>
/// <param name="Handle">share/saveAs için <c>args.handle</c>.</param>
/// <param name="HapticKind">haptic için <c>args.kind</c>.</param>
internal sealed record BridgeInbound(
    string Kind, string Id, string? Method, string? Path, string? Body, string? Command, string? Handle, string? HapticKind);

/// <summary>
/// Köprü sözleşmesinin (docs/android-mobil-plan.md → "Köprü sözleşmesi") yerel tarafı.
/// </summary>
/// <remarks>
/// JSON elle okunup yazılır (JsonDocument / Utf8JsonWriter): yansımalı
/// serileştirme kırpılmış AOT derlemede ek tür bilgisi ister ve bu sıcak yolda
/// gereksiz. Alan adları JS tarafındaki <c>src/lib/transport.ts</c> ile harfiyen aynı:
/// <code>
/// istek  {"type":"request","id","method","path","body":"&lt;JSON metni&gt;"|null}
/// yanıt  {"type":"response","id","status","contentType","body":"&lt;JSON metni&gt;"|null,"file":null|{handle,name,mime,size}}
/// komut  {"type":"command","id","command","args":{...}}
/// olay   {"type":"event","event":"back|pause|resume"}
/// </code>
/// <c>body</c> bir JSON METNİDİR (ikinci kez kodlanmış dize), nesne değil.
/// </remarks>
internal static class BridgeProtocol
{
    /// <summary>Türkçe karakterler \uXXXX'e kaçırılmaz (router'ın kendi ayarıyla aynı); mesaj HTML'e gömülmez.</summary>
    private static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>Gelen mesajı ayrıştırır; sözleşmeye uymuyorsa nedenini döner.</summary>
    public static BridgeInbound? Parse(string? raw, out string? error)
    {
        error = null;
        if (string.IsNullOrEmpty(raw))
        {
            error = "boş mesaj";
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                error = "nesne değil";
                return null;
            }

            string? type = ReadString(root, "type");
            string? id = ReadString(root, "id");
            if (string.IsNullOrEmpty(id))
            {
                error = "id yok";
                return null;
            }

            switch (type)
            {
                case "request":
                    return new BridgeInbound("request", id, ReadString(root, "method")?.ToUpperInvariant(), ReadString(root, "path"),
                        ReadBody(root), null, null, null);
                case "command":
                    string? handle = null;
                    string? hapticKind = null;
                    if (root.TryGetProperty("args", out JsonElement args) && args.ValueKind == JsonValueKind.Object)
                    {
                        handle = ReadString(args, "handle");
                        hapticKind = ReadString(args, "kind");
                    }

                    return new BridgeInbound("command", id, null, null, null, ReadString(root, "command"), handle, hapticKind);
                default:
                    error = $"bilinmeyen tür: {type}";
                    return null;
            }
        }
        catch (JsonException exception)
        {
            error = $"JSON ayrıştırılamadı: {exception.Message}";
            return null;
        }
    }

    /// <summary>Router yanıtını köprü yanıtına çevirir (dosya varsa tutamaçla).</summary>
    public static string Response(string id, RouterResponse response, ExportedFile? file) =>
        Write(writer =>
        {
            writer.WriteString("type", "response");
            writer.WriteString("id", id);
            writer.WriteNumber("status", response.Status);
            writer.WriteString("contentType", response.ContentType);
            if (response.BodyJson is null) writer.WriteNull("body");
            else writer.WriteString("body", response.BodyJson);
            if (file is null)
            {
                writer.WriteNull("file");
            }
            else
            {
                writer.WriteStartObject("file");
                writer.WriteString("handle", file.Handle);
                writer.WriteString("name", file.Name);
                writer.WriteString("mime", file.Mime);
                writer.WriteNumber("size", file.Size);
                writer.WriteEndObject();
            }
        });

    /// <summary>Gövdesiz bir yanıt (ör. dosya seçiminden vazgeçme: 204).</summary>
    public static string Empty(string id, int status) =>
        Response(id, new RouterResponse(status, string.Empty, null, null), null);

    /// <summary>Router'ın hata sözleşmesiyle aynı biçimde bir hata yanıtı: <c>{"message","rule"}</c>.</summary>
    public static string Error(string id, int status, string message, string rule)
    {
        string body = Write(writer =>
        {
            writer.WriteString("message", message);
            writer.WriteString("rule", rule);
        });
        return Response(id, new RouterResponse(status, "application/json; charset=utf-8", body, null), null);
    }

    /// <summary>Yerel olay: back, pause, resume.</summary>
    public static string Event(string name) =>
        Write(writer =>
        {
            writer.WriteString("type", "event");
            writer.WriteString("event", name);
        });

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    /// <summary>
    /// Sözleşmede gövde bir JSON metnidir. JS yanlışlıkla nesne gönderirse ham
    /// metni kullanılır (transport.ts'in gelen yanıtlarda yaptığı hoşgörünün aynısı).
    /// </summary>
    private static string? ReadBody(JsonElement root)
    {
        if (!root.TryGetProperty("body", out JsonElement body)) return null;
        return body.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => body.GetString(),
            _ => body.GetRawText()
        };
    }

    private static string Write(Action<Utf8JsonWriter> body)
    {
        var buffer = new ArrayBufferWriter<byte>(256);
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            body(writer);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}
