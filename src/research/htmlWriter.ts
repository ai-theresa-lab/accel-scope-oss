// Shared HTML file-writer backend. A coding agent AUTHORS an HTML file DIRECTLY in a scratch workspace via file
// I/O — it never emits HTML on stdout. Two backends behind one interface: `codex` (the codex CLI, workspace-write) and
// `claude` (the Agent SDK with writableCwd). Both confine writes to the scratch cwd. Extracted from analystReport.ts so
// the Analyst (per-bundle report writer) AND the Report Normalizer (merge many reports → one tabbed file) share ONE copy
// of the codex plumbing — critically the secret-scrubbing env allowlist (`scrubbedEnv`), which must never drift into two
// definitions. The security notes below are load-bearing — keep them with the code.
import { spawn, spawnSync } from 'node:child_process';
import { runAgent } from './agent.ts';
import { openaiCostUsd, codexStreamUsage } from './openaiPricing.ts';
import { recordLlmCost } from './budget.ts';

// Writer backend ORDER. OpenAI (codex) is tried FIRST; Claude Code (the Agent SDK) is the fallback. A writer starts on
// order[0] and advances to the next backend when a round fails — codex missing, a non-zero exit, or no file authored —
// so "try OpenAI, fall back to Claude Code" is a RUNTIME behaviour, not a one-shot choice made before anything runs.
// codex authors a full HTML report in ~1–2 min/round where the Agent SDK grinds for many minutes on a 100KB+
// single-file Write, so codex-first is also the fast path. (The Docker image ships codex, authed from
// CODEX_HOME/auth.json, which server boot provisions from OPENAI_API_KEY.)
//
// ⚠ BILLING — this REVERSES an earlier rule, deliberately. Previously a pasted BYO Claude token forced the 'claude'
// backend because the codex CLI runs on its OWN auth (the instance's OPENAI_API_KEY) and silently ignores opts.authToken.
// Now the FIRST attempt is always codex, so on a BYO run the codex rounds bill the instance's OpenAI key and only the fallback rounds
// bill the user's pasted credential. Set THERESA_REPORT_WRITER=claude to restore BYO-only writing (an explicit pin also
// disables the fallback).
export type WriterBackend = 'codex' | 'claude';

let _codexOk: boolean | undefined;
// codex runs only on the OpenAI key the user configured (src/apiKeys.ts writes it into a private CODEX_HOME): without
// OPENAI_API_KEY it is unavailable, so an installed codex can never fall back to someone's own ChatGPT login.
export function codexAvailable(): boolean {
  if (!process.env.OPENAI_API_KEY) return false;
  if (_codexOk === undefined) { try { _codexOk = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0; } catch { _codexOk = false; } }
  return _codexOk;
}

// OPT-IN "no codex without an OS sandbox" for the REPORT pipeline (THERESA_REPORT_CODEX_REQUIRE_SANDBOX=1,
// default OFF). On Cloud Run (THERESA_CODEX_NO_SANDBOX=1, gVisor) every report-pipeline codex call runs with
// --dangerously-bypass-approvals-and-sandbox over scanned-repo-derived content with CODEX_HOME/auth.json readable — a
// key-exfil surface (the OpenAI key on disk, reachable by an unsandboxed agent over untrusted repos). With the flag set
// and no OS sandbox, codex is treated as UNAVAILABLE for reports, so each call site takes its existing codex-less path:
// the HTML writers use the Claude writer (writerOrder → ['claude']), the codex file-task steps and
// the html-QC judge use the tool-free gpt-5.5 fallback, and reconcile is skipped (recorded as a degradation).
// Default OFF keeps today's deployed behaviour; the residual risk while OFF is that codex runs unsandboxed.
export function reportCodexSandboxBlocked(): boolean {
  return process.env.THERESA_REPORT_CODEX_REQUIRE_SANDBOX === '1' && process.env.THERESA_CODEX_NO_SANDBOX === '1';
}
// codex availability as the REPORT pipeline sees it: the CLI is installed AND the sandbox requirement is met.
export function reportCodexAvailable(): boolean {
  return !reportCodexSandboxBlocked() && codexAvailable();
}

