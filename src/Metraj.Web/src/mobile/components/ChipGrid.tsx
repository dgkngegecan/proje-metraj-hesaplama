import { useRef, type KeyboardEvent } from 'react';
import { haptic } from './haptics.ts';

export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
  /** İkinci satır (ör. "12 giriş"). */
  hint?: string;
  /** Sağ üst rozet (ör. bekleyen adet). */
  badge?: string | number;
  disabled?: boolean;
}

interface CommonProps<V extends string> {
  options: readonly ChipOption<V>[];
  /** Grubun adı (ekran okuyucu): "Çap". */
  label: string;
  /** Sütun sayısı; verilmezse ekrana sığdığı kadar (en az 96 px genişlik). */
  columns?: number;
  className?: string;
}

export type ChipGridProps<V extends string> = CommonProps<V> &
  (
    | { mode: 'single'; value: V | null; onChange: (value: V) => void }
    | { mode: 'multiple'; value: readonly V[]; onChange: (value: V[]) => void }
  );

/**
 * Çip ızgarası: çap, tip, yükseklik gibi seçenekler için büyük dokunma
 * hedefleri. Tek seçimde `radiogroup` (ok tuşlarıyla dolaşma, tek sekme durağı),
 * çok seçimde basılı/basılı değil düğmeler.
 */
export function ChipGrid<V extends string>(props: ChipGridProps<V>) {
  const { options, label, columns, className } = props;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const isSelected = (value: V) => (props.mode === 'single' ? props.value === value : props.value.includes(value));

  const toggle = (option: ChipOption<V>) => {
    if (option.disabled) return;
    haptic('tick');
    if (props.mode === 'single') {
      props.onChange(option.value);
      return;
    }
    const selected = props.value.includes(option.value);
    props.onChange(selected ? props.value.filter((item) => item !== option.value) : [...props.value, option.value]);
  };

  // Tek seçimde ok tuşları seçimi taşır (WAI-ARIA radio deseni).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (props.mode !== 'single') return;
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const enabled = options.map((option, index) => ({ option, index })).filter((item) => !item.option.disabled);
    if (!enabled.length) return;
    const current = enabled.findIndex((item) => item.option.value === props.value);
    const next = enabled[(current + delta + enabled.length) % enabled.length]!;
    toggle(next.option);
    refs.current[next.index]?.focus();
  };

  const selectedIndex = props.mode === 'single' ? options.findIndex((option) => option.value === props.value) : -1;
  const firstEnabled = options.findIndex((option) => !option.disabled);
  return (
    <div
      className={`m-chip-grid${className ? ` ${className}` : ''}`}
      role={props.mode === 'single' ? 'radiogroup' : 'group'}
      aria-label={label}
      onKeyDown={onKeyDown}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option, index) => {
        const selected = isSelected(option.value);
        const tabbable = props.mode === 'multiple' || index === (selectedIndex >= 0 ? selectedIndex : firstEnabled);
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            className={`m-chip${selected ? ' is-selected' : ''}`}
            role={props.mode === 'single' ? 'radio' : undefined}
            aria-checked={props.mode === 'single' ? selected : undefined}
            aria-pressed={props.mode === 'multiple' ? selected : undefined}
            tabIndex={tabbable ? 0 : -1}
            disabled={option.disabled}
            onClick={() => toggle(option)}
          >
            <span className="m-chip__label">{option.label}</span>
            {option.hint && <span className="m-chip__hint">{option.hint}</span>}
            {option.badge !== undefined && option.badge !== '' && (
              <span className="m-chip__badge m-num">{option.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
