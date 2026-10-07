// CLICKABLE EVIDENCE: `path:line[-line]` references become GitHub permalinks at the scanned commit.
//
// TWO HALVES, because the facts live in different places at different times:
//   1. AT RUN END (execute-org-run.ts, while the cloned workspace still exists) buildLinkIndex resolves every path the
//      run's reports and findings CITE against the workspace manifest (repos @ pinned SHA) and the files on disk, and
//      saves the result as a small `<runId>-links.json` sidecar: cited path → (repo, repo-relative path). Only paths
//      that EXIST under a GitHub repo with a pinned SHA get an entry — a local folder, an unknown path, or a path two
//      repos both carry (ambiguous) never does. The workspace is deleted right after, so this is the only moment the
//      existence check can be made.
//   2. AT SERVE TIME (server.ts reportForConsole / reportForShare) linkifyReport rewrites the stored HTML per request:
//      `<code>` spans that name an indexed path, and the engineering report's embedded evidence rows (`href` added to
//      __ACCEL_DATA__, which the report runtime renders). Per request, not baked in, because the policy differs by
//      audience: /share (a public, token-only link) may only point at PUBLIC repos — the giturl targets, cloned
//      tokenless — so a private repo's owner/name/SHA/paths are never emitted there.
//
// SAFETY: the pass never touches <pre> (SQL / command drawers), <script>, <style>, <textarea> or an existing <a>; it
// only ever emits https://github.com/<owner>/<repo>/blob/<sha>/<path>[#L<a>[-L<b>]] with target="_blank"
// rel="noopener noreferrer"; and a `<!--accel-links-->` marker makes a second pass a no-op.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';
import type { WorkspaceManifest } from './checkpoints.ts';

export const LINKS_MARK = '<!--accel-links-->';

/** One GitHub repo the run scanned at a pinned commit. `public` = a giturl target (the only kind /share may link). */
export interface LinkRepo { owner: string; repo: string; sha: string; dir: string; public: boolean }
/** The run's resolved citations: cited path (as written) → [index into repos, repo-relative path]. */
export interface LinkIndex { v: 1; repos: LinkRepo[]; paths: Record<string, [number, string]> }

