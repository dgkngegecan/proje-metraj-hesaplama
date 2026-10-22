// Mobil durum deposunun saf çekirdeği: tablolar, ters yamalar, seçiciler,
// eylemler (sahte API ile), iyimser güncelleme ve taslak tamponu.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.ts';
import {
  applyPatch,
  emptyEntities,
  entityKey,
  listOf,
  patch,
  removeMany,
  replaceWhere,
  restoreMany,
  summaryKey,
  tableFrom,
  upsertMany,
} from '../src/mobile/store/entities.ts';
import {
  buildPlacementTree,
  memoizeLast,
  selectIsRevisionLocked,
  selectMeasurementsOfPlacement,
  selectRevisionsOf,
  sortSummariesForDisplay,
  subtreeIds,
} from '../src/mobile/store/selectors.ts';
import { createAppStore, errorMessage, loadKeys } from '../src/mobile/store/appStore.ts';
import {
  flushPendingRemovals,
  pendingRemovalCount,
  removeWithUndo,
  runOptimistic,
} from '../src/mobile/store/optimistic.ts';
import { createDraftStore, createWriteBuffer, draftKey, parseDraft } from '../src/mobile/store/drafts.ts';

const byId = (item) => item.id;
const ids = (table) => [...table.ids];
const values = (table) => listOf(table).map((item) => item.v ?? item.id);

// ---------------------------------------------------------------------------
// Tablolar
// ---------------------------------------------------------------------------

test('tableFrom sırayı korur; yinelenen anahtarda son değer ilk konumda kalır', () => {
  const table = tableFrom(
    [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'a', v: 3 },
    ],
    byId,
  );
  assert.deepEqual(ids(table), ['a', 'b']);
  assert.equal(table.byId.get('a').v, 3);
});

test('upsertMany: değişiklik yoksa AYNI tablo; yeni kayıt sona veya başa', () => {
  const a = { id: 'a' };
  const table = tableFrom([a], byId);
  assert.equal(upsertMany(table, [a], byId), table, 'aynı nesne → aynı tablo');
  assert.equal(upsertMany(table, [], byId), table);
  assert.deepEqual(ids(upsertMany(table, [{ id: 'b' }], byId)), ['a', 'b']);
  assert.deepEqual(ids(upsertMany(table, [{ id: 'b' }], byId, 'start')), ['b', 'a']);
  const updated = upsertMany(table, [{ id: 'a', v: 9 }], byId);
  assert.notEqual(updated, table);
  assert.deepEqual(ids(updated), ['a']);
  assert.equal(updated.byId.get('a').v, 9);
  assert.equal(table.byId.get('a').v, undefined, 'eski tablo değişmez');
});

test('removeMany ve restoreMany sırayı geri kurar', () => {
  const table = tableFrom(
    ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    byId,
  );
  assert.equal(removeMany(table, ['x']), table);
  const removed = removeMany(table, ['b', 'd']);
  assert.deepEqual(ids(removed), ['a', 'c']);
  const restored = restoreMany(removed, [
    { key: 'd', item: { id: 'd' }, index: 3 },
    { key: 'b', item: { id: 'b' }, index: 1 },
  ]);
  assert.deepEqual(ids(restored), ['a', 'b', 'c', 'd']);
  // Liste arada kısaldıysa sona kırpılır, kayıt kaybolmaz.
  assert.deepEqual(ids(restoreMany(tableFrom([], byId), [{ key: 'z', item: { id: 'z' }, index: 7 }])), ['z']);
});

test('replaceWhere yalnız eşleşenleri değiştirir', () => {
  const table = tableFrom(
    [
      { id: 'r1', projectId: 'p1' },
      { id: 'r2', projectId: 'p2' },
      { id: 'r3', projectId: 'p1' },
    ],
    byId,
  );
  const next = replaceWhere(table, (item) => item.projectId === 'p1', [{ id: 'r4', projectId: 'p1' }], byId);
  assert.deepEqual(ids(next), ['r2', 'r4']);
});

test('listOf tablo değişmedikçe aynı diziyi döner', () => {
  const table = tableFrom([{ id: 'a' }], byId);
  assert.equal(listOf(table), listOf(table));
  assert.ok(Object.isFrozen(listOf(table)));
});

