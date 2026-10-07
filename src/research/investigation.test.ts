import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusFor, statusFromVerdict, verdict, dispositionVerdict, normalizeArtifacts, queryHashOf, METRIC_LIBRARY, type Measurement } from './investigation.ts';

const M = (over: Partial<Measurement>): Measurement => ({
  metricId: 'm', value: 1, direction: 'higher', nulls: [{ name: 'floor', value: 0 }], ...over,
});

// Status follows the agent's EXPLICIT defect disposition, not the cascade verdict —
// because "metric beats its null" (a cascade win) does NOT mean "defect present" for a defect-framed
// hypothesis whose metric is "higher = healthier".

test('supportsClaim=false overrides a cascade win → refuted (healthy)', () => {
  // like-AUC 0.642 beats 0.5 floor → verdict win, but it REFUTES "ranker ignores likes".
  const m = M({ value: 0.642, nulls: [{ name: 'auc_random', value: 0.5 }], supportsClaim: false });
  assert.equal(verdict(m), 'win');                 // cascade: metric beat its null
  assert.equal(statusFor(m), 'refuted');           // disposition: defect absent / healthy
});

test('supportsClaim=true overrides a cascade refuted → supported (defect real)', () => {
  // 0 arms vary the formula vs a floor of 1 → verdict refuted, but it CONFIRMS "no arm varies".
  const m = M({ value: 0, nulls: [{ name: 'min_arms', value: 1 }], supportsClaim: true });
  assert.equal(verdict(m), 'refuted');
  assert.equal(statusFor(m), 'supported');
});

test('no supportsClaim → falls back to statusFromVerdict(verdict) (back-compat)', () => {
  const win = M({ value: 6, nulls: [{ name: 'clean', value: 0 }] });   // count of secrets beats 0
  assert.equal(statusFor(win), statusFromVerdict(verdict(win)));
  assert.equal(statusFor(win), 'supported');
});

test('no supportsClaim + no-free-lunch verdict → still supported (caveated effect)', () => {
  // beats its null AND its parent but trades a guardrail → cascade 'no-free-lunch'; fallback → supported.
  const nfl = M({ value: 2, nulls: [{ name: 'floor', value: 1 }], parent: { id: 'p', value: 2 }, guardrailTraded: true });
  assert.equal(verdict(nfl), 'no-free-lunch');
  assert.equal(statusFor(nfl), 'supported');
});

test('unmeasured (value null) → blocked-need-eval regardless of supportsClaim', () => {
  assert.equal(statusFor(M({ value: null, supportsClaim: true })), 'blocked-need-eval');
  assert.equal(statusFor(undefined), 'blocked-need-eval');
});

// ── normalizeArtifacts — required-after-normalization, optional-from-agent ──
const measured: Measurement = { metricId: 'full_catalog_recall', value: 0.12, direction: 'higher', nulls: [{ name: 'random_chance', value: 0.001 }], source: 'warehouse:q_recall' };

test('normalizeArtifacts: a THIN reply is completed with deterministic defaults (no invented numbers)', () => {
  const a = normalizeArtifacts(measured, 'recall is too low', 'run a full-catalog recall@k eval', METRIC_LIBRARY, undefined);
  assert.equal(a.dataContract.grain, 'unknown');                 // not stated → unknown, not fabricated
  assert.deepEqual(a.dataContract.joinKeys, []);
  assert.equal(a.counterfactual.state, 'not_run');               // no counterfactual run → not_run + reason
  assert.ok(a.counterfactual.reason && a.counterfactual.reason.length > 0);
  assert.equal(a.metricSemantics.proxyOrDecision, 'unknown');    // not stated → unknown (not guessed)
  assert.ok(a.metricSemantics.proves.length > 0 && a.metricSemantics.cannotProve.length > 0);
  assert.ok(a.claimBoundaries.includes('full_catalog_recall'));  // boundary names the metric, not the broad claim
  assert.equal(a.nextDecisiveTest, 'run a full-catalog recall@k eval');  // falls back to the eval proposal's how
  assert.ok(!/=\s*\d/.test(a.metricSemantics.proves), 'no fabricated number in the proves text');
});

