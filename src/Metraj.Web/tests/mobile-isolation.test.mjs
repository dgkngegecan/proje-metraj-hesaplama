// Kaynak düzeyinde yalıtım: mobile.html → src/mobile/main.tsx'ten erişilen hiçbir
// modül @xyflow/react'i içe aktarmaz — `import type` bile. (Tip içe aktarması
// derlemede silinir, yani derleme çıktısı testi bunu göremez; ama böyle bir
// modül mobil grafiğe girdiğinde yarın biri değer içe aktarması eklerse React
// Flow sessizce mobil pakete girer.) Masaüstü kabuğu (App.tsx) da grafikte yok.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECIFIER =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ])
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate;
  throw new Error(`${path.relative(projectDir, fromFile)}: '${specifier}' çözülemedi`);
}

function moduleGraph(entry) {
  const modules = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (modules.has(file)) continue;
    // Yorumlardaki örnek içe aktarmalar (JSDoc) sayılmaz.
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    const packages = [];
    modules.set(file, packages);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('.')) queue.push(resolveLocal(file, specifier));
      else packages.push(specifier);
    }
  }
  return modules;
}

const entry = path.join(projectDir, 'src', 'mobile', 'main.tsx');
const graph = moduleGraph(entry);
const relative = (file) => path.relative(projectDir, file).replace(/\\/g, '/');

test('mobil kaynak grafiği taranabiliyor ve sekme ekranlarını içeriyor', () => {
  const files = [...graph.keys()].map(relative);
  for (const screen of [
    'project/ProjectScreen',
    'output/OutputScreen',
    'library/LibraryScreen',
    'settings/SettingsScreen',
  ])
    assert.ok(files.includes(`src/mobile/screens/${screen}.tsx`), `${screen} grafikte`);
  assert.ok(files.includes('src/api.ts'), 'paylaşılan api.ts kullanılıyor');
});

test('mobil grafikteki hiçbir modül @xyflow/react içe aktarmıyor (tip içe aktarması dahil)', () => {
  const offenders = [...graph]
    .filter(([, packages]) => packages.some((name) => name.startsWith('@xyflow/')))
    .map(([file]) => relative(file));
  assert.deepEqual(offenders, []);
});

test("masaüstü kabuğu ve React Flow'a bağlı paylaşılan modüller mobil grafikte değil", () => {
  const files = new Set([...graph.keys()].map(relative));
  for (const desktopOnly of [
    'src/App.tsx',
    'src/main.tsx',
    'src/lib/flow.ts',
    'src/lib/uiTypes.ts',
    'src/components/FlowCard.tsx',
  ])
    assert.equal(files.has(desktopOnly), false, desktopOnly);
});

test('kendi kendini sınama: masaüstü grafiğinde @xyflow/react bulunuyor', () => {
  const desktop = moduleGraph(path.join(projectDir, 'src', 'main.tsx'));
  assert.ok([...desktop.values()].some((packages) => packages.includes('@xyflow/react')));
});
