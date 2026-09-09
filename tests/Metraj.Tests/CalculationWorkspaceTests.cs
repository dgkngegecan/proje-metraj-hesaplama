using Metraj.Application;
using Metraj.Domain;
using Metraj.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Metraj.Tests;

public sealed class CalculationWorkspaceTests
{
    [Fact]
    public async Task FixedMultiplierCreatesPinnedReviewableSnapshotAndSupersedesInsteadOfOverwriting()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-calc");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var calculations = new CalculationWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-CALC", "Hesap testi");
        CatalogCardListItem sourceCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-SOURCE", "Kaynak boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m", 10m));
        CatalogCardListItem targetCard = await cards.CreateCardAsync(new CatalogCardDraft(
            "ACC-CLAMP", "Boru kelepçesi", CardType.Accessory, ItemKind.Material, InputBehavior.Derived,
            SalesConversion.Package, ReportBehavior.Measurable, "adet", 0m, 10m));
        PlacementListItem source = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, sourceCard.LatestVersionId));
        PlacementListItem target = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, targetCard.LatestVersionId));
        await tree.AddLinkAsync(source.Id, target.Id, SemanticLinkType.CalculatedFrom);
        await measurements.CreateMeasurementsAsync([
            new MeasurementDraft(project.LatestRevisionId, source.Id, 10m, "m", Block: "A"),
            new MeasurementDraft(project.LatestRevisionId, source.Id, 5m, "m", Block: "B")
        ]);

        CalculationRuleListItem rule = await calculations.CreateRuleVersionAsync(project.LatestRevisionId,
            new CalculationRuleDraft("CLAMP-PER-M", "Metre başına iki kelepçe", CalculationRuleMode.FixedMultiplier, 2m, SourceQuantityKind.WithWaste));
        CalculationResultListItem first = await calculations.CalculateAsync(project.LatestRevisionId, target.Id, rule.Id);

        Assert.Equal(CalculationResultStatus.PendingReview, first.Status);
        Assert.Equal(33m, first.ProposedQuantity); // (10 + 5) * 1.10 * 2
        Assert.Equal(4m, first.PurchaseQuantity);
        Assert.Equal(7m, first.RemainderQuantity);
        Assert.Equal(rule.Id, first.RuleVersionId);
        Assert.Equal(targetCard.LatestVersionId, first.CardVersionId);
        Assert.Equal("SYN-CALC-ENGINE-CONTRACT-v1", first.EngineVersion);
        Assert.Equal("SYN-UNIT-POLICY-v1", first.UnitPolicyVersion);
        Assert.Equal(2, System.Text.Json.JsonSerializer.Deserialize<string[]>(first.SourceMeasurementIdsJson)!.Length);
        Assert.Contains("FixedMultiplier", first.InputSummary, StringComparison.Ordinal);

        await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, source.Id, 5m, "m", Block: "C"));
        CalculationResultListItem second = await calculations.CalculateAsync(project.LatestRevisionId, target.Id, rule.Id);
        IReadOnlyList<CalculationResultListItem> results = await calculations.ListResultsAsync(project.LatestRevisionId);

        Assert.Equal(44m, second.ProposedQuantity);
        Assert.Equal(first.Id, second.SupersedesResultId);
        Assert.Equal(CalculationResultStatus.Superseded, results.Single(x => x.Id == first.Id).Status);
        Assert.Equal(CalculationResultStatus.PendingReview, results.Single(x => x.Id == second.Id).Status);

        await calculations.OverrideAsync(second.Id, 6m, "Sahada tam paket daha uygun.");
        CalculationResultListItem overridden = (await calculations.ListResultsAsync(project.LatestRevisionId)).Single(x => x.Id == second.Id);
        Assert.Equal(CalculationResultStatus.Overridden, overridden.Status);
        Assert.Equal(6m, overridden.UsedQuantity);
        Assert.Equal("Sahada tam paket daha uygun.", overridden.OverrideReason);

        CalculationRuleListItem newRule = await calculations.CreateRuleVersionAsync(project.LatestRevisionId,
            new CalculationRuleDraft("CLAMP-PER-M", "Metre başına üç kelepçe", CalculationRuleMode.FixedMultiplier, 3m, SourceQuantityKind.WithWaste));
        IReadOnlyList<CalculationRuleListItem> rules = await calculations.ListRulesAsync(project.LatestRevisionId);
        Assert.False(rules.Single(x => x.Id == rule.Id).IsActive);
        Assert.True(rules.Single(x => x.Id == newRule.Id).IsActive);

        await using MetrajDbContext verification = MetrajDbContextFactory.Create(databasePath);
        Assert.True(await verification.AuditEntries.CountAsync(x => x.ProjectRevisionId == project.LatestRevisionId) >= 4);
    }

    [Fact]
    public async Task DirectRuleUsesTargetMeasurementsAndRequiresReviewReasonForOverride()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-direct-calc");
        string databasePath = database.Path;
        var projects = new ProjectWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var cards = new CatalogWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var tree = new ProjectTreeWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var measurements = new MeasurementWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        var calculations = new CalculationWorkspaceService(() => MetrajDbContextFactory.Create(databasePath));
        ProjectListItem project = await projects.CreateProjectAsync("P-DIRECT", "Doğrudan hesap testi");
        CatalogCardListItem card = await cards.CreateCardAsync(new CatalogCardDraft(
            "MAT-DIRECT", "Doğrudan boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.StandardLength, ReportBehavior.Measurable, "m", 0m, 6m));
        PlacementListItem placement = await tree.AddPlacementAsync(new PlacementDraft(project.LatestRevisionId, card.LatestVersionId));
        await measurements.CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id, 7m, "m"));
        CalculationRuleListItem rule = await calculations.CreateRuleVersionAsync(project.LatestRevisionId,
            new CalculationRuleDraft("DIRECT", "Doğrudan metraj", CalculationRuleMode.Direct));

        CalculationResultListItem result = await calculations.CalculateAsync(project.LatestRevisionId, placement.Id, rule.Id);
        Assert.Equal(7m, result.ProposedQuantity);
        Assert.Equal(2m, result.PurchaseQuantity);
        Assert.Equal(5m, result.RemainderQuantity);
        await Assert.ThrowsAsync<DomainRuleViolationException>(() => calculations.OverrideAsync(result.Id, 2m, " "));

        await calculations.ApproveAsync(result.Id);
        CalculationResultListItem approved = (await calculations.ListResultsAsync(project.LatestRevisionId)).Single();
        Assert.Equal(CalculationResultStatus.Approved, approved.Status);
        Assert.Equal(2m, approved.UsedQuantity);
    }
}
