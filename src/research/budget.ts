// Per-run budget ledger + ambient run context — the second half of the operating-envelope spine.
//
// The doc's allocation of B = RUN_BUDGET:
//   discovery 0.10B (intake + comprehend) · bundle 0.60B (critique + preflight + expert) ·
//   audit 0.10B (claim + synthesis-claim audits) · reserve 0.20B (synthesis + report + fallback)
// and a global admission stop: do not START new bundle/measure work past 0.80B.
//
// ADMISSION-ONLY: `admit()` answers "may a NEW call start?"; it NEVER cancels an in-flight call. The
// ledger is per-run; the only process-global is the scheduler semaphore.
//
// COST ATTRIBUTION VIA AsyncLocalStorage: `runAgent`/`openaiComplete` have no ledger param, and we do
// not want to thread one through every signature. Instead `executeOrgRun` enters a run context; leaf
// LLM calls read it via `recordLlmCost()` and attribute their cost to the current node. Outside a run
// context (CLIs, tests) these are no-ops — the scheduler still applies, the ledger simply isn't fed.

import { AsyncLocalStorage } from 'node:async_hooks';

export type BudgetNode = 'discovery' | 'bundle' | 'audit' | 'reserve';

export const BUDGET_ALLOC: Record<BudgetNode, number> = { discovery: 0.10, bundle: 0.60, audit: 0.10, reserve: 0.20 };
// Stop STARTING new discovery/bundle (measure) work past this fraction of B. Audit/reserve still run
// (they finish the run + write the report); they have their own allocations.
// In-flight assumption (admission-only): cost is recorded when a call RETURNS, so up to (concurrency-1)
// in-flight siblings' spend isn't yet in the ledger when a call is admitted — admission can momentarily
// clear slightly past the line. At concurrency ≤2 the 0.20·B reserve absorbs this (reserve ≥ the cost of the
// in-flight calls). The per-bundle phase RAISES concurrency to the activated-bundle count
// (`scheduler.ts requestLlmConcurrency`, scoped per run, ceiling 16), so the reserve no longer fully bounds the overshoot — ACCEPTED
// (cost is not the constraint for these runs): admission still gates STARTING new work and NEVER aborts
// an in-flight generation, so the only effect is a bounded budget overshoot, not a correctness break.
// Env-tunable (default 0.80). A max-power run uses 0.85.
// CLAMPED to [0.5, 0.95]: leaving it unbounded would let an env value (e.g. 0.99 / 1.5)
// erase the reserve entirely — the clamp keeps the stop fraction a meaningful bound regardless of concurrency.
export const GLOBAL_STOP_FRACTION = Math.min(0.95, Math.max(0.5, Number(process.env.THERESA_GLOBAL_STOP_FRACTION) || 0.80));

// Optional per-run observers. The ledger is the one object every nested LLM leaf already reaches
// through the ambient context, so it is also where a run's LIVE spend and its DEGRADATIONS surface without threading a
// run handle through every signature: `onSpend` sees the running total after each recorded cost (the run page's live
// spend), `onDegraded` sees each `recordDegraded(stage, reason)` from a fail-open stage. Both are best-effort — a hook
// that throws is swallowed, because an observer must never break the cost accounting or the run.
export interface LedgerHooks {
  onSpend?: (spentUsd: number) => void;
  onDegraded?: (stage: string, reason: string) => void;
}

export class BudgetLedger {
  readonly total: number;
  private byNode: Record<BudgetNode, number> = { discovery: 0, bundle: 0, audit: 0, reserve: 0 };
  // Per-LANE spend (incremental re-scan, proposal §7): the cost each bundle lane's Critic → Preflight → Expert cost,
  // attributed through the same ambient context (withBudgetLane). It is what the next scan's estimate reads ("est. $a–b
  // instead of ~$c") and what an automatically reused lane saves. A breakdown of the node totals, never extra spend.
  private byLane = new Map<string, number>();
  private _spent = 0;
  private hooks: LedgerHooks;

