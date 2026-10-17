import { useId, useMemo, type KeyboardEvent } from 'react';
import { Icon } from '../Icon';
import { haptic } from '../haptics.ts';
import { useLongPress } from '../useLongPress.ts';
import { evaluateExpression, type EvaluationResult } from './expression.ts';
import { applyKey, keyFromKeyboard, prettyExpression, type KeypadKey } from './keypadInput.ts';

export type KeypadResult = Extract<EvaluationResult, { ok: true }>;

export interface NumericKeypadProps {
  /** Ekrandaki ifade (ör. "3,2+4×1,5"). Denetimli: üst bileşen saklar (taslak olarak da). */
  value: string;
  onChange: (expression: string) => void;
  /** "Kaydet": geçerli ve `validate`'ten geçen sonuçla çağrılır. */
  onSave: (result: KeypadResult) => void;
  /** "Kaydet → sıradaki": verilirse ikinci düğme görünür (art arda giriş). */
  onSaveNext?: (result: KeypadResult) => void;
  /** Alanın adı (ekran okuyucu ve başlık): "Miktar". */
  label: string;
  /** Birim: "m", "adet". */
  unit?: string;
  /** Ek kural; hata metni döner. Varsayılan: sıfırdan büyük olmalı. */
  validate?: (result: KeypadResult) => string | null;
  saveLabel?: string;
  saveNextLabel?: string;
  /** Kayıt sürerken düğmeler kilitlenir. */
  busy?: boolean;
  disabled?: boolean;
}

const positive = (result: KeypadResult) => (result.number > 0 ? null : 'Miktar sıfırdan büyük olmalı.');

const KEYS: ReadonlyArray<{ key: KeypadKey; label: string; aria?: string; kind?: 'op' | 'fn' }> = [
  { key: '7', label: '7' },
  { key: '8', label: '8' },
  { key: '9', label: '9' },
  { key: 'backspace', label: '', aria: 'Sil (uzun bas: temizle)', kind: 'fn' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: '×', label: '×', aria: 'çarpı', kind: 'op' },
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '−', label: '−', aria: 'eksi', kind: 'op' },
  { key: ',', label: ',', aria: 'virgül' },
  { key: '0', label: '0' },
  { key: 'clear', label: 'C', aria: 'Temizle', kind: 'fn' },
  { key: '+', label: '+', aria: 'artı', kind: 'op' },
];

/**
 * Sayısal tuş takımı. Sistem klavyesi açılmaz (giriş alanı yok): ekranın alt
 * yarısında sabit, büyük tuşlar; sonuç canlı önizlenir. Türkçe ondalık virgül,
 * + − × (çarpma önce), ⌫ (uzun bas: temizle), "Kaydet" ve "Kaydet → sıradaki".
 * Bağlı fiziksel klavye de çalışır (rakamlar, , . + - * Backspace Delete Enter).
 */
export function NumericKeypad({
  value,
  onChange,
  onSave,
  onSaveNext,
  label,
  unit,
  validate = positive,
  saveLabel = 'Kaydet',
  saveNextLabel = 'Kaydet → sıradaki',
  busy = false,
  disabled = false,
}: NumericKeypadProps) {
  const displayId = useId();
  const statusId = useId();
  const preview = useMemo(() => evaluateExpression(value, { allowTrailingOperator: true }), [value]);
  const final = useMemo(() => evaluateExpression(value), [value]);
  const problem = final.ok ? validate(final) : value ? final.message : null;
  const canSave = final.ok && !problem && !busy && !disabled;
  const locked = busy || disabled;

  const press = (key: KeypadKey) => {
    if (locked) return;
    const next = applyKey(value, key);
    if (next === value) {
      if (key !== 'clear') haptic('reject');
      return;
    }
    haptic('tick');
    onChange(next);
  };
  const clearPress = useLongPress(() => {
    if (locked || !value) return;
    haptic('confirm');
    onChange('');
  });

  const save = (next: boolean) => {
    if (!final.ok || !canSave) {
      haptic('reject');
      return;
    }
    if (next && onSaveNext) onSaveNext(final);
    else onSave(final);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save(event.shiftKey && Boolean(onSaveNext));
      return;
    }
    const key = keyFromKeyboard(event.key);
    if (!key || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    press(key);
  };

  const showPreview = preview.ok && (preview.operands > 1 || !final.ok);
  return (
    <div
      className={`m-keypad${locked ? ' is-locked' : ''}`}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={`${label} tuş takımı`}
      // Fiziksel klavye için odaklanabilir kap; dokunmatik kullanımda odak göstergesi çıkmaz.
      tabIndex={0}
    >
      <div className="m-keypad__display">
        <div className="m-keypad__label">
          <span>{label}</span>
          {unit && <span className="m-keypad__unit">{unit}</span>}
        </div>
        <output id={displayId} className="m-keypad__expression m-num" aria-label={`${label}: ${value || 'boş'}`}>
          {value ? prettyExpression(value) : <span className="m-keypad__placeholder">0</span>}
        </output>
        <p id={statusId} className={`m-keypad__status${problem ? ' is-error' : ''}`} aria-live="polite">
          {problem ? problem : showPreview ? `= ${preview.display}${unit ? ` ${unit}` : ''}` : ' '}
        </p>
      </div>
      <div className="m-keypad__grid">
        {KEYS.map(({ key, label: text, aria, kind }) => {
          const isBackspace = key === 'backspace';
          return (
            <button
              key={key}
              type="button"
              className={`m-keypad__key${kind ? ` m-keypad__key--${kind}` : ''}`}
              aria-label={aria}
              disabled={locked}
              {...(isBackspace ? clearPress.handlers : {})}
              onClick={isBackspace ? clearPress.guardClick(() => press(key)) : () => press(key)}
            >
              {isBackspace ? <Icon name="backspace" size={28} /> : text}
            </button>
          );
        })}
      </div>
      <div className="m-keypad__actions">
        {onSaveNext && (
          <button
            type="button"
            className="m-btn m-btn--secondary m-btn--large"
            disabled={!canSave}
            aria-describedby={statusId}
            onClick={() => save(true)}
          >
            {saveNextLabel}
          </button>
        )}
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large"
          disabled={!canSave}
          aria-describedby={statusId}
          onClick={() => save(false)}
        >
          {busy ? 'Kaydediliyor…' : saveLabel}
        </button>
      </div>
    </div>
  );
}
