import assert from 'node:assert/strict';
import test from 'node:test';
import { isRadiatorPlacement } from '../src/lib/format.ts';
import {
  activeRadiatorDraft, canonicalRadiatorType, catalogRadiatorSize, clearActiveRadiatorCounts,
  initialRadiatorGroups, legacyRadiatorCounts, mergeRadiatorGroups, PANEL_HEIGHTS, PANEL_LENGTHS, radiatorDimension,
  radiatorGroupKey, radiatorMeasurementRows, radiatorSizeKey, radiatorTypeLabel, readRadiatorDraft,
} from '../src/lib/radiatorChoices.ts';

const placement = { cardCode: 'STD-EQ-RADIATOR', cardName: 'Panel Radyatör', displayName: 'Özel isim', cardType: 'Material', variants: [] };
const group = { type: 'Tip 22', height: '600', lengths: ['1000', '1200'] };
const size = (length, extra = {}) => ({ type: 'Tip 22', height: '600', length, ...extra });
const draft = (groups, values) => ({ groups, active: radiatorGroupKey(groups[0]), counts: Object.fromEntries(values.map(([item, count]) => [radiatorSizeKey(item), count])) });

test('radiators use the height picker even when catalog variant mode is Fitting; accessories do not', () => {
  for (const code of ['STD-EQ-RADIATOR', 'STDX-ISI-PANEL-RAD-TIP', 'STDX-ISI-DOKUM-RAD-DILIM', 'STDX-ISI-ALU-RAD-DILIM', 'STDX-ISI-HAVLUPAN']) {
    assert.equal(isRadiatorPlacement({ ...placement, cardCode: code, variantMode: 'Fitting' }), true);
  }
  assert.equal(isRadiatorPlacement({ ...placement, cardCode: 'CUSTOM', cardName: 'Petek', displayName: 'Petek' }), true);
  assert.equal(isRadiatorPlacement({ ...placement, cardCode: 'STDX-ISI-RAD-DONUS-VANA', cardName: 'Radyatör dönüş vanası' }), false);
  assert.equal(isRadiatorPlacement({ ...placement, cardType: 'Accessory' }), false);
  assert.equal(isRadiatorPlacement({ ...placement, cardType: 'System' }), false);
});

test('panel types and manufacturer-backed heights/lengths are ready without manual entry', () => {
  const groups = initialRadiatorGroups({ ...placement, variants: [{ code: 'T22-500-1000' }, { code: 'T22-600-1200' }, { code: 'T33-500-1000' }] }, []);
  for (const type of ['Tip 10', 'Tip 11', 'Tip 21', 'Tip 22', 'Tip 33']) {
    assert.deepEqual(groups.filter((group) => group.type === type).map((group) => group.height), PANEL_HEIGHTS);
    assert.deepEqual(groups.find((group) => group.type === type && group.height === '600').lengths, PANEL_LENGTHS);
  }
  assert.equal(PANEL_LENGTHS[0], '300');
  assert.equal(PANEL_LENGTHS.at(-1), '3000');
  assert.deepEqual(catalogRadiatorSize('HP-ELEKTRIKLI-600-800'), { type: 'Elektrikli havlupan', height: '800', length: '600' });
});

test('panel presets never leak into towel or sectional radiator cards', () => {
  const towel = initialRadiatorGroups({ ...placement, cardCode: 'STDF-ISI-HAVLUPAN', cardName: 'Havlupan', variants: [{ code: 'HP-500-800' }] }, []);
  assert.deepEqual(towel, [{ type: 'Havlupan', height: '800', lengths: ['500'] }]);
});

test('type, height and length all distinguish submitted quantities across groups', () => {
  const groups = [group, { ...group, height: '500' }, { ...group, type: 'Tip 33' }];
  const pending = draft(groups, [[size('1000'), 2], [size('1200'), 3], [size('1000', { height: '500' }), 4], [size('1000', { type: 'Tip 33' }), 5]]);
  const rows = radiatorMeasurementRows(pending, placement, []);
  assert.equal(rows.length, 4);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 14);
  assert.equal(new Set(rows.map((row) => `${row.variant}/${row.secondaryVariant}`)).size, 4);
});

test('Enter submits and clears only the selected type and height; all other counters remain pending', () => {
  const groups = [group, { ...group, height: '500' }, { ...group, type: 'Tip 33' }];
  const pending = draft(groups, [[size('1000'), 2], [size('1200'), 3], [size('1000', { height: '500' }), 4], [size('1000', { type: 'Tip 33' }), 5]]);
  const rows = radiatorMeasurementRows(activeRadiatorDraft(pending), placement, []);
  assert.deepEqual(rows.map((row) => row.quantity), [2, 3]);
  const cleared = clearActiveRadiatorCounts(pending);
  assert.equal(cleared.counts[radiatorSizeKey(size('1000', { height: '500' }))], 4);
  assert.equal(cleared.counts[radiatorSizeKey(size('1000', { type: 'Tip 33' }))], 5);
  assert.equal(Object.values(cleared.counts).reduce((sum, count) => sum + count, 0), 9);
  assert.equal(cleared.active, pending.active);
  assert.equal(Object.values(pending.counts).reduce((sum, count) => sum + count, 0), 14);
});