  constructor(totalUsd: number, hooks: LedgerHooks = {}) { this.total = totalUsd > 0 ? totalUsd : Infinity; this.hooks = hooks; }

  spend(node: BudgetNode, usd: number, lane?: string): void {
    if (!(usd > 0)) return;
    this.byNode[node] += usd;
    this._spent += usd;
    if (lane) this.byLane.set(lane, (this.byLane.get(lane) ?? 0) + usd);
    try { this.hooks.onSpend?.(this._spent); } catch { /* observer only — never affects accounting */ }
  }

  // Take back part of an earlier PROVISIONAL spend: a long agent call records a live estimate while it runs and
  // trues it up against the SDK's authoritative total when it returns; when the estimate ran high, the difference comes
  // back here. Clamped so neither the node nor the total ever goes negative. No onSpend (the live figure only moves up).
  refund(node: BudgetNode, usd: number, lane?: string): void {
    if (!(usd > 0)) return;
    const back = Math.min(usd, this.byNode[node]);
    this.byNode[node] -= back;
    this._spent = Math.max(0, this._spent - back);
    if (lane && this.byLane.has(lane)) this.byLane.set(lane, Math.max(0, (this.byLane.get(lane) ?? 0) - back));
  }

  // A fail-open stage degraded (see recordDegraded). Forwarded to the run's observer; no-op without one.
  degrade(stage: string, reason: string): void {
    try { this.hooks.onDegraded?.(stage, reason); } catch { /* observer only */ }
  }

  spent(): number { return this._spent; }
  spentOn(node: BudgetNode): number { return this.byNode[node]; }
  spentOnLane(lane: string): number { return this.byLane.get(lane) ?? 0; }
  nodeSpend(): Record<BudgetNode, number> { return { ...this.byNode }; }
  remaining(): number { return this.total === Infinity ? Infinity : Math.max(0, this.total - this._spent); }

  // Budget still available within a node's own allocation (for SIZING a sub-call, e.g. per-bundle).
  nodeRemaining(node: BudgetNode): number {
    if (this.total === Infinity) return Infinity;
    return Math.max(0, this.total * BUDGET_ALLOC[node] - this.byNode[node]);
  }

  // May a NEW call for `node` start? discovery/bundle stop at the global 0.80B line; audit/reserve are
  // always admitted (the run must be able to finish + report). Never aborts a running call.
  admit(node: BudgetNode): boolean {
    if (this.total === Infinity) return true;
    if ((node === 'discovery' || node === 'bundle') && this._spent >= this.total * GLOBAL_STOP_FRACTION) return false;
    return true;
  }

  // Has NON-reserve work (discovery + bundle + audit) already eaten into the protected final reserve slice?
  // i.e. everything-but-reserve has spent ≥ (1 − reserve)·B. Used to gate OPTIONAL reserve work (the report
  // red-team): when the reserve is invaded, skip the red-team and ship the writer's report as-is so
  // the run still finishes within budget. `admit('reserve')` can't express this (reserve is always-admitted).
  // NOTE: this tests against `1 − BUDGET_ALLOC.reserve` (= 0.80·B), which equals GLOBAL_STOP_FRACTION
  // only at the DEFAULT 0.80. At a tuned stop=0.85 the two no longer coincide (bundle work admits past 0.80),
  // so the red-team is skipped slightly more eagerly — conservative (skips optional work, never overspends). The
  // two constants are intentionally NOT coupled; don't assume they track.
  reserveInvaded(): boolean {
    if (this.total === Infinity) return false;
    return (this._spent - this.byNode.reserve) >= this.total * (1 - BUDGET_ALLOC.reserve);
  }
}

interface RunCtx { ledger: BudgetLedger; node: BudgetNode; lane?: string }
const als = new AsyncLocalStorage<RunCtx>();

// Enter a per-run budget context (used by executeOrgRun). Nested LLM calls attribute cost to `node`
// until a `withBudgetNode` switches it.
export function withRunBudget<T>(ledger: BudgetLedger, node: BudgetNode, fn: () => Promise<T>): Promise<T> {
  return als.run({ ledger, node }, fn);
}

