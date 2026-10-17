// Ölçüm satırlarının masaüstüyle aynı üretildiği: düz miktar, boru çapı, fitting, radyatör,
// düzeltme gövdesi ve iyimser kayıt (sahte API ile).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.ts';
import { fittingChoices } from '../src/lib/fittingChoices.ts';
import {
  activeRadiatorDraft,
  initialRadiatorGroups,
  radiatorGroupKey,
  radiatorMeasurementRows,
  radiatorSizeKey,
} from '../src/lib/radiatorChoices.ts';
import { emptyEntities, listOf, tableFrom } from '../src/mobile/store/entities.ts';
import {
  buildMeasurementBodies,
  buildUpdateBody,
  newestFirst,
  quantityToExpression,
  rowsError,
} from '../src/mobile/screens/project/measurementRows.ts';
import { emptyContext } from '../src/mobile/screens/project/context.ts';
import {
  matchesVariant,
  orderByRecentUse,
  pipeBoxesDraft,
  pipeRow,
  readSelectedDiameter,
  sourceGroups,
  stockInfo,
  summaryForVariant,
  switchGroup,
  variantsInGroup,
} from '../src/mobile/screens/project/pipeModel.ts';
import {
  fittingSubmission,
  mergeCounts,
  pendingForDiameter,
  readFittingBoxes,
  remainingAfterSubmit,
  setCount,
  toDraftBoxes,
} from '../src/mobile/screens/project/fittingModel.ts';
import {
  addCustomLength,
  addGroup,
  afterSubmit,
  groupCount,
  hydrateRadiatorDraft,
  heightsOf,
  otherPending,
  pendingOf,
  selectHeight,
  selectType,
  serializePreferences,
  withCount,
  activeGroup,
} from '../src/mobile/screens/project/radiatorModel.ts';
import {
  duplicateMeasurement,
  removalOps,
  saveMeasurementRows,
  updateMeasurement,
} from '../src/mobile/screens/project/entrySave.ts';
import {
  appliedProperties,
  checkCalculationLink,
  updatePlacementBody,
} from '../src/mobile/screens/project/placementOps.ts';

const revisionId = 'rev-1';
const placement = {
  id: 'pl-1',
  revisionId,
  cardCode: 'KOD',
  cardName: 'Çelik Boru',
  displayName: 'Çelik Boru',
  unit: 'm',
  inputBehavior: 'Manual',
  cardType: 'Material',
  isMeasurable: true,
};

// ----- Masaüstü App.tsx addMeasurementRows gövdesi (birebir kopya, karşılaştırma için)
function desktopBodies(target, rows, measurementDraft) {
  return rows.map((row) => ({
    placementId: target.id,
    inputQuantity: row.quantity,
    inputUnit: target.unit,
    block: measurementDraft.block || null,
    floor: measurementDraft.floor || null,
    room: measurementDraft.room || null,
    zone: null,
    sheet: measurementDraft.sheet || null,
    drawingRevision: null,
    notes: [row.notes, measurementDraft.notes].filter(Boolean).join(' · ') || null,
    sourceKind: 'USER',
    variant: row.variant ?? null,
    secondaryVariant: row.secondaryVariant ?? null,
  }));
}

test('satır gövdesi masaüstü addMeasurementRows ile aynı alanları üretir', () => {
  const rows = [
    { quantity: 12.5 },
    { quantity: 3, variant: 'DN25', notes: 'Çap: DN25 / 1"' },
    { quantity: 2, variant: null, secondaryVariant: 'ELBOW-90', notes: '90° Dirsek · Çap: DN25' },
  ];
  const context = { ...emptyContext(), block: 'A', floor: '2', room: 'Mutfak', sheet: 'M-03', note: 'Not' };
  const desktop = desktopBodies(placement, rows, {
    block: 'A',
    floor: '2',
    room: 'Mutfak',
    sheet: 'M-03',
    notes: 'Not',
  });
  assert.deepEqual(buildMeasurementBodies(placement, rows, context), desktop);
  // Boş bağlam: hepsi null.
  assert.deepEqual(
    buildMeasurementBodies(placement, rows, emptyContext()),
    desktopBodies(placement, rows, { block: '', floor: '', room: '', sheet: '', notes: '' }),
  );
});

