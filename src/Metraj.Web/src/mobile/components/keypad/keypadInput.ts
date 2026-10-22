/**
 * Tuş takımı düzenleme kuralları (saf). Ekranda görünen metin her zaman
 * `evaluateExpression`'ın anlayacağı biçimde kalır:
 * - Arka arkaya iki işlem işareti olmaz; yenisi eskisinin yerine geçer.
 * - Bir sayıda ikinci ondalık virgülü yok sayılır; boş sayıya virgül "0," olur.
 * - Baştaki gereksiz sıfır yazılmaz ("007" değil "7").
 * - İfade yalnız "−" ile başlayabilir.
 */

export type KeypadKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | '+' | '−' | '×' | 'backspace' | 'clear';

export const KEYPAD_OPERATORS = ['+', '−', '×'] as const;
export type KeypadOperator = (typeof KEYPAD_OPERATORS)[number];

export const MAX_EXPRESSION_LENGTH = 64;
const MAX_DIGITS_PER_NUMBER = 15;

const isOperator = (char: string | undefined): char is KeypadOperator => char === '+' || char === '−' || char === '×';

/** İfadenin son (yazılmakta olan) sayısı. */
export function currentNumber(expression: string): string {
  const match = /[0-9,]*$/.exec(expression);
  return match ? match[0] : '';
}

export function applyKey(expression: string, key: KeypadKey): string {
  if (key === 'clear') return '';
  if (key === 'backspace') return expression.slice(0, -1);
  if (expression.length >= MAX_EXPRESSION_LENGTH) return expression;

  const last = expression.at(-1);
  const number = currentNumber(expression);

  if (key === ',') {
    if (number.includes(',')) return expression;
    return number ? `${expression},` : `${expression}0,`;
  }

  if (isOperator(key)) {
    if (!expression) return key === '−' ? '−' : '';
    if (expression === '−') return key === '−' ? expression : '';
    // Sarkan virgül atılır: "12," + "+" → "12+".
    const base = last === ',' ? expression.slice(0, -1) : expression;
    return isOperator(base.at(-1)) ? `${base.slice(0, -1)}${key}` : `${base}${key}`;
  }

  // Rakam
  if (number.replace(',', '').length >= MAX_DIGITS_PER_NUMBER) return expression;
  if (number === '0') return `${expression.slice(0, -1)}${key}`;
  return `${expression}${key}`;
}

/** Fiziksel klavye tuşunu tuş takımı tuşuna çevirir (Bluetooth klavye, emülatör, masaüstü testi). */
export function keyFromKeyboard(key: string): KeypadKey | null {
  if (/^[0-9]$/.test(key)) return key as KeypadKey;
  switch (key) {
    case ',':
    case '.':
    case 'Decimal':
      return ',';
    case '+':
      return '+';
    case '-':
    case '−':
      return '−';
    case '*':
    case 'x':
    case 'X':
    case '×':
      return '×';
    case 'Backspace':
      return 'backspace';
    case 'Delete':
      return 'clear';
    default:
      return null;
  }
}

/** Ekranda gösterim: işaretlerin etrafında ince boşluk (okunurluk). */
export function prettyExpression(expression: string): string {
  return expression.replace(/(?<=.)([+−×])/g, ' $1 ');
}