// Switch the attribution node for everything awaited inside `fn` (e.g. 'discovery' → 'bundle'). No-op
// (just runs fn) when there is no active run context.
export function withBudgetNode<T>(node: BudgetNode, fn: () => Promise<T>): Promise<T> {
  const cur = als.getStore();
  return cur ? als.run({ ledger: cur.ledger, node, lane: cur.lane }, fn) : fn();
}

// Attribute everything awaited inside `fn` to one bundle LANE as well as to its node (per-lane spend). Nested
// withBudgetNode switches keep the lane. No-op without an active run context.
export function withBudgetLane<T>(lane: string, fn: () => Promise<T>): Promise<T> {
  const cur = als.getStore();
  return cur ? als.run({ ...cur, lane }, fn) : fn();
}

// Called by the leaf LLM wrappers (runAgent / openaiComplete) after a call returns its cost.
export function recordLlmCost(usd: number): void {
  const cur = als.getStore();
  if (cur) cur.ledger.spend(cur.node, usd, cur.lane);
}

// Signed variant for the true-up of a provisional (live) estimate: a positive delta spends, a negative one refunds.
export function adjustLlmCost(deltaUsd: number): void {
  const cur = als.getStore();
  if (!cur || !Number.isFinite(deltaUsd) || deltaUsd === 0) return;
  if (deltaUsd > 0) cur.ledger.spend(cur.node, deltaUsd, cur.lane); else cur.ledger.refund(cur.node, -deltaUsd, cur.lane);
}

export function currentLedger(): BudgetLedger | undefined { return als.getStore()?.ledger; }
export function currentBudgetNode(): BudgetNode | undefined { return als.getStore()?.node; }

// ── Degradation sink ─────────────────────────────────────────────────────────
// Fail-open stays, but it is no longer SILENT: a stage that ships without doing its job (a QC judge that could not run,
// a reconcile that was skipped, a writer that fell back) calls recordDegraded(stage, reason), which lands one
// {stage, reason, at} row in `run.degraded` via the run's ledger hook (noteDegraded dedupes identical pairs, so keep
// `reason` STABLE — classify errors with llmFailureReason rather than pasting raw provider text; the full error still
// goes to the run log). Outside a run context (CLIs, tests) it is a no-op, like recordLlmCost.
export function recordDegraded(stage: string, reason: string): void {
  als.getStore()?.ledger.degrade(stage, reason);
}

// A short, STABLE reason for an LLM/codex failure message — the banner row, not the diagnostic (that stays in the log).
// The 401 class once hit every codex/gpt stage of a run while the pipeline looked
// healthy, so it is named explicitly and points at the key.
export function llmFailureReason(msg: string | undefined | null): string {
  const m = String(msg ?? '');
  if (!m.trim()) return 'no output';
  if (/OPENAI_API_KEY not set/i.test(m)) return 'OPENAI_API_KEY not set';
  if (/\b401\b|unauthori[sz]ed|invalid[_ ]api[_ ]key|incorrect api key/i.test(m)) return 'OpenAI auth failed (401) — check OPENAI_API_KEY';
  if (/\b403\b|forbidden/i.test(m)) return 'access denied (403)';
  if (/\b429\b|rate.?limit|insufficient_quota|quota/i.test(m)) return 'rate limited or out of quota (429)';
  if (/skipped: run-budget envelope/.test(m)) return 'run budget envelope reached';
  if (/\b5\d\d\b|timed? ?out|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|socket hang up/i.test(m)) return 'provider or network error';
  return 'unexpected error';
}

