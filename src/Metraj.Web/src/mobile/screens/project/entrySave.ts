import { ApiError } from '../../../api.ts';
import type { Measurement, MeasurementSummary, Placement } from '../../../types';
import { patch, summaryKey, type PatchOp } from '../../store/entities.ts';
import {
  runOptimistic,
  temporaryId,
  type EntityStore,
  type Feedback,
  type OptimisticResult,
} from '../../store/optimistic.ts';
import type { MeasureContext } from './context.ts';
import {
  applyUpdate,
  buildMeasurementBodies,
  buildUpdateBody,
  provisionalMeasurement,
  rowsError,
  type EntryRow,
  type MeasurementEdit,
} from './measurementRows.ts';

/**
 * Ölçüm kayıtları (iyimser). Her kayıt önce listeye geçici satır olarak girer
 * (dokunuş → görsel tepki beklemeden), istek arkadan gider; başarısız olursa
 * yalnız bu işlemin geçici satırları geri alınır ve hata gösterilir. Sunucu
 * yanıtı gelince geçici satır gerçeğiyle değiştirilir. Özetler sunucuda
 * hesaplandığı için çağıran `refreshSummaries` ile YALNIZ özetleri tazeler.
 */
export interface SaveDeps {
  store: EntityStore;
  api: {
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body: unknown): Promise<T>;
  };
  feedback?: Pick<Feedback, 'error'>;
  now?: () => Date;
  idFor?: () => string;
}

export interface SaveRowsInput {
  revisionId: string;
  placement: Placement;
  rows: readonly EntryRow[];
  context: MeasureContext;
}

const fail = (deps: SaveDeps, message: string): OptimisticResult<never> => {
  const error = new ApiError(message);
  deps.feedback?.error(error, message);
  return { ok: false, error };
};

/** Bir veya birden çok satırı toplu uçla (`/measurements/batch`) kaydeder; masaüstüyle aynı yol. */
export async function saveMeasurementRows(
  deps: SaveDeps,
  input: SaveRowsInput,
): Promise<OptimisticResult<Measurement[]>> {
  const problem = rowsError(input.rows);
  if (problem) return fail(deps, problem);
  const now = (deps.now ?? (() => new Date()))();
  const idFor = deps.idFor ?? temporaryId;
  const bodies = buildMeasurementBodies(input.placement, input.rows, input.context);
  const provisional = bodies.map((body) =>
    provisionalMeasurement(input.revisionId, input.placement, body, idFor(), now),
  );
  return runOptimistic(deps.store, {
    ops: [patch.upsert('measurements', provisional, 'start')],
    request: () => deps.api.post<Measurement[]>(`/revisions/${input.revisionId}/measurements/batch`, bodies),
    reconcile: (saved) => [
      patch.remove(
        'measurements',
        provisional.map((item) => item.id),
      ),
      patch.upsert('measurements', saved, 'start'),
    ],
    feedback: deps.feedback,
  });
}

export async function updateMeasurement(
  deps: SaveDeps,
  measurement: Measurement,
  edit: MeasurementEdit,
): Promise<OptimisticResult<void>> {
  if (!Number.isFinite(edit.quantity) || edit.quantity <= 0)
    return fail(deps, 'Miktarı sıfırdan büyük bir sayı olarak yazın.');
  const body = buildUpdateBody(measurement, edit);
  const updated = applyUpdate(measurement, body, (deps.now ?? (() => new Date()))());
  return runOptimistic(deps.store, {
    ops: [patch.upsert('measurements', [updated])],
    request: async () => {
      await deps.api.put<void>(`/measurements/${measurement.id}`, body);
    },
    feedback: deps.feedback,
  });
}

/** Aynı miktarla yeni bir giriş ekler (sunucu kopyalar; geçici satır önce görünür). */
export async function duplicateMeasurement(
  deps: SaveDeps,
  measurement: Measurement,
): Promise<OptimisticResult<Measurement>> {
  const now = (deps.now ?? (() => new Date()))();
  const copy: Measurement = {
    ...measurement,
    id: (deps.idFor ?? temporaryId)(),
    createdAtUtc: now.toISOString(),
    updatedAtUtc: null,
  };
  return runOptimistic(deps.store, {
    ops: [patch.upsert('measurements', [copy], 'start')],
    request: () => deps.api.post<Measurement>(`/measurements/${measurement.id}/duplicate`),
    reconcile: (saved) => [patch.remove('measurements', [copy.id]), patch.upsert('measurements', [saved], 'start')],
    feedback: deps.feedback,
  });
}

/**
 * Bir kartı (ve altındakileri) silerken depodan kalkacak kayıtlar: kartlar,
 * ölçümleri ve özet satırları. Yalnız kartları kaldırmak, ağaç rozetlerinde
 * ve Özet sekmesinde silinmiş kartın toplamını geri alma süresi boyunca
 * hayalet olarak bırakırdı.
 */
export function removalOps(
  ids: readonly string[],
  measurements: readonly Pick<Measurement, 'id' | 'placementId'>[],
  summaries: readonly Pick<MeasurementSummary, 'placementId' | 'variant' | 'secondaryVariant'>[],
): PatchOp[] {
  const doomed = new Set(ids);
  return [
    patch.remove('placements', [...doomed]),
    patch.remove(
      'measurements',
      measurements.filter((item) => doomed.has(item.placementId)).map((item) => item.id),
    ),
    patch.remove('summaries', summaries.filter((item) => doomed.has(item.placementId)).map(summaryKey)),
  ];
}
