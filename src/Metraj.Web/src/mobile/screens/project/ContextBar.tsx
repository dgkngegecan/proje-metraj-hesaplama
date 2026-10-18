import { useState } from 'react';
import { ChipGrid, Icon, haptic } from '../../components';
import { BottomSheet } from '../../shell';
import { CONTEXT_FIELDS, CONTEXT_KEYS, contextSummary, fieldOf, hasContext, type ContextKey } from './context.ts';
import type { MeasureContextApi } from './useMeasureContext';

/**
 * Bağlam çipleri: "Blok A · Kat 2 · Mahal Mutfak". Bir çipe dokunmak o alanın son
 * kullanılan değerlerini açar; değer tek dokunuşla seçilir ve panel kapanır
 * (yeni değer için kısa bir giriş alanı da var). "Diğer" zon, şaft, hat no, pafta,
 * çizim revizyonu ve notu açar. Seçili bağlam sonraki kayıtlara uygulanır.
 */
export function ContextBar({ api, disabled = false }: { api: MeasureContextApi; disabled?: boolean }) {
  const { context, clearAll } = api;
  const [picker, setPicker] = useState<ContextKey | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const visible = CONTEXT_FIELDS.filter((field) => field.primary || context[field.key]);
  const summary = contextSummary(context);

  return (
    <section className="m-proj-context" aria-label="Giriş konumu">
      <div className="m-proj-context__head">
        <span className="m-proj-context__title">Konum</span>
        <span className="m-proj-context__summary" aria-live="polite">
          {summary || 'Seçilmedi'}
        </span>
      </div>
      <div className="m-proj-strip" role="group" aria-label="Konum çipleri">
        {visible.map((field) => {
          const value = context[field.key];
          return (
            <button
              key={field.key}
              type="button"
              className={`m-proj-strip__chip${value ? ' is-selected' : ''}`}
              disabled={disabled}
              aria-label={value ? `${field.label}: ${value}. Değiştir` : `${field.label} seç`}
              onClick={() => {
                haptic('tick');
                setPicker(field.key);
              }}
            >
              {value ? (
                <>
                  <span className="m-proj-strip__muted">{field.label}</span> {value}
                </>
              ) : (
                `+ ${field.label}`
              )}
            </button>
          );
        })}
        <button
          type="button"
          className="m-proj-strip__chip"
          disabled={disabled}
          onClick={() => {
            haptic('tick');
            setListOpen(true);
          }}
        >
          Diğer…
        </button>
      </div>

      <ContextValuePicker api={api} fieldKey={picker} onClose={() => setPicker(null)} />

      <BottomSheet open={listOpen} onClose={() => setListOpen(false)} title="Giriş konumu" size="auto">
        <ul className="m-proj-fieldlist">
          {CONTEXT_KEYS.map((key) => {
            const field = fieldOf(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="m-proj-fieldlist__row"
                  onClick={() => {
                    setListOpen(false);
                    setPicker(key);
                  }}
                >
                  <span>{field.label}</span>
                  <strong>{context[key] || '—'}</strong>
                  <Icon name="chevronRight" size={20} />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="m-muted m-proj-note">
          Şaft ve hat no ayrı bir alan olmadığından satırın notuna yazılır; diğerleri raporda ayrı sütundur.
        </p>
        <button
          type="button"
          className="m-btn m-btn--secondary m-btn--block"
          disabled={!hasContext(context)}
          onClick={() => {
            clearAll();
            setListOpen(false);
          }}
        >
          Konumu temizle
        </button>
      </BottomSheet>
    </section>
  );
}

function ContextValuePicker({
  api,
  fieldKey,
  onClose,
}: {
  api: MeasureContextApi;
  fieldKey: ContextKey | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  // Panel her açıldığında giriş alanı mevcut değerle başlar.
  const [lastKey, setLastKey] = useState<ContextKey | null>(null);
  if (fieldKey !== lastKey) {
    setLastKey(fieldKey);
    if (fieldKey) setDraft(api.context[fieldKey]);
  }
  const key = fieldKey ?? lastKey;
  if (!key) return null;
  const field = fieldOf(key);
  const current = api.context[key];
  const recent = api.recents[key];
  const apply = (value: string) => {
    api.setField(key, value);
    onClose();
  };

  return (
    <BottomSheet
      open={fieldKey !== null}
      onClose={onClose}
      title={field.label}
      footer={
        <>
          {current && (
            <button type="button" className="m-btn m-btn--secondary m-btn--large" onClick={() => apply('')}>
              Temizle
            </button>
          )}
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large"
            style={{ flex: 1 }}
            disabled={!draft.trim() && !current}
            onClick={() => apply(draft)}
          >
            Uygula
          </button>
        </>
      }
    >
      {recent.length > 0 && (
        <div className="m-proj-picker__recent">
          <p className="m-field__label">Son kullanılanlar</p>
          <ChipGrid
            mode="single"
            label={`${field.label} son değerler`}
            value={recent.find((item) => item === current) ?? null}
            options={recent.map((item) => ({ value: item, label: item }))}
            columns={3}
            onChange={apply}
          />
        </div>
      )}
      <form
        className="m-form"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <label className="m-field">
          <span className="m-field__label">{recent.length ? 'Yeni değer' : `${field.label} değeri`}</span>
          <input
            className="m-input"
            value={draft}
            maxLength={field.max}
            placeholder={`Örn. ${field.hint}`}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      </form>
    </BottomSheet>
  );
}
