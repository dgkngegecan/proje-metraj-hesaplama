import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { haptic } from './haptics.ts';
import { lockAxis, resolveSwipe, swipeOffset, type SwipeAxis } from './swipe.ts';
import { useLongPress } from './useLongPress.ts';

export interface SwipeAction {
  id: string;
  label: string;
  icon?: IconName;
  tone?: 'danger' | 'primary' | 'neutral';
  onAction: () => void;
}

export interface SwipeRowProps {
  children: ReactNode;
  /** Sola kaydırınca sağda görünen eylemler (soldan sağa). */
  actions: readonly SwipeAction[];
  /** Tam kaydırmada çalışacak eylem; verilmezse tam kaydırma kapalı. Genellikle "sil". */
  fullSwipeActionId?: string;
  onPress?: () => void;
  /** Uzun basma (genellikle aynı eylemleri içeren `ActionSheet`'i açar). */
  onLongPress?: () => void;
  disabled?: boolean;
  /** Satırın ekran okuyucu adı; içerik zaten anlatıyorsa gerekmez. */
  ariaLabel?: string;
}

const ACTION_WIDTH = 88;
// Aynı anda tek satır açık kalır.
let closeOpenRow: (() => void) | null = null;

/**
 * Kaydırarak eylem gösteren liste satırı. Dikey kaydırma listeye kalır
 * (`touch-action: pan-y`); yatay jest ilk 8 px'te kilitlenir. Açık satıra
 * dokunmak onu kapatır. Uzun basma ve klavyedeki Menü / Shift+F10 tuşu
 * `onLongPress`'i çağırır — kaydıramayan kullanıcı eylemlere oradan ulaşır.
 */
export function SwipeRow({
  children,
  actions,
  fullSwipeActionId,
  onPress,
  onLongPress,
  disabled = false,
  ariaLabel,
}: SwipeRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    axis: SwipeAxis;
    lastX: number;
    lastT: number;
    velocity: number;
  } | null>(null);
  const moved = useRef(false);
  const actionsWidth = actions.length * ACTION_WIDTH;
  const fullAction = actions.find((action) => action.id === fullSwipeActionId);
  const longPress = useLongPress(() => onLongPress?.(), { disabled: disabled || !onLongPress });

  // Kimliği sabit kapatıcı: "açık satır" kaydı satır kaldırılınca da temizlenebilsin.
  const close = useRef(() => setOffset(0)).current;
  useEffect(
    () => () => {
      if (closeOpenRow === close) closeOpenRow = null;
    },
    [close],
  );
  useEffect(() => {
    if (offset >= 0) return;
    if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    closeOpenRow = close;
  }, [offset, close]);

  const runAction = (action: SwipeAction) => {
    haptic(action.tone === 'danger' ? 'confirm' : 'tick');
    setOffset(0);
    action.onAction();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    longPress.handlers.onPointerDown(event);
    if (disabled || !actions.length || (event.pointerType === 'mouse' && event.button !== 0)) return;
    moved.current = false;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: offset,
      axis: null,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: 0,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    longPress.handlers.onPointerMove(event);
    const state = gesture.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      state.axis = lockAxis(dx, dy);
      if (state.axis === 'y') {
        gesture.current = null;
        return;
      }
      if (state.axis === 'x') {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        longPress.cancel();
      }
    }
    if (state.axis !== 'x') return;
    moved.current = true;
    const dt = Math.max(1, event.timeStamp - state.lastT);
    state.velocity = (event.clientX - state.lastX) / dt;
    state.lastX = event.clientX;
    state.lastT = event.timeStamp;
    const rowWidth = rowRef.current?.offsetWidth ?? 360;
    setOffset(swipeOffset(dx, state.start, { actionsWidth, rowWidth, fullSwipe: Boolean(fullAction) }));
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    longPress.handlers.onPointerUp();
    const state = gesture.current;
    gesture.current = null;
    if (!state || state.id !== event.pointerId || state.axis !== 'x') return;
    setDragging(false);
    const rowWidth = rowRef.current?.offsetWidth ?? 360;
    const geometry = { actionsWidth, rowWidth, fullSwipe: Boolean(fullAction) };
    // Karar BIRAKMA noktasına göre verilir: hızlı bir jestte son pointermove
    // olayı parmağın kalktığı yerden çok geride kalabiliyor.
    const finalOffset = swipeOffset(event.clientX - state.x, state.start, geometry);
    const outcome = event.type === 'pointercancel' ? 'closed' : resolveSwipe(finalOffset, state.velocity, geometry);
    if (outcome === 'full' && fullAction) {
      setOffset(-rowWidth);
      // Satır ekrandan çıkarken eylem çalışır (ör. sil + geri al çubuğu).
      window.setTimeout(() => runAction(fullAction), 140);
    } else if (outcome === 'open') {
      if (offset > -actionsWidth) haptic('tick');
      setOffset(-actionsWidth);
    } else setOffset(0);
  };

  const onClick = longPress.guardClick(() => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (offset < 0) {
      close();
      return;
    }
    onPress?.();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && onLongPress) {
      event.preventDefault();
      onLongPress();
    } else if (event.key === 'Escape' && offset < 0) {
      close();
    } else if ((event.key === 'Enter' || event.key === ' ') && onPress && event.target === event.currentTarget) {
      event.preventDefault();
      onPress();
    }
  };

  const open = offset < 0;
  return (
    <div ref={rowRef} className={`m-swipe${open ? ' is-open' : ''}`}>
      <div className="m-swipe__actions" style={{ width: actionsWidth }} aria-hidden={!open}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`m-swipe__action m-swipe__action--${action.tone ?? 'neutral'}`}
            style={{ width: ACTION_WIDTH }}
            tabIndex={open ? 0 : -1}
            onClick={() => runAction(action)}
          >
            {action.icon && <Icon name={action.icon} />}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <div
        className={`m-swipe__content m-pressable${dragging ? ' is-dragging' : ''}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        role={onPress ? 'button' : undefined}
        tabIndex={onPress || onLongPress ? 0 : undefined}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={longPress.handlers.onPointerLeave}
        onContextMenu={longPress.handlers.onContextMenu}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
