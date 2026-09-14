// Run from src/Metraj.Web with Node 24: node --test tests/layout-and-choices.test.mjs
// Import the real helpers; flow.ts resolves @xyflow/react from the web project.
import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeFlowNodes, nodeSize } from '../src/lib/flow.ts';
import { diameterCode, fittingChoices } from '../src/lib/fittingChoices.ts';

const variant = (code, extra = {}) => ({ code, label: code, ...extra });
const placement = (id, extra = {}) => ({ id, variantMode: 'None', ...extra });
const node = (id, parentPlacementId, measured, extra = {}) => ({
  id,
  type: 'placement',
  position: { x: -100, y: -100 },
  data: placement(id, { parentPlacementId, ...extra }),
  ...(measured ? { measured } : {}),
});
const measurement = (placementId, variant, extra = {}) => ({ placementId, variant, ...extra });
const codes = (variants) => variants.map((item) => item.code);
const byId = (nodes, id) => nodes.find((item) => item.id === id);

function assertSeparated(nodes) {
  for (const current of nodes) {
    assert.ok(Number.isFinite(current.position.x), `${current.id}: finite x`);
    assert.ok(Number.isFinite(current.position.y), `${current.id}: finite y`);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (const right of nodes.slice(i + 1)) {
      const left = nodes[i];
      const a = nodeSize(left);
      const b = nodeSize(right);
      assert.ok(
        left.position.x + a.width <= right.position.x ||
          right.position.x + b.width <= left.position.x ||
          left.position.y + a.height <= right.position.y ||
          right.position.y + b.height <= left.position.y,
        `${left.id} overlaps ${right.id}`,
      );
    }
  }
}

test('measured dimensions override expansion estimates, independently per axis', () => {
  const fitting = { expanded: true, variantMode: 'Fitting' };
  assert.deepEqual(nodeSize(node('fit', null, { width: 530, height: 810 }, fitting)), { width: 530, height: 810 });
  assert.deepEqual(nodeSize(node('fit', null, { width: 530 }, fitting)), { width: 530, height: 320 });
  assert.deepEqual(nodeSize(node('fit', null, { height: 810 }, fitting)), { width: 410, height: 810 });
  assert.deepEqual(nodeSize(node('closed')), { width: 240, height: 156 });
});

test('each depth reserves the widest measured card before placing its children', () => {
  const arranged = arrangeFlowNodes([
    node('root', null, { width: 640, height: 180 }),
    node('narrow', 'root', { width: 120, height: 100 }),
    node('wide', 'root', { width: 790, height: 300 }),
    node('grandchild', 'narrow', { width: 150, height: 100 }),
  ]);
  assertSeparated(arranged);
  assert.ok(byId(arranged, 'narrow').position.x >= 640 + 88);
  assert.equal(byId(arranged, 'narrow').position.x, byId(arranged, 'wide').position.x);
  assert.ok(byId(arranged, 'grandchild').position.x >= byId(arranged, 'wide').position.x + 790 + 88);
});

test('a tall parent reserves its height even when its children are short', () => {
  const arranged = arrangeFlowNodes([
    node('tall', null, { width: 260, height: 1000 }),
    node('child-a', 'tall', { width: 240, height: 100 }),
    node('child-b', 'tall', { width: 240, height: 120 }),
    node('next-root', null, { width: 260, height: 200 }),
    node('next-child', 'next-root', { width: 240, height: 100 }),
  ]);
  assertSeparated(arranged);
  const parent = byId(arranged, 'tall');
  const first = byId(arranged, 'child-a');
  const last = byId(arranged, 'child-b');
  assert.equal((first.position.y + last.position.y + nodeSize(last).height) / 2, parent.position.y + 500);
  assert.ok(byId(arranged, 'next-root').position.y >= parent.position.y + 1000 + 36);
});

test('tall siblings and expanded descendant branches reserve disjoint vertical spans', () => {
  const arranged = arrangeFlowNodes([
    node('root', null, { width: 240, height: 180 }),
    node('branch-a', 'root', { width: 300, height: 850 }, { expanded: true }),
    node('branch-b', 'root', { width: 300, height: 700 }, { expanded: true }),
    node('a-1', 'branch-a', { width: 480, height: 620 }, { expanded: true, variantMode: 'Fitting' }),
    node('a-2', 'branch-a', { width: 410, height: 540 }, { expanded: true, variantMode: 'Fitting' }),
    node('b-1', 'branch-b', { width: 410, height: 1300 }, { expanded: true, variantMode: 'Fitting' }),
  ]);
  assertSeparated(arranged);
  const endA = Math.max(...arranged.filter((item) => ['branch-a', 'a-1', 'a-2'].includes(item.id))
    .map((item) => item.position.y + nodeSize(item).height));
  const startB = Math.min(...arranged.filter((item) => ['branch-b', 'b-1'].includes(item.id))
    .map((item) => item.position.y));
  assert.ok(startB >= endA + 36, 'the next branch must clear the entire preceding subtree');
});

