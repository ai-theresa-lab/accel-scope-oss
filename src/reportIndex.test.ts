// The deterministic findings index at the top of the Combined report.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { backfillFindingsIndex, combinedTabs, evidenceTier, FINDINGS_INDEX_CLOSE, FINDINGS_INDEX_OPEN, findingsIndexRows, injectFindingsIndex, stripFindingsIndex } from './reportIndex.ts';
import { renderFindingsHtml } from './reportHtml.ts';
import { buildReportRefs } from './reportAnchors.ts';
import type { Finding } from './schema.ts';

const f = (id: string, title: string, extra: Partial<Finding> = {}): Finding => ({
  id, dimension: 'code_health', title, claim: title, evidence: [{ kind: 'file', ref: 'src/a.ts:10-12' }], businessImpact: 'b',
  recommendation: 'r', severity: 'high', confidence: 'high', effort: 'moderate', source: 'research', ...extra,
});
const FINDINGS = [
  f('RE2-01', 'Floating action tags', { invariant: 're2', severity: 'medium' }),
  f('SWE-ARCH:H3', 'Cache is healthy', { severity: 'info', source: 'recommendation-audit' }),
  f('SWE-ARCH:H1', 'Layer cycle', { severity: 'critical', source: 'recommendation-audit' }),
  f('GCP-1', 'Stale table', { severity: 'low', evidence: [{ kind: 'metric', ref: 'warehouse:q1' }] }),
];
// The Combined report's real shape (normalizer output): header + tab bar, then one data-report-tab panel per source.
const COMBINED = '<!doctype html><html><head><title>c</title></head><body><header class="app-header"><nav class="tabbar">'
  + '<button id="tab-leadership" data-report-nav="leadership">Leadership</button>'
  + '<button id="tab-swe-arch" data-report-nav="swe-arch">Software architecture &amp; code health</button>'
  + '<button id="tab-release-eng" data-report-nav="release-eng">Build / CI / release engineering</button>'
  + '</nav></header><main class="app-main"><style>#rp-x{}</style>'
  + '<section class="rp-panel active" data-report-tab="leadership">L</section>'
  + '<section class="rp-panel" data-report-tab="swe-arch">S</section><section class="rp-panel" data-report-tab="release-eng">R</section>'
  + '</main></body></html>';

test('the index is injected above the first area panel, bracketed, with the display ids and a deep link', () => {
  const out = injectFindingsIndex(COMBINED, FINDINGS, { engineeringUrl: '/api/runs/rs_1/report' });
  const a = out.indexOf(FINDINGS_INDEX_OPEN);
  const b = out.indexOf(FINDINGS_INDEX_CLOSE);
  assert.ok(a > 0 && b > a, 'bracketed');
  assert.ok(a < out.indexOf('data-report-tab="leadership"'), 'the Combined report starts with the index, above every tab');
  assert.ok(a > out.indexOf('</nav>'), 'but below the header + tab bar');
  const block = out.slice(a, b);
  // Same run → same id: the leadership list's F-01 is this index's F-01, linked to the same anchor.
  const refs = buildReportRefs(FINDINGS, '/api/runs/rs_1/report');
  assert.equal(refs[0].displayId, 'F-01');
  assert.ok(block.includes(`<a href="${refs[0].href}">F-01</a>`), 'F-01 links to the engineering-report anchor');
  assert.ok(block.indexOf('F-01') < block.indexOf('F-02') && block.indexOf('F-02') < block.indexOf('F-03'), 'sorted like the display ids');
  assert.match(block, /Layer cycle/);
  assert.match(block, /data-fi-tab="swe-arch">Software architecture &amp; code health</, 'names the area tab that discusses it');
  assert.match(block, /data-fi-tab="release-eng">Build \/ CI \/ release engineering</);
  assert.match(block, /<td>Measured<\/td>/, 'a live-plane metric is "Measured"');
  assert.match(block, /<td>Read from code<\/td>/);
  assert.match(block, /<code>src\/a\.ts:10-12<\/code>/, 'the primary evidence ref is a <code> span the serve-time link pass can resolve');
  assert.match(block, /<summary>Findings index · 3 confirmed · 1 ruled out<\/summary>/, 'the summary counts');
  assert.doesNotMatch(block, /fi-en|fi-zh|data-fi-lang/, 'no language machinery');
});

test('ruled-out rows sit in a collapsed "Checked and ruled out" group, prefixed "Ruled out:"', () => {
  const block = injectFindingsIndex(COMBINED, FINDINGS);
  const ro = block.slice(block.indexOf('<details class="fi-ro">'));
  assert.match(ro, /^<details class="fi-ro"><summary>/, 'collapsed (no open attribute)');
  assert.match(ro, /Checked and ruled out \(1\)/);
  assert.match(ro, /<span class="st st-ruled-out">Ruled out<\/span> Ruled out: Cache is healthy<\/li>/);
  assert.match(ro, /st-ruled-out/);
  const table = block.slice(block.indexOf('<table>'), block.indexOf('</table>'));
  assert.doesNotMatch(table, /Cache is healthy/, 'a ruled-out row is never in the findings table');
});

