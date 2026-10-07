// run-context.ts — the dependency-injection SEAM for extracting `executeOrgRun` out of
// `src/server.ts` (a planned refactor). NOTHING is wired in yet: this is the seam only —
// no existing file is modified and this module is not imported anywhere.
//
// WHY: `executeOrgRun` (and its run-lifecycle siblings) currently reach directly for module-
// level singletons in server.ts — the `store`, the `liveRuns` WeakMap, and the free functions
// `pushLog` / `saveReport` / `reportArtifactPath` / `saveRunCheckpoint` / `finishRun` /
// `failRun` / `runSourceSet`, plus the `RUN_BUDGET` constant. To move the executor into its own
// module we route those through an injected `RunContext` instead. Two implementations will
// satisfy this interface:
//   • the IN-PROCESS impl, assembled in server.ts, that forwards to today's singletons/functions
//     (unchanged behavior — the same choke-points).
//   • the JOB impl, built in run-worker Phase B, that backs the same surface with the durable
//     Job/Store execution model.
//
// RUNTIME CONSTRAINT — this file runs under `node --experimental-strip-types`:
//   • Erasable TypeScript ONLY: no enums, no parameter properties, no namespaces.
//   • EVERY accel-scope type is a TYPE-ONLY import (`import type { … }`). Type-only imports are
//     fully erased at runtime, so referencing `../server.ts` here does NOT load/boot the server
//     (no HTTP listener, no singletons constructed). A value import from server.ts is forbidden.
//   • Verify by RUNNING it (NOT `--check`, which doesn't strip types on node 22.x):
//     `node --experimental-strip-types src/run/run-context.ts` must exit 0, print nothing, boot
//     no server, and raise no SyntaxError / ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.

import type { ServerResponse } from 'node:http';
import type { Run, Source, ResumeSpec } from '../server.ts';
import type { CkptId } from '../checkpoints.ts';
import type { MinerResult } from '../schema.ts';
import { liveCostDue, type LedgerHooks } from '../research/budget.ts';
import { noteDegraded } from './degraded.ts';

// ── LiveHandles ──────────────────────────────────────────────────────────────────────────────
// The SIX transient / process-handle run fields, lifted from server.ts's `LiveRun` (server.ts:377).
// These NEVER persist — they hold live SSE response handles, the in-flight AbortController, the BYO
// Claude credential, the pinned execution source snapshot, the loaded resume/replay payload, and
// the cooperative stop flag. All optional so an entry can be created empty (see
// IdKeyedLiveHandles.get). (server.ts's LiveRun also carries a 7th field, `leaseConfirmed`, added
// by the lease work — deliberately NOT part of this seam per spec; add it here if the move needs it.)
export interface LiveHandles {
  subs?: Set<ServerResponse>;   // live SSE response handles for this run's event stream
  abort?: AbortController;      // cancels the in-flight execution
  authToken?: string;          // BYO Claude credential for this run
  boundSources?: Source[];     // resolved in-memory execution source snapshot (may carry raw pasted tokens)
  resumeSpec?: ResumeSpec;     // loaded replay context of a resumed (child) run
  stopRequested?: boolean;     // cooperative stop signal
}

// ── IdKeyedLiveHandles ─────────────────────────────────────────────────────────────────────────
// The id-keyed replacement for server.ts's `liveRun(run)` WeakMap (server.ts:390 / :399). A future
// remote Store returns freshly-deserialized Run objects per read, so keying live handles by run
// OBJECT identity (the WeakMap) breaks; keying by the STABLE `run.id` composes with it.
//
// KEY SEMANTIC DIFFERENCE FROM THE WEAKMAP: a WeakMap auto-GCs its entry when the run object is
// collected, so `liveRun` never needed an explicit delete. A Map does NOT — an entry lives until
// `delete(id)` is called. The server MUST call `delete(id)` at run teardown (when the run is
// removed) or these handles LEAK for the process's lifetime. That teardown delete is the caller's
// responsibility, not this class's.
export class IdKeyedLiveHandles {
  private handles = new Map<string, LiveHandles>();

  // Always returns a valid LiveHandles, lazily creating + storing an empty `{}` on first access —
  // mirroring liveRun's create-on-access (server.ts:399). NOTE: the WeakMap version seeds
  // `{ subs: new Set() }`; here every field is optional and we seed `{}`, so a caller that needs
  // `.subs` must initialize it (e.g. `(h.subs ??= new Set())`). The in-process adapter can seed
  // subs itself to reproduce the exact old "subs is always a live Set" invariant.
  get(id: string): LiveHandles {
    let h = this.handles.get(id);
    if (!h) { h = {}; this.handles.set(id, h); }
    return h;
  }

  // Read WITHOUT create — returns undefined when absent.
  peek(id: string): LiveHandles | undefined {
    return this.handles.get(id);
  }

  has(id: string): boolean {
    return this.handles.has(id);
  }

  set(id: string, h: LiveHandles): void {
    this.handles.set(id, h);
  }

  // Explicit teardown — REQUIRED (see class doc): unlike the WeakMap, a Map does not auto-GC, so
  // the owning run's removal MUST call this or the entry leaks.
  delete(id: string): void {
    this.handles.delete(id);
  }
}

