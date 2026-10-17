// Kart ekleme panelinin arama/sıralama mantığı ve bağlam taslağı.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCardList,
  filterCards,
  parseRecentCodes,
  pushRecent,
  recentCards,
  searchWords,
  selectableCards,
} from '../src/mobile/screens/project/cardSearch.ts';
import {
  composeNotes,
  contextSummary,
  contextToFields,
  emptyContext,
  emptyRecents,
  hasContext,
  normalizeContext,
  normalizeRecents,
  pushRecentValue,
  withValue,
} from '../src/mobile/screens/project/context.ts';

let n = 0;
const card = (name, over = {}) => ({
  id: `c${++n}`,
  latestVersionId: `v${n}`,
  code: `KOD-${n}`,
  name,
  cardType: 'Material',
  unit: 'adet',
  inputBehavior: 'Manual',
  salesConversion: 'None',
  reportBehavior: 'Measurable',
  wasteRatePct: 0,
  latestVersion: 1,
  isActive: true,
  ...over,
});

function catalog() {
  n = 0;
  return [
    card('Çelik Boru', { materialType: 'Carbon Steel' }),
    card('PPR Dirsek 90°', { cardType: 'Accessory', materialType: 'PP-R' }),
    card('ISITMA SİSTEMİ', { cardType: 'System', reportBehavior: 'Folder' }),
    card('Pasif kart', { isActive: false }),
    card('Eski kart', { supersededByCode: 'KOD-1' }),
    card('Galvaniz Boru', { materialType: 'Galvanized Steel' }),
  ];
}

test('seçilebilir kartlar etkin ve yerine geçilmemiş olanlardır, ada göre sıralıdır', () => {
  const names = selectableCards(catalog()).map((item) => item.name);
  assert.deepEqual(names, ['Çelik Boru', 'Galvaniz Boru', 'ISITMA SİSTEMİ', 'PPR Dirsek 90°']);
});

test('arama Türkçe büyük/küçük harf ve aksan duyarsızdır; her sözcük bulunmalı', () => {
  const cards = selectableCards(catalog());
  const find = (query, type = '') => filterCards(cards, { query, type }).map((item) => item.name);
  // Deste adı da aranır (masaüstüyle aynı): "Galvaniz çelik" destesindeki kart "celik" ile de bulunur.
  assert.deepEqual(find('celik'), ['Çelik Boru', 'Galvaniz Boru']);
  assert.deepEqual(find('ÇELİK'), ['Çelik Boru', 'Galvaniz Boru']);
  assert.deepEqual(find('çelik boru'), ['Çelik Boru', 'Galvaniz Boru']);
  assert.deepEqual(find('galvaniz'), ['Galvaniz Boru']);
  assert.deepEqual(find('isitma sistemi'), ['ISITMA SİSTEMİ']);
  // Siyah çelik destesi "Isıtma" alanında olduğu için çelik boru da bulunur (masaüstüyle aynı).
  assert.ok(find('ısıtma').includes('ISITMA SİSTEMİ'));
  assert.deepEqual(find('ısıtma', 'System'), ['ISITMA SİSTEMİ']);
  assert.deepEqual(find('dirsek ppr'), ['PPR Dirsek 90°']);
  assert.deepEqual(find('boru'), ['Çelik Boru', 'Galvaniz Boru']);
  assert.deepEqual(find('', 'Accessory'), ['PPR Dirsek 90°']);
  assert.deepEqual(find('boru', 'Accessory'), []);
  assert.equal(find('').length, 4);
  assert.deepEqual(searchWords('  Çelik   BORU '), ['celik', 'boru']);
});

test('son kullanılanlar başa alınır, yinelenmez, sınırlıdır ve kataloğda olmayan kod atlanır', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(pushRecent(['a'], 'z', 3), ['z', 'a']);
  assert.equal(
    pushRecent(
      Array.from({ length: 20 }, (_, i) => `k${i}`),
      'yeni',
    ).length,
    12,
  );
  assert.deepEqual(parseRecentCodes(['a', 3, '', null, 'b']), ['a', 'b']);
  assert.deepEqual(parseRecentCodes('bozuk'), []);
  const cards = selectableCards(catalog());
  assert.deepEqual(
    recentCards(cards, ['KOD-6', 'YOK', 'KOD-1']).map((item) => item.code),
    ['KOD-6', 'KOD-1'],
  );
});

test('liste: filtre yokken son kullanılanlar önce, sonra tüm kartlar başlıklarıyla', () => {
  const cards = selectableCards(catalog());
  const items = buildCardList({ cards, filter: { query: '', type: '' }, recentCodes: ['KOD-6'], showAll: true });
  assert.deepEqual(
    items.map((item) => (item.kind === 'heading' ? `# ${item.label}` : item.card.name)),
    ['# Son kullanılanlar', 'Galvaniz Boru', '# Tüm kartlar', 'Çelik Boru', 'ISITMA SİSTEMİ', 'PPR Dirsek 90°'],
  );
  // Aynı kart iki kez listelenmez.
  assert.equal(items.filter((item) => item.kind === 'card' && item.card.code === 'KOD-6').length, 1);
});