// ── Live spend + the cap ─────────────────────────────────────────────────────────────────────────
// The run page showed "— spend" for the whole of a $108 run. The ledger now reports every recorded cost (LedgerHooks.
// onSpend); persisting the run on EVERY leaf would rewrite state.json hundreds of times, so the live figure is
// throttled: persist when it moved by ≥ minUsd or ≥ minMs passed since the last persist. The terminal finish always
// writes the exact total, so the throttle only bounds how stale the RUNNING figure can be.
export function liveCostDue(last: { usd: number; at: number } | undefined, spentUsd: number, nowMs: number, minMs = 5000, minUsd = 0.5): boolean {
  if (!last) return spentUsd > 0;
  if (!(spentUsd > last.usd)) return false;
  return spentUsd - last.usd >= minUsd || nowMs - last.at >= minMs;
}

// Admission is START-only (see the header), so a run's final cost CAN exceed its cap (in-flight siblings finish; the
// reserve always admits). That is accepted, but not silent: the finished run records a degradation naming the overrun.
// null when within the cap or when the ledger was unbounded (cap ≤ 0 / non-finite = force-all).
export function budgetOverrunReason(costUsd: number | null | undefined, capUsd: number): string | null {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || !(capUsd > 0) || !Number.isFinite(capUsd)) return null;
  if (costUsd <= capUsd) return null;
  const pct = ((costUsd - capUsd) / capUsd) * 100;
  return `exceeded cap by ${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}% ($${costUsd.toFixed(2)} of a $${capUsd.toFixed(2)} cap)`;
}

// OPTIONAL late stages (reconcile, the combined-report normalizer) are skipped once the run is nearly out of budget:
// the cap is reached, or less than HALF the reserve slice is left (spent ≥ (1 − reserve/2)·B = 0.90·B at defaults —
// the other half stays for the required leadership report). Admission is otherwise start-only and the reserve always
// admits, so a normalize pass started at $7.92 of an $8 cap ran for 10 minutes and ended at $10.56. null = go ahead (also for an unbounded ledger).
// the 0.90·B line alone still let a normalize pass start at $6.71 of an $8 cap (84%) and end at $8.96 (+12%),
// because that one stage costs ~$2+. `estUsd` is the stage's expected cost: when what is left of the cap cannot cover
// it, the stage is skipped up front instead of being started and overshooting.
// The SDK `maxBudgetUsd` for ONE agent query so it cannot run the ledger past `fraction`·B (Quick Ask: the
// investigate agent at 0.80·B — the same line admission stops new work at — and its salvage pass at the whole cap).
// What is already spent counts against it; a floor of $0.01 lets the SDK stop after one turn rather than leaving the
// cap off. undefined (no cap) without a ledger or on an unbounded one (budget 0 / force-all).
export function agentBudgetCap(ledger: BudgetLedger | undefined, fraction = 1): number | undefined {
  if (!ledger || ledger.total === Infinity) return undefined;
  return Math.max(0.01, ledger.total * fraction - ledger.spent());
}

export function lateStageSkipReason(ledger: BudgetLedger | undefined, estUsd = 0): string | null {
  if (!ledger || ledger.total === Infinity) return null;
  const at = `$${ledger.spent().toFixed(2)} of a $${ledger.total.toFixed(2)} cap`;
  if (ledger.spent() >= ledger.total) return `run budget cap reached (${at})`;
  if (ledger.spent() >= ledger.total * (1 - BUDGET_ALLOC.reserve / 2)) return `run budget nearly spent (${at})`;
  if (estUsd > 0 && ledger.spent() + estUsd > ledger.total) return `not enough run budget left for it (~$${estUsd.toFixed(2)} est.; ${at})`;
  return null;
}

