/**
 * Büyük artırıcının (+/−) uzun basma davranışı (saf).
 *
 * Fitting ve radyatör sayımında adetler çoğunlukla küçüktür (1–20) ama bazen
 * yüzlerce olur (dirsek, kelepçe). Uzun basınca tekrar önce yavaş başlar,
 * sonra hızlanır; 15 tekrardan sonra adım beşe çıkar ve değer beşin katına
 * hizalanır ki 13 → 15 → 20 diye okunabilir ilerlesin.
 */

export const LONG_PRESS_DELAY_MS = 420;
const FASTEST_REPEAT_MS = 50;
export const BIG_STEP_AFTER = 15;
const BIG_STEP_FACTOR = 5;

/** `repeat` = kaçıncı otomatik tekrar (0 = ilk tekrar). Bir sonraki tekrara kadar beklenecek süre. */
export function repeatDelay(repeat: number): number {
  if (repeat < 0) return LONG_PRESS_DELAY_MS;
  return Math.max(FASTEST_REPEAT_MS, Math.round(200 * Math.pow(0.82, repeat)));
}

export interface StepOptions {
  step?: number;
  min?: number;
  max?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Bir sonraki değer. `repeat` = -1 tek dokunuş; 0.. uzun basma tekrarları.
 * Ondalık adımlarda (0,5 gibi) kayan nokta birikmesin diye adım sayısıyla hesaplanır.
 */
export function nextStepperValue(value: number, direction: 1 | -1, repeat: number, options: StepOptions = {}): number {
  const step = options.step ?? 1;
  const min = options.min ?? 0;
  const max = options.max ?? 1_000_000;
  const units = Math.round(value / step);
  if (repeat < BIG_STEP_AFTER) return clamp(roundToStep((units + direction) * step, step), min, max);
  const big = BIG_STEP_FACTOR;
  const aligned = direction > 0 ? Math.floor(units / big) * big + big : Math.ceil(units / big) * big - big;
  return clamp(roundToStep(aligned * step, step), min, max);
}

function roundToStep(value: number, step: number) {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(value.toFixed(decimals));
}
