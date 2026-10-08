// Two-report model — the Execution report's data, its rendering, the Leadership
// brief's Area health block, the appendix, and the org-run pipeline shipping exactly two reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areaHealthThemes, buildExecutionModel, executionGroups, executionItemFor } from './executionModel.ts';
import { historyFragmentHtml } from './executionAppendix.ts';
import { renderFindingsHtml } from './reportHtml.ts';
import { buildReportRefs, injectDetailIndex, reinjectDetailIndex } from './reportAnchors.ts';
import { REMEDIATION_MD_JS } from './remediationMd.ts';
import type { Finding, CoverageGap } from './schema.ts';
import type { Hypothesis } from './research/investigation.ts';
import type { Mitigation, SynthesisArea } from './research/deep.ts';

const finding = (id: string, title: string, o: Partial<Finding> = {}): Finding => ({
  id, dimension: 'product_metrics' as Finding['dimension'], title, claim: `${title} — claim`, evidence: [{ kind: 'file', ref: `src/${id.toLowerCase().replace(/[^a-z0-9]/g, '')}.ts:10`, detail: 'd' }],
  businessImpact: 'impact', recommendation: 'No specific fix was drafted — fix the problem described above.', severity: 'medium',
  confidence: 'high', effort: 'moderate', source: 'recommendation-audit', ...o,
});
const hyp = (id: string, o: Partial<Hypothesis> = {}): Hypothesis => ({
  id, claim: 'c', symptom: 's', status: 'supported', decisiveMetric: 'm',
  measurement: { metricId: 'm', value: 1, direction: 'lower', nulls: [{ name: 'pinned', value: 0 }], evidence: { ref: 'r', value: 1, source: 'code', nulls: [], query: 'grep -n uuid src/route.ts' } },
  ...o,
} as Hypothesis);
const mit = (hypothesisId: string): Mitigation => ({ hypothesisId, supported: true, mitigation: 'm', lever: 'Use a random uuid at route.ts:196', expectedEffect: 'collisions 1→0', guardrail: 'visit continuity holds', grounding: 'g' });
const areas: SynthesisArea[] = [
  { key: 'kpi', name: 'KPI definition integrity', verdict: 'critical', framing: 'Same metric, different SQL.', owner: 'x', basis: ['release-eng:h2', 'data-eng:h3', 'api-stability:h1'] },
  { key: 'counts', name: 'Visitor & visit counts', verdict: 'risk', framing: 'Humans miscounted.', owner: 'x', basis: ['data-eng:h1'] },
];
const findings = [finding('DATA-ENG:H1', 'visit id collides'), finding('DATA-ENG:H3', 'bounce predicate two ways', { severity: 'low' }), finding('RELEASE-ENG:H2', 'bounces SQL inconsistent')];
const gaps: CoverageGap[] = [
  { id: 'API-STABILITY:H1', concern: 'estimator differs', whyUnsettled: 'not measured', nextDecisiveTest: 'run both', source: 'recommendation-audit', status: 'unmeasured', hypothesisId: 'api-stability:h1' },
  { id: 'DATA-ENG:H5', concern: 'geo db unpinned', whyUnsettled: 'budget', nextDecisiveTest: 'pin it', source: 'recommendation-audit', status: 'budget_skipped', hypothesisId: 'data-eng:h5', bundleId: 'data-eng' },
];
const model = () => buildExecutionModel({ findings, hypotheses: [hyp('data-eng:h1'), hyp('data-eng:h3', { measurement: undefined, evalProposal: { metric: 'x', what: 'w', why: 'y', how: 'Seed both branches and compare' } as Hypothesis['evalProposal'] }), hyp('release-eng:h2')], mitigations: [mit('data-eng:h1')], gaps, areas });

