// Universal read-only org-memory PULL — symmetric with the memory PUSH (./push.ts). A run sets a recall
// context once (withMemoryRecall), and the runAgent chokepoint mounts a READ-ONLY memory_recall MCP server
// on every memory-ELIGIBLE agent. So ANY agent (executor, critique, intake, measure, research) can look up
// this org's durable knowledge ON DEMAND mid-run — not just receive the one-shot pushed brief. Reuses
// recallOrgMemory (the SAME local keyword retriever the push brief uses).
//
// READ-ONLY by construction: memory_write stays behind makeOrgMemorySource (sources/orgmemory.ts), gated by
// ACCEL_MEMORY_WRITE_ENABLED + per-run run.writeMemory. This puller only reads, so it is safe to mount widely.
//
// Gating MIRRORS the push exactly: the context is only SET at the server run sites when memory is enabled and
// the run's useMemory is on; runAgent additionally mounts it ONLY for memory-eligible nodes (nodeIsMemoryEligible)
// and only under memoryPushEnabled(). If the caller already mounted an `orgmemory` server (the ask+write path
// mounts the read+write source, which already exposes memory_recall), runAgent skips this puller so the
// write-capable server is never clobbered. Fail-open: any recall error returns text, never throws.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { recallOrgMemory } from '../orgMemory.ts';

export interface MemoryRecallCtx {
  orgId: string;
  actor?: string;       // user email (passed through to recallOrgMemory)
  repos?: string[];     // run repos (owner/name) → repo-aware recall precision; omit ⇒ unfiltered
}

const als = new AsyncLocalStorage<MemoryRecallCtx>();

/** Run `fn` with an org-memory recall context in scope. A blank / no-org ctx is a no-op (never masks an
 *  outer scope). Nesting is safe: an inner call with a ctx simply re-scopes; pass currentMemoryRecall() to
 *  inherit an outer (repo-scoped) context instead of overriding it. */
export function withMemoryRecall<T>(ctx: MemoryRecallCtx | undefined, fn: () => T): T {
  return ctx && ctx.orgId ? als.run(ctx, fn) : fn();
}

/** The recall context in scope for the current node, or undefined. */
export function currentMemoryRecall(): MemoryRecallCtx | undefined {
  return als.getStore();
}

// Mounted under the SAME server name the write-capable source uses, so the agent-facing tool name is stable
// (mcp__orgmemory__memory_recall) whether a run mounts this read-only puller or the read+write source.
export const MEMORY_RECALL_SERVER = 'orgmemory';

/** Build a read-only memory_recall MCP server bound to a recall context. Reuses recallOrgMemory. */
export function makeMemoryRecallServer(ctx: MemoryRecallCtx) {
  const t = tool(
    'memory_recall',
    "Look up THIS org's durable knowledge — metric definitions/calibers, model & data lineage, which table/box/export/checkpoint is canonical, known traps, playbooks, and prior findings — by keyword match. Call it WHENEVER you hit something org-specific you're unsure about (a metric's exact definition, the canonical model/checkpoint, a known gotcha, how a prior run ran an eval) instead of guessing. Returns the most relevant cards with their detail; treat every hit as PRIOR knowledge — re-verify against live data before you rely on it.",
    {
      query: z.string().describe('what to look up — a metric, model, table, method, or a question'),
      k: z.number().optional().describe('max cards to return (default 6, capped at 20)'),
    },
    async ({ query, k }: { query: string; k?: number }) => {
      try {
        const cards = await recallOrgMemory(ctx.orgId, { q: query, retriever: 'hybrid', k: Math.min(Math.max(1, k ?? 6), 20), repos: ctx.repos }, ctx.actor);
        if (process.env.THERESA_MEMORY_RECALL_DEBUG) console.error(`[memory_recall] "${String(query).slice(0, 80)}" → ${cards.length} card(s)${cards.length ? ': ' + cards.map((c) => c.short_desc.slice(0, 48)).join(' | ').slice(0, 240) : ''}`);
        if (!cards.length) return { content: [{ type: 'text' as const, text: `No org knowledge matched "${query}".` }] };
        const items = cards.map((c) => {
          const body = c.body ? `\n  ${String(c.body).replace(/\r?\n/g, '\n  ').slice(0, 1200)}` : '';
          const ev = c.provenance?.evidence_ptr ? ` (evidence: ${c.provenance.evidence_ptr})` : '';
          return `- [${c.type}] ${c.short_desc}${ev}${body}`;
        });
        const text = [`Org knowledge matching "${query}" (${cards.length}) — PRIOR, re-verify before relying:`, ...items].join('\n').slice(0, 12000);
        return { content: [{ type: 'text' as const, text }] };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `memory_recall error: ${e instanceof Error ? e.message : String(e)} — run continues without it.` }] };
      }
    },
  );
  return createSdkMcpServer({ name: MEMORY_RECALL_SERVER, version: '1.0.0', tools: [t] });
}
