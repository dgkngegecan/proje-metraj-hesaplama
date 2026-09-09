using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// T3-4: Liste sorguları artık gereğinden fazlasını yüklemiyor. Bu testler,
/// hızlandırmanın DÖNEN VERİYİ değiştirmediğini güvence altına alır --
/// özellikle projeksiyona geçerken sessizce boşalabilecek alanları.
/// </summary>
public sealed class ListQueryShapeTests
{
    [Fact]
    public async Task CardListStillCarriesTheCustomTypeAndItsAttributeKeys()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var types = new CatalogCardTypeWorkspaceService(database.ContextFactory);

        CatalogCardTypeListItem type = await types.CreateTypeAsync(new CatalogCardTypeDraft(
            "OZELTIP", "Özel tür", CardType.Material,
            AttributeKeys: ["Code", "Name", "Unit", "WasteRatePct"]));

        await cards.CreateCardAsync(new CatalogCardDraft(
            "TIPLI", "Tipli kart", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 5m, CustomTypeId: type.Id));

        CatalogCardListItem listed = Assert.Single(await cards.ListCardsAsync());

        // Liste sorgusu AsNoTracking projeksiyonuna geçti. Gezinme özellikleri
        // orada kendiliğinden dolmaz; açıkça çekilmezse bu üç alan sessizce
        // boşalır ve kullanıcı kartının türünü kaybederdi.
        Assert.Equal(type.Id, listed.CustomTypeId);
        Assert.Equal("OZELTIP", listed.CustomTypeCode);
        Assert.Equal("Özel tür", listed.CustomTypeName);
        Assert.Contains("WasteRatePct", listed.AttributeKeys ?? []);
    }

    [Fact]
    public async Task CardListReturnsOnlyTheNewestVersionOfEachCard()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var cards = new CatalogWorkspaceService(database.ContextFactory);

        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "SURUMLU", "İlk ad", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m));

        await cards.CreateVersionAsync(card.Id, new CatalogCardDraft(
            "SURUMLU", "İkinci ad", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m));
        await cards.CreateVersionAsync(card.Id, new CatalogCardDraft(
            "SURUMLU", "Üçüncü ad", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m));

        CatalogCardListItem listed = Assert.Single(await cards.ListCardsAsync());
        Assert.Equal("Üçüncü ad", listed.Name);
        Assert.Equal(3, listed.LatestVersion);
    }

    [Fact]
    public async Task CardListIsOrderedByCode()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var cards = new CatalogWorkspaceService(database.ContextFactory);

        foreach (string code in new[] { "ZKART", "AKART", "MKART" })
        {
            await cards.CreateCardAsync(new CatalogCardDraft(
                code, code, CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "m", 0m));
        }

        IReadOnlyList<CatalogCardListItem> listed = await cards.ListCardsAsync();
        Assert.Equal(["AKART", "MKART", "ZKART"], listed.Select(x => x.Code));
    }

    [Fact]
    public async Task InactiveAndNonAccessoryCardsStayOutOfTheFittingList()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var tree = new ProjectTreeWorkspaceService(database.ContextFactory);

        CatalogCardListItem pipeCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "BORU", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 0m));
        CatalogCardListItem fitting = await cards.CreateCardAsync(new CatalogCardDraft(
            "EKPARCA", "Ek parça", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "adet", 0m));
        CatalogCardListItem passive = await cards.CreateCardAsync(new CatalogCardDraft(
            "PASIF", "Pasif ek parça", CardType.Accessory, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "adet", 0m));
        await cards.DeactivateCardAsync(passive.Id);

        ProjectListItem project = await projects.CreateProjectAsync("PRJ-LIST", "Liste projesi");
        PlacementListItem pipe = await tree.AddPlacementAsync(new PlacementDraft(
            project.LatestRevisionId, pipeCard.LatestVersionId, null));

        IReadOnlyList<CatalogCardListItem> fittings = await cards.ListCompatibleFittingsAsync(pipe.Id);

        // Süzgeç veritabanına indi; sonuç kümesi aynı kalmalı.
        Assert.Equal([fitting.Code], fittings.Select(x => x.Code));
    }

    [Fact]
    public async Task ProjectListReportsRevisionCountAndNewestRevision()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("PRJ-SAYIM", "Sayım projesi");
        // Yeni bir revizyon ancak açık taslak onaylandıktan sonra açılabilir.
        await projects.ApproveRevisionAsync(project.LatestRevisionId);
        ProjectRevisionListItem second = await projects.CreateDraftRevisionAsync(project.Id);

        ProjectListItem listed = Assert.Single(await projects.ListProjectsAsync());
        Assert.Equal(2, listed.RevisionCount);
        Assert.Equal(second.Id, listed.LatestRevisionId);

        // Sıralama koda göre; ikinci bir proje eklendiğinde bu korunmalı.
        await projects.CreateProjectAsync("AAA-ONCE", "Önce gelen");
        IReadOnlyList<ProjectListItem> all = await projects.ListProjectsAsync();
        Assert.Equal(["AAA-ONCE", "PRJ-SAYIM"], all.Select(x => x.Code));
    }
}
