// findingKey.ts — a finding identity that is STABLE ACROSS RUNS.
//
// WHY. Finding ids (findingIds.ts F-01…, deep.ts `<BUNDLE>:<hyp>`, research `I3-01`) are per-run display / positional
// ids: the same defect gets a different id every scan, so "fixed / new / still open since last scan" cannot be computed
// from them. The durable key is
//
//   findingKey = hash(bundleId, invariantId, normalizedTitleStem, primaryEvidencePath, snippetHash)
//
// where snippetHash hashes the NORMALIZED TEXT of the cited lines (whitespace-collapsed), never the line numbers: code
// that MOVES keeps its key (a fresh agent cites the new line numbers, which hold the same text), code that is EDITED
// changes it. When the cited file/lines cannot be read (no workspace, a deleted file, a non-file evidence kind, a cite
// without a line), the snippet part is empty and the key rests on the path alone.
//
// LLM titles paraphrase between runs ("SSH allow-list is a regex" / "SSH allowlist uses a regex"), so the diff in
// sinceLastScan.ts also uses the two COARSER keys below: `evidenceKey` (title-free when a snippet was read: same bundle + invariant + evidence
// text ⇒ the same defect re-worded) and `looseKey` (evidence-free: same bundle + invariant + title stem ⇒ the same
// defect whose evidence changed). PURE apart from the optional workspace read; no LLM, no network.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { findingArea } from './findingIds.ts';
import { EXPERT_BUNDLES } from './research/experts.ts';
import type { Finding } from './schema.ts';

export interface FindingKeys {
  key: string;          // the full identity (title + evidence)
  evidenceKey: string;  // title-free: bundle + invariant + primary path + snippet
  looseKey: string;     // evidence-free: bundle + invariant + title stem
  bundleId: string;
  path?: string;        // workspace-relative primary evidence path (posix), when there is one
  snippetHash?: string; // hash of the cited lines' normalized text, when they could be read
}

const h = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

// Words that carry no identity ("the", "is", "a" …). Numbers are dropped too: an LLM title restates a measured value
// ("37% of rows" → "41% of rows") that moves between runs while the defect does not.
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'be', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with', 'by', 'at', 'as', 'from', 'that', 'this', 'it', 'its', 'not', 'no', 'uses', 'use', 'using', 'can', 'may', 'will']);

/** The title's identity-bearing words, in order: lowercased, "Ruled out:" dropped, punctuation / numbers / stopwords removed. */
export function titleWords(title: string | undefined): string[] {
  const t = String(title ?? '').toLowerCase().replace(/^\s*ruled out:\s*/, '')
    .replace(/[-_/]/g, '')                       // "allow-list" = "allowlist", "key_value" = "keyvalue"
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');   // CJK letters (written as escapes) count as words too
  return t.split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
}
/** The title reduced to its identity-bearing words (titleWords), first 8 words. */
export function normalizedTitleStem(title: string | undefined): string {
  return titleWords(title).slice(0, 8).join(' ');
}

/** The bundle that owns a finding: its id prefix / owning invariant (findingArea), else its source. */
const BUNDLE_IDS = new Set(EXPERT_BUNDLES.map((b) => b.id));
export function findingBundleId(f: Pick<Finding, 'id' | 'invariant' | 'source'>): string {
  const id = String(f.id ?? '');
  const colon = id.indexOf(':');
  // `<BUNDLE>:<hyp>` for every registered bundle — including recsys-mle, which findingArea's display map does not carry.
  if (colon > 0 && BUNDLE_IDS.has(id.slice(0, colon).toLowerCase())) return id.slice(0, colon).toLowerCase();
  return findingArea({ id, invariant: f.invariant })?.key ?? String(f.source ?? '').toLowerCase();
}

