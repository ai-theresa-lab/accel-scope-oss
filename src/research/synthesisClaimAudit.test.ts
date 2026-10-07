import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSynthesisClaims, parseSynthesisAudits, applySynthesisAudit, synthesisAuditPrompt, type SynthesisCandidate } from './synthesisClaimAudit.ts';
import type { DeepSynthesis } from './deep.ts';
import type { SynthesisClaim } from '../schema.ts';

const synth = (over: Partial<DeepSynthesis> = {}): DeepSynthesis => ({
  bottomLine: '• Recall is the bottleneck across bundles\n• Cost is healthy',
  leads: [
    { title: 'Raising the candidate pool will lift engagement 12%', detail: 'd', grounding: 'g', basis: ['recsys-mle:h1'] },
    { title: 'Metric definitions agree across surfaces', detail: 'd', grounding: 'g', basis: ['analytics:h1'] },
  ],
  areas: [{ key: 'recsys', name: 'Recommendations', verdict: 'critical', framing: 'f', owner: '', basis: ['recsys-mle:h1'] }],
  ...over,
});

// ── extract: bottom-line bullets + leads become candidates with stable ids ────────────────────────
test('extractSynthesisClaims: bullets + leads → candidates with stable ids', () => {
  const c = extractSynthesisClaims(synth());
  assert.deepEqual(c.map((x) => x.id), ['synth:bottomLine:0', 'synth:bottomLine:1', 'synth:lead:0', 'synth:lead:1']);
  assert.equal(c[0].text, 'Recall is the bottleneck across bundles');   // bullet marker stripped
  assert.equal(c[2].target, 'lead');
  assert.deepEqual(c[2].basis, ['recsys-mle:h1']);
});

test('extractSynthesisClaims: undefined / empty → no candidates', () => {
  assert.deepEqual(extractSynthesisClaims(undefined), []);
  assert.deepEqual(extractSynthesisClaims({ bottomLine: '', leads: [] }), []);
});

const cands = (): SynthesisCandidate[] => extractSynthesisClaims(synth());

// ── parse: fail-closed on missing / unknown ───────────────────────────────────────────────────────
test('parseSynthesisAudits: parses scope+verdict; covered_by_basis + accept + downgrade + reject', () => {
  const text = '```json\n{"claims":[' +
    '{"id":"synth:bottomLine:0","scope":"synthesis_introduced","verdict":"accept","reason":"follows"},' +
    '{"id":"synth:bottomLine:1","scope":"covered_by_basis","verdict":"accept","reason":"restatement"},' +
    '{"id":"synth:lead:0","scope":"synthesis_introduced","verdict":"downgrade","reason":"no measured +12%","allowedWording":"A larger pool may help engagement"},' +
    '{"id":"synth:lead:1","scope":"synthesis_introduced","verdict":"reject","reason":"not measured cross-surface"}' +
    ']}\n```';
  const out = parseSynthesisAudits(text, cands());
  assert.equal(out.length, 4);
  assert.equal(out[0].verdict, 'accept');
  assert.equal(out[1].scope, 'covered_by_basis');
  assert.equal(out[2].verdict, 'downgrade');
  assert.equal(out[2].allowedWording, 'A larger pool may help engagement');
  assert.equal(out[3].verdict, 'reject');
  for (const x of out) assert.equal(x.auditStatus, 'audited');
});

test('parseSynthesisAudits: a candidate MISSING from the reply → fail-closed reject (unparseable)', () => {
  const text = '```json\n{"claims":[{"id":"synth:bottomLine:0","scope":"synthesis_introduced","verdict":"accept","reason":"ok"}]}\n```';
  const out = parseSynthesisAudits(text, cands());
  const missing = out.filter((c) => c.id !== 'synth:bottomLine:0');
  assert.ok(missing.length === 3 && missing.every((c) => c.verdict === 'reject' && c.auditStatus === 'unparseable'));
});

test('parseSynthesisAudits: an unparseable reply → ALL candidates fail-closed', () => {
  const out = parseSynthesisAudits('no json', cands());
  assert.ok(out.length === 4 && out.every((c) => c.verdict === 'reject' && c.auditStatus === 'unparseable'));
});

// ── apply: gate the synthesis ──────────────────────────────────────────────────────────────────────
const aud = (id: string, over: Partial<SynthesisClaim>): SynthesisClaim => ({ id, target: id.includes('lead') ? 'lead' : 'bottomLine', index: 0, text: '', basis: [], scope: 'synthesis_introduced', verdict: 'accept', reason: 'r', auditStatus: 'audited', ...over });

