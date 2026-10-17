// Ayarlar ekranlarının saf mantığı: revizyon kuralları, hesap kuralı/sonuç doğrulamaları ve gövdeleri,
// sorumluluk ve fire doğrulamaları, yedek ve bütünlük metinleri, içe aktarma özeti.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSIGNMENT_STATE_LABEL,
  CALCULATION_STATUS_LABEL,
  approveConsequences,
  backupMeta,
  buildOverridePayload,
  buildRulePayload,
  buildWastePayload,
  calculationStatusTone,
  canApproveRevision,
  emptyRuleDraft,
  formatBackupSize,
  formatDateTime,
  importIsEmpty,
  importSummaryLines,
  integrityState,
  isRevisionLocked,
  pendingResults,
  ruleSummary,
  sampleMessage,
  sortResults,
  decidedAssignmentCount,
  orderAssignments,
  validateAssignment,
  validateCalculationLink,
  validateNamed,
  validateOverride,
  validateRejectReason,
  validateRuleDraft,
  validateWaste,
  wasteDraftFor,
} from '../src/mobile/screens/settings/settingsModel.ts';

test('revizyon: yalnız taslak onaylanır, onaylı/arşiv kilitlidir', () => {
  assert.equal(canApproveRevision({ status: 'Draft' }), true);
  assert.equal(canApproveRevision({ status: 'Approved' }), false);
  assert.equal(canApproveRevision(null), false);
  assert.equal(isRevisionLocked({ status: 'Draft' }), false);
  assert.equal(isRevisionLocked({ status: 'Approved' }), true);
  assert.equal(isRevisionLocked({ status: 'Archived' }), true);
  assert.equal(isRevisionLocked(undefined), false);
});

test('onay paneli geri alınamazlığı ve yeni taslak yolunu söyler', () => {
  const lines = approveConsequences('R2');
  assert.match(lines[0], /R2 onaylanır ve kilitlenir; bu işlem geri alınamaz/);
  assert.ok(lines.some((line) => /yeni bir taslak revizyon/.test(line)));
});

test('"Kontrol bekliyor" durumu görünür ve bekleyenler listenin başındadır', () => {
  assert.equal(CALCULATION_STATUS_LABEL.PendingReview, 'Kontrol bekliyor');
  assert.equal(calculationStatusTone('PendingReview'), 'warning');
  assert.equal(calculationStatusTone('Approved'), 'success');
  assert.equal(calculationStatusTone('Overridden'), 'success');
  assert.equal(calculationStatusTone('Rejected'), 'danger');
  assert.equal(calculationStatusTone('Stale'), 'neutral');
  const results = [
    { id: 1, status: 'Approved' },
    { id: 2, status: 'PendingReview' },
    { id: 3, status: 'Rejected' },
    { id: 4, status: 'PendingReview' },
  ];
  assert.deepEqual(
    sortResults(results).map((r) => r.id),
    [2, 4, 1, 3],
  );
  assert.equal(pendingResults(results).length, 2);
  assert.deepEqual(
    results.map((r) => r.id),
    [1, 2, 3, 4],
    'girdi değişmez',
  );
});

test('hesap kuralı: masaüstüyle aynı doğrulama ve gövde', () => {
  assert.equal(validateRuleDraft(emptyRuleDraft()), 'Kuralın kodunu, adını ve çarpanını yazın.');
  assert.equal(validateRuleDraft({ code: 'D', name: 'Dirsek', multiplier: '0,2' }), null);
  assert.equal(validateRuleDraft({ code: 'D', name: 'Dirsek', multiplier: '0' }), null, 'sıfır çarpan geçerli');
  assert.notEqual(validateRuleDraft({ code: 'D', name: 'Dirsek', multiplier: '-1' }), null);
  assert.notEqual(validateRuleDraft({ code: 'D', name: 'Dirsek', multiplier: 'x' }), null);
  assert.notEqual(validateRuleDraft({ code: ' ', name: 'Dirsek', multiplier: '1' }), null);
  assert.deepEqual(buildRulePayload({ code: 'D', name: 'Dirsek', multiplier: '1,5' }), {
    code: 'D',
    name: 'Dirsek',
    mode: 'FixedMultiplier',
    multiplier: 1.5,
    sourceQuantityKind: 'Net',
  });
  assert.equal(ruleSummary({ code: 'DIRSEK', multiplier: 1.25 }), 'DIRSEK · ×1,25');
});

test('reddetme gerekçesi zorunlu; ezmede miktar sayı, gerekçe dolu olmalı', () => {
  assert.notEqual(validateRejectReason('  '), null);
  assert.equal(validateRejectReason('Saha uygun değil'), null);
  assert.deepEqual(validateOverride({ quantity: '12,5', reason: 'ölçüldü' }), {});
  assert.equal(validateOverride({ quantity: '', reason: 'x' }).quantity, 'Kullanılacak miktarı sayı olarak yazın.');
  assert.equal(validateOverride({ quantity: '-3', reason: 'x' }).quantity, 'Kullanılacak miktarı sayı olarak yazın.');
  assert.equal(validateOverride({ quantity: 'abc', reason: 'x' }).quantity, 'Kullanılacak miktarı sayı olarak yazın.');
  assert.equal(validateOverride({ quantity: '5', reason: '  ' }).reason, 'Değiştirme gerekçesini yazın.');
  assert.equal(validateOverride({ quantity: '0', reason: 'sıfır' }).quantity, undefined, 'sıfır miktar geçerli');
  assert.deepEqual(buildOverridePayload({ quantity: '12,5', reason: ' ölçüldü ' }), {
    usedQuantity: 12.5,
    reason: 'ölçüldü',
  });
});

