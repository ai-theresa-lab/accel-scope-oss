// incremental.ts — the INCREMENTAL RE-SCAN planner.
//
// After the workspace is cloned, executeOrgRun asks this module what an earlier completed scan of the SAME target set in
// the SAME org (the baseline, scanLineage.ts) lets this run reuse. The answer is one of three modes:
//
//   • unchanged   — every repo at the baseline's SHA, same inputs, same planes, same registry → replay the baseline's
//                   cuts up to `findings` at $0 through the existing resume machinery; only the reports are re-rendered.
//   • incremental — some repos changed: Comprehend is reused when every repo is Unchanged / Small and its inputs are
//                   equal; each bundle lane is reused when nothing it READ (readSet.ts) changed and strict compat holds;
//                   everything else re-runs live. Reused lanes replay through the same `reuseBundles` revival path.
//   • full        — no baseline, a forced / requested full scan, an Unknown repo (base SHA missing — force-push, a local
//                   folder that changed), or nothing reusable. Always with a stated reason.
//
// STRICT COMPAT (§6) for AUTOMATIC reuse — any mismatch drops to the next coarser level with a logged reason
// (`reuse: lane data-eng not reused — invariant registry changed`): equal checkpoint stage versions (baseline selection),
// equal bundle / invariant registry hashes, equal measure-plane fingerprints, equal inputs fingerprint (brief + memory
// recall + codeintel choice). Manual resume (POST resumeFrom) keeps its own lenient rules and never comes through here.
// PURE apart from read-only `git` subprocesses against the run's own clone (diff / show / ls-tree / cat-file). Every
// failure falls back to a full scan with a reason — the planner can never break a run.
import { execFileSync } from 'node:child_process';
import type { ReadSetSnapshot } from '../research/readSet.ts';
import type { LineageEntry } from '../scanLineage.ts';
import type { CoverageGap } from '../schema.ts';

// ── settings (env-tunable) ──────────────────────────────────────────────────────────────────────────────────────────
// DELTA LANES: a lane whose read set changed in at most `deltaMaxFiles` files (THERESA_INCR_DELTA_MAX_FILES,
// default 20; 0 = off) is revived at $0 plus a delta critique over those files capped at `deltaMaxProblems` new problems
// (THERESA_INCR_DELTA_MAX_PROBLEMS, default 2) instead of fully re-running. Optional so older callers / tests keep compiling.
export interface IncrSettings { enabled: boolean; smallMaxFiles: number; forceFullEvery: number; forceFullDays: number; findingCarry: boolean; deltaMaxFiles?: number; deltaMaxProblems?: number }
export function incrSettings(env: NodeJS.ProcessEnv = process.env): IncrSettings {
  const int = (v: string | undefined, d: number): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    enabled: env.THERESA_INCR !== '0',
    smallMaxFiles: int(env.THERESA_INCR_SMALL_MAX_FILES, 200) || 200,
    forceFullEvery: int(env.THERESA_INCR_FORCE_FULL_EVERY, 4),
    forceFullDays: int(env.THERESA_INCR_FORCE_FULL_DAYS, 30),
    findingCarry: env.THERESA_INCR_FINDING_CARRY !== '0',
    deltaMaxFiles: int(env.THERESA_INCR_DELTA_MAX_FILES, 20),
    deltaMaxProblems: int(env.THERESA_INCR_DELTA_MAX_PROBLEMS, 2) || 2,
  };
}

// ── git (read-only, bounded) ─────────────────────────────────────────────────────────────────────────────────────────
export interface ChangedFile { status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X'; path: string; oldPath?: string }
function git(dir: string, args: string[], timeout = 30_000): string {
  return execFileSync('git', ['-C', dir, '-c', 'core.quotepath=off', ...args], { timeout, maxBuffer: 64 * 1024 * 1024 }).toString();
}
/** Does the clone have `sha` as a commit? (false after a force-push / history rewrite). */
export function gitHasCommit(dir: string, sha: string): boolean {
  try { git(dir, ['cat-file', '-e', `${sha}^{commit}`], 10_000); return true; } catch { return false; }
}
/** Parse `git diff --name-status -M` output. */
export function parseNameStatus(out: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = (parts[0] ?? '').charAt(0) as ChangedFile['status'];
    if ((code === 'R' || code === 'C') && parts.length >= 3) files.push({ status: code, oldPath: parts[1], path: parts[2] });
    else if (parts.length >= 2) files.push({ status: (['A', 'M', 'D', 'T', 'U', 'X'].includes(code) ? code : 'M') as ChangedFile['status'], path: parts[1] });
  }
  return files;
}
export function gitChangedFiles(dir: string, baseSha: string, headSha: string): { ok: true; files: ChangedFile[] } | { ok: false; reason: string } {
  if (!gitHasCommit(dir, baseSha)) return { ok: false, reason: `base SHA ${baseSha.slice(0, 10)} is not in the clone (force-push or history rewrite)` };
  try { return { ok: true, files: parseNameStatus(git(dir, ['diff', '--name-status', '-M', '--no-color', baseSha, headSha])) }; }
  catch (e) { return { ok: false, reason: `git diff failed (${e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e)})` }; }
}
/** Top-level entries of a commit's tree (layout-change detection). */
export function gitTopLevel(dir: string, sha: string): string[] | null {
  try { return git(dir, ['ls-tree', '--name-only', sha], 10_000).split('\n').filter(Boolean); } catch { return null; }
}
/** The unified diff of one path between two commits (bounded), '' on failure — the targeted re-verify's context. */
export function gitDiffPath(dir: string, baseSha: string, headSha: string, path: string, max = 6000): string {
  try { return git(dir, ['diff', '--no-color', '-U3', baseSha, headSha, '--', path], 15_000).slice(0, max); } catch { return ''; }
}
/** The tracked files of a clone at HEAD (repo-relative, posix), [] on failure — measurement-input resolution (carryForward). */
export function gitListFiles(dir: string): string[] {
  // NUL-separated (-z): paths with spaces / non-ASCII names come back unquoted.
  try { return git(dir, ['ls-files', '-z'], 30_000).split(String.fromCharCode(0)).filter(Boolean); } catch { return []; }
}
/** A file's text at a commit (undefined when absent / binary-huge / unreadable). */
export function gitShow(dir: string, sha: string, path: string): string | undefined {
  try { const t = git(dir, ['show', `${sha}:${path}`], 15_000); return t.length > 4 * 1024 * 1024 ? undefined : t; } catch { return undefined; }
}

