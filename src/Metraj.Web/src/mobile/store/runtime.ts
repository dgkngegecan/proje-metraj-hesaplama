import { api } from '../../api';
import { clearUiState, loadUiState, readUiState, writeUiState } from '../../uiState';
import { createAppStore } from './appStore.ts';
import { createDraftStore, draftKey, parseDraft } from './drafts.ts';
import { flushPendingRemovals } from './optimistic.ts';

/**
 * Uygulamanın tekil depoları. Ekranlar bunları doğrudan değil, `store/index.ts`
 * üzerinden (kancalar ve `actions`) kullanır.
 */
export const { store: appStore, actions } = createAppStore({ api });

export const drafts = createDraftStore({
  load: loadUiState,
  read: readUiState,
  write: writeUiState,
  clear: clearUiState,
});

/** Son açık proje/revizyon; açılışta oraya dönülür. */
const SELECTION_KEY = draftKey('mobile-selection', 'last');

type SavedSelection = { projectId: string | null; revisionId: string | null };
const isSavedSelection = (value: unknown): value is SavedSelection =>
  typeof value === 'object' && value !== null && 'projectId' in value && 'revisionId' in value;

export function readSavedSelection(): SavedSelection | null {
  return parseDraft(drafts.read(SELECTION_KEY), isSavedSelection);
}

let selectionPersistence: (() => void) | null = null;

/** Seçim değiştikçe taslağa yazar. Tek abonelik kurulur; dönen işlev onu kaldırır. */
export function persistSelection(): () => void {
  selectionPersistence ??= appStore.subscribe((state, previous) => {
    if (state.selection === previous.selection) return;
    // Revizyon seçilene kadar ara durum (yeni proje, revizyon=null) yazılmaz.
    if (state.selection.projectId && !state.selection.revisionId) return;
    drafts.write(SELECTION_KEY, JSON.stringify(state.selection));
  });
  return () => {
    selectionPersistence?.();
    selectionPersistence = null;
  };
}

/**
 * Uygulama arka plana geçerken çağrılır: biriken taslak yazımları ve "Geri al"
 * süresi dolmamış silmeler hemen gönderilir.
 */
export function flushPendingWrites() {
  drafts.flush();
  void flushPendingRemovals();
}
