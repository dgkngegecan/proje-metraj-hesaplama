/**
 * Android köprüsü (`window.MetrajBridge`) için taşıma katmanı.
 *
 * Android'de yerel HTTP portu yoktur (aygıttaki başka uygulamalar loopback
 * portuna erişebilirdi). WebView ile .NET tarafı süreç içi bir
 * `WebMessageListener` üzerinden JSON metinleriyle konuşur. Sözleşme
 * docs/android-mobil-plan.md → "Köprü sözleşmesi" bölümündedir; bu dosya
 * onun JS tarafıdır ve alan adlarını harfiyen izler:
 *
 *   istek  (JS → yerel)  {"type":"request","id","method","path":"/api/...","body":"<JSON metni>"|null[,"idempotencyKey"]}
 *   yanıt  (yerel → JS)  {"type":"response","id","status","contentType","body":"<JSON metni>"|null,"file":null|{handle,name,mime,size}}
 *   ilerleme (yerel → JS) {"type":"progress","id","stage":"waiting|started"}
 *   komut  (JS → yerel)  {"type":"command","id","command":"share|saveAs|release|pickAndImport|haptic|ready|exitApp","args":{...}}
 *   olay   (yerel → JS)  {"type":"event","event":"back|pause|resume"}
 *
 * Köprü yoksa (masaüstü, `vite dev`, Playwright) `api.ts` eskisi gibi `fetch`
 * kullanır; bu modül yalnızca köprü varken devreye girer.
 *
 * Bilerek React'e ve `api.ts`'e bağımlı değildir: `node:test` ile sahte bir
 * köprüyle doğrudan sınanır (tests/transport.test.mjs).
 */

export type BridgeMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type BridgeCommandName = 'share' | 'saveAs' | 'release' | 'pickAndImport' | 'haptic' | 'ready' | 'exitApp';
export type BridgeEventName = 'back' | 'pause' | 'resume';
export type HapticKind = 'tick' | 'confirm' | 'reject';

/** Yerel tarafın diske yazdığı ikili içerik (rapor, `.metraj`). İçerik köprüden geçmez, yalnız tutamacı. */
export interface BridgeFile {
  handle: string;
  name: string;
  mime: string;
  size: number;
}

export interface BridgeResponse {
  type: 'response';
  id: string;
  status: number;
  contentType: string;
  /** JSON METNİ (ikinci kez kodlanmış); 204 veya dosya yanıtında null. */
  body: string | null;
  file: BridgeFile | null;
}

export interface BridgeRequestMessage {
  type: 'request';
  id: string;
  method: BridgeMethod;
  path: string;
  body: string | null;
  /** Yalnız verildiğinde gönderilir; yerel taraf aynı anahtarlı isteği ikinci kez işlemez. */
  idempotencyKey?: string;
}

/**
 * Yerel taraf isteği çekirdek hazır olmadan aldıysa önce `waiting`, çekirdek
 * hazır olup istek işlenmeye başlayınca `started` gönderir. Zaman aşımı sayacı
 * bekleme süresince durur: ilk kurulumda göç + tohumlama on saniyeleri
 * bulabiliyor ve bu bekleme isteğin kendi süresinden yemiyor olmalı.
 */
export type BridgeProgressStage = 'waiting' | 'started';

export interface BridgeCommandMessage {
  type: 'command';
  id: string;
  command: BridgeCommandName;
  args: Record<string, unknown>;
}

export interface BridgeEventMessage {
  type: 'event';
  event: string;
}

export type BridgeMessageListener = (event: { data: unknown }) => void;

/**
 * `WebViewCompat.addWebMessageListener` ile eklenen nesnenin kullandığımız
 * yüzeyi. Android hem `onmessage` özelliğini hem `addEventListener`'ı sunar;
 * ikisi de desteklenir.
 */
export interface MetrajBridgeLike {
  postMessage(message: string): void;
  addEventListener?(type: 'message', listener: BridgeMessageListener): void;
  removeEventListener?(type: 'message', listener: BridgeMessageListener): void;
  onmessage?: BridgeMessageListener | null;
}

