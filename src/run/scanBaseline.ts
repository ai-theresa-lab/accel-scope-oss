// scanBaseline.ts — the New Full Scan config summary's BASELINE line (incremental re-scan, proposal §7):
//
//   Baseline: <date> by <who> · N of M repos changed (X files) · est. $a–b instead of ~$c · [ ] Full rescan
//
// GET /api/scan-baseline computes it BEFORE any clone, cheaply and read-only: the baseline from the lineage index
// (scanLineage.selectBaseline — same org, same exact target set), each baseline repo's remote HEAD via `git ls-remote`
// (refs only, the clone credential), and — for a moved repo — GitHub's compare API for the changed file list, which lets
// the read-set rule already say which lanes WILL re-run (the low end of the estimate). Everything is fail-open: an
// unreachable repo / API reports "change unknown" and widens the estimate; nothing here can fail the form.
// The real decision is made again after the clone (incrementalRun.prepareIncremental) — this is a preview.
import type { LineageEntry } from '../scanLineage.ts';
import { selectBaseline } from '../scanLineage.ts';
import { classifyRepo, deltaEligibleLane, estimateIncremental, incrSettings, judgeablePackageJson, laneIncompleteReason, laneReadSetDecision, packageJsonDepsChanged, type ChangedFile, type LaneSnapLike, type RepoChange } from './incremental.ts';
// A delta lane's expected cost as a share of its last full run (one scoped critique + ≤ 2 measured problems) — a planning
// estimate for the summary line only.
export const DELTA_COST_FRACTION = 0.25;

export interface BaselineRepoAccess { fullName: string; cloneUrl: string; token?: string }
export interface ScanBaselineInfo {
  baseline: null | { runId: string; date: string; by?: string; depth: number; lastFullAt: string; totalSpend: number; fullUsd?: number };
  reason: string;
  full?: string;                // why the NEXT scan will be a full one anyway (forced / disabled / compat), when it will
  // `diverged`: at least one repo's baseline SHA is not an ancestor of its HEAD — the file count is the union of both
  // sides since their merge base (an upper bound), not an exact two-dot diff (GitHub's compare API is three-dot only).
  repos: { total: number; changed: number | null; files: number | null; unknown: number; diverged?: boolean };
  estimate: { lowUsd: number; highUsd: number; fullUsd: number } | null;
  estimateNote?: string;        // why there is no estimate ("estimate unavailable — …")
}
/** A changed-file list from the compare step; `diverged` when OLD was not an ancestor of HEAD (see githubCompareFiles). */
export type CompareResult = { files: { status: string; path: string; oldPath?: string }[]; diverged?: boolean };
/**
 * What THIS run would be compared with (an end-to-end run: the preview promised $0.22–0.44 for a run that turned out a
 * full $28.94 scan because the code / inputs differed). The same strict-compat inputs the planner compares
 * (incremental.ts planInner): the code revision hash, the inputs signature (brief + memory recall + codeintel; null =
 * unknown, e.g. the pinned org-memory version cannot be known before the run), the manual bundle pick and the bundle
 * registry. Absent ⇒ those checks are skipped (older callers).
 */
export interface PreviewCompat { codeHash: string; inputsSig: string | null; manualBundles: string[] | null; bundleHashes?: Record<string, string> }
export interface ScanBaselineDeps {
  headSha: (r: BaselineRepoAccess) => Promise<string | undefined>;
  compare: (r: BaselineRepoAccess, base: string, head: string) => Promise<CompareResult | { status: string; path: string; oldPath?: string }[] | null>;
  lanes: (runId: string) => Record<string, LaneSnapLike>;
  runExists?: (runId: string) => boolean;
  now?: Date;
  compat?: PreviewCompat;
  // The text of a file at a commit (a changed package.json: dependency fields or not — incremental.packageJsonDepsChanged).
  // Absent / undefined ⇒ unknown ⇒ conservative (a dependency-manifest change, as the planner does).
  fileAt?: (r: BaselineRepoAccess, sha: string, path: string) => Promise<string | undefined>;
}

/** The strict-compat reason the next scan is a FULL one (the planner's own wording), or undefined. */
export function previewCompatFull(b: LineageEntry, c: PreviewCompat | undefined): string | undefined {
  if (!c) return undefined;
  if ((c.codeHash ?? '') !== (b.codeHash ?? '')) return 'the analysis prompts / code or the model changed since the baseline';
  if (c.inputsSig != null && c.inputsSig !== b.inputsSig) return 'the brief / memory-recall / codeintel inputs changed since the baseline';
  return undefined;
}

