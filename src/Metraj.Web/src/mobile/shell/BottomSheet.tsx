import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useBackHandler } from './back.ts';
import { keyboardInset, sheetDragOffset, shouldDismissSheet } from './sheetGesture.ts';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[inert]') && element.getClientRects().length > 0,
  );
}

// Arka plandaki uygulama, panel açıkken ekran okuyucu ve klavye için erişilemez
// olur (`inert`). İç içe paneller için sayaç tutulur.
let inertCount = 0;
function setBackgroundInert(active: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  inertCount = Math.max(0, inertCount + (active ? 1 : -1));
  if (inertCount > 0) root.setAttribute('inert', '');
  else root.removeAttribute('inert');
}

/**
 * Klavye açıkken görsel görüntü alanının altta kapladığı yükseklik.
 * Panel bu kadar yukarı alınır; alttaki "Kaydet" düğmesi klavyenin arkasında kalmaz.
 */
export function useKeyboardInset(active: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () => setInset(keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Başlığı görsel olarak gizler (ekran okuyucu yine okur). */
  hideTitle?: boolean;
  description?: ReactNode;
  children?: ReactNode;
  /** Altta sabit kalan eylemler (Kaydet, Vazgeç). Klavye açıkken klavyenin üstünde durur. */
  footer?: ReactNode;
  /** `auto`: içerik kadar; `tall`: ekranın ~%85'i; `full`: tam ekran. */
  size?: 'auto' | 'tall' | 'full';
  /** false: kaydırma, arka plan ve geri tuşuyla kapanmaz (ör. kayıt sürerken). Geri tuşu yine yutulur. */
  dismissible?: boolean;
  /** Açılışta odaklanacak öğe; verilmezse içerikteki ilk odaklanabilir öğe, o da yoksa panelin kendisi. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

const EXIT_MS = 220;

/**
 * Alttan açılan panel. Tutamaç veya başlıktan aşağı sürükleyerek, arka plana
 * dokunarak, Escape veya geri tuşuyla kapanır. `role="dialog"` + `aria-modal`,
 * odak tuzağı, kapanışta odağın geri verilmesi, arka planın `inert` yapılması.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  hideTitle,
  description,
  children,
  footer,
  size = 'auto',
  dismissible = true,
  initialFocus,
  className,
}: BottomSheetProps) {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<'enter' | 'open' | 'exit'>('enter');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ pointerId: number; startY: number; lastY: number; lastT: number; velocity: number } | null>(
    null,
  );
  const inset = useKeyboardInset(rendered);
  const close = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  // Açılış / kapanış animasyonu: kapanırken kısa bir süre daha çizilir.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setPhase('enter');
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
      return () => cancelAnimationFrame(frame);
    }
    if (!rendered) return;
    setPhase('exit');
    const timer = window.setTimeout(() => setRendered(false), EXIT_MS);
    return () => window.clearTimeout(timer);
    // `rendered` bilerek bağımlılık değil: yalnız `open` değişimine tepki verilir.
  }, [open]);

  useLayoutEffect(() => {
    if (!rendered) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBackgroundInert(true);
    return () => {
      setBackgroundInert(false);
      const target = previousFocus.current;
      // Odak, paneli açan öğeye döner (hâlâ sayfadaysa).
      if (target && document.contains(target)) target.focus({ preventScroll: true });
    };
  }, [rendered]);

  useEffect(() => {
    if (!open || !rendered) return;
    const panel = panelRef.current;
    if (!panel) return;
    // Önce içerikteki ilk öğe (liste seçeneği, tuş takımı); başlıktaki "Kapat" son çare.
    const body = panel.querySelector<HTMLElement>('.m-sheet__body');
    const target = initialFocus?.current ?? (body && focusableIn(body)[0]) ?? focusableIn(panel)[0] ?? panel;
    target.focus({ preventScroll: true });
  }, [open, rendered, initialFocus]);

  // Geri tuşu önce paneli kapatır. Kapatılamayan panel geri tuşunu yine yutar
  // ki arkadaki ekran habersizce değişmesin.
  useBackHandler(
    () => {
      close();
    },
    { enabled: open, layer: 'sheet' },
  );

  // Klavye açılınca odaktaki alan görünür kalsın.
  useEffect(() => {
    if (!inset) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && panelRef.current?.contains(active))
      active.scrollIntoView({ block: 'nearest' });
  }, [inset]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusableIn(panelRef.current);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!dismissible || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
  };
  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dt = Math.max(1, event.timeStamp - state.lastT);
    state.velocity = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    setDragY(sheetDragOffset(event.clientY - state.startY));
  };
  const onDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    const dy = event.clientY - state.startY;
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    if (event.type !== 'pointercancel' && shouldDismissSheet(dy, state.velocity, height)) {
      setDragY(Math.max(dy, 0));
      close();
      // Kapanma animasyonu sürüklenen konumdan devam eder.
      window.setTimeout(() => setDragY(0), EXIT_MS);
    } else {
      setDragY(0);
    }
  };

  if (!rendered) return null;

  const dragging = drag.current !== null;
  return createPortal(
    <div className={`m-sheet-layer m-sheet-layer--${phase}`} style={{ ['--m-keyboard-inset' as string]: `${inset}px` }}>
      <div className="m-sheet-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`m-sheet m-sheet--${size}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: dragging ? 'none' : undefined } : undefined}
      >
        <div
          className="m-sheet__header"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span className="m-sheet__handle" aria-hidden="true" />
          <div className="m-sheet__titlebar">
            <h2 id={titleId} className={hideTitle ? 'm-visually-hidden' : 'm-sheet__title'}>
              {title}
            </h2>
            {dismissible && (
              <button type="button" className="m-icon-button" onClick={close} aria-label="Kapat">
                <Icon name="close" />
              </button>
            )}
          </div>
          {description && (
            <p id={descriptionId} className="m-sheet__description">
              {description}
            </p>
          )}
        </div>
        <div className="m-sheet__body">{children}</div>
        {footer && <div className="m-sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