// INCREMENTAL RE-SCAN targeted re-checks (src/research/incrReverify.ts) are AUDIT work — they decide whether a prior
// finding is still true — and must not be starved by the bundle phase. They used to be gated on `!reserveInvaded()`,
// which ran them only while everything-but-reserve was under 0.80·B; the carry pass runs AFTER the re-run lanes, which
// had already spent past that line, so every re-check was skipped ("the targeted re-check budget for this run was used
// up") on the 2026-09-29 end-to-end (p-limit, 4 lanes, spent > 0.80·B before the carry pass — zero re-verify calls in the
// audit log).
// But the report stage's OPTIONAL steps (the free-vibe leadership brief, the structured red-team) skip once
// reserveInvaded() — so a re-check must never be what CROSSES that line. A
// re-check may START when
//   • it keeps everything-but-reserve at or under the reserveInvaded line ((1 − 0.20)·B): it uses the audit slice, the
//     reserve stays untouched; or
//   • the reserve is ALREADY invaded (the lanes crossed the line — the optional report steps skip either way) and
//     spent + perCheckUsd ≤ cap − the report-stage estimate (REPORT_STAGE_EST_USD, ≈ the ~3-pass leadership brief the
//     report stage's back-off comment cites, capped at the 0.20·B slice), so the structured writer keeps its money.
// An unbounded ledger always admits (the caller's count cap still applies). Admission-only like every gate here: a
// started re-check is bounded by its own SDK maxBudgetUsd (= perCheckUsd).
export const REPORT_STAGE_EST_USD = 1.5;

// Leadership v5 (report lens split): the v5 brief is short (≈300 words, no charts) and, without OpenAI, one Claude
// author pass — so it costs well under the ~3-pass v0 / v4 estimate above. A CONSERVATIVE ceiling for that one call.
export const V5_AUTHOR_EST_USD = 1.2;
/**
 * May the free-vibe leadership author start? Not invaded → yes. Invaded (umami E2E: $24.89 of a $30 cap — the author was
 * skipped with ≈$5 left) → a v5 author still runs when what is left of the cap covers V5_AUTHOR_EST_USD; a v0 / v4
 * author does not. `why` is the log line either way.
 */
export function leadershipAuthorAdmit(ledger: Pick<BudgetLedger, 'total' | 'spent' | 'remaining' | 'reserveInvaded'> | undefined, v5: boolean): { run: boolean; why: string } {
  if (!ledger || !ledger.reserveInvaded()) return { run: true, why: '' };
  const left = ledger.remaining();
  const money = `$${ledger.spent().toFixed(2)} of a $${ledger.total.toFixed(2)} cap spent, $${left.toFixed(2)} left`;
  if (v5 && left >= V5_AUTHOR_EST_USD) return { run: true, why: `reserve budget invaded (${money}) — running the v5 author anyway: it fits (estimate $${V5_AUTHOR_EST_USD.toFixed(2)})` };
  return { run: false, why: `reserve budget invaded (${money}) — skipping the free-vibe leadership author (${v5 ? `under the v5 estimate $${V5_AUTHOR_EST_USD.toFixed(2)}` : 'v0 / v4 author ≈3 passes'}); the structured writer writes the brief` };
}
export function reverifyAdmit(ledger: Pick<BudgetLedger, 'total' | 'spent' | 'spentOn' | 'reserveInvaded'> | undefined, perCheckUsd: number, reportReserveUsd: number = REPORT_STAGE_EST_USD): boolean {
  if (!ledger || ledger.total === Infinity) return true;
  const check = Math.max(0, perCheckUsd);
  if (!ledger.reserveInvaded()) return ledger.spent() - ledger.spentOn('reserve') + check <= ledger.total * (1 - BUDGET_ALLOC.reserve);
  const reserve = Math.min(ledger.total * BUDGET_ALLOC.reserve, Math.max(0, Number.isFinite(reportReserveUsd) ? reportReserveUsd : REPORT_STAGE_EST_USD));
  return ledger.spent() + check <= ledger.total - reserve;
}

// Expected cost of the combined-report normalizer, per source report. Calibrated on end-to-end test runs: 2-report
// merges cost $2.25 and $2.64, about $1.25 per report on the Claude writer.
export const NORMALIZE_EST_USD_PER_REPORT = 1.25;
export function normalizeCostEstimate(reportCount: number): number {
  return Math.max(0, Math.floor(reportCount)) * NORMALIZE_EST_USD_PER_REPORT;
}

