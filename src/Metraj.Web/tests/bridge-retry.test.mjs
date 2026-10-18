// Bulgu 3 (çift kayıt) ve 7 (indirme temizliği): köprüde idempotency anahtarı,
// çekirdek hazırlığı beklenirken duran zaman aşımı sayacı ve release komutu.
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { api, ApiError, bridgeRetryKeys } from '../src/api.ts';
import { createRetryKeyRegistry, mutationSignature, RETRY_KEY_WINDOW_MS } from '../src/lib/retryKeys.ts';
import { createBridgeTransport, createIdFactory, parseIncomingMessage } from '../src/lib/transport.ts';

function fakeBridge() {
  const sent = [];
  let listener = null;
  const bridge = {
    postMessage(message) {
      sent.push(JSON.parse(message));
    },
    addEventListener(_type, next) {
      listener = next;
    },
    removeEventListener() {
      listener = null;
    },
  };
  const deliver = (data) => listener?.({ data: JSON.stringify(data) });
  return { bridge, sent, deliver };
}

function fakeTimers() {
  const handles = [];
  return {
    handles,
    timers: {
      set(callback, ms) {
        const handle = { callback, ms, cleared: false };
        handles.push(handle);
        return handle;
      },
      clear(handle) {
        handle.cleared = true;
      },
    },
    live: () => handles.filter((handle) => !handle.cleared),
  };
}

const response = (id, extra = {}) => ({
  type: 'response',
  id,
  status: 200,
  contentType: 'application/json',
  body: null,
  file: null,
  ...extra,
});

// --- Taşıma -----------------------------------------------------------------

test('idempotencyKey yalnız verildiğinde mesaja girer', () => {
  const { bridge, sent } = fakeBridge();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t'), timers: fakeTimers().timers });
  transport.request({ method: 'POST', path: '/api/a', body: '{}', idempotencyKey: 'k-1' }).catch(() => undefined);
  transport.request({ method: 'POST', path: '/api/b', body: '{}' }).catch(() => undefined);
  transport.dispose();
  assert.equal(sent[0].idempotencyKey, 'k-1');
  assert.equal(Object.hasOwn(sent[1], 'idempotencyKey'), false);
});

test('çekirdek beklenirken sayaç durur, işlem başlayınca TAM süreyle yeniden kurulur', async () => {
  const { bridge, deliver } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t'), timers: clock.timers });
  const pending = transport.request({ method: 'POST', path: '/api/x', body: '{}', timeoutMs: 60_000 });
  assert.equal(clock.live().length, 1);

  deliver({ type: 'progress', id: 't-1', stage: 'waiting' });
  assert.equal(clock.live().length, 0, 'bekleme süresince zaman aşımı sayacı yok');
  assert.equal(transport.pendingCount, 1);

  deliver({ type: 'progress', id: 't-1', stage: 'started' });
  const [restarted] = clock.live();
  assert.equal(restarted.ms, 60_000, 'bekleme isteğin süresinden yemez');

  deliver(response('t-1', { body: '"ok"' }));
  assert.equal((await pending).body, '"ok"');
  assert.equal(restarted.cleared, true);
});

test('başladıktan sonra yine de süre dolarsa zaman aşımı verilir', async () => {
  const { bridge, deliver } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t'), timers: clock.timers });
  const pending = transport.request({ method: 'GET', path: '/api/x', timeoutMs: 1000 });
  deliver({ type: 'progress', id: 't-1', stage: 'waiting' });
  deliver({ type: 'progress', id: 't-1', stage: 'started' });
  clock.live()[0].callback();
  await assert.rejects(pending, (error) => error.code === 'timeout');
});

test('süresiz istekte ilerleme sayaç kurmaz; bilinmeyen kimlik yok sayılır', async () => {
  const { bridge, deliver } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t'), timers: clock.timers });
  const pending = transport.request({ method: 'GET', path: '/api/x', timeoutMs: 0 });
  deliver({ type: 'progress', id: 't-1', stage: 'started' });
  deliver({ type: 'progress', id: 'bilinmeyen', stage: 'started' });
  assert.equal(clock.handles.length, 0);
  deliver(response('t-1'));
  await pending;
});

