import type { CatalogCardVariant, Measurement, MeasurementSummary, Placement } from '../../../types';
import { STEEL_DIAMETERS, variantName } from '../../../lib/catalogData.ts';
import { diameterCode } from '../../../lib/fittingChoices.ts';
import { measurementVariantOf } from '../../../lib/format.ts';
import type { EntryRow } from './measurementRows.ts';

/**
 * Boru çapı/boyutu seçimi (saf). Masaüstü Inspector'daki "Boru çapları" kutusunun
 * telefon karşılığı: kutu listesi yerine çip ızgarası; hangi çapın seçili olduğu
 * `pipe-boxes.v1.{id}` taslağında masaüstüyle aynı biçimde saklanır.
 */
const lower = (value: string) => value.trim().toLocaleLowerCase('tr');

/** Ölçümde yazılı çap, varyantın koduyla veya etiketiyle eşleşiyor mu (büyük/küçük harf duyarsız)? */
export const matchesVariant = (value: string, variant: Pick<CatalogCardVariant, 'code' | 'label'>) =>
  lower(value) === lower(variant.code) || lower(value) === lower(variant.label);

/** Kartın çap listesi; kartta tanım yoksa girilmiş çaplar, o da yoksa çelik boru çapları. */
export function pipeVariants(placement: Placement, measurements: readonly Measurement[]): CatalogCardVariant[] {
  if (placement.variants?.length) return placement.variants;
  const known = [...new Set(measurements.map((item) => measurementVariantOf(item)).filter(Boolean))];
  return known.length ? known.map((item) => ({ code: item, label: item })) : STEEL_DIAMETERS;
}

/**
 * Masaüstü `summaryForVariant`: toplam ve satın alma boyu sunucunun `decimal`
 * sonucundan okunur, burada yeniden hesaplanmaz.
 */
export function summaryForVariant(
  summaries: readonly MeasurementSummary[],
  variant: Pick<CatalogCardVariant, 'code' | 'label'>,
): MeasurementSummary | undefined {
  return summaries.find((item) => {
    const value = (item.variant ?? '').toLowerCase();
    return value === variant.code.toLowerCase() || value === variant.label.toLowerCase();
  });
}

/**
 * Çapları kullanım sırasına göre dizer: en son ölçüm girilen çap başa gelir,
 * hiç girilmeyenler kartın kendi sırasıyla sona. Sahada aynı birkaç çapla
 * çalışılır; 11 çaplı bir listede her seferinde aşağı kaydırmak gerekmez.
 */
export function orderByRecentUse<T extends Pick<CatalogCardVariant, 'code' | 'label'>>(
  variants: readonly T[],
  measurements: readonly Pick<Measurement, 'variant' | 'notes' | 'createdAtUtc'>[],
): T[] {
  const lastUsed = new Map<number, number>();
  for (const measurement of measurements) {
    const value = measurementVariantOf(measurement);
    if (!value) continue;
    const index = variants.findIndex((variant) => matchesVariant(value, variant));
    if (index < 0) continue;
    const time = Date.parse(measurement.createdAtUtc);
    const stamp = Number.isFinite(time) ? time : 0;
    if (stamp >= (lastUsed.get(index) ?? -1)) lastUsed.set(index, stamp);
  }
  return variants
    .map((variant, index) => ({ variant, index, used: lastUsed.get(index) }))
    .sort((a, b) => {
      if (a.used !== undefined && b.used !== undefined) return b.used - a.used || a.index - b.index;
      if (a.used !== undefined) return -1;
      if (b.used !== undefined) return 1;
      return a.index - b.index;
    })
    .map((item) => item.variant);
}

/** Birleştirilmiş kart kaynağı (boru çeşidi / basınç sınıfı) anahtarı. */
export const sourceGroupKey = (variant: CatalogCardVariant) => variant.sourceCardName ?? variant.sourceCardCode ?? '';

/** Masaüstüyle aynı: farklı kaynak kartlar varsa grup seçici gösterilir. */
export function sourceGroups(placement: Placement, variants: readonly CatalogCardVariant[]): Array<[string, string]> {
  return [
    ...new Map(variants.map((item) => [sourceGroupKey(item), item.sourceCardName ?? placement.cardName])).entries(),
  ];
}

/** Seçili çapın kaynak grubuna ait çaplar (tek grup varsa hepsi). */
export function variantsInGroup(
  placement: Placement,
  variants: readonly CatalogCardVariant[],
  selectedCode: string,
): CatalogCardVariant[] {
  if (sourceGroups(placement, variants).length <= 1) return [...variants];
  const selected = variants.find((item) => item.code === selectedCode);
  const group = selected ? sourceGroupKey(selected) : sourceGroupKey(variants[0]!);
  return variants.filter((item) => sourceGroupKey(item) === group);
}

/** Gruba geçilince aynı çapı (aynı `diameterCode`) yeni grupta koru, yoksa ilkini seç. */
export function switchGroup(
  variants: readonly CatalogCardVariant[],
  currentCode: string,
  groupKey: string,
): string | null {
  const inGroup = variants.filter((item) => sourceGroupKey(item) === groupKey);
  const current = variants.find((item) => item.code === currentCode);
  const next = inGroup.find((item) => current && diameterCode(item) === diameterCode(current)) ?? inGroup[0];
  return next?.code ?? null;
}

/** Masaüstü `submitPipeBox` satırı. */
export function pipeRow(quantity: number, code: string, variants: readonly CatalogCardVariant[]): EntryRow {
  const profile = variants.find((item) => item.code === code);
  return { quantity, variant: code, notes: `Çap: ${profile?.label ?? code}` };
}

export interface PipeBoxDraft {
  id: string;
  diameter: string;
}

/** Kayıtlı çap kutularından geçerli ilk çapı alır (kartın çap kümesinde olmayan atılır). */
export function readSelectedDiameter(raw: unknown, variants: readonly CatalogCardVariant[]): string | null {
  if (!Array.isArray(raw)) return null;
  const valid = new Set(variants.map((item) => item.code.toLowerCase()));
  for (const item of raw) {
    const diameter =
      item && typeof item === 'object' && typeof (item as { diameter?: unknown }).diameter === 'string'
        ? (item as { diameter: string }).diameter.trim()
        : '';
    if (diameter && valid.has(diameter.toLowerCase())) {
      return variants.find((variant) => variant.code.toLowerCase() === diameter.toLowerCase())?.code ?? diameter;
    }
  }
  return null;
}

/** Masaüstüyle uyumlu taslak: tek kutulu dizi. */
export function pipeBoxesDraft(placementId: string, diameter: string): PipeBoxDraft[] {
  return [{ id: `${placementId}-pipe-0`, diameter }];
}

export interface StockInfo {
  /** Standart boy (m); tanımlı değilse 0. */
  stockLength: number;
  /** Satın alma birimi "boy" mu? */
  bars: boolean;
  /** Satın alınacak boy sayısı (sunucudan; "boy" değilse 0). */
  barCount: number;
}

export function stockInfo(variant: CatalogCardVariant | undefined, summary: MeasurementSummary | undefined): StockInfo {
  const bars = (summary?.purchaseUnit ?? '') === 'boy';
  return { stockLength: variant?.standardLength ?? 0, bars, barCount: bars ? (summary?.purchaseQuantity ?? 0) : 0 };
}

export { variantName };