test('geçersiz miktar reddedilir', () => {
  assert.ok(rowsError([]));
  assert.ok(rowsError([{ quantity: 0 }]));
  assert.ok(rowsError([{ quantity: -1 }]));
  assert.ok(rowsError([{ quantity: Number.NaN }]));
  assert.ok(rowsError([{ quantity: 1 }, { quantity: Infinity }]));
  assert.equal(rowsError([{ quantity: 0.0004 }]), null);
});

test('düzeltme gövdesi masaüstü updateMeasurementQuantity ile aynıdır', () => {
  const measurement = {
    id: 'm1',
    revisionId,
    placementId: 'pl-1',
    placementCode: 'KOD',
    placementName: 'Çelik Boru',
    sourceKind: 'USER',
    inputQuantity: 124,
    inputUnit: 'm',
    block: 'A',
    floor: null,
    room: undefined,
    zone: 'Z1',
    sheet: null,
    drawingRevision: 'R2',
    notes: 'Çap: DN25',
    createdAtUtc: '2026-10-17T10:00:00Z',
    variant: 'DN25',
    secondaryVariant: undefined,
  };
  const desktop = {
    revisionId: measurement.revisionId,
    placementId: measurement.placementId,
    inputQuantity: 12.4,
    inputUnit: measurement.inputUnit,
    block: measurement.block ?? null,
    floor: measurement.floor ?? null,
    room: measurement.room ?? null,
    zone: measurement.zone ?? null,
    sheet: measurement.sheet ?? null,
    drawingRevision: measurement.drawingRevision ?? null,
    notes: measurement.notes ?? null,
    sourceKind: measurement.sourceKind,
    variant: measurement.variant ?? null,
    secondaryVariant: measurement.secondaryVariant ?? null,
  };
  assert.deepEqual(buildUpdateBody(measurement, { quantity: 12.4 }), desktop);
  assert.equal(buildUpdateBody(measurement, { quantity: 1, context: { floor: '3' } }).floor, '3');
  assert.equal(buildUpdateBody(measurement, { quantity: 1, context: { block: null } }).block, null);
});

test('miktar ifade metni üstel gösterim üretmez; yeni kayıtlar önce gelir', () => {
  assert.equal(quantityToExpression(12.5), '12,5');
  assert.equal(quantityToExpression(0.0000001), '0,0000001');
  assert.equal(quantityToExpression(1234567.5), '1234567,5');
  const list = newestFirst([
    { id: 'a', createdAtUtc: '2026-01-01T00:00:00Z' },
    { id: 'c', createdAtUtc: '2026-03-01T00:00:00Z' },
    { id: 'b', createdAtUtc: '2026-03-01T00:00:00Z' },
    { id: 'x', createdAtUtc: 'bozuk' },
  ]);
  assert.deepEqual(
    list.map((item) => item.id),
    ['c', 'b', 'a', 'x'],
  );
});

// ---------------------------------------------------------------- boru

const variants = [
  { code: 'DN20', label: 'DN20 / 3/4"', standardLength: 6 },
  { code: 'DN25', label: 'DN25 / 1"', standardLength: 6 },
  { code: 'DN32', label: 'DN32 / 1 1/4"', standardLength: 6 },
];

test('boru satırı masaüstü submitPipeBox ile aynı notu taşır', () => {
  assert.deepEqual(pipeRow(12.5, 'DN25', variants), { quantity: 12.5, variant: 'DN25', notes: 'Çap: DN25 / 1"' });
  assert.deepEqual(pipeRow(1, 'DN99', variants), { quantity: 1, variant: 'DN99', notes: 'Çap: DN99' });
});

test('çaplar son kullanıma göre dizilir; kullanılmayanlar kart sırasını korur', () => {
  const measurements = [
    { variant: 'DN32', notes: null, createdAtUtc: '2026-10-01T10:00:00Z' },
    { variant: null, notes: 'Çap: DN20 / 3/4"', createdAtUtc: '2026-10-02T10:00:00Z' },
    { variant: 'dn32', notes: null, createdAtUtc: '2026-10-03T10:00:00Z' },
  ];
  assert.deepEqual(
    orderByRecentUse(variants, measurements).map((item) => item.code),
    ['DN32', 'DN20', 'DN25'],
  );
  assert.deepEqual(
    orderByRecentUse(variants, []).map((item) => item.code),
    ['DN20', 'DN25', 'DN32'],
  );
  assert.ok(matchesVariant('dn25 / 1"', variants[1]));
});

