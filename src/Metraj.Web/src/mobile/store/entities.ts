import type {
  CatalogCard,
  CatalogCardType,
  MaterialWasteSetting,
  Measurement,
  MeasurementSummary,
  Placement,
  Project,
  Revision,
} from '../../types';

/**
 * Normalize edilmiş varlık tabloları ve geri alınabilir yamalar.
 *
 * Masaüstünde her liste ayrı bir `useState` dizisiydi; bir ölçüm kaydı bütün
 * diziyi yeniden kuruyor ve ona bağlı her bileşeni yeniden çiziyordu. Telefonda
 * 2.000 satırlık bir ağaçta bu, her dokunuşta hissedilir bir takılma demek.
 * Burada her varlık türü tek bir tabloda (anahtar → kayıt + sıra) durur ve
 * değişmeyen tablo AYNI referansla kalır; seçiciler de buna göre önbellekler.
 *
 * Bu dosya saftır (React'e ve ağa bağımlı değil): tests/mobile-store.test.mjs.
 */

export interface EntityTable<T> {
  /** `Map`: anahtarlar kullanıcı verisinden türeyebilir (özet varyantı), düz nesnede `__proto__` tehlikeli. */
  readonly byId: ReadonlyMap<string, T>;
  /** Sunucunun döndürdüğü sıra; listeler bu sırayla gösterilir. */
  readonly ids: readonly string[];
}

/** Özet satırlarının kendi revizyon kimliği yoktur; yüklenirken eklenir. */
export type SummaryEntity = MeasurementSummary & { revisionId: string };

export interface Entities {
  projects: EntityTable<Project>;
  revisions: EntityTable<Revision>;
  cards: EntityTable<CatalogCard>;
  catalogTypes: EntityTable<CatalogCardType>;
  placements: EntityTable<Placement>;
  measurements: EntityTable<Measurement>;
  summaries: EntityTable<SummaryEntity>;
  wasteSettings: EntityTable<MaterialWasteSetting>;
}

export type EntityName = keyof Entities;
export type EntityOf<N extends EntityName> = Entities[N] extends EntityTable<infer T> ? T : never;

const EMPTY_IDS: readonly string[] = Object.freeze([]);

export function emptyTable<T>(): EntityTable<T> {
  return { byId: new Map(), ids: EMPTY_IDS };
}

export function emptyEntities(): Entities {
  return {
    projects: emptyTable(),
    revisions: emptyTable(),
    cards: emptyTable(),
    catalogTypes: emptyTable(),
    placements: emptyTable(),
    measurements: emptyTable(),
    summaries: emptyTable(),
    wasteSettings: emptyTable(),
  };
}

/** Bir özetin kimliği: aynı yerleşimin her çap/varyant birleşimi ayrı satırdır. */
export function summaryKey(summary: Pick<MeasurementSummary, 'placementId' | 'variant' | 'secondaryVariant'>) {
  return `${summary.placementId}\u001f${summary.variant ?? ''}\u001f${summary.secondaryVariant ?? ''}`;
}

const byIdKey = (item: { id: string }) => item.id;

export const entityKey: { [N in EntityName]: (item: EntityOf<N>) => string } = {
  projects: byIdKey,
  revisions: byIdKey,
  cards: byIdKey,
  catalogTypes: byIdKey,
  placements: byIdKey,
  measurements: byIdKey,
  summaries: summaryKey,
  wasteSettings: byIdKey,
};

export function tableFrom<T>(items: Iterable<T>, keyOf: (item: T) => string): EntityTable<T> {
  const byId = new Map<string, T>();
  const ids: string[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!byId.has(key)) ids.push(key);
    byId.set(key, item);
  }
  return { byId, ids };
}

/** Var olanı yerinde günceller, yeniyi sona (veya başa) ekler. Hiçbir şey değişmezse aynı tablo döner. */
export function upsertMany<T>(
  table: EntityTable<T>,
  items: readonly T[],
  keyOf: (item: T) => string,
  position: 'start' | 'end' = 'end',
): EntityTable<T> {
  if (!items.length) return table;
  let byId: Map<string, T> | null = null;
  const added: string[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const current = (byId ?? table.byId).get(key);
    const exists = (byId ?? table.byId).has(key);
    if (exists && Object.is(current, item)) continue;
    byId ??= new Map(table.byId);
    if (!exists) added.push(key);
    byId.set(key, item);
  }
  if (!byId) return table;
  const ids = added.length ? (position === 'start' ? [...added, ...table.ids] : [...table.ids, ...added]) : table.ids;
  return { byId, ids };
}

export function removeMany<T>(table: EntityTable<T>, keys: Iterable<string>): EntityTable<T> {
  const doomed = new Set<string>();
  for (const key of keys) if (table.byId.has(key)) doomed.add(key);
  if (!doomed.size) return table;
  const byId = new Map(table.byId);
  for (const key of doomed) byId.delete(key);
  return { byId, ids: table.ids.filter((key) => !doomed.has(key)) };
}

export interface RestoreEntry<T> {
  key: string;
  item: T;
  /** Kaydın geri dönmesi gereken sıra. Liste o arada kısaldıysa sona kırpılır. */
  index: number;
}

