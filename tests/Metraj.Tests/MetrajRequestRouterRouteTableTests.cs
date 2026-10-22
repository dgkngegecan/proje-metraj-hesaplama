using System.Reflection;
using System.Text.Json;
using Metraj.Domain;
using Metraj.Host;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Router'ın rota tablosu ve JSON ayarları, eski minimal API'nin tanımladıklarıyla
/// birebir aynı olmalı.
/// </summary>
public sealed class MetrajRequestRouterRouteTableTests
{
    /// <summary>
    /// LocalApiHost'un minimal API tanımlarından (refaktör öncesi) elle çıkarılmış
    /// 67 uç nokta ve sonradan eklenen kart sürüm geçmişi (GET .../versions), toplam 68.
    /// Bilerek rota tablosundan TÜRETİLMEDİ: tablo bir ucu kaybeder,
    /// kısıtını düşürür ya da yöntemini değiştirirse bu liste onu yakalar.
    /// </summary>
    private static readonly (string Method, string Template)[] ExpectedRoutes =
    [
        ("GET", "/api/health"),
        ("GET", "/api/projects"),
        ("POST", "/api/projects"),
        ("GET", "/api/projects/{projectId:guid}/revisions"),
        ("POST", "/api/projects/{projectId:guid}/revisions"),
        ("POST", "/api/revisions/{revisionId:guid}/approve"),
        ("GET", "/api/catalog/cards"),
        ("GET", "/api/catalog/attributes"),
        ("GET", "/api/catalog/types"),
        ("POST", "/api/catalog/types"),
        ("DELETE", "/api/catalog/types/{typeId:guid}"),
        ("POST", "/api/catalog/starter-pack"),
        ("POST", "/api/catalog/cards"),
        ("GET", "/api/catalog/cards/{cardId:guid}/versions"),
        ("POST", "/api/catalog/cards/{cardId:guid}/versions"),
        ("POST", "/api/catalog/cards/{cardId:guid}/deactivate"),
        ("DELETE", "/api/catalog/cards/{cardId:guid}"),
        ("GET", "/api/placements/{pipePlacementId:guid}/compatible-fittings"),
        ("GET", "/api/settings/material-waste"),
        ("PUT", "/api/settings/material-waste"),
        ("DELETE", "/api/settings/material-waste/{id:guid}"),
        ("GET", "/api/revisions/{revisionId:guid}/placements"),
        ("POST", "/api/revisions/{revisionId:guid}/placements"),
        ("PUT", "/api/placements/{placementId:guid}"),
        ("PUT", "/api/placements/{placementId:guid}/parent"),
        ("POST", "/api/placements/{placementId:guid}/calculated-from"),
        ("DELETE", "/api/placements/{placementId:guid}"),
        ("GET", "/api/placements/{placementId:guid}/context-notes"),
        ("POST", "/api/placements/{placementId:guid}/context-notes"),
        ("DELETE", "/api/placement-context-notes/{noteId:guid}"),
        ("DELETE", "/api/placements/{placementId:guid}/context-notes/{noteId:guid}"),
        ("GET", "/api/revisions/{revisionId:guid}/measurements"),
        ("GET", "/api/revisions/{revisionId:guid}/measurement-summaries"),
        ("POST", "/api/revisions/{revisionId:guid}/measurements"),
        ("POST", "/api/revisions/{revisionId:guid}/measurements/batch"),
        ("POST", "/api/measurements/{measurementId:guid}/duplicate"),
        ("DELETE", "/api/measurements/{measurementId:guid}"),
        ("PUT", "/api/measurements/{measurementId:guid}"),
        ("GET", "/api/revisions/{revisionId:guid}/calculations/rules"),
        ("POST", "/api/revisions/{revisionId:guid}/calculations/rules"),
        ("GET", "/api/revisions/{revisionId:guid}/calculations/results"),
        ("POST", "/api/revisions/{revisionId:guid}/calculations/results"),
        ("POST", "/api/calculations/results/{resultId:guid}/approve"),
        ("POST", "/api/calculations/results/{resultId:guid}/reject"),
        ("POST", "/api/calculations/results/{resultId:guid}/override"),
        ("GET", "/api/revisions/{revisionId:guid}/responsibilities"),
        ("POST", "/api/revisions/{revisionId:guid}/responsibilities/dimensions"),
        ("POST", "/api/revisions/{revisionId:guid}/responsibilities/parties"),
        ("POST", "/api/revisions/{revisionId:guid}/responsibilities/assignments"),
        ("GET", "/api/revisions/{revisionId:guid}/report"),
        ("GET", "/api/revisions/{revisionId:guid}/report/excel"),
        ("GET", "/api/revisions/{revisionId:guid}/report/pdf"),
        ("GET", "/api/revisions/{revisionId:guid}/report/word"),
        ("GET", "/api/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}"),
        ("GET", "/api/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/excel"),
        ("GET", "/api/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/pdf"),
        ("GET", "/api/revisions/{revisionId:guid}/report/subtree/{rootPlacementId:guid}/word"),
        ("POST", "/api/synthetic-clean-water"),
        ("GET", "/api/ui-state"),
        ("PUT", "/api/ui-state"),
        ("DELETE", "/api/ui-state"),
        ("GET", "/api/database/backups"),
        ("POST", "/api/database/backups"),
        ("POST", "/api/database/backups/restore"),
        ("GET", "/api/database/integrity"),
        ("DELETE", "/api/database/projects"),
        ("GET", "/api/workspace/export"),
        ("POST", "/api/workspace/import")
    ];

