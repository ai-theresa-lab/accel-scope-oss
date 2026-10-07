// Per-run abort signal carried via AsyncLocalStorage (same pattern as mcpPolicy/budget) so every nested
// runAgent in a run can observe a user "Stop" WITHOUT threading an AbortSignal through the whole pipeline.
// Set once at the run entry with withRunAbort(run.abort.signal, …); runAgent reads currentRunSignal() and
// aborts its internal SDK controller (which makes the SDK query throw → unwinds to the executor's stop guard).
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage<AbortSignal>();

export function withRunAbort<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return signal ? als.run(signal, fn) : fn();
}

export function currentRunSignal(): AbortSignal | undefined {
  return als.getStore();
}
