import type { Placement } from '../../../types';
import { foldSearchText } from '../../components/search.ts';

/**
 * Proje ağacının klasör gezgini modeli (saf, React'siz).
 *
 * Masaüstünde ağaç bir React Flow tuvaliydi; telefonda aynı veri iki biçimde
 * gezilir: klasör gibi seviye seviye (her seviyede yalnız doğrudan çocuklar) ve
 * salt-okunur girintili tam ağaç. İkisi de burada kurulur. Sunucu aynı
 * ebeveynin çocuklarını ada göre sıralı verir, ama iyimser eklenen bir kart
 * listenin sonuna düşerdi; kardeşler bu yüzden burada, sunucuya yakın bir
 * kuralla (görünen ad, doğal sayı sırası, kimlik) yeniden sıralanır ki ekleme,
 * yeniden adlandırma ve taşıma sonrası liste yer değiştirmesin.
 */

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });

export const compareSiblings = (a: Placement, b: Placement) =>
  collator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id);

export interface ChildIndex {
  readonly byId: ReadonlyMap<string, Placement>;
  /** `null` anahtarı kökleri verir. Ebeveyni listede olmayan kart kök sayılır (kaybolmasın). */
  readonly childrenOf: ReadonlyMap<string | null, readonly Placement[]>;
}

const indexCache = new WeakMap<readonly Placement[], ChildIndex>();

/** Liste referansına göre önbelleklenir: yalnız ağaç gerçekten değişince yeniden kurulur. */
export function buildChildIndex(placements: readonly Placement[]): ChildIndex {
  const cached = indexCache.get(placements);
  if (cached) return cached;
  const byId = new Map(placements.map((item) => [item.id, item]));
  const groups = new Map<string | null, Placement[]>();
  for (const placement of placements) {
    const parent =
      placement.parentPlacementId && byId.has(placement.parentPlacementId) ? placement.parentPlacementId : null;
    const bucket = groups.get(parent);
    if (bucket) bucket.push(placement);
    else groups.set(parent, [placement]);
  }
  for (const bucket of groups.values()) {
    bucket.sort(compareSiblings);
    Object.freeze(bucket);
  }
  const index: ChildIndex = { byId, childrenOf: groups };
  indexCache.set(placements, index);
  return index;
}

export interface LevelRow {
  placement: Placement;
  /** Doğrudan çocuk sayısı. */
  childCount: number;
}

const NO_CHILDREN: readonly Placement[] = Object.freeze([]);

export function childrenOf(index: ChildIndex, parentId: string | null): readonly Placement[] {
  return index.childrenOf.get(parentId) ?? NO_CHILDREN;
}

/** Bir seviyenin satırları. Döngüsel veride bile yalnız doğrudan çocuklar döner. */
export function levelRows(index: ChildIndex, parentId: string | null): LevelRow[] {
  return childrenOf(index, parentId).map((placement) => ({
    placement,
    childCount: childrenOf(index, placement.id).length,
  }));
}

const MAX_DEPTH = 64;

/** Kökten ebeveyne kadar atalar (kendisi hariç). Döngüde kırpılır. */
export function ancestorsOf(index: ChildIndex, id: string | null): Placement[] {
  const chain: Placement[] = [];
  const seen = new Set<string>();
  let cursor = id ? index.byId.get(id) : undefined;
  while (cursor && !seen.has(cursor.id) && chain.length < MAX_DEPTH) {
    seen.add(cursor.id);
    const parentId = cursor.parentPlacementId;
    cursor = parentId ? index.byId.get(parentId) : undefined;
    if (cursor) chain.unshift(cursor);
  }
  return chain;
}

export interface Crumb {
  /** `null` = proje kökü. */
  id: string | null;
  label: string;
}

/** Yol göstergesi: kök + atalar + (verilmişse) bu seviyenin kendisi. */
export function breadcrumb(index: ChildIndex, levelId: string | null, rootLabel = 'Proje'): Crumb[] {
  const crumbs: Crumb[] = [{ id: null, label: rootLabel }];
  if (!levelId) return crumbs;
  for (const ancestor of ancestorsOf(index, levelId)) crumbs.push({ id: ancestor.id, label: ancestor.displayName });
  const self = index.byId.get(levelId);
  if (self) crumbs.push({ id: self.id, label: self.displayName });
  return crumbs;
}

/** Kök → hedef kimlik zinciri (hedef dahil). Yol göstergesinden bir seviyeye atlamak için. */
export function levelPath(index: ChildIndex, levelId: string | null): string[] {
  if (!levelId) return [];
  return [...ancestorsOf(index, levelId).map((item) => item.id), levelId];
}

/**
 * Seviye geçişinin planı. Yığındaki seviyeler hedef yolla aynı başlıyorsa
 * yalnız fazlası geri alınır (kaydırma konumları korunur); ayrışıyorsa ortak
 * kısımdan sonrası geri alınıp hedefe kalan seviyeler eklenir.
 * `stackIds`: yığının dipten başlayan elemanlarının seviye kimlikleri; seviye
 * olmayan bir rota (kart girişi) `null` ile gösterilir ve zinciri keser.
 */
export function planLevelNavigation(
  stackIds: readonly (string | null)[],
  target: readonly string[],
): { pops: number; pushes: string[] } {
  let common = 0;
  while (common < stackIds.length && common < target.length && stackIds[common] === target[common]) common += 1;
  return { pops: stackIds.length - common, pushes: target.slice(common) };
}