export type BridgeTransportErrorCode = 'timeout' | 'unavailable' | 'disposed';

/** Köprünün kendisinden kaynaklanan hata. `api.ts` bunu `ApiError`'a çevirir. */
export class BridgeTransportError extends Error {
  readonly code: BridgeTransportErrorCode;

  constructor(code: BridgeTransportErrorCode, message: string) {
    super(message);
    this.name = 'BridgeTransportError';
    this.code = code;
  }
}

export interface BridgeTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface BridgeTransportOptions {
  /** Yanıt beklenen mesajlar için varsayılan süre. 0 = süre sınırı yok. */
  defaultTimeoutMs?: number;
  createId?: () => string;
  timers?: BridgeTimers;
  /** Ayrıştırılamayan veya sözleşmeye uymayan gelen mesajlar için (varsayılan: console.warn). */
  onProtocolError?: (reason: string, raw: unknown) => void;
}

export interface BridgeRequestInput {
  method: BridgeMethod;
  /** `/api` ön ekiyle birlikte tam yol ve sorgu: `/api/projects?x=1`. */
  path: string;
  body?: string | null;
  timeoutMs?: number;
  /** Mutasyonun kimliği; yeniden denemede aynı anahtar = aynı işlem (bkz. lib/retryKeys.ts). */
  idempotencyKey?: string;
}

export interface BridgeCommandOptions {
  /** Yalnız `pickAndImport` gibi yanıtı olan komutlar için. Diğerleri gönder-unut. */
  awaitResponse?: boolean;
  timeoutMs?: number;
}

export interface BridgeTransport {
  request(input: BridgeRequestInput): Promise<BridgeResponse>;
  command(
    name: BridgeCommandName,
    args?: Record<string, unknown>,
    options?: BridgeCommandOptions,
  ): Promise<BridgeResponse | undefined>;
  on(event: BridgeEventName, listener: () => void): () => void;
  dispose(): void;
  readonly pendingCount: number;
}

export const DEFAULT_BRIDGE_TIMEOUT_MS = 60_000;

const BRIDGE_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'DELETE']);

export function isBridgeMethod(value: string): value is BridgeMethod {
  return BRIDGE_METHODS.has(value);
}

const defaultTimers: BridgeTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Sayfa başına rastgele bir ön ek + artan sayaç: aynı oturumda çakışmaz, yeniden yüklemede de karışmaz. */
export function createIdFactory(prefix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`) {
  let counter = 0;
  return () => `${prefix}-${(++counter).toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFile(value: unknown): BridgeFile | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.handle !== 'string' || !value.handle) return undefined;
  return {
    handle: value.handle,
    name: typeof value.name === 'string' ? value.name : '',
    mime: typeof value.mime === 'string' ? value.mime : 'application/octet-stream',
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : 0,
  };
}

type IncomingMessage =
  | { kind: 'response'; response: BridgeResponse }
  | { kind: 'event'; event: string }
  | { kind: 'progress'; id: string; stage: BridgeProgressStage };

/**
 * Gelen mesajı doğrular. Sözleşme `body` alanını JSON METNİ olarak tanımlar;
 * yerel taraf yanlışlıkla nesne gönderirse metne çevrilir ki çağıran tek bir
 * biçimle uğraşsın. Sözleşmeye uymayan mesaj sessizce yutulmaz, raporlanır.
 */