// ── change classification (§2) ──────────────────────────────────────────────────────────────────────────────────────
export type RepoClass = 'unchanged' | 'small' | 'structural' | 'unknown';
// A dependency manifest / lockfile, a schema or migration, CI, or build config: a change here can move what the whole
// system IS (new dependency, new table, new deploy path), so Comprehend re-runs even for a small diff.
const STRUCTURAL: { re: RegExp; what: string }[] = [
  { re: /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|Pipfile(\.lock)?|pyproject\.toml|poetry\.lock|uv\.lock|setup\.(py|cfg)|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.lockfile|[^/]+\.csproj|packages\.config|Package\.(swift|resolved)|Podfile(\.lock)?|pubspec\.(yaml|lock)|mix\.(exs|lock))$/i, what: 'dependency manifest' },
  { re: /(^|\/)(migrations?|alembic|flyway|liquibase|db\/migrate)\//i, what: 'migration' },
  { re: /(^|\/)(schema\.(sql|prisma|graphql|rb|ts|json)|[^/]+\.prisma|[^/]+\.graphqls?|structure\.sql)$/i, what: 'schema' },
  { re: /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/|Jenkinsfile$|azure-pipelines\.ya?ml$|\.buildkite\/|bitbucket-pipelines\.yml$|\.travis\.yml$|cloudbuild\.ya?ml$)/i, what: 'CI config' },
  { re: /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|Makefile|CMakeLists\.txt|BUILD(\.bazel)?|WORKSPACE(\.bazel)?|MODULE\.bazel|\.bazelrc|tsconfig[^/]*\.json|(webpack|vite|rollup|babel|esbuild|turbo|nx|next|nuxt|svelte|astro)\.config\.[cm]?[jt]s|turbo\.json|nx\.json|lerna\.json|app\.ya?ml|serverless\.ya?ml|terraform\/[^/]+\.tf|[^/]+\.tf)$/i, what: 'build config' },
];
// A MODIFIED package.json is a dependency-manifest change only when one of these fields moved (an end-to-end run: a
// one-line `scripts` edit re-ran Comprehend and turned every delta lane off). `version` / `scripts` / `description` /
// `keywords` / … are ordinary edits. Conservative extras beyond the dependency maps: the module `type`, the
// `packageManager` pin and pnpm's `pnpm` block (overrides / patches) also change what installs or how it builds.
export const PACKAGE_JSON_DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'engines', 'workspaces', 'overrides', 'resolutions', 'pnpm', 'packageManager', 'type'];
const sortedJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
/**
 * Did a package.json edit touch its dependency fields? true / false, or undefined when either side is missing or not a
 * JSON object (the caller then stays conservative: a dependency-manifest change).
 */
