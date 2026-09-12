import type { CatalogCard } from '../types';
import { TYPE_META } from './uiTypes';

export const normalizeCatalogText = (value: string) =>
  value.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const keyOf = (value: string) => normalizeCatalogText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });

// Optional until the DTO includes family metadata. Names never classify or hide cards.
export interface CatalogDeckMetadata {
  familyKey?: string | null;
  familyCode?: string | null;
  familyName?: string | null;
  domainCode?: string | null;
  domainName?: string | null;
  family?: { key?: string; code?: string; name?: string; domainCode?: string; domainName?: string } | string | null;
}

export interface CatalogDeck {
  id: string;
  familyKey: string;
  name: string;
  domainKey: string;
  domainName: string;
  color: string;
  order: number;
  cards: CatalogCard[];
}

const domains: Record<string, { name: string; color: string; order: number }> = {
  STRUCTURE: { name: 'Proje yapısı', color: '#b58cff', order: 0 },
  SU: { name: 'Temiz ve sıcak su', color: '#50caff', order: 1 },
  ATIK: { name: 'Atık su ve drenaj', color: '#65d9cc', order: 2 },
  VITR: { name: 'Vitrifiye ve armatür', color: '#81c8fa', order: 3 },
  VANA: { name: 'Vanalar', color: '#ffbd79', order: 4 },
  ISI: { name: 'Isıtma', color: '#ffae78', order: 5 },
  SOG: { name: 'Soğutma', color: '#7dbbff', order: 6 },
  HAV: { name: 'Havalandırma', color: '#9bafff', order: 7 },
  YAN: { name: 'Yangın tesisatı', color: '#ff869f', order: 8 },
  GAZ: { name: 'Gaz tesisatı', color: '#ebce73', order: 9 },
  ASK: { name: 'Askı ve destek', color: '#c4b6fa', order: 10 },
  IZO: { name: 'Yalıtım', color: '#9bd596', order: 11 },
  POM: { name: 'Pompa ve basınçlandırma', color: '#78cfd5', order: 12 },
  OLC: { name: 'Ölçüm ve kontrol', color: '#d5a0f3', order: 13 },
  SARF: { name: 'Sarf ve yardımcılar', color: '#c6baab', order: 14 },
  OTHER: { name: 'Diğer kartlar', color: '#aabbd3', order: 20 },
};

const materials = [
  { key: 'pprc', name: 'PP-R / PPRC', domain: 'SU', aliases: ['PP-R', 'PPR', 'PPRC'], codes: ['PPRC', 'PPR'] },
  { key: 'pex-al-pex', name: 'PEX-AL-PEX', domain: 'SU', aliases: ['PEX-AL-PEX', 'PEXALPEX'], codes: ['PEXALPEX'] },
  { key: 'pex', name: 'PEX', domain: 'SU', aliases: ['PEX'], codes: ['PEX'] },
  { key: 'galvanized-steel', name: 'Galvaniz çelik', domain: 'SU', aliases: ['Galvanized Steel', 'Galvaniz', 'Galvaniz Çelik', 'Galvanizli Çelik'], codes: ['GALV', 'GALVANIZ'] },
  { key: 'carbon-steel', name: 'Siyah çelik', domain: 'ISI', aliases: ['Carbon Steel', 'Steel', 'Siyah Çelik', 'Çelik'], codes: ['STEEL', 'SIYAH'] },
  { key: 'stainless-steel', name: 'Paslanmaz çelik', domain: 'SU', aliases: ['Stainless Steel', 'Paslanmaz Çelik'], codes: ['PASLANMAZ'] },
  { key: 'copper', name: 'Bakır', domain: 'SU', aliases: ['Copper', 'Bakır'], codes: ['CU', 'BAKIR'] },
  { key: 'pvc-u', name: 'PVC-U', domain: 'ATIK', aliases: ['PVC-U', 'PVCU', 'PVC'], codes: ['PVCU', 'PVC'] },
  { key: 'htpp', name: 'Sessiz PP / HTPP', domain: 'ATIK', aliases: ['HTPP', 'HT-PP', 'Silent PP'], codes: ['HTPP'] },
  { key: 'hdpe', name: 'HDPE', domain: 'ATIK', aliases: ['HDPE', 'PE100', 'PE 100'], codes: ['HDPE', 'PE100'] },
];

const materialDomains: Record<string, string> = {
  'heating-equipment': 'ISI', radiator: 'ISI', 'hvac-equipment': 'HAV',
  'plumbing-equipment': 'SU', 'fire-equipment': 'YAN', 'fire-fitting': 'YAN',
  pump: 'POM', valve: 'VANA', support: 'ASK', insulation: 'IZO',
};