/** Kayıtları eski sıralarına geri koyar (geri almanın temeli). */
export function restoreMany<T>(table: EntityTable<T>, entries: readonly RestoreEntry<T>[]): EntityTable<T> {
  if (!entries.length) return table;
  const byId = new Map(table.byId);
  const ids = [...table.ids];
  for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
    const existing = ids.indexOf(entry.key);
    if (existing >= 0) ids.splice(existing, 1);
    ids.splice(Math.max(0, Math.min(entry.index, ids.length)), 0, entry.key);
    byId.set(entry.key, entry.item);
  }
  return { byId, ids };
}

/** `predicate`'e uyan kayıtları atar, yerlerine `items`'ı koyar (bir revizyonun verisini tazelemek). */
export function replaceWhere<T>(
  table: EntityTable<T>,
  predicate: (item: T) => boolean,
  items: readonly T[],
  keyOf: (item: T) => string,
): EntityTable<T> {
  const kept = table.ids.map((key) => table.byId.get(key) as T).filter((item) => !predicate(item));
  return tableFrom([...kept, ...items], keyOf);
}

const listCache = new WeakMap<EntityTable<unknown>, readonly unknown[]>();

/** Tablonun sıralı listesi. Tablo değişmedikçe AYNI dizi döner (seçici kararlılığı için şart). */
export function listOf<T>(table: EntityTable<T>): readonly T[] {
  const cached = listCache.get(table as EntityTable<unknown>);
  if (cached) return cached as readonly T[];
  const list = Object.freeze(table.ids.map((key) => table.byId.get(key) as T));
  listCache.set(table as EntityTable<unknown>, list);
  return list;
}

// ---------------------------------------------------------------------------
// Yamalar. Her uygulama, YALNIZ dokunduğu kayıtları eski hâline döndüren bir
// ters yama üretir. Bütün durumun anlık görüntüsüne dönmek, arada başka bir
// işlemin yaptığı değişikliği de silerdi (ör. iki hızlı ölçüm kaydından ilki
// başarısız olursa ikincisi de kaybolurdu).
// ---------------------------------------------------------------------------

export type PatchOp =
  | { op: 'upsert'; entity: EntityName; items: readonly unknown[]; position?: 'start' | 'end' }
  | { op: 'remove'; entity: EntityName; keys: readonly string[] }
  | { op: 'restore'; entity: EntityName; entries: readonly RestoreEntry<unknown>[] };

/** Tip güvenli yama kurucuları: `patch.upsert('measurements', [m])`. */
export const patch = {
  upsert<N extends EntityName>(entity: N, items: readonly EntityOf<N>[], position?: 'start' | 'end'): PatchOp {
    return { op: 'upsert', entity, items, position };
  },
  remove<N extends EntityName>(entity: N, keys: readonly string[]): PatchOp {
    return { op: 'remove', entity, keys };
  },
};

function positionsOf(table: EntityTable<unknown>) {
  return new Map(table.ids.map((key, index) => [key, index]));
}

export function applyPatch(entities: Entities, ops: readonly PatchOp[]): { entities: Entities; inverse: PatchOp[] } {
  let next = entities;
  const inverse: PatchOp[] = [];
  const write = (entity: EntityName, table: EntityTable<unknown>) => {
    if (table === next[entity]) return;
    next = { ...next, [entity]: table };
  };
  for (const op of ops) {
    const table = next[op.entity] as EntityTable<unknown>;
    const keyOf = entityKey[op.entity] as (item: unknown) => string;
    const positions = positionsOf(table);
    if (op.op === 'upsert') {
      const previous: RestoreEntry<unknown>[] = [];
      const created: string[] = [];
      const seen = new Set<string>();
      for (const item of op.items) {
        const key = keyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        const index = positions.get(key);
        if (index === undefined) created.push(key);
        else previous.push({ key, item: table.byId.get(key), index });
      }
      write(op.entity, upsertMany(table, op.items, keyOf, op.position));
      inverse.unshift(
        ...(created.length ? [{ op: 'remove' as const, entity: op.entity, keys: created }] : []),
        ...(previous.length ? [{ op: 'restore' as const, entity: op.entity, entries: previous }] : []),
      );
    } else if (op.op === 'remove') {
      const removed: RestoreEntry<unknown>[] = [];
      for (const key of op.keys) {
        const index = positions.get(key);
        if (index !== undefined) removed.push({ key, item: table.byId.get(key), index });
      }
      write(op.entity, removeMany(table, op.keys));
      if (removed.length) inverse.unshift({ op: 'restore', entity: op.entity, entries: removed });
    } else {
      const previous: RestoreEntry<unknown>[] = [];
      const created: string[] = [];
      for (const entry of op.entries) {
        const index = positions.get(entry.key);
        if (index === undefined) created.push(entry.key);
        else previous.push({ key: entry.key, item: table.byId.get(entry.key), index });
      }
      write(op.entity, restoreMany(table, op.entries));
      inverse.unshift(
        ...(created.length ? [{ op: 'remove' as const, entity: op.entity, keys: created }] : []),
        ...(previous.length ? [{ op: 'restore' as const, entity: op.entity, entries: previous }] : []),
      );
    }
  }
  return { entities: next, inverse };
}
