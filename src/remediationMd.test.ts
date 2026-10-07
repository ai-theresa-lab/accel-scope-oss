// REMEDIATION.md an agent can run. Evaluates the SAME builder text the browser runs (REMEDIATION_MD_JS,
// shared by the console export and the report's own Export / the /share retrofit) on a fixture with duplicates and
// ruled-out rows. Every assertion here fails on the previous builder (numbered "## 1." sections in input order, no
// merge, ruled-out list un-prefixed under "Ruled out (no action)", no preamble).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REMEDIATION_MD_JS } from './remediationMd.ts';
import { REMEDIATION_EXPORT_JS } from './reportHtml.ts';

type AnyFn = (...a: unknown[]) => unknown;
const R = new Function(`${REMEDIATION_MD_JS}; return { remediationIsRuledOut, remediationMarkdown, remediationSections, remediationDisplayIds };`)() as Record<string, AnyFn>;
const md = (o: unknown): string => R.remediationMarkdown(o) as string;

// A view-model row (reportHtml.ts buildViewModel shape): claim = headline, lensKey, effortRank (quick_win 1 · moderate 3 ·
// project 6), remediation rows.
const vm = (claim: string, severity: string, o: Record<string, unknown> = {}) => ({
  claim, severity, confidence: 'high', lensKey: 'correctness', lensLabel: 'Correctness', effortRank: 3, effortLabel: 'moderate',
  detail: `detail ${claim}`, evidence: [{ ref: `${claim.replace(/\s+/g, '-')}.ts:10`, detail: '' }],
  remediation: [{ k: 'Recommendation', v: `fix ${claim}` }, { k: 'Effort', v: 'moderate' }, { k: 'Source', v: 'baseline:i1' }], ...o,
});

const fixture = () => [
  vm('slow query', 'medium', { effortRank: 6, effortLabel: 'project' }),
  vm('missing index', 'medium', { effortRank: 1, effortLabel: 'quick win' }),
  // Two findings on the SAME primary file + lens (different lines): the critical one keeps the section.
  vm('auth bypass low', 'low', { evidence: [{ ref: 'src/auth.ts:40-44', detail: 'x' }] }),
  vm('auth bypass', 'critical', { evidence: [{ ref: 'src/auth.ts:12', detail: 'guard skipped' }], acceptance: 'unauthenticated request gets 401' }),
  // Same file, DIFFERENT lens: not merged.
  vm('auth perf', 'high', { lensKey: 'performance', lensLabel: 'Performance', evidence: [{ ref: 'src/auth.ts:90', detail: '' }] }),
  vm('healthy pool', 'info', { status: 'ruled-out', ruledOut: true }),
  vm('Ruled out: fresh cache', 'info', { status: 'ruled-out' }),
];