test('özet anahtarı yerleşim + iki varyanttan oluşur', () => {
  assert.notEqual(
    summaryKey({ placementId: 'p', variant: 'DN20', secondaryVariant: null }),
    summaryKey({ placementId: 'p', variant: 'DN25', secondaryVariant: null }),
  );
  assert.equal(entityKey.summaries({ placementId: 'p' }), summaryKey({ placementId: 'p', variant: null }));
});

// ---------------------------------------------------------------------------
// Ters yamalar
// ---------------------------------------------------------------------------

const measurement = (id, extra = {}) => ({ id, revisionId: 'r1', placementId: 'pl1', inputQuantity: 1, ...extra });

function entitiesWith(measurements) {
  return { ...emptyEntities(), measurements: tableFrom(measurements, byId) };
}

test('ters yama: güncelleme + ekleme + silme tam olarak geri alınır', () => {
  const start = entitiesWith([measurement('m1'), measurement('m2'), measurement('m3')]);
  const { entities, inverse } = applyPatch(start, [
    patch.upsert('measurements', [measurement('m2', { inputQuantity: 5 }), measurement('m9')]),
    patch.remove('measurements', ['m1', 'yok']),
  ]);
  assert.deepEqual(ids(entities.measurements), ['m2', 'm3', 'm9']);
  assert.equal(entities.measurements.byId.get('m2').inputQuantity, 5);
  const back = applyPatch(entities, inverse).entities;
  assert.deepEqual(ids(back.measurements), ['m1', 'm2', 'm3']);
  assert.deepEqual(listOf(back.measurements), listOf(start.measurements));
  assert.equal(back.projects, start.projects, 'dokunulmayan tablolar aynı referans');
});

test('ters yama yalnız kendi kayıtlarını geri alır; arada yapılan başka değişiklik korunur', () => {
  const start = entitiesWith([measurement('m1')]);
  const first = applyPatch(start, [patch.upsert('measurements', [measurement('tmp-a')])]);
  const second = applyPatch(first.entities, [patch.upsert('measurements', [measurement('tmp-b')])]);
  // İlk işlem başarısız oldu: yalnız tmp-a gider.
  const rolledBack = applyPatch(second.entities, first.inverse).entities;
  assert.deepEqual(ids(rolledBack.measurements), ['m1', 'tmp-b']);
});

test('geri almanın da tersi vardır (yinele)', () => {
  const start = entitiesWith([measurement('m1'), measurement('m2')]);
  const removed = applyPatch(start, [patch.remove('measurements', ['m1'])]);
  const undone = applyPatch(removed.entities, removed.inverse);
  const redone = applyPatch(undone.entities, undone.inverse);
  assert.deepEqual(ids(redone.entities.measurements), ['m2']);
});

test('boş veya etkisiz yama aynı varlık nesnesini döner', () => {
  const start = entitiesWith([measurement('m1')]);
  assert.equal(applyPatch(start, []).entities, start);
  assert.equal(applyPatch(start, [patch.remove('measurements', ['yok'])]).entities, start);
  assert.deepEqual(applyPatch(start, [patch.remove('measurements', ['yok'])]).inverse, []);
});

// ---------------------------------------------------------------------------
// Seçiciler
// ---------------------------------------------------------------------------

function stateWith(entities, selection = { projectId: null, revisionId: null }) {
  return {
    entities: { ...emptyEntities(), ...entities },
    selection,
    loads: {},
    resources: {},
    busy: 0,
    dataVersion: 0,
  };
}

test('seçiciler girdi tablosu değişmedikçe aynı diziyi döner', () => {
  const revisions = tableFrom(
    [
      { id: 'r1', projectId: 'p1', status: 'Draft' },
      { id: 'r2', projectId: 'p1', status: 'Approved' },
      { id: 'r3', projectId: 'p2', status: 'Draft' },
    ],
    byId,
  );
  const state = stateWith({ revisions });
  const first = selectRevisionsOf(state, 'p1');
  assert.deepEqual(first.map(byId), ['r1', 'r2']);
  assert.equal(selectRevisionsOf(state, 'p1'), first);
  assert.equal(selectRevisionsOf({ ...state, busy: 1 }, 'p1'), first, 'ilgisiz değişiklik yeni dizi üretmez');
  assert.equal(selectRevisionsOf(state, 'yok'), selectRevisionsOf(state, null), 'boş sonuç ortak sabit');
  const measurements = tableFrom([measurement('m1'), measurement('m2', { placementId: 'pl2' })], byId);
  const withMeasurements = stateWith({ measurements });
  assert.deepEqual(selectMeasurementsOfPlacement(withMeasurements, 'pl1').map(byId), ['m1']);
});

