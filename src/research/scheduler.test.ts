import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLlmSlot, llmConcurrency, schedulerStats, requestLlmConcurrency, releaseLlmConcurrency } from './scheduler.ts';

// The semaphore must admit at most `max` calls concurrently; the rest queue and run as slots free.
test('withLlmSlot bounds concurrency to the configured max and queues the rest', async () => {
  const max = llmConcurrency();
  let active = 0, peak = 0;
  const gates: Array<() => void> = [];
  const tasks = Array.from({ length: max + 3 }, () => withLlmSlot(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>((resolve) => { gates.push(resolve); }); // hold the slot until released
    active--;
  }));

  // Let the scheduler admit the first `max`.
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(peak, max, 'no more than max run concurrently');
  assert.equal(schedulerStats().active, max);
  assert.equal(schedulerStats().queued, 3, 'the extras are queued, not running');

  // Drain: release one gate at a time. As each finishes, a queued task acquires the freed slot and
  // registers its own gate, so we keep releasing until every task has resolved.
  const done = Promise.all(tasks);
  const drain = setInterval(() => { const g = gates.shift(); if (g) g(); }, 1);
  await done;
  clearInterval(drain);
  assert.equal(peak, max, 'peak concurrency never exceeded max across the whole run');
  assert.equal(schedulerStats().active, 0);
});

// a run REQUESTS concurrency = its activated-bundle count (no longer a hard ≤2), clamped to a safety ceiling
// so a pathological fan-out can't drive the provider into 429s; a request below the default never drops the cap.
test('requestLlmConcurrency clamps to [default, ceiling]; release restores the default; env override pins it', () => {
  if (process.env.THERESA_LLM_CONCURRENCY) return;   // env override is authoritative → request/release are no-ops
  assert.equal(llmConcurrency(), 2, 'starts at the default');
  requestLlmConcurrency('r', 5);   assert.equal(llmConcurrency(), 5, 'raised to the request');
  requestLlmConcurrency('r', 999); assert.equal(llmConcurrency(), 16, 'clamped to the 16 ceiling (same run id overwrites)');
  requestLlmConcurrency('r', 1);   assert.equal(llmConcurrency(), 2, 'a request below the default never drops the cap below 2');
  releaseLlmConcurrency('r');       assert.equal(llmConcurrency(), 2, 'released → default');
});

// the cap is SCOPED per run. Overlapping runs (max-instances 1) compose by MAX; when a run ends it
// RELEASES, and the cap returns to the default once the LAST run that needed it finishes — a finished run never
// leaks a raised cap into the next run's discovery phase.
test('requestLlmConcurrency composes overlapping runs by MAX; release returns the cap to the default', () => {
  if (process.env.THERESA_LLM_CONCURRENCY) return;
  requestLlmConcurrency('A', 3);   assert.equal(llmConcurrency(), 3, 'run A wants 3');
  requestLlmConcurrency('B', 6);   assert.equal(llmConcurrency(), 6, 'overlapping run B wants 6 → max(3,6)');
  releaseLlmConcurrency('A');       assert.equal(llmConcurrency(), 6, 'A ended but B still needs 6 — no premature drop');
  releaseLlmConcurrency('B');       assert.equal(llmConcurrency(), 2, 'last run ended → back to the default 2 (no leak)');
  releaseLlmConcurrency('B');       assert.equal(llmConcurrency(), 2, 'release is idempotent');
});

// a raise must drain ALREADY-QUEUED waiters immediately — not leave them parked until an in-flight call
// releases. Without this, the per-bundle phase (which requests the higher cap AFTER the first bundles have queued
// under the default 2) would stall those bundles behind whatever was in flight.
test('requestLlmConcurrency raising the cap immediately admits queued waiters (no release needed)', async () => {
  if (process.env.THERESA_LLM_CONCURRENCY) return;   // env override pins the cap → request is a no-op
  let peak = 0, running = 0;
  const gates: Array<() => void> = [];
  const tasks = Array.from({ length: 5 }, () => withLlmSlot(async () => {
    running++; peak = Math.max(peak, running);
    await new Promise<void>((resolve) => { gates.push(resolve); });  // hold the slot
    running--;
  }));

  await new Promise((r) => setTimeout(r, 15));
  assert.equal(schedulerStats().active, 2, 'only 2 admitted at the default cap');
  assert.equal(schedulerStats().queued, 3, 'the other 3 are queued');

  requestLlmConcurrency('drain', 5);   // raise with 3 parked + 2 in flight, nothing releasing
  assert.equal(schedulerStats().active, 5, 'the raise drained all 3 waiters synchronously');
  assert.equal(schedulerStats().queued, 0);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(peak, 5, 'all 5 fn bodies ran concurrently after the raise');

  const done = Promise.all(tasks);
  const drain = setInterval(() => { const g = gates.shift(); if (g) g(); }, 1);
  await done; clearInterval(drain);
  assert.equal(schedulerStats().active, 0);
  releaseLlmConcurrency('drain');   // back to the default for other tests
});
