using Metraj.Application;
using Metraj.Domain;
using Microsoft.EntityFrameworkCore;

namespace Metraj.Infrastructure;

/// <summary>Persistence-backed project workspace operations used by the desktop shell.</summary>
public sealed class ProjectWorkspaceService : IProjectWorkspace
{
    private readonly Func<MetrajDbContext> contextFactory;

    public ProjectWorkspaceService(Func<MetrajDbContext> contextFactory)
    {
        this.contextFactory = contextFactory ?? throw new ArgumentNullException(nameof(contextFactory));
    }

    public async Task<IReadOnlyList<ProjectListItem>> ListProjectsAsync(CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        var projects = await context.Projects
            .AsNoTracking()
            .Include(x => x.Revisions)
            .OrderBy(x => x.Code)
            .ToListAsync(cancellationToken);
        return projects.Select(x =>
        {
            ProjectRevision latest = x.Revisions.MaxBy(revision => revision.RevisionNumber)!;
            return new ProjectListItem(x.Id, x.Code, x.Name, x.Revisions.Count, latest.Id, x.CreatedAtUtc);
        }).ToList();
    }

    public async Task<ProjectListItem> CreateProjectAsync(string code, string name, string? description = null, CancellationToken cancellationToken = default)
    {
        string normalizedCode = code.Trim().ToUpperInvariant();
        string normalizedName = name.Trim();
        if (normalizedCode.Length is 0 or > 64)
        {
            throw new DomainRuleViolationException("project.code", "Project code must contain 1 to 64 characters.");
        }

        if (normalizedName.Length is 0 or > 256)
        {
            throw new DomainRuleViolationException("project.name", "Project name must contain 1 to 256 characters.");
        }

        await using MetrajDbContext context = contextFactory();
        if (await context.Projects.AnyAsync(x => x.Code == normalizedCode, cancellationToken))
        {
            throw new DomainRuleViolationException("project.code-unique", $"Project code '{normalizedCode}' already exists.");
        }

        Project project = new()
        {
            Id = Guid.NewGuid(),
            Code = normalizedCode,
            Name = normalizedName,
            Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim()
        };
        project.Revisions.Add(new ProjectRevision
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            RevisionNumber = 1,
            Code = "R0"
        });
        context.Projects.Add(project);
        await context.SaveChangesAsync(cancellationToken);
        return new ProjectListItem(project.Id, project.Code, project.Name, 1, project.Revisions.Single().Id, project.CreatedAtUtc);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ProjectRevisionListItem>> ListRevisionsAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        return await context.ProjectRevisions.AsNoTracking()
            .Where(x => x.ProjectId == projectId)
            .OrderByDescending(x => x.RevisionNumber)
            .Select(x => ToRevisionListItem(x))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<ProjectRevisionListItem> CreateDraftRevisionAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        Project project = await context.Projects.Include(x => x.Revisions)
            .SingleOrDefaultAsync(x => x.Id == projectId, cancellationToken)
            ?? throw new DomainRuleViolationException("revision.project", "Project was not found.");
        ProjectRevision source = project.Revisions.MaxBy(x => x.RevisionNumber)
            ?? throw new DomainRuleViolationException("revision.source", "Project has no revision to clone.");
        if (source.Status == ProjectRevisionStatus.Draft)
        {
            throw new DomainRuleViolationException("revision.draft-exists", "Approve the current draft revision before creating another revision.");
        }

