// Mobil kabuğun saf mantığı: geri yığını, panel jesti, alt bilgi çubuğu, kaydırma ve arama.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackStack } from '../src/mobile/shell/backStack.ts';
import { keyboardInset, sheetDragOffset, shouldDismissSheet } from '../src/mobile/shell/sheetGesture.ts';
import { createSnackbarController, SNACKBAR_DURATION } from '../src/mobile/shell/snackbar.ts';
import { lockAxis, resolveSwipe, swipeOffset } from '../src/mobile/components/swipe.ts';
import { createSearchIndex, foldSearchText, matchesQuery } from '../src/mobile/components/search.ts';
import { shellActions, shellStore, START_TAB, topRoute } from '../src/mobile/shell/shellStore.ts';

// ---------------------------------------------------------------------------
// Geri yığını
// ---------------------------------------------------------------------------

test('geri sırası: panel → iç içe seviye → sekme kökü → çıkış', () => {
  const stack = createBackStack();
  const log = [];
  let sheetOpen = true;
  let depth = 2;
  let tab = 'library';
  stack.register('tab', () => {
    if (tab === 'project') return false;
    tab = 'project';
    log.push('tab');
  });
  stack.register('nested', () => {
    if (!depth) return false;
    depth -= 1;
    log.push(`pop:${depth}`);
  });
  const offSheet = stack.register('sheet', () => {
    sheetOpen = false;
    log.push('sheet');
    offSheet();
  });
  const results = Array.from({ length: 5 }, () => stack.handleBack());
  assert.deepEqual(log, ['sheet', 'pop:1', 'pop:0', 'tab']);
  assert.deepEqual(results, ['handled', 'handled', 'handled', 'handled', 'exit']);
  assert.equal(sheetOpen, false);
});

test('aynı katmanda en son kaydolan önce sorulur; kaldırılan sorulmaz', () => {
  const stack = createBackStack();
  const log = [];
  stack.register('sheet', () => log.push('alttaki panel'));
  const offTop = stack.register('sheet', () => log.push('üstteki panel'));
  stack.handleBack();
  offTop();
  stack.handleBack();
  assert.deepEqual(log, ['üstteki panel', 'alttaki panel']);
});

test('yığın değişimi abonelere bildirilir', () => {
  const stack = createBackStack();
  let changes = 0;
  stack.subscribe(() => changes++);
  const off = stack.register('nested', () => undefined);
  off();
  off();
  assert.equal(changes, 2);
  assert.equal(stack.size, 0);
});

// ---------------------------------------------------------------------------
// Alttan açılan panel
// ---------------------------------------------------------------------------

test('panel: aşağı serbest, yukarı dirençli; mesafe veya hızla kapanır', () => {
  assert.equal(sheetDragOffset(120), 120);
  assert.equal(sheetDragOffset(-100), -20);
  assert.equal(shouldDismissSheet(50, 0.1, 600), false);
  assert.equal(shouldDismissSheet(170, 0.1, 600), true, '160 px üstü');
  assert.equal(shouldDismissSheet(110, 0.1, 300), true, 'kısa panelde üçte bir');
  assert.equal(shouldDismissSheet(40, 0.9, 600), true, 'hızlı fırlatma');
  assert.equal(shouldDismissSheet(10, 2, 600), false, 'çok kısa fırlatma tıklama sayılır');
  assert.equal(shouldDismissSheet(-200, -3, 600), false);
});

test('klavye payı görsel görüntü alanından hesaplanır', () => {
  assert.equal(keyboardInset(800, 800, 0), 0);
  assert.equal(keyboardInset(800, 480, 0), 320);
  assert.equal(keyboardInset(800, 470, 10), 320);
  assert.equal(keyboardInset(800, 790, 0), 0, 'küçük titremeler yok sayılır');
});

// ---------------------------------------------------------------------------
// Alt bilgi çubuğu
// ---------------------------------------------------------------------------

