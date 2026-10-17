import type { ReactNode } from 'react';
import { haptic } from '../../components';

export interface StripOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Ekran okuyucu adı; verilmezse etiket metni. */
  ariaLabel?: string;
  badge?: string | number;
}

/**
 * Yatay kaydırmalı çip şeridi: sınırlı dikeyde (kart ekleme paneli, tuş takımı
 * üstü) `ChipGrid`'in çok satırlı ızgarası fazla yer tutar. Her çip ≥ 48 dp.
 */
export function ChipStrip<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly StripOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div className="m-proj-strip" role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`m-proj-strip__chip${selected ? ' is-selected' : ''}`}
            aria-pressed={selected}
            aria-label={option.ariaLabel}
            onClick={() => {
              haptic('tick');
              onChange(option.value);
            }}
          >
            {option.label}
            {option.badge !== undefined && option.badge !== '' && option.badge !== 0 && (
              <span className="m-proj-strip__badge m-num">{option.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
