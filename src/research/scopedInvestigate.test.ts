import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Quick Ask alignment: the investigate failure path used to dump the agent's RAW (unredacted) output + trace to
// /tmp/mini-fail-*.txt — on Cloud Run a RAM tmpfs nobody reads, outside the run's own artifacts. The text now goes
// to the caller (opts.onFailTrace), which saves it redacted as the run's trace artifact; nothing is written here.
test('scopedInvestigate writes nothing to disk on the failure path (no /tmp dump)', () => {
  const src = readFileSync(new URL('./scopedInvestigate.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /mini-fail-/);
  assert.doesNotMatch(src, /writeFileSync|from 'node:fs'/);
  assert.match(src, /onFailTrace\?\.\(/);
});

test('the investigate agent and its salvage pass both carry an SDK maxBudgetUsd from the run ledger', () => {
  const src = readFileSync(new URL('./scopedInvestigate.ts', import.meta.url), 'utf8');
  assert.match(src, /maxBudgetUsd: agentBudgetCap\(currentLedger\(\), 0\.8\)/);
  assert.match(src, /withBudgetNode\('reserve', \(\) => runAgent\(\{[^\n]*maxBudgetUsd: agentBudgetCap\(currentLedger\(\), 1\)/);
});

// The salvage pass's prompt says it has NO tools — it now runs toolFree — and its JSON shape matches the main path
// (tightening / bottomLine / execSummary, which the template renders), not the retired workItems list.
test('salvage: toolFree, and its JSON schema is the main dossier shape (no legacy workItems)', async () => {
  const { salvagePrompt } = await import('./scopedInvestigate.ts');
  const p = salvagePrompt('how does X work?', 'transcript '.repeat(40));
  for (const k of ['"tightening"', '"bottomLine"', '"execSummary"', '"openQuestions"']) assert.ok(p.includes(k), k);
  assert.ok(!p.includes('workItems'));
  const src = readFileSync(new URL('./scopedInvestigate.ts', import.meta.url), 'utf8');
  assert.match(src, /toolFree: true[^\n]*label: 'accel-mini-salvage-synthesis'/);
});

// Evidence gate (Full Scan parity): before this the ask rendered any `file:line` the agent wrote, existing or not.
test('gateScopedEvidence: drops file-shaped refs + tightening files missing from the workspace, keeps the rest', async () => {
  const { gateScopedEvidence, isFileShapedRef } = await import('./scopedInvestigate.ts');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'ask-gate-'));
  try {
    mkdirSync(join(root, 'p-limit'));
    writeFileSync(join(root, 'p-limit', 'index.js'), 'a\nb\nc\n');
    for (const r of ['index.js:2', 'p-limit/index.js', 'src/x.ts#L4']) assert.ok(isFileShapedRef(r), r);
    for (const r of ['analytics.events_daily', 'SELECT count(*) FROM t', 'pool:hot:123', 'https://x.io/a.js:3', 'src/**/*.ts', 'README.md']) assert.ok(!isFileShapedRef(r), r);
    const d = {
      question: 'q', answer: 'a', dataPoints: [], wantsFixes: true, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
      evidence: [{ ref: 'index.js:2' }, { ref: 'index.js:99' }, { ref: 'lib/ghost.ts:5', detail: 'made up' }, { ref: 'analytics.events_daily' }, { ref: 'redis key pool:hot' }],
      tightening: [{ weakness: 'w', fix: 'f', files: ['p-limit/index.js', 'src/nope.ts'] }, { weakness: 'w2', fix: 'f2', files: ['gone/a.ts'] }],
    };
    const { dossier, dropped } = gateScopedEvidence(d, root);
    assert.deepEqual(dossier.evidence.map((e) => e.ref), ['index.js:2', 'analytics.events_daily', 'redis key pool:hot']);
    assert.deepEqual(dossier.tightening?.[0].files, ['p-limit/index.js']);
    assert.equal(dossier.tightening?.[1].files, undefined);
    assert.deepEqual(dropped.sort(), ['gone/a.ts', 'index.js:99', 'lib/ghost.ts:5', 'src/nope.ts']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
