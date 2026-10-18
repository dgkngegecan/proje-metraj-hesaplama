import type { FittingCounts, FittingSubmission } from '../../../lib/measurementBodies.ts';

/**
 * Fitting adet sayımı (saf). Masaüstü Inspector'daki "Uyumlu çap ve parça
 * seçenekleri" kutusunun telefon karşılığı. Bekleyen adetler masaüstüyle AYNI
 * taslak biçiminde (`fitting-draft.v1.{id}` = FittingBox[]) saklanır: yarım
 * kalmış sayım bir cihazdan ötekine yedekle taşınabilir. Telefon tek kutu
 * kullanır (çaplar çiple değişir); masaüstünden gelen birden çok kutu okunurken
 * toplanır — kayıtta zaten kutular (çap, tür) çiftine göre toplanıyordu.
 * Gönderilecek satırlar masaüstüyle ORTAK `fittingSubmission`'dan
 * (lib/measurementBodies.ts) üretilir.
 */
export type { FittingCounts };
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

/** Kaydedilecek toplam adet (gönder düğmesi). Satırlar ortak `fittingSubmission`'dan gelir. */
export function pendingTotal(submission: FittingSubmission): number {
  return submission.rows.reduce((sum, row) => sum + row.quantity, 0);
}
