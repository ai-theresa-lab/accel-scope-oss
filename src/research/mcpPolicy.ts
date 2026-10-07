// Run-scoped READ-ONLY MCP tool allowlist, carried via AsyncLocalStorage (mirrors budget.ts / auditLog.ts).
//
// The allowlist (server name → permitted EXACT tool names) is the SAME for every agent in a run (the mounted
// planes + their policies are decided once, when the run assembles its DataSources). So rather than thread an
// `mcpToolPolicy` param through every agent wrapper's signature (research / critique / comprehend / deepAudit /
// reverify / scout / derive), we set it ONCE at the run entry with `withMcpPolicy()` and read it at the leaf in
// `runAgent`'s `canUseTool` via `currentMcpPolicy()`. Outside a run context it is empty → canUseTool falls back
// to "trust any mounted server" (our own read-only MCPs), exactly as before this change.
//
// SECURITY semantics (see canUseTool): a server WITH an entry here permits ONLY its listed tool names (an empty
// list denies all of that server's tools); a server with NO entry is a read-only MCP we author + trust. For an
// arbitrary third-party MCP we don't author (e.g. a vendor BI dashboard), declaring its exact read tools is
// defense-in-depth on top of that MCP's own read-only gate.

import { AsyncLocalStorage } from 'node:async_hooks';

export type McpToolPolicy = Record<string, string[]>;

const als = new AsyncLocalStorage<McpToolPolicy>();

// Enter a run context whose mounted MCP servers carry the given per-server read-only tool allowlist. No-op-safe:
// pass an empty/undefined policy and it simply runs `fn` (canUseTool then trusts any mounted server).
export function withMcpPolicy<T>(policy: McpToolPolicy | undefined, fn: () => Promise<T>): Promise<T> {
  return policy && Object.keys(policy).length ? als.run(policy, fn) : fn();
}

// The active run's policy (empty object outside a run context — never undefined, so callers index safely).
export function currentMcpPolicy(): McpToolPolicy {
  return als.getStore() ?? {};
}
