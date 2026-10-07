// Everything accel-scope ingests is a DataSource behind ONE uniform adapter
// interface. The orchestration is source-agnostic: it connects whatever sources
// exist and the invariant-checkers query across them. Supporting a new company/
// stack = registering adapters — zero change to invariants or orchestration.
//
// Common sources ship built-in (repo / cloud / warehouse / rawdata). Bespoke ones
// (a company's MCP / semantic layer / custom dashboard) are pluggable optional
// adapters: absent → fall back to common sources; present → richer evidence.

export type SourceKind =
  | 'repo'       // code / VCS (built-in)
  | 'cloud'      // GCP / AWS infra (built-in)
  | 'warehouse'  // BigQuery / Snowflake / Redshift (built-in)
  | 'keyvalue'   // Redis / Memcached / serving cache (read-only — catalog & pool sizes, set membership)
  | 'rawdata'    // object store / log buckets (built-in)
  | 'analytics'  // Amplitude / GA4 / Firebase (optional plugin)
  | 'bi'         // Metabase / Looker / Tableau (optional plugin)
  | 'semantic'   // dbt Semantic Layer / Cube / LookML (optional plugin)
  | 'slack'      // Slack workspace (read-only chat — decision / definition / incident provenance)
  | 'memory'     // org durable-knowledge card store (read recall + direct-apply write via the backend intake spine — new facts added directly, reinforcements append-merged; every write logged + revertable)
  | 'codeintel'  // repowise code-intel index over the cloned workspace (read-only, pre-computed, no LLM — external AGPL CLI as a subprocess)
  | 'custom';    // company MCP / internal API / custom registry (optional plugin)

export interface SourceCapabilities {
  discover: boolean; // can enumerate its structure (tables / repos / events / dashboards)
  query: boolean;    // can fetch evidence on demand, read-only
  metadata: boolean; // can report cost / freshness / lineage hints
}

// Tools a source exposes into the agent's Agent-SDK session (e.g. an MCP server
// that runs read-only warehouse SQL). Code/cloud sources need none.
export interface SourceAgentTools {
  mcpServers?: Record<string, unknown>; // mounted into query({ options: { mcpServers } })
  // HOST-SIDE read-only tool allowlist, per server name → permitted EXACT tool names. Stays host-side (NOT
  // passed to the SDK): the agent's canUseTool allows a mounted MCP tool only if the server has NO policy
  // entry (our trusted read-only MCPs — warehouse/redis/amplitude) OR the bare tool name is in this list.
  // A declared EMPTY list denies all of that server's tools. For an arbitrary third-party MCP we don't author
  // (e.g. a team's own dashboard MCP), declaring its exact read tools is defense-in-depth on top of its own read gate.
  mcpToolPolicy?: Record<string, string[]>;
}

export interface DataSource {
  kind: SourceKind;
  name: string;
  capabilities: SourceCapabilities;
  discover?(): Promise<Record<string, unknown>>;     // deterministic map-building (no LLM)
  query?(request: string): Promise<unknown>;          // read-only evidence fetch
  metadata?(): Promise<Record<string, unknown>>;      // cost / freshness / lineage hints
  agentTools?(): SourceAgentTools;                    // tools handed to investigate/verify agents
}

export interface CapabilityManifest {
  sources: { kind: SourceKind; name: string; capabilities: SourceCapabilities }[];
}

export function manifestOf(sources: DataSource[]): CapabilityManifest {
  return {
    sources: sources.map((s) => ({ kind: s.kind, name: s.name, capabilities: s.capabilities })),
  };
}

// Merge the agent tools (mcpServers + the host-side mcpToolPolicy) from every connected source into one object
// to hand the investigate/verify agents. A DUPLICATE server name is a config error (two sources claiming the
// same MCP name would silently shadow each other + confuse the tool-policy) — keep the FIRST and warn+skip the
// rest (never silently overwrite). `onWarn` lets the caller surface it to the run log.
export function mergeAgentTools(sources: DataSource[], onWarn?: (m: string) => void): SourceAgentTools {
  const mcpServers: Record<string, unknown> = {};
  const mcpToolPolicy: Record<string, string[]> = {};
  for (const s of sources) {
    const t = s.agentTools?.();
    if (!t?.mcpServers) continue;
    for (const [name, cfg] of Object.entries(t.mcpServers)) {
      if (name in mcpServers) { onWarn?.(`MCP server name '${name}' is already mounted — skipping the duplicate from source '${s.name}' (rename one)`); continue; }
      mcpServers[name] = cfg;
      const pol = t.mcpToolPolicy?.[name];
      if (pol) mcpToolPolicy[name] = pol;   // only when the source declared an allowlist for this server
    }
  }
  const out: SourceAgentTools = {};
  if (Object.keys(mcpServers).length) out.mcpServers = mcpServers;
  if (Object.keys(mcpToolPolicy).length) out.mcpToolPolicy = mcpToolPolicy;
  return out;
}
