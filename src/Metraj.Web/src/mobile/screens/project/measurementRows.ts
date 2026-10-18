import type { Measurement, Placement } from '../../../types';
import { composeNotes, contextToFields, type MeasureContext } from './context.ts';

/**
 * Ölçüm satırlarının sunucuya gidecek gövdesi. Masaüstü `addMeasurementRows`
 * (App.tsx) ve `updateMeasurementQuantity` ile AYNI alanları üretir; ikisinin
 * ayrışması "yanlış sayı" demektir, bu yüzden tests/mobile-project-rows.test.mjs
 * masaüstü ifadesini yeniden kurup karşılaştırır.
 */
export interface EntryRow {
  quantity: number;
  notes?: string | null;
  variant?: string | null;
  secondaryVariant?: string | null;
}

export interface MeasurementBody {
  placementId: string;
  inputQuantity: number;
  inputUnit: string;
  block: string | null;
  floor: string | null;
  room: string | null;
  zone: string | null;
  sheet: string | null;
  drawingRevision: string | null;
  notes: string | null;
  sourceKind: 'USER';
  variant: string | null;
  secondaryVariant: string | null;
}

export const QUANTITY_ERROR = 'Miktarı sıfırdan büyük bir sayı olarak yazın.';

/** Masaüstüyle aynı kontrol: boş liste veya sıfırdan büyük olmayan/sonlu olmayan miktar reddedilir. */
export function rowsError(rows: readonly EntryRow[]): string | null {
  return !rows.length || rows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0)
    ? QUANTITY_ERROR
    : null;
}

export function buildMeasurementBodies(
  placement: Pick<Placement, 'id' | 'unit'>,
  rows: readonly EntryRow[],
  context: MeasureContext,
): MeasurementBody[] {
  const fields = contextToFields(context);
  return rows.map((row) => ({
    placementId: placement.id,
    inputQuantity: row.quantity,
    inputUnit: placement.unit,
    ...fields,
    notes: composeNotes(row.notes, context),
    sourceKind: 'USER',
    variant: row.variant ?? null,
    secondaryVariant: row.secondaryVariant ?? null,
  }));
}

/** Sunucu yanıtı gelene kadar listede görünen geçici satır. */
export function provisionalMeasurement(
  revisionId: string,
  placement: Pick<Placement, 'cardCode' | 'displayName'>,
  body: MeasurementBody,
  id: string,
  now: Date,
): Measurement {
  return {
    id,
    revisionId,
    placementId: body.placementId,
    placementCode: placement.cardCode,
    placementName: placement.displayName,
    sourceKind: body.sourceKind,
    inputQuantity: body.inputQuantity,
    inputUnit: body.inputUnit,
    block: body.block,
    floor: body.floor,
    room: body.room,
    zone: body.zone,
    sheet: body.sheet,
    drawingRevision: body.drawingRevision,
    notes: body.notes,
    createdAtUtc: now.toISOString(),
    variant: body.variant,
    secondaryVariant: body.secondaryVariant,
  };
}

export interface MeasurementEdit {
  quantity: number;
  /** Verilirse bağlam alanları da değişir; verilmezse satırın mevcut değerleri korunur. */
  context?: Partial<Pick<Measurement, 'block' | 'floor' | 'room' | 'zone' | 'sheet' | 'drawingRevision'>>;
}

/** Masaüstü `updateMeasurementQuantity` gövdesi: satırın diğer bütün alanları aynen korunur. */
export function buildUpdateBody(measurement: Measurement, edit: MeasurementEdit) {
  const context = edit.context ?? {};
  const pick = (key: 'block' | 'floor' | 'room' | 'zone' | 'sheet' | 'drawingRevision') =>
    (key in context ? context[key] : measurement[key]) ?? null;
  return {
    revisionId: measurement.revisionId,
    placementId: measurement.placementId,
    inputQuantity: edit.quantity,
    inputUnit: measurement.inputUnit,
    block: pick('block'),
    floor: pick('floor'),
    room: pick('room'),
    zone: pick('zone'),
    sheet: pick('sheet'),
    drawingRevision: pick('drawingRevision'),
    notes: measurement.notes ?? null,
    sourceKind: measurement.sourceKind,
    variant: measurement.variant ?? null,
    secondaryVariant: measurement.secondaryVariant ?? null,
  };
}

/**
 * Düzeltme/ekleme sonrası listede gösterilecek satır: gövdedeki alanlar üzerine
 * yazılır, güncellenme zamanı işlenir ("düzeltildi" etiketi).
 */
export function applyUpdate(
  measurement: Measurement,
  body: ReturnType<typeof buildUpdateBody>,
  now: Date,
): Measurement {
  return {
    ...measurement,
    inputQuantity: body.inputQuantity,
    block: body.block,
    floor: body.floor,
    room: body.room,
    zone: body.zone,
    sheet: body.sheet,
    drawingRevision: body.drawingRevision,
    updatedAtUtc: now.toISOString(),
  };
}

/**
 * Tuş takımı ifadesi olarak gösterilecek metin (Türkçe virgül). `String(1e-7)` "1e-7" verir ve
 * tuş takımı bunu ayrıştıramaz; sabit biçim kullanılır.
 */
export function quantityToExpression(value: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 20, useGrouping: false }).format(value);
}

/**
 * Sunucu `DateTime`'ı UTC ve "Z" ekiyle yazar ("2026-10-17T14:45:38.41Z"). Önceki
 * sürümler eksiz yazıyordu; tarayıcı eksiz değeri yerel saat sayacağı için eski bir
 * önbellekten ya da içe aktarılmış veriden gelen eksiz zaman damgası da UTC kabul edilir.
 */
export function parseUtc(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

/** Geçmiş listesi sırası: en yeni önce, eşitlikte kimlik. */
export function newestFirst(measurements: readonly Measurement[]): Measurement[] {
  const time = (value: string) => {
    const parsed = parseUtc(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...measurements].sort((a, b) => time(b.createdAtUtc) - time(a.createdAtUtc) || b.id.localeCompare(a.id));
}