test('type aliases share counters but an unspecified Panel stays distinct', () => {
  for (const [alias, type] of [['PKP', 'Tip 21'], ['pkkp', 'Tip 22'], ['PKKPKP', 'Tip 33'], ['DKEK', 'Tip 33'], ['PK', 'Tip 11'], ['P', 'Tip 10']]) {
    assert.equal(canonicalRadiatorType(alias), type);
    assert.equal(radiatorSizeKey(size('1000', { type: alias })), radiatorSizeKey(size('1000', { type })));
  }
  const saved = readRadiatorDraft(JSON.stringify({ active: '["PKKP","600"]', groups: [{ type: 'PKKP', height: '600', lengths: ['1000'] }], counts: { '["PKKP","600","1000"]': 5 } }));
  assert.equal(saved.counts[radiatorSizeKey(size('1000'))], 5);
  assert.equal(saved.active, radiatorGroupKey(group));
  assert.equal(canonicalRadiatorType('Panel'), 'Panel');
  assert.equal(radiatorTypeLabel('Tip 33'), 'PKKPKP · Tip 33');
});

test('existing measurements keep their exact identities and catalog choices keep their original codes', () => {
  const pending = draft([group], [[size('1200'), 2]]);
  const catalog = { ...placement, variants: [{ code: 'T22-600-1200' }] };
  assert.deepEqual(radiatorMeasurementRows(pending, catalog, []).map(({ variant, secondaryVariant }) => [variant, secondaryVariant]), [[null, 'T22-600-1200']]);
  const old = [{ variant: 'Tip 22 · H600', secondaryVariant: 'W1200' }];
  assert.equal(radiatorMeasurementRows(pending, catalog, old)[0].variant, old[0].variant);
  assert.equal(radiatorMeasurementRows(pending, catalog, old)[0].secondaryVariant, 'W1200');
});

test('sectional radiators count sections without inventing a length', () => {
  const sectional = { ...placement, cardCode: 'STDX-ISI-DOKUM-RAD-DILIM', variants: [{ code: 'DR-600' }] };
  const groups = initialRadiatorGroups(sectional, []);
  const rows = radiatorMeasurementRows(draft(groups, [[{ type: 'Döküm', height: '600', length: '' }, 12]]), sectional, []);
  assert.equal(rows[0].quantity, 12);
  assert.equal(rows[0].secondaryVariant, 'DR-600');
  assert.match(rows[0].notes, /Birim: dilim/);
});

test('custom dimensions normalize decimal commas; invalid dimensions and quantities do not reach measurement rows', () => {
  assert.equal(radiatorDimension(' 0600,5 '), '600.5');
  for (const value of ['', '0', '-100', 'Infinity', 'NaN', '1e3', '100001', '600 mm']) assert.equal(radiatorDimension(value), '');
  const saved = readRadiatorDraft(JSON.stringify(draft([group], [[size('1000'), -2], [size('1200'), 1.5]])));
  assert.deepEqual(saved.counts, {});
  assert.equal(readRadiatorDraft('{bad'), null);
  assert.equal(readRadiatorDraft('null'), null);
});

test('a draft survives serialization; reusable preferences carry sizes without quantities', () => {
  const pending = draft([group], [[size('1000'), 5]]);
  assert.deepEqual(readRadiatorDraft(JSON.stringify(pending)), pending);
  assert.deepEqual(readRadiatorDraft(JSON.stringify({ ...pending, counts: {} })).counts, {});
  assert.deepEqual(mergeRadiatorGroups([group], [{ ...group, lengths: ['1400', '1000'] }])[0].lengths, ['1000', '1200', '1400']);
});

test('pending fitting counts migrate across boxes without changing catalog dimensions', () => {
  const counts = legacyRadiatorCounts(JSON.stringify([
    { countsByDiameter: { GENEL: { 'T22-600-1200': 2, 'T11-500-1000': 3 } } },
    { counts: { 'T22-600-1200': 4, INVALID: 9, 'T22-300-800': -1 } },
  ]));
  assert.equal(counts[radiatorSizeKey(size('1200'))], 6);
  assert.equal(counts[radiatorSizeKey(size('1000', { type: 'Tip 11', height: '500' }))], 3);
  assert.equal(Object.keys(counts).length, 2);
  assert.deepEqual(legacyRadiatorCounts('broken'), {});
});
