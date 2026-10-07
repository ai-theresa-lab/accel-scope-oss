// readSet.ts — what a bundle lane LOOKED AT (incremental re-scan).
//
// A lane may be reused on a re-scan only if nothing it looked at has changed. runAgent (agent.ts) sees every tool call
// its agent makes; each call is reported here through an AsyncLocalStorage collector the executor enters PER LANE
// (withReadSet around the lane's Critic → Preflight → Expert → in-session area report), so no signature threading.
// Outside a lane (Comprehend, claim audit, synthesis, writers) there is no collector and the calls are not recorded.
//
// What is recorded, all as WORKSPACE-RELATIVE posix paths (the agents' cwd is the run workspace, `<repoDir>/<path>`):
//   • readSet — files the lane READ: Read file_path; paths listed in Grep / Glob RESULTS; repogrep repo_read of a
//     workspace repo; the file of a single-file codeintel read (none of repowise's current tools is one). This is the
//     CONSERVATIVE union the incremental reuse decision reads (a listed file the agent saw is part of what it saw).
//   • opened — the subset the lane actually OPENED (Read, repo_read, a single-file codeintel read) — NOT a path a Glob /
//     Grep result merely listed. The capability map's "examined" signal (capabilities.examinedCapabilityIds) reads this:
//     on the umami E2E a wide listing put every anchor in readSet and marked 11 of 12 capabilities examined.
//   • globs   — Glob patterns (under their `path`): a file ADDED / DELETED / RENAMED that matches one changes the listing
//     the agent saw. (A modification does not; the agent's later Read of that file is in readSet.)
//   • greps   — Grep probes {path, glob, type, pattern, -i} and repogrep repo_grep searches (as a case-insensitive
//     over-approximating regex): at reuse time every CHANGED file under the probe's scope is tested against the pattern
//     in BOTH its old and new version — a file that newly matches (or stopped matching) would have changed what the
//     agent saw, even though it never read it.
//   • opaque  — reads we cannot attribute to files: EVERY codeintel index query (symbol / context / risk / blast radius
//     draw on callers and co-change edges, not one file), a repogrep call against a repo OUTSIDE the scanned workspace
//     or with code-search syntax we cannot model. A lane with any opaque read is reused only when NO file changed.
//   • measured — the measure planes whose tools the lane CALLED (warehouse / redis / analytics / bi / custom / repometa /
//     osv): time-dependent evidence, carried on reuse as "measured <date>" (proposal §3 option b).
// Known blind spots (documented in the proposal Status): reasoning from the prompt's pushed context (org map, codeintel
// digest, memory cards) rather than from a tool; codex file tasks (report-stage only, past the barrier); a Grep regex
// JS cannot compile (treated as matching — conservative). FAIL-OPEN: a collector error never touches the agent call.
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export interface GrepProbe { path: string; glob?: string; type?: string; pattern: string; ci?: boolean }
export interface ReadSetSnapshot { readSet: string[]; globs: string[]; greps: GrepProbe[]; opaque: string[]; measured: string[]; opened?: string[] }

const MAX_FILES = 5000, MAX_PROBES = 400;
// MCP servers whose tools are LIVE measurements (time-dependent), by mounted server name. The generic analytics / bi /
// custom planes mount under their own mcpName, so the executor passes the run's measure-plane names in as well.
const LIVE_PLANES = new Set(['warehouse', 'redis', 'repometa', 'osv']);