export function parseIncomingMessage(raw: unknown): IncomingMessage | { kind: 'invalid'; reason: string } {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { kind: 'invalid', reason: 'JSON ayrıştırılamadı' };
    }
  }
  if (!isRecord(value)) return { kind: 'invalid', reason: 'nesne değil' };
  if (value.type === 'event') {
    return typeof value.event === 'string' && value.event
      ? { kind: 'event', event: value.event }
      : { kind: 'invalid', reason: 'olay adı yok' };
  }
  if (value.type === 'progress') {
    if (typeof value.id !== 'string' || !value.id) return { kind: 'invalid', reason: 'ilerlemede id yok' };
    return value.stage === 'waiting' || value.stage === 'started'
      ? { kind: 'progress', id: value.id, stage: value.stage }
      : { kind: 'invalid', reason: `bilinmeyen ilerleme: ${String(value.stage)}` };
  }
  if (value.type !== 'response') return { kind: 'invalid', reason: `bilinmeyen tür: ${String(value.type)}` };
  if (typeof value.id !== 'string' || !value.id) return { kind: 'invalid', reason: 'yanıtta id yok' };
  if (typeof value.status !== 'number' || !Number.isInteger(value.status))
    return { kind: 'invalid', reason: 'yanıtta durum kodu yok' };
  const file = readFile(value.file);
  if (file === undefined) return { kind: 'invalid', reason: 'dosya tutamacı geçersiz' };
  const body =
    value.body === null || value.body === undefined
      ? null
      : typeof value.body === 'string'
        ? value.body
        : JSON.stringify(value.body);
  return {
    kind: 'response',
    response: {
      type: 'response',
      id: value.id,
      status: value.status,
      contentType: typeof value.contentType === 'string' ? value.contentType : '',
      body,
      file,
    },
  };
}

interface PendingEntry {
  resolve: (response: BridgeResponse) => void;
  reject: (error: unknown) => void;
  timer: unknown;
  timeoutMs: number;
}

