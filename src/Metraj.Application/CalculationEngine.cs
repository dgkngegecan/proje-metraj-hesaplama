using Metraj.Domain;

namespace Metraj.Application;

public sealed record CalculationOutput(
    decimal NetQuantity,
    decimal WithWasteQuantity,
    decimal PurchaseQuantity,
    decimal RemainderQuantity,
    SalesConversion Conversion);

/// <summary>Deterministic, deliberately limited calculation engine for catalog quantities.</summary>
public sealed class CalculationEngine
{
    public static CalculationOutput Calculate(CatalogCardVersion card, decimal inputQuantity)
    {
        ArgumentNullException.ThrowIfNull(card);
        QuantityRules.EnsureValid(inputQuantity, "input quantity");
        QuantityRules.EnsureValid(card.WasteRatePct, "waste rate");

        decimal withWaste = decimal.Round(inputQuantity * (1m + card.WasteRatePct / 100m), QuantityRules.DecimalScale, MidpointRounding.ToEven);
        decimal purchase;
        decimal remainder;
        if (card.SalesConversion is SalesConversion.StandardLength or SalesConversion.Package)
        {
            if (card.ContainerParameter is not decimal parameter || parameter <= 0m)
            {
                throw new DomainRuleViolationException("calculation.parameter", "A positive container parameter is required for length or package conversion.");
            }

            purchase = decimal.Ceiling(withWaste / parameter);
            remainder = decimal.Round((purchase * parameter) - withWaste, QuantityRules.DecimalScale, MidpointRounding.ToEven);
        }
        else
        {
            purchase = withWaste;
            remainder = 0m;
        }

        QuantityRules.EnsureValid(withWaste, "with-waste quantity");
        QuantityRules.EnsureValid(purchase, "purchase quantity");
        QuantityRules.EnsureValid(remainder, "remainder quantity");
        return new CalculationOutput(inputQuantity, withWaste, purchase, remainder, card.SalesConversion);
    }
}
