using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Metraj.Api;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Cross-layer acceptance regressions for the most important desktop workflows.
/// These tests intentionally use a real temporary SQLite database rather than mocks.
/// </summary>
public sealed class OverallFunctionalAcceptanceTests
{
    [Fact]
    public async Task SeededCardCanReceiveNativeAttributesWithoutCustomTypeAndNewVersionDrivesCalculations()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-native-attributes-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            var starter = new StarterCatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var catalog = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
            await starter.SeedAsync();

            CatalogCardListItem seeded = Assert.Single(
                await catalog.ListCardsAsync(), card => card.Code == "STD-EQ-BOILER");
            Assert.Null(seeded.CustomTypeId);

            CatalogCardListItem edited = await catalog.CreateVersionAsync(seeded.Id, new CatalogCardDraft(
                seeded.Code,
                "Doğalgazlı Kazan / Gas Boiler — düzenlendi",
                seeded.CardType,
                ItemKind.Equipment,
                seeded.InputBehavior,
                SalesConversion.Package,
                seeded.ReportBehavior,
                seeded.Unit,
                WasteRatePct: 0m,
                ContainerParameter: null,
                Notes: seeded.Notes,
                MaterialType: seeded.MaterialType,
                CustomTypeId: null,
                AttributeValues: new Dictionary<string, string>
                {
                    ["WasteRatePct"] = "10",
                    ["ContainerParameter"] = "4",
                    ["Notes"] = "Sistem kartı kullanıcı tarafından düzenlendi"
                }));

            Assert.Equal(2, edited.LatestVersion);
            Assert.Null(edited.CustomTypeId);
            Assert.Equal(10m, edited.WasteRatePct);
            Assert.Equal(4m, edited.ContainerParameter);
            Assert.Equal("Sistem kartı kullanıcı tarafından düzenlendi", edited.Notes);
            Assert.Equal("10", edited.AttributeValues!["WasteRatePct"]);

            ProjectListItem project = await projects.CreateProjectAsync("NATIVE-ATTR", "Yerleşik kart düzenleme kabulü");
            PlacementListItem placement = await tree.AddPlacementAsync(new(project.LatestRevisionId, edited.LatestVersionId));
            await measurements.CreateMeasurementAsync(new(project.LatestRevisionId, placement.Id, 9m, "adet"));

