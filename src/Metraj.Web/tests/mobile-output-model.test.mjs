// Özet / Çıktı ekranının saf modeli: kapsam çözümleme, indirme adresi, malzeme gruplama ve arama,
// radyatör düzleştirme ve toplamlar (biçim masaüstüyle aynı: lib/format.ts).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRadiatorRows,
  folderOf,
  formatByteSize,
  groupSummaries,
  materialItemCount,
  materialRows,
  pendingChecks,
  radiatorGrandTotals,
  radiatorTotal,
  radiatorTypes,
  reportDataPath,
  reportDownloadPath,
  reportFileName,
  reportStats,
  resolveScope,
  scopeQuery,
  summaryDetail,
  summaryQuantities,
} from '../src/mobile/screens/output/reportModel.ts';

const place = (id, parent, extra = {}) => ({
  id,
  revisionId: 'r1',
  parentPlacementId: parent,
  displayName: id.toUpperCase(),
  cardCode: `C-${id}`,
  isMeasurable: true,
  cardType: 'Material',
  ...extra,
});

// root(Sistem) ─ kat1(Kapsam) ─ boru ─ dirsek
//             └ kat2(Kapsam) ─ vana
const placements = [
  place('root', null, { isMeasurable: false, cardType: 'System', displayName: 'Temiz Su' }),
  place('kat1', 'root', { isMeasurable: false, cardType: 'Scope', displayName: 'Kat 1' }),
  place('boru', 'kat1', { displayName: 'PPRC Boru' }),
  place('dirsek', 'boru', { displayName: 'Dirsek', cardType: 'Accessory' }),
  place('kat2', 'root', { isMeasurable: false, cardType: 'Scope', displayName: 'Kat 2' }),
  place('vana', 'kat2', { displayName: 'Vana' }),
];

const summary = (placementId, name, extra = {}) => ({
  placementId,
  placementCode: `C-${placementId}`,
  placementName: name,
  unit: 'adet',
  measurementCount: 1,
  netQuantity: 1,
  withWasteQuantity: 1,
  purchaseQuantity: 1,
  remainderQuantity: 0,
  variant: null,
  secondaryVariant: null,
  ...extra,
});

test('kapsam: kök ve bütün altındakiler; bilinmeyen ya da boş kimlik bütün proje', () => {
  const scope = resolveScope(placements, 'kat1');
  assert.equal(scope.rootId, 'kat1');
  assert.deepEqual([...scope.ids].sort(), ['boru', 'dirsek', 'kat1']);
  assert.equal(scope.root.displayName, 'Kat 1');
  for (const requested of [null, undefined, '', 'yok'])
    assert.deepEqual(resolveScope(placements, requested), { rootId: null, root: null, ids: null });
  assert.deepEqual([...resolveScope(placements, 'vana').ids], ['vana'], 'yaprak kendi kapsamıdır');
});

test('kapsam döngülü veride de sonlanır', () => {
  const cyclic = [place('a', 'b'), place('b', 'a')];
  assert.deepEqual([...resolveScope(cyclic, 'a').ids].sort(), ['a', 'b']);
});

test('adresler: rapor verisi alt ağaç yolunda, indirmeler masaüstüyle aynı ?placementId= sorgusuyla', () => {
  assert.equal(reportDataPath('R', null), '/revisions/R/report');
  assert.equal(reportDataPath('R', 'K'), '/revisions/R/report/subtree/K');
  assert.equal(scopeQuery(null), '');
  assert.equal(scopeQuery('abc-1'), '?placementId=abc-1');
  assert.equal(reportDownloadPath('R', 'pdf', null), '/revisions/R/report/pdf');
  assert.equal(reportDownloadPath('R', 'excel', 'K'), '/revisions/R/report/excel?placementId=K');
  assert.equal(reportDownloadPath('R', 'word', 'K'), '/revisions/R/report/word?placementId=K');
});

test('dosya adı: uzantı, kapsam kodu ve güvenli karakterler', () => {
  assert.equal(reportFileName('SYN-CW-001', 'R0', 'pdf'), 'SYN-CW-001-R0.pdf');
  assert.equal(reportFileName('P 1', 'R1', 'excel', 'C/KAT:1'), 'P-1-R1-C-KAT-1.xlsx');
  assert.equal(reportFileName('', 'R2', 'word'), 'Metraj-R2.docx');
  assert.equal(reportFileName(null, undefined, 'pdf'), 'Metraj.pdf');
});

