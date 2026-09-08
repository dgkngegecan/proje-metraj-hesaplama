using Metraj.Domain;

namespace Metraj.Application;

/// <summary>Read model for one configurable responsibility dimension in a project revision.</summary>
public sealed record ResponsibilityDimensionListItem(Guid Id, Guid RevisionId, string Code, string Name, int SortOrder, bool IsActive);

/// <summary>Read model for a party that can be assigned responsibility in a project revision.</summary>
public sealed record ResponsibilityPartyListItem(Guid Id, Guid RevisionId, string Code, string Name);

/// <summary>Read model for a responsibility assignment at project-placement scope.</summary>
public sealed record ResponsibilityAssignmentListItem(
    Guid Id,
    Guid RevisionId,
    Guid DimensionId,
    string DimensionName,
    Guid? PlacementId,
    string? PlacementName,
    Guid? PartyId,
    string? PartyName,
    ResponsibilityAssignmentState State,
    string? Notes,
    bool IsInherited,
    string? SourcePlacementName);

/// <summary>Application boundary for configurable responsibility dimensions, parties, and assignments.</summary>
public interface IResponsibilityWorkspace
{
    public Task<IReadOnlyList<ResponsibilityDimensionListItem>> ListDimensionsAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<ResponsibilityPartyListItem>> ListPartiesAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<IReadOnlyList<ResponsibilityAssignmentListItem>> ListAssignmentsAsync(Guid revisionId, CancellationToken cancellationToken = default);
    public Task<ResponsibilityDimensionListItem> CreateDimensionAsync(Guid revisionId, string code, string name, CancellationToken cancellationToken = default);
    public Task<ResponsibilityPartyListItem> CreatePartyAsync(Guid revisionId, string code, string name, CancellationToken cancellationToken = default);
    public Task AssignPlacementAsync(
        Guid revisionId,
        Guid dimensionId,
        Guid placementId,
        Guid? partyId,
        ResponsibilityAssignmentState state,
        string? notes = null,
        CancellationToken cancellationToken = default);
}