test('onaylı revizyon kilitlidir', () => {
  const revisions = tableFrom(
    [
      { id: 'r1', projectId: 'p1', status: 'Draft' },
      { id: 'r2', projectId: 'p1', status: 'Approved' },
    ],
    byId,
  );
  assert.equal(selectIsRevisionLocked(stateWith({ revisions }, { projectId: 'p1', revisionId: 'r1' })), false);
  assert.equal(selectIsRevisionLocked(stateWith({ revisions }, { projectId: 'p1', revisionId: 'r2' })), true);
  assert.equal(selectIsRevisionLocked(stateWith({ revisions })), false);
});

const placement = (id, parentPlacementId = null, extra = {}) => ({
  id,
  revisionId: 'r1',
  parentPlacementId,
  displayName: id,
  ...extra,
});

test('proje ağacı derinlik öncelikli düzleşir; yetim ve döngüdeki kartlar kaybolmaz', () => {
  const placements = [
    placement('sistem'),
    placement('boru', 'sistem'),
    placement('dirsek', 'boru'),
    placement('vana', 'sistem'),
    placement('yetim', 'silinmis'),
    placement('a', 'b'),
    placement('b', 'a'),
  ];
  const rows = buildPlacementTree(placements);
  assert.deepEqual(
    rows.map((row) => [row.placement.id, row.depth, row.childCount]),
    [
      ['sistem', 0, 2],
      ['boru', 1, 1],
      ['dirsek', 2, 0],
      ['vana', 1, 0],
      ['yetim', 0, 0],
      ['a', 0, 1],
      ['b', 1, 0],
    ],
  );
  assert.deepEqual(rows[2].path, ['sistem', 'boru', 'dirsek']);
  assert.equal(buildPlacementTree(placements), rows, 'aynı dizi için önbellek');
});

test('2.000 satırlık ağaç hızlı kurulur', () => {
  const placements = [placement('kok')];
  for (let index = 0; index < 1999; index += 1)
    placements.push(placement(`k${index}`, index % 40 === 0 ? 'kok' : `k${index - 1}`));
  const started = performance.now();
  const rows = buildPlacementTree(placements);
  assert.equal(rows.length, 2000);
  assert.ok(performance.now() - started < 200, 'ağaç kurulumu 200 ms altında');
});

test('alt ağaç kimlikleri kartın kendisini ve bütün altını içerir', () => {
  const placements = [placement('s'), placement('b', 's'), placement('d', 'b'), placement('v', 's'), placement('x')];
  assert.deepEqual(subtreeIds(placements, 'b').sort(), ['b', 'd']);
  assert.deepEqual(subtreeIds(placements, 's').sort(), ['b', 'd', 's', 'v']);
});

test('özet sırası masaüstüyle aynı kural: derinlik, büyük çap önce, ad', () => {
  const placements = [placement('s'), placement('boru', 's'), placement('vana', 's')];
  const summary = (placementId, placementName, variant = null) => ({ placementId, placementName, variant });
  const sorted = sortSummariesForDisplay(
    [summary('vana', 'Vana'), summary('boru', 'Boru', 'DN20'), summary('boru', 'Boru', 'DN50'), summary('s', 'Sistem')],
    placements,
  );
  assert.deepEqual(
    sorted.map((item) => `${item.placementName}${item.variant ? ` ${item.variant}` : ''}`),
    ['Sistem', 'Boru DN50', 'Boru DN20', 'Vana'],
  );
});

