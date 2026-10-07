import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hypothesesToFindings, synthesisOverview, answerBackRows, deepAudit, reconcileToKnownId, reconcileBasis, plannedBlock, confirmedNoLeverFix } from './deep.ts';
import type { Hypothesis } from './investigation.ts';
import { baseline } from './domainBundles.ts';
import { findingHasResolvableEvidence, type CoverageGap, type Finding } from '../schema.ts';

// ── id reconciliation (LLM may shorten recsys-mle:h1 → h1) + plannedBlock rendering ──
test('reconcileToKnownId: resolves a UNIQUE shortened id; AMBIGUOUS cross-bundle short id kept raw', () => {
  const known = ['recsys-mle:h1', 'recsys-mle:h2', 'analytics:h1'];
  assert.equal(reconcileToKnownId('h2', known), 'recsys-mle:h2');             // unique short → prefixed
  assert.equal(reconcileToKnownId('recsys-mle:h1', known), 'recsys-mle:h1');  // exact → unchanged
  assert.equal(reconcileToKnownId('h1', known), 'h1');                        // AMBIGUOUS (two :h1) → keep raw, don't guess
  assert.equal(reconcileToKnownId('h9', known), 'h9');                        // no match → verbatim
  assert.equal(reconcileToKnownId('', known), '');
});

test('reconcileBasis: flattens combined entries, reconciles each token, dedups', () => {
  const known = ['recsys-mle:h1', 'recsys-mle:h3'];
  assert.deepEqual(reconcileBasis(['h1, h3', 'h1'], known), ['recsys-mle:h1', 'recsys-mle:h3']);
  assert.deepEqual(reconcileBasis(undefined, known), []);
});

test('plannedBlock: renders the EXECUTE-THIS plan (query + plane + must-beat + contract); empty without a plan', () => {
  const h = { id: 'recsys-mle:h1', claim: 'c', symptom: 's', status: 'open', decisiveMetric: 'm',
    plannedMeasurement: { decisiveQuery: 'SELECT count(*) FROM impressions', mustBeat: 'random floor', requiresPlane: 'warehouse', dataContract: { grain: 'one row per impression' } },
  } as unknown as Hypothesis;
  const block = plannedBlock(h);
  assert.match(block, /PRE-APPROVED PLAN/);
  assert.match(block, /SELECT count\(\*\) FROM impressions/);
  assert.match(block, /on the warehouse plane/);
  assert.match(block, /random floor/);
  assert.match(block, /one row per impression/);
  assert.equal(plannedBlock({ id: 'x', claim: 'c', symptom: 's', status: 'open', decisiveMetric: 'm' } as Hypothesis), '');
});

const measuredHyp = (id: string, claim: string): Hypothesis => ({
  id, claim, symptom: 's', status: 'supported', decisiveMetric: 'm',
  measurement: { metricId: 'm', value: 1, direction: 'higher', nulls: [{ name: 'f', value: 0 }], source: `warehouse:q_${id}`, supportsClaim: true },
});

const hyp = (over: Partial<Hypothesis>): Hypothesis => ({
  id: 'h1', claim: 'X starves Z', symptom: 'low engagement', status: 'open', decisiveMetric: 'm1', ...over,
});

test('hypothesesToFindings: measured+disposed → Finding with RESOLVABLE evidence; unmeasured → CoverageGap', () => {
  const measured = hyp({
    id: 'h1', status: 'supported',
    measurement: { metricId: 'm1', value: 0.42, direction: 'higher', nulls: [{ name: 'floor', value: 0.1 }], source: 'warehouse:q_abc', supportsClaim: true },
  });
  const unmeasured = hyp({ id: 'h2', status: 'blocked-need-eval', evalProposal: { metric: 'm2', what: 'run an A/B', why: 'settles h2', how: 'ablation arm', mustBeat: ['flat_band'] } });

  const { findings, gaps } = hypothesesToFindings([measured, unmeasured], []);

  // the measured one is a finding, backed by a resolvable ref (never eval:*)
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'H1');
  assert.ok(findingHasResolvableEvidence(findings[0]), 'measured finding must carry resolvable evidence');
  assert.ok(!findings[0].evidence.some((e) => e.ref.startsWith('eval:')), 'no synthetic eval:* ref on a finding');

  // the unmeasured one is a coverage gap, NOT a finding
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].hypothesisId, 'h2');
  assert.equal(gaps[0].status, 'unmeasured');
  assert.ok(gaps[0].nextDecisiveTest.length > 0, 'a gap names the next decisive test');
  assert.ok(!findings.some((f) => f.id === 'H2'), 'an unmeasured hypothesis must not appear as a finding');
});

