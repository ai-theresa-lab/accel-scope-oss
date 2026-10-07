import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restrictMemoryRepos } from './orgmemory.ts';

// Quick Ask alignment: memory_write took ANY `repos` the agent named, so a fact could be tied to a repo the run never
// read. A Quick Ask passes its selection; tags outside it are dropped (and logged by the tool).
test('restrictMemoryRepos: keeps only the run’s selected repos; unrestricted when no selection is given', () => {
  assert.deepEqual(restrictMemoryRepos(['sindresorhus/p-limit', 'acme/secret'], ['Sindresorhus/P-Limit@main']), { kept: ['sindresorhus/p-limit'], dropped: ['acme/secret'] });
  assert.deepEqual(restrictMemoryRepos(['acme/secret'], []), { kept: undefined, dropped: ['acme/secret'] });
  assert.deepEqual(restrictMemoryRepos(['acme/x'], undefined), { kept: ['acme/x'], dropped: [] });
  assert.deepEqual(restrictMemoryRepos(undefined, ['a/b']), { kept: undefined, dropped: [] });
});

test('the org-memory server declares an explicit tool allowlist, so the host gate denies anything else', async () => {
  const { makeOrgMemorySource, ORG_MEMORY_TOOLS } = await import('./orgmemory.ts');
  const { mergeAgentTools } = await import('./types.ts');
  const { mcpToolAllowed } = await import('../research/agent.ts');
  const merged = mergeAgentTools([makeOrgMemorySource({ orgId: 'local' })]);
  assert.deepEqual(merged.mcpToolPolicy?.orgmemory, [...ORG_MEMORY_TOOLS]);
  const mounted = new Set(Object.keys(merged.mcpServers ?? {}));
  assert.equal(mcpToolAllowed('mcp__orgmemory__memory_recall', mounted, merged.mcpToolPolicy ?? {}).allowed, true);
  assert.equal(mcpToolAllowed('mcp__orgmemory__memory_delete', mounted, merged.mcpToolPolicy ?? {}).allowed, false);
});