test('ilerleme mesajı doğrulanır', () => {
  assert.deepEqual(parseIncomingMessage('{"type":"progress","id":"a","stage":"waiting"}'), {
    kind: 'progress',
    id: 'a',
    stage: 'waiting',
  });
  assert.equal(parseIncomingMessage('{"type":"progress","id":"a","stage":"bitti"}').kind, 'invalid');
  assert.equal(parseIncomingMessage('{"type":"progress","stage":"started"}').kind, 'invalid');
});

// --- Anahtar kaydı -----------------------------------------------------------

test('anahtar kaydı: zaman aşımından sonra aynı imza aynı anahtarı alır; yanıt gelince unutulur', () => {
  let counter = 0;
  let now = 1_000;
  const registry = createRetryKeyRegistry({ createKey: () => `k${++counter}`, now: () => now });
  const signature = mutationSignature('POST', '/revisions/r1/measurements/batch', '[{"quantity":2.5}]');
  const first = registry.keyFor(signature);
  assert.equal(first, 'k1');
  assert.equal(registry.keyFor(signature), 'k2', 'zaman aşımı olmadan her istek yeni işlemdir');

  registry.timedOut(signature, first);
  assert.equal(registry.keyFor(signature), 'k1');
  assert.notEqual(registry.keyFor(mutationSignature('POST', '/revisions/r1/measurements/batch', '[{"quantity":3}]')), 'k1');

  registry.settled(signature);
  assert.equal(registry.keyFor(signature), 'k4', 'yanıt alındıktan sonraki aynı istek bilinçli yeni kayıttır');

  registry.timedOut(signature, 'k4');
  now += RETRY_KEY_WINDOW_MS + 1;
  assert.notEqual(registry.keyFor(signature), 'k4', 'pencere dolunca anahtar düşer');
  assert.equal(registry.size, 0);
});

// --- api.ts uçtan uca (sahte köprü + sahte saat) ------------------------------

function installBridge(respond) {
  const sent = [];
  let listener = null;
  const bridge = {
    postMessage(text) {
      const message = JSON.parse(text);
      sent.push(message);
      const reply = respond?.(message);
      if (reply)
        queueMicrotask(() =>
          listener({
            data: JSON.stringify({ type: 'response', id: message.id, contentType: 'application/json', body: null, file: null, ...reply }),
          }),
        );
    },
    addEventListener(_type, next) {
      listener = next;
    },
    removeEventListener() {
      listener = null;
    },
  };
  globalThis.window = { MetrajBridge: bridge };
  return { sent };
}

test.afterEach(() => {
  globalThis.window = {};
  mock.timers.reset();
});

test('api: zaman aşımına uğrayan mutasyonun yeniden denemesi AYNI anahtarla gider; GET anahtarsız', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let answer = false;
  const { sent } = installBridge(() => (answer ? { status: 200, body: '[{"id":"m1"}]' } : null));
  const body = [{ placementId: 'p1', quantity: 2.5 }];

  const first = api.post('/revisions/r1/measurements/batch', body).then(
    () => null,
    (error) => error,
  );
  mock.timers.tick(60_000);
  const error = await first;
  assert.ok(error instanceof ApiError);
  assert.equal(error.rule, 'transport.timeout');

  answer = true;
  assert.deepEqual(await api.post('/revisions/r1/measurements/batch', body), [{ id: 'm1' }]);
  assert.ok(sent[0].idempotencyKey, 'mutasyon anahtarla gider');
  assert.equal(sent[1].idempotencyKey, sent[0].idempotencyKey, 'yerel taraf ikinci denemeyi ilkine bağlar');

  await api.post('/revisions/r1/measurements/batch', body);
  assert.notEqual(sent[2].idempotencyKey, sent[0].idempotencyKey, 'yanıt alındıktan sonra yeni işlem');
  assert.equal(bridgeRetryKeys.size, 0);

  await api.get('/projects');
  assert.equal(Object.hasOwn(sent[3], 'idempotencyKey'), false);
});

test('api: farklı gövdeli istek zaman aşımına uğramış anahtarı devralmaz', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let answer = false;
  const { sent } = installBridge(() => (answer ? { status: 204 } : null));
  const first = api.put('/measurements/m1', { quantity: 1 }).catch(() => undefined);
  mock.timers.tick(60_000);
  await first;
  answer = true;
  await api.put('/measurements/m1', { quantity: 2 });
  assert.notEqual(sent[1].idempotencyKey, sent[0].idempotencyKey);
  await api.put('/measurements/m1', { quantity: 1 });
  assert.equal(sent[2].idempotencyKey, sent[0].idempotencyKey);
});
