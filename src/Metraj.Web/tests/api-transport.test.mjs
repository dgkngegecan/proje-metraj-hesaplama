// api.ts iki taşımada (köprü ve fetch) aynı sözleşmeyi sunmalı. Masaüstü
// imzaları değişmez; köprü yalnız window.MetrajBridge varken devreye girer.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  api,
  ApiError,
  bridgeTimeoutFor,
  BRIDGE_DEFAULT_TIMEOUT_MS,
  BRIDGE_LONG_TIMEOUT_MS,
  fileNameFromContentDisposition,
  readBridgeResponse,
  setDownloadPresenter,
} from '../src/api.ts';

/** Her çağrıda yeni bir köprü kurulur; api.ts köprü nesnesi başına bir taşıma tutar. */
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
            data: JSON.stringify({
              type: 'response',
              id: message.id,
              contentType: 'application/json',
              body: null,
              file: null,
              ...reply,
            }),
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
  return { sent, emit: (data) => listener({ data: JSON.stringify(data) }) };
}

function removeBridge() {
  globalThis.window = {};
}

function captureError(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}

const apiErrorShape = (error) =>
  error instanceof ApiError
    ? { kind: 'ApiError', message: error.message, rule: error.rule, isServerFault: error.isServerFault }
    : { kind: error?.constructor?.name, message: String(error?.message) };

test.afterEach(() => {
  removeBridge();
  setDownloadPresenter(null);
});

test('köprü: GET yolu /api önekiyle gider, JSON metni gövde ayrıştırılır', async () => {
  const { sent } = installBridge(() => ({ status: 200, body: '[{"id":"p1"}]' }));
  assert.deepEqual(await api.get('/projects'), [{ id: 'p1' }]);
  assert.equal(sent[0].type, 'request');
  assert.equal(sent[0].method, 'GET');
  assert.equal(sent[0].path, '/api/projects');
  assert.equal(sent[0].body, null);
});

test('köprü: post/put gövdeyi JSON METNİ olarak gönderir; gövdesiz post null', async () => {
  const { sent } = installBridge(() => ({ status: 200, body: '{}' }));
  await api.post('/projects', { code: 'P-1', name: 'Villa' });
  await api.post('/revisions/r1/approve');
  await api.put('/ui-state', { key: 'a.v1.x', valueJson: '1' });
  await api.delete('/measurements/m1');
  assert.deepEqual(
    sent.map(({ method, path, body }) => [method, path, body]),
    [
      ['POST', '/api/projects', '{"code":"P-1","name":"Villa"}'],
      ['POST', '/api/revisions/r1/approve', null],
      ['PUT', '/api/ui-state', '{"key":"a.v1.x","valueJson":"1"}'],
      ['DELETE', '/api/measurements/m1', null],
    ],
  );
});

// Aynı HTTP sonucu iki taşımadan da aynı sonucu/hatayı üretmeli.
const scenarios = [
  { name: '200 JSON', status: 200, body: '{"id":"x","n":1.25}' },
  { name: '201 JSON', status: 201, body: '[1,2,3]' },
  { name: '204', status: 204, body: null },
  { name: '400 kural', status: 400, body: '{"message":"Birim uyumsuz.","rule":"measurement.unit"}' },
  { name: '400 boş gövde', status: 400, body: null },
  { name: '404 JSON olmayan', status: 404, body: 'Not Found' },
  { name: '409 yalnız mesaj', status: 409, body: '{"message":"Revizyon kilitli."}' },
  { name: '500 genel', status: 500, body: '{"message":"Beklenmeyen bir hata oluştu.","rule":"server.error"}' },
  { name: '503 boş', status: 503, body: null },
];

