import { api } from './api';

/**
 * Arayüzün kalıcı olması gereken küçük durumu (yarım kalmış fitting sayımları,
 * açık çap kutuları, kenar çubuğu tercihi).
 *
 * `localStorage` bu iş için kullanılamaz: yerel API her açılışta işletim
 * sisteminin seçtiği bir loopback portu dinler, port değişince WebView için
 * origin değişir ve localStorage boş gelir. Kullanıcı yarım kalmış bir fitting
 * sayımını ertesi güne bırakıp uygulamayı kapattığında her şey gidiyordu —
 * üstelik arayüz açıkça "Bekleyen adetler ... saklanır" diyordu.
 *
 * Değerler uygulama veritabanında tutulur, yani yedeklere de girer.
 * localStorage yalnızca ağ gidiş-dönüşünü beklememek için hızlı bir ayna olarak
 * kullanılır; doğruluk kaynağı her zaman sunucudur.
 */
export type UiStateMap = Record<string, string>;

type UiStateItem = { key: string; valueJson: string; updatedAtUtc: string };

const MIRROR_PREFIX = 'metraj.mirror.';
// Different draft/preference keys share the same SQLite database. Serialize all
// writes so rapid counting cannot race independent read-then-save requests.
let pendingWrite: Promise<void> = Promise.resolve();
function queueWrite(operation: () => Promise<unknown>) {
  pendingWrite = pendingWrite.then(operation).then(() => undefined).catch(() => undefined);
}

export async function loadUiState(): Promise<UiStateMap> {
  const items = await api.get<UiStateItem[]>('/ui-state');
  const map: UiStateMap = {};
  for (const item of items) map[item.key] = item.valueJson;
  return map;
}

/** Anahtarı okur: önce sunucudan gelen harita, sonra yerel ayna. */
export function readUiState(map: UiStateMap, key: string): string | null {
  if (map[key] !== undefined) return map[key];
  try {
    return window.localStorage.getItem(MIRROR_PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * Anahtarı yazar. Ayna anında güncellenir (arayüz beklemez), sunucu yazması
 * arka planda tamamlanır. Yazma başarısız olursa ayna yine de doğru kalır.
 */
export function writeUiState(map: UiStateMap, key: string, valueJson: string): void {
  map[key] = valueJson;
  try {
    window.localStorage.setItem(MIRROR_PREFIX + key, valueJson);
  } catch {
    // Özel pencere veya kapalı site verisi: sunucu kaydı yine de yapılır.
  }
  queueWrite(() => api.put('/ui-state', { key, valueJson }));
}

/** Anahtarı siler (ör. bekleyen adetler başarıyla kaydedildiğinde). */
export function clearUiState(map: UiStateMap, key: string): void {
  delete map[key];
  try {
    window.localStorage.removeItem(MIRROR_PREFIX + key);
  } catch {
    // yok sayılır
  }
  queueWrite(() => api.delete(`/ui-state?key=${encodeURIComponent(key)}`));
}
