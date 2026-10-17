import {
  BridgeTransportError,
  getBridgeTransport,
  isBridgeMethod,
  type BridgeFile,
  type BridgeResponse,
  type BridgeTransport,
} from './lib/transport.ts';
import type { WorkspaceImportResult } from './types';

export class ApiError extends Error {
  /** Kararlı kural kodu (örn. "measurement.unit"). Arayüz gerekirse buna göre dallanabilir. */
  readonly rule: string;
  /** Sunucu arızası mı, kullanıcının düzeltebileceği bir durum mu? */
  readonly isServerFault: boolean;

  constructor(message: string, rule = '', isServerFault = false) {
    super(message);
    this.rule = rule;
    this.isServerFault = isServerFault;
  }
}

// ---------------------------------------------------------------------------
// Taşıma seçimi. Android kabuğu `window.MetrajBridge` ekler; yoksa (masaüstü
// WebView2, `vite dev`, Playwright) aşağıdaki fetch yolu ÖNCEKİYLE BİREBİR
// aynıdır. Masaüstü davranışı bu dosyadaki köprü kodundan etkilenmez.
// ---------------------------------------------------------------------------

const DEFAULT_ERROR_MESSAGE = 'İşlem tamamlanamadı.';

/** Ağır işler (rapor üretimi, yedek, içe/dışa aktarma, katalog tohumlama) telefonda saniyeler sürebilir. */
export const BRIDGE_LONG_TIMEOUT_MS = 300_000;
export const BRIDGE_DEFAULT_TIMEOUT_MS = 60_000;
const LONG_RUNNING_PATH =
  /^\/(database\/|workspace\/|catalog\/starter-pack|synthetic-clean-water|revisions\/[^/]+\/report)/;

/** Köprüde bir isteğin ne kadar bekleneceği. Yol `/api` ön eki OLMADAN verilir. */
export function bridgeTimeoutFor(path: string): number {
  return LONG_RUNNING_PATH.test(path) ? BRIDGE_LONG_TIMEOUT_MS : BRIDGE_DEFAULT_TIMEOUT_MS;
}

function transportFailure(error: unknown): unknown {
  if (!(error instanceof BridgeTransportError)) return error;
  // Sunucu tarafı bir hata değil ama kullanıcının düzeltebileceği bir şey de
  // değil: isServerFault=true, arayüz "tekrar dene" yolunu gösterir.
  return error.code === 'timeout'
    ? new ApiError('Uygulama zamanında yanıt vermedi. Tekrar deneyin.', 'transport.timeout', true)
    : new ApiError(
        'Uygulamanın yerel servisine ulaşılamadı. Uygulamayı yeniden başlatın.',
        'transport.unavailable',
        true,
      );
}

function parseErrorBody(body: string | null): { message?: string; rule?: string } {
  if (!body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as { message?: string; rule?: string }) : {};
  } catch {
    return {};
  }
}

/**
 * Köprü yanıtını fetch yoluyla AYNI kurallarla yorumlar: 2xx dışı → ApiError
 * (gövdedeki message/rule, 5xx ise isServerFault), 204 → undefined, aksi hâlde
 * gövde JSON metni olarak ayrıştırılır.
 */
export function readBridgeResponse<T>(response: BridgeResponse): T {
  if (response.status < 200 || response.status > 299) {
    const body = parseErrorBody(response.body);
    throw new ApiError(body.message ?? DEFAULT_ERROR_MESSAGE, body.rule ?? '', response.status >= 500);
  }
  if (response.status === 204 || response.body === null || response.body === '') return undefined as T;
  return JSON.parse(response.body) as T;
}

async function bridgeRequest<T>(bridge: BridgeTransport, path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!isBridgeMethod(method)) throw new ApiError(DEFAULT_ERROR_MESSAGE, 'transport.method');
  if (typeof FormData !== 'undefined' && init?.body instanceof FormData)
    // Sözleşme gereği ikili içerik köprüden JSON olarak geçmez; içe aktarma
    // yerel dosya seçiciyle yapılır (api.importWorkspace → pickAndImport).
    throw new ApiError('Bu cihazda dosya içe aktarma yerel dosya seçiciyle yapılır.', 'transport.upload-unsupported');
  let response: BridgeResponse;
  try {
    response = await bridge.request({
      method,
      path: `/api${path}`,
      body: typeof init?.body === 'string' ? init.body : null,
      timeoutMs: bridgeTimeoutFor(path),
    });
  } catch (error) {
    throw transportFailure(error);
  }
  return readBridgeResponse<T>(response);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const bridge = getBridgeTransport();
  if (bridge) return bridgeRequest<T>(bridge, path, init);
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    // init önce yayılır: bir çağıran kendi başlıklarını verirse, aşağıdaki
    // birleştirilmiş nesne onu ezmek yerine içerir.
    ...init,
    headers: init?.body && !isFormData ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message ?? DEFAULT_ERROR_MESSAGE, body.rule ?? '', response.status >= 500);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// İndirme (rapor, çalışma alanı dışa aktarma)
// ---------------------------------------------------------------------------

export type DownloadAction = 'share' | 'saveAs';

