import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSinceLastScan, sinceLastScanLine, uncheckedBreakdown, uncheckedByWhy, uncheckedWhyText, type KeyedFinding } from './sinceLastScan.ts';
import { injectDetailIndex, reinjectDetailIndex, sinceLastScanHtml } from './reportAnchors.ts';

const K = (id: string, key: string, over: Partial<KeyedFinding> & { ev?: string; loose?: string; bundle?: string; source?: string } = {}): KeyedFinding => ({
  f: { id, title: `t-${id}`, severity: 'high', source: over.source ?? 'deep' },
  k: { key, evidenceKey: over.ev ?? `ev-${key}`, looseKey: over.loose ?? `lo-${key}`, bundleId: over.bundle ?? 'data-eng' },
  ...(over.ruledOut ? { ruledOut: true } : {}), ...(over.displayId ? { displayId: over.displayId } : {}), ...(over.path ? { path: over.path } : {}),
});
const META = { runId: 'rs_base', date: '2026-09-01', sha: 'abcdef1234567' };

test('diff: persisting by key, persisting by evidence (paraphrased title), changed by loose key, new, fixed', () => {
  const base = [K('B1', 'k1'), K('B2', 'k2', { ev: 'E2' }), K('B3', 'k3', { loose: 'L3' }), K('B4', 'k4', { displayId: 'F-04' })];
  const cur = [K('C1', 'k1'), K('C2', 'kX', { ev: 'E2' }), K('C3', 'kY', { loose: 'L3' }), K('C4', 'kNew')];
  const d = diffSinceLastScan(cur, base, META);
  assert.deepEqual(d.statuses, ['persisting', 'persisting', 'changed', 'new']);
  assert.deepEqual(d.counts, { fixed: 1, new: 1, persisting: 2, changed: 1, unchecked: 0 });
  assert.equal(d.fixed[0].displayId, 'F-04');
  assert.equal(d.tags.C1.since, '2026-09-01');
  assert.equal(d.tags.C4.since, undefined);
});

test('diff: a baseline finding whose bundle was NOT re-checked is unchecked, never fixed', () => {
  const d = diffSinceLastScan([], [K('B1', 'k1', { bundle: 'appsec' }), K('B2', 'k2', { bundle: 'data-eng' })], META, { checkedBundles: new Set(['data-eng']) });
  assert.equal(d.counts.fixed, 1); assert.equal(d.counts.unchecked, 1); assert.equal(d.unchecked[0].bundleId, 'appsec');
  // A prior finding a targeted re-verify could not settle (by looseKey) is not re-checked either, even in a checked bundle.
  const u = diffSinceLastScan([], [K('B2', 'k2', { bundle: 'data-eng', loose: 'L2' })], META, { checkedBundles: new Set(['data-eng']), uncheckedLoose: new Set(['L2']) });
  assert.equal(u.counts.fixed, 0); assert.equal(u.counts.unchecked, 1);
});

test('diff: ruled-out rows and GCP findings are excluded; confirmed → ruled out reads as fixed; each baseline row is claimed once', () => {
  const base = [K('B1', 'k1'), K('G1', 'g1', { source: 'gcp-iam' }), K('B5', 'k5')];
  const cur = [K('C1', 'k1', { ruledOut: true }), K('G2', 'g1', { source: 'gcp-iam' }), K('C5a', 'k5'), K('C5b', 'k5')];
  const d = diffSinceLastScan(cur, base, META);
  assert.deepEqual(d.statuses, [undefined, undefined, 'persisting', 'new']);
  assert.equal(d.counts.fixed, 1);
});

test('the brief row: injected ahead of Area health inside the content column, idempotent on re-inject', () => {
  const d = diffSinceLastScan([K('C1', 'k1'), K('C2', 'k2')], [K('B1', 'k1'), K('B9', 'k9')], META);
  assert.equal(sinceLastScanLine(d), '1 fixed · 1 new · 1 persisting · baseline 2026-09-01 @ abcdef1');
  const brief = '<html><body><div class="wrap"><p>Brief</p></div></body></html>';
  const themes = [{ key: 'a', name: 'Area A', verdict: 'risk' as const, findingIds: [], gapCount: 1 }];
  const once = injectDetailIndex(brief, [], { themes, since: d });
  const twice = reinjectDetailIndex(once, [], { themes, since: d });
  for (const html of [once, twice]) {
    assert.equal((html.match(/Since last scan/g) ?? []).length, 1, 'row once');
    assert.ok(html.indexOf('Since last scan') < html.indexOf('Area health'));
    assert.ok(html.indexOf('Since last scan') > html.indexOf('<p>Brief</p>') && html.indexOf('Area health') < html.lastIndexOf('</div></body>'), 'inside the content column');
  }
  // With zero current findings and no themes, the row still renders (everything fixed is news).
  const empty = diffSinceLastScan([], [K('B1', 'k1')], META);
  assert.match(injectDetailIndex(brief, [], { since: empty }), /1 fixed · 0 new · 0 persisting/);
  assert.equal(sinceLastScanHtml(null), '');
});