test('normalizeArtifacts: EvidencePayload only for a MEASURED value with a concrete source (no fake precision)', () => {
  const withPayload = normalizeArtifacts(measured, 'c', undefined, METRIC_LIBRARY, undefined);
  assert.ok(withPayload.evidence, 'measured + source → payload');
  assert.equal(withPayload.evidence!.ref, 'measurement:full_catalog_recall');
  assert.equal(withPayload.evidence!.value, 0.12);
  assert.equal(normalizeArtifacts({ ...measured, value: null }, 'c', undefined, METRIC_LIBRARY, undefined).evidence, undefined, 'no value → no payload');
  assert.equal(normalizeArtifacts({ ...measured, source: undefined }, 'c', undefined, METRIC_LIBRARY, undefined).evidence, undefined, 'no concrete source → no payload');
});

test('normalizeArtifacts: a RICH reply is rendered faithfully', () => {
  const a = normalizeArtifacts(measured, 'c', undefined, METRIC_LIBRARY, {
    dataContract: { grain: 'request', window: '31d', joinKeys: ['user_id', 'item_id'], biases: ['logged-only'] },
    metricSemantics: { proves: 'serving recall is below the popularity floor', cannotProve: 'why', proxyOrDecision: 'proxy' },
    counterfactual: { state: 'run', baseline: 'popularity list', delta: '-8pp' },
    query: 'SELECT recall FROM eval',
  });
  assert.equal(a.dataContract.grain, 'request');
  assert.deepEqual(a.dataContract.joinKeys, ['user_id', 'item_id']);
  assert.equal(a.metricSemantics.proxyOrDecision, 'proxy');
  assert.equal(a.counterfactual.state, 'run');
  assert.equal(a.counterfactual.delta, '-8pp');
  assert.equal(a.evidence!.query, 'SELECT recall FROM eval');
  assert.ok(a.evidence!.queryHash && a.evidence!.queryHash.length === 12, 'a query yields a stable 12-char hash');
});

// queryHash: deterministic, whitespace-insensitive, present only when a query exists .
test('queryHashOf: stable + whitespace-insensitive; empty/undefined → undefined', () => {
  const a = queryHashOf('SELECT count(*)  FROM   t');
  const b = queryHashOf('SELECT count(*) FROM t');           // collapsed whitespace → same hash
  assert.equal(a, b);
  assert.notEqual(a, queryHashOf('SELECT count(*) FROM other'));
  assert.equal(queryHashOf(''), undefined);
  assert.equal(queryHashOf(undefined), undefined);
});

test('normalizeArtifacts: no query → payload has no queryHash (no fabricated reproducibility)', () => {
  const a = normalizeArtifacts(measured, 'c', undefined, METRIC_LIBRARY, undefined);
  assert.ok(a.evidence, 'measured + source → payload');
  assert.equal(a.evidence!.query, undefined);
  assert.equal(a.evidence!.queryHash, undefined);
});

// the RECORDED verdict must not contradict the disposition (the log printed
// `supported [verdict=refuted]` and the checkpoint stored verdict:'refuted' on confirmed defects).
test('dispositionVerdict: a direct polarity contradiction follows the agent disposition; the rest is the cascade', () => {
  assert.equal(dispositionVerdict(M({ value: 0, nulls: [{ name: 'min', value: 1 }], supportsClaim: true })), 'win');
  assert.equal(dispositionVerdict(M({ value: 0.642, nulls: [{ name: 'auc', value: 0.5 }], supportsClaim: false })), 'refuted');
  assert.equal(dispositionVerdict(M({ value: 0, nulls: [{ name: 'min', value: 1 }] })), 'refuted', 'no disposition → cascade');
  assert.equal(dispositionVerdict(M({ value: 3, nulls: [{ name: 'n', value: null }], supportsClaim: true })), 'pending');
  assert.equal(dispositionVerdict(M({ value: null })), 'unmeasured');
  for (const m of [M({ value: 0, nulls: [{ name: 'min', value: 1 }], supportsClaim: true }), M({ value: 0.642, nulls: [{ name: 'auc', value: 0.5 }], supportsClaim: false })])
    assert.equal(statusFromVerdict(dispositionVerdict(m)), statusFor(m), 'verdict and status agree');
});
