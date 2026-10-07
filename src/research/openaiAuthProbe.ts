// Boot-time OpenAI key probe.
//
// The deployed instance's OPENAI_API_KEY returned 401 for a whole run: every codex/gpt stage — the QC
// judges, reconcile, the normalizer — failed open, and the pipeline looked healthy. One cheap, non-billed call at boot
// (`GET /v1/models`, a listing — no tokens) tells the user up front: the server logs a structured
// `component:boot event:openai-auth-failed` line and /api/state exposes `openaiAuthOk` for the console banner.
//
// Tri-state result: true = the key authenticated; false = the provider REJECTED it (401/403 — the actionable case);
// undefined = inconclusive (no key, network error, 5xx, timeout) — never reported as a bad key. The key is sent only
// in the Authorization header and never logged. `fetchImpl` is injectable so the classification is unit-tested.
export type OpenAiAuthProbe = { ok: boolean | undefined; status?: number; error?: string };

export async function probeOpenAiAuth(opts: { key?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<OpenAiAuthProbe> {
  const key = opts.key ?? process.env.OPENAI_API_KEY;
  if (!key) return { ok: undefined, error: 'OPENAI_API_KEY not set' };
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (res.ok) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status };
    return { ok: undefined, status: res.status, error: `unexpected HTTP ${res.status}` };
  } catch (e) {
    return { ok: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}
