// RepoMetaSource — a READ-ONLY GitHub repo-METADATA reader backed by an IN-PROCESS MCP server (sibling of
// repogrep.ts, which reads repo CONTENT). Its purpose: give the Expert measure step a CODE-NATIVE measurement
// plane — CI workflow-run history (pass rate / retry-to-green / duration), check conclusions at a ref (was a
// merge green at merge time), releases + tags with dates (cadence / version discipline), commit metadata
// (reverts, hotfix clusters, ownership concentration), and PR merge metadata (lead time). These are the
// warehouse-equivalent for a code-only project (e.g. a public engine/SDK repo connected by URL): queryable,
// numeric, falsifiable — so the release-eng / swe-arch bundles bind MEASURED verdicts instead of deferring.
//
// Auth is OPTIONAL by design: with a connected GitHub source the lazy token path (same as repogrep) raises the
// rate limit and reaches private repos; with NO token the GitHub API still serves public-repo metadata at a
// tight unauthenticated rate budget — which is exactly the giturl (public URL, no auth) case. Every tool is a
// read-only GET against api.github.com (fixed host, path-encoded — no write/exec surface), so the server keeps
// whole-server trust once `repometa` is a mounted MCP key.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DataSource, SourceAgentTools } from './types.ts';

const GH = 'https://api.github.com';
function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'accel-scope',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface RepoMetaSourceOpts {
  // Lazy OPTIONAL token getter — resolved per call (tokenForRun → resolveSecretValue) when a GitHub source is
  // connected; returns undefined for the tokenless public-repo path (giturl). Never captured at mount time.
  getToken: () => Promise<string | undefined>;
  defaultRepos?: string[];  // the run's scan-target repos (owner/name) — surfaced in tool descriptions so the agent doesn't guess
  // ALLOWLIST (security): when set, EVERY tool call's `repo` must be in this set, else it's refused before any
  // fetch. `defaultRepos` is only a description hint — without this, a prompt-injected / mistaken tool call
  // could read metadata for ANY repo the (ambient/org) token can reach, incl. private repos outside the run's
  // scope. Callers pass the run's actual target repos here. Absent/empty ⇒ no restriction (tokenless public use).
  allowRepos?: string[];
  mcpName?: string;         // mounted server name (default 'repometa' — matches /^[a-z][a-z0-9]*$/)
  maxOutput?: number;       // bytes returned per call (default 400k)
}

