import type { Measurement, MeasurementSummary, Placement, Project, Revision } from '../../types';
import { listOf, type EntityTable, type SummaryEntity } from './entities.ts';
import type { AppState, LoadState } from './appStore.ts';

/**
 * Seçiciler. Zustand bir bileşeni yalnız seçicisinin döndürdüğü değer
 * DEĞİŞTİĞİNDE (Object.is) yeniden çizer; bu yüzden türetilmiş her dizi,
 * girdisi olan tablo değişmedikçe AYNI referansla dönmelidir. Gruplamalar tablo
 * referansına göre önbelleklenir: bir ölçüm kaydı yalnız ölçüm ve özet
 * tablolarını değiştirir, proje seçici ya da kütüphane listesi yeniden çizilmez.
 */

const EMPTY: readonly never[] = Object.freeze([]);

/** Son argümanlara göre önbellekleyen sarmalayıcı (referans eşitliği). */
export function memoizeLast<A extends unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A) => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((value, index) => Object.is(value, args[index])))
      return lastResult;
    lastResult = compute(...args);
    lastArgs = args;
    return lastResult;
  };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key == null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  for (const bucket of groups.values()) Object.freeze(bucket);
  return groups as Map<string, readonly T[]>;
}

/** Tablo başına bir gruplama önbelleği. */
function groupedBy<T>(keyOf: (item: T) => string | null | undefined) {
  const cache = new WeakMap<EntityTable<T>, Map<string, readonly T[]>>();
  return (table: EntityTable<T>) => {
    let grouped = cache.get(table);
    if (!grouped) {
      grouped = groupBy(listOf(table), keyOf);
      cache.set(table, grouped);
    }
    return grouped;
  };
}

const revisionsByProject = groupedBy<Revision>((item) => item.projectId);
const placementsByRevision = groupedBy<Placement>((item) => item.revisionId);
const measurementsByPlacement = groupedBy<Measurement>((item) => item.placementId);
const measurementsByRevision = groupedBy<Measurement>((item) => item.revisionId);
const summariesByPlacement = groupedBy<SummaryEntity>((item) => item.placementId);
const summariesByRevision = groupedBy<SummaryEntity>((item) => item.revisionId);

export const selectProjects = (state: AppState): readonly Project[] => listOf(state.entities.projects);

export const selectSelectedProject = (state: AppState): Project | null =>
  (state.selection.projectId && state.entities.projects.byId.get(state.selection.projectId)) || null;

export const selectSelectedRevision = (state: AppState): Revision | null =>
  (state.selection.revisionId && state.entities.revisions.byId.get(state.selection.revisionId)) || null;

export const selectRevisionsOf = (state: AppState, projectId: string | null): readonly Revision[] =>
  (projectId && revisionsByProject(state.entities.revisions).get(projectId)) || EMPTY;

/** Onaylı/arşivlenmiş revizyon kilitlidir; düzenleme yolları kapanır ve kalıcı şerit görünür. */
export const selectIsRevisionLocked = (state: AppState): boolean => {
  const revision = selectSelectedRevision(state);
  return revision ? revision.status !== 'Draft' : false;
};

export const selectPlacementsOf = (state: AppState, revisionId: string | null): readonly Placement[] =>
  (revisionId && placementsByRevision(state.entities.placements).get(revisionId)) || EMPTY;

export const selectMeasurementsOfPlacement = (state: AppState, placementId: string | null): readonly Measurement[] =>
  (placementId && measurementsByPlacement(state.entities.measurements).get(placementId)) || EMPTY;

export const selectMeasurementsOfRevision = (state: AppState, revisionId: string | null): readonly Measurement[] =>
  (revisionId && measurementsByRevision(state.entities.measurements).get(revisionId)) || EMPTY;

export const selectSummariesOfPlacement = (state: AppState, placementId: string | null): readonly SummaryEntity[] =>
  (placementId && summariesByPlacement(state.entities.summaries).get(placementId)) || EMPTY;

export const selectSummariesOfRevision = (state: AppState, revisionId: string | null): readonly SummaryEntity[] =>
  (revisionId && summariesByRevision(state.entities.summaries).get(revisionId)) || EMPTY;

const IDLE: LoadState = Object.freeze({ status: 'idle', error: null, at: 0 });