test('executionItemFor: fix = the lever, done-when = the null, verify = the query (else the next decisive test), found by = the bundle', () => {
  const it = executionItemFor(findings[0], hyp('data-eng:h1'), mit('data-eng:h1'));
  assert.equal(it.fix, 'Use a random uuid at route.ts:196');
  assert.equal(it.expectedEffect, 'collisions 1→0');
  assert.equal(it.guardrail, 'visit continuity holds');
  assert.equal(it.doneWhen, 'The same check, re-run, meets: pinned=0.');
  assert.equal(it.verify, 'grep -n uuid src/route.ts'); assert.equal(it.verifyKind, 'query');
  assert.equal(it.foundBy, 'Data engineering (pipelines / warehouse)');
  const noMit = executionItemFor(findings[1], hyp('data-eng:h3', { measurement: undefined, evalProposal: { how: 'Seed both branches' } as Hypothesis['evalProposal'] }), undefined);
  assert.match(noMit.fix ?? '', /^No specific fix was drafted/, 'no mitigation → the honest recommendation, never blank');
  assert.equal(noMit.verifyKind, 'procedure'); assert.equal(noMit.verify, 'Seed both branches');
  assert.equal(noMit.doneWhen, undefined);
});

test('executionGroups: by synthesis theme (not by bundle); budget-skipped checks get their own last group; no areas → by bundle', () => {
  const g = executionGroups(findings, gaps, areas);
  assert.deepEqual(g.map((x) => x.name), ['KPI definition integrity', 'Visitor & visit counts', 'Planned, not examined (run budget ran out)']);
  assert.deepEqual(g[0].findingIds, ['DATA-ENG:H3', 'RELEASE-ENG:H2'], 'two bundles, one theme — near-duplicates sit together');
  assert.deepEqual(g[0].gapIds, ['API-STABILITY:H1']);
  assert.deepEqual(g[2].gapIds, ['DATA-ENG:H5']);
  const byBundle = executionGroups(findings, [], undefined);
  assert.deepEqual(byBundle.map((x) => x.name), ['Data engineering (pipelines / warehouse)', 'Build / CI / release engineering']);
  const fallback = executionGroups(findings, [], [{ key: 'confirmed-defects', name: 'Confirmed defects', verdict: 'critical', framing: 'x', owner: '', basis: ['data-eng:h1', 'data-eng:h3', 'release-eng:h2'] }]);
  assert.deepEqual(fallback.map((x) => x.name), ['Data engineering (pipelines / warehouse)', 'Build / CI / release engineering'], 'the disposition fallback is not a theme');
  const themes = areaHealthThemes(g);
  assert.deepEqual(themes.map((t) => t.key), ['kpi', 'counts'], 'Area health shows themes only — not the unexamined / other buckets');
  assert.equal(themes[0].gapCount, 1);
});

test('Execution report: Work plan / Findings / Appendix, per-finding fix · done when · verify, no answer-back (leadership owns it)', () => {
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · umami', metrics: { summary: { org: true } }, findings, coverageGaps: gaps,
    answerBack: [{ concern: 'Are metrics consistent?', status: 'supported' } as never], execution: model() }, '2026-09-27T00:00:00Z', false, 'check metrics');
  assert.match(html, /<title>Waggle · organization · umami · execution report<\/title>/);
  assert.match(html, /data-tab="overview">Work plan</); assert.match(html, /data-tab="evidence">Appendix</);
  assert.match(html, /<h2>KPI definition integrity<\/h2><span class="tagx"[^>]*>Critical<\/span>/);
  assert.match(html, /Needs a test · 1 open question in this area/);
  assert.match(html, /Planned, not examined \(run budget ran out\)/);
  assert.doesNotMatch(html, /What we found, mapped to your brief/, 'no answer-back block');
  const data = JSON.parse(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/.exec(html)![1]);
  assert.equal(data.mode, 'execution');
  const f1 = data.findings.find((f: { id: string }) => f.id === 'DATA-ENG:H1');
  assert.equal(f1.acceptance, 'The same check, re-run, meets: pinned=0.');
  assert.equal(f1.verify, 'grep -n uuid src/route.ts');
  assert.equal(f1.group, 'Visitor & visit counts');
  assert.equal(f1.lensLabel, 'Visitor & visit counts', 'the Findings pane filters by theme');
  assert.ok(f1.remediation.some((r: { k: string; v: string }) => r.k === 'Recommended fix' && /random uuid/.test(r.v)));
  assert.ok(!f1.remediation.some((r: { k: string }) => r.k === 'Source'), 'internal provenance rows are dropped');
  // Work-plan rows use their own attribute, so a Leadership deep link (#finding-…) still resolves to the finding card.
  assert.doesNotMatch(html, /data-act="gotofinding" data-anchor-id=/);
  // REMEDIATION.md (same builder the Export button runs) carries Acceptance + How to verify.
  const md = (new Function(`${REMEDIATION_MD_JS}; return remediationMarkdown;`)() as (o: unknown) => string)({ title: 't', findings: data.findings });
  assert.match(md, /\*\*Acceptance:\*\* The same check, re-run, meets: pinned=0\./);
  assert.match(md, /\*\*How to verify:\*\*\n\n```\ngrep -n uuid src\/route\.ts\n```/);
});

