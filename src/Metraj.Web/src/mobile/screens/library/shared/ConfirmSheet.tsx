import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BottomSheet, Spinner } from '../../../shell';
import { confirmationMatches } from './confirmText.ts';
import './shared.css';

export interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Ne olacağını anlatan kısa metin (panel başlığının altında). */
  description?: ReactNode;
  /** Sonuçların ayrıntısı (madde listesi gibi). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** Verilirse onay düğmesi, kullanıcı bu sözcüğü yazana kadar kapalı kalır (ör. "TEMİZLE"). */
  phrase?: string;
  /** Onay kutusu: işaretlenmeden onaylanamaz (ör. "Mevcut verinin değişeceğini anlıyorum"). */
  acknowledge?: string;
  /**
   * Onay işi. `false` dönerse panel açık kalır (hata zaten bildirilmiştir,
   * kullanıcı yeniden deneyebilir); aksi hâlde kapanır.
   */
  onConfirm: () => Promise<boolean | void> | boolean | void;
}

/**
 * Geri alınamaz işlemler için onay paneli. Silme gibi "Geri al" çubuğuyla
 * karşılanabilen işlemlerde kullanılmaz (bkz. `removeWithUndo`); kalıcı olanlarda
 * ne olacağı açıkça yazılır, güvenli seçenek ("Vazgeç") ilk odaklanan düğmedir ve
 * onay işlenirken panel kapanmaz.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Vazgeç',
  tone = 'danger',
  phrase,
  acknowledge,
  onConfirm,
}: ConfirmSheetProps) {
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const phraseId = useId();
  const needsInput = Boolean(phrase || acknowledge);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setAcknowledged(false);
    setBusy(false);
  }, [open]);

  const ready = (!phrase || confirmationMatches(typed, phrase)) && (!acknowledge || acknowledged);

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = await onConfirm();
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
      dismissible={!busy}
      initialFocus={needsInput ? undefined : cancelRef}
      size="auto"
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            className="m-btn m-btn--secondary m-btn--large"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`m-btn m-btn--large ${tone === 'danger' ? 'm-btn--danger' : 'm-btn--primary'}`}
            disabled={!ready || busy}
            onClick={() => void confirm()}
          >
            {busy ? <Spinner size={20} /> : null}
            {busy ? 'İşleniyor…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="m-confirm">
        {children}
        {acknowledge && (
          <label className="m-check-row m-check-row--boxed">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>{acknowledge}</span>
          </label>
        )}
        {phrase && (
          <div className="m-field">
            <label className="m-field__label" htmlFor={phraseId}>
              Onaylamak için “{phrase}” yazın
            </label>
            <input
              id={phraseId}
              className="m-input"
              type="text"
              value={typed}
              disabled={busy}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby={`${phraseId}-state`}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirm();
                }
              }}
            />
            <small id={`${phraseId}-state`} className="m-field__hint" role="status" aria-live="polite">
              {typed ? (ready ? 'Onay sözcüğü doğru.' : 'Sözcük henüz eşleşmiyor.') : ''}
            </small>
          </div>
        )}
        <p className="m-visually-hidden" role="status" aria-live="polite">
          {busy ? 'İşlem sürüyor' : ''}
        </p>
      </div>
    </BottomSheet>
  );
}