// The model for EVERY `codex exec` in the pipeline — ONE definition (like scrubbedEnv above) so the report writer, the
// HTML QC judge and the reconciler can never drift onto different models. NOTE: the tool-free
// chat-completions fallback (research/openai.ts) keeps its OWN DEFAULT_MODEL and is deliberately NOT covered by this.
//
// ROLLBACK IS AN ENV CHANGE, NOT A CODE CHANGE. If this model id is rejected by the pinned @openai/codex CLI, the org
// has no access to it, or its output regresses: set THERESA_CODEX_MODEL=gpt-5.5 and redeploy config-only — do NOT edit
// or revert this line. Symptom: `codex round N exit <non-zero>` every round, then `↪ falling back to the claude
// writer` (the runtime fallback below) — reports still ship, on the Claude credential instead of the codex key.
export const CODEX_MODEL = process.env.THERESA_CODEX_MODEL || 'gpt-5.6';

// The backends to try, in order. THERESA_REPORT_WRITER pins ONE (no fallback); otherwise codex first, Claude after.
export function writerOrder(): WriterBackend[] {
  if (process.env.THERESA_REPORT_WRITER === 'claude') return ['claude'];
  if (process.env.THERESA_REPORT_WRITER === 'codex') return reportCodexAvailable() ? ['codex'] : ['claude'];   // even a codex pin never runs unsandboxed when the sandbox is required
  return reportCodexAvailable() ? ['codex', 'claude'] : ['claude'];
}

// The codex child gets a SCRUBBED env: codex authenticates from its own ~/.codex config, not env, and —
// unlike runAgent — has no Bash/egress denial, so a prompt-injected codex run must not inherit the server's secrets.
// Drop any key whose name looks credential-bearing; keep PATH/HOME/etc. so the CLI still runs.
export function scrubbedEnv(): NodeJS.ProcessEnv {
  // ALLOWLIST (default-deny). A denylist leaked connection-string secrets (DATABASE_URL / REDIS_URL / MONGODB_URI /
  // SENTRY_DSN …) that don't match KEY/TOKEN/SECRET. The codex child is model-executable and — unlike
  // runAgent — has no egress denial, so it gets ONLY OS/locale essentials + HOME (codex authenticates from ~/.codex).
  // Nothing app/secret-bearing reaches it. Verified codex still runs on this set.
  const ALLOW = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TMPDIR', 'TZ', 'LANG', 'CODEX_HOME']);
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && (ALLOW.has(k) || k.startsWith('LC_'))) out[k] = v;
  }
  return out;
}

// Async codex exec — NEVER spawnSync: a writer round takes minutes and spawnSync would block the Node
// event loop (server progress logs / Stop / other HTTP / the bundle Promise.all fan-out all freeze). Streams stdin in,
// collects stdout, resolves on close. No wall-clock kill (an in-flight generation is never aborted).
export function runCodexExec(args: string[], input: string, cwd: string): Promise<{ stdout: string; status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('codex', args, { cwd, env: scrubbedEnv() });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e: Error) => resolve({ stdout, stderr: e.message, status: 1 }));
    child.on('close', (code: number | null) => resolve({ stdout, stderr, status: code }));
    // A codex that exits before draining the prompt (bad args, auth failure, prompt larger than the pipe buffer) makes
    // the write fail with EPIPE on the stdin stream. Without a listener that is a process-level uncaughtException; the
    // non-zero exit status that 'close' resolves is already the round-failure signal, so the stdin error is dropped here.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export interface HtmlWriteOpts {
  label: string;                          // audit/log label, e.g. a bundleId or 'combined'
  model?: string;
  authToken?: string;
  mcpServers?: Record<string, unknown>;   // read-only planes → tool-equipped Claude writer (codex uses its own sandbox)
  maxTurns?: number;                       // Claude-backend turn budget override (default: 40 with tools, 24 without)
  maxBudgetUsd?: number;                   // Claude-backend USD ceiling for this round (runAgent maxBudgetUsd); codex has none
  onCost?: (usd: number) => void;
}

