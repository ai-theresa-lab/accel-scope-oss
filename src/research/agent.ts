// Thin wrapper over the Claude Agent SDK: runs ONE headless Claude Code agent
// (read-only code exploration) and returns its final text + cost/turn telemetry.
//
// This is the engine of the "Analyze / Verify / Synthesize" layers — the
// intelligence that turns the deterministic evidence layer into findings. It is
// part of the TOOL; it is not run by hand.
//
// Robustness contract: a single agent hitting maxTurns / a transient error must
// NOT crash the pipeline. We catch, keep whatever partial text we have, and
// return it with an `error` note so the orchestrator can fail-open.

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { resolve as resolvePath, relative as relativePath, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import { withLlmSlot } from './scheduler.ts';
import { QueryCostTracker, currentLedger, currentBudgetNode } from './budget.ts';
import { currentRunSignal } from './runAbort.ts';
import { currentAuditRecorder } from './auditLog.ts';
import { currentReadSet } from './readSet.ts';
import { currentMcpPolicy, type McpToolPolicy } from './mcpPolicy.ts';
import { currentMemoryPush, nodeIsMemoryEligible, memoryPushEnabled } from '../memory/push.ts';
import { auditedContrastPrompt, promptWithContrast } from '../memory/contrast.ts';
import { currentMemoryRecall, makeMemoryRecallServer, MEMORY_RECALL_SERVER } from '../memory/recall-tool.ts';

export interface AgentRun {
  text: string;       // the SDK result message if present, else the full transcript
  allText: string;    // EVERY assistant text block across ALL turns — parse this when the agent
                      // emits structured blocks incrementally (the result message is only the last turn)
  costUsd: number;
  turns: number;
  error?: string;
  sessionId?: string;   // the SDK session UUID — pass to a later runAgent's `resume` to continue this conversation
}

// Marker on an AgentRun the budget envelope declined to START (not an agent that ran and failed). It
// carries NO verdict — so an adversarial consumer (e.g. the verify step) must fail CLOSED on it (drop
// the claim), NOT fail-open as it would for a genuine unparseable reply. See runAgent's leaf gate.
export const BUDGET_SKIP_MARKER = 'skipped: run-budget envelope';
export function isBudgetSkip(r: { error?: string } | null | undefined): boolean {
  return Boolean(r?.error && r.error.startsWith(BUDGET_SKIP_MARKER));
}

export interface RunAgentOpts {
  cwd: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  // Hard USD ceiling for THIS query (the SDK's maxBudgetUsd: it stops between turns once exceeded — never mid-generation,
  // matching the admission-only envelope). Used by optional late stages to stay inside what is left of the run cap.
  maxBudgetUsd?: number;
  label?: string;
  // Audit log (research/auditLog.ts): set when THIS runAgent is the Claude-tier FALLBACK after an OpenAI
  // text-out attempt failed, so the audit leaf records the fallback chain (tier 'claude' ← 'openai').
  fallbackFrom?: string;
  // Bring-your-own Claude credential for THIS run. Accepts either a Claude subscription
  // OAuth token (`claude setup-token` → sk-ant-oat…) so the run bills to that Pro/Max
  // plan, or a metered API key (sk-ant-api…). When set, the headless agent subprocess
  // runs on it; when omitted, the subprocess inherits the server's process env (the
  // instance default: on-disk `claude` login locally, or a deployed key). See server.ts.
  authToken?: string;
  // Data-source tools mounted into the agent session (e.g. an MCP server that
  // runs read-only warehouse SQL). Lets I1–I8 use live data, not just code.
  mcpServers?: Record<string, unknown>;
  // NOTE: the host-side READ-ONLY tool allowlist is RUN-scoped (same for every agent in a run), so it is carried
  // via an AsyncLocalStorage (research/mcpPolicy.ts) rather than threaded through every wrapper's opts — canUseTool
  // reads currentMcpPolicy(). Set once at the run entry with withMcpPolicy().
  // TOOL-FREE mode: deny EVERY tool — even the read-only file tools (Read/Grep/Glob). For the
  // tool-free TEXT-OUT audit steps (synthesis-claim audit, report red-team, claim audit) that must judge ONLY
  // from the verdict/payload text in the prompt — never re-inspect the repo. Without this, a Claude-tier
  // fallback could read repo evidence and effectively re-audit, defeating the "narrow / no re-measure" contract.
  toolFree?: boolean;
  // WRITABLE SCRATCH cwd (HTML-writer): allow Write/Edit, but CONFINED to `cwd` (the per-run scratch workspace) by
  // the same `withinDir` guard the read tools use. The HTML report writer authors report.html in its scratch dir. The
  // scanned repo is a DIFFERENT path → still unwritable; Bash/WebFetch/WebSearch stay denied (no shell, no egress). The
  // CALLER must point `cwd` at a dedicated scratch dir (mkdtemp), NOT the scanned repo, and keep the trusted ledger OUT
  // of that dir (the QC reads the ledger from the orchestrator, never the writer's copy) — codex design review.
  writableCwd?: boolean;
  // WRITE CONFINEMENT (single-session Expert): with `writableCwd`, confine Write/Edit to `writeDir` — which MUST
  // be a SUBDIRECTORY of `cwd` (e.g. <repo-clone>/.theresa-out). The SDK jails file ops to cwd; a subdir stays inside
  // that jail, and canUseTool narrows Write/Edit to ONLY that subdir, so the Expert can READ the whole repo (cwd) but
  // WRITE only its report dir — never the audited source (Non-Negotiable #1; also prevents corrupting a sibling bundle
  // that shares the clone). Omit ⇒ Write/Edit confine to `cwd` (prior behavior). Do NOT point writeDir OUTSIDE cwd (the
  // SDK's own sandbox blocks cross-cwd writes — verified).
  writeDir?: string;
  // PERSISTENT SESSION (Analyst⇄QC): resume a prior runAgent session so the agent keeps its FULL prior
  // context (its last draft + the dossier/ledger) and EDITS in response to feedback, instead of regenerating from
  // foreign text each round. Round 1 omits `resume` and returns the new `sessionId`; rounds 2+ pass it and send only
  // the QC feedback as the turn. This is the ONE place the node-per-agent "discardable query" rule is relaxed.
  resume?: string;
  onTool?: (name: string, arg: string) => void;
  // Full trajectory tap: called for every streamed step — the agent's reasoning ('text')
  // and every tool/MCP call ('tool', resolved name + args). Lets a caller record the thinking
  // trajectory + which tools were pulled (used by the deep-audit + agentic executor).
  onTrace?: (e: { type: 'text'; text: string } | { type: 'tool'; name: string; args: string }) => void;
}

// Build the subprocess env for a bring-your-own-credential run. Routes by token prefix
// so ONE paste field works for both auth modes: a subscription OAuth token (sk-ant-oat…)
// is set as CLAUDE_CODE_OAUTH_TOKEN (runs on that Claude plan); anything else is treated
// as a metered API key (ANTHROPIC_API_KEY). The other credential is cleared so the chosen
// one wins unambiguously. The SDK does NOT merge process.env into `env` — we spread it
// ourselves, filtering to defined strings for the SDK's Record<string,string>.
export function credEnv(token: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  // Clear EVERY inherited Anthropic credential / profile selector so the pasted token is the
  // SOLE credential. Otherwise a host ANTHROPIC_AUTH_TOKEN (gateway/shared bearer) or
  // ANTHROPIC_PROFILE could shadow it — and the SDK rejects a request carrying two
  // credentials (api-key + auth-token together).
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_PROFILE;
  if (token.startsWith('sk-ant-oat')) env.CLAUDE_CODE_OAUTH_TOKEN = token; // subscription (Pro/Max) plan
  else env.ANTHROPIC_API_KEY = token;                                     // metered API key
  return env;
}

// Read-only AND no-egress enforcement. The agentic layer runs on a BYO Claude credential
// that necessarily lives in the agent subprocess env (the SDK needs it to authenticate),
// and a prompt-injected repo could read it. Reading the env from a shell cannot be reliably
// blocked (awk ENVIRON, bash -c, eval, jq env, … — a blocklist never converges), so instead
// we remove the EXFIL CHANNELS: no shell (Bash) and no web (WebFetch/WebSearch). With
// Write/Edit/NotebookEdit also removed, the agent keeps only Read/Grep/Glob (+ any mounted
// read-only MCP data tool) — all local, no outbound network — so a credential it might read
// has nowhere to go, and its findings go only to the run's owner. Mutation + exfil are thus
// enforced STRUCTURALLY, not by prompt compliance. (Restoring Bash safely needs network-level
// isolation.) disallowedTools hides these from the model; the canUseTool
// ALLOWLIST below is the hard guarantee — default-deny, so any other command-exec tool the
// SDK exposes (Monitor, PowerShell, BashOutput, Task, …) is refused even if not listed here.
export const DISALLOWED = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch'];

// Tool ALLOWLIST (default-deny). A read-only analyzer needs only file read/search, plus any
// mounted read-only MCP data tool. Allowing ONLY these — and denying everything else in
// canUseTool — means no command-execution tool (Bash, Monitor, PowerShell, BashOutput,
// KillShell, Task, …, present now or added by a future SDK) can run, and nothing can mutate
// the repo or reach the network. This is the robust inversion of a tool blocklist, which can
// never enumerate every exec tool. (MCP tools, mcp__*, are the read-only warehouse SQL we
// mount ourselves, so they're allowed.)
export const ALLOWED_TOOLS = new Set(['Read', 'Grep', 'Glob']);

// Confine a file tool's target to the cloned repo under analysis. With Bash/Web gone, the
// remaining read vector is a file tool (Read/Grep/Glob) pointed at an ABSOLUTE path outside
// the repo — /proc/<pid>/environ or the on-disk ~/.claude credential — to pull the BYO token
// (which lives in the subprocess env) into the agent context/report. Resolve through symlinks
// so an in-repo symlink can't point out. Returns true iff `target` is at/under `rootReal`.
export function withinDir(target: string, rootReal: string): boolean {
  if (!target) return true; // no path → the tool defaults to its cwd (the repo) — safe
  const absLexical = isAbsolute(target) ? resolvePath(target) : resolvePath(rootReal, target);
  let chosen = absLexical;
  try { chosen = realpathSync(absLexical); } catch { /* may not exist yet — fall back to lexical */ }
  const rel = relativePath(rootReal, chosen);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// A hard auth failure (bad/expired/revoked credential) vs a transient error. Anchored to
// auth signals so it does NOT swallow maxTurns / timeout / 429 / 5xx (those still fail-open).
export function isAuthError(msg: string): boolean {
  return /\b(401|403)\b|authentication_error|authentication failed|unauthor|invalid[\s_-]*(api[\s_-]?key|x-api-key|token|bearer|credential)|oauth[^.]*(expired|invalid|revoked)/i.test(msg);
}

// PURE read-only MCP tool gate (exported for tests). Parse `mcp__<server>__<tool>` (server may contain
// single underscores; `__` is the separator), then a tool is allowed iff its server is MOUNTED **and** either
// the server has NO policy entry (a read-only MCP we author → trust the whole server: warehouse/redis/amplitude)
// OR the bare tool name is in that server's allowlist (a declared EMPTY list denies all of its tools).
export function mcpToolAllowed(toolName: string, mountedServers: Set<string>, policy: McpToolPolicy): { allowed: boolean; server: string; tool: string; reason?: string } {
  // FAIL CLOSED on a malformed name (no `mcp__<server>__<tool>` with a non-empty tool) — never let
  // `mcp__warehouse` / `mcp__warehouse__` fall through to allow on a trusted server.
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (!m) return { allowed: false, server: '', tool: '', reason: `malformed MCP tool name '${toolName}'` };
  const server = m[1]; const tool = m[2];
  if (!mountedServers.has(server)) return { allowed: false, server, tool, reason: `MCP server '${server}' is not mounted for this agent` };
  const allow = policy[server];
  if (allow && !allow.includes(tool)) return { allowed: false, server, tool, reason: `tool '${tool}' is not in the read-only allowlist for MCP server '${server}'` };
  return { allowed: true, server, tool };
}

export async function runAgent(opts: RunAgentOpts): Promise<AgentRun> {
  // Acquire ONE process-wide LLM slot for the whole agent session (leaf-only — see scheduler.ts).
  // The slot is held until the session returns/throws; it is never released on a timer.
  return withLlmSlot(async () => {
  // Late admission gate — evaluated AFTER acquiring the slot, so every LLM call the semaphore ran
  // before this one has already recorded its cost. If this is new discovery/bundle work and the run is
  // past the 0.80·B envelope, skip WITHOUT starting an LLM call and return an empty, error-marked
  // result that callers fail-open on (critique → 0 problems → bundle skipped; measure → unmeasured →
  // eval proposal; reparse → falls through to the standard eval). This — not a pre-queue check — is what
  // makes the global stop tight across concurrent bundle lanes. It NEVER aborts a running call; it only
  // declines to START one. reserve/audit nodes (synthesis/report) are always admitted; no run context
  // (the CLI deep-dive) ⇒ never gated.
  {
    const led = currentLedger(); const node = currentBudgetNode();
    if (led && node && !led.admit(node)) {
      opts.onTool?.('(budget-skip)', `run budget ≥80% spent — ${opts.label ?? 'agent'} not started`);
      // Record the skip too — this path returns BEFORE the try/finally below, so capture here.
      try { currentAuditRecorder()?.record({ kind: 'agent', label: opts.label, tier: 'claude', fallbackFrom: opts.fallbackFrom, prompt: opts.prompt, costUsd: 0, error: `${BUDGET_SKIP_MARKER} (admission ≥80%)` }); } catch { /* fail-open */ }
      return { text: '', allText: '', costUsd: 0, turns: 0, error: `${BUDGET_SKIP_MARKER} (>=80%)` };
    }
  }
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abort = new AbortController();
  // User "Stop": the ambient per-run signal (runAbort ALS) aborts THIS agent's SDK controller, so an in-flight
  // generation unwinds. The catch below rethrows on abort so it propagates to the executor's stop guard.
  const runSig = currentRunSignal();
  const onRunAbort = () => abort.abort();   // named so it can be removed in finally (don't accrue on the shared per-run signal)
  if (runSig) { if (runSig.aborted) abort.abort(); else runSig.addEventListener('abort', onRunAbort, { once: true }); }
  // Resolve the analysis root once (through symlinks); file tools are confined under it.
  const rootReal = (() => { try { return realpathSync(opts.cwd); } catch { return resolvePath(opts.cwd); } })();
  // Optional WRITE confinement (writeDir, a subdir of cwd) — Write/Edit narrow to here while reads keep the whole cwd.
  const writeRootReal = opts.writeDir ? (() => { try { return realpathSync(opts.writeDir!); } catch { return resolvePath(opts.writeDir!); } })() : undefined;
  // The MCP servers WE mounted for this agent (the only ones canUseTool will allow) — defense-in-depth so an
  // agent run WITHOUT mcpServers (e.g. the tool-light Preflight node) cannot reach any data plane even if one
  // leaked in. An `mcp__<server>__<tool>` is allowed iff <server> is a key here.
  // Universal org-memory PULL (symmetric with the PUSH below): mount a READ-ONLY memory_recall MCP on
  // memory-ELIGIBLE nodes when the run set a recall context (withMemoryRecall) — so ANY agent can look up this
  // org's durable knowledge on demand, not just receive the one-shot pushed brief. Skip when the caller already
  // mounted `orgmemory` (the ask+write path mounts the read+write source, which already exposes memory_recall)
  // so we never clobber the write-capable server. Gated exactly like the push (eligible node + push-enabled).
  const recallCtx = (() => {
    const c = currentMemoryRecall();
    return c && memoryPushEnabled() && nodeIsMemoryEligible(opts.label) ? c : undefined;
  })();
  const effectiveMcpServers: Record<string, unknown> = (recallCtx && !(MEMORY_RECALL_SERVER in (opts.mcpServers ?? {})))
    ? { ...(opts.mcpServers ?? {}), [MEMORY_RECALL_SERVER]: makeMemoryRecallServer(recallCtx) }
    : (opts.mcpServers ?? {});
  const mountedServers = new Set(Object.keys(effectiveMcpServers));
  // Node-scoped memory PUSH: a memory-ELIGIBLE node gets the run's push-core appended to its system
  // prompt; toolFree nodes (QC/synthesis/writers) get nothing. Fail-open — no push-core ⇒ unchanged behavior.
  const memPush = (() => { const p = currentMemoryPush(); return p && nodeIsMemoryEligible(opts.label) ? p : undefined; })();
  // Sibling CONTRAST (cross-project org memory, ../memory/contrast.ts): a SEPARATE block with its OWN eligibility list —
  // Critic + Expert nodes only (never Comprehend / Preflight / audit / verify / synthesis / writers). It is REPO-DERIVED
  // data from other repositories, so it rides in the USER turn as a fenced, labelled untrusted-data section — never the
  // system prompt. Unchanged prompt unless the run opted in (run.siblingRecall) and the block was filled.
  const sysAppend = memPush ?? '';
  // The prompt the model ACTUALLY receives. The audit log records it with the CONTRAST data section replaced by a
  // placeholder (count + visible keys, never values): the placement stays auditable,
  // but the audit artifact no longer copies sibling-repo values to everyone who can view the run.
  const sentPrompt = promptWithContrast(opts.prompt, opts.label);
  const recordedPrompt = auditedContrastPrompt(opts.prompt, opts.label);
  const q = query({
    prompt: sentPrompt,
    options: {
      cwd: opts.cwd,
      systemPrompt: sysAppend ? { type: 'preset', preset: 'claude_code', append: sysAppend } : { type: 'preset', preset: 'claude_code' },
      // SDK isolation mode: do NOT load filesystem settings from the cloned (untrusted) repo.
      // By default the SDK reads project settings (.claude/settings.json) from cwd, whose
      // hooks/plugins run shell OUTSIDE the canUseTool allowlist (with the BYO credential in
      // env) — a full bypass. The repo's CLAUDE.md is data to analyze, not instructions to
      // obey, so dropping it also closes a prompt-injection vector. Everything the agent needs
      // is supplied via these options; auth (env / on-disk credential) is unaffected.
      settingSources: [],
      // writableCwd (HTML-writer): un-hide Write/Edit so the agent can author its report file; canUseTool still confines
      // their target to `cwd` (the scratch workspace) via withinDir. Bash/WebFetch/WebSearch/NotebookEdit stay denied.
      disallowedTools: opts.writableCwd ? DISALLOWED.filter((t) => t !== 'Write' && t !== 'Edit') : DISALLOWED,
      // Default-deny ALLOWLIST (canUseTool is the headless permission resolver; no interactive
      // prompt). BUILT-IN command-exec / mutation / egress tools (Bash, Write, Edit, WebFetch, …)
      // are always denied. Mounted MCP tools (mcp__*) are allowed — we control which get mounted:
      // for the scan/audit path they are read-only data planes (no sink); on the local-machine
      // EXEC path the mutating run_on_box is mounted too, but the executor runs on the on-disk login,
      // NOT a BYO credential — so a BYO token in a scan subprocess's env still has no reachable sink.
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        // TOOL-FREE: a text-out audit step judges ONLY from the prompt — deny EVERY tool, incl.
        // the read-only file tools, so a Claude-tier fallback can't re-inspect the repo and re-audit evidence.
        if (opts.toolFree) return { behavior: 'deny' as const, message: 'tool-free audit step: no tools (judge only from the provided text).' };
        // Mounted MCP tool (we control which: read-only data planes, or the exec's run_on_box). MUST
        // return updatedInput — SDK-created MCP tools (createSdkMcpServer) drop their args otherwise and
        // fail zod validation ("non-functional at the permission layer"). Built-ins tolerate the omission.
        if (toolName.startsWith('mcp__')) {
          // Allow ONLY a mounted server's tool, gated by the RUN-scoped read-only allowlist (mcpToolAllowed —
          // a pure, unit-tested helper). mountedServers is empty when no mcpServers were passed (e.g. the
          // tool-light Preflight node), so it can reach no plane. The policy comes from withMcpPolicy (no
          // per-wrapper threading); empty outside a run, so our own read-only MCPs keep allow-the-whole-server.
          const v = mcpToolAllowed(toolName, mountedServers, currentMcpPolicy());
          if (!v.allowed) return { behavior: 'deny' as const, message: `read-only scan: ${v.reason}; '${toolName}' is blocked.` };
          return { behavior: 'allow' as const, updatedInput: input };
        }
        // writableCwd adds Write/Edit to the allowed set (still path-confined below); otherwise only Read/Grep/Glob.
        const writeOk = opts.writableCwd === true && (toolName === 'Write' || toolName === 'Edit');
        if (!ALLOWED_TOOLS.has(toolName) && !writeOk) {
          return { behavior: 'deny' as const, message: `read-only scan: only file read/search (Read/Grep/Glob)${opts.writableCwd ? ' + Write/Edit in the scratch workspace' : ''} and mounted data tools are allowed; '${toolName}' is blocked.` };
        }
        // Confine file tools by path. Reads (Read/Grep/Glob) → `cwd` (blocks /proc/<pid>/environ, ~/.claude creds, …).
        // Writes (Write/Edit under writableCwd) → `writeDir` when set (a subdir of cwd), else `cwd`. So the single-session
        // Expert READS the whole repo (cwd) but WRITES only its report dir — never the audited source, and never a
        // sibling bundle's files in the shared clone.
        const p = String((input as { file_path?: unknown; path?: unknown }).file_path ?? (input as { path?: unknown }).path ?? '');
        const confineTo = (writeOk && writeRootReal) ? writeRootReal : rootReal;
        if (p && !withinDir(p, confineTo)) {
          return { behavior: 'deny' as const, message: `confined to the ${writeOk && writeRootReal ? 'report output' : 'analysis'} directory: blocked a path outside it (e.g. /proc, credentials, or the audited source): ${p.slice(0, 80)}` };
        }
        return { behavior: 'allow' as const };
      },
      // Global turn-budget scale (default 1). THERESA_TURN_SCALE>1 lets every agent iterate deeper for a
      // max-power run (e.g. 2 ⇒ double every agent's tool-iteration budget). The single chokepoint all agents pass.
      // CLAMPED to [1, 16]: an unclamped env (negative → negative maxTurns; absurd → runaway)
      // would break the turn budget; this keeps it a sane multiplier.
      maxTurns: Math.round((opts.maxTurns ?? 16) * Math.min(16, Math.max(1, Number(process.env.THERESA_TURN_SCALE) || 1))),
      abortController: abort,
      ...(opts.maxBudgetUsd !== undefined && Number.isFinite(opts.maxBudgetUsd) && opts.maxBudgetUsd > 0 ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
      ...(opts.resume ? { resume: opts.resume } : {}),   // persistent-session: continue the prior conversation
      // writableCwd: 'acceptEdits' so the SDK auto-accepts file edits headlessly (under the default mode Write/Edit hit an
      // "internal permission-system error" — there is no interactive prompt to grant them). canUseTool STILL runs and
      // confines every Write/Edit target to the scratch cwd via withinDir (verified), so this only lifts the edit prompt,
      // not the path boundary. Read-only runs keep the default mode.
      ...(opts.writableCwd ? { permissionMode: 'acceptEdits' as const } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(Object.keys(effectiveMcpServers).length ? { mcpServers: effectiveMcpServers as Record<string, McpServerConfig> } : {}),
      // BYO: only override the subprocess env when a credential is supplied. Omitting
      // `env` lets the child inherit process.env (the instance subscription/default key).
      ...(opts.authToken ? { env: credEnv(opts.authToken) } : {}),
    },
  });

  let assistantText = '';
  let finalText = '';
  let costUsd = 0;
  const costTrack = new QueryCostTracker();   // live spend while the query runs, trued up by its result
  let turns = 0;
  let error: string | undefined;
  let sessionId: string | undefined;
  const auditTools: { name: string; args: string }[] = [];   // FULL tool-call args for the audit log (not the 300-char onTrace cap)
  // Incremental re-scan (readSet.ts): the lane's read-set collector, when this agent runs inside a bundle lane. Tool
  // inputs are recorded at tool_use, result paths at tool_result (matched by tool_use_id). Fail-open, observe-only.
  const readSet = currentReadSet();
  const toolNameById = new Map<string, string>();
  const startedAt = Date.now();

  try {
    for await (const msg of q as AsyncIterable<any>) {
      if (!sessionId && typeof msg.session_id === 'string') sessionId = msg.session_id;   // capture for resume
      if (msg.type === 'assistant') {
        // live spend — this turn's usage is priced and recorded now, instead of the whole query's cost landing
        // only when it returns (a 9-minute normalize round froze the run's live spend).
        costTrack.assistant(msg);
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            assistantText += block.text + '\n';
            if (block.text.trim()) opts.onTrace?.({ type: 'text', text: block.text.trim() });
          } else if (block.type === 'tool_use') {
            const arg = block.name === 'Bash' ? String(block.input?.command ?? '') : JSON.stringify(block.input ?? {});
            opts.onTool?.(String(block.name), arg.replace(/\s+/g, ' ').slice(0, 120));
            opts.onTrace?.({ type: 'tool', name: String(block.name), args: arg.replace(/\s+/g, ' ').slice(0, 300) });
            auditTools.push({ name: String(block.name), args: arg });   // RAW exact args — whitespace is meaningful for SQL/JSON/regex (keep the collapsed form only for onTool/onTrace); AuditRecorder applies only its size cap
            if (readSet) { readSet.noteToolUse(String(block.name), block.input, opts.cwd); if (typeof block.id === 'string') toolNameById.set(block.id, String(block.name)); }
          }
        }
      } else if (msg.type === 'user' && readSet) {
        // tool results (Grep / Glob / codeintel hit lists) → the files the agent was SHOWN. Observe-only; fail-open.
        try {
          for (const block of (Array.isArray(msg.message?.content) ? msg.message.content : [])) {
            if (block?.type !== 'tool_result') continue;
            const name = toolNameById.get(String(block.tool_use_id ?? ''));
            if (!name) continue;
            const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
            if (text) readSet.noteToolResult(name, text, opts.cwd);
          }
        } catch { /* fail-open */ }
      } else if (msg.type === 'result') {
        if (typeof msg.result === 'string' && msg.result.trim()) finalText = msg.result;
        costTrack.result(msg);   // the authoritative total + calibration of the live-estimate rate
        if (typeof msg.num_turns === 'number') turns = msg.num_turns;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    // Auth failure is NOT transient — a bad/expired credential won't fix itself, and
    // fail-open would silently produce a misleading "complete · 0 findings" run. Abort the
    // whole run with a SANITIZED message (never echo the raw error, which could contain the
    // credential). Transient errors (maxTurns, timeouts, 429/5xx) still fail-open below.
    if (isAuthError(error)) throw new Error('Claude authentication failed — the credential for this run was rejected (401/403). Re-paste a valid token on the Run page.');
    // User Stop: the SDK query was aborted via the run signal. RETHROW (instead of fail-open) so it unwinds to
    // the executor's stop guard → 'stopped', not a misleading "complete · 0 findings". (Must be after isAuthError.)
    if (runSig?.aborted || /\babort(ed)?\b/i.test(error)) throw new Error('run stopped by user');
    // maxTurns, transient API errors, etc. — keep partial output, never crash the run.
    if (opts.onTool) opts.onTool('(agent-error)', error.slice(0, 120));
  } finally {
    if (runSig) runSig.removeEventListener('abort', onRunAbort);   // shared per-run signal: drop our listener so dozens of leaves don't accrue (MaxListenersExceededWarning)
    // ONE place for cost attribution + audit recording — so normal returns, the auth-error RETHROW above, and
    // transient errors are each captured exactly once. No-op outside a run context. fail-open.
    // true the live estimate up to the SDK's total (a signed delta: an estimate that ran high is refunded). With
    // no result (the stream threw) the estimate is the best figure there is, so it stays recorded.
    costUsd = costTrack.finish();
    try {
      // SANITIZE the auth-error before persisting it: this function deliberately throws a sanitized auth error
      // (line above) because the raw SDK message may carry the credential — so the audit JSONL (written AT REST)
      // must not record the raw one either (Non-Negotiable #3). Transient errors aren't credential-bearing.
      const auditError = error && isAuthError(error) ? 'Claude authentication failed (401/403) — credential rejected' : error;
      currentAuditRecorder()?.record({
        kind: 'agent', label: opts.label, model: opts.model, tier: 'claude', fallbackFrom: opts.fallbackFrom,
        prompt: recordedPrompt, response: finalText || assistantText, toolCalls: auditTools,
        costUsd, ms: Date.now() - startedAt, turns, error: auditError,
      });
    } catch { /* fail-open: a logging failure never breaks a run */ }
  }
  return { text: finalText || assistantText, allText: assistantText, costUsd, turns, error, sessionId };
  });
}