test('applySynthesisAudit: accept + covered keep, downgrade replaces, reject + non-audited DROP', () => {
  const claims: SynthesisClaim[] = [
    aud('synth:bottomLine:0', { verdict: 'accept' }),                                        // keep
    aud('synth:bottomLine:1', { verdict: 'reject' }),                                        // drop
    aud('synth:lead:0', { verdict: 'downgrade', allowedWording: 'A larger pool may help' }), // replace
    aud('synth:lead:1', { verdict: 'accept', scope: 'covered_by_basis' }),                   // keep
  ];
  const g = applySynthesisAudit(synth(), claims)!;
  assert.equal(g.bottomLine, '• Recall is the bottleneck across bundles');   // bullet 1 dropped
  assert.equal(g.leads.length, 2);
  assert.equal(g.leads[0].title, 'A larger pool may help');                  // downgraded → caveated wording
  assert.equal(g.leads[1].title, 'Metric definitions agree across surfaces');
  assert.deepEqual(g.areas, synth().areas);                                  // areas unchanged (basis-linked grouping labels)
});

test('applySynthesisAudit: a downgraded lead CLEARS its original (overclaiming) detail', () => {
  // synthesisOverview renders lead.detail too — a downgraded title with stale detail would leak past the caveat.
  const claims: SynthesisClaim[] = extractSynthesisClaims(synth()).map((c) => aud(c.id, { verdict: c.id === 'synth:lead:0' ? 'downgrade' : 'accept', allowedWording: c.id === 'synth:lead:0' ? 'A larger pool may help' : undefined }));
  const g = applySynthesisAudit(synth(), claims)!;
  assert.equal(g.leads[0].title, 'A larger pool may help');
  assert.equal(g.leads[0].detail, '');                       // original detail cleared
  assert.equal(g.leads[1].detail, 'd');                      // an accepted lead keeps its detail
});

test('applySynthesisAudit: a MISSING audit row drops the claim (fail-closed)', () => {
  // only one bullet has an audit row; the rest (no row) must drop, not keep.
  const g = applySynthesisAudit(synth(), [aud('synth:bottomLine:0', { verdict: 'accept' })]);
  assert.equal(g!.bottomLine, '• Recall is the bottleneck across bundles');   // bullet 1 + both leads dropped (no row)
  assert.equal(g!.leads.length, 0);
});

test('applySynthesisAudit: a downgrade WITHOUT allowedWording is DROPPED (no caveat fallback for synthesis prose)', () => {
  const claims: SynthesisClaim[] = extractSynthesisClaims(synth()).map((c) => aud(c.id, { verdict: c.id === 'synth:lead:0' ? 'downgrade' : 'accept' }));
  const g = applySynthesisAudit(synth(), claims)!;
  assert.equal(g.leads.length, 1);   // lead:0 downgraded w/o wording → dropped
  assert.equal(g.leads[0].title, 'Metric definitions agree across surfaces');
});

test('applySynthesisAudit: a non-audited claim is DROPPED (fail-closed)', () => {
  const claims: SynthesisClaim[] = extractSynthesisClaims(synth()).map((c) => aud(c.id, { auditStatus: c.id === 'synth:bottomLine:0' ? 'unparseable' : 'audited', verdict: c.id === 'synth:bottomLine:0' ? 'reject' : 'accept' }));
  const g = applySynthesisAudit(synth(), claims)!;
  assert.equal(g.bottomLine, '• Cost is healthy');   // bullet 0 fail-closed dropped
});

test('applySynthesisAudit: everything dropped → undefined (synthesis omitted)', () => {
  const claims: SynthesisClaim[] = extractSynthesisClaims(synth()).map((c) => aud(c.id, { verdict: 'reject' }));
  assert.equal(applySynthesisAudit(synth(), claims), undefined);
});

// ── prompt ───────────────────────────────────────────────────────────────────────────────────────
test('synthesisAuditPrompt: surfaces the verdicts as ground truth + the covered/introduced grammar', () => {
  const p = synthesisAuditPrompt(cands(), [{ id: 'recsys-mle:h1', claim: 'recall starves diversity', symptom: 's', status: 'supported', decisiveMetric: 'm', measurement: { metricId: 'm', value: 0.1, direction: 'higher', nulls: [], supportsClaim: true } } as any], []);
  assert.match(p, /recsys-mle:h1/);
  assert.match(p, /covered_by_basis\|synthesis_introduced/);
  assert.match(p, /NOT re-auditing/i);
});
