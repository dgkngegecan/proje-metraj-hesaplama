import type { CatalogCardVariant, Placement } from '../../../types';
import type { EntryRow } from './measurementRows.ts';

/**
 * Fitting adet sayımı (saf). Masaüstü Inspector'daki "Uyumlu çap ve parça
 * seçenekleri" kutusunun telefon karşılığı. Bekleyen adetler masaüstüyle AYNI
 * taslak biçiminde (`fitting-draft.v1.{id}` = FittingBox[]) saklanır: yarım
 * kalmış sayım bir cihazdan ötekine yedekle taşınabilir. Telefon tek kutu
 * kullanır (çaplar çiple değişir); masaüstünden gelen birden çok kutu okunurken
 * toplanır — kayıtta zaten kutular (çap, tür) çiftine göre toplanıyordu.
 */
export type FittingCounts = Record<string, Record<string, number>>;
export interface FittingBox {
  id: string;
  diameter: string;
  countsByDiameter: FittingCounts;
}

export const MAX_FITTING_COUNT = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalizeCounts(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(value)) return result;
  for (const [kind, count] of Object.entries(value))
    if (typeof count === 'number' && Number.isFinite(count) && count > 0)
      result[kind] = Math.min(MAX_FITTING_COUNT, Math.floor(count));
  return result;
}

export interface FittingHydration {
  placementId: string;
  /** Kayıtlı kutuda çap yoksa kullanılacak ilk çap. */
  firstDiameter: string;
  /** Bağlı borunun çap kümesi; verilirse bunun dışındaki kayıtlı çaplar atılır. */
  validDiameters: ReadonlySet<string> | null;
}

/** Masaüstü hidrasyonuyla aynı normalleştirme; geçersiz kayıt sessizce yok sayılır. */
export function readFittingBoxes(raw: unknown, context: FittingHydration): FittingBox[] {
  if (!Array.isArray(raw)) return [];
  const boxes: FittingBox[] = [];
  raw.forEach((item: unknown, index) => {
    if (!isRecord(item)) return;
    const diameter = (typeof item.diameter === 'string' ? item.diameter.trim() : '') || context.firstDiameter;
    const valid = context.validDiameters;
    if (valid && !valid.has(diameter.toLowerCase())) return;
    const rawByDiameter = isRecord(item.countsByDiameter)
      ? item.countsByDiameter
      : isRecord(item.counts)
        ? { [diameter]: item.counts }
        : {};
    const countsByDiameter: FittingCounts = {};
    for (const [savedDiameter, counts] of Object.entries(rawByDiameter))
      if (!valid || valid.has(savedDiameter.toLowerCase())) countsByDiameter[savedDiameter] = normalizeCounts(counts);
    boxes.push({
      id: typeof item.id === 'string' && item.id ? item.id : `${context.placementId}-fit-${index}`,
      diameter,
      countsByDiameter,
    });
  });
  return boxes;
}

/** Birden çok kutuyu (çap, tür) bazında toplayıp tek sayım tablosuna indirger. */
export function mergeCounts(boxes: readonly FittingBox[]): FittingCounts {
  const merged: FittingCounts = {};
  for (const box of boxes)
    for (const [diameter, counts] of Object.entries(box.countsByDiameter))
      for (const [kind, count] of Object.entries(counts)) {
        const target = (merged[diameter] ??= {});
        target[kind] = Math.min(MAX_FITTING_COUNT, (target[kind] ?? 0) + count);
      }
  return merged;
}

export function toDraftBoxes(placementId: string, diameter: string, counts: FittingCounts): FittingBox[] {
  return [{ id: `${placementId}-fit-0`, diameter, countsByDiameter: counts }];
}

export function setCount(counts: FittingCounts, diameter: string, kind: string, value: number): FittingCounts {
  const safe = Number.isFinite(value) ? Math.min(MAX_FITTING_COUNT, Math.max(0, Math.floor(value))) : 0;
  if ((counts[diameter]?.[kind] ?? 0) === safe) return counts;
  return { ...counts, [diameter]: { ...(counts[diameter] ?? {}), [kind]: safe } };
}

export const countOf = (counts: FittingCounts, diameter: string, kind: string) => counts[diameter]?.[kind] ?? 0;

/** Bir çaptaki bekleyen toplam (çip rozeti). */
export function pendingForDiameter(counts: FittingCounts, diameter: string): number {
  return Object.values(counts[diameter] ?? {}).reduce((sum, count) => sum + count, 0);
}

export type CompatibleFor = (diameterCode: string) => readonly CatalogCardVariant[];

export interface FittingSubmission {
  rows: EntryRow[];
  /** Kaydedilen (çap, tür) çiftleri; başarıdan sonra taslaktan bunlar silinir. */
  submitted: ReadonlySet<string>;
}

const keyOf = (diameter: string, kind: string) => `${diameter}\u0000${kind}`;

/**
 * Masaüstü `submitFittings` satırları: yalnız o çapla UYUMLU türlerin sıfırdan
 * büyük adetleri gönderilir, uyumsuz kalıntılar (örn. başka boruya bağlanınca)
 * sessizce taslakta bırakılır. Satır sırası kutu/çap/tür ekleme sırasıdır.
 */
export function fittingSubmission(
  placement: Pick<Placement, 'variants'>,
  counts: FittingCounts,
  parentDiameters: readonly CatalogCardVariant[],
  compatibleFor: CompatibleFor,
): FittingSubmission {
  const totals = new Map<string, { diameter: string; kind: string; count: number }>();
  for (const [diameter, byKind] of Object.entries(counts))
    for (const [kind, count] of Object.entries(byKind)) {
      if (!(count > 0) || !compatibleFor(diameter).some((option) => option.code === kind)) continue;
      totals.set(keyOf(diameter, kind), { diameter, kind, count });
    }
  const rows = [...totals.values()].map(({ diameter, kind, count }) => ({
    quantity: count,
    variant: diameter === 'GENEL' ? null : diameter,
    secondaryVariant: kind,
    notes: `${placement.variants?.find((item) => item.code === kind)?.label ?? kind}${
      diameter === 'GENEL' ? '' : ` · Çap: ${parentDiameters.find((item) => item.code === diameter)?.label ?? diameter}`
    }`,
  }));
  return { rows, submitted: new Set(totals.keys()) };
}

/** Başarılı kayıttan sonra taslakta kalanlar: gönderilen (çap, tür) çiftleri çıkarılır. */
export function remainingAfterSubmit(counts: FittingCounts, submitted: ReadonlySet<string>): FittingCounts {
  const remaining: FittingCounts = {};
  for (const [diameter, byKind] of Object.entries(counts))
    remaining[diameter] = Object.fromEntries(
      Object.entries(byKind).filter(([kind]) => !submitted.has(keyOf(diameter, kind))),
    );
  return remaining;
}

export function pendingTotal(submission: FittingSubmission): number {
  return submission.rows.reduce((sum, row) => sum + row.quantity, 0);
}
