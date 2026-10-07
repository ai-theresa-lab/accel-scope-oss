// incrementalRun.ts — the RUNTIME glue of the incremental re-scan: executeOrgRun
// calls these three at fixed points, and nothing else in the executor knows about lineage.
//
//   1. prepareIncremental — right after the workspace is cloned: resolve the org + target, select the baseline
//      (scanLineage.ts), plan the reuse (incremental.ts), log every decision, and — for an `unchanged` / `incremental`
//      plan — build the replay context (a ResumeSpec loaded from the BASELINE's checkpoint sidecars) that the existing
//      resume machinery in orgCritiqueExpert already knows how to replay at $0.
//   2. sinceLastScanFor — after the final findings are known: the deterministic fixed / new / persisting / changed diff
//      against the baseline's findings (sinceLastScan.ts).
//   3. recordRunHistory — after a COMPLETED finish: the run's lineage entry, its keyed-findings sidecar and the durable
//      org findings store (orgFindings.ts). Run history, not memory — deliberately NOT gated on run.writeMemory.
//
// QUEUED / RESTARTED RUNS: nothing here is computed at POST time or held only in memory. The plan and its replay
// context are derived when the run EXECUTES, from durable state (the lineage index + the baseline's checkpoint sidecars
// under THERESA_DATA_DIR) — so a queued incremental run needs no persisted replay spec: whenever it starts (after a
// promotion, after a restart that re-admits it) it plans from what is on disk then. The only
// request-time input is the persisted `run.fullRescan` flag.
// FAIL-OPEN everywhere: any error here logs a reason and the run proceeds as a normal full scan.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run, Source, ResumeSpec, LaneSnap } from '../server.ts';
import type { RunContext } from './run-context.ts';
import { CKPT_STAGE_VERSION, type CkptId, type WorkspaceManifest, loadCheckpoint } from '../checkpoints.ts';
import { orgIdForTenant } from '../localOrg.ts';
import { findingKeys, type FindingKeys } from '../findingKey.ts';
import { assignDisplayIds } from '../findingIds.ts';
import { isRuledOutFinding } from '../reportAnchors.ts';
import { diffSinceLastScan, excludeFromDiff, type KeyedFinding, type SinceLastScan, type UncheckedWhy } from '../sinceLastScan.ts';
import { evidenceStems, fuzzyFeatures, fuzzyWords } from '../fuzzyMatch.ts';
import { recordRunFindings, listTargetFindings, type RunFindingRow } from '../orgFindings.ts';
import { briefHashOf, inputsSigOf, listLineage, orgKeyFor, recordLineage, registryHashes, runTargets, selectBaseline, targetKeyFor, type LineageEntry } from '../scanLineage.ts';
import { gitChangedFiles, gitListFiles, gitShow, gitTopLevel, incrSettings, planIncremental, type IncrPlan, type LaneSnapLike, type RepoChange } from './incremental.ts';
import type { AuditedClaim, Finding } from '../schema.ts';
import type { ReadSetSnapshot } from '../research/readSet.ts';
import { deltaLaneSplit, planCarry, type CarriedLane, type PendingFinding } from './carryForward.ts';

/** Carried on ResumeSpec.incremental: what orgCritiqueExpert needs beyond the plain resume replay. */
export interface IncrementalReplay {
  mode: 'unchanged' | 'incremental';
  baselineRunId: string;
  baselineAt: string;
  lanes: IncrPlan['lanes'];
  baselineBundleIds: string[];
  audits: AuditedClaim[];                    // the baseline's claim-audit verdicts (reused lanes keep theirs)
  baselineLanes: Record<string, LaneSnap>;   // every baseline lane (Phase 3 carry-forward reads the non-reused ones)
  changedPaths: string[];                    // repo-normalized paths of every changed file (old + new names)
  findingCarry: boolean;
  // Phase 3 (finding-level carry-forward): the baseline's findings checkpoint, the repos with base → head SHAs (for the
  // targeted re-verify's diff hunks) and the baseline workspace's dir → repo map (its evidence paths use its dirs).
  baselineFindings: Finding[];
  // What the baseline CARRIED per lane and the prior findings it left PENDING (its findings cut).
  baselineCarried?: Record<string, CarriedLane>;
  baselinePending?: PendingFinding[];
  repos: { fullName: string; dir: string; baseSha?: string; headSha?: string }[];
  baselineRepos: { fullName: string; dir: string }[];
}

/** Persisted on the Run (non-secret): what the run reused and why — the run page's hero / checkpoints note. */
export interface IncrementalSummary {
  mode: 'unchanged' | 'incremental' | 'full';
  reason: string;
  baselineRunId?: string;
  baselineAt?: string;
  baselineBy?: string;
  comprehend?: 'reuse' | 'rerun';
  comprehendWhy?: string;
  lanesReused: string[];
  lanesRerun: { id: string; reason: string }[];
  // DELTA lanes: revived at $0 + a delta critique over `files` changed read file(s) + `rechecks` re-checks.
  lanesDelta?: { id: string; reason: string; files: number; rechecks: number }[];
  // Baseline lanes whose bundle this run's Comprehend did NOT activate — they neither re-ran nor were
  // reused (their earlier findings read "not re-checked"). Filled once the activated set is known (withActivation).
  lanesNotActivated?: { id: string; reason: string }[];
  repos: { fullName: string; cls: string; files: number }[];
  changedFiles: number;
  forcedFull?: string;
  since?: { fixed: number; new: number; persisting: number; changed: number; unchecked: number; uncheckedWhy?: Partial<Record<UncheckedWhy, number>> };
}

