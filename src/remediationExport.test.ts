// REMEDIATION.md enumerated EVERY embedded row, so the 5 refuted hypotheses of one run shipped as
// remediation items with a "Recommendation", and the item count (53) disagreed with the header (48). REMEDIATION_MD_JS
// is the one builder both exports run (the report's own Export + serve-time retrofit, and the console run page); it is
// evaluated here with `new Function`, exactly the text the browser gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REMEDIATION_EXPORT_JS, renderFindingsHtml } from './reportHtml.ts';
// The builder moved to its own module (remediationMd.ts); reportHtml.ts re-exports it into REMEDIATION_EXPORT_JS.
import { REMEDIATION_MD_JS } from './remediationMd.ts';
import { renderApp } from './serverUi.ts';

type AnyFn = (...a: unknown[]) => unknown;
const R = new Function(`${REMEDIATION_MD_JS}; return { remediationIsRuledOut, remediationMarkdown };`)() as Record<string, AnyFn>;
const md = (o: unknown): string => R.remediationMarkdown(o) as string;

const row = (claim: string, severity: string, extra: Record<string, unknown> = {}) => ({
  claim, severity, detail: `detail ${claim}`, evidence: [{ ref: 'a.ts:1', detail: '' }],
  remediation: [{ k: 'Recommendation', v: `fix ${claim}` }, { k: 'Source', v: 'recommendation-audit' }], ...extra,
});

test('remediationMarkdown enumerates confirmed findings only and lists ruled-out rows under "Checked and ruled out — no action"', () => {
  const out = md({ title: 'org', findings: [row('stale store', 'high', { ruledOut: false }), row('healthy pool', 'info', { ruledOut: true }), row('drift', 'medium', { ruledOut: false, evidence: [{ ref: 'b.ts:2', detail: '' }] })] });
  assert.match(out, /_2 findings · 1 ruled out_/, 'header count = confirmed count, ruled-out named beside it');
  assert.match(out, /## F-01 · \[HIGH\] stale store/);
  assert.match(out, /## F-02 · \[MEDIUM\] drift/);
  assert.doesNotMatch(out, /## F-\d+ · \[INFO\] healthy pool/, 'a refuted hypothesis is not a numbered remediation item');
  assert.doesNotMatch(out, /fix healthy pool/, 'no fix is attached to a ruled-out row');
  assert.match(out, /## Checked and ruled out — no action\n[\s\S]*- Ruled out: healthy pool — detail healthy pool/);
});

test('a report stored before the ruledOut flag is filtered by the same isRuledOutFinding encoding', () => {
  // No `ruledOut` field: severity info + a "Source: recommendation-audit" remediation row ⇒ ruled out.
  const legacyRefuted = row('healthy pool', 'info');
  const baselineInfo = { ...row('info-level baseline defect', 'info'), remediation: [{ k: 'Source', v: 'baseline:i1' }] };
  assert.equal(R.remediationIsRuledOut(legacyRefuted), true);
  assert.equal(R.remediationIsRuledOut(baselineInfo), false, 'an info finding from another source is still confirmed');
  assert.equal(R.remediationIsRuledOut(row('x', 'high')), false);
  const out = md({ title: 'org', findings: [legacyRefuted, baselineInfo] });
  assert.match(out, /_1 finding · 1 ruled out_/);
  assert.match(out, /## F-01 · \[INFO\] info-level baseline defect/);
});

test('header prefix/suffix, empty note and the recommendation fallback', () => {
  assert.match(md({ title: 'r', findings: [], before: 'agentic run · ', after: ' · $1.00', emptyNote: 'nothing embeddable' }), /^# Remediation — r\n\n_agentic run · 0 findings · \$1\.00_\n\nnothing embeddable\n$/);
  const out = md({ title: 'r', findings: [{ title: 'legacy', severity: 'low', recommendation: 'do it' }] });
  assert.match(out, /## F-01 · \[LOW\] legacy\n\n\*\*Recommended fix:\*\* do it/);
});

test('the rendered report embeds the ruledOut flag and its Export runs the shared builder', () => {
  const f = (id: string, severity: 'high' | 'info') => ({ id, invariant: 'i1', title: `t ${id}`, claim: `claim ${id}`, severity, confidence: 'high', effort: 'low', dimension: 'code', source: 'recommendation-audit', recommendation: 'fix', evidence: [{ kind: 'file', ref: 'a.ts:1' }] });
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'org', metrics: { summary: { org: true, repos: 1, commits: 5 } }, findings: [f('a', 'high'), f('b', 'info')] } as never, '2026-09-25');
  const vm = JSON.parse(html.match(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/)![1]);
  const out = md({ title: 'org', findings: vm.findings });
  assert.match(out, /_1 finding · 1 ruled out_/);
  assert.match(out, /## F-01 · \[HIGH\] t a/);
  assert.ok(REMEDIATION_EXPORT_JS.startsWith(REMEDIATION_MD_JS), 'the report Export (and its serve-time retrofit) carries the builder');
  assert.doesNotThrow(() => new Function(REMEDIATION_EXPORT_JS));
  const client = renderApp();
  assert.ok(client.includes(REMEDIATION_MD_JS.trim()), 'the console run-page export embeds the same builder');
  assert.match(client, /var md=remediationMarkdown\(\{ title: runTitle\(run\)/, 'and calls it');
});