function fakeClock() {
  let time = 0;
  const handles = [];
  return {
    timers: {
      set(callback, ms) {
        const handle = { callback, at: time + ms, cleared: false };
        handles.push(handle);
        return handle;
      },
      clear(handle) {
        handle.cleared = true;
      },
      now: () => time,
    },
    advance(ms) {
      time += ms;
      for (const handle of handles)
        if (!handle.cleared && handle.at <= time) {
          handle.cleared = true;
          handle.callback();
        }
    },
  };
}

test('çubuk süresi dolunca kapanır; tonlara göre varsayılan süreler', () => {
  const clock = fakeClock();
  const bar = createSnackbarController(clock.timers);
  const reasons = [];
  bar.show({ message: 'Kaydedildi.', onClose: (reason) => reasons.push(reason) });
  assert.equal(bar.current.message, 'Kaydedildi.');
  assert.equal(bar.current.durationMs, SNACKBAR_DURATION.info);
  clock.advance(SNACKBAR_DURATION.info);
  assert.equal(bar.current, null);
  assert.deepEqual(reasons, ['timeout']);
  bar.show({ message: 'Hata', tone: 'error' });
  assert.equal(bar.current.durationMs, SNACKBAR_DURATION.error);
});

test('yeni çubuk eskisinin yerine geçer (replaced); eylem "action" nedeniyle kapatır', () => {
  const bar = createSnackbarController(fakeClock().timers);
  const log = [];
  const first = bar.show({
    message: 'A silindi',
    action: { label: 'Geri al', onAction: () => log.push('undo A') },
    onClose: (r) => log.push(`A:${r}`),
  });
  const second = bar.show({
    message: 'B silindi',
    action: { label: 'Geri al', onAction: () => log.push('undo B') },
    onClose: (r) => log.push(`B:${r}`),
  });
  bar.act(first);
  bar.act(second);
  assert.deepEqual(log, ['A:replaced', 'B:action', 'undo B']);
});

test('dokunurken süre durur, bırakınca kalan süre (en az 1,5 sn) işler', () => {
  const clock = fakeClock();
  const bar = createSnackbarController(clock.timers);
  bar.show({ message: 'Silindi', durationMs: 5000 });
  clock.advance(4000);
  bar.hold();
  clock.advance(60_000);
  assert.ok(bar.current, 'tutulurken kapanmaz');
  bar.release();
  clock.advance(1499);
  assert.ok(bar.current);
  clock.advance(1);
  assert.equal(bar.current, null);
});

test('arka plana geçerken açık çubuk "flush" ile kapanır; anlık görüntü kararlıdır', () => {
  const bar = createSnackbarController(fakeClock().timers);
  const reasons = [];
  let notifications = 0;
  bar.subscribe(() => notifications++);
  bar.show({ message: 'x', durationMs: 0, onClose: (reason) => reasons.push(reason) });
  assert.equal(bar.current, bar.current, 'useSyncExternalStore için aynı nesne');
  bar.flush();
  bar.flush();
  bar.dismiss(999);
  assert.deepEqual(reasons, ['flush']);
  assert.equal(notifications, 2);
});

// ---------------------------------------------------------------------------
// Kaydırarak eylem
// ---------------------------------------------------------------------------

const geometry = { actionsWidth: 96, rowWidth: 360, fullSwipe: true };

test('eksen kilidi: ilk 8 px karar vermez, baskın eksen kazanır', () => {
  assert.equal(lockAxis(4, 3), null);
  assert.equal(lockAxis(-20, 4), 'x');
  assert.equal(lockAxis(6, 20), 'y');
  assert.equal(lockAxis(10, 10), 'y', 'eşitlikte liste kaydırması');
});

test('satır sağa açılmaz; tam kaydırma kapalıyken direnç vardır', () => {
  assert.equal(swipeOffset(50, 0, geometry), 0);
  assert.equal(swipeOffset(-80, 0, geometry), -80);
  assert.equal(swipeOffset(-500, 0, geometry), -360);
  assert.equal(swipeOffset(-196, 0, { ...geometry, fullSwipe: false }), -121);
});

