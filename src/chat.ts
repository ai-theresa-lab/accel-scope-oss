// "Report Assistant" — the lightweight chat assistant over Waggle reports. A chat drawer
// over the Waggle single server. One message in → SSE stream out, grounded in the OPEN report's context.
//
// Base mode: TOOL-FREE — the agent reasons over the loaded report context + conversation history only.
// No clone, no data planes, no exec — so it's fast/cheap and can't write or reach a sink (matches the
// "lightweight chatbot" framing). Live access (repos + planes) is the opt-in
// escalation; this module is structured so that wiring drops into runChatTurn's query() options later.

import { credEnv, ALLOWED_TOOLS, DISALLOWED, withinDir, mcpToolAllowed } from './research/agent.ts';
import { withLlmSlot } from './research/scheduler.ts';
import { currentMcpPolicy } from './research/mcpPolicy.ts';
import { loadChats, saveChats } from './store.ts';
import { realpathSync } from 'node:fs';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: string;
  partial?: boolean;
  reportRunId?: string;          // the report this turn was pinned to (provenance)
  usage?: { input: number; output: number; costUsd?: number; durationMs?: number; turns?: number };
}
export interface Conversation {
  id: string;
  tenant: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  messages: ChatMsg[];
}

// ── Conversation store (in-memory + atomic JSON blob via store.ts) ─────────────────────────────────────────
const convs = new Map<string, Conversation>();
let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const blob = loadChats();
  if (blob && Array.isArray(blob.conversations)) for (const c of blob.conversations) if (c && c.id) convs.set(c.id, c);
}
function persistChats(): void { saveChats({ conversations: [...convs.values()] }); }
const CONV_CAP = 50;   // conversation cap — the store is one JSON blob rewritten each turn, so bound
const MSG_CAP = 400;   // its growth (drop the oldest conversations / messages beyond these).

let _seq = 0;
function cid(prefix: string): string { _seq = (_seq + 1) % 1e6; return prefix + Date.now().toString(36) + _seq.toString(36); }

export function listConversations(tenant: string): { id: string; title: string; updatedAt: string }[] {
  ensureLoaded();
  return [...convs.values()]
    .filter((c) => c.tenant === tenant)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}
export function getConversation(tenant: string, id: string): Conversation | null {
  ensureLoaded();
  const c = convs.get(id);
  return c && c.tenant === tenant ? c : null;   // owner (tenant) check
}
export function createConversation(tenant: string, title: string, who?: string): Conversation {
  ensureLoaded();
  const now = new Date().toISOString();
  const c: Conversation = { id: cid('cv_'), tenant, title: title.slice(0, 60) || 'New chat', createdAt: now, updatedAt: now, createdBy: who, messages: [] };
  convs.set(c.id, c);
  // Bound this tenant's conversation count — drop the oldest beyond CONV_CAP.
  const mine = [...convs.values()].filter((x) => x.tenant === tenant).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  for (const old of mine.slice(CONV_CAP)) convs.delete(old.id);
  persistChats();
  return c;
}
export function appendMessage(c: Conversation, m: Omit<ChatMsg, 'id' | 'ts'> & { ts?: string }): ChatMsg {
  const msg: ChatMsg = { id: cid('m_'), ts: m.ts ?? new Date().toISOString(), role: m.role, text: m.text, partial: m.partial, reportRunId: m.reportRunId, usage: m.usage };
  c.messages.push(msg);
  if (c.messages.length > MSG_CAP) c.messages.splice(0, c.messages.length - MSG_CAP);   // keep the newest MSG_CAP
  c.updatedAt = msg.ts; persistChats();
  return msg;
}
export function updateMessage(c: Conversation, id: string, patch: Partial<ChatMsg>): void {
  const m = c.messages.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, patch); c.updatedAt = new Date().toISOString(); persistChats();
}
export function deleteConversation(tenant: string, id: string): boolean {
  ensureLoaded();
  const c = convs.get(id);
  if (!c || c.tenant !== tenant) return false;
  convs.delete(id); persistChats();
  return true;
}

