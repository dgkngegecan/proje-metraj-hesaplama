using System.Globalization;
using System.Text.Json;
using Metraj.Domain;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Miktarlar veritabanında ölçekli INTEGER olarak TAM saklanır, ancak tele
/// JSON sayısı olarak çıkar ve tarayıcıda IEEE-754 double olur. Bu testler
/// güvenli aralığın nerede bittiğini sabitler.
///
/// Tel formatını ondalık-string'e çevirmek (T2-16) uyumluluk testi isteyen
/// ayrı bir iştir; bu testler o iş yapılana kadar sessiz bozulmayı yakalar
/// ve yapıldığında da sözleşmenin ne olduğunu belgelemeye devam eder.
/// </summary>
public sealed class DecimalWireContractTests
{
    private static decimal RoundTripThroughJsonNumber(decimal value)
    {
        string json = JsonSerializer.Serialize(value);
        double asBrowserNumber = JsonSerializer.Deserialize<double>(json);
        return (decimal)asBrowserNumber;
    }

    [Theory]
    // Gerçek metraj büyüklükleri: metre, metrekare, adet, kilogram.
    [InlineData("0.000001")]
    [InlineData("0.5")]
    [InlineData("123.456789")]
    [InlineData("9999.999999")]
    [InlineData("1250000.75")]
    [InlineData("99999999.123456")]
    public void RealisticQuantitiesSurviveTheJsonNumberWireFormat(string literal)
    {
        decimal value = decimal.Parse(literal, CultureInfo.InvariantCulture);
        QuantityRules.EnsureValid(value);

        Assert.Equal(value, RoundTripThroughJsonNumber(value));
    }

    [Fact]
    public void TheDocumentedSafeCeilingIsExactOnTheWire()
    {
        // Altı ondalıklı bir değer, ölçeklenmiş hâli 2^53'ün altında kaldığı
        // sürece double olarak tam temsil edilir: 9_007_199_254.740992 / 1e6.
        const decimal safeCeiling = 9_007_199_254m / 1_000_000m;
        Assert.Equal(safeCeiling, RoundTripThroughJsonNumber(safeCeiling));
    }

    [Fact]
    public void TheDomainMaximumIsWellAboveWhatTheWireFormatCanCarry()
    {
        // Bu, alan sınırının tel sınırından BÜYÜK olduğunu -- yani T2-16'nın
        // gerçek bir açık olduğunu -- kayda geçirir. Alan sınırı düşürülürse
        // ya da tel formatı string'e çevrilirse bu test bilerek kırılır.
        decimal roundTripped = RoundTripThroughJsonNumber(QuantityRules.MaximumQuantity);
        Assert.NotEqual(QuantityRules.MaximumQuantity, roundTripped);

        // Uygulamada karşılaşılan büyüklükler bu tavanın çok altında olduğu için
        // açık teoriktir; yine de sınırın nerede olduğu burada yazılıdır.
        Assert.True(QuantityRules.MaximumQuantity > 9_007_199_254m / 1_000_000m);
    }
}