test('Execution: a caller without an execution model gets the detailed report unchanged', () => {
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · x', metrics: {}, findings }, '2026-09-27T00:00:00Z');
  assert.match(html, /diagnostic report/); assert.doesNotMatch(html, /execution report/);
});

test('Leadership Area health: one row per theme with verdict + F-id links, no finding titles (no-overlap rule)', () => {
  const refs = buildReportRefs(findings, '/api/runs/rs_x/report');
  const themes = areaHealthThemes(executionGroups(findings, gaps, areas));
  const doc = '<html><body><div class="wrap"><h1>Brief</h1></div></body></html>';
  const out = injectDetailIndex(doc, refs, { themes });
  assert.equal((out.match(/class="detail-index area-health"/g) ?? []).length, 1, 'one block');
  assert.match(out, /Area health/);
  assert.match(out, />KPI definition integrity<\/span> <span[^>]*>Critical</);
  assert.match(out, /<a href="\/api\/runs\/rs_x\/report#finding-[^"]+"[^>]*>F-0\d<\/a>/);
  for (const f of findings) assert.ok(!out.includes(f.title), `no finding title in the brief: ${f.title}`);
  assert.doesNotMatch(out, /Where the detail lives/);
  const again = reinjectDetailIndex(out, refs, { themes });
  assert.equal((again.match(/class="detail-index area-health"/g) ?? []).length, 1, 'idempotent re-inject');
  assert.equal(again, out);
});

test('Execution appendix: the git-history spine renders as facts (phases, dead ends, reverts, ownership)', () => {
  const html = historyFragmentHtml([{ repo: 'umami', totalCommits: 42, span: ['2020-01-01', '2026-09-16'],
    phases: [{ n: 1, start: '2020-01-01T00:00:00Z', end: '2021-01-01T00:00:00Z', commits: 30, authors: { alice: 20, bob: 10 }, topDirs: [['src/lib', 12]], sampleSubjects: [], anchorShas: [] }],
    deadEnds: [{ dir: 'src/old', filesDeleted: 3, firstAdded: '2020-03-01', deletedAround: [], deleteCommits: [], deleteSubjects: ['remove old <thing>'], sampleFiles: [] }],
    reverts: [{ sha: 'abcdef1234', date: '2021-02-02', subject: 'Revert "x"' }], ownership: [{ author: 'alice', commits: 20, first: '2020-01-01', last: '2026-01-01' }] }]);
  assert.match(html, /umami/); assert.match(html, /Dead ends — added, then removed/); assert.match(html, /src\/old/);
  assert.match(html, /remove old &lt;thing&gt;/, 'escaped'); assert.match(html, /abcdef1/); assert.equal(historyFragmentHtml([]), '');
});

