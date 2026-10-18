// Kart formunun saf mantığı: doğrulama, sunucu gövdesi (masaüstüyle aynı kurallar), varyant ve tür taslağı.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addVariant,
  applyDiameterPreset,
  applyFittingPreset,
  attributeControl,
  buildCardPayload,
  buildTypePayload,
  draftChanged,
  draftFromCard,
  dynamicAttributes,
  emptyCardDraft,
  emptyTypeDraft,
  firstError,
  hasErrors,
  parseDiameterList,
  removeVariant,
  setVariantMode,
  toggleAttributeKey,
  toggleId,
  updateVariant,
  validateCardDraft,
  validateTypeDraft,
} from '../src/mobile/screens/library/cardDraft.ts';
import { confirmationMatches, CLEAR_PROJECTS_PHRASE } from '../src/mobile/screens/library/shared/confirmText.ts';

const code = () => 'KART-1';
const baseCard = {
  id: 'c1',
  latestVersionId: 'v1',
  code: 'STD-X',
  name: 'Siyah boru',
  cardType: 'Material',
  unit: 'm',
  inputBehavior: 'Derived',
  salesConversion: 'Package',
  reportBehavior: 'Auxiliary',
  wasteRatePct: 5,
  containerParameter: 12,
  positionNumber: '15.100',
  latestVersion: 3,
  isActive: true,
  materialType: 'Siyah çelik',
  notes: 'not',
  variantMode: 'None',
  variants: [],
  attributeValues: {},
};

test('yeni kart taslağı varsayılanları ve doğrulama', () => {
  const draft = emptyCardDraft();
  assert.deepEqual(validateCardDraft(draft), { name: 'Kart adı gerekli.' });
  const ok = { ...draft, name: 'Vana' };
  assert.equal(hasErrors(validateCardDraft(ok)), false);
  assert.equal(firstError(validateCardDraft({ ...ok, name: ' ', unit: '' })), 'Kart adı gerekli.');
});

test('fire payı: virgül kabul edilir, negatif ve sayı olmayan reddedilir, boş sıfırdır', () => {
  const draft = { ...emptyCardDraft(), name: 'A' };
  assert.equal(validateCardDraft({ ...draft, wasteRatePct: '2,5' }).wasteRatePct, undefined);
  assert.equal(validateCardDraft({ ...draft, wasteRatePct: '' }).wasteRatePct, undefined);
  assert.match(validateCardDraft({ ...draft, wasteRatePct: '-1' }).wasteRatePct, /sıfır ya da daha büyük/);
  assert.match(validateCardDraft({ ...draft, wasteRatePct: 'abc' }).wasteRatePct, /sıfır ya da daha büyük/);
});

test('boru/fitting kartlarında varyant kuralları sunucuyla aynı', () => {
  const pipe = setVariantMode({ ...emptyCardDraft(), name: 'Boru' }, 'Pipe');
  assert.equal(pipe.unit, 'm');
  assert.match(validateCardDraft(pipe).variants, /en az bir çeşit/i);
  const withRow = addVariant(pipe);
  assert.equal(validateCardDraft(withRow).variants, undefined);
  assert.match(
    validateCardDraft(updateVariant(withRow, 0, { standardLength: null })).variants,
    /sıfırdan büyük bir boy/,
  );
  assert.match(validateCardDraft(updateVariant(withRow, 0, { code: ' ' })).variants, /kodunu ve adını/);
  const fitting = setVariantMode({ ...emptyCardDraft(), name: 'F' }, 'Fitting');
  assert.equal(fitting.unit, 'adet');
  assert.equal(validateCardDraft(addVariant(fitting)).variants, undefined, 'fittingde boy gerekmez');
  assert.deepEqual(setVariantMode(withRow, 'None').variants, [], 'standart kipte varyantlar atılır');
});

test('hazır şablonlar ve varyant satırı dönüşümleri taslağı değiştirmez (saf)', () => {
  const draft = emptyCardDraft();
  const steel = applyDiameterPreset(draft, 'steel');
  assert.equal(draft.variants.length, 0);
  assert.equal(steel.variantMode, 'Pipe');
  assert.equal(steel.variants[0].code, 'DN15');
  assert.equal(applyDiameterPreset(draft, 'pprc').variants[0].code, 'DN16');
  assert.ok(applyFittingPreset(draft).variants.some((v) => v.code === 'TEE'));
  const removed = removeVariant(steel, 0);
  assert.equal(removed.variants.length, steel.variants.length - 1);
  assert.equal(steel.variants[0].code, 'DN15');
  // Şablon satırı değiştirmek ortak sabit diziyi bozmamalı.
  updateVariant(steel, 1, { label: 'x' });
  assert.notEqual(applyDiameterPreset(draft, 'steel').variants[1].label, 'x');
});

test('uyumlu çap listesi virgülle ayrılır', () => {
  assert.deepEqual(parseDiameterList('DN25, DN32 ,, '), ['DN25', 'DN32']);
  assert.deepEqual(parseDiameterList(''), []);
});

test('düzenleme gövdesi, formda gösterilmeyen alanları korur', () => {
  const draft = { ...draftFromCard(baseCard), name: 'Siyah boru (yeni ad)' };
  const payload = buildCardPayload(draft, [], code);
  assert.equal(payload.code, 'STD-X');
  assert.equal(payload.name, 'Siyah boru (yeni ad)');
  assert.equal(payload.inputBehavior, 'Derived');
  assert.equal(payload.salesConversion, 'Package');
  assert.equal(payload.reportBehavior, 'Auxiliary');
  assert.equal(payload.positionNumber, '15.100');
  assert.equal(payload.containerParameter, 12);
  assert.equal(payload.wasteRatePct, 5);
});

