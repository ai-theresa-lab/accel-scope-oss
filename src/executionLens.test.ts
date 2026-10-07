// Report lens split — part 2: the Execution report is SECURITY FIRST
// (a Security group ordered by severity then effort, with exposure), and REMEDIATION.md follows the same order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionModel, executionGroups, findingExposure, securityFirstGroups } from './executionModel.ts';
import { buildReportRefs } from './reportAnchors.ts';
import { renderFindingsHtml } from './reportHtml.ts';
import { REMEDIATION_MD_JS } from './remediationMd.ts';
import { areas, findings, gaps, labelled } from './findingLens.fixtures.ts';

// ── Part 2: Execution security-first + REMEDIATION.md ──────────────────────────────────────────────────────────────

test('securityFirstGroups: Security leads, ordered by severity then effort; every finding still appears exactly once', () => {
  const lf = labelled();
  const g = securityFirstGroups(executionGroups(lf, gaps, areas), lf, gaps);
  assert.equal(g[0].key, 'security'); assert.equal(g[0].name, 'Security');
  assert.deepEqual(g[0].findingIds, ['APPSEC:H2', 'APPSEC:H1', 'SAAS-TENANCY:H1'], 'critical first; then low quick win before low project');
  assert.deepEqual(g[0].gapIds, ['APPSEC:H4']);
  const all = g.flatMap((x) => x.findingIds);
  assert.equal(all.length, new Set(all).size, 'no finding twice');
  assert.deepEqual([...all].sort(), lf.map((f) => f.id).sort(), 'no finding lost');
  assert.ok(!g.find((x) => x.key === 'checkout')!.findingIds.includes('APPSEC:H1'), 'moved out of its theme');
  assert.deepEqual(securityFirstGroups(g, lf, gaps), g, 'idempotent');
  assert.deepEqual(securityFirstGroups(executionGroups([findings[0]], [], areas), [findings[0]], []).map((x) => x.key), ['checkout'], 'no security → no Security group');
});

test('findingExposure: evidence tier + plane', () => {
  assert.equal(findingExposure({ evidence: [{ kind: 'metric', ref: 'warehouse:audit.logs' }] }), 'Measured · the data warehouse');
  assert.match(findingExposure({ evidence: [{ kind: 'computation', ref: 'osv:GHSA-1234' }] }), /^Measured · the OSV vulnerability database \(recorded/);
  assert.equal(findingExposure({ evidence: [{ kind: 'file', ref: 'src/a.ts:3' }] }), 'Read from code · the repository');
});

test('Execution report: the Security group renders FIRST with an Exposure column; REMEDIATION.md orders security first, same F-ids', () => {
  const lf = labelled();
  const execution = buildExecutionModel({ findings: lf, hypotheses: [], mitigations: [], gaps, areas });
  assert.equal(execution.items['APPSEC:H2'].exposure, 'Measured · the data warehouse');
  assert.equal(execution.items['DATA-ENG:H1'].exposure, undefined, 'exposure is a security-card field');
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · x', metrics: { summary: { org: true } }, findings: lf, coverageGaps: gaps, execution }, '2026-09-30T00:00:00Z');
  const firstH2 = /<div class="sechead"><span class="n">01<\/span><h2>([^<]+)<\/h2>/.exec(html);
  assert.equal(firstH2?.[1], 'Security');
  assert.match(html, /<th>Exposure<\/th>/);
  const sec = html.slice(html.indexOf('<h2>Security</h2>'), html.indexOf('<h2>Checkout &amp; billing</h2>'));
  assert.ok(sec.indexOf('secret in CI logs') < sec.indexOf('tenant token readable') && sec.indexOf('tenant token readable') < sec.indexOf('cross-tenant cache key'), 'severity then effort, not F-id order');
  const data = JSON.parse(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/.exec(html)![1]);
  const md = (new Function(`${REMEDIATION_MD_JS}; return remediationMarkdown;`)() as (o: unknown) => string)({ title: 't', findings: data.findings });
  const heads = [...md.matchAll(/^## (F-\d+) · \[(\w+)\] (.+)$/gm)].map((m) => [m[1], m[3]]);
  assert.deepEqual(heads.slice(0, 3).map((h) => h[1]), ['secret in CI logs', 'tenant token readable by any tenant', 'cross-tenant cache key'], 'security sections first');
  assert.match(md, /ordered security first, then by severity/);
  assert.match(md, /\*\*Exposure:\*\* Measured · the data warehouse/);
  // Same F-ids as the Leadership refs.
  const refs = new Map(buildReportRefs(lf, '/r').map((r) => [r.title, r.displayId]));
  for (const [id, title] of heads) assert.equal(refs.get(title), id, `F-id of "${title}" agrees across reports`);
});