export interface IncrRuntime {
  orgKey: string;
  targetKey: string;
  targets: string[];
  baseline: LineageEntry | null;
  plan: IncrPlan;
  summary: IncrementalSummary;
  repos: { fullName: string; dir: string; sha?: string }[];
  inputsSig: string;            // the compared inputs fingerprint of THIS run (incl. the pinned org-memory version)
  // A MANUAL resume child continues its parent's drift chain: the lineage fields it inherits instead of
  // restarting at depth 0 / "last full scan = now".
  inherit?: { depth: number; lastFullAt: string; fullSpendUsd?: number; baselineRunId?: string };
}

export function localNamesFor(sources: Source[]): Map<string, { sourceId: string; name: string }> {
  const m = new Map<string, { sourceId: string; name: string }>();
  for (const s of sources) if (s.kind === 'local') for (const r of s.localRepos ?? []) m.set(r.path, { sourceId: s.id, name: r.name });
  return m;
}

export function incrEligible(run: Run): boolean { return run.mode === 'agentic' && (run.kind ?? 'org') === 'org'; }

function laneMapOf(data: Partial<Record<CkptId, any>>): Record<string, LaneSnap> {
  return (data.barrier?.lanes ?? data.frontier?.lanes ?? {}) as Record<string, LaneSnap>;
}

/** Load the baseline's cuts contiguously up to `upTo` (skipping workspace — the fresh clone IS the workspace). */
function loadBaselineCuts(runId: string, upTo: CkptId): { data: Partial<Record<CkptId, any>>; last: CkptId | null } {
  const order: CkptId[] = ['comprehend', 'frontier', 'barrier', 'claim-audit', 'synthesis', 'findings'];
  const data: Partial<Record<CkptId, any>> = {};
  let last: CkptId | null = null;
  for (const id of order) {
    const got = loadCheckpoint(runId, id);
    const ok = got && got.meta.stageVersion === CKPT_STAGE_VERSION[id];
    if (ok) { data[id] = got!.payload; last = id; }
    else if (id === 'frontier') { /* subsumed by barrier */ }
    else break;
    if (id === upTo) break;
  }
  return { data, last };
}

/**
 * Plan this run against its baseline and, when something is reusable, return the replay context. Logs every decision.
 * Returns null only when the run is not eligible (not an agentic Full Scan, or a manual resume child — manual resume
 * keeps its own lenient rules).
 */
