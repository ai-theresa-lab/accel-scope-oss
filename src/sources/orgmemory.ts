// OrgMemorySource - an IN-PROCESS MCP server that gives an accel agent READ + WRITE access to THIS org's durable
// knowledge (the local file-backed card store in ../orgMemory.ts). Mirrors makeRepoGrepSource in shape: a DataSource
// whose agentTools() mounts a createSdkMcpServer under one server name, tools built with tool()/zod, ok/fail text
// helpers, fail-open by construction. memory_write goes through the store's dedup + apply path (intakeCandidates):
// a NEW fact is added directly, a reinforcement of an existing fact is append-merged. Every write is logged to the
// Memory History with a pre-change snapshot and is REVERTABLE there, so a bad write is easy to catch and undo.
// memory_recall is the deterministic keyword reader the agent should call FIRST to avoid duplicating/contradicting
// what is already known.
//
// Both tools are fail-open: any error returns ok('<message>') / fail(...) so a memory tool can NEVER crash a run.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DataSource, SourceAgentTools } from './types.ts';
import { recallOrgMemory, intakeCandidates } from '../orgMemory.ts';

export interface OrgMemorySourceOpts {
  orgId: string;           // the org whose memory this is (the acting org of the run)
  dryRun?: boolean;        // when true, memory_write runs the intake spine WITHOUT persisting (default false)
  runId?: string;          // provenance run_id folded into the intake `source` (default a fixed marker)
  mcpName?: string;        // mounted server name (default 'orgmemory' — matches /^[a-z][a-z0-9]*$/)
  actor?: string;          // user email, recorded as the actor on memory history events
  allowedRepos?: string[]; // the run's selected repos (owner/name): memory_write's `repos` is restricted to these (undefined ⇒ unrestricted)
  log?: (m: string) => void; // run log sink (a dropped repo is logged here)
}

// memory_write may tie a fact only to repos THIS run actually read (its explicit selection): a repo the agent names
// outside it is dropped (case-insensitive, `@branch` ignored). `allowed` undefined ⇒ unrestricted (non-ask callers).
export function restrictMemoryRepos(repos: string[] | undefined, allowed: string[] | undefined): { kept: string[] | undefined; dropped: string[] } {
  if (!repos?.length || !allowed) return { kept: repos, dropped: [] };
  const key = (r: string) => String(r).split('@')[0].trim().toLowerCase();
  const ok = new Set(allowed.map(key));
  const kept = repos.filter((r) => ok.has(key(r)));
  return { kept: kept.length ? kept : undefined, dropped: repos.filter((r) => !ok.has(key(r))) };
}

/** The tools the org-memory server exposes — also its host-side allowlist. */
export const ORG_MEMORY_TOOLS = ['memory_recall', 'memory_write'] as const;