for (const scenario of scenarios) {
  test(`fetch ve köprü aynı davranır: ${scenario.name}`, async () => {
    removeBridge();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(scenario.body, { status: scenario.status });
    let viaFetch;
    try {
      viaFetch = await captureError(api.get('/x'));
    } finally {
      globalThis.fetch = originalFetch;
    }
    installBridge(() => ({ status: scenario.status, body: scenario.body }));
    const viaBridge = await captureError(api.get('/x'));
    if (viaFetch.error) {
      assert.ok(viaBridge.error, 'köprü de hata vermeli');
      assert.deepEqual(apiErrorShape(viaBridge.error), apiErrorShape(viaFetch.error));
      assert.equal(viaBridge.error.isServerFault, scenario.status >= 500);
    } else {
      assert.deepEqual(viaBridge.value, viaFetch.value);
    }
  });
}

test('köprü: FormData yüklemesi açık bir hata verir (ikili içerik köprüden geçmez)', async () => {
  const { sent } = installBridge(() => ({ status: 200, body: '{}' }));
  const result = await captureError(api.upload('/workspace/import', new FormData()));
  assert.ok(result.error instanceof ApiError);
  assert.equal(result.error.rule, 'transport.upload-unsupported');
  assert.equal(sent.length, 0);
});

test('köprü: zaman aşımı ApiError(transport.timeout, sunucu arızası) olur', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  installBridge(() => null);
  const pending = captureError(api.get('/projects'));
  t.mock.timers.tick(BRIDGE_DEFAULT_TIMEOUT_MS);
  const { error } = await pending;
  assert.ok(error instanceof ApiError);
  assert.equal(error.rule, 'transport.timeout');
  assert.equal(error.isServerFault, true);
});

test('köprü: postMessage çökerse ApiError(transport.unavailable)', async () => {
  globalThis.window = {
    MetrajBridge: {
      postMessage() {
        throw new Error('detached');
      },
      addEventListener() {},
    },
  };
  const { error } = await captureError(api.get('/projects'));
  assert.equal(error.rule, 'transport.unavailable');
  assert.equal(error.isServerFault, true);
});

test('ağır uçlar uzun süre sınırı alır', () => {
  for (const path of [
    '/database/backups',
    '/database/backups/restore',
    '/workspace/export',
    '/catalog/starter-pack',
    '/synthetic-clean-water',
    '/revisions/r1/report',
    '/revisions/r1/report/pdf',
  ])
    assert.equal(bridgeTimeoutFor(path), BRIDGE_LONG_TIMEOUT_MS, path);
  for (const path of ['/projects', '/revisions/r1/measurements', '/catalog/cards', '/ui-state'])
    assert.equal(bridgeTimeoutFor(path), BRIDGE_DEFAULT_TIMEOUT_MS, path);
});

const pdfFile = { handle: 'h-42', name: 'P-001-R1.pdf', mime: 'application/pdf', size: 2048 };

test('download (köprü): dosya tutamacı sunucuya, sonra seçilen komuta gider', async () => {
  const { sent } = installBridge((message) =>
    message.type === 'request' ? { status: 200, contentType: 'application/pdf', file: pdfFile } : null,
  );
  const offered = [];
  setDownloadPresenter(async (file) => {
    offered.push(file);
    return 'share';
  });
  const result = await api.download('/revisions/r1/report/pdf', 'Metraj.pdf');
  assert.deepEqual(offered, [pdfFile]);
  assert.deepEqual(result, { name: 'P-001-R1.pdf', mime: 'application/pdf', size: 2048, outcome: 'share' });
  assert.equal(sent[0].path, '/api/revisions/r1/report/pdf');
  assert.deepEqual(
    { type: sent[1].type, command: sent[1].command, args: sent[1].args },
    { type: 'command', command: 'share', args: { handle: 'h-42' } },
  );
});

test('download (köprü): sunucu ad vermezse önerilen ad; sunucu kaydı yoksa saveAs', async () => {
  const { sent } = installBridge((message) =>
    message.type === 'request' ? { status: 200, file: { ...pdfFile, name: '' } } : null,
  );
  const result = await api.download('/workspace/export', 'ProjeMetraj.metraj');
  assert.equal(result.name, 'ProjeMetraj.metraj');
  assert.equal(result.outcome, 'saveAs');
  assert.equal(sent[1].command, 'saveAs');
});

