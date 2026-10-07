// Run codex as a real AGENT with FILE I/O. codex is an agent — it READS and WRITES files. So every
// report/synthesis step that used to stuff data into a gpt-5.5 prompt and scrape stdout now: writes its INPUTS to files
// in a workspace, tells codex to READ those files + WRITE its output to a named file (workspace-write), and reads that
// file back. Data travels as FILES, not prompt blobs. (The gpt-5.5 fallback is unavoidably prompt-based since it's
// tool-free — but it only fires when codex is unavailable / didn't write its file.)
//
// codex authenticates from CODEX_HOME/auth.json (boot-provisioned from OPENAI_API_KEY — same key gpt-5.5 uses), so these
// steps never run on a user's BYO Claude credential. THERESA_QC_JUDGE=gpt / THERESA_REPORT_WRITER=claude force the gpt
// fallback. recordLlmCost + an audit leaf are emitted exactly like openaiComplete so budget/audit attribution is unchanged.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexExec, reportCodexAvailable, CODEX_MODEL } from './htmlWriter.ts';
import { openaiComplete, openaiAvailable } from './openai.ts';
import { recordLlmCost, recordDegraded } from './budget.ts';
import { currentAuditRecorder } from './auditLog.ts';

// Cost: the codex `exec --json` turn.completed usage (schema verified against codex-cli 0.141.0) priced for CODEX_MODEL
// from the shared table (openaiPricing.ts) — a token-priced estimate, recorded to the run ledger like openaiComplete.
import { openaiCostUsd, codexStreamUsage } from './openaiPricing.ts';

// codex is the backend for these steps unless explicitly forced to gpt, or codex/the OpenAI key is unavailable, or
// THERESA_REPORT_CODEX_REQUIRE_SANDBOX=1 and there is no OS sandbox → the tool-free gpt-5.5 fallback.
export function codexAgentAvailable(): boolean {
  if (process.env.THERESA_QC_JUDGE === 'gpt' || process.env.THERESA_REPORT_WRITER === 'claude') return false;
  return reportCodexAvailable() && openaiAvailable();
}

export interface CodexFileTask {
  files?: Record<string, string>;   // input files seeded into the workspace for codex to READ (name → content)
  prompt: string;                    // instruction: which files to read, what to do, which file to WRITE
  outputFile: string;                // the file codex must write (relative to workspace); read back + returned
  workspace?: string;                // reuse an EXISTING workspace (e.g. edit-in-place on files already there); else a fresh temp dir (auto-cleaned)
  keepWorkspace?: boolean;           // keep a temp workspace after (default: remove); ignored when workspace was supplied
  label?: string;
  log?: (m: string) => void;
}

