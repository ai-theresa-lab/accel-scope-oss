import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVARIANTS, RANKING_INVARIANTS, baselineFloorInvariants, DE_INVARIANTS, ANALYTICS_INVARIANTS, TS_INVARIANTS, SW_INVARIANTS, RE_INVARIANTS, AS_INVARIANTS, SC_INVARIANTS, MOBILE_IOS_INVARIANTS, MOBILE_ANDROID_INVARIANTS, BL_INVARIANTS } from './invariants.ts';

// the general invariants were consolidated 11→6 (owner-tagged) and the ranking pair i12+i13 merged into one.
// The always-on data-trust floor is now derived from the `owner==='baseline' && mount==='floor'` tags, not a key list.

test('the consolidated set: 6 general (folded keys retired) + 1 merged ranking invariant, correctly owned', () => {
  const keys = new Set(INVARIANTS.map((i) => i.key));
  assert.deepEqual(keys, new Set(['i1', 'i2', 'i4', 'i6', 'i9', 'i10']), 'i3/i5/i7/i8/i11 folded or dropped');
  // the five baseline-core + i10 owned by analytics
  const byKey = Object.fromEntries(INVARIANTS.map((i) => [i.key, i]));
  for (const k of ['i1', 'i2', 'i4', 'i6', 'i9']) { assert.equal(byKey[k].owner, 'baseline', `${k} owner`); assert.equal(byKey[k].mount, 'floor', `${k} floor`); }
  assert.equal(byKey['i10'].owner, 'analytics');
  assert.equal(byKey['i10'].mount, 'bundle');
  // ranking pair merged into one recsys-owned, gated
  assert.equal(RANKING_INVARIANTS.length, 1);
  assert.equal(RANKING_INVARIANTS[0].key, 'i12');
  assert.equal(RANKING_INVARIANTS[0].owner, 'recsys-mle');
  assert.equal(RANKING_INVARIANTS[0].mount, 'gated');
});

test('every domain-bundle structural invariant is owner-tagged + mount:bundle (self-describing, off the floor)', () => {
  const byOwner: [string, typeof DE_INVARIANTS][] = [
    ['data-eng', DE_INVARIANTS], ['analytics', ANALYTICS_INVARIANTS], ['trust-safety', TS_INVARIANTS],
    ['swe-arch', SW_INVARIANTS], ['release-eng', RE_INVARIANTS], ['api-stability', AS_INVARIANTS], ['appsec', SC_INVARIANTS],
    ['mobile-ios', MOBILE_IOS_INVARIANTS], ['mobile-android', MOBILE_ANDROID_INVARIANTS], ['product-logic', BL_INVARIANTS],
  ];
  for (const [owner, arr] of byOwner) {
    for (const i of arr) {
      assert.equal(i.owner, owner, `${i.key} owner`);
      assert.equal(i.mount, 'bundle', `${i.key} mount`);
    }
  }
  // and none of them leak into the always-on data-trust floor
  const floor = new Set(baselineFloorInvariants().map((i) => i.key));
  for (const [, arr] of byOwner) for (const i of arr) assert.ok(!floor.has(i.key), `${i.key} must not be on the floor`);
});

test('baselineFloorInvariants = the baseline-owned data-trust core (owner/mount driven)', () => {
  const prev = process.env.THERESA_BASELINE_MAX_INVARIANTS;
  delete process.env.THERESA_BASELINE_MAX_INVARIANTS;
  try {
    const f = baselineFloorInvariants();
    assert.deepEqual(f.map((i) => i.key), ['i1', 'i2', 'i4', 'i6', 'i9']);
    for (const i of f) { assert.equal(i.owner, 'baseline'); assert.equal(i.mount, 'floor'); }
    // never includes the analytics/ranking-owned ones
    assert.ok(!f.some((i) => i.key === 'i10' || i.key === 'i12'));
  } finally { if (prev === undefined) delete process.env.THERESA_BASELINE_MAX_INVARIANTS; else process.env.THERESA_BASELINE_MAX_INVARIANTS = prev; }
});

test('THERESA_BASELINE_MAX_INVARIANTS shrinks the floor; junk/oversized fall back to the full core', () => {
  const prev = process.env.THERESA_BASELINE_MAX_INVARIANTS;
  const coreN = INVARIANTS.filter((i) => i.owner === 'baseline' && i.mount === 'floor').length;
  try {
    process.env.THERESA_BASELINE_MAX_INVARIANTS = '3';
    assert.equal(baselineFloorInvariants().length, 3);
    process.env.THERESA_BASELINE_MAX_INVARIANTS = '99';
    assert.equal(baselineFloorInvariants().length, coreN, 'oversized clamps to the core size');
    process.env.THERESA_BASELINE_MAX_INVARIANTS = 'nonsense';
    assert.equal(baselineFloorInvariants().length, coreN, 'junk → full core');
    process.env.THERESA_BASELINE_MAX_INVARIANTS = '0';
    assert.equal(baselineFloorInvariants().length, coreN, '0/negative → full core');
  } finally { if (prev === undefined) delete process.env.THERESA_BASELINE_MAX_INVARIANTS; else process.env.THERESA_BASELINE_MAX_INVARIANTS = prev; }
});