export function prepareIncremental(run: Run, ctx: RunContext, root: string, manifest: WorkspaceManifest, cur: { planeFps: string[]; codeintel: boolean; osv: boolean; memoryVersion?: number | null }): { rt: IncrRuntime; spec: ResumeSpec | null } | null {
  if (!incrEligible(run)) return null;
  const log = (m: string): void => ctx.log(run, m);
  try {
    const orgKey = orgKeyFor(run.orgId ?? (run.tenant ? orgIdForTenant(run.tenant) : null), run.tenant);
    // No org and no tenant: there is no isolation scope to file lineage under — no baseline, no record.
    if (!orgKey) { log('incremental: off for this run — it has no org or tenant scope to keep scan lineage under (full scan)'); return null; }
    const targets = runTargets(run, localNamesFor(ctx.sourcesFor(run)));
    const targetKey = targetKeyFor(targets);
    const parentSpec = ctx.live(run).resumeSpec;
    const resumed = Boolean(parentSpec);
    const inputsSig = inputsSigOf(run, cur.memoryVersion);
    // A trashed OR PURGED (no longer resolvable) run has no usable sidecars.
    const pick = selectBaseline(orgKey, targetKey, { excludeRunId: run.id, runExists: runExistsIn(ctx) });
    const b = pick.entry;
    const settings = incrSettings();
    const repos = manifest.repos.map((r) => ({ fullName: r.fullName, dir: r.dir, sha: r.sha }));
    const reg = registryHashes();
    // Baseline payloads the planner needs (lanes for the read-set rule, comprehend flags for compat).
    const bComp = b ? loadCheckpoint(b.runId, 'comprehend')?.payload : undefined;
    const bLanesRaw = b ? (loadCheckpoint(b.runId, 'barrier')?.payload?.lanes ?? loadCheckpoint(b.runId, 'frontier')?.payload?.lanes ?? {}) as Record<string, LaneSnap> : {};
    const baselineRun = b ? ctx.getRun(b.runId) : undefined;
    const planInput = {
      settings, fullRescan: run.fullRescan === true || resumed, baseline: b, baselineReason: pick.reason, now: new Date(),
      repos, localDirs: manifest.localDirs, planeFps: cur.planeFps, inputsSig, briefHash: briefHashOf(run.brief),
      manualBundles: run.bundles && run.bundles.length ? run.bundles : null, invariantIds: run.invariantKeys ?? [], registry: reg,
      codeintel: cur.codeintel, osv: cur.osv,
      baselineLanes: bLanesRaw as unknown as Record<string, LaneSnapLike>,
      baselineComprehend: bComp ? { codeintel: bComp.codeintel, osv: bComp.osv, bundleIds: bComp.bundleIds } : undefined,
      // The baseline's manual bundle pick: recorded on its lineage entry (older entries: read from its run record).
      baselineManualBundles: b && b.manualBundles !== undefined ? b.manualBundles : (baselineRun ? (baselineRun.bundles && baselineRun.bundles.length ? baselineRun.bundles : null) : null),
      gitDiff: (r: { dir: string }, a: string, h: string) => gitChangedFiles(join(root, r.dir), a, h),
      gitTop: (r: { dir: string }, sha: string) => gitTopLevel(join(root, r.dir), sha),
      textAt: (r: { dir: string }, sha: string, p: string) => (sha === 'HEAD' ? readText(join(root, r.dir, p)) : gitShow(join(root, r.dir), sha, p)),
    };
    let { plan, changes } = planIncremental(planInput);
    if (resumed && b) plan = { ...plan, mode: 'full', reason: 'manual resume — incremental reuse does not apply (the resume replays its parent)' };
    // ── the replay context ──
    let spec: ResumeSpec | null = null;
    if (b && plan.mode !== 'full') {
      if (plan.mode === 'unchanged') {
        // The $0 promise holds only when the chain replays through `findings`: a chain that stops earlier
        // would pay for claim audit / synthesis live while calling itself "unchanged" — downgrade it honestly to an
        // incremental replay of Comprehend + every lane (or a full scan when even those are gone).
        const { data, last } = loadBaselineCuts(b.runId, 'findings');
        const laneIds = Object.keys(laneMapOf(data));
        if (last === 'findings' && data.comprehend && laneIds.length) spec = { parentId: b.runId, parentLabel: `baseline ${baselineRun?.alias || b.runId}`, ckpt: last, reuse: new Set(laneIds), data };
        else if (data.comprehend && laneIds.length) plan = { ...plan, mode: 'incremental', reason: `no changes since ${b.finishedAt.slice(0, 10)}, but the baseline's checkpoint chain stops at ${last ?? 'none'} — Comprehend and every lane are reused, the later stages run live` };
        else plan = { ...plan, mode: 'full', reason: `full scan — the baseline ${b.runId}'s checkpoint chain is incomplete (${last ?? 'none'})` };
      }
      if (plan.mode === 'incremental') {
        const comp = plan.comprehend === 'reuse' ? loadCheckpoint(b.runId, 'comprehend') : null;
        const reuse = new Set(Object.entries(plan.lanes).filter(([, v]) => v.reuse).map(([k]) => k).filter((k) => bLanesRaw[k]));
        const data: Partial<Record<CkptId, any>> = { barrier: { lanes: bLanesRaw } };
        if (comp && comp.meta.stageVersion === CKPT_STAGE_VERSION.comprehend) data.comprehend = comp.payload;
        else if (plan.comprehend === 'reuse') plan = { ...plan, comprehend: 'rerun', comprehendWhy: 'the baseline comprehend checkpoint is unreadable' };
        // Reusing NOTHING is a full scan — mode, depth and lastFullAt must say so, or the drift counter
        // would count a fresh look as one more incremental step.
        // A DELTA lane replays its baseline snapshot too (revived at $0 + a delta critique), so it counts as reusable.
        const deltas = Object.entries(plan.lanes).filter(([k, v]) => v.delta && bLanesRaw[k]).length;
        if (!data.comprehend && !reuse.size && !deltas) plan ={ ...plan, mode: 'full', reason: `full scan — nothing reusable (Comprehend: ${plan.comprehendWhy}; no lane replayable from the baseline's checkpoints)` };
        else spec = { parentId: b.runId, parentLabel: `baseline ${baselineRun?.alias || b.runId}`, ckpt: 'barrier', reuse, data };
      }
      if (spec) {
        const audits = ((loadCheckpoint(b.runId, 'claim-audit')?.payload?.audits ?? []) as AuditedClaim[]);
        spec.incremental = {
          mode: plan.mode as 'unchanged' | 'incremental', baselineRunId: b.runId, baselineAt: b.finishedAt, lanes: plan.lanes,
          baselineBundleIds: b.bundleIds, audits, baselineLanes: bLanesRaw,
          changedPaths: [...new Set(changes.flatMap((c: RepoChange) => [`${c.repo}/${c.path}`, ...(c.oldPath ? [`${c.repo}/${c.oldPath}`] : [])]))],
          findingCarry: settings.findingCarry,
          ...((): Pick<IncrementalReplay, 'baselineFindings' | 'baselineCarried' | 'baselinePending'> => {
            const fp = loadCheckpoint(b.runId, 'findings')?.payload;
            return { baselineFindings: (fp?.findings ?? []) as Finding[], baselineCarried: (fp?.carried ?? {}) as Record<string, CarriedLane>, baselinePending: (fp?.pending ?? []) as PendingFinding[] };
          })(),
          repos: repos.map((r) => { const br = b.repos.find((x) => x.fullName.toLowerCase() === r.fullName.toLowerCase()); return { fullName: r.fullName, dir: r.dir, ...(br?.sha ? { baseSha: br.sha } : {}), ...(r.sha ? { headSha: r.sha } : {}) }; }),
          baselineRepos: b.repos.map((r) => ({ fullName: r.fullName, dir: r.dir })),
        };
      }
    }
    // DELTA lanes: how many baseline findings each will re-check (those citing / measuring a changed file) — for the log
    // line + the run record. Pure over the baseline findings + the changed set (carryForward.deltaLaneSplit / planCarry).
    const deltaRechecks: Record<string, number> = {};
    if (spec?.incremental && plan.mode === 'incremental') {
      const inc = spec.incremental;
      const changedSet = new Set(inc.changedPaths.map((p) => p.toLowerCase()));
      // The same workspace file index the findings stage resolves measurement inputs against (execute-org-run
      // inputIndex) — without it every measurement reads `unresolved` (= a re-check) and the count over-states.
      const wsRepos = repos.map((r) => ({ fullName: r.fullName, dir: r.dir }));
      const inputs = { files: wsRepos.flatMap((r) => gitListFiles(join(root, r.dir)).map((p) => `${r.fullName.toLowerCase()}/${p.toLowerCase()}`)), repos: wsRepos };
      for (const [id, v] of Object.entries(plan.lanes)) {
        if (!v.delta) continue;
        const hyps = new Set(((bLanesRaw[id]?.hypotheses ?? []) as { id: string }[]).map((h) => String(h.id).toLowerCase()));
        const derived = inc.baselineFindings.filter((f) => hyps.has(String(f.id).toLowerCase()));
        const carried = inc.baselineCarried?.[id]?.findings ?? [];
        deltaRechecks[id] = deltaLaneSplit(derived, changedSet, inc.baselineRepos, inputs).recheck.length + planCarry(carried, [], changedSet, inc.baselineRepos, undefined, { laneMode: 'delta', inputs }).reverify.length;
      }
    }
    // ── log + summary ──
    const by = b?.createdBy ? ` by ${b.createdBy.split('@')[0]}` : '';
    log(b ? `incremental: baseline ${b.runId} (${b.finishedAt.slice(0, 10)}${by}) — ${plan.reason}` : `incremental: ${plan.reason}`);
    for (const r of plan.repos) if (r.cls !== 'unchanged') log(`incremental: ${r.fullName} — ${r.cls} (${r.reason})${r.baseSha && r.headSha ? ` ${r.baseSha.slice(0, 7)}→${r.headSha.slice(0, 7)}` : ''}`);
    if (plan.mode !== 'full') {
      log(`reuse: Comprehend ${plan.comprehend === 'reuse' ? 'reused' : 're-runs'} — ${plan.comprehendWhy}`);
      for (const [id, v] of Object.entries(plan.lanes)) {
        if (v.delta) { log(`reuse: lane ${id} Change — ${v.reason} · Change critique + ${deltaRechecks[id] ?? 0} re-check(s)`); continue; }
        log(`reuse: lane ${id} ${v.reuse ? 'reused' : 'not reused'} — ${v.reason}${v.reuse && v.measuredAt ? ` (live-plane measurements kept as measured ${v.measuredAt.slice(0, 10)})` : ''}`);
      }
    }
    const summary: IncrementalSummary = {
      mode: plan.mode, reason: plan.reason, ...(b ? { baselineRunId: b.runId, baselineAt: b.finishedAt, ...(b.createdBy ? { baselineBy: b.createdBy } : {}) } : {}),
      ...(plan.mode !== 'full' ? { comprehend: plan.comprehend, comprehendWhy: plan.comprehendWhy } : {}),
      lanesReused: plan.mode === 'full' ? [] : Object.entries(plan.lanes).filter(([, v]) => v.reuse).map(([k]) => k),
      lanesRerun: plan.mode === 'full' ? [] : Object.entries(plan.lanes).filter(([, v]) => !v.reuse && !v.delta).map(([k, v]) => ({ id: k, reason: v.reason })),
      ...(plan.mode !== 'full' && Object.values(plan.lanes).some((v) => v.delta) ? { lanesDelta: Object.entries(plan.lanes).filter(([, v]) => v.delta).map(([k, v]) => ({ id: k, reason: v.reason, files: v.delta!.files.length, rechecks: deltaRechecks[k] ?? 0 })) } : {}),
      repos: plan.repos.map((r) => ({ fullName: r.fullName, cls: r.cls, files: r.files })), changedFiles: plan.changedFiles,
      ...(plan.forcedFull ? { forcedFull: plan.forcedFull } : {}),
    };
    ctx.updateRun(run, (r) => { r.incremental = summary; if (b) r.baselineRunId = b.runId; });
    const inherit = resumed && parentSpec ? resumeInheritance(ctx, orgKey, targetKey, parentSpec.parentId) : undefined;
    return { rt: { orgKey, targetKey, targets, baseline: b, plan, summary, repos, inputsSig, ...(inherit ? { inherit } : {}) }, spec };
  } catch (e) {
    log(`incremental: planning skipped (${e instanceof Error ? e.message : String(e)}) — full scan`);
    return null;
  }
}

