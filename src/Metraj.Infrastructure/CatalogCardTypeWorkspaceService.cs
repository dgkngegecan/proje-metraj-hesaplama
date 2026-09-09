using System.Text.Json;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Persists global, safe card-type templates used by every project.</summary>
public sealed class CatalogCardTypeWorkspaceService(Func<MetrajDbContext> contextFactory) : ICatalogCardTypeWorkspace
{
    private static readonly string[] RequiredAttributeKeys = ["Code", "Name", "Unit"];
    private readonly Func<MetrajDbContext> contextFactory =
        contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));

    public async Task<IReadOnlyList<CatalogCardTypeListItem>> ListTypesAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return (await context.CatalogCardTypeDefinitions.AsNoTracking().ToListAsync(cancellationToken))
            .Select(ToListItem)
            .OrderBy(x => x.Code, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<CatalogCardTypeListItem> CreateTypeAsync(CatalogCardTypeDraft draft, CancellationToken cancellationToken = default)
    {
        string code = NormalizeCode(draft.Code);
        string name = NormalizeRequired(draft.Name, 128, "type name");
        string? description = NormalizeOptional(draft.Description, 2_000, "type description");
        IReadOnlyList<string> attributes = NormalizeAttributeKeys(draft.AttributeKeys);

        await using MetrajDbContext context = contextFactory();
        if (await context.CatalogCardTypeDefinitions.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new DomainRuleViolationException("catalog-type.code-unique", $"Catalog type code '{code}' already exists.");
        }

        Guid[] parents = await NormalizeCardReferencesAsync(context, draft.AllowedParentCardIds, "parent", cancellationToken);
        Guid[] children = await NormalizeCardReferencesAsync(context, draft.AllowedChildCardIds, "child", cancellationToken);
        var definition = new CatalogCardTypeDefinition
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = name,
            Description = description,
            BaseCardType = draft.BaseCardType,
            AllowedParentCardIdsJson = JsonSerializer.Serialize(parents),
            AllowedChildCardIdsJson = JsonSerializer.Serialize(children),
            AttributeKeysJson = JsonSerializer.Serialize(attributes),
            IsActive = true
        };
        context.CatalogCardTypeDefinitions.Add(definition);
        await context.SaveChangesAsync(cancellationToken);
        return ToListItem(definition);
    }

    public async Task DeleteTypeAsync(Guid typeId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        CatalogCardTypeDefinition definition = await context.CatalogCardTypeDefinitions
            .SingleOrDefaultAsync(x => x.Id == typeId, cancellationToken)
            ?? throw new DomainRuleViolationException("catalog-type.not-found", "Catalog card type was not found.");

        bool referenced = await context.CatalogCardVersions.AnyAsync(x => x.CatalogCardTypeDefinitionId == typeId, cancellationToken);
        if (referenced)
        {
            // Existing global cards and project snapshots remain valid; only new
            // cards stop being offered this type.
            definition.IsActive = false;
        }
        else
        {
            context.CatalogCardTypeDefinitions.Remove(definition);
        }
        await context.SaveChangesAsync(cancellationToken);
    }

    private static CatalogCardTypeListItem ToListItem(CatalogCardTypeDefinition definition) => new(
        definition.Id,
        definition.Code,
        definition.Name,
        definition.BaseCardType,
        JsonStore.ReadIds(definition.AllowedParentCardIdsJson),
        JsonStore.ReadIds(definition.AllowedChildCardIdsJson),
        ParseAttributes(definition.AttributeKeysJson),
        definition.IsActive,
        definition.Description);

    // Bu servis kural kodunu sabit tutup alan adını iletiye gömüyor; gövde
    // TextRules'ta ama sözleşme (kural kodları) burada korunuyor.
    private static string NormalizeCode(string value) =>
        TextRules.Code(value, 64, "catalog-type.code", "Type code must be filled and at most 64 characters.");

    private static string NormalizeRequired(string value, int maximumLength, string fieldName) =>
        TextRules.Required(value, maximumLength, "catalog-type.required", $"{fieldName} must be filled within its supported length.");

    private static string? NormalizeOptional(string? value, int maximumLength, string fieldName) =>
        TextRules.Optional(value, maximumLength, "catalog-type.optional", $"{fieldName} must not exceed {maximumLength} characters.");

    private static string[] NormalizeAttributeKeys(IEnumerable<string>? keys)
    {
        var selected = CatalogCardAttributeCatalog.NormalizeKeys(keys).ToList();
        foreach (string required in RequiredAttributeKeys)
        {
            if (!selected.Contains(required, StringComparer.OrdinalIgnoreCase))
            {
                selected.Insert(0, required);
            }
        }
        return selected
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(key => Array.FindIndex(RequiredAttributeKeys, x => x.Equals(key, StringComparison.OrdinalIgnoreCase)) < 0 ? 99 : Array.FindIndex(RequiredAttributeKeys, x => x.Equals(key, StringComparison.OrdinalIgnoreCase)))
            .ThenBy(key => key, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static async Task<Guid[]> NormalizeCardReferencesAsync(MetrajDbContext context, IEnumerable<Guid>? values, string role, CancellationToken cancellationToken)
    {
        Guid[] ids = (values ?? []).Distinct().ToArray();
        if (ids.Length == 0) return [];
        Guid[] found = await context.CatalogCardDefinitions
            .Where(x => ids.Contains(x.Id) && x.IsActive)
            .Select(x => x.Id)
            .ToArrayAsync(cancellationToken);
        if (found.Length != ids.Length)
        {
            throw new DomainRuleViolationException($"catalog-type.{role}-reference", $"Every selected {role} card must exist and be active in the global catalog.");
        }
        return ids;
    }

    private static IReadOnlyList<string> ParseAttributes(string json)
    {
        string[]? keys = JsonStore.Read<string[]?>(json, null);
        return keys is null ? RequiredAttributeKeys : CatalogCardAttributeCatalog.NormalizeKeys(keys);
    }
}