// Build an in-process READ+WRITE org-memory MCP DataSource. Mounted under the `orgmemory` server name; the agent
// calls mcp__orgmemory__{memory_recall,memory_write}. Never throws at mount — problems surface per-call as clear
// text (fail-open) so a run degrades gracefully.
export function makeOrgMemorySource(opts: OrgMemorySourceOpts): DataSource {
  const serverName = opts.mcpName ?? 'orgmemory';
  const orgId = opts.orgId;
  const dryRun = opts.dryRun ?? false;
  const runId = opts.runId && opts.runId.trim() ? opts.runId.trim() : 'accel-mini-write';
  const actor = opts.actor;

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text: text || '(empty)' }] });
  const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }], isError: true });

  const memoryRecall = tool('memory_recall',
    "Search this org's existing durable knowledge (keyword match). Use before writing to avoid contradicting or duplicating what's already known.",
    {
      query: z.string().describe('what to look up'),
      k: z.number().optional().describe('max cards to return (default 8)'),
    },
    async ({ query, k }: { query: string; k?: number }) => {
      try {
        const cards = await recallOrgMemory(orgId, { q: query, retriever: 'hybrid', k: k ?? 8 }, actor);
        if (!cards.length) return ok(`No existing knowledge found for "${query}". Nothing to duplicate/contradict — you may write a verified fact.`);
        const lines = cards.map((c) => `- [${c.type}] ${c.short_desc} (id: ${c.id})`);
        return ok([`Existing org knowledge matching "${query}" (${cards.length}):`, ...lines].join('\n'));
      } catch (e) { return fail(e); }
    });

  const memoryWrite = tool('memory_write',
    "Write a durable fact into this org's knowledge base. ONLY call this for knowledge you have VERIFIED against the actual assets in this run (repos, warehouse, docs) — never write a claim you have not confirmed (e.g. a repo/table/metric that does not exist). Prefer specific, evidence-backed statements. tier-1 = a fact about THIS org (pick the right card type); tier-2 = a value-free reusable method (strip client names/numbers). New facts are added directly, and a fact matching an existing card is merged into it (append) — every write is logged and can be reverted by a human in the Memory tab. Recall first (memory_recall) to avoid duplicating.",
    {
      type: z.enum(['invariant', 'router', 'metric-def', 'mistake', 'playbook', 'release-log', 'method']).describe('card type — pick the one that fits (method ⇒ a value-free reusable technique, tier-2)'),
      short_desc: z.string().describe('one-line statement of the fact (specific, evidence-backed)'),
      body: z.string().optional().describe('optional fuller detail / the evidence that confirms it'),
      key_entities: z.array(z.string()).optional().describe('the entities this fact is about (repo/table/metric/model names)'),
      tier: z.enum(['tier-1', 'tier-2']).optional().describe('tier-1 = a fact about THIS org; tier-2 = a value-free reusable method. Defaults from type.'),
      confidence: z.number().optional().describe('0..1 confidence you have in this fact'),
      repos: z.array(z.string()).optional().describe('repo keys (owner/name) this fact is SPECIFICALLY about — omit for general company/domain facts not tied to one repo'),
    },
    async ({ type, short_desc, body, key_entities, tier, confidence, repos }: { type: string; short_desc: string; body?: string; key_entities?: string[]; tier?: string; confidence?: number; repos?: string[] }) => {
      try {
        const scoped = restrictMemoryRepos(repos, opts.allowedRepos);
        if (scoped.dropped.length) opts.log?.(`  memory_write: dropped repo tag(s) outside this run's selection: ${scoped.dropped.join(', ')}`);
        const candidate: Record<string, unknown> = {
          tier: tier ?? (type === 'method' ? 'tier-2' : 'tier-1'),
          type,
          short_desc,
          body,
          key_entities,
          confidence,
          repos: scoped.kept,
          kind: 'measured',
        };
        const source = { run_id: runId, run_type: 'accel-mini', scope: 'agent-write' };
        const res = await intakeCandidates(orgId, source, [candidate], { dryRun, actor });
        if (res && typeof res.error === 'string') {
          return ok(`Could not write to org memory: ${res.error}. Your run continues; nothing was recorded.`);
        }
        const committed = Array.isArray(res.committed) ? res.committed : [];
        const discarded = Array.isArray(res.discarded) ? res.discarded : [];
        // Surface the dedup ACTION + target so the agent knows how each fact landed (added / merged / replaced).
        const describe = (arr: any[]) => arr.map((x) => {
          if (x && typeof x === 'object') {
            const action = (x as any).action ?? (x as any).status;
            const target = (x as any).target_id ?? (x as any).id ?? (x as any).card_id;
            const desc = (x as any).short_desc;
            return [action, target ? `→ ${target}` : '', desc ? `(${desc})` : ''].filter(Boolean).join(' ');
          }
          return String(x);
        });
        const parts: string[] = [];
        if (committed.length) parts.push(`APPLIED (insert = added · append = merged into existing · supersede = replaced): ${describe(committed).join('; ')}`);
        if (discarded.length) parts.push(`DISCARDED (duplicate/no-op): ${describe(discarded).join('; ')}`);
        if (!parts.length) parts.push('Intake returned no applied/discarded items — nothing changed.');
        const dryNote = dryRun ? ' [DRY-RUN — nothing persisted]' : '';
        return ok(`memory_write result${dryNote}:\n${parts.join('\n')}`);
      } catch (e) { return fail(e); }
    });

  const server = createSdkMcpServer({ name: 'orgmemory', version: '1.0.0', tools: [memoryRecall, memoryWrite] });
  return {
    kind: 'memory',
    name: 'Org memory (read + write)',
    capabilities: { discover: false, query: true, metadata: false },
    // An explicit allowlist (not the "no policy ⇒ trust the whole server" default): the host-side gate then denies any
    // tool on this server that is not named here, so a tool added to the server later is never trusted by accident.
    agentTools: (): SourceAgentTools => ({ mcpServers: { [serverName]: server }, mcpToolPolicy: { [serverName]: [...ORG_MEMORY_TOOLS] } }),
  };
}