test('memoizeLast yalnız argüman değişince yeniden hesaplar', () => {
  let calls = 0;
  const double = memoizeLast((value) => {
    calls += 1;
    return [value * 2];
  });
  const first = double(2);
  assert.equal(double(2), first);
  double(3);
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// Eylemler (sahte API)
// ---------------------------------------------------------------------------

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeApi(routes) {
  const calls = [];
  const handle = (method) => (path, body) => {
    calls.push([method, path, body]);
    const route = routes[`${method} ${path}`];
    if (!route) return Promise.reject(new ApiError(`tanımsız: ${method} ${path}`, 'test.missing'));
    return Promise.resolve(typeof route === 'function' ? route(body) : route);
  };
  return { calls, api: { get: handle('GET'), post: handle('POST'), put: handle('PUT'), delete: handle('DELETE') } };
}

const projects = [
  { id: 'p1', code: 'P-1', name: 'Villa' },
  { id: 'p2', code: 'P-2', name: 'Okul' },
];
const revisionData = (revisionId) => ({
  [`GET /revisions/${revisionId}/placements`]: [placement(`${revisionId}-kok`, null, { revisionId })],
  [`GET /revisions/${revisionId}/measurements`]: [measurement(`${revisionId}-m`, { revisionId })],
  [`GET /revisions/${revisionId}/measurement-summaries`]: [{ placementId: `${revisionId}-kok`, variant: null }],
});

test('açılış: ilk proje ve sunucunun ilk revizyonu açılır', async () => {
  const { api } = fakeApi({
    'GET /projects': projects,
    'GET /projects/p1/revisions': [
      { id: 'r2', projectId: 'p1', status: 'Draft' },
      { id: 'r1', projectId: 'p1', status: 'Approved' },
    ],
    ...revisionData('r2'),
  });
  const { store, actions } = createAppStore({ api });
  assert.equal(await actions.bootstrap(), true);
  const state = store.getState();
  assert.deepEqual(state.selection, { projectId: 'p1', revisionId: 'r2' });
  assert.deepEqual(ids(state.entities.placements), ['r2-kok']);
  assert.equal(state.entities.summaries.byId.size, 1);
  assert.equal(listOf(state.entities.summaries)[0].revisionId, 'r2', 'özetler revizyonla etiketlenir');
  assert.equal(state.loads[loadKeys.projects].status, 'ready');
  assert.equal(state.dataVersion, 1);
});

test('açılış: hatırlanan seçim varsa ona dönülür, yoksa ilk seçenek', async () => {
  const { api } = fakeApi({
    'GET /projects': projects,
    'GET /projects/p2/revisions': [
      { id: 'r5', projectId: 'p2', status: 'Draft' },
      { id: 'r4', projectId: 'p2', status: 'Approved' },
    ],
    ...revisionData('r4'),
    ...revisionData('r5'),
  });
  const { store, actions } = createAppStore({ api });
  await actions.bootstrap({ projectId: 'p2', revisionId: 'r4' });
  assert.deepEqual(store.getState().selection, { projectId: 'p2', revisionId: 'r4' });
  const second = createAppStore({ api });
  await second.actions.bootstrap({ projectId: 'p2', revisionId: 'silinmis' });
  assert.equal(second.store.getState().selection.revisionId, 'r5');
});

test('tam yenileme sürerken yerel bir yazma olduysa eski ölçüm yanıtı onu ezmez; ağaç yine güncellenir', async () => {
  const routes = {
    'GET /projects': projects,
    'GET /projects/p1/revisions': [{ id: 'r2', projectId: 'p1', status: 'Draft' }],
    ...revisionData('r2'),
  };
  let summaryCalls = 0;
  routes['GET /revisions/r2/measurement-summaries'] = () => {
    summaryCalls += 1;
    return [{ placementId: 'r2-kok', variant: null }];
  };
  const { api } = fakeApi(routes);
  const { store, actions } = createAppStore({ api });
  await actions.bootstrap();

  // Yenileme turunda ölçüm sorgusu yavaş; bu arada kullanıcı yeni bir ölçüm kaydeder.
  const slowMeasurements = deferred();
  routes['GET /revisions/r2/measurements'] = () => slowMeasurements.promise;
  routes['GET /revisions/r2/placements'] = [
    placement('r2-kok', null, { revisionId: 'r2' }),
    placement('r2-yeni', 'r2-kok', { revisionId: 'r2' }),
  ];
  const callsBefore = summaryCalls;
  const refresh = actions.refreshRevision();
  store.setState((state) => ({
    entities: applyPatch(state.entities, [
      patch.upsert('measurements', [measurement('r2-yerel', { revisionId: 'r2' })]),
    ]).entities,
  }));
  slowMeasurements.resolve([measurement('r2-m', { revisionId: 'r2' })]); // kayıttan önceki eski liste
  assert.equal(await refresh, true);

  const state = store.getState();
  assert.ok(state.entities.measurements.byId.has('r2-yerel'), 'araya giren yerel kayıt korunur');
  assert.deepEqual(ids(state.entities.placements), ['r2-kok', 'r2-yeni'], 'ağaç yine güncellenir');
  assert.ok(summaryCalls >= callsBefore + 2, 'eski özet yazılmaz, özetler ayrıca tazelenir');
});

test('araya yazma girmeyen tam yenileme ölçümleri ve özetleri sunucudan yeniler', async () => {
  const routes = {
    'GET /projects': projects,
    'GET /projects/p1/revisions': [{ id: 'r2', projectId: 'p1', status: 'Draft' }],
    ...revisionData('r2'),
  };
  const { api } = fakeApi(routes);
  const { store, actions } = createAppStore({ api });
  await actions.bootstrap();
  routes['GET /revisions/r2/measurements'] = [measurement('r2-sunucu', { revisionId: 'r2' })];
  assert.equal(await actions.refreshRevision(), true);
  assert.deepEqual(ids(store.getState().entities.measurements), ['r2-sunucu']);
});

test('geç gelen eski revizyon yanıtı yeni seçimi ezmez', async () => {
  const slow = deferred();
  const routes = { ...revisionData('r2') };
  routes['GET /revisions/r1/placements'] = () => slow.promise;
  routes['GET /revisions/r1/measurements'] = [];
  routes['GET /revisions/r1/measurement-summaries'] = [];
  const { api } = fakeApi(routes);
  const { store, actions } = createAppStore({ api });
  const first = actions.selectRevision('r1');
  await actions.selectRevision('r2');
  slow.resolve([placement('eski', null, { revisionId: 'r1' })]);
  assert.equal(await first, false);
  assert.deepEqual(ids(store.getState().entities.placements), ['r2-kok']);
});

test('yükleme hatası Türkçe metinle yükleme durumuna yazılır', async () => {
  const { api } = fakeApi({
    'GET /projects': () => Promise.reject(new ApiError('Veritabanı bakımda.', 'database.maintenance', true)),
  });
  const { store, actions } = createAppStore({ api });
  assert.equal(await actions.loadProjects(), false);
  assert.deepEqual(
    { status: store.getState().loads.projects.status, error: store.getState().loads.projects.error },
    { status: 'error', error: 'Veritabanı bakımda.' },
  );
  assert.equal(errorMessage(new TypeError('Failed to fetch')), 'İşlem tamamlanamadı. Tekrar deneyin.');
});

test('yeni proje listeye hemen eklenir ve seçilir; meşgul sayacı geri döner', async () => {
  const created = { id: 'p9', code: 'P-9', name: 'Yeni' };
  const { api, calls } = fakeApi({
    'POST /projects': created,
    'GET /projects': [created, ...projects],
    'GET /projects/p9/revisions': [{ id: 'r9', projectId: 'p9', status: 'Draft' }],
    ...revisionData('r9'),
  });
  const { store, actions } = createAppStore({ api });
  await actions.createProject({ code: ' P-9 ', name: 'Yeni ' });
  assert.deepEqual(calls[0], ['POST', '/projects', { code: 'P-9', name: 'Yeni', description: null }]);
  assert.equal(store.getState().selection.projectId, 'p9');
  assert.equal(store.getState().busy, 0);
});

test('kaynak önbelleği: bayatlatma, yükleme sürerken bayatlatma ve hata', async () => {
  const { api } = fakeApi({});
  const { store, actions } = createAppStore({ api });
  let calls = 0;
  await actions.loadResource('report:r1', async () => ({ n: ++calls }));
  assert.deepEqual(store.getState().resources['report:r1'].data, { n: 1 });
  assert.equal(store.getState().resources['report:r1'].stale, false);
  actions.invalidateResources('report:');
  assert.equal(store.getState().resources['report:r1'].stale, true);
  const gate = deferred();
  const loading = actions.loadResource('report:r1', () => gate.promise);
  assert.equal(store.getState().resources['report:r1'].status, 'loading');
  assert.deepEqual(store.getState().resources['report:r1'].data, { n: 1 }, 'eski veri görünmeye devam eder');
  actions.invalidateResources('report:r1');
  gate.resolve({ n: 2 });
  await loading;
  assert.equal(store.getState().resources['report:r1'].stale, true, 'yükleme sırasında bayatlatıldı');
  await actions.loadResource('report:r1', () => Promise.reject(new ApiError('Rapor üretilemedi.')));
  assert.equal(store.getState().resources['report:r1'].status, 'error');
  assert.equal(store.getState().resources['report:r1'].error, 'Rapor üretilemedi.');
  assert.deepEqual(store.getState().resources['report:r1'].data, { n: 2 });
});

test('kaynak önbelleği sınırlıdır', async () => {
  const { store, actions } = createAppStore({ api: fakeApi({}).api });
  for (let index = 0; index < 60; index += 1) await actions.loadResource(`k${index}`, async () => index);
  assert.ok(Object.keys(store.getState().resources).length <= 40);
  assert.equal(store.getState().resources.k59.data, 59);
});

// ---------------------------------------------------------------------------
// İyimser güncelleme ve geri al
// ---------------------------------------------------------------------------

function entityStore(measurements) {
  let state = { entities: entitiesWith(measurements) };
  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial };
    },
  };
}