/**
 * The run summary once Comprehend has chosen this run's bundles (B said "re-ran data-eng / api-stability"
 * for two bundles the re-run Comprehend never activated). A planned lane whose bundle is not activated moves to
 * `lanesNotActivated`; an activated bundle the baseline had no lane for is a fresh lane (re-run, "not in the baseline").
 * Pure; a summary that is not incremental is returned unchanged.
 */
export function withActivation(s: IncrementalSummary, activated: Iterable<string>): IncrementalSummary {
  if (s.mode !== 'incremental') return s;
  const act = new Set([...activated].map((x) => x.toLowerCase()));
  const on = (id: string): boolean => act.has(id.toLowerCase());
  const why = 'this run’s Comprehend did not activate this bundle — it neither re-ran nor was reused; its earlier findings read "not re-checked"';
  const planned = new Set([...s.lanesReused, ...s.lanesRerun.map((l) => l.id), ...(s.lanesDelta ?? []).map((l) => l.id), ...(s.lanesNotActivated ?? []).map((l) => l.id)].map((x) => x.toLowerCase()));
  const notAct = [...(s.lanesNotActivated ?? []), ...[...s.lanesReused, ...s.lanesRerun.map((l) => l.id), ...(s.lanesDelta ?? []).map((l) => l.id)].filter((id) => !on(id)).map((id) => ({ id, reason: why }))];
  const fresh = [...act].filter((id) => !planned.has(id)).map((id) => ({ id, reason: 'not in the baseline — activated by this run’s Comprehend, so it runs fresh' }));
  const delta = (s.lanesDelta ?? []).filter((l) => on(l.id));
  return {
    ...s, lanesReused: s.lanesReused.filter(on), lanesRerun: [...s.lanesRerun.filter((l) => on(l.id)), ...fresh],
    ...(s.lanesDelta ? { lanesDelta: delta } : {}), ...(notAct.length ? { lanesNotActivated: notAct } : {}),
  };
}

