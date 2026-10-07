import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLedgerHooks } from './run-context.ts';
import type { Run } from '../server.ts';

// The run ledger's observers — live spend into run.costUsd (throttled, running-only) and degradations into
// run.degraded — go through ctx.updateRun (the persist choke-point), exactly like every other run mutation.
function fakeRun(status: Run['status'] = 'running'): { run: Run; updates: number; ctx: { updateRun: (r: Run, m: (r: Run) => void) => void } } {
  const run = { id: 'rs_x', status, costUsd: null, log: [] } as unknown as Run;
  const box = { run, updates: 0, ctx: { updateRun: (r: Run, m: (r: Run) => void) => { box.updates++; m(r); } } };
  return box;
}

test('live spend lands on run.costUsd while running, throttled, and never after a terminal status', () => {
  let now = 0;
  const f = fakeRun();
  const h = runLedgerHooks(f.run, f.ctx, () => now);
  h.onSpend!(0.3);                       // first spend → persisted
  assert.equal(f.run.costUsd, 0.3);
  now = 1000; h.onSpend!(0.4);           // +$0.10 after 1s → throttled
  assert.equal(f.run.costUsd, 0.3);
  now = 2000; h.onSpend!(0.95);          // +$0.65 → persisted
  assert.equal(f.run.costUsd, 0.95);
  assert.equal(f.updates, 2);
  f.run.status = 'complete'; f.run.costUsd = 12.34;   // finishRun wrote the exact total
  now = 60_000; h.onSpend!(13);         // a late leaf returning after finish
  assert.equal(f.run.costUsd, 12.34);
});

test('degradations land on run.degraded once per (stage, reason)', () => {
  const f = fakeRun();
  const h = runLedgerHooks(f.run, f.ctx);
  h.onDegraded!('html-qc', 'area QC judge (gpt) unavailable: OpenAI auth failed (401) — check OPENAI_API_KEY — report shipped unscored');
  h.onDegraded!('html-qc', 'area QC judge (gpt) unavailable: OpenAI auth failed (401) — check OPENAI_API_KEY — report shipped unscored');
  h.onDegraded!('reconcile', 'skipped (codex CLI unavailable)');
  assert.deepEqual(f.run.degraded?.map((d) => d.stage), ['html-qc', 'reconcile']);
  assert.ok(f.run.degraded?.every((d) => typeof d.at === 'string' && d.at.endsWith('Z')));
});