function recordingFeedback() {
  const errors = [];
  const bars = [];
  return {
    errors,
    bars,
    error: (error, fallback) => errors.push(error instanceof ApiError ? error.message : fallback),
    undo: (request) => {
      const bar = { ...request, closed: false };
      bars.push(bar);
      return () => {
        bar.closed = true;
      };
    },
  };
}

test('iyimser ekleme: önce depo, sonra sunucu kaydıyla uzlaştırma', async () => {
  const store = entityStore([measurement('m1')]);
  const gate = deferred();
  const pending = runOptimistic(store, {
    ops: [patch.upsert('measurements', [measurement('tmp-1', { inputQuantity: 2 })])],
    request: () => gate.promise,
    reconcile: (saved) => [patch.remove('measurements', ['tmp-1']), patch.upsert('measurements', [saved])],
  });
  assert.deepEqual(ids(store.getState().entities.measurements), ['m1', 'tmp-1'], 'istek bitmeden görünür');
  gate.resolve(measurement('m2', { inputQuantity: 2 }));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(ids(store.getState().entities.measurements), ['m1', 'm2']);
});

test('iyimser güncelleme başarısızsa yalnız kendi değişikliği geri alınır ve hata gösterilir', async () => {
  const store = entityStore([measurement('m1', { inputQuantity: 1 })]);
  const feedback = recordingFeedback();
  const gate = deferred();
  const pending = runOptimistic(store, {
    ops: (entities) => [patch.upsert('measurements', [{ ...entities.measurements.byId.get('m1'), inputQuantity: 7 }])],
    request: () => gate.promise,
    feedback,
  });
  assert.equal(store.getState().entities.measurements.byId.get('m1').inputQuantity, 7);
  // Arada başka bir işlem yeni bir satır ekledi.
  store.setState({
    entities: applyPatch(store.getState().entities, [patch.upsert('measurements', [measurement('m2')])]).entities,
  });
  gate.reject(new ApiError('Revizyon kilitli.', 'revision.locked'));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(store.getState().entities.measurements.byId.get('m1').inputQuantity, 1);
  assert.deepEqual(ids(store.getState().entities.measurements), ['m1', 'm2']);
  assert.deepEqual(feedback.errors, ['Revizyon kilitli.']);
});