export function packageJsonDepsChanged(oldText: string | undefined, newText: string | undefined): boolean | undefined {
  if (oldText == null || newText == null) return undefined;
  let o: unknown, n: unknown;
  try { o = JSON.parse(oldText); n = JSON.parse(newText); } catch { return undefined; }
  if (!o || !n || typeof o !== 'object' || typeof n !== 'object' || Array.isArray(o) || Array.isArray(n)) return undefined;
  return PACKAGE_JSON_DEP_FIELDS.some((k) => sortedJson((o as Record<string, unknown>)[k]) !== sortedJson((n as Record<string, unknown>)[k]));
}
/** Is this a MODIFIED package.json (the only manifest whose content we judge — pyproject / Cargo stay conservative)? */
export function judgeablePackageJson(f: ChangedFile): boolean { return f.status === 'M' && !f.oldPath && /(^|\/)package\.json$/i.test(f.path); }
// `depsChanged` (optional): for a judgeable package.json, whether its dependency fields changed (undefined = unknown ⇒
// conservative). A package.json whose deps did not change is an ordinary changed file (it still counts for read sets).
export interface ClassifyOpts { depsChanged?: (f: ChangedFile) => boolean | undefined }
export function structuralReason(files: ChangedFile[], o: ClassifyOpts = {}): string | undefined {
  for (const f of files) for (const p of [f.path, f.oldPath].filter(Boolean) as string[]) {
    const hit = STRUCTURAL.find((s) => s.re.test(p));
    if (hit && hit.what === 'dependency manifest' && judgeablePackageJson(f) && o.depsChanged?.(f) === false) continue;
    if (hit) return `${hit.what} changed (${p})`;
  }
  return undefined;
}
export function classifyRepo(files: ChangedFile[], s: Pick<IncrSettings, 'smallMaxFiles'>, topLevel?: { before: string[] | null; after: string[] | null }, o: ClassifyOpts = {}): { cls: RepoClass; reason: string } {
  if (!files.length) return { cls: 'unchanged', reason: 'no file changes' };
  if (files.length > s.smallMaxFiles) return { cls: 'structural', reason: `${files.length} files changed (> ${s.smallMaxFiles})` };
  const st = structuralReason(files, o);
  if (st) return { cls: 'structural', reason: st };
  if (topLevel?.before && topLevel.after) {
    const b = new Set(topLevel.before), a = new Set(topLevel.after);
    const added = [...a].filter((x) => !b.has(x)), removed = [...b].filter((x) => !a.has(x));
    if (added.length || removed.length) return { cls: 'structural', reason: `top-level layout changed (${[...added.map((x) => '+' + x), ...removed.map((x) => '-' + x)].slice(0, 4).join(' ')})` };
  }
  const pj = files.filter((f) => judgeablePackageJson(f) && o.depsChanged?.(f) === false).length;
  return { cls: 'small', reason: `${files.length} file(s) changed${pj ? ` (package.json: no dependency field changed)` : ''}` };
}

// ── glob / grep matching (read-set reuse rule, §3) ───────────────────────────────────────────────────────────────────
/** A glob → RegExp over repo-normalized posix paths. `**` spans directories, `*`/`?` do not, `{a,b}` alternates. A glob
 *  with no `/` (ripgrep --glob semantics) matches the basename at any depth. */