test('hesap bağı: hedef, kaynak seçilmeli ve aynı olamaz', () => {
  assert.match(validateCalculationLink('', 'a'), /hesaplanacak ek parça/);
  assert.match(validateCalculationLink('a', ''), /kaynak kartını seçin/);
  assert.match(validateCalculationLink('a', 'a'), /aynı olamaz/);
  assert.equal(validateCalculationLink('a', 'b'), null);
});

test('sorumluluk: boyut/taraf adı ve atama zorunlulukları', () => {
  assert.equal(validateNamed({ code: '', name: 'x' }, 'Boyut'), 'Boyut için kod ve ad yazın.');
  assert.equal(validateNamed({ code: 'x', name: ' ' }, 'Taraf'), 'Taraf için kod ve ad yazın.');
  assert.equal(validateNamed({ code: 'x', name: 'y' }, 'Taraf'), null);
  assert.equal(validateAssignment('', 'p'), 'Boyut ve kart seçin.');
  assert.equal(validateAssignment('d', ''), 'Boyut ve kart seçin.');
  assert.equal(validateAssignment('d', 'p'), null);
  assert.deepEqual(Object.keys(ASSIGNMENT_STATE_LABEL), ['Assigned', 'Excluded', 'Optional', 'Unassigned']);
});

test('atamalar: gerçek kararlar "Atanmamış" gürültüsünün önüne alınır, sıra korunur', () => {
  const list = [
    { id: 1, state: 'Unassigned' },
    { id: 2, state: 'Assigned' },
    { id: 3, state: 'Unassigned' },
    { id: 4, state: 'Excluded' },
  ];
  assert.deepEqual(
    orderAssignments(list).map((a) => a.id),
    [2, 4, 1, 3],
  );
  assert.equal(decidedAssignmentCount(list), 2);
  assert.deepEqual(
    list.map((a) => a.id),
    [1, 2, 3, 4],
    'girdi değişmez',
  );
});

test('fire payı: aile adı zorunlu, oran 0-1000 arası, virgül kabul', () => {
  assert.deepEqual(validateWaste({ materialType: 'Galvaniz', wasteRatePct: '5' }), {});
  assert.deepEqual(validateWaste({ materialType: 'Galvaniz', wasteRatePct: '2,5' }), {});
  assert.deepEqual(validateWaste({ materialType: 'G', wasteRatePct: '0' }), {});
  assert.deepEqual(validateWaste({ materialType: 'G', wasteRatePct: '1000' }), {});
  assert.equal(
    validateWaste({ materialType: ' ', wasteRatePct: '5' }).materialType,
    'Fire payı için malzeme ailesi yazın.',
  );
  for (const bad of ['', '-1', '1000,1', 'abc'])
    assert.equal(
      validateWaste({ materialType: 'G', wasteRatePct: bad }).wasteRatePct,
      'Fire payını 0 ile 1000 arasında yazın.',
      bad,
    );
  assert.deepEqual(buildWastePayload({ materialType: ' Galvaniz ', wasteRatePct: '2,5' }), {
    materialType: 'Galvaniz',
    wasteRatePct: 2.5,
  });
  assert.deepEqual(wasteDraftFor({ materialType: 'A', wasteRatePct: 2.5 }), { materialType: 'A', wasteRatePct: '2,5' });
  assert.deepEqual(wasteDraftFor(undefined), { materialType: '', wasteRatePct: '' });
});

test('yedek ve bütünlük metinleri', () => {
  assert.equal(formatBackupSize(100), '1 KB');
  assert.equal(formatBackupSize(2048), '2 KB');
  assert.equal(formatBackupSize(3 * 1024 * 1024), '3 MB');
  assert.match(
    backupMeta({ createdAtUtc: '2026-10-17T11:17:13', sizeBytes: 50 * 1024, reason: 'BeforeRestore' }),
    /50 KB · Geri yükleme öncesi otomatik/,
  );
  assert.equal(integrityState(null), 'unknown');
  assert.equal(integrityState({ isHealthy: true }), 'healthy');
  assert.equal(integrityState({ isHealthy: false }), 'warning');
});

test("tarih: Z'siz sunucu zamanı UTC sayılır, geçersiz boş döner", () => {
  assert.equal(formatDateTime('2026-10-17T11:17:13'), formatDateTime('2026-10-17T11:17:13Z'));
  assert.equal(formatDateTime(undefined), '');
  assert.equal(formatDateTime('değil'), '');
});

test('içe aktarma özeti: sıfırlar atlanır, tamamen boşsa belirtilir', () => {
  const result = {
    importedProjects: 2,
    skippedProjects: 1,
    importedCatalogCards: 5,
    importedCardVersions: 0,
    importedWasteSettings: 3,
  };
  assert.deepEqual(importSummaryLines(result), [
    '2 proje eklendi, 1 mevcut proje atlandı.',
    '5 yeni kütüphane kartı eklendi.',
    '3 malzeme fire payı eklendi.',
  ]);
  assert.equal(importIsEmpty(result), false);
  const none = {
    importedProjects: 0,
    skippedProjects: 4,
    importedCatalogCards: 0,
    importedCardVersions: 0,
    importedWasteSettings: 0,
  };
  assert.equal(importIsEmpty(none), true);
  assert.deepEqual(importSummaryLines(none), ['0 proje eklendi, 4 mevcut proje atlandı.']);
});

test('örnek proje mesajı tekrar eklenip eklenmediğini ve sayıları söyler', () => {
  assert.match(sampleMessage({ alreadyExisted: true }), /zaten yüklüydü/);
  assert.match(
    sampleMessage({ alreadyExisted: false, importedPlacementCount: 14, importedMeasurementCount: 36 }),
    /14 kart, 36 ölçüm/,
  );
});
