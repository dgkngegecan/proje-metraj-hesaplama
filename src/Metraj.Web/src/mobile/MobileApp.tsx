import { useEffect } from 'react';
import { setHapticsEnabled } from './components/haptics.ts';
import { installBackButton } from './shell/back.ts';
import { AppShell } from './shell/AppShell';
import { DownloadPresenterHost } from './shell/DownloadPresenterHost';
import { installFeedback, snackbar } from './shell/feedback.ts';
import { onAppPause, signalReady } from './shell/lifecycle.ts';
import { SnackbarHost } from './shell/SnackbarHost';
import { applyTheme, HAPTICS_KEY, parseThemePreference, THEME_KEY } from './shell/theme.ts';
import { actions, drafts, flushPendingWrites, persistSelection, readSavedSelection } from './store';

/** Açılış ekranı en geç bu süre sonra kapanır: veri gelmese de kullanıcı iskeleti görür, donmuş bir logo değil. */
const READY_FALLBACK_MS = 1200;

/**
 * Telefon uygulamasının kökü: kabuk + küresel ana bilgisayarlar (alt bilgi
 * çubuğu, indirme sorusu) + yaşam döngüsü bağlantıları.
 */
export function MobileApp() {
  useEffect(() => {
    installFeedback();
    const cleanups = [
      installBackButton(),
      persistSelection(),
      // Arka plana geçerken: biriken taslaklar ve süresi dolmamış "Geri al"lar gönderilir.
      onAppPause(() => {
        snackbar.flush();
        flushPendingWrites();
      }),
    ];

    const fallback = window.setTimeout(signalReady, READY_FALLBACK_MS);
    // Taslaklar (hatırlanan seçim, tercihler) ve proje listesi paralel okunur.
    const preferred = drafts.init().then(() => {
      applyTheme(parseThemePreference(drafts.read(THEME_KEY)));
      setHapticsEnabled(drafts.read(HAPTICS_KEY) !== '"off"');
      return readSavedSelection() ?? {};
    });
    void actions.bootstrap(preferred).finally(() => {
      window.clearTimeout(fallback);
      // Bir sonraki karede: ilk gerçek içerik çizildikten sonra.
      requestAnimationFrame(() => requestAnimationFrame(signalReady));
    });

    return () => {
      window.clearTimeout(fallback);
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return (
    <>
      <AppShell />
      <SnackbarHost />
      <DownloadPresenterHost />
    </>
  );
}