export const selectLoad = (state: AppState, key: string): LoadState => state.loads[key] ?? IDLE;

// ---------------------------------------------------------------------------
// Proje ağacı: masaüstündeki React Flow haritasının telefon karşılığı girintili
// bir listedir. Satırlar derinlik öncelikli sırayla, sunucu sırası korunarak
// düzleştirilir; sanallaştırılmış liste doğrudan bu diziyi çizer.
// ---------------------------------------------------------------------------

export interface PlacementTreeRow {
  placement: Placement;
  depth: number;
  childCount: number;
  /** Kökten bu satıra kimlik zinciri (kendisi dahil); daraltma/kapsam için. */
  path: readonly string[];
}

const treeCache = new WeakMap<readonly Placement[], readonly PlacementTreeRow[]>();

export function buildPlacementTree(placements: readonly Placement[]): readonly PlacementTreeRow[] {
  const cached = treeCache.get(placements);
  if (cached) return cached;
  const ids = new Set(placements.map((item) => item.id));
  const children = new Map<string | null, Placement[]>();
  for (const placement of placements) {
    // Ebeveyni listede olmayan kart kök sayılır: kaybolmaktansa en üstte görünür.
    const parent =
      placement.parentPlacementId && ids.has(placement.parentPlacementId) ? placement.parentPlacementId : null;
    const bucket = children.get(parent);
    if (bucket) bucket.push(placement);
    else children.set(parent, [placement]);
  }
  const rows: PlacementTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (placement: Placement, depth: number, path: readonly string[]): boolean => {
    if (visited.has(placement.id)) return false;
    visited.add(placement.id);
    const ownPath = [...path, placement.id];
    const row = { placement, depth, childCount: 0, path: ownPath };
    rows.push(row);
    // Yalnız gerçekten bu satırın altında çizilen çocuklar sayılır (döngüde
    // zaten çizilmiş ata çocuk sayılmaz).
    for (const child of children.get(placement.id) ?? []) if (visit(child, depth + 1, ownPath)) row.childCount += 1;
    return true;
  };
  for (const root of children.get(null) ?? []) visit(root, 0, []);
  // Döngüdeki kartlar (A→B→A) hiçbir kökten erişilemez; kaybolmasınlar.
  for (const placement of placements) visit(placement, 0, []);
  const frozen = Object.freeze(rows);
  treeCache.set(placements, frozen);
  return frozen;
}

/** Bir kartın kendisi ve bütün altındakiler (silme/geri alma ve alt ağaç raporu için). */
export function subtreeIds(placements: readonly Placement[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const placement of placements) {
    if (!placement.parentPlacementId) continue;
    const bucket = childrenOf.get(placement.parentPlacementId);
    if (bucket) bucket.push(placement.id);
    else childrenOf.set(placement.parentPlacementId, [placement.id]);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

/**
 * Özetlerin gösterim sırası: masaüstündeki SummaryTable ile aynı kural
 * (ağaç derinliği, büyük çap önce, ad, varyant). Telefonda Özet sekmesi aynı
 * sırayı gösterir ki iki ekranda aynı malzeme listesi aynı sırada okunsun.
 */
export function sortSummariesForDisplay<T extends MeasurementSummary>(
  summaries: readonly T[],
  placements: readonly Placement[],
): T[] {
  const parentById = new Map(placements.map((item) => [item.id, item.parentPlacementId ?? null]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string) => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    let depth = 0;
    let cursor = parentById.get(id) ?? null;
    while (cursor && depth < 12) {
      depth += 1;
      cursor = parentById.get(cursor) ?? null;
    }
    depthCache.set(id, depth);
    return depth;
  };
  const sizeOf = (name: string) =>
    Number(name.match(/(?:DN\s*|\b)(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(',', '.') ?? '') || 0;
  return summaries
    .map((summary) => ({
      summary,
      depth: depthOf(summary.placementId),
      size: sizeOf(summary.variant ?? summary.placementName),
    }))
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        b.size - a.size ||
        a.summary.placementName.localeCompare(b.summary.placementName, 'tr') ||
        (a.summary.variant ?? '').localeCompare(b.summary.variant ?? '', 'tr'),
    )
    .map((row) => row.summary);
}
