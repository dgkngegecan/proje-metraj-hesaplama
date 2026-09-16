using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <inheritdoc cref="IUiStateWorkspace" />
public sealed class UiStateWorkspaceService(Func<MetrajDbContext> contextFactory) : IUiStateWorkspace
{
    private const int MaximumKeyLength = 256;
    private const int MaximumValueLength = 65_536;

    /// <inheritdoc />
    public async Task<IReadOnlyList<UiStateItem>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return await context.UiStates.AsNoTracking()
            .OrderBy(x => x.Key)
            .Select(x => new UiStateItem(x.Key, x.ValueJson, x.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<UiStateItem> SetAsync(string key, string valueJson, CancellationToken cancellationToken = default)
    {
        string normalizedKey = NormalizeKey(key);
        string normalizedValue = valueJson ?? string.Empty;
        if (normalizedValue.Length > MaximumValueLength)
        {
            throw new DomainRuleViolationException("ui-state.value", $"UI state value must not exceed {MaximumValueLength} characters.");
        }

        await using MetrajDbContext context = contextFactory();
        DateTime updatedAtUtc = DateTime.UtcNow;
        // One atomic statement avoids competing read-then-insert/update operations
        // while measurement and draft writes share the local SQLite database.
        await context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "UiStates" ("Key", "ValueJson", "UpdatedAtUtc")
            VALUES ({normalizedKey}, {normalizedValue}, {updatedAtUtc})
            ON CONFLICT("Key") DO UPDATE SET
                "ValueJson" = excluded."ValueJson", "UpdatedAtUtc" = excluded."UpdatedAtUtc"
            """, cancellationToken);
        return new UiStateItem(normalizedKey, normalizedValue, updatedAtUtc);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(string key, CancellationToken cancellationToken = default)
    {
        string normalizedKey = NormalizeKey(key);
        await using MetrajDbContext context = contextFactory();
        await context.UiStates.Where(x => x.Key == normalizedKey).ExecuteDeleteAsync(cancellationToken);
    }

    private static string NormalizeKey(string key)
    {
        string normalized = (key ?? string.Empty).Trim();
        if (normalized.Length is 0 or > MaximumKeyLength)
        {
            throw new DomainRuleViolationException("ui-state.key", $"UI state key must contain 1 to {MaximumKeyLength} characters.");
        }

        return normalized;
    }
}
