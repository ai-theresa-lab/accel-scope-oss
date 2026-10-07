import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimAuditSurvivors } from './claimAudit.ts';
import type { Hypothesis } from './investigation.ts';
import type { Mitigation } from './deep.ts';
import type { AuditedClaim } from '../schema.ts';

// This transform decides what a reader is allowed to see, and it had been hand-copied into executeOrgRun
// and cli-deepdive — and omitted entirely from the report-tiers harness, which rebuilt writer input from the
// `barrier` checkpoint (saved BEFORE claim audit) and so handed every experiment arm claims production would
// have withheld. Shared and pinned here after a code review found it.

const h = (id: string, claim = `claim ${id}`): Hypothesis => ({ id, claim, status: 'supported', measurement: { value: 1 } } as unknown as Hypothesis);
const m = (id: string): Mitigation => ({ hypothesisId: id, supported: true, lever: 'fix' } as unknown as Mitigation);
const a = (id: string, verdict: string, auditStatus = 'audited', allowedWording?: string): AuditedClaim =>
  ({ hypothesisId: id, verdict, auditStatus, ...(allowedWording ? { allowedWording } : {}) } as unknown as AuditedClaim);

test('a REJECTED claim never reaches the writer, and neither does its mitigation', () => {
  const s = claimAuditSurvivors([h('h1'), h('h2')], [m('h1'), m('h2')], [a('h1', 'accept'), a('h2', 'reject')]);
  assert.deepEqual(s.hypotheses.map((x) => x.id), ['h1']);
  assert.deepEqual(s.mitigations.map((x) => x.hypothesisId), ['h1'], 'a rejected claim must not keep a fix in the report');
  assert.deepEqual([...s.rejectedIds], ['h2']);
});

test('a claim the auditor COULD NOT SETTLE is withheld too, not shipped as accepted', () => {
  // auditStatus !== 'audited' is the "we could not rule on this" case. Shipping it would present an
  // unsettled claim as a finding — the failure mode the claim auditor exists to prevent.
  const s = claimAuditSurvivors([h('h1'), h('h2')], [], [a('h1', 'accept'), a('h2', 'accept', 'audit-failed')]);
  assert.deepEqual(s.hypotheses.map((x) => x.id), ['h1']);
  assert.deepEqual([...s.rejectedIds], ['h2']);
});

test('a DOWNGRADED claim survives but is re-worded, never shipped at full strength', () => {
  const s = claimAuditSurvivors([h('h1', 'the cache is always stale')], [], [a('h1', 'downgrade', 'audited', 'the cache MAY be stale on one path')]);
  assert.equal(s.hypotheses.length, 1);
  assert.notEqual(s.hypotheses[0].claim, 'the cache is always stale', 'an un-reworded downgrade overclaims in the report');
  assert.match(s.hypotheses[0].claim, /MAY be stale/);
});

test('a downgrade with NO allowedWording still gets a caveat, never the bare original', () => {
  // Re-verify can produce a wording-less downgrade; the bare claim must not pass through.
  const s = claimAuditSurvivors([h('h1', 'retrieval is the binding ceiling')], [], [a('h1', 'downgrade')]);
  assert.notEqual(s.hypotheses[0].claim, 'retrieval is the binding ceiling');
});

test('an ACCEPTED claim passes through untouched', () => {
  const s = claimAuditSurvivors([h('h1', 'exactly this wording')], [m('h1')], [a('h1', 'accept')]);
  assert.equal(s.hypotheses[0].claim, 'exactly this wording');
  assert.equal(s.mitigations.length, 1);
  assert.equal(s.rejectedIds.size, 0);
});

test('NO audits means nothing is withheld — the identity case the harness relied on', () => {
  // This is precisely what the harness was doing (barrier has no audits), which is why it looked correct:
  // with an empty audit list the transform is the identity, so the bug is invisible on a run where the
  // auditor rejected nothing, and silent on a run where it rejected something.
  const s = claimAuditSurvivors([h('h1'), h('h2')], [m('h1')], []);
  assert.deepEqual(s.hypotheses.map((x) => x.id), ['h1', 'h2']);
  assert.equal(s.rejectedIds.size, 0);
});

test('the input arrays are not mutated', () => {
  const hyp = [h('h1', 'original'), h('h2')];
  const mit = [m('h1'), m('h2')];
  claimAuditSurvivors(hyp, mit, [a('h1', 'downgrade', 'audited', 'weaker'), a('h2', 'reject')]);
  assert.equal(hyp.length, 2, 'caller keeps its own list');
  assert.equal(hyp[0].claim, 'original', 'the wording change must be a copy, not an in-place edit');
  assert.equal(mit.length, 2);
});
