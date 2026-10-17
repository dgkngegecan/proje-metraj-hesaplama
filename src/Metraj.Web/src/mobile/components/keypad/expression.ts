/**
 * Sayısal tuş takımının ifade ayrıştırıcısı.
 *
 * Sahada metraj çoğu zaman bir hesaptır: "3,2 + 4,75 + 2 × 1,5". Tuş takımı bu
 * ifadeyi kabul eder ve sonucu KESİN ondalık olarak üretir. Kayan nokta
 * kullanılsaydı 0,1 + 0,2 = 0,30000000000000004 olurdu; sunucu `decimal`
 * kullandığı için bu artık hata kalıcı veriye girerdi. Hesap BigInt tabanlı
 * ölçekli tam sayılarla yapılır, sonuç metindir.
 *
 * Kurallar:
 * - Ondalık ayırıcı virgül (Türkçe) veya nokta. Bir sayıda en fazla bir ayırıcı;
 *   "1.234,5" gibi binlik ayırıcılı yazım belirsiz olduğu için REDDEDİLİR.
 * - İşlemler: + , − (veya -), × (veya *, ·). Çarpma önce yapılır. Parantez yok.
 * - Yalnız ifadenin başında işaret olabilir ("−2 + 5").
 * - Sonuç `value` alanında nokta ayırıcılı, üssüz, sondaki sıfırları atılmış
 *   metindir; `lib/format.ts` içindeki `parseDecimal(value)` ile aynı sayıyı verir.
 * - .NET `decimal` sınırları: en fazla 28 ondalık basamak (fazlası bankacı
 *   yuvarlamasıyla), mutlak değer 79.228.162.514.264.337.593.543.950.335'i aşamaz.
 *
 * Saf modül: tests/mobile-keypad.test.mjs.
 */

export type ExpressionErrorCode = 'empty' | 'syntax' | 'number' | 'incomplete' | 'too-large';

export type EvaluationResult =
  | {
      ok: true;
      /** Kanonik ondalık metin: "12.5", "-3", "0.3". */
      value: string;
      /** Türkçe gösterim: "12,5", "1.234,75". */
      display: string;
      /** `parseDecimal(value)`; JSON'a sayı olarak yazılacaksa bu kullanılır. */
      number: number;
      /** `number` JSON'a yazılıp geri okunduğunda `value` ile birebir aynı mı? */
      exact: boolean;
      /** İfadede kaç sayı vardı (tek sayı mı, hesap mı?). */
      operands: number;
    }
  | { ok: false; error: ExpressionErrorCode; message: string; position: number };

export const MAX_SCALE = 28;
const DECIMAL_MAX = 79228162514264337593543950335n;
const MAX_NUMBER_DIGITS = 29;

const MESSAGES: Record<ExpressionErrorCode, string> = {
  empty: 'Bir sayı yazın.',
  syntax: 'İfade anlaşılamadı.',
  number: 'Bir sayıda en fazla bir ondalık ayırıcı olabilir.',
  incomplete: 'İfade bir işlem işaretiyle bitiyor.',
  'too-large': 'Sayı çok büyük.',
};

interface Decimal {
  coefficient: bigint;
  scale: number;
}

type Token =
  | { kind: 'number'; text: string; position: number }
  | { kind: 'operator'; operator: '+' | '-' | '*'; position: number };

const OPERATOR_ALIASES: Record<string, '+' | '-' | '*'> = {
  '+': '+',
  '-': '-',
  '−': '-', // −
  '–': '-', // – (bazı klavyeler)
  '*': '*',
  '×': '*', // ×
  '·': '*', // ·
};

const WHITESPACE = /[\s   ]/;

function fail(error: ExpressionErrorCode, position: number): EvaluationResult {
  return { ok: false, error, message: MESSAGES[error], position };
}

function tokenize(input: string): Token[] | EvaluationResult {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (WHITESPACE.test(char)) {
      index += 1;
      continue;
    }
    const operator = OPERATOR_ALIASES[char];
    if (operator) {
      tokens.push({ kind: 'operator', operator, position: index });
      index += 1;
      continue;
    }
    if (/[0-9.,]/.test(char)) {
      const start = index;
      while (index < input.length && /[0-9.,]/.test(input[index]!)) index += 1;
      tokens.push({ kind: 'number', text: input.slice(start, index), position: start });
      continue;
    }
    return fail('syntax', index);
  }
  return tokens;
}

function parseNumber(token: { text: string; position: number }): Decimal | EvaluationResult {
  const separators = token.text.match(/[.,]/g) ?? [];
  if (separators.length > 1) return fail('number', token.position);
  const [integerPart = '', fractionPart = ''] = token.text.split(/[.,]/);
  // parseDecimal ile uyum: ",5" = 0,5 ve "5," = 5 kabul edilir; yalnız "," değil.
  if (!integerPart && !fractionPart) return fail('syntax', token.position);
  const digits = (integerPart + fractionPart).replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_NUMBER_DIGITS) return fail('too-large', token.position);
  const parsed = fitDecimal({ coefficient: BigInt(integerPart + fractionPart || '0'), scale: fractionPart.length });
  return parsed ?? fail('too-large', token.position);
}