// ── RunContext ─────────────────────────────────────────────────────────────────────────────────
// The injected dependency seam the extracted `executeOrgRun` (and its lifecycle siblings) run
// against, instead of reaching for server.ts module singletons. Sink signatures are kept as close
// as possible to today's server.ts functions; where a precise type isn't importable the signature
// is structural / `unknown`-typed and noted for firm-up during the move.
export interface RunContext {
  // Live process-handle side-table for this run (was `liveRun(run)`). Takes the Run OBJECT, not the
  // id, on purpose: the IN-PROCESS impl (server.ts) forwards straight to the existing WeakMap-based
  // `liveRun(run)`, so its GC semantics are preserved and NO in-process re-keying/teardown-delete is
  // needed (a WeakMap auto-collects; an id-keyed Map would need an explicit delete that could kill a
  // still-executing run's state). Only the JOB impl keys by `run.id` (via IdKeyedLiveHandles, whose
  // entry lifecycle the Job manages). The moved executor always has the Run object in scope, so this
  // costs nothing at the call-sites.
  live(run: Run): LiveHandles;

  // Store surface the run cluster reads/writes. NOTE the seam simplifications vs server.ts's `Store`:
  //   • getRun is id-only here (server.ts Store.getRun is `(tenant, id)`).
  //   • allRuns returns a materialized array (server.ts Store.allRuns returns `Iterable<Run>`).
  //   • updateRun matches server.ts's `updateRun(run, mutator)` — the mutate-in-place + persist-once choke-point.
  getRun(id: string): Run | undefined;
  allRuns(): Run[];
  updateRun(run: Run, mutator: (r: Run) => void): void;

  // Append a log line to the run (was `pushLog(run, line)`).
  log(run: Run, line: string): void;

  // Persist a report artifact. Matches store.ts's 2-arg `saveReport(runId, html)`; callers pre-compute
  // the `id + '-' + suffix` filename (e.g. 'leadership' | 'combined') before calling.
  saveReport(id: string, html: string): void;

  // Filesystem path for a NON-html sidecar artifact (matches store.ts `reportArtifactPath(runId, suffix)`).
  reportArtifactPath(id: string, suffix: string): string;

  // Persist a resume/replay checkpoint. Matches server.ts's `saveRunCheckpoint(run, id, payload, display)`.
  saveCheckpoint(run: Run, id: CkptId, payload: unknown, display: { label: string; detail?: string; bundlesDone?: string[] }): void;

  // Terminal-success transition (server.ts's `finishRun(run, result, costUsd)` where `result` is `MinerResult`).
  // `opts.workspaceRoot`: the run's still-live workspace, so the evidence gate can check that file/line refs
  // resolve on disk. The gate runs synchronously inside finish, before the executor's finally deletes the workspace.
  finish(run: Run, result: MinerResult, cost: number | null, opts?: { workspaceRoot?: string }): void;

  // Terminal-failure transition (was `failRun(run, msg)`).
  fail(run: Run, msg: string): void;

  // The run's execution source set. Was `runSourceSet(run)` → `liveRun(run).boundSources ?? tenant sources`.
  sourcesFor(run: Run): Source[];

  // The connected sources of the run's OWN org (server.ts `runWs(run).sources` — per (tenant, org), never the whole
  // tenant) — the fallback set `runSourceSet` falls back to when a run has no pinned `boundSources`.
  tenantSources(run: Run): Source[];

  // Per-run spend envelope in USD (was the `RUN_BUDGET` constant, default 100).
  runBudget: number;
  // The force-all-aware budget actually handed to the ledger (was `EFFECTIVE_RUN_BUDGET`): 0 ⇒ unbounded.
  effectiveRunBudget: number;
}

// ── runLedgerHooks ─────────────────────────────────────────────────────────────────────────────
// The per-run observers handed to the run's BudgetLedger. Two things the run
// page could not see before: LIVE spend ("— spend" for the whole of a $108 run) and DEGRADATIONS
// (a 401'd OpenAI key made every codex/gpt stage fall open while the pipeline looked healthy).
//   • onSpend → `run.costUsd` is updated INCREMENTALLY while the run is 'running' (the same field
//     finishRun writes the exact total into — the UI reads one field), throttled by liveCostDue so a
//     run with hundreds of LLM leaves doesn't rewrite state.json on every one.
//   • onDegraded → one `run.degraded` row per distinct (stage, reason) via noteDegraded.
// Value imports here are NOT from server.ts (see the runtime constraint above) — budget.ts and
// degraded.ts are leaf modules, so loading this file still boots nothing.

export function runLedgerHooks(run: Run, ctx: Pick<RunContext, 'updateRun'>, now: () => number = Date.now): LedgerHooks {
  let last: { usd: number; at: number } | undefined;
  return {
    onSpend: (spent) => {
      const t = now();
      if (!liveCostDue(last, spent, t)) return;
      last = { usd: spent, at: t };
      // Only while running: a late leaf returning after finish/stop must not overwrite the terminal total.
      ctx.updateRun(run, (r) => { if (r.status === 'running') r.costUsd = Number(spent.toFixed(2)); });
    },
    onDegraded: (stage, reason) => { ctx.updateRun(run, (r) => { noteDegraded(r, stage, reason); }); },
  };
}
