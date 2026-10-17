// Proje ağacının saf modeli: klasör gezgini seviyeleri, yol göstergesi, seviye geçiş planı,
// taşıma hedefleri, arama dizini ve toplam rozetleri.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ancestorsOf,
  breadcrumb,
  buildChildIndex,
  descendantIds,
  flattenTree,
  isEnterable,
  levelPath,
  levelRows,
  moveTargets,
  nearestPipe,
  planLevelNavigation,
  searchEntries,
  tapTarget,
} from '../src/mobile/screens/project/treeModel.ts';
import { totalsByPlacement, totalsOf } from '../src/mobile/screens/project/totals.ts';
import { foldSearchText } from '../src/mobile/components/search.ts';

let counter = 0;
const place = (name, parent = null, extra = {}) => ({
  id: `p${++counter}-${name}`,
  revisionId: 'r1',
  parentPlacementId: parent,
  cardVersionId: 'cv',
  cardCode: `KOD-${name.toUpperCase()}`,
  cardName: name,
  displayName: name,
  unit: 'm',
  inputBehavior: 'Manual',
  cardType: 'Material',
  isMeasurable: false,
  ...extra,
});

function sample() {
  counter = 0;
  const sistem = place('Sistem', null, { cardType: 'System' });
  const boru = place('Boru', sistem.id, { isMeasurable: true, variantMode: 'Pipe' });
  const dirsek = place('Dirsek', boru.id, { isMeasurable: true, cardType: 'Accessory', variantMode: 'Fitting' });
  const vana = place('Vana', sistem.id, { isMeasurable: true, cardType: 'Accessory' });
  const kategori = place('Kat 10', null, { cardType: 'Category' });
  const kat2 = place('Kat 2', null, { cardType: 'Category' });
  // Karışık sırada: sunucu sırası ağaç sırasını belirlemez.
  return { list: [dirsek, kat2, vana, boru, kategori, sistem], sistem, boru, dirsek, vana, kategori, kat2 };
}

test('kardeşler doğal sayı sırasıyla dizilir ve seviye yalnız doğrudan çocukları verir', () => {
  const { list, sistem, boru, vana } = sample();
  const index = buildChildIndex(list);
  assert.deepEqual(
    levelRows(index, null).map((row) => row.placement.displayName),
    ['Kat 2', 'Kat 10', 'Sistem'],
  );
  assert.deepEqual(
    levelRows(index, sistem.id).map((row) => row.placement.id),
    [boru.id, vana.id],
  );
  assert.equal(levelRows(index, sistem.id)[0].childCount, 1);
  assert.equal(levelRows(index, sistem.id)[1].childCount, 0);
});

test('dizin aynı liste referansı için önbellekten gelir', () => {
  const { list } = sample();
  assert.equal(buildChildIndex(list), buildChildIndex(list));
  assert.notEqual(buildChildIndex(list), buildChildIndex([...list]));
});

test('ebeveyni listede olmayan kart kök sayılır, kaybolmaz', () => {
  counter = 0;
  const yetim = place('Yetim', 'yok-boyle-bir-kart');
  const index = buildChildIndex([yetim]);
  assert.deepEqual(
    levelRows(index, null).map((row) => row.placement.id),
    [yetim.id],
  );
});

test('atalar ve yol göstergesi kökten başlar; seviye yolu hedefi içerir', () => {
  const { list, sistem, boru, dirsek } = sample();
  const index = buildChildIndex(list);
  assert.deepEqual(
    ancestorsOf(index, dirsek.id).map((item) => item.id),
    [sistem.id, boru.id],
  );
  assert.deepEqual(breadcrumb(index, null), [{ id: null, label: 'Proje' }]);
  assert.deepEqual(
    breadcrumb(index, boru.id).map((crumb) => crumb.label),
    ['Proje', 'Sistem', 'Boru'],
  );
  assert.deepEqual(levelPath(index, boru.id), [sistem.id, boru.id]);
  assert.deepEqual(levelPath(index, null), []);
});

test('döngüsel veride atalar sonsuz döngüye girmez', () => {
  counter = 0;
  const a = place('A');
  const b = place('B', a.id);
  a.parentPlacementId = b.id;
  const index = buildChildIndex([a, b]);
  assert.ok(ancestorsOf(index, a.id).length <= 2);
  assert.equal(flattenTree([a, b]).length, 2);
});

test('seviye geçiş planı: ortak başlangıç korunur, fazlası geri alınır, kalanı eklenir', () => {
  assert.deepEqual(planLevelNavigation(['a', 'b', 'c'], ['a', 'b']), { pops: 1, pushes: [] });
  assert.deepEqual(planLevelNavigation(['a', 'b'], ['a', 'x', 'y']), { pops: 1, pushes: ['x', 'y'] });
  assert.deepEqual(planLevelNavigation([], ['a', 'b']), { pops: 0, pushes: ['a', 'b'] });
  assert.deepEqual(planLevelNavigation(['a', 'b'], []), { pops: 2, pushes: [] });
  // Seviye olmayan rota (kart girişi) zinciri keser.
  assert.deepEqual(planLevelNavigation(['a', null], ['a', 'b']), { pops: 1, pushes: ['b'] });
});