/** Does a (baseline) run still exist? A purged run resolves to nothing — that is NOT "exists". */
export function runExistsIn(ctx: Pick<RunContext, 'getRun'>): (id: string) => boolean {
  return (id) => { const r = ctx.getRun(id); return Boolean(r) && !r!.trashed; };
}

/**
 * The drift-chain fields a MANUAL resume child inherits: its parent's own lineage entry when the parent
 * completed; else, when the parent was itself an incremental run against baseline B, B's chain one step deeper; else
 * nothing (the parent was a full scan — the child, replaying freshly computed cuts, is one too).
 */
export function resumeInheritance(ctx: Pick<RunContext, 'getRun'>, orgKey: string, targetKey: string, parentId: string): IncrRuntime['inherit'] {
  const ls = listLineage(orgKey, targetKey);
  const pe = ls.find((e) => e.runId === parentId);
  if (pe) return { depth: pe.depth, lastFullAt: pe.lastFullAt, ...(pe.fullSpendUsd != null ? { fullSpendUsd: pe.fullSpendUsd } : {}), ...(pe.incremental?.baselineRunId ? { baselineRunId: pe.incremental.baselineRunId } : {}) };
  const pr = ctx.getRun(parentId);
  const bId = pr?.incremental && pr.incremental.mode !== 'full' ? (pr.baselineRunId ?? pr.incremental.baselineRunId) : undefined;
  const be = bId ? ls.find((e) => e.runId === bId) : undefined;
  if (be) return { depth: be.depth + 1, lastFullAt: be.lastFullAt, fullSpendUsd: be.fullSpendUsd ?? be.totalSpend, baselineRunId: be.runId };
  return undefined;
}

function readText(p: string): string | undefined { try { const t = readFileSync(p, 'utf8'); return t.length > 4 * 1024 * 1024 ? undefined : t; } catch { return undefined; } }

// ── keyed findings (the run's final, evidence-gated list) ────────────────────────────────────────────────────────────
// `pending`: a prior finding this run could not re-check — a baseline row for the NEXT diff (so it reads "not
// re-checked", never vanishes), never a current finding (no F-id, not in the org store).
// `metric` / `evStems` (fuzzy tier, fuzzyMatch.ts — additive; absent on older sidecars, whose rows then fuzzy-match on the
// title alone): the hypothesis's metric name and the normalized evidence stems.
export interface KeyRow { id: string; title: string; severity: string; source: string; ruledOut: boolean; displayId?: string; key: string; evidenceKey: string; looseKey: string; bundleId: string; path?: string; invariant?: string; pending?: boolean; xproj?: NonNullable<Finding['xproj']>; metric?: string; evStems?: string[] }
interface KeysFile { v: 1; runId: string; at: string; rows: KeyRow[] }

export function keyRowsFor(findings: Finding[], root: string | undefined, metricOf?: (f: Finding) => string | undefined): KeyRow[] {
  const ids = assignDisplayIds(findings);
  return findings.map((f, i) => {
    const k: FindingKeys = findingKeys(f, { root });
    const metric = metricOf?.(f);
    const evStems = evidenceStems(f);
    return { id: String(f.id), title: String(f.title ?? ''), severity: String(f.severity ?? ''), source: String(f.source ?? ''), ruledOut: isRuledOutFinding(f),
      ...(ids[i] ? { displayId: ids[i] } : {}), key: k.key, evidenceKey: k.evidenceKey, looseKey: k.looseKey, bundleId: k.bundleId,
      ...(k.path ? { path: k.path } : {}), ...(f.invariant ? { invariant: String(f.invariant) } : {}), ...(f.xproj ? { xproj: f.xproj } : {}),
      ...(metric ? { metric } : {}), ...(evStems.length ? { evStems } : {}) };
  });
}
/**
 * The "Across projects" tags a previous run's keyed sidecar recorded, by finding key — the baseline of an
 * incremental scan, else the parent a manual resume inherits from. Fail-open: an empty map.
 */
