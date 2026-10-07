import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredMoves, hasDecomposition, inferArchetype, normalizeArchetype, renderMoveTemplate } from './methodMoves.ts';
import { aggregateDisposition, decompositionPromotes, type SubMeasurement } from './investigation.ts';
import { buildSubMeasurements } from './deep.ts';
import { lintPlan, type AuditPlan, type PlanHypothesis } from './auditPlan.ts';
import { planItemsToHypotheses, type PlanItemJson } from './preflight.ts';

// ── registry + archetype inference ─────────────────────────────────────────────────────────────────
test('requiredMoves: incremental_value carries the 8-move decomposition incl. a single decision move; others empty', () => {
  const moves = requiredMoves('incremental_value');
  assert.equal(moves.length, 8);
  assert.ok(hasDecomposition('incremental_value'));
  assert.equal(moves.filter((m) => m.decision).length, 1);                 // exactly one DECISION move (the ablation)
  assert.equal(moves.find((m) => m.decision)!.kind, 'counterfactual');
  assert.ok(moves.some((m) => m.kind === 'target_sole_footprint' && m.proxy));
  assert.deepEqual(requiredMoves('generic'), []);                          // archetypes not brought up → single-metric path
  assert.deepEqual(requiredMoves('freshness'), []);
});

test('inferArchetype: incremental-value signals → incremental_value; otherwise generic (no decomposition forced)', () => {
  assert.equal(inferArchetype('does the two-tower recall source add incremental value over popularity?'), 'incremental_value');
  assert.equal(inferArchetype('the recall source may be redundant / never exposed dead weight'), 'incremental_value');
  assert.equal(inferArchetype('DAU is defined two different ways across dashboards'), 'generic');
  assert.equal(normalizeArchetype('Incremental_Value'), 'incremental_value');
  assert.equal(normalizeArchetype('metric definition drift'), 'metric_definition_drift'); // space/hyphen normalized
  assert.equal(normalizeArchetype('nonsense'), undefined);
});

test('renderMoveTemplate: lists every required move with the decision move flagged', () => {
  const t = renderMoveTemplate('incremental_value');
  assert.match(t, /counterfactual.*DECISION move/);
  assert.match(t, /target_overlap/);
});

// ── deterministic aggregation — the anti-overclaim core ───────────────────────────────
const sub = (kind: string, state: SubMeasurement['state'], disposition?: SubMeasurement['disposition']): SubMeasurement =>
  ({ moveId: 'h1.' + kind, kind, intent: kind, state, disposition, reason: 'r' });

test('aggregateDisposition: proxy stack complete but the ablation (counterfactual) is a GAP → proxy_supported, NOT confirmed', () => {
  const subs = [
    sub('population_denominator', 'evidence_ref', 'neutral'),
    sub('alternative_coverage', 'evidence_ref', 'neutral'),
    sub('target_overlap', 'evidence_ref', 'supports'),
    sub('target_sole_footprint', 'evidence_ref', 'supports'),
    sub('reachable_denominator', 'evidence_ref', 'supports'),
    sub('counterfactual', 'coverage_gap'),     // the decision move did NOT run
  ];
  const d = aggregateDisposition(subs, /*headlineSupportsClaim*/ true);
  assert.equal(d, 'proxy_supported');
  assert.equal(decompositionPromotes(d), false);  // MUST NOT become a definitive finding
});

const decided = (disp: SubMeasurement['disposition'], value: number): SubMeasurement =>
  ({ moveId: 'h1.cf', kind: 'counterfactual', intent: 'ablation', state: 'evidence_ref', value, disposition: disp, reason: 'ablation ran' });

test('aggregateDisposition: the ablation ran (with a value) and refutes → refuted (definitive); promotes', () => {
  const subs = [sub('target_overlap', 'evidence_ref', 'supports'), decided('refutes', -0.2)];  // no engagement loss → keep is wrong
  const d = aggregateDisposition(subs, false);
  assert.equal(d, 'refuted');
  assert.equal(decompositionPromotes(d), true);
});

test('aggregateDisposition: ablation ran (with a value) + a supporting move is a gap → confirmed_with_caveats (still promotes)', () => {
  const subs = [sub('target_overlap', 'coverage_gap'), decided('supports', 0.08)];
  assert.equal(aggregateDisposition(subs, true), 'confirmed_with_caveats');
});

