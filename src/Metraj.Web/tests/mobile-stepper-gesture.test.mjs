import assert from 'node:assert/strict';
import test from 'node:test';
import { initialGestureState, reduceGesture, TAP_MOVE_TOLERANCE_PX } from '../src/mobile/components/stepperGesture.ts';

/** Olayları sırayla işler; kaç adım atıldığını ve son durumu döndürür. */
function run(events) {
  let state = initialGestureState;
  let steps = 0;
  const effects = [];
  for (const event of events) {
    const result = reduceGesture(state, event);
    state = result.state;
    effects.push(...result.effects);
    steps += result.effects.filter((effect) => effect === 'step').length;
  }
  return { state, steps, effects };
}

test('dokunma: adım parmak kalkınca bir kez atılır, ardından gelen click yutulur', () => {
  const { steps, state } = run([{ type: 'down', x: 10, y: 10 }, { type: 'up' }, { type: 'click' }]);
  assert.equal(steps, 1);
  assert.equal(state.suppressClick, false);
});

test('pointerdown tek başına değer değiştirmez', () => {
  assert.equal(run([{ type: 'down', x: 0, y: 0 }]).steps, 0);
});

test('kaydırma: tarayıcı pointercancel gönderirse hiçbir adım atılmaz', () => {
  const { steps, state } = run([{ type: 'down', x: 0, y: 0 }, { type: 'move', x: 0, y: 4 }, { type: 'cancel' }]);
  assert.equal(steps, 0);
  assert.equal(state.phase, 'idle');
});

test('iptalden sonra klavye/ekran okuyucu tıklaması yutulmaz (takılı bayrak yok)', () => {
  const { steps } = run([{ type: 'down', x: 0, y: 0 }, { type: 'cancel' }, { type: 'click' }]);
  assert.equal(steps, 1);
});

test('eşikten fazla kayan parmak kalkınca adım atılmaz; gelen click de yutulur', () => {
  const far = TAP_MOVE_TOLERANCE_PX + 1;
  const { steps } = run([
    { type: 'down', x: 0, y: 0 },
    { type: 'move', x: 0, y: far },
    { type: 'up' },
    { type: 'click' },
  ]);
  assert.equal(steps, 0);
});

test('eşik içindeki titreme dokunmayı bozmaz', () => {
  const near = TAP_MOVE_TOLERANCE_PX - 1;
  const { steps } = run([{ type: 'down', x: 0, y: 0 }, { type: 'move', x: near, y: 0 }, { type: 'up' }]);
  assert.equal(steps, 1);
});

test('uzun basma: ilk adım gecikmede atılır ve tekrar başlar; kalkınca ek adım yok', () => {
  const { steps, effects } = run([
    { type: 'down', x: 0, y: 0 },
    { type: 'longPress' },
    { type: 'up' },
    { type: 'click' },
  ]);
  assert.equal(steps, 1, 'tekrarlar ayrıca zamanlayıcıdan gelir; hareketin kendisi bir adım atar');
  assert.ok(effects.includes('startRepeat'));
  assert.equal(effects.at(-1), 'stopTimers');
});

test('kaydırma uzun basma zamanlayıcısını durdurur; geciken longPress yok sayılır', () => {
  const { steps, effects } = run([
    { type: 'down', x: 0, y: 0 },
    { type: 'move', x: 0, y: 40 },
    { type: 'longPress' },
    { type: 'cancel' },
  ]);
  assert.equal(steps, 0);
  assert.ok(!effects.includes('startRepeat'));
});

test('işaretçisiz click (klavye Enter/Boşluk, TalkBack) tek adım atar', () => {
  assert.equal(run([{ type: 'click' }]).steps, 1);
  assert.equal(run([{ type: 'click' }, { type: 'click' }]).steps, 2);
});
