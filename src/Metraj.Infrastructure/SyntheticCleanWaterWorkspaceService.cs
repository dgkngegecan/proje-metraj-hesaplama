using System.Globalization;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Loads the bundled, explicitly synthetic Clean Water acceptance data without external connectors.</summary>
public sealed class SyntheticCleanWaterWorkspaceService : ISyntheticCleanWaterWorkspace
{
    private const string ProjectCode = "SYN-CW-001";
    private readonly Func<MetrajDbContext> contextFactory;
    private readonly string? csvPath;
    private readonly Func<Stream>? csvStreamFactory;

    /// <summary>Creates an importer using the supplied immutable synthetic CSV fixture.</summary>
    public SyntheticCleanWaterWorkspaceService(Func<MetrajDbContext> contextFactory, string csvPath)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
        this.csvPath = string.IsNullOrWhiteSpace(csvPath) ? throw new ArgumentException("A sample CSV path is required.", nameof(csvPath)) : csvPath;
    }

    /// <summary>Creates an importer using a bundled immutable synthetic CSV stream.</summary>
    public SyntheticCleanWaterWorkspaceService(Func<MetrajDbContext> contextFactory, Func<Stream> csvStreamFactory)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
        this.csvStreamFactory = csvStreamFactory ?? throw new ArgumentNullException(nameof(csvStreamFactory));
    }

    /// <inheritdoc />
    public async Task<SyntheticCleanWaterImportResult> ImportAsync(CancellationToken cancellationToken = default)
    {
        if (csvPath is not null && !File.Exists(csvPath))
        {
            throw new FileNotFoundException("Bundled synthetic Clean Water CSV could not be found.", csvPath);
        }

        await using MetrajDbContext context = contextFactory();
        Project? existing = await context.Projects.AsNoTracking()
            .Include(x => x.Revisions)
            .SingleOrDefaultAsync(x => x.Code == ProjectCode, cancellationToken);
        if (existing is not null)
        {
            ProjectRevision existingRevision = existing.Revisions.MaxBy(x => x.RevisionNumber)!;
            int placementCount = await context.ProjectPlacements.CountAsync(x => x.ProjectRevisionId == existingRevision.Id, cancellationToken);
            int measurementCount = await context.Measurements.CountAsync(x => x.ProjectRevisionId == existingRevision.Id, cancellationToken);
            return new SyntheticCleanWaterImportResult(ToProjectListItem(existing, existingRevision), true, placementCount, measurementCount);
        }

        IReadOnlyList<SyntheticMeasurementRow> rows = await ReadRowsAsync(cancellationToken);
        DateTime now = DateTime.UtcNow;
        var project = new Project { Id = Guid.NewGuid(), Code = ProjectCode, Name = "Sentetik Temiz Su Referans Projesi", Description = "SYNTHETIC — gerçek metraj değildir; kabul ve regresyon verisidir.", CreatedAtUtc = now };
        // Normal proje oluşturma akışı R0'ı dahili sıra numarası 1 ile başlatır.
        // Örnek proje de aynı sözleşmeyi izlemelidir; aksi halde ilk kopya R0'ı tekrarlar.
        var revision = new ProjectRevision { Id = Guid.NewGuid(), ProjectId = project.Id, RevisionNumber = 1, Code = "R0", Status = ProjectRevisionStatus.Draft, CreatedAtUtc = now };
        Dictionary<string, CatalogCardVersion> cards = CreateCards(rows, now);
        CatalogCardVersion rootCard = CreateRootCard(now);
        cards.Add("ROOT", rootCard);

        // "Bütün projeleri temizle" kartları korur. Örnek proje temizlendikten sonra
        // yeniden açılırsa SYN-* kart tanımları zaten vardır; yeniden eklemek
        // CatalogCardDefinitions.Code benzersizlik hatasıyla 500 veriyordu. Var olan
        // ilk sürümler yeniden kullanılır, yalnız eksik olanlar eklenir.
        string[] cardCodes = cards.Values.Select(x => x.CatalogCardDefinition!.Code).ToArray();
        Dictionary<string, CatalogCardVersion> existingByCode = await context.CatalogCardVersions
            .Include(x => x.CatalogCardDefinition)
            .Where(x => x.VersionNumber == 1 && cardCodes.Contains(x.CatalogCardDefinition!.Code))
            .ToDictionaryAsync(x => x.CatalogCardDefinition!.Code, StringComparer.Ordinal, cancellationToken);
        var newCards = new List<CatalogCardVersion>();
        foreach (string key in cards.Keys.ToArray())
        {
            string code = cards[key].CatalogCardDefinition!.Code;
            if (existingByCode.TryGetValue(code, out CatalogCardVersion? existingCard))
            {
                cards[key] = existingCard;
            }
            else
            {
                newCards.Add(cards[key]);
            }
        }

        var placementBySourceId = new Dictionary<string, ProjectPlacement>(StringComparer.OrdinalIgnoreCase);
        var root = new ProjectPlacement
        {
            Id = Guid.NewGuid(), ProjectRevisionId = revision.Id, CatalogCardVersionId = cards["ROOT"].Id,
            DisplayNameOverride = project.Name, Notes = "SYNTHETIC reference fixture", CatalogCardVersion = cards["ROOT"]
        };
        placementBySourceId.Add("ROOT", root);
        foreach (IGrouping<string, SyntheticMeasurementRow> group in rows.GroupBy(x => x.PlacementId, StringComparer.OrdinalIgnoreCase).OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase))
        {
            SyntheticMeasurementRow first = group.First();
            CatalogCardVersion card = cards[first.CardVersionId];
            placementBySourceId.Add(group.Key, new ProjectPlacement
            {
                Id = Guid.NewGuid(), ProjectRevisionId = revision.Id, CatalogCardVersionId = card.Id,
                ParentPlacementId = root.Id, DisplayNameOverride = DisplayNameFor(first.CardVersionId, first.PlacementId),
                ProcurementScope = first.ProcurementScope, CatalogCardVersion = card
            });
        }

        var placements = placementBySourceId.Values.ToList();
        var measurements = rows.Select(row => new Measurement
        {
            Id = Guid.NewGuid(), ProjectRevisionId = revision.Id, ProjectPlacementId = placementBySourceId[row.PlacementId].Id,
            SourceKind = "SYNTHETIC", SourceRowId = row.SourceRowId, InputQuantity = row.Quantity, InputUnit = row.Unit,
            Block = row.Block, Floor = row.Floor, Room = row.Room, Zone = row.Zone, Sheet = row.Sheet,
            DrawingRevision = row.DrawingRevision, CreatedAtUtc = now
        }).ToList();

        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        context.Add(project);
        context.Add(revision);
        context.CatalogCardDefinitions.AddRange(newCards.Select(x => x.CatalogCardDefinition!));
        context.CatalogCardVersions.AddRange(newCards);
        context.ProjectPlacements.AddRange(placements);
        context.Measurements.AddRange(measurements);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new SyntheticCleanWaterImportResult(ToProjectListItem(project, revision), false, placements.Count, measurements.Count);
    }

    private async Task<IReadOnlyList<SyntheticMeasurementRow>> ReadRowsAsync(CancellationToken cancellationToken)
    {
        string[] lines;
        if (csvPath is not null)
        {
            lines = await File.ReadAllLinesAsync(csvPath, cancellationToken);
        }
        else
        {
            await using Stream stream = csvStreamFactory?.Invoke()
                ?? throw new InvalidDataException("Bundled synthetic Clean Water CSV could not be opened.");
            using var reader = new StreamReader(stream);
            string content = await reader.ReadToEndAsync(cancellationToken);
            lines = content.Split(["\r\n", "\n"], StringSplitOptions.None);
        }

        if (lines.Length < 2)
        {
            throw new InvalidDataException("Synthetic Clean Water CSV contains no measurements.");
        }

        var rows = new List<SyntheticMeasurementRow>(lines.Length - 1);
        foreach (string line in lines.Skip(1).Where(static line => !string.IsNullOrWhiteSpace(line)))
        {
            string[] cells = line.Split(',');
            if (cells.Length < 24)
            {
                throw new InvalidDataException("Synthetic Clean Water CSV has an invalid column count.");
            }

            rows.Add(new SyntheticMeasurementRow(
                cells[3], cells[5], cells[6], cells[7], cells[8], cells[9], cells[10], cells[11], cells[12],
                decimal.Parse(cells[13], CultureInfo.InvariantCulture), cells[14], decimal.Parse(cells[15], CultureInfo.InvariantCulture),
                ParseConversion(cells[16]), decimal.Parse(cells[17], CultureInfo.InvariantCulture), cells[19]));
        }

        return rows;
    }

    private static Dictionary<string, CatalogCardVersion> CreateCards(IReadOnlyList<SyntheticMeasurementRow> rows, DateTime now)
    {
        var cards = new Dictionary<string, CatalogCardVersion>(StringComparer.OrdinalIgnoreCase);
        foreach (SyntheticMeasurementRow row in rows)
        {
            if (cards.ContainsKey(row.CardVersionId))
            {
                continue;
            }

            string code = row.CardVersionId.Replace("-v1", string.Empty, StringComparison.OrdinalIgnoreCase);
            CardType cardType = code.Contains("ELB", StringComparison.OrdinalIgnoreCase) || code.Contains("TEE", StringComparison.OrdinalIgnoreCase)
                ? CardType.Accessory : CardType.Material;
            var definition = new CatalogCardDefinition { Id = Guid.NewGuid(), Code = $"SYN-{code}", Name = DisplayNameFor(row.CardVersionId, null), CreatedAtUtc = now };
            cards.Add(row.CardVersionId, new CatalogCardVersion
            {
                Id = Guid.NewGuid(), CatalogCardDefinitionId = definition.Id, CatalogCardDefinition = definition, VersionNumber = 1,
                Name = definition.Name, CardType = cardType, ItemKind = code.Contains("VAL", StringComparison.OrdinalIgnoreCase) ? ItemKind.Equipment : ItemKind.Material,
                InputBehavior = InputBehavior.Manual, SalesConversion = row.SalesConversion, ReportBehavior = ReportBehavior.Measurable,
                Unit = row.Unit, WasteRatePct = row.WasteRatePct, ContainerParameter = row.ContainerParameter,
                ContentHash = $"SYNTHETIC-{row.CardVersionId}", IsPublished = true, CreatedAtUtc = now
            });
        }

        return cards;
    }

    private static CatalogCardVersion CreateRootCard(DateTime now)
    {
        var definition = new CatalogCardDefinition { Id = Guid.NewGuid(), Code = "SYN-CW-ROOT", Name = "Temiz Su", CreatedAtUtc = now };
        return new CatalogCardVersion
        {
            Id = Guid.NewGuid(), CatalogCardDefinitionId = definition.Id, CatalogCardDefinition = definition, VersionNumber = 1,
            Name = definition.Name, CardType = CardType.System, ItemKind = ItemKind.Service, InputBehavior = InputBehavior.Manual,
            SalesConversion = SalesConversion.None, ReportBehavior = ReportBehavior.Folder, Unit = "-", ContentHash = "SYNTHETIC-ROOT", IsPublished = true, CreatedAtUtc = now
        };
    }

    private static ProjectListItem ToProjectListItem(Project project, ProjectRevision revision) => new(project.Id, project.Code, project.Name, 1, revision.Id, project.CreatedAtUtc);

    private static SalesConversion ParseConversion(string value) => value.ToLowerInvariant() switch
    {
        "standard-length" => SalesConversion.StandardLength,
        "package" => SalesConversion.Package,
        _ => SalesConversion.None
    };

    private static string DisplayNameFor(string cardVersionId, string? placementId) => placementId switch
    {
        "PL-PPR25-A" => "PPRC Boru DN25 — A Blok",
        "PL-PPR25-B" => "PPRC Boru DN25 — B Blok",
        "PL-PPR25-C" => "PPRC Boru DN25 — Çatı",
        "PL-PPR32-A" => "PPRC Boru DN32 — A Blok",
        "PL-PPR32-B" => "PPRC Boru DN32 — B Blok",
        "PL-PPR50-A" => "PPRC Boru DN50 — Bodrum Ana Hat",
        "PL-PPR20-A" => "PPRC Boru DN20 — Daire Dağıtımı",
        _ => cardVersionId switch
        {
            "CW-PPR20-v1" => "PPRC Boru DN20", "CW-PPR25-v1" => "PPRC Boru DN25", "CW-PPR32-v1" => "PPRC Boru DN32", "CW-PPR50-v1" => "PPRC Boru DN50",
            "CW-ELB25-v1" => "PPRC Dirsek DN25", "CW-TEE25-v1" => "PPRC Te DN25", "CW-VAL25-v1" => "Küresel Vana DN25",
            "CW-ELB32-v1" => "PPRC Dirsek DN32", "CW-VAL50-v1" => "Kelebek Vana DN50", "CW-TEE32-v1" => "PPRC Te DN32",
            _ => cardVersionId
        }
    };

    private sealed record SyntheticMeasurementRow(string SourceRowId, string CardVersionId, string PlacementId, string Block, string Floor, string Room, string Sheet, string Zone, string DrawingRevision, decimal Quantity, string Unit, decimal WasteRatePct, SalesConversion SalesConversion, decimal ContainerParameter, string ProcurementScope);
}