export class ReadSetCollector {
  private root: string;
  private rootReal: string;
  private files = new Set<string>();
  private opened = new Set<string>();
  private globs = new Set<string>();
  private greps = new Map<string, GrepProbe>();
  private opaque = new Set<string>();
  private measured = new Set<string>();
  private workspaceRepos: Set<string>;       // owner/name of the repos cloned into the workspace (repogrep attribution)
  private repoDirOf: Map<string, string>;    // owner/name (lowercase) → workspace dir
  private measurePlanes: Set<string>;
  constructor(root: string, opts: { repos?: { fullName: string; dir: string }[]; measurePlanes?: Iterable<string> } = {}) {
    this.root = resolve(root);
    let rr = this.root; try { rr = realpathSync(this.root); } catch { /* keep */ }
    this.rootReal = rr;
    this.repoDirOf = new Map((opts.repos ?? []).map((r) => [r.fullName.toLowerCase(), r.dir]));
    this.workspaceRepos = new Set(this.repoDirOf.keys());
    this.measurePlanes = new Set([...LIVE_PLANES, ...(opts.measurePlanes ?? [])]);
  }

  /** Workspace-relative posix path of `p` (as the agent passed it, relative to `cwd`), or undefined when outside the workspace. */
  rel(p: string, cwd?: string): string | undefined {
    const raw = String(p ?? '').trim();
    if (!raw) return undefined;
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(cwd ?? this.root, raw);
    for (const base of [this.root, this.rootReal]) {
      const r = relative(base, abs);
      if (r === '') return '.';
      if (!r.startsWith('..') && !isAbsolute(r)) return r.replace(/\\/g, '/');
    }
    return undefined;
  }

  private addFile(p: string | undefined, opened = false): void {
    if (!p || p === '.') return;
    if (this.files.size < MAX_FILES) this.files.add(p);
    if (opened && this.opened.size < MAX_FILES) this.opened.add(p);
  }