export interface DownloadResult {
  /** Dosyanın gerçekte aldığı ad: sunucunun verdiği ad, yoksa önerilen ad. */
  name: string;
  mime: string;
  size: number;
  /** Köprüde kullanıcının seçimi; tarayıcıda her zaman `browser`; vazgeçildiyse `cancelled`. */
  outcome: DownloadAction | 'browser' | 'cancelled';
}

/**
 * Köprüde dosya hazır olduğunda kullanıcıya "Paylaş / Cihaza kaydet" sorulur.
 * Bu soruyu mobil kabuk sorar (alttan açılan panel); `api.ts` React'e bağımlı
 * olmasın diye bir sunucu (presenter) kaydı üzerinden. Kayıt yoksa doğrudan
 * `saveAs` (SAF "farklı kaydet") kullanılır. `null` dönmek = vazgeç.
 */
export type DownloadPresenter = (file: BridgeFile) => Promise<DownloadAction | null>;

let downloadPresenter: DownloadPresenter | null = null;

export function setDownloadPresenter(presenter: DownloadPresenter | null): () => void {
  downloadPresenter = presenter;
  return () => {
    if (downloadPresenter === presenter) downloadPresenter = null;
  };
}

/** `Content-Disposition` başlığından dosya adı (RFC 6266; `filename*` önceliklidir). */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended?.[2]) {
    try {
      return decodeURIComponent(extended[2].trim().replace(/^"|"$/g, ''));
    } catch {
      // bozuk yüzde kodlaması: düz filename'e düşülür
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const value = (plain?.[2] ?? plain?.[1])?.trim();
  return value || null;
}

function saveBlobInBrowser(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Hemen iptal etmek bazı tarayıcılarda indirmeyi yarıda kesiyordu.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function download(path: string, suggestedName: string): Promise<DownloadResult> {
  const bridge = getBridgeTransport();
  if (bridge) {
    let response: BridgeResponse;
    try {
      response = await bridge.request({
        method: 'GET',
        path: `/api${path}`,
        body: null,
        timeoutMs: BRIDGE_LONG_TIMEOUT_MS,
      });
    } catch (error) {
      throw transportFailure(error);
    }
    if (response.status < 200 || response.status > 299) readBridgeResponse(response);
    if (!response.file) throw new ApiError('Dosya hazırlanamadı. Tekrar deneyin.', 'transport.no-file', true);
    const file: BridgeFile = { ...response.file, name: response.file.name || suggestedName };
    const action = downloadPresenter ? await downloadPresenter(file) : 'saveAs';
    if (!action) return { name: file.name, mime: file.mime, size: file.size, outcome: 'cancelled' };
    try {
      await bridge.command(action, { handle: file.handle });
    } catch (error) {
      throw transportFailure(error);
    }
    return { name: file.name, mime: file.mime, size: file.size, outcome: action };
  }

  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message ?? DEFAULT_ERROR_MESSAGE, body.rule ?? '', response.status >= 500);
  }
  const blob = await response.blob();
  const name = fileNameFromContentDisposition(response.headers.get('Content-Disposition')) || suggestedName;
  saveBlobInBrowser(blob, name);
  return { name, mime: blob.type, size: blob.size, outcome: 'browser' };
}

// ---------------------------------------------------------------------------
// Çalışma alanı içe aktarma
// ---------------------------------------------------------------------------

const WORKSPACE_ACCEPT = '.metraj,application/vnd.projemetraj.workspace';

/** Tarayıcı dosya seçicisi. Kullanıcı vazgeçerse `null`. */
function pickFileInBrowser(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/**
 * Bir `.metraj` dosyasını mevcut veriye EKLEYEREK içe aktarır.
 * Köprüde yerel SAF seçici açılır ve dosya akış hâlinde `/api/workspace/import`'a
 * verilir (`pickAndImport`); tarayıcıda dosya seçici + `upload`. Kullanıcı
 * vazgeçerse `null` döner. Seçimden SONRA onay sorulamaz (köprüde seçim ve içe
 * aktarma tek adımdır), bu yüzden onay gerekiyorsa çağırmadan önce sorun.
 */
async function importWorkspace(): Promise<WorkspaceImportResult | null> {
  const bridge = getBridgeTransport();
  if (bridge) {
    let response: BridgeResponse | undefined;
    try {
      // Kullanıcı dosya seçerken süre sınırı konmaz; yerel taraf vazgeçmede de
      // yanıt döner (204).
      response = await bridge.command('pickAndImport', {}, { awaitResponse: true, timeoutMs: 0 });
    } catch (error) {
      throw transportFailure(error);
    }
    if (!response || response.status === 204) return null;
    return readBridgeResponse<WorkspaceImportResult | null>(response) ?? null;
  }
  const file = await pickFileInBrowser(WORKSPACE_ACCEPT);
  if (!file) return null;
  const form = new FormData();
  form.append('file', file, file.name);
  return request<WorkspaceImportResult>('/workspace/import', { method: 'POST', body: form });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  /** Dosyayı indirir: köprüde dosya tutamacı + paylaş/kaydet, tarayıcıda blob + `<a download>`. */
  download: (path: string, suggestedName: string) => download(path, suggestedName),
  /** `.metraj` içe aktarma; vazgeçilirse `null`. */
  importWorkspace: () => importWorkspace(),
};
