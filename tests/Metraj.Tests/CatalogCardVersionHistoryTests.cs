using System.Text.Json;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Host;
using Xunit;

namespace Metraj.Tests;

/// <summary><c>GET /api/catalog/cards/{cardId}/versions</c>: kartın değişmez sürüm geçmişi.</summary>
public sealed class CatalogCardVersionHistoryTests
{
    private static CatalogCardDraft Pipe(string name, decimal waste) => new(
        "PIPE-HISTORY", name, CardType.Material, ItemKind.Material, InputBehavior.Manual,
        SalesConversion.StandardLength, ReportBehavior.Measurable, "m", WasteRatePct: waste, ContainerParameter: 6m);

    [Fact]
    public async Task VersionsAreListedNewestFirstWithUsageAndUtcTimestamps()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-card-history");
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);
        CatalogCardListItem first = await services.Catalog.CreateCardAsync(Pipe("Tarih borusu", 5m));
        ProjectListItem project = await services.Projects.CreateProjectAsync("P-HISTORY", "Sürüm geçmişi");
        await services.ProjectTree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, first.LatestVersionId));
        await services.ProjectTree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, first.LatestVersionId));
        CatalogCardListItem second = await services.Catalog.CreateVersionAsync(first.Id, Pipe("Tarih borusu (yeni)", 7.5m));

        RouterResponse response = await router.DispatchAsync(
            new RouterRequest("GET", $"/api/catalog/cards/{first.Id}/versions", null, null, null), CancellationToken.None);
        Assert.Equal(200, response.Status);
        CatalogCardVersionItem[] versions =
            JsonSerializer.Deserialize<CatalogCardVersionItem[]>(response.BodyJson!, MetrajRequestRouter.SerializerOptions)!;

        Assert.Equal([2, 1], versions.Select(x => x.VersionNumber));
        Assert.Equal([second.LatestVersionId, first.LatestVersionId], versions.Select(x => x.Id));
        Assert.All(versions, x => Assert.Equal(first.Id, x.CardId));
        Assert.Equal([true, false], versions.Select(x => x.IsLatest));
        Assert.Equal(["Tarih borusu (yeni)", "Tarih borusu"], versions.Select(x => x.Name));
        Assert.Equal([7.5m, 5m], versions.Select(x => x.WasteRatePct));
        Assert.Equal([0, 2], versions.Select(x => x.PlacementCount));
        Assert.True(versions[0].CreatedAtUtc >= versions[1].CreatedAtUtc);

        using var body = JsonDocument.Parse(response.BodyJson!);
        Assert.All(body.RootElement.EnumerateArray(), item =>
            Assert.EndsWith("Z", item.GetProperty("createdAtUtc").GetString(), StringComparison.Ordinal));
        // Kart notu sürüme ait değildir; geçmişte yer almaz.
        Assert.False(body.RootElement[0].TryGetProperty("notes", out _));
    }

    [Fact]
    public async Task UnknownCardIsARuleViolationAndAMalformedIdIsNotFound()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-card-history-missing");
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);

        RouterResponse unknown = await router.DispatchAsync(
            new RouterRequest("GET", $"/api/catalog/cards/{Guid.NewGuid()}/versions", null, null, null), CancellationToken.None);
        Assert.Equal(400, unknown.Status);
        Assert.Contains("catalog.definition", unknown.BodyJson, StringComparison.Ordinal);

        RouterResponse malformed = await router.DispatchAsync(
            new RouterRequest("GET", "/api/catalog/cards/kart/versions", null, null, null), CancellationToken.None);
        Assert.Equal(404, malformed.Status);
    }
}
