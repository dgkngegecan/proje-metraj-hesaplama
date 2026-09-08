using Metraj.Application;
using Metraj.Domain;
using Xunit;

namespace Metraj.Tests;

public sealed class CalculationEngineTests
{
    [Fact]
    public void StandardLengthConversionSeparatesNetWastePurchaseAndRemainder()
    {
        var card = new CatalogCardVersion
        {
            Unit = "m",
            WasteRatePct = 10m,
            SalesConversion = SalesConversion.StandardLength,
            ContainerParameter = 6m
        };

        var output = CalculationEngine.Calculate(card, 10m);

        Assert.Equal(10m, output.NetQuantity);
        Assert.Equal(11m, output.WithWasteQuantity);
        Assert.Equal(2m, output.PurchaseQuantity);
        Assert.Equal(1m, output.RemainderQuantity);
    }

    [Fact]
    public void ConversionRequiresPositiveParameter()
    {
        var card = new CatalogCardVersion
        {
            Unit = "adet",
            SalesConversion = SalesConversion.Package,
            ContainerParameter = 0m
        };

        Assert.Throws<DomainRuleViolationException>(() => CalculationEngine.Calculate(card, 1m));
    }

    [Fact]
    public void FractionalInputUsesFixedScaleBeforeDeterministicPurchaseRounding()
    {
        var card = new CatalogCardVersion
        {
            Unit = "m",
            WasteRatePct = 12.5m,
            SalesConversion = SalesConversion.StandardLength,
            ContainerParameter = 0.25m
        };

        CalculationOutput output = CalculationEngine.Calculate(card, 1.234567m);

        Assert.Equal(1.234567m, output.NetQuantity);
        Assert.Equal(1.388888m, output.WithWasteQuantity);
        Assert.Equal(6m, output.PurchaseQuantity);
        Assert.Equal(0.111112m, output.RemainderQuantity);
    }

    [Fact]
    public void ZeroAndMaximumBoundaryAreSafeWhileNegativeAndOverScaleInputsAreRejected()
    {
        var card = new CatalogCardVersion { Unit = "adet", SalesConversion = SalesConversion.None };

        Assert.Equal(0m, CalculationEngine.Calculate(card, 0m).PurchaseQuantity);
        Assert.Equal(QuantityRules.MaximumQuantity, CalculationEngine.Calculate(card, QuantityRules.MaximumQuantity).NetQuantity);
        Assert.Throws<DomainRuleViolationException>(() => CalculationEngine.Calculate(card, -0.001m));
        Assert.Throws<DomainRuleViolationException>(() => CalculationEngine.Calculate(card, 0.0000001m));
    }
}
