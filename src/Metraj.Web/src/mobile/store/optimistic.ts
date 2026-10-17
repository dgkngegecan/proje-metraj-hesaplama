import { applyPatch, type Entities, type PatchOp } from './entities.ts';

/**
 * İyimser güncelleme ve "Geri al"lı silme.
 *
 * Telefonda her kayıt için köprü gidiş-dönüşünü beklemek, saha ekibinin art
 * arda girdiği ölçümleri yavaşlatır. Desen: önce depo değişir (anında görünür),
 * istek arkadan gider; başarısız olursa YALNIZ bu işlemin dokunduğu kayıtlar
 * eski hâline döner ve hata gösterilir.
 *
 * Silme onay penceresi açmaz: kayıt hemen kaybolur, alt bilgi çubuğunda
 * "Geri al" çıkar; süre dolunca (veya uygulama arka plana geçince) istek
 * gönderilir. Saf mantıktır; geri bildirim (snackbar) dışarıdan verilir.
 */

/** zustand `StoreApi`'nin burada gereken kısmı. */
export interface EntityStore {
  getState(): { entities: Entities };
  setState(partial: { entities: Entities }): void;
}

export interface UndoRequest {
  message: string;
  actionLabel: string;
  durationMs: number;
  /** Kullanıcı "Geri al"a bastı. */
  onUndo(): void;
  /** Çubuk başka bir nedenle kapandı (süre, yerine yenisi, uygulama arka plana geçti). */
  onCommit(): void;
}

export interface Feedback {
  error(error: unknown, fallbackMessage?: string): void;
  /** Geri al çubuğunu gösterir; dönen işlev çubuğu kod tarafından kapatır. */
  undo(request: UndoRequest): () => void;
}

let defaultFeedback: Feedback = {
  error: (error) => console.error(error),
  undo: (request) => {
    // Kabuk bağlanmadan (testler, erken açılış) geri alma sunulamaz: hemen işlenir.
    request.onCommit();
    return () => undefined;
  },
};

/** Kabuk açılışta snackbar'ı bağlar (bkz. shell/feedback.ts). */
export function configureFeedback(feedback: Feedback) {
  defaultFeedback = feedback;
}

export function applyToStore(store: EntityStore, ops: readonly PatchOp[]): PatchOp[] {
  const current = store.getState().entities;
  const { entities, inverse } = applyPatch(current, ops);
  if (entities !== current) store.setState({ entities });
  return inverse;
}

export type OptimisticResult<R> = { ok: true; result: R } | { ok: false; error: unknown };

export interface OptimisticOptions<R> {
  /** Anında uygulanacak değişiklik. İşlev verilirse güncel varlıklarla çağrılır. */
  ops: readonly PatchOp[] | ((entities: Entities) => readonly PatchOp[]);
  request: () => Promise<R>;
  /** Sunucu yanıtıyla uzlaştırma: ör. geçici kimlikli kaydı kaldırıp sunucunun kaydını eklemek. */
  reconcile?: (result: R, entities: Entities) => readonly PatchOp[];
  /** Hata bir `ApiError` değilse gösterilecek metin. */
  errorMessage?: string;
  feedback?: Pick<Feedback, 'error'>;
}

export async function runOptimistic<R>(
  store: EntityStore,
  options: OptimisticOptions<R>,
): Promise<OptimisticResult<R>> {
  const ops = typeof options.ops === 'function' ? options.ops(store.getState().entities) : options.ops;
  const inverse = applyToStore(store, ops);
  try {
    const result = await options.request();
    if (options.reconcile) applyToStore(store, options.reconcile(result, store.getState().entities));
    return { ok: true, result };
  } catch (error) {
    applyToStore(store, inverse);
    (options.feedback ?? defaultFeedback).error(error, options.errorMessage);
    return { ok: false, error };
  }
}

export type RemovalState = 'pending' | 'undone' | 'committing' | 'committed' | 'failed';

export interface RemovalHandle {
  readonly state: RemovalState;
  undo(): void;
  /** Bekleme süresini beklemeden isteği gönderir (ör. uygulama arka plana geçti). */
  commitNow(): Promise<void>;
}

export interface RemoveWithUndoOptions {
  ops: readonly PatchOp[];
  commit: () => Promise<unknown>;
  message: string;
  undoLabel?: string;
  durationMs?: number;
  /** İstek başarıyla gittikten sonra (ör. özetleri tazelemek için). */
  onCommitted?: () => void;
  errorMessage?: string;
  feedback?: Feedback;
}

const pendingRemovals = new Set<RemovalHandle>();

export function removeWithUndo(store: EntityStore, options: RemoveWithUndoOptions): RemovalHandle {
  const feedback = options.feedback ?? defaultFeedback;
  const inverse = applyToStore(store, options.ops);
  let state: RemovalState = 'pending';
  let closeBar: () => void = () => undefined;
  let inFlight: Promise<void> | null = null;

  const handle: RemovalHandle = {
    get state() {
      return state;
    },
    undo() {
      if (state !== 'pending') return;
      state = 'undone';
      pendingRemovals.delete(handle);
      applyToStore(store, inverse);
      closeBar();
    },
    commitNow() {
      if (state !== 'pending') return inFlight ?? Promise.resolve();
      state = 'committing';
      pendingRemovals.delete(handle);
      closeBar();
      inFlight = options.commit().then(
        () => {
          state = 'committed';
          options.onCommitted?.();
        },
        (error: unknown) => {
          // Sunucu reddetti: kayıt geri gelir, kullanıcı neden olduğunu görür.
          state = 'failed';
          applyToStore(store, inverse);
          feedback.error(error, options.errorMessage);
        },
      );
      return inFlight;
    },
  };

  pendingRemovals.add(handle);
  closeBar = feedback.undo({
    message: options.message,
    actionLabel: options.undoLabel ?? 'Geri al',
    durationMs: options.durationMs ?? 5000,
    onUndo: () => handle.undo(),
    onCommit: () => void handle.commitNow(),
  });
  return handle;
}

/**
 * Bekleyen bütün silmeleri hemen gönderir. Uygulama arka plana geçerken
 * çağrılır: Android süreci orada öldürebilir ve kullanıcının "sildim" sandığı
 * kayıt bir sonraki açılışta geri gelirdi.
 */
export function flushPendingRemovals(): Promise<void> {
  return Promise.all([...pendingRemovals].map((handle) => handle.commitNow())).then(() => undefined);
}

export function pendingRemovalCount() {
  return pendingRemovals.size;
}

let temporarySequence = 0;

/** İyimser eklemeler için geçici kimlik; sunucu yanıtıyla `reconcile` içinde değiştirilir. */
export function temporaryId(prefix = 'tmp') {
  temporarySequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${temporarySequence}`;
}

export const isTemporaryId = (id: string) => id.startsWith('tmp-');
