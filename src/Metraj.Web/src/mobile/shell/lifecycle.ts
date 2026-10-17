import { onBridgeEvent, sendBridgeCommand } from '../../lib/transport.ts';

/**
 * Uygulama yaşam döngüsü. Android'de etkinlik arka plana geçerken köprü
 * `pause` olayı gönderir; tarayıcıda karşılığı `visibilitychange` (hidden) ve
 * `pagehide`'dır. Dinleyici her iki kaynaktan da çağrılabilir, işi tekrar
 * edilebilir olmalıdır (ör. bekleyen yazımları boşaltmak).
 */
export function onAppPause(listener: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') listener();
  };
  const offBridge = onBridgeEvent('pause', listener);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', listener);
  return () => {
    offBridge();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', listener);
  };
}

export function onAppResume(listener: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') listener();
  };
  const offBridge = onBridgeEvent('resume', listener);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    offBridge();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

let readySent = false;

/**
 * Açılış ekranını kapatır (köprüde `ready`) ve ölçüm için `metraj:ready`
 * performans işaretini koyar. Bir kez çalışır.
 */
export function signalReady() {
  if (readySent) return;
  readySent = true;
  try {
    performance.mark('metraj:ready');
  } catch {
    // performance.mark yoksa ölçüm işareti olmadan devam edilir.
  }
  sendBridgeCommand('ready');
}

export function isReadySignalled() {
  return readySent;
}