function metadataFor(card: CatalogCard) {
  const metadata = card as CatalogCard & CatalogDeckMetadata;
  const family = typeof metadata.family === 'object' ? metadata.family : null;
  const attributes = new Map(Object.entries(card.attributeValues ?? {}).map(([key, value]) => [keyOf(key), value]));
  return {
    key: metadata.familyKey || metadata.familyCode || family?.key || family?.code ||
      attributes.get('familykey') || attributes.get('familycode') ||
      (typeof metadata.family === 'string' ? metadata.family : ''),
    name: metadata.familyName || family?.name || attributes.get('familyname'),
    domainCode: metadata.domainCode || family?.domainCode || attributes.get('domaincode'),
    domainName: metadata.domainName || family?.domainName || attributes.get('domainname'),
  };
}

export function describeCatalogDeck(card: CatalogCard): Omit<CatalogDeck, 'cards'> {
  const metadata = metadataFor(card);
  const tokens = card.code.toUpperCase().split('-');
  const standard = tokens[0] === 'STD' || tokens[0] === 'STDX' || tokens[0] === 'SYN';
  const material = keyOf((card.materialType ?? '').replace(/\s+(fittings?|pipe|boru|ek parça)$/i, ''));
  const knownMaterial = materials.find((entry) => entry.aliases.some((alias) => keyOf(alias) === material)) ??
    (standard ? materials.find((entry) => entry.codes.some((token) => tokens.includes(token))) : undefined);
  const structure = card.cardType === 'Category' || card.cardType === 'Scope' || card.cardType === 'System';
  let domainKey = metadata.domainCode?.toUpperCase() ||
    (tokens[0] === 'STDX' && tokens[1] && domains[tokens[1]] ? tokens[1] : '') ||
    (structure ? 'STRUCTURE' : '') || knownMaterial?.domain || materialDomains[material] ||
    (tokens[0] === 'SYN' && tokens[1] === 'CW' ? 'SU' : 'OTHER');
  if (metadata.domainName && !metadata.domainCode) domainKey = keyOf(metadata.domainName);
  const domain = domains[domainKey];
  const familyKey = metadata.key || (structure ? card.cardType : knownMaterial?.key) ||
    (domainKey !== 'OTHER' ? domainKey : card.customTypeCode || card.materialType || card.cardType);
  const name = metadata.name || (metadata.key ? metadata.key : '') ||
    (structure ? TYPE_META[card.cardType].label : knownMaterial?.name) ||
    (domainKey !== 'OTHER' ? domain?.name : card.customTypeName || card.materialType || TYPE_META[card.cardType].label) ||
    metadata.domainName || familyKey;
  return {
    id: `${keyOf(domainKey)}:${keyOf(familyKey) || familyKey}`,
    familyKey, name, domainKey,
    domainName: metadata.domainName || domain?.name || metadata.domainCode || 'Diğer kartlar',
    color: structure ? TYPE_META[card.cardType].color : domain?.color || '#aabbd3',
    order: domain?.order ?? 19,
  };
}

/** One active card, one deck. No suppression based on names, prefixes or variants. */
export function buildCatalogDecks(cards: CatalogCard[]): CatalogDeck[] {
  const decks = new Map<string, CatalogDeck>();
  // Sort first so labels and contents are independent of API order.
  for (const card of cards.filter((item) => item.isActive).sort((a, b) =>
    collator.compare(a.name, b.name) || collator.compare(a.code, b.code) || a.id.localeCompare(b.id))) {
    const descriptor = describeCatalogDeck(card);
    const deck = decks.get(descriptor.id);
    if (deck) deck.cards.push(card);
    else decks.set(descriptor.id, { ...descriptor, cards: [card] });
  }
  return [...decks.values()].sort((a, b) =>
    a.order - b.order || collator.compare(a.domainName, b.domainName) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

export function catalogCardSearchText(card: CatalogCard, deck: CatalogDeck): string {
  return normalizeCatalogText([
    card.name, card.code, card.unit, card.materialType, card.notes, card.positionNumber,
    card.customTypeCode, card.customTypeName, TYPE_META[card.cardType].label,
    card.inputBehavior, card.salesConversion, card.reportBehavior, card.variantMode,
    card.wasteRatePct, card.containerParameter, deck.name, deck.familyKey, deck.domainName,
    ...(card.compatibleDiameters ?? []), ...(card.attributeKeys ?? []),
    ...Object.entries(card.attributeValues ?? {}).flat(),
    ...(card.variants ?? []).flatMap((variant) => [variant.code, variant.label, variant.standardLength, ...(variant.compatibleDiameters ?? [])]),
  ].filter((value) => value !== null && value !== undefined).join(' '));
}
