import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../../../components';
import './parts.css';
import './shared.css';
import './status.css';

/*
 * Form parçaları: etiketli, ≥48 dp yüksekliğinde alanlar. Hepsi mevcut
 * `m-field` / `m-input` stillerini kullanır; etiket her zaman görünür ve
 * `htmlFor` ile bağlıdır (ekran okuyucu alanı adıyla okur).
 */

interface BaseProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

function FieldFrame({ id, label, hint, error, children }: BaseProps & { id: string; children: ReactNode }) {
  return (
    <div className="m-field">
      <label className="m-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <small id={`${id}-hint`} className="m-field__hint">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="m-field__error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

const describedBy = (id: string, props: BaseProps) =>
  props.error ? `${id}-error` : props.hint ? `${id}-hint` : undefined;

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  ...rest
}: BaseProps & { value: string; onChange: (value: string) => void } & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'id'
  >) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <input
        {...rest}
        id={id}
        className="m-input"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  value,
  onChange,
  rows = 3,
  placeholder,
  disabled,
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        className="m-input m-input--area"
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Yerel `select`: Android'in kendi seçici penceresini açar (büyük hedef, klavye gerekmez). */
export function SelectField({
  label,
  hint,
  error,
  value,
  onChange,
  options,
  disabled,
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        className="m-input m-input--select"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/** Virgül ya da nokta ile yazılan ondalık sayı; sayısal klavye açılır. Geçersiz/boş metin `null`. */
export function parseNumberText(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Sayı alanı. Yazarken "6," gibi yarım değerler kaybolmasın diye metin yerelde
 * tutulur, yalnız ayrıştırılabilen değer dışarı verilir. Dışarıdan farklı bir
 * sayı gelirse (ör. hazır şablon) metin güncellenir.
 */
export function DecimalField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  suffix,
  disabled,
  ariaLabel,
}: BaseProps & {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => (value === null ? '' : String(value).replace('.', ',')));
  useEffect(() => {
    setText((current) =>
      parseNumberText(current) === value ? current : value === null ? '' : String(value).replace('.', ','),
    );
  }, [value]);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className="m-input-suffix">
        <input
          id={id}
          className="m-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseNumberText(event.target.value));
          }}
        />
        {suffix && <span className="m-input-suffix__text">{suffix}</span>}
      </div>
    </FieldFrame>
  );
}

/** Dokunma hedefi ≥48 dp olan onay kutusu satırı. */
export function CheckRow({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="m-check-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}

/** Sayfa içi bilgi / uyarı bandı. `tone="error"` yüklenemeyen veya başarısız iş için `role="alert"` taşır. */
export function Notice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`m-notice m-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'empty' : 'warning'} size={20} />
      <div className="m-notice__text">{children}</div>
      {action}
    </div>
  );
}

/** Başlıklı bölüm; ekran okuyucu için `aria-labelledby` bağlı. */
export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section className="m-section" aria-labelledby={id}>
      <div className="m-section__head">
        <h2 id={id} className="m-section__title">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