  /** One tool_use block. `cwd` = the agent's cwd. */
  noteToolUse(name: string, input: Record<string, unknown> | undefined, cwd?: string): void {
    try {
      const inp = input ?? {};
      const str = (k: string): string | undefined => (typeof inp[k] === 'string' && (inp[k] as string).trim() ? String(inp[k]) : undefined);
      if (name === 'Read') { this.addFile(this.rel(str('file_path') ?? str('path') ?? '', cwd), true); return; }
      if (name === 'Glob') {
        const base = this.rel(str('path') ?? '.', cwd) ?? '.';
        let pat = (str('pattern') ?? '**/*').replace(/\\/g, '/');
        // An ABSOLUTE pattern (`/ws/app/src/**/*.ts`) is re-rooted at the workspace; one outside it is not a workspace read.
        if (isAbsolute(pat) || /^[A-Za-z]:\//.test(pat)) { const r = this.rel(pat); if (!r) return; pat = r; this.globs.add(pat); return; }
        this.globs.add(base === '.' ? pat : `${base}/${pat}`);
        return;
      }
      if (name === 'Grep') {
        const pattern = str('pattern');
        if (!pattern) return;
        const path = this.rel(str('path') ?? '.', cwd) ?? '.';
        const probe: GrepProbe = { path, pattern, ...(str('glob') ? { glob: str('glob')!.replace(/\\/g, '/') } : {}), ...(str('type') ? { type: str('type') } : {}), ...(inp['-i'] === true ? { ci: true } : {}) };
        const k = JSON.stringify(probe);
        if (!this.greps.has(k) && this.greps.size < MAX_PROBES) this.greps.set(k, probe);
        return;
      }
      const m = /^mcp__(.+?)__(.+)$/.exec(name);
      if (!m) return;
      const [, server, tool] = m;
      if (this.measurePlanes.has(server)) { this.measured.add(server); return; }
      if (server === 'repogrep') {
        const repo = String(inp.repo ?? '').toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
        if (tool === 'repo_list') return;
        const dir = this.repoDirOf.get(repo);
        if (!repo || !dir) { this.opaque.add(`repogrep:${repo || 'unknown repo'}`); return; }
        const p = String(inp.path ?? '').replace(/^\/+/, '');
        if (tool === 'repo_read') { if (p) this.addFile(`${dir}/${p}`, true); return; }
        if (tool === 'repo_grep') {
          // GitHub code-search syntax, case-insensitive: recorded as a case-insensitive REGEX probe that
          // over-approximates the search (any term matching ⇒ the probe matches); syntax we cannot model ⇒ opaque.
          const pattern = codeSearchProbe(String(inp.pattern ?? ''));
          if (pattern === null) { this.opaque.add('repogrep:repo_grep'); return; }
          const probe: GrepProbe = { path: p ? `${dir}/${p}`.replace(/\/+$/, '') : dir, pattern, ci: true };
          if (probe.pattern && this.greps.size < MAX_PROBES) this.greps.set(JSON.stringify(probe), probe);
          return;
        }
        this.opaque.add(`repogrep:${tool}`);
        return;
      }
      if (server === 'codeintel') {
        // codeintel answers from the INDEX — a symbol / context / risk / blast-radius query about one file
        // still draws on its callers, dependents and co-change edges, so it is not a single-file read. Only a
        // single-file read / outline tool is attributed to its file; every other codeintel call is opaque (the lane is
        // then reused only when nothing changed).
        const paths = CODEINTEL_SINGLE_FILE.has(tool) ? pathLikeStrings(inp).map((s) => this.rel(s, cwd)).filter((x): x is string => !!x && x !== '.' && this.isFile(x)) : [];
        if (paths.length) paths.forEach((x) => this.addFile(x, true)); else this.opaque.add(`codeintel:${tool}`);
      }
      // memory_recall and other non-code MCPs: not a code read.
    } catch { /* fail-open */ }
  }

  /** One tool_result block (text), for the tool that produced it. Adds result paths that resolve to workspace files. */
  noteToolResult(name: string, text: string, cwd?: string): void {
    try {
      if (!(name === 'Grep' || name === 'Glob' || name.startsWith('mcp__codeintel__'))) return;
      let n = 0;
      for (const line of String(text ?? '').split('\n')) {
        if (n > 2000) break;
        const cand = line.trim().replace(/:\d+(?::.*)?$/, '').replace(/^[-*]\s+/, '');   // "path:12:match" / "path" / "- path"
        if (!cand || cand.length > 400 || /\s{2,}/.test(cand)) continue;
        const r = this.rel(cand, cwd);
        if (r && r !== '.' && this.isFile(r)) { this.addFile(r); n++; }
      }
    } catch { /* fail-open */ }
  }

  private isFile(rel: string): boolean { try { return statSync(resolve(this.root, rel)).isFile(); } catch { return false; } }
  exists(rel: string): boolean { return existsSync(resolve(this.root, rel)); }

  snapshot(): ReadSetSnapshot {
    return { readSet: [...this.files].sort(), globs: [...this.globs].sort(), greps: [...this.greps.values()], opaque: [...this.opaque].sort(), measured: [...this.measured].sort(), opened: [...this.opened].sort() };
  }
}

// codeintel tools that read ONE file and nothing derived from the cross-file index (none of repowise's current
// CODEINTEL_TOOLS qualifies; a future read / outline tool would be listed here).
const CODEINTEL_SINGLE_FILE = new Set(['read_file', 'get_file', 'get_outline', 'get_file_outline']);

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/**
 * A GitHub code-search query → a JS regex source that matches (case-insensitively) whenever the search COULD match a
 * file: `/re/` → that regex; `"a b"` → the literal phrase; bare terms (implicitly AND-ed by code-search) → any term
 * (a superset — conservative for reuse). Boolean operators, qualifiers (`language:` …), parentheses → null (opaque).
 */
export function codeSearchProbe(q: string): string | null {
  const s = q.trim();
  if (!s) return null;
  const re = /^\/(.+)\/$/.exec(s);
  if (re) { try { new RegExp(re[1], 'i'); return re[1]; } catch { return null; } }
  if (/(^|\s)(AND|OR|NOT)(\s|$)|[()]|(^|\s)-?[a-z_]+:\S/.test(s)) return null;
  const terms: string[] = [];
  s.replace(/"([^"]+)"|(\S+)/g, (_m, phrase: string | undefined, word: string | undefined) => { terms.push(escapeRe(phrase ?? word ?? '')); return ''; });
  return terms.filter(Boolean).join('|') || null;
}
function pathLikeStrings(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 3 || out.length > 50) return out;
  // A candidate only — `os.path` passes this shape test too, so every caller keeps just those that resolve to an
  // EXISTING workspace file (isFile), and only for single-file tools.
  if (typeof v === 'string') { if (/[\w-]\/[\w.-]|\.\w{1,6}$/.test(v) && v.length < 400) out.push(v); return out; }
  if (Array.isArray(v)) { for (const x of v) pathLikeStrings(x, out, depth + 1); return out; }
  if (v && typeof v === 'object') for (const x of Object.values(v)) pathLikeStrings(x, out, depth + 1);
  return out;
}