export function baselineCrossProjectTags(ctx: Pick<RunContext, 'reportArtifactPath'>, rt: IncrRuntime | null): Map<string, NonNullable<Finding['xproj']>> {
  const out = new Map<string, NonNullable<Finding['xproj']>>();
  const id = rt?.baseline?.runId ?? rt?.inherit?.baselineRunId;
  if (!id) return out;
  try {
    const f = JSON.parse(readFileSync(ctx.reportArtifactPath(id, 'findingkeys.json'), 'utf8')) as KeysFile;
    if (f?.v === 1 && Array.isArray(f.rows)) for (const r of f.rows) if (r.xproj && !r.pending && !r.ruledOut) out.set(r.key, r.xproj);
  } catch { /* no sidecar → no tags */ }
  return out;
}
// Exported for tests: an OLD sidecar row (no `metric` / `evStems`) keeps working — empty stems, no metric.
export const asKeyed = (r: KeyRow): KeyedFinding => ({ f: { id: r.id, title: r.title, severity: r.severity as Finding['severity'], source: r.source }, k: { key: r.key, evidenceKey: r.evidenceKey, looseKey: r.looseKey, bundleId: r.bundleId }, ruledOut: r.ruledOut, ...(r.displayId ? { displayId: r.displayId } : {}), ...(r.path ? { path: r.path } : {}),
  fz: { bundleId: r.bundleId, invariant: String(r.invariant ?? '').toLowerCase(), words: fuzzyWords(r.title), ...(r.metric ? { metric: r.metric.toLowerCase() } : {}), stems: r.evStems ?? [], ...(r.severity ? { severity: r.severity } : {}) } });

/**
 * The baseline's keyed findings: its keyed-findings sidecar (written at its finish — exact: the final, gated list), else
 * its `findings` CHECKPOINT with keys recomputed against the baseline's own SHAs via `git show` in this run's clone.
 */
export function baselineKeyedFindings(ctx: RunContext, b: LineageEntry, root: string, repos: { fullName: string; dir: string }[]): KeyedFinding[] | null {
  try {
    const f = JSON.parse(readFileSync(ctx.reportArtifactPath(b.runId, 'findingkeys.json'), 'utf8')) as KeysFile;
    if (f?.v === 1 && f.runId === b.runId && Array.isArray(f.rows)) return f.rows.map(asKeyed);
  } catch { /* fall back to the checkpoint */ }
  const cp = loadCheckpoint(b.runId, 'findings');
  if (!cp) return null;
  const findings = [...(cp.payload?.findings ?? []), ...((cp.payload?.pending ?? []) as PendingFinding[]).map((p) => p.finding)] as Finding[];
  const curDir = new Map(repos.map((r) => [r.fullName.toLowerCase(), r.dir]));
  const baseDirToRepo = new Map(b.repos.map((r) => [r.dir, r]));
  const readAtBase = (path: string): string | undefined => {
    const i = path.indexOf('/');
    const br = i > 0 ? baseDirToRepo.get(path.slice(0, i)) : undefined;
    if (br?.sha) { const d = curDir.get(br.fullName.toLowerCase()); if (d) return gitShow(join(root, d), br.sha, path.slice(i + 1)); }
    for (const r of b.repos) { const d = curDir.get(r.fullName.toLowerCase()); const t = d && r.sha ? gitShow(join(root, d), r.sha, path) : undefined; if (t != null) return t; }
    return undefined;
  };
  // The fuzzy tier's metric of each baseline finding: its baseline hypothesis (barrier lanes + what the findings cut
  // carried / parked) — deep-audit findings carry no invariant, so without the metric they could never fuzzy-pair.
  const metric = new Map<string, string>();
  try {
    const lanes = (loadCheckpoint(b.runId, 'barrier')?.payload?.lanes ?? {}) as Record<string, LaneSnap>;
    const carried = (cp.payload?.carried ?? {}) as Record<string, CarriedLane>;
    const hyps = [...Object.values(lanes).flatMap((l) => l?.hypotheses ?? []), ...Object.values(carried).flatMap((l) => l?.hypotheses ?? []), ...((cp.payload?.pending ?? []) as PendingFinding[]).flatMap((p) => (p.hypothesis ? [p.hypothesis] : []))];
    for (const h of hyps) { const m = String(h.agentMetric || h.decisiveMetric || ''); if (m) metric.set(String(h.id).toLowerCase(), m); }
  } catch { /* no metrics → title / evidence only */ }
  const ids = assignDisplayIds(findings);
  return findings.map((fd, i) => {
    const k = findingKeys(fd, { readText: readAtBase });
    return { f: fd, k, ruledOut: isRuledOutFinding(fd), ...(ids[i] ? { displayId: ids[i] } : {}), ...(k.path ? { path: k.path } : {}), fz: fuzzyFeatures(fd, { bundleId: k.bundleId, metric: metric.get(String(fd.id).toLowerCase()) }) };
  });
}

/**
 * May a baseline finding read "fixed"? "Fixed" needs a code change: a finding whose repo is at the SAME
 * SHA as the baseline cannot have been fixed — the run just did not re-raise it. Its repo = the repo dir its primary
 * evidence path starts with, else (one-repo workspace) the only repo. `unchangedDirs`: the workspace dirs of the repos the
 * plan classed unchanged. An UNKNOWN repo (a path-less measurement in a multi-repo workspace) is fixable
 * only when EVERY repo changed — it used to be fixable whenever its repo could not be told, even with no repo changed.
 */
export function canBeFixedIn(path: string | undefined, repos: { dir: string }[], unchangedDirs: Set<string>): boolean {
  if (!unchangedDirs.size) return true;                                          // every repo changed (or no plan)
  if (repos.length && repos.every((r) => unchangedDirs.has(r.dir))) return false; // nothing changed anywhere
  const head = path && path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
  const dir = head && repos.some((r) => r.dir === head) ? head : (repos.length === 1 ? repos[0].dir : '');
  return dir ? !unchangedDirs.has(dir) : false;                                  // unknown repo + some repo unchanged ⇒ not provable
}