test('Org-run pipeline ships exactly two reports: no area-report authoring, reconcile, normalizer or provenance report', () => {
  const src = readFileSync(new URL('./run/execute-org-run.ts', import.meta.url), 'utf8');
  for (const call of ['writeBundleReport(', 'writeAnalystReport(', 'reconcileAreaReports(', 'normalizeReports(', 'buildProvenanceReport(', 'appendCodeintelViz(']) assert.ok(!src.includes(call), `no ${call}`);
  assert.doesNotMatch(src, /areaReport: \{/, 'the Expert no longer authors an area report in its session');
  assert.doesNotMatch(src, /saveReport\(run\.id \+ '-bundle-'|saveReport\(run\.id \+ '-combined'|saveReport\(run\.id \+ '-provenance'/);
  assert.match(src, /buildExecutionModel\(/); assert.match(src, /\.\.\.\(execution \? \{ execution \} : \{\}\)/);
});

// Incremental re-scan: each finding is tagged new / persisting since <date> /
// changed in the Work plan (+ its card), the plan closes with "Fixed since last scan", and a baseline finding whose review
// did not run is listed as not re-checked (never fixed). A reused lane's live measurement is carried as "measured <date>".
test('Execution report: since-last-scan tags, the closing Fixed list, not-re-checked rows and measuredOn', () => {
  const m = buildExecutionModel({ findings, hypotheses: [hyp('data-eng:h1')], mitigations: [mit('data-eng:h1')], gaps, areas, measuredOnByBundle: { 'data-eng': '2026-09-01' } });
  assert.equal(m.items['DATA-ENG:H1'].measuredOn, '2026-09-01');
  assert.equal(m.items['RELEASE-ENG:H2'].measuredOn, undefined);
  const withSince = { ...m, sinceLastScan: {
    baseline: { runId: 'rs_base', date: '2026-09-01', sha: 'abcdef1234' },
    counts: { fixed: 1, new: 1, persisting: 1, changed: 1, unchecked: 1 },
    tags: { 'DATA-ENG:H1': { status: 'persisting' as const, since: '2026-08-01' }, 'DATA-ENG:H3': { status: 'new' as const }, 'RELEASE-ENG:H2': { status: 'changed' as const } },
    fixed: [{ title: 'old defect gone', severity: 'high', displayId: 'F-02' }],
    unchecked: [{ title: 'appsec thing', severity: 'medium' }],
  } };
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · umami', metrics: { summary: { org: true } }, findings, coverageGaps: gaps, execution: withSince }, '2026-09-27T00:00:00Z');
  assert.match(html, /persisting since 2026-08-01/);
  assert.match(html, />new</);
  assert.match(html, />changed</);
  assert.match(html, /Fixed since last scan/);
  assert.match(html, /old defect gone/);
  assert.match(html, /F-02 \(then\)/);
  assert.match(html, /1 fixed · 1 new · 1 persisting · 1 changed/);
  assert.match(html, /Not counted as fixed · 1/);
  assert.match(html, /"measuredOn":"2026-09-01"/, 'the card data carries the carried measurement date');
  const plain = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · umami', metrics: { summary: { org: true } }, findings, coverageGaps: gaps, execution: m }, '2026-09-27T00:00:00Z');
  assert.doesNotMatch(plain, /Fixed since last scan/, 'no baseline → no since section');
  // The Execution hero starts straight at the work: no big "N findings to fix · M to test" title, no how-to paragraph.
  const hero = plain.slice(plain.indexOf('class="hero-in"'), plain.indexOf('class="herostats"'));
  assert.doesNotMatch(hero, /<h1\b/);
  assert.doesNotMatch(plain, /Work top to bottom within a theme/);
  assert.match(hero, /Execution report · how to fix it and how to prove it is fixed/);
});

test('E2E 2026-10-01 #3: the Execution "Not counted as fixed" rows name each reason', () => {
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · umami', metrics: { summary: { org: true } }, findings, coverageGaps: gaps, execution: { ...model(), sinceLastScan: {
    baseline: { runId: 'rs_base', date: '2026-10-01' }, counts: { fixed: 0, new: 0, persisting: 0, changed: 0, unchecked: 3 }, tags: {}, fixed: [],
    unchecked: [{ title: 'share token', severity: 'high', why: 'recheck-budget' }, { title: 'reset rows', severity: 'high', why: 'not-run' }, { title: 'bounce', severity: 'medium', why: 'recheck-unsettled' }],
  } } }, '2026-10-01T00:00:00Z');
  assert.match(html, /<b>share token<\/b> <span class="gap-why">its targeted re-check was skipped — the run budget \(or the per-run re-check cap\) ran out, so it is not counted as fixed/);
  assert.match(html, /<b>reset rows<\/b> <span class="gap-why">the review that raised it did not run in this scan, so it is not counted as fixed/);
  assert.match(html, /<b>bounce<\/b> <span class="gap-why">its targeted re-check ran but could not settle it, so it is not counted as fixed/);
});
