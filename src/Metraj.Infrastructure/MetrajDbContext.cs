using Metraj.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Metraj.Infrastructure;

/// <summary>Application database context; entities and migrations are introduced in Phase 2.</summary>
public sealed class MetrajDbContext(DbContextOptions<MetrajDbContext> options) : DbContext(options)
{
    public DbSet<CatalogCardDefinition> CatalogCardDefinitions => Set<CatalogCardDefinition>();
    public DbSet<CatalogCardTypeDefinition> CatalogCardTypeDefinitions => Set<CatalogCardTypeDefinition>();
    public DbSet<CatalogCardVersion> CatalogCardVersions => Set<CatalogCardVersion>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectRevision> ProjectRevisions => Set<ProjectRevision>();
    public DbSet<ProjectPlacement> ProjectPlacements => Set<ProjectPlacement>();
    public DbSet<PlacementLink> PlacementLinks => Set<PlacementLink>();
    public DbSet<Measurement> Measurements => Set<Measurement>();
    public DbSet<ResponsibilityDimension> ResponsibilityDimensions => Set<ResponsibilityDimension>();
    public DbSet<ResponsibilityParty> ResponsibilityParties => Set<ResponsibilityParty>();
    public DbSet<ResponsibilityAssignment> ResponsibilityAssignments => Set<ResponsibilityAssignment>();
    public DbSet<CalculationRuleVersion> CalculationRuleVersions => Set<CalculationRuleVersion>();
    public DbSet<CalculationResult> CalculationResults => Set<CalculationResult>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<MaterialTypeWasteSetting> MaterialTypeWasteSettings => Set<MaterialTypeWasteSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ValueConverter<decimal, long> quantityConverter = new ScaledDecimalConverter();
        ValueConverter<decimal?, long?> nullableQuantityConverter = new NullableScaledDecimalConverter();