// Core file-I/O codex run. Seeds `files`, runs codex workspace-write in the workspace, reads back `outputFile`. Returns
// its content (null if codex didn't write it) + cost + the workspace path. NEVER throws on a codex failure (returns null
// output) — callers fall back. A supplied workspace is left intact (caller owns it); a temp one is removed unless kept.
export async function runCodexFileTask(t: CodexFileTask): Promise<{ output: string | null; costUsd: number; workspace: string }> {
  const ownWorkspace = !t.workspace;
  const ws = t.workspace ?? mkdtempSync(join(tmpdir(), 'theresa-codex-'));
  const startedAt = Date.now();
  let costUsd = 0, output: string | null = null, outErr: string | undefined;
  try {
    for (const [name, content] of Object.entries(t.files ?? {})) writeFileSync(join(ws, name), content);
    // workspace-write locally; on Cloud Run (gVisor, THERESA_CODEX_NO_SANDBOX=1) the OS sandbox can't init → bypass
    // (the ephemeral container + scrubbed env are the boundary). Mirrors htmlWriter.ts.
    const sandbox = process.env.THERESA_CODEX_NO_SANDBOX === '1' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', 'workspace-write'];
    const args = ['exec', '--ephemeral', ...sandbox, '-m', CODEX_MODEL, '--skip-git-repo-check', '--json', '-'];
    const r = await runCodexExec(args, t.prompt, ws);
    const usage = codexStreamUsage(r.stdout);
    const inTok = usage.input, outTok = usage.output;
    costUsd = openaiCostUsd(CODEX_MODEL, usage);
    if (costUsd) recordLlmCost(costUsd);
    const outPath = join(ws, t.outputFile);
    output = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
    if (output == null) outErr = `codex wrote no ${t.outputFile} (exit ${r.status}): ${(r.stderr || '').slice(0, 120)}`;
    t.log?.(output != null
      ? `  ↳ codex ${t.label ?? 'task'}: ${inTok}+${outTok} tok · ≈$${costUsd.toFixed(3)} → ${t.outputFile} (${(output.length / 1024).toFixed(1)}KB)`
      : `  ⚠ codex ${t.label ?? 'task'}: ${outErr}`);
  } catch (e) {
    outErr = e instanceof Error ? e.message : String(e);
    t.log?.(`  ⚠ codex ${t.label ?? 'task'} failed (${outErr.slice(0, 100)})`);
  } finally {
    try { currentAuditRecorder()?.record({ kind: 'openai', label: `${t.label ?? 'codex'} (codex)`, model: CODEX_MODEL, tier: 'openai', prompt: t.prompt, response: output ?? '', costUsd, ms: Date.now() - startedAt, error: outErr }); } catch { /* fail-open */ }
    if (ownWorkspace && !t.keepWorkspace) { try { rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
  return { output, costUsd, workspace: ws };
}

// Convenience for a TEXT-OUT step that has a gpt-5.5 fallback: codex reads `files` + writes `outputFile` (its content is
// the text-out); on any miss, fall back to gpt-5.5 with `fallbackPrompt`. A drop-in shape for the openaiComplete sites.
export async function codexOrGpt(opts: {
  files?: Record<string, string>; codexPrompt: string; outputFile: string;
  fallbackPrompt: string; maxTokens?: number; label?: string; log?: (m: string) => void;
}): Promise<{ text: string; costUsd: number }> {
  if (codexAgentAvailable()) {
    const r = await runCodexFileTask({ files: opts.files, prompt: opts.codexPrompt, outputFile: opts.outputFile, label: opts.label, log: opts.log });
    if (r.output != null && r.output.trim()) return { text: r.output, costUsd: r.costUsd };
    opts.log?.(`  ↳ codex ${opts.label ?? 'task'} produced nothing — gpt-5.5 fallback`);
    // the shared codex path (synthesize / claim-audit / leadership digest / area writers) silently downgrading to
    // the tool-free gpt-5.5 prompt is a degradation too. Stable reason; the codex error detail is already in the log.
    recordDegraded('codex', `${opts.label ?? 'codex-task'}: codex produced nothing — fell back to gpt-5.5`);
  }
  const r = await openaiComplete({ prompt: opts.fallbackPrompt, maxTokens: opts.maxTokens, label: opts.label, log: opts.log });
  return { text: r.text, costUsd: r.costUsd };
}

// The same text-out step for a Claude-only setup. OpenAI is optional: with OPENAI_API_KEY the step runs as above (codex,
// then gpt-5.5); without it, ONE tool-free Claude call answers `fallbackPrompt` from an empty scratch directory, so the
// step still runs instead of being skipped. Throws like codexOrGpt; callers keep their own fail-open handling.
type ClaudeTextRunner = (o: { cwd: string; prompt: string; model?: string; authToken?: string; maxTurns: number; toolFree: true; label?: string }) => Promise<{ text: string; allText?: string; costUsd: number; error?: string }>;
let claudeTextRunner: ClaudeTextRunner | undefined;
/** Test seam: replace the Claude call codexGptOrClaude makes when no OpenAI key is set (undefined restores it). */
export function setClaudeTextRunnerForTest(fn: ClaudeTextRunner | undefined): void { claudeTextRunner = fn; }

export async function codexGptOrClaude(opts: Parameters<typeof codexOrGpt>[0] & { model?: string; authToken?: string }): Promise<{ text: string; costUsd: number }> {
  if (openaiAvailable()) return codexOrGpt(opts);
  const runAgent: ClaudeTextRunner = claudeTextRunner ?? (await import('./agent.ts')).runAgent;
  const cwd = mkdtempSync(join(tmpdir(), 'accel-claude-text-'));
  try {
    const r = await runAgent({ cwd, prompt: opts.fallbackPrompt, model: opts.model, authToken: opts.authToken, maxTurns: 2, toolFree: true, label: opts.label });
    const text = (r.text && r.text.trim()) ? r.text : (r.allText ?? '');
    if (!text.trim()) throw new Error(r.error ? `Claude ${opts.label ?? 'task'} failed: ${r.error}` : `Claude ${opts.label ?? 'task'} produced no text`);
    return { text, costUsd: r.costUsd };
  } finally {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
