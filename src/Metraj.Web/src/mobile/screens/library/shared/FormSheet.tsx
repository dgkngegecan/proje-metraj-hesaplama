import { useEffect, useId, useState, type ReactNode } from 'react';
import { BottomSheet, Spinner } from '../../../shell';
import './shared.css';

export interface FormSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  size?: 'auto' | 'tall' | 'full';
  /** Gönder düğmesi ek koşulla kapatılır (ör. zorunlu seçim yapılmadı). */
  submitDisabled?: boolean;
  /**
   * Gönderim. `false` dönerse panel açık kalır (doğrulama ya da sunucu hatası; kullanıcı
   * düzeltip yeniden dener); aksi hâlde panel kapanır.
   */
  onSubmit: () => Promise<boolean | void> | boolean | void;
  children: ReactNode;
}

/**
 * Küçük formlar için alttan açılan panel (kural ekle, gerekçe yaz, fire payı…). Enter ile
 * gönderilir; işlem sürerken panel kapanmaz ve düğme tekrar basılamaz. Gönder düğmesi
 * panelin altında sabittir (klavye açıkken klavyenin üstünde kalır).
 */
export function FormSheet({
  open,
  onClose,
  title,
  description,
  submitLabel,
  cancelLabel = 'Vazgeç',
  tone = 'primary',
  size = 'tall',
  submitDisabled,
  onSubmit,
  children,
}: FormSheetProps) {
  const formId = useId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await onSubmit();
      if (result !== false) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className="m-btn m-btn--secondary m-btn--large" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            form={formId}
            className={`m-btn m-btn--large ${tone === 'danger' ? 'm-btn--danger' : 'm-btn--primary'}`}
            disabled={busy || submitDisabled}
          >
            {busy ? <Spinner size={20} /> : null}
            {busy ? 'Kaydediliyor…' : submitLabel}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="m-form m-formsheet"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {children}
      </form>
    </BottomSheet>
  );
}
