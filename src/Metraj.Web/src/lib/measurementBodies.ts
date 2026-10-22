import type { CatalogCardVariant, Measurement, Placement } from '../types';
import type { MeasurementDraft } from './draftTypes';

/**
 * Ölçüm satırlarının sunucuya giden gövdeleri — masaüstü (App.tsx, Inspector.tsx)
 * ve telefon (src/mobile) AYNI fonksiyonları çağırır. Hesap mantığının ikinci
 * kopyası olmaz: alan sırası, `' · '` ayırıcısı, varyant ve not kuralları
 * yalnız burada tanımlıdır; iki arayüzün ayrışması "yanlış miktar" demektir.
 */

export interface EntryRow {
  quantity: number;
  notes?: string | null;
  variant?: string | null;
  secondaryVariant?: string | null;
}

/** Sunucudaki ayrı bağlam alanları; boş değer `null` gider. */
export interface EntryFields {
  block: string | null;
  floor: string | null;
  room: string | null;
  zone: string | null;
  sheet: string | null;
  drawingRevision: string | null;
}

/**
 * Bir girişin "nerede" olduğu: ayrı alanlar + ayrı alanı olmayan parçalar
 * (masaüstünde serbest not; telefonda şaft, hat no ve not). Parçalar satıra
 * özel notun ARDINA yazılır.
 */
export interface EntryContext {
  fields: EntryFields;
  noteSegments: readonly (string | null | undefined)[];
}

export interface MeasurementBody extends EntryFields {
  placementId: string;
  inputQuantity: number;
  inputUnit: string;
  notes: string | null;
  sourceKind: 'USER';
  variant: string | null;
  secondaryVariant: string | null;
}

export const QUANTITY_ERROR = 'Miktarı sıfırdan büyük bir sayı olarak yazın.';

/** Boş liste veya sıfırdan büyük olmayan/sonlu olmayan miktar reddedilir. */
export function rowsError(rows: readonly EntryRow[]): string | null {
  return !rows.length || rows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0)
    ? QUANTITY_ERROR
    : null;
}

/** Satırın notu: önce satıra özel not (ör. "Çap: DN25"), sonra bağlam parçaları. */
export function composeRowNotes(
  rowNotes: string | null | undefined,
  segments: readonly (string | null | undefined)[],
): string | null {
  return [rowNotes, ...segments].filter(Boolean).join(' · ') || null;
}

/** Masaüstü Inspector altındaki Blok/Kat/Mahal/Pafta/Not alanları; zon ve çizim revizyonu masaüstünde yok. */
export function draftEntryContext(
  draft: Pick<MeasurementDraft, 'block' | 'floor' | 'room' | 'sheet' | 'notes'>,
): EntryContext {
  return {
    fields: {
      block: draft.block || null,
      floor: draft.floor || null,
      room: draft.room || null,
      zone: null,
      sheet: draft.sheet || null,
      drawingRevision: null,
    },
    noteSegments: [draft.notes],
  };
}

/** `POST /revisions/{id}/measurements/batch` gövdesi. */
export function buildMeasurementBodies(
  placement: Pick<Placement, 'id' | 'unit'>,
  rows: readonly EntryRow[],
  context: EntryContext,
): MeasurementBody[] {
  const { fields } = context;
  return rows.map((row) => ({
    placementId: placement.id,
    inputQuantity: row.quantity,
    inputUnit: placement.unit,
    block: fields.block,
    floor: fields.floor,
    room: fields.room,
    zone: fields.zone,
    sheet: fields.sheet,
    drawingRevision: fields.drawingRevision,
    notes: composeRowNotes(row.notes, context.noteSegments),
    sourceKind: 'USER',
    variant: row.variant ?? null,
    secondaryVariant: row.secondaryVariant ?? null,
  }));
}

type ContextFieldKey = keyof EntryFields;

export interface MeasurementEdit {
  quantity: number;
  /** Verilirse bağlam alanları da değişir; verilmezse satırın mevcut değerleri korunur. */
  context?: Partial<Pick<Measurement, ContextFieldKey>>;
}

/** `PUT /measurements/{id}` gövdesi: satırın diğer bütün alanları aynen korunur. */
export function buildUpdateBody(measurement: Measurement, edit: MeasurementEdit) {
  const context = edit.context ?? {};
  const pick = (key: ContextFieldKey) => (key in context ? context[key] : measurement[key]) ?? null;
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

export type MeasurementUpdateBody = ReturnType<typeof buildUpdateBody>;

/** Boru çapı satırı: varyant çap kodu, not "Çap: {etiket}". */
export function pipeRow(quantity: number, code: string, variants: readonly CatalogCardVariant[]): EntryRow {
  const profile = variants.find((item) => item.code === code);
  return { quantity, variant: code, notes: `Çap: ${profile?.label ?? code}` };
}

/** Çap → fitting türü → bekleyen adet. */
export type FittingCounts = Record<string, Record<string, number>>;

export type CompatibleFor = (diameterCode: string) => readonly CatalogCardVariant[];

export interface FittingSubmission {
  rows: EntryRow[];
  /** Kaydedilen (çap, tür) çiftleri; başarıdan sonra taslaktan bunlar silinir. */
  submitted: ReadonlySet<string>;
}

export const fittingKey = (diameter: string, kind: string) => `${diameter}\u0000${kind}`;

/**
 * Fitting satırları: yalnız o çapla UYUMLU türlerin sıfırdan büyük adetleri
 * gönderilir, uyumsuz kalıntılar (örn. başka boruya bağlanınca) taslakta kalır.
 * Birden çok sayım tablosu (masaüstünde kutular) (çap, tür) çiftine göre
 * toplanır; satır sırası tablo/çap/tür ilk görülme sırasıdır.
 */
export function fittingSubmission(
  placement: Pick<Placement, 'variants'>,
  tables: readonly FittingCounts[],
  parentDiameters: readonly CatalogCardVariant[],
  compatibleFor: CompatibleFor,
): FittingSubmission {
  const totals = new Map<string, { diameter: string; kind: string; count: number }>();
  for (const counts of tables)
    for (const [diameter, byKind] of Object.entries(counts))
      for (const [kind, count] of Object.entries(byKind)) {
        if (!(count > 0) || !compatibleFor(diameter).some((option) => option.code === kind)) continue;
        const key = fittingKey(diameter, kind);
        totals.set(key, { diameter, kind, count: (totals.get(key)?.count ?? 0) + count });
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
      Object.entries(byKind).filter(([kind]) => !submitted.has(fittingKey(diameter, kind))),
    );
  return remaining;
}