test('bayt boyutu okunur biçimde', () => {
  assert.equal(formatByteSize(10), '10 B');
  assert.equal(formatByteSize(2048), '2 KB');
  assert.equal(formatByteSize(5 * 1024 * 1024), '5 MB');
});

test('klasör: en yakın ölçülemeyen ata (boru altındaki fitting boruyla aynı başlıkta)', () => {
  assert.equal(folderOf('dirsek', placements).id, 'kat1');
  assert.equal(folderOf('boru', placements).id, 'kat1');
  assert.equal(folderOf('vana', placements).id, 'kat2');
  assert.equal(folderOf('kat1', placements).id, 'root');
  assert.equal(folderOf('root', placements), null);
});

test('gruplama: başlıklar ağaç sırasıyla, satırlar büyük çap önce', () => {
  const groups = groupSummaries(
    [
      summary('vana', 'Vana'),
      summary('boru', 'PPRC Boru', { variant: 'DN20' }),
      summary('boru', 'PPRC Boru', { variant: 'DN50' }),
      summary('dirsek', 'Dirsek'),
    ],
    placements,
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Kat 1', 'Kat 2'],
  );
  assert.deepEqual(
    groups[0].rows.map((r) => r.variant ?? r.placementName),
    ['DN50', 'DN20', 'Dirsek'],
  );
});

test('klasörsüz kalem "Diğer kalemler" başlığında sona gider', () => {
  const groups = groupSummaries([summary('orphan', 'Yetim'), summary('vana', 'Vana')], placements);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Kat 2', 'Diğer kalemler'],
  );
});

test('satırlar: başlık + kalemler; arama Türkçe duyarlı, boş gruplar atlanır', () => {
  const groups = groupSummaries(
    [
      summary('vana', 'Küresel Vana'),
      summary('boru', 'PPRC Boru', { variant: 'DN25' }),
      summary('dirsek', 'Işıklı Dirsek'),
    ],
    placements,
  );
  const all = materialRows(groups, '');
  assert.deepEqual(
    all.map((r) => r.kind),
    ['header', 'item', 'item', 'header', 'item'],
  );
  assert.equal(materialItemCount(all), 3);
  const keys = new Set(all.map((r) => r.key));
  assert.equal(keys.size, all.length, 'anahtarlar benzersiz');
  const found = materialRows(groups, 'isikli');
  assert.deepEqual(
    found.map((r) => r.kind),
    ['header', 'item'],
  );
  assert.equal(found[0].label, 'Kat 1');
  assert.equal(found[0].count, 1);
  assert.deepEqual(
    materialRows(groups, 'KÜRESEL').map((r) => r.kind),
    ['header', 'item'],
  );
  assert.deepEqual(
    materialRows(groups, 'dn25').map((r) => r.kind),
    ['header', 'item'],
  );
  assert.deepEqual(materialRows(groups, 'yok'), []);
});

test('miktar kutuları: masaüstüyle aynı biçim, artan ve fire yalnız varsa', () => {
  const q = summaryQuantities(
    summary('boru', 'Boru', {
      unit: 'm',
      netQuantity: 30.5,
      withWasteQuantity: 31.415,
      purchaseQuantity: 8,
      remainderQuantity: 0.585,
      appliedWasteRatePct: 3,
      purchaseUnit: 'boy',
    }),
  );
  assert.deepEqual(q, {
    net: '30,5 m',
    withWaste: '31,415 m',
    purchase: '8 boy',
    remainder: '0,585 m',
    wastePct: '%3',
  });
  const plain = summaryQuantities(summary('vana', 'Vana', { netQuantity: 1234.5 }));
  assert.equal(plain.net, '1.234,5 adet');
  assert.equal(plain.remainder, null);
  assert.equal(plain.wastePct, null);
  assert.equal(
    summaryQuantities(summary('x', 'x', { netQuantity: 0.0004 })).net,
    '0,0004 adet',
    '0,0004 sıfır görünmez',
  );
});