test('tür veya varyant davranışı değişince ilgili alanlar yeniden türetilir', () => {
  const edited = draftFromCard(baseCard);
  const toCategory = buildCardPayload({ ...edited, type: 'Category' }, [], code);
  assert.equal(toCategory.reportBehavior, 'Folder');
  const toPipe = buildCardPayload(applyDiameterPreset(edited, 'steel'), [], code);
  assert.equal(toPipe.salesConversion, 'StandardLength');
  assert.equal(toPipe.containerParameter, 6);
  const noLongerPipe = buildCardPayload(
    {
      ...draftFromCard({
        ...baseCard,
        variantMode: 'Pipe',
        variants: [{ code: 'DN', label: 'DN', standardLength: 6 }],
      }),
      variantMode: 'None',
      variants: [],
    },
    [],
    code,
  );
  assert.equal(noLongerPipe.salesConversion, 'None');
  assert.equal(noLongerPipe.containerParameter, null);
});

test('yeni kartta kod boşsa üretilir; ad ve not kırpılır, boş metinler null olur', () => {
  const payload = buildCardPayload({ ...emptyCardDraft(), name: '  Vana ', notes: '  ', materialType: ' ' }, [], code);
  assert.equal(payload.code, 'KART-1');
  assert.equal(payload.name, 'Vana');
  assert.equal(payload.notes, null);
  assert.equal(payload.materialType, null);
  assert.equal(payload.reportBehavior, 'Measurable');
  assert.equal(payload.attributeValues, null);
  assert.equal(buildCardPayload({ ...emptyCardDraft(), name: 'K', type: 'Scope' }, [], code).reportBehavior, 'Folder');
});

test('özel tür: temel tür türden gelir, açık alanlar niteliklere yazılır', () => {
  const type = {
    id: 't1',
    code: 'R',
    name: 'Radyatör',
    baseCardType: 'Accessory',
    isActive: true,
    allowedParentCardIds: [],
    allowedChildCardIds: [],
    attributeKeys: ['Notes', 'MaterialType', 'WasteRatePct', 'Brand'],
  };
  const draft = {
    ...emptyCardDraft(),
    name: 'R1',
    customTypeId: 't1',
    notes: 'n',
    materialType: 'm',
    wasteRatePct: '3',
    attributeValues: { Brand: 'X' },
  };
  const payload = buildCardPayload(draft, [type], code);
  assert.equal(payload.cardType, 'Accessory');
  assert.equal(payload.customTypeId, 't1');
  assert.deepEqual(payload.attributeValues, { Brand: 'X', Notes: 'n', MaterialType: 'm', WasteRatePct: '3' });
  // Kapalı alanlar niteliklerden silinir.
  const cleared = buildCardPayload({ ...draft, notes: '' }, [type], code);
  assert.equal('Notes' in cleared.attributeValues, false);
});

test('dinamik nitelikler: türün açtıkları, ayrıca çizilenler hariç', () => {
  const attributes = ['Code', 'Name', 'Notes', 'ItemKind', 'WasteRatePct', 'Brand', 'ContainerParameter'].map(
    (key) => ({
      key,
      label: key,
      description: '',
      isRequired: false,
    }),
  );
  const type = { attributeKeys: ['code', 'notes', 'itemkind', 'brand', 'containerparameter'] };
  assert.deepEqual(
    dynamicAttributes(attributes, type).map((a) => a.key),
    ['ItemKind', 'Brand', 'ContainerParameter'],
  );
  assert.deepEqual(dynamicAttributes(attributes, null), []);
  assert.equal(attributeControl('Notes').kind, 'textarea');
  assert.equal(attributeControl('ItemKind').kind, 'select');
  assert.equal(attributeControl('ContainerParameter').kind, 'decimal');
  assert.equal(attributeControl('Brand').kind, 'text');
});

test('taslak değişti mi: yalnız gerçek farkta true', () => {
  const initial = draftFromCard(baseCard);
  assert.equal(draftChanged(initial, draftFromCard(baseCard)), false);
  assert.equal(draftChanged(initial, { ...initial, name: 'x' }), true);
});

test('tür formu: doğrulama, gövde, işaretleme kuralları', () => {
  assert.deepEqual(Object.keys(validateTypeDraft(emptyTypeDraft())).sort(), ['code', 'name']);
  const draft = { ...emptyTypeDraft(), code: ' RAD ', name: ' Panel ', description: ' ', parentCardIds: ['a'] };
  assert.equal(Object.keys(validateTypeDraft(draft)).length, 0);
  assert.deepEqual(buildTypePayload(draft), {
    code: 'RAD',
    name: 'Panel',
    baseCardType: 'Material',
    allowedParentCardIds: ['a'],
    allowedChildCardIds: [],
    attributeKeys: [],
    description: null,
  });
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleAttributeKey(['Code'], { key: 'Code', isRequired: true }), ['Code'], 'zorunlu kapatılamaz');
  assert.deepEqual(toggleAttributeKey([], { key: 'Brand', isRequired: false }), ['Brand']);
});

test('yazarak onay: Türkçe duyarlı, noktalı/noktasız i ve boşluk farkını yok sayar', () => {
  for (const typed of ['TEMİZLE', 'temizle', 'Temizle', 'TEMIZLE', ' temizle ', 'te mizle'])
    assert.equal(confirmationMatches(typed, CLEAR_PROJECTS_PHRASE), true, typed);
  for (const typed of ['', '   ', 'temizl', 'temizlee', 'evet', 'sil'])
    assert.equal(confirmationMatches(typed, CLEAR_PROJECTS_PHRASE), false, JSON.stringify(typed));
});