test('çap özeti büyük/küçük harf duyarsız eşleşir ve boy bilgisi sunucudan okunur', () => {
  const summaries = [
    { variant: 'DN25', purchaseUnit: 'boy', purchaseQuantity: 3, netQuantity: 17 },
    { variant: 'DN20 / 3/4"', purchaseUnit: 'm', purchaseQuantity: 5, netQuantity: 5 },
  ];
  assert.equal(summaryForVariant(summaries, variants[1]).netQuantity, 17);
  assert.equal(summaryForVariant(summaries, variants[0]).netQuantity, 5);
  assert.equal(summaryForVariant(summaries, variants[2]), undefined);
  assert.deepEqual(stockInfo(variants[1], summaries[0]), { stockLength: 6, bars: true, barCount: 3 });
  assert.deepEqual(stockInfo(variants[0], summaries[1]), { stockLength: 6, bars: false, barCount: 0 });
  assert.deepEqual(stockInfo(undefined, undefined), { stockLength: 0, bars: false, barCount: 0 });
});

test('kayıtlı çap seçimi yalnız kartın çap kümesinden okunur', () => {
  assert.equal(readSelectedDiameter([{ id: 'x', diameter: 'dn32' }], variants), 'DN32');
  assert.equal(readSelectedDiameter([{ id: 'x', diameter: 'DN99' }, { diameter: 'DN20' }], variants), 'DN20');
  assert.equal(readSelectedDiameter('bozuk', variants), null);
  assert.equal(readSelectedDiameter([], variants), null);
  assert.deepEqual(pipeBoxesDraft('pl-1', 'DN25'), [{ id: 'pl-1-pipe-0', diameter: 'DN25' }]);
});

test('birleşik boru kartında kaynak grupları ayrılır ve grup değişince aynı çap korunur', () => {
  const merged = [
    { code: 'A-DN20', label: 'DN20', sourceCardName: 'PN16', sourceVariantCode: 'DN20' },
    { code: 'A-DN25', label: 'DN25', sourceCardName: 'PN16', sourceVariantCode: 'DN25' },
    { code: 'B-DN20', label: 'DN20', sourceCardName: 'PN20', sourceVariantCode: 'DN20' },
    { code: 'B-DN25', label: 'DN25', sourceCardName: 'PN20', sourceVariantCode: 'DN25' },
  ];
  assert.deepEqual(sourceGroups(placement, merged), [
    ['PN16', 'PN16'],
    ['PN20', 'PN20'],
  ]);
  assert.deepEqual(
    variantsInGroup(placement, merged, 'B-DN25').map((item) => item.code),
    ['B-DN20', 'B-DN25'],
  );
  assert.equal(switchGroup(merged, 'A-DN25', 'PN20'), 'B-DN25');
  assert.equal(variantsInGroup(placement, variants, 'DN20').length, 3);
});

// ---------------------------------------------------------------- fitting

const pipe = {
  ...placement,
  id: 'pipe',
  variantMode: 'Pipe',
  materialType: 'PP-R',
  variants: [
    { code: 'DN20', label: 'DN20', standardLength: 4 },
    { code: 'DN25', label: 'DN25', standardLength: 4 },
  ],
};
const elbow = {
  ...placement,
  id: 'elbow',
  parentPlacementId: 'pipe',
  cardType: 'Accessory',
  variantMode: 'Fitting',
  materialType: 'PP-R',
  variants: [
    { code: 'ELBOW-90', label: '90° Dirsek', compatibleDiameters: [] },
    { code: 'TEE', label: 'Te', compatibleDiameters: ['DN25'] },
  ],
};

