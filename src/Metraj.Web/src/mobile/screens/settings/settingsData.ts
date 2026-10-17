import { api } from '../../../api';
import type {
  CalculationResult,
  CalculationRule,
  DatabaseBackup,
  DatabaseIntegrity,
  ResponsibilityData,
} from '../../../types';
import { shellActions } from '../../shell';
import { actions, readSavedSelection, useResource } from '../../store';

/*
 * Ayarlar ekranlarının ekrana özgü verisi (`useResource` önbelleği) ve veri değişince
 * yapılacak tazelemeler. Anahtarlar tek yerde: bir ekranda yazılan değişiklik, öbür
 * ekranın aynı anahtarı bayatlatarak görünmesini sağlar.
 */

export const resourceKeys = {
  rules: (revisionId: string) => `calc-rules:${revisionId}`,
  results: (revisionId: string) => `calc-results:${revisionId}`,
  responsibilities: (revisionId: string) => `responsibilities:${revisionId}`,
  backups: 'backups',
  integrity: 'integrity',
  health: 'health',
} as const;

export function useCalculationRules(revisionId: string | null) {
  return useResource(revisionId && resourceKeys.rules(revisionId), () =>
    api.get<CalculationRule[]>(`/revisions/${revisionId}/calculations/rules`),
  );
}

export function useCalculationResults(revisionId: string | null) {
  return useResource(revisionId && resourceKeys.results(revisionId), () =>
    api.get<CalculationResult[]>(`/revisions/${revisionId}/calculations/results`),
  );
}

export function useResponsibilities(revisionId: string | null) {
  return useResource(revisionId && resourceKeys.responsibilities(revisionId), () =>
    api.get<ResponsibilityData>(`/revisions/${revisionId}/responsibilities`),
  );
}

export function useBackups() {
  return useResource(resourceKeys.backups, () => api.get<DatabaseBackup[]>('/database/backups'));
}

export function useIntegrity() {
  return useResource(resourceKeys.integrity, () => api.get<DatabaseIntegrity>('/database/integrity'));
}

/**
 * Hesap sonucu / fire / revizyon değişti: rapor ve özetler yeniden hesaplanır. Yalnız
 * `calc-results`u bayatlatmak, ekrandaki rapor eski sayılarla kalırken indirilen dosyanın yeni
 * sayılarla üretilmesine yol açıyordu (masaüstünde aynı ders).
 */
export function refreshAfterCalculationChange() {
  actions.invalidateResources('calc-');
  actions.invalidateResources('report:');
  void actions.refreshRevision();
}

/** Proje ve çıktı sekmelerinin iç ekranları (ör. silinen karta açık ayrıntı) kapanır; Ayarlar'ınki kalır. */
export function closeProjectScreens() {
  shellActions.popToRoot('project');
  shellActions.popToRoot('output');
}

/**
 * Bütün veri değişti (yedek geri yüklendi, projeler temizlendi): seçim, projeler, katalog,
 * fire payları ve ekrana özgü önbellek baştan okunur. Eski proje/revizyon kimlikleriyle
 * açık kalan hiçbir iç ekran bırakılmaz.
 */
export async function reloadEverything() {
  closeProjectScreens();
  shellActions.popToRoot('library');
  actions.invalidateResources('');
  await actions.bootstrap(readSavedSelection() ?? {});
  void actions.loadCatalog();
  void actions.loadWasteSettings();
}

/** Mevcut veriye EKLEME yapıldı (içe aktarma, örnek proje): seçim korunur, listeler tazelenir. */
export async function reloadAfterAddition() {
  actions.invalidateResources('');
  await Promise.all([actions.loadProjects(), actions.loadCatalog(), actions.loadWasteSettings()]);
}
