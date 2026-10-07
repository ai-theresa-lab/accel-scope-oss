import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditableHypotheses, parseAudits, auditPrompt, scoreClaimRisk, selectRiskySubset, applyReverify, reverifyCouldNotReach } from './claimAudit.ts';
import type { Hypothesis } from './investigation.ts';
import type { AuditedClaim } from '../schema.ts';

const measured = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id, claim: `${id} defect`, symptom: 's', status: 'supported', decisiveMetric: 'm',
  measurement: { metricId: 'm', value: 0.4, direction: 'higher', nulls: [{ name: 'floor', value: 0.1 }], source: `warehouse:q_${id}`, supportsClaim: true,
    evidence: { ref: `measurement:${id}`, value: 0.4, source: `warehouse:q_${id}`, nulls: [{ name: 'floor', value: 0.1 }] } },
  ...over,
});

// ── auditableHypotheses: only would-be findings (measured + disposed + reproducible evidence) ─────
test('auditableHypotheses: selects measured+disposed+resolvable; skips deferred and non-resolvable', () => {
  const ok = measured('h1');
  const deferred: Hypothesis = { id: 'h2', claim: 'c', symptom: 's', status: 'blocked-need-eval', decisiveMetric: 'm' };
  const nonResolvable = measured('h3', { measurement: { metricId: 'm', value: 0.4, direction: 'higher', nulls: [], source: 'proposed', supportsClaim: true } });
  const unmeasured = measured('h4', { measurement: { metricId: 'm', value: null, direction: 'higher', nulls: [], source: 'warehouse:q', supportsClaim: true } });
  const out = auditableHypotheses([ok, deferred, nonResolvable, unmeasured], []);
  assert.deepEqual(out.map((h) => h.id), ['h1']);   // only the reproducible, measured, disposed one
});

// ── parseAudits: keyed to audited ids, fail-closed on missing / unknown verdict ───────────────────
test('parseAudits: parses verdicts for the audited ids', () => {
  const text = '```json\n{"audits":[{"hypothesisId":"a:h1","verdict":"accept","reason":"sound"},{"hypothesisId":"a:h2","verdict":"downgrade","reason":"no counterfactual","allowedWording":"a weak signal","confidence":"low"}]}\n```';
  const out = parseAudits(text, ['a:h1', 'a:h2']);
  assert.equal(out.length, 2);
  assert.equal(out[0].verdict, 'accept');
  assert.equal(out[0].auditStatus, 'audited');
  assert.equal(out[1].verdict, 'downgrade');
  assert.equal(out[1].allowedWording, 'a weak signal');
  assert.equal(out[1].confidence, 'low');
});

test('parseAudits: an audited id MISSING from the reply → fail-closed (reject + unparseable)', () => {
  const text = '```json\n{"audits":[{"hypothesisId":"a:h1","verdict":"accept","reason":"ok"}]}\n```';
  const out = parseAudits(text, ['a:h1', 'a:h2']);   // h2 not in the reply
  const h2 = out.find((a) => a.hypothesisId === 'a:h2')!;
  assert.equal(h2.verdict, 'reject');
  assert.equal(h2.auditStatus, 'unparseable');
});

test('parseAudits: an unknown verdict → fail-closed (reject + unparseable)', () => {
  const text = '```json\n{"audits":[{"hypothesisId":"a:h1","verdict":"maybe","reason":"hmm"}]}\n```';
  const out = parseAudits(text, ['a:h1']);
  assert.equal(out[0].verdict, 'reject');
  assert.equal(out[0].auditStatus, 'unparseable');
});

test('parseAudits: an unparseable reply → ALL audited ids fail-closed', () => {
  const out = parseAudits('no json here', ['a:h1', 'a:h2']);
  assert.equal(out.length, 2);
  for (const a of out) { assert.equal(a.verdict, 'reject'); assert.equal(a.auditStatus, 'unparseable'); }
});

test('parseAudits: ignores ids the auditor invented (not in the audited set)', () => {
  const text = '```json\n{"audits":[{"hypothesisId":"a:h1","verdict":"accept","reason":"ok"},{"hypothesisId":"made:up","verdict":"accept","reason":"x"}]}\n```';
  const out = parseAudits(text, ['a:h1']);
  assert.equal(out.length, 1);
  assert.equal(out[0].hypothesisId, 'a:h1');
});

test('parseAudits: an invalid severity/confidence is dropped (left undefined, not coerced)', () => {
  const text = '```json\n{"audits":[{"hypothesisId":"a:h1","verdict":"accept","reason":"ok","severity":"huge","confidence":"max"}]}\n```';
  const out = parseAudits(text, ['a:h1']);
  assert.equal(out[0].severity, undefined);
  assert.equal(out[0].confidence, undefined);
});