test('inject / strip / reinject is idempotent and keeps the index where it was', () => {
  const once = injectFindingsIndex(COMBINED, FINDINGS, { engineeringUrl: '/r' });
  assert.equal(injectFindingsIndex(once, FINDINGS, { engineeringUrl: '/r' }), once, 'inject twice = inject once');
  assert.equal(stripFindingsIndex(once), COMBINED, 'strip restores the document byte for byte');
  assert.equal(injectFindingsIndex(stripFindingsIndex(once), FINDINGS, { engineeringUrl: '/r' }), once);
  // A later, more complete findings list (the GCP findings land after the merge) REPLACES the index in place.
  const moved = once.replace(FINDINGS_INDEX_OPEN, '').replace(FINDINGS_INDEX_CLOSE, '');
  assert.notEqual(moved, once);
  const later = injectFindingsIndex(once, [...FINDINGS, f('GCP-2', 'Second stale table', { severity: 'high' })], { engineeringUrl: '/r' });
  assert.equal(later.split(FINDINGS_INDEX_OPEN).length, 2, 'exactly one index');
  assert.equal(later.indexOf(FINDINGS_INDEX_OPEN), once.indexOf(FINDINGS_INDEX_OPEN), 'same position');
  assert.match(later, /Second stale table/);
});

test('no findings → no index (and a stale one is removed)', () => {
  assert.equal(injectFindingsIndex(COMBINED, []), COMBINED);
  assert.equal(injectFindingsIndex(injectFindingsIndex(COMBINED, FINDINGS), []), COMBINED);
});

test('a document with no panels gets the index right after <body>', () => {
  const out = injectFindingsIndex('<html><body class="x"><p>hi</p></body></html>', FINDINGS);
  assert.ok(out.startsWith(`<html><body class="x">${FINDINGS_INDEX_OPEN}`));
});

test('the index rows use the evidence-gated array (the same one the engineering report renders)', () => {
  const rows = findingsIndexRows([f('X-1', 'no evidence', { evidence: [] }), ...FINDINGS]);
  assert.equal(rows.filter((r) => r.status === 'confirmed').length, 3, 'a finding without resolvable evidence is not indexed');
  assert.deepEqual(rows.map((r) => r.displayId).filter(Boolean), ['F-01', 'F-02', 'F-03']);
});

test('tab labels read from the tab buttons (EN half), kebab keys only', () => {
  assert.deepEqual(combinedTabs(COMBINED), [
    { key: 'leadership', label: 'Leadership' },
    { key: 'swe-arch', label: 'Software architecture & code health' },
    { key: 'release-eng', label: 'Build / CI / release engineering' },
  ]);
});

test('evidence tier — Measured / Read from code / Needs a test', () => {
  assert.equal(evidenceTier({ evidence: [{ kind: 'metric', ref: 'warehouse:q' }] }), 'measured');
  assert.equal(evidenceTier({ evidence: [{ kind: 'computation', ref: 'code:src/a.ts' }] }), 'code');
  assert.equal(evidenceTier({ evidence: [{ kind: 'computation', ref: 'src/exec/run-on-box.ts:74-75' }] }), 'code');
  assert.equal(evidenceTier({ evidence: [{ kind: 'computation', ref: 'derived ratio of two counts' }] }), 'needs-test');
});

test('the index script and markup are safe to inline (no </script>, parseable)', () => {
  const block = injectFindingsIndex(COMBINED, FINDINGS);
  const script = block.slice(block.indexOf('<script>') + 8, block.indexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
  assert.equal(block.split('</script>').length, COMBINED.split('</script>').length + 1);
});

test('a stored Combined report without an index is back-filled at serve time from the engineering report', () => {
  const eng = renderFindingsHtml({ miner: 'org-aggregate', target: 'org', metrics: {}, findings: FINDINGS }, '2026-01-01');
  const out = backfillFindingsIndex(COMBINED, eng, { engineeringUrl: '/api/runs/rs_1/report' });
  assert.ok(out.indexOf(FINDINGS_INDEX_OPEN) > 0 && out.indexOf(FINDINGS_INDEX_OPEN) < out.indexOf('data-report-tab="leadership"'));
  // Same rows, ids and anchors as the index the run would have written from its real Finding[].
  const direct = injectFindingsIndex(COMBINED, FINDINGS, { engineeringUrl: '/api/runs/rs_1/report' });
  const hrefs = (h: string) => [...h.matchAll(/<a href="([^"]+)">(F-\d+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
  assert.deepEqual(hrefs(out), hrefs(direct));
  assert.match(out, /Checked and ruled out \(1\)/);
  // Idempotent, and it never overrides an index the run already wrote.
  assert.equal(backfillFindingsIndex(out, eng, { engineeringUrl: '/api/runs/rs_1/report' }), out);
  assert.equal(backfillFindingsIndex(direct, eng), direct);
  assert.equal(backfillFindingsIndex(COMBINED, null), COMBINED, 'no engineering report → unchanged');
});

test('two-report model: the org run no longer builds a Combined report; its citations come from the workspace-gated findings', () => {
  // The findings index lives on as the Execution report's Work plan; injectFindingsIndex/back-fill still serve OLD
  // combined files (kept servable by URL), which the tests above cover.
  const org = readFileSync(new URL('./run/execute-org-run.ts', import.meta.url), 'utf8');
  assert.match(org, /const reportFindings = findings\.filter\(\(f\) => findingResolvesInWorkspace\(f, tmp\)\)/);
  assert.doesNotMatch(org, /run\.combinedHtml = /);
  assert.match(org, /run\.leadershipHtml = reinjectDetailIndex\(run\.leadershipHtml, buildReportRefs\(reportFindings, /);
});
