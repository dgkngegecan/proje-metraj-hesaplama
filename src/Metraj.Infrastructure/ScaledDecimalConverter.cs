using Metraj.Domain;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Metraj.Infrastructure;

/// <summary>Miktarları SQLite INTEGER olarak TAM saklar (altı ondalık).</summary>
/// <remarks>
/// Çarpan <see cref="QuantityRules.ScaleFactor"/>'dan gelir. Önceden burada
/// dört kez sabit yazılıydı ve alan katmanındaki ölçek sabitinden habersizdi;
/// ayrıca kullanılmayan ikinci bir <c>Scale</c> sabiti taşıyordu.
/// </remarks>
public sealed class ScaledDecimalConverter() : ValueConverter<decimal, long>(
    value => checked((long)decimal.Round(value * QuantityRules.ScaleFactor, 0, MidpointRounding.AwayFromZero)),
    value => value / QuantityRules.ScaleFactor)
{
}

/// <summary>Aynı dönüştürücünün null kabul eden karşılığı.</summary>
public sealed class NullableScaledDecimalConverter() : ValueConverter<decimal?, long?>(
    value => value.HasValue
        ? checked((long?)decimal.Round(value.Value * QuantityRules.ScaleFactor, 0, MidpointRounding.AwayFromZero))
        : null,
    value => value.HasValue ? value.Value / QuantityRules.ScaleFactor : null)
{
}
