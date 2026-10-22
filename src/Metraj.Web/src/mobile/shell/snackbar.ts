/**
 * Alt bilgi çubuğu (snackbar) denetleyicisi — React'siz, sınanabilir.
 *
 * Aynı anda tek çubuk görünür; yenisi gelince eskisi `replaced` nedeniyle
 * kapanır (Material davranışı). "Geri al" çubuğu kapanırken nedeni bilinir:
 * `action` dışındaki her neden silmenin gönderilmesi demektir.
 * Kullanıcı çubuğa dokunurken süre durur (okumadan kaybolmasın).
 */

export type SnackbarTone = 'info' | 'success' | 'error';
export type SnackbarCloseReason = 'timeout' | 'action' | 'dismiss' | 'replaced' | 'flush';

export interface SnackbarOptions {
  message: string;
  tone?: SnackbarTone;
  action?: { label: string; onAction: () => void };
  /** 0 = kendiliğinden kapanmaz. */
  durationMs?: number;
  onClose?: (reason: SnackbarCloseReason) => void;
}

export interface SnackbarItem {
  id: number;
  message: string;
  tone: SnackbarTone;
  action?: { label: string; onAction: () => void };
  durationMs: number;
}

export interface SnackbarTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const SNACKBAR_DURATION = { info: 4000, success: 4000, error: 6000, action: 6000 } as const;

export interface SnackbarController {
  show(options: SnackbarOptions): number;
  dismiss(id: number, reason?: SnackbarCloseReason): void;
  /** Eylem düğmesine basıldı. */
  act(id: number): void;
  /** Dokunma/odak süresince zamanlayıcıyı durdurur. */
  hold(): void;
  release(): void;
  /** Uygulama arka plana geçiyor: açık çubuk kapanır (geri al işlemi gönderilir). */
  flush(): void;
  readonly current: SnackbarItem | null;
  subscribe(listener: () => void): () => void;
}

const defaultTimers: SnackbarTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createSnackbarController(timers: SnackbarTimers = defaultTimers): SnackbarController {
  let current: SnackbarItem | null = null;
  // useSyncExternalStore aynı durum için aynı nesneyi bekler: `current`
  // kendisi anlık görüntüdür, kapanış geri çağrısı ayrı tutulur.
  let onClose: SnackbarOptions['onClose'];
  let timer: unknown;
  let startedAt = 0;
  let remaining = 0;
  let held = false;
  let nextId = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const stopTimer = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  const startTimer = (ms: number) => {
    stopTimer();
    if (!current || ms <= 0 || held) return;
    const id = current.id;
    startedAt = timers.now();
    remaining = ms;
    timer = timers.set(() => close(id, 'timeout'), ms);
  };

  function close(id: number, reason: SnackbarCloseReason) {
    if (!current || current.id !== id) return;
    const closing = onClose;
    current = null;
    onClose = undefined;
    stopTimer();
    held = false;
    notify();
    closing?.(reason);
  }

  return {
    show(options) {
      if (current) close(current.id, 'replaced');
      const tone = options.tone ?? 'info';
      const durationMs = options.durationMs ?? (options.action ? SNACKBAR_DURATION.action : SNACKBAR_DURATION[tone]);
      current = Object.freeze({ id: ++nextId, message: options.message, tone, action: options.action, durationMs });
      onClose = options.onClose;
      remaining = durationMs;
      notify();
      startTimer(durationMs);
      return current.id;
    },
    dismiss(id, reason = 'dismiss') {
      close(id, reason);
    },
    act(id) {
      if (!current || current.id !== id) return;
      const action = current.action;
      close(id, 'action');
      action?.onAction();
    },
    hold() {
      if (!current || held) return;
      held = true;
      if (timer !== undefined) {
        remaining = Math.max(0, remaining - (timers.now() - startedAt));
        stopTimer();
      }
    },
    release() {
      if (!current || !held) return;
      held = false;
      // En az 1,5 sn daha görünür: parmağını kaldıran kullanıcı metni okuyabilsin.
      startTimer(current.durationMs > 0 ? Math.max(remaining, 1500) : 0);
    },
    flush() {
      if (current) close(current.id, 'flush');
    },
    get current() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