// ── Prompt assembly ────────────────────────────────────────────────────────────────────────────────────────
const HISTORY_MSGS = 12;     // how much prior turn text to replay
const HISTORY_CLIP = 2400;   // per-message clip (chars)

export function chatSystemPrompt(hasRepos?: boolean, planeNames?: string[]): string {
  // When the conversation has a cloned-repo workspace, grant the agent leave to read the code; otherwise
  // it's report-context only.
  const repoLine = hasRepos
    ? `\n- You ALSO have READ-ONLY access to the org's connected source repositories — Read/Grep/Glob over a clone
  in your working directory. When the report doesn't cover the question, you MAY read the code to answer, and
  cite the exact file path. You cannot run commands, edit files, or reach the network; never present something
  you read as a measured metric unless the report states it.`
    : '';
  // Mounted read-only data planes (warehouse SELECT / redis read) — the live "data" half of accel-mini parity.
  const planeLine = planeNames && planeNames.length
    ? `\n- You ALSO have READ-ONLY DATA PLANES mounted — ${planeNames.join(', ')} — via their \`mcp__\` tools
  (the warehouse runs SELECT/WITH queries against the production BigQuery, byte-capped + dry-run-gated; redis
  reads candidate pools / counters). Query them for LIVE numbers when the report or repo doesn't answer it.
  NEVER write/DDL. Always state the exact query/command you ran with the result (provenance).`
    : '';
  return `You are Report Assistant, the embedded, read-only data assistant of the Waggle console.

The user is looking at an investigation REPORT and asking questions about it. Answer conversationally and
concisely — this is a chat, not a report. Rules:
- Ground every claim in the OPEN REPORT context provided below (its datapoints, evidence, answer, work items).
  Cite the specific datapoint/evidence you used. Numbers must come from the report — never invent or infer a
  number that isn't there.
- If the answer is NOT in the report, say so plainly and offer to investigate it (a fresh accel-mini run). Do
  not fabricate, and do not present an inference as a measured fact (the console's "trust only data" discipline).
- Reply in English.
- Use plain Markdown (short paragraphs, lists, tables for numeric comparisons). Keep it tight.${repoLine}${planeLine}`;
}

