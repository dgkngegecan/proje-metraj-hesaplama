// Sayısal tuş takımı: ifade ayrıştırıcı (kesin ondalık), düzenleme kuralları ve artırıcı zamanlaması.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDecimal } from '../src/lib/format.ts';
import { evaluateExpression, formatDecimalTr, roundHalfEven } from '../src/mobile/components/keypad/expression.ts';
import {
  applyKey,
  currentNumber,
  keyFromKeyboard,
  MAX_EXPRESSION_LENGTH,
  prettyExpression,
} from '../src/mobile/components/keypad/keypadInput.ts';
import {
  BIG_STEP_AFTER,
  LONG_PRESS_DELAY_MS,
  nextStepperValue,
  repeatDelay,
} from '../src/mobile/components/stepperTiming.ts';

const value = (input, options) => {
  const result = evaluateExpression(input, options);
  assert.equal(result.ok, true, `${input}: ${result.message ?? ''}`);
  return result.value;
};
const error = (input, options) => {
  const result = evaluateExpression(input, options);
  assert.equal(result.ok, false, `${input} reddedilmeliydi, sonuç: ${result.value}`);
  return result.error;
};

test('tek sayı: virgül ve nokta ondalık ayırıcı olarak kabul edilir', () => {
  assert.equal(value('12,5'), '12.5');
  assert.equal(value('12.5'), '12.5');
  assert.equal(value('007'), '7');
  assert.equal(value('0,50'), '0.5');
  assert.equal(value('100'), '100');
  assert.equal(value(' 3 , 2 '.replace(/ /g, '')), '3.2');
  assert.equal(value('  42  '), '42');
});

test('parseDecimal ile uyum: ",5" ve "5," kabul edilir', () => {
  assert.equal(value(',5'), '0.5');
  assert.equal(value('5,'), '5');
  assert.equal(value('.25'), '0.25');
});

test('işlem önceliği: çarpma toplamadan önce', () => {
  assert.equal(value('2+3×4'), '14');
  assert.equal(value('2×3+4'), '10');
  assert.equal(value('1+2×3×4+5'), '30');
  assert.equal(value('10−2×3'), '4');
  assert.equal(value('10-2*3'), '4');
  assert.equal(value('2·3'), '6');
  assert.equal(value('3,2 + 4,75 + 2 × 1,5'), '10.95');
});

test('kayan nokta hatası yok: sonuçlar kesin ondalık', () => {
  assert.equal(value('0,1+0,2'), '0.3');
  assert.equal(value('0,3−0,1'), '0.2');
  assert.equal(value('1,1×1,1'), '1.21');
  assert.equal(value('0,07×100'), '7');
  assert.equal(value('1,005×1000'), '1005');
  assert.equal(value('4,35×100'), '435');
  assert.equal(value('0,1×3'), '0.3');
  // Aynı hesap kayan noktayla yanlış çıkar; burada çıkmamalı.
  assert.notEqual(String(0.1 + 0.2), '0.3');
  assert.notEqual(String(1.1 * 1.1), '1.21');
});

test('baştaki işaret ve negatif sonuç', () => {
  assert.equal(value('−2+5'), '3');
  assert.equal(value('-2'), '-2');
  assert.equal(value('+7'), '7');
  assert.equal(value('2−5'), '-3');
  assert.equal(value('−0'), '0');
  assert.equal(value('1,5−1,5'), '0');
});

test('geçersiz ifadeler açık hata kodlarıyla reddedilir', () => {
  assert.equal(error(''), 'empty');
  assert.equal(error('   '), 'empty');
  assert.equal(error('−'), 'empty');
  assert.equal(error(','), 'syntax');
  assert.equal(error('×5'), 'syntax');
  assert.equal(error('5++3'), 'syntax');
  assert.equal(error('5×−3'), 'syntax', 'işaret yalnız başta');
  assert.equal(error('5+'), 'incomplete');
  assert.equal(error('5×'), 'incomplete');
  assert.equal(error('1,2,3'), 'number');
  assert.equal(error('1.234,5'), 'number', 'binlik ayırıcılı yazım belirsiz');
  assert.equal(error('1e3'), 'syntax');
  assert.equal(error('12 mm'), 'syntax');
  assert.equal(error('(2+3)'), 'syntax');
  assert.equal(error('6÷2'), 'syntax');
  const result = evaluateExpression('5+x');
  assert.equal(result.position, 2, 'hatalı karakterin konumu');
  assert.match(result.message, /okunamadı/);
});

