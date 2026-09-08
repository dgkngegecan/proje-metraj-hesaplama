using System.Globalization;
using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// İçerik parmak izleri (ContentHash) ve kart doğrulaması. Bu değerler kalıcı
/// olarak saklanır ve izlenebilirlik iddiasının temelidir; makineye, işletim
/// sistemi diline veya alan sırasına göre değişmemelidirler.
/// </summary>
public sealed class ContentIntegrityTests
{
    [Fact]
    public async Task RuleContentHashDoesNotDependOnTheOperatingSystemLanguage()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var projects = new ProjectWorkspaceService(database.ContextFactory);
        var calculations = new CalculationWorkspaceService(database.ContextFactory);

        ProjectListItem project = await projects.CreateProjectAsync("P-HASH", "Hash testi");
        var draft = new CalculationRuleDraft("CARPAN", "Çarpanlı kural", CalculationRuleMode.FixedMultiplier, 1.5m);

        CultureInfo original = CultureInfo.CurrentCulture;
        string turkishHash;
        string englishHash;
        try
        {
            // Hedef kitle Türkçe Windows kullanıyor; ondalık ayıracı virgül.
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            turkishHash = (await calculations.CreateRuleVersionAsync(project.LatestRevisionId, draft)).ContentHash;

            CultureInfo.CurrentCulture = new CultureInfo("en-US");
            englishHash = (await calculations.CreateRuleVersionAsync(project.LatestRevisionId, draft)).ContentHash;
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }

        Assert.Equal(turkishHash, englishHash);
    }

    [Fact]
    public async Task CardContentHashCoversResolvedValuesAndIsOrderIndependent()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var types = new CatalogCardTypeWorkspaceService(database.ContextFactory);

        CatalogCardTypeListItem type = await types.CreateTypeAsync(new CatalogCardTypeDraft(
            "FIRELI", "Fire alanlı tür", CardType.Material,
            AttributeKeys: ["Code", "Name", "Unit", "WasteRatePct", "PositionNumber"]));

        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "HASH-CARD", "Kart", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 5m, CustomTypeId: type.Id));

        async Task<string> HashOfNewVersionAsync(IReadOnlyDictionary<string, string> attributes)
        {
            CatalogCardListItem created = await cards.CreateVersionAsync(card.Id, new CatalogCardDraft(
                "HASH-CARD", "Kart", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.None, ReportBehavior.Measurable, "m", 0m,
                CustomTypeId: type.Id, AttributeValues: attributes));
            await using MetrajDbContext context = database.ContextFactory();
            return await context.CatalogCardVersions.Where(x => x.Id == created.LatestVersionId)
                .Select(x => x.ContentHash).SingleAsync();
        }

        // Parmak izi, yalnızca öznitelik üzerinden ulaşılabilen ÇÖZÜLMÜŞ değeri
        // kapsamalı. Önceki sürüm ham taslağı hash'lediği için burada iki sürüm
        // de draft.WasteRatePct = 0 görüyordu.
        string sevenPercent = await HashOfNewVersionAsync(new Dictionary<string, string> { ["WasteRatePct"] = "7" });
        string ninePercent = await HashOfNewVersionAsync(new Dictionary<string, string> { ["WasteRatePct"] = "9" });
        Assert.NotEqual(sevenPercent, ninePercent);

        // Aynı içerik, özniteliklerin yazılma SIRASI değişse bile aynı parmak
        // izini vermeli: kanonik biçim sıralıdır ve derleyicinin üye sırasına
        // bağlı değildir.
        string firstOrder = await HashOfNewVersionAsync(new Dictionary<string, string>
        {
            ["WasteRatePct"] = "12",
            ["PositionNumber"] = "15.01",
        });
        string reversedOrder = await HashOfNewVersionAsync(new Dictionary<string, string>
        {
            ["PositionNumber"] = "15.01",
            ["WasteRatePct"] = "12",
        });
        Assert.Equal(firstOrder, reversedOrder);

        // Aynı içerik iki kez hesaplandığında da değişmemeli.
        Assert.Equal(firstOrder, await HashOfNewVersionAsync(new Dictionary<string, string>
        {
            ["WasteRatePct"] = "12",
            ["PositionNumber"] = "15.01",
        }));
    }

    [Fact]
    public async Task ANewVersionCannotStoreANegativeContainerParameterThroughAnAttribute()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync();
        var cards = new CatalogWorkspaceService(database.ContextFactory);
        var types = new CatalogCardTypeWorkspaceService(database.ContextFactory);

        CatalogCardTypeListItem type = await types.CreateTypeAsync(new CatalogCardTypeDraft(
            "BOYLU", "Boy kapasiteli tür", CardType.Material,
            AttributeKeys: ["Code", "Name", "Unit", "ContainerParameter"]));

        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "CONT-NEG", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 0m, 4m,
            CustomTypeId: type.Id));

        // Öznitelik üzerinden gelen negatif değer, alan üzerinden gelenle aynı
        // doğrulamaya tabi olmalı. Önceden yalnızca HAM taslak doğrulanıyor,
        // çözülmüş değer kaydediliyordu; hata ancak rapor alınırken patlıyordu.
        DomainRuleViolationException error = await Assert.ThrowsAsync<DomainRuleViolationException>(
            () => cards.CreateVersionAsync(card.Id, new CatalogCardDraft(
                "CONT-NEG", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 0m, 4m,
                CustomTypeId: type.Id,
                AttributeValues: new Dictionary<string, string> { ["ContainerParameter"] = "-1" })));
        Assert.Equal("quantity.non-negative", error.Rule);

        // Aynı koruma yeni kart oluşturmada da geçerli olmalı.
        DomainRuleViolationException createError = await Assert.ThrowsAsync<DomainRuleViolationException>(
            () => cards.CreateCardAsync(new CatalogCardDraft(
                "CONT-NEG-2", "Boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
                SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 0m, 4m,
                CustomTypeId: type.Id,
                AttributeValues: new Dictionary<string, string> { ["ContainerParameter"] = "-1" })));
        Assert.Equal("quantity.non-negative", createError.Rule);
    }
}
