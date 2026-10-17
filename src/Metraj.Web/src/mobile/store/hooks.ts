import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { AppState, ResourceState } from './appStore.ts';
import { actions, appStore, drafts } from './runtime.ts';
import {
  buildPlacementTree,
  selectIsRevisionLocked,
  selectLoad,
  selectMeasurementsOfPlacement,
  selectPlacementsOf,
  selectProjects,
  selectRevisionsOf,
  selectSelectedProject,
  selectSelectedRevision,
  selectSummariesOfPlacement,
  selectSummariesOfRevision,
} from './selectors.ts';

/**
 * React kancaları. Kural: bileşen YALNIZ ihtiyaç duyduğu dilimi seçer.
 * `useAppStore((s) => s)` gibi bütün durumu seçmek, her değişiklikte bütün
 * ağacı yeniden çizer; bunu yapmayın. Türetilmiş diziler `selectors.ts`'teki
 * önbellekli seçicilerden gelmeli (her çağrıda yeni dizi dönen bir seçici
 * sonsuz yeniden çizim döngüsüne yol açar).
 */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

export const useProjects = () => useAppStore(selectProjects);
export const useSelectedProject = () => useAppStore(selectSelectedProject);
export const useSelectedRevision = () => useAppStore(selectSelectedRevision);
export const useSelection = () => useAppStore((state) => state.selection);
export const useIsRevisionLocked = () => useAppStore(selectIsRevisionLocked);
export const useBusy = () => useAppStore((state) => state.busy > 0);
export const useLoad = (key: string) => useAppStore((state) => selectLoad(state, key));

export function useRevisionsOf(projectId: string | null) {
  return useAppStore((state) => selectRevisionsOf(state, projectId));
}

export function usePlacements(revisionId: string | null) {
  return useAppStore((state) => selectPlacementsOf(state, revisionId));
}

/** Girintili proje ağacı satırları (sanallaştırılmış listeye hazır). */
export function usePlacementTree(revisionId: string | null) {
  return buildPlacementTree(usePlacements(revisionId));
}

export function useMeasurementsOf(placementId: string | null) {
  return useAppStore((state) => selectMeasurementsOfPlacement(state, placementId));
}

export function useSummariesOf(placementId: string | null) {
  return useAppStore((state) => selectSummariesOfPlacement(state, placementId));
}

export function useRevisionSummaries(revisionId: string | null) {
  return useAppStore((state) => selectSummariesOfRevision(state, revisionId));
}

export interface UseResourceResult<T> {
  data: T | undefined;
  status: ResourceState['status'];
  error: string | null;
  reload: () => void;
}

/**
 * Ekrana özgü bir kaynağı yükler ve önbellekler. `key` null ise hiçbir şey
 * yapılmaz (ör. revizyon seçilmemişken). Aynı anahtar başka bir ekranda da
 * kullanılıyorsa veri paylaşılır. `actions.invalidateResources(önek)` ile
 * bayatlatılan kaynak, ekran açıkken kendiliğinden yeniden yüklenir.
 *
 *   const report = useResource(revisionId && `report:${revisionId}`,
 *     () => api.get<ReportData>(`/revisions/${revisionId}/report`));
 */
export function useResource<T>(
  key: string | null | false | undefined,
  fetcher: () => Promise<T>,
): UseResourceResult<T> {
  const resourceKey = key || null;
  const resource = useAppStore((state) => (resourceKey ? state.resources[resourceKey] : undefined)) as
    ResourceState<T> | undefined;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mountedKey = useRef<string | null>(null);
  const stale = resource?.stale ?? false;
  const status = resource?.status;

  useEffect(() => {
    if (!resourceKey) return;
    const firstRunForKey = mountedKey.current !== resourceKey;
    mountedKey.current = resourceKey;
    const cached = appStore.getState().resources[resourceKey];
    // Taze önbellek kullanılır; bayatlatılmış veri yeniden istenir. Hata yalnız
    // ekran (yeniden) açıldığında kendiliğinden denenir; açıkken döngüye girmez.
    const shouldLoad =
      !cached ||
      cached.status === 'idle' ||
      (cached.status === 'ready' && cached.stale) ||
      (cached.status === 'error' && firstRunForKey);
    if (shouldLoad) void actions.loadResource(resourceKey, () => fetcherRef.current());
  }, [resourceKey, stale, status]);

  const reload = useCallback(() => {
    if (resourceKey) void actions.loadResource(resourceKey, () => fetcherRef.current());
  }, [resourceKey]);

  return {
    data: resource?.data,
    status: resource?.status ?? (resourceKey ? 'loading' : 'idle'),
    error: resource?.error ?? null,
    reload,
  };
}

/** Taslak deposu hazır mı (sunucudaki taslaklar okundu mu)? Hidrasyon bundan önce yapılmamalı. */
export function useDraftsReady() {
  return useSyncExternalStore(
    drafts.subscribe,
    () => drafts.ready,
    () => drafts.ready,
  );
}

export interface DraftCodec<T> {
  parse(raw: string): T | null;
  serialize(value: T): string;
}

const jsonCodec = <T>(): DraftCodec<T> => ({
  parse: (raw) => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  serialize: (value) => JSON.stringify(value),
});

/**
 * Kalıcı taslak durumu: `useState` gibi davranır, değer `/ui-state`'e
 * (biriktirilerek) yazılır ve uygulama yeniden açıldığında geri gelir.
 * `null` yazmak taslağı siler. Anahtar `draftKey(tür, kimlik)` ile üretilmeli.
 *
 *   const [counts, setCounts] = useDraft(draftKey('fitting-draft', placement.id), {});
 */
export function useDraft<T>(key: string, fallback: T, codec: DraftCodec<T> = jsonCodec<T>()) {
  const ready = useDraftsReady();
  const codecRef = useRef(codec);
  codecRef.current = codec;
  // fallback çoğunlukla satır içi bir nesnedir; bağımlılık yapılsaydı her
  // çizimde kanca kimliği değişirdi.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const read = useCallback(() => {
    const raw = drafts.read(key);
    return raw === null ? null : codecRef.current.parse(raw);
  }, [key]);
  const [value, setValue] = useState<T>(() => read() ?? fallback);
  const [hydratedFor, setHydratedFor] = useState<{ key: string; ready: boolean }>({ key, ready });
  const valueRef = useRef(value);
  valueRef.current = value;

  // Anahtar değişti veya sunucudaki taslaklar geldi: yeniden oku.
  if (hydratedFor.key !== key || hydratedFor.ready !== ready) {
    const next = read() ?? fallback;
    setHydratedFor({ key, ready });
    setValue(next);
    valueRef.current = next;
  }

  const update = useCallback(
    (next: T | null | ((current: T) => T | null)) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T | null)(valueRef.current) : next;
      // Yazım güncelleyicinin DIŞINDA: StrictMode güncelleyicileri iki kez çağırır.
      if (resolved === null) {
        drafts.clear(key);
        valueRef.current = fallbackRef.current;
      } else {
        drafts.write(key, codecRef.current.serialize(resolved));
        valueRef.current = resolved;
      }
      setValue(valueRef.current);
    },
    [key],
  );
  return [value, update] as const;
}