export function createBridgeTransport(bridge: MetrajBridgeLike, options: BridgeTransportOptions = {}): BridgeTransport {
  const timers = options.timers ?? defaultTimers;
  const createId = options.createId ?? createIdFactory();
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  const onProtocolError =
    options.onProtocolError ??
    ((reason: string, raw: unknown) => console.warn(`MetrajBridge: yok sayılan mesaj (${reason})`, raw));
  const pending = new Map<string, PendingEntry>();
  const listeners = new Map<string, Set<() => void>>();
  let disposed = false;

  const handleMessage: BridgeMessageListener = (event) => {
    const message = parseIncomingMessage(event?.data);
    if (message.kind === 'invalid') {
      onProtocolError(message.reason, event?.data);
      return;
    }
    if (message.kind === 'event') {
      // Dinleyici listesinin kopyası üzerinde dönülür: bir dinleyici kendini
      // kaldırırsa (ör. tek seferlik "resume") döngü bozulmaz.
      for (const listener of [...(listeners.get(message.event) ?? [])]) {
        try {
          listener();
        } catch (error) {
          console.error('MetrajBridge olay dinleyicisi hata verdi', error);
        }
      }
      return;
    }
    if (message.kind === 'progress') {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      // Bekleme süresince sayaç durur; işlem başlayınca TAM süreyle yeniden kurulur.
      if (waiting.timer !== undefined) timers.clear(waiting.timer);
      waiting.timer = message.stage === 'started' ? armTimer(message.id, waiting.timeoutMs, waiting.reject) : undefined;
      return;
    }
    const entry = pending.get(message.response.id);
    // Zaman aşımından sonra gelen geç yanıt: istek zaten hata olarak
    // sonuçlandı, ikinci kez çözülmez.
    if (!entry) return;
    pending.delete(message.response.id);
    if (entry.timer !== undefined) timers.clear(entry.timer);
    entry.resolve(message.response);
  };

  if (typeof bridge.addEventListener === 'function') bridge.addEventListener('message', handleMessage);
  else bridge.onmessage = handleMessage;

  function post(message: BridgeRequestMessage | BridgeCommandMessage) {
    bridge.postMessage(JSON.stringify(message));
  }

  function armTimer(id: string, timeoutMs: number, reject: (error: unknown) => void): unknown {
    if (timeoutMs <= 0) return undefined;
    return timers.set(() => {
      if (!pending.delete(id)) return;
      reject(new BridgeTransportError('timeout', `Yanıt ${timeoutMs} ms içinde gelmedi.`));
    }, timeoutMs);
  }

  function send(message: BridgeRequestMessage | BridgeCommandMessage, timeoutMs: number): Promise<BridgeResponse> {
    return new Promise<BridgeResponse>((resolve, reject) => {
      if (disposed) {
        reject(new BridgeTransportError('disposed', 'Köprü kapatıldı.'));
        return;
      }
      const timer = armTimer(message.id, timeoutMs, reject);
      pending.set(message.id, { resolve, reject, timer, timeoutMs });
      try {
        post(message);
      } catch (error) {
        pending.delete(message.id);
        if (timer !== undefined) timers.clear(timer);
        reject(new BridgeTransportError('unavailable', `Köprüye mesaj gönderilemedi: ${String(error)}`));
      }
    });
  }

  return {
    request({ method, path, body = null, timeoutMs, idempotencyKey }) {
      const message: BridgeRequestMessage = { type: 'request', id: createId(), method, path, body };
      if (idempotencyKey) message.idempotencyKey = idempotencyKey;
      return send(message, timeoutMs ?? defaultTimeoutMs);
    },
    async command(name, args = {}, commandOptions = {}) {
      const message: BridgeCommandMessage = { type: 'command', id: createId(), command: name, args };
      if (commandOptions.awaitResponse) return send(message, commandOptions.timeoutMs ?? defaultTimeoutMs);
      if (disposed) throw new BridgeTransportError('disposed', 'Köprü kapatıldı.');
      try {
        post(message);
      } catch (error) {
        throw new BridgeTransportError('unavailable', `Köprüye komut gönderilemedi: ${String(error)}`);
      }
      return undefined;
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof bridge.removeEventListener === 'function') bridge.removeEventListener('message', handleMessage);
      else if (bridge.onmessage === handleMessage) bridge.onmessage = null;
      for (const [id, entry] of pending) {
        pending.delete(id);
        if (entry.timer !== undefined) timers.clear(entry.timer);
        entry.reject(new BridgeTransportError('disposed', 'Köprü kapatıldı.'));
      }
      listeners.clear();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Sayfa genelindeki köprü: Android nesneyi belge başlarken ekler, yani ilk
// betik çalıştığında hazırdır. Köprü nesnesi başına tek bir taşıma kurulur.
// ---------------------------------------------------------------------------

const transports = new WeakMap<MetrajBridgeLike, BridgeTransport>();

/** Sözleşmedeki seçim kuralı: `typeof window.MetrajBridge !== 'undefined'` ise köprü. */
export function getBridge(): MetrajBridgeLike | null {
  if (typeof window === 'undefined' || typeof window.MetrajBridge === 'undefined') return null;
  const bridge = window.MetrajBridge;
  return bridge && typeof bridge.postMessage === 'function' ? bridge : null;
}

export function getBridgeTransport(): BridgeTransport | null {
  const bridge = getBridge();
  if (!bridge) return null;
  let transport = transports.get(bridge);
  if (!transport) {
    transport = createBridgeTransport(bridge);
    transports.set(bridge, transport);
  }
  return transport;
}

export function isBridgeAvailable(): boolean {
  return getBridge() !== null;
}

/**
 * Gönder-unut komut. Köprü yoksa `false` döner; çağıran tarayıcıdaki
 * karşılığını kendisi seçer (ör. `haptic` → `navigator.vibrate`).
 */
export function sendBridgeCommand(name: Exclude<BridgeCommandName, 'pickAndImport'>, args?: Record<string, unknown>) {
  const transport = getBridgeTransport();
  if (!transport) return false;
  transport
    .command(name, args)
    .catch((error: unknown) => console.warn(`MetrajBridge komutu gönderilemedi: ${name}`, error));
  return true;
}

/** Yerel olayları dinler. Köprü yoksa hiçbir şey yapmayan bir kaldırma işlevi döner. */
export function onBridgeEvent(event: BridgeEventName, listener: () => void): () => void {
  const transport = getBridgeTransport();
  return transport ? transport.on(event, listener) : () => undefined;
}
