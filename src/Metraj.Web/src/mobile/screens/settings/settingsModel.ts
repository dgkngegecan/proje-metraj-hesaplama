import { parseDecimal, quantity } from '../../../lib/format.ts';
import type {
  CalculationResult,
  CalculationRule,
  DatabaseBackup,
  Revision,
  RevisionStatus,
  WorkspaceImportResult,
} from '../../../types';

/*
 * Ayarlar ekranlarının saf mantığı: durum etiketleri, doğrulama kuralları ve sunucuya giden
 * gövdeler. Doğrulama metinleri masaüstündeki (`App.tsx`) ile aynıdır; sunucu kuralları ayrıca
 * doğrular. `node:test` ile sınanır (tests/mobile-settings-model.test.mjs).
 */

// ---------------------------------------------------------------------------
// Revizyonlar
// ---------------------------------------------------------------------------

export const REVISION_STATUS_TEXT: Record<RevisionStatus, string> = {
  Draft: 'Taslak · düzenlenebilir',
  Approved: 'Onaylı · kilitli',
  Archived: 'Arşiv · kilitli',
};

export const isRevisionLocked = (revision: Pick<Revision, 'status'> | null | undefined) =>
  Boolean(revision && revision.status !== 'Draft');

/** Yalnız taslak revizyon onaylanabilir. */
export const canApproveRevision = (revision: Pick<Revision, 'status'> | null | undefined) =>
  revision?.status === 'Draft';

/** Onay panelinde sıralanan, geri alınamaz sonuçlar. */
export function approveConsequences(revisionCode: string): string[] {
  return [
    `${revisionCode} onaylanır ve kilitlenir; bu işlem geri alınamaz.`,
    'Kilitli revizyonda kart, ölçüm, hesap kuralı ve sorumluluk değiştirilemez; yalnız raporlar alınabilir.',
    'Değişiklik gerekirse yeni bir taslak revizyon açılır; onaylı revizyon olduğu gibi korunur.',
  ];
}

// ---------------------------------------------------------------------------
// Hesap kuralları ve sonuçları
// ---------------------------------------------------------------------------

export const CALCULATION_STATUS_LABEL: Record<CalculationResult['status'], string> = {
  PendingReview: 'Kontrol bekliyor',
  Approved: 'Onaylandı',
  Overridden: 'Elle düzeltildi',
  Rejected: 'Uygulanmadı',
  Stale: 'Güncel değil',
  Superseded: 'Yenisiyle değiştirildi',
};

export type StatusTone = 'warning' | 'success' | 'neutral' | 'danger';

export function calculationStatusTone(status: CalculationResult['status']): StatusTone {
  switch (status) {
    case 'PendingReview':
      return 'warning';
    case 'Approved':
    case 'Overridden':
      return 'success';
    case 'Rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const pendingResults = <T extends { status: CalculationResult['status'] }>(results: readonly T[]) =>
  results.filter((result) => result.status === 'PendingReview');

/** Bekleyenler üstte; kendi içinde sunucu sırası korunur. */
export function sortResults<T extends { status: CalculationResult['status'] }>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => Number(b.status === 'PendingReview') - Number(a.status === 'PendingReview'));
}

export const ruleSummary = (rule: Pick<CalculationRule, 'code' | 'multiplier'>) =>
  `${rule.code} · ×${quantity(rule.multiplier)}`;

export interface RuleDraft {
  code: string;
  name: string;
  multiplier: string;
}

export const emptyRuleDraft = (): RuleDraft => ({ code: '', name: '', multiplier: '1' });

/** Masaüstüyle aynı kural: kod, ad ve negatif olmayan çarpan. */
export function validateRuleDraft(draft: RuleDraft): string | null {
  const multiplier = parseDecimal(draft.multiplier);
  if (!draft.code.trim() || !draft.name.trim() || !Number.isFinite(multiplier) || multiplier < 0)
    return 'Kuralın kodunu, adını ve çarpanını yazın.';
  return null;
}

