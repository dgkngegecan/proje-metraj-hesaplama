import type { Measurement, Placement } from '../types';

export type RadiatorSize = { type: string; height: string; length: string };
export type RadiatorGroup = { type: string; height: string; lengths: string[] };
export type RadiatorDraft = { active: string; groups: RadiatorGroup[]; counts: Record<string, number> };

// Manufacturer sources and the scope of these entry presets: docs/radyator-secimleri.md.
export const PANEL_TYPES = [
  { type: 'Tip 21', code: 'PKP', description: '2 panel · 1 konvektör' },
  { type: 'Tip 22', code: 'PKKP', description: '2 panel · 2 konvektör' },
  { type: 'Tip 33', code: 'PKKPKP', description: '3 panel · 3 konvektör' },
  { type: 'Tip 11', code: 'PK', description: '1 panel · 1 konvektör' },
  { type: 'Tip 10', code: 'P', description: '1 panel · konvektörsüz' },
];
export const PANEL_HEIGHTS = ['300', '400', '500', '600', '900'];
export const PANEL_LENGTHS = Array.from({ length: 28 }, (_, index) => String(300 + index * 100));

export function canonicalRadiatorType(type: string): string {
  const normalized = type.trim().replace(/\s+/g, ' ');
  const code = normalized.toUpperCase().replace(/İ/g, 'I').replace(/\s+/g, '');
  const option = PANEL_TYPES.find((item) => item.code === code ||
    code === `TIP${item.type.slice(4)}` || code === `T${item.type.slice(4)}`);
  return option?.type ?? (normalized.toUpperCase() === 'DKEK' ? 'Tip 33' : normalized);
}
export const radiatorTypeLabel = (type: string) => {
  const canonical = canonicalRadiatorType(type);
  const option = PANEL_TYPES.find((item) => item.type === canonical);
  return option ? `${option.code} · ${option.type}` : canonical;
};
export const radiatorGroupKey = (group: Pick<RadiatorSize, 'type' | 'height'>) => JSON.stringify([canonicalRadiatorType(group.type), group.height]);
export const radiatorSizeKey = (size: RadiatorSize) => JSON.stringify([canonicalRadiatorType(size.type), size.height, size.length]);
export const radiatorDimension = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return '';
  const number = Number(trimmed.replace(',', '.'));
  return number > 0 && number <= 100000 ? String(number) : '';
};
export const isSectionalRadiator = (placement: Placement) =>
  /(?:DOKUM|ALU)-RAD-DILIM/.test(placement.cardCode) || /dilim|sectional/i.test(placement.cardName ?? '');
export const isPanelRadiator = (placement: Placement) => !isSectionalRadiator(placement) &&
  !/havlupan|towel/i.test(`${placement.cardCode} ${placement.cardName}`);

export function catalogRadiatorSize(code: string): RadiatorSize | null {
  const panel = code.match(/^T(\d+)-(\d+)-(\d+)$/i);
  if (panel) return { type: `Tip ${panel[1]}`, height: panel[2]!, length: panel[3]! };
  const towel = code.match(/^HP-(ELEKTRIKLI-)?(\d+)-(\d+)$/i);
  if (towel) return { type: towel[1] ? 'Elektrikli havlupan' : 'Havlupan', height: towel[3]!, length: towel[2]! };
  const sectional = code.match(/^(DR|ALU)-(\d+)$/i);
  if (sectional) return { type: sectional[1]!.toUpperCase() === 'DR' ? 'Döküm' : 'Alüminyum', height: sectional[2]!, length: '' };
  return null;
}

export function measurementRadiatorSize(measurement: Pick<Measurement, 'variant' | 'secondaryVariant'>): RadiatorSize | null {
  const catalog = catalogRadiatorSize(measurement.secondaryVariant ?? '') || catalogRadiatorSize(measurement.variant ?? '');
  if (catalog) return catalog;
  const primary = measurement.variant?.match(/^(?:(.+) · )?H(\d+(?:\.\d+)?)$/);
  const secondary = measurement.secondaryVariant?.match(/^[WL](\d+(?:\.\d+)?)$/);
  if (!primary) return null;
  return { type: canonicalRadiatorType(primary[1] || 'Panel'), height: primary[2]!, length: secondary?.[1] ?? '' };
}

export function mergeRadiatorGroups(...sources: RadiatorGroup[][]): RadiatorGroup[] {
  const groups = new Map<string, RadiatorGroup>();
  for (const source of sources) for (const group of source) {
    const key = radiatorGroupKey(group);
    const previous = groups.get(key);
    groups.set(key, { ...group, type: canonicalRadiatorType(group.type), lengths: [...new Set([...(previous?.lengths ?? []), ...group.lengths])].sort((a, b) => Number(a) - Number(b)) });
  }
  return [...groups.values()];
}