/** Parse a file ref into path + an inclusive line range. Shapes: a/b.ts, a/b.ts:42, a/b.ts:42-60, a/b.ts:42:7, a/b.ts#L42-L60 (+ trailing prose). */
export function parseCitedRange(ref: string): { path: string; start?: number; end?: number } {
  const head = String(ref ?? '').trim().split(/[\s,;]+/)[0] ?? '';
  const m = /^(.*?)(?:#L(\d+)(?:-L?(\d+))?|:(\d+)(?:[-–](\d+)|:\d+)?)?$/.exec(head);
  const path = (m?.[1] ?? head).replace(/^\.\//, '').replace(/\\/g, '/');
  const start = Number(m?.[2] ?? m?.[4]);
  const endRaw = Number(m?.[3] ?? m?.[5]);
  if (!(Number.isFinite(start) && start > 0)) return { path };
  const end = Number.isFinite(endRaw) && endRaw >= start ? Math.min(endRaw, start + 400) : start;
  return { path, start, end };
}

/** The primary evidence pointer: the first `file` ref, else the first ref of any kind (a metric / query id). */
export function primaryEvidence(f: Pick<Finding, 'evidence'>): { kind: string; ref: string } | undefined {
  const ev = Array.isArray(f.evidence) ? f.evidence : [];
  const file = ev.find((e) => e && e.kind === 'file' && String(e.ref ?? '').trim());
  const any = file ?? ev.find((e) => e && String(e.ref ?? '').trim());
  return any ? { kind: String(any.kind), ref: String(any.ref).trim() } : undefined;
}

/** Normalize cited text: every whitespace run → one space, trimmed. Moving / re-indenting code keeps the hash. */
export function normalizeSnippet(text: string): string { return String(text ?? '').replace(/\s+/g, ' ').trim(); }

/** The file a workspace cite points at — workspace-relative first, else `<repoDir>/<path>` for one repo dir (sorted, deterministic). */
export function resolveCitedPath(root: string, path: string): string | undefined {
  if (!path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /[*?[\]{}]/.test(path)) return undefined;
  const absRoot = resolve(root);
  const inside = (p: string): boolean => { const r = relative(absRoot, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
  const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };
  const rel = (p: string): string => relative(absRoot, p).replace(/\\/g, '/');
  if (isAbsolute(path)) { const p = resolve(path); return inside(p) && isFile(p) ? rel(p) : undefined; }
  const direct = resolve(absRoot, path);
  if (!inside(direct)) return undefined;
  if (isFile(direct)) return rel(direct);
  let dirs: string[] = [];
  try { dirs = readdirSync(absRoot).filter((n) => { try { return statSync(join(absRoot, n)).isDirectory(); } catch { return false; } }).sort(); } catch { /* unreadable */ }
  for (const d of dirs) { const c = resolve(absRoot, d, path); if (inside(c) && isFile(c)) return rel(c); }
  return undefined;
}

/** Hash of the cited lines' normalized text, or undefined when the lines cannot be read. `readText` overrides the disk read (tests, `git show`). */
export function snippetHashFor(text: string | undefined, start?: number, end?: number): string | undefined {
  if (text == null || !start) return undefined;
  if (text.length > 8 * 1024 * 1024) return undefined;
  const lines = text.split('\n');
  if (start > lines.length) return undefined;
  const snip = normalizeSnippet(lines.slice(start - 1, Math.min(end ?? start, lines.length)).join('\n'));
  return snip ? createHash('sha256').update(snip).digest('hex').slice(0, 12) : undefined;
}

export interface FindingKeyOpts {
  root?: string;                                     // the run's workspace (resolves + reads the cited file)
  readText?: (path: string) => string | undefined;   // alternative reader keyed by the normalized path (e.g. `git show <sha>:<path>`)
}

/** The three keys of one finding. */
export function findingKeys(f: Pick<Finding, 'id' | 'title' | 'invariant' | 'source' | 'evidence'>, opts: FindingKeyOpts = {}): FindingKeys {
  const bundleId = findingBundleId(f);
  const invariantId = String(f.invariant ?? '').toLowerCase();
  const stem = normalizedTitleStem(f.title);
  const pe = primaryEvidence(f);
  let path: string | undefined;
  let snippetHash: string | undefined;
  if (pe) {
    if (pe.kind === 'file') {
      const c = parseCitedRange(pe.ref);
      const resolved = opts.root ? resolveCitedPath(opts.root, c.path) : undefined;
      path = resolved ?? c.path.replace(/^\/+/, '');
      if (c.start) {
        let text: string | undefined;
        try { text = opts.readText ? opts.readText(path) : (opts.root && resolved ? readFileSync(join(opts.root, resolved), 'utf8') : undefined); } catch { text = undefined; }
        snippetHash = snippetHashFor(text, c.start, c.end);
      }
    } else {
      path = `${pe.kind}:${pe.ref.replace(/\s+/g, ' ').slice(0, 200)}`;
    }
  }
  return {
    key: h([bundleId, invariantId, stem, path ?? '', snippetHash ?? '']),
    // Title-free ONLY when there is cited text to stand in for the title: without a snippet, every finding
    // of one bundle + invariant citing the same file (or no file at all) would share one evidenceKey, so the title stem
    // joins it — a path-only / evidence-free finding then needs its title to match, like `key`.
    evidenceKey: h(['ev', bundleId, invariantId, path ?? '', snippetHash ?? '', ...(snippetHash ? [] : [stem])]),
    looseKey: h(['loose', bundleId, invariantId, stem]),
    bundleId,
    ...(path ? { path } : {}),
    ...(snippetHash ? { snippetHash } : {}),
  };
}

/** Just the full key. */
export function findingKey(f: Pick<Finding, 'id' | 'title' | 'invariant' | 'source' | 'evidence'>, opts: FindingKeyOpts = {}): string {
  return findingKeys(f, opts).key;
}

/** Every workspace-relative file path a finding cites (for carry-forward: "are all its evidence files unchanged?"). */
export function evidenceFilePaths(f: Pick<Finding, 'evidence'>, root?: string): string[] {
  const out = new Set<string>();
  for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
    if (!e || e.kind !== 'file') continue;
    const c = parseCitedRange(String(e.ref ?? ''));
    if (!c.path) continue;
    out.add((root ? resolveCitedPath(root, c.path) : undefined) ?? c.path.replace(/^\/+/, ''));
  }
  return [...out];
}

// ── Inputs of a MEASUREMENT (incremental re-scan, 2026-09-29 E2E) ────────────────────────────────────────────────────
// A code-native lane's measurement finding carries NO `file` evidence row: its evidence is a `metric` / `computation`
// ref such as `probe:glob+read(.npmrc,main.yml,package.json,.gitignore)` or `code:grep uses: in .github/workflows/**`,
// so evidenceFilePaths() is empty and carry-forward had no way to tell whether what it measured changed — every such
// finding went to a re-check. The FILES IT READ are, however, named in the ref / detail text. These are the tokens that
// look like a file name, a path or a glob (dotfiles, `name.ext`, `a/b/c`, `dir/**`, `*.{yml,yaml}`); the caller resolves
// them against the workspace's file list and the diff (carryForward.ts measurementInputState). A token that resolves to
// nothing is simply ignored — over-extraction is harmless, only resolvable tokens decide.
const PATHISH = /^(?:\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+|\.[A-Za-z0-9_-]{2,})$/;
/**
 * File names / paths / globs mentioned in a finding's NON-file evidence refs + details (deduped, ≤ 30, original case).
 * A bare DIRECTORY token (`umami/src`, `src/lib/` — a path whose last segment names no file) is kept only when the SAME
 * evidence row names no specific file (2026-10-01 E2E): `code-reconciliation:umami/src (auth.ts, jwt.ts, permissions/*.ts)`
 * measured those files, and the `umami/src` prefix used to match every unrelated changed file under src/ ("its cited code
 * changed" → a needless re-check). A row that names only a directory keeps it (a prefix matcher downstream).
 */
export function evidenceInputTokens(f: Pick<Finding, 'evidence'>): string[] {
  const out = new Set<string>();
  for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
    if (!e || e.kind === 'file') continue;
    const text = `${String(e.ref ?? '')} ${String(e.detail ?? '')}`.slice(0, 2000);
    const row = new Set<string>(); const dirs = new Set<string>();
    // Scan: path characters, plus `{a,b}` brace groups (the comma inside a brace does not end the token).
    let cur = ''; let brace = 0;
    const flush = (): void => { if (cur) addToken(cur, row, dirs); cur = ''; brace = 0; };
    for (const ch of text) {
      if (/[A-Za-z0-9_.\-/*?]/.test(ch)) cur += ch;
      else if (ch === '{') { brace++; cur += ch; }
      else if (ch === '}' && brace > 0) { brace--; cur += ch; }
      else if (ch === ',' && brace > 0) cur += ch;
      else flush();
    }
    flush();
    const isDir = (t: string): boolean => dirs.has(t) || isDirectoryToken(t);
    const specific = [...row].some((t) => !isDir(t));
    for (const t of row) if (!specific || !isDir(t)) out.add(t);
  }
  return [...out].slice(0, 30);
}
// Extension-less names that are files, not directories (a path ending in one of these is a specific file).
const EXTLESS_FILES = /^(?:Makefile|Dockerfile|Jenkinsfile|Gemfile|Rakefile|Procfile|Vagrantfile|Brewfile|Podfile|Cartfile|Pipfile|LICENSE|NOTICE|README|CODEOWNERS|OWNERS|BUILD|WORKSPACE|Caddyfile|Justfile|Taskfile)$/i;
/** A path token that names a directory, not a file: it has a `/`, no glob, and its last segment has no extension. */
export function isDirectoryToken(t: string): boolean {
  if (/[*?{]/.test(t) || !t.includes('/')) return false;
  const last = t.replace(/\/+$/, '').split('/').pop() ?? '';
  return !!last && !/\.[A-Za-z0-9_-]+$/.test(last) && !EXTLESS_FILES.test(last);
}
// `dirs`: tokens written with a trailing `/` (`umami/`, `src/lib/`) — directories even when one segment long.
function addToken(raw: string, out: Set<string>, dirs?: Set<string>): void {
  let t = raw.replace(/^\.\//, '').replace(/[.,]+$/, '');
  if (!t || t.startsWith('//') || t.length > 200) return;
  if (/^[\d.]+$/.test(t)) return;                                         // a version / a number, not a file
  const glob = /[*?{]/.test(t);
  if (glob) { if (/[/.]/.test(t) && /[A-Za-z]/.test(t)) out.add(t); return; }
  if (t.includes('/')) {
    const slash = /\/$/.test(t);
    t = t.replace(/\/+$/, '');
    const last = t.split('/').pop() ?? '';
    if (last && /[A-Za-z]/.test(last) && !t.startsWith('/')) { out.add(t); if (slash) dirs?.add(t); }
    return;
  }
  if (PATHISH.test(t) && /[A-Za-z]/.test(t.split('.').pop() ?? '') && !/^(?:e\.g|i\.e|etc|vs)$/i.test(t)) out.add(t);
}