test('download (köprü): vazgeçilirse yalnız release gider; hata ve dosyasız yanıt ApiError', async () => {
  let mode = 'file';
  const { sent } = installBridge((message) => {
    if (message.type !== 'request') return null;
    if (mode === 'error') return { status: 400, body: '{"message":"Rapor boş.","rule":"report.empty"}' };
    if (mode === 'nofile') return { status: 200, body: '{}' };
    return { status: 200, file: pdfFile };
  });
  setDownloadPresenter(async () => null);
  assert.equal((await api.download('/revisions/r1/report/pdf', 'x.pdf')).outcome, 'cancelled');
  // Bulgu 7: vazgeçilen dosya yerel önbellekte kalmasın diye tutamaç bırakılır;
  // paylaş/kaydet komutu gönderilmez.
  assert.deepEqual(
    sent.filter((message) => message.type === 'command').map(({ command, args }) => ({ command, args })),
    [{ command: 'release', args: { handle: 'h-42' } }],
  );
  mode = 'error';
  assert.equal((await captureError(api.download('/revisions/r1/report/pdf', 'x.pdf'))).error.rule, 'report.empty');
  mode = 'nofile';
  assert.equal((await captureError(api.download('/revisions/r1/report/pdf', 'x.pdf'))).error.rule, 'transport.no-file');
});

test('importWorkspace (köprü): pickAndImport yanıtı; 204 = vazgeçti; hata ApiError', async () => {
  let reply = { status: 200, body: '{"importedProjects":2,"skippedProjects":1}' };
  const { sent } = installBridge((message) => (message.type === 'command' ? reply : null));
  assert.deepEqual(await api.importWorkspace(), { importedProjects: 2, skippedProjects: 1 });
  assert.equal(sent[0].command, 'pickAndImport');
  assert.deepEqual(sent[0].args, {});
  reply = { status: 204, body: null };
  assert.equal(await api.importWorkspace(), null);
  reply = { status: 400, body: '{"message":"Dosya bozuk.","rule":"workspace-import.invalid"}' };
  const { error } = await captureError(api.importWorkspace());
  assert.equal(error.rule, 'workspace-import.invalid');
});

test('readBridgeResponse doğrudan da kullanılabilir', () => {
  assert.deepEqual(readBridgeResponse({ status: 200, body: '{"a":1}' }), { a: 1 });
  assert.equal(readBridgeResponse({ status: 200, body: null }), undefined);
  assert.throws(() => readBridgeResponse({ status: 422, body: '{"message":"m","rule":"r"}' }), {
    message: 'm',
    rule: 'r',
    isServerFault: false,
  });
});

test('Content-Disposition: filename* (UTF-8) önceliklidir; düz ad yedek', () => {
  assert.equal(
    fileNameFromContentDisposition("attachment; filename=Metraj-_zet.xlsx; filename*=UTF-8''Metraj-%C3%96zet.xlsx"),
    'Metraj-Özet.xlsx',
  );
  assert.equal(fileNameFromContentDisposition('attachment; filename="P-001 R1.pdf"'), 'P-001 R1.pdf');
  assert.equal(fileNameFromContentDisposition('attachment; filename=Rapor.docx'), 'Rapor.docx');
  assert.equal(fileNameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A"), null);
  assert.equal(fileNameFromContentDisposition('attachment'), null);
  assert.equal(fileNameFromContentDisposition(null), null);
});

test('köprü yokken masaüstü fetch yolu aynen kalır (başlıklar, yöntem, gövde)', async () => {
  removeBridge();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    await api.post('/projects', { code: 'P' });
    await api.get('/projects');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].url, '/api/projects');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"code":"P"}');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
  assert.equal(calls[1].init.headers, undefined);
});