/** The since-last-scan diff for this run's final findings, or null without a baseline. */
export function sinceLastScanFor(ctx: RunContext, rt: IncrRuntime | null, current: KeyRow[], root: string, checkedBundles: Set<string> | undefined, uncheckedLoose?: Set<string>, extra: { uncheckedWhy?: Map<string, UncheckedWhy>; ranBundles?: Set<string> } = {}): SinceLastScan | null {
  if (!rt?.baseline) return null;
  try {
    const base = baselineKeyedFindings(ctx, rt.baseline, root, rt.repos);
    if (!base) return null;
    const bRepo = rt.baseline.repos[0];
    const firstSeen = new Map(listTargetFindings(rt.orgKey, rt.targetKey).map((r) => [r.findingKey, r.firstSeen.at.slice(0, 10)]));
    const unchangedDirs = new Set<string>();
    for (const rp of rt.plan.repos ?? []) if (rp.cls === 'unchanged') { const d = rt.repos.find((r) => r.fullName.toLowerCase() === rp.fullName.toLowerCase())?.dir; if (d) unchangedDirs.add(d); }
    const canBeFixed = (b: KeyedFinding): boolean => canBeFixedIn(b.path, rt.repos, unchangedDirs);
    return diffSinceLastScan(current.map(asKeyed), base, { runId: rt.baseline.runId, date: rt.baseline.finishedAt.slice(0, 10), ...(bRepo?.sha ? { sha: bRepo.sha } : {}), ...(rt.baseline.createdBy ? { by: rt.baseline.createdBy } : {}) }, {
      checkedBundles, uncheckedLoose, ...(extra.uncheckedWhy ? { uncheckedWhy: extra.uncheckedWhy } : {}), ...(extra.ranBundles ? { ranBundles: extra.ranBundles } : {}), firstSeen: (k) => firstSeen.get(k), canBeFixed,
    });
  } catch { return null; }
}

/** What orgCritiqueExpert hands back for the lineage entry. */
export interface LineageInfo {
  bundleIds: string[];
  planeFps: string[];
  lanes: Record<string, LaneSnap>;
  nodeSpend: Record<string, number>;
  checkedBundles: string[];
  // Phase 3: looseKeys of baseline findings a targeted re-verify could not settle — reported "not re-checked", never fixed.
  uncheckedLoose?: string[];
  // Why each of those is unchecked (looseKey → reason), and every lane that ran (complete or not).
  uncheckedWhy?: Record<string, UncheckedWhy>;
  ranBundles?: string[];
  // Those prior findings themselves — kept in the keyed sidecar as pending baseline rows for the next scan.
  pending?: Finding[];
  // What was actually REPLAYED from the baseline at execute time — the drift counter's input. A DELTA lane
  // (revived at $0 + a delta critique over its changed files) counts as reused.
  reused?: { comprehend: boolean; lanes: string[] };
  // Fuzzy tier: hypothesis id (lowercased) → its decisive / agent-named metric, so a finding's keyed row carries it.
  metricById?: Record<string, string>;
}

/** The org project of a FIXED row (no current evidence): its store record's evidence path, its stored id, the workspace's. */
export function fixedRowProject(rec: { evidencePath?: string; projectId?: string } | undefined, projectOf?: (path?: string) => string | undefined): string | undefined {
  if (!projectOf) return undefined;
  return (rec?.evidencePath ? projectOf(rec.evidencePath) : undefined) ?? rec?.projectId ?? projectOf(undefined);
}

