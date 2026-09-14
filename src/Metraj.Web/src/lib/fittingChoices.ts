import type { CatalogCardVariant, Measurement, Placement } from '../types';
import { measurementVariantOf } from './format.ts';

const equal = (left: string, right: string) => left.trim().toLocaleLowerCase('tr') === right.trim().toLocaleLowerCase('tr');
export const diameterCode = (variant: CatalogCardVariant) => variant.sourceVariantCode || variant.code;
const canonicalMaterial = (material: string) => {
  const value = material.trim().toUpperCase();
  if (['PPR', 'PPRC', 'PPR-C', 'PP-R', 'PP-R FITTING'].includes(value)) return 'PP-R';
  if (['CARBON STEEL', 'CARBON STEEL FITTING', 'ÇELİK'].includes(value)) return 'CARBON STEEL';
  if (['GALVANIZED STEEL', 'GALVANIZED STEEL FITTING'].includes(value)) return 'GALVANIZED STEEL';
  if (['COPPER', 'BAKIR'].includes(value)) return 'COPPER';
  return value;
};
const defaultSystems: Record<string, string> = { 'PP-R': 'water.ppr', PEX: 'water.pex', 'PEX-AL-PEX': 'water.multilayer', 'GALVANIZED STEEL': 'water.galvanized.threaded', 'CARBON STEEL': 'water.steel', COPPER: 'water.copper', 'PVC-U': 'drain.pvc' };

export function fittingChoices(placement: Placement, placements: Placement[], measurements: Measurement[]) {
  const byId = new Map(placements.map((item) => [item.id, item]));
  let parent = placement.parentPlacementId ? byId.get(placement.parentPlacementId) : undefined;
  const visited = new Set<string>([placement.id]);
  while (parent && parent.variantMode !== 'Pipe' && !visited.has(parent.id)) {
    visited.add(parent.id);
    parent = parent.parentPlacementId ? byId.get(parent.parentPlacementId) : undefined;
  }
  const parentPipe = parent?.variantMode === 'Pipe' && !visited.has(parent.id) ? parent : undefined;
  const variants = placement.variants ?? [];
  const explicitDiameters = [...new Set(variants.flatMap((item) => item.compatibleDiameters ?? []))];
  const ownDiameters = explicitDiameters.map((code) => ({ code, label: code }));
  const base = parentPipe?.variants?.length ? parentPipe.variants : ownDiameters;
  const entered = parentPipe ? measurements.filter((row) => row.placementId === parentPipe.id && measurementVariantOf(row)) : [];
  const measured = base.filter((variant) => entered.some((row) => equal(measurementVariantOf(row), variant.code) || equal(measurementVariantOf(row), variant.label)));
  const candidates = entered.length ? measured : base;
  const parentMaterial = parentPipe?.materialType ? canonicalMaterial(parentPipe.materialType) : '';
  const system = parentPipe?.pipeSystem || defaultSystems[parentMaterial];
  const compatibleVariants = (diameter: CatalogCardVariant) => variants.filter((item) => {
    const accepted = item.compatibleDiameters ?? [];
    const diameterMatches = !accepted.length || accepted.some((code) => equal(code, diameterCode(diameter)) || equal(code, diameter.label));
    const acceptedSystems = item.compatiblePipeSystems ?? [];
    const optionMaterial = item.materialType || placement.materialType;
    const systemMatches = !parentPipe || (acceptedSystems.length
      ? acceptedSystems.includes('*') || Boolean(system && acceptedSystems.some((value) => equal(value, system)))
      : !parentMaterial || !optionMaterial || canonicalMaterial(optionMaterial) === parentMaterial);
    return diameterMatches && systemMatches;
  });
  // A non-dimensional accessory family has choices, not invented steel-pipe diameters.
  const dimensional = Boolean(parentPipe || explicitDiameters.length);
  const diameters: CatalogCardVariant[] = dimensional
    ? candidates.filter((item) => compatibleVariants(item).length > 0)
    : [{ code: 'GENEL', label: 'Çeşit seçenekleri' }];
  return { parentPipe, entered, diameters, dimensional, filtered: Boolean(parentPipe && entered.length), compatibleVariants };
}
