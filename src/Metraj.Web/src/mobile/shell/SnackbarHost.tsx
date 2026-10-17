import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { snackbar } from './feedback.ts';

const getCurrent = () => snackbar.current;

/**
 * Alt bilgi çubuğunun görünümü. `document.body`'ye çizilir: alttan panel
 * açıkken uygulama kökü `inert` olur, "Geri al" yine dokunulabilir kalmalı.
 * Hata çubukları `role="alert"`, diğerleri kibar canlı bölge.
 */
export function SnackbarHost() {
  const current = useSyncExternalStore(snackbar.subscribe, getCurrent, getCurrent);
  return createPortal(
    <div className="m-snackbar-region" aria-live="polite" aria-atomic="true">
      {current && (
        <div
          key={current.id}
          className={`m-snackbar m-snackbar--${current.tone}`}
          role={current.tone === 'error' ? 'alert' : 'status'}
          onPointerDown={() => snackbar.hold()}
          onPointerUp={() => snackbar.release()}
          onPointerCancel={() => snackbar.release()}
          onFocus={() => snackbar.hold()}
          onBlur={() => snackbar.release()}
        >
          <p className="m-snackbar__message">{current.message}</p>
          {current.action ? (
            <button type="button" className="m-snackbar__action" onClick={() => snackbar.act(current.id)}>
              {current.action.label}
            </button>
          ) : (
            <button
              type="button"
              className="m-icon-button m-snackbar__close"
              aria-label="Bildirimi kapat"
              onClick={() => snackbar.dismiss(current.id)}
            >
              <Icon name="close" size={20} />
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