test('sections ordered by severity, then effort (quick wins first within a severity)', () => {
  const out = md({ title: 'org', findings: fixture() });
  const heads = [...out.matchAll(/^## (F-\d+) · \[(\w+)\] (.+)$/gm)].map((m) => m[3]);
  assert.deepEqual(heads, ['auth bypass', 'auth perf', 'missing index', 'slow query']);
});

test('same primary evidence file + same lens merge into the highest-severity section ("Also covers")', () => {
  const out = md({ title: 'org', findings: fixture() });
  assert.doesNotMatch(out, /^## F-\d+ · \[LOW\] auth bypass low$/m, 'the lower-severity duplicate is not its own section');
  const sec = out.split(/^## /m).find((s) => s.startsWith('F-01 · [CRITICAL] auth bypass'))!;
  assert.ok(sec, 'the critical one keeps the section');
  assert.match(sec, /\*\*Also covers:\*\*\n- F-05 — auth bypass low \[LOW\]/);
  assert.match(out, /^## F-02 · \[HIGH\] auth perf$/m, 'a different lens on the same file is not merged');
  assert.match(out, /_5 findings · 2 ruled out_/, 'the header still counts every confirmed finding (= run.findings)');
  assert.match(out, /_5 findings in 4 sections/);
});

test('section ids are the displayId, else the display-id order (severity, confidence, original order)', () => {
  // No displayId: computed over confirmed rows only — critical F-01, high F-02, medium x2 in original order, low F-05.
  assert.deepEqual(R.remediationDisplayIds(fixture().filter((f) => !R.remediationIsRuledOut(f))), ['F-03', 'F-04', 'F-05', 'F-01', 'F-02']);
  // Embedded displayId wins.
  const withIds = fixture().map((f, i) => ((f as Record<string, unknown>).status ? f : { ...f, displayId: `F-${String(90 + i)}` }));
  const out = md({ title: 'org', findings: withIds });
  assert.match(out, /^## F-93 · \[CRITICAL\] auth bypass$/m);
  assert.match(out, /- F-92 — auth bypass low/);
});

test('ruled-out rows are a final "Checked and ruled out — no action" list, prefixed once, never sections', () => {
  const out = md({ title: 'org', findings: fixture() });
  assert.doesNotMatch(out, /^## F-\d+ · \[INFO\]/m);
  const tail = out.slice(out.indexOf('## Checked and ruled out — no action'));
  assert.ok(out.indexOf('## Checked and ruled out — no action') > out.lastIndexOf('## F-'), 'it is the last list');
  assert.match(tail, /^- Ruled out: healthy pool — /m);
  assert.match(tail, /^- Ruled out: fresh cache — /m, 'an already-prefixed title is not double-prefixed');
  assert.doesNotMatch(out, /fix healthy pool/, 'no fix attached');
  // The `status` field wins over the legacy encoding in both directions.
  assert.equal(R.remediationIsRuledOut({ severity: 'high', status: 'ruled-out' }), true);
  assert.equal(R.remediationIsRuledOut({ severity: 'info', status: 'confirmed', remediation: [{ k: 'Source', v: 'recommendation-audit' }] }), false);
});

test('agent preamble, and each section keeps Evidence / Recommended fix / Acceptance', () => {
  const out = md({ title: 'org', findings: fixture() });
  const pre = out.indexOf('## How to use this file');
  assert.ok(pre > 0 && pre < out.indexOf('## F-'), 'the preamble opens the file');
  assert.match(out, /Work top to bottom/);
  assert.match(out, /one commit per section/i);
  assert.match(out, /Run the test suite after each section/);
  const sec = out.split(/^## /m).find((s) => s.startsWith('F-01 · '))!;
  assert.match(sec, /\*\*Evidence:\*\*\n- src\/auth\.ts:12 — guard skipped/);
  assert.match(sec, /\*\*Recommended fix:\*\* fix auth bypass/);
  assert.match(sec, /\*\*Acceptance:\*\* unauthenticated request gets 401/);
  assert.doesNotMatch(sec, /\*\*Source:\*\*/, 'internal provenance rows are not agent instructions');
  const other = out.split(/^## /m).find((s) => s.startsWith('F-02 · '))!;
  assert.doesNotMatch(other, /\*\*Acceptance:\*\*/, 'Acceptance only when present');
});

test('the report Export / share retrofit runs this exact builder', () => {
  assert.ok(REMEDIATION_EXPORT_JS.includes(REMEDIATION_MD_JS.trim()));
  assert.doesNotThrow(() => new Function(REMEDIATION_EXPORT_JS));
  assert.doesNotMatch(REMEDIATION_MD_JS, /`|\$\{|<\/script>/i, 'safe to embed in a <script>');
});

test('the preamble explains only the parts the file has; headings carry no stray whitespace', () => {
  const plain = md({ title: 'org', findings: [vm('slow query ', 'medium'), vm('missing index', 'low')] });
  assert.doesNotMatch(plain, /Also covers/, 'no merged sections → no "Also covers" instruction');
  assert.doesNotMatch(plain, /Checked and ruled out/, 'no ruled-out rows → no ruled-out instruction');
  assert.doesNotMatch(plain, /^## .* $/m, 'no trailing space on a heading');
  const full = md({ title: 'org', findings: fixture() });
  assert.match(full, /A section marked "Also covers"/);
  assert.match(full, /The "Checked and ruled out" list at the end is not work/);
});
