import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingCounts } from './findingCounts.ts';

// A real run: 48 confirmed + 5 ruled-out rows were reported as "53 confirmed findings".
test('ruled-out (refuted) recommendation-audit rows are counted separately, never as findings', () => {
  const confirmed = Array.from({ length: 48 }, () => ({ source: 'recommendation-audit', severity: 'high' as const }));
  const ruledOut = Array.from({ length: 5 }, () => ({ source: 'recommendation-audit', severity: 'info' as const }));
  const c = findingCounts([...confirmed, ...ruledOut]);
  assert.equal(c.confirmed, 48);
  assert.equal(c.ruledOut, 5);
  assert.equal(c.ruledOutItems.length, 5);
});

test('an info-severity finding from any OTHER source is still a confirmed finding', () => {
  assert.deepEqual(findingCounts([{ source: 'baseline', severity: 'info' }, { source: 'gcp', severity: 'low' }]), { confirmed: 2, ruledOut: 0, ruledOutItems: [] });
  assert.deepEqual(findingCounts([]), { confirmed: 0, ruledOut: 0, ruledOutItems: [] });
});

// Ruled-out rows are carried as a separate LIST (run.ruledOut), naming each refuted hypothesis.
test('findingCounts carries the ruled-out rows as an {id, title} list, in order', () => {
  const c = findingCounts([
    { id: 'REC:H1', title: 'stale feature store', source: 'recommendation-audit', severity: 'high' },
    { id: 'REC:H2', title: 'healthy candidate pool', source: 'recommendation-audit', severity: 'info' },
    { id: 'REC:H3', title: 'healthy dedupe', source: 'recommendation-audit', severity: 'info' },
  ]);
  assert.equal(c.confirmed, 1);
  assert.deepEqual(c.ruledOutItems, [{ id: 'REC:H2', title: 'healthy candidate pool' }, { id: 'REC:H3', title: 'healthy dedupe' }]);
});

test('the internal report header counts confirmed findings only', async () => {
  const { renderFindingsHtml } = await import('../reportHtml.ts');
  const f = (id: string, severity: 'high' | 'info') => ({ id, invariant: 'i1', title: `t ${id}`, claim: `claim ${id}`, severity, confidence: 'high', effort: 'low', dimension: 'code', source: 'recommendation-audit', recommendation: 'fix', evidence: [{ kind: 'file', ref: 'a.ts:1' }] });
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 't', metrics: { summary: { org: true, repos: 1, commits: 5 } }, findings: [f('a', 'high'), f('b', 'high'), f('c', 'info')] } as never, '2026-09-25');
  assert.match(html, /2 of 2 confirmed findings/);
  assert.doesNotMatch(html, /of 3 confirmed findings/);
});

// The "N confirmed · by severity" card sat over bars that summed to confirmed + ruled out (48 vs 53). The severity
// cells, the bar and the "by lens" card must all sum to the confirmed count; the ruled-out rows are named beside it.
test('the internal report severity + lens breakdowns sum to the confirmed count', async () => {
  const { renderFindingsHtml, severityCounts } = await import('../reportHtml.ts');
  const f = (id: string, severity: 'high' | 'medium' | 'info') => ({ id, invariant: 'i1', title: `t ${id}`, claim: `claim ${id}`, severity, confidence: 'high', effort: 'low', dimension: 'code', source: 'recommendation-audit', recommendation: 'fix', evidence: [{ kind: 'file', ref: 'a.ts:1' }] });
  const findings = [f('a', 'high'), f('b', 'medium'), f('c', 'info'), f('d', 'info')];
  assert.deepEqual(severityCounts(findings as never), { high: 1, medium: 1 });
  const html = renderFindingsHtml({ miner: 'org-aggregate', target: 't', metrics: { summary: { org: true, repos: 1, commits: 5 } }, findings } as never, '2026-09-25');
  const vm = JSON.parse(html.match(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/)![1]);
  const sum = (xs: { n?: number; flex?: number }[]) => xs.reduce((a, x) => a + (x.n ?? x.flex ?? 0), 0);
  assert.equal(vm.summary.total, 2);
  assert.equal(vm.summary.ruledOut, 2);
  assert.equal(sum(vm.summary.sev), vm.summary.total, 'severity cells sum to the confirmed count');
  assert.equal(sum(vm.summary.sevBar), vm.summary.total, 'severity bar sums to the confirmed count');
  assert.equal(sum(vm.summary.lenses), vm.summary.total, 'by-lens card sums to the confirmed count');
  assert.deepEqual(vm.findings.map((x: { ruledOut: boolean }) => x.ruledOut), [false, false, true, true], 'rows still render, flagged');
  assert.match(html, /2 confirmed · by severity · 2 ruled out \(not counted\)/);
});