test('deepAudit refuses empty-library FORCED mode (baseline must use the floor lane, not deepAudit)', async () => {
  // baseline has an empty metric library — forced deepAudit would silently inherit the recsys library
  // (a former bug). It must throw so the caller routes it to the invariant-floor lane instead. Throws at
  // the library check, before any agent/LLM call.
  await assert.rejects(
    deepAudit({ root: process.cwd(), scopeDesc: 's', issue: 'i', bundles: [baseline] }),
    /no metric library/,
  );
  // unforced mode is exempt — the agent draws its own decisive measurements with no library.
  // (Not exercised here to avoid an LLM call; the guard is `!opts.unforced && mergedLib.length === 0`.)
});

test('answerBackRows: built from FINAL findings+gaps — self-gated hyp is unsettled only; absence never refuted', () => {
  const confirmed = measuredHyp('h1', 'A is broken');   // → confirmed finding (high) → supported
  const refutedH: Hypothesis = { id: 'h2', claim: 'B is broken', symptom: 's', status: 'refuted', decisiveMetric: 'm',
    measurement: { metricId: 'm', value: 0, direction: 'higher', nulls: [{ name: 'f', value: 1 }], source: 'warehouse:q2', supportsClaim: false } };
  // h3 is MEASURED+supported but its source is the audit's OWN self-referential pointer ('measurement:h3'),
  // not a reproducible plane → the converter backstop self-gates it to a GAP (measurement:* is
  // not a concrete source). 'proposed' would gap the same way.
  const selfGated: Hypothesis = { id: 'h3', claim: 'C is broken', symptom: 's', status: 'supported', decisiveMetric: 'm',
    measurement: { metricId: 'm', value: 1, direction: 'higher', nulls: [], source: 'measurement:h3', supportsClaim: true } };
  const { findings, gaps } = hypothesesToFindings([confirmed, refutedH, selfGated], []);
  assert.deepEqual(findings.map((f) => f.id), ['H1', 'H2'], 'self-gated h3 is NOT a finding');
  assert.ok(gaps.some((g) => g.hypothesisId === 'h3'), 'h3 is routed to a gap');

  const baselineFinding: Finding = { id: 'I1-01', dimension: 'security_supply', title: 'secret committed', claim: 'c',
    evidence: [{ kind: 'file', ref: 'a.ts:1' }], businessImpact: 'b', recommendation: 'r', severity: 'high', confidence: 'high', effort: 'quick_win', source: 'research', invariant: 'i1' };

  const rows = answerBackRows([...findings, baselineFinding], gaps);
  assert.equal(rows.find((r) => r.id === 'H1')!.status, 'supported');
  assert.equal(rows.find((r) => r.id === 'H2')!.status, 'refuted');      // measured + info-severity = ruled out
  assert.equal(rows.find((r) => r.id === 'I1-01')!.status, 'supported');  // baseline research-confirmed defect
  // the self-gated h3 appears ONLY as an unsettled row — never double-counted as supported AND unsettled
  const h3 = rows.filter((r) => r.id === 'H3');
  assert.ok(h3.length && h3.every((r) => r.status === 'unsettled'), 'self-gated hypothesis is unsettled only');
  assert.equal(rows.filter((r) => r.status === 'refuted').length, 1, 'only the genuinely-refuted finding is ruled out — absence never becomes refuted');
});

test('synthesisOverview renders bottom-line + leads as text (never a finding)', () => {
  const text = synthesisOverview({ bottomLine: 'The recall source is redundant.', leads: [{ title: 'Cut source A', detail: 'no incremental engagement', grounding: 'g', basis: ['h1'] }] });
  assert.match(text, /recall source is redundant/);
  assert.match(text, /Cut source A/);
  assert.equal(synthesisOverview(undefined), '');
});

test('confirmedNoLeverFix (ky test run): no boilerplate — says no fix was drafted and turns the null into the done-check', () => {
  const r = confirmedNoLeverFix('pinned=1');
  assert.doesNotMatch(r, /re-measure against the same null/);
  assert.match(r, /No specific fix was drafted/);
  assert.match(r, /Done when the same check, re-run, meets: pinned=1\./);
  assert.match(confirmedNoLeverFix(''), /re-run the same check/);
});