// Author/edit an HTML file in the scratch workspace with the given backend. codex = the codex CLI (workspace-write,
// each round self-contained — the file on disk IS the cross-round state); claude = the Agent SDK (writableCwd, resume
// across rounds). Both confine writes to the scratch cwd. The TARGET filename is chosen by the PROMPT, not here — the
// caller tells the agent which file to write and re-reads it from disk afterward.
//
// Returns `{ session, ok }`. `session` is the resumable session id for the claude backend (undefined for codex, which
// persists no session with --ephemeral); pass it back as `session` on the next round. `ok` is FALSE when the backend
// itself failed this round, which is the signal the caller uses to fall back to the NEXT backend. An AUTH failure still throws out of
// runAgent (a dead BYO credential must stop the run, never fall back).
export async function authorHtmlFile(scratch: string, prompt: string, round: number, session: string | undefined, opts: HtmlWriteOpts, log: (m: string) => void, backend: WriterBackend): Promise<{ session?: string; ok: boolean }> {
  if (backend === 'codex') {
    // --ephemeral: codex persists NO session files to disk; auth still uses ~/.codex. There is therefore no session to resume, so each round is
    // self-contained: the authored file persists in the scratch cwd and IS the cross-round state — the feedback prompt
    // tells codex to EDIT it in place, and the whole scratch is rmSync'd by the caller's finally.
    // Sandbox: local uses codex's own workspace-write sandbox. On Cloud Run (THERESA_CODEX_NO_SANDBOX=1, set in the
    // Dockerfile) codex's OS sandbox can't init reliably under gVisor (no user namespaces / bubblewrap), so use
    // --dangerously-bypass-approvals-and-sandbox — codex's documented flag for "environments that are externally
    // sandboxed": the ephemeral Cloud Run container + the scrubbed env (no secrets reach the child) ARE that boundary.
    const sandboxArgs = process.env.THERESA_CODEX_NO_SANDBOX === '1' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', 'workspace-write'];
    const args = ['exec', '--ephemeral', ...sandboxArgs, '-m', CODEX_MODEL, '--skip-git-repo-check', '--json', '-'];
    const r = await runCodexExec(args, prompt, scratch);
    // Attribute codex spend to the run budget/audit: the stream's usage priced for CODEX_MODEL.
    const codexUsd = openaiCostUsd(CODEX_MODEL, codexStreamUsage(r.stdout));
    if (codexUsd) { recordLlmCost(codexUsd); opts.onCost?.(codexUsd); }   // to the run ledger (a no-op outside a run)
    if (r.status !== 0) log(`  ⚠ ${opts.label} codex round ${round} exit ${r.status}: ${(r.stderr || '').slice(0, 160)}`);
    // No resumable session with --ephemeral; the scratch file carries cross-round state. `ok` reports the exit status so
    // the caller can fall back to Claude Code instead of burning every remaining round on a codex that cannot run.
    return { ok: r.status === 0 };
  }
  const r = await runAgent({
    cwd: scratch, writableCwd: true, mcpServers: opts.mcpServers, model: opts.model, authToken: opts.authToken,
    maxTurns: opts.maxTurns ?? (opts.mcpServers ? 40 : 24), maxBudgetUsd: opts.maxBudgetUsd, label: `${opts.label}:r${round}`,
    resume: round > 1 ? session : undefined, prompt,
  });
  // NOTE: do NOT call opts.onCost here for the Claude backend — runAgent already records this spend to the active
  // budget ledger via recordLlmCost. onCost exists for the CODEX backend only, which is out-of-band (not a runAgent
  // leaf), so the codex branch above records its own spend to the ledger and reports it through onCost too.
  // runAgent RETURNS non-auth failures in `error` (auth failures throw) — surface that as !ok.
  if (r.error) log(`  ⚠ ${opts.label} claude round ${round}: ${r.error.slice(0, 160)}`);
  return { session: r.sessionId ?? session, ok: !r.error };
}