export const buildRulePayload = (draft: RuleDraft) => ({
  code: draft.code,
  name: draft.name,
  mode: 'FixedMultiplier' as const,
  multiplier: parseDecimal(draft.multiplier),
  sourceQuantityKind: 'Net' as const,
});

export function validateRejectReason(reason: string): string | null {
  return reason.trim() ? null : 'Uygulanmama gerekçesini yazın.';
}

export interface OverrideDraft {
  quantity: string;
  reason: string;
}

/** Hata metinleri masaüstündeki `overrideCalculation` ile aynı. */
export function validateOverride(draft: OverrideDraft): { quantity?: string; reason?: string } {
  const errors: { quantity?: string; reason?: string } = {};
  const used = parseDecimal(draft.quantity);
  if (!draft.quantity.trim() || !Number.isFinite(used) || used < 0)
    errors.quantity = 'Kullanılacak miktarı sayı olarak yazın.';
  if (!draft.reason.trim()) errors.reason = 'Değiştirme gerekçesini yazın.';
  return errors;
}

export const buildOverridePayload = (draft: OverrideDraft) => ({
  usedQuantity: parseDecimal(draft.quantity),
  reason: draft.reason.trim(),
});

/** Hesap bağı: kaynak ve hedef ayrı, aynı olamaz (masaüstündeki üç kontrol). */
export function validateCalculationLink(targetId: string, sourceId: string): string | null {
  if (!targetId) return 'Önce hesaplanacak ek parça kartını seçin.';
  if (!sourceId) return 'Bu hesabın kaynak kartını seçin.';
  if (targetId === sourceId) return 'Kaynak kartı ile hesaplanacak kart aynı olamaz.';
  return null;
}

// ---------------------------------------------------------------------------
// Sorumluluklar
// ---------------------------------------------------------------------------

export const ASSIGNMENT_STATE_LABEL = {
  Assigned: 'Sorumlu',
  Excluded: 'Hariç',
  Optional: 'Opsiyonel',
  Unassigned: 'Atanmamış',
} as const;

export type AssignmentState = keyof typeof ASSIGNMENT_STATE_LABEL;

/**
 * Sunucu bir boyut eklenince bütün kartlar için "Atanmamış" kaydı da üretir; gerçek
 * atamalar (sorumlu, hariç, opsiyonel) bu gürültünün altında kalmasın diye öne alınır.
 */
export function orderAssignments<T extends { state: AssignmentState }>(assignments: readonly T[]): T[] {
  return [...assignments].sort((a, b) => Number(a.state === 'Unassigned') - Number(b.state === 'Unassigned'));
}

export const decidedAssignmentCount = (assignments: readonly { state: AssignmentState }[]) =>
  assignments.filter((assignment) => assignment.state !== 'Unassigned').length;

export function validateNamed(draft: { code: string; name: string }, noun: 'Boyut' | 'Taraf'): string | null {
  return !draft.code.trim() || !draft.name.trim() ? `${noun} için kod ve ad yazın.` : null;
}

export function validateAssignment(dimensionId: string, placementId: string): string | null {
  return !dimensionId || !placementId ? 'Boyut ve kart seçin.' : null;
}

// ---------------------------------------------------------------------------
// Fire payları
// ---------------------------------------------------------------------------

export function validateWaste(draft: { materialType: string; wasteRatePct: string }): {
  materialType?: string;
  wasteRatePct?: string;
} {
  const errors: { materialType?: string; wasteRatePct?: string } = {};
  if (!draft.materialType.trim()) errors.materialType = 'Fire payı için malzeme ailesi yazın.';
  const pct = parseDecimal(draft.wasteRatePct);
  if (!draft.wasteRatePct.trim() || !Number.isFinite(pct) || pct < 0 || pct > 1000)
    errors.wasteRatePct = 'Fire payını 0 ile 1000 arasında yazın.';
  return errors;
}

