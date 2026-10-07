// OpenAI / codex token pricing — ONE table for every OpenAI spend path (chat-completions fallback, codex file tasks,
// the codex HTML QC judge, the codex reconciler, the codex HTML writer). Each of those used to carry its own
// `IN_PER_M = 1.25, OUT_PER_M = 10` — gpt-5's launch price — while production runs gpt-5.5 ($5 / $30), so OpenAI spend
// was under-counted ~3-4x in run.costUsd and in the budget ledger, and cached input was billed at the full rate.
//
// Standard-tier USD per 1M tokens, from https://developers.openai.com/api/docs/pricing (checked 2026-10-05).
// Long-context surcharges (>272K input) are not modelled: our prompts stay far below that.
// A model is matched by the longest table key that its id starts with ("gpt-5.5-2026-04-23" → "gpt-5.5"). An id the
// table does not know is priced as DEFAULT_MODEL — the model the pipeline runs — so a new model never reads as $0.
export interface OpenAIPrice { input: number; cachedInput: number; output: number }
const PRICES: Record<string, OpenAIPrice> = {
  'gpt-5.6-sol': { input: 4.00, cachedInput: 0.40, output: 20.00 },
  'gpt-5.6-terra': { input: 2.00, cachedInput: 0.20, output: 12.00 },
  'gpt-5.6-luna': { input: 0.20, cachedInput: 0.02, output: 1.20 },
  'gpt-5.5-pro': { input: 30.00, cachedInput: 30.00, output: 180.00 },   // no cached-input rate published ⇒ full rate
  'gpt-5.5': { input: 5.00, cachedInput: 0.50, output: 30.00 },
  'gpt-5.4-nano': { input: 0.20, cachedInput: 0.02, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.50 },
  'gpt-5.4': { input: 2.50, cachedInput: 0.25, output: 15.00 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.40 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.00 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10.00 },
};
const DEFAULT_MODEL = 'gpt-5.5';
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

/** The price row for a model id, and whether the table actually knew it (false ⇒ priced as DEFAULT_MODEL). */
export function openaiPrice(model: string | undefined | null): { price: OpenAIPrice; known: boolean } {
  const m = String(model ?? '').trim().toLowerCase();
  const key = KEYS.find((k) => m === k || m.startsWith(k + '-'));
  return key ? { price: PRICES[key], known: true } : { price: PRICES[DEFAULT_MODEL], known: false };
}

/** Token usage in OpenAI's convention: `cached` is the part of `input` served from the prompt cache (a subset). */
export interface OpenAIUsage { input: number; cached: number; output: number }

/** USD for one call's usage. Cached input is billed at the cached rate, the rest of the input at the full rate. */
const warnedUnknown = new Set<string>();
export function openaiCostUsd(model: string | undefined | null, u: OpenAIUsage): number {
  const { price, known } = openaiPrice(model);
  // An unpriced model id (e.g. the bare `gpt-5.6` codex default, which the published table only lists as sol / terra /
  // luna) is costed at the gpt-5.5 row — say so once per id so a mispriced total is visible in the service log.
  const id = String(model ?? '').trim();
  if (!known && id && !warnedUnknown.has(id)) { warnedUnknown.add(id); console.log(JSON.stringify({ severity: 'WARNING', component: 'cost', event: 'openai-model-unpriced', model: id, pricedAs: DEFAULT_MODEL })); }
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const input = n(u.input), cached = Math.min(n(u.cached), input), output = n(u.output);
  return ((input - cached) * price.input + cached * price.cachedInput + output * price.output) / 1e6;
}

/** Usage of a chat-completions response (`usage.prompt_tokens_details.cached_tokens` is a subset of prompt_tokens). */
export function chatUsage(usage: any): OpenAIUsage {
  const u = usage ?? {};
  return { input: Number(u.prompt_tokens) || 0, cached: Number(u.prompt_tokens_details?.cached_tokens) || 0, output: Number(u.completion_tokens) || 0 };
}

/**
 * Usage summed over a `codex exec --json` stream: every `turn.completed` event carries
 * `{input_tokens, cached_input_tokens, output_tokens}` (cached is a subset of input, as in the API).
 */
export function codexStreamUsage(stdout: string): OpenAIUsage {
  const out: OpenAIUsage = { input: 0, cached: 0, output: 0 };
  for (const l of String(stdout || '').split('\n')) {
    const t = l.trim(); if (!t.startsWith('{')) continue;
    try {
      const e = JSON.parse(t);
      if (e?.type !== 'turn.completed' || !e.usage) continue;
      out.input += Number(e.usage.input_tokens ?? e.usage.prompt_tokens ?? 0) || 0;
      out.cached += Number(e.usage.cached_input_tokens ?? 0) || 0;
      out.output += Number(e.usage.output_tokens ?? e.usage.completion_tokens ?? 0) || 0;
    } catch { /* not json */ }
  }
  return out;
}
