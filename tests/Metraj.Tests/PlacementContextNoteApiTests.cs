using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Metraj.Api;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

public sealed class PlacementContextNoteApiTests
{
    private static readonly string[] NotePropertyNames =
        ["block", "createdAtUtc", "floor", "id", "placementId", "room", "text", "updatedAtUtc"];

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task HttpContractPersistsMultipleFolderPlacementNotesAcrossHostRestartAndEnforcesApprovedRestrictions(bool scopedDelete)
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (project, placement, other) = await CreatePlacementsAsync(database);
        string route = $"api/placements/{placement.Id}/context-notes";
        string DeleteRoute(Guid noteId) => scopedDelete ? $"{route}/{noteId}" : $"api/placement-context-notes/{noteId}";
        PlacementContextNoteListItem survivor;
        await using (LocalApiHost host = await LocalApiHost.StartAsync(database.Path))
        {
            using var client = new HttpClient { BaseAddress = host.BaseUri };
            Assert.Empty((await client.GetFromJsonAsync<PlacementContextNoteListItem[]>(route))!);
            HttpResponseMessage added = await client.PostAsJsonAsync(route, new
            {
                text = "  Bu katta farklı uygulama planlandı.  ", block = " A ", floor = " 2 ", room = " Salon "
            });
            Assert.Equal(HttpStatusCode.OK, added.StatusCode);
            JsonElement payload = await added.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(NotePropertyNames,
                payload.EnumerateObject().Select(x => x.Name).OrderBy(x => x, StringComparer.Ordinal));
            Guid firstId = payload.GetProperty("id").GetGuid();
            Assert.NotEqual(Guid.Empty, firstId);
            Assert.Equal(placement.Id, payload.GetProperty("placementId").GetGuid());
            Assert.Equal("Bu katta farklı uygulama planlandı.", payload.GetProperty("text").GetString());
            Assert.Equal("A", payload.GetProperty("block").GetString());
            Assert.Equal("2", payload.GetProperty("floor").GetString());
            Assert.Equal("Salon", payload.GetProperty("room").GetString());
            Assert.EndsWith("Z", payload.GetProperty("createdAtUtc").GetString(), StringComparison.Ordinal);
            Assert.Equal(JsonValueKind.Null, payload.GetProperty("updatedAtUtc").ValueKind);

            HttpResponseMessage secondResponse = await client.PostAsJsonAsync(route, new { text = "İkinci bağımsız not" });
            Assert.Equal(HttpStatusCode.OK, secondResponse.StatusCode);
            survivor = (await secondResponse.Content.ReadFromJsonAsync<PlacementContextNoteListItem>())!;
            Assert.NotEqual(firstId, survivor.Id);
            Assert.Null(survivor.Block);
            Assert.Null(survivor.Floor);
            Assert.Null(survivor.Room);
            PlacementContextNoteListItem[] both = (await client.GetFromJsonAsync<PlacementContextNoteListItem[]>(route))!;
            Assert.Equal(new[] { firstId, survivor.Id }, both.Select(x => x.Id));
            Assert.All(both, note => Assert.Equal(DateTimeKind.Utc, note.CreatedAtUtc.Kind));
            Assert.Empty((await client.GetFromJsonAsync<PlacementContextNoteListItem[]>($"api/placements/{other.Id}/context-notes"))!);

            await AssertErrorAsync(await client.DeleteAsync(DeleteRoute(Guid.NewGuid())), "context-note.not-found");
            await AssertErrorAsync(await client.DeleteAsync($"api/placements/{other.Id}/context-notes/{firstId}"), "context-note.not-found");
            HttpResponseMessage deletion = await client.DeleteAsync(DeleteRoute(firstId));
            Assert.Equal(HttpStatusCode.NoContent, deletion.StatusCode);
            Assert.Empty(await deletion.Content.ReadAsStringAsync());
            Assert.Equal(survivor, Assert.Single((await client.GetFromJsonAsync<PlacementContextNoteListItem[]>(route))!));
        }

        TestDatabase.ClearPoolFor(database.Path);
        await using LocalApiHost restarted = await LocalApiHost.StartAsync(database.Path);
        using var reopened = new HttpClient { BaseAddress = restarted.BaseUri };
        Assert.Equal(survivor, Assert.Single((await reopened.GetFromJsonAsync<PlacementContextNoteListItem[]>(route))!));
        HttpResponseMessage approval = await reopened.PostAsync($"api/revisions/{project.LatestRevisionId}/approve", null);
        Assert.Equal(HttpStatusCode.NoContent, approval.StatusCode);
        await AssertErrorAsync(await reopened.PostAsJsonAsync(route, new { text = "Kilitli revizyona ekleme" }), "revision.read-only");
        await AssertErrorAsync(await reopened.DeleteAsync(DeleteRoute(survivor.Id)), "revision.read-only");
        Assert.Equal(survivor, Assert.Single((await reopened.GetFromJsonAsync<PlacementContextNoteListItem[]>(route))!));
    }

    [Fact]
    public async Task MissingAndBlankTextAndUnknownPlacementReturnTheDomainErrorContract()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var (_, placement, _) = await CreatePlacementsAsync(database);
        await using LocalApiHost host = await LocalApiHost.StartAsync(database.Path);
        using var client = new HttpClient { BaseAddress = host.BaseUri };
        string route = $"api/placements/{placement.Id}/context-notes";

        await AssertErrorAsync(await client.PostAsJsonAsync(route, new { text = " \t " }), "context-note.text");
        await AssertErrorAsync(await client.PostAsJsonAsync(route, new { text = (string?)null }), "context-note.text");
        await AssertErrorAsync(await client.PostAsJsonAsync(route, new { floor = "2" }), "context-note.text");
        await AssertErrorAsync(await client.GetAsync($"api/placements/{Guid.NewGuid()}/context-notes"), "placement.not-found");
        await AssertErrorAsync(await client.PostAsJsonAsync($"api/placements/{Guid.NewGuid()}/context-notes", new { text = "Not" }), "placement.not-found");
        Assert.Empty((await client.GetFromJsonAsync<PlacementContextNoteListItem[]>(route))!);
    }

    private static async Task AssertErrorAsync(HttpResponseMessage response, string rule)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        JsonElement body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(rule, body.GetProperty("rule").GetString());
        Assert.Equal(DomainMessageCatalog.Resolve(rule), body.GetProperty("message").GetString());
    }

    private static async Task<(ProjectListItem Project, PlacementListItem Placement, PlacementListItem Other)> CreatePlacementsAsync(TestDatabase database)
    {
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("P-NOTE-API", "Not API");
        CatalogCardListItem card = await new CatalogWorkspaceService(database.ContextFactory).CreateCardAsync(new CatalogCardDraft(
            "SYS-NOTE-API", "Sistem", CardType.System, ItemKind.Service, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Folder, "-"));
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);
        PlacementListItem placement = await tree.AddPlacementAsync(new(project.LatestRevisionId, card.LatestVersionId));
        PlacementListItem other = await tree.AddPlacementAsync(new(project.LatestRevisionId, card.LatestVersionId));
        return (project, placement, other);
    }
}
