import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, R7_CODENAME_RE, R7_PLUMBING_RE, R7_SQL_RE, type Ledger } from './reportRubric.ts';
import type { Hypothesis } from './investigation.ts';

// minimal hypothesis fixture — only the fields buildLedger reads
const hyp = (id: string, value: number, sampleRows: string[], baseline?: string, subs?: { move: string; value: number }[]): Hypothesis =>
  ({ id, claim: id, measurement: { value, evidence: { source: 'redis ZCARD', query: 'ZCARD X', sampleRows }, counterfactual: baseline ? { baseline } : undefined, subMeasurements: subs } } as unknown as Hypothesis);

// ── buildLedger (the evidence ledger: lift numbers from sampleRows + baseline + subMeasurements) ──
test('buildLedger lifts top-line + sampleRows + baseline numbers into the certified set', () => {
  const l: Ledger = buildLedger([hyp('h1', 0.804, ['pool_size=499, covered_in_pool=401'], 'popularity-head null ~0.20')]);
  assert.ok(l.entries.some((e) => e.artifactId === 'h1' && e.value === 0.804), 'top-line entry');
  assert.ok(l.numbers.has('401'), 'covered_in_pool from sampleRows is certified');
  assert.ok(l.numbers.has('499'), 'pool_size from sampleRows is certified');
  assert.ok(l.text.includes('measured evidence'), 'ledger text carries the evidence blob');
});

test('buildLedger comma-normalizes so 998,165 and 998165 both certify', () => {
  const l = buildLedger([hyp('h1', 1, ['catalog=998,165'])]);
  assert.ok(l.numbers.has('998165') && l.numbers.has('998,165'));
});

test('sub-measurement values appear in the judge ledger text', () => {
  const l = buildLedger([hyp('h1', 1, [], undefined, [{ move: 'overlap', value: 0.125 }])]);
  assert.ok(l.text.includes('overlap=0.125'), 'judge text must carry decomposition values');
});

test('buildLedger reads real SubMeasurement moveId/kind, not undefined', () => {
  const h = { id: 'h1', claim: 'c', measurement: { value: 1, subMeasurements: [{ moveId: 'h1.m3', kind: 'overlap', value: 0.5 }] } } as unknown as import('./investigation.ts').Hypothesis;
  const l = buildLedger([h]);
  assert.ok(l.entries.some((e) => e.artifactId.includes('h1.m3')), 'artifactId uses moveId');
  assert.ok(!l.text.includes('undefined'), 'no "undefined=" in judge ledger text');
});

test('buildLedger certifies must-beat null baseline values + lists them in judge text', () => {
  const h = { id: 'h1', claim: 'c', measurement: { value: 0.31, nulls: [{ name: 'popularity_list_null', value: 0.2 }, { name: 'random_chance' }] } } as unknown as Hypothesis;
  const l = buildLedger([h]);
  assert.ok(l.numbers.has('0.2'), 'the must-beat baseline value is certified');
  assert.ok(l.text.includes('popularity_list_null=0.2'), 'judge text lists the must-beat baseline');
  assert.ok(l.entries.some((e) => e.artifactId === 'h1.null:popularity_list_null' && e.value === 0.2), 'a null-baseline ledger entry exists');
  assert.ok(!l.entries.some((e) => e.artifactId === 'h1.null:random_chance'), 'a valueless null is not certified');
});

test('buildLedger certifies DECIMAL rounded forms of a measured fraction but not a bare whole-number percent', () => {
  const l = buildLedger([hyp('h1', 0.9164, [])]);
  assert.ok(l.numbers.has('0.916') && l.numbers.has('0.92'), 'rounded fraction forms certified');
  assert.ok(l.numbers.has('91.6') && l.numbers.has('91.64'), 'decimal percent forms certified');
  assert.ok(!l.numbers.has('92'), 'a bare whole-number percent (92) is NOT certified — would collide with a count');
});

test('buildLedger: a measured COUNT (integer 1..100) is NOT aliased to a fraction', () => {
  const l = buildLedger([hyp('h1', 53, [])]);
  assert.ok(l.numbers.has('53'), 'the count itself is certified');
  assert.ok(!l.numbers.has('0.53'), 'a count is not certified as a fraction (would let a fabricated rate pass)');
  // a non-integer percent value still aliases to its fraction
  const l2 = buildLedger([hyp('h2', 91.64, [])]);
  assert.ok(l2.numbers.has('0.9164'), 'a non-integer percent value still certifies its fraction form');
});

// ── R7: the leadership plain-language vocabulary ──
test('R7 rules: snake_case codenames and file / Redis plumbing are caught; the English verb "select … from" is not SQL', () => {
  assert.match('the swing_i2i source', R7_CODENAME_RE);
  assert.match('a bare usercf list', R7_CODENAME_RE);
  assert.doesNotMatch('the SmartFeed two-tower model', R7_CODENAME_RE);
  assert.match('see server.ts for details', R7_PLUMBING_RE);
  assert.match('ZCARD on the pool', R7_PLUMBING_RE);
  assert.doesNotMatch('select the winners from the list', R7_SQL_RE);
  assert.match('SELECT count(*) FROM events', R7_SQL_RE);
});