export function globToRegExp(glob: string): RegExp {
  const g = String(glob ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  const anyDepth = !g.includes('/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const j = g.indexOf('}', i); if (j > i) { re += '(?:' + g.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = j; } else re += '\\{'; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(anyDepth ? `(?:^|/)${re}$` : `^${re}$`);
}
/** A glob this translator does not model faithfully (character classes, negation, nested braces). */
export function globUnsupported(glob: string): boolean { return /[[\]]|^!|\{[^}]*\{/.test(String(glob ?? '')); }
/**
 * Does `glob` match any of `cands`? An agent's glob is relative to WHATEVER it searched from, and a slash
 * glob is anchored, so the caller passes every form of the changed path (the full `owner/name/<rel>`, the repo-relative
 * `<rel>`, the path relative to the probe's scope). A glob that cannot be evaluated counts as MATCHING (conservative:
 * the lane re-runs rather than being reused on a guess).
 */
export function globMatchesAny(glob: string, cands: string[]): boolean {
  if (globUnsupported(glob)) return true;
  let re: RegExp;
  try { re = globToRegExp(glob); } catch { return true; }
  return cands.some((p) => re.test(p));
}
/** The forms of a repo-normalized changed path a glob may be written against: full, repo-relative, scope-relative. */
function pathForms(c: { repo: string; path: string; oldPath?: string }, scope?: string): string[] {
  const out = new Set<string>();
  const sc = scope && scope !== '.' ? scope.replace(/\/+$/, '') : '';
  for (const rel of [c.path, ...(c.oldPath ? [c.oldPath] : [])]) {
    const full = `${c.repo}/${rel}`;
    out.add(full); out.add(rel);
    if (sc && full.startsWith(sc + '/')) out.add(full.slice(sc.length + 1));
  }
  return [...out];
}
// ripgrep --type → extensions (the common ones agents use). An unknown type matches every file (conservative).
const RG_TYPES: Record<string, string[]> = {
  ts: ['ts', 'tsx', 'mts', 'cts'], js: ['js', 'jsx', 'mjs', 'cjs'], py: ['py', 'pyi'], go: ['go'], rust: ['rs'], java: ['java'], kotlin: ['kt', 'kts'],
  swift: ['swift'], ruby: ['rb'], php: ['php'], cs: ['cs'], cpp: ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'h'], c: ['c', 'h'], sql: ['sql'], json: ['json'],
  yaml: ['yml', 'yaml'], toml: ['toml'], md: ['md', 'markdown'], html: ['html', 'htm'], css: ['css', 'scss', 'sass', 'less'], sh: ['sh', 'bash', 'zsh'],
  scala: ['scala'], dart: ['dart'], vue: ['vue'], svelte: ['svelte'], proto: ['proto'], tf: ['tf'], xml: ['xml'],
};
function typeMatches(type: string | undefined, path: string): boolean {
  if (!type) return true;
  const exts = RG_TYPES[type.toLowerCase()];
  if (!exts) return true;
  const ext = (path.split('/').pop() ?? '').split('.').pop()?.toLowerCase() ?? '';
  return exts.includes(ext);
}
function underPath(scope: string, path: string): boolean { return scope === '.' || scope === '' || path === scope || path.startsWith(scope.replace(/\/+$/, '') + '/'); }
/**
 * A Grep / repo_grep probe → a JS RegExp over a WHOLE file's text. ripgrep is line-oriented, so `^` / `$`
 * anchor at every line: the `m` flag is always on. A leading inline-flag group (`(?i)`, `(?is)` …, Rust regex syntax
 * JS does not parse) is translated to JS flags; a flag JS has no equivalent for (`x`, `U`) makes the probe
 * uncompilable. null = cannot compile ⇒ the caller treats it as MATCHING (conservative).
 */
export function compileProbe(pattern: string, ci?: boolean): RegExp | null {
  let p = String(pattern ?? '');
  const flags = new Set(['m', ...(ci ? ['i'] : [])]);
  const inl = /^\(\?([a-zA-Z]+)\)/.exec(p);
  if (inl) {
    for (const f of inl[1]) { if (f === 'i' || f === 's') flags.add(f); else if (f === 'm') { /* always on */ } else return null; }
    p = p.slice(inl[0].length);
  }
  try { return new RegExp(p, [...flags].join('')); } catch { return null; }
}

/** One changed file, repo-normalized (`owner/name/<path>`), with accessors for its old / new text. */
export interface RepoChange extends ChangedFile { repo: string; newText: () => string | undefined; oldText: () => string | undefined }

export interface LaneGapLike { id?: string; status?: string; source?: string }
export interface LaneSnapLike extends Partial<ReadSetSnapshot> { bundleId: string; measuredAt?: string; spentUsd?: number; gaps?: LaneGapLike[] }
/**
 * Why a lane's output is NOT a completed check of its concerns, or undefined when it is: the lane failed
 * (a `node_failed` gap — its read set is empty because it never ran, not because it read nothing), the run-budget
 * envelope / the per-bundle slice skipped its critique / preflight / measurement (`budget_skipped`, except the plan
 * lint's deterministic per-bundle-cap overflow, source `preflight:lint`), or Preflight produced no plan (`-PLAN-EMPTY`).
 * Such a lane is never REUSED by a re-scan, and it does not count as having re-checked its bundle's baseline findings
 * (they read "not re-checked", never "fixed").
 */
export function laneIncompleteReason(gaps: LaneGapLike[] | undefined): string | undefined {
  for (const g of gaps ?? []) {
    if (g.status === 'node_failed') return 'it failed in that run';
    if (g.status === 'budget_skipped' && g.source !== 'preflight:lint') return 'it was cut short by the budget in that run';
    if (/-PLAN-EMPTY$/i.test(String(g.id ?? ''))) return 'Preflight produced no measurable plan for it in that run';
  }
  return undefined;
}
/**
 * The hypotheses a LIVE lane's Expert left `open` — never measured because the run budget stopped the measure loop
 * (deepAudit breaks on the per-lane budget or the 0.80·B envelope: "leaving <id> open (global envelope)", and leaves
 * them `open`, the only way a planned hypothesis stays `open` past the loop). an end-to-end run: such a lane carried no
 * budget_skipped gap, so the next scan replayed it as a COMPLETE check. Each one becomes a `budget_skipped` gap
 * (source `expert:budget` — laneIncompleteReason then calls the lane incomplete: never reused, its bundle not counted as
 * re-checked) and leaves the hypothesis list (its deepAudit gap would have said "not computable from the data", which
 * is not why it is open). Measured / blocked-need-eval / disposed hypotheses are untouched.
 */
export function budgetLeftOpen<H extends { id: string; status?: string; measurement?: unknown; claim?: string; decisiveMetric?: string }>(bundleId: string, hyps: H[]): { keep: H[]; gaps: CoverageGap[] } {
  const keep: H[] = [], gaps: CoverageGap[] = [];
  for (const h of hyps) {
    if (h.status !== 'open' || h.measurement) { keep.push(h); continue; }
    gaps.push({ id: String(h.id).toUpperCase(), concern: String(h.claim ?? h.id).slice(0, 300), whyUnsettled: 'the run budget ran out before this hypothesis could be measured (the lane is not a completed check)', nextDecisiveTest: h.decisiveMetric ? `Measure: ${h.decisiveMetric}` : 'Re-run this bundle with budget headroom.', source: 'expert:budget', status: 'budget_skipped', bundleId, hypothesisId: h.id });
  }
  return { keep, gaps };
}
/**
 * The read-set rule: may this lane be reused given these changes? Reason is always set (a log line either way).
 * `hits` (delta lanes): EVERY changed file the lane depends on — read, matched by one of its globs (added / deleted /
 * renamed), or matched by one of its grep probes (a probe that cannot be re-checked counts every in-scope change) —
 * repo-normalized (`owner/name/<path>`, the current name). `hits` is absent when the lane cannot be judged per file at all
 * (incomplete baseline output, no read set, opaque reads): such a lane is never a delta candidate.
 */
export function laneReadSetDecision(snap: LaneSnapLike, changes: RepoChange[]): { reuse: boolean; reason: string; hits?: string[] } {
  const incomplete = laneIncompleteReason(snap.gaps);
  if (incomplete) return { reuse: false, reason: `its baseline output is not a completed check — ${incomplete}` };
  if (!Array.isArray(snap.readSet)) return { reuse: false, reason: 'no read set recorded for it in the baseline (it predates read-set recording)' };
  if (!changes.length) return { reuse: true, reason: 'no file changed', hits: [] };
  if (snap.opaque?.length) return { reuse: false, reason: `it used reads that cannot be attributed to files (${snap.opaque.slice(0, 2).join(', ')}) and ${changes.length} file(s) changed` };
  const rs = new Set(snap.readSet);
  const hit = new Map<RepoChange, string>();            // change → the first reason it counts (insertion order = pass order)
  const pathsOf = (c: RepoChange): string[] => [`${c.repo}/${c.path}`, ...(c.oldPath ? [`${c.repo}/${c.oldPath}`] : [])];
  for (const c of changes) {
    const h = pathsOf(c).find((p) => rs.has(p));
    if (h) hit.set(c, `it read ${h}, which changed`);
  }
  for (const c of changes) {
    if (hit.has(c) || !['A', 'D', 'R', 'C'].includes(c.status)) continue;
    const paths = pathsOf(c);
    const g = (snap.globs ?? []).find((x) => globMatchesAny(x, pathForms(c)));
    if (g) hit.set(c, `a file matching its glob ${g} was ${c.status === 'A' ? 'added' : c.status === 'D' ? 'deleted' : 'renamed'} (${paths[paths.length - 1]})`);
  }
  for (const pr of snap.greps ?? []) {
    const re = compileProbe(pr.pattern, pr.ci);
    for (const c of changes) {
      if (hit.has(c)) continue;
      const paths = pathsOf(c);
      if (!paths.some((p) => underPath(pr.path, p) && typeMatches(pr.type, p))) continue;
      if (pr.glob && !globMatchesAny(pr.glob, pathForms(c, pr.path))) continue;
      if (!re) { hit.set(c, `its search /${pr.pattern.slice(0, 40)}/ cannot be re-checked and ${paths[0]} changed in its scope`); continue; }
      const texts = [c.status === 'D' ? undefined : c.newText(), c.status === 'A' ? undefined : c.oldText()];
      if (texts.some((t) => t != null && re.test(t))) hit.set(c, `its search /${pr.pattern.slice(0, 40)}/ matches ${paths[0]}, which changed`);
    }
  }
  const hits = [...hit.keys()].map((c) => `${c.repo}/${c.path}`);
  if (hit.size) return { reuse: false, reason: [...hit.values()][0], hits };
  return { reuse: true, reason: `none of the ${snap.readSet.length} file(s) it read changed`, hits: [] };
}
/** Lanes with no Critic (own intake / the invariant floor) cannot run a delta critique — they re-run whole or are reused. */
export function deltaEligibleLane(id: string): boolean { return id !== 'baseline' && id !== 'recsys-mle'; }

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type IncrMode = 'unchanged' | 'incremental' | 'full';
export interface RepoPlan { fullName: string; cls: RepoClass; files: number; reason: string; baseSha?: string; headSha?: string }
export interface IncrPlan {
  mode: IncrMode;
  reason: string;
  baselineRunId?: string;
  comprehend: 'reuse' | 'rerun';
  comprehendWhy: string;
  // `delta`: the lane is NOT reused whole but revived at $0 plus a delta critique over `files` (the
  // changed files it depends on, repo-normalized) — `readCount` = the size of its baseline read set.
  lanes: Record<string, { reuse: boolean; reason: string; measuredAt?: string; delta?: { files: string[]; readCount: number } }>;
  repos: RepoPlan[];
  changedFiles: number;
  forcedFull?: string;
}
export interface PlanInput {
  settings: IncrSettings;
  fullRescan: boolean;
  baseline: LineageEntry | null;
  baselineReason: string;
  now: Date;
  // Current run
  repos: { fullName: string; dir: string; sha?: string }[];                // the fresh workspace manifest
  localDirs: { path: string; name: string; files?: number; bytes?: number; hash?: string }[];
  planeFps: string[];
  inputsSig: string;
  briefHash: string;
  manualBundles: string[] | null;
  invariantIds: string[];
  registry: { registryHash: string; bundleHashes: Record<string, string>; invariantHash: string; codeHash?: string };
  codeintel: boolean;
  osv: boolean;
  // Baseline payloads
  baselineLanes: Record<string, LaneSnapLike>;                             // barrier (or frontier) lanes
  baselineComprehend?: { codeintel?: boolean; osv?: boolean; bundleIds?: string[] };
  baselineManualBundles?: string[] | null;
  // git over the fresh clone
  gitDiff: (repo: { fullName: string; dir: string }, baseSha: string, headSha: string) => { ok: true; files: ChangedFile[] } | { ok: false; reason: string };
  gitTop: (repo: { fullName: string; dir: string }, sha: string) => string[] | null;
  textAt: (repo: { fullName: string; dir: string }, sha: string | 'HEAD', path: string) => string | undefined;
}
const sameSet = (a: string[] | null | undefined, b: string[] | null | undefined): boolean => {
  const x = [...new Set(a ?? [])].sort(), y = [...new Set(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const full = (reason: string, extra: Partial<IncrPlan> = {}): IncrPlan => ({ mode: 'full', reason, comprehend: 'rerun', comprehendWhy: reason, lanes: {}, repos: [], changedFiles: 0, ...extra });

/** The decision for one run. Never throws: an unexpected error returns a full plan with the error as its reason. */
export function planIncremental(inp: PlanInput): { plan: IncrPlan; changes: RepoChange[] } {
  try { return planInner(inp); }
  catch (e) { return { plan: full(`incremental planning failed (${e instanceof Error ? e.message : String(e)}) — full scan`), changes: [] }; }
}

function planInner(inp: PlanInput): { plan: IncrPlan; changes: RepoChange[] } {
  const b = inp.baseline;
  if (!b) return { plan: full(`full scan — ${inp.baselineReason}`), changes: [] };
  const base = { baselineRunId: b.runId };
  if (!inp.settings.enabled) return { plan: full('full scan — incremental reuse disabled (THERESA_INCR=0)', base), changes: [] };
  if (inp.fullRescan) return { plan: full('full scan — Full rescan requested', base), changes: [] };
  // Periodic forced full scan (proposal Risks): a chain of incremental runs drifts from what a fresh look would find.
  if (inp.settings.forceFullEvery > 0 && b.depth >= inp.settings.forceFullEvery) {
    const why = `full scan — the baseline chain is ${b.depth} incremental run(s) deep (every ${inp.settings.forceFullEvery}th scan is a full one)`;
    return { plan: full(why, { ...base, forcedFull: why }), changes: [] };
  }
  const ageDays = (inp.now.getTime() - Date.parse(b.lastFullAt)) / 86_400_000;
  if (inp.settings.forceFullDays > 0 && Number.isFinite(ageDays) && ageDays > inp.settings.forceFullDays) {
    const why = `full scan — the last full scan of this target was ${Math.floor(ageDays)} days ago (> ${inp.settings.forceFullDays})`;
    return { plan: full(why, { ...base, forcedFull: why }), changes: [] };
  }
  // The workspace must hold exactly the baseline's repos (a skipped / unreachable repo changes the target).
  const curNames = inp.repos.map((r) => r.fullName.toLowerCase()), baseNames = b.repos.map((r) => r.fullName.toLowerCase());
  if (!sameSet(curNames, baseNames)) {
    const missing = baseNames.filter((n) => !curNames.includes(n)), extra = curNames.filter((n) => !baseNames.includes(n));
    return { plan: full(`full scan — the workspace repos differ from the baseline's (${[...missing.map((m) => '-' + m), ...extra.map((x) => '+' + x)].join(' ')})`, base), changes: [] };
  }
  // Nothing diffable: a GCP- / warehouse-only scan has no repo or folder whose change we can see, and
  // `[].every(unchanged)` would otherwise replay a stale baseline forever.
  if (!inp.repos.length && !inp.localDirs.length) return { plan: full('full scan — the target has no repo or local folder to diff against the baseline (GCP / data-plane-only scans always run fresh)', base), changes: [] };
  // Local folders: no history → only an unchanged CONTENT fingerprint is reusable (count + bytes alone miss a
  // same-size edit, so a baseline recorded without the content hash is not comparable).
  for (const d of inp.localDirs) {
    const bd = b.localDirs.find((x) => x.path === d.path);
    if (!bd || !bd.hash || !d.hash || bd.hash !== d.hash || bd.files !== d.files || bd.bytes !== d.bytes) return { plan: full(`full scan — local folder ${d.name} changed or has no content fingerprint (no git history to diff)`, base), changes: [] };
  }
  if (b.localDirs.length !== inp.localDirs.length) return { plan: full('full scan — the local folder set differs from the baseline', base), changes: [] };

  // ── per-repo classification ──
  const repos: RepoPlan[] = []; const changes: RepoChange[] = [];
  for (const r of inp.repos) {
    const br = b.repos.find((x) => x.fullName.toLowerCase() === r.fullName.toLowerCase())!;
    if (!br.sha || !r.sha) { repos.push({ fullName: r.fullName, cls: 'unknown', files: 0, reason: 'no pinned SHA' }); continue; }
    if (br.sha === r.sha) { repos.push({ fullName: r.fullName, cls: 'unchanged', files: 0, reason: 'same SHA', baseSha: br.sha, headSha: r.sha }); continue; }
    const d = inp.gitDiff(r, br.sha, r.sha);
    if (!d.ok) { repos.push({ fullName: r.fullName, cls: 'unknown', files: 0, reason: d.reason, baseSha: br.sha, headSha: r.sha }); continue; }
    const cls = classifyRepo(d.files, inp.settings, { before: inp.gitTop(r, br.sha), after: inp.gitTop(r, r.sha) },
      { depsChanged: (f) => packageJsonDepsChanged(inp.textAt(r, br.sha!, f.oldPath ?? f.path), inp.textAt(r, 'HEAD', f.path)) });
    repos.push({ fullName: r.fullName, cls: cls.cls, files: d.files.length, reason: cls.reason, baseSha: br.sha, headSha: r.sha });
    const repoKey = r.fullName.toLowerCase();
    for (const f of d.files) {
      const memo: { n?: string | null; o?: string | null } = {};
      changes.push({ ...f, repo: repoKey,
        newText: () => (memo.n !== undefined ? memo.n ?? undefined : ((memo.n = inp.textAt(r, 'HEAD', f.path) ?? null), memo.n ?? undefined)),
        oldText: () => (memo.o !== undefined ? memo.o ?? undefined : ((memo.o = inp.textAt(r, br.sha!, f.oldPath ?? f.path) ?? null), memo.o ?? undefined)) });
    }
  }
  const changedFiles = changes.length;
  const unknown = repos.find((r) => r.cls === 'unknown');
  if (unknown) return { plan: full(`full scan — ${unknown.fullName}: ${unknown.reason}`, { ...base, repos, changedFiles }), changes };

  // ── strict compat inputs (§6) ──
  const planesSame = sameSet(inp.planeFps, b.planeFps);
  const inputsSame = inp.inputsSig === b.inputsSig;
  const manualSame = sameSet(inp.manualBundles, inp.baselineManualBundles ?? null) && (inp.manualBundles == null) === (inp.baselineManualBundles == null);
  const invSame = sameSet(inp.invariantIds, b.invariantIds);
  const regSame = inp.registry.registryHash === b.registryHash;
  // The prompt-bearing modules' source + model env (scanLineage.codeRevisionHash). An older baseline without it
  // is not comparable once the running code records one.
  const codeSame = (inp.registry.codeHash ?? '') === (b.codeHash ?? '');
  const bc = inp.baselineComprehend ?? {};
  const codeintelSame = typeof bc.codeintel !== 'boolean' || bc.codeintel === inp.codeintel;
  const osvSame = typeof bc.osv !== 'boolean' || bc.osv === inp.osv;
  const allUnchanged = repos.every((r) => r.cls === 'unchanged');

  // A baseline lane that failed / was budget-cut is never replayed: with one, an all-unchanged target
  // takes the incremental path instead, where that lane re-runs and the rest are reused.
  const anyIncomplete = Object.values(inp.baselineLanes).some((l) => laneIncompleteReason(l.gaps));
  if (allUnchanged && !anyIncomplete && codeSame && planesSame && inputsSame && manualSame && invSame && regSame && codeintelSame && osvSame) {
    const lanes = Object.fromEntries(Object.values(inp.baselineLanes).map((l) => [l.bundleId, { reuse: true, reason: 'no file changed', ...(l.measuredAt ? { measuredAt: l.measuredAt } : {}) }]));
    return { plan: { ...base, mode: 'unchanged', reason: `no changes since ${b.finishedAt.slice(0, 10)} — reusing the baseline up to its findings; only the reports are re-rendered`, comprehend: 'reuse', comprehendWhy: 'no changes', lanes, repos, changedFiles: 0 }, changes };
  }

  // Comprehend: reused only on Unchanged / Small repos with equal inputs (a brief / bundle / plane change re-derives it).
  const bundleMembershipSame = sameSet(Object.keys(inp.registry.bundleHashes), Object.keys(b.bundleHashes ?? {}));
  const compWhy = !repos.every((r) => r.cls === 'unchanged' || r.cls === 'small') ? `structural change (${repos.filter((r) => r.cls === 'structural').map((r) => `${r.fullName}: ${r.reason}`).slice(0, 2).join('; ')})`
    : !codeSame ? 'the analysis prompts / code or the model changed since the baseline'
      : !inputsSame ? 'the brief / memory-recall / codeintel inputs changed'
      : !manualSame ? 'the bundle selection changed'
        : !planesSame ? 'the measure-plane set changed'
          : !bundleMembershipSame ? 'the bundle registry changed (a bundle was added or removed)'
            : !codeintelSame ? 'codeintel availability changed'
              : !osvSame ? 'OSV advisory-plane availability changed'
                : '';
  const comprehend: IncrPlan['comprehend'] = compWhy ? 'rerun' : 'reuse';

  // Lanes: compat first (coarse → fine), then the read-set rule.
  const lanes: IncrPlan['lanes'] = {};
  for (const l of Object.values(inp.baselineLanes)) {
    const id = l.bundleId;
    const why = !codeSame ? 'the analysis prompts / code or the model changed since the baseline'
      : !inputsSame ? 'the brief / memory-recall / codeintel inputs changed'
      : !planesSame ? 'the measure-plane set changed'
        : inp.registry.invariantHash !== b.invariantHash ? 'invariant registry changed'
          : !inp.registry.bundleHashes[id] ? 'bundle no longer registered'
            : inp.registry.bundleHashes[id] !== b.bundleHashes?.[id] ? 'bundle playbook changed'
              : (id === 'baseline' && !invSame) ? 'the invariant selection changed'
                : !codeintelSame ? 'codeintel availability changed'
                  : !osvSame ? 'OSV advisory-plane availability changed'
                    : '';
    if (why) { lanes[id] = { reuse: false, reason: why }; continue; }
    const d = laneReadSetDecision(l, changes);
    // DELTA LANE: the part of its read set that changed is small (≤ deltaMaxFiles), every repo those files live in is
    // Small (never Structural — Unknown already forced a full scan), strict compat held (above), carry-forward is on (the
    // delta needs its prior findings), and the lane has a Critic. Otherwise it re-runs whole, as before.
    const dmax = inp.settings.deltaMaxFiles ?? 20;
    const hitRepos = new Set((d.hits ?? []).map((h) => changes.find((c) => h === `${c.repo}/${c.path}`)?.repo));
    const structuralHit = repos.some((r) => hitRepos.has(r.fullName.toLowerCase()) && r.cls !== 'small' && r.cls !== 'unchanged');
    if (!d.reuse && d.hits && d.hits.length && d.hits.length <= dmax && inp.settings.findingCarry && deltaEligibleLane(id) && !structuralHit) {
      const n = Array.isArray(l.readSet) ? l.readSet.length : 0;
      lanes[id] = { reuse: false, reason: `${d.hits.length} of ${n} read file(s) changed (${d.hits.slice(0, 3).join(', ')}${d.hits.length > 3 ? ', …' : ''})`, delta: { files: d.hits, readCount: n } };
      continue;
    }
    lanes[id] = { reuse: d.reuse, reason: d.hits && d.hits.length > dmax && dmax > 0 && !d.reuse ? `${d.reason} — ${d.hits.length} of its read file(s) changed (> ${dmax}, too many for a delta)` : d.reason, ...(d.reuse && l.measuredAt ? { measuredAt: l.measuredAt } : {}) };
  }
  const reused = Object.values(lanes).filter((x) => x.reuse || x.delta).length;       // a delta lane reuses its baseline output
  const nDelta = Object.values(lanes).filter((x) => x.delta).length;
  if (!reused && comprehend === 'rerun') {
    return { plan: { ...base, mode: 'full', reason: `full scan — nothing reusable (Comprehend: ${compWhy}; 0 of ${Object.keys(lanes).length} lane(s) reusable)`, comprehend, comprehendWhy: compWhy, lanes, repos, changedFiles }, changes };
  }
  const nChanged = repos.filter((r) => r.cls !== 'unchanged').length;
  return {
    plan: { ...base, mode: 'incremental', reason: `${nChanged} of ${repos.length} repo(s) changed (${changedFiles} file(s)) — Comprehend ${comprehend === 'reuse' ? 'reused' : `re-runs (${compWhy})`} · ${reused - nDelta}/${Object.keys(lanes).length} lane(s) reused${nDelta ? ` · ${nDelta} delta` : ''}`, comprehend, comprehendWhy: compWhy || 'inputs unchanged and every repo Unchanged / Small', lanes, repos, changedFiles },
    changes,
  };
}

// ── the estimate for the config summary line (§7) ────────────────────────────────────────────────────────────────────
// From the baseline's recorded per-lane + per-node spend: reports (the reserve slice) always re-run; Comprehend
// (discovery) re-runs when any repo changed structurally; changed lanes re-run at their last recorded cost. Before the
// clone we only know which repos moved (ls-remote), not which files, so the range is: low = only the reports (+ the
// lanes the changed file list already invalidates, when it is known), high = every lane re-runs.
export function estimateIncremental(b: LineageEntry, o: { changedRepos: number | null; totalRepos: number; changedLanesLow?: number }): { lowUsd: number; highUsd: number; fullUsd: number } {
  const ns = b.nodeSpend ?? {};
  const fullUsd = Number(b.fullSpendUsd ?? b.totalSpend) || 0;
  const lanes = Object.values(b.laneSpend ?? {}).reduce((a, v) => a + (Number(v) || 0), 0);
  const reserve = Number(ns.reserve) || Math.max(0, fullUsd * 0.2);
  const audit = Number(ns.audit) || Math.max(0, fullUsd * 0.1);
  const discovery = Number(ns.discovery) || Math.max(0, fullUsd * 0.1);
  const round = (x: number): number => Math.round(x * 100) / 100;
  if (o.changedRepos === 0) return { lowUsd: round(reserve * 0.5), highUsd: round(reserve), fullUsd: round(fullUsd) };
  const low = reserve + (o.changedLanesLow ?? 0) + audit * 0.3;
  const high = reserve + discovery + lanes + audit;
  return { lowUsd: round(low), highUsd: round(Math.max(low, Math.min(high, fullUsd || high))), fullUsd: round(fullUsd) };
}