    [Fact]
    public void RouteTableContainsExactlyTheSixtyEightEndpoints()
    {
        Assert.Equal(68, ExpectedRoutes.Length);
        Assert.Equal(ExpectedRoutes.Length, ExpectedRoutes.Distinct().Count());

        var actual = MetrajRequestRouter.Routes.Select(route => (route.Method, route.Template)).ToList();
        string[] missing = ExpectedRoutes.Except(actual).Select(route => $"{route.Method} {route.Template}").ToArray();
        string[] unexpected = actual.Except(ExpectedRoutes).Select(route => $"{route.Method} {route.Template}").ToArray();

        Assert.True(missing.Length == 0, $"Router tablosunda eksik uçlar: {string.Join(", ", missing)}");
        Assert.True(unexpected.Length == 0, $"Router tablosunda beklenmeyen uçlar: {string.Join(", ", unexpected)}");
        Assert.Equal(ExpectedRoutes.Length, actual.Count);
    }

    [Fact]
    public void NoTwoRoutesCanMatchTheSameRequest()
    {
        // Minimal API'de belirsiz eşleşme (AmbiguousMatchException) 500 üretirdi; router
        // ilk eşleşeni seçer. Tabloda böyle bir çift olmadığı sürece ikisi aynıdır.
        RouterRoute[] routes = MetrajRequestRouter.Routes.ToArray();
        for (int left = 0; left < routes.Length; left++)
        {
            for (int right = left + 1; right < routes.Length; right++)
            {
                if (!string.Equals(routes[left].Method, routes[right].Method, StringComparison.Ordinal)) continue;
                string[] a = routes[left].Template.Split('/');
                string[] b = routes[right].Template.Split('/');
                bool overlaps = a.Length == b.Length && a.Zip(b).All(pair =>
                    pair.First.StartsWith('{') || pair.Second.StartsWith('{') ||
                    string.Equals(pair.First, pair.Second, StringComparison.OrdinalIgnoreCase));
                Assert.False(overlaps, $"Belirsiz rota çifti: {routes[left]} / {routes[right]}");
            }
        }
    }

    [Fact]
    public void JsonOptionsMatchTheMinimalApiDefaultsTheEndpointsUsedToRunWith()
    {
        // Eski LocalApiHost, ASP.NET Core'un JsonOptions varsayılanına yalnız camelCase
        // ve adla okunan enum dönüştürücüsünü ekliyordu.
        JsonSerializerOptions expected = new Microsoft.AspNetCore.Http.Json.JsonOptions().SerializerOptions;
        JsonSerializerOptions actual = MetrajRequestRouter.SerializerOptions;
        string[] ignored = ["Converters", "TypeInfoResolver", "TypeInfoResolverChain", "IsReadOnly"];

        foreach (PropertyInfo property in typeof(JsonSerializerOptions).GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (property.GetIndexParameters().Length > 0 || ignored.Contains(property.Name, StringComparer.Ordinal)) continue;
            object? expectedValue = property.GetValue(expected);
            object? actualValue = property.GetValue(actual);
            if (expectedValue is not null && expectedValue.GetType().IsClass && expectedValue is not string)
            {
                // Politika/kodlayıcı nesneleri: aynı tür (ör. JsonCamelCaseNamingPolicy, relaxed encoder).
                Assert.True(expectedValue.GetType() == actualValue?.GetType(),
                    $"{property.Name}: beklenen {expectedValue.GetType().Name}, bulunan {actualValue?.GetType().Name ?? "null"}");
                continue;
            }

            Assert.True(Equals(expectedValue, actualValue), $"{property.Name}: beklenen {expectedValue}, bulunan {actualValue}");
        }

        // Numaralandırmalar yalnız adla yazılır ve okunur.
        Assert.Equal("\"Material\"", JsonSerializer.Serialize(CardType.Material, actual));
        Assert.Equal(CardType.Material, JsonSerializer.Deserialize<CardType>("\"material\"", actual));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CardType>("0", actual));
        // Türkçe karakterler kaçırılmaz.
        Assert.Equal("\"Şişli Ğ\"", JsonSerializer.Serialize("Şişli Ğ", actual));
    }
}
