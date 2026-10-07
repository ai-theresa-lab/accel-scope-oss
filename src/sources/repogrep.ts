// RepoGrepSource — a READ-ONLY, on-demand GitHub-repo reader/grepper backed by an IN-PROCESS MCP server
// (like makeBigQuerySource). Its purpose: let an accel agent read/grep an org repo that ISN'T in its mounted
// clone. The org run only clones the audit's selected repos into cwd; when a report or a question points at a
// repo OUTSIDE that set (e.g. acme/mobile-app), the agent has no file access to it. This source closes
// that gap by reaching those repos through the connected GitHub source's token via the GitHub REST API —
// NO git clone (deliberately: /tmp is often RAM-backed tmpfs in containers, and cloning full-org history
// can OOM-kill the box; the REST API keeps the reach read-only and RAM-free).
//
// The token is resolved LAZILY at run time (via tokenForRun on the connected github Source), so a profile-loaded
// GitHub connection works headlessly with no stored secret — matching the clone-on-run credential path. The three
// tools are read-only by construction (list / code-search / contents-read — no write/exec/clone surface), so the
// whole server keeps whole-server trust once `repogrep` is a mounted MCP key.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DataSource, SourceAgentTools } from './types.ts';

// Replicated from github.ts (its GH const + headers() helper are module-private there). Same base URL, same
// auth-header shape (Bearer token + the pinned API version) so this reaches GitHub exactly like the connector.
const GH = 'https://api.github.com';
function ghHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'User-Agent': 'accel-scope',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export interface RepoGrepSourceOpts {
  // Lazy token getter — the connected github token is resolved at run time (tokenForRun → resolveSecretValue),
  // so we never capture a possibly-expired/absent token at mount time. Returns undefined when nothing resolves
  // (the tools then report a clear "no GitHub token" message rather than throwing).
  getToken: () => Promise<string | undefined>;
  defaultOrg?: string;   // org used when repo_list is called without an explicit `org` (wiring derives it per-org from the connected source's repos)
  mcpName?: string;      // mounted server name (default 'repogrep' — matches /^[a-z][a-z0-9]*$/)
  maxOutput?: number;    // bytes returned per call (default 400k)
}

