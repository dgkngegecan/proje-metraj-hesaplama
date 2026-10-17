// Köprü sözleşmesinin JS tarafı (docs/android-mobil-plan.md → "Köprü sözleşmesi").
// Sahte bir MetrajBridge ile mesaj biçimi, yanıt eşleme, zaman aşımı ve olaylar sınanır.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BridgeTransportError,
  createBridgeTransport,
  createIdFactory,
  parseIncomingMessage,
} from '../src/lib/transport.ts';

function fakeBridge({ eventTarget = true } = {}) {
  const sent = [];
  let listener = null;
  const bridge = {
    postMessage(message) {
      assert.equal(typeof message, 'string', 'köprüye yalnız JSON metni gider');
      sent.push(JSON.parse(message));
    },
  };
  if (eventTarget) {
    bridge.addEventListener = (type, next) => {
      assert.equal(type, 'message');
      listener = next;
    };
    bridge.removeEventListener = (_type, next) => {
      if (listener === next) listener = null;
    };
  }
  const deliver = (data) => {
    const target = listener ?? bridge.onmessage;
    target?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  };
  return { bridge, sent, deliver, attached: () => Boolean(listener ?? bridge.onmessage) };
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
    fire(handle) {
      if (!handle.cleared) handle.callback();
    },
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

test('istek mesajı sözleşmedeki alanlarla ve JSON metni gövdeyle gider', async () => {
  const { bridge, sent, deliver } = fakeBridge();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t') });
  const pending = transport.request({ method: 'POST', path: '/api/projects?x=1', body: '{"code":"P-1"}' });
  assert.deepEqual(sent, [
    { type: 'request', id: 't-1', method: 'POST', path: '/api/projects?x=1', body: '{"code":"P-1"}' },
  ]);
  deliver(response('t-1', { body: '{"id":"p1"}' }));
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"id":"p1"}');
  assert.equal(transport.pendingCount, 0);
});

test('gövdesiz istek body:null gönderir', () => {
  const { bridge, sent } = fakeBridge();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t'), timers: fakeTimers().timers });
  transport.request({ method: 'GET', path: '/api/health' }).catch(() => undefined);
  transport.dispose();
  assert.equal(sent[0].body, null);
  assert.ok(Object.hasOwn(sent[0], 'body'), 'body alanı her zaman bulunur');
});

test('yanıtlar kimliğe göre eşlenir; sıra dışı gelse de doğru isteğe gider', async () => {
  const { bridge, deliver } = fakeBridge();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t') });
  const first = transport.request({ method: 'GET', path: '/api/a' });
  const second = transport.request({ method: 'GET', path: '/api/b' });
  deliver(response('t-2', { body: '"b"' }));
  deliver(response('bilinmeyen', { body: '"x"' }));
  deliver(response('t-1', { body: '"a"' }));
  assert.equal((await first).body, '"a"');
  assert.equal((await second).body, '"b"');
});

test('zaman aşımı BridgeTransportError(timeout) verir; geç yanıt yok sayılır', async () => {
  const { bridge, deliver } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('t'), timers: clock.timers });
  const pending = transport.request({ method: 'GET', path: '/api/slow', timeoutMs: 1500 });
  assert.equal(clock.handles[0].ms, 1500);
  clock.fire(clock.handles[0]);
  await assert.rejects(pending, (error) => error instanceof BridgeTransportError && error.code === 'timeout');
  assert.equal(transport.pendingCount, 0);
  assert.doesNotThrow(() => deliver(response('t-1', { body: '"geç"' })));
});

test('yanıt gelince zamanlayıcı iptal edilir; varsayılan süre uygulanır', async () => {
  const { bridge, deliver } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, {
    createId: createIdFactory('t'),
    timers: clock.timers,
    defaultTimeoutMs: 4321,
  });
  const pending = transport.request({ method: 'GET', path: '/api/x' });
  assert.equal(clock.handles[0].ms, 4321);
  deliver(response('t-1'));
  await pending;
  assert.equal(clock.handles[0].cleared, true);
});

test('timeoutMs:0 süre sınırı koymaz', () => {
  const { bridge } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, { timers: clock.timers });
  transport.request({ method: 'GET', path: '/api/x', timeoutMs: 0 }).catch(() => undefined);
  assert.equal(clock.handles.length, 0);
  assert.equal(transport.pendingCount, 1);
});

test('postMessage hata verirse istek "unavailable" ile reddedilir ve bekleyen kalmaz', async () => {
  const transport = createBridgeTransport({
    postMessage() {
      throw new Error('detached');
    },
    addEventListener() {},
  });
  await assert.rejects(
    transport.request({ method: 'GET', path: '/api/x' }),
    (error) => error instanceof BridgeTransportError && error.code === 'unavailable',
  );
  assert.equal(transport.pendingCount, 0);
});