test('alt ağaç kimlikleri kartın kendisini ve bütün altını içerir', () => {
  const { list, sistem, boru, dirsek, vana, kategori } = sample();
  const index = buildChildIndex(list);
  assert.deepEqual([...descendantIds(index, sistem.id)].sort(), [sistem.id, boru.id, dirsek.id, vana.id].sort());
  assert.deepEqual([...descendantIds(index, kategori.id)], [kategori.id]);
});

test('taşıma hedefleri kartı ve altındakileri dışlar, geçerli ebeveyni işaretler', () => {
  const { list, sistem, boru, dirsek, vana } = sample();
  const targets = moveTargets(list, boru.id);
  const ids = targets.map((target) => target.placement.id);
  assert.ok(!ids.includes(boru.id) && !ids.includes(dirsek.id), 'kendisi ve alt kartı hedef olamaz');
  assert.ok(ids.includes(sistem.id) && ids.includes(vana.id));
  assert.equal(targets.find((target) => target.isCurrentParent).placement.id, sistem.id);
  assert.equal(targets.find((target) => target.placement.id === vana.id).depth, 1);
});

test('tam ağaç derinlik öncelikli ve kardeş sıralıdır; yol zinciri kendisini içerir', () => {
  const { list, sistem, boru, dirsek, vana } = sample();
  const rows = flattenTree(list);
  assert.deepEqual(
    rows.map((row) => row.placement.displayName),
    ['Kat 2', 'Kat 10', 'Sistem', 'Boru', 'Dirsek', 'Vana'],
  );
  const dirsekRow = rows.find((row) => row.placement.id === dirsek.id);
  assert.deepEqual(dirsekRow.path, [sistem.id, boru.id, dirsek.id]);
  assert.equal(dirsekRow.depth, 2);
  assert.equal(rows.find((row) => row.placement.id === sistem.id).childCount, 2);
  assert.ok(rows.find((row) => row.placement.id === vana.id));
});

test('arama dizini üst yolu içerir ve Türkçe harf/aksan duyarsızdır', () => {
  counter = 0;
  const sistem = place('Isıtma Sistemi', null, { cardType: 'System' });
  const boru = place('ÇELİK BORU', sistem.id, { isMeasurable: true });
  const entries = searchEntries([boru, sistem]);
  const entry = entries.find((item) => item.placement.id === boru.id);
  assert.equal(entry.path, 'Isıtma Sistemi');
  for (const query of ['celik', 'ÇELİK', 'çelik', 'isitma celik', 'ısıtma']) {
    const words = foldSearchText(query).split(' ');
    assert.ok(
      words.every((word) => entry.folded.includes(word)),
      `"${query}" eşleşmeli`,
    );
  }
  assert.ok(
    !foldSearchText('dirsek')
      .split(' ')
      .every((word) => entry.folded.includes(word)),
  );
});

test('dokunma hedefi: ölçülebilir kart giriş sayfasını, klasör alt seviyeyi açar', () => {
  const { sistem, boru } = sample();
  assert.equal(tapTarget({ placement: sistem, childCount: 2 }), 'level');
  assert.equal(tapTarget({ placement: boru, childCount: 1 }), 'entry');
  assert.equal(isEnterable(boru), true);
  assert.equal(isEnterable({ ...boru, inputBehavior: 'Derived' }), false);
  assert.equal(isEnterable(sistem), false);
});

test('en yakın boru: kartın kendisi veya atası boruysa o, değilse tanımsız', () => {
  const { list, boru, dirsek, vana, kategori } = sample();
  assert.equal(nearestPipe(list, dirsek.id).id, boru.id);
  assert.equal(nearestPipe(list, boru.id).id, boru.id);
  assert.equal(nearestPipe(list, vana.id), undefined);
  assert.equal(nearestPipe(list, kategori.id), undefined);
  assert.equal(nearestPipe(list, null), undefined);
});

const summary = (placementId, over = {}) => ({
  placementId,
  placementCode: 'X',
  placementName: 'X',
  unit: 'm',
  measurementCount: 1,
  netQuantity: 10,
  withWasteQuantity: 11,
  purchaseQuantity: 2,
  remainderQuantity: 0,
  purchaseUnit: 'boy',
  ...over,
});

test('toplamlar aynı kartın çap satırlarını toplar; masaüstü Inspector kartıyla aynı kural', () => {
  const rows = [
    summary('a', {
      variant: 'DN20',
      netQuantity: 10.5,
      withWasteQuantity: 11,
      purchaseQuantity: 3,
      measurementCount: 2,
    }),
    summary('a', { variant: 'DN25', netQuantity: 4, withWasteQuantity: 4.4, purchaseQuantity: 1, measurementCount: 1 }),
    summary('b', { unit: 'adet', purchaseUnit: null, netQuantity: 7, withWasteQuantity: 7, purchaseQuantity: 7 }),
  ];
  const totals = totalsByPlacement(rows);
  assert.deepEqual(totals.get('a'), {
    net: 14.5,
    withWaste: 15.4,
    purchase: 4,
    unit: 'm',
    purchaseUnit: 'boy',
    entries: 3,
    variantCount: 2,
  });
  assert.equal(totals.get('b').purchaseUnit, 'adet');
  assert.equal(totals.get('yok'), undefined);
  assert.equal(totalsOf([]), null);
});

test('birimi m olan ve çapı bulunan satırda satın alma birimi boy olur (format.purchaseUnit)', () => {
  const totals = totalsOf([summary('a', { variant: 'DN25', purchaseUnit: null })]);
  assert.equal(totals.purchaseUnit, 'boy');
});
