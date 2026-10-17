// Kütüphane listesinin saf modeli: Türkçe duyarlı arama, tür/durum/alan süzgeçleri, sayaçlar.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearchIndex } from '../src/mobile/components/search.ts';
import {
  buildLibraryItems,
  cardSubtitle,
  countActiveFilters,
  DEFAULT_FILTERS,
  domainFacets,
  filterItems,
  isSuperseded,
  statusFacets,
  typeFacets,
} from '../src/mobile/screens/library/libraryModel.ts';

let sequence = 0;
const card = (overrides = {}) => ({
  id: `c${++sequence}`,
  latestVersionId: `v${sequence}`,
  code: `X-${sequence}`,
  name: `Kart ${sequence}`,
  cardType: 'Material',
  unit: 'adet',
  inputBehavior: 'Manual',
  salesConversion: 'None',
  reportBehavior: 'Measurable',
  wasteRatePct: 0,
  latestVersion: 1,
  isActive: true,
  variantMode: 'None',
  variants: [],
  ...overrides,
});

const cards = [
  card({ name: 'PPRC Dirsek 90°', code: 'STD-PPRC-ELBOW', materialType: 'PPRC Fittings', unit: 'adet' }),
  card({
    name: 'Çelik Boru',
    code: 'STD-STEEL-PIPE',
    materialType: 'Carbon Steel',
    unit: 'm',
    variantMode: 'Pipe',
    variants: [{ code: 'DN25', label: 'DN25 / 1"', standardLength: 6 }],
  }),
  card({ name: 'Işık Seviye Sensörü', code: 'OLC-SENS', cardType: 'Accessory' }),
  card({ name: 'Temiz Su', code: 'STD-CAT-SU', cardType: 'Category', unit: '-' }),
  card({ name: 'Eski Vana', code: 'OLD-VANA', isActive: false, cardType: 'Accessory' }),
  card({ name: 'Yeni Sürümlü', code: 'SUP-1', supersededByCode: 'STD-NEW' }),
  card({ name: 'Özel Tür Kartı', code: 'CUS-1', customTypeId: 't1', customTypeName: 'Panel radyatör' }),
];

const items = buildLibraryItems(cards);
const names = (list) => list.map((item) => item.card.name);
const find = (query, list = items) => names(createSearchIndex((item) => item.searchText)(list, query));

test('arama Türkçe büyük/küçük harf ve aksan duyarsız', () => {
  assert.deepEqual(find('celik'), ['Çelik Boru']);
  assert.deepEqual(find('ÇELİK'), ['Çelik Boru']);
  assert.deepEqual(find('isik seviye'), ['Işık Seviye Sensörü']);
  assert.deepEqual(find('IŞIK'), ['Işık Seviye Sensörü']);
  assert.deepEqual(find('DİRSEK'), ['PPRC Dirsek 90°']);
});

test('arama sözcükleri herhangi bir sırada, kod ve malzeme ailesi dahil eşleşir', () => {
  assert.deepEqual(find('pprc dirsek'), ['PPRC Dirsek 90°']);
  assert.deepEqual(find('dirsek pprc'), ['PPRC Dirsek 90°']);
  assert.deepEqual(find('std-steel'), ['Çelik Boru']);
  assert.deepEqual(find('carbon'), ['Çelik Boru']);
  assert.deepEqual(find('dn25'), ['Çelik Boru'], 'varyant kodu da aranır');
  assert.deepEqual(find('yok böyle bir kart'), []);
  assert.equal(find('   ').length, items.length, 'boş sorgu hepsini getirir');
});

test('varsayılan süzgeç yalnız aktif ve yerine yenisi geçmemiş kartları gösterir', () => {
  const shown = names(filterItems(items, DEFAULT_FILTERS));
  assert.ok(!shown.includes('Eski Vana'));
  assert.ok(!shown.includes('Yeni Sürümlü'));
  assert.equal(isSuperseded(cards[5]), true);
  assert.equal(shown.length, 5);
});

test('durum süzgeci: pasif ve tümü', () => {
  assert.deepEqual(names(filterItems(items, { ...DEFAULT_FILTERS, status: 'inactive' })), ['Eski Vana']);
  assert.equal(filterItems(items, { ...DEFAULT_FILTERS, status: 'all' }).length, cards.length);
});

test('tür süzgeci temel türe ve özel türe göre', () => {
  assert.deepEqual(names(filterItems(items, { ...DEFAULT_FILTERS, type: 'Category' })), ['Temiz Su']);
  assert.deepEqual(names(filterItems(items, { ...DEFAULT_FILTERS, type: 'custom:t1' })), ['Özel Tür Kartı']);
  assert.deepEqual(names(filterItems(items, { ...DEFAULT_FILTERS, type: 'custom:yok' })), []);
});

test('tür çipleri diğer süzgeçlere göre sayılır ve özel türü içerir', () => {
  const options = typeFacets(items, DEFAULT_FILTERS, [
    {
      id: 't1',
      name: 'Panel radyatör',
      isActive: true,
      code: 'R',
      baseCardType: 'Material',
      allowedParentCardIds: [],
      allowedChildCardIds: [],
      attributeKeys: [],
    },
  ]);
  const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
  assert.equal(byValue.all.count, 5);
  assert.equal(byValue.Category.count, 1);
  assert.equal(byValue.Material.label, 'Malzeme');
  assert.equal(byValue['custom:t1'].label, 'Panel radyatör');
  assert.equal(byValue['custom:t1'].count, 1);
  // Pasif kartlar yalnız "Pasif" durumunda sayılır.
  const inactive = typeFacets(items, { ...DEFAULT_FILTERS, status: 'inactive' }, []);
  assert.equal(inactive[0].count, 1);
  assert.ok(inactive.some((o) => o.value === 'Accessory' && o.count === 1));
});

test('durum çipleri ve alan seçenekleri', () => {
  const status = statusFacets(items);
  assert.deepEqual(
    status.map((s) => [s.value, s.count]),
    [
      ['active', 5],
      ['inactive', 1],
      ['all', 7],
    ],
  );
  const domains = domainFacets(items, DEFAULT_FILTERS);
  assert.ok(domains.length >= 2);
  assert.equal(
    domains.reduce((sum, d) => sum + d.count, 0),
    5,
  );
  // Bir alan seçilince liste yalnız o alanın kartlarını içerir.
  const first = domains[0];
  const inDomain = filterItems(items, { ...DEFAULT_FILTERS, domain: first.value });
  assert.equal(inDomain.length, first.count);
});

test('etkin süzgeç sayısı yalnız varsayılandan sapmaları sayar', () => {
  assert.equal(countActiveFilters(DEFAULT_FILTERS), 0);
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, status: 'all', domain: 'SU' }), 2);
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, type: 'Material' }), 0);
});

test('liste öğeleri kart nesnesi değişmedikçe aynı kalır (arama önbelleği)', () => {
  const again = buildLibraryItems(cards);
  const byId = new Map(items.map((item) => [item.card.id, item]));
  for (const item of again) assert.equal(item, byId.get(item.card.id));
});

test('ikinci satır: tür, kod, birim, varyant sayısı, pasiflik', () => {
  const pipe = items.find((item) => item.card.name === 'Çelik Boru');
  assert.match(cardSubtitle(pipe), /Malzeme · STD-STEEL-PIPE · m · 1 çap/);
  const old = items.find((item) => item.card.name === 'Eski Vana');
  assert.match(cardSubtitle(old), /pasif$/);
});