test('olaylar dinleyicilere dağıtılır; kaldırılan dinleyici çağrılmaz', () => {
  const { bridge, deliver } = fakeBridge();
  const transport = createBridgeTransport(bridge);
  const calls = [];
  const offBack = transport.on('back', () => calls.push('back'));
  // Kendini kaldıran tek seferlik dinleyici dağıtımı bozmamalı.
  const offOnce = transport.on('back', () => {
    calls.push('once');
    offOnce();
  });
  transport.on('pause', () => calls.push('pause'));
  deliver({ type: 'event', event: 'back' });
  deliver({ type: 'event', event: 'pause' });
  deliver({ type: 'event', event: 'back' });
  offBack();
  deliver({ type: 'event', event: 'back' });
  deliver({ type: 'event', event: 'resume' });
  assert.deepEqual(calls, ['back', 'once', 'pause', 'back']);
});

test('hata veren bir olay dinleyicisi diğerlerini durdurmaz', () => {
  const { bridge, deliver } = fakeBridge();
  const transport = createBridgeTransport(bridge);
  const calls = [];
  const originalError = console.error;
  console.error = () => undefined;
  try {
    transport.on('pause', () => {
      throw new Error('boom');
    });
    transport.on('pause', () => calls.push('ikinci'));
    deliver({ type: 'event', event: 'pause' });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(calls, ['ikinci']);
});

test('sözleşmeye uymayan mesajlar raporlanır, uygulamayı düşürmez', () => {
  const problems = [];
  const { bridge, deliver } = fakeBridge();
  createBridgeTransport(bridge, { onProtocolError: (reason) => problems.push(reason) });
  deliver('{bozuk');
  deliver({ type: 'response', status: 200 });
  deliver({ type: 'response', id: 'x', status: '200' });
  deliver({ type: 'response', id: 'x', status: 200, file: { name: 'tutamaçsız' } });
  deliver({ type: 'telemetry' });
  deliver({ type: 'event' });
  assert.equal(problems.length, 6);
});

test('yanıt ayrıştırma: nesne gövde metne çevrilir, dosya tutamacı okunur', () => {
  const parsed = parseIncomingMessage(
    JSON.stringify({
      type: 'response',
      id: 'r1',
      status: 200,
      contentType: 'application/pdf',
      body: { yanlislikla: 'nesne' },
      file: { handle: 'h-1', name: 'Rapor.pdf', mime: 'application/pdf', size: 12345 },
    }),
  );
  assert.equal(parsed.kind, 'response');
  assert.equal(parsed.response.body, '{"yanlislikla":"nesne"}');
  assert.deepEqual(parsed.response.file, { handle: 'h-1', name: 'Rapor.pdf', mime: 'application/pdf', size: 12345 });
  const empty = parseIncomingMessage({ type: 'response', id: 'r2', status: 204 });
  assert.equal(empty.response.body, null);
  assert.equal(empty.response.file, null);
  assert.equal(empty.response.contentType, '');
});

test('addEventListener yoksa onmessage kullanılır; dispose dinleyiciyi söker', () => {
  const { bridge, deliver, attached } = fakeBridge({ eventTarget: false });
  const transport = createBridgeTransport(bridge);
  assert.equal(typeof bridge.onmessage, 'function');
  let backs = 0;
  transport.on('back', () => backs++);
  deliver({ type: 'event', event: 'back' });
  transport.dispose();
  assert.equal(attached(), false);
  assert.equal(backs, 1);
});

test('dispose bekleyen istekleri reddeder ve zamanlayıcıları temizler', async () => {
  const { bridge } = fakeBridge();
  const clock = fakeTimers();
  const transport = createBridgeTransport(bridge, { timers: clock.timers });
  const pending = transport.request({ method: 'GET', path: '/api/x' });
  transport.dispose();
  await assert.rejects(pending, (error) => error.code === 'disposed');
  assert.equal(clock.handles[0].cleared, true);
  await assert.rejects(transport.request({ method: 'GET', path: '/api/y' }), (error) => error.code === 'disposed');
});

test('komutlar: gönder-unut biçimi ve yanıt bekleyen komut', async () => {
  const { bridge, sent, deliver } = fakeBridge();
  const transport = createBridgeTransport(bridge, { createId: createIdFactory('c') });
  assert.equal(await transport.command('haptic', { kind: 'tick' }), undefined);
  assert.equal(transport.pendingCount, 0, 'gönder-unut komut bekleyen bırakmaz');
  await transport.command('ready');
  assert.deepEqual(sent, [
    { type: 'command', id: 'c-1', command: 'haptic', args: { kind: 'tick' } },
    { type: 'command', id: 'c-2', command: 'ready', args: {} },
  ]);
  const picked = transport.command('pickAndImport', {}, { awaitResponse: true, timeoutMs: 0 });
  assert.equal(sent[2].command, 'pickAndImport');
  deliver(response(sent[2].id, { body: '{"importedProjects":2}' }));
  assert.equal((await picked).body, '{"importedProjects":2}');
});

test('kimlik üreteci benzersiz kimlikler üretir', () => {
  const next = createIdFactory();
  const ids = new Set(Array.from({ length: 500 }, next));
  assert.equal(ids.size, 500);
  assert.notEqual(createIdFactory()(), createIdFactory()(), 'sayfa yüklemeleri ayrı ön ek alır');
});
