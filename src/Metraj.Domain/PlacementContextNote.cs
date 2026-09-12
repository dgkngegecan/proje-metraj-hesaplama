namespace Metraj.Domain;

/// <summary>A floor/room exception or planned work note belonging to one revision's placement.</summary>
public sealed class PlacementContextNote
{
    public Guid Id { get; set; }
    public Guid PlacementId { get; set; }
    public string? Block { get; set; }
    public string? Floor { get; set; }
    public string? Room { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAtUtc { get; set; }
    public ProjectPlacement? Placement { get; set; }
}