// ── auditPrompt: surfaces the reproducible evidence + the strict accept/downgrade/reject grammar ──
test('auditPrompt: includes the claim id and the verdict grammar', () => {
  const p = auditPrompt('recsys-mle', '- id: recsys-mle:h1\n  claim: pool starves diversity', 'the recsys system');
  assert.match(p, /recsys-mle:h1/);
  assert.match(p, /accept\|downgrade\|reject/);
  assert.match(p, /independent/i);
  assert.match(p, /CANNOT run new measurements/i);   // tool-free: judge from evidence only
});

// ── scoreClaimRisk + selectRiskySubset (pure, deterministic) ───────────────────────────────
const accept = (id: string): AuditedClaim => ({ hypothesisId: id, verdict: 'accept', reason: 'ok', auditStatus: 'audited' });

test('scoreClaimRisk: a high-stakes confirmed defect with weak reproducibility scores high; rejected scores 0', () => {
  // confirmed (default high sev) + live-plane no queryHash + no counterfactual/unknown grain → 100+60+40
  const risky = measured('h1', { measurement: { metricId: 'm', value: 0.4, direction: 'higher', nulls: [{ name: 'f', value: 0.1 }], source: 'warehouse:q', supportsClaim: true, evidence: { ref: 'measurement:h1', value: 0.4, source: 'warehouse:q', nulls: [{ name: 'f', value: 0.1 }] } } });
  assert.equal(scoreClaimRisk(risky, accept('h1')), 200);
  // a rejected claim is never re-verified (already a gap)
  assert.equal(scoreClaimRisk(risky, { hypothesisId: 'h1', verdict: 'reject', reason: 'x', auditStatus: 'audited' }), 0);
  // an unparseable audit → 0
  assert.equal(scoreClaimRisk(risky, { hypothesisId: 'h1', verdict: 'accept', reason: 'x', auditStatus: 'unparseable' }), 0);
});

test('scoreClaimRisk: an analytics/BI server-name source counts as a live plane only when passed in', () => {
  // A confirmed-high value from "acmedash:…" with NO stored query: it's reproducibility-risk (+60) ONLY when the
  // run tells scoreClaimRisk that 'acmedash' is a live measure plane; otherwise the prefix isn't recognized.
  const biRisky = measured('h1', { measurement: { metricId: 'm', value: 0.4, direction: 'higher', nulls: [{ name: 'f', value: 0.1 }], source: 'acmedash:funnel', supportsClaim: true,
    dataContract: { grain: 'request', joinKeys: [], biases: [] }, counterfactual: { state: 'run', delta: '-8pp' },
    evidence: { ref: 'measurement:h1', value: 0.4, source: 'acmedash:funnel', nulls: [{ name: 'f', value: 0.1 }] } } });
  assert.equal(scoreClaimRisk(biRisky, accept('h1')), 100);                       // 'acmedash' unknown → not a live plane → no +60
  assert.equal(scoreClaimRisk(biRisky, accept('h1'), undefined, ['acmedash']), 160); // run mounts acmedash → +60 reproducibility risk
});

test('scoreClaimRisk: a downgrade adds risk; a strong reproducible claim scores lower', () => {
  const strong = measured('h1', { measurement: { metricId: 'm', value: 0.4, direction: 'higher', nulls: [{ name: 'f', value: 0.1 }], source: 'warehouse:q', supportsClaim: true,
    dataContract: { grain: 'request', joinKeys: [], biases: [] }, counterfactual: { state: 'run', delta: '-8pp' },
    evidence: { ref: 'measurement:h1', value: 0.4, source: 'warehouse:q', queryHash: 'abc123', query: 'SELECT 1', nulls: [{ name: 'f', value: 0.1 }] } } });
  // confirmed-high (100) only; reproducible (has queryHash+query, run counterfactual, known grain, valued null)
  assert.equal(scoreClaimRisk(strong, accept('h1')), 100);
  // a downgrade on the same adds +80
  assert.equal(scoreClaimRisk(strong, { hypothesisId: 'h1', verdict: 'downgrade', reason: 'shaky', auditStatus: 'audited' }), 180);
});

