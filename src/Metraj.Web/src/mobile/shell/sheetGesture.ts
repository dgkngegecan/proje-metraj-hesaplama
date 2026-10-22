/**
 * Alttan açılan panelin sürükleyerek kapatma kararları (saf).
 */

/** Aşağı sürükleme serbest; yukarı sürükleme dirençli (panel tutamaçtan kopmuş gibi görünmesin). */
export function sheetDragOffset(dy: number): number {
  return dy >= 0 ? dy : dy / 5;
}

/**
 * Bırakınca kapansın mı? Panelin üçte biri (en fazla 160 px) kadar indirildiyse
 * ya da hızlıca aşağı fırlatıldıysa kapanır. `velocity` px/ms, aşağı pozitif.
 */
export function shouldDismissSheet(dy: number, velocity: number, height: number): boolean {
  if (dy <= 0) return false;
  const distance = Math.min(Math.max(height, 1) * 0.33, 160);
  return dy > distance || (velocity > 0.55 && dy > 24);
}

/**
 * Klavye açıkken panelin altında kalan alan. Android WebView'da klavye görsel
 * görüntü alanını küçültür ama düzen görüntü alanı (innerHeight) değişmeyebilir;
 * alttaki eylem düğmeleri klavyenin arkasında kalıyordu.
 */
export function keyboardInset(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  const inset = layoutHeight - visualHeight - visualOffsetTop;
  // Kaydırma çubuğu/yuvarlama titremesini yok say; klavye en az ~120 px'tir.
  return inset > 40 ? Math.round(inset) : 0;
}