test('fitting satırları yalnız uyumlu türleri gönderir; gönderilmeyen kalıntı taslakta kalır', () => {
  const choices = fittingChoices(elbow, [pipe, elbow], []);
  const compatibleFor = (code) => {
    const selected = choices.diameters.find((item) => item.code === code);
    return selected ? choices.compatibleVariants(selected) : [];
  };
  const counts = { DN20: { 'ELBOW-90': 4, TEE: 2 }, DN25: { 'ELBOW-90': 1, TEE: 3 }, DN99: { 'ELBOW-90': 9 } };
  const result = fittingSubmission(elbow, counts, choices.diameters, compatibleFor);
  assert.deepEqual(result.rows, [
    { quantity: 4, variant: 'DN20', secondaryVariant: 'ELBOW-90', notes: '90° Dirsek · Çap: DN20' },
    { quantity: 1, variant: 'DN25', secondaryVariant: 'ELBOW-90', notes: '90° Dirsek · Çap: DN25' },
    { quantity: 3, variant: 'DN25', secondaryVariant: 'TEE', notes: 'Te · Çap: DN25' },
  ]);
  const remaining = remainingAfterSubmit(counts, result.submitted);
  assert.deepEqual(remaining.DN20, { TEE: 2 }); // DN20'ye uymayan te gönderilmedi, bekliyor
  assert.deepEqual(remaining.DN25, {});
  assert.deepEqual(remaining.DN99, { 'ELBOW-90': 9 });
});

test('çapsız (GENEL) seçenek grubunda variant null gider ve nota çap eklenmez', () => {
  const plain = { ...elbow, parentPlacementId: null, variants: [{ code: 'A', label: 'Seçenek A' }] };
  const choices = fittingChoices(plain, [plain], []);
  assert.equal(choices.dimensional, false);
  const compatibleFor = (code) =>
    choices.diameters.some((item) => item.code === code) ? choices.compatibleVariants(choices.diameters[0]) : [];
  const result = fittingSubmission(plain, { GENEL: { A: 2 } }, choices.diameters, compatibleFor);
  assert.deepEqual(result.rows, [{ quantity: 2, variant: null, secondaryVariant: 'A', notes: 'Seçenek A' }]);
});

test('fitting taslağı masaüstü biçimini okur: kutular toplanır, geçersiz çap ve sayı atılır', () => {
  const context = { placementId: 'elbow', firstDiameter: 'DN20', validDiameters: new Set(['dn20', 'dn25']) };
  const raw = [
    { id: 'b1', diameter: 'DN20', countsByDiameter: { DN20: { 'ELBOW-90': 2.9, TEE: -1, X: 'a' }, DN99: { A: 1 } } },
    { id: 'b2', diameter: 'DN25', counts: { 'ELBOW-90': 3 } },
    { diameter: 'DN99', countsByDiameter: {} },
    'bozuk',
    null,
  ];
  const boxes = readFittingBoxes(raw, context);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0].countsByDiameter, { DN20: { 'ELBOW-90': 2 } });
  assert.deepEqual(mergeCounts([...boxes, ...boxes]), { DN20: { 'ELBOW-90': 4 }, DN25: { 'ELBOW-90': 6 } });
  assert.deepEqual(readFittingBoxes('bozuk', context), []);
  assert.deepEqual(toDraftBoxes('elbow', 'DN25', { DN25: { TEE: 1 } }), [
    { id: 'elbow-fit-0', diameter: 'DN25', countsByDiameter: { DN25: { TEE: 1 } } },
  ]);
});

test('adet ayarı negatife düşmez, tam sayıya yuvarlanır, değişmeyende aynı nesne döner', () => {
  const counts = { DN20: { TEE: 2 } };
  assert.equal(setCount(counts, 'DN20', 'TEE', 2), counts);
  assert.equal(setCount(counts, 'DN20', 'TEE', -4).DN20.TEE, 0);
  assert.equal(setCount(counts, 'DN20', 'TEE', 3.9).DN20.TEE, 3);
  assert.equal(setCount(counts, 'DN20', 'TEE', Number.NaN).DN20.TEE, 0);
  assert.equal(pendingForDiameter({ DN20: { A: 2, B: 3 } }, 'DN20'), 5);
  assert.equal(pendingForDiameter({}, 'DN20'), 0);
});

// ---------------------------------------------------------------- radyatör

const radiator = {
  ...placement,
  cardCode: 'STD-EQ-RADIATOR',
  cardName: 'Panel Radyatör',
  displayName: 'Panel Radyatör',
  unit: 'adet',
  variants: [],
  variantMode: 'Fitting',
};

test('radyatör ilk durumu masaüstüyle aynıdır: varsayılan etkin grup Tip 22 / 600', () => {
  const draft = hydrateRadiatorDraft(radiator, [], null, null, null);
  const group = activeGroup(draft);
  assert.equal(group.type, 'Tip 22');
  assert.equal(group.height, '600');
  assert.deepEqual(
    draft.groups,
    initialRadiatorGroups(radiator, []).map((item) => ({ ...item })),
  );
  assert.deepEqual(draft.counts, {});
});

