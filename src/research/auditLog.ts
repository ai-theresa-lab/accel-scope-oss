// Per-node AUDIT LOG — the run "flight recorder". Captures EVERY LLM leaf call's full input (prompt) +
// output (raw response) + tool calls (full args) + model/tier/cost/ms/error, so a developer can (a) judge
// per-node output quality and (b) VERIFY that a newly-mounted MCP source actually got CALLED in the pipeline
// (mounted != used — the "0 calls" acceptance test). It is a PARALLEL artifact sourced from the leaf wrappers,
// NOT derived from persistRunTrace (which is intentionally truncated + per-bundle).
//
// Mirrors budget.ts: a per-run recorder carried via AsyncLocalStorage, fed by runAgent / openaiComplete with
// NO signature threading. Outside a run context (most tests) the getter is a no-op. FAIL-OPEN throughout — a
// logging failure must NEVER break a run.
//
// Persistence: each leaf is appended (sync, ordered, crash-safe) as one JSON line to a JSONL sidecar on disk
// (the source of truth — NOT an unbounded in-memory array). Leaf COUNT is bounded by the fan-out caps
// (~30-40/run); each prompt/response/tool-arg is capped (generous, with a `[truncated N]` marker). The owner
// chose FULL/unredacted capture for completeness (internal artifact, never served on /share).

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, readFileSync } from 'node:fs';
import { currentBudgetNode } from './budget.ts';

export interface AuditToolCall { name: string; args: string }
export type AuditKind = 'agent' | 'openai' | 'deterministic' | 'meta';

export interface AuditLeaf {
  seq: number;
  ts: number;                 // ms epoch
  kind: AuditKind;
  label?: string;             // the node's runAgent/openai label, e.g. 'critique', 'claim-audit:recsys-mle'
  stage?: string;             // coarse phase, e.g. 'bundle' | 'synthesize' | 'report' (from withAuditContext)
  bundleId?: string;          // owning bundle (from withAuditContext)
  budgetNode?: string;        // discovery | bundle | audit | reserve (from the budget ALS)
  model?: string;
  tier?: string;              // 'claude' (runAgent) | 'openai' (openaiComplete)
  fallbackFrom?: string;      // 'openai' when a Claude leaf is the fallback after an OpenAI attempt failed
  prompt?: string;
  promptTruncated?: number;   // bytes dropped from prompt (0/undefined = full)
  response?: string;
  responseTruncated?: number;
  toolCalls?: AuditToolCall[];
  costUsd?: number;
  ms?: number;
  turns?: number;
  error?: string;
  mountedServers?: string[];  // for kind:'meta' — the MCP servers mounted into this run (the "0 calls" baseline)
}

// Generous per-field caps. The owner wants completeness, but an unbounded field (a pathological multi-MB prompt)
// must not blow up the JSONL — so cap with a marker rather than truncate silently or store unbounded.
const FIELD_CAP = Number(process.env.THERESA_AUDIT_FIELD_CAP || 262_144); // 256 KB per prompt / response
const ARG_CAP = Number(process.env.THERESA_AUDIT_ARG_CAP || 16_384);      // 16 KB per tool-call arg

function capField(s: string | undefined, n: number): { v?: string; truncated?: number } {
  if (s == null) return {};
  return s.length <= n ? { v: s } : { v: s.slice(0, n), truncated: s.length - n };
}

export class AuditRecorder {
  private seq = 0;
  private readonly jsonlPath: string;   // explicit field (NOT a TS parameter property — repo rule: erasable syntax only)
  constructor(jsonlPath: string) { this.jsonlPath = jsonlPath; }

  // Record the MCP servers mounted into this run (called where mcpServers is assembled — NOT an afterthought;
  // the "mounted but 0 calls" panel needs this baseline). Safe to call more than once (the renderer unions them).
  noteMountedServers(names: string[]): void {
    const m = [...new Set((names || []).filter(Boolean))];
    if (m.length) this.append({ kind: 'meta', mountedServers: m });
  }

  // Record one leaf. Merges the ambient stage/bundleId (audit ALS) + budgetNode (budget ALS), caps big fields.
  record(partial: Partial<AuditLeaf> & { kind: AuditKind }): void {
    const ctx = auditCtx.getStore();
    const p = capField(partial.prompt, FIELD_CAP);
    const r = capField(partial.response, FIELD_CAP);
    this.append({
      ...partial,
      stage: partial.stage ?? ctx?.stage,
      bundleId: partial.bundleId ?? ctx?.bundleId,
      budgetNode: partial.budgetNode ?? currentBudgetNode(),
      prompt: p.v, promptTruncated: p.truncated,
      response: r.v, responseTruncated: r.truncated,
      toolCalls: partial.toolCalls?.map((t) => ({ name: t.name, args: (t.args ?? '').slice(0, ARG_CAP) })),
    });
  }

  private append(leaf: Partial<AuditLeaf>): void {
    try {
      const full: AuditLeaf = { seq: this.seq++, ts: Date.now(), kind: leaf.kind ?? 'agent', ...leaf } as AuditLeaf;
      appendFileSync(this.jsonlPath, JSON.stringify(full) + '\n');
    } catch { /* fail-open: a logging failure never breaks a run */ }
  }
}

interface AuditCtx { recorder: AuditRecorder; stage?: string; bundleId?: string }
const auditCtx = new AsyncLocalStorage<AuditCtx>();

// Enter a per-run audit context (used by executeOrgRun / executeAuditRun / the CLIs). A separate ALS instance
// from budget's — they compose without interference.
export function withAuditRun<T>(recorder: AuditRecorder, fn: () => Promise<T>): Promise<T> {
  return auditCtx.run({ recorder }, fn);
}

// Tag everything awaited inside `fn` with a stage / bundleId. MERGES the current context (keeps the recorder) —
// never replaces it. No-op when there is no active audit run.
export function withAuditContext<T>(ctx: { stage?: string; bundleId?: string }, fn: () => Promise<T>): Promise<T> {
  const cur = auditCtx.getStore();
  if (!cur) return fn();
  return auditCtx.run({ ...cur, ...ctx }, fn);
}

export function currentAuditRecorder(): AuditRecorder | undefined { return auditCtx.getStore()?.recorder; }

// Read back the JSONL sidecar (best-effort; a malformed line is skipped). Used by the run-end HTML render.
export function readAuditLeaves(jsonlPath: string): AuditLeaf[] {
  try {
    return readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as AuditLeaf; } catch { return null; } })
      .filter((x): x is AuditLeaf => x !== null);
  } catch { return []; }
}

// The set of MCP servers a leaf actually CALLED, parsed from tool names of the form mcp__<server>__<tool>.
export function calledMcpServers(leaf: AuditLeaf): Set<string> {
  const s = new Set<string>();
  for (const t of leaf.toolCalls ?? []) {
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(t.name);
    if (m) s.add(m[1]);
  }
  return s;
}
