export type CardType = 'Category' | 'Scope' | 'System' | 'Material' | 'Accessory';
export type CatalogVariantMode = 'None' | 'Pipe' | 'Fitting';
export type RevisionStatus = 'Draft' | 'Approved' | 'Archived';

export interface CatalogCardVariant {
  code: string;
  label: string;
  standardLength?: number | null;
  compatibleDiameters?: string[] | null;
}

export interface CatalogCardAttributeDescriptor {
  key: string;
  label: string;
  description: string;
  isRequired: boolean;
}

export interface CatalogCardType {
  id: string;
  code: string;
  name: string;
  baseCardType: CardType;
  allowedParentCardIds: string[];
  allowedChildCardIds: string[];
  attributeKeys: string[];
  isActive: boolean;
  description?: string | null;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  revisionCount: number;
  latestRevisionId: string;
  createdAtUtc: string;
}

export interface Revision {
  id: string;
  projectId: string;
  revisionNumber: number;
  code: string;
  status: RevisionStatus;
  createdAtUtc: string;
  approvedAtUtc?: string | null;
}

export interface CatalogCard {
  id: string;
  latestVersionId: string;
  code: string;
  name: string;
  cardType: CardType;
  unit: string;
  inputBehavior: 'Manual' | 'Boolean' | 'Derived';
  salesConversion: 'None' | 'StandardLength' | 'Package';
  reportBehavior: 'Folder' | 'Measurable' | 'Auxiliary' | 'Reference';
  wasteRatePct: number;
  containerParameter?: number | null;
  positionNumber?: string | null;
  latestVersion: number;
  isActive: boolean;
  notes?: string | null;
  materialType?: string | null;
  compatibleDiameters?: string[] | null;
  customTypeId?: string | null;
  customTypeCode?: string | null;
  customTypeName?: string | null;
  attributeKeys?: string[] | null;
  attributeValues?: Record<string, string> | null;
  variantMode?: CatalogVariantMode;
  variants?: CatalogCardVariant[] | null;
}

export interface StarterCatalogSeedResult { addedCount: number; existingCount: number; addedCodes: string[]; }

export interface Placement extends Record<string, unknown> {
  id: string;
  revisionId: string;
  parentPlacementId?: string | null;
  cardVersionId: string;
  cardCode: string;
  cardName: string;
  unit: string;
  inputBehavior: 'Manual' | 'Boolean' | 'Derived';
  cardType: CardType;
  positionNumber?: string | null;
  isMeasurable: boolean;
  displayName: string;
  displayNameOverride?: string | null;
  procurementScope?: string | null;
  notes?: string | null;
  variantMode?: CatalogVariantMode;
  variants?: CatalogCardVariant[] | null;
}

export interface Measurement {
  id: string;
  revisionId: string;
  placementId: string;
  placementCode: string;
  placementName: string;
  sourceKind: string;
  inputQuantity: number;
  inputUnit: string;
  block?: string | null;
  floor?: string | null;
  room?: string | null;
  zone?: string | null;
  sheet?: string | null;
  drawingRevision?: string | null;
  notes?: string | null;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
  variant?: string | null;
  secondaryVariant?: string | null;
}

export interface MeasurementSummary {
  placementId: string;
  placementCode: string;
  placementName: string;
  unit: string;
  measurementCount: number;
  netQuantity: number;
  withWasteQuantity: number;
  purchaseQuantity: number;
  remainderQuantity: number;
  variant?: string | null;
  secondaryVariant?: string | null;
  appliedWasteRatePct?: number;
  purchaseUnit?: string | null;
}

export interface ReportData {
  projectCode: string;
  projectName: string;
  revisionCode: string;
  summaries: MeasurementSummary[];
  calculationChecks: Array<{
    resultId: string;
    targetPlacementId: string;
    targetCode: string;
    targetName: string;
    rule: string;
    ruleVersion: number;
    status: CalculationResult['status'];
    proposedQuantity: number;
    purchaseQuantity: number;
    usedQuantity?: number | null;
    reason?: string | null;
  }>;
}

export interface CalculationRule {
  id: string;
  revisionId: string;
  code: string;
  name: string;
  versionNumber: number;
  mode: 'Direct' | 'FixedMultiplier';
  multiplier: number;
  sourceQuantityKind: 'Net' | 'WithWaste';
  isActive: boolean;
}

export interface CalculationResult {
  id: string;
  targetPlacementId: string;
  targetPlacementName: string;
  ruleCode: string;
  status: 'PendingReview' | 'Approved' | 'Overridden' | 'Rejected' | 'Stale' | 'Superseded';
  proposedQuantity: number;
  purchaseQuantity: number;
  unit: string;
}

export interface ResponsibilityDimension { id: string; code: string; name: string; }
export interface ResponsibilityParty { id: string; code: string; name: string; }
export interface ResponsibilityAssignment {
  id: string;
  dimensionName: string;
  placementName?: string | null;
  partyName?: string | null;
  state: 'Assigned' | 'Excluded' | 'Optional' | 'Unassigned';
}
export interface ResponsibilityData {
  dimensions: ResponsibilityDimension[];
  parties: ResponsibilityParty[];
  assignments: ResponsibilityAssignment[];
}

export interface DatabaseBackup {
  fullPath: string;
  fileName: string;
  reason: string;
  createdAtUtc: string;
  sizeBytes: number;
}

export interface DatabaseIntegrity { isHealthy: boolean; details: string; }
export interface MaterialWasteSetting {
  id: string;
  materialType: string;
  wasteRatePct: number;
  updatedAtUtc: string;
}