export function initialRadiatorGroups(placement: Placement, measurements: Measurement[]): RadiatorGroup[] {
  const sizes = [
    ...(placement.variants ?? []).map((variant) => catalogRadiatorSize(variant.code)),
    ...measurements.map(measurementRadiatorSize),
  ].filter((size): size is RadiatorSize => size !== null);
  const declared = sizes.map(({ length, ...group }) => ({ ...group, lengths: length ? [length] : [] }));
  if (isPanelRadiator(placement)) return mergeRadiatorGroups(
    PANEL_TYPES.flatMap(({ type }) => PANEL_HEIGHTS.map((height) => ({ type, height, lengths: [...PANEL_LENGTHS] }))), declared,
  );
  if (sizes.length) return mergeRadiatorGroups(declared);
  const type = /havlupan/i.test(`${placement.cardCode} ${placement.cardName}`) ? 'Havlupan' : 'Panel';
  // Height shortcuts from the existing generic entry screen. Lengths are entered by the user.
  return ['300', '400', '500', '600', '900'].map((height) => ({ type, height, lengths: [] }));
}

/** Only validated groups and counts survive a stale or malformed saved UI state. */
export function readRadiatorDraft(raw: string | null): RadiatorDraft | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || !Array.isArray(value.groups)) return null;
    const groups: RadiatorGroup[] = value.groups.flatMap((group: RadiatorGroup) => {
      if (!group || typeof group.type !== 'string' || !group.type.trim() || group.type.length > 40 ||
          typeof group.height !== 'string' || !radiatorDimension(group.height) || !Array.isArray(group.lengths)) return [];
      return [{ type: group.type.trim(), height: radiatorDimension(group.height),
        lengths: group.lengths.filter((length): length is string => typeof length === 'string').map(radiatorDimension).filter(Boolean) }];
    });
    const counts: Record<string, number> = {};
    for (const group of groups) for (const length of [...group.lengths, '']) {
      const oldKey = JSON.stringify([group.type, group.height, length]);
      const key = radiatorSizeKey({ ...group, length });
      const count = value.counts?.[oldKey];
      if (Number.isSafeInteger(count) && count > 0 && count <= 1000000) counts[key] = (counts[key] ?? 0) + count;
    }
    let active = '';
    try {
      const [type, height] = JSON.parse(value.active);
      if (typeof type === 'string' && typeof height === 'string') active = radiatorGroupKey({ type, height });
    } catch { /* Unknown selection falls back to the first available group. */ }
    return { active, groups: mergeRadiatorGroups(groups), counts };
  } catch { return null; }
}

/** Bring pending counts from the former fitting editor into the height editor once. */
export function legacyRadiatorCounts(raw: string | null): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    const boxes = JSON.parse(raw ?? '[]');
    if (!Array.isArray(boxes)) return counts;
    for (const box of boxes) {
      const byDiameter = box?.countsByDiameter ?? { GENEL: box?.counts };
      if (!byDiameter || typeof byDiameter !== 'object') continue;
      for (const values of Object.values(byDiameter)) {
        if (!values || typeof values !== 'object') continue;
        for (const [code, count] of Object.entries(values)) {
          const size = catalogRadiatorSize(code);
          if (size && Number.isSafeInteger(count) && count > 0 && count <= 1000000) {
            const key = radiatorSizeKey(size);
            counts[key] = (counts[key] ?? 0) + count;
          }
        }
      }
    }
  } catch { /* A malformed legacy draft must not block the editor. */ }
  return counts;
}

export function radiatorMeasurementRows(draft: RadiatorDraft, placement: Placement, measurements: Measurement[]) {
  return draft.groups.flatMap((group) => (isSectionalRadiator(placement) ? [''] : group.lengths).flatMap((length) => {
    const size = { ...group, length };
    const key = radiatorSizeKey(size);
    const count = draft.counts[key];
    if (!count || !Number.isSafeInteger(count) || count < 0 || count > 1000000) return [];
    // Reuse identities already present in this project so old and new entries aggregate together.
    const existing = measurements.find((measurement) => {
      const parsed = measurementRadiatorSize(measurement);
      return parsed && radiatorSizeKey(parsed) === key;
    });
    const catalog = placement.variants?.find((variant) => {
      const parsed = catalogRadiatorSize(variant.code);
      return parsed && radiatorSizeKey(parsed) === key;
    });
    return [{ quantity: count,
      variant: existing ? existing.variant : catalog ? null : `${group.type} · H${group.height}`,
      secondaryVariant: existing ? existing.secondaryVariant : catalog ? catalog.code : length ? `W${length}` : null,
      notes: `Radyatör: ${group.type} · Yükseklik: ${group.height} mm${length ? ` · Uzunluk: ${length} mm` : ' · Birim: dilim'}`,
    }];
  }));
}

export function activeRadiatorDraft(draft: RadiatorDraft): RadiatorDraft {
  return { ...draft, groups: draft.groups.filter((group) => radiatorGroupKey(group) === draft.active) };
}

export function clearActiveRadiatorCounts(draft: RadiatorDraft): RadiatorDraft {
  const group = draft.groups.find((item) => radiatorGroupKey(item) === draft.active);
  if (!group) return draft;
  const counts = { ...draft.counts };
  for (const length of [...group.lengths, '']) delete counts[radiatorSizeKey({ ...group, length })];
  return { ...draft, counts };
}
