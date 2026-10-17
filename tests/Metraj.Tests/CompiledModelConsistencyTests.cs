using System.Globalization;
using Metraj.Infrastructure;
using Metraj.Infrastructure.CompiledModel;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Uygulama EF Core modelini çalışma zamanında <c>OnModelCreating</c>'den kurmaz,
/// derleme anında üretilmiş <see cref="MetrajDbContextModel"/>'i kullanır. Model
/// değişip derlenmiş model yenilenmezse uygulama ESKİ modelle çalışır: yeni bir
/// sütun yazılmaz, bir indeks/kısıt kaybolur ya da bir dönüştürücü eski ölçekle
/// yazar. Bu test o durumda kırılır ve yenileme komutunu söyler.
/// </summary>
public sealed class CompiledModelConsistencyTests
{
    private const string RefreshHint =
        "Derlenmiş EF Core modeli OnModelCreating ile uyuşmuyor. Yenileyin (docs/derleme.md): " +
        "dotnet build src/Metraj.Infrastructure -c Release -p:NuGetAudit=false && " +
        "dotnet-ef dbcontext optimize --project src/Metraj.Infrastructure --startup-project src/Metraj.Infrastructure " +
        "--context MetrajDbContext --output-dir CompiledModel --namespace Metraj.Infrastructure.CompiledModel --configuration Release --no-build";

    private static readonly decimal[] DecimalSamples = [0m, 1.234567m, -987654.321098m, 0.000001m, 12_345_678.5m];