test('radyatör seçimi tip/yükseklik değişince birbirini korur; sayaç sınırları uygulanır', () => {
  let draft = hydrateRadiatorDraft(radiator, [], null, null, null);
  draft = selectType(draft, 'Tip 33');
  assert.equal(activeGroup(draft).type, 'Tip 33');
  assert.equal(activeGroup(draft).height, '600');
  draft = selectHeight(draft, '500');
  assert.equal(activeGroup(draft).height, '500');
  assert.deepEqual(heightsOf(draft, 'Tip 33'), ['300', '400', '500', '600', '900']);
  const group = activeGroup(draft);
  assert.equal(withCount(draft, group, '1000', -1), draft);
  assert.equal(withCount(draft, group, '1000', 1.5), draft);
  assert.equal(withCount(draft, group, '1000', 1_000_001), draft);
  const counted = withCount(draft, group, '1000', 3);
  assert.equal(counted.counts[radiatorSizeKey({ ...group, length: '1000' })], 3);
  assert.equal(groupCount(counted, radiator, 'Tip 33'), 3);
  assert.equal(groupCount(counted, radiator, 'Tip 33', '600'), 0);
});

test('radyatör kaydı yalnız seçili grubun satırlarını masaüstü fonksiyonuyla üretir, sonra yalnız onu temizler', () => {
  let draft = hydrateRadiatorDraft(radiator, [], null, null, null);
  const first = activeGroup(draft);
  draft = withCount(draft, first, '1000', 2);
  draft = withCount(draft, first, '1200', 3);
  draft = selectHeight(draft, '500');
  const second = activeGroup(draft);
  draft = withCount(draft, second, '1000', 4);
  draft = { ...draft, active: radiatorGroupKey(first) };
  const pending = pendingOf(draft, radiator, []);
  assert.deepEqual(pending.rows, radiatorMeasurementRows(activeRadiatorDraft(draft), radiator, []));
  assert.equal(pending.active, 5);
  assert.equal(pending.all, 9);
  assert.deepEqual(
    pending.rows.map((row) => row.secondaryVariant),
    ['W1000', 'W1200'],
  );
  assert.equal(pending.rows[0].notes, 'Radyatör: Tip 22 · Yükseklik: 600 mm · Uzunluk: 1000 mm');
  const after = afterSubmit(draft);
  assert.equal(pendingOf(after, radiator, []).all, 4);
  assert.deepEqual(
    otherPending(draft, radiator).map((item) => item.text),
    ['1000 mm × 4 adet'],
  );
});

test('özel uzunluk 1 adetle başlar; geçersiz değer ve tip/yükseklik hatası anlaşılır', () => {
  const draft = hydrateRadiatorDraft(radiator, [], null, null, null);
  const bad = addCustomLength(draft, 'abc');
  assert.equal(bad.ok, false);
  const ok = addCustomLength(draft, '1250');
  assert.equal(ok.ok, true);
  const group = activeGroup(ok.draft);
  assert.ok(group.lengths.includes('1250'));
  assert.equal(ok.draft.counts[radiatorSizeKey({ ...group, length: '1250' })], 1);
  assert.equal(addGroup(draft, radiator, { mode: 'type', type: '', height: '600' }).ok, false);
  assert.equal(addGroup(draft, radiator, { mode: 'type', type: 'a · b', height: '600' }).ok, false);
  const added = addGroup(draft, radiator, { mode: 'type', type: 'Dekoratif', height: '700' });
  assert.equal(added.ok, true);
  assert.equal(activeGroup(added.draft).type, 'Dekoratif');
  assert.ok(heightsOf(added.draft, 'Dekoratif').includes('700'));
});

test('tercih kaydı adetleri içermez; taslak ve tercih masaüstü anahtar biçimini taşır', () => {
  let draft = hydrateRadiatorDraft(radiator, [], null, null, null);
  draft = withCount(draft, activeGroup(draft), '1000', 2);
  const preferences = JSON.parse(serializePreferences(draft));
  assert.deepEqual(preferences.counts, {});
  const restored = hydrateRadiatorDraft(radiator, [], JSON.stringify(draft), serializePreferences(draft), null);
  assert.equal(pendingOf(restored, radiator, []).all, 2);
});

