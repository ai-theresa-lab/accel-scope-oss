// OsvSource — a READ-ONLY known-vulnerability lookup backed by an IN-PROCESS MCP server over the public
// OSV.dev API (sibling of repometa.ts). Its purpose: give the appsec bundle's Expert a live advisory plane —
// resolve the LOCKED dependency set from the clone's lockfiles, then query it here to bind MEASURED verdicts
// (known-vuln exposure on the release path, security-fix adoption lag) instead of deferring.
//
// DEFENSIVE, public, credential-less: api.osv.dev serves advisory data for open-source package versions with
// no auth (fixed host, read-only POST of package coordinates — no code, no project data leaves the box beyond
// package names/versions, which are public by construction in a lockfile). Fail-soft per call: a network or
// rate-limit error surfaces as clear text so the run degrades to an eval proposal, never crashes.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DataSource, SourceAgentTools } from './types.ts';

const OSV = 'https://api.osv.dev';

export interface OsvSourceOpts {
  mcpName?: string;    // mounted server name (default 'osv')
  maxOutput?: number;  // bytes returned per call (default 400k)
}

// Build the in-process read-only OSV MCP DataSource. Mounted under the `osv` server name; the agent calls
// mcp__osv__{osv_querybatch,osv_vuln}. Never throws at mount.
export function makeOsvSource(opts: OsvSourceOpts = {}): DataSource {
  const serverName = opts.mcpName ?? 'osv';
  const MAX_OUTPUT = opts.maxOutput ?? 400_000;

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text: text || '(empty)' }] });
  const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
  const cap = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(truncated at ${MAX_OUTPUT} bytes)` : s);

  const osvQueryBatch = tool('osv_querybatch',
    'Query the public OSV.dev advisory database for KNOWN vulnerabilities affecting specific package VERSIONS (read-only; defensive inventory). ' +
    'Pass the LOCKED versions you resolved from the clone\'s lockfiles — up to 100 packages per call. ' +
    'PRIVACY: this sends {ecosystem, name, version} to a third-party public service — query OPEN-SOURCE / registry packages only; never pass an org\'s internal/private package names. ' +
    'ecosystem must be an OSV ecosystem name (npm, PyPI, Go, crates.io, Maven, NuGet, RubyGems, Packagist, Pub, Hex, SwiftURL, …). ' +
    'Returns, per package, the advisory ids + summary/severity when affected (empty = no known advisory). Use osv_vuln for one advisory\'s full detail (fixed versions → adoption lag).',
    {
      packages: z.array(z.object({
        ecosystem: z.string().describe('OSV ecosystem, e.g. npm / PyPI / Go / crates.io / Maven'),
        name: z.string().describe('package name exactly as the ecosystem knows it'),
        version: z.string().describe('the LOCKED version from the lockfile'),
      })).describe('locked packages to check (max 100 per call)'),
    },
    async ({ packages }: { packages: { ecosystem: string; name: string; version: string }[] }) => {
      try {
        const requested = (packages ?? []).length;
        const omitted = Math.max(0, requested - 100);   // over-limit input is TRUNCATED LOUDLY, never silently
        const list = (packages ?? []).slice(0, 100).map((p) => ({
          package: { ecosystem: String(p.ecosystem ?? '').trim(), name: String(p.name ?? '').trim() },
          version: String(p.version ?? '').trim(),
        })).filter((q) => q.package.ecosystem && q.package.name && q.version);
        if (!list.length) return ok('No valid {ecosystem, name, version} entries in the request.');
        const r = await fetch(`${OSV}/v1/querybatch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'waggle' },
          body: JSON.stringify({ queries: list }),
        });
        if (r.status === 429) return ok('OSV.dev is rate-limited (HTTP 429) — retry shortly with a smaller batch.');
        if (!r.ok) return ok(`OSV querybatch failed (HTTP ${r.status}).`);
        const d = (await r.json()) as any;
        const results = (Array.isArray(d.results) ? d.results : []).map((res: any, i: number) => ({
          package: list[i] ? `${list[i].package.ecosystem}:${list[i].package.name}@${list[i].version}` : `#${i}`,
          vulns: (Array.isArray(res?.vulns) ? res.vulns : []).map((v: any) => v.id).filter(Boolean),
        }));
        const affected = results.filter((x: any) => x.vulns.length);
        return ok(cap(JSON.stringify({
          queried: list.length, affectedCount: affected.length, affected,
          ...(omitted ? { omitted, note: `INPUT TRUNCATED: ${omitted} package(s) beyond the 100-per-call cap were NOT queried — call again with the remaining batch(es), or your exposure count is a LOWER BOUND over a partial inventory.` }
            : { note: 'ids only — pull one advisory\'s detail (severity, fixed versions) with osv_vuln' }),
        })));
      } catch (e) { return fail(e); }
    });

  const osvVuln = tool('osv_vuln',
    'Fetch ONE OSV advisory\'s detail by id (read-only): summary, severity, affected ranges, and FIXED versions — the fixed-version dates are what settle security-fix ADOPTION LAG (fix available vs lock updated).',
    { id: z.string().describe('OSV advisory id, e.g. GHSA-xxxx-xxxx-xxxx or OSV-2023-…') },
    async ({ id }: { id: string }) => {
      try {
        const vid = String(id ?? '').trim();
        if (!/^[A-Za-z0-9._-]{4,60}$/.test(vid)) return ok(`Invalid advisory id "${vid}".`);
        const r = await fetch(`${OSV}/v1/vulns/${encodeURIComponent(vid)}`, { headers: { 'User-Agent': 'waggle' } });
        if (r.status === 404) return ok(`No OSV advisory with id ${vid}.`);
        if (!r.ok) return ok(`OSV lookup failed (HTTP ${r.status}) for ${vid}.`);
        const d = (await r.json()) as any;
        const affected = (Array.isArray(d.affected) ? d.affected : []).map((a: any) => ({
          package: a?.package ? `${a.package.ecosystem}:${a.package.name}` : undefined,
          ranges: (Array.isArray(a?.ranges) ? a.ranges : []).map((rg: any) => ({
            type: rg.type,
            events: (Array.isArray(rg?.events) ? rg.events : []).slice(0, 20),
          })),
        })).slice(0, 20);
        return ok(cap(JSON.stringify({
          id: d.id, summary: d.summary, published: d.published, modified: d.modified,
          severity: d.severity, aliases: d.aliases, affected,
          references: (Array.isArray(d.references) ? d.references : []).slice(0, 10).map((x: any) => x.url).filter(Boolean),
        })));
      } catch (e) { return fail(e); }
    });

  const server = createSdkMcpServer({ name: 'osv-readonly', version: '1.0.0', tools: [osvQueryBatch, osvVuln] });
  return {
    kind: 'custom',
    name: 'OSV advisory lookup (known vulns)',
    capabilities: { discover: false, query: true, metadata: false },
    agentTools: (): SourceAgentTools => ({ mcpServers: { [serverName]: server } }),
  };
}