test('canlı önizleme: sondaki işaret yok sayılabilir', () => {
  assert.equal(value('12+', { allowTrailingOperator: true }), '12');
  assert.equal(value('2×3×', { allowTrailingOperator: true }), '6');
  assert.equal(value('2+3×', { allowTrailingOperator: true }), '5');
  assert.equal(error('+', { allowTrailingOperator: true }), 'empty');
});

test('decimal sınırları: 28 ondalık basamak, bankacı yuvarlaması, en büyük değer', () => {
  // 1e-16 × 1e-13 = 1e-29: 28. basamaktan sonrası yuvarlanır.
  assert.equal(value('0,0000000000000001×0,0000000000001'), '0');
  // 5e-14 × 3e-15 = 1,5e-28 → yarımda çifte: 2e-28.
  assert.equal(value('0,00000000000005×0,000000000000003'), `0.${'0'.repeat(27)}2`);
  assert.equal(roundHalfEven({ coefficient: 25n, scale: 1 }, 0).coefficient, 2n);
  assert.equal(roundHalfEven({ coefficient: 35n, scale: 1 }, 0).coefficient, 4n);
  assert.equal(roundHalfEven({ coefficient: -25n, scale: 1 }, 0).coefficient, -2n);
  assert.equal(roundHalfEven({ coefficient: 251n, scale: 2 }, 1).coefficient, 25n);
  assert.equal(roundHalfEven({ coefficient: 26n, scale: 1 }, 0).coefficient, 3n);
  assert.equal(value('79228162514264337593543950335'), '79228162514264337593543950335');
  assert.equal(error('79228162514264337593543950335+1'), 'too-large');
  assert.equal(error('99999999999999×99999999999999×99'), 'too-large');
  assert.equal(error('1234567890123456789012345678901'), 'too-large');
});

test('ondalık sonuç .NET decimal gibi sığdırılır: tam kısım büyükse ondalık kısalır', () => {
  // 12 hane tam kısım × 20 ondalık: 96 bit sınırı içinde kalacak kadar yuvarlanır.
  const result = evaluateExpression('123456789012×1,23456789012345678901');
  assert.equal(result.ok, true);
  const [integer, fraction = ''] = result.value.split('.');
  assert.ok((integer + fraction).length <= 29, result.value);
});

test('sonuç parseDecimal ile aynı sayıyı verir; JSON kesinliği raporlanır', () => {
  for (const input of ['12,5', '0,1+0,2', '3×1,25', '1000000', '0,000001', '−4,5+1', '2,675×3']) {
    const result = evaluateExpression(input);
    assert.equal(result.number, parseDecimal(result.value), input);
    assert.equal(result.exact, true, input);
  }
  const precise = evaluateExpression('0,1234567891234×0,9876543219876');
  assert.equal(precise.value, '0.12193263135643773714966984');
  assert.equal(precise.exact, false, "26 anlamlı basamak Number'a sığmaz; çağıran value metnini kullanmalı");
});

test('Türkçe gösterim: binlik nokta, ondalık virgül, eksi işareti', () => {
  assert.equal(formatDecimalTr('1234567.891'), '1.234.567,891');
  assert.equal(formatDecimalTr('12.5'), '12,5');
  assert.equal(formatDecimalTr('-1000'), '−1.000');
  assert.equal(formatDecimalTr('0'), '0');
  assert.equal(evaluateExpression('1000×2,5').display, '2.500');
  assert.equal(evaluateExpression('3+4').operands, 2);
});

// ---------------------------------------------------------------------------
// Düzenleme kuralları
// ---------------------------------------------------------------------------

const type = (keys, start = '') => keys.reduce((expression, key) => applyKey(expression, key), start);

test('rakamlar, baştaki sıfır ve virgül', () => {
  assert.equal(type(['1', '2', ',', '5']), '12,5');
  assert.equal(type(['0', '0', '7']), '7');
  assert.equal(type([',', '5']), '0,5');
  assert.equal(type(['1', ',', '2', ','], ''), '1,2', 'ikinci virgül yok sayılır');
  assert.equal(type(['0', ',', '0', '5']), '0,05');
  assert.equal(type(['3', '+', ',', '5']), '3+0,5');
});