/** Record a COMPLETED run: keyed-findings sidecar, lineage entry, org findings store. Fail-open; logs one line. */
// `projectOf` (cross-project memory, src/orgProjects.ts): the org project a row's evidence path belongs to — stamped on the
// org findings store rows so precedents / the Compare view can ask "which project was this in". Optional: absent ⇒ no projectId.
export function recordRunHistory(run: Run, ctx: RunContext, rt: IncrRuntime | null, manifest: WorkspaceManifest, info: LineageInfo | undefined, rows: KeyRow[], since: SinceLastScan | null, totalSpend: number, projectOf?: (path?: string) => string | undefined): void {
  if (!rt || !incrEligible(run) || run.status !== 'complete') return;
  try {
    const now = new Date().toISOString();
    const pendRows: KeyRow[] = (info?.pending ?? []).map((f) => { const k = findingKeys(f); const evStems = evidenceStems(f); return { id: String(f.id), title: String(f.title ?? ''), severity: String(f.severity ?? ''), source: String(f.source ?? ''), ruledOut: false, key: k.key, evidenceKey: k.evidenceKey, looseKey: k.looseKey, bundleId: k.bundleId, pending: true, ...(f.invariant ? { invariant: String(f.invariant) } : {}), ...(evStems.length ? { evStems } : {}) }; });
    try { writeFileSync(ctx.reportArtifactPath(run.id, 'findingkeys.json'), JSON.stringify({ v: 1, runId: run.id, at: now, rows: [...rows, ...pendRows] } satisfies KeysFile)); } catch (e) { ctx.log(run, `run history: keyed-findings sidecar not written (${e instanceof Error ? e.message : String(e)})`); }
    const cuts = (run.checkpoints ?? []).map((c) => c.id);
    const reg = registryHashes();
    const b = rt.baseline;
    // What the run ACTUALLY reused: a plan that reused nothing at execute time (every planned lane fell
    // back to live, Comprehend re-ran) is a full scan for the drift counter.
    const reusedAny = rt.plan.mode !== 'full' && (!info?.reused || info.reused.comprehend || info.reused.lanes.length > 0);
    const inh = rt.inherit;
    const laneSpend: Record<string, number> = {};
    for (const [id, l] of Object.entries(info?.lanes ?? {})) laneSpend[id] = Number((l.spentUsd ?? 0).toFixed(4));
    const entry: LineageEntry = {
      v: 1, runId: run.id, ...(run.createdBy ? { createdBy: run.createdBy } : {}), createdAt: run.createdAt ?? now, finishedAt: now, status: 'complete',
      targets: rt.targets, repos: manifest.repos.map((r) => ({ fullName: r.fullName, dir: r.dir, ...(r.sha ? { sha: r.sha } : {}), ...(r.public ? { public: true } : {}) })),
      localDirs: manifest.localDirs.map((d) => ({ name: d.name, path: d.path, ...(d.files != null ? { files: d.files } : {}), ...(d.bytes != null ? { bytes: d.bytes } : {}), ...(d.hash ? { hash: d.hash } : {}) })),
      bundleIds: info?.bundleIds ?? [], invariantIds: run.invariantKeys ?? [], manualBundles: run.bundles && run.bundles.length ? run.bundles : null, planeFps: info?.planeFps ?? [],
      briefHash: briefHashOf(run.brief), inputsSig: rt.inputsSig, stageVersions: { ...CKPT_STAGE_VERSION },
      registryHash: reg.registryHash, bundleHashes: reg.bundleHashes, invariantHash: reg.invariantHash, codeHash: reg.codeHash,
      cuts, laneSpend, ...(info?.nodeSpend ? { nodeSpend: info.nodeSpend } : {}), totalSpend: Number(totalSpend.toFixed(4)),
      // A manual resume child continues its parent's chain; otherwise the chain grows by one per reuse.
      ...(inh ? { fullSpendUsd: inh.fullSpendUsd ?? Number(totalSpend.toFixed(4)), depth: inh.depth, lastFullAt: inh.lastFullAt }
        : { fullSpendUsd: reusedAny && b ? (b.fullSpendUsd ?? b.totalSpend) : Number(totalSpend.toFixed(4)), depth: reusedAny && b ? b.depth + 1 : 0, lastFullAt: reusedAny && b ? b.lastFullAt : now }),
      ...(inh?.baselineRunId ? { incremental: { baselineRunId: inh.baselineRunId, mode: 'resume' } } : b ? { incremental: { baselineRunId: b.runId, mode: reusedAny ? rt.plan.mode : 'full' } } : {}),
    };
    recordLineage(rt.orgKey, rt.targetKey, entry);
    // Org findings: every current row (new / persisting / changed / ruled-out) + the baseline rows now fixed.
    const stamp = { runId: run.id, at: now, ...(manifest.repos[0]?.sha ? { sha: manifest.repos[0].sha } : {}) };
    const out: RunFindingRow[] = [];
    rows.forEach((r, i) => {
      // GCP findings (deterministic IAM / BigQuery scans appended after the pipeline) are outside the since-last-scan
      // diff on both sides, so the Leadership counts never include them; recording them here as "new" on every run made
      // the store disagree with the brief. They are simply not tracked by this store.
      if (excludeFromDiff(r)) return;
      const st = r.ruledOut ? 'ruled-out' : (since?.statuses[i] ?? 'new');
      const pid = projectOf?.(r.path);
      out.push({ findingKey: r.key, title: r.title, severity: r.severity, status: st, bundleId: r.bundleId, ...(r.invariant ? { invariant: r.invariant } : {}), ...(r.path ? { evidencePath: r.path } : {}), ...(r.displayId ? { displayId: r.displayId } : {}), ...(pid ? { projectId: pid } : {}) });
    });
    const prevSeen = b ? { runId: b.runId, at: b.finishedAt, ...(b.repos[0]?.sha ? { sha: b.repos[0].sha } : {}) } : undefined;
    // A FIXED row has no current evidence: its project comes from the store record's evidencePath (resolved against
    // this workspace's registry), else the record's stored projectId, else the whole-workspace project (
    // `projectOf(undefined)` alone left every fixed row of a multi-repo workspace without a project).
    const prior = projectOf && since?.fixed.length ? new Map(listTargetFindings(rt.orgKey, rt.targetKey).map((r) => [r.findingKey, r])) : new Map();
    for (const f of since?.fixed ?? []) {
      const rec = prior.get(f.key);
      const pid = fixedRowProject(rec, projectOf);
      out.push({ findingKey: f.key, title: f.title, severity: f.severity, status: 'fixed', ...(rec?.evidencePath ? { evidencePath: rec.evidencePath } : {}), ...(prevSeen ? { prevSeen } : {}), ...(pid ? { projectId: pid } : {}) });
    }
    const saved = recordRunFindings(rt.orgKey, rt.targetKey, stamp, out);
    ctx.log(run, `run history: lineage entry recorded (${rt.plan.mode}${b ? ` vs ${b.runId}` : ''}) · org findings store ${saved.added} new · ${saved.updated} updated · ${saved.total} tracked`);
  } catch (e) { ctx.log(run, `run history: not recorded (${e instanceof Error ? e.message : String(e)})`); }
}

/** A lane snapshot's read-set fields (normalized) — what serializeLane stores next to the lane output. */
export type LaneReadFields = Partial<ReadSetSnapshot> & { spentUsd?: number; measuredAt?: string; ranAt?: string; reusedFrom?: string };
