import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Uygulamanın kendi soru/onay penceresi.
 *
 * Önceden yıkıcı işlemler ve gerekçe soruları için `window.prompt` ve
 * `window.confirm` kullanılıyordu: özenle tasarlanmış bir arayüzün ortasında
 * Windows'un sistem kutusu çıkıyor, kopyalanamıyor, tema ile uyumsuz kalıyor ve
 * bütün uygulamayı blokluyordu. Ayrıca `prompt` yalnızca düz metin döndürdüğü
 * için "12,5" gibi girdiler ayrı ayrı ayrıştırılmak zorundaydı.
 *
 * Bu bileşen erişilebilirlik gereklerini de karşılar: `role="dialog"`,
 * `aria-modal`, odak tuzağı, Escape ile kapanma ve kapanışta odağın geri
 * verilmesi. Eski özel modal'ların hiçbirinde bunlar yoktu.
 */
export type AskField = {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'decimal' | 'text';
};

export type AskRequest = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  fields?: AskField[];
};

type PendingAsk = AskRequest & { resolve: (values: Record<string, string> | null) => void };

/** Soru penceresini söz (promise) tabanlı kullanmayı sağlar. */
export function useAsk() {
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const ask = useCallback(
    (request: AskRequest) =>
      new Promise<Record<string, string> | null>((resolve) => setPending({ ...request, resolve })),
    [],
  );
  const close = useCallback((values: Record<string, string> | null) => {
    setPending((current) => {
      current?.resolve(values);
      return null;
    });
  }, []);
  return { pending, ask, close };
}

export function AskDialog({ request, onClose }: { request: PendingAsk; onClose: (values: Record<string, string> | null) => void }) {
  const fields = request.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((field) => [field.key, field.value])),
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>('input, textarea, button');
    focusable?.focus();
    if (focusable instanceof HTMLInputElement || focusable instanceof HTMLTextAreaElement) focusable.select();
    return () => previouslyFocused.current?.focus?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(null);
      return;
    }
    if (event.key !== 'Tab') return;
    // Odak tuzağı: sekme, pencerenin dışına çıkıp arka plandaki forma düşemez.
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('input, textarea, button') ?? [])]
      .filter((element) => !element.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = () => onClose(values);

  return (
    <div className="modal-backdrop" onMouseDown={() => onClose(null)}>
      <div
        ref={panelRef}
        className="modal ask-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{request.title}</h2>
        {request.description && <p id={descriptionId}>{request.description}</p>}
        {fields.map((field) => (
          <label key={field.key}>
            {field.label}
            {field.multiline
              ? <textarea
                rows={3}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              : <input
                inputMode={field.inputMode}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
              />}
          </label>
        ))}
        <div className="ask-actions">
          <button type="button" onClick={() => onClose(null)}>{request.cancelLabel ?? 'Vazgeç'}</button>
          <button type="button" className={request.danger ? 'primary danger-confirm' : 'primary'} onClick={submit}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
