import type { CardType, CatalogCard } from '../../../types';
import { TYPE_META } from '../../../lib/cardTypes.ts';
import {
  catalogCardSearchText,
  describeCatalogDeck,
  normalizeCatalogText,
  selectableDeckCards,
} from '../../../lib/catalogDecks.ts';

/**
 * Kart ekleme panelinin arama ve sıralama mantığı (saf).
 *
 * Arama metni ve eşleşme kuralı masaüstü kart rafıyla AYNIDIR
 * (`catalogCardSearchText` + `normalizeCatalogText`, her sözcük metinde geçmeli),
 * yani "celik", "ÇELİK" ve "çelik" aynı kartları bulur ve masaüstünde bulunan
 * kart telefonda da bulunur. Metin kart başına bir kez, ilk aramada üretilir.
 */

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });

export const CARD_TYPE_ORDER: readonly CardType[] = ['Material', 'Accessory', 'System', 'Scope', 'Category'];

export const cardTypeLabel = (type: CardType) => TYPE_META[type].label;

export interface IndexedCard {
  card: CatalogCard;
  /** Kartın bulunduğu deste (tesisat alanı), satırda ikinci satır olarak gösterilir. */
  deckName: string;
  text: string;
}

const textCache = new WeakMap<CatalogCard, string>();
const deckCache = new WeakMap<CatalogCard, string>();

function deckNameOf(card: CatalogCard) {
  let name = deckCache.get(card);
  if (name === undefined) {
    name = describeCatalogDeck(card).name;
    deckCache.set(card, name);
  }
  return name;
}

function textOf(card: CatalogCard) {
  let text = textCache.get(card);
  if (text === undefined) {
    const deck = { ...describeCatalogDeck(card), cards: [] };
    text = catalogCardSearchText(card, deck);
    textCache.set(card, text);
  }
  return text;
}

/** Seçilebilir (etkin, yerine geçilmemiş) kartlar, ada göre sıralı. */
export function selectableCards(cards: readonly CatalogCard[]): CatalogCard[] {
  return selectableDeckCards([...cards]).sort(
    (a, b) => collator.compare(a.name, b.name) || collator.compare(a.code, b.code) || a.id.localeCompare(b.id),
  );
}

export function searchWords(query: string): string[] {
  return normalizeCatalogText(query.trim()).split(/\s+/).filter(Boolean);
}

export interface CardFilter {
  query: string;
  type: CardType | '';
}

export function filterCards(cards: readonly CatalogCard[], filter: CardFilter): CatalogCard[] {
  const words = searchWords(filter.query);
  if (!words.length && !filter.type) return [...cards];
  return cards.filter((card) => {
    if (filter.type && card.cardType !== filter.type) return false;
    if (!words.length) return true;
    const text = textOf(card);
    return words.every((word) => text.includes(word));
  });
}

/** Sonuç satırı için deste adı. */
export function indexCard(card: CatalogCard): IndexedCard {
  return { card, deckName: deckNameOf(card), text: textOf(card) };
}

export const MAX_RECENT_CARDS = 12;

/** Son kullanılan kart kodu başa alınır, yinelenenler atılır, liste kırpılır. */
export function pushRecent(recent: readonly string[], code: string, max = MAX_RECENT_CARDS): string[] {
  return [code, ...recent.filter((item) => item !== code)].slice(0, max);
}

export function parseRecentCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, MAX_RECENT_CARDS);
}

/** Son kullanılanlar (verilen sırayla); artık katalogda olmayan kod sessizce atlanır. */
export function recentCards(cards: readonly CatalogCard[], recentCodes: readonly string[]): CatalogCard[] {
  const byCode = new Map(cards.map((card) => [card.code, card]));
  return recentCodes.flatMap((code) => {
    const card = byCode.get(code);
    return card ? [card] : [];
  });
}

export type CardListItem =
  | { kind: 'heading'; key: string; label: string; count?: number }
  | { kind: 'card'; key: string; card: CatalogCard; recent?: boolean };

export interface CardListInput {
  cards: readonly CatalogCard[];
  filter: CardFilter;
  recentCodes: readonly string[];
  /** Borunun uyumlu fittingleri; verilirse yalnız bunlar (ve "tümü" ayrı kipte) gösterilir. */
  compatible?: readonly CatalogCard[] | null;
  /** true: uyumlu liste yerine bütün kartlar. */
  showAll: boolean;
}

/**
 * Panelin listesi. Arama/süzgeç yokken: (uyumlu parçalar) · son kullanılanlar ·
 * tüm kartlar. Arama veya tip süzgeci varken tek düz sonuç listesi (başlık yok),
 * son kullanılanlar yine önde. Uyumluluk kipinde yalnız uyumlu kartlar içinde aranır.
 */
export function buildCardList(input: CardListInput): CardListItem[] {
  const { cards, filter, recentCodes, compatible, showAll } = input;
  const pool = compatible && !showAll ? selectableCards(compatible) : cards;
  const filtered = filterCards(pool, filter);
  const filtering = Boolean(filter.type) || searchWords(filter.query).length > 0;
  const recents = recentCards(filtered, recentCodes);
  const recentIds = new Set(recents.map((card) => card.id));
  const rest = filtered.filter((card) => !recentIds.has(card.id));
  const items: CardListItem[] = [];
  const modeLabel = compatible && !showAll ? 'Bu boruya uyumlu parçalar' : 'Tüm kartlar';
  if (recents.length) {
    items.push({ kind: 'heading', key: 'h:recent', label: 'Son kullanılanlar' });
    for (const card of recents) items.push({ kind: 'card', key: `r:${card.id}`, card, recent: true });
  }
  if (rest.length) {
    if (!filtering || recents.length)
      items.push({ kind: 'heading', key: 'h:all', label: modeLabel, count: rest.length });
    for (const card of rest) items.push({ kind: 'card', key: `c:${card.id}`, card });
  }
  return items;
}

/** Kartın satırdaki ikinci satırı: birim, çeşit sayısı, malzeme. */
export function cardSubtitle(card: CatalogCard): string {
  const parts: string[] = [card.code, card.unit];
  if (card.variantMode === 'Pipe') parts.push(`${card.variants?.length ?? 0} ölçü`);
  else if (card.variantMode === 'Fitting') parts.push(`${card.variants?.length ?? 0} çeşit`);
  if (card.materialType) parts.push(card.materialType);
  return parts.join(' · ');
}
