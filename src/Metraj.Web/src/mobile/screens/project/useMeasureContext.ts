import { useCallback, useMemo } from 'react';
import { draftKey, useAppStore, useDraft, useSelection } from '../../store';
import { selectMeasurementsOfRevision } from '../../store/selectors.ts';
import { newestFirst } from './measurementRows.ts';
import {
  CONTEXT_DRAFT_KIND,
  CONTEXT_RECENTS_DRAFT_KIND,
  normalizeContext,
  normalizeRecents,
  pushRecentValue,
  seedRecents,
  withValue,
  type ContextKey,
  type ContextRecents,
  type MeasureContext,
} from './context.ts';

export interface MeasureContextApi {
  context: MeasureContext;
  recents: ContextRecents;
  setField: (key: ContextKey, value: string) => void;
  clearAll: () => void;
}

/**
 * Son ölçüm bağlamı (blok, kat, mahal…) ve alan başına son değerler. Proje başına
 * `/ui-state`'te saklanır (`measure-context.v1.{projectId}`): uygulama kapanıp
 * açılsa, başka bir karta geçilse bağlam yerinde kalır; kayıttan sonra DEĞİŞMEZ
 * (masaüstüyle aynı kural). Taslak deposu hazır olmadan okunmaz (`useDraft` bunu yapar).
 */
export function useMeasureContext(): MeasureContextApi {
  const { projectId, revisionId } = useSelection();
  const id = projectId ?? 'none';
  const revisionMeasurements = useAppStore((state) => selectMeasurementsOfRevision(state, revisionId));
  const [rawContext, setRawContext] = useDraft<unknown>(draftKey(CONTEXT_DRAFT_KIND, id), null);
  const [rawRecents, setRawRecents] = useDraft<unknown>(draftKey(CONTEXT_RECENTS_DRAFT_KIND, id), null);
  const context = useMemo(() => normalizeContext(rawContext), [rawContext]);
  const saved = useMemo(() => normalizeRecents(rawRecents), [rawRecents]);
  // Kaydedilmiş son değerlerin ardına, revizyondaki girişlerde geçen konumlar (en yeni önce) eklenir.
  const recents = useMemo(() => seedRecents(saved, newestFirst(revisionMeasurements)), [saved, revisionMeasurements]);

  const setField = useCallback(
    (key: ContextKey, value: string) => {
      const next = withValue(context, key, value);
      if (next === context) return;
      setRawContext(next);
      if (next[key]) setRawRecents(pushRecentValue(saved, key, next[key]));
    },
    [context, saved, setRawContext, setRawRecents],
  );
  const clearAll = useCallback(() => setRawContext(null), [setRawContext]);

  return { context, recents, setField, clearAll };
}
