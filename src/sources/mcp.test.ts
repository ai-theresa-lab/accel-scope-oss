import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMcpSource, normalizeMcpName } from './mcp.ts';
import { mergeAgentTools, type DataSource } from './types.ts';
import { mcpToolAllowed } from '../research/agent.ts';

// ── makeMcpSource ────────────────────────────────────────────────────────────────────────────────
test('makeMcpSource: mounts an http MCP server + (only) emits a policy when allowedTools is declared', () => {
  const withPolicy = makeMcpSource({ kind: 'bi', name: 'Dashboard', mcpUrl: 'https://x/mcp', mcpToken: 't', mcpName: 'dash', allowedTools: ['get_catalog', 'query_dau'] });
  const t1 = withPolicy.agentTools!();
  assert.deepEqual(t1.mcpServers, { dash: { type: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } } });
  assert.deepEqual(t1.mcpToolPolicy, { dash: ['get_catalog', 'query_dau'] });
  assert.equal(withPolicy.kind, 'bi');

  // No allowedTools → trust the whole server (no policy entry); no token → no Authorization header.
  const trusted = makeMcpSource({ kind: 'analytics', mcpUrl: 'http://127.0.0.1:8773/', mcpName: 'amplitude' });
  const t2 = trusted.agentTools!();
  assert.deepEqual(t2.mcpServers, { amplitude: { type: 'http', url: 'http://127.0.0.1:8773/', headers: {} } });
  assert.equal(t2.mcpToolPolicy, undefined);
  assert.equal(trusted.name, 'amplitude');   // defaults to the server name
});

// ── mergeAgentTools: merge policy + warn-skip duplicate server names ───────────────────────────────
test('mergeAgentTools: merges mcpServers + mcpToolPolicy across sources', () => {
  const wh = { kind: 'warehouse', name: 'WH', capabilities: { discover: false, query: true, metadata: true }, agentTools: () => ({ mcpServers: { warehouse: { type: 'http', url: 'u1' } } }) } as DataSource;
  const dash = makeMcpSource({ kind: 'bi', mcpUrl: 'u2', mcpName: 'dash', allowedTools: ['get_catalog'] });
  const merged = mergeAgentTools([wh, dash]);
  assert.deepEqual(Object.keys(merged.mcpServers!).sort(), ['dash', 'warehouse']);
  assert.deepEqual(merged.mcpToolPolicy, { dash: ['get_catalog'] });   // only the source that declared one
});

test('mergeAgentTools: a DUPLICATE server name keeps the first + warns (never silent overwrite)', () => {
  const a = makeMcpSource({ kind: 'custom', name: 'A', mcpUrl: 'urlA', mcpName: 'dup', allowedTools: ['a'] });
  const b = makeMcpSource({ kind: 'custom', name: 'B', mcpUrl: 'urlB', mcpName: 'dup', allowedTools: ['b'] });
  const warns: string[] = [];
  const merged = mergeAgentTools([a, b], (m) => warns.push(m));
  assert.deepEqual(merged.mcpServers, { dup: { type: 'http', url: 'urlA', headers: {} } });   // FIRST kept
  assert.deepEqual(merged.mcpToolPolicy, { dup: ['a'] });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /already mounted.*'B'/);
});

// ── mcpToolAllowed: the read-only gate (safety-critical) ──────────────────────────────────────────
test('mcpToolAllowed: a non-mounted server is denied', () => {
  const r = mcpToolAllowed('mcp__ghost__read', new Set(['warehouse']), {});
  assert.equal(r.allowed, false); assert.match(r.reason!, /not mounted/);
});

test('mcpToolAllowed: a mounted server with NO policy entry trusts the whole server (warehouse/redis/amplitude)', () => {
  assert.equal(mcpToolAllowed('mcp__warehouse__run_sql', new Set(['warehouse']), {}).allowed, true);
  assert.equal(mcpToolAllowed('mcp__amplitude__amplitude_segmentation', new Set(['amplitude']), {}).allowed, true);
});

test('mcpToolAllowed: a mounted server WITH a policy allows only its exact listed tools', () => {
  const policy = { dash: ['get_catalog', 'query_dau', 'query_raw_bigquery'] };
  const mounted = new Set(['dash']);
  assert.equal(mcpToolAllowed('mcp__dash__query_dau', mounted, policy).allowed, true);
  assert.equal(mcpToolAllowed('mcp__dash__get_catalog', mounted, policy).allowed, true);
  const denied = mcpToolAllowed('mcp__dash__delete_everything', mounted, policy);   // not in the allowlist
  assert.equal(denied.allowed, false); assert.match(denied.reason!, /not in the read-only allowlist/);
});

test('mcpToolAllowed: a declared EMPTY allowlist denies all of that server\'s tools', () => {
  assert.equal(mcpToolAllowed('mcp__locked__anything', new Set(['locked']), { locked: [] }).allowed, false);
});

test('mcpToolAllowed: parses server names containing single underscores (mcp__a_b__tool_x)', () => {
  const r = mcpToolAllowed('mcp__acme_dash__query_dau', new Set(['acme_dash']), { acme_dash: ['query_dau'] });
  assert.equal(r.server, 'acme_dash'); assert.equal(r.tool, 'query_dau'); assert.equal(r.allowed, true);
});

test('mcpToolAllowed: FAILS CLOSED on a malformed name (no <server>__<tool>)', () => {
  for (const bad of ['mcp__warehouse', 'mcp__warehouse__', 'mcp__', 'mcp__x']) {
    assert.equal(mcpToolAllowed(bad, new Set(['warehouse', 'x']), {}).allowed, false, bad);
  }
});

// ── normalizeMcpName: the UI connector's guarantee that a user-typed name is mountable ──────────────
// A name that trips makeMcpSource's /^[a-z][a-z0-9]*$/ throw becomes a silently-dropped (0-call) plane — the exact
// failure the generic UI MCP connector exists to prevent. normalizeMcpName must ALWAYS produce a valid mountable name.
test('normalizeMcpName always yields a mountable mcp name', () => {
  const valid = /^[a-z][a-z0-9]*$/;
  assert.equal(normalizeMcpName('Amplitude'), 'amplitude', 'lowercased');
  assert.equal(normalizeMcpName('acme_dash'), 'acmedash', 'underscore stripped (it would desync the tool prefix)');
  assert.equal(normalizeMcpName('metabase-bi'), 'metabasebi', 'hyphen stripped');
  assert.equal(normalizeMcpName('Acme Dash'), 'acmedash', 'space stripped');
  assert.equal(normalizeMcpName('3dash'), 'mcp3dash', 'a leading digit gets an mcp prefix (cannot start with a number)');
  assert.equal(normalizeMcpName('', 'a1b2'), 'mcpa1b2', 'empty falls back to the supplied suffix, still letter-led');
  assert.equal(normalizeMcpName('***'), 'mcp', 'an all-symbol name collapses to the safe default');
  for (const raw of ['Amplitude', 'acme_dash', 'metabase-bi', 'Acme Dash', '3dash', '__weird__', '99', '']) {
    assert.match(normalizeMcpName(raw, 'fa11'), valid, `'${raw}' must normalize to a valid mountable name`);
  }
});

// And the normalized name must pass through makeMcpSource without throwing (the contract the UI connector relies on).
test('a normalized name mounts cleanly through makeMcpSource', () => {
  const src = makeMcpSource({ kind: 'analytics', mcpUrl: 'https://x/mcp', mcpName: normalizeMcpName('acme_dash') });
  const tools = src.agentTools!();
  assert.ok(tools.mcpServers && tools.mcpServers['acmedash'], 'the server is registered under the normalized name');
});
