using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Metraj.Infrastructure;

/// <summary>Stores six-decimal quantities as exact SQLite INTEGER values.</summary>
public sealed class ScaledDecimalConverter() : ValueConverter<decimal, long>(
    value => checked((long)decimal.Round(value * 1_000_000m, 0, MidpointRounding.AwayFromZero)),
    value => value / 1_000_000m)
{
    public const int Scale = 6;
}

/// <summary>Nullable counterpart of the six-decimal quantity converter.</summary>
public sealed class NullableScaledDecimalConverter() : ValueConverter<decimal?, long?>(
    value => value.HasValue
        ? checked((long?)decimal.Round(value.Value * 1_000_000m, 0, MidpointRounding.AwayFromZero))
        : null,
    value => value.HasValue ? value.Value / 1_000_000m : null)
{
}