export interface TreeRow {
  placement: Placement;
  depth: number;
  /** Doğrudan çocuk sayısı. */
  childCount: number;
  /** Kökten bu satıra kimlik zinciri (kendisi dahil). */
  path: readonly string[];
}

const flatCache = new WeakMap<readonly Placement[], readonly TreeRow[]>();

/**
 * Derinlik öncelikli düzleştirilmiş tam ağaç (kardeşler `compareSiblings`
 * sırasıyla). Döngüdeki kartlar (A→B→A) hiçbir kökten erişilemez; kaybolmasınlar
 * diye kök sayılarak sona eklenir (store/selectors.ts buildPlacementTree ile aynı koruma).
 */
export function flattenTree(placements: readonly Placement[]): readonly TreeRow[] {
  const cached = flatCache.get(placements);
  if (cached) return cached;
  const index = buildChildIndex(placements);
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const visit = (placement: Placement, depth: number, path: readonly string[]): boolean => {
    if (visited.has(placement.id)) return false;
    visited.add(placement.id);
    const ownPath = [...path, placement.id];
    const row: TreeRow = { placement, depth, childCount: 0, path: ownPath };
    rows.push(row);
    for (const child of childrenOf(index, placement.id)) if (visit(child, depth + 1, ownPath)) row.childCount += 1;
    return true;
  };
  for (const root of childrenOf(index, null)) visit(root, 0, []);
  for (const placement of [...placements].sort(compareSiblings)) visit(placement, 0, []);
  const frozen = Object.freeze(rows);
  flatCache.set(placements, frozen);
  return frozen;
}

/** Kartın kendisi ve altındaki her şey. */
export function descendantIds(index: ChildIndex, rootId: string): Set<string> {
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const child of childrenOf(index, id)) stack.push(child.id);
  }
  return result;
}

/** Taşıma hedefi seçici satırı: ağaçtaki yeri ve geçerli ebeveyn olup olmadığı. */
export interface MoveTarget {
  placement: Placement;
  depth: number;
  isCurrentParent: boolean;
}

/**
 * Taşınan kartın ve altındakilerin kendi altına taşınması engellenir (döngü).
 * Asıl kural sunucudadır (tip uyumu, izin verilen ebeveyn); burada yalnız
 * anlamsız seçenekler gizlenir, geri kalanı sunucu reddederse mesajı gösterilir.
 */
export function moveTargets(placements: readonly Placement[], movingId: string): MoveTarget[] {
  const moving = placements.find((item) => item.id === movingId);
  const currentParent = moving?.parentPlacementId ?? null;
  return flattenTree(placements)
    .filter((row) => !row.path.includes(movingId))
    .map((row) => ({
      placement: row.placement,
      depth: row.depth,
      isCurrentParent: row.placement.id === currentParent,
    }));
}

export interface SearchEntry {
  placement: Placement;
  /** "Sistem › Boru hattı" gibi üst yol; kökteyse boş. */
  path: string;
  depth: number;
  childCount: number;
  folded: string;
}

const searchCache = new WeakMap<readonly Placement[], readonly SearchEntry[]>();

/** Bütün ağacı arama için düzleştirir; metin bir kez sadeleştirilir. */
export function searchEntries(placements: readonly Placement[]): readonly SearchEntry[] {
  const cached = searchCache.get(placements);
  if (cached) return cached;
  const names = new Map(placements.map((item) => [item.id, item.displayName]));
  const entries = flattenTree(placements).map((row) => {
    const path = row.path
      .slice(0, -1)
      .map((id) => names.get(id) ?? '')
      .filter(Boolean)
      .join(' › ');
    const { placement } = row;
    return {
      placement,
      path,
      depth: row.depth,
      childCount: row.childCount,
      folded: foldSearchText(`${placement.displayName} ${placement.cardName} ${placement.cardCode} ${path}`),
    };
  });
  const frozen = Object.freeze(entries);
  searchCache.set(placements, frozen);
  return frozen;
}

/** Bir kartın "giriş sayfası" mı yoksa "alt seviye" mi açacağı. */
export function tapTarget(row: { placement: Placement; childCount: number }): 'entry' | 'level' {
  return row.placement.isMeasurable ? 'entry' : 'level';
}

/** Metraj girilebilir mi? Hesaplanan (Derived) kalemlerde giriş yoktur. */
export const isEnterable = (placement: Placement) => placement.isMeasurable && placement.inputBehavior !== 'Derived';

/**
 * Kartın altına eklenen kartlar için "en yakın boru". Masaüstü kart rafıyla
 * aynı kural: seçili kartın kendisi veya en yakın atası boru ise (ya da boru
 * sistemi olan bir malzemeyse) uyumlu fittingler ondan sorgulanır.
 */
export function nearestPipe(placements: readonly Placement[], startId: string | null): Placement | undefined {
  if (!startId) return undefined;
  const byId = new Map(placements.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let current = byId.get(startId);
  while (current && !visited.has(current.id)) {
    if (current.variantMode === 'Pipe' || (current.pipeSystem && current.cardType === 'Material')) return current;
    visited.add(current.id);
    current = current.parentPlacementId ? byId.get(current.parentPlacementId) : undefined;
  }
  return undefined;
}
