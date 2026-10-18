/**
 * Köprüde zaman aşımına uğrayan mutasyonların yeniden denemesi için
 * idempotency anahtarları.
 *
 * Sorun: JS 60 sn sonra "zamanında yanıt vermedi" der, ama yerel taraf isteği
 * işlemeyi sürdürür ve yazabilir. Kullanıcı "tekrar dene" dediğinde aynı ölçüm
 * iki kez girilirdi.
 *
 * Çözüm: her mutasyon bir anahtarla gider. Zaman aşımına uğrayan isteğin
 * anahtarı, isteğin imzasıyla (yöntem + yol + gövde) bir süre hatırlanır; aynı
 * imzalı yeni istek AYNI anahtarı kullanır. Yerel taraf aynı anahtarı görünce
 * işi ikinci kez yapmaz: hâlâ sürüyorsa onun sonucunu bekler, bittiyse
 * önbellekteki sonucu döner (Metraj.Host/IdempotentRequestCache, 15 dk).
 *
 * Neden "zaman aşımından sonra tazele" değil: tazeleme yarışa açıktı (yerel
 * yazma henüz bitmediyse tazeleme kaydı göstermez, kullanıcı yine iki kez
 * kaydeder) ve ~40 mutasyon ucunun her biri için neyin tazeleneceğini bilmek
 * gerekirdi. Anahtar taşıma katmanında, uçtan bağımsız çalışır.
 *
 * Yanıt arayana ulaşınca (başarı ya da sunucu hatası) imza unutulur: sonraki
 * aynı istek bilinçli yeni bir işlemdir (ör. aynı ölçümü ikinci kez girmek).
 */

/** JS'in imzayı hatırladığı süre; yerel önbellek süresinden (15 dk) kısa olmalı. */
export const RETRY_KEY_WINDOW_MS = 10 * 60_000;

export interface RetryKeyRegistry {
  /** Bu imza için kullanılacak anahtar: zaman aşımına uğramış eşi varsa onun anahtarı, yoksa yeni. */
  keyFor(signature: string): string;
  /** İstek zaman aşımına uğradı: anahtar yeniden deneme için saklanır. */
  timedOut(signature: string, key: string): void;
  /** Yanıt arayana ulaştı: imza unutulur. */
  settled(signature: string): void;
  readonly size: number;
}

export interface RetryKeyRegistryOptions {
  createKey?: () => string;
  now?: () => number;
  windowMs?: number;
}

export function mutationSignature(method: string, path: string, body: string | null | undefined): string {
  return `${method} ${path}\n${body ?? ''}`;
}

function randomKey(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createRetryKeyRegistry(options: RetryKeyRegistryOptions = {}): RetryKeyRegistry {
  const createKey = options.createKey ?? randomKey;
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? RETRY_KEY_WINDOW_MS;
  const remembered = new Map<string, { key: string; at: number }>();

  const prune = () => {
    const threshold = now() - windowMs;
    for (const [signature, entry] of remembered) if (entry.at < threshold) remembered.delete(signature);
  };

  return {
    keyFor(signature) {
      prune();
      return remembered.get(signature)?.key ?? createKey();
    },
    timedOut(signature, key) {
      remembered.set(signature, { key, at: now() });
    },
    settled(signature) {
      remembered.delete(signature);
    },
    get size() {
      prune();
      return remembered.size;
    },
  };
}
