import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hypothesesToFindings } from './deep.ts';
import type { Hypothesis } from './investigation.ts';
import type { AuditedClaim } from '../schema.ts';

// A measured + confirmed hypothesis (would become a Finding under the disposition split).
const confirmed = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id, claim: `${id} defect`, symptom: 'low engagement', status: 'supported', decisiveMetric: 'm',
  measurement: { metricId: 'm', value: 0.42, direction: 'higher', nulls: [{ name: 'floor', value: 0.1 }], source: `warehouse:q_${id}`, supportsClaim: true,
    evidence: { ref: `measurement:${id}`, value: 0.42, source: `warehouse:q_${id}`, nulls: [{ name: 'floor', value: 0.1 }] } },
  ...over,
});
const audit = (over: Partial<AuditedClaim>): AuditedClaim => ({ hypothesisId: 'h1', verdict: 'accept', reason: 'evidence supports the claim', auditStatus: 'audited', ...over });
const auditMap = (...a: AuditedClaim[]) => new Map(a.map((x) => [x.hypothesisId, x]));

// ── no auditor → behavior is EXACTLY today's disposition split (the omitted-param path) ──────────
test('hypothesesToFindings: with no audits arg, behavior is unchanged (confirmed → Finding)', () => {
  const { findings, gaps } = hypothesesToFindings([confirmed('h1')], []);
  assert.equal(findings.length, 1);
  assert.equal(gaps.length, 0);
  assert.equal(findings[0].severity, 'high');     // confirmed default
  assert.equal(findings[0].confidence, 'high');
});

// ── accept → Finding (unchanged severity unless the auditor sets one) ────────────────────────────
test('audit accept → Finding ships', () => {
  const { findings, gaps } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'accept' })));
  assert.equal(findings.length, 1);
  assert.equal(gaps.length, 0);
  assert.equal(findings[0].severity, 'high');
});

// ── reject → claim_rejected CoverageGap (fail-closed) ────────────────────────────────────────────
test('audit reject → claim_rejected gap, NOT a finding', () => {
  const { findings, gaps } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'reject', reason: 'the warehouse query does not isolate the claimed cause' })));
  assert.equal(findings.length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].status, 'claim_rejected');
  assert.equal(gaps[0].source, 'claim-audit');
  assert.match(gaps[0].whyUnsettled, /REJECTED/);
  assert.match(gaps[0].nextDecisiveTest, /isolate the claimed cause/);
});

// ── fail-CLOSED: a would-be finding with NO audit verdict (auditor ran but missed it) → gap ──────
test('audit ran but no verdict for this claim → claim_rejected gap (fail-closed)', () => {
  // audits map present (auditor ran) but has no entry for h1
  const { findings, gaps } = hypothesesToFindings([confirmed('h1')], [], new Map());
  assert.equal(findings.length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].status, 'claim_rejected');
  assert.match(gaps[0].whyUnsettled, /could not settle/);
});

test('audit llm_failed / unparseable → claim_rejected gap (fail-closed)', () => {
  for (const s of ['llm_failed', 'unparseable'] as const) {
    const { findings, gaps } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'accept', auditStatus: s })));
    assert.equal(findings.length, 0, s);
    assert.equal(gaps[0].status, 'claim_rejected', s);
  }
});

test('audit accept with NO auditStatus → claim_rejected gap (only an explicit `audited` ships)', () => {
  // an AuditedClaim that says accept but carries no `audited` status is NOT a real audit → fail-closed.
  const { findings, gaps } = hypothesesToFindings([confirmed('h1')], [], auditMap({ hypothesisId: 'h1', verdict: 'accept', reason: 'x' }));
  assert.equal(findings.length, 0);
  assert.equal(gaps[0].status, 'claim_rejected');
});

// ── downgrade → Finding with capped severity/confidence + allowed wording ────────────────────────
test('audit downgrade → Finding, severity capped below high, confidence lowered, wording substituted', () => {
  const { findings, gaps } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({
    hypothesisId: 'h1', verdict: 'downgrade', confidence: 'low', allowedWording: 'A weak association, not a confirmed cause.', reason: 'no counterfactual',
  })));
  assert.equal(gaps.length, 0);
  assert.equal(findings.length, 1);
  assert.notEqual(findings[0].severity, 'high');     // capped below high
  assert.notEqual(findings[0].severity, 'info');     // …but never flipped to the refuted band (polarity preserved)
  assert.equal(findings[0].confidence, 'low');
  assert.equal(findings[0].claim, 'A weak association, not a confirmed cause.');
});

