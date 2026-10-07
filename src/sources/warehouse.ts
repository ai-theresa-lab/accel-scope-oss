// WarehouseSource — a generic, READ-ONLY data-warehouse adapter (BigQuery / Snowflake /
// Redshift / any SQL endpoint exposed over an MCP). It implements the uniform DataSource
// interface and, most importantly, exposes a read-only SQL tool to the investigate/verify
// agents via mcpServers — so the metric-trust invariants (I1–I8) can reconcile sources,
// profile distributions, and trace cost on LIVE data instead of guessing from code.
//
// Company-agnostic: point it at ANY read-only SQL MCP endpoint (typically your
// warehouse behind a read-only service account). It does not run SQL itself
// from TS — the agent does, through the mounted MCP — so no SQL-client dependency lives
// here; deterministic INFORMATION_SCHEMA / JOBS mapping can be layered on later via the
// same endpoint without changing this interface.

import type { DataSource, SourceAgentTools } from './types.ts';

export interface WarehouseSourceOpts {
  name?: string;
  mcpUrl: string;    // HTTP MCP endpoint exposing read-only SQL (run_sql / query_raw_*)
  mcpToken?: string; // bearer token, if the endpoint requires auth
  mcpName?: string;  // server name the agent sees (default 'warehouse')
}

export function makeWarehouseSource(opts: WarehouseSourceOpts): DataSource {
  const serverName = opts.mcpName ?? 'warehouse';
  return {
    kind: 'warehouse',
    name: opts.name ?? serverName,
    // query/metadata are served through the agent's mounted read-only SQL tool, not a
    // local SQL client; discover() (deterministic INFORMATION_SCHEMA mapping) is future work.
    capabilities: { discover: false, query: true, metadata: true },
    agentTools: (): SourceAgentTools => ({
      mcpServers: {
        [serverName]: {
          type: 'http',
          url: opts.mcpUrl,
          headers: opts.mcpToken ? { Authorization: `Bearer ${opts.mcpToken}` } : {},
        },
      },
    }),
  };
}