test('selectRiskySubset: caps at ≤max, deterministically ordered (score desc → id), excludes score 0', () => {
  const weak = (id: string): Hypothesis => measured(id, { measurement: { metricId: 'm', value: 0.4, direction: 'higher', nulls: [{ name: 'f', value: 0.1 }], source: 'warehouse:q', supportsClaim: true, dataContract: { grain: 'request', joinKeys: [], biases: [] }, counterfactual: { state: 'run', delta: '-1pp' }, evidence: { ref: `measurement:${id}`, value: 0.4, source: 'warehouse:q', queryHash: 'h', query: 'SELECT 1', nulls: [{ name: 'f', value: 0.1 }] } } });
  const hyps = ['recsys-mle:h1', 'recsys-mle:h2', 'trust-safety:h1', 'analytics:h1'].map((id) => weak(id));
  const audits = hyps.map((h) => accept(h.id));
  const picks = selectRiskySubset(hyps, audits, [], 4);
  // all weak → all score 100 (confirmed-high) → tie broken by id; ≤4
  assert.equal(picks.length, 4);
  assert.deepEqual(picks, ['analytics:h1', 'recsys-mle:h1', 'recsys-mle:h2', 'trust-safety:h1']);  // id-sorted on ties
});

test('selectRiskySubset: a refuted (info) claim with strong evidence scores 0 and is excluded', () => {
  const refuted = measured('h1', { status: 'refuted', measurement: { metricId: 'm', value: 0.9, direction: 'higher', nulls: [{ name: 'f', value: 0.1 }], source: 'warehouse:q', supportsClaim: false, dataContract: { grain: 'request', joinKeys: [], biases: [] }, counterfactual: { state: 'run', delta: '+5pp' }, evidence: { ref: 'measurement:h1', value: 0.9, source: 'warehouse:q', queryHash: 'h', query: 'SELECT 1', nulls: [{ name: 'f', value: 0.1 }] } } });
  assert.deepEqual(selectRiskySubset([refuted], [accept('h1')], [], 4), []);
});

// ── applyReverify (pure) ───────────────────────────────────────────────────────────────────
test('applyReverify: reproduced + supporting → confirmed (reverified, verdict unchanged)', () => {
  const out = applyReverify(accept('h1'), { reproduced: true, supportsClaim: true, note: 'same 0.4' });
  assert.equal(out.verdict, 'accept');
  assert.equal(out.reverified, true);
  assert.equal(out.reverifyNote, 'same 0.4');
});

test('applyReverify: not-reproduced AND not-supporting → reject', () => {
  const out = applyReverify(accept('h1'), { reproduced: false, supportsClaim: false, note: 'got 0.9, opposite' });
  assert.equal(out.verdict, 'reject');
  assert.equal(out.reverified, true);
});

test('applyReverify: partial contradiction (not reproduced, still supporting) → downgrade', () => {
  const out = applyReverify(accept('h1'), { reproduced: false, supportsClaim: true, note: 'close but not identical' });
  assert.equal(out.verdict, 'downgrade');
  assert.equal(out.confidence, 'low');
});

test('applyReverify: skipped (undefined) → unchanged, not reverified', () => {
  const out = applyReverify(accept('h1'), undefined);
  assert.equal(out.verdict, 'accept');
  assert.ok(!out.reverified);
});

test('applyReverify: reproduced but supportsClaim MISSING → NOT auto-confirmed (downgrade)', () => {
  // a missing/non-boolean supportsClaim must not count as supporting — only an explicit both-true confirms.
  const out = applyReverify(accept('h1'), { reproduced: true, note: 'value matched but support unclear' });
  assert.equal(out.verdict, 'downgrade');
  assert.ok(out.reverified);
});

// ── workspace-first file evidence — a remote plane that can't see the repo is "unverifiable", never "reject" ──
// In one real run, api-stability:h6 (a TRUE finding about .github/workflows/claude-review.yml) was rejected because the
// re-verifier asked the GitHub REST plane — on a PAT that cannot see the scanned repo — instead of the clone.
test('evidencePathTokens pulls file paths out of compound refs, never prose or traversal', async () => {
  const { evidencePathTokens } = await import('./claimAudit.ts');
  assert.deepEqual(evidencePathTokens('code:.github/workflows/claude-review.yml:20-49 ; redis:scan(x)'), ['.github/workflows/claude-review.yml']);
  assert.deepEqual(evidencePathTokens('repo:src/server.ts + package.json'), ['src/server.ts', 'package.json']);
  assert.deepEqual(evidencePathTokens('the workflow has no gate'), []);
  assert.deepEqual(evidencePathTokens('code:../../etc/passwd.txt'), []);
});

