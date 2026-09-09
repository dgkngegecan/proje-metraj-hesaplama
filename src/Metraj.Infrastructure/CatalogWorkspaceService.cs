using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Globalization;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Catalog operations that preserve immutable card versions.</summary>
public sealed class CatalogWorkspaceService(Func<MetrajDbContext> contextFactory) : ICatalogWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory =
        contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));

    public async Task<IReadOnlyList<CatalogCardListItem>> ListCardsAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return await ProjectLatestVersionsAsync(context.CatalogCardDefinitions.AsNoTracking(), cancellationToken);
    }

    /// <summary>
    /// Verilen kart kümesinin yalnızca EN SON sürümlerini listeye çevirir.
    /// </summary>
    /// <remarks>
    /// Önceki hâl her kartın bütün sürüm geçmişini belleğe alıp seçimi orada
    /// yapıyordu; sürümleme bu modelin amacı olduğu için o küme kullanıldıkça
    /// büyüyordu. Kaynak sorgusu dışarıdan geldiği için çağıranlar süzmeyi
    /// veritabanında yapabiliyor.
    /// </remarks>
    private static async Task<IReadOnlyList<CatalogCardListItem>> ProjectLatestVersionsAsync(
        IQueryable<CatalogCardDefinition> source,
        CancellationToken cancellationToken)
    {
        var rows = await source
            .Select(definition => new
            {
                Definition = definition,
                Latest = definition.Versions
                    .OrderByDescending(version => version.VersionNumber)
                    .FirstOrDefault(),
                // ToListItem kart tipini de okuyor. AsNoTracking projeksiyonunda
                // gezinme özellikleri kendiliğinden dolmaz; açıkça çekilmezse
                // özel tip adı ve öznitelik anahtarları sessizce boşalırdı.
                LatestType = definition.Versions
                    .OrderByDescending(version => version.VersionNumber)
                    .Select(version => version.CatalogCardTypeDefinition)
                    .FirstOrDefault()
            })
            .Where(row => row.Latest != null)
            .ToListAsync(cancellationToken);

        return rows
            .Select(row =>
            {
                row.Latest!.CatalogCardTypeDefinition = row.LatestType;
                return ToListItem(row.Definition, row.Latest);
            })
            .OrderBy(x => x.Code)
            .ToList();
    }

    public async Task<CatalogCardListItem> CreateCardAsync(CatalogCardDraft draft, CancellationToken cancellationToken = default)
    {
        string code = draft.Code.Trim().ToUpperInvariant();
        string name = draft.Name.Trim();
        string unit = draft.Unit.Trim();
        string? positionNumber = NormalizeOptionalText(draft.PositionNumber, 64, "position number");
        if (code.Length is 0 or > 64 || name.Length is 0 or > 256 || unit.Length is 0 or > 32)
        {
            throw new DomainRuleViolationException("catalog.required", "Code, name and unit must be filled within their supported lengths.");
        }

        // Doğrulama yalnızca ÇÖZÜLMÜŞ değerler üzerinde yapılır (bkz.
        // ResolveContentAsync). Önceden burada bir kez ham taslak, aşağıda bir
        // kez de çözülmüş değer doğrulanıyordu; sürüm yolunda ise yalnızca ham
        // taslak doğrulanıp çözülmüş değer kaydediliyordu.
        await using MetrajDbContext context = contextFactory();
        if (await context.CatalogCardDefinitions.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new DomainRuleViolationException("catalog.code-unique", $"Catalog code '{code}' already exists.");
        }

        ResolvedCardContent content = await ResolveContentAsync(context, draft, code, name, unit, positionNumber, cancellationToken);

        var definition = new CatalogCardDefinition
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = name,
            Description = content.Description
        };
        CatalogCardVersion version = content.ToVersion(definition.Id, versionNumber: 1);
        context.AddRange(definition, version);
        await context.SaveChangesAsync(cancellationToken);
        return ToListItem(definition, version);
    }

    public async Task<CatalogCardListItem> CreateVersionAsync(Guid definitionId, CatalogCardDraft draft, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        CatalogCardDefinition definition = await context.CatalogCardDefinitions.Include(x => x.Versions)
            .SingleOrDefaultAsync(x => x.Id == definitionId, cancellationToken)
            ?? throw new DomainRuleViolationException("catalog.definition", "Catalog card definition was not found.");
        if (!definition.IsActive)
        {
            throw new DomainRuleViolationException("catalog.inactive", "An inactive card cannot receive a new version.");
        }

        string name = draft.Name.Trim();
        string unit = draft.Unit.Trim();
        if (name.Length is 0 or > 256 || unit.Length is 0 or > 32)
        {
            throw new DomainRuleViolationException("catalog.version-content", "Name and unit must be filled within their supported lengths.");
        }

        ResolvedCardContent content = await ResolveContentAsync(
            context, draft, definition.Code, name, unit, NormalizeOptionalText(draft.PositionNumber, 64, "position number"), cancellationToken);

        int versionNumber = definition.Versions.Max(x => x.VersionNumber) + 1;
        definition.Description = content.Description;
        CatalogCardVersion version = content.ToVersion(definition.Id, versionNumber);
        context.CatalogCardVersions.Add(version);
        await context.SaveChangesAsync(cancellationToken);
        return ToListItem(definition, version);
    }

    public async Task DeactivateCardAsync(Guid definitionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        CatalogCardDefinition definition = await context.CatalogCardDefinitions.SingleOrDefaultAsync(x => x.Id == definitionId, cancellationToken)
            ?? throw new DomainRuleViolationException("catalog.definition", "Catalog card definition was not found.");
        definition.IsActive = false;
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteCardAsync(Guid definitionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        CatalogCardDefinition definition = await context.CatalogCardDefinitions.Include(x => x.Versions)
            .SingleOrDefaultAsync(x => x.Id == definitionId, cancellationToken)
            ?? throw new DomainRuleViolationException("catalog.definition", "Catalog card definition was not found.");
        Guid[] versions = definition.Versions.Select(x => x.Id).ToArray();
        if (await context.ProjectPlacements.AnyAsync(x => versions.Contains(x.CatalogCardVersionId), cancellationToken))
        {
            definition.IsActive = false;
        }
        else
        {
            context.CatalogCardVersions.RemoveRange(definition.Versions);
            context.CatalogCardDefinitions.Remove(definition);
        }
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<CatalogCardListItem>> ListCompatibleFittingsAsync(Guid pipePlacementId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        if (!await context.ProjectPlacements.AnyAsync(x => x.Id == pipePlacementId, cancellationToken))
        {
            throw new DomainRuleViolationException("placement.not-found", "Pipe placement was not found.");
        }
        var enteredDiameters = (await context.Measurements.AsNoTracking()
            .Where(x => x.ProjectPlacementId == pipePlacementId && x.Variant != null)
            .Select(x => x.Variant!).Distinct().ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        // Aktiflik ve kart tipi süzgeci artık veritabanında uygulanıyor; önceki
        // hâl BÜTÜN kartları listeye çevirip sonra bellekte eliyordu.
        IQueryable<CatalogCardDefinition> accessories = context.CatalogCardDefinitions
            .AsNoTracking()
            .Where(definition => definition.IsActive)
            .Where(definition => definition.Versions
                .OrderByDescending(version => version.VersionNumber)
                .First().CardType == CardType.Accessory);

        IReadOnlyList<CatalogCardListItem> cards = await ProjectLatestVersionsAsync(accessories, cancellationToken);
        // Uyumlu çaplar JSON içinde saklandığı için bu süzgeç bellekte kalıyor.
        return cards
            .Where(x => enteredDiameters.Count == 0 || x.CompatibleDiameters is null || x.CompatibleDiameters.Count == 0 ||
                x.CompatibleDiameters.Any(enteredDiameters.Contains))
            .ToList();
    }

    /// <summary>
    /// Bir taslağın gerçekten KAYDEDİLECEK hâli. Öznitelik geçersiz kılmaları
    /// burada çözülür, doğrulama burada yapılır ve parmak izi buradan üretilir.
    /// </summary>
    /// <remarks>
    /// Oluşturma ve yeni sürüm yolları bu çözümlemeyi ayrı ayrı yapıyordu ve
    /// ayrışmışlardı: oluşturma çözülmüş değeri doğruluyor, sürüm ise HAM
    /// taslağı doğrulayıp çözülmüş değeri kaydediyordu. Bu yüzden öznitelik
    /// üzerinden gelen negatif bir boy kapasitesi kaydedilebiliyor, hata ancak
    /// kullanıcı rapor alırken ortaya çıkıyordu.
    /// </remarks>
    private sealed record ResolvedCardContent(
        string Code,
        string Name,
        string Unit,
        CardType CardType,
        ItemKind ItemKind,
        InputBehavior InputBehavior,
        SalesConversion SalesConversion,
        ReportBehavior ReportBehavior,
        decimal WasteRatePct,
        decimal? ContainerParameter,
        string? PositionNumber,
        string? Description,
        string? MaterialType,
        IReadOnlyList<string> CompatibleDiameters,
        Guid? CustomTypeId,
        CatalogVariantMode VariantMode,
        IReadOnlyList<CatalogCardVariant> Variants,
        IReadOnlyDictionary<string, string> AttributeValues,
        CatalogCardTypeDefinition? CustomType)
    {
        /// <summary>Kaydedilecek sürüm varlığını, parmak iziyle birlikte üretir.</summary>
        public CatalogCardVersion ToVersion(Guid definitionId, int versionNumber) => new()
        {
            Id = Guid.NewGuid(),
            CatalogCardDefinitionId = definitionId,
            CatalogCardTypeDefinitionId = CustomTypeId,
            VersionNumber = versionNumber,
            Name = Name,
            CardType = CardType,
            ItemKind = ItemKind,
            InputBehavior = InputBehavior,
            SalesConversion = SalesConversion,
            ReportBehavior = ReportBehavior,
            Unit = Unit,
            WasteRatePct = WasteRatePct,
            ContainerParameter = ContainerParameter,
            PositionNumber = PositionNumber,
            VariantMode = VariantMode,
            VariantDefinitionsJson = CatalogVariantCatalog.Serialize(Variants),
            MaterialType = MaterialType,
            CompatibleDiametersJson = SerializeDiameters(CompatibleDiameters),
            AttributeValuesJson = SerializeAttributeValues(AttributeValues),
            ContentHash = ComputeContentHash(),
            IsPublished = true,
            CatalogCardTypeDefinition = CustomType
        };

        /// <summary>Kaydedilen içeriğin kararlı parmak izi.</summary>
        /// <remarks>
        /// Kanonik biçim için anonim tip yerine açık ve sıralı bir sözlük
        /// kullanılır: anonim tip üye sıralaması derleyiciye bağlıdır ve bu
        /// hash kalıcı olarak saklanmaktadır. Sayılar kültürden bağımsız
        /// biçimlendirilir.
        /// </remarks>
        private string ComputeContentHash()
        {
            var canonical = new SortedDictionary<string, string?>(StringComparer.Ordinal)
            {
                ["code"] = Code,
                ["name"] = Name,
                ["unit"] = Unit,
                ["cardType"] = CardType.ToString(),
                ["itemKind"] = ItemKind.ToString(),
                ["inputBehavior"] = InputBehavior.ToString(),
                ["salesConversion"] = SalesConversion.ToString(),
                ["reportBehavior"] = ReportBehavior.ToString(),
                ["wasteRatePct"] = WasteRatePct.ToString("0.######", CultureInfo.InvariantCulture),
                ["containerParameter"] = ContainerParameter?.ToString("0.######", CultureInfo.InvariantCulture),
                ["positionNumber"] = PositionNumber,
                ["description"] = Description,
                ["materialType"] = MaterialType,
                ["compatibleDiameters"] = string.Join('\u001f', CompatibleDiameters),
                ["customTypeId"] = CustomTypeId?.ToString("D"),
                ["variantMode"] = VariantMode.ToString(),
                ["variants"] = CatalogVariantCatalog.Serialize(Variants),
                ["attributeValues"] = SerializeAttributeValues(AttributeValues)
            };
            string payload = string.Join('\u001e', canonical.Select(pair => $"{pair.Key}{'\u001f'}{pair.Value}"));
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        }
    }

    /// <summary>Taslağı çözer, doğrular ve kaydedilecek içeriği üretir.</summary>
    private static async Task<ResolvedCardContent> ResolveContentAsync(
        MetrajDbContext context,
        CatalogCardDraft draft,
        string code,
        string name,
        string unit,
        string? positionNumber,
        CancellationToken cancellationToken)
    {
        CatalogCardTypeDefinition? customType = await ResolveCustomTypeAsync(context, draft, cancellationToken);
        Dictionary<string, string> attributeValues = NormalizeAttributeValues(draft.AttributeValues, customType);

        decimal wasteRate = ResolveDecimalAttribute(attributeValues, "WasteRatePct") ?? draft.WasteRatePct;
        decimal? containerParameter = ResolveDecimalAttribute(attributeValues, "ContainerParameter") ?? draft.ContainerParameter;
        IReadOnlyList<string> compatibleDiameters = draft.CompatibleDiameters is { Count: > 0 }
            ? draft.CompatibleDiameters
            : ResolveDiametersAttribute(attributeValues);
        IReadOnlyList<CatalogCardVariant> variants = CatalogVariantCatalog.Normalize(draft.Variants);
        EnsureVariantProfile(draft.VariantMode, variants);

        // Doğrulama ÇÖZÜLMÜŞ değerler üzerinde; alan ve öznitelik yolları aynı
        // kurallara tabidir.
        QuantityRules.EnsureValid(wasteRate, "waste rate");
        if (containerParameter is decimal resolvedContainer)
        {
            QuantityRules.EnsureValid(resolvedContainer, "container parameter");
            if (resolvedContainer == 0m)
            {
                throw new DomainRuleViolationException("catalog.container-positive", "Container parameter must be greater than zero when supplied.");
            }
        }

        return new ResolvedCardContent(
            code,
            name,
            unit,
            draft.CardType,
            ResolveEnumAttribute<ItemKind>(attributeValues, "ItemKind") ?? draft.ItemKind,
            ResolveEnumAttribute<InputBehavior>(attributeValues, "InputBehavior") ?? draft.InputBehavior,
            ResolveEnumAttribute<SalesConversion>(attributeValues, "SalesConversion") ?? draft.SalesConversion,
            ResolveEnumAttribute<ReportBehavior>(attributeValues, "ReportBehavior") ?? draft.ReportBehavior,
            wasteRate,
            containerParameter,
            NormalizeOptionalText(ResolveTextAttribute(attributeValues, "PositionNumber") ?? positionNumber, 64, "position number"),
            NormalizeOptionalText(attributeValues.TryGetValue("Notes", out string? noteValue) ? noteValue : draft.Notes, 2_000, "notes"),
            NormalizeOptionalText(ResolveTextAttribute(attributeValues, "MaterialType") ?? draft.MaterialType, 128, "material type"),
            NormalizeDiameters(compatibleDiameters),
            customType?.Id,
            draft.VariantMode,
            variants,
            attributeValues,
            customType);
    }

    private static CatalogCardListItem ToListItem(CatalogCardDefinition definition, CatalogCardVersion version) => new(
        definition.Id,
        version.Id,
        definition.Code,
        version.Name,
        version.CardType,
        version.Unit,
        version.InputBehavior,
        version.SalesConversion,
        version.ReportBehavior,
        version.WasteRatePct,
        version.ContainerParameter,
        version.PositionNumber,
        version.VersionNumber,
        definition.IsActive,
        definition.Description,
        version.MaterialType,
        DeserializeDiameters(version.CompatibleDiametersJson),
        version.CatalogCardTypeDefinitionId,
        version.CatalogCardTypeDefinition?.Code,
        version.CatalogCardTypeDefinition?.Name,
        ParseAttributeKeys(version.CatalogCardTypeDefinition?.AttributeKeysJson),
        DeserializeAttributeValues(version.AttributeValuesJson),
        version.VariantMode,
        CatalogVariantCatalog.Parse(version.VariantDefinitionsJson));

    private static void EnsureVariantProfile(CatalogVariantMode mode, IReadOnlyList<CatalogCardVariant> variants)
    {
        if (mode is CatalogVariantMode.Pipe or CatalogVariantMode.Fitting && variants.Count == 0)
        {
            throw new DomainRuleViolationException("catalog.variant.empty", "Pipe and fitting cards must define at least one variant.");
        }

        if (mode == CatalogVariantMode.Pipe && variants.Any(x => x.StandardLength is null or <= 0m))
        {
            throw new DomainRuleViolationException("catalog.variant.pipe-length", "Every pipe diameter must have a positive standard length.");
        }

        if (mode == CatalogVariantMode.None && variants.Count > 0)
        {
            throw new DomainRuleViolationException("catalog.variant.mode", "Variant definitions require Pipe or Fitting variant behavior.");
        }
    }

    private static string SerializeDiameters(IReadOnlyList<string>? values) => JsonSerializer.Serialize(NormalizeDiameters(values));

    private static string[] NormalizeDiameters(IReadOnlyList<string>? values) =>
        (values ?? []).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();

    private static string[] DeserializeDiameters(string json) => JsonStore.Read<string[]>(json, []);

    private static IReadOnlyList<string> ParseAttributeKeys(string? json)
    {
        string[]? keys = JsonStore.Read<string[]?>(json, null);
        return keys is null ? [] : CatalogCardAttributeCatalog.NormalizeKeys(keys);
    }

    private static Dictionary<string, string> DeserializeAttributeValues(string? json) =>
        JsonStore.Read(json, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));

    private static string SerializeAttributeValues(IReadOnlyDictionary<string, string> values) =>
        JsonSerializer.Serialize(values
            .Where(x => !string.IsNullOrWhiteSpace(x.Key) && !string.IsNullOrWhiteSpace(x.Value))
            .OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.Value.Trim(), StringComparer.OrdinalIgnoreCase));

    private static async Task<CatalogCardTypeDefinition?> ResolveCustomTypeAsync(MetrajDbContext context, CatalogCardDraft draft, CancellationToken cancellationToken)
    {
        if (draft.CustomTypeId is not Guid typeId)
        {
            return null;
        }

        CatalogCardTypeDefinition type = await context.CatalogCardTypeDefinitions
            .SingleOrDefaultAsync(x => x.Id == typeId, cancellationToken)
            ?? throw new DomainRuleViolationException("catalog-type.not-found", "Selected custom card type was not found.");
        if (!type.IsActive)
        {
            throw new DomainRuleViolationException("catalog-type.inactive", "An inactive custom card type cannot be used for a new card version.");
        }
        if (type.BaseCardType != draft.CardType)
        {
            throw new DomainRuleViolationException("catalog-type.base-type", "The card type must match the selected custom type's base type.");
        }
        return type;
    }

    private static Dictionary<string, string> NormalizeAttributeValues(
        IReadOnlyDictionary<string, string>? values, CatalogCardTypeDefinition? customType)
    {
        if (values is null || values.Count == 0)
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }

        HashSet<string>? allowed = customType is null
            ? null
            : ParseAttributeKeys(customType.AttributeKeysJson).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var normalized = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach ((string key, string value) in values)
        {
            string canonical = CatalogCardAttributeCatalog.Canonical(key)
                ?? throw new DomainRuleViolationException("catalog-type.attribute-key", $"Unknown card attribute '{key}'.");
            if (allowed is not null && !allowed.Contains(canonical))
            {
                throw new DomainRuleViolationException("catalog-type.attribute-not-enabled", $"Attribute '{canonical}' is not enabled for this card type.");
            }
            if (!string.IsNullOrWhiteSpace(value)) normalized[canonical] = value.Trim();
        }
        return normalized;
    }

    private static decimal? ResolveDecimalAttribute(Dictionary<string, string> values, string key)
    {
        if (!values.TryGetValue(key, out string? raw) || string.IsNullOrWhiteSpace(raw)) return null;
        string normalized = raw.Trim().Replace(',', '.');
        return decimal.TryParse(normalized, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal value)
            ? value
            : throw new DomainRuleViolationException("catalog-type.attribute-number", $"Attribute '{key}' must be a valid number.");
    }

    private static string? ResolveTextAttribute(Dictionary<string, string> values, string key) =>
        values.TryGetValue(key, out string? value) && !string.IsNullOrWhiteSpace(value) ? value.Trim() : null;

    private static TEnum? ResolveEnumAttribute<TEnum>(Dictionary<string, string> values, string key)
        where TEnum : struct, Enum
    {
        string? raw = ResolveTextAttribute(values, key);
        if (raw is null) return null;
        // TryParse tek başına yeterli değil: tanımsız bir sayısal değer ("5")
        // de başarıyla ayrıştırılır ve numaralandırmada karşılığı olmayan bir
        // değer kaydedilirdi.
        return Enum.TryParse(raw, ignoreCase: true, out TEnum parsed) && Enum.IsDefined(parsed)
            ? parsed
            : throw new DomainRuleViolationException("catalog-type.attribute-enum", $"Attribute '{key}' has an unsupported value.");
    }

    private static string[] ResolveDiametersAttribute(Dictionary<string, string> values)
    {
        string? value = ResolveTextAttribute(values, "CompatibleDiameters");
        return string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split([',', ';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private static string? NormalizeOptionalText(string? value, int maximumLength, string fieldName) =>
        TextRules.Optional(value, maximumLength, "catalog.optional-text", $"{fieldName} must not exceed {maximumLength} characters.");
}