test('aggregateDisposition: an AMBIGUOUS measured decision (mixed/neutral/unstated) does NOT promote → unresolved', () => {
  const proxies = [sub('target_overlap', 'evidence_ref', 'supports'), sub('reachable_denominator', 'evidence_ref', 'supports')];
  // decision ran with a value but disposition 'mixed' and no headline → must NOT read as confirmed
  const mixed: SubMeasurement = { moveId: 'h1.cf', kind: 'counterfactual', intent: 'ablation', state: 'evidence_ref', value: -0.5, disposition: 'mixed', reason: 'partial loss' };
  assert.equal(aggregateDisposition([...proxies, mixed], undefined), 'unresolved');
  // decision "evidence_ref" but value-less → not a real decision → falls to proxy_supported (proxies complete)
  const valueless: SubMeasurement = { moveId: 'h1.cf', kind: 'counterfactual', intent: 'ablation', state: 'evidence_ref', disposition: 'supports', reason: 'no number' };
  assert.equal(aggregateDisposition([...proxies, valueless], true), 'proxy_supported');
});

test('aggregateDisposition: partial proxy stack + no decision → unresolved', () => {
  const subs = [sub('target_overlap', 'evidence_ref', 'supports'), sub('reachable_denominator', 'coverage_gap'), sub('counterfactual', 'coverage_gap')];
  assert.equal(aggregateDisposition(subs, undefined), 'unresolved');
  assert.equal(aggregateDisposition([], true), undefined);   // no decomposition → single-metric path
});

// ── buildSubMeasurements — preserves every planned move (no lie by omission, codex correction) ───────
test('buildSubMeasurements: a planGap move and an agent-omitted move both survive as coverage_gap', () => {
  const planMoves = requiredMoves('incremental_value').map((m) => ({ kind: m.kind, intent: m.intent }));
  // lint pre-marked the counterfactual as a planGap (ablation plane unmounted); agent returns only overlap.
  (planMoves.find((m) => m.kind === 'counterfactual') as any).planGap = 'requires the experiment plane, which is not mounted';
  const raw = [{ moveId: 'x', kind: 'target_overlap', state: 'evidence_ref', value: 0.18, source: 'acmedash:q', query: 'SELECT 1', disposition: 'supports', reason: '18% overlap' }];
  const subs = buildSubMeasurements('rec:h1', raw, planMoves);
  assert.equal(subs.length, planMoves.length);                                  // every planned move is present
  const overlap = subs.find((s) => s.kind === 'target_overlap')!;
  assert.equal(overlap.state, 'evidence_ref'); assert.equal(overlap.value, 0.18); assert.ok(overlap.queryHash);
  assert.equal(subs.find((s) => s.kind === 'counterfactual')!.state, 'coverage_gap');     // planGap preserved
  assert.match(subs.find((s) => s.kind === 'counterfactual')!.reason, /not mounted/);
  assert.equal(subs.find((s) => s.kind === 'target_sole_footprint')!.state, 'coverage_gap'); // agent-omitted → gap
});

// ── lint: per-move — an unmounted move gaps THAT move, not the whole decomposition ──────────
test('lintPlan: a metric-set hypothesis survives when the ablation move is unmounted (gaps the move, keeps proxies)', () => {
  const hyp: PlanHypothesis = {
    id: 'recsys-mle:h1', claim: 'two_tower adds little incremental value', symptom: 's', decisiveMetric: '',
    archetype: 'incremental_value',
    metricSet: [
      { kind: 'target_overlap', intent: 'overlap vs all sources', requiresPlane: 'bi', decisiveQuery: 'SELECT 1' },
      { kind: 'target_sole_footprint', intent: 'sole share', requiresPlane: 'bi', decisiveQuery: 'SELECT 2' },
      { kind: 'counterfactual', intent: 'ablation', requiresPlane: 'warehouse', decisiveQuery: 'propose an A/B' },
    ],
  };
  const plan: AuditPlan = { bundleId: 'recsys-mle', hypotheses: [hyp] };
  const r = lintPlan(plan, { mountedPlanes: new Set(['bi']), maxHypotheses: 5 });   // bi mounted, warehouse not
  assert.equal(r.ok.length, 1);                                       // NOT rejected — proxies are runnable
  const cf = r.ok[0].metricSet!.find((m) => m.kind === 'counterfactual')!;
  assert.match(cf.planGap ?? '', /not mounted/);                     // the unmounted ablation move is gapped
  assert.equal(r.ok[0].metricSet!.find((m) => m.kind === 'target_overlap')!.planGap, undefined); // proxy runnable
});