test('liste: arama sürerken başlık yok, son kullanılan yine önde', () => {
  const cards = selectableCards(catalog());
  const items = buildCardList({ cards, filter: { query: 'boru', type: '' }, recentCodes: [], showAll: true });
  assert.deepEqual(
    items.map((item) => item.kind),
    ['card', 'card'],
  );
  const withRecent = buildCardList({
    cards,
    filter: { query: 'boru', type: '' },
    recentCodes: ['KOD-6'],
    showAll: true,
  });
  assert.equal(withRecent[1].card.name, 'Galvaniz Boru');
});

test('liste: boru altında yalnız uyumlu parçalar; "tümü" kipi bütün kartları açar', () => {
  const cards = selectableCards(catalog());
  const compatible = [cards.find((item) => item.name.startsWith('PPR'))];
  const only = buildCardList({ cards, filter: { query: '', type: '' }, recentCodes: [], compatible, showAll: false });
  assert.deepEqual(
    only.filter((i) => i.kind === 'card').map((i) => i.card.name),
    ['PPR Dirsek 90°'],
  );
  assert.equal(only[0].label, 'Bu boruya uyumlu parçalar');
  const all = buildCardList({ cards, filter: { query: '', type: '' }, recentCodes: [], compatible, showAll: true });
  assert.equal(all.filter((i) => i.kind === 'card').length, 4);
});

// ---------------------------------------------------------------- bağlam

test('bağlam: bozuk kayıt boş bağlama döner, değerler alan sınırına kırpılır', () => {
  assert.deepEqual(normalizeContext(null), emptyContext());
  assert.deepEqual(normalizeContext('x'), emptyContext());
  const context = normalizeContext({ block: '  A   ', floor: 3, room: 'x'.repeat(500), zone: 'Z1' });
  assert.equal(context.block, 'A');
  assert.equal(context.floor, '');
  assert.equal(context.room.length, 256);
  assert.equal(context.zone, 'Z1');
});

test('bağlam: masaüstü addMeasurementRows alanlarıyla aynı eşleme', () => {
  const context = { ...emptyContext(), block: 'A', floor: '2', room: 'Mutfak', sheet: 'M-03', note: 'Tavan arası' };
  // Masaüstü: block/floor/room/sheet draft'tan, zone ve drawingRevision null, notlar row.notes · draft.notes
  assert.deepEqual(contextToFields(context), {
    block: 'A',
    floor: '2',
    room: 'Mutfak',
    zone: null,
    sheet: 'M-03',
    drawingRevision: null,
  });
  assert.equal(composeNotes('Çap: DN25', context), 'Çap: DN25 · Tavan arası');
  assert.equal(composeNotes(null, context), 'Tavan arası');
  assert.equal(composeNotes('Çap: DN25', emptyContext()), 'Çap: DN25');
  assert.equal(composeNotes(null, emptyContext()), null);
});

test('bağlam: şaft ve hat no ayrı alan olmadığından nota yazılır', () => {
  const context = { ...emptyContext(), shaft: 'Ş3', line: 'H-12', note: 'dikkat' };
  assert.equal(composeNotes('Çap: DN25', context), 'Çap: DN25 · Şaft: Ş3 · Hat: H-12 · dikkat');
  assert.deepEqual(contextToFields(context), contextToFields(emptyContext()));
});

test('bağlam: özet, değişmeyen değerde aynı nesne, temizleme', () => {
  const base = withValue(withValue(emptyContext(), 'block', 'A'), 'floor', '2');
  assert.equal(contextSummary(base), 'Blok A · Kat 2');
  assert.equal(withValue(base, 'block', ' A '), base);
  assert.equal(hasContext(base), true);
  const cleared = withValue(base, 'block', '');
  assert.equal(cleared.block, '');
  assert.equal(hasContext(emptyContext()), false);
  assert.equal(contextSummary(emptyContext()), '');
});

test('bağlam: son değerler başa alınır, harf farkı tek sayılır, sekizle sınırlıdır', () => {
  let recents = emptyRecents();
  for (const value of ['1', '2', '3', 'a', 'b', 'c', 'd', 'e', 'f']) recents = pushRecentValue(recents, 'floor', value);
  assert.equal(recents.floor.length, 8);
  assert.equal(recents.floor[0], 'f');
  recents = pushRecentValue(recents, 'floor', 'A');
  assert.equal(recents.floor[0], 'A');
  assert.equal(recents.floor.filter((item) => item.toLowerCase() === 'a').length, 1);
  assert.equal(pushRecentValue(recents, 'floor', '   '), recents);
  const parsed = normalizeRecents({ floor: ['x', 'X', 3, 'y'], block: 'bozuk' });
  assert.deepEqual(parsed.floor, ['x', 'y']);
  assert.deepEqual(parsed.block, []);
});
