/**
 * Geri tuşu yığını (saf).
 *
 * Android'de geri tuşu her zaman "en üstteki şeyi kapat" demektir. Sıra:
 *   1. açık alttan panel (sheet)  →  kapanır
 *   2. iç içe gezinme seviyesi    →  bir üst seviyeye dönülür
 *   3. sekme kökü                 →  başlangıç sekmesine (Proje) dönülür
 *   4. hiçbiri                    →  uygulamadan çıkılır (`exitApp`)
 * Aynı katmanda en son kaydolan önce sorulur. İşleyici `false` dönerse
 * "benim işim yok" demektir; sıradakine geçilir.
 *
 * Tarayıcı `popstate` ve köprünün `back` olayı aynı `handleBack`'e bağlanır
 * (bkz. shell/back.ts).
 */

export type BackLayer = 'sheet' | 'nested' | 'tab';

const PRIORITY: Record<BackLayer, number> = { sheet: 3, nested: 2, tab: 1 };

/** `false` → bu işleyici geri tuşunu kullanmadı; diğer her dönüş "kullandı" sayılır. */
export type BackHandler = () => boolean | void;

interface Entry {
  layer: BackLayer;
  order: number;
  handler: BackHandler;
}

export type BackResult = 'handled' | 'exit';

export interface BackStack {
  register(layer: BackLayer, handler: BackHandler): () => void;
  handleBack(): BackResult;
  /** Kayıtlı işleyici sayısı (tanılama ve testler için). */
  readonly size: number;
  /** Yığın değiştiğinde (kayıt/kaldırma) çağrılır. */
  subscribe(listener: () => void): () => void;
}

export function createBackStack(): BackStack {
  const entries = new Set<Entry>();
  const listeners = new Set<() => void>();
  let order = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    register(layer, handler) {
      const entry: Entry = { layer, handler, order: ++order };
      entries.add(entry);
      notify();
      return () => {
        if (entries.delete(entry)) notify();
      };
    },
    handleBack() {
      const candidates = [...entries].sort((a, b) => PRIORITY[b.layer] - PRIORITY[a.layer] || b.order - a.order);
      for (const entry of candidates) {
        // İşleyici çalışırken kendini kaldırabilir (panel kapanır); kopya üzerinde dönülür.
        if (!entries.has(entry)) continue;
        if (entry.handler() !== false) return 'handled';
      }
      return 'exit';
    },
    get size() {
      return entries.size;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