test('a file the workspace clone has is resolved there (repo-relative, workspace-relative, owner-qualified)', async () => {
  const { resolveEvidenceInWorkspace, workspaceSettlesEvidence } = await import('./claimAudit.ts');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'ws-ev-'));
  try {
    mkdirSync(join(root, 'accel-scope', '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, 'accel-scope', '.github', 'workflows', 'claude-review.yml'), 'on: issue_comment');
    assert.deepEqual(resolveEvidenceInWorkspace('code:.github/workflows/claude-review.yml:20', root), ['.github/workflows/claude-review.yml']);
    assert.deepEqual(resolveEvidenceInWorkspace('code:accel-scope/.github/workflows/claude-review.yml', root), ['accel-scope/.github/workflows/claude-review.yml']);
    assert.deepEqual(resolveEvidenceInWorkspace('code:example-org/accel-scope/.github/workflows/claude-review.yml', root), ['example-org/accel-scope/.github/workflows/claude-review.yml']);
    assert.deepEqual(resolveEvidenceInWorkspace('code:.github/workflows/missing.yml', root), []);
    assert.deepEqual(resolveEvidenceInWorkspace('code:.github/workflows/claude-review.yml', undefined), []);
    // a LIVE-plane ref is re-derived by re-running the query, not by reading a file → never settled by the workspace
    const live = measured('h9', { measurement: { metricId: 'm', value: 1, direction: 'higher', nulls: [], source: 'warehouse:t.claude-review.yml', supportsClaim: true } });
    assert.deepEqual(workspaceSettlesEvidence(live, root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('"does not exist in the live read-only plane" on a file the clone HAS → unverifiable, verdict unchanged', () => {
  const out = applyReverify(accept('api-stability:h6'), { reproduced: false, supportsClaim: false, note: 'claude-review.yml does not exist in the live read-only plane' }, { workspaceFiles: ['.github/workflows/claude-review.yml'] });
  assert.equal(out.verdict, 'accept', 'the old code rejected this true finding');
  assert.ok(!out.reverified);
  assert.match(out.reverifyNote ?? '', /^unverifiable — .*exist in the run workspace/);
});

test('an explicit unverifiable reply is recorded, never a reject — even with no workspace hit', () => {
  const out = applyReverify(accept('h1'), { unverifiable: true, reproduced: false, supportsClaim: false, note: 'repogrep returned 404 for this repo' });
  assert.equal(out.verdict, 'accept');
  assert.match(out.reverifyNote ?? '', /^unverifiable — repogrep returned 404/);
});

test('a re-run that READ the workspace file and found the content contradicts the claim still rejects', () => {
  const out = applyReverify(accept('h1'), { reproduced: false, supportsClaim: false, note: 'the workflow already gates on author_association' }, { workspaceFiles: ['.github/workflows/claude-review.yml'] });
  assert.equal(out.verdict, 'reject');
  assert.equal(out.reverified, true);
});

// ── a CONTENT contradiction about a file that was read must not be mistaken for "could not reach it" ──
test('reverifyCouldNotReach: access wording / empty note → could not reach', () => {
  const ws = ['.github/workflows/claude-review.yml'];
  assert.equal(reverifyCouldNotReach(undefined, ws), true);
  assert.equal(reverifyCouldNotReach('accel-scope is unreachable/private; HTTP 404', ws), true);
  assert.equal(reverifyCouldNotReach('The claimed .github/workflows/claude-review.yml does not exist in the live read-only plane', ws), true);
  assert.equal(reverifyCouldNotReach('no such file claude-review.yml on the default branch', ws), true);
});
test('reverifyCouldNotReach: "X not found in <file>" is a content contradiction, not a miss', () => {
  const ws = ['src/a.ts'];
  assert.equal(reverifyCouldNotReach('the claimed guard isAdmin() is not found in src/a.ts', ws), false);
  assert.equal(reverifyCouldNotReach('value was 0.9, the opposite of the claim', ws), false);
});
test('applyReverify: content contradiction on a workspace-resolvable file still rejects', () => {
  const out = applyReverify(accept('h1'), { reproduced: false, supportsClaim: false, note: 'the claimed guard is not found in src/a.ts; the check exists at line 40' }, { workspaceFiles: ['src/a.ts'] });
  assert.equal(out.verdict, 'reject');
});

test('applyReverify: an explicit contradiction with NO note still rejects (empty note is not "could not reach")', () => {
  const out = applyReverify(accept('h1'), { reproduced: false, supportsClaim: false }, { workspaceFiles: ['src/a.ts'] });
  assert.equal(out.verdict, 'reject');
  assert.equal(out.reverified, true);
});
test('applyReverify: a non-reproduced re-run with NO note and no contradiction stays unverifiable', () => {
  const out = applyReverify(accept('h1'), { reproduced: false }, { workspaceFiles: ['src/a.ts'] });
  assert.equal(out.verdict, 'accept');
  assert.match(out.reverifyNote ?? '', /^unverifiable/);
});