/** Build the user prompt: history + the pinned report context + the question. */
export function chatUserPrompt(history: { role: string; text: string }[], reportContext: string | undefined, message: string): string {
  const parts: string[] = [];
  if (history.length) {
    parts.push('[Conversation so far — context only; re-ground numbers in the report below.]');
    for (const m of history.slice(-HISTORY_MSGS)) parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, HISTORY_CLIP)}`);
  }
  if (reportContext && reportContext.trim()) {
    parts.push('\n[OPEN REPORT — the report the user is viewing; answer about THIS]');
    parts.push(reportContext.trim());
  } else {
    parts.push('\n[No report is currently open. Answer from general knowledge of the console, or suggest opening/running a report.]');
  }
  parts.push(`\n[Question] ${message}`);
  return parts.join('\n');
}

// ── The streaming chat turn (tool-free Agent SDK query) ──────────────────────────────────────────────────────
export interface ChatTurnResult { text: string; error?: string; usage?: ChatMsg['usage'] }
export async function runChatTurn(opts: {
  system: string;
  user: string;
  authToken?: string;
  model?: string;
  signal?: AbortSignal;
  cwd?: string;                                  // a cloned-repo workspace → read-only repo access
  mcpServers?: Record<string, unknown>;          // mounted read-only data planes (warehouse SELECT / redis read)
  maxTurns?: number;                             // tool-iteration budget when repo/planes present (default 24)
  onDelta: (text: string) => void;     // streamed token text
  onStatus?: (key: string) => void;    // coarse status ("thinking")
}): Promise<ChatTurnResult> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (opts.signal) { if (opts.signal.aborted) abort.abort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }
  let text = '';
  let usage: ChatMsg['usage'];
  let error: string | undefined;
  try {
    opts.onStatus?.('thinking');
    // Route the turn through the process-wide LLM slot so chat shares the same concurrency cap as agent runs —
    // no /api/chat stampede against the provider when several chats are sent at once.
    await withLlmSlot(async () => {
    // realpath-anchor the workspace so the path-confinement check below can't be slipped by an in-repo symlink.
    const rootReal = opts.cwd ? realpathSync(opts.cwd) : undefined;
    const mountedServers = new Set(opts.mcpServers ? Object.keys(opts.mcpServers) : []);
    const hasTools = Boolean(rootReal) || mountedServers.size > 0;   // repo file-read and/or data planes
    const q = query({
      prompt: opts.user,
      options: {
        systemPrompt: opts.system,
        settingSources: [],                 // never read cwd settings (untrusted) — same hardening as runAgent
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.mcpServers ? { mcpServers: opts.mcpServers as Record<string, McpServerConfig> } : {}),
        ...(hasTools ? { disallowedTools: DISALLOWED } : {}),
        // Tool policy. WITHOUT repo/planes: TOOL-FREE — deny every tool so the turn reasons only over the report
        // context + history (the lightweight chat). WITH them: read-only access — Read/Grep/Glob
        // confined to the clone via withinDir (blocks /proc + ~/.claude credential reads), and the mounted
        // read-only data-plane MCPs (warehouse SELECT / redis read). No mutation, no exec, no egress.
        canUseTool: hasTools
          ? async (toolName: string, input: Record<string, unknown>) => {
              // Mounted read-only data planes — allow via the run-scoped allowlist. currentMcpPolicy() is empty
              // here (no withMcpPolicy), which trusts the whole mounted server — and we only mount read-only
              // planes (warehouse SELECT, redis-read), so that's the intended posture.
              if (toolName.startsWith('mcp__')) {
                if (!mountedServers.size) return { behavior: 'deny' as const, message: 'report chat: no data planes mounted.' };
                const v = mcpToolAllowed(toolName, mountedServers, currentMcpPolicy());
                if (!v.allowed) return { behavior: 'deny' as const, message: `read-only data plane: ${v.reason}; '${toolName}' is blocked.` };
                return { behavior: 'allow' as const, updatedInput: input };
              }
              // File tools — only with a repo workspace, confined to it.
              if (!ALLOWED_TOOLS.has(toolName)) return { behavior: 'deny' as const, message: `read-only report chat: only file read/search (Read/Grep/Glob) + mounted data planes; '${toolName}' is blocked.` };
              if (!rootReal) return { behavior: 'deny' as const, message: 'no repo workspace mounted; data-plane queries only.' };
              const p = String((input as { file_path?: unknown; path?: unknown }).file_path ?? (input as { path?: unknown }).path ?? '');
              if (p && !withinDir(p, rootReal)) return { behavior: 'deny' as const, message: `read-only report chat confined to the report's repos: blocked a path outside them: ${p.slice(0, 80)}` };
              return { behavior: 'allow' as const };
            }
          : async () => ({ behavior: 'deny' as const, message: 'lightweight report chat: answer only from the provided report context.' }),
        maxTurns: hasTools ? (opts.maxTurns ?? 24) : 1,
        includePartialMessages: true,
        abortController: abort,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.authToken ? { env: credEnv(opts.authToken) } : {}),
      },
    });
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type === 'stream_event') {
        const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } };
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) { text += ev.delta.text; opts.onDelta(ev.delta.text); }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success' && msg.usage) {
          const u = msg.usage as { input_tokens?: number; output_tokens?: number };
          usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, costUsd: (msg as { total_cost_usd?: number }).total_cost_usd, durationMs: (msg as { duration_ms?: number }).duration_ms, turns: (msg as { num_turns?: number }).num_turns };
        } else if (msg.subtype !== 'success') { error = `run ${String(msg.subtype)}`; }
      }
    }
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
  return { text, error, usage };
}
