/**
 * Kalıcı taslaklar (yarım kalmış sayımlar, açık kutular, tercih edilen seçim).
 *
 * Masaüstündeki `/ui-state` mekanizması (src/uiState.ts) aynen kullanılır:
 * değer önce yerel aynaya, sonra uygulama veritabanına yazılır. Telefonda tuş
 * takımıyla yazarken her tuşta bir köprü yazımı göndermek gereksiz; yazımlar
 * kısa bir süre biriktirilir ve uygulama arka plana geçerken (`visibilitychange`
 * / köprünün `pause` olayı) hemen boşaltılır.
 *
 * Anahtar deseni masaüstüyle aynıdır: `{tür}.v1.{kimlik}`; ör.
 * `fitting-draft.v1.{placementId}`, `radiator-draft.v1.{placementId}`.
 * Biçim değişirse sürüm artırılır (`.v2.`), eski anahtar okunmaz.
 *
 * Bu dosya saftır: tests/mobile-store.test.mjs.
 */

const KIND = /^[a-z][a-z0-9-]*$/;

export function draftKey(kind: string, id: string, version = 1): string {
  if (!KIND.test(kind)) throw new Error(`Geçersiz taslak türü: ${kind}`);
  if (!id || /\s/.test(id)) throw new Error(`Geçersiz taslak kimliği: "${id}"`);
  if (!Number.isInteger(version) || version < 1) throw new Error(`Geçersiz taslak sürümü: ${version}`);
  return `${kind}.v${version}.${id}`;
}

/** Bozuk veya beklenmeyen biçimdeki taslak sessizce yok sayılır; uygulama açılmaya devam eder. */
export function parseDraft<T>(raw: string | null | undefined, guard: (value: unknown) => value is T): T | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

export interface DraftTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface WriteBufferOptions {
  write(key: string, valueJson: string): void;
  clear(key: string): void;
  /** Son yazımdan sonra beklenen süre. */
  delayMs?: number;
  /** Sürekli yazımda bile en geç bu kadar sürede boşaltılır. */
  maxWaitMs?: number;
  timers?: DraftTimers;
  now?: () => number;
}

export type PendingDraft = { kind: 'write'; valueJson: string } | { kind: 'clear' };

export interface WriteBuffer {
  set(key: string, valueJson: string): void;
  remove(key: string): void;
  /** Bekleyen yazımın değeri (henüz gönderilmemiş olsa da okuma bunu görmeli). */
  peek(key: string): PendingDraft | undefined;
  flush(): void;
  readonly size: number;
}

const defaultTimers: DraftTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createWriteBuffer(options: WriteBufferOptions): WriteBuffer {
  const delayMs = options.delayMs ?? 400;
  const maxWaitMs = options.maxWaitMs ?? 2000;
  const timers = options.timers ?? defaultTimers;
  const now = options.now ?? Date.now;
  const pending = new Map<string, PendingDraft>();
  let timer: unknown;
  let firstPendingAt = 0;

  const flush = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    const entries = [...pending];
    pending.clear();
    for (const [key, entry] of entries) {
      try {
        if (entry.kind === 'write') options.write(key, entry.valueJson);
        else options.clear(key);
      } catch (error) {
        // Bir anahtarın yazımı ötekileri engellememeli.
        console.error(`Taslak yazılamadı: ${key}`, error);
      }
    }
  };

  const schedule = () => {
    const at = now();
    if (!pending.size) return;
    if (timer === undefined) firstPendingAt = at;
    else timers.clear(timer);
    const waited = at - firstPendingAt;
    timer = timers.set(flush, Math.max(0, Math.min(delayMs, maxWaitMs - waited)));
  };

  return {
    set(key, valueJson) {
      pending.set(key, { kind: 'write', valueJson });
      schedule();
    },
    remove(key) {
      pending.set(key, { kind: 'clear' });
      schedule();
    },
    peek: (key) => pending.get(key),
    flush,
    get size() {
      return pending.size;
    },
  };
}

export type UiStateMap = Record<string, string>;

export interface DraftStoreDeps {
  load(): Promise<UiStateMap>;
  read(map: UiStateMap, key: string): string | null;
  write(map: UiStateMap, key: string, valueJson: string): void;
  clear(map: UiStateMap, key: string): void;
  delayMs?: number;
  maxWaitMs?: number;
  timers?: DraftTimers;
  now?: () => number;
}

export interface DraftStore {
  /** Açılışta bir kez: sunucudaki taslakları okur. Başarısız olsa da `ready` olur (yerel ayna kalır). */
  init(): Promise<void>;
  readonly ready: boolean;
  /** `ready` değiştiğinde çağrılır; dönen işlev aboneliği kaldırır. */
  subscribe(listener: () => void): () => void;
  read(key: string): string | null;
  write(key: string, valueJson: string): void;
  clear(key: string): void;
  flush(): void;
  readonly pendingCount: number;
}

export function createDraftStore(deps: DraftStoreDeps): DraftStore {
  let map: UiStateMap = {};
  let ready = false;
  const listeners = new Set<() => void>();
  const buffer = createWriteBuffer({
    write: (key, valueJson) => deps.write(map, key, valueJson),
    clear: (key) => deps.clear(map, key),
    delayMs: deps.delayMs,
    maxWaitMs: deps.maxWaitMs,
    timers: deps.timers,
    now: deps.now,
  });

  const read = (key: string) => {
    const pending = buffer.peek(key);
    if (pending) return pending.kind === 'write' ? pending.valueJson : null;
    return deps.read(map, key);
  };

  return {
    async init() {
      try {
        const loaded = await deps.load();
        // init sürerken yazılmış değerler kaybolmasın: yüklenen haritaya taşınır.
        map = { ...loaded, ...map };
      } catch {
        // Sunucuya ulaşılamadı: yerel ayna (readUiState) yine okunur.
      } finally {
        ready = true;
        for (const listener of [...listeners]) listener();
      }
    },
    get ready() {
      return ready;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read,
    write(key, valueJson) {
      if (read(key) === valueJson) return;
      buffer.set(key, valueJson);
    },
    clear(key) {
      if (read(key) === null) return;
      buffer.remove(key);
    },
    flush: () => buffer.flush(),
    get pendingCount() {
      return buffer.size;
    },
  };
}
