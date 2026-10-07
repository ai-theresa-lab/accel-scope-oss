// BigQuerySource — a READ-ONLY warehouse DataSource backed by an IN-PROCESS MCP server (like makeRunOnBox),
// using a service-account key pasted at Connect (BigQuery read-only role). This is the
// in-repo, in-process equivalent of the standalone bq-mcp.mjs: the same four read-only tools (list_datasets /
// list_tables / describe_table / run_sql), the same SELECT/WITH-only guard + dry-run byte cap, but the SA key
// stays in memory unless the user saves connections on this machine, and the console owns the lifecycle.
// Mounted under the `warehouse` server name, so deep.ts's
// measure step sees `hasWarehouse` and the agent calls mcp__warehouse__*.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import type { DataSource, SourceAgentTools } from './types.ts';

// READ-ONLY by syntax: one statement, must start with SELECT or WITH. The read-only SA is the hard guarantee;
// this rejects the obvious write/DDL/scripting forms early. Errs CLOSED (a literal ';' in a string is over-counted
// as multi-statement and refused). Shared with bq-mcp.mjs's guard; regression-tested in bigquery.test.ts.
export function bqSelectOnly(sql: string): string {
  const s = String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  if (!s) throw new Error('empty query');
  const stmts = s.replace(/;\s*$/, '').split(/;/).map((x) => x.trim()).filter(Boolean);
  if (stmts.length > 1) throw new Error('only a single statement is allowed (no multi-statement / scripting)');
  if (!/^(select|with)\b/i.test(stmts[0])) throw new Error('only SELECT / WITH queries are allowed — this plane is read-only (no INSERT/UPDATE/DELETE/MERGE/CREATE/DROP/…)');
  return stmts[0];
}

export interface BigQuerySourceOpts {
  saKey: string;          // the service-account key JSON (pasted at Connect)
  projectId?: string;     // defaults to the SA key's project_id
  mcpName?: string;       // mounted server name (default 'warehouse')
  maxGb?: number;         // per-query scan cap (default 5 GB)
  maxRows?: number;       // rows returned per call (default 1000)
  maxOutput?: number;     // bytes returned per call (default 400k)
}

// Build an in-process read-only BigQuery MCP DataSource from a resolved SA key. Throws if the key is unparseable
// or carries no project (so a misconfigured ref fails loud at mount, not mid-run).
export function makeBigQuerySource(opts: BigQuerySourceOpts): DataSource {
  const serverName = opts.mcpName ?? 'warehouse';
  let creds: Record<string, unknown>;
  try { creds = JSON.parse(opts.saKey); } catch { throw new Error('BigQuery SA key is not valid JSON'); }
  const project = opts.projectId || (typeof creds.project_id === 'string' ? creds.project_id : '');
  if (!project) throw new Error('BigQuery SA key has no project_id and no projectId was given');
  const MAX_BYTES = Math.round((opts.maxGb ?? 5) * 1024 ** 3);
  const MAX_ROWS = opts.maxRows ?? 1000;
  const MAX_OUTPUT = opts.maxOutput ?? 400_000;
  const bq = new BigQuery({ projectId: project, credentials: creds as Record<string, string> });

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text: text || '(empty)' }] });
  const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
  const cap = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(truncated at ${MAX_OUTPUT} bytes)` : s);

  const listDatasets = tool('list_datasets', `List the datasets in BigQuery project ${project} (read-only). Use this first to find where the relevant logs/tables live.`, {},
    async () => { try { const [ds] = await bq.getDatasets(); return ok(cap(JSON.stringify({ project, datasets: ds.map((d) => d.id) }))); } catch (e) { return fail(e); } });

  const listTables = tool('list_tables', 'List the tables in a dataset (read-only). Pass the dataset id from list_datasets.',
    { dataset: z.string().describe('dataset id, e.g. acme_rec_data') },
    async ({ dataset }: { dataset: string }) => { try { const [ts] = await bq.dataset(dataset).getTables(); return ok(cap(JSON.stringify({ dataset, tables: ts.map((t) => t.id) }))); } catch (e) { return fail(e); } });

  const describeTable = tool('describe_table', 'Show a table\'s schema (field names + types), row count, and partitioning (read-only). Inspect this before writing a query so you filter the partition/time column to bound the scan.',
    { dataset: z.string(), table: z.string() },
    async ({ dataset, table }: { dataset: string; table: string }) => {
      try {
        const [m] = await bq.dataset(dataset).table(table).getMetadata();
        const fields = (m.schema?.fields || []).map((f: { name: string; type: string; mode?: string }) => `${f.name}:${f.type}${f.mode && f.mode !== 'NULLABLE' ? `(${f.mode})` : ''}`);
        return ok(cap(JSON.stringify({ table: `${project}.${dataset}.${table}`, numRows: m.numRows, sizeBytes: m.numBytes, partitioning: m.timePartitioning || m.rangePartitioning || null, clustering: m.clustering || null, fields })));
      } catch (e) { return fail(e); }
    });

  const runSql = tool('run_sql',
    `Run a READ-ONLY SELECT/WITH query against BigQuery project ${project} and return rows as JSON (read-only — no writes/DDL). ` +
    `A dry-run estimates bytes scanned; a query over the byte cap is REFUSED (narrow the partition/time filter or columns, or pass a higher max_gb). ` +
    `Always filter the partition/time column to bound the scan. Use standard SQL (project.dataset.table).`,
    { sql: z.string().describe('a single read-only SELECT / WITH statement'), max_gb: z.number().optional().describe('per-query scan cap in GB (capped at the server max)') },
    async ({ sql, max_gb }: { sql: string; max_gb?: number }) => {
      try {
        const q = bqSelectOnly(sql);
        const limit = Math.min(MAX_BYTES, max_gb ? Math.round(max_gb * 1024 ** 3) : MAX_BYTES);
        const [dry] = await bq.createQueryJob({ query: q, dryRun: true, useLegacySql: false });
        const bytes = Number(dry.metadata?.statistics?.totalBytesProcessed || 0);
        if (bytes > limit) return ok(`REFUSED: this query would scan ${(bytes / 1024 ** 3).toFixed(2)} GB, over the ${(limit / 1024 ** 3).toFixed(2)} GB cap. Add/narrow a partition or time filter, select fewer columns, or pass a higher max_gb (still ≤ server cap).`);
        const [rows] = await bq.query({ query: q, maximumBytesBilled: String(limit), useLegacySql: false });
        const shown = rows.slice(0, MAX_ROWS);
        return ok(cap(JSON.stringify({ scanned_gb: +(bytes / 1024 ** 3).toFixed(3), rows: shown.length, truncated_rows: rows.length > MAX_ROWS, data: shown }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))));
      } catch (e) { return fail(e); }
    });

  const server = createSdkMcpServer({ name: 'bigquery-readonly', version: '1.0.0', tools: [listDatasets, listTables, describeTable, runSql] });
  return {
    kind: 'warehouse',
    name: `BigQuery (${project})`,
    capabilities: { discover: false, query: true, metadata: true },
    agentTools: (): SourceAgentTools => ({ mcpServers: { [serverName]: server } }),
  };
}
