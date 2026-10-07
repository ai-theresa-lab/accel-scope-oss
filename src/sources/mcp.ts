// Generic READ-ONLY MCP source — the config-driven way to mount an arbitrary read-only MCP data plane
// (Amplitude / a deployed dashboard MCP / any company MCP) into the agentic run, so "add a source" is data,
// not per-source code. The agent is already source-agnostic (it uses whatever MCP tools are mounted); this
// adapter just declares the HTTP MCP endpoint + an OPTIONAL host-side read-only tool allowlist.
//
// Read-only is enforced at three layers (see the design doc): the credential scope, the MCP server's own tool
// surface, and — for a third-party MCP we don't author — the host-side `mcpToolPolicy` (exact permitted tool
// names) the agent's canUseTool consults. Leave `allowedTools` undefined for an MCP WE author + trust to be
// read-only by construction (warehouse/redis/amplitude); declare exact names for anything else.
import type { DataSource, SourceAgentTools, SourceKind } from './types.ts';

export interface McpSourceOpts {
  kind: SourceKind;          // 'analytics' (Amplitude) | 'bi' (dashboard) | 'custom' (any read-only MCP) | …
  name?: string;
  mcpUrl: string;            // HTTP MCP endpoint (… for a local MCP: http://127.0.0.1:<port>/)
  mcpToken?: string;         // bearer token, if the endpoint requires auth
  mcpName: string;           // server name the agent sees → tools are mcp__<mcpName>__<tool>
  allowedTools?: string[];   // EXACT read-only tool names permitted (host-side guard). undefined = trust the whole server (our own read-only MCP). An empty [] denies all.
}

// Coerce an arbitrary user-typed name into a VALID mcpName (the /^[a-z][a-z0-9]*$/ makeMcpSource enforces below): lower,
// strip to [a-z0-9] (drops hyphen/underscore/space), and prefix `mcp` if it would otherwise start with a digit or be
// empty — falling back to `fallback` (e.g. a random suffix) for the empty case. The single source of truth for the name
// rule, so a UI connector can guarantee a mountable name instead of tripping makeMcpSource's throw → a silent 0-call plane.
export function normalizeMcpName(raw: string, fallback = ''): string {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^[a-z]/.test(s)) return s;
  const f = String(fallback ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return 'mcp' + (s || f);
}

export function makeMcpSource(opts: McpSourceOpts): DataSource {
  const serverName = opts.mcpName;
  // The server name becomes the `mcp__<serverName>__<tool>` prefix the SDK emits + the canUseTool parse + the
  // allowlist key. A hyphen/underscore/uppercase risks SDK name-sanitization desync (the prefix no longer
  // matching the mounted key → the read-only guard would deny everything). Require a clean lowercase id.
  if (!/^[a-z][a-z0-9]*$/.test(serverName)) throw new Error(`makeMcpSource: mcpName '${serverName}' must match /^[a-z][a-z0-9]*$/ (lowercase, no hyphen/underscore) — it is the mcp__<name>__ tool prefix`);
  return {
    kind: opts.kind,
    name: opts.name ?? serverName,
    // query/metadata are served through the agent's mounted read-only MCP tool (not a local client).
    capabilities: { discover: false, query: true, metadata: true },
    agentTools: (): SourceAgentTools => ({
      mcpServers: {
        [serverName]: {
          type: 'http',
          url: opts.mcpUrl,
          headers: opts.mcpToken ? { Authorization: `Bearer ${opts.mcpToken}` } : {},
        },
      },
      // Only emit a policy entry when an allowlist was declared — otherwise canUseTool trusts the whole server
      // (preserves the warehouse/redis/amplitude behavior). A declared (possibly empty) list is enforced exactly.
      ...(opts.allowedTools !== undefined ? { mcpToolPolicy: { [serverName]: opts.allowedTools } } : {}),
    }),
  };
}
