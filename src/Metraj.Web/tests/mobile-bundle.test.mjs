// Mobil paketin derleme çıktısı üzerinde iki kilitli karar:
//   1. React Flow (@xyflow/react) mobil sayfanın erişebildiği HİÇBİR parçada yok.
//   2. Mobil ilk JS (giriş + başlangıç sekmesi) < 250 KB gzip.
// Test, eski bir dist/'e güvenmemek için projeyi node_modules/.cache altına
// taze derler (Vite JS API'si, ~1-2 sn). Ayrıntılı tablo: npm run check:mobile.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { analyzeBundle, MOBILE_INITIAL_JS_BUDGET_BYTES, violations } from '../scripts/mobile-bundle.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectDir, 'node_modules', '.cache', 'metraj-bundle-check');

let report;

test.before(async () => {
  await build({
    root: projectDir,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  report = analyzeBundle(outDir);
});

test.after(() => rmSync(outDir, { recursive: true, force: true }));

test('React Flow mobil sayfanın erişebildiği hiçbir JS parçasında yok', () => {
  assert.ok(report.mobile.reachable.length >= 3, 'mobil grafik taranabildi');
  assert.deepEqual(report.mobile.reactFlowHits, []);
});

test("React Flow stilleri mobil CSS'e girmiyor", () => {
  assert.ok(report.mobile.styles.length >= 1);
  assert.deepEqual(report.mobile.reactFlowStylesheets, []);
});

test("denetim kör değil: aynı işaretler masaüstü paketinde React Flow'u buluyor", () => {
  assert.ok(report.desktop.reactFlowHits.length >= 1, 'masaüstünde React Flow izi bulunmalı');
  const mobileOnly = report.mobile.reachable.filter((file) => !report.desktop.reachable.includes(file));
  assert.ok(mobileOnly.length >= 1, 'mobil giriş masaüstünden ayrı parçalara sahip');
});

test(`mobil ilk JS ${MOBILE_INITIAL_JS_BUDGET_BYTES / 1000} kB gzip bütçesinin altında`, () => {
  const summary = report.mobile.initialFiles.map((item) => `${item.file}=${item.gzip}`).join(', ');
  assert.ok(
    report.mobile.initialGzip < MOBILE_INITIAL_JS_BUDGET_BYTES,
    `ilk JS ${report.mobile.initialGzip} B gzip (${summary})`,
  );
  // Başlangıç sekmesi dışındaki sekmeler ayrı (tembel) parçalarda kalmalı.
  for (const screen of ['OutputScreen', 'LibraryScreen', 'SettingsScreen'])
    assert.ok(
      report.mobile.lazyFiles.some((item) => path.posix.basename(item.file).startsWith(`${screen}-`)),
      `${screen} tembel yüklenmeli`,
    );
  assert.deepEqual(violations(report), []);
});
