import { sendBridgeCommand, type HapticKind } from '../../lib/transport.ts';

/**
 * Titreşimli geri bildirim. Köprüde yerel `haptic` komutu (Android
 * HapticFeedbackConstants; sistem ayarına uyar), tarayıcıda varsa
 * `navigator.vibrate`. Ayarlar'dan kapatılabilir.
 *
 *   tick    — tuş, artırıcı adımı, seçim
 *   confirm — kayıt başarılı
 *   reject  — geçersiz giriş, sınır, hata
 */
const VIBRATION: Record<HapticKind, number | number[]> = {
  tick: 8,
  confirm: [12, 40, 18],
  reject: [30, 50, 30],
};

let enabled = true;

export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function hapticsEnabled() {
  return enabled;
}

export function haptic(kind: HapticKind = 'tick') {
  if (!enabled) return;
  if (sendBridgeCommand('haptic', { kind })) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Chrome, sayfaya hiç dokunulmadan yapılan titreşim çağrısını reddedip konsola
  // hata yazıyor (ör. açılışta gelen bir hata bildirimi); o durumda sessizce geçilir.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate(VIBRATION[kind]);
  } catch {
    // Titreşim desteklenmiyor veya engellendi; önemsiz.
  }
}
