/**
 * Mobil durum deposunun genel yüzeyi. Ekranlar buradan içe aktarır:
 *
 *   import { actions, appStore, usePlacementTree, runOptimistic, patch } from '../../store';
 *
 * Ayrıntılar: src/mobile/MIMARI.md → "Durum deposu".
 */
export { actions, appStore, drafts, flushPendingWrites, persistSelection, readSavedSelection } from './runtime.ts';
export {
  useAppStore,
  useBusy,
  useDraft,
  useDraftsReady,
  useIsRevisionLocked,
  useLoad,
  useMeasurementsOf,
  usePlacements,
  usePlacementTree,
  useProjects,
  useResource,
  useRevisionSummaries,
  useRevisionsOf,
  useSelectedProject,
  useSelectedRevision,
  useSelection,
  useSummariesOf,
  type DraftCodec,
  type UseResourceResult,
} from './hooks.ts';
export {
  errorMessage,
  GENERIC_ERROR_MESSAGE,
  loadKeys,
  type AppActions,
  type AppState,
  type LoadState,
  type LoadStatus,
  type ResourceState,
  type Selection,
} from './appStore.ts';
export {
  entityKey,
  listOf,
  patch,
  summaryKey,
  type Entities,
  type EntityName,
  type EntityOf,
  type EntityTable,
  type PatchOp,
  type SummaryEntity,
} from './entities.ts';
export {
  isTemporaryId,
  removeWithUndo,
  runOptimistic,
  temporaryId,
  type OptimisticOptions,
  type OptimisticResult,
  type RemovalHandle,
  type RemoveWithUndoOptions,
} from './optimistic.ts';
export { draftKey, parseDraft } from './drafts.ts';
export {
  buildPlacementTree,
  selectIsRevisionLocked,
  selectSelectedProject,
  selectSelectedRevision,
  sortSummariesForDisplay,
  subtreeIds,
  type PlacementTreeRow,
} from './selectors.ts';