// E2E 2026-09-29: a full rescan at the baseline SHA listed 3 "fixed" findings the run merely did not re-raise.
test('diff: a baseline finding whose code did not change is never fixed — unchecked with reason code-unchanged', () => {
  const base = [K('B1', 'k1', { path: 'p-queue/source/index.ts' }), K('B2', 'k2', { path: 'other/x.ts' })];
  const d = diffSinceLastScan([], base, META, { checkedBundles: new Set(['data-eng']), canBeFixed: (b) => !String(b.path).startsWith('p-queue/') });
  assert.equal(d.counts.fixed, 1);
  assert.equal(d.fixed[0].key, 'k2');
  assert.deepEqual(d.unchecked.map((u) => [u.key, u.why]), [['k1', 'code-unchanged']]);
  // The brief row names the reason separately from "did not run".
  const html = sinceLastScanHtml(d);
  assert.match(html, /1 earlier finding is not counted as fixed: 1 — not raised again this time, but its code has not changed/);
  assert.doesNotMatch(html, /did not run/);
});

test('E2E 2026-10-01 #3: each unchecked row carries its precise reason; the rendering names it', () => {
  // B1: a budget-skipped re-check in a lane that RAN; B2: an unsettled re-check; B3: a bundle Comprehend did not activate;
  // B4: a lane that ran but was cut short; B5: code unchanged.
  const base = [K('B1', 'k1', { bundle: 'product-logic', loose: 'L1' }), K('B2', 'k2', { bundle: 'product-logic', loose: 'L2' }), K('B3', 'k3', { bundle: 'data-eng' }), K('B4', 'k4', { bundle: 'saas-tenancy' }), K('B5', 'k5', { bundle: 'analytics', path: 'umami/a.ts' })];
  const d = diffSinceLastScan([], base, META, {
    checkedBundles: new Set(['product-logic', 'analytics']), ranBundles: new Set(['product-logic', 'analytics', 'saas-tenancy']),
    uncheckedLoose: new Set(['L1', 'L2']), uncheckedWhy: new Map([['L1', 'recheck-budget'], ['L2', 'recheck-unsettled']]), canBeFixed: (b) => b.k.bundleId !== 'analytics',
  });
  assert.deepEqual(d.unchecked.map((u) => [u.key, u.why]), [['k1', 'recheck-budget'], ['k2', 'recheck-unsettled'], ['k3', 'not-run'], ['k4', 'incomplete'], ['k5', 'code-unchanged']]);
  assert.equal(d.counts.fixed, 0);
  assert.deepEqual(uncheckedByWhy(d.unchecked), { 'recheck-budget': 1, 'recheck-unsettled': 1, 'not-run': 1, incomplete: 1, 'code-unchanged': 1 });
  assert.equal(uncheckedBreakdown(uncheckedByWhy(d.unchecked)), '1 re-check skipped (budget) · 1 re-check unsettled · 1 review not run · 1 review incomplete · 1 code unchanged');
  // An unchecked looseKey without a recorded reason (an old run) stays the old "not run".
  assert.equal(diffSinceLastScan([], [K('B1', 'k1', { loose: 'L1' })], META, { uncheckedLoose: new Set(['L1']) }).unchecked[0].why, 'not-run');
  const row = sinceLastScanHtml(d);
  assert.match(row, /5 earlier findings are not counted as fixed: 1 — its targeted re-check was skipped — the run budget \(or the per-run re-check cap\) ran out; 1 — its targeted re-check ran but could not settle it; 1 — the review that raised it did not run in this scan; 1 — the review that raised it did not complete/);
  assert.doesNotMatch(sinceLastScanHtml(diffSinceLastScan([], [K('B1', 'k1', { loose: 'L1' }), K('B2', 'k2', { loose: 'L2' })], META, { uncheckedLoose: new Set(['L1', 'L2']), uncheckedWhy: new Map([['L1', 'recheck-budget'], ['L2', 'recheck-budget']]) })), /did not run/, 'old code: every row "did not run"');
  assert.match(uncheckedWhyText('recheck-budget', 2), /^their targeted re-checks were skipped/);
});
