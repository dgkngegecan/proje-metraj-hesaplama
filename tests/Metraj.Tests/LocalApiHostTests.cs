using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using System.Text.Json;
using Metraj.Application;
using Metraj.Api;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

public sealed class LocalApiHostTests
{
    [Fact]
    public async Task LoopbackHostServesEmbeddedReactApplicationAndExistingWorkspaces()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-local-api");
        string databasePath = database.Path;
        await using LocalApiHost host = await LocalApiHost.StartAsync(databasePath);
        using var client = new HttpClient { BaseAddress = host.BaseUri };

        HttpResponseMessage healthResponse = await client.GetAsync("api/health");
        Assert.Equal(HttpStatusCode.OK, healthResponse.StatusCode);

        HttpResponseMessage projectResponse = await client.PostAsJsonAsync("api/projects", new
        {
            code = "P-REACT-API",
            name = "React arayüz testi",
            description = "Yerel API testi"
        });
        Assert.Equal(HttpStatusCode.OK, projectResponse.StatusCode);

        string projects = await client.GetStringAsync("api/projects");
        Assert.Contains("P-REACT-API", projects, StringComparison.Ordinal);

        string indexHtml = await client.GetStringAsync("/");
        Assert.Contains("id=\"root\"", indexHtml, StringComparison.Ordinal);
        Match assetMatch = Regex.Match(indexHtml, "(?:src|href)=\"(?<path>/assets/[^\"]+)\"");
        Assert.True(assetMatch.Success, "Gömülü React başlangıç dosyasında bir varlık yolu bulunamadı.");

        HttpResponseMessage assetResponse = await client.GetAsync(assetMatch.Groups["path"].Value);
        Assert.Equal(HttpStatusCode.OK, assetResponse.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(await assetResponse.Content.ReadAsStringAsync()));

        HttpResponseMessage faviconResponse = await client.GetAsync("favicon.ico");
        Assert.Equal(HttpStatusCode.OK, faviconResponse.StatusCode);
        Assert.True((await faviconResponse.Content.ReadAsByteArrayAsync()).Length > 0);

        HttpResponseMessage spaRoute = await client.GetAsync("flow");
        Assert.Equal(HttpStatusCode.OK, spaRoute.StatusCode);
        Assert.Contains("id=\"root\"", await spaRoute.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task MeasurementBatchEndpointWritesAllRowsAtomicallyAndPreservesVariants()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-local-api-batch");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-BATCH", "Toplu metraj API testi");
        CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "PIPE-BATCH", "Toplu giriş borusu", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, pipeCard.LatestVersionId));

        await using LocalApiHost host = await LocalApiHost.StartAsync(databasePath);
        using var client = new HttpClient { BaseAddress = host.BaseUri };
        HttpResponseMessage validResponse = await client.PostAsJsonAsync(
            $"api/revisions/{project.LatestRevisionId}/measurements/batch",
            new[]
            {
                new { placementId = pipe.Id, inputQuantity = 4.25m, inputUnit = "m", sourceKind = "USER", variant = "DN25", secondaryVariant = "Hat A" },
                new { placementId = pipe.Id, inputQuantity = 5.75m, inputUnit = "m", sourceKind = "USER", variant = "DN25", secondaryVariant = "Hat A" }
            });
        Assert.Equal(HttpStatusCode.OK, validResponse.StatusCode);
        JsonElement validPayload = await validResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, validPayload.GetArrayLength());

        IReadOnlyList<MeasurementListItem> afterValidBatch = await measurements.ListMeasurementsAsync(project.LatestRevisionId);
        Assert.Equal(2, afterValidBatch.Count);
        Assert.All(afterValidBatch, item =>
        {
            Assert.Equal("DN25", item.Variant);
            Assert.Equal("Hat A", item.SecondaryVariant);
        });

        HttpResponseMessage invalidResponse = await client.PostAsJsonAsync(
            $"api/revisions/{project.LatestRevisionId}/measurements/batch",
            new[]
            {
                new { placementId = pipe.Id, inputQuantity = 3m, inputUnit = "m", sourceKind = "USER", variant = "DN32" },
                new { placementId = pipe.Id, inputQuantity = -1m, inputUnit = "m", sourceKind = "USER", variant = "DN32" }
            });
        Assert.Equal(HttpStatusCode.BadRequest, invalidResponse.StatusCode);
        Assert.Equal(2, (await measurements.ListMeasurementsAsync(project.LatestRevisionId)).Count);
    }
}