    [Fact]
    public async Task ContextsUseTheCompiledModel()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-compiled-model-use");
        await using MetrajDbContext context = MetrajDbContextFactory.Create(database.Path);
        Assert.IsType<MetrajDbContextModel>(context.Model);
    }

    [Fact]
    public async Task CompiledModelMatchesTheModelBuiltFromOnModelCreating()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-compiled-model");
        await using MetrajDbContext context = MetrajDbContextFactory.Create(database.Path);
        IModel compiled = context.Model;
        // Tasarım zamanı modeli derlenmiş model kullanılırken bile OnModelCreating'den kurulur.
        IModel fromOnModelCreating = context.GetService<IDesignTimeModel>().Model;
        Assert.NotSame(compiled, fromOnModelCreating);

        string[] expected = Describe(fromOnModelCreating);
        string[] actual = Describe(compiled);
        string[] missing = expected.Except(actual, StringComparer.Ordinal).ToArray();
        string[] stale = actual.Except(expected, StringComparer.Ordinal).ToArray();
        Assert.True(missing.Length == 0 && stale.Length == 0,
            $"{RefreshHint}{Environment.NewLine}Modelde olup derlenmişte olmayan:{Environment.NewLine}  " +
            string.Join($"{Environment.NewLine}  ", missing) +
            $"{Environment.NewLine}Derlenmişte kalan eski hâl:{Environment.NewLine}  " +
            string.Join($"{Environment.NewLine}  ", stale));
    }

    [Fact]
    public void TheDumpCoversColumnTypesAndConverterBehaviour()
    {
        // Karşılaştırmanın kör olmadığının kanıtı: döküm sütun türünü ve dönüştürücünün
        // örnek değerlerdeki davranışını gerçekten içeriyor (ölçek değişirse fark çıkar).
        using MetrajDbContext context = MetrajDbContextFactory.Create(":memory:");
        string[] full = Describe(context.Model);
        Assert.Contains(full, line => line.StartsWith("[CatalogCardVersions].WasteRatePct type=INTEGER", StringComparison.Ordinal));
        Assert.Contains(full, line => line.Contains("WasteRatePct", StringComparison.Ordinal) &&
            line.Contains("1.234567->1234567->1.234567", StringComparison.Ordinal));
    }

    /// <summary>Modelin karşılaştırılabilir, sıralı bir dökümü.</summary>
    /// <remarks>
    /// İki katman: varlık modeli (özellik, anahtar, ilişki, gezinme, dönüştürücü) ve
    /// ilişkisel model (tablo, sütun adı ve türü, indeks, kısıt adları). Derlenmiş
    /// model yalnız çalışma zamanında gereken nitelikleri tutar; burada yalnız iki
    /// modelde de okunabilen nitelikler karşılaştırılır.
    /// </remarks>
    private static string[] Describe(IModel model)
    {
        var lines = new List<string>();
        foreach (IEntityType entity in model.GetEntityTypes().OrderBy(type => type.Name, StringComparer.Ordinal))
        {
            string name = entity.Name;
            lines.Add($"{name} table={entity.GetTableName()}");
            foreach (IProperty property in entity.GetProperties())
            {
                lines.Add($"{name}.{property.Name} clr={property.ClrType} nullable={property.IsNullable} " +
                    $"max={property.GetMaxLength()} generated={property.ValueGenerated} concurrency={property.IsConcurrencyToken} " +
                    $"store={property.GetRelationalTypeMapping().StoreType} converter={DescribeConverter(property)}");
            }

            foreach (IKey key in entity.GetKeys())
            {
                lines.Add($"{name} key({Names(key.Properties)}) primary={key.IsPrimaryKey()}");
            }

            foreach (IForeignKey foreignKey in entity.GetForeignKeys())
            {
                lines.Add($"{name} fk({Names(foreignKey.Properties)}) -> {foreignKey.PrincipalEntityType.Name}({Names(foreignKey.PrincipalKey.Properties)}) " +
                    $"delete={foreignKey.DeleteBehavior} required={foreignKey.IsRequired} unique={foreignKey.IsUnique} " +
                    $"toPrincipal={foreignKey.DependentToPrincipal?.Name} toDependent={foreignKey.PrincipalToDependent?.Name}");
            }

            foreach (IIndex index in entity.GetIndexes())
            {
                lines.Add($"{name} index({Names(index.Properties)}) unique={index.IsUnique}");
            }

            foreach (INavigation navigation in entity.GetNavigations())
            {
                lines.Add($"{name} navigation {navigation.Name} -> {navigation.TargetEntityType.Name} collection={navigation.IsCollection}");
            }
        }

        foreach (ITable table in model.GetRelationalModel().Tables.OrderBy(table => table.Name, StringComparer.Ordinal))
        {
            foreach (IColumn column in table.Columns.OrderBy(column => column.Name, StringComparer.Ordinal))
            {
                // Harmanlama, varsayılan değer gibi yalnız DDL'e ait nitelikler derlenmiş
                // modelde tutulmaz; EnsureCreated tabloları zaten OnModelCreating'den
                // kurulan tasarım zamanı modelinden üretir, dolayısıyla onlar bayatlamaz.
                lines.Add($"[{table.Name}].{column.Name} type={column.StoreType} nullable={column.IsNullable}");
            }

            foreach (ITableIndex index in table.Indexes.OrderBy(index => index.Name, StringComparer.Ordinal))
            {
                lines.Add($"[{table.Name}] index {index.Name}({string.Join(",", index.Columns.Select(column => column.Name))}) unique={index.IsUnique} filter={index.Filter}");
            }

            foreach (IForeignKeyConstraint constraint in table.ForeignKeyConstraints.OrderBy(constraint => constraint.Name, StringComparer.Ordinal))
            {
                lines.Add($"[{table.Name}] fk {constraint.Name}({string.Join(",", constraint.Columns.Select(column => column.Name))}) -> " +
                    $"{constraint.PrincipalTable.Name}({string.Join(",", constraint.PrincipalColumns.Select(column => column.Name))}) delete={constraint.OnDeleteAction}");
            }

            if (table.PrimaryKey is { } primaryKey)
            {
                lines.Add($"[{table.Name}] pk {primaryKey.Name}({string.Join(",", primaryKey.Columns.Select(column => column.Name))})");
            }
        }

        return lines.ToArray();
    }

    private static string Names(IReadOnlyList<IProperty> properties) => string.Join(",", properties.Select(property => property.Name));

    /// <summary>
    /// Dönüştürücüyü türüyle değil davranışıyla tarif eder: derlenmiş model
    /// dönüştürücünün ifadesini koda KOPYALAR (ör. ölçek çarpanı 1000000M sabit
    /// olarak yazılır). Dönüştürücü ya da ölçek sabiti değişip model yenilenmezse
    /// örnek değerlerin sağlayıcı karşılığı farklılaşır.
    /// </summary>
    private static string DescribeConverter(IProperty property)
    {
        ValueConverter? converter = property.GetTypeMapping().Converter ?? property.GetValueConverter();
        if (converter is null) return "none";

        Type model = Nullable.GetUnderlyingType(converter.ModelClrType) ?? converter.ModelClrType;
        IEnumerable<object> samples = model == typeof(decimal)
            ? DecimalSamples.Cast<object>()
            : model.IsEnum ? Enum.GetValues(model).Cast<object>() : [];
        string conversions = string.Join(";", samples.Select(sample =>
        {
            object? provider = converter.ConvertToProvider(sample);
            object? roundTrip = converter.ConvertFromProvider(provider);
            return string.Create(CultureInfo.InvariantCulture, $"{sample}->{provider}->{roundTrip}");
        }));
        return $"{converter.ModelClrType.Name}->{converter.ProviderClrType.Name} [{conversions}]";
    }
}
