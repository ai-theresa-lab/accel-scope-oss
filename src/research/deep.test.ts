// robustness of the synthesis AREA grouping over large multi-bundle verdict sets. The agent can drop
// hypotheses from (or omit) its area grouping; deterministicAreas + fillAreaCoverage guarantee the area-first
// overview always exists and accounts for every measured verdict. Findings never depend on this path.
import { test } from 'node:test';
import assert from 'node:assert';
import { deterministicAreas, fillAreaCoverage } from './deep.ts';
import type { Mitigation, SynthesisArea } from './deep.ts';
import type { Hypothesis, HypothesisStatus } from './investigation.ts';

const hyp = (id: string, status: HypothesisStatus, value: number | null, supportsClaim?: boolean): Hypothesis => ({
  id, claim: `${id} claim`, symptom: 's', status, decisiveMetric: 'm',
  measurement: value == null ? undefined : { metricId: 'm', value, direction: 'higher', nulls: [], supportsClaim },
});
const mit = (hypothesisId: string, supported: boolean): Mitigation =>
  ({ hypothesisId, supported, mitigation: '', lever: '', expectedEffect: '', guardrail: '', grounding: '' });
const area = (key: string, verdict: SynthesisArea['verdict'], basis: string[]): SynthesisArea =>
  ({ key, name: key, verdict, framing: '', owner: '', basis });

// ── deterministicAreas (fallback grouping) ───────────────────────────────────────────────
test('deterministicAreas groups by disposition, worst-first, every measured hypothesis in exactly one area', () => {
  const hs = [hyp('h1', 'supported', 0.1), hyp('h2', 'refuted', 0.7), hyp('h3', 'blocked-need-eval', null)];
  const areas = deterministicAreas(hs, []);
  assert.deepEqual(areas.map((a) => a.verdict), ['critical', 'risk', 'healthy']); // confirmed, deferred, refuted — worst first
  const byVerdict = Object.fromEntries(areas.map((a) => [a.verdict, a.basis]));
  assert.deepEqual(byVerdict.critical, ['h1']);
  assert.deepEqual(byVerdict.risk, ['h3']);   // unmeasured → deferred
  assert.deepEqual(byVerdict.healthy, ['h2']);
  const allBasis = areas.flatMap((a) => a.basis);
  assert.equal(allBasis.length, 3);
  assert.equal(new Set(allBasis).size, 3);    // every hypothesis in exactly one area
});

test('deterministicAreas: a mitigation disposition overrides raw status', () => {
  const areas = deterministicAreas([hyp('h1', 'supported', 0.1)], [mit('h1', false)]);
  assert.equal(areas.find((a) => a.basis.includes('h1'))?.verdict, 'healthy'); // mit not-supported → refuted → healthy
});

test('deterministicAreas: only the dispositions present produce areas (no empty buckets)', () => {
  const areas = deterministicAreas([hyp('h1', 'blocked-need-eval', null)], []);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].verdict, 'risk');
  assert.deepEqual(areas[0].basis, ['h1']);
});

test('deterministicAreas: empty input yields no areas', () => {
  assert.deepEqual(deterministicAreas([], []), []);
});

// ── fillAreaCoverage (coverage sweep over the agent's areas) ──────────────────────────────
test('fillAreaCoverage: a dropped CONFIRMED defect is appended as CRITICAL (not down-graded), unmeasured stays out', () => {
  const hs = [hyp('h1', 'supported', 0.1), hyp('h2', 'refuted', 0.7), hyp('h3', 'blocked-need-eval', null)];
  const agentAreas = [area('covered', 'healthy', ['h2'])]; // agent only grouped h2; dropped h1 (confirmed) + h3 (unmeasured)
  const out = fillAreaCoverage(agentAreas, hs, []);
  const catchAll = out.find((a) => a.key === 'other-findings');
  assert.ok(catchAll, 'catch-all area appended');
  assert.equal(catchAll!.verdict, 'critical');     // confirmed defect → critical, NOT risk
  assert.deepEqual(catchAll!.basis, ['h1']);        // measured-only: h3 (unmeasured) is NOT manufactured
});

test('fillAreaCoverage: normalizes combined / mixed-case basis ids so a covered hypothesis is not re-appended', () => {
  const hs = [hyp('h1', 'supported', 0.1), hyp('h3', 'supported', 0.2)];
  const agentAreas = [area('a', 'critical', ['H1, h3'])]; // combined into one element + mixed case
  const out = fillAreaCoverage(agentAreas, hs, []);
  assert.equal(out.find((a) => a.key === 'other-findings'), undefined); // both recognized as covered → no duplicate
  assert.equal(out.length, 1);
});

test('fillAreaCoverage: nothing missing → returns the same areas unchanged', () => {
  const hs = [hyp('h1', 'supported', 0.1)];
  const agentAreas = [area('a', 'critical', ['h1'])];
  assert.equal(fillAreaCoverage(agentAreas, hs, []), agentAreas); // same reference, no work
});
