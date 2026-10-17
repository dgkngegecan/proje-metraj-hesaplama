/**
 * Uygulama kabuğunun genel yüzeyi (Dalga 2 ekranları için).
 *
 *   import { BottomSheet, useBackHandler, notify, removeWithUndo… } from '../../shell';
 *
 * Ayrıntı: src/mobile/MIMARI.md → "Kabuk".
 */
export { backStack, exitApp, requestBack, useBackHandler } from './back.ts';
export type { BackHandler, BackLayer } from './backStack.ts';
export { BottomSheet, useKeyboardInset, type BottomSheetProps } from './BottomSheet';
export { formatFileSize } from './DownloadPresenterHost';
export { notify, notifyError, notifySuccess, snackbar } from './feedback.ts';
export { isReadySignalled, onAppPause, onAppResume, signalReady } from './lifecycle.ts';
export { ScreenHeader } from './ScreenHeader';
export { shellActions, shellStore, START_TAB, TAB_IDS, topRoute, type NestedRoute, type TabId } from './shellStore.ts';
export { BusyBar, EmptyState, ErrorState, ScreenErrorBoundary, SkeletonList, Spinner } from './StatusViews';
export { applyTheme, HAPTICS_KEY, THEME_KEY, type ThemePreference } from './theme.ts';
export { REVISION_STATUS_LABEL } from './TopBar';
export { useActiveTab, useShell, useTopRoute } from './useShell.ts';
