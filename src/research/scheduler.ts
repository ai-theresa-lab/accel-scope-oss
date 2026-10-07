// Process-wide LLM admission control — the operating-envelope spine.
//
// WHY PROCESS-WIDE, NOT PER-RUN: under `max-instances 1` several runs can be in flight at once, so a
// per-run concurrency cap is a false guarantee (N runs × their own cap). The cap that actually bounds
// load on the Claude/OpenAI tier is a single process-global semaphore. Every LLM/agent LEAF call
// (`runAgent`, `openaiComplete`) acquires a slot here; nothing else does.
//
// NON-DEADLOCK INVARIANT (load-bearing): only LEAF calls acquire. A function must NEVER hold a slot
// while awaiting another slotted call. Verified against the current call graph: `orgCritiqueExpert`
// awaits Comprehend, then runs bundle chains under `Promise.all`; each chain awaits ONE
// `runAgent`/`openaiComplete` at a time, and no `runAgent` calls another `runAgent` internally.
// Wrapping `deepAudit`/`runCritique`/the report writers/orchestration would deadlock the moment a
// wrapper awaits a nested slotted call. Do not wrap those.
//
// NO TIMEOUTS, BY DESIGN: a slot is released only when the wrapped call RETURNS or THROWS — never on
// a wall clock. The envelope gates ADMISSION (queueing new calls); it must never abort an in-flight
// generation (a long report can take minutes). See the "no-LLM-abort-timeout" rule.

// Process-wide LLM concurrency. Default 2; the per-bundle phase RAISES it to the activated-bundle count so N
// bundles' Analyst⇄QC sessions don't serialize at 2. A hard safety CEIL of 16 remains — never
// drive the provider into 429s (which would HURT report quality), even if asked for more.
//
// SCOPED PER RUN (not a permanent process mutation): a run REQUESTS its desired concurrency (`requestLlmConcurrency`,
// keyed by run id) at its per-bundle phase and RELEASES it on run end (`releaseLlmConcurrency`, in executeOrgRun's
// finally). The effective cap = max(DEFAULT, the highest active run's request), clamped to CEIL — so overlapping runs
// under `max-instances 1` compose by MAX (not last-writer-wins), and the cap RETURNS to the default once the last run
// that needed it finishes. A finished run never leaves the cap raised for the next run's discovery phase.
//
// An explicit `THERESA_LLM_CONCURRENCY` is AUTHORITATIVE (a cost/dev clamp): it pins the cap and makes request/release
// no-ops. Budget note: with concurrency >2 the 0.20·B reserve no longer fully bounds in-flight admission overshoot —
// accepted (cost is not the constraint for these runs); admission (budget.ts) still gates STARTING new work, never aborts.
const CEIL = 16;
const ENV = Number(process.env.THERESA_LLM_CONCURRENCY) || 0;   // 0 ⇒ unset
const DEFAULT = Math.min(CEIL, Math.max(1, ENV || 2));
let max = DEFAULT;

// Active runs' desired concurrencies, keyed by run id. The effective cap composes by MAX over all in-flight runs.
const desiredByRun = new Map<string, number>();
function recompute(): void {
  const vals = [...desiredByRun.values()];
  max = Math.min(CEIL, vals.length ? Math.max(DEFAULT, ...vals) : DEFAULT);
  pump();   // a raise creates free slots NOW — admit parked waiters immediately (don't wait for an in-flight release).
}

// Request `n` concurrency for `runId`'s duration (idempotent per run id). No-op when an env override pins the cap.
export function requestLlmConcurrency(runId: string, n: number): void {
  if (ENV) return;   // env override is authoritative
  desiredByRun.set(runId, Math.max(1, Math.floor(n) || 1));
  recompute();
}

// Release `runId`'s request on run end (idempotent). Recomputes the cap DOWN once the last run needing it finishes —
// a cap lowering is correct here: `release()` sheds freed slots instead of admitting waiters while over the new cap.
export function releaseLlmConcurrency(runId: string): void {
  if (ENV) return;
  if (desiredByRun.delete(runId)) recompute();
}

let active = 0;
const waiters: Array<() => void> = [];

// Single admission point: admit queued waiters while spare capacity exists under the CURRENT cap. Called
// after a slot frees (release) and after the cap is raised (recompute). Respecting `max` here also
// makes a cap LOWERING correct — release sheds the freed slot instead of handing it on while over cap.
function pump(): void {
  while (active < max && waiters.length) {
    active++;
    const next = waiters.shift();
    if (next) next();
  }
}

function acquire(): Promise<void> {
  if (active < max) { active++; return Promise.resolve(); }
  return new Promise<void>((resolve) => { waiters.push(resolve); });
}

function release(): void {
  active--;   // free this call's slot, then admit whatever the current cap now allows
  pump();
}

// Run `fn` inside one LLM slot. FIFO; bounded by THERESA_LLM_CONCURRENCY (default 2).
export async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try { return await fn(); }
  finally { release(); }
}

// Introspection for logs / tests (not a control surface).
export function llmConcurrency(): number { return max; }
export function schedulerStats(): { max: number; active: number; queued: number } {
  return { max, active, queued: waiters.length };
}
