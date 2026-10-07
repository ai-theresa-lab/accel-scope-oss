// OpenAI HTTP client for the TEXT-OUT pipeline steps (synthesis + the report writers). These steps call
// NO tools, so they don't need the Claude Agent SDK — a plain chat-completions call is enough. When
// OPENAI_API_KEY is set these steps run on OpenAI (gpt-5.5); otherwise
// the callers fall back to Claude. Read-only: the key is read from process.env and sent only in the
// Authorization header — never logged, never persisted. Node ≥22 (global fetch).

import { withLlmSlot } from './scheduler.ts';
import { recordLlmCost, currentLedger, currentBudgetNode } from './budget.ts';
import { BUDGET_SKIP_MARKER } from './agent.ts';
import { currentAuditRecorder } from './auditLog.ts';
import { openaiCostUsd, chatUsage } from './openaiPricing.ts';
import { redactSecrets } from './reportEvidence.ts';

const DEFAULT_MODEL = 'gpt-5.5';
// Cost: priced from the response's usage + model against the shared table (openaiPricing.ts) and recorded to the run
// ledger, so it counts toward run.costUsd and the budget. A token-priced estimate, not the OpenAI invoice.

export function openaiAvailable(): boolean { return !!process.env.OPENAI_API_KEY; }

// Total attempts for a transient failure (1 try + retries). Env-tunable; default 3. A gpt-5.5 call can flake on a 429 /
// 5xx / dropped socket / (occasionally) an empty completion — without a retry that surfaced as "QC unavailable" and the
// step fell open. Retry ONLY these transient classes; NEVER retry auth (401/403), a 400 bad request, or a budget-skip
// (those won't fix themselves). This is a retry-after-failure, not a timeout — it never aborts an in-flight generation.
// Total attempts = retries + 1. Sanitized: THERESA_OPENAI_RETRIES=0 truly disables retries (1 attempt); a NaN/unset env
// defaults to 2 retries; a huge/Infinity value is clamped so the loop can't run unbounded.
const OPENAI_ATTEMPTS = (() => {
  const env = process.env.THERESA_OPENAI_RETRIES;
  const n = env == null || env === '' ? 2 : Math.floor(Number(env));
  const retries = Number.isFinite(n) && n >= 0 ? Math.min(n, 5) : 2;
  return retries + 1;
})();
function isRetryableOpenAiError(msg: string): boolean {
  if (msg.startsWith(BUDGET_SKIP_MARKER)) return false;                              // admission skip — not transient
  if (/\bOpenAI (400|401|403|404)\b/.test(msg)) return false;                        // auth / bad request — won't fix on retry
  if (/insufficient_quota|exceeded your current quota|billing_hard_limit|billing/i.test(msg)) return false;   // hard-quota 429 — not transient
  return /\bOpenAI (429|408|409|5\d\d)\b/.test(msg)                                  // rate limit / server errors
    || /\b(no text content)\b/i.test(msg)                                            // empty completion — a model hiccup, retry
    || /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang ?up|network|fetch failed|terminated/i.test(msg);
}

export async function openaiComplete(opts: { prompt: string; model?: string; maxTokens?: number; label?: string; log?: (m: string) => void }): Promise<{ text: string; costUsd: number }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const model = opts.model || DEFAULT_MODEL;
  const body: Record<string, unknown> = { model, messages: [{ role: 'user', content: opts.prompt }] };
  if (opts.maxTokens) body.max_completion_tokens = opts.maxTokens;   // gpt-5 family uses max_completion_tokens
  // Acquire one process-wide LLM slot (same semaphore the Claude agent uses) so OpenAI text-out steps
  // count against the global concurrency cap — not a parallel uncapped lane.
  return withLlmSlot(async () => {
    const startedAt = Date.now();
    let outText = '', outCost = 0, outErr: string | undefined;
    try {
      // Attempt loop: retry ONLY transient failures (429/5xx/network/empty completion) with exponential backoff, so a
      // one-off gpt-5.5 flake no longer fails the whole step open (that's how the QC judge surfaced "QC unavailable").
      // Non-transient (auth / 400 / budget-skip) throws immediately. Backoff is a wait BETWEEN attempts — it never
      // aborts an in-flight request (no request timeout, by design).
      for (let attempt = 1; ; attempt++) {
        try {
          // Late admission gate, symmetric with runAgent's. Today EVERY openaiComplete caller
          // runs at the always-admitted 'reserve'/'audit' node, so this never fires — it future-proofs the leaf so a
          // discovery/bundle caller can't spend past 0.80B ungated. A budget-skip throw is NON-retryable (see classifier).
          const led = currentLedger(); const node = currentBudgetNode();
          if (led && node && !led.admit(node)) throw new Error(`${BUDGET_SKIP_MARKER} (>=80%) — openai ${node} call not started`);
          // NO request timeout, by design: a tool-free text step (synthesis / report writer / QC judge) must run to
          // COMPLETION on gpt-5.5 — a large report output can take minutes, and we never abort it early.
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
          });
          if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`OpenAI ${res.status}: ${redactSecrets(t.slice(0, 300))}`); }   // the body can echo request details: redact before it reaches run logs
          const j = await res.json() as any;
          const text = j?.choices?.[0]?.message?.content;
          if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned no text content');
          const u = j.usage || {};
          const costUsd = openaiCostUsd(j.model || model, chatUsage(u));
          // Attribute to the current run/node ledger so OpenAI spend counts toward the run budget (no-op in CLIs).
          recordLlmCost(costUsd);
          opts.log?.(`  ↳ openai ${j.model || model}: ${u.prompt_tokens ?? '?'}+${u.completion_tokens ?? '?'} tok · ≈$${costUsd.toFixed(3)}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
          outText = text; outCost = costUsd;
          return { text, costUsd };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (attempt >= OPENAI_ATTEMPTS || !isRetryableOpenAiError(msg)) throw e;   // out of retries or non-transient → give up
          const backoff = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300);   // 0.5s,1s,2s… + jitter
          opts.log?.(`  ↳ openai ${model} attempt ${attempt}/${OPENAI_ATTEMPTS} failed (${redactSecrets(msg).slice(0, 90)}) — retrying in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    } catch (e) { outErr = e instanceof Error ? e.message : String(e); throw e; }
    finally {
      // Record the audit leaf on BOTH success and every throw (admission / HTTP / empty body), so a
      // gpt-5.5→Claude fallback shows both attempts. fail-open.
      try { currentAuditRecorder()?.record({ kind: 'openai', label: opts.label, model, tier: 'openai', prompt: opts.prompt, response: outText, costUsd: outCost, ms: Date.now() - startedAt, error: outErr }); } catch { /* fail-open */ }
    }
  });
}