test('geri al: kayıt hemen kaybolur; "Geri al" geri getirir ve istek gitmez', async () => {
  const store = entityStore([measurement('m1'), measurement('m2')]);
  const feedback = recordingFeedback();
  let committed = 0;
  const handle = removeWithUndo(store, {
    ops: [patch.remove('measurements', ['m1'])],
    commit: async () => {
      committed += 1;
    },
    message: 'Satır silindi.',
    feedback,
  });
  assert.deepEqual(ids(store.getState().entities.measurements), ['m2']);
  assert.equal(feedback.bars[0].message, 'Satır silindi.');
  assert.equal(feedback.bars[0].actionLabel, 'Geri al');
  feedback.bars[0].onUndo();
  assert.equal(handle.state, 'undone');
  assert.deepEqual(ids(store.getState().entities.measurements), ['m1', 'm2']);
  assert.equal(feedback.bars[0].closed, true);
  feedback.bars[0].onCommit();
  await Promise.resolve();
  assert.equal(committed, 0, 'geri alınmış silme sonradan gönderilmez');
});

test('geri al süresi dolunca istek gider; sunucu reddederse kayıt geri gelir', async () => {
  const store = entityStore([measurement('m1')]);
  const feedback = recordingFeedback();
  let after = 0;
  const ok = removeWithUndo(store, {
    ops: [patch.remove('measurements', ['m1'])],
    commit: async () => undefined,
    onCommitted: () => {
      after += 1;
    },
    message: 'Silindi.',
    feedback,
  });
  feedback.bars[0].onCommit();
  await ok.commitNow();
  assert.equal(ok.state, 'committed');
  assert.equal(after, 1);
  assert.equal(store.getState().entities.measurements.byId.size, 0);

  const store2 = entityStore([measurement('m1')]);
  const failing = removeWithUndo(store2, {
    ops: [patch.remove('measurements', ['m1'])],
    commit: () => Promise.reject(new ApiError('Bu satır hesapta kullanılıyor.')),
    message: 'Silindi.',
    feedback,
  });
  await failing.commitNow();
  assert.equal(failing.state, 'failed');
  assert.deepEqual(ids(store2.getState().entities.measurements), ['m1']);
  assert.equal(feedback.errors.at(-1), 'Bu satır hesapta kullanılıyor.');
});