test('bırakınca: kapan, açık kal veya birincil eylem', () => {
  assert.equal(resolveSwipe(-20, 0, geometry), 'closed');
  assert.equal(resolveSwipe(-60, 0, geometry), 'open');
  assert.equal(resolveSwipe(-30, -0.6, geometry), 'open', 'hızlı kısa kaydırma açar');
  assert.equal(resolveSwipe(-90, 0.5, geometry), 'closed', 'geri savurma kapatır');
  assert.equal(resolveSwipe(-230, 0, geometry), 'full');
  assert.equal(resolveSwipe(-120, -1.4, geometry), 'full', 'hızlı uzun kaydırma');
  assert.equal(resolveSwipe(-230, 0, { ...geometry, fullSwipe: false }), 'open');
});

// ---------------------------------------------------------------------------
// Arama
// ---------------------------------------------------------------------------

test('Türkçe sadeleştirme: ı/i, ş, ç, ğ, ö, ü ve büyük İ', () => {
  assert.equal(foldSearchText('ÇELİK DİRSEK'), 'celik dirsek');
  assert.equal(foldSearchText('Işık  Şalter'), 'isik salter');
  assert.equal(foldSearchText('Göğüs ÜÇGEN'), 'gogus ucgen');
  assert.equal(foldSearchText('Café'), 'cafe');
});

test('sorgu sözcükleri herhangi bir sırada eşleşir', () => {
  const text = foldSearchText('PPR-C Dirsek 90° Ø25');
  assert.equal(matchesQuery(text, 'dirsek ppr'), true);
  assert.equal(matchesQuery(text, 'DİRSEK 25'), true);
  assert.equal(matchesQuery(text, 'dirsek 45'), false);
  assert.equal(matchesQuery(text, '   '), true);
});

test('arama dizini metni öğe başına bir kez sadeleştirir', () => {
  let folds = 0;
  const search = createSearchIndex((item) => {
    folds += 1;
    return item.name;
  });
  const items = Array.from({ length: 2000 }, (_, index) => ({
    name: index % 3 ? `Boru DN${index}` : `Çelik vana ${index}`,
  }));
  assert.equal(search(items, ''), items, 'boş sorgu aynı diziyi döner');
  assert.equal(search(items, 'celik').length, 667);
  search(items, 'celik van');
  search(items, 'celik vana 1');
  // Hız garantisi duvar saatiyle değil sayımla ölçülür: üç aramada da her öğe
  // yalnız bir kez sadeleştirilir. Önceki "150 ms altında" kontrolü testler
  // paralel koşarken makine yüküne göre rastgele düşüyordu (161 ms ölçüldü).
  assert.equal(folds, 2000);
});

// ---------------------------------------------------------------------------
// Sekmeler ve iç içe gezinme
// ---------------------------------------------------------------------------

test('her sekme kendi iç içe yığınını tutar; pop boş yığında false döner', () => {
  assert.equal(shellStore.getState().activeTab, START_TAB);
  shellActions.push({ screen: 'placement', params: { id: 'p1' } });
  shellActions.push({ screen: 'measurement', params: { id: 'm1' } });
  shellActions.setTab('library');
  shellActions.push({ screen: 'card', params: { id: 'c1' } });
  assert.equal(topRoute(shellStore.getState(), 'project').screen, 'measurement');
  assert.equal(topRoute(shellStore.getState(), 'library').screen, 'card');
  shellActions.replace({ screen: 'card', params: { id: 'c2' } });
  assert.equal(topRoute(shellStore.getState(), 'library').params.id, 'c2');
  assert.equal(shellActions.pop(), true);
  assert.equal(shellActions.pop(), false, 'kütüphane kökte');
  shellActions.setTab('project');
  shellActions.popToRoot();
  assert.equal(topRoute(shellStore.getState(), 'project'), null);
  shellActions.push({ screen: 'placement', params: { id: 'p2' } }, 'project');
  shellActions.resetStacks();
  assert.equal(topRoute(shellStore.getState(), 'project'), null);
});