// ── Live (provisional) cost of a long agent call ──────────────────────────────────────────────────────────
// The Agent SDK reports a query's cost only in its final `result` message, so a 9-minute normalize round left the live
// spend frozen and then jumped by $2.25. While a query runs, runAgent now prices each assistant turn's token usage with
// a rate CALIBRATED from the queries that already finished in this process (their authoritative total_cost_usd over
// their token usage, per model) — no hard-coded price table to drift. Before any calibration exists there is no
// estimate (the old behavior). The final result trues the estimate up (adjustLlmCost), so the ledger total stays exact.
export interface TokenUsage { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
// Usage in "input-token equivalents". Every Claude model prices output at 5x input, cache writes at 1.25x and cache
// reads at 0.1x, so one calibrated $/unit rate covers every token class of a model.
export function usageUnits(u: TokenUsage | undefined | null): number {
  if (!u) return 0;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return n(u.input_tokens) + 5 * n(u.output_tokens) + 1.25 * n(u.cache_creation_input_tokens) + 0.1 * n(u.cache_read_input_tokens);
}
export class CostCalibration {
  private byModel = new Map<string, { usd: number; units: number }>();
  private all = { usd: 0, units: 0 };
  // Feed one finished query: its per-model cost + usage (the SDK result's modelUsage), or the query total under ''.
  observe(model: string, usd: number, units: number): void {
    if (!(usd > 0) || !(units > 0)) return;
    const k = model || '';
    const m = this.byModel.get(k) ?? { usd: 0, units: 0 };
    m.usd += usd; m.units += units; this.byModel.set(k, m);
    this.all.usd += usd; this.all.units += units;
  }
  // $ per unit for `model` (its own history first, else every model seen); null before any finished query.
  rate(model?: string): number | null {
    const m = model ? this.byModel.get(model) : undefined;
    if (m && m.units > 0) return m.usd / m.units;
    return this.all.units > 0 ? this.all.usd / this.all.units : null;
  }
  estimate(model: string | undefined, u: TokenUsage | undefined | null): number {
    const r = this.rate(model); return r == null ? 0 : r * usageUnits(u);
  }
}
export const claudeCostCalibration = new CostCalibration();

// A run's recorded cost: rounded to 1/100 cent (float sums print as 10.560582499999999 in /api/state and SSE).
export function roundUsd(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(4)) : null;
}

// The per-query half of the live estimate, driven by runAgent's SDK message loop (pure; unit-tested with synthetic SDK
// messages). assistant(msg): record this turn's estimate now. result(msg): capture the authoritative total + calibrate.
// finish(): true the ledger up to that total and return the query's cost (the estimate when no result ever arrived).
export class QueryCostTracker {
  private provisional = 0;
  private total: number | null = null;
  private seen = new Set<string>();
  private cal: CostCalibration;
  constructor(cal: CostCalibration = claudeCostCalibration) { this.cal = cal; }
  assistant(msg: any): void {
    const m = msg?.message; if (!m?.usage) return;
    const id = typeof m.id === 'string' ? m.id : '';
    if (id) { if (this.seen.has(id)) return; this.seen.add(id); }   // one API response can span several assistant messages
    const est = this.cal.estimate(typeof m.model === 'string' ? m.model : undefined, m.usage);
    if (est > 0) { this.provisional += est; recordLlmCost(est); }
  }
  result(msg: any): void {
    if (typeof msg?.total_cost_usd === 'number' && Number.isFinite(msg.total_cost_usd)) this.total = msg.total_cost_usd;
    try {
      for (const [model, mu] of Object.entries((msg?.modelUsage ?? {}) as Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }>)) {
        this.cal.observe(model, Number(mu?.costUSD) || 0, usageUnits({ input_tokens: mu?.inputTokens, output_tokens: mu?.outputTokens, cache_read_input_tokens: mu?.cacheReadInputTokens, cache_creation_input_tokens: mu?.cacheCreationInputTokens }));
      }
    } catch { /* calibration is best-effort */ }
  }
  finish(): number {
    if (this.total == null) return this.provisional;
    adjustLlmCost(this.total - this.provisional);
    return this.total;
  }
}