function align(left: Decimal, right: Decimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

const add = (left: Decimal, right: Decimal): Decimal => {
  const [a, b, scale] = align(left, right);
  return { coefficient: a + b, scale };
};

const negate = (value: Decimal): Decimal => ({ coefficient: -value.coefficient, scale: value.scale });

const multiply = (left: Decimal, right: Decimal): Decimal => ({
  coefficient: left.coefficient * right.coefficient,
  scale: left.scale + right.scale,
});

/** Ölçeği `maxScale`'e indirir; yarım değerde çifte yuvarlar (.NET decimal davranışı). */
export function roundHalfEven(value: Decimal, maxScale = MAX_SCALE): Decimal {
  if (value.scale <= maxScale) return value;
  const divisor = 10n ** BigInt(value.scale - maxScale);
  const negative = value.coefficient < 0n;
  const magnitude = negative ? -value.coefficient : value.coefficient;
  let quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const twice = remainder * 2n;
  if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) quotient += 1n;
  return { coefficient: negative ? -quotient : quotient, scale: maxScale };
}

/**
 * .NET `decimal`'ın gösterebileceği biçime sığdırır: ölçek en fazla 28 ve
 * katsayı 96 bit. Sığmayan basamaklar sağdan yuvarlanır (ör. 12 haneli tam
 * kısmı olan bir çarpımın 28. ondalık basamağı). Tam kısım sığmıyorsa null.
 */
function fitDecimal(value: Decimal): Decimal | null {
  let fitted = roundHalfEven(value);
  const magnitude = (item: Decimal) => (item.coefficient < 0n ? -item.coefficient : item.coefficient);
  while (magnitude(fitted) > DECIMAL_MAX && fitted.scale > 0) fitted = roundHalfEven(fitted, fitted.scale - 1);
  return magnitude(fitted) > DECIMAL_MAX ? null : fitted;
}

function normalize(value: Decimal): Decimal {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function toCanonical(value: Decimal): string {
  const { coefficient, scale } = normalize(value);
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = scale ? digits.slice(digits.length - scale) : '';
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

/** Kanonik metni Türkçe gösterime çevirir: binlik nokta, ondalık virgül. */
export function formatDecimalTr(value: string): string {
  const negative = value.startsWith('-');
  const [integer = '0', fraction] = (negative ? value.slice(1) : value).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

export interface EvaluateOptions {
  /** Canlı önizleme için: sondaki işlem işareti yok sayılır ("12 +" → 12). */
  allowTrailingOperator?: boolean;
}

export function evaluateExpression(input: string, options: EvaluateOptions = {}): EvaluationResult {
  const tokens = tokenize(input);
  if (!Array.isArray(tokens)) return tokens;
  if (!tokens.length) return fail('empty', 0);
  let position = 0;
  let sign: '+' | '-' = '+';
  const first = tokens[0]!;
  if (first.kind === 'operator') {
    if (first.operator === '*') return fail('syntax', first.position);
    sign = first.operator;
    position = 1;
  }

  let total: Decimal = { coefficient: 0n, scale: 0 };
  let term: Decimal | null = null;
  let pendingAdditive: '+' | '-' = sign;
  let operands = 0;
  let expectNumber = true;
  let lastOperatorPosition = -1;

  for (; position < tokens.length; position += 1) {
    const token = tokens[position]!;
    if (expectNumber) {
      if (token.kind !== 'number') return fail('syntax', token.position);
      const parsed = parseNumber(token);
      if ('ok' in parsed) return parsed;
      operands += 1;
      const next: Decimal | null = term ? fitDecimal(multiply(term, parsed)) : parsed;
      if (!next) return fail('too-large', token.position);
      term = next;
      expectNumber = false;
      continue;
    }
    if (token.kind !== 'operator') return fail('syntax', token.position);
    lastOperatorPosition = token.position;
    if (token.operator === '*') {
      expectNumber = true;
      continue;
    }
    // Toplama/çıkarma: biriken çarpım terimi toplama eklenir.
    const sum = fitDecimal(add(total, pendingAdditive === '-' ? negate(term!) : term!));
    if (!sum) return fail('too-large', token.position);
    total = sum;
    term = null;
    pendingAdditive = token.operator;
    expectNumber = true;
  }

  if (expectNumber) {
    if (!options.allowTrailingOperator || operands === 0)
      return fail(operands === 0 ? 'empty' : 'incomplete', lastOperatorPosition);
    // "12 × " → 12: yarım kalan çarpım, son tam terimle kapanır.
  }
  const final = term ? fitDecimal(add(total, pendingAdditive === '-' ? negate(term) : term)) : fitDecimal(total);
  if (!final) return fail('too-large', 0);
  const value = toCanonical(final);
  const number = Number(value);
  return {
    ok: true,
    value,
    display: formatDecimalTr(value),
    number,
    exact: isExactInNumber(value, number),
    operands,
  };
}

function isExactInNumber(value: string, number: number): boolean {
  if (!Number.isFinite(number)) return false;
  const text = String(number);
  if (/e/i.test(text)) return false;
  return text === value;
}
