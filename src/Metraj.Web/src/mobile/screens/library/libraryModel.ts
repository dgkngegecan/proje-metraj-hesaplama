import { TYPE_META } from '../../../lib/cardTypes.ts';
import { catalogCardSearchText, describeCatalogDeck } from '../../../lib/catalogDecks.ts';
import type { CardType, CatalogCard, CatalogCardType } from '../../../types';

/*
 * Kütüphane listesinin saf modeli: kart → liste öğesi, süzgeçler, sayaçlar.
 * React'siz yazıldı ki `node:test` ile sınanabilsin (tests/mobile-library-model.test.mjs).
 *
 * Masaüstündeki CardShelf kartları "deste"lere ayırıp destede açıyordu. Telefonda
 * deste açıp kapatmak yerine düz, sanallaştırılmış bir liste ve süzgeçler var: aynı
 * deste/alan bilgisi her satırın ikinci satırında ve "Alan" süzgecindedir. Arama metni
 * masaüstüyle AYNI işlevden (`catalogCardSearchText`) gelir, yani her iki arayüzde aynı
 * sözcük aynı kartı bulur.
 */

export interface LibraryItem {
  card: CatalogCard;
  /** Tesisat alanı (desteleri gruplayan üst düzey): "Temiz ve sıcak su". */
  domainKey: string;
  domainName: string;
  /** Destenin adı: "PP-R / PPRC". */
  deckName: string;
  deckOrder: number;
  /** Aranabilir metin (masaüstüyle aynı alanlar, sadeleştirilmiş). */
  searchText: string;
}

export type StatusFilter = 'active' | 'inactive' | 'all';
/** `all` | temel tür | `custom:<tür kimliği>` */
export type TypeFilter = 'all' | CardType | `custom:${string}`;

export interface LibraryFilters {
  type: TypeFilter;
  status: StatusFilter;
  /** Boş = bütün alanlar. */
  domain: string;
}

export const DEFAULT_FILTERS: LibraryFilters = { type: 'all', status: 'active', domain: '' };

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });

/** Kütüphaneden gizlenen "yerine yenisi geçmiş" kart: yalnız sunucunun açıkça bildirdiği. */
export const isSuperseded = (card: CatalogCard) => Boolean(card.supersededByCode?.trim());

const itemCache = new WeakMap<CatalogCard, LibraryItem>();

/** Kartlardan liste öğeleri üretir; kart nesnesi değişmedikçe öğe aynı kalır (arama önbelleği için). */
export function buildLibraryItems(cards: readonly CatalogCard[]): LibraryItem[] {
  const items = cards.map((card) => {
    let item = itemCache.get(card);
    if (!item) {
      const deck = describeCatalogDeck(card);
      item = {
        card,
        domainKey: deck.domainKey,
        domainName: deck.domainName,
        deckName: deck.name,
        deckOrder: deck.order,
        searchText: catalogCardSearchText(card, { ...deck, cards: [] }),
      };
      itemCache.set(card, item);
    }
    return item;
  });
  return items.sort(
    (a, b) =>
      a.deckOrder - b.deckOrder ||
      collator.compare(a.domainName, b.domainName) ||
      collator.compare(a.deckName, b.deckName) ||
      collator.compare(a.card.name, b.card.name) ||
      collator.compare(a.card.code, b.card.code) ||
      a.card.id.localeCompare(b.card.id),
  );
}

export function matchesStatus(card: CatalogCard, status: StatusFilter): boolean {
  if (status === 'all') return true;
  // "Aktif" = seçilebilir: pasif ve yerine yenisi geçmiş kartlar hariç (masaüstü `selectableDeckCards`).
  if (status === 'active') return card.isActive && !isSuperseded(card);
  return !card.isActive;
}

export function matchesType(card: CatalogCard, type: TypeFilter): boolean {
  if (type === 'all') return true;
  if (type.startsWith('custom:')) return card.customTypeId === type.slice('custom:'.length);
  return card.cardType === type;
}

export function filterItems(items: readonly LibraryItem[], filters: LibraryFilters): LibraryItem[] {
  return items.filter(
    (item) =>
      matchesStatus(item.card, filters.status) &&
      matchesType(item.card, filters.type) &&
      (!filters.domain || item.domainKey === filters.domain),
  );
}

/** Varsayılandan farklı süzgeç sayısı (süzgeç düğmesindeki rozet). Tür çipleri ayrı görünür, sayılmaz. */
export function countActiveFilters(filters: LibraryFilters): number {
  return (filters.status !== DEFAULT_FILTERS.status ? 1 : 0) + (filters.domain ? 1 : 0);
}