test('empty, orphaned and cyclic graphs retain every node without overlaps', () => {
  assert.deepEqual(arrangeFlowNodes([]), []);
  const input = [
    node('a', 'b'), node('b', 'a'), node('self', 'self'),
    node('orphan', 'missing'), node('child', 'a'),
  ];
  const arranged = arrangeFlowNodes(input);
  assert.deepEqual(arranged.map((item) => item.id), input.map((item) => item.id));
  assertSeparated(arranged);
});

test('deep ancestry exceeding the layout guard still positions every descendant', () => {
  const input = Array.from({ length: 70 }, (_, index) => node(String(index), index ? String(index - 1) : null));
  const arranged = arrangeFlowNodes(input);
  assert.equal(arranged.length, 70);
  assertSeparated(arranged);
});

test('non-colliding remembered positions survive and inputs remain unchanged', () => {
  const input = [node('root'), node('child', 'root')];
  const before = structuredClone(input);
  const preferred = new Map([['root', { x: -430, y: -200 }], ['child', { x: 1200, y: 730 }]]);
  const preferredBefore = structuredClone(preferred);
  const arranged = arrangeFlowNodes(input, preferred);
  for (const item of arranged) assert.deepEqual(item.position, preferred.get(item.id));
  assert.deepEqual(input, before);
  assert.deepEqual(preferred, preferredBefore);
  const again = arrangeFlowNodes(arranged, preferred);
  assert.ok(again.every((item, index) => item === arranged[index]), 'unchanged nodes retain their identity');
});

test('growth repairs remembered collisions while retaining unaffected manual positions', () => {
  const preferred = new Map([
    ['a', { x: 50, y: 0 }], ['b', { x: 50, y: 220 }], ['far', { x: 1600, y: 60 }],
  ]);
  const small = arrangeFlowNodes([node('a'), node('b'), node('far')], preferred);
  assert.deepEqual(byId(small, 'b').position, preferred.get('b'));
  const grown = small.map((item) => item.id === 'a' ? { ...item, measured: { width: 520, height: 900 } } : item);
  const arranged = arrangeFlowNodes(grown, preferred);
  assertSeparated(arranged);
  assert.deepEqual(byId(arranged, 'a').position, preferred.get('a'));
  assert.deepEqual(byId(arranged, 'far').position, preferred.get('far'));
  assert.equal(byId(arranged, 'b').position.x, 50);
  assert.ok(byId(arranged, 'b').position.y >= 936);
  assert.deepEqual(arrangeFlowNodes(arranged, preferred), arranged, 'collision repair is stable');
});

function fittingScenario(pipeExtra = {}, fittingExtra = {}) {
  const pipe = placement('pipe', {
    variantMode: 'Pipe', pipeSystem: 'water.ppr',
    variants: [variant('DN20'), variant('DN25')], ...pipeExtra,
  });
  const fitting = placement('fitting', {
    variantMode: 'Fitting', parentPlacementId: pipe.id,
    variants: [variant('elbow', { compatibleDiameters: ['DN20', 'DN25'], compatiblePipeSystems: ['water.ppr'] })],
    ...fittingExtra,
  });
  return { pipe, fitting, placements: [pipe, fitting] };
}

test('fitting uses the nearest pipe ancestor and only that pipe’s entered dimensions', () => {
  const { pipe, fitting } = fittingScenario({}, { parentPlacementId: 'group' });
  const group = placement('group', { parentPlacementId: pipe.id });
  const outer = placement('outer', { variantMode: 'Pipe', variants: [variant('DN50')] });
  pipe.parentPlacementId = outer.id;
  const choices = fittingChoices(fitting, [outer, pipe, group, fitting], [
    measurement(outer.id, 'DN50'), measurement(pipe.id, 'DN25'), measurement('other', 'DN20'),
  ]);
  assert.equal(choices.parentPipe, pipe);
  assert.deepEqual(codes(choices.diameters), ['DN25']);
  assert.equal(choices.entered.length, 1);
  assert.equal(choices.filtered, true);
});

test('canonical sourceVariantCode matches fitting dimensions while preserving the family option code', () => {
  const profile = variant('PPR-STABI-DN25', { label: 'Stabil boru · 25 mm', sourceVariantCode: 'DN25' });
  const { pipe, fitting, placements } = fittingScenario({ variants: [profile] });
  const choices = fittingChoices(fitting, placements, [measurement(pipe.id, profile.code)]);
  assert.equal(diameterCode(profile), 'DN25');
  assert.equal(diameterCode(variant('DN20')), 'DN20');
  assert.equal(diameterCode(variant('DN20', { sourceVariantCode: '' })), 'DN20');
  assert.deepEqual(codes(choices.diameters), [profile.code]);
  assert.deepEqual(codes(choices.compatibleVariants(profile)), ['elbow']);
});

