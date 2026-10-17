import type { MeasurementSummary } from '../../../types';
import { purchaseUnit } from '../../../lib/format.ts';

/**
 * Bir kartın toplamları (ağaç rozetleri ve giriş sayfası üst kartı).
 *
 * Sayılar sunucunun `decimal` hesabından gelir; burada yalnız aynı kartın
 * çap/çeşit satırları TOPLANIR (masaüstü Inspector "Şu ana kadar" kartıyla aynı
 * kural). Satın alma adedini JavaScript kayan noktasıyla yeniden hesaplamak
 * bir zamanlar 40 × 0,1 m girişinde yanlış boy sayısı göstermişti; bu yüzden
 * burada hiçbir adet/boy türetmesi yoktur.
 */
export interface PlacementTotals {
  net: number;
  withWaste: number;
  purchase: number;
  unit: string;
  purchaseUnit: string;
  entries: number;
  /** Kaç çap/çeşit satırı toplandı. */
  variantCount: number;
}

export function totalsOf(summaries: readonly MeasurementSummary[]): PlacementTotals | null {
  const first = summaries[0];
  if (!first) return null;
  let net = 0;
  let withWaste = 0;
  let purchase = 0;
  let entries = 0;
  for (const summary of summaries) {
    net += summary.netQuantity;
    withWaste += summary.withWasteQuantity;
    purchase += summary.purchaseQuantity;
    entries += summary.measurementCount;
  }
  return {
    net,
    withWaste,
    purchase,
    unit: first.unit,
    purchaseUnit: purchaseUnit(first),
    entries,
    variantCount: summaries.length,
  };
}

/** Yerleşim kimliğine göre toplamlar; ağaç satırı başına O(1) okuma. */
export function totalsByPlacement(summaries: readonly MeasurementSummary[]): Map<string, PlacementTotals> {
  const groups = new Map<string, MeasurementSummary[]>();
  for (const summary of summaries) {
    const bucket = groups.get(summary.placementId);
    if (bucket) bucket.push(summary);
    else groups.set(summary.placementId, [summary]);
  }
  const result = new Map<string, PlacementTotals>();
  for (const [id, group] of groups) {
    const totals = totalsOf(group);
    if (totals) result.set(id, totals);
  }
  return result;
}
