// Mobil paket denetimi: ilk JS bütçesi ve React Flow'un mobil grafikte olmaması.
//
//   npm run build && npm run check:mobile        (dist/ üzerinde)
//   node scripts/mobile-bundle.mjs <dist klasörü>
//
// Derleme çıktısı TARANIR (kaynak değil): mobile.html'in yüklediği giriş
// parçasından başlayıp statik ve dinamik `import`'lar izlenerek mobil
// sayfanın erişebildiği BÜTÜN parçalar bulunur. Bu parçaların hiçbiri React
// Flow kodu içermemelidir. Aynı tarama masaüstü (index.html) üzerinde de
// yapılır ve React Flow'u BULMASI beklenir: işaretler eskirse (React Flow
// sürümü değişir, sınıf adları değişir) denetim sessizce geçmez, düşer.
//
// "İlk JS" = giriş + statik içe aktardıkları + açılışta yüklenen başlangıç
// sekmesi (Proje) parçası ve onun statik içe aktardıkları. Ölçü gzip
// (zlib varsayılan seviye) baytıdır.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Plan belgesi → Performans bütçeleri: "Mobil ilk JS paketi < 250 KB gzip". */
export const MOBILE_INITIAL_JS_BUDGET_BYTES = 250_000;

/** Açılışta (başlangıç sekmesi) dinamik olarak yüklenen parçalar; AppShell'deki START_TAB ile aynı. */
export const STARTUP_LAZY_CHUNKS = ['ProjectScreen'];

/** React Flow'un derleme çıktısında bıraktığı izler (sınıf adları, paket adı). */
export const REACT_FLOW_MARKERS = [/react-flow__/, /@xyflow/, /xyflow\.com|reactflow\.dev/];

