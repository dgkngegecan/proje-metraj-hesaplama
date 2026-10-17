import { useEffect, useRef } from 'react';
import { isBridgeAvailable, onBridgeEvent, sendBridgeCommand } from '../../lib/transport.ts';
import { createBackStack, type BackHandler, type BackLayer } from './backStack.ts';

/** Uygulamanın tek geri yığını. */
export const backStack = createBackStack();

/** Geri yığını boşken: köprüde uygulamayı kapatır; tarayıcıda yapılacak bir şey yoktur. */
export function exitApp() {
  sendBridgeCommand('exitApp');
}

/** Ekrandaki "←" düğmeleri de donanım geri tuşuyla AYNI yolu izler. */
export function requestBack() {
  if (backStack.handleBack() === 'exit') exitApp();
}

/**
 * Geri tuşunu dinleyen kanca. İşleyici `false` dönerse geri tuşu bir alt
 * katmana geçer. Katman sırası: `sheet` → `nested` → `tab` (bkz. backStack.ts).
 *
 *   useBackHandler(() => { if (!editing) return false; setEditing(false); });
 */
export function useBackHandler(handler: BackHandler, options: { enabled?: boolean; layer?: BackLayer } = {}) {
  const { enabled = true, layer = 'nested' } = options;
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return backStack.register(layer, () => latest.current());
  }, [enabled, layer]);
}

/**
 * Tarayıcıda (vite dev, Playwright) geri tuşunu yakalamak için tek bir
 * "nöbetçi" geçmiş kaydı tutulur: geri basıldığında `popstate` gelir, yığın
 * işlerse nöbetçi yeniden eklenir; işlemezse eklenmez ve bir sonraki geri
 * sayfadan çıkar. Kayıt yalnız bir kullanıcı etkileşiminde eklenir: Chrome
 * etkileşimsiz eklenen kayıtları geri tuşunda atlıyor.
 */
function installBrowserBackGuard() {
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    window.history.pushState({ metrajBackGuard: true }, '');
  };
  const onPopState = () => {
    armed = false;
    if (backStack.handleBack() === 'handled') arm();
  };
  window.addEventListener('popstate', onPopState);
  window.addEventListener('click', arm, { capture: true });
  window.addEventListener('keydown', arm, { capture: true });
  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('click', arm, { capture: true });
    window.removeEventListener('keydown', arm, { capture: true });
  };
}

let installCount = 0;
let uninstall: (() => void) | null = null;

/** Donanım/tarayıcı geri tuşunu yığına bağlar. Birden çok çağrı tek kurulum sayılır. */
export function installBackButton(): () => void {
  installCount += 1;
  if (!uninstall) {
    // Köprüde Android geri tuşunu kendisi yakalar ve `back` olayı gönderir;
    // WebView geçmişine dokunulmaz.
    uninstall = isBridgeAvailable() ? onBridgeEvent('back', requestBack) : installBrowserBackGuard();
  }
  return () => {
    installCount -= 1;
    if (installCount === 0 && uninstall) {
      uninstall();
      uninstall = null;
    }
  };
}