export const buildWastePayload = (draft: { materialType: string; wasteRatePct: string }) => ({
  materialType: draft.materialType.trim(),
  wasteRatePct: parseDecimal(draft.wasteRatePct),
});

/** Aynı ailenin farklı yazımı ("galvaniz" / "Galvaniz ") güncelleme sayılır mı: sunucu karar verir, burada yalnız ipucu. */
export function wasteDraftFor(setting?: { materialType: string; wasteRatePct: number }) {
  return {
    materialType: setting?.materialType ?? '',
    wasteRatePct: setting ? String(setting.wasteRatePct).replace('.', ',') : '',
  };
}

// ---------------------------------------------------------------------------
// Yedekler ve bütünlük
// ---------------------------------------------------------------------------

export const BACKUP_REASON_LABEL: Record<string, string> = {
  Manual: 'Elle alındı',
  BeforeMigration: 'Güncelleme öncesi otomatik',
  BeforeRestore: 'Geri yükleme öncesi otomatik',
  BeforeProjectReset: 'Temizleme öncesi otomatik',
};

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}

const dateTime = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  // Sunucu UTC'yi "Z" ile yazar; eski bir yedekten ya da önbellekten gelen eksiz
  // değer yerel saat sanılmasın diye yine UTC sayılır.
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? '' : dateTime.format(date);
}

export function backupMeta(backup: Pick<DatabaseBackup, 'createdAtUtc' | 'sizeBytes' | 'reason'>): string {
  return [
    formatDateTime(backup.createdAtUtc),
    formatBackupSize(backup.sizeBytes),
    BACKUP_REASON_LABEL[backup.reason] ?? backup.reason,
  ]
    .filter(Boolean)
    .join(' · ');
}

export type IntegrityState = 'unknown' | 'healthy' | 'warning';

/** "Kontrol bekliyor" (henüz sonuç yok), "sağlam" ya da "uyarı". */
export function integrityState(result: { isHealthy: boolean } | null | undefined): IntegrityState {
  return !result ? 'unknown' : result.isHealthy ? 'healthy' : 'warning';
}

export const INTEGRITY_TEXT: Record<IntegrityState, string> = {
  unknown: 'Kontrol bekliyor',
  healthy: 'Veritabanı sağlam',
  warning: 'Veritabanında sorun bulundu',
};

// ---------------------------------------------------------------------------
// Çalışma alanı
// ---------------------------------------------------------------------------

/** İçe aktarma sonuç özeti (satır satır, sıfır olanlar atlanır; hiçbiri yoksa açıklama). */
export function importSummaryLines(result: WorkspaceImportResult): string[] {
  const lines: string[] = [];
  lines.push(
    `${result.importedProjects} proje eklendi${result.skippedProjects ? `, ${result.skippedProjects} mevcut proje atlandı` : ''}.`,
  );
  if (result.importedCatalogCards) lines.push(`${result.importedCatalogCards} yeni kütüphane kartı eklendi.`);
  if (result.importedCardVersions) lines.push(`${result.importedCardVersions} kart sürümü eklendi.`);
  if (result.importedWasteSettings) lines.push(`${result.importedWasteSettings} malzeme fire payı eklendi.`);
  return lines;
}

export const importIsEmpty = (result: WorkspaceImportResult) =>
  !result.importedProjects &&
  !result.importedCatalogCards &&
  !result.importedCardVersions &&
  !result.importedWasteSettings;

/** Sentetik örnek yanıtı → kullanıcıya iletilecek metin. */
export function sampleMessage(result: {
  alreadyExisted?: boolean;
  importedPlacementCount?: number;
  importedMeasurementCount?: number;
}) {
  return result.alreadyExisted
    ? 'Örnek Temiz Su projesi zaten yüklüydü; yeniden eklenmedi.'
    : `Örnek Temiz Su projesi eklendi (${result.importedPlacementCount ?? 0} kart, ${result.importedMeasurementCount ?? 0} ölçüm).`;
}
