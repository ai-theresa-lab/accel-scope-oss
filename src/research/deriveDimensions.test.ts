// Unit tests for the pure parse step of the derive-dimensions stage. These lock in the
// two safety invariants (keys reassigned in code; dimensions without a playbook dropped)
// without invoking an LLM. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDerivedResponse } from './deriveDimensions.ts';

const fence = (obj: unknown) => '```json\n' + JSON.stringify(obj) + '\n```';

test('keys are reassigned u1..uN, never trusting the agent numbering', () => {
  const { dimensions } = parseDerivedResponse(fence({
    dimensions: [
      { key: 'i1', title: 'A', aim: 'a', playbook: 'p' },   // collides with a built-in
      { key: 'u9', title: 'B', aim: 'b', playbook: 'p' },   // skips
      { key: 'whatever', title: 'C', aim: 'c', playbook: 'p' },
    ],
  }));
  assert.deepEqual(dimensions.map((d) => d.key), ['u1', 'u2', 'u3']);
  assert.ok(dimensions.every((d) => d.origin === 'user'));
});

test('dimensions missing the isomorphic core (title/aim/playbook) are dropped', () => {
  const { dimensions } = parseDerivedResponse(fence({
    dimensions: [
      { title: 'has all', aim: 'a', playbook: 'p' },
      { title: 'no playbook', aim: 'a' },                   // dropped
      { title: '', aim: 'a', playbook: 'p' },               // blank title → dropped
      { aim: 'a', playbook: 'p' },                          // no title → dropped
      { title: 'blank playbook', aim: 'a', playbook: '   ' }, // whitespace → dropped
    ],
  }));
  assert.equal(dimensions.length, 1);
  assert.equal(dimensions[0].key, 'u1');
  assert.equal(dimensions[0].title, 'has all');
});

test('evidenceable defaults true and only false when explicitly false', () => {
  const { dimensions } = parseDerivedResponse(fence({
    dimensions: [
      { title: 'A', aim: 'a', playbook: 'p' },                       // default → true
      { title: 'B', aim: 'b', playbook: 'p', evidenceable: false },  // explicit false
      { title: 'C', aim: 'c', playbook: 'p', evidenceable: 'no' },   // non-bool → true (only literal false flips it)
    ],
  }));
  assert.deepEqual(dimensions.map((d) => d.evidenceable), [true, false, true]);
});

test('coverage is filtered to well-formed notes', () => {
  const { coverage } = parseDerivedResponse(fence({
    coverage: [
      { concern: 'x', status: 'covered', invariant: 'i1' },
      { concern: 'y', status: 'residue' },
      { concern: 'z', status: 'bogus' },   // bad status → dropped
      { status: 'covered' },               // no concern → dropped
    ],
  }));
  assert.deepEqual(coverage.map((c) => c.status), ['covered', 'residue']);
});

test('fail-open: non-JSON / empty text yields empty arrays', () => {
  for (const t of ['', 'no json here', '```json\n{not valid}\n```']) {
    const r = parseDerivedResponse(t);
    assert.deepEqual(r.dimensions, []);
    assert.deepEqual(r.coverage, []);
  }
});
