import { ApiError } from '../../api.ts';
import { errorMessage } from '../store/appStore.ts';
import { configureFeedback } from '../store/optimistic.ts';
import { haptic } from '../components/haptics.ts';
import { createSnackbarController, type SnackbarOptions } from './snackbar.ts';

/**
 * Kullanıcıya geri bildirim: tek alt bilgi çubuğu (snackbar).
 * Onay penceresi yerine silme + "Geri al" kullanılır (bkz. store/optimistic.ts).
 */
export const snackbar = createSnackbarController();

export function notify(message: string, options: Omit<SnackbarOptions, 'message'> = {}) {
  return snackbar.show({ message, ...options });
}

export function notifySuccess(message: string) {
  haptic('confirm');
  return snackbar.show({ message, tone: 'success' });
}

/** `ApiError` kendi Türkçe metnini taşır; diğer hatalarda genel metin (veya verilen yedek) gösterilir. */
export function notifyError(error: unknown, fallbackMessage?: string) {
  haptic('reject');
  // Beklenmeyen hatalar (programlama hatası) geliştirici için konsola da yazılır.
  if (!(error instanceof ApiError)) console.error(error);
  return snackbar.show({ message: errorMessage(error, fallbackMessage), tone: 'error' });
}

/** İyimser güncelleme ve geri al yardımcılarını alt bilgi çubuğuna bağlar (açılışta bir kez). */
export function installFeedback() {
  configureFeedback({
    error: notifyError,
    undo: (request) => {
      const id = snackbar.show({
        message: request.message,
        durationMs: request.durationMs,
        action: { label: request.actionLabel, onAction: request.onUndo },
        onClose: (reason) => {
          if (reason !== 'action') request.onCommit();
        },
      });
      return () => snackbar.dismiss(id);
    },
  });
}