export async function scanBaselineInfo(orgKey: string, targetKey: string, repos: BaselineRepoAccess[], deps: ScanBaselineDeps): Promise<ScanBaselineInfo> {
  const pick = selectBaseline(orgKey, targetKey, { runExists: deps.runExists });
  const b: LineageEntry | null = pick.entry;
  if (!b) return { baseline: null, reason: pick.reason, repos: { total: repos.length, changed: null, files: null, unknown: 0 }, estimate: null };
  const s = incrSettings();
  const now = deps.now ?? new Date();
  const ageDays = (now.getTime() - Date.parse(b.lastFullAt)) / 86_400_000;
  const fullUsd = Math.round((Number(b.fullSpendUsd ?? b.totalSpend) || 0) * 100) / 100;
  const full = !s.enabled ? 'incremental reuse is disabled on this instance (THERESA_INCR=0)'
    : (s.forceFullEvery > 0 && b.depth >= s.forceFullEvery) ? `a periodic full scan is due (the baseline chain is ${b.depth} incremental scans deep)`
      : (s.forceFullDays > 0 && ageDays > s.forceFullDays) ? `a periodic full scan is due (the last full scan was ${Math.floor(ageDays)} days ago)`
        : previewCompatFull(b, deps.compat);
  // Which repos moved (bounded parallelism; refs only).
  let changed = 0, unknown = 0, files = 0, filesKnown = true, diverged = false;
  const changes: RepoChange[] = [];
  const repoFiles = new Map<string, { acc: BaselineRepoAccess; base: string; head: string; files: ChangedFile[] }>();
  const byName = new Map(repos.map((r) => [r.fullName.toLowerCase(), r]));
  // Tasks are thunks so at most 6 remote probes (git ls-remote + compare) are IN FLIGHT at once.
  const work = b.repos.map((br) => async () => {
    const acc = byName.get(br.fullName.toLowerCase());
    if (!acc || !br.sha) { unknown++; filesKnown = false; return; }
    const head = await deps.headSha(acc).catch(() => undefined);
    if (!head) { unknown++; filesKnown = false; return; }
    if (head === br.sha) return;
    changed++;
    const got = await deps.compare(acc, br.sha, head).catch(() => null);
    const res: CompareResult | null = !got ? null : Array.isArray(got) ? { files: got } : got;
    if (!res) { filesKnown = false; return; }
    if (res.diverged) diverged = true;
    files += res.files.length;
    const cf: ChangedFile[] = res.files.map((f) => ({ status: (f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'), path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}) }));
    repoFiles.set(br.fullName.toLowerCase(), { acc, base: br.sha, head, files: cf });
    for (const f of cf) changes.push({ ...f, repo: br.fullName.toLowerCase(), newText: () => undefined, oldText: () => undefined });
  });
  for (let i = 0; i < work.length; i += 6) await Promise.all(work.slice(i, i + 6).map((t) => t()));
  const baseline = { runId: b.runId, date: b.finishedAt.slice(0, 10), ...(b.createdBy ? { by: b.createdBy } : {}), depth: b.depth, lastFullAt: b.lastFullAt, totalSpend: b.totalSpend, ...(fullUsd ? { fullUsd } : {}) };
  const repoInfo = { total: b.repos.length, changed: unknown === b.repos.length ? null : changed, files: filesKnown ? files : null, unknown, ...(diverged ? { diverged: true } : {}) };
  if (full) return { baseline, reason: pick.reason, full, repos: repoInfo, estimate: null };
  const lanes = deps.lanes(b.runId);
  const est = await predictEstimate(b, { lanes, changes, repoFiles, changed, unknown, filesKnown, settings: s, compat: deps.compat, fileAt: deps.fileAt });
  return { baseline, reason: pick.reason, repos: repoInfo, estimate: est.estimate, ...(est.note ? { estimateNote: est.note } : {}) };
}

/**
 * The estimate from the baseline's per-lane spend × the PREDICTED reuse (an end-to-end run: "$1.11–$28.94" said nothing):
 * the read-set rule over the changed file list decides each lane — reused $0, a delta lane DELTA_COST_FRACTION of its last
 * full cost, a re-run lane its full cost (a lane in a Structural repo never goes delta, as in the planner); Comprehend
 * (discovery) re-runs when a repo is Structural or the bundle pick / registry changed; the audit share follows the lane
 * share; the reports (reserve) always re-run. The range is that point −20 % / +30 % (capped at the full cost). Without
 * the file list or a recorded read set for every lane there is nothing to predict from ⇒ "estimate unavailable".
 */
async function predictEstimate(b: LineageEntry, o: { lanes: Record<string, LaneSnapLike>; changes: RepoChange[]; repoFiles: Map<string, { acc: BaselineRepoAccess; base: string; head: string; files: ChangedFile[] }>; changed: number; unknown: number; filesKnown: boolean; settings: ReturnType<typeof incrSettings>; compat?: PreviewCompat; fileAt?: ScanBaselineDeps['fileAt'] }): Promise<{ estimate: ScanBaselineInfo['estimate']; note?: string }> {
  const ns = b.nodeSpend ?? {};
  const fullUsd = Number(b.fullSpendUsd ?? b.totalSpend) || 0;
  const round = (x: number): number => Math.round(x * 100) / 100;
  const laneList = Object.values(o.lanes);
  const anyIncomplete = laneList.some((l) => laneIncompleteReason(l.gaps));
  if (o.unknown) return { estimate: null, note: `estimate unavailable — ${o.unknown} repo(s) could not be checked for changes` };
  if (o.changed === 0 && !anyIncomplete) {
    const e = estimateIncremental(b, { changedRepos: 0, totalRepos: b.repos.length });
    return { estimate: e };
  }
  if (!o.filesKnown) return { estimate: null, note: 'estimate unavailable — the changed file list could not be fetched' };
  if (!laneList.length) return { estimate: null, note: 'estimate unavailable — the baseline has no lane checkpoint to predict from' };
  if (laneList.some((l) => !Array.isArray(l.readSet))) return { estimate: null, note: 'estimate unavailable — a baseline lane predates read-set recording' };
  // Classify each moved repo like the planner (a changed package.json is judged by its dependency fields when its text
  // is available, else conservatively a dependency-manifest change).
  const structural = new Set<string>();
  const depsMemo = new Map<string, boolean | undefined>();
  for (const [name, rf] of o.repoFiles) {
    const cls = classifyRepo(rf.files, o.settings, undefined, { depsChanged: (f) => depsMemo.get(`${name}\u0000${f.path}`) });
    // Fetch the two sides of a changed package.json only when it is the one thing standing between Small and Structural.
    if (cls.cls === 'structural' && o.fileAt) {
      for (const f of rf.files.filter(judgeablePackageJson)) {
        const [a, c] = await Promise.all([o.fileAt(rf.acc, rf.base, f.path).catch(() => undefined), o.fileAt(rf.acc, rf.head, f.path).catch(() => undefined)]);
        depsMemo.set(`${name}\u0000${f.path}`, packageJsonDepsChanged(a, c));
      }
    }
    const again = classifyRepo(rf.files, o.settings, undefined, { depsChanged: (f) => depsMemo.get(`${name}\u0000${f.path}`) });
    if (again.cls === 'structural') structural.add(name);
  }
  const c = o.compat;
  const manualSame = !c || JSON.stringify([...(c.manualBundles ?? [])].sort()) === JSON.stringify([...(b.manualBundles ?? [])].sort());
  const membershipSame = !c?.bundleHashes || JSON.stringify(Object.keys(c.bundleHashes).sort()) === JSON.stringify(Object.keys(b.bundleHashes ?? {}).sort());
  const compRerun = structural.size > 0 || !manualSame || !membershipSame;
  const dmax = o.settings.deltaMaxFiles ?? 20;
  let laneCost = 0, laneFull = 0;
  for (const l of laneList) {
    const cost = Number(b.laneSpend?.[l.bundleId] ?? l.spentUsd ?? 0) || 0;
    laneFull += cost;
    const bundleChanged = !!c?.bundleHashes && c.bundleHashes[l.bundleId] !== b.bundleHashes?.[l.bundleId];
    if (bundleChanged) { laneCost += cost; continue; }
    const d = laneReadSetDecision(l, o.changes);
    if (d.reuse) continue;
    const hitStructural = (d.hits ?? []).some((h) => structural.has(h.split('/').slice(0, 2).join('/')));
    const delta = d.hits && d.hits.length && d.hits.length <= dmax && dmax > 0 && o.settings.findingCarry && deltaEligibleLane(l.bundleId) && !hitStructural;
    laneCost += delta ? cost * DELTA_COST_FRACTION : cost;
  }
  const reserve = Number(ns.reserve) || Math.max(0, fullUsd * 0.2);
  const audit = Number(ns.audit) || Math.max(0, fullUsd * 0.1);
  const discovery = Number(ns.discovery) || Math.max(0, fullUsd * 0.1);
  const point = reserve + (compRerun ? discovery : 0) + laneCost + (laneFull > 0 ? audit * Math.min(1, laneCost / laneFull) : 0);
  const cap = fullUsd || Infinity;
  return { estimate: { lowUsd: round(Math.min(point * 0.8, cap)), highUsd: round(Math.min(point * 1.3, cap)), fullUsd: round(fullUsd) } };
}
/**
 * GitHub's compare API → the changed file list (≤300 per side). Tokenless for public repos. null on any failure.
 * The API is THREE-dot only (`base...head` = changes on head since the merge base; `base..head` is a 404), so when the
 * baseline SHA is not an ancestor of HEAD (status `diverged` / `behind` — e.g. a baseline on another branch, or HEAD
 * reset back) it ALSO lists `head...base` and returns the union, flagged `diverged` (an end-to-end run: the preview said
 * "0 files" for a 5-file diff). The union is an upper bound of the true two-dot diff (a file changed identically on both
 * sides is counted), so the UI says "≤ N files, diverged history".
 */
export async function githubCompareFiles(r: BaselineRepoAccess, base: string, head: string, fetchImpl: typeof fetch = fetch): Promise<CompareResult | null> {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(r.fullName);
  if (!m) return null;
  const one = async (a: string, z: string): Promise<{ status: string; files: CompareResult['files'] } | null> => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetchImpl(`https://api.github.com/repos/${m[1]}/${m[2]}/compare/${a}...${z}`, { headers: { Accept: 'application/vnd.github+json', ...(r.token ? { Authorization: `Bearer ${r.token}` } : {}) }, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!res.ok) return null;
      const j = await res.json() as { status?: string; files?: { filename?: string; status?: string; previous_filename?: string }[] };
      return { status: String(j.status ?? ''), files: (j.files ?? []).filter((f) => f.filename).map((f) => ({ status: String(f.status ?? 'modified'), path: String(f.filename), ...(f.previous_filename ? { oldPath: String(f.previous_filename) } : {}) })) };
    } catch { return null; }
  };
  const fwd = await one(base, head);
  if (!fwd) return null;
  if (fwd.status !== 'diverged' && fwd.status !== 'behind') return { files: fwd.files };
  const back = await one(head, base);
  if (!back) return null;
  const seen = new Set(fwd.files.map((f) => f.path));
  // A file only the OLD side touched: in the two-dot sense it differs between OLD and HEAD (status flipped for add/remove).
  const flip = (st: string): string => (st === 'added' ? 'removed' : st === 'removed' ? 'added' : st);
  return { files: [...fwd.files, ...back.files.filter((f) => !seen.has(f.path)).map((f) => ({ ...f, status: flip(f.status) }))], diverged: true };
}

/** A file's text at a commit via raw.githubusercontent.com (≤ 1 MB), undefined on any failure — the package.json judge. */
export async function githubFileAt(r: BaselineRepoAccess, sha: string, path: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(r.fullName);
  if (!m || !/^[0-9a-f]{7,40}$/i.test(sha) || /(^|\/)\.\.(\/|$)/.test(path)) return undefined;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetchImpl(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: r.token ? { Authorization: `Bearer ${r.token}` } : {}, signal: ctl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return undefined;
    const txt = await res.text();
    return txt.length > 1_000_000 ? undefined : txt;
  } catch { return undefined; }
}

/**
 * The run filters a scan-baseline preview may look up: every id in `sel` must be one of the CALLER'S OWN
 * connected artifacts (`idsOf` — the same list the picker offers). A single id that does not resolve (a guessed repo
 * name, another member's folder path) ⇒ null — the endpoint then returns no baseline at all, so the lineage index can
 * never be probed for targets the caller cannot scan. Only the four target-bearing source kinds are read.
 */
export interface BaselineFilters { repoFilter: string[] | null; giturlFilter: string[] | null; localFilter: string[] | null; projectFilter: string[] | null }
export function resolveBaselineFilters<S extends { id: string; kind: string }>(sel: Record<string, unknown>, sources: S[], idsOf: (s: S) => string[]): BaselineFilters | null {
  let unresolved = false;
  const of = (kind: string): string[] | null => {
    const s = sources.find((x) => x.kind === kind);
    if (!s || !Array.isArray(sel[s.id])) return null;
    const want = (sel[s.id] as unknown[]).map(String).slice(0, 500);
    const own = new Set(idsOf(s));
    if (!want.every((id) => own.has(id))) unresolved = true;
    return want;
  };
  const f: BaselineFilters = { repoFilter: of('github'), giturlFilter: of('giturl'), localFilter: of('local'), projectFilter: of('gcp') };
  return unresolved ? null : f;
}