const als = new AsyncLocalStorage<ReadSetCollector>();
/** Record every tool call awaited inside `fn` into `c` (one lane). */
export function withReadSet<T>(c: ReadSetCollector, fn: () => Promise<T>): Promise<T> { return als.run(c, fn); }
export function currentReadSet(): ReadSetCollector | undefined { return als.getStore(); }

/**
 * Translate a snapshot from workspace paths (`<dir>/<rel>`) to REPO-NORMALIZED paths (`<owner/name>/<rel>`) so it
 * compares against a later run's git diff regardless of the workspace dir name that run picks. A path outside every
 * repo dir (a top-level file, a local folder) keeps its workspace form.
 */
export function normalizeSnapshot(s: ReadSetSnapshot, repos: { fullName: string; dir: string }[]): ReadSetSnapshot {
  const byDir = new Map(repos.map((r) => [r.dir, r.fullName.toLowerCase()]));
  const norm = (p: string): string => {
    const i = p.indexOf('/');
    const head = i < 0 ? p : p.slice(0, i);
    const full = byDir.get(head);
    return full ? full + (i < 0 ? '' : p.slice(i)) : p;
  };
  return {
    readSet: [...new Set(s.readSet.map(norm))].sort(),
    globs: [...new Set(s.globs.map(norm))].sort(),
    greps: s.greps.map((g) => ({ ...g, path: g.path === '.' ? '.' : norm(g.path) })),
    opaque: s.opaque, measured: s.measured,
    ...(s.opened ? { opened: [...new Set(s.opened.map(norm))].sort() } : {}),
  };
}

/**
 * The files a lane OPENED, recovered from its persisted TRACE — for a lane recorded before `opened` existed (a checkpoint
 * or lineage written earlier). The trace lists each tool call as `🔧 Read  {"file_path":…}`; the path is the agent's
 * own (workspace-relative, or absolute under the run's temp workspace), so it is cut at the first segment that is a
 * workspace repo dir and repo-normalized like normalizeSnapshot. A path under no repo dir is dropped. Best-effort by
 * design: a trace that was truncated loses reads (the capability then renders grey — never a false green).
 */
export function openedFromTrace(trace: string | undefined, repos: { fullName: string; dir: string }[]): string[] {
  const byDir = new Map(repos.map((r) => [r.dir, r.fullName.toLowerCase()]));
  const out = new Set<string>();
  for (const m of String(trace ?? '').matchAll(/🔧 Read\s+\{[^\n]*?"file_path":"((?:[^"\\]|\\.)*)"/g)) {
    let p: string;
    try { p = JSON.parse(`"${m[1]}"`); } catch { continue; }
    const segs = p.replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
    const i = segs.findIndex((x) => byDir.has(x));
    if (i < 0 || i === segs.length - 1) continue;
    out.add(`${byDir.get(segs[i])}/${segs.slice(i + 1).join('/')}`);
  }
  return [...out].sort();
}