test('audit downgrade caps an explicit high/critical severity down to medium (never raises)', () => {
  const { findings } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'downgrade', severity: 'critical' })));
  assert.equal(findings[0].severity, 'medium');
});

test('audit downgrade WITHOUT allowedWording → caveated claim + [Caveated]-marked title, never bare-over-strong', () => {
  const { findings } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'downgrade', reason: 'no counterfactual was run' })));
  assert.equal(findings.length, 1);
  // the claim carries the deterministic caveat (not the over-strong "verdict: CONFIRMED…" framing)
  assert.match(findings[0].claim, /CAVEATED \(downgraded/);
  assert.match(findings[0].claim, /no counterfactual was run/);
  assert.ok(!/verdict: CONFIRMED/.test(findings[0].claim), 'no over-strong confirmed wording on a downgrade');
  // the headline is explicitly marked caveated (honest — keeps the topic but signals the downgrade)
  assert.match(findings[0].title, /^\[Caveated\]/);
});

test('audit downgrade WITH allowedWording → claim + headline derive from the caveated wording, not the original', () => {
  const { findings } = hypothesesToFindings([confirmed('h1')], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'downgrade', allowedWording: 'A weak association, not a confirmed cause.' })));
  assert.equal(findings[0].claim, 'A weak association, not a confirmed cause.');
  assert.match(findings[0].title, /weak association/i);   // headline from the caveated wording
  assert.ok(!/h1 defect/.test(findings[0].title), 'the original over-strong claim must not appear in the headline');
});

test('audit downgrade → the mitigation recommendation is flagged exploratory (expected-effect provisional)', () => {
  const mit = [{ hypothesisId: 'h1', supported: true, mitigation: 'tune it', lever: 'raise the pool cap', expectedEffect: '+12% engagement', guardrail: 'latency', grounding: 'measured' }];
  const { findings } = hypothesesToFindings([confirmed('h1')], mit, auditMap(audit({ hypothesisId: 'h1', verdict: 'downgrade', allowedWording: 'weak association' })));
  assert.equal(findings.length, 1);
  assert.match(findings[0].recommendation, /Exploratory/);
  assert.match(findings[0].recommendation, /PROVISIONAL/i);
  assert.match(findings[0].recommendation, /raise the pool cap/);   // the actionable lever is still there
});

// ── polarity preserved: a REFUTED finding stays info even under a downgrade (answerBack contract) ─
test('audit downgrade on a REFUTED claim keeps severity=info (polarity intact)', () => {
  const refuted = confirmed('h1', { status: 'refuted', measurement: { metricId: 'm', value: 0.8, direction: 'higher', nulls: [{ name: 'floor', value: 0.1 }], source: 'warehouse:q_h1', supportsClaim: false, evidence: { ref: 'measurement:h1', value: 0.8, source: 'warehouse:q_h1', nulls: [{ name: 'floor', value: 0.1 }] } } });
  const { findings } = hypothesesToFindings([refuted], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'downgrade', severity: 'high' })));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'info');        // a refuted/healthy finding is frozen at info regardless of the auditor
});

// ── the evidence gate runs FIRST + independent: a non-resolvable measurement is not_evidenceable,
//    NOT claim_rejected — even with an accept audit (the auditor never sees an unreproducible claim) ──
test('non-resolvable evidence → not_evidenceable gap regardless of an accept audit (evidence gate first)', () => {
  const noSource = confirmed('h1', { measurement: { metricId: 'm', value: 0.42, direction: 'higher', nulls: [{ name: 'floor', value: 0.1 }], source: 'proposed', supportsClaim: true } });
  const { findings, gaps } = hypothesesToFindings([noSource], [], auditMap(audit({ hypothesisId: 'h1', verdict: 'accept' })));
  assert.equal(findings.length, 0);
  assert.equal(gaps[0].status, 'not_evidenceable');   // the evidence gate, not the audit gate
});

// ── deferred stays a normal gap (the audit gate only applies to would-be findings) ───────────────
test('a deferred hypothesis stays an unmeasured gap (audit gate not applied)', () => {
  const deferred: Hypothesis = { id: 'h2', claim: 'h2 defect', symptom: 's', status: 'blocked-need-eval', decisiveMetric: 'm', evalProposal: { metric: 'm', what: 'w', why: 'y', how: 'h', mustBeat: ['floor'] } };
  const { findings, gaps } = hypothesesToFindings([deferred], [], new Map());
  assert.equal(findings.length, 0);
  assert.equal(gaps[0].status, 'unmeasured');         // not claim_rejected — it never reached the audit gate
});