// ---------------------------------------------------------------- iyimser kayıt

function fakeStore(initial = {}) {
  let state = { entities: { ...emptyEntities(), ...initial } };
  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial };
    },
  };
}

const quiet = () => {
  const errors = [];
  return { errors, feedback: { error: (error) => errors.push(error) } };
};

test('kayıt geçici satırı hemen gösterir, yanıtta sunucu satırıyla değiştirir', async () => {
  const store = fakeStore();
  const { feedback } = quiet();
  let seenDuringRequest = null;
  const api = {
    post: async (path, body) => {
      seenDuringRequest = listOf(store.getState().entities.measurements).map((item) => item.inputQuantity);
      assert.equal(path, `/revisions/${revisionId}/measurements/batch`);
      return body.map((item, index) => ({
        ...item,
        id: `srv-${index}`,
        revisionId,
        createdAtUtc: '2026-10-17T10:00:00Z',
      }));
    },
    put: async () => undefined,
  };
  const outcome = await saveMeasurementRows(
    {
      store,
      api,
      feedback,
      idFor: (() => {
        let i = 0;
        return () => `tmp-${++i}`;
      })(),
    },
    { revisionId, placement, rows: [{ quantity: 12.5 }, { quantity: 3 }], context: emptyContext() },
  );
  assert.equal(outcome.ok, true);
  assert.equal(seenDuringRequest.length, 2, 'istek sürerken iki geçici satır görünür');
  const final = listOf(store.getState().entities.measurements);
  assert.deepEqual(final.map((item) => item.id).sort(), ['srv-0', 'srv-1']);
});