            MeasurementSummaryItem summary = Assert.Single(await measurements.ListSummariesAsync(project.LatestRevisionId));
            Assert.Equal(9m, summary.NetQuantity);
            Assert.Equal(9.9m, summary.WithWasteQuantity);
            Assert.Equal(3m, summary.PurchaseQuantity);
            Assert.Equal(10m, summary.AppliedWasteRatePct);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            DeleteDatabaseFiles(databasePath);
        }
    }

    [Fact]
    public async Task LocalApiCompletesProjectMeasurementReportAndRevisionLockWorkflow()
    {
        string databasePath = Path.Combine(Path.GetTempPath(), $"metraj-api-acceptance-{Guid.NewGuid():N}.db");
        try
        {
            await using (MetrajDbContext context = MetrajDbContextFactory.Create(databasePath))
            {
                await ApplicationSchemaMigrator.MigrateAsync(context);
            }

            await using LocalApiHost host = await LocalApiHost.StartAsync(databasePath);
            using var client = new HttpClient { BaseAddress = host.BaseUri, Timeout = TimeSpan.FromSeconds(30) };

            JsonElement project = await PostJsonAsync(client, "api/projects", new
            {
                code = "API-UAT",
                name = "HTTP uçtan uca kabul",
                description = "Geçici SQLite verisi"
            });
            Guid revisionId = project.GetProperty("latestRevisionId").GetGuid();

            JsonElement card = await PostJsonAsync(client, "api/catalog/cards", new
            {
                code = "API-PIPE",
                name = "API test borusu",
                cardType = "Material",
                unit = "m",
                inputBehavior = "Manual",
                salesConversion = "StandardLength",
                reportBehavior = "Measurable",
                wasteRatePct = 5m,
                containerParameter = 6m,
                materialType = "API Boru"
            });
            Guid cardId = card.GetProperty("id").GetGuid();
            JsonElement editedCard = await PostJsonAsync(client, $"api/catalog/cards/{cardId}/versions", new
            {
                code = "API-PIPE",
                name = "API test borusu — düzenlendi",
                cardType = "Material",
                unit = "m",
                inputBehavior = "Manual",
                salesConversion = "StandardLength",
                reportBehavior = "Measurable",
                wasteRatePct = 0m,
                containerParameter = 6m,
                materialType = "API Boru",
                customTypeId = (Guid?)null,
                attributeValues = new Dictionary<string, string> { ["WasteRatePct"] = "7,5" }
            });
            Assert.Equal(7.5m, editedCard.GetProperty("wasteRatePct").GetDecimal());
            Guid cardVersionId = editedCard.GetProperty("latestVersionId").GetGuid();

            JsonElement placement = await PostJsonAsync(client, $"api/revisions/{revisionId}/placements", new
            {
                cardVersionId,
                parentPlacementId = (Guid?)null,
                displayNameOverride = "A Blok API Borusu",
                procurementScope = "Biz"
            });
            Guid placementId = placement.GetProperty("id").GetGuid();

            JsonElement firstMeasurement = await PostJsonAsync(client, $"api/revisions/{revisionId}/measurements", new
            {
                placementId,
                inputQuantity = 4.25m,
                inputUnit = "m",
                block = "A",
                floor = "1",
                room = "101",
                zone = "Z1",
                sheet = "M-01",
                drawingRevision = "R0",
                notes = "İlk ölçüm",
                sourceKind = "USER",
                variant = "DN25",
                secondaryVariant = (string?)null
            });
            Guid firstMeasurementId = firstMeasurement.GetProperty("id").GetGuid();

            await PostJsonAsync(client, $"api/revisions/{revisionId}/measurements", new
            {
                placementId,
                inputQuantity = 7.75m,
                inputUnit = "m",
                block = "A",
                floor = "1",
                room = "102",
                zone = (string?)null,
                sheet = "M-01",
                drawingRevision = "R0",
                notes = "İkinci ölçüm",
                sourceKind = "USER",
                variant = "DN25",
                secondaryVariant = (string?)null
            });

            JsonElement summaries = await GetJsonAsync(client, $"api/revisions/{revisionId}/measurement-summaries");
            JsonElement summary = Assert.Single(summaries.EnumerateArray());
            Assert.Equal(12m, summary.GetProperty("netQuantity").GetDecimal());
            Assert.Equal(12.9m, summary.GetProperty("withWasteQuantity").GetDecimal());
            Assert.Equal(3m, summary.GetProperty("purchaseQuantity").GetDecimal());
            Assert.Equal(2, summary.GetProperty("measurementCount").GetInt32());

            JsonElement report = await GetJsonAsync(client, $"api/revisions/{revisionId}/report");
            Assert.Equal(2, report.GetProperty("sourceMeasurements").GetArrayLength());
            Assert.Single(report.GetProperty("summaries").EnumerateArray());

            await AssertDownloadAsync(client, $"api/revisions/{revisionId}/report/excel", "PK");
            await AssertDownloadAsync(client, $"api/revisions/{revisionId}/report/word", "PK");
            await AssertDownloadAsync(client, $"api/revisions/{revisionId}/report/pdf", "%PDF-");

            HttpResponseMessage delete = await client.DeleteAsync($"api/measurements/{firstMeasurementId}");
            Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
            summaries = await GetJsonAsync(client, $"api/revisions/{revisionId}/measurement-summaries");
            Assert.Equal(7.75m, Assert.Single(summaries.EnumerateArray()).GetProperty("netQuantity").GetDecimal());

            HttpResponseMessage approve = await client.PostAsync($"api/revisions/{revisionId}/approve", null);
            Assert.Equal(HttpStatusCode.NoContent, approve.StatusCode);
            HttpResponseMessage forbiddenWrite = await client.PostAsJsonAsync($"api/revisions/{revisionId}/measurements", new
            {
                placementId,
                inputQuantity = 1m,
                inputUnit = "m"
            });
            Assert.Equal(HttpStatusCode.BadRequest, forbiddenWrite.StatusCode);
            // Sözleşme, çevrilebilir mesaj metnine değil kararlı kural koduna dayanır.
            using var forbiddenBody = JsonDocument.Parse(await forbiddenWrite.Content.ReadAsStringAsync());
            Assert.Equal("revision.read-only", forbiddenBody.RootElement.GetProperty("rule").GetString());
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            DeleteDatabaseFiles(databasePath);
        }
    }

    private static async Task<JsonElement> PostJsonAsync(HttpClient client, string requestUri, object payload)
    {
        HttpResponseMessage response = await client.PostAsJsonAsync(requestUri, payload);
        string content = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"POST {requestUri} returned {(int)response.StatusCode}: {content}");
        using var document = JsonDocument.Parse(content);
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string requestUri)
    {
        HttpResponseMessage response = await client.GetAsync(requestUri);
        string content = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"GET {requestUri} returned {(int)response.StatusCode}: {content}");
        using var document = JsonDocument.Parse(content);
        return document.RootElement.Clone();
    }

    private static async Task AssertDownloadAsync(HttpClient client, string requestUri, string expectedHeader)
    {
        HttpResponseMessage response = await client.GetAsync(requestUri);
        byte[] bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.True(response.IsSuccessStatusCode, $"GET {requestUri} returned {(int)response.StatusCode}.");
        Assert.True(bytes.Length > 100, $"{requestUri} produced an unexpectedly small file.");
        Assert.StartsWith(expectedHeader, System.Text.Encoding.ASCII.GetString(bytes, 0, expectedHeader.Length));
    }

    private static void DeleteDatabaseFiles(string databasePath)
    {
        File.Delete(databasePath);
        File.Delete($"{databasePath}-wal");
        File.Delete($"{databasePath}-shm");
    }
}