// owner/repo of a github.com clone URL (https or ssh form). Anything else (GitLab, a local path) → null: no links.
export function githubRepoOf(cloneUrl: string): { owner: string; repo: string } | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(String(cloneUrl ?? '').trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Parse one citation into a path and an optional line range. Accepts `a/b.ts`, `a/b.ts:12`, `a/b.ts:12-40`,
 * `a/b.ts#L12-L40`, and — for evidence refs — a leading plane tag (`code-inspection:a/b.ts:12`) and trailing prose
 * or a comma list (only the first range is used). `strict` (code spans) requires the WHOLE text to be one ref.
 */
export function parseCitation(text: string, strict = false): { path: string; a?: number; b?: number } | null {
  let t = String(text ?? '').trim();
  if (!strict) {
    t = t.replace(/^[A-Za-z][\w-]*:\s*(?=[\w.-]*[/.])/, '');   // plane tag, only when a path-looking token follows
    t = t.split(/[\s,;+()]+/)[0] ?? '';
  }
  const m = /^((?:\.\/)?[\w@.-]+(?:\/[\w@.+-]+)*)(?::(\d+)(?:[-–](\d+))?|#L(\d+)(?:-L?(\d+))?)?$/.exec(t);
  if (!m) return null;
  const path = m[1].replace(/^\.\//, '');
  // A path must look like a file: an extension, or a directory component (`Dockerfile` alone is too generic to be
  // sure of, but `docker/Dockerfile` is fine). A bare number or a word never qualifies.
  if (!/\.[A-Za-z0-9]{1,8}$/.test(path) && !path.includes('/')) return null;
  if (path.split('/').some((seg) => seg === '..')) return null;
  const a = Number(m[2] ?? m[4]);
  const b = Number(m[3] ?? m[5]);
  return { path, ...(a > 0 ? { a } : {}), ...(a > 0 && b > a ? { b } : {}) };
}

// Every path-looking token INSIDE an evidence ref. Real refs are often method descriptions with the files in them —
// `code:glob+read (ky/package.json, ky/.github/workflows/main.yml)` — whose FIRST token is not a path, so the
// first-token parse above yields nothing (the ky test run: zero links on the engineering report). Order-preserving.
export function embeddedCitations(text: string): { path: string; a?: number; b?: number }[] {
  const out: { path: string; a?: number; b?: number }[] = []; const seen = new Set<string>();
  for (const raw of String(text ?? '').split(/[\s,;+()\[\]{}"'`]+/)) {
    const tok = raw.replace(/^[A-Za-z][\w-]*:(?=[\w.-]*[/.])/, '').replace(/[.:]+$/, '');
    if (!tok) continue;
    const c = parseCitation(tok, true);
    if (c && !seen.has(c.path)) { seen.add(c.path); out.push(c); }
  }
  return out;
}

const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// Regions the pass never rewrites. <a> first-class so a <code> already inside a link is left alone.
const PROTECTED = /(<pre\b[\s\S]*?<\/pre>|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<textarea\b[\s\S]*?<\/textarea>|<a\b[\s\S]*?<\/a>)/gi;
const CODE_SPAN = /<code\b([^>]*)>([^<]{1,400})<\/code>/gi;

/** Every path a run's HTML (`<code>` spans outside protected regions) and evidence refs cite. */
export function citedPaths(htmls: (string | null | undefined)[], evidenceRefs: string[]): Set<string> {
  const out = new Set<string>();
  for (const html of htmls) {
    if (!html) continue;
    String(html).split(PROTECTED).forEach((seg, i) => {
      if (i % 2) return;
      for (const m of seg.matchAll(CODE_SPAN)) { const c = parseCitation(decode(m[2]), true); if (c) out.add(c.path); }
    });
  }
  for (const r of evidenceRefs) { const c = parseCitation(r); if (c) out.add(c.path); for (const e of embeddedCitations(r)) out.add(e.path); }
  return out;
}

/**
 * Resolve the cited paths against the workspace (run end, workspace still on disk). A path resolves when it exists
 * as a FILE under exactly one GitHub repo of the manifest — cited workspace-relative (`<dir>/…`), owner/repo-relative
 * (`<owner>/<repo>/…`), or repo-relative (`src/a.ts`, the usual form in a one-repo run). Pure except for stat calls.
 */
export function buildLinkIndex(manifest: WorkspaceManifest, root: string, paths: Iterable<string>): LinkIndex {
  const repos: LinkRepo[] = [];
  for (const p of manifest.repos ?? []) {
    const gh = githubRepoOf(p.cloneUrl);
    if (!gh || !p.sha || !/^[0-9a-f]{40}$/.test(p.sha) || !p.dir) continue;
    repos.push({ ...gh, sha: p.sha, dir: p.dir, public: p.public === true });
  }
  const idx: LinkIndex = { v: 1, repos, paths: {} };
  if (!repos.length) return idx;
  const isFileIn = (dir: string, rel: string): boolean => {
    const base = join(root, dir);
    const abs = normalize(join(base, rel));
    const r = relative(base, abs);
    if (!r || r.startsWith('..') || isAbsolute(r)) return false;
    try { return statSync(abs).isFile(); } catch { return false; }
  };
  for (const cited of paths) {
    const hits: [number, string][] = [];
    repos.forEach((r, i) => {
      for (const prefix of [`${r.dir}/`, `${r.owner}/${r.repo}/`]) {
        if (cited.startsWith(prefix) && isFileIn(r.dir, cited.slice(prefix.length))) { hits.push([i, cited.slice(prefix.length)]); return; }
      }
      if (isFileIn(r.dir, cited)) hits.push([i, cited]);
    });
    // Exactly one owner, or no link — a path two repos both carry cannot be attributed from the text alone.
    if (hits.length === 1) idx.paths[cited] = hits[0];
  }
  return idx;
}

/** The permalink for one citation, or null (unknown path, or a private repo under the public-only policy). */
export function permalinkFor(idx: LinkIndex | null | undefined, citation: string, opts: { publicOnly?: boolean; strict?: boolean } = {}): string | null {
  if (!idx || idx.v !== 1) return null;
  const first = parseCitation(citation, opts.strict);
  // Non-strict (evidence refs): fall back to the first EMBEDDED path the index knows (see embeddedCitations).
  const cands = [first, ...(opts.strict ? [] : embeddedCitations(citation))].filter((c): c is { path: string; a?: number; b?: number } => Boolean(c));
  for (const c of cands) {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(idx.paths, k);
    // also the repo-relative form of a workspace-relative cite (`ky/.npmrc` when the index learned `.npmrc`)
    const key = has(c.path) ? c.path : idx.repos.map((r) => (c.path.startsWith(r.dir + '/') ? c.path.slice(r.dir.length + 1) : '')).find((k) => k && has(k));
    const hit = key ? idx.paths[key] : undefined;
    if (!hit) continue;
    const repo = idx.repos[hit[0]];
    if (!repo || (opts.publicOnly && !repo.public)) return null;
    const enc = hit[1].split('/').map(encodeURIComponent).join('/');
    const frag = c.a ? `#L${c.a}${c.b ? `-L${c.b}` : ''}` : '';
    return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/blob/${repo.sha}/${enc}${frag}`;
  }
  return null;
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** `<code>` spans naming an indexed path → wrapped in a permalink. Protected regions untouched. */
export function linkifyCodeSpans(html: string, idx: LinkIndex, opts: { publicOnly?: boolean } = {}): string {
  return String(html ?? '').split(PROTECTED).map((seg, i) => (i % 2 ? seg : seg.replace(CODE_SPAN, (whole, _a: string, inner: string) => {
    const href = permalinkFor(idx, decode(inner), { publicOnly: opts.publicOnly, strict: true });
    return href ? `<a href="${attr(href)}" target="_blank" rel="noopener noreferrer" class="accel-ev-link">${whole}</a>` : whole;
  }))).join('');
}

/** The engineering report's embedded evidence rows gain `href` (rendered by its runtime's evref). */
export function linkifyAccelData(html: string, idx: LinkIndex, opts: { publicOnly?: boolean } = {}): string {
  return String(html ?? '').replace(/(<script>window\.__ACCEL_DATA__ = )(\{[\s\S]*?\})(;<\/script>)/, (whole, pre: string, json: string, post: string) => {
    let d: { findings?: { evidence?: { ref?: string; href?: string }[] }[] };
    try { d = JSON.parse(json); } catch { return whole; }
    let changed = false;
    for (const f of d.findings ?? []) for (const e of f.evidence ?? []) {
      const href = permalinkFor(idx, String(e.ref ?? ''), { publicOnly: opts.publicOnly });
      if (href) { e.href = href; changed = true; } else if ('href' in e) { delete e.href; changed = true; }
    }
    return changed ? `${pre}${JSON.stringify(d).replace(/</g, '\\u003c')}${post}` : whole;
  });
}

/**
 * The serve-time pass (both halves + the marker). No index, or a document already marked, is returned unchanged.
 * The marker goes right after <head> (never before the doctype — that would flip the page into quirks mode).
 */
export function linkifyReport(html: string, idx: LinkIndex | null | undefined, opts: { publicOnly?: boolean } = {}): string {
  const src = String(html ?? '');
  if (!idx || !Object.keys(idx.paths).length || src.includes(LINKS_MARK)) return src;
  const out = linkifyAccelData(linkifyCodeSpans(src, idx, opts), idx, opts);
  const head = /<head\b[^>]*>/i.exec(out);
  const mark = LINKS_MARK + LINK_CLICK_JS;
  return head ? out.slice(0, head.index + head[0].length) + mark + out.slice(head.index + head[0].length) : out + mark;
}

// Why a click handler at all: every report is served under `sandbox allow-scripts allow-downloads` (REPORT_CSP) with
// NO `allow-popups` — deliberately, since a popup is an exfiltration channel for a prompt-injected report script — so a
// plain click on a `target="_blank"` link is blocked. Inside the console iframe the report therefore ASKS its parent to
// open the permalink (`{type:'accel-open-link', href}`); the console validates the sender frame, the URL shape and the
// run's own repos before opening it (serverUi `accelOpenLinkAllowed`). Top-level (`/share`) there is no parent, and a
// sandboxed document may still navigate ITSELF, so the link opens in the same tab. Right-click / copy link still work.
export const LINK_CLICK_JS = '<script>document.addEventListener("click",function(e){var t=e.target,a=t&&t.closest?t.closest("a.accel-ev-link"):null;'
  + 'if(!a)return;var h=a.getAttribute("href")||"";if(!/^https:\\/\\/github\\.com\\//.test(h)||/%2e|\\/\\.{1,2}(\\/|$|#)|\\\\/i.test(h))return;e.preventDefault();'
  + 'if(window.parent&&window.parent!==window){window.parent.postMessage({type:"accel-open-link",href:h},"*");}else{location.href=h;}},true);</script>';

/** Parse a stored sidecar, fail-closed on any shape problem (null ⇒ no links). */
export function parseLinkIndex(text: string): LinkIndex | null {
  try {
    const d = JSON.parse(text) as LinkIndex;
    if (d?.v !== 1 || !Array.isArray(d.repos) || !d.paths || typeof d.paths !== 'object') return null;
    return d;
  } catch { return null; }
}

// Serve-time reads are per report view; the sidecar is written once at run end, so a small cache of parsed indexes
// is safe. A miss (not yet written — e.g. the run is still going) is NOT cached.
const cache = new Map<string, LinkIndex>();
export function loadLinkIndexFile(path: string): LinkIndex | null {
  const hit = cache.get(path);
  if (hit) return hit;
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const idx = parseLinkIndex(text);
  if (idx) { cache.set(path, idx); if (cache.size > 32) cache.delete(cache.keys().next().value as string); }
  return idx;
}

/** Write the sidecar (fail-open — a run never fails over its links; the reports then simply carry none). */
export function saveLinkIndexFile(path: string, idx: LinkIndex): void {
  try { writeFileSync(path, JSON.stringify(idx)); cache.delete(path); } catch { /* best-effort */ }
}