// Build an in-process read-only repo-grep MCP DataSource. Mounted under the `repogrep` server name; the agent
// calls mcp__repogrep__{repo_list,repo_grep,repo_read}. Never throws at mount (unlike bigquery, there's no key
// to validate) — token problems surface per-call as clear text so a run degrades gracefully.
export function makeRepoGrepSource(opts: RepoGrepSourceOpts): DataSource {
  const serverName = opts.mcpName ?? 'repogrep';
  const defaultOrg = opts.defaultOrg;
  const MAX_OUTPUT = opts.maxOutput ?? 400_000;
  const MAX_FILE = 40 * 1024;   // ~40 KB clip for a single file read

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text: text || '(empty)' }] });
  const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
  const cap = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(truncated at ${MAX_OUTPUT} bytes)` : s);
  // Resolve the connected token per call; a clear message (not a throw) when there's none, so the agent can move on.
  const need = async (): Promise<{ token: string } | { msg: string }> => {
    let token: string | undefined;
    try { token = await opts.getToken(); } catch { token = undefined; }
    return token ? { token } : { msg: 'No GitHub token is available — the org has no connected GitHub source, or its token did not resolve. Reconnect GitHub to reach repos outside the mounted clone.' };
  };
  // owner/name shape guard — reject a malformed `repo` up front with a clear message (a bad ref otherwise 404s confusingly).
  const badRepo = (r: string) => `Invalid repo "${r}" — expected owner/name (e.g. acme/mobile-app). Use repo_list to find the exact full-name.`;
  const okRepo = (r: string) => /^[\w.-]+\/[\w.-]+$/.test(r.trim());

  const repoList = tool('repo_list',
    'List the GitHub repos the connected token can read (read-only). Use this to DISCOVER the exact full-name of a repo that is NOT in your mounted clone — e.g. acme/mobile-app — before calling repo_grep / repo_read. ' +
    (defaultOrg ? `Defaults to org '${defaultOrg}' when no org is given. ` : '') +
    'Optionally filter to a specific org. Returns repo full-names (owner/name).',
    { org: z.string().optional().describe(`GitHub org to list (defaults to ${defaultOrg ?? 'the token\'s repos'})`) },
    async ({ org }: { org?: string }) => {
      const g = await need(); if ('msg' in g) return ok(g.msg);
      try {
        const target = (org && org.trim()) || defaultOrg;
        // Lazy import from github.ts so this module stays dependency-light and mirrors the connector's paging/fail-soft.
        const { listOrgRepos, listReposWithOrgs } = await import('../github.ts');
        const repos = target ? await listOrgRepos(g.token, target) : await listReposWithOrgs(g.token);
        const names = repos.map((r) => r.fullName).sort();
        if (!names.length) return ok(target ? `No readable repos found in org '${target}' (the connected token may lack access, or the org name is wrong).` : 'No readable repos found for the connected token.');
        return ok(cap(JSON.stringify({ org: target ?? null, count: names.length, repos: names })));
      } catch (e) { return fail(e); }
    });

  const repoGrep = tool('repo_grep',
    'Grep a GitHub repo by content via GitHub code-search (read-only) — reaches repos NOT in your mounted clone, e.g. acme/mobile-app. ' +
    'Args: repo (owner/name), pattern (the search string), optional path filter, optional maxResults (default 20, cap 50). ' +
    'Returns matches with { path, url, html_url, fragment }. NOTE: code-search indexes only the repo DEFAULT branch and can lag recent pushes; ' +
    'for a non-default branch or a file it misses, use repo_read with an explicit ref.',
    {
      repo: z.string().describe('owner/name, e.g. acme/mobile-app'),
      pattern: z.string().describe('the content to search for (GitHub code-search syntax)'),
      path: z.string().optional().describe('optional path filter, e.g. src/ or a filename'),
      maxResults: z.number().optional().describe('max matches to return (default 20, capped at 50)'),
    },
    async ({ repo, pattern, path, maxResults }: { repo: string; pattern: string; path?: string; maxResults?: number }) => {
      const g = await need(); if ('msg' in g) return ok(g.msg);
      if (!okRepo(repo)) return ok(badRepo(repo));
      try {
        const per = Math.min(50, Math.max(1, Math.round(maxResults ?? 20)));
        // q = <pattern> repo:<owner/repo> [path:<path>] — plus-joined, each part encoded (space→+ per code-search).
        const parts = [pattern.trim(), `repo:${repo.trim()}`];
        if (path && path.trim()) parts.push(`path:${path.trim()}`);
        const q = parts.map((p) => encodeURIComponent(p)).join('+');
        const url = `${GH}/search/code?q=${q}&per_page=${per}`;
        const r = await fetch(url, { headers: ghHeaders(g.token, 'application/vnd.github.text-match+json') });
        if (r.status === 403 || r.status === 429) {
          // code-search has a tight secondary rate limit; surface it plainly instead of throwing.
          const reset = r.headers.get('x-ratelimit-reset');
          return ok(`GitHub code-search is rate-limited (HTTP ${r.status})${reset ? `; resets around ${new Date(Number(reset) * 1000).toISOString()}` : ''}. Retry shortly, narrow the pattern, or use repo_read for a known file.`);
        }
        if (!r.ok) return ok(`code-search failed (HTTP ${r.status}) for repo ${repo}. Check the repo full-name (use repo_list) and that the connected token can read it.`);
        const d = (await r.json()) as any;
        const items = Array.isArray(d.items) ? d.items : [];
        if (!items.length) {
          return ok(`No code-search matches for "${pattern}" in ${repo}${path ? ` (path:${path})` : ''}. Note: code-search indexes only the DEFAULT branch and may lag recent pushes — if you expect a match on another branch or a just-pushed file, use repo_read with an explicit ref.`);
        }
        const matches = items.slice(0, per).map((it: any) => ({
          path: it.path,
          url: it.url,
          html_url: it.html_url,
          fragment: Array.isArray(it.text_matches) && it.text_matches.length ? it.text_matches.map((m: any) => m.fragment).filter(Boolean).join('\n---\n') : undefined,
        }));
        return ok(cap(JSON.stringify({ repo, pattern, path: path ?? null, total_count: d.total_count ?? matches.length, returned: matches.length, note: 'code-search covers the DEFAULT branch only and can lag recent pushes', matches })));
      } catch (e) { return fail(e); }
    });

  const repoRead = tool('repo_read',
    'Read ONE file from a GitHub repo (read-only) — reaches repos NOT in your mounted clone, e.g. acme/mobile-app, AND non-default branches that repo_grep\'s code-search can\'t see. ' +
    'Args: repo (owner/name), path (file path in the repo), optional ref (branch name or commit sha; defaults to the repo default branch). ' +
    `Returns the file text (clipped to ~${Math.round(MAX_FILE / 1024)} KB).`,
    {
      repo: z.string().describe('owner/name, e.g. acme/mobile-app'),
      path: z.string().describe('file path within the repo, e.g. src/config.ts'),
      ref: z.string().optional().describe('optional branch name or commit sha (defaults to the repo default branch)'),
    },
    async ({ repo, path, ref }: { repo: string; path: string; ref?: string }) => {
      const g = await need(); if ('msg' in g) return ok(g.msg);
      if (!okRepo(repo)) return ok(badRepo(repo));
      try {
        const cleanPath = path.trim().replace(/^\/+/, '');
        const encPath = cleanPath.split('/').map(encodeURIComponent).join('/');
        const qs = ref && ref.trim() ? `?ref=${encodeURIComponent(ref.trim())}` : '';
        const url = `${GH}/repos/${repo.trim()}/contents/${encPath}${qs}`;
        const r = await fetch(url, { headers: ghHeaders(g.token) });
        if (r.status === 404) return ok(`Not found: ${repo}:${cleanPath}${ref ? `@${ref}` : ''}. Check the repo full-name (repo_list), the path, and the ref (branch/sha).`);
        if (r.status === 403 || r.status === 429) return ok(`GitHub is rate-limited (HTTP ${r.status}) reading ${repo}:${cleanPath}. Retry shortly.`);
        if (!r.ok) return ok(`Failed to read ${repo}:${cleanPath} (HTTP ${r.status}). Check the repo full-name and that the connected token can read it.`);
        const d = (await r.json()) as any;
        if (Array.isArray(d)) return ok(`'${cleanPath}' is a DIRECTORY in ${repo}, not a file. Entries: ${d.slice(0, 100).map((e: any) => e.name).join(', ')}`);
        if (typeof d.content !== 'string' || d.encoding !== 'base64') {
          // Large files (>1 MB) come back without inline content; download_url is the fallback but we keep this read
          // API-only (no extra fetch of arbitrary blobs). Point the agent at code-search / a narrower path instead.
          return ok(`Cannot inline '${cleanPath}' from ${repo} (${d.size ? `${d.size} bytes` : 'no base64 content'} — likely too large or binary). Try a more specific file, or repo_grep to locate the relevant lines.`);
        }
        const text = Buffer.from(d.content, 'base64').toString('utf8');
        const clipped = text.length > MAX_FILE ? text.slice(0, MAX_FILE) + `\n…(clipped at ${Math.round(MAX_FILE / 1024)} KB; file is ${text.length} bytes — use repo_grep to locate the relevant lines)` : text;
        return ok(cap(`# ${repo}:${cleanPath}${ref ? `@${ref}` : ''} (${text.length} bytes)\n\n${clipped}`));
      } catch (e) { return fail(e); }
    });

  const server = createSdkMcpServer({ name: 'repogrep-readonly', version: '1.0.0', tools: [repoList, repoGrep, repoRead] });
  return {
    kind: 'repo',
    name: 'GitHub repo-grep (on-demand)',
    capabilities: { discover: true, query: true, metadata: false },
    agentTools: (): SourceAgentTools => ({ mcpServers: { [serverName]: server } }),
  };
}
