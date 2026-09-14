using System.Text.Json;
using Metraj.Application;
using Metraj.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Creates portable SQLite snapshots and merges their missing data into the active workspace.</summary>
public sealed class WorkspaceTransferService(
    Func<string> databasePathProvider,
    ApplicationDatabaseGate? gate = null) : IWorkspaceTransfer
{
    private readonly Func<string> databasePathProvider = databasePathProvider ?? throw new ArgumentNullException(nameof(databasePathProvider));

    public async Task ExportAsync(string outputPath, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(outputPath);
        string sourcePath = Path.GetFullPath(databasePathProvider());
        string finalPath = Path.GetFullPath(outputPath);
        if (string.Equals(sourcePath, finalPath, StringComparison.OrdinalIgnoreCase))
            throw new DomainRuleViolationException("workspace-import.same-file", "The active database cannot be exported onto itself.");

        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
        string temporaryPath = $"{finalPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            await CopyDatabaseAsync(sourcePath, temporaryPath, cancellationToken);
            await DatabaseMaintenanceWorkspaceService.VerifyDatabaseAsync(temporaryPath, cancellationToken);
            await DatabaseMaintenanceWorkspaceService.EnsureRestorableMetrajDatabaseAsync(temporaryPath, cancellationToken);
            SqliteConnection.ClearAllPools();
            File.Move(temporaryPath, finalPath, overwrite: true);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            TryDelete(temporaryPath);
        }
    }

    public async Task<WorkspaceImportResult> ImportAsync(string packagePath, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(packagePath);
        string sourcePath = Path.GetFullPath(packagePath);
        string destinationPath = Path.GetFullPath(databasePathProvider());
        if (string.Equals(sourcePath, destinationPath, StringComparison.OrdinalIgnoreCase))
            throw new DomainRuleViolationException("workspace-import.same-file", "The active database cannot be imported into itself.");

        await DatabaseMaintenanceWorkspaceService.VerifyDatabaseAsync(sourcePath, cancellationToken);
        await DatabaseMaintenanceWorkspaceService.EnsureRestorableMetrajDatabaseAsync(sourcePath, cancellationToken);

        await using (MetrajDbContext migration = MetrajDbContextFactory.Create(sourcePath))
            await ApplicationSchemaMigrator.MigrateAsync(migration, cancellationToken);

        await using IAsyncDisposable? maintenance = gate is null ? null : await gate.EnterMaintenanceAsync(cancellationToken);
        await using MetrajDbContext source = MetrajDbContextFactory.Create(sourcePath);
        await using MetrajDbContext destination = MetrajDbContextFactory.Create(destinationPath);
        await using var transaction = await destination.Database.BeginTransactionAsync(cancellationToken);

        List<Project> sourceProjects = await source.Projects.AsNoTracking().OrderBy(x => x.CreatedAtUtc).ToListAsync(cancellationToken);
        HashSet<Guid> existingProjectIds = await destination.Projects.AsNoTracking().Select(x => x.Id).ToHashSetAsync(cancellationToken);
        var projectsToImport = sourceProjects.Where(x => !existingProjectIds.Contains(x.Id)).ToList();
        int skippedProjects = sourceProjects.Count - projectsToImport.Count;

        CatalogMerge catalog = await MergeCatalogAsync(source, destination, cancellationToken);
        int importedWasteSettings = await MergeWasteSettingsAsync(source, destination, cancellationToken);
        await destination.SaveChangesAsync(cancellationToken);

        if (projectsToImport.Count > 0)
            await ImportProjectsAsync(source, destination, projectsToImport, catalog.VersionIds, cancellationToken);

        await destination.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new WorkspaceImportResult(projectsToImport.Count, skippedProjects, catalog.ImportedDefinitions,
            catalog.ImportedVersions, importedWasteSettings);
    }

    private static async Task<CatalogMerge> MergeCatalogAsync(MetrajDbContext source, MetrajDbContext destination, CancellationToken token)
    {
        List<CatalogCardDefinition> sourceDefinitions = await source.CatalogCardDefinitions.AsNoTracking().ToListAsync(token);
        List<CatalogCardDefinition> destinationDefinitions = await destination.CatalogCardDefinitions.ToListAsync(token);
        var definitionsByCode = destinationDefinitions.ToDictionary(x => x.Code, StringComparer.OrdinalIgnoreCase);
        var definitionIds = new Dictionary<Guid, Guid>();
        int importedDefinitions = 0;
        foreach (CatalogCardDefinition item in sourceDefinitions)
        {
            if (definitionsByCode.TryGetValue(item.Code, out CatalogCardDefinition? existing))
            {
                definitionIds[item.Id] = existing.Id;
                continue;
            }
            Guid id = destinationDefinitions.Any(x => x.Id == item.Id) ? Guid.NewGuid() : item.Id;
            var clone = new CatalogCardDefinition
            {
                Id = id, Code = item.Code, Name = item.Name, Description = item.Description,
                IsActive = item.IsActive, CreatedAtUtc = item.CreatedAtUtc
            };
            destination.CatalogCardDefinitions.Add(clone);
            destinationDefinitions.Add(clone);
            definitionsByCode[clone.Code] = clone;
            definitionIds[item.Id] = id;
            importedDefinitions++;
        }

        List<CatalogCardTypeDefinition> sourceTypes = await source.CatalogCardTypeDefinitions.AsNoTracking().ToListAsync(token);
        List<CatalogCardTypeDefinition> destinationTypes = await destination.CatalogCardTypeDefinitions.ToListAsync(token);
        var typesByCode = destinationTypes.ToDictionary(x => x.Code, StringComparer.OrdinalIgnoreCase);
        var typeIds = new Dictionary<Guid, Guid>();
        foreach (CatalogCardTypeDefinition item in sourceTypes)
        {
            if (typesByCode.TryGetValue(item.Code, out CatalogCardTypeDefinition? existing))
            {
                typeIds[item.Id] = existing.Id;
                continue;
            }
            Guid id = destinationTypes.Any(x => x.Id == item.Id) ? Guid.NewGuid() : item.Id;
            var clone = new CatalogCardTypeDefinition
            {
                Id = id, Code = item.Code, Name = item.Name, Description = item.Description,
                BaseCardType = item.BaseCardType,
                AllowedParentCardIdsJson = RemapGuidArray(item.AllowedParentCardIdsJson, definitionIds),
                AllowedChildCardIdsJson = RemapGuidArray(item.AllowedChildCardIdsJson, definitionIds),
                AttributeKeysJson = item.AttributeKeysJson, IsActive = item.IsActive, CreatedAtUtc = item.CreatedAtUtc
            };
            destination.CatalogCardTypeDefinitions.Add(clone);
            destinationTypes.Add(clone);
            typesByCode[clone.Code] = clone;
            typeIds[item.Id] = id;
        }

        List<CatalogCardVersion> sourceVersions = await source.CatalogCardVersions.AsNoTracking()
            .OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.VersionNumber).ToListAsync(token);
        List<CatalogCardVersion> destinationVersions = await destination.CatalogCardVersions.ToListAsync(token);
        var versionIds = new Dictionary<Guid, Guid>();
        int importedVersions = 0;
        foreach (CatalogCardVersion item in sourceVersions)
        {
            Guid definitionId = definitionIds[item.CatalogCardDefinitionId];
            CatalogCardVersion? existing = destinationVersions.FirstOrDefault(x =>
                x.CatalogCardDefinitionId == definitionId &&
                !string.IsNullOrWhiteSpace(item.ContentHash) && x.ContentHash == item.ContentHash);
            existing ??= destinationVersions.FirstOrDefault(x => x.Id == item.Id && x.CatalogCardDefinitionId == definitionId);
            if (existing is not null)
            {
                versionIds[item.Id] = existing.Id;
                continue;
            }

            Guid id = destinationVersions.Any(x => x.Id == item.Id) ? Guid.NewGuid() : item.Id;
            int versionNumber = item.VersionNumber;
            if (destinationVersions.Any(x => x.CatalogCardDefinitionId == definitionId && x.VersionNumber == versionNumber))
                versionNumber = destinationVersions.Where(x => x.CatalogCardDefinitionId == definitionId).Max(x => x.VersionNumber) + 1;
            var clone = new CatalogCardVersion
            {
                Id = id, CatalogCardDefinitionId = definitionId,
                CatalogCardTypeDefinitionId = item.CatalogCardTypeDefinitionId is Guid typeId ? typeIds[typeId] : null,
                VersionNumber = versionNumber, Name = item.Name, CardType = item.CardType, ItemKind = item.ItemKind,
                InputBehavior = item.InputBehavior, SalesConversion = item.SalesConversion,
                ReportBehavior = item.ReportBehavior, Unit = item.Unit, WasteRatePct = item.WasteRatePct,
                ContainerParameter = item.ContainerParameter, PositionNumber = item.PositionNumber,
                ColorCode = item.ColorCode, PatternCode = item.PatternCode, VariantMode = item.VariantMode,
                VariantDefinitionsJson = item.VariantDefinitionsJson, MaterialType = item.MaterialType,
                CompatibleDiametersJson = item.CompatibleDiametersJson, AttributeValuesJson = item.AttributeValuesJson,
                ContentHash = item.ContentHash, IsPublished = item.IsPublished, CreatedAtUtc = item.CreatedAtUtc
            };
            destination.CatalogCardVersions.Add(clone);
            destinationVersions.Add(clone);
            versionIds[item.Id] = id;
            importedVersions++;
        }
        return new CatalogMerge(definitionIds, versionIds, importedDefinitions, importedVersions);
    }

    private static async Task<int> MergeWasteSettingsAsync(MetrajDbContext source, MetrajDbContext destination, CancellationToken token)
    {
        List<MaterialTypeWasteSetting> current = await destination.MaterialTypeWasteSettings.ToListAsync(token);
        var names = current.Select(x => x.MaterialType).ToHashSet(StringComparer.OrdinalIgnoreCase);
        int count = 0;
        foreach (MaterialTypeWasteSetting item in await source.MaterialTypeWasteSettings.AsNoTracking().ToListAsync(token))
        {
            if (!names.Add(item.MaterialType)) continue;
            Guid id = current.Any(x => x.Id == item.Id) ? Guid.NewGuid() : item.Id;
            var clone = new MaterialTypeWasteSetting { Id = id, MaterialType = item.MaterialType, WasteRatePct = item.WasteRatePct, UpdatedAtUtc = item.UpdatedAtUtc };
            destination.MaterialTypeWasteSettings.Add(clone);
            current.Add(clone);
            count++;
        }
        return count;
    }

    private static async Task ImportProjectsAsync(MetrajDbContext source, MetrajDbContext destination,
        IReadOnlyList<Project> projects, IReadOnlyDictionary<Guid, Guid> versionIds, CancellationToken token)
    {
        var projectIds = projects.Select(x => x.Id).ToHashSet();
        var projectCodes = await destination.Projects.AsNoTracking().Select(x => x.Code).ToHashSetAsync(token);
        foreach (Project item in projects)
        {
            string code = UniqueCode(item.Code, projectCodes);
            destination.Projects.Add(new Project { Id = item.Id, Code = code, Name = item.Name, Description = item.Description, CreatedAtUtc = item.CreatedAtUtc });
        }

        var revisions = (await source.ProjectRevisions.AsNoTracking().ToListAsync(token)).Where(x => projectIds.Contains(x.ProjectId)).ToList();
        EnsureNoIdCollisions(revisions.Select(x => x.Id), await destination.ProjectRevisions.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.ProjectRevisions.AddRange(revisions.Select(x => new ProjectRevision
        {
            Id = x.Id, ProjectId = x.ProjectId, RevisionNumber = x.RevisionNumber, Code = x.Code,
            Status = x.Status, EngineVersion = x.EngineVersion, UnitPolicyVersion = x.UnitPolicyVersion,
            EffectivePolicyJson = x.EffectivePolicyJson, CreatedAtUtc = x.CreatedAtUtc, ApprovedAtUtc = x.ApprovedAtUtc
        }));
        await destination.SaveChangesAsync(token);

        var revisionIds = revisions.Select(x => x.Id).ToHashSet();
        var placements = (await source.ProjectPlacements.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        EnsureNoIdCollisions(placements.Select(x => x.Id), await destination.ProjectPlacements.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.ProjectPlacements.AddRange(placements.Select(x => new ProjectPlacement
        {
            Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, CatalogCardVersionId = versionIds[x.CatalogCardVersionId],
            ParentPlacementId = x.ParentPlacementId, DisplayNameOverride = x.DisplayNameOverride, Notes = x.Notes,
            ProcurementScope = x.ProcurementScope, NoPool = x.NoPool
        }));
        await destination.SaveChangesAsync(token);

        var placementIds = placements.Select(x => x.Id).ToHashSet();
        var measurements = (await source.Measurements.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        EnsureNoIdCollisions(measurements.Select(x => x.Id), await destination.Measurements.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.Measurements.AddRange(measurements.Select(x => new Measurement
        {
            Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, ProjectPlacementId = x.ProjectPlacementId,
            SourceKind = x.SourceKind, SourceRowId = x.SourceRowId, InputQuantity = x.InputQuantity, InputUnit = x.InputUnit,
            Block = x.Block, Floor = x.Floor, Room = x.Room, Zone = x.Zone, Sheet = x.Sheet,
            DrawingRevision = x.DrawingRevision, Notes = x.Notes, Variant = x.Variant,
            SecondaryVariant = x.SecondaryVariant, CreatedAtUtc = x.CreatedAtUtc, UpdatedAtUtc = x.UpdatedAtUtc
        }));

        var notes = (await source.PlacementContextNotes.AsNoTracking().ToListAsync(token)).Where(x => placementIds.Contains(x.PlacementId)).ToList();
        EnsureNoIdCollisions(notes.Select(x => x.Id), await destination.PlacementContextNotes.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.PlacementContextNotes.AddRange(notes.Select(x => new PlacementContextNote
        {
            Id = x.Id, PlacementId = x.PlacementId, Block = x.Block, Floor = x.Floor, Room = x.Room,
            Text = x.Text, CreatedAtUtc = x.CreatedAtUtc, UpdatedAtUtc = x.UpdatedAtUtc
        }));

        var links = (await source.PlacementLinks.AsNoTracking().ToListAsync(token))
            .Where(x => placementIds.Contains(x.SourcePlacementId) && placementIds.Contains(x.TargetPlacementId)).ToList();
        EnsureNoIdCollisions(links.Select(x => x.Id), await destination.PlacementLinks.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.PlacementLinks.AddRange(links.Select(x => new PlacementLink
        {
            Id = x.Id, SourcePlacementId = x.SourcePlacementId, TargetPlacementId = x.TargetPlacementId,
            LinkType = x.LinkType, Notes = x.Notes
        }));

        var dimensions = (await source.ResponsibilityDimensions.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        var parties = (await source.ResponsibilityParties.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        var rules = (await source.CalculationRuleVersions.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        EnsureNoIdCollisions(dimensions.Select(x => x.Id), await destination.ResponsibilityDimensions.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        EnsureNoIdCollisions(parties.Select(x => x.Id), await destination.ResponsibilityParties.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        EnsureNoIdCollisions(rules.Select(x => x.Id), await destination.CalculationRuleVersions.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.ResponsibilityDimensions.AddRange(dimensions.Select(x => new ResponsibilityDimension { Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, Code = x.Code, Name = x.Name, SortOrder = x.SortOrder, IsActive = x.IsActive }));
        destination.ResponsibilityParties.AddRange(parties.Select(x => new ResponsibilityParty { Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, Code = x.Code, Name = x.Name }));
        destination.CalculationRuleVersions.AddRange(rules.Select(x => new CalculationRuleVersion { Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, Code = x.Code, Name = x.Name, VersionNumber = x.VersionNumber, SourceQuantityKind = x.SourceQuantityKind, ParametersJson = x.ParametersJson, ContentHash = x.ContentHash, IsActive = x.IsActive }));
        await destination.SaveChangesAsync(token);

        var assignments = (await source.ResponsibilityAssignments.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        EnsureNoIdCollisions(assignments.Select(x => x.Id), await destination.ResponsibilityAssignments.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.ResponsibilityAssignments.AddRange(assignments.Select(x => new ResponsibilityAssignment
        {
            Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, ResponsibilityDimensionId = x.ResponsibilityDimensionId,
            ProjectPlacementId = x.ProjectPlacementId, MeasurementId = x.MeasurementId,
            ResponsibilityPartyId = x.ResponsibilityPartyId, State = x.State, Notes = x.Notes
        }));

        var results = (await source.CalculationResults.AsNoTracking().ToListAsync(token)).Where(x => revisionIds.Contains(x.ProjectRevisionId)).ToList();
        EnsureNoIdCollisions(results.Select(x => x.Id), await destination.CalculationResults.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.CalculationResults.AddRange(results.Select(x => new CalculationResult
        {
            Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, TargetPlacementId = x.TargetPlacementId,
            CalculationRuleVersionId = x.CalculationRuleVersionId, CardVersionId = versionIds[x.CardVersionId],
            SourceMeasurementIdsJson = x.SourceMeasurementIdsJson, InputSummary = x.InputSummary,
            InputHash = x.InputHash, EngineVersion = x.EngineVersion, UnitPolicyVersion = x.UnitPolicyVersion,
            ProposedQuantity = x.ProposedQuantity, NetQuantity = x.NetQuantity, WithWasteQuantity = x.WithWasteQuantity,
            PurchaseQuantity = x.PurchaseQuantity, RemainderQuantity = x.RemainderQuantity, UsedQuantity = x.UsedQuantity,
            Status = x.Status, OverrideReason = x.OverrideReason, SupersedesResultId = x.SupersedesResultId,
            CreatedAtUtc = x.CreatedAtUtc
        }));
        await destination.SaveChangesAsync(token);

        var audits = (await source.AuditEntries.AsNoTracking().ToListAsync(token))
            .Where(x => x.ProjectRevisionId is Guid revisionId && revisionIds.Contains(revisionId)).ToList();
        EnsureNoIdCollisions(audits.Select(x => x.Id), await destination.AuditEntries.AsNoTracking().Select(x => x.Id).ToHashSetAsync(token));
        destination.AuditEntries.AddRange(audits.Select(x => new AuditEntry
        {
            Id = x.Id, ProjectRevisionId = x.ProjectRevisionId, EntityType = x.EntityType,
            EntityId = x.EntityId, EventType = x.EventType, DetailsJson = x.DetailsJson, OccurredAtUtc = x.OccurredAtUtc
        }));
    }

    private static string UniqueCode(string source, HashSet<string> used)
    {
        if (used.Add(source)) return source;
        for (int index = 1; ; index++)
        {
            string suffix = $"-IMPORT-{index}";
            string prefix = source[..Math.Min(source.Length, 64 - suffix.Length)];
            string candidate = prefix + suffix;
            if (used.Add(candidate)) return candidate;
        }
    }

    private static void EnsureNoIdCollisions(IEnumerable<Guid> sourceIds, ISet<Guid> destinationIds)
    {
        if (sourceIds.Any(destinationIds.Contains))
            throw new DomainRuleViolationException("workspace-import.id-collision", "A project-scoped identifier already exists in another project.");
    }

    private static string RemapGuidArray(string json, Dictionary<Guid, Guid> ids)
    {
        try
        {
            Guid[] source = JsonSerializer.Deserialize<Guid[]>(json) ?? [];
            return JsonSerializer.Serialize(source.Select(id => ids.TryGetValue(id, out Guid mapped) ? mapped : id));
        }
        catch (JsonException)
        {
            return "[]";
        }
    }

    private static async Task CopyDatabaseAsync(string sourcePath, string destinationPath, CancellationToken token)
    {
        await using var source = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = sourcePath, Mode = SqliteOpenMode.ReadOnly, ForeignKeys = true }.ToString());
        await using var destination = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = destinationPath, Mode = SqliteOpenMode.ReadWriteCreate, ForeignKeys = true }.ToString());
        await source.OpenAsync(token);
        await destination.OpenAsync(token);
        source.BackupDatabase(destination);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private sealed record CatalogMerge(
        IReadOnlyDictionary<Guid, Guid> DefinitionIds,
        IReadOnlyDictionary<Guid, Guid> VersionIds,
        int ImportedDefinitions,
        int ImportedVersions);
}