        ConfigureCardModel(modelBuilder, quantityConverter, nullableQuantityConverter);
        ConfigureProjectModel(modelBuilder);
        ConfigureMeasurementModel(modelBuilder, quantityConverter);
        ConfigureResponsibilityModel(modelBuilder);
        ConfigureCalculationModel(modelBuilder, quantityConverter, nullableQuantityConverter);
        ConfigureAuditModel(modelBuilder);
        ConfigureMaterialTypeWasteModel(modelBuilder, quantityConverter);
    }

    private static void ConfigureCardModel(ModelBuilder modelBuilder, ValueConverter<decimal, long> quantityConverter, ValueConverter<decimal?, long?> nullableQuantityConverter)
    {
        EntityTypeBuilder<CatalogCardDefinition> definitions = modelBuilder.Entity<CatalogCardDefinition>();
        definitions.HasKey(x => x.Id);
        definitions.Property(x => x.Code).HasMaxLength(64).IsRequired();
        definitions.Property(x => x.Name).HasMaxLength(256).IsRequired();
        definitions.HasIndex(x => x.Code).IsUnique();

        EntityTypeBuilder<CatalogCardTypeDefinition> typeDefinitions = modelBuilder.Entity<CatalogCardTypeDefinition>();
        typeDefinitions.HasKey(x => x.Id);
        typeDefinitions.Property(x => x.Code).HasMaxLength(64).IsRequired();
        typeDefinitions.Property(x => x.Name).HasMaxLength(128).IsRequired();
        typeDefinitions.Property(x => x.BaseCardType).HasConversion<string>().HasMaxLength(32);
        typeDefinitions.Property(x => x.AllowedParentCardIdsJson).HasMaxLength(16_384).IsRequired();
        typeDefinitions.Property(x => x.AllowedChildCardIdsJson).HasMaxLength(16_384).IsRequired();
        typeDefinitions.Property(x => x.AttributeKeysJson).HasMaxLength(4_096).IsRequired();
        typeDefinitions.HasIndex(x => x.Code).IsUnique();

        EntityTypeBuilder<CatalogCardVersion> versions = modelBuilder.Entity<CatalogCardVersion>();
        versions.HasKey(x => x.Id);
        versions.Property(x => x.Name).HasMaxLength(256).IsRequired();
        versions.Property(x => x.CardType).HasConversion<string>().HasMaxLength(32);
        versions.Property(x => x.ItemKind).HasConversion<string>().HasMaxLength(32);
        versions.Property(x => x.InputBehavior).HasConversion<string>().HasMaxLength(32);
        versions.Property(x => x.SalesConversion).HasConversion<string>().HasMaxLength(32);
        versions.Property(x => x.ReportBehavior).HasConversion<string>().HasMaxLength(32);
        versions.Property(x => x.VariantMode).HasConversion<string>().HasMaxLength(32);
        versions.Property(x => x.Unit).HasMaxLength(32).IsRequired();
        versions.Property(x => x.WasteRatePct).HasConversion(quantityConverter).HasColumnType("INTEGER");
        versions.Property(x => x.ContainerParameter).HasConversion(nullableQuantityConverter).HasColumnType("INTEGER");
        versions.Property(x => x.ContentHash).HasMaxLength(128).IsRequired();
        versions.Property(x => x.MaterialType).HasMaxLength(128);
        versions.Property(x => x.CompatibleDiametersJson).HasMaxLength(4_096).IsRequired();
        versions.Property(x => x.VariantDefinitionsJson).HasMaxLength(16_384).IsRequired();
        versions.Property(x => x.AttributeValuesJson).HasMaxLength(16_384).IsRequired();
        versions.HasIndex(x => new { x.CatalogCardDefinitionId, x.VersionNumber }).IsUnique();
        versions.HasOne(x => x.CatalogCardDefinition).WithMany(x => x.Versions)
            .HasForeignKey(x => x.CatalogCardDefinitionId).OnDelete(DeleteBehavior.Restrict);
        versions.HasOne(x => x.CatalogCardTypeDefinition).WithMany(x => x.CardVersions)
            .HasForeignKey(x => x.CatalogCardTypeDefinitionId).OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureProjectModel(ModelBuilder modelBuilder)
    {
        EntityTypeBuilder<Project> projects = modelBuilder.Entity<Project>();
        projects.HasKey(x => x.Id);
        projects.Property(x => x.Code).HasMaxLength(64).IsRequired();
        projects.Property(x => x.Name).HasMaxLength(256).IsRequired();
        projects.HasIndex(x => x.Code).IsUnique();

        EntityTypeBuilder<ProjectRevision> revisions = modelBuilder.Entity<ProjectRevision>();
        revisions.HasKey(x => x.Id);
        revisions.Property(x => x.Code).HasMaxLength(64).IsRequired();
        revisions.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        revisions.Property(x => x.EngineVersion).HasMaxLength(64).IsRequired();
        revisions.Property(x => x.UnitPolicyVersion).HasMaxLength(64).IsRequired();
        revisions.Property(x => x.EffectivePolicyJson).HasMaxLength(65_536);
        revisions.HasIndex(x => new { x.ProjectId, x.RevisionNumber }).IsUnique();
        revisions.HasOne(x => x.Project).WithMany(x => x.Revisions)
            .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);

        EntityTypeBuilder<ProjectPlacement> placements = modelBuilder.Entity<ProjectPlacement>();
        placements.HasKey(x => x.Id);
        placements.Property(x => x.ProcurementScope).HasMaxLength(128);
        placements.HasOne(x => x.ProjectRevision).WithMany(x => x.Placements)
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);
        placements.HasOne(x => x.CatalogCardVersion).WithMany()
            .HasForeignKey(x => x.CatalogCardVersionId).OnDelete(DeleteBehavior.Restrict);
        placements.HasOne(x => x.ParentPlacement).WithMany(x => x.Children)
            .HasForeignKey(x => x.ParentPlacementId).OnDelete(DeleteBehavior.Restrict);
        placements.HasIndex(x => new { x.ProjectRevisionId, x.ParentPlacementId });

        EntityTypeBuilder<PlacementLink> links = modelBuilder.Entity<PlacementLink>();
        links.HasKey(x => x.Id);
        links.Property(x => x.LinkType).HasConversion<string>().HasMaxLength(32);
        links.HasIndex(x => new { x.SourcePlacementId, x.TargetPlacementId, x.LinkType }).IsUnique();
        links.HasOne(x => x.SourcePlacement).WithMany(x => x.SourceLinks)
            .HasForeignKey(x => x.SourcePlacementId).OnDelete(DeleteBehavior.Restrict);
        links.HasOne(x => x.TargetPlacement).WithMany(x => x.TargetLinks)
            .HasForeignKey(x => x.TargetPlacementId).OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureMeasurementModel(ModelBuilder modelBuilder, ValueConverter<decimal, long> quantityConverter)
    {
        EntityTypeBuilder<Measurement> measurements = modelBuilder.Entity<Measurement>();
        measurements.HasKey(x => x.Id);
        measurements.Property(x => x.InputQuantity).HasConversion(quantityConverter).HasColumnType("INTEGER");
        measurements.Property(x => x.SourceKind).HasMaxLength(32).IsRequired();
        measurements.Property(x => x.InputUnit).HasMaxLength(32).IsRequired();
        measurements.Property(x => x.Block).HasMaxLength(128);
        measurements.Property(x => x.Floor).HasMaxLength(128);
        measurements.Property(x => x.Room).HasMaxLength(256);
        measurements.Property(x => x.Zone).HasMaxLength(128);
        measurements.Property(x => x.Sheet).HasMaxLength(128);
        measurements.Property(x => x.DrawingRevision).HasMaxLength(64);
        measurements.Property(x => x.Variant).HasMaxLength(64);
        measurements.Property(x => x.SecondaryVariant).HasMaxLength(64);
        measurements.HasOne(x => x.ProjectRevision).WithMany(x => x.Measurements)
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);
        measurements.HasOne(x => x.ProjectPlacement).WithMany(x => x.Measurements)
            .HasForeignKey(x => x.ProjectPlacementId).OnDelete(DeleteBehavior.Restrict);
        measurements.HasIndex(x => new { x.ProjectRevisionId, x.ProjectPlacementId });
    }

    private static void ConfigureResponsibilityModel(ModelBuilder modelBuilder)
    {
        EntityTypeBuilder<ResponsibilityDimension> dimensions = modelBuilder.Entity<ResponsibilityDimension>();
        dimensions.HasKey(x => x.Id);
        dimensions.Property(x => x.Code).HasMaxLength(64).IsRequired();
        dimensions.Property(x => x.Name).HasMaxLength(128).IsRequired();
        dimensions.HasIndex(x => new { x.ProjectRevisionId, x.Code }).IsUnique();
        dimensions.HasOne(x => x.ProjectRevision).WithMany(x => x.ResponsibilityDimensions)
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);

        EntityTypeBuilder<ResponsibilityParty> parties = modelBuilder.Entity<ResponsibilityParty>();
        parties.HasKey(x => x.Id);
        parties.Property(x => x.Code).HasMaxLength(64).IsRequired();
        parties.Property(x => x.Name).HasMaxLength(128).IsRequired();
        parties.HasIndex(x => new { x.ProjectRevisionId, x.Code }).IsUnique();
        parties.HasOne(x => x.ProjectRevision).WithMany(x => x.ResponsibilityParties)
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);

        EntityTypeBuilder<ResponsibilityAssignment> assignments = modelBuilder.Entity<ResponsibilityAssignment>();
        assignments.HasKey(x => x.Id);
        assignments.Property(x => x.State).HasConversion<string>().HasMaxLength(32);
        assignments.HasIndex(x => new { x.ProjectRevisionId, x.ResponsibilityDimensionId, x.ProjectPlacementId, x.MeasurementId }).IsUnique();
        assignments.HasOne(x => x.ResponsibilityDimension).WithMany(x => x.Assignments)
            .HasForeignKey(x => x.ResponsibilityDimensionId).OnDelete(DeleteBehavior.Cascade);
        assignments.HasOne(x => x.ResponsibilityParty).WithMany()
            .HasForeignKey(x => x.ResponsibilityPartyId).OnDelete(DeleteBehavior.Restrict);
        assignments.HasOne<ProjectRevision>().WithMany()
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);
        assignments.HasOne<ProjectPlacement>().WithMany()
            .HasForeignKey(x => x.ProjectPlacementId).OnDelete(DeleteBehavior.Restrict);
        assignments.HasOne<Measurement>().WithMany()
            .HasForeignKey(x => x.MeasurementId).OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureCalculationModel(ModelBuilder modelBuilder, ValueConverter<decimal, long> quantityConverter, ValueConverter<decimal?, long?> nullableQuantityConverter)
    {
        EntityTypeBuilder<CalculationRuleVersion> rules = modelBuilder.Entity<CalculationRuleVersion>();
        rules.HasKey(x => x.Id);
        rules.Property(x => x.SourceQuantityKind).HasConversion<string>().HasMaxLength(32);
        rules.Property(x => x.Code).HasMaxLength(64).IsRequired();
        rules.Property(x => x.Name).HasMaxLength(256).IsRequired();
        rules.Property(x => x.ParametersJson).HasMaxLength(16_384).IsRequired();
        rules.Property(x => x.ContentHash).HasMaxLength(128).IsRequired();
        rules.HasIndex(x => new { x.ProjectRevisionId, x.Code, x.VersionNumber }).IsUnique();
        rules.HasOne(x => x.ProjectRevision).WithMany(x => x.CalculationRules)
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);

        EntityTypeBuilder<CalculationResult> results = modelBuilder.Entity<CalculationResult>();
        results.HasKey(x => x.Id);
        results.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        results.Property(x => x.ProposedQuantity).HasConversion(quantityConverter).HasColumnType("INTEGER");
        results.Property(x => x.NetQuantity).HasConversion(quantityConverter).HasColumnType("INTEGER");
        results.Property(x => x.WithWasteQuantity).HasConversion(quantityConverter).HasColumnType("INTEGER");
        results.Property(x => x.PurchaseQuantity).HasConversion(quantityConverter).HasColumnType("INTEGER");
        results.Property(x => x.RemainderQuantity).HasConversion(quantityConverter).HasColumnType("INTEGER");
        results.Property(x => x.UsedQuantity).HasConversion(nullableQuantityConverter).HasColumnType("INTEGER");
        results.Property(x => x.SourceMeasurementIdsJson).HasMaxLength(16_384).IsRequired();
        results.Property(x => x.InputHash).HasMaxLength(128).IsRequired();
        results.Property(x => x.EngineVersion).HasMaxLength(64).IsRequired();
        results.Property(x => x.UnitPolicyVersion).HasMaxLength(64).IsRequired();
        // The same reproducible input can be calculated again after a review decision; snapshots are append-only.
        results.HasIndex(x => new { x.ProjectRevisionId, x.InputHash });
        results.HasOne(x => x.ProjectRevision).WithMany(x => x.CalculationResults)
            .HasForeignKey(x => x.ProjectRevisionId).OnDelete(DeleteBehavior.Cascade);
        results.HasOne(x => x.TargetPlacement).WithMany()
            .HasForeignKey(x => x.TargetPlacementId).OnDelete(DeleteBehavior.Restrict);
        results.HasOne(x => x.CalculationRuleVersion).WithMany()
            .HasForeignKey(x => x.CalculationRuleVersionId).OnDelete(DeleteBehavior.Restrict);
        results.HasOne(x => x.CardVersion).WithMany()
            .HasForeignKey(x => x.CardVersionId).OnDelete(DeleteBehavior.Restrict);
        results.HasOne<CalculationResult>().WithMany()
            .HasForeignKey(x => x.SupersedesResultId).OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureAuditModel(ModelBuilder modelBuilder)
    {
        EntityTypeBuilder<AuditEntry> audit = modelBuilder.Entity<AuditEntry>();
        audit.HasKey(x => x.Id);
        audit.Property(x => x.EntityType).HasMaxLength(64).IsRequired();
        audit.Property(x => x.EventType).HasMaxLength(128).IsRequired();
        audit.Property(x => x.DetailsJson).HasMaxLength(16_384).IsRequired();
        audit.HasIndex(x => new { x.ProjectRevisionId, x.OccurredAtUtc });
    }

    private static void ConfigureMaterialTypeWasteModel(ModelBuilder modelBuilder, ValueConverter<decimal, long> quantityConverter)
    {
        EntityTypeBuilder<MaterialTypeWasteSetting> settings = modelBuilder.Entity<MaterialTypeWasteSetting>();
        settings.HasKey(x => x.Id);
        // Metraj özeti aile adlarını büyük/küçük harf duyarsız arar. Depolama da aynı
        // politikayı uygulamazsa "Steel" ve "steel" iki satır olur ve özet çöker.
        // NOCASE yalnızca ASCII'yi kapsadığı için Türkçe karakterli adlarda son güvence
        // servis tarafındaki OrdinalIgnoreCase eşleştirmesidir.
        settings.Property(x => x.MaterialType).HasMaxLength(128).UseCollation("NOCASE").IsRequired();
        settings.Property(x => x.WasteRatePct).HasConversion(quantityConverter).HasColumnType("INTEGER");
        settings.HasIndex(x => x.MaterialType).IsUnique();
    }
}
