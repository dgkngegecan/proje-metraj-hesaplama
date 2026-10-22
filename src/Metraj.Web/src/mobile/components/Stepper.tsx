import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Icon } from './Icon';
import { haptic } from './haptics.ts';
import { LONG_PRESS_DELAY_MS, nextStepperValue, repeatDelay } from './stepperTiming.ts';
import { initialGestureState, reduceGesture, type GestureEvent, type GestureState } from './stepperGesture.ts';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Değere dokununca (ör. tuş takımıyla doğrudan yazmak için). */
  onValuePress?: () => void;
  size?: 'large' | 'compact';
}

/**
 * Büyük artırıcı: − [değer] +. Tek dokunuş (parmak kalkınca) bir adım; basılı
 * tutunca önce yavaş, sonra hızlanarak tekrarlar (15 tekrardan sonra beşer).
 * Düğmenin üstünden başlayan kaydırma değeri değiştirmez. Ekran okuyucu
 * için `spinbutton`; ok tuşları, Page Up/Down (±10), Home/End çalışır.
 */
export function Stepper({
  value,
  onChange,
  label,
  unit,
  min = 0,
  max = 1_000_000,
  step = 1,
  disabled = false,
  onValuePress,
  size = 'large',
}: StepperProps) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<number | null>(null);
  const gestures = useRef<Record<1 | -1, GestureState>>({ [1]: initialGestureState, [-1]: initialGestureState });

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const apply = (direction: 1 | -1, repeat: number) => {
    const next = nextStepperValue(valueRef.current, direction, repeat, { min, max, step });
    if (next === valueRef.current) {
      haptic('reject');
      stop();
      return false;
    }
    haptic('tick');
    // Basılı tutarken üst bileşen yeniden çizilmeden de doğru değerden devam edilir.
    valueRef.current = next;
    onChangeRef.current(next);
    return true;
  };

  const startRepeat = (direction: 1 | -1) => {
    let repeat = 0;
    const tick = () => {
      if (!apply(direction, repeat)) return;
      timer.current = window.setTimeout(tick, repeatDelay(repeat));
      repeat += 1;
    };
    timer.current = window.setTimeout(tick, repeatDelay(0));
  };

  // Hareket kararı saf durum makinesinde (stepperGesture.ts): adım parmak
  // kalkınca atılır, kaydırma (pointercancel) hiçbir şey uygulamaz.
  const dispatch = (direction: 1 | -1, event: GestureEvent) => {
    const result = reduceGesture(gestures.current[direction], event);
    gestures.current[direction] = result.state;
    let stepped = true;
    for (const effect of result.effects) {
      if (effect === 'stopTimers') stop();
      else if (effect === 'armLongPress') {
        timer.current = window.setTimeout(() => dispatch(direction, { type: 'longPress' }), LONG_PRESS_DELAY_MS);
      } else if (effect === 'step') stepped = !disabled && apply(direction, -1);
      else if (effect === 'startRepeat' && stepped) startRepeat(direction);
    }
  };

  const pointerHandlers = (direction: 1 | -1) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dispatch(direction, { type: 'down', x: event.clientX, y: event.clientY });
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) =>
      dispatch(direction, { type: 'move', x: event.clientX, y: event.clientY }),
    onPointerUp: () => dispatch(direction, { type: 'up' }),
    onPointerCancel: () => dispatch(direction, { type: 'cancel' }),
    // Sıra pointerup → lostpointercapture → click: hareket zaten bittiyse iptal sayılmaz.
    onLostPointerCapture: () => {
      if (gestures.current[direction].phase !== 'idle') dispatch(direction, { type: 'cancel' });
    },
    // İşaretçi hareketinin ardından gelen click yutulur; klavye/ekran okuyucu tıklaması tek adım atar.
    onClick: () => dispatch(direction, { type: 'click' }),
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const set = (next: number) => {
      event.preventDefault();
      const clamped = Math.min(max, Math.max(min, next));
      if (clamped !== value) {
        haptic('tick');
        onChange(clamped);
      }
    };
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') set(value + step);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') set(value - step);
    else if (event.key === 'PageUp') set(value + step * 10);
    else if (event.key === 'PageDown') set(value - step * 10);
    else if (event.key === 'Home') set(min);
    else if (event.key === 'End' && max < 1_000_000) set(max);
  };

  const display = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 }).format(value);
  return (
    <div className={`m-stepper m-stepper--${size}${disabled ? ' is-disabled' : ''}`}>
      <button
        type="button"
        className="m-stepper__button m-pressable"
        aria-label={`${label} azalt`}
        disabled={disabled || value <= min}
        {...pointerHandlers(-1)}
      >
        <Icon name="minus" />
      </button>
      <div
        className="m-stepper__value"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${display}${unit ? ` ${unit}` : ''}`}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onClick={onValuePress}
      >
        <span className="m-num">{display}</span>
        {unit && <small>{unit}</small>}
      </div>
      <button
        type="button"
        className="m-stepper__button m-pressable"
        aria-label={`${label} artır`}
        disabled={disabled || value >= max}
        {...pointerHandlers(1)}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}
