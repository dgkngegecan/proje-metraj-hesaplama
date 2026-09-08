using Metraj.Domain;
using Xunit;

namespace Metraj.Tests;

public sealed class DomainRulesTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(12.345678)]
    public void QuantityRulesAcceptsSupportedValues(decimal value)
    {
        QuantityRules.EnsureValid(value);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.0000001)]
    public void QuantityRulesRejectsInvalidValues(decimal value)
    {
        Assert.Throws<DomainRuleViolationException>(() => QuantityRules.EnsureValid(value));
    }

    [Fact]
    public void TreeRulesRejectSelfParentAndCycles()
    {
        var revisionId = Guid.NewGuid();
        ProjectPlacement root = new() { Id = Guid.NewGuid(), ProjectRevisionId = revisionId };
        ProjectPlacement child = new() { Id = Guid.NewGuid(), ProjectRevisionId = revisionId, ParentPlacementId = root.Id };
        ProjectPlacement grandChild = new() { Id = Guid.NewGuid(), ProjectRevisionId = revisionId, ParentPlacementId = child.Id };

        Assert.Throws<DomainRuleViolationException>(() => ProjectTreeRules.EnsureParentAllowed(root, root, [root, child, grandChild]));
        Assert.Throws<DomainRuleViolationException>(() => ProjectTreeRules.EnsureParentAllowed(root, grandChild, [root, child, grandChild]));
    }

    [Theory]
    [InlineData(CardType.Scope, CardType.Category)]
    [InlineData(CardType.System, CardType.Category)]
    [InlineData(CardType.Material, CardType.System)]
    [InlineData(CardType.Accessory, CardType.System)]
    [InlineData(CardType.Accessory, CardType.Material)]
    public void TreeRulesAllowExpectedCardTypeHierarchy(CardType childType, CardType parentType)
    {
        ProjectTreeRules.EnsureCardTypeCompatible(childType, parentType);
    }

    [Theory]
    [InlineData(CardType.System, CardType.Material)]
    [InlineData(CardType.System, CardType.Accessory)]
    [InlineData(CardType.Material, CardType.Accessory)]
    [InlineData(CardType.Category, CardType.System)]
    public void TreeRulesRejectInvertedCardTypeHierarchy(CardType childType, CardType parentType)
    {
        DomainRuleViolationException error = Assert.Throws<DomainRuleViolationException>(
            () => ProjectTreeRules.EnsureCardTypeCompatible(childType, parentType));

        Assert.Equal("tree.card-type", error.Rule);
    }

    [Fact]
    public void LinkRulesRejectCrossRevisionAndDuplicates()
    {
        ProjectPlacement source = new() { Id = Guid.NewGuid(), ProjectRevisionId = Guid.NewGuid() };
        ProjectPlacement target = new() { Id = Guid.NewGuid(), ProjectRevisionId = Guid.NewGuid() };
        PlacementLink link = new() { Id = Guid.NewGuid(), SourcePlacementId = source.Id, TargetPlacementId = target.Id, LinkType = SemanticLinkType.Reference };

        Assert.Throws<DomainRuleViolationException>(() => ProjectTreeRules.EnsureLinkAllowed(link, source, target, []));

        target.ProjectRevisionId = source.ProjectRevisionId;
        PlacementLink existing = new() { Id = Guid.NewGuid(), SourcePlacementId = source.Id, TargetPlacementId = target.Id, LinkType = SemanticLinkType.Reference };
        Assert.Throws<DomainRuleViolationException>(() => ProjectTreeRules.EnsureLinkAllowed(link, source, target, [existing]));
    }

    [Fact]
    public void CalculatedFromLinksRejectDependencyCycles()
    {
        var revisionId = Guid.NewGuid();
        ProjectPlacement first = new() { Id = Guid.NewGuid(), ProjectRevisionId = revisionId };
        ProjectPlacement second = new() { Id = Guid.NewGuid(), ProjectRevisionId = revisionId };
        ProjectPlacement third = new() { Id = Guid.NewGuid(), ProjectRevisionId = revisionId };
        PlacementLink firstToSecond = new() { Id = Guid.NewGuid(), SourcePlacementId = first.Id, TargetPlacementId = second.Id, LinkType = SemanticLinkType.CalculatedFrom };
        PlacementLink secondToThird = new() { Id = Guid.NewGuid(), SourcePlacementId = second.Id, TargetPlacementId = third.Id, LinkType = SemanticLinkType.CalculatedFrom };
        PlacementLink thirdToFirst = new() { Id = Guid.NewGuid(), SourcePlacementId = third.Id, TargetPlacementId = first.Id, LinkType = SemanticLinkType.CalculatedFrom };

        Assert.Throws<DomainRuleViolationException>(() => ProjectTreeRules.EnsureLinkAllowed(thirdToFirst, third, first, [firstToSecond, secondToThird]));
    }
}
