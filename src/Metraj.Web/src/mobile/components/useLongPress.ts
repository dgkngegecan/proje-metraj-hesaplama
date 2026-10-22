import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

export interface LongPressOptions {
  delayMs?: number;
  /** Parmak bu kadar kayarsa uzun basma iptal olur (liste kaydırması). */
  moveTolerance?: number;
  disabled?: boolean;
}

/**
 * Uzun basma (eylem paneli açmak için). Android Chrome uzun basmada ayrıca
 * `contextmenu` olayı da üretir; ikisi tek tetiklemeye indirgenir. Uzun
 * basmanın ardından gelen `click` yutulur ki satır bir de "açılmasın".
 *
 *   const press = useLongPress(() => setMenuOpen(true));
 *   <button {...press.handlers} onClick={press.guardClick(open)}>…</button>
 */
export function useLongPress(onLongPress: () => void, options: LongPressOptions = {}) {
  const { delayMs = 480, moveTolerance = 10, disabled = false } = options;
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    cancel();
    callback.current();
  }, [cancel]);

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(fire, delayMs);
    },
    onPointerMove: (event: PointerEvent) => {
      const origin = start.current;
      if (!origin) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > moveTolerance) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent) => {
      if (disabled) return;
      event.preventDefault();
      fire();
    },
  };

  /** `onClick` sarmalayıcısı: uzun basmadan sonra gelen tıklamayı yok sayar. */
  const guardClick = useCallback(
    <E>(handler?: (event: E) => void) =>
      (event: E) => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        handler?.(event);
      },
    [],
  );

  return { handlers, guardClick, cancel };
}