test('entered profile labels match case-insensitively with surrounding whitespace', () => {
  const { pipe, fitting, placements } = fittingScenario({ variants: [variant('DN20'), variant('DN25', { label: '25 mm' })] });
  assert.deepEqual(codes(fittingChoices(fitting, placements, [measurement(pipe.id, ' 25 MM ')]).diameters), ['DN25']);
});

test('before measurements, show only declared parent dimensions with compatible options', () => {
  const { fitting, placements } = fittingScenario({ variants: [variant('DN20'), variant('DN25'), variant('DN99')] });
  const choices = fittingChoices(fitting, placements, []);
  assert.deepEqual(codes(choices.diameters), ['DN20', 'DN25']);
  assert.equal(choices.filtered, false);
});

test('equal nominal dimensions do not make different pipe material systems compatible', () => {
  const { fitting, placements } = fittingScenario({}, {
    variants: [
      variant('ppr', { compatibleDiameters: ['DN25'], compatiblePipeSystems: ['water.ppr'] }),
      variant('steel', { compatibleDiameters: ['DN25'], compatiblePipeSystems: ['water.steel'] }),
      variant('drain', { compatibleDiameters: ['DN25'], compatiblePipeSystems: ['drain.pvc'] }),
    ],
  });
  const choices = fittingChoices(fitting, placements, []);
  assert.deepEqual(codes(choices.diameters), ['DN25']);
  assert.deepEqual(codes(choices.compatibleVariants(choices.diameters[0])), ['ppr']);
});

test('material-system mismatch produces no choices rather than a fallback diameter list', () => {
  const { fitting, placements } = fittingScenario({ pipeSystem: 'drain.pvc' });
  assert.deepEqual(fittingChoices(fitting, placements, []).diameters, []);
});

test('unknown or incompatible measured dimensions do not fall back to unmeasured sizes', () => {
  const { pipe, fitting, placements } = fittingScenario();
  assert.deepEqual(fittingChoices(fitting, placements, [measurement(pipe.id, 'DN999')]).diameters, []);
  fitting.variants = [variant('elbow', { compatibleDiameters: ['DN20'] })];
  assert.deepEqual(fittingChoices(fitting, placements, [measurement(pipe.id, 'DN25')]).diameters, []);
});

test('standalone accessories expose actual options without fabricated steel dimensions or presets', () => {
  const fitting = placement('kit', { variantMode: 'Fitting', variants: [variant('seal'), variant('bracket')] });
  const choices = fittingChoices(fitting, [fitting], []);
  assert.equal(choices.dimensional, false);
  assert.deepEqual(codes(choices.diameters), ['GENEL']);
  assert.deepEqual(codes(choices.compatibleVariants(choices.diameters[0])), ['seal', 'bracket']);
  const empty = placement('empty', { variantMode: 'Fitting' });
  const emptyChoices = fittingChoices(empty, [empty], []);
  assert.deepEqual(emptyChoices.compatibleVariants(emptyChoices.diameters[0]), []);
});

test('standalone dimensional fittings derive sizes exclusively from their declared compatibility', () => {
  const fitting = placement('fit', { variantMode: 'Fitting', variants: [
    variant('elbow', { compatibleDiameters: ['OD63', 'OD75'] }),
    variant('tee', { compatibleDiameters: ['OD75'] }),
  ] });
  const choices = fittingChoices(fitting, [fitting], []);
  assert.equal(choices.dimensional, true);
  assert.deepEqual(codes(choices.diameters), ['OD63', 'OD75']);
  assert.deepEqual(codes(choices.compatibleVariants(choices.diameters[0])), ['elbow']);
});

test('fitting ancestor cycles terminate without inventing a pipe parent', () => {
  const fitting = placement('fit', { variantMode: 'Fitting', parentPlacementId: 'group', variants: [variant('seal')] });
  const group = placement('group', { parentPlacementId: fitting.id });
  const choices = fittingChoices(fitting, [fitting, group], []);
  assert.equal(choices.parentPipe, undefined);
  assert.deepEqual(codes(choices.diameters), ['GENEL']);
});

test('legacy pipe measurements retain diameter filtering from their notes', () => {
  const { pipe, fitting, placements } = fittingScenario();
  const choices = fittingChoices(fitting, placements, [measurement(pipe.id, null, { notes: 'Çap: DN25 · eski ölçüm' })]);
  assert.deepEqual(codes(choices.diameters), ['DN25']);
  assert.equal(choices.entered.length, 1);
});

test('explicit wildcard system compatibility agrees with the catalog compatibility contract', () => {
  const { fitting, placements } = fittingScenario({}, {
    variants: [variant('universal-support', { compatibleDiameters: ['DN25'], compatiblePipeSystems: ['*'] })],
  });
  const choices = fittingChoices(fitting, placements, []);
  assert.deepEqual(codes(choices.diameters), ['DN25']);
});