test('özet açıklaması: varyantlar ve giriş sayısı', () => {
  assert.equal(
    summaryDetail(summary('x', 'x', { variant: 'DN25', secondaryVariant: 'Dirsek', measurementCount: 4 })),
    'DN25 · Dirsek · 4 giriş',
  );
  assert.equal(summaryDetail(summary('x', 'x')), 'Standart · 1 giriş');
});

const rad = (type, typeLabel, heightMm, lengthMm, net, extra = {}) => ({
  type,
  typeLabel,
  heightMm,
  lengthMm,
  unit: 'adet',
  netQuantity: net,
  withWasteQuantity: net,
  purchaseQuantity: net,
  purchaseUnit: 'adet',
  placementIds: [],
  ...extra,
});
const radiators = [
  rad('panel-22', 'Panel 22', 600, 1000, 2),
  rad('panel-22', 'Panel 22', 600, 800, 1),
  rad('panel-22', 'Panel 22', 500, 1200, 3),
  rad('havlupan', 'Havlupan', 800, null, 4, { unit: 'dilim', purchaseUnit: 'dilim' }),
];

test('radyatör: tipler, genel toplamlar, toplama sonra biçimleme', () => {
  assert.deepEqual(radiatorTypes(radiators), [
    { type: 'panel-22', label: 'Panel 22' },
    { type: 'havlupan', label: 'Havlupan' },
  ]);
  assert.deepEqual(radiatorGrandTotals(radiators), [
    { unit: 'adet', net: '6' },
    { unit: 'dilim', net: '4' },
  ]);
  assert.equal(radiatorTotal([rad('a', 'A', 1, 1, 0.1), rad('a', 'A', 1, 2, 0.2)], 'netQuantity'), '0,3');
});

test('radyatör satırları: grup başlığı, yükseklik artan, uzunluk artan, toplamlar', () => {
  const rows = buildRadiatorRows(radiators, '');
  assert.deepEqual(
    rows.map((r) => r.kind),
    [
      'header',
      'height',
      'item',
      'subtotal',
      'height',
      'item',
      'item',
      'subtotal',
      'total', // Panel 22
      'header',
      'height',
      'item',
      'subtotal',
      'total', // Havlupan
    ],
  );
  const first = rows[0];
  assert.equal(first.label, 'Panel 22');
  assert.equal(first.total, '6 adet');
  assert.equal(rows[1].label, 'Yükseklik: 500 mm');
  assert.deepEqual(
    rows.filter((r) => r.kind === 'item').map((r) => r.label),
    ['1.200 mm', '800 mm', '1.000 mm', 'Dilim'],
  );
  const total = rows.find((r) => r.kind === 'total');
  assert.equal(total.net, '6');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'anahtarlar benzersiz');
  // Her satır kendi grubunun anahtarını taşır (yapışkan başlık için).
  assert.equal(new Set(rows.slice(0, 9).map((r) => r.groupKey)).size, 1);
});

test('radyatör tip süzgeci ve uzunluk belirtilmemiş satır', () => {
  const only = buildRadiatorRows(radiators, 'havlupan');
  assert.deepEqual(
    only.map((r) => r.kind),
    ['header', 'height', 'item', 'subtotal', 'total'],
  );
  const unspecified = buildRadiatorRows([rad('x', 'X', 600, null, 1)], '');
  assert.equal(unspecified.find((r) => r.kind === 'item').label, 'Belirtilmedi');
});

test('rapor özeti: bekleyen hesap sayısı ve sayaçlar', () => {
  const report = {
    summaries: [summary('a', 'A'), summary('b', 'B')],
    sourceMeasurements: [{}, {}, {}],
    radiatorSummaries: radiators,
    calculationChecks: [{ status: 'PendingReview' }, { status: 'Approved' }, { status: 'PendingReview' }],
  };
  assert.deepEqual(reportStats(report), { materials: 2, sources: 3, pending: 2, radiatorRows: 4 });
  assert.equal(pendingChecks(report), 2);
  assert.deepEqual(reportStats(undefined), { materials: 0, sources: 0, pending: 0, radiatorRows: 0 });
});