test('lintPlan: a metric-set hypothesis with ALL moves unmounted is rejected (no runnable proxy)', () => {
  const hyp: PlanHypothesis = {
    id: 'recsys-mle:h1', claim: 'c', symptom: 's', decisiveMetric: '', archetype: 'incremental_value',
    metricSet: [{ kind: 'target_overlap', intent: 'o', requiresPlane: 'bi' }, { kind: 'counterfactual', intent: 'a', requiresPlane: 'analytics' }],
  };
  const r = lintPlan({ bundleId: 'recsys-mle', hypotheses: [hyp] }, { mountedPlanes: new Set(['warehouse']), maxHypotheses: 5 }); // neither bi nor analytics mounted
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /no runnable proxy/);
});

// ── preflight parse: archetype inferred + metricSet parsed for incremental_value only ─────────────────
test('planItemsToHypotheses: an incremental_value item parses its metricSet; a generic item does not', () => {
  const items = [
    { claim: 'does two_tower add incremental value', symptom: 's', archetype: 'incremental_value',
      metricSet: [{ kind: 'target_overlap', intent: 'overlap', requiresPlane: 'bi', decisiveQuery: 'SELECT 1' }, { kind: 'counterfactual', intent: 'ablation', requiresPlane: 'none' }] },
    { claim: 'DAU defined two ways', symptom: 's', decisiveMetric: 'dau_gap', archetype: 'metric_definition_drift', requiresPlane: 'bi', decisiveQuery: 'SELECT 2' },
  ] as unknown as PlanItemJson[];
  const hyps = planItemsToHypotheses('analytics', items);
  assert.equal(hyps[0].archetype, 'incremental_value');
  assert.equal(hyps[0].metricSet!.length, 8);          // 2 planned + 6 backfilled (the required set is ENFORCED)
  assert.equal(hyps[0].metricSet!.filter((m) => m.planGap).length, 6);   // the 6 unplanned required moves are gapped, not dropped
  assert.ok(hyps[0].metricSet!.some((m) => m.kind === 'target_overlap' && !m.planGap));   // the 2 the planner DID plan are real
  assert.equal(hyps[1].archetype, undefined);          // single-metric archetype carries no metricSet
  assert.equal(hyps[1].metricSet, undefined);
  assert.equal(hyps[1].decisiveMetric, 'dau_gap');
});

test('planItemsToHypotheses: archetype is INFERRED when the planner omits it (no silent single-metric fallthrough)', () => {
  const items = [{ claim: 'the recall source may be redundant dead weight', symptom: 's',
    metricSet: [{ kind: 'target_overlap', intent: 'overlap', requiresPlane: 'bi' }, { kind: 'counterfactual', intent: 'ablation', requiresPlane: 'none' }] }] as unknown as PlanItemJson[];
  const hyps = planItemsToHypotheses('recsys-mle', items);
  assert.equal(hyps[0].archetype, 'incremental_value');   // inferred from "redundant dead weight"
  assert.equal(hyps[0].metricSet!.length, 8);             // backfilled to the full required set
});

test('planItemsToHypotheses: incremental_value with NO metricSet is FORCED onto the decomposition', () => {
  // labelled incremental_value but only a decisiveMetric + no metricSet → must NOT fall through to single-metric
  // (where one number could ship as a definitive finding). All 8 required moves backfill as planGaps; lint then
  // rejects it (zero runnable proxy) → a CoverageGap, never a one-number definitive finding.
  const items = [{ claim: 'two_tower adds incremental value', symptom: 's', archetype: 'incremental_value', decisiveMetric: 'served_share', decisiveQuery: 'SELECT 1' }] as unknown as PlanItemJson[];
  const hyps = planItemsToHypotheses('recsys-mle', items);
  assert.equal(hyps[0].archetype, 'incremental_value');
  assert.equal(hyps[0].metricSet!.length, 8);
  assert.equal(hyps[0].metricSet!.every((m) => m.planGap), true);
  const r = lintPlan({ bundleId: 'recsys-mle', hypotheses: hyps }, { mountedPlanes: new Set(['bi']), maxHypotheses: 5 });
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /no runnable proxy/);
});