test('uygulama arka plana geçerken bekleyen silmeler gönderilir', async () => {
  const store = entityStore([measurement('m1'), measurement('m2')]);
  const feedback = recordingFeedback();
  const sent = [];
  for (const id of ['m1', 'm2'])
    removeWithUndo(store, {
      ops: [patch.remove('measurements', [id])],
      commit: async () => sent.push(id),
      message: 'Silindi.',
      feedback,
    });
  assert.equal(pendingRemovalCount(), 2);
  await flushPendingRemovals();
  assert.deepEqual(sent.sort(), ['m1', 'm2']);
  assert.equal(pendingRemovalCount(), 0);
  assert.ok(feedback.bars.every((bar) => bar.closed));
});

// ---------------------------------------------------------------------------
// Taslaklar
// ---------------------------------------------------------------------------

test('taslak anahtarı masaüstü desenini izler ve doğrulanır', () => {
  assert.equal(draftKey('fitting-draft', 'abc-123'), 'fitting-draft.v1.abc-123');
  assert.equal(draftKey('radiator-options', 'STD-EQ-RADIATOR', 2), 'radiator-options.v2.STD-EQ-RADIATOR');
  assert.throws(() => draftKey('Fitting Draft', 'x'));
  assert.throws(() => draftKey('fitting-draft', ''));
  assert.throws(() => draftKey('fitting-draft', 'a b'));
  assert.throws(() => draftKey('fitting-draft', 'x', 0));
});

test('bozuk taslak yok sayılır', () => {
  const isCounts = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  assert.deepEqual(parseDraft('{"a":1}', isCounts), { a: 1 });
  assert.equal(parseDraft('[1]', isCounts), null);
  assert.equal(parseDraft('{bozuk', isCounts), null);
  assert.equal(parseDraft(null, isCounts), null);
});

function manualClock() {
  let time = 0;
  const handles = [];
  return {
    now: () => time,
    timers: {
      set(callback, ms) {
        const handle = { callback, at: time + ms, cleared: false };
        handles.push(handle);
        return handle;
      },
      clear(handle) {
        handle.cleared = true;
      },
    },
    advance(ms) {
      time += ms;
      for (const handle of handles) {
        if (!handle.cleared && handle.at <= time) {
          handle.cleared = true;
          handle.callback();
        }
      }
    },
  };
}