const STATIC_IMPORT = /(?:import|export)\s*(?:[^'"`;()]*?\bfrom\s*)?["'`](\.\/[^"'`]+?\.js)["'`]/g;
const DYNAMIC_IMPORT = /import\(\s*["'`](\.\/[^"'`]+?\.js)["'`]\s*\)/g;

/** HTML girişinin yüklediği betik, ön yükleme ve stil dosyaları (dist'e göreli yollar). */
export function readHtmlAssets(distDir, htmlFile) {
  const html = readFileSync(path.join(distDir, htmlFile), 'utf8');
  const attr = (pattern) => [...html.matchAll(pattern)].map((match) => match[1].replace(/^\//, ''));
  return {
    scripts: attr(/<script[^>]*type="module"[^>]*src="([^"]+)"/g),
    preloads: attr(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
    styles: attr(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
  };
}

function importsOf(distDir, file) {
  const source = readFileSync(path.join(distDir, file), 'utf8');
  const dir = path.posix.dirname(file);
  const resolve = (specifier) => path.posix.normalize(path.posix.join(dir, specifier));
  return {
    source,
    statics: [...source.matchAll(STATIC_IMPORT)].map((match) => resolve(match[1])),
    dynamics: [...source.matchAll(DYNAMIC_IMPORT)].map((match) => resolve(match[1])),
  };
}

/** Başlangıç dosyalarından statik içe aktarma kapanışı; dinamik içe aktarılanlar ayrıca döner. */
export function staticClosure(distDir, roots) {
  const files = new Set();
  const dynamic = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    const { statics, dynamics } = importsOf(distDir, file);
    queue.push(...statics);
    for (const target of dynamics) dynamic.add(target);
  }
  return { files, dynamic };
}

/** Statik + dinamik: sayfanın er geç yükleyebileceği bütün parçalar. */
export function reachableChunks(distDir, roots) {
  const all = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift();
    if (all.has(file)) continue;
    all.add(file);
    const { statics, dynamics } = importsOf(distDir, file);
    queue.push(...statics, ...dynamics);
  }
  return all;
}

const gzipSize = (distDir, file) => gzipSync(readFileSync(path.join(distDir, file))).length;
const rawSize = (distDir, file) => readFileSync(path.join(distDir, file)).length;

export function findReactFlow(distDir, files) {
  const hits = [];
  for (const file of files) {
    const source = readFileSync(path.join(distDir, file), 'utf8');
    const markers = REACT_FLOW_MARKERS.filter((marker) => marker.test(source)).map(String);
    if (markers.length) hits.push({ file, markers });
  }
  return hits;
}

export function analyzeBundle(distDir) {
  if (!existsSync(path.join(distDir, 'mobile.html')))
    throw new Error(`${distDir} içinde mobile.html yok. Önce derleyin: npm run build`);

  const mobileHtml = readHtmlAssets(distDir, 'mobile.html');
  const entry = mobileHtml.scripts;
  if (entry.length !== 1) throw new Error(`mobile.html tek bir giriş betiği yüklemeli, bulunan: ${entry.join(', ')}`);
  const eager = staticClosure(distDir, entry);
  const startup = [...eager.dynamic].filter((file) =>
    STARTUP_LAZY_CHUNKS.some((name) => path.posix.basename(file).startsWith(`${name}-`)),
  );
  if (startup.length !== STARTUP_LAZY_CHUNKS.length)
    throw new Error(
      `Başlangıç sekmesi parçası bulunamadı (${STARTUP_LAZY_CHUNKS.join(', ')}). AppShell'deki sekme adları değiştiyse STARTUP_LAZY_CHUNKS'ı güncelleyin.`,
    );
  const initial = new Set([...eager.files, ...staticClosure(distDir, startup).files]);
  const reachable = reachableChunks(distDir, entry);
  const lazy = [...reachable].filter((file) => !initial.has(file));
  const describe = (file) => ({ file, raw: rawSize(distDir, file), gzip: gzipSize(distDir, file) });
  const initialFiles = [...initial].map(describe).sort((a, b) => b.gzip - a.gzip);
  const initialGzip = initialFiles.reduce((total, item) => total + item.gzip, 0);

  const desktopHtml = readHtmlAssets(distDir, 'index.html');
  const desktopReachable = reachableChunks(distDir, desktopHtml.scripts);
  const stylesheetHits = mobileHtml.styles.filter((file) =>
    /\.react-flow\b/.test(readFileSync(path.join(distDir, file), 'utf8')),
  );

  return {
    budget: MOBILE_INITIAL_JS_BUDGET_BYTES,
    mobile: {
      entry: entry[0],
      initialFiles,
      initialGzip,
      lazyFiles: lazy.map(describe).sort((a, b) => b.gzip - a.gzip),
      styles: mobileHtml.styles.map(describe),
      reachable: [...reachable],
      reactFlowHits: findReactFlow(distDir, reachable),
      reactFlowStylesheets: stylesheetHits,
    },
    desktop: {
      entry: desktopHtml.scripts[0],
      reachable: [...desktopReachable],
      reactFlowHits: findReactFlow(distDir, desktopReachable),
    },
  };
}

/** Bütçe ve yalıtım ihlalleri; boş dizi = geçti. */
export function violations(report) {
  const problems = [];
  if (report.mobile.initialGzip >= report.budget)
    problems.push(`Mobil ilk JS ${report.mobile.initialGzip} B gzip; bütçe < ${report.budget} B.`);
  for (const hit of report.mobile.reactFlowHits)
    problems.push(`React Flow mobil grafikte: ${hit.file} (${hit.markers.join(', ')}).`);
  for (const file of report.mobile.reactFlowStylesheets) problems.push(`React Flow stilleri mobil CSS'te: ${file}.`);
  if (!report.desktop.reactFlowHits.length)
    problems.push('Denetim kör: masaüstü paketinde de React Flow izi bulunamadı (REACT_FLOW_MARKERS güncellenmeli).');
  return problems;
}

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

function printReport(report) {
  const line = (item) => `  ${item.file.padEnd(40)} ${kb(item.raw).padStart(11)} ${kb(item.gzip).padStart(11)} gzip`;
  console.log(`Mobil ilk JS (giriş + başlangıçta yüklenenler):`);
  for (const item of report.mobile.initialFiles) console.log(line(item));
  console.log(
    `  ${'TOPLAM'.padEnd(40)} ${''.padStart(11)} ${kb(report.mobile.initialGzip).padStart(11)} gzip  (bütçe < ${kb(report.budget)})`,
  );
  console.log(`Sonradan yüklenen parçalar:`);
  for (const item of report.mobile.lazyFiles) console.log(line(item));
  console.log(`Mobil CSS:`);
  for (const item of report.mobile.styles) console.log(line(item));
  console.log(
    `React Flow: mobil grafikte ${report.mobile.reactFlowHits.length} parça, masaüstünde ${report.desktop.reactFlowHits.length} parça (${report.desktop.reactFlowHits.map((hit) => hit.file).join(', ')}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(process.argv[2] ?? path.join(projectDir, 'dist'));
  const report = analyzeBundle(distDir);
  printReport(report);
  const problems = violations(report);
  if (problems.length) {
    for (const problem of problems) console.error(`HATA: ${problem}`);
    process.exit(1);
  }
  console.log('Mobil paket denetimi geçti.');
}
