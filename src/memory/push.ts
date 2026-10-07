// Node-scoped memory PUSH (agent memory system). A run recalls a small memory core once at start and
// runs its agent work inside withMemoryPush(core, …); the runAgent chokepoint reads currentMemoryPush() and
// appends the core to the system prompt — but ONLY for memory-ELIGIBLE nodes. Mirrors the currentLedger /
// currentRunSignal ALS pattern in research/agent.ts.
//
// LOAD-BEARING INVARIANT: toolFree nodes get NO push. QC / claim-audit / red-team, ALL synthesis nodes, and
// the leadership / area / vibe-HTML writers must judge only from their payload — a push would break the
// no-re-audit contract and the "canonical numbers arrive in the payload" guarantee. NOTE: the `synthesis`
// token is DELIBERATELY broad — it excludes every synthesis node (the bottom-line synthesis writer,
// synthesis-claim-audit, AND the accel-mini salvage assembler), all of which reason strictly over their own
// payload; none should be seeded with memory. `nodeIsMemoryEligible` excludes them by label; new memory-free
// nodes should extend MEMORY_FREE_LABEL.

import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage<string>();

/** Master switch for the memory PUSH. DEFAULT ON — org-memory is injected into eligible agent prompts unless
 *  explicitly disabled. Set THERESA_MEMORY_PUSH=off to force it off fleet-wide (ops kill-switch); per-run the
 *  UI "Use org memory" toggle (run.useMemory) can also turn it off. Off ⇒ agents behave EXACTLY as they did
 *  before this feature (no memory in any system prompt). */
export function memoryPushEnabled(): boolean {
  return (process.env.THERESA_MEMORY_PUSH || 'on').trim().toLowerCase() !== 'off';
}

/** Run `fn` with a memory push-core in scope. A blank core is a no-op (never masks the ambient store). */
export function withMemoryPush<T>(pushCore: string, fn: () => T): T {
  return pushCore && pushCore.trim() ? als.run(pushCore, fn) : fn();
}

/** The push-core in scope for the current node, or undefined. */
export function currentMemoryPush(): string | undefined {
  return als.getStore();
}

// Memory-FREE node labels — these judge only their payload and must receive NO push (see the invariant above).
const MEMORY_FREE_LABEL = /\b(qc|claim.?audit|red.?team|synthesis|leadership|area|vibe|html|preflight)\b/i;

/** Is a node (by its runAgent label) allowed to receive the memory push? Unlabeled nodes are eligible. */
export function nodeIsMemoryEligible(label?: string): boolean {
  return !label || !MEMORY_FREE_LABEL.test(label);
}