test('sunucu reddederse geçici satırlar geri alınır ve hata bildirilir; başka satırlara dokunulmaz', async () => {
  const existing = { id: 'old', placementId: 'pl-1', inputQuantity: 1, createdAtUtc: '2026-01-01T00:00:00Z' };
  const store = fakeStore({ measurements: tableFrom([existing], (item) => item.id) });
  const { feedback, errors } = quiet();
  const api = {
    post: async () => {
      throw new ApiError('Bu revizyon onaylı.');
    },
    put: async () => undefined,
  };
  const outcome = await saveMeasurementRows(
    { store, api, feedback },
    { revisionId, placement, rows: [{ quantity: 5 }], context: emptyContext() },
  );
  assert.equal(outcome.ok, false);
  assert.deepEqual(
    listOf(store.getState().entities.measurements).map((item) => item.id),
    ['old'],
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Bu revizyon onaylı.');
});

test('geçersiz miktarda istek hiç gönderilmez', async () => {
  const store = fakeStore();
  const { feedback, errors } = quiet();
  let called = false;
  const api = {
    post: async () => {
      called = true;
      return [];
    },
    put: async () => undefined,
  };
  const outcome = await saveMeasurementRows(
    { store, api, feedback },
    { revisionId, placement, rows: [{ quantity: 0 }], context: emptyContext() },
  );
  assert.equal(outcome.ok, false);
  assert.equal(called, false);
  assert.equal(errors.length, 1);
  assert.equal(listOf(store.getState().entities.measurements).length, 0);
});

test('düzeltme miktarı hemen günceller; reddedilirse eski değere döner', async () => {
  const measurement = {
    id: 'm1',
    revisionId,
    placementId: 'pl-1',
    placementCode: 'K',
    placementName: 'K',
    sourceKind: 'USER',
    inputQuantity: 124,
    inputUnit: 'm',
    createdAtUtc: '2026-10-17T10:00:00Z',
  };
  const store = fakeStore({ measurements: tableFrom([measurement], (item) => item.id) });
  const { feedback } = quiet();
  let during = null;
  const okApi = {
    post: async () => undefined,
    put: async (path, body) => {
      during = store.getState().entities.measurements.byId.get('m1').inputQuantity;
      assert.equal(path, '/measurements/m1');
      assert.equal(body.inputQuantity, 12.4);
    },
  };
  const ok = await updateMeasurement({ store, api: okApi, feedback }, measurement, { quantity: 12.4 });
  assert.equal(ok.ok, true);
  assert.equal(during, 12.4);
  assert.equal(store.getState().entities.measurements.byId.get('m1').inputQuantity, 12.4);
  assert.ok(store.getState().entities.measurements.byId.get('m1').updatedAtUtc);

  const failing = {
    post: async () => undefined,
    put: async () => {
      throw new ApiError('Reddedildi');
    },
  };
  const failed = await updateMeasurement(
    { store, api: failing, feedback },
    store.getState().entities.measurements.byId.get('m1'),
    { quantity: 99 },
  );
  assert.equal(failed.ok, false);
  assert.equal(store.getState().entities.measurements.byId.get('m1').inputQuantity, 12.4);
});

test('çoğaltma geçici kopyayı ekler ve sunucu kopyasıyla değiştirir', async () => {
  const measurement = {
    id: 'm1',
    revisionId,
    placementId: 'pl-1',
    inputQuantity: 7,
    inputUnit: 'm',
    createdAtUtc: '2026-10-17T10:00:00Z',
  };
  const store = fakeStore({ measurements: tableFrom([measurement], (item) => item.id) });
  const { feedback } = quiet();
  const api = {
    post: async (path) => {
      assert.equal(path, '/measurements/m1/duplicate');
      return { ...measurement, id: 'copy-1' };
    },
    put: async () => undefined,
  };
  const outcome = await duplicateMeasurement({ store, api, feedback }, measurement);
  assert.equal(outcome.ok, true);
  assert.deepEqual(
    listOf(store.getState().entities.measurements)
      .map((item) => item.id)
      .sort(),
    ['copy-1', 'm1'],
  );
});

test('kart silme kartları, ölçümlerini ve özetlerini birlikte kaldırır', () => {
  const ops = removalOps(
    ['a', 'b'],
    [
      { id: 'm1', placementId: 'a' },
      { id: 'm2', placementId: 'z' },
      { id: 'm3', placementId: 'b' },
    ],
    [{ placementId: 'a', variant: 'DN25' }, { placementId: 'z' }],
  );
  assert.deepEqual(ops[0].keys.sort(), ['a', 'b']);
  assert.deepEqual(ops[1].keys.sort(), ['m1', 'm3']);
  assert.equal(ops[2].keys.length, 1);
});

test('özellik gövdesi: kart adına eşit/boş ad geçersiz kılmayı kaldırır, boş alanlar null olur', () => {
  const body = updatePlacementBody(placement, { displayName: ' Ana hat ', procurementScope: ' ', notes: ' 120 kW ' });
  assert.deepEqual(body, { displayNameOverride: 'Ana hat', procurementScope: null, notes: '120 kW' });
  assert.equal(
    updatePlacementBody(placement, { displayName: 'Çelik Boru', procurementScope: '', notes: '' }).displayNameOverride,
    null,
  );
  assert.equal(
    updatePlacementBody(placement, { displayName: '', procurementScope: '', notes: '' }).displayNameOverride,
    null,
  );
  assert.equal(appliedProperties(placement, body).displayName, 'Ana hat');
  assert.equal(appliedProperties(placement, { ...body, displayNameOverride: null }).displayName, 'Çelik Boru');
});

test('hesap bağı ön kontrolleri masaüstüyle aynı mesajları verir', () => {
  assert.match(checkCalculationLink(null, 'a').error, /hesaplanacak/);
  assert.match(checkCalculationLink('a', null).error, /kaynak/);
  assert.match(checkCalculationLink('a', 'a').error, /aynı olamaz/);
  assert.equal(checkCalculationLink('a', 'b').ok, true);
});

test('sunucunun saat dilimi eksiz zaman damgası UTC sayılır; karışık biçimler doğru sıralanır', async () => {
  const { parseUtc } = await import('../src/mobile/screens/project/measurementRows.ts');
  assert.equal(parseUtc('2026-10-17T14:45:38.4138484'), Date.parse('2026-10-17T14:45:38.4138484Z'));
  assert.equal(parseUtc('2026-10-17T14:45:38Z'), Date.parse('2026-10-17T14:45:38Z'));
  assert.equal(parseUtc('2026-10-17T17:45:38+03:00'), Date.parse('2026-10-17T14:45:38Z'));
  assert.ok(Number.isNaN(parseUtc('')));
  const sorted = newestFirst([
    { id: 'server', createdAtUtc: '2026-10-17T14:50:17.5598283' },
    { id: 'tmp', createdAtUtc: '2026-10-17T14:55:00.000Z' },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['tmp', 'server'],
  );
});