        int revisionNumber = source.RevisionNumber + 1;
        var target = new ProjectRevision
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            RevisionNumber = revisionNumber,
            Code = $"R{revisionNumber - 1}",
            Status = ProjectRevisionStatus.Draft,
            EngineVersion = source.EngineVersion,
            UnitPolicyVersion = source.UnitPolicyVersion,
            CreatedAtUtc = DateTime.UtcNow
        };
        context.ProjectRevisions.Add(target);

        List<ProjectPlacement> sourcePlacements = await context.ProjectPlacements
            .Where(x => x.ProjectRevisionId == source.Id)
            .OrderBy(x => x.Id)
            .ToListAsync(cancellationToken);
        var placementIds = sourcePlacements.ToDictionary(x => x.Id, _ => Guid.NewGuid());
        foreach (ProjectPlacement placement in sourcePlacements)
        {
            context.ProjectPlacements.Add(new ProjectPlacement
            {
                Id = placementIds[placement.Id],
                ProjectRevisionId = target.Id,
                CatalogCardVersionId = placement.CatalogCardVersionId,
                ParentPlacementId = placement.ParentPlacementId is Guid parentId ? placementIds[parentId] : null,
                DisplayNameOverride = placement.DisplayNameOverride,
                Notes = placement.Notes,
                ProcurementScope = placement.ProcurementScope,
                NoPool = placement.NoPool
            });
        }

        List<PlacementLink> sourceLinks = await context.PlacementLinks
            .Where(x => sourcePlacements.Select(placement => placement.Id).Contains(x.SourcePlacementId))
            .OrderBy(x => x.Id)
            .ToListAsync(cancellationToken);
        foreach (PlacementLink link in sourceLinks)
        {
            if (placementIds.TryGetValue(link.SourcePlacementId, out Guid newSourceId) &&
                placementIds.TryGetValue(link.TargetPlacementId, out Guid newTargetId))
            {
                context.PlacementLinks.Add(new PlacementLink
                {
                    Id = Guid.NewGuid(),
                    SourcePlacementId = newSourceId,
                    TargetPlacementId = newTargetId,
                    LinkType = link.LinkType,
                    Notes = link.Notes
                });
            }
        }

        List<Measurement> sourceMeasurements = await context.Measurements
            .Where(x => x.ProjectRevisionId == source.Id)
            .OrderBy(x => x.Id)
            .ToListAsync(cancellationToken);
        var measurementIds = sourceMeasurements.ToDictionary(x => x.Id, _ => Guid.NewGuid());
        foreach (Measurement measurement in sourceMeasurements)
        {
            context.Measurements.Add(new Measurement
            {
                Id = measurementIds[measurement.Id],
                ProjectRevisionId = target.Id,
                ProjectPlacementId = placementIds[measurement.ProjectPlacementId],
                SourceKind = measurement.SourceKind,
                SourceRowId = measurement.SourceRowId,
                InputQuantity = measurement.InputQuantity,
                InputUnit = measurement.InputUnit,
                Block = measurement.Block,
                Floor = measurement.Floor,
                Room = measurement.Room,
                Zone = measurement.Zone,
                Sheet = measurement.Sheet,
                DrawingRevision = measurement.DrawingRevision,
                Notes = measurement.Notes,
                Variant = measurement.Variant,
                SecondaryVariant = measurement.SecondaryVariant,
                CreatedAtUtc = measurement.CreatedAtUtc,
                UpdatedAtUtc = measurement.UpdatedAtUtc
            });
        }

        List<ResponsibilityDimension> sourceDimensions = await context.ResponsibilityDimensions
            .Where(x => x.ProjectRevisionId == source.Id).OrderBy(x => x.Id).ToListAsync(cancellationToken);
        var dimensionIds = sourceDimensions.ToDictionary(x => x.Id, _ => Guid.NewGuid());
        foreach (ResponsibilityDimension dimension in sourceDimensions)
        {
            context.ResponsibilityDimensions.Add(new ResponsibilityDimension
            {
                Id = dimensionIds[dimension.Id], ProjectRevisionId = target.Id, Code = dimension.Code,
                Name = dimension.Name, SortOrder = dimension.SortOrder, IsActive = dimension.IsActive
            });
        }

        List<ResponsibilityParty> sourceParties = await context.ResponsibilityParties
            .Where(x => x.ProjectRevisionId == source.Id).OrderBy(x => x.Id).ToListAsync(cancellationToken);
        var partyIds = sourceParties.ToDictionary(x => x.Id, _ => Guid.NewGuid());
        foreach (ResponsibilityParty party in sourceParties)
        {
            context.ResponsibilityParties.Add(new ResponsibilityParty
            {
                Id = partyIds[party.Id], ProjectRevisionId = target.Id, Code = party.Code, Name = party.Name
            });
        }

        List<ResponsibilityAssignment> sourceAssignments = await context.ResponsibilityAssignments
            .Where(x => x.ProjectRevisionId == source.Id).OrderBy(x => x.Id).ToListAsync(cancellationToken);
        foreach (ResponsibilityAssignment assignment in sourceAssignments)
        {
            context.ResponsibilityAssignments.Add(new ResponsibilityAssignment
            {
                Id = Guid.NewGuid(),
                ProjectRevisionId = target.Id,
                ResponsibilityDimensionId = dimensionIds[assignment.ResponsibilityDimensionId],
                ProjectPlacementId = assignment.ProjectPlacementId is Guid placementId ? placementIds[placementId] : null,
                MeasurementId = assignment.MeasurementId is Guid measurementId ? measurementIds[measurementId] : null,
                ResponsibilityPartyId = assignment.ResponsibilityPartyId is Guid partyId ? partyIds[partyId] : null,
                State = assignment.State,
                Notes = assignment.Notes
            });
        }

        List<CalculationRuleVersion> sourceRules = await context.CalculationRuleVersions
            .Where(x => x.ProjectRevisionId == source.Id).OrderBy(x => x.Id).ToListAsync(cancellationToken);
        foreach (CalculationRuleVersion rule in sourceRules)
        {
            context.CalculationRuleVersions.Add(new CalculationRuleVersion
            {
                Id = Guid.NewGuid(), ProjectRevisionId = target.Id, Code = rule.Code, Name = rule.Name,
                VersionNumber = rule.VersionNumber, SourceQuantityKind = rule.SourceQuantityKind,
                ParametersJson = rule.ParametersJson, ContentHash = rule.ContentHash, IsActive = rule.IsActive
            });
        }

        context.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.NewGuid(), ProjectRevisionId = target.Id, EntityType = "ProjectRevision", EntityId = target.Id,
            EventType = "revision-created-from-approved", DetailsJson = $"{{\"sourceRevisionId\":\"{source.Id}\",\"sourceCode\":\"{source.Code}\"}}",
            OccurredAtUtc = DateTime.UtcNow
        });
        await context.SaveChangesAsync(cancellationToken);
        return ToRevisionListItem(target);
    }

    /// <inheritdoc />
    public async Task ApproveRevisionAsync(Guid revisionId, CancellationToken cancellationToken = default)
    {
        await using MetrajDbContext context = contextFactory();
        ProjectRevision revision = await context.ProjectRevisions.SingleOrDefaultAsync(x => x.Id == revisionId, cancellationToken)
            ?? throw new DomainRuleViolationException("revision.not-found", "Project revision was not found.");
        ProjectRevisionRules.EnsureDraft(revision);
        bool pendingCalculation = await context.CalculationResults.AnyAsync(
            x => x.ProjectRevisionId == revisionId && x.Status == CalculationResultStatus.PendingReview,
            cancellationToken);
        if (pendingCalculation)
        {
            throw new DomainRuleViolationException("revision.pending-calculations", "Review or reject every pending calculation proposal before approving the revision.");
        }

        // Kaynak metrajı değiştiği için bayatlamış bir öneri, dondurulmuş bir
        // revizyona yanlış miktarla girmemelidir. Kullanıcı ya yeniden hesaplar
        // ya da öneriyi reddeder.
        bool staleCalculation = await context.CalculationResults.AnyAsync(
            x => x.ProjectRevisionId == revisionId && x.Status == CalculationResultStatus.Stale,
            cancellationToken);
        if (staleCalculation)
        {
            throw new DomainRuleViolationException("revision.stale-calculations", "Recalculate or reject every out-of-date calculation proposal before approving the revision.");
        }

        // Onay anında, projeye dışarıdan etki eden tek değişken politikayı dondur.
        // Bu olmadan onaylı bir revizyonun fireli miktarları, aylar sonra yapılan
        // ilgisiz bir ayar değişikliğiyle birlikte değişiyordu ve "onaylanan sürüm
        // korunur" vaadi tutmuyordu.
        revision.EffectivePolicyJson = await RevisionWastePolicy.CaptureAsync(context, cancellationToken);
        revision.Status = ProjectRevisionStatus.Approved;
        revision.ApprovedAtUtc = DateTime.UtcNow;
        context.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.NewGuid(), ProjectRevisionId = revision.Id, EntityType = "ProjectRevision", EntityId = revision.Id,
            EventType = "revision-approved", DetailsJson = $"{{\"revisionCode\":\"{revision.Code}\"}}", OccurredAtUtc = revision.ApprovedAtUtc.Value
        });
        await context.SaveChangesAsync(cancellationToken);
    }

    private static ProjectRevisionListItem ToRevisionListItem(ProjectRevision revision) => new(
        revision.Id,
        revision.ProjectId,
        revision.RevisionNumber,
        revision.Code,
        revision.Status,
        revision.CreatedAtUtc,
        revision.ApprovedAtUtc);
}