export interface FacetOption<V extends string = string> {
  value: V;
  label: string;
  count: number;
}

/**
 * Tür çipleri ve sayıları. Sayılar diğer süzgeçlere (durum, alan) göre hesaplanır:
 * "Malzeme (12)" çipi, görünen listeye dokunulursa kaç kart geleceğini söyler.
 * Özel türler yalnız en az bir kartı olanlar ve etkin türlerdir.
 */
export function typeFacets(
  items: readonly LibraryItem[],
  filters: LibraryFilters,
  catalogTypes: readonly CatalogCardType[],
): FacetOption<TypeFilter>[] {
  const base = items.filter(
    (item) => matchesStatus(item.card, filters.status) && (!filters.domain || item.domainKey === filters.domain),
  );
  const options: FacetOption<TypeFilter>[] = [{ value: 'all', label: 'Tümü', count: base.length }];
  for (const type of Object.keys(TYPE_META) as CardType[]) {
    const count = base.filter((item) => item.card.cardType === type).length;
    if (count || filters.type === type) options.push({ value: type, label: TYPE_META[type].label, count });
  }
  const customs = new Map<string, string>();
  for (const type of catalogTypes) if (type.isActive) customs.set(type.id, type.name);
  for (const item of base) {
    const id = item.card.customTypeId;
    if (id && !customs.has(id)) customs.set(id, item.card.customTypeName ?? item.card.customTypeCode ?? 'Özel tür');
  }
  for (const [id, name] of [...customs].sort((a, b) => collator.compare(a[1], b[1]))) {
    const value = `custom:${id}` as const;
    const count = base.filter((item) => item.card.customTypeId === id).length;
    if (count || filters.type === value) options.push({ value, label: name, count });
  }
  return options;
}

/** Tesisat alanı seçenekleri (durum ve tür süzgecine göre sayılı). */
export function domainFacets(items: readonly LibraryItem[], filters: LibraryFilters): FacetOption[] {
  const base = items.filter((item) => matchesStatus(item.card, filters.status) && matchesType(item.card, filters.type));
  const domains = new Map<string, { label: string; order: number; count: number }>();
  for (const item of base) {
    const current = domains.get(item.domainKey);
    if (current) current.count += 1;
    else domains.set(item.domainKey, { label: item.domainName, order: item.deckOrder, count: 1 });
  }
  return [...domains]
    .sort((a, b) => a[1].order - b[1].order || collator.compare(a[1].label, b[1].label))
    .map(([value, entry]) => ({ value, label: entry.label, count: entry.count }));
}

export function statusFacets(items: readonly LibraryItem[]): FacetOption<StatusFilter>[] {
  return [
    { value: 'active', label: 'Aktif', count: items.filter((i) => matchesStatus(i.card, 'active')).length },
    { value: 'inactive', label: 'Pasif', count: items.filter((i) => matchesStatus(i.card, 'inactive')).length },
    { value: 'all', label: 'Tümü', count: items.length },
  ];
}

/** Kart satırının ikinci satırı: "Malzeme · STD-PPRC-… · m · PP-R / PPRC". */
export function cardSubtitle(item: LibraryItem): string {
  const { card } = item;
  const parts: string[] = [TYPE_META[card.cardType].label];
  if (card.customTypeName) parts[0] = `${parts[0]} · ${card.customTypeName}`;
  parts.push(card.code);
  // Klasör türü kartların birimi "-"dir; anlamsız bir işaret göstermeyelim.
  if (card.unit.trim() && card.unit.trim() !== '-') parts.push(card.unit);
  if (card.variantMode === 'Pipe') parts.push(`${card.variants?.length ?? 0} çap`);
  else if (card.variantMode === 'Fitting') parts.push(`${card.variants?.length ?? 0} çeşit`);
  if (item.deckName && item.deckName !== TYPE_META[card.cardType].label) parts.push(item.deckName);
  if (!card.isActive) parts.push('pasif');
  return parts.join(' · ');
}

/** Boş sonuç mesajında hangi süzgeçlerin etkin olduğunu anlatır. */
export function describeFilters(
  filters: LibraryFilters,
  typeLabel: string | null,
  domainLabel: string | null,
  query: string,
): string {
  const parts: string[] = [];
  if (query.trim()) parts.push(`“${query.trim()}” araması`);
  if (filters.type !== 'all' && typeLabel) parts.push(`${typeLabel} türü`);
  if (filters.domain && domainLabel) parts.push(`${domainLabel} alanı`);
  if (filters.status !== 'all')
    parts.push(filters.status === 'active' ? 'yalnız aktif kartlar' : 'yalnız pasif kartlar');
  return parts.join(' · ');
}
