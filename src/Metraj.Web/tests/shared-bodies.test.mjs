// Hesap mantığının ikinci kopyası olmaz (kilitli karar #1): ölçüm satırı ve kart
// gövdeleri yalnız src/lib/measurementBodies.ts ve src/lib/cardPayload.ts içinde
// üretilir. Masaüstü (App.tsx, Inspector.tsx) Node'da çalıştırılamadığı için (React
// Flow, CSS) kaynak düzeyinde denetlenir: ortak yardımcıları içe aktarıp çağırıyor mu,
// ve ağaçta başka bir yerde gövde yeniden mi yazılmış? Telefon modülleri çalışma
// zamanında aynı fonksiyon nesnesini kullandığını kanıtlar.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cardPayload from '../src/lib/cardPayload.ts';
import * as cardDraft from '../src/mobile/screens/library/cardDraft.ts';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(projectDir, 'src');
const SHARED = new Set(['src/lib/measurementBodies.ts', 'src/lib/cardPayload.ts']);

const relative = (file) => path.relative(projectDir, file).replace(/\\/g, '/');
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file) => withoutComments(readFileSync(path.join(projectDir, file), 'utf8'));

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** `import { a, b, type C } from 'spec'` içindeki adlar (tip olmayanlar). */
function importedNames(source, specifier) {
  const names = new Set();
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${escaped}(?:\\.ts)?'`, 'g');
  for (const match of source.matchAll(pattern))
    for (const part of match[1].split(',')) {
      const name = part.trim();
      if (name && !name.startsWith('type ')) names.add(name);
    }
  return names;
}

test('masaüstü App.tsx ölçüm ve kart gövdelerini ortak modülden üretir', () => {
  const app = read('src/App.tsx');
  const bodies = importedNames(app, './lib/measurementBodies');
  for (const name of ['buildMeasurementBodies', 'buildUpdateBody', 'draftEntryContext', 'rowsError'])
    assert.ok(bodies.has(name), `App.tsx ${name} içe aktarmalı`);
  const cards = importedNames(app, './lib/cardPayload');
  for (const name of ['buildCardPayload', 'draftFromCard', 'emptyCardDraft'])
    assert.ok(cards.has(name), `App.tsx ${name} içe aktarmalı`);
  assert.match(app, /buildMeasurementBodies\(target, rows, draftEntryContext\(measurementDraft\)\)/);
  assert.match(app, /buildUpdateBody\(measurement, \{ quantity: inputQuantity \}\)/);
  assert.match(app, /rowsError\(rows\)/);
  assert.match(app, /buildCardPayload\(cardDraft, catalogTypes\)/);
  assert.match(app, /setCardDraft\(draftFromCard\(card\)\)/);
});

test('masaüstü Inspector.tsx boru ve fitting satırlarını ortak modülden üretir', () => {
  const inspector = read('src/components/Inspector.tsx');
  const names = importedNames(inspector, '../lib/measurementBodies');
  for (const name of ['pipeRow', 'fittingSubmission', 'remainingAfterSubmit'])
    assert.ok(names.has(name), `Inspector.tsx ${name} içe aktarmalı`);
  assert.match(inspector, /pipeRow\(parsed, box\.diameter, variantDiameters\)/);
  assert.match(inspector, /fittingSubmission\(\s*placement,\s*fittingBoxes\.map\(\(box\) => box\.countsByDiameter\)/);
  assert.match(inspector, /remainingAfterSubmit\(box\.countsByDiameter, submitted\)/);
});

test('telefon ölçüm kaydı ve fitting girişi ortak modülü çağırır', () => {
  const save = read('src/mobile/screens/project/entrySave.ts');
  const saveNames = importedNames(save, '../../../lib/measurementBodies');
  for (const name of ['buildMeasurementBodies', 'buildUpdateBody', 'rowsError'])
    assert.ok(saveNames.has(name), `entrySave.ts ${name} içe aktarmalı`);
  const fitting = read('src/mobile/screens/project/FittingEntry.tsx');
  const fittingNames = importedNames(fitting, '../../../lib/measurementBodies');
  for (const name of ['fittingSubmission', 'remainingAfterSubmit'])
    assert.ok(fittingNames.has(name), `FittingEntry.tsx ${name} içe aktarmalı`);
  const entry = read('src/mobile/screens/project/EntryScreen.tsx');
  assert.ok(importedNames(entry, '../../../lib/measurementBodies').has('pipeRow'));
});

test('telefon kart formu ortak kart gövdesinin AYNI fonksiyonunu kullanır', () => {
  assert.equal(cardDraft.buildCardPayload, cardPayload.buildCardPayload);
  assert.equal(cardDraft.draftFromCard, cardPayload.draftFromCard);
  assert.equal(cardDraft.emptyCardDraft, cardPayload.emptyCardDraft);
});

// Gövdenin ayırt edici parçaları. Ortak modül dışında görünürlerse biri gövdeyi yeniden yazmıştır.
const BODY_MARKERS = [
  ["sourceKind: 'USER' değeri", /sourceKind:\s*'USER'\s*[,}]/],
  ['"Çap: …" satır notu', /`[^`]*Çap: \$\{/],
  ['inputUnit kartın biriminden', /inputUnit:\s*\w+\.unit\b/],
  ['salesConversion kuralı', /salesConversion:\s*[\w.]+\.variantMode\s*===/],
  ['containerParameter kuralı', /containerParameter:\s*[\w.]+\.variantMode\s*===/],
  ['reportBehavior kuralı', /reportBehavior:\s*typeChanged\b/],
];

test('ortak modüller dışında ölçüm/kart gövdesi yeniden yazılmamış', () => {
  const offenders = [];
  for (const file of sourceFiles(srcDir)) {
    const name = relative(file);
    if (SHARED.has(name)) continue;
    const source = withoutComments(readFileSync(file, 'utf8'));
    for (const [label, pattern] of BODY_MARKERS) if (pattern.test(source)) offenders.push(`${name}: ${label}`);
    if (/\[\s*row\.notes\b/.test(source)) offenders.push(`${name}: satır notu birleştirme`);
  }
  assert.deepEqual(offenders, []);
});

test('kendi kendini sınama: işaretler ortak modüllerde gerçekten bulunuyor', () => {
  const shared = [...SHARED].map(read).join('\n');
  for (const [label, pattern] of BODY_MARKERS) assert.match(shared, pattern, label);
});