// Build the in-process read-only repo-metadata MCP DataSource. Mounted under the `repometa` server name; the
// agent calls mcp__repometa__{meta_workflows,meta_runs,meta_checks,meta_releases,meta_commits,meta_pulls}.
// Never throws at mount; token/rate problems surface per-call as clear text so a run degrades gracefully.
export function makeRepoMetaSource(opts: RepoMetaSourceOpts): DataSource {
  const serverName = opts.mcpName ?? 'repometa';
  const MAX_OUTPUT = opts.maxOutput ?? 400_000;
  const repoHint = opts.defaultRepos?.length ? ` This run's scan targets: ${opts.defaultRepos.slice(0, 10).join(', ')}.` : '';

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text: text || '(empty)' }] });
  const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
  const cap = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(truncated at ${MAX_OUTPUT} bytes)` : s);
  const badRepo = (r: string) => `Invalid repo "${r}" — expected owner/name (e.g. acme/engine).`;
  const okRepo = (r: string) => /^[\w.-]+\/[\w.-]+$/.test(r.trim());
  const clampN = (n: number | undefined, dflt: number, max: number) => Math.min(max, Math.max(1, Math.round(n ?? dflt)));
  // Per-call repo guard: shape check + (when an allowlist is set) scope check. Returns an error string to
  // return to the agent, or null when the repo is permitted. Bounds the token's blast radius to the run's
  // target repos regardless of what the token can reach (security — see allowRepos).
  const allow = opts.allowRepos && opts.allowRepos.length ? new Set(opts.allowRepos.map((r) => r.trim().toLowerCase())) : null;
  const repoGuard = (r: string): string | null => {
    if (!okRepo(r)) return badRepo(r);
    if (allow && !allow.has(r.trim().toLowerCase())) return `Repo "${r}" is out of scope for this run. Allowed: ${[...allow].join(', ') || '(none)'}. Query only the run's target repos.`;
    return null;
  };

  // One shared GET with the lazy optional token + uniform rate-limit / error surfacing. The unauthenticated
  // budget is tight (per-IP), so the message tells the agent to batch (bigger per_page, fewer calls).
  const get = async (path: string): Promise<{ json?: unknown; msg?: string }> => {
    let token: string | undefined;
    try { token = await opts.getToken(); } catch { token = undefined; }
    const r = await fetch(`${GH}${path}`, { headers: ghHeaders(token) });
    if (r.status === 403 || r.status === 429) {
      const reset = r.headers.get('x-ratelimit-reset');
      return { msg: `GitHub API rate-limited (HTTP ${r.status}${token ? '' : '; UNAUTHENTICATED — the tokenless public-repo budget is small, batch your reads: max per-page, fewest calls'})${reset ? `; resets around ${new Date(Number(reset) * 1000).toISOString()}` : ''}.` };
    }
    if (r.status === 404) return { msg: `Not found (HTTP 404) for ${path} — check the owner/name; without a token only PUBLIC repos are reachable.` };
    if (!r.ok) return { msg: `GitHub API HTTP ${r.status} for ${path}.` };
    return { json: await r.json() };
  };

  const metaWorkflows = tool('meta_workflows',
    'List a repo\'s CI workflows (read-only GitHub metadata) — discover workflow names/ids/paths before pulling run history with meta_runs.' + repoHint,
    { repo: z.string().describe('owner/name, e.g. acme/engine') },
    async ({ repo }: { repo: string }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const r = await get(`/repos/${repo.trim()}/actions/workflows?per_page=100`);
        if (r.msg) return ok(r.msg);
        const d = r.json as any;
        const flows = (Array.isArray(d.workflows) ? d.workflows : []).map((w: any) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
        return ok(cap(JSON.stringify({ repo, total: d.total_count ?? flows.length, workflows: flows })));
      } catch (e) { return fail(e); }
    });

  const metaRuns = tool('meta_runs',
    'Workflow-run HISTORY for a repo (read-only GitHub metadata): per run — workflow name, branch, sha, event, status, conclusion, run_attempt (>1 = it was re-run), run_started_at/updated_at (duration). ' +
    'This is the measurement source for CI pass rate, retry-to-green/flake rate, and duration trend. Filter by branch (e.g. the default branch) and/or workflow id from meta_workflows; page with maxRuns (default 50, cap 100 per call).' + repoHint,
    {
      repo: z.string().describe('owner/name, e.g. acme/engine'),
      branch: z.string().optional().describe('filter to one branch (e.g. the default branch)'),
      workflowId: z.number().optional().describe('filter to one workflow (id from meta_workflows)'),
      maxRuns: z.number().optional().describe('runs to return (default 50, cap 100)'),
      page: z.number().optional().describe('page number for older runs (1-based)'),
    },
    async ({ repo, branch, workflowId, maxRuns, page }: { repo: string; branch?: string; workflowId?: number; maxRuns?: number; page?: number }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const per = clampN(maxRuns, 50, 100);
        const pg = clampN(page, 1, 50);
        const qs = `per_page=${per}&page=${pg}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`;
        const path = workflowId
          ? `/repos/${repo.trim()}/actions/workflows/${workflowId}/runs?${qs}`
          : `/repos/${repo.trim()}/actions/runs?${qs}`;
        const r = await get(path);
        if (r.msg) return ok(r.msg);
        const d = r.json as any;
        const runs = (Array.isArray(d.workflow_runs) ? d.workflow_runs : []).map((w: any) => ({
          id: w.id, workflow: w.name, branch: w.head_branch, sha: String(w.head_sha ?? '').slice(0, 10), event: w.event,
          status: w.status, conclusion: w.conclusion, attempt: w.run_attempt,
          started: w.run_started_at, updated: w.updated_at,
        }));
        return ok(cap(JSON.stringify({ repo, total: d.total_count ?? runs.length, returned: runs.length, page: pg, runs })));
      } catch (e) { return fail(e); }
    });

  const metaChecks = tool('meta_checks',
    'Check-run CONCLUSIONS for one ref (commit sha / branch / tag) — read-only GitHub metadata. The measurement source for merge-gate integrity: pull a merge commit\'s sha (meta_commits / meta_pulls), then read whether its required checks were green at merge time.' + repoHint,
    {
      repo: z.string().describe('owner/name, e.g. acme/engine'),
      ref: z.string().describe('commit sha, branch, or tag'),
    },
    async ({ repo, ref }: { repo: string; ref: string }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const r = await get(`/repos/${repo.trim()}/commits/${encodeURIComponent(ref.trim())}/check-runs?per_page=100`);
        if (r.msg) return ok(r.msg);
        const d = r.json as any;
        const checks = (Array.isArray(d.check_runs) ? d.check_runs : []).map((c: any) => ({ name: c.name, status: c.status, conclusion: c.conclusion, completed: c.completed_at }));
        return ok(cap(JSON.stringify({ repo, ref, total: d.total_count ?? checks.length, checks })));
      } catch (e) { return fail(e); }
    });

  const metaReleases = tool('meta_releases',
    'Releases + tags with DATES and the release-note BODY (clipped; read-only GitHub metadata) — the measurement source for release cadence (inter-release intervals), version-increment discipline (tag sequence vs breaking-change signals), and release-note completeness (reconcile the body against API-touching diffs from meta_compare). Falls back to bare tags (no dates/body) when a repo cuts tags without releases.' + repoHint,
    {
      repo: z.string().describe('owner/name, e.g. acme/engine'),
      maxReleases: z.number().optional().describe('releases to return (default 30, cap 100)'),
    },
    async ({ repo, maxReleases }: { repo: string; maxReleases?: number }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const per = clampN(maxReleases, 30, 100);
        const r = await get(`/repos/${repo.trim()}/releases?per_page=${per}`);
        if (r.msg) return ok(r.msg);
        // The release BODY (clipped) rides along: for many projects the release notes live HERE, not in a
        // checked-in CHANGELOG — without it, release-note completeness (API-touching diffs vs notes) has no
        // text to reconcile against.
        const MAX_BODY = 2000;
        const rel = (Array.isArray(r.json) ? (r.json as any[]) : []).map((x: any) => ({
          tag: x.tag_name, name: x.name, created: x.created_at, published: x.published_at, prerelease: x.prerelease, draft: x.draft,
          body: typeof x.body === 'string' && x.body.length ? (x.body.length > MAX_BODY ? x.body.slice(0, MAX_BODY) + `…(clipped at ${MAX_BODY} chars)` : x.body) : undefined,
        }));
        if (rel.length) return ok(cap(JSON.stringify({ repo, returned: rel.length, releases: rel })));
        const t = await get(`/repos/${repo.trim()}/tags?per_page=${per}`);
        if (t.msg) return ok(t.msg);
        const tags = (Array.isArray(t.json) ? (t.json as any[]) : []).map((x: any) => ({ tag: x.name, sha: String(x.commit?.sha ?? '').slice(0, 10) }));
        return ok(cap(JSON.stringify({ repo, note: 'no GitHub releases — bare tags only (no dates here; date a tag via meta_commits on its sha)', returned: tags.length, tags })));
      } catch (e) { return fail(e); }
    });

  const metaCommits = tool('meta_commits',
    'Commit LOG metadata (read-only): sha, author, date, message headline. The measurement source for revert/hotfix density (grep "Revert"/"hotfix" headlines around release dates), ownership concentration (author distribution per path), and dating bare tags. Filter by path and/or since/until (ISO dates); page with maxCommits (default 50, cap 100 per call).' + repoHint,
    {
      repo: z.string().describe('owner/name, e.g. acme/engine'),
      path: z.string().optional().describe('only commits touching this path'),
      since: z.string().optional().describe('ISO date lower bound'),
      until: z.string().optional().describe('ISO date upper bound'),
      sha: z.string().optional().describe('start ref (branch/sha; default the default branch)'),
      maxCommits: z.number().optional().describe('commits to return (default 50, cap 100)'),
      page: z.number().optional().describe('page number for older commits (1-based)'),
    },
    async ({ repo, path, since, until, sha, maxCommits, page }: { repo: string; path?: string; since?: string; until?: string; sha?: string; maxCommits?: number; page?: number }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const per = clampN(maxCommits, 50, 100);
        const pg = clampN(page, 1, 100);
        const q = [`per_page=${per}`, `page=${pg}`];
        if (path && path.trim()) q.push(`path=${encodeURIComponent(path.trim())}`);
        if (since && since.trim()) q.push(`since=${encodeURIComponent(since.trim())}`);
        if (until && until.trim()) q.push(`until=${encodeURIComponent(until.trim())}`);
        if (sha && sha.trim()) q.push(`sha=${encodeURIComponent(sha.trim())}`);
        const r = await get(`/repos/${repo.trim()}/commits?${q.join('&')}`);
        if (r.msg) return ok(r.msg);
        const commits = (Array.isArray(r.json) ? (r.json as any[]) : []).map((c: any) => ({
          sha: String(c.sha ?? '').slice(0, 10),
          author: c.author?.login ?? c.commit?.author?.name ?? null,
          date: c.commit?.author?.date,
          headline: String(c.commit?.message ?? '').split('\n')[0].slice(0, 160),
        }));
        return ok(cap(JSON.stringify({ repo, path: path ?? null, returned: commits.length, page: pg, commits })));
      } catch (e) { return fail(e); }
    });

  const metaCompare = tool('meta_compare',
    'Compare two refs (tags/branches/shas) — read-only GitHub metadata: the files changed between them (path, status, additions/deletions, optional patch hunks). The measurement source for PUBLIC-API churn between release tags: compare consecutive tags, filter to the public surface (headers / d.ts / exported modules) with pathPrefix, and read removals/renames/signature changes from the patches. Patches are clipped — request them only for the filtered surface, not the whole diff.' + repoHint,
    {
      repo: z.string().describe('owner/name, e.g. acme/engine'),
      base: z.string().describe('base ref (older tag/sha)'),
      head: z.string().describe('head ref (newer tag/sha)'),
      pathPrefix: z.string().optional().describe('only return files whose path starts with this prefix (e.g. include/ or types/)'),
      includePatches: z.boolean().optional().describe('include clipped patch hunks per file (default false — metadata only)'),
      maxFiles: z.number().optional().describe('files to return after filtering (default 100, cap 300)'),
    },
    async ({ repo, base, head, pathPrefix, includePatches, maxFiles }: { repo: string; base: string; head: string; pathPrefix?: string; includePatches?: boolean; maxFiles?: number }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const per = clampN(maxFiles, 100, 300);
        const ref = (s: string) => encodeURIComponent(s.trim());
        // NOTE: the compare API's `page`/`per_page` paginate COMMITS, not files — the changed-file list arrives
        // only with the first page, hard-capped by GitHub (~300 files). So: no page param, and when the listing
        // hits the cap the counts are an explicit LOWER BOUND (paging for more files returns
        // pages with NO file list and silently stops the metric at the first slice).
        const r = await get(`/repos/${repo.trim()}/compare/${ref(base)}...${ref(head)}`);
        if (r.msg) return ok(r.msg);
        const d = r.json as any;
        const prefix = (pathPrefix ?? '').trim().replace(/^\/+/, '');
        const MAX_PATCH = 4000;   // per-file patch clip — the agent asks for the filtered surface, not the world
        // A rename/move reports `filename` = NEW path and `previous_filename` = OLD path — match the prefix
        // against BOTH, or a public-API file moved OUT of the filtered surface (the classic breaking rename)
        // would be filtered away from the API-stability metric.
        const filtered = (Array.isArray(d.files) ? d.files : [])
          .filter((f: any) => !prefix || String(f.filename ?? '').startsWith(prefix) || String(f.previous_filename ?? '').startsWith(prefix));
        const files = filtered
          .slice(0, per)
          .map((f: any) => ({
            path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
            previousPath: f.previous_filename,
            ...(includePatches && typeof f.patch === 'string'
              ? { patch: f.patch.length > MAX_PATCH ? f.patch.slice(0, MAX_PATCH) + `\n…(patch clipped at ${MAX_PATCH} chars)` : f.patch }
              : {}),
          }));
        const GH_FILE_CAP = 300;   // GitHub's hard cap on the compare file listing
        const rawFiles = Array.isArray(d.files) ? d.files.length : 0;
        const truncatedByApi = rawFiles >= GH_FILE_CAP;
        const truncatedByMaxFiles = filtered.length > files.length;   // client cap dropped MATCHING files — loud, never silent
        const notes = [
          truncatedByApi ? `GitHub caps the compare file listing at ~${GH_FILE_CAP} files and does NOT page it — this diff has more. To enumerate fully, NARROW the range (compare intermediate tags between ${base} and ${head}).` : '',
          truncatedByMaxFiles ? `maxFiles (${per}) dropped ${filtered.length - files.length} MATCHING file(s) — re-call with a larger maxFiles to see them all.` : '',
          (truncatedByApi || truncatedByMaxFiles) ? 'Any churn/breaking-change count from this listing is a LOWER BOUND and must be reported as such.' : '',
        ].filter(Boolean).join(' ');
        return ok(cap(JSON.stringify({
          repo, base, head, aheadBy: d.ahead_by, behindBy: d.behind_by,
          totalCommits: d.total_commits, rawFilesListed: rawFiles,
          filteredTotal: filtered.length, filteredReturned: files.length, pathPrefix: prefix || null,
          truncatedByApi, truncatedByMaxFiles,
          ...(notes ? { note: notes } : {}),
          files,
        })));
      } catch (e) { return fail(e); }
    });

  const metaPulls = tool('meta_pulls',
    'Pull-request MERGE metadata (read-only): number, title, created_at, merged_at, merge_commit_sha, base branch. The measurement source for PR lead time and (via meta_checks on merge_commit_sha) merge-gate integrity. Returns closed PRs newest-first; page with maxPulls (default 30, cap 100 per call).' + repoHint,
    {
      repo: z.string().describe('owner/name, e.g. acme/engine'),
      maxPulls: z.number().optional().describe('PRs to return (default 30, cap 100)'),
      page: z.number().optional().describe('page number for older PRs (1-based)'),
    },
    async ({ repo, maxPulls, page }: { repo: string; maxPulls?: number; page?: number }) => {
      const _g = repoGuard(repo); if (_g) return ok(_g);
      try {
        const per = clampN(maxPulls, 30, 100);
        const pg = clampN(page, 1, 50);
        const r = await get(`/repos/${repo.trim()}/pulls?state=closed&sort=updated&direction=desc&per_page=${per}&page=${pg}`);
        if (r.msg) return ok(r.msg);
        const pulls = (Array.isArray(r.json) ? (r.json as any[]) : []).map((p: any) => ({
          number: p.number, title: String(p.title ?? '').slice(0, 120), created: p.created_at, merged: p.merged_at,
          mergeSha: p.merge_commit_sha ? String(p.merge_commit_sha).slice(0, 10) : null, base: p.base?.ref,
        }));
        return ok(cap(JSON.stringify({ repo, returned: pulls.length, page: pg, pulls })));
      } catch (e) { return fail(e); }
    });

  const server = createSdkMcpServer({ name: 'repometa-readonly', version: '1.0.0', tools: [metaWorkflows, metaRuns, metaChecks, metaReleases, metaCommits, metaCompare, metaPulls] });
  return {
    kind: 'repo',
    name: 'GitHub repo metadata (CI / releases / commits)',
    capabilities: { discover: true, query: true, metadata: true },
    agentTools: (): SourceAgentTools => ({ mcpServers: { [serverName]: server } }),
  };
}
