/**
 * Büyük artırıcının (+/−) dokunma hareketi (saf durum makinesi).
 *
 * Önceden adım `pointerdown` anında atılıyordu. Parmak listeyi kaydırmak için
 * bir +/− düğmesinin üstünden başlayınca tarayıcı önce `pointerdown`, kaydırma
 * başlayınca `pointercancel` gönderiyor; adet fark edilmeden bir artıyor ya da
 * azalıyordu ve fitting/radyatör sayımı bu değeri teklif miktarına taşıyordu.
 *
 * Kurallar:
 * - Dokunma: adım, parmak hareket etmeden KALKINCA atılır.
 * - Kaydırma: tarayıcı iptal ederse (`cancel`) ya da parmak eşikten fazla
 *   kayarsa hiçbir şey uygulanmaz.
 * - Basılı tutma: ilk adım gecikmeden sonra (`longPress`) atılır, sonra tekrar
 *   başlar; parmak kalkınca ek adım atılmaz.
 * - Klavye / ekran okuyucu tıklaması (işaretçisiz `click`) tek adım atar;
 *   işaretçiyle yapılmış bir hareketin ardından gelen `click` yutulur.
 */

/** Bu kadar pikselden fazla kayan parmak dokunma değil, kaydırma sayılır. */
export const TAP_MOVE_TOLERANCE_PX = 10;

export type GesturePhase = 'idle' | 'pressed' | 'repeating' | 'moved';

export interface GestureState {
  phase: GesturePhase;
  startX: number;
  startY: number;
  /** Az önce işaretçiyle işlenmiş bir hareketin ardından gelecek `click` yutulsun mu? */
  suppressClick: boolean;
}

export type GestureEvent =
  | { type: 'down'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'longPress' }
  | { type: 'up' }
  | { type: 'cancel' }
  | { type: 'click' };

/** `armLongPress`: uzun basma zamanlayıcısını kur; `startRepeat`: tekrar döngüsünü başlat. */
export type GestureEffect = 'step' | 'armLongPress' | 'startRepeat' | 'stopTimers';

export const initialGestureState: GestureState = { phase: 'idle', startX: 0, startY: 0, suppressClick: false };

export function reduceGesture(
  state: GestureState,
  event: GestureEvent,
): { state: GestureState; effects: GestureEffect[] } {
  switch (event.type) {
    case 'down':
      return {
        state: { phase: 'pressed', startX: event.x, startY: event.y, suppressClick: false },
        effects: ['stopTimers', 'armLongPress'],
      };
    case 'move': {
      if (state.phase !== 'pressed') return { state, effects: [] };
      const moved = Math.hypot(event.x - state.startX, event.y - state.startY) > TAP_MOVE_TOLERANCE_PX;
      return moved ? { state: { ...state, phase: 'moved' }, effects: ['stopTimers'] } : { state, effects: [] };
    }
    case 'longPress':
      if (state.phase !== 'pressed') return { state, effects: [] };
      return { state: { ...state, phase: 'repeating' }, effects: ['step', 'startRepeat'] };
    case 'up':
      if (state.phase === 'idle') return { state, effects: [] };
      return {
        state: { ...state, phase: 'idle', suppressClick: true },
        effects: state.phase === 'pressed' ? ['stopTimers', 'step'] : ['stopTimers'],
      };
    case 'cancel':
      // İptalden sonra `click` gelmez; bayrak kalırsa sonraki klavye tıklaması yutulurdu.
      return { state: { ...state, phase: 'idle', suppressClick: false }, effects: ['stopTimers'] };
    case 'click':
      if (state.suppressClick) return { state: { ...state, suppressClick: false }, effects: [] };
      if (state.phase !== 'idle') return { state, effects: [] };
      return { state, effects: ['step'] };
  }
}
