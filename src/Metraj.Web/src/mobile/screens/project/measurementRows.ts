import type { Measurement, Placement } from '../../../types';
import type { MeasurementBody, MeasurementUpdateBody } from '../../../lib/measurementBodies.ts';

/**
 * Telefonun ölçüm listesine özgü yardımcılar (geçici satır, düzeltme sonrası
 * görünüm, sıralama). Sunucuya giden gövdeler masaüstüyle ORTAK modülden gelir
 * (lib/measurementBodies.ts: `buildMeasurementBodies`, `buildUpdateBody`,
 * `rowsError`); burada kopyası yoktur.
 */

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

/**
 * Düzeltme/ekleme sonrası listede gösterilecek satır: gövdedeki alanlar üzerine
 * yazılır, güncellenme zamanı işlenir ("düzeltildi" etiketi).
 */
export function applyUpdate(measurement: Measurement, body: MeasurementUpdateBody, now: Date): Measurement {
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
 * Sunucu `DateTime`'ı saat dilimi eki OLMADAN yazıyor ("2026-10-17T14:45:38.41");
 * tarayıcı bunu yerel saat sayar ve ekranda UTC farkı kadar kayık saat görünür.
 * Eksiz zaman damgaları UTC kabul edilir (sunucu hep UTC yazar).
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