test('işlem işaretleri: arka arkaya iki işaret olmaz, baştaki yalnız eksi', () => {
  assert.equal(type(['+']), '');
  assert.equal(type(['×']), '');
  assert.equal(type(['−', '5']), '−5');
  assert.equal(type(['−', '+']), '');
  assert.equal(type(['−', '−', '3']), '−3');
  assert.equal(type(['5', '+', '×', '2']), '5×2');
  assert.equal(type(['5', '+', '−']), '5−');
  assert.equal(type(['1', '2', ',', '+', '3']), '12+3', 'sarkan virgül atılır');
});

test('silme ve temizleme', () => {
  assert.equal(applyKey('12,5', 'backspace'), '12,');
  assert.equal(applyKey('', 'backspace'), '');
  assert.equal(applyKey('3+4', 'clear'), '');
});

test('uzunluk sınırları: sayı başına 15 rakam, ifade 64 karakter', () => {
  const sixteen = type(Array.from({ length: 16 }, () => '9'));
  assert.equal(sixteen.length, 15);
  let long = '';
  for (let index = 0; index < 100; index += 1) long = applyKey(long, index % 2 ? '+' : '7');
  assert.ok(long.length <= MAX_EXPRESSION_LENGTH);
});

test('tuş takımının ürettiği her ifade ayrıştırılabilir (rastgele dizi)', () => {
  const keys = ['0', '1', '5', '9', ',', '+', '−', '×', 'backspace'];
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let round = 0; round < 300; round += 1) {
    let expression = '';
    const length = 1 + Math.floor(random() * 20);
    for (let index = 0; index < length; index += 1)
      expression = applyKey(expression, keys[Math.floor(random() * keys.length)]);
    const result = evaluateExpression(expression, { allowTrailingOperator: true });
    if (!result.ok) assert.ok(['empty'].includes(result.error) || expression === '', `${expression} → ${result.error}`);
  }
});

test('yardımcılar: geçerli sayı, fiziksel klavye, okunur gösterim', () => {
  assert.equal(currentNumber('3+12,5'), '12,5');
  assert.equal(currentNumber('3+'), '');
  assert.equal(keyFromKeyboard('7'), '7');
  assert.equal(keyFromKeyboard('.'), ',');
  assert.equal(keyFromKeyboard('-'), '−');
  assert.equal(keyFromKeyboard('*'), '×');
  assert.equal(keyFromKeyboard('Backspace'), 'backspace');
  assert.equal(keyFromKeyboard('Enter'), null);
  assert.equal(prettyExpression('−3+4×2'), '−3 + 4 × 2');
});

// ---------------------------------------------------------------------------
// Büyük artırıcı
// ---------------------------------------------------------------------------

test('uzun basma yavaş başlar, hızlanır ve alt sınırda durur', () => {
  assert.equal(repeatDelay(-1), LONG_PRESS_DELAY_MS);
  const delays = Array.from({ length: 40 }, (_, index) => repeatDelay(index));
  for (let index = 1; index < delays.length; index += 1) assert.ok(delays[index] <= delays[index - 1]);
  assert.equal(delays.at(-1), 50);
});

test('adım: önce birer, 15 tekrardan sonra beşin katlarına', () => {
  assert.equal(nextStepperValue(3, 1, -1), 4);
  assert.equal(nextStepperValue(3, -1, 0), 2);
  assert.equal(nextStepperValue(13, 1, BIG_STEP_AFTER), 15);
  assert.equal(nextStepperValue(15, 1, BIG_STEP_AFTER + 1), 20);
  assert.equal(nextStepperValue(13, -1, BIG_STEP_AFTER), 10);
  assert.equal(nextStepperValue(0, -1, 0), 0, 'alt sınır');
  assert.equal(nextStepperValue(99, 1, 0, { max: 99 }), 99, 'üst sınır');
  assert.equal(nextStepperValue(0.5, 1, 0, { step: 0.1 }), 0.6, 'ondalık adımda birikme yok');
  let current = 0;
  for (let index = 0; index < 10; index += 1) current = nextStepperValue(current, 1, -1, { step: 0.1 });
  assert.equal(current, 1);
});
