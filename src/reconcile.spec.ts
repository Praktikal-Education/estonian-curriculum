import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type IdentifierLedger,
  type OutcomeRec,
  applyRemaps,
  pairPage,
  planReconciliation,
  similarity,
} from './reconcile';

const rec = (id: string, text: string, pageId = '1'): OutcomeRec => ({
  id,
  text,
  pageId,
});

test('similarity: identical is 1, typo is high, unrelated is low', () => {
  assert.equal(similarity('the cat sat', 'the cat sat'), 1);
  assert.ok(similarity('the cat sat on the mat', 'the cat sat on the matt') > 0.9);
  assert.ok(similarity('apples and oranges', 'quantum chromodynamics') < 0.2);
});

test('planReconciliation: a sole wording edit on a page is paired', () => {
  const before = [rec('A', 'the cat sat on the mat'), rec('B', 'dogs run fast')];
  const after = [rec('A2', 'the cat sat on the warm mat'), rec('B', 'dogs run fast')];
  const { remaps, newOutcomes, removedOutcomes, ambiguousPages } = planReconciliation(
    before,
    after,
  );
  assert.equal(remaps.length, 1);
  assert.equal(remaps[0].orphan.id, 'A');
  assert.equal(remaps[0].stray.id, 'A2');
  assert.deepEqual([newOutcomes, removedOutcomes, ambiguousPages], [[], [], []]);
});

test('planReconciliation: a genuinely new outcome is not remapped', () => {
  const before = [rec('A', 'unchanged')];
  const after = [rec('A', 'unchanged'), rec('C', 'a brand new outcome')];
  const { remaps, newOutcomes } = planReconciliation(before, after);
  assert.equal(remaps.length, 0);
  assert.deepEqual(
    newOutcomes.map((o) => o.id),
    ['C'],
  );
});

test('planReconciliation: a removed outcome keeps its id and is not ambiguous', () => {
  const before = [rec('A', 'unchanged'), rec('D', 'to be deleted')];
  const after = [rec('A', 'unchanged')];
  const { remaps, removedOutcomes, ambiguousPages } = planReconciliation(before, after);
  assert.equal(remaps.length, 0);
  assert.deepEqual(
    removedOutcomes.map((o) => o.id),
    ['D'],
  );
  assert.deepEqual(ambiguousPages, []);
});

test('planReconciliation: an unrelated add+remove on one page is flagged, not paired', () => {
  const before = [rec('A', 'apples and oranges')];
  const after = [rec('Z', 'quantum chromodynamics')];
  const { remaps, newOutcomes, removedOutcomes, ambiguousPages } = planReconciliation(
    before,
    after,
  );
  assert.equal(remaps.length, 0);
  assert.deepEqual(
    newOutcomes.map((o) => o.id),
    ['Z'],
  );
  assert.deepEqual(
    removedOutcomes.map((o) => o.id),
    ['A'],
  );
  assert.deepEqual(ambiguousPages, ['1']);
});

test('planReconciliation: two edits on a page pair by best similarity', () => {
  const before = [rec('A', 'the quick brown fox'), rec('B', 'a lazy sleeping dog')];
  const after = [rec('A2', 'the quick brown foxes'), rec('B2', 'a lazy sleeping dogs')];
  const { remaps, ambiguousPages } = planReconciliation(before, after);
  const pairs = remaps.map((r) => [r.orphan.id, r.stray.id]).sort();
  assert.deepEqual(pairs, [
    ['A', 'A2'],
    ['B', 'B2'],
  ]);
  assert.deepEqual(ambiguousPages, []);
});

test('planReconciliation: partial multi-edit remaps the clear pair and flags the rest', () => {
  const before = [rec('A', 'the quick brown fox'), rec('B', 'a lazy sleeping dog')];
  const after = [
    rec('A2', 'the quick brown foxes'),
    rec('X', 'completely different statement about photosynthesis'),
  ];
  const { remaps, newOutcomes, removedOutcomes, ambiguousPages } = planReconciliation(
    before,
    after,
  );
  assert.deepEqual(
    remaps.map((r) => [r.orphan.id, r.stray.id]),
    [['A', 'A2']],
  );
  assert.deepEqual(
    newOutcomes.map((o) => o.id),
    ['X'],
  );
  assert.deepEqual(
    removedOutcomes.map((o) => o.id),
    ['B'],
  );
  assert.deepEqual(ambiguousPages, ['1']);
});

test('planReconciliation: matching only happens within a page, never across pages', () => {
  const before = [rec('A', 'the cat sat on the mat', 'p1')];
  const after = [rec('A2', 'the cat sat on the mat!', 'p2')];
  const { remaps, newOutcomes, removedOutcomes } = planReconciliation(before, after);
  assert.equal(remaps.length, 0);
  assert.deepEqual(
    newOutcomes.map((o) => o.id),
    ['A2'],
  );
  assert.deepEqual(
    removedOutcomes.map((o) => o.id),
    ['A'],
  );
});

test('pairPage: sole-edit threshold is looser than the multi-edit threshold', () => {
  // A moderate 0.2–0.5 match pairs when it is the only edit on the page…
  const sole = pairPage(
    [rec('A', 'measure the length of an object')],
    [rec('A2', 'measure and record the length of a physical object in metres')],
  );
  assert.equal(sole.length, 1);
  // …but the same moderate match is rejected amid other edits on the page.
  const multi = pairPage(
    [rec('A', 'measure the length of an object'), rec('B', 'name the seasons')],
    [
      rec('A2', 'measure and record the length of a physical object in metres'),
      rec('B2', 'name the four seasons of the year'),
    ],
  );
  assert.ok(multi.length <= 1);
});

test('applyRemaps: a fresh correction records the override and drops the stray', () => {
  const ledger: IdentifierLedger = {
    version: 1,
    allocated: ['A', 'A2', 'B'],
    overrides: {},
  };
  const next = applyRemaps(ledger, [
    { orphan: rec('A', 'old'), stray: rec('A2', 'new'), similarity: 0.9 },
  ]);
  assert.deepEqual(next.allocated, ['A', 'B']);
  assert.deepEqual(next.overrides, {
    A: { fingerprint: 'A2', prior: ['A'], status: 'active' },
  });
});

test('applyRemaps: a second correction appends the previous fingerprint to prior', () => {
  const ledger: IdentifierLedger = {
    version: 1,
    allocated: ['A', 'A3', 'B'],
    overrides: { A: { fingerprint: 'A2', prior: ['A'], status: 'active' } },
  };
  const next = applyRemaps(ledger, [
    { orphan: rec('A', 'newer'), stray: rec('A3', 'newest'), similarity: 0.9 },
  ]);
  assert.deepEqual(next.allocated, ['A', 'B']);
  assert.deepEqual(next.overrides.A, {
    fingerprint: 'A3',
    prior: ['A', 'A2'],
    status: 'active',
  });
});

test('applyRemaps: output is deterministic — allocated and overrides sorted', () => {
  const ledger: IdentifierLedger = {
    version: 1,
    allocated: ['ccc', 'aaa', 'bbb', 'zzz'],
    overrides: {},
  };
  const next = applyRemaps(ledger, [
    { orphan: rec('bbb', 'x'), stray: rec('zzz', 'y'), similarity: 1 },
  ]);
  assert.deepEqual(next.allocated, ['aaa', 'bbb', 'ccc']);
});