test('yazım tamponu: son yazım kazanır, gecikmeyle boşalır', () => {
  const clock = manualClock();
  const writes = [];
  const buffer = createWriteBuffer({
    write: (key, value) => writes.push(['write', key, value]),
    clear: (key) => writes.push(['clear', key]),
    delayMs: 400,
    maxWaitMs: 2000,
    timers: clock.timers,
    now: clock.now,
  });
  buffer.set('a.v1.x', '1');
  buffer.set('a.v1.x', '12');
  buffer.remove('b.v1.y');
  assert.deepEqual(buffer.peek('a.v1.x'), { kind: 'write', valueJson: '12' });
  clock.advance(399);
  assert.equal(writes.length, 0);
  clock.advance(1);
  assert.deepEqual(writes, [
    ['write', 'a.v1.x', '12'],
    ['clear', 'b.v1.y'],
  ]);
  assert.equal(buffer.size, 0);
});

test('yazım tamponu: sürekli yazımda bile en geç maxWait içinde boşalır', () => {
  const clock = manualClock();
  const writes = [];
  const buffer = createWriteBuffer({
    write: (key, value) => writes.push(value),
    clear: () => undefined,
    delayMs: 400,
    maxWaitMs: 1000,
    timers: clock.timers,
    now: clock.now,
  });
  for (let index = 0; index < 10; index += 1) {
    buffer.set('k.v1.x', String(index));
    clock.advance(300);
  }
  assert.ok(writes.length >= 2, `yazım aç kalmamalı (yazımlar: ${writes.join(',')})`);
});

test('yazım tamponu: flush hemen yazar; bir anahtarın hatası ötekini engellemez', () => {
  const writes = [];
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const buffer = createWriteBuffer({
      write: (key, value) => {
        if (key === 'bozuk.v1.x') throw new Error('disk dolu');
        writes.push(value);
      },
      clear: () => undefined,
      timers: manualClock().timers,
    });
    buffer.set('bozuk.v1.x', '1');
    buffer.set('iyi.v1.x', '2');
    buffer.flush();
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(writes, ['2']);
});

test('taslak deposu: bekleyen yazım okunur, init sırasında yazılan değer kaybolmaz', async () => {
  const clock = manualClock();
  const server = { 'a.v1.x': '"sunucu"', 'b.v1.y': '"eski"' };
  const persisted = [];
  const load = deferred();
  const store = createDraftStore({
    load: () => load.promise,
    read: (map, key) => map[key] ?? null,
    write: (map, key, value) => {
      map[key] = value;
      persisted.push([key, value]);
    },
    clear: (map, key) => {
      delete map[key];
      persisted.push([key, null]);
    },
    timers: clock.timers,
    now: clock.now,
  });
  let readyCalls = 0;
  store.subscribe(() => readyCalls++);
  const init = store.init();
  assert.equal(store.ready, false);
  store.write('b.v1.y', '"yeni"');
  assert.equal(store.read('b.v1.y'), '"yeni"', 'henüz gönderilmemiş yazım okunur');
  store.flush();
  load.resolve(server);
  await init;
  assert.equal(store.ready, true);
  assert.equal(readyCalls, 1);
  assert.equal(store.read('a.v1.x'), '"sunucu"');
  assert.equal(store.read('b.v1.y'), '"yeni"', 'init sırasında yazılan değer sunucudakini ezer');
  store.write('a.v1.x', '"sunucu"');
  assert.equal(store.pendingCount, 0, 'aynı değer yeniden yazılmaz');
  store.clear('a.v1.x');
  assert.equal(store.read('a.v1.x'), null);
  store.flush();
  assert.deepEqual(persisted.at(-1), ['a.v1.x', null]);
});

test('taslak deposu: sunucu okunamazsa da hazır olur', async () => {
  const store = createDraftStore({
    load: () => Promise.reject(new Error('çevrimdışı')),
    read: () => null,
    write: () => undefined,
    clear: () => undefined,
  });
  await store.init();
  assert.equal(store.ready, true);
});
