// execute-org-run.ts — the org-run EXECUTION cluster, extracted VERBATIM from src/server.ts
// (run-extraction refactor, Phase B). Server-singleton deps (liveRun/pushLog/saveReport/… + the
// RUN_BUDGET envelope) are routed through the injected `RunContext` seam (./run-context.ts); every
// other dependency is imported DIRECTLY from its leaf module. NEVER value-import ../server.ts — only
// `import type` (fully erased at runtime, so this module boots no server). See run-context.ts header.

import { areaHealthThemes, buildExecutionModel, executionGroups, executionGroupsFor, type ExecutionModel } from '../executionModel.ts';
import { type Capability, type CapabilityAssignment, examinedCapabilityIds, parseCapabilities } from '../research/capabilities.ts';
import { buildExecutionAppendix } from '../executionAppendix.ts';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { localCopyFilter } from '../requestGuard.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type RunContext, runLedgerHooks } from './run-context.ts';
import type { Run, Source, ResumeSpec, LaneSnap } from '../server.ts';
import { type CkptId, type WorkspaceLocalPin, type WorkspaceManifest, type WorkspaceRepoPin, ckptRank, dirFingerprint, gitCheckoutSha, gitHeadSha } from '../checkpoints.ts';
import { cloneRepo, probeRepoAccess } from '../github.ts';
import { currentMemoryPush, memoryPushEnabled, withMemoryPush } from '../memory/push.ts';
import { currentMemoryRecall, withMemoryRecall } from '../memory/recall-tool.ts';
import { analyzeOrg } from '../org.ts';
import { execMemoryBrief, memoryCardLines, memoryEnabled, memoryRecallStatusLine } from '../orgMemory.ts';
import { orgIdForTenant } from '../localOrg.ts';
import { renderRecallReport } from '../recallReportHtml.ts';
import { AuditRecorder, currentAuditRecorder, withAuditContext, withAuditRun } from '../research/auditLog.ts';
import { type MeasurePlane, prefixBundle, rejectedToGaps } from '../research/auditPlan.ts';
import { BudgetLedger, currentLedger, leadershipAuthorAdmit, recordDegraded, reverifyAdmit, withBudgetLane, withBudgetNode, withRunBudget } from '../research/budget.ts';
import { ReadSetCollector, normalizeSnapshot, openedFromTrace, withReadSet } from '../research/readSet.ts';
import { carryHow, deltaLaneSplit, laneCandidates, mergeCarried, pendingIsSettled, pendingUncheckedWhy, priorKnownBlock, runCarryForward, type CarriedLane, type CarryNote, type InputIndex, type PendingFinding } from './carryForward.ts';
import { uncheckedBreakdown, uncheckedByWhy, type UncheckedWhy } from '../sinceLastScan.ts';
import { budgetLeftOpen, deltaEligibleLane, gitDiffPath, gitListFiles, incrSettings, laneIncompleteReason } from './incremental.ts';
import { claimAuditCarryLine, deltaFocusPaths, mergeDeltaLane, staleRevivedHypotheses , unionReadSets } from './deltaLane.ts';
import { reverifyFinding, reverifyLimits } from '../research/incrReverify.ts';
import { baselineCrossProjectTags, keyRowsFor, localNamesFor, prepareIncremental, recordRunHistory, sinceLastScanFor, withActivation, type IncrRuntime, type LaneReadFields, type LineageInfo } from './incrementalRun.ts';
import { RESTRICTED_PROJECT_LABEL, acrossProjectsInfo, comprehendEntityNames, commitRunFacts, crossProjectFindings, fillSiblingContrast, reapplyCrossProjectTags, githubFileAtSha, makeAccessChecker, precedentsFor, prepareRunFacts, projectResolverFor, registerCompletedRunProjects, runProjectIds, workspaceRepos, type CrossProjectTag, type PendingFacts } from './crossProject.ts';
import { currentContrastHolder, withContrastScope, type ContrastHolder } from '../memory/contrast.ts';
import { edgesForProjects, mergedProjectMap, type FactCard } from '../orgFacts.ts';
import { listProjects } from '../orgProjects.ts';
import { listOrgFindings } from '../orgFindings.ts';
import type { AcrossProjects } from '../reportAnchors.ts';
import { orgKeyFor } from '../scanLineage.ts';
import { claimAuditSurvivors, reverifyClaims, runClaimAudit } from '../research/claimAudit.ts';
import { comprehendNode } from '../research/comprehend.ts';
import { runCritique } from '../research/critique.ts';
import { type DeepSynthesis, type EvalToRun, type Mitigation, answerBackRows, deepAudit, hypothesesToFindings, synthesisOverview, synthesizeAudit } from '../research/deep.ts';
import { docRecoveryEnabled } from '../research/docRecovery.ts';
import { EXPERT_BUNDLES, type ExpertBundle, bundlesFor, resolveBundles, structuralChecksFor } from '../research/experts.ts';
import { ALL_INVARIANTS, INVARIANTS, type Invariant, RANKING_INVARIANTS } from '../research/invariants.ts';
import { isMeasurePlaneKind, type Hypothesis } from '../research/investigation.ts';
import { injectProvenance, measuredSplit, writeLeadershipReportHtml } from '../research/leadershipVibe.ts';
import { buildReportRefs, engineeringReportUrl, injectDetailIndex, isRuledOutFinding, rebindReportRefUrls, reinjectDetailIndex, stripDetailIndex } from '../reportAnchors.ts';
import { type LensOverride, labelFindings, leadershipLensFor, lensBriefFor, lensCountsOf } from '../findingLens.ts';
import type { LeadershipVariant } from '../research/leadershipWriter.ts';
import { type LeadershipWriterOpts, lensAnswerBack, lensAnswerBackFrom, lensSplitOn, writeLeadershipReport } from '../research/leadershipWriter.ts';
import { withMcpPolicy } from '../research/mcpPolicy.ts';
import { type ResearchFinding, research } from '../research/orchestrate.ts';
import { PLANE_EXPOSES, type PlaneInfo, withPlaneManifest } from '../research/planeManifest.ts';
import { runPreflight } from '../research/preflight.ts';
import { looksLikeRanking } from '../research/ranking.ts';
import { sanitizeReportInput } from '../research/reportEvidence.ts';
import { reportRedTeam } from '../research/reportRedTeam.ts';
import { withRunAbort } from '../research/runAbort.ts';
import { generateRunTitle } from '../research/runTitle.ts';
import { releaseLlmConcurrency, requestLlmConcurrency } from '../research/scheduler.ts';
import { runSynthesisClaimAudit } from '../research/synthesisClaimAudit.ts';
import { type AnswerBackRow, type AuditedClaim, type CoverageGap, type Finding, caveatedClaim, findingResolvesInWorkspace } from '../schema.ts';
import { evidenceFilePaths, findingKeys } from '../findingKey.ts';
import { buildCodeintelDigest, codeintelEnabled, makeCodeintelSource, prepareCodeintelIndex } from '../sources/codeintel.ts';
import { makeMcpSource } from '../sources/mcp.ts';
import { makeOsvSource } from '../sources/osv.ts';
import { persistableSource, rehydratePersistedSource } from '../sources/persist.ts';
import { makeRedisSource } from '../sources/redis.ts';
import { makeRepoGrepSource } from '../sources/repogrep.ts';
import { makeRepoMetaSource } from '../sources/repometa.ts';
import { type DataSource, mergeAgentTools } from '../sources/types.ts';
import { makeWarehouseSource } from '../sources/warehouse.ts';
import { makeBigQuerySource } from '../sources/bigquery.ts';
import { scopeSourcesToSelection } from './planeSelection.ts';
import { designEvolutionWarning, noteDegraded, workspaceHasGitHistory } from './degraded.ts';
import { findingCounts } from './findingCounts.ts';
import { findingCountCheck } from '../research/htmlQc.ts';
import { type UnreachableTarget, markCloneable, nothingAnalyzedMessage, resolveSelectedRepos } from './workspaceAccess.ts';
import { loadReport, reportExists } from '../store.ts';
import { buildLinkIndex, citedPaths, saveLinkIndexFile } from '../reportLinks.ts';
import { DEFAULT_SWEEP_BRIEF, FORCE_ALL_BUNDLES, LEADERSHIP_VARIANT, hasRealBrief, MAX_DOMAIN_BUNDLES, envMcpSources, escapeHtml, measurePlaneIdentities, osvPublicOnly } from './shared.ts';

// Operating-envelope caps — env-tunable (safe defaults; raise via env for a
// max-power local run). Budget admission stop (0.80) lives in budget.ts; concurrency in scheduler.ts.
const MAX_HYPOTHESES = Number(process.env.THERESA_MAX_HYPOTHESES) || 3;     // hypotheses measured per bundle
const TOP_N = Number(process.env.THERESA_TOPN) || 5;                        // findings per invariant investigation (baseline floor)

const INV_DIM: Record<string, Finding['dimension']> = {
  i1: 'product_metrics', i2: 'product_metrics', i3: 'product_metrics', i4: 'product_metrics', i5: 'product_metrics',
  i6: 'product_metrics', i7: 'product_metrics', i8: 'architecture', i9: 'architecture', i10: 'product_metrics', i11: 'security_supply',
  i12: 'architecture', i13: 'architecture', // ranking-infra durability / train-serve fidelity are infra-shaped
};


// Has the resume context a usable payload for this cut? (rank-gated AND actually loaded)
function rzHas(rz: ResumeSpec | undefined, id: CkptId): boolean {
  return Boolean(rz && ckptRank(rz.ckpt) >= ckptRank(id) && rz.data[id] !== undefined);
}

// One reused-stage log line. Reuses the existing `stage:<key>` anchor so the UI timeline
// advances unchanged; the `⟳ reused` marker is what the UI styles as a cached node.
function reusedLine(rz: ResumeSpec, stage: string, what: string): string {
  return `stage:${stage} · ⟳ reused from ${rz.parentLabel} @ ${rz.ckpt} — ${what} · $0`;
}

function orgVitals(orgMetrics: any): { summary: Record<string, unknown> } {
  const m = orgMetrics ?? {}; const s = m.summary ?? {}; const repos = (m.repos ?? []) as any[];
  const codeFiles = repos.reduce((a, r) => a + (r.codeFiles || 0), 0);
  const avgTest = repos.length ? repos.reduce((a, r) => a + (r.testRatio || 0), 0) / repos.length : 0;
  return { summary: { org: true, repos: s.repos ?? repos.length, commits: s.totalCommits ?? 0, people: s.people ?? 0, busFactor: s.orgBusFactor ?? 0, topContributorShare: 0, testRatio: avgTest, codeFiles, reposWithSecrets: s.reposWithSecrets ?? 0 } };
}

// Fork-aware contributor counting: a FORKED repo carries its full upstream
// history, so every upstream author would count as an org contributor. Build a basename→fork-date
// cutoff from the workspace's connected GitHub source(s) — analyzeOrg then counts only post-fork
// commits for those repos. Non-fork repos have no cutoff (all history counts). Generic: any fork
// with a known fork date works — no hardcoded repo/org/people. Empty map = today's behavior.
// Fork-date cutoffs for the repos THIS run actually scans, keyed by basename (what analyzeOrg keys on).
// The workspace clones a GitHub repo ONLY for an explicitly-SELECTED fullName (the clone gate is
// `run.repoFilter` non-empty — see executeOrgRun), so a fork cutoff must apply to exactly that selected set:
//   • an UNSELECTED fork `userA/foo` must not inject a `foo` cutoff onto a SELECTED non-fork `org/foo`
//     cloned to the same basename; and
//   • a null/empty repoFilter clones NO GitHub repos — a local-folder / public-URL-only run — so it returns
//     NO cutoffs, else a scanned local/giturl repo sharing a fork's basename would be wrongly filtered (r2).
// (Two SELECTED repos sharing a basename is a pre-existing workspace-clone collision, not disambiguable here.)
function forkCutoffsForRun(run: Run, ctx: RunContext): Record<string, string> {
  const cutoffs: Record<string, string> = {};
  const selected = run.repoFilter && run.repoFilter.length ? new Set(run.repoFilter) : null;
  if (!selected) return cutoffs;   // no GitHub repos cloned → no github fork cutoffs apply
  for (const s of ctx.sourcesFor(run)) {   // the run's OWN pinned snapshot (self-contained; never live t.sources)
    if (s.kind !== 'github') continue;
    for (const r of s.repos ?? []) {
      if (r.fork && r.forkedAt && selected.has(r.fullName)) cutoffs[r.fullName.split('/').pop()!] = r.forkedAt;
    }
  }
  return cutoffs;
}

// capabilityMap (report lens split Phase 2): Comprehend's capability map + every workspace file a lane OPENED (repo-
// normalized, readSet.ts `opened`) + what the hypotheses cite + the synthesis' capability assignments — so the final
// capability map, rebuilt after the GCP append, can tell examined from not and place every open question.
type OrgRunResult = { findings: Finding[]; metrics: any; costUsd?: number | null; coverageGaps?: CoverageGap[]; synthesisText?: string; answerBack?: AnswerBackRow[]; evalsToRun?: EvalToRun[]; execution?: ExecutionModel; lineage?: LineageInfo; lensOverrides?: LensOverride[]; capabilityMap?: { capabilities: Capability[]; openedPaths: string[]; hypotheses: { claim?: string; note?: string }[]; assignments?: CapabilityAssignment[] } };

async function orgDeterministic(run: Run, root: string, ctx: RunContext): Promise<OrgRunResult> {
  const org = await analyzeOrg(root, undefined, forkCutoffsForRun(run, ctx)); const m = org.metrics as any;
  ctx.log(run, `org evidence: ${m.summary.repos} repos · ${m.summary.reposWithSecrets} with secrets · org bus factor ${m.summary.orgBusFactor || 'not available'} · ${org.findings.length} findings · ${org.coverageGaps.length} open question(s)`);
  return { findings: org.findings as Finding[], metrics: m, coverageGaps: org.coverageGaps };
}

// What actually steers an investigation: the stated concern, or the standard sweep when there is no real
// one. Defined once because the INVARIANT FLOOR FALLBACK had been missed — orgAgentic's research() call
// still received `run.brief` and `scout: Boolean(run.brief)`, so a placeholder run that surfaced nothing
// re-entered the old placeholder-steered path, and a genuinely blank run lost the sweep entirely, while the
// log said the standard sweep was running. Two call sites reading one function cannot disagree about it.
function investigationBriefFor(brief: string | undefined): string | undefined {
  return hasRealBrief(brief) ? brief : DEFAULT_SWEEP_BRIEF;
}

async function orgAgentic(run: Run, root: string, ctx: RunContext): Promise<OrgRunResult> {
  ctx.log(run, 'building shared org map …');
  let orgContext: string | undefined;
  let orgMetrics: any = null;
  try { const org = await analyzeOrg(root, undefined, forkCutoffsForRun(run, ctx)); orgMetrics = org.metrics as any; const m = orgMetrics; orgContext = `Repos (${m.summary.repos}; ${m.summary.reposWithHistory} with history). Org bus factor ${m.summary.orgBusFactor}.`; }
  catch (e) { ctx.log(run, '(org map unavailable: ' + (e instanceof Error ? e.message : String(e)) + ')'); }
  const ds: DataSource[] = []; const planes: PlaneInfo[] = [];
  for (const s of ctx.sourcesFor(run)) {   // the run's OWN pinned snapshot (self-contained; never live t.sources)
    if (s.kind === 'warehouse' && s.saJson && s.status !== 'error') { ds.push(makeBigQuerySource({ saKey: s.saJson })); planes.push({ serverName: 'warehouse', kind: 'warehouse', exposes: PLANE_EXPOSES.warehouse }); }
    else if (s.kind === 'warehouse' && s.mcpUrl && s.status !== 'error') { ds.push(makeWarehouseSource({ mcpUrl: s.mcpUrl, mcpToken: s.mcpToken })); planes.push({ serverName: 'warehouse', kind: 'warehouse', exposes: PLANE_EXPOSES.warehouse }); }
  }
  const mcpServers = mergeAgentTools(ds).mcpServers;
  // This fallback rebuilds a TENANT-ONLY mcpServers set (no env planes, no redis/generic). It runs INSIDE
  // orgCritiqueExpert's withPlaneManifest, so it must enter its OWN manifest (matching what it actually mounts)
  // — otherwise planeHints would advertise env Amplitude/dashboard planes the floor-scan agents don't have.
  const floorPlanes = planes.filter((p) => mcpServers && Object.hasOwn(mcpServers, p.serverName));
  // Invariant set: the UI selection if the user picked any; otherwise auto — all general invariants, plus
  // the ranking-infra ones (i12/i13) when the org's code/brief looks like a recsys system.
  const invariants = run.invariantKeys && run.invariantKeys.length
    ? ALL_INVARIANTS.filter((i) => run.invariantKeys!.includes(i.key))
    : (looksLikeRanking(run.brief, orgContext) ? [...INVARIANTS, ...RANKING_INVARIANTS] : INVARIANTS);
  ctx.log(run, `invariants: ${invariants.map((i) => i.key).join(', ')}${run.invariantKeys ? ' (selected in UI)' : (invariants.length > INVARIANTS.length ? ' (auto — recsys signals → +i12/i13)' : ' (auto)')}`);
  // Anchored markers so the pipeline graph also advances on this floor-scan path (it's the fail-open
  // fallback from orgCritiqueExpert; the invariant investigation maps to the expert node, then synthesize).
  ctx.log(run, `stage:expert · invariant floor scan — investigating ${invariants.length} invariants · budget $${ctx.runBudget} · warehouse=${mcpServers ? 'on' : 'off'}`);
  if (ctx.live(run).authToken) ctx.log(run, `running on your Claude ${ctx.live(run).authToken!.startsWith('sk-ant-oat') ? 'subscription' : 'API key'} (pasted credential)`);
  const result = await withPlaneManifest(floorPlanes, () => research({ root, scopeDesc: 'all git repos under this directory, considered as one organization.', invariants, orgContext, userBrief: investigationBriefFor(run.brief), scout: hasRealBrief(run.brief), mcpServers, authToken: ctx.live(run).authToken, maxTurns: 18, topN: TOP_N, verify: true, budgetUsd: ctx.runBudget, log: (mm) => ctx.log(run, mm) }));
  // archive the dimensions minted from the brief + how each concern mapped (non-secret; persisted with run history for reproducibility)
  run.derivedDimensions = result.derivedDimensions; run.coverage = result.coverage;
  const findings = researchToFindings(result.confirmed);
  ctx.log(run, `stage:synthesize · synthesized · ${result.candidates.length} candidates → ${result.confirmed.length} confirmed · ≈$${result.costUsd.toFixed(2)}`);
  ctx.log(run, `stage:findings · assembling ${findings.length} finding(s) + ${result.coverageGaps?.length ?? 0} coverage gap(s) from the floor scan`);
  // Return the deterministic org map alongside the agentic findings so the report's
  // Organization vitals (repos, people, commits, bus factor, code files, test ratio)
  // are populated. The agentic layer supplies findings; these vitals come from the
  // org map computed above — without this they fall back to zeros (UI looked
  // disconnected from the data: 23 findings but every vital 0/—).
  // A brief-bearing run that falls back to this floor scan still gets its answer-back,
  // built from the same evidence-gated findings + structured gaps research() returned.
  const answerBack = hasRealBrief(run.brief) ? answerBackRows(findings, result.coverageGaps ?? []) : undefined;
  return { findings, metrics: orgMetrics, costUsd: result.costUsd, coverageGaps: result.coverageGaps, answerBack };
}

// Map research()'s confirmed ResearchFindings → the shared Finding contract (shared by the floor-scan
// fallback + the baseline floor lane). u1..uN (user-derived) have no INV_DIM entry → fall back to the
// product_metrics lens for grouping (provenance carried by the UserDerived badge, not the lens).
function researchToFindings(confirmed: ResearchFinding[]): Finding[] {
  return confirmed.map((f, i) => ({
    id: `${f.invariant.toUpperCase()}-${String(i + 1).padStart(2, '0')}`, dimension: INV_DIM[f.invariant] ?? 'product_metrics',
    title: f.title, claim: f.claim, evidence: (f.evidence ?? []).map((e) => ({ kind: 'computation' as const, ref: e.ref, detail: e.detail })),
    businessImpact: f.businessImpact, recommendation: f.recommendation, severity: f.severity as Finding['severity'],
    confidence: f.confidence as Finding['confidence'], effort: f.effort as Finding['effort'], source: f.focus || 'research', invariant: f.invariant,
  }));
}

// BASELINE FLOOR LANE — the always-on data-trust floor. It runs the invariant scan via
// research() over the baseline bundle's structural checks (the 11 invariants), NOT deepAudit: deepAudit
// is forced-mode metric-triage and the baseline has no metric library, so it silently inherited the
// recsys library (a real bug). research() returns evidence-backed Findings + STRUCTURED coverage gaps,
// already in the shared contract — so the baseline merges with the domain lanes without faking a
// Hypothesis. Runs inside the caller's 'bundle' budget node (cost attributed; admission-gated). Read-only.
async function runBaselineFloor(run: Run, root: string, invariants: Invariant[], orgContext: string | undefined, mcpServers: Record<string, unknown> | undefined, budgetUsd: number, blog: (m: string) => void, ctx: RunContext): Promise<{ findings: Finding[]; gaps: CoverageGap[] }> {
  blog(`stage:critique · baseline floor — invariant scan (research, not deepAudit) over ${invariants.length} invariant(s)`);
  const result = await research({
    root, scopeDesc: 'all git repos under this directory, considered as one organization (data-trust floor).',
    invariants, orgContext, userBrief: investigationBriefFor(run.brief), scout: hasRealBrief(run.brief), mcpServers, authToken: ctx.live(run).authToken,
    maxTurns: 18, topN: TOP_N, verify: true, budgetUsd, log: blog,
  });
  const findings = researchToFindings(result.confirmed);
  const gaps = (result.coverageGaps ?? []).map((g) => ({ ...g, bundleId: 'baseline' }));
  blog(`stage:expert · baseline floor: ${findings.length} finding(s) + ${gaps.length} coverage gap(s)`);
  return { findings, gaps };
}

// LaneSnap ↔ BundleOut: the live ExpertBundle object is revived from the registry (null when the
// bundle is no longer registered — the resume validator rejects that upfront; this is the backstop).
// The lane's incremental-re-scan fields (read set, spend, when it ran / measured, carried-from) ride along verbatim.
type LaneOut = { bundle: ExpertBundle; hypotheses: Hypothesis[]; mitigations: Mitigation[]; findings: Finding[]; gaps: CoverageGap[]; trace: string; toolTally: Record<string, number>; areaReportHtml?: string; evalsToRun?: EvalToRun[] } & LaneReadFields;
const READ_FIELDS = ['readSet', 'globs', 'greps', 'opaque', 'measured', 'opened', 'spentUsd', 'measuredAt', 'ranAt', 'reusedFrom'] as const;
function readFieldsOf(x: LaneReadFields): LaneReadFields {
  const o: Record<string, unknown> = {};
  for (const k of READ_FIELDS) if (x[k] !== undefined) o[k] = x[k];
  return o as LaneReadFields;
}
function serializeLane(x: LaneOut): LaneSnap {
  return { bundleId: x.bundle.id, title: x.bundle.title, hypotheses: x.hypotheses, mitigations: x.mitigations, findings: x.findings, gaps: x.gaps, trace: x.trace, toolTally: x.toolTally, areaReportHtml: x.areaReportHtml, evalsToRun: x.evalsToRun, ...readFieldsOf(x) };
}

function reviveLane(snap: LaneSnap): LaneOut | null {
  const b = EXPERT_BUNDLES.find((bb) => bb.id === snap.bundleId);
  if (!b) return null;
  return { bundle: b, hypotheses: snap.hypotheses ?? [], mitigations: snap.mitigations ?? [], findings: snap.findings ?? [], gaps: snap.gaps ?? [], trace: snap.trace ?? '', toolTally: snap.toolTally ?? {}, areaReportHtml: snap.areaReportHtml, evalsToRun: snap.evalsToRun, ...readFieldsOf(snap) };
}

// `ws` (incremental re-scan): the fresh workspace manifest, so each lane's recorded read set is normalized to repo
// identities (`owner/name/<path>`) that compare against a later run's git diff whatever workspace dir that run picks.
async function orgCritiqueExpert(run: Run, root: string, ctx: RunContext, ws?: { manifest: WorkspaceManifest; sibling?: { holder: ContrastHolder; canAccess: (f: FactCard) => Promise<boolean> } }): Promise<OrgRunResult> {
  // NODE-PER-AGENT pipeline — every node is an INDEPENDENT runAgent (a fresh Agent-SDK query, discarded
  // when it returns); nodes pass only structured data downstream. Shape:
  //   Comprehend agent → per-bundle PARALLEL [ Critic agent → Expert agent ] → Synthesis agent → Findings → Report agent
  // CHECKPOINT/RESUME: each boundary below writes a durable cut (saveRunCheckpoint); a CHILD run carries
  // liveRun(run).resumeSpec and REPLAYS every cut ≤ the resume point instead of executing it (emitting `⟳ reused`
  // stage lines so the UI timeline advances and styles the node as cached).
  const rz = ctx.live(run).resumeSpec;
  const rzComp = rzHas(rz, 'comprehend') ? rz!.data.comprehend : undefined;
  // ── stage:comprehend — a Comprehend agent explores code + GCP + warehouse + Slack, classifies the
  //    system, and CHOOSES which expert bundles to activate (baseline always on + the domain ones). ──
  ctx.log(run, 'stage:comprehend · mapping the org and classifying the system …');
  let orgContext: string | undefined; let orgMetrics: any = null;
  if (rzComp) { orgMetrics = rzComp.orgMetrics ?? null; orgContext = rzComp.orgContext; }
  else {
    try { const org = await analyzeOrg(root, undefined, forkCutoffsForRun(run, ctx)); orgMetrics = org.metrics as any; const m = orgMetrics; orgContext = `Repos (${m.summary.repos}; ${m.summary.reposWithHistory} with history). Org bus factor ${m.summary.orgBusFactor}.`; }
    catch (e) { ctx.log(run, '(org map unavailable: ' + (e instanceof Error ? e.message : String(e)) + ')'); }
  }

  const srcSet = ctx.sourcesFor(run);   // the run's OWN pinned source snapshot (self-contained; never live t.sources)
  // RUN-LOCAL source list: the run's pinned sources + any env-mounted MCP planes. envMcpSources()
  // is a no-op unless THERESA_OPERATOR_MCP_PLANES=1, so this is identical to the run's sources on a normal install.
  const envPlanes = envMcpSources();
  if (envPlanes.length) ctx.log(run, `⚠ env MCP planes mounted (THERESA_OPERATOR_MCP_PLANES): ${envPlanes.map((s) => s.mcpName).join(', ')} — local machine only`);
  const runSources = [...srcSet, ...envPlanes];
  // RESUME plane pinning: when the comprehend payload is REUSED, mount ONLY the
  // measure planes the PARENT mounted (matched by identity fingerprint) — an EXTRA plane connected
  // since would let a re-running lane measure evidence the cached lanes never saw (the "same planes"
  // guarantee is exact-set, not subset). Missing planes are already rejected fail-closed at POST.
  const allowedPlaneFps = rzComp ? new Set((((rzComp.planes ?? []) as { fp?: string }[]).map((p) => p.fp).filter(Boolean)) as string[]) : null;
  const identBySrcId = new Map(measurePlaneIdentities(runSources).map((e) => [e.srcId, e]));
  const resumeSkipsPlane = (s: Source): boolean => {
    if (!allowedPlaneFps) return false;
    const ident = identBySrcId.get(s.id);
    if (!ident || allowedPlaneFps.has(ident.fp)) return false;
    ctx.log(run, `⟳ resume: skipping ${ident.serverName} (${ident.kind}) — not part of the parent run's mounted plane set`);
    return true;
  };
  // ── codeintel plane (repowise, gated THERESA_CODEINTEL=1): index the freshly-cloned workspace ONCE
  //    (deterministic, index-only — no LLM, no key; fail-open), then (a) mount `repowise mcp` as a read-only
  //    stdio plane for Comprehend/Critique/Expert, and (b) feed the deterministic cross-repo digest
  //    (co-change / shared tables / cycles / per-repo health) to each bundle's Critique + Preflight as
  //    `gitContext` — the console org-run previously passed none (only the CLI pre-computed a git digest).
  //    A RESUMED child rebuilds the workspace from the manifest, so the index is simply recomputed —
  //    derived data, no checkpoint stage of its own. ──
  let codeintelDigest: string | undefined;
  // Availability gate (THERESA_CODEINTEL) AND the per-run toggle (default ON when available; false = opt-out).
  const codeintelIdx = (codeintelEnabled() && run.codeintel !== false)
    ? await prepareCodeintelIndex(root, (m) => ctx.log(run, `stage:comprehend · [codeintel] ${m}`), ctx.live(run).abort?.signal)
    : null;
  if (codeintelIdx) {
    // buildCodeintelDigest is pure file I/O over an external tool's output — wrap it so a schema drift
    // that slips past the in-function guards degrades to "no digest", never sinks the run.
    try { codeintelDigest = buildCodeintelDigest(root); }
    catch (e) { ctx.log(run, `⚠ [codeintel] digest build failed (${e instanceof Error ? e.message : String(e)}) — continuing without a digest`); }
    if (codeintelDigest) ctx.log(run, `stage:comprehend · [codeintel] digest ready (${codeintelDigest.length} chars) — seeding Critique/Preflight`);
  }
  const codeintelSeeded = Boolean(codeintelDigest);
  // Resume comparability: cached lanes were (or weren't) codeintel-seeded by the PARENT;
  // a child that actually produced a DIFFERENT seeding state re-runs its lanes on differently-seeded
  // critiques. Compare on whether a digest was produced (not just the flag), so parent-true-but-no-digest
  // vs child-true-with-digest is caught. The digest is lead-generation only (every finding still passes
  // the evidence contract + measurement), so a mismatch is a LOUD warning, not fail-closed — unlike
  // measure planes, which stay exact-set-matched.
  if (rzComp && typeof rzComp.codeintel === 'boolean' && rzComp.codeintel !== codeintelSeeded) {
    // codeintel is now also a MEASURE plane (code-native bundles), so a mismatch means re-run lanes may bind
    // codeintel measurements the reused lanes never could (or vice versa) — still warn-not-fail: the index is
    // derived data recomputed deterministically from the pinned repos@SHA manifest, so same-availability runs
    // measure identically, and the mismatch is visible here + in the audit log's mounted-planes panel.
    ctx.log(run, `⚠ codeintel is ${codeintelSeeded ? 'ON' : 'OFF'} but the parent run had it ${rzComp.codeintel ? 'ON' : 'OFF'} — re-run lanes ${codeintelSeeded ? 'see seeded critiques + can bind codeintel measurements' : 'see unseeded critiques + cannot bind codeintel measurements'}; reused lanes keep the parent's state`);
  }
  const ds: DataSource[] = []; const planes: PlaneInfo[] = []; let hasWh = false, hasKv = false;
  if (codeintelIdx) { ds.push(makeCodeintelSource(root)); planes.push({ serverName: 'codeintel', kind: 'codeintel', exposes: PLANE_EXPOSES.codeintel }); }
  for (const s of runSources) {
    if (s.kind === 'warehouse' && s.saJson && s.status !== 'error' && !resumeSkipsPlane(s) && !hasWh) { ds.push(makeBigQuerySource({ saKey: s.saJson })); hasWh = true; planes.push({ serverName: 'warehouse', kind: 'warehouse', exposes: PLANE_EXPOSES.warehouse }); }
    else if (s.kind === 'warehouse' && s.mcpUrl && s.status !== 'error' && !resumeSkipsPlane(s) && !hasWh) { ds.push(makeWarehouseSource({ mcpUrl: s.mcpUrl, mcpToken: s.mcpToken })); hasWh = true; planes.push({ serverName: 'warehouse', kind: 'warehouse', exposes: PLANE_EXPOSES.warehouse }); }
    if (s.kind === 'keyvalue' && s.mcpUrl && s.status !== 'error' && !resumeSkipsPlane(s)) { ds.push(makeRedisSource({ mcpUrl: s.mcpUrl, mcpToken: s.mcpToken })); hasKv = true; planes.push({ serverName: 'redis', kind: 'keyvalue', exposes: PLANE_EXPOSES.keyvalue }); }
    // Generic read-only MCP planes: Amplitude (analytics) / a dashboard MCP (bi) / any company MCP (custom).
    // allowedTools (when set) becomes the host-side read-only tool allowlist enforced by canUseTool via withMcpPolicy.
    // Skip an 'error' source (a profile-restored coords-only plane awaiting a token reconnect) — mounting it would
    // be token-less and just 401; once reconnected it flips to 'ready'.
    if ((s.kind === 'analytics' || s.kind === 'bi' || s.kind === 'custom') && s.mcpUrl && s.mcpName && s.status !== 'error' && !resumeSkipsPlane(s)) {
      const mcpToken = s.mcpToken;
      ds.push(makeMcpSource({ kind: s.kind, name: s.name, mcpUrl: s.mcpUrl, mcpToken, mcpName: s.mcpName, allowedTools: s.allowedTools }));
      planes.push({ serverName: s.mcpName, kind: s.kind, exposes: s.exposes || `read-only ${s.kind} plane` });
    }
  }
  // On-demand repo-grep plane: read-only REST-API reader so the comprehend/critic/expert agents can reach org
  // repos NOT in the mounted clone (e.g. acme/mobile-app). PER-ORG credential — THIS org's connected github
  // source token.
  // defaultOrg derived from the source's repos. No clone. (repogrep)
  const ghRepoSrc = srcSet.find((s) => s.kind === 'github');
  if (ghRepoSrc) {
    ds.push(makeRepoGrepSource({
      getToken: async () => tokenForRun(ghRepoSrc),
      defaultOrg: ghRepoSrc.repos?.[0]?.fullName?.split('/')[0],
    }));
    planes.push({ serverName: 'repogrep', kind: 'repo', exposes: PLANE_EXPOSES.repogrep });
  }
  // On-demand repo-METADATA plane (repometa): read-only GitHub REST metadata — CI workflow-run history,
  // check conclusions at a ref, releases/tags with dates, commit-log metadata, PR merge metadata. This is the
  // code-native MEASUREMENT plane the release-eng / swe-arch bundles compute on (CI pass rate, retry-to-green,
  // merge-gate integrity, post-release regression density, release cadence, ownership concentration) — the
  // warehouse-equivalent for a code-only project. Mounts whenever the run can reach ANY GitHub repo: with the
  // org's github credential when connected (same lazy token path as repogrep), else TOKENLESS for public
  // giturl repos (the API serves public-repo metadata unauthenticated at a tight per-IP budget — the tools
  // tell the agent to batch). Unlike repogrep this IS a MeasurePlane (kind 'repometa' is in MEASURE_KIND).
  const giturlMetaSrc = srcSet.find((s) => s.kind === 'giturl');
  // Driving source = github first, else giturl — MUST mirror measurePlaneIdentities' (ghSrc ?? guSrc) choice so
  // resumeSkipsPlane keys on the same srcId. A resumed child whose parent never mounted repometa (a pre-repometa
  // checkpoint, or the credential identity changed) skips the mount — the exact-set plane continuity contract.
  // LEAST-PRIVILEGE token decision: the org GitHub credential rides ONLY when the run actually
  // scans authenticated github repos (run.repoFilter non-empty). A PUBLIC-URL-ONLY run (giturl selection, even
  // with a GitHub source connected on the tenant) stays TOKENLESS — the no-auth public-URL contract holds and
  // the agent cannot reach private org metadata from a run scoped to public repos. (repogrep is different by
  // design: it exists to reach org repos outside the clone, so it keeps the org credential.)
  const repometaUsesGh = Boolean(ghRepoSrc && run.repoFilter && run.repoFilter.length);
  const repometaDriver = repometaUsesGh ? ghRepoSrc : giturlMetaSrc;
  // The repometa IDENTITY (measurePlaneIdentities) is keyed to the github source when one exists — check the
  // resume guard on BOTH candidates so a giturl-driven mount still honors the parent's exact plane set
  // (resumeSkipsPlane is false for a source with no identity entry, so this stays precise).
  const repometaResumeSkip = [ghRepoSrc, giturlMetaSrc].some((s) => s && resumeSkipsPlane(s));
  if (repometaDriver && !repometaResumeSkip) {
    const metaRepos = [
      ...(repometaUsesGh ? (run.repoFilter ?? []) : []),
      ...(run.giturlFilter ?? (giturlMetaSrc?.giturlRepos ?? []).map((r) => r.fullName)),
    ];
    ds.push(makeRepoMetaSource({
      getToken: repometaUsesGh && ghRepoSrc
        ? async () => tokenForRun(ghRepoSrc)
        : async () => undefined,
      defaultRepos: metaRepos.slice(0, 20),
      // ALLOWLIST (security): scope every tool call to THIS run's target repos, so the org PAT can't be
      // steered (prompt injection / mistaken call) into reading metadata for other private org repos it can
      // reach — defaultRepos is only a hint, this is the enforced boundary.
      allowRepos: metaRepos,
    }));
    planes.push({ serverName: 'repometa', kind: 'repometa', exposes: PLANE_EXPOSES.repometa });
  }
  // OSV advisory plane (appsec bundle): public, read-only, credential-less known-vuln lookup for the LOCKED
  // dependency versions the Expert resolves from the clone's lockfiles. PRIVACY GATE: querying
  // OSV posts {ecosystem, name, version} coordinates to a third party — that inventory is PUBLIC by construction
  // for a public-URL (giturl) target, but for a private org's lockfiles it is proprietary metadata. So the plane
  // mounts only when the run's scan targets include PUBLIC giturl repos, or the user explicitly opts a
  // private project in via THERESA_OSV=1. Its OWN kind 'osv' (a real MeasurePlane) — NOT
  // 'custom' — so the generic requiresPlane:'custom' lint can't route to it and its availability never fakes a
  // custom MCP. DERIVED (no connected Source) → deliberately outside the checkpoint
  // plane-identity fingerprint, like codeintel; availability is deterministic given the same inputs + env.
  // PUBLIC-ONLY scope via the SHARED osvPublicOnly predicate (see its comment for the full threat model:
  // mixed workspaces, credentialed repogrep, private data planes). THERESA_OSV=1 is the
  // explicit private-repo opt-in — PROCESS-WIDE, so it is a LOCAL-MACHINE env (boot WARN lists it, same
  // class as THERESA_LOCAL_AUDIT). Default = public-only.
  // RACE-FREE mutual exclusion with injected org-memory: the memory-suppression decision
  // (executeOrgRun) and this mount read the source list at DIFFERENT moments, so a private source
  // disconnecting in between could inject memory yet still qualify as public-only here. Gate the AUTO path on
  // the ACTUAL in-scope memory — BOTH the withMemoryPush ALS (the injected brief) AND the withMemoryRecall ALS
  // (the memory_recall puller, active even when the push block is empty) this run executes inside — not a second
  // source snapshot: on the auto public path OSV never mounts while org-memory (push OR pull) is present, whatever the sources did
  // between the two reads. THERESA_OSV=1 is the explicit opt-in on a local machine, where its own
  // org's memory may coexist by the accepted posture — so it is not gated on memory.
  // The same race-free rule for sibling CONTRAST: the auto path mounts only when no contrast holder is in
  // scope or the one in scope is PUBLIC-ONLY (facts of public repos only).
  const inScopeContrast = currentContrastHolder();
  const osvAllowed = osvPublicOnly(run, runSources) ? (!currentMemoryPush() && !currentMemoryRecall() && (!inScopeContrast || inScopeContrast.publicOnly === true)) : process.env.THERESA_OSV === '1';
  if (osvAllowed) {
    ds.push(makeOsvSource());
    planes.push({ serverName: 'osv', kind: 'osv', exposes: PLANE_EXPOSES.osv });
  }
  const merged = mergeAgentTools(ds, (m) => ctx.log(run, m));   // warn+skip a duplicate MCP server name
  const mcpServers = merged.mcpServers;
  // The manifest = exactly the servers that actually merged in, FIRST occurrence only — mergeAgentTools keeps the
  // first source of a duplicate name and warn-skips the rest, so we must also drop the later PlaneInfo(s) for that
  // name (else a skipped source's `exposes` would describe a plane the agent never got).
  const runPlanes: PlaneInfo[] = []; const seenPlane = new Set<string>();
  for (const p of planes) {
    if (mcpServers && Object.hasOwn(mcpServers, p.serverName) && !seenPlane.has(p.serverName)) { seenPlane.add(p.serverName); runPlanes.push(p); }
  }
  // OSV truth = the MERGED outcome, not the predicate: a user custom MCP that happens to be
  // named `osv` wins the mergeAgentTools name race, so the built-in is skipped and kind 'osv' never lands in
  // runPlanes — the checkpoint boolean + the resume parity must record what actually mounted, or a child would
  // fail/pass the gate against fiction. (osvAllowed still gates the ATTEMPT above.)
  const osvMounted = runPlanes.some((p) => p.kind === 'osv');
  if (osvAllowed && !osvMounted) ctx.log(run, '⚠ the OSV advisory plane did not mount (a connected MCP already uses the server name `osv`) — appsec known-vuln metrics will defer');
  // Resume comparability warn (fail-closed enforcement lives in the resume POST gate; this covers a parent
  // predating the gate, or a name-collision divergence the gate could not predict): reused lanes keep the
  // parent's state, re-run lanes see the CURRENT plane set.
  if (rzComp && typeof (rzComp as { osv?: unknown }).osv === 'boolean' && (rzComp as { osv?: boolean }).osv !== osvMounted) {
    ctx.log(run, `⚠ the OSV advisory plane is ${osvMounted ? 'ON' : 'OFF'} but the parent run had it ${(rzComp as { osv?: boolean }).osv ? 'ON' : 'OFF'} — re-run lanes ${osvMounted ? 'can' : 'cannot'} bind known-vuln measurements; reused lanes keep the parent's state`);
  }
  // The Expert MEASURE + reverify steps route to the MEASURE-CAPABLE planes (opened from warehouse/
  // keyvalue-only to also include analytics / bi / custom; only non-data planes like slack are excluded). The
  // measure registry (`measurePlanes`) is passed to Preflight + deepAudit + reverify so each describes the planes
  // + the planner sets requiresPlane to a mounted kind. Prompt-only scoping is NOT a boundary — so the measure
  // steps also get a SCOPED mcpServers map (`measureServers`, just these planes), keeping non-data MCPs (slack)
  // out of measurement; the broad scans (comprehend/critique) keep the FULL map.
  // The measure-capable plane KINDS (every MeasurePlane except 'none'; the non-data 'slack' isn't a MeasurePlane
  // at all). A keyed map (not an array) so the COMPILER forces a decision on every future MeasurePlane member:
  // add a kind to the union and this `Record` is missing a key → type error (vs an array, where a new kind would
  // be silently fail-closed-dropped from measurement). The guard narrows PlaneInfo.kind (string) → MeasurePlane,
  // so no cast is needed downstream.
  // The canonical set lives next to the MeasurePlane type now (research/investigation.ts), because this
  // list and the provenance classifier were maintained separately and disagreed — the classifier let
  // `slack` claim a live measurement while this router correctly excluded it. Same Record, both callers.
  const isMeasureKind = (k: string): k is MeasurePlane => isMeasurePlaneKind(k);
  const measurePlanes = runPlanes.filter((p): p is PlaneInfo & { kind: MeasurePlane } => isMeasureKind(p.kind));
  const mountedPlaneKinds = new Set<MeasurePlane>(measurePlanes.map((p) => p.kind));
  const measurePlaneNames = new Set(measurePlanes.map((p) => p.serverName));
  // repogrep (kind:'repo') is a read-only REFERENCE reader, not a MeasurePlane — but the scoped measure/Expert +
  // area-report session should still reach repos OUTSIDE the mounted clone (the motivating case), so fold repo
  // planes into the measure map too, even though they don't participate in datapoint planning/requiresPlane.
  // codeintel used to be the same class — the code-native bundles PROMOTED it (and repometa) to a real
  // MeasurePlane (dependency-graph / hotspot / CI-history metrics are measurements), so those now flow in via
  // measurePlaneNames above; only repogrep remains reference-only.
  const refPlaneNames = new Set(runPlanes.filter((p) => p.kind === 'repo').map((p) => p.serverName));
  // Normalize to `undefined` when no measure plane is mounted: an empty {} is truthy, and reverifyClaims only
  // truthiness-checks mcpServers — {} would spin up tool-less reverify agents instead of a clean tool-free pass.
  const measureEntries = mcpServers ? Object.entries(mcpServers).filter(([k]) => measurePlaneNames.has(k) || refPlaneNames.has(k)) : [];
  const measureServers = measureEntries.length ? Object.fromEntries(measureEntries) : undefined;
  // Audit log: record the mounted MCP planes UP FRONT (not an afterthought) so the audit HTML's
  // "mounted but 0 calls" panel has its baseline = the acceptance test for "did this source enter the pipeline".
  currentAuditRecorder()?.noteMountedServers(Object.keys(mcpServers ?? {}));
  // Read-only guard: carry the per-server tool allowlist for the WHOLE pipeline via the run-scoped ALS
  // (no per-wrapper threading) — runAgent's canUseTool then denies any non-allowlisted tool from a policy-bearing
  // MCP. No-op when no source declared an allowlist (our own read-only MCPs trust the whole server). The rest of
  // orgCritiqueExpert runs inside this context. withPlaneManifest carries the mounted planes' descriptions
  // so every broad-scan prompt (comprehend/critique/scout/derive/investigate/verify) describes each plane correctly
  // instead of calling every MCP "warehouse SQL".
  return withPlaneManifest(runPlanes, () => withMcpPolicy(merged.mcpToolPolicy, async () => {

  let gcpInv: string | undefined;
  if (rzComp) gcpInv = rzComp.gcpInv;

  // THE INVESTIGATION BRIEF. A real stated concern steers the run; a blank or placeholder one gets the
  // standing sweep instead of nothing. This is what reaches classification, bundle choice, critique,
  // preflight and measurement — the only places a brief can change what is FOUND.
  // It is NOT used for the answer-back section or as the report's inquiry: those speak for the reader,
  // and the reader did not ask this.
  const briefIsReal = hasRealBrief(run.brief);
  const investigationBrief = investigationBriefFor(run.brief);
  if (!briefIsReal) ctx.log(run, `stage:comprehend · no question supplied${run.brief ? ` ("${String(run.brief).slice(0, 24)}" is a placeholder)` : ''} — running the standard defect sweep (access · data trust · change safety · cost)`);
  const ranking = rzComp ? Boolean(rzComp.ranking) : looksLikeRanking(run.brief, orgContext);
  // MANUAL bundle selection (UI): the user explicitly picked which bundles to run. Honor EXACTLY that set and SKIP
  // Comprehend entirely — Comprehend's output beyond the bundle choice (companyType/systems/kpis/rationale) is
  // informational-only and never consumed downstream, so skipping saves its LLM cost + latency with no functional loss.
  // An empty / all-invalid selection is treated as "no manual selection" → the normal Comprehend path. (baseline still
  // rides via resolveBundles; the domain-count cap is bypassed below since the human deliberately chose the set.)
  const manualIds = (run.bundles ?? []).filter((id) => EXPERT_BUNDLES.some((b) => b.id === id));
  // FORCE_ALL_BUNDLES (env, documented full sweep) OUTRANKS a UI pick — in a force-all environment a manual
  // selection must not silently downgrade the run to a subset. So manual mode only applies when NOT force-all.
  const manual = manualIds.length > 0 && !FORCE_ALL_BUNDLES;
  // Comprehend AGENT (node 1) — SKIPPED for a manual selection (and for FORCE_ALL_BUNDLES). Otherwise fail-open: on
  // failure, fall back to the deterministic keyword bundle match.
  let comp: Awaited<ReturnType<typeof comprehendNode>> = null;
  if (!rzComp && !manual && !FORCE_ALL_BUNDLES) {
    try { comp = await comprehendNode({ root, scopeDesc: 'the system(s) under this directory', orgContext, gcpInventory: gcpInv, brief: investigationBrief, mcpServers, authToken: ctx.live(run).authToken, log: (m) => ctx.log(run, m) }); }
    catch { comp = null; }
  }
  // The chosen bundle ids in PRIORITY order — the manual selection, else Comprehend's own ordering (its prioritization)
  // when it ran, else the ranking/keyword fallback. Kept because resolveBundles() re-sorts to registry order
  // (EXPERT_BUNDLES), which is NOT the agent's priority — the "top N domain" cap below must rank against
  // THIS list, not the resolved order, or it could drop the agent's top pick.
  const chosenIds: string[] = rzComp
    ? (rzComp.bundleIds as string[])                                   // resume: the parent's FINAL (already-capped) activation, replayed verbatim
    : manual
      ? manualIds                                                      // manual: run EXACTLY these (Comprehend skipped)
      : FORCE_ALL_BUNDLES
        ? EXPERT_BUNDLES.map((b) => b.id)                              // force-all: every registered bundle, Comprehend bypassed
        : comp
          ? comp.activatedBundles.map((b) => b.id)
          : (ranking ? ['recsys-mle'] : bundlesFor(run.targetName, investigationBrief, orgContext).map((b) => b.id));
  if (rzComp) ctx.log(run, reusedLine(rz!, 'comprehend', `${rzComp.companyType ?? 'classification'} · bundles: ${chosenIds.join(', ')}`));
  else if (manual) ctx.log(run, `stage:comprehend · manual bundle selection (${manualIds.join(', ')}) — Comprehend skipped, envelope cap bypassed`);
  else if (FORCE_ALL_BUNDLES) ctx.log(run, `stage:comprehend · FORCE_ALL_BUNDLES — running every registered bundle (${chosenIds.join(', ')}), Comprehend selection + envelope cap bypassed`);
  // ranking-looking org but recsys-mle wasn't chosen → lead with it (the deep, validated bundle). NOT for a manual
  // selection: the user's explicit set is honored verbatim (never inject a bundle they didn't pick).
  if (!rzComp && !manual && ranking && !chosenIds.some((id) => id.toLowerCase() === 'recsys-mle')) chosenIds.unshift('recsys-mle');
  // Who forces the always-on baseline floor: ONLY the keyword/ranking FALLBACK (Comprehend failed → keep the floor as a
  // safety default). When Comprehend RAN, its choice governs baseline (it's a selectable data-trust bundle now —
  // domain Critiques carry trust patterns, so Comprehend activates baseline only for a dedicated trust pass). A MANUAL
  // selection runs EXACTLY the user's set (baseline only if ticked). So force baseline only when NOT manual AND
  // Comprehend did not run. The all-empty → orgAgentic invariant floor remains the ultimate safety net.
  let bundles = resolveBundles(chosenIds, !rzComp && !manual && !comp);  // returned in registry order; a resume replays the parent's set verbatim (never re-forces baseline)
  const compType: string = rzComp ? (rzComp.companyType ?? 'resumed classification') : manual ? 'manual selection' : comp ? comp.companyType : (ranking ? 'ranking/recsys system (keyword)' : 'data product (keyword)');
  // `compType` is a DISPLAY string: it is never undefined, and its fallbacks ('manual selection',
  // 'resumed classification', '… (keyword)') describe how we chose bundles, not what the system IS. The
  // model-facing classification is a DIFFERENT value and must stay optional — see `systemKind` at the
  // report stage. Persisted separately (`classification`) so a RESUME does not read a display fallback
  // back out of the checkpoint and frame a report as "an audit of: manual selection". Code review
  // caught that: the fresh path guarded it, the resume path did not.
  const classification: string | undefined = rzComp
    ? ((rzComp as { classification?: string }).classification ?? undefined)   // absent on older checkpoints → undefined, which is the safe branch
    : (comp?.companyType || undefined);
  // The product's CAPABILITY MAP (report lens split Phase 2): Comprehend's, re-validated on a replay (a comprehend cut
  // written before the map existed has none → []). A manual / force-all / keyword-fallback run has no map: the reports
  // keep the Phase 1 area-based capabilities. On the run record for the UI / report; fed to every Critic as context.
  const capabilities: Capability[] = rzComp ? parseCapabilities((rzComp as { capabilities?: unknown }).capabilities) : (comp?.capabilities ?? []);
  if (rzComp && capabilities.length) ctx.log(run, `stage:comprehend · capability map (replayed): ${capabilities.map((c) => c.name).join(' · ')}`);
  ctx.updateRun(run, (r) => { if (capabilities.length) r.capabilities = capabilities; else delete r.capabilities; });
  ctx.log(run, `stage:comprehend · ${compType} · bundles: ${bundles.map((b) => b.id).join(', ')} · warehouse=${hasWh ? 'on' : 'off'} key-value=${hasKv ? 'on' : 'off'} · capabilities=${capabilities.length}`);
  if (ctx.live(run).authToken) ctx.log(run, `running on your Claude ${ctx.live(run).authToken!.startsWith('sk-ant-oat') ? 'subscription' : 'API key'} (pasted credential)`);

  // Operating envelope: by DEFAULT there is NO domain-bundle count cap (MAX_DOMAIN_BUNDLES = Infinity) — every
  // bundle Comprehend judged relevant runs, and spend is bounded by the per-run BUDGET's admission gate (0.80·B stops
  // STARTING new work — with the bounded, already-accepted in-flight overshoot at concurrency >2), not by a count
  // truncation. The always-on baseline floor always rides. Only when THERESA_MAX_DOMAIN_BUNDLES is set to a finite N does
  // this clamp to the top N domain bundles BY COMPREHEND PRIORITY (chosenIds order) — NOT registry order, else the
  // agent's top pick could be the one dropped. (Removing the default-2 cap resolves the mobile-pair drop:
  // with no truncation, a two-platform company keeps both mobile-ios and mobile-android.)
  const domainRank = (id: string) => { const i = chosenIds.findIndex((x) => x.toLowerCase() === id.toLowerCase()); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  // A manual selection (like FORCE_ALL_BUNDLES) bypasses the clamp too — the user deliberately chose the set,
  // so honor all of it rather than dropping their picks past a set MAX_DOMAIN_BUNDLES.
  const bypassCap = FORCE_ALL_BUNDLES || manual || Boolean(rzComp);  // a resume replays the parent's set verbatim
  const keptDomain = bundles.filter((b) => !b.alwaysOn).sort((a, b) => domainRank(a.id) - domainRank(b.id)).slice(0, bypassCap ? bundles.length : MAX_DOMAIN_BUNDLES);
  const cappedBundles = bundles.filter((b) => b.alwaysOn || keptDomain.includes(b));
  if (cappedBundles.length !== bundles.length) ctx.log(run, `stage:comprehend · operating envelope: capping to baseline + top ${MAX_DOMAIN_BUNDLES} domain → ${cappedBundles.map((b) => b.id).join(', ')}`);
  bundles = cappedBundles;
  // Incremental re-scan: now that the bundle set is known, the run summary stops calling a lane
  // "re-ran" when Comprehend did not activate its bundle.
  if (run.incremental?.mode === 'incremental') {
    try {
      const next = withActivation(run.incremental, bundles.map((x) => x.id));
      ctx.updateRun(run, (r) => { r.incremental = next; });
      if (next.lanesNotActivated?.length) ctx.log(run, `incremental: not activated this time — ${next.lanesNotActivated.map((l) => l.id).join(', ')} (Comprehend did not pick them; they neither re-run nor are reused, and their earlier findings read "not re-checked")`);
    } catch { /* fail-open: the plan summary stays as planned */ }
  }
  // Run the per-bundle fan-out N-wide (+1 for the concurrent leadership/synthesis writers) rather
  // than serializing at the default 2, so N bundles' Critique→Expert and Analyst⇄QC sessions progress in parallel.
  // SCOPED to THIS run (keyed by run.id) and RELEASED in executeOrgRun's finally — a finished run must not leave the
  // process-wide cap raised for the next run's discovery phase. Overlapping runs compose by MAX.
  // (An explicit THERESA_LLM_CONCURRENCY still wins; the 16 safety ceiling in scheduler.ts still applies.)
  requestLlmConcurrency(run.id, bundles.length + 1);

  // ◆ checkpoint: comprehend — everything the fan-out needs (planes/tokens are NOT persisted; a
  // resume re-mounts them from live sources). `planes` records the CONCRETE identity (kind +
  // server name + coordinate fingerprint) of every measure plane actually mounted, so a resume
  // refuses to re-run measuring stages unless the SAME planes would mount again (a
  // re-run lane degrading to code-only — or silently measuring a DIFFERENT warehouse —
  // would mix with the cached lanes' verdicts into a non-comparable synthesis).
  // TRANSITIVE continuity: a REPLAYED comprehend must carry the PARENT's plane
  // identities forward — the cached lanes' provenance is what the parent mounted, not what happens
  // to be connected while this child replays (a ≥synthesis resume legitimately runs with no planes;
  // recording `planes: []` here would let a GRAND-child resume from this child's barrier pass the
  // gate and mix code-only re-runs with the parent's warehouse-measured lanes).
  const mountedIdents = rzComp
    ? ((rzComp.planes ?? []) as { kind: string; serverName: string; fp: string }[])
    : measurePlaneIdentities(runSources).filter((p) => measurePlaneNames.has(p.serverName)).map(({ kind, serverName, fp }) => ({ kind, serverName, fp }));
  // `codeintel` is an OPTIONAL additive field — deliberately NOT bumping the comprehend stage schema
  // version (that is fail-closed and would invalidate every existing resumable checkpoint). It defaults
  // gracefully: an older parent has it undefined → the parity check simply doesn't fire.
  // `kpis` / `systems` are optional additive fields the same way: Comprehend's entity names, so a
  // REPLAYED comprehend still gives sibling recall its metric / event keys (an older parent: absent → [] → the keys come
  // from the manifests / codeintel / own facts only). A replay carries the parent's forward (transitive).
  const compKeys = comprehendEntityNames(rzComp, comp);
  // `capabilities` is optional + additive like `kpis` (no stage-schema bump): absent on an older cut → no map.
  ctx.saveCheckpoint(run, 'comprehend', { ...(capabilities.length ? { capabilities } : {}), kpis: compKeys.kpis, systems: compKeys.systems, orgMetrics, orgContext, gcpInv, ranking, companyType: compType, classification, bundleIds: bundles.map((b) => b.id), planeKinds: rzComp ? (rzComp.planeKinds ?? []) : [...mountedPlaneKinds], planes: mountedIdents, codeintel: rzComp ? Boolean(rzComp.codeintel) : codeintelSeeded, osv: (rzComp && typeof (rzComp as { osv?: unknown }).osv === 'boolean') ? (rzComp as { osv?: boolean }).osv : osvMounted },
    { label: 'Comprehend complete', detail: `${compType} · ${bundles.map((b) => b.id).join(', ')}` });

  // SIBLING CONTRAST (cross-project org memory §3) — only now are this project's entity keys known (Comprehend's KPIs /
  // systems + codeintel tables + the workspace's dependency manifests), so the opted-in run's CONTRAST block is built
  // here and installed in the run's holder; runAgent appends it to every later Critic / Expert node (memory/contrast.ts).
  // KEYS WITHOUT A LIVE COMPREHEND: a resumed / incremental run replays the checkpointed KPIs + systems
  // (compKeys); a MANUAL bundle selection (or FORCE_ALL_BUNDLES) skips Comprehend, so its keys come from the dependency
  // manifests, the codeintel tables and this project's own previous facts only — metric keys it never recorded are missed.
  // Visibility is checked with the run's clone credential (ws.sibling.canAccess). Fail-open: no block, the run goes on.
  const sibOrg = orgKeyFor(run.orgId ?? orgIdForTenant(run.tenant), run.tenant);
  if (ws?.sibling && !sibOrg) ctx.log(run, 'stage:comprehend · sibling recall skipped (no org scope)');
  if (ws?.sibling && sibOrg) {
    try {
      const line = await fillSiblingContrast({ holder: ws.sibling.holder, orgKey: sibOrg, root, repos: workspaceRepos(ws.manifest, localNamesFor(srcSet)), comp: compKeys.kpis.length || compKeys.systems.length ? compKeys : null, canAccess: ws.sibling.canAccess, publicOnly: ws.sibling.holder.publicOnly === true });
      ctx.log(run, `stage:comprehend · ${line}`);
    } catch (e) { ctx.log(run, `stage:comprehend · sibling recall skipped (${e instanceof Error ? e.message : String(e)})`); }
  }

  const scopeDesc = `all git repos under this directory, considered as one ${ranking ? 'ranking/recsys' : 'data'} system.`;
  // NO per-bundle budget slicing. A bundle's OWN local budget = the FULL run budget, so its own
  // state.cost check never binds before the ONE total limit. The single throttle is the process-wide
  // BudgetLedger + its 0.80·B admission gate, which governs all parallel bundles COLLECTIVELY — a tool-heavy
  // bundle can use more and a light one less, capped only in aggregate. (Was 0.60·B ÷ N, a redundant second
  // cap that starved the tool-heavy baseline floor: it exhausted its ~$24 slice mid-verification, shipping
  // findings UNVERIFIED even though the whole run was far under the global cap.) EFFECTIVE_RUN_BUDGET==0
  // ("unbounded") maps to Infinity explicitly — deepAudit's `budgetUsd ?? Infinity` does NOT coalesce a
  // literal 0 (0 ?? Infinity === 0) and would zero out every measure.
  const perBundleBudget = ctx.effectiveRunBudget > 0 ? ctx.effectiveRunBudget : Infinity;

  // ── per-bundle pipeline, IN PARALLEL — each bundle runs its OWN Critic agent → its OWN Expert agent,
  //    each an independent runAgent. Fail-open per bundle: one that throws contributes nothing rather than
  //    sinking the run. Logs are tagged "[bundle-id] …" so the UI shows each bundle's own problems/verdicts.
  //    Synthesis is NOT per-bundle (skipSynthesis) — it runs ONCE over the merged verdicts, below. ──
  // Two lane kinds: a DOMAIN lane (Critique → Expert/deepAudit → hypotheses) and the always-on
  // BASELINE FLOOR lane (invariant scan via research() → Findings + CoverageGaps directly). Both normalize
  // into this BundleOut; domain hypotheses convert to findings/gaps post-loop, baseline carries them inline.
  // NOTE: claim audit is NOT done here (inside the per-bundle Promise.all) — it runs AFTER the measure barrier
  //, so an always-admitted 'audit' call from a fast bundle can't push total spend toward the
  // 0.80B stop while other bundles' measure calls are still gated on total. BundleOut carries no `audits`.
  type BundleOut = LaneOut;
  // CHECKPOINT — the parallel phase as a MONOTONE FRONTIER: the cut is identified by the SET of
  // completed bundles (payload keyed by bundle id), not a count. Each completed lane updates the
  // 'frontier' file; a lane that FAILED (node_failed gap) has no reusable output and stays out.
  // On resume, a completed lane in rz.reuse REPLAYS from its snapshot; anything else (lost
  // in-flight, or deliberately unticked for a forced re-run) executes live from its own Critic.
  const laneSnaps: Record<string, LaneSnap> = rzHas(rz, 'barrier') ? (rz!.data.barrier.lanes ?? {}) : rzHas(rz, 'frontier') ? (rz!.data.frontier.lanes ?? {}) : {};
  const frontierDone: Record<string, LaneSnap> = {};
  const noteLaneDone = (out: BundleOut): void => {
    if (out.gaps.some((g) => g.status === 'node_failed')) return;
    frontierDone[out.bundle.id] = serializeLane(out);
    const done = Object.keys(frontierDone);
    ctx.saveCheckpoint(run, 'frontier', { lanes: { ...frontierDone } },
      { label: `Bundle frontier · ${done.length}/${bundles.length}`, detail: done.map((id) => id + ' ✓').join(' · '), bundlesDone: done });
  };
  // Incremental re-scan: which lanes REPLAYED (so the claim audit can carry their baseline verdicts), and the lane
  // read-set recording context — the workspace repos (dir → owner/name) + the measure planes whose calls mark a lane
  // as live-measured. Recording is observe-only (readSet.ts); a failure never touches the lane.
  const incr = rz?.incremental;
  const replayedLanes = new Set<string>();
  const wsRepos = (ws?.manifest.repos ?? []).map((r) => ({ fullName: r.fullName, dir: r.dir }));
  // The changed files as the agents see them (workspace paths `<dir>/<path>`), for the delta critique.
  const wsChanged = incr ? incr.changedPaths.map((p) => { const r = incr.repos.find((x) => p.toLowerCase().startsWith(x.fullName.toLowerCase() + '/')); return r ? `${r.dir}${p.slice(r.fullName.length)}` : p; }) : [];
  const baselineSetChanged = incr ? [...bundles.map((x) => x.id)].sort().join(',') !== [...incr.baselineBundleIds].sort().join(',') : false;
  // The workspace's tracked files (repo-normalized, lowercased) — what a MEASUREMENT's named inputs resolve against
  // (carryForward.measurementInputState: `probe:glob+read(.npmrc,main.yml)` cites no file row, but names its files).
  // Read-only `git ls-files` per repo, once; fail-open to [] (the measurement then reads "unresolved").
  const inputIndex: InputIndex | undefined = incr && incr.findingCarry ? { files: wsRepos.flatMap((r) => gitListFiles(join(root, r.dir)).map((p) => `${r.fullName.toLowerCase()}/${p.toLowerCase()}`)), repos: wsRepos, livePlanes: [...measurePlaneNames] } : undefined;
  const changedSet = new Set((incr?.changedPaths ?? []).map((p) => p.toLowerCase()));
  // DELTA lanes (src/run/deltaLane.ts): per lane, the revived findings that left its output for a
  // re-check, the ids the delta ADDED (their audits are fresh, their findings are the lane's only re-derivations), and
  // how each kept revived finding is carried (the Execution report's "persisting (…)" / "measured <date>" line).
  const deltaMaxProblems = incrSettings().deltaMaxProblems ?? 2;
  const deltaLanes = new Map<string, { recheck: Finding[]; added: Set<string>; keep: { f: Finding; note: CarryNote; inputs: string[] }[] }>();
  const perBundle = await withBudgetNode('bundle', () => Promise.all(bundles.map((b): Promise<BundleOut> => withAuditContext({ stage: 'bundle', bundleId: b.id }, async (): Promise<BundleOut> => {
    const blog = (m: string) => ctx.log(run, `[${b.id}] ${m}`);
    const empty: BundleOut = { bundle: b, hypotheses: [], mitigations: [], findings: [], gaps: [], trace: '', toolTally: {} };
    const snap = laneSnaps[b.id];
    // The baseline FLOOR lane's invariant list is derived from the ACTIVATED bundle set (structuralChecksFor), so a
    // re-run Comprehend that activated a different set makes its cached output non-comparable — re-run it.
    const floorStale = Boolean(incr && b.id === 'baseline' && baselineSetChanged);
    if (floorStale && snap && rz!.reuse.has(b.id)) ctx.log(run, 'reuse: lane baseline not reused — the activated bundle set changed (its floor invariants depend on it)');
    // DELTA LANE: revive the baseline snapshot at $0, take out the revived findings whose cited / measured files changed
    // (→ a targeted re-check at the findings stage), then run a delta critique over just the changed files below and
    // merge its new verdicts in (deltaLane.ts). A lane that cannot be revived falls through to a full live run.
    const dplan = incr && incr.mode === 'incremental' && incr.findingCarry && deltaEligibleLane(b.id) ? incr.lanes[b.id]?.delta : undefined;
    let delta: { revived: BundleOut; base: BundleOut; focus: string[]; usedIds: string[] } | null = null;
    if (dplan && snap && !floorStale) {
      const revived = reviveLane(snap);
      if (revived) {
        const hypIds = new Set(revived.hypotheses.map((h) => String(h.id).toLowerCase()));
        const derived = incr!.baselineFindings.filter((f) => hypIds.has(String(f.id).toLowerCase()));
        const split = deltaLaneSplit(derived, changedSet, incr!.baselineRepos, inputIndex);
        // Revived hypotheses backing NO finding whose measurement read a changed file leave too: the
        // delta critique / Expert re-derives them — their verdicts + claim audits are not carried.
        const stale = staleRevivedHypotheses(revived.hypotheses, new Set(derived.map((f) => String(f.id).toLowerCase())), changedSet, incr!.baselineRepos, inputIndex);
        const out = new Set([...[...split.recheck, ...split.dropped].map((f) => String(f.id).toLowerCase()), ...stale]);
        const base: BundleOut = { ...revived, hypotheses: revived.hypotheses.filter((h) => !out.has(String(h.id).toLowerCase())), mitigations: revived.mitigations.filter((m) => !out.has(String(m.hypothesisId).toLowerCase())) };
        const usedIds = [...revived.hypotheses.map((h) => h.id), ...laneCandidates(b.id, incr!.baselineFindings).map((f) => f.id), ...(incr!.baselineCarried?.[b.id]?.findings ?? []).map((f) => f.id), ...(incr!.baselinePending ?? []).filter((p) => p.bundleId === b.id).map((p) => p.finding.id)];
        delta = { revived, base, focus: deltaFocusPaths(dplan.files, incr!.repos), usedIds };
        deltaLanes.set(b.id, { recheck: split.recheck, added: new Set(), keep: split.keep });
        replayedLanes.add(b.id);
        blog(`stage:critique · ⟳ lane revived from ${rz!.parentLabel} · $0 — Change: ${dplan.files.length} of ${dplan.readCount} read file(s) changed · ${split.keep.length} of ${derived.length} baseline finding(s) kept · ${split.recheck.length} to re-check${split.dropped.length ? ` · ${split.dropped.length} ruled-out lead(s) dropped` : ''}${stale.length ? ` · ${stale.length} verdict(s) without a finding re-derived (their measured files changed)` : ''} (findings = reported defects; the lane's verdicts also include ruled-out / healthy hypotheses)`);
      } else blog('⚠ cached lane could not be revived for a Change lane (bundle no longer registered) — running live');
    }
    if (!delta && snap && rz!.reuse.has(b.id) && !floorStale) {
      const revived = reviveLane(snap);
      if (revived) {
        const measured = incr && revived.measuredAt ? ` · live-plane measurements kept as measured ${revived.measuredAt.slice(0, 10)}` : '';
        blog(`stage:critique · ⟳ lane reused from ${rz!.parentLabel} · $0${incr ? ` — ${incr.lanes[b.id]?.reason ?? 'reusable'}` : ''}`);
        blog(`stage:expert · ⟳ ${revived.hypotheses.length} verdict(s) + ${revived.findings.length} finding(s)${revived.areaReportHtml ? ' + area report' : ''} carried forward · $0${measured}`);
        replayedLanes.add(b.id);
        return { ...revived, reusedFrom: revived.reusedFrom ?? rz!.parentId };
      }
      blog('⚠ cached lane could not be revived (bundle no longer registered) — running live');
    }
    // A LIVE lane: attribute its spend to it (per-lane spend) and record what its agents read (read set).
    const rec = new ReadSetCollector(root, { repos: wsRepos, measurePlanes: measurePlaneNames });
    const startedAt = new Date().toISOString();
    const finishLane = (out: BundleOut): BundleOut => {
      try {
        const snapRS = normalizeSnapshot(rec.snapshot(), wsRepos);
        const spent = currentLedger()?.spentOnLane(b.id) ?? 0;
        // A DELTA lane: read set = baseline ∪ the delta's reads; `spentUsd` stays the cost of a FULL run of the lane (what
        // the next estimate / a future re-run costs); the delta's own spend is logged. Its baseline measurement date stays.
        if (delta) {
          blog(`stage:expert · Change lane spent $${spent.toFixed(2)} (a full re-run cost $${Number(delta.revived.spentUsd ?? 0).toFixed(2)} last time)`);
          // No recorded full cost ⇒ stays unknown: the delta's own (small) spend is not what a full re-run costs.
          return { ...out, ...unionReadSets(delta.revived, snapRS), spentUsd: delta.revived.spentUsd, ranAt: startedAt, ...(snapRS.measured.length ? { measuredAt: startedAt } : delta.revived.measuredAt ? { measuredAt: delta.revived.measuredAt } : {}), reusedFrom: undefined };
        }
        return { ...out, ...snapRS, spentUsd: Number(spent.toFixed(4)), ranAt: startedAt, ...(snapRS.measured.length ? { measuredAt: startedAt } : {}), reusedFrom: undefined };
      } catch { return out; }
    };
    // Hypotheses the run budget left OPEN (never measured) → budget_skipped gaps, so this lane is recorded as an
    // incomplete check and a re-scan never replays it as complete (incremental.budgetLeftOpen).
    const markLeftOpen = (o: BundleOut): BundleOut => {
      try {
        const lo = budgetLeftOpen(b.id, o.hypotheses);
        if (!lo.gaps.length) return o;
        blog(`stage:expert · ⚠ ${lo.gaps.length} hypothesis(es) left unmeasured by the run budget (${lo.gaps.map((g) => g.hypothesisId).slice(0, 4).join(', ')}) — recorded as budget_skipped: this lane is not a completed check, so a re-scan re-runs it and its earlier findings read "not re-checked"`);
        const out = new Set(lo.gaps.map((g) => String(g.hypothesisId).toLowerCase()));
        return { ...o, hypotheses: lo.keep, mitigations: o.mitigations.filter((m) => !out.has(String(m.hypothesisId).toLowerCase())), gaps: [...o.gaps, ...lo.gaps] };
      } catch { return o; }
    };
    // Merge a delta's own output into the revived lane (renumbered, duplicates of kept findings dropped).
    const mergeDelta = (o: BundleOut): BundleOut => {
      if (!delta) return o;
      try {
        const d = deltaLanes.get(b.id)!;
        const hm = new Map(delta.revived.hypotheses.map((h) => [String(h.id).toLowerCase(), String(h.agentMetric || h.decisiveMetric || '')]));
        const m = mergeDeltaLane(b.id, delta.base, d.keep.map((k) => k.f), delta.usedIds, o, { metricOf: (h) => h.agentMetric || h.decisiveMetric, keptMetricOf: (f) => hm.get(String(f.id).toLowerCase()) || undefined });
        for (const id of m.added) d.added.add(String(id).toLowerCase());
        blog(`stage:expert · Change: +${m.added.length} new verdict(s)${m.duplicates.length ? ` · ${m.duplicates.length} duplicate(s) of known findings dropped` : ''} · ${delta.base.hypotheses.length} revived verdict(s) kept (every hypothesis still in the lane, incl. ruled-out / healthy — ${d.keep.length} of them back a kept finding)`);
        // No area report for a delta lane: the revived one describes the pre-delta verdicts (and a Full Scan no longer
        // produces area reports — two-report model; only an old baseline snapshot can still carry one).
        return { ...delta.revived, ...m.out, areaReportHtml: undefined, evalsToRun: delta.revived.evalsToRun };
      } catch (e) {
        blog(`stage:expert · Change merge failed (${e instanceof Error ? e.message : String(e)}) — keeping the revived lane`);
        return { ...delta.base, areaReportHtml: undefined, gaps: [...delta.base.gaps, ...o.gaps.filter((g) => g.status === 'node_failed' || g.status === 'budget_skipped')] };
      }
    };
    return withBudgetLane(b.id, () => withReadSet(rec, async (): Promise<BundleOut> => {
    try {
      // BASELINE FLOOR LANE — branch by LANE IDENTITY (not empty metric library): the data-trust floor
      // runs research() over its invariants, NOT critique→deepAudit (which is forced metric-triage and
      // would silently inherit the recsys library). (0b)
      if (b.id === 'baseline') {
        // The floor = the 11 general invariants (baseline.structuralChecks) PLUS the code-structural checks of
        // every ACTIVATED domain bundle — recsys i12/i13, data-eng de*, analytics an*, trust-safety ts* — keyed to
        // bundle ACTIVATION (not the looksLikeRanking heuristic): Comprehend can activate a bundle from richer
        // signals, and an inactive bundle's checks must never run. recsys.structuralChecks IS
        // RANKING_INVARIANTS, so this generalizes the former recsys-only special case to all domain bundles.
        // The general floor invariants: the UI pick if the user chose any (the invariant checklist IS the real control
        // over the floor now), else the baseline-owned floor default (b.structuralChecks = baselineFloorInvariants()).
        const generalFloor = run.invariantKeys && run.invariantKeys.length
          ? ALL_INVARIANTS.filter((i) => run.invariantKeys!.includes(i.key))
          : b.structuralChecks;
        // OWNER-AWARE routing: a general invariant OWNED by an active domain bundle (e.g. i10 experiment-validity →
        // analytics) must actually be scanned when that domain is active — ownership isn't just picker cosmetics. Fold in
        // those, plus the activated domain bundles' own structural checks (recsys i12, de*, an*, ts*). De-dupe by key.
        const activeDomainIds = new Set(bundles.filter((bb) => bb.id !== 'baseline').map((bb) => bb.id));
        const domainOwnedGeneral = INVARIANTS.filter((i) => i.owner && i.owner !== 'baseline' && activeDomainIds.has(i.owner));
        const floorInvariants = [...generalFloor, ...domainOwnedGeneral, ...structuralChecksFor(bundles.filter((bb) => bb.id !== 'baseline'))]
          .filter((inv, idx, arr) => arr.findIndex((x) => x.key === inv.key) === idx);
        const { findings, gaps } = await runBaselineFloor(run, root, floorInvariants, orgContext, mcpServers, perBundleBudget, blog, ctx);
        return { ...empty, findings, gaps };
      }
      // ── RECSYS-MLE — dedicated recsys intake (parity with orchestrateRecsysAudit) ────────────────
      // The recsys-mle bundle draws hypotheses from deepAudit's OWN recsys-grounded intake — `unforced`
      // (the recsys expert poses its OWN falsifiable hypotheses from first principles, no forced cause-list)
      // + `ranking` (mounts the recsys lens + metric library for measurement) — NOT the generic
      // orgCritiqueExpert critique → preflight → execute-plan. This restores the Phase-1 hypothesis quality
      // the dedicated /api/audit → bundle consolidation regressed (a general critic posed weak/stale leads —
      // e.g. auditing a retired experiment). Phase-2/3 exec→resume is the SAME shared helper
      // (runRecsysExecAndResume); the area report is (re-)authored on the measured/resumed verdicts.
      // recsys-mle ONLY — every other bundle keeps the critique→preflight path below.
      if (b.id === 'recsys-mle') {
        const relog = (m: string) => blog(/^▶\s*mitigate\b/i.test(m) ? 'stage:mitigate · ' + m.replace(/^▶\s*mitigate\s*·?\s*/i, '') : m);
        // The NORMALIZED brief, like every other lane. This branch read run.brief directly, so a ranking run
        // with a blank or placeholder brief investigated scopeDesc or the placeholder while every other lane
        // got the standard sweep - and the log said the sweep was running. Third site found for this same
        // drift (main path, invariant fallback, and now here), which is why it reads the shared helper.
        const rIssue = investigationBriefFor(run.brief) ?? scopeDesc;
        const rCommon = { root, scopeDesc, issue: rIssue, unforced: true as const, ranking: true as const, bundles: [b], mcpServers: measureServers, planes: measurePlanes, authToken: ctx.live(run).authToken, maxTurns: 24, maxHypotheses: MAX_HYPOTHESES, skipSynthesis: true as const, log: relog };
        blog('stage:intake · recsys expert drawing falsifiable hypotheses (unforced + ranking) …');
        const res = await deepAudit({ ...rCommon, budgetUsd: perBundleBudget });
        blog(`stage:intake · ${res.hypotheses.length} hypothesis(es) · ${res.evalsToRun.length} eval proposal(s)`);
        let laneRes = res;
        // Prefix the intake's h1..hN with the bundle id (recsys-mle:h1) — deepAudit's UNFORCED intake numbers
        // hypotheses per-lane, and downstream bundle attribution (answer-back rows, finalGapsForBundle) keys off
        // the `bundleId:` id prefix. Mirrors the code-only path's prefixBundle. (The in-session area report is
        // authored on the un-prefixed ids — the same accepted quirk as the code-only path.)
        return { ...empty, hypotheses: prefixBundle(b.id, laneRes.hypotheses), mitigations: laneRes.mitigations.map((m) => ({ ...m, hypothesisId: `${b.id}:${m.hypothesisId}` })), evalsToRun: laneRes.evalsToRun, trace: laneRes.trace, toolTally: laneRes.toolTally };
      }
      // Admission past the 0.80·B envelope is enforced at the LLM leaf (runAgent), after concurrent
      // siblings' cost is recorded — a budget-skipped domain bundle's critique returns 0 problems → it
      // contributes nothing, fail-open.
      blog('stage:critique · critic posing evidence-seeded problems …');
      // DELTA CRITIQUE (incremental re-scan, Phase 3): a lane re-running against a baseline is told what the last scan
      // already found for it + the files that changed, so it spends its problems on NEW defects in the changed code.
      // A DELTA lane: scoped to the few changed files it depends on (focusPaths), ≤ THERESA_INCR_DELTA_MAX_PROBLEMS new
      // problems, fewer turns; everything it already found is ALREADY KNOWN.
      const priorKnown = (incr && incr.findingCarry && incr.mode === 'incremental') ? priorKnownBlock(incr.baselineAt.slice(0, 10), laneCandidates(b.id, incr.baselineFindings, mergeCarried(incr.baselineLanes[b.id], incr.baselineCarried?.[b.id], b.id)), delta ? delta.focus : wsChanged) : '';
      if (delta) blog(`stage:critique · Change critique over ${delta.focus.length} changed file(s) (${delta.focus.slice(0, 3).join(', ')}${delta.focus.length > 3 ? ', …' : ''}) · ≤ ${deltaMaxProblems} new problem(s)`);
      else if (priorKnown) blog('stage:critique · Change critique — prior findings passed as already-known; focus on the changed files');
      const crit = await runCritique({ root, scopeDesc, bundles: [b], orgContext, brief: investigationBrief, gitContext: codeintelDigest, capabilities, mcpServers, authToken: ctx.live(run).authToken, maxTurns: delta ? 12 : 20, log: blog, ...(priorKnown ? { priorKnown } : {}), ...(delta ? { focusPaths: delta.focus, maxProblems: deltaMaxProblems } : {}) });
      blog(`stage:critique · ${crit.problems.length} problem(s) posed`);
      // A critic the run-budget envelope declined to START posed nothing because it never looked — record it as a
      // budget_skipped gap (not a clean empty lane), so a re-scan neither reuses this lane nor reads its bundle's prior
      // findings as fixed.
      if (!crit.problems.length && crit.budgetSkipped) {
        blog('stage:critique · skipped by the run-budget envelope — the lane checked nothing');
        return { ...empty, gaps: [{ id: `${b.id.toUpperCase()}-CRIT-SKIP`, concern: `${b.title} was not examined`, whyUnsettled: 'the run hit the operating-envelope budget before this bundle\'s critique could start', nextDecisiveTest: `Re-run the ${b.id} bundle with budget headroom.`, source: 'critique', status: 'budget_skipped', bundleId: b.id }], trace: crit.trace, toolTally: crit.toolTally };
      }
      if (!crit.problems.length) return { ...empty, trace: crit.trace, toolTally: crit.toolTally };
      const elog = (m: string) => blog(/^▶\s*mitigate\b/i.test(m) ? 'stage:mitigate · ' + m.replace(/^▶\s*mitigate\s*·?\s*/i, '') : m);
      // A delta lane measures only its ≤ N new problems.
      const laneMaxH = delta ? Math.max(1, Math.min(MAX_HYPOTHESES, deltaMaxProblems)) : MAX_HYPOTHESES;

      // ── PREFLIGHT — conditional. When a data plane (warehouse / key-value) is mounted, the
      //    domain lane runs Critique → PREFLIGHT (plan + deterministic pre-budget lint) → Expert(execute-plan).
      //    Preflight mints stable bundle-prefixed ids, so the planned path does NOT re-prefix. A lint-rejected
      //    plan item becomes a CoverageGap (reported, never silently re-measured); zero lint-passed → skip the
      //    Expert entirely. CODE-ONLY runs (no plane) keep the code-only Critique → Expert(intake) default —
      //    Preflight would only plan queries nothing can run — and prefix ids post-hoc via prefixBundle(). ──
      const mountedPlanes = mountedPlaneKinds;   // all measure-capable plane KINDS mounted this run (warehouse/keyvalue/analytics/bi/custom), not just warehouse/keyvalue
      if (mountedPlanes.size > 0) {
        blog('stage:preflight · planning decisive measurements (tool-light) …');
        const pf = await runPreflight({ root, scopeDesc, bundleId: b.id, problems: crit.problems, bundles: [b], mountedPlanes, planes: measurePlanes, maxHypotheses: laneMaxH, orgContext, brief: investigationBrief, gitContext: codeintelDigest, authToken: ctx.live(run).authToken, maxTurns: 16, log: blog });
        const rejGaps = rejectedToGaps(pf.lint.rejected, b.id);
        if (!pf.lint.ok.length) {
          // No lint-passing decisive measurement → skip the Expert (no silent unplanned fallback). Report the
          // per-item rejections + a bundle-level gap so the bundle is visible, not silently absent. If Preflight
          // itself was BUDGET-SKIPPED (run past the 0.80·B envelope → no plan was even attempted), attribute the
          // already-posed critique problems as budget_skipped — NOT not_evidenceable, which would falsely imply
          // the concern can't be settled from the artifacts.
          if (pf.budgetSkipped) {
            blog(`stage:preflight · skipped by the run-budget envelope — reporting ${crit.problems.length} posed problem(s) as budget_skipped`);
            const skipGaps: CoverageGap[] = crit.problems.map((p, i) => ({ id: `${b.id.toUpperCase()}-Q${i + 1}`, concern: p.title, whyUnsettled: 'the run hit the operating-envelope budget before Preflight could plan the decisive measurement', nextDecisiveTest: p.check || `Plan + measure the problem: ${p.title}`, source: 'preflight', status: 'budget_skipped', bundleId: b.id }));
            return { ...empty, gaps: [...rejGaps, ...skipGaps], trace: [crit.trace, pf.trace].filter(Boolean).join('\n\n'), toolTally: mergeTally(crit.toolTally, pf.toolTally) };
          }
          blog(`stage:preflight · 0 lint-passed hypotheses — skipping expert (${rejGaps.length} gap(s) recorded)`);
          const bundleGap: CoverageGap = { id: `${b.id.toUpperCase()}-PLAN-EMPTY`, concern: `${b.title} produced no measurable plan`, whyUnsettled: 'Preflight surfaced no lint-passing decisive measurement for this bundle on the mounted planes', nextDecisiveTest: `Sharpen the Critique leads, or mount the data plane the decisive queries need, for ${b.id}.`, source: 'preflight', status: 'not_evidenceable', bundleId: b.id };
          return { ...empty, gaps: [...rejGaps, bundleGap], trace: [crit.trace, pf.trace].filter(Boolean).join('\n\n'), toolTally: mergeTally(crit.toolTally, pf.toolTally) };
        }
        // Per-bundle MEASURE budget = the bundle slice MINUS what Critique + Preflight already spent, so the
        // measure loop can't overrun the slice. Fully exhausted → skip measurement and report
        // the planned hypotheses as budget_skipped gaps (not a silent drop of 'open' hypotheses).
        const measureBudget = Math.max(0, perBundleBudget - crit.costUsd - pf.costUsd);
        if (measureBudget <= 0) {
          blog(`stage:expert · per-bundle budget spent on critique+preflight ($${(crit.costUsd + pf.costUsd).toFixed(2)} / $${perBundleBudget.toFixed(2)}) — skipping measurement`);
          const skipGaps: CoverageGap[] = pf.lint.ok.map((h) => ({ id: h.id.toUpperCase(), concern: h.claim, whyUnsettled: 'the per-bundle budget was spent on critique + preflight before measurement', nextDecisiveTest: h.decisiveQuery ? `Run on the ${h.requiresPlane ?? 'data'} plane: ${h.decisiveQuery.slice(0, 80)}` : `Measure: ${h.decisiveMetric}`, source: 'preflight', status: 'budget_skipped', bundleId: b.id, hypothesisId: h.id }));
          return { ...empty, gaps: [...rejGaps, ...skipGaps], trace: [crit.trace, pf.trace].filter(Boolean).join('\n\n'), toolTally: mergeTally(crit.toolTally, pf.toolTally) };
        }
        blog('stage:expert · expert measuring each PLANNED problem to a verdict …');
        // EXECUTE-PLAN: deepAudit skips intake and measures pf.lint.ok. ids are ALREADY bundle-prefixed by
        // Preflight (recsys-mle:h1) and carried through unchanged → measurement payload refs match → do NOT
        // re-prefix. brief was already consumed by Preflight (intake is skipped here).
        const res = await deepAudit({ root, scopeDesc, issue: crit.intake, plan: pf.lint.ok, bundles: [b], mcpServers: measureServers, planes: measurePlanes, authToken: ctx.live(run).authToken, maxTurns: 18, maxHypotheses: laneMaxH, budgetUsd: measureBudget, skipSynthesis: true, log: elog });
        // Layer 2: recsys-mle exec→resume — run the Phase-1 eval proposals on the box, merge datapoints, and
        // RESUME this lane's deepAudit bound to them (resume reloads the slug-keyed ledger the Phase-1 run just
        // persisted — plan+resume are mutually exclusive, so resume drops `plan`). recsys-mle + armed + evals only.
        let laneRes = res;
        // Claim audit runs AFTER the barrier (see below) — not here — so its spend can't prematurely gate
        // sibling bundles' measure calls.
        return {
          ...empty,
          hypotheses: laneRes.hypotheses,     // already prefixed at plan creation — no post-hoc prefixing
          mitigations: laneRes.mitigations,   // reference the already-prefixed hypothesis ids
          gaps: rejGaps,                      // lint rejections travel as gaps alongside the measured findings
          evalsToRun: b.id === 'recsys-mle' ? laneRes.evalsToRun : undefined,   // Layer 1: capture the recsys bundle's eval proposals for the run report (recsys-mle only)
          trace: [crit.trace, pf.trace, laneRes.trace].filter(Boolean).join('\n\n'),
          toolTally: mergeTally(crit.toolTally, pf.toolTally, laneRes.toolTally),
        };
      }

      // CODE-ONLY PATH (no data plane mounted) — Preflight is a no-op; the proven Critique → Expert(intake)
      // default. NOT deprecated — this is the LIVE path for any run without a warehouse/data plane (e.g. a
      // repo-only audit); it's simply the non-preflight branch, kept in step with the EXECUTE-PLAN path above.
      // Budget = the slice minus critique spend. deepAudit's intake LLM call runs BEFORE its own measure-loop
      // budget check, so guard here: critique alone exhausting the slice → skip the Expert and report the posed
      // problems as budget_skipped gaps (don't pay for an intake we can't then measure).
      const codeOnlyBudget = Math.max(0, perBundleBudget - crit.costUsd);
      if (codeOnlyBudget <= 0) {
        blog(`stage:expert · per-bundle budget spent on critique ($${crit.costUsd.toFixed(2)} / $${perBundleBudget.toFixed(2)}) — skipping expert intake`);
        const skipGaps: CoverageGap[] = crit.problems.map((p, i) => ({ id: `${b.id.toUpperCase()}-Q${i + 1}`, concern: p.title, whyUnsettled: 'the per-bundle budget was spent on critique before measurement', nextDecisiveTest: p.check || `Measure the problem: ${p.title}`, source: 'critique', status: 'budget_skipped', bundleId: b.id }));
        return { ...empty, gaps: skipGaps, trace: crit.trace, toolTally: crit.toolTally };
      }
      blog('stage:expert · expert measuring each posed problem to a verdict …');
      // maxHypotheses 3 — the operating-envelope per-bundle cap (was the deepAudit default of 6). brief =
      // UNTRUSTED priority context, injected into INTAKE only.
      const res = await deepAudit({ root, scopeDesc, issue: crit.intake, brief: investigationBrief, bundles: [b], mcpServers: measureServers, planes: measurePlanes, authToken: ctx.live(run).authToken, maxTurns: 18, maxHypotheses: laneMaxH, budgetUsd: codeOnlyBudget, skipSynthesis: true, log: elog });
      // Layer 2: recsys-mle exec→resume (code-only lane). Same helper; resume re-runs THIS lane's
      // intake-mode deepAudit bound to the measured datapoint plane (resume reloads the slug-keyed ledger).
      let codeOnlyRes = res;
      // Each bundle's expert numbers hypotheses h1..hN independently → prefix with the bundle id so the MERGED
      // set has unique ids AND the measurement payload ref is rewritten (prefixBundle — fixes the latent
      // desync where the id was prefixed but the EvidencePayload ref kept the unprefixed id). Audit the PREFIXED
      // sets so the AuditedClaim ids match the final finding ids.
      const codeOnlyHyp = prefixBundle(b.id, codeOnlyRes.hypotheses);
      const codeOnlyMit = codeOnlyRes.mitigations.map((m) => ({ ...m, hypothesisId: `${b.id}:${m.hypothesisId}` }));
      // Claim audit runs AFTER the barrier (see below) over these PREFIXED ids — not here.
      return {
        ...empty,
        hypotheses: codeOnlyHyp,
        mitigations: codeOnlyMit,
        evalsToRun: b.id === 'recsys-mle' ? codeOnlyRes.evalsToRun : undefined,   // Layer 1: capture the recsys bundle's eval proposals for the run report (recsys-mle only)
        // Persist the agent trajectory the console previously DISCARDED (only the CLI kept it).
        trace: [crit.trace, codeOnlyRes.trace].filter(Boolean).join('\n\n'),
        // Merge the critique-stage tally with the expert's so the trace tally counts BOTH.
        toolTally: mergeTally(crit.toolTally, codeOnlyRes.toolTally),
      };
    } catch (e) {
      blog(`stage:expert · bundle failed (${e instanceof Error ? e.message : String(e)}) — skipped`);
      // A failed lane is fail-open for the run, but records a node-failure CoverageGap so the concern isn't lost.
      return { ...empty, gaps: [{ id: `${b.id.toUpperCase()}-LANE-FAIL`, concern: `${b.title} lane did not complete`, whyUnsettled: `the ${b.id} lane failed: ${e instanceof Error ? e.message : String(e)}`, nextDecisiveTest: `Re-run the ${b.id} bundle.`, source: 'pipeline', status: 'node_failed', bundleId: b.id }] };
    }
    })).then(markLeftOpen).then(mergeDelta).then(finishLane);
  }).then((out) => { try { noteLaneDone(out); } catch { /* fail-open */ } return out; }))));
  const allHyp: Hypothesis[] = perBundle.flatMap((x) => x.hypotheses);
  const allMit: Mitigation[] = perBundle.flatMap((x) => x.mitigations);
  const allEvals: EvalToRun[] = perBundle.flatMap((x) => x.evalsToRun ?? []);   // Layer 1: recsys-mle eval proposals, aggregated across the frontier (only the recsys lane populates this)
  // Layer 2: the recsys-mle lane's exec datapoint store is fully consumed by its in-lane resume above — drop the temp dir.
  // ◆ checkpoint: barrier — the full ordered perBundle (SUBSUMES the 3/3 frontier: one "Bundles
  // complete" row). Captured BEFORE the claim audit folds its trajectory back into the lanes, so a
  // ≥claim-audit resume replays slightly thinner traces — accepted (display-only artifact).
  ctx.saveCheckpoint(run, 'barrier', { lanes: Object.fromEntries(perBundle.map((x) => [x.bundle.id, serializeLane(x)])) },
    { label: 'Bundles complete', detail: `the ${perBundle.length}/${bundles.length} frontier — ${perBundle.map((x) => x.bundle.id).join(' · ')} · ${allHyp.length} hypothesis(es)`, bundlesDone: perBundle.map((x) => x.bundle.id) });
  // The per-bundle CLAIM AUDIT runs HERE, AFTER the measure barrier, not inside the
  // per-bundle Promise.all: the audit's always-admitted 'audit'-node spend would otherwise count toward total
  // and prematurely trip the 0.80B bundle-measure stop while sibling lanes were still measuring. Audits each
  // domain bundle's (already-prefixed) hypotheses in parallel; the audit trajectory is folded back into that
  // bundle's persisted trace/tally.
  // Incremental re-scan: a REUSED lane's hypotheses are the baseline's, byte for byte, so its baseline claim-audit
  // verdicts (keyed by the bundle-prefixed hypothesis id) still hold — carry them and audit only the re-run lanes.
  const carriedAudits: AuditedClaim[] = [];
  if (incr && !rzHas(rz, 'claim-audit') && replayedLanes.size) {
    // (A delta lane's NEW hypotheses are not the baseline's — their verdicts are audited fresh, never carried.)
    const hypIds = new Set(perBundle.filter((x) => replayedLanes.has(x.bundle.id)).flatMap((x) => x.hypotheses.map((h) => h.id).filter((id) => !deltaLanes.get(x.bundle.id)?.added.has(String(id).toLowerCase()))));
    for (const a of incr.audits) if (hypIds.has(a.hypothesisId)) carriedAudits.push(a);
    // Reused and DELTA lanes counted apart (an end-to-end run: "8 verdict(s) of 3 reused lane(s)" hid that 2 were delta lanes).
    const nDelta = [...replayedLanes].filter((id) => deltaLanes.has(id)).length;
    if (carriedAudits.length) ctx.log(run, claimAuditCarryLine(carriedAudits.length, replayedLanes.size - nDelta, nDelta, rz!.parentLabel));
  }
  const carriedHyp = new Set(carriedAudits.map((a) => a.hypothesisId));
  const domainOuts = perBundle.filter((x) => x.hypotheses.length && !(replayedLanes.has(x.bundle.id) && x.hypotheses.every((h) => carriedHyp.has(h.id))));
  let allAudits: AuditedClaim[] = [];
  if (rzHas(rz, 'claim-audit')) {
    allAudits = ((rz!.data['claim-audit'].audits ?? []) as AuditedClaim[]);
    ctx.log(run, `stage:claim-audit · ⟳ reused from ${rz!.parentLabel} — ${allAudits.length} audited claim(s) · $0`);
  } else {
  if (domainOuts.length) {
    const auditPhase = await withBudgetNode('audit', () => Promise.all(domainOuts.map((x) =>
      runClaimAudit({ bundleId: x.bundle.id, hypotheses: x.hypotheses.filter((h) => !carriedHyp.has(h.id)), mitigations: x.mitigations, scopeDesc, authToken: ctx.live(run).authToken, root, log: (m) => ctx.log(run, `[${x.bundle.id}] ${m}`) }).then((ca) => ({ x, ca })),
    )));
    for (const { x, ca } of auditPhase) {
      allAudits.push(...ca.audits);
      x.trace = [x.trace, ca.trace].filter(Boolean).join('\n\n');   // keep the audit trajectory in the persisted trace
      x.toolTally = mergeTally(x.toolTally, ca.toolTally);
    }
  }
  // GLOBAL tool-backed re-verify of the ≤4 riskiest surviving claims (chosen AFTER the barrier so
  // the cap is deterministic across the parallel bundles). 'audit' node = always-admitted; a skipped/failed
  // re-verify leaves a claim unchanged (never punishes it). A contradicted re-run flips accept→downgrade/reject.
  if (allAudits.length) {
    try {
      const rv = await withBudgetNode('audit', () => reverifyClaims({ hypotheses: allHyp, audits: allAudits, mitigations: allMit, mcpServers: measureServers, planes: measurePlanes, authToken: ctx.live(run).authToken, root, log: (m) => ctx.log(run, m) }));
      allAudits = rv.audits;
    } catch (e) { ctx.log(run, `stage:claim-audit · re-verify pass failed (${e instanceof Error ? e.message : String(e)}) — keeping tool-free verdicts`); }
  }
  // The carried (already re-verified) baseline verdicts join AFTER the re-verify pass, so its <=4 riskiest pick is spent
  // on the claims this run actually produced.
  if (carriedAudits.length) allAudits = [...carriedAudits, ...allAudits.filter((a) => !carriedHyp.has(a.hypothesisId))];
  }
  // ◆ checkpoint: claim-audit — the post-reverify verdicts the rest of the pipeline keys on.
  ctx.saveCheckpoint(run, 'claim-audit', { audits: allAudits }, { label: 'Claim audit', detail: `${allAudits.length} claim(s) audited + re-verified` });
  const auditById = new Map(allAudits.map((a) => [a.hypothesisId, a]));        // post-reverify verdicts, keyed by hypothesis id — used by the wording rewrite AND the finding converter
  const baselineFindings: Finding[] = perBundle.flatMap((x) => x.findings);   // baseline floor lane (already Findings; NOT claim-audited — already evidence-gated)
  const laneGaps: CoverageGap[] = perBundle.flatMap((x) => x.gaps);           // baseline gaps + node-failure gaps
  // Run cost is read from the per-run BudgetLedger (entered in executeOrgRun) — the single source of truth.

  // Truly nothing surfaced (even the always-on baseline floor came up empty AND failed) → last-resort
  // fail-open to a fresh invariant floor scan (fail-open). Normally the baseline lane IS the floor.
  if (!allHyp.length && !baselineFindings.length && !laneGaps.length) {
    ctx.log(run, 'stage:critique · no bundle (incl. baseline) surfaced anything — falling back to a fresh invariant floor scan');
    return orgAgentic(run, root, ctx);
  }

  // ── stage:synthesize — ONE synthesis agent over the MERGED multi-bundle verdicts (DOMAIN hypotheses
  //    only; the baseline floor bypasses synthesis per the evidence gate — its findings are already
  //    evidence-backed and merge directly). Skipped when there are no domain hypotheses. ──
  // Synthesis runs over the AUDIT-SURVIVING verdicts only — a claim the auditor REJECTED (or couldn't settle)
  // must not feed the cross-bundle bottom line (don't let rejected claims reach synthesis).
  const rejectedIds = new Set(allAudits.filter((a) => a.verdict === 'reject' || a.auditStatus !== 'audited').map((a) => a.hypothesisId));
  // The AUDIT-SURVIVING verdicts (accept/downgrade) — the ONLY domain claims that may appear in synthesis AND
  // in the leadership / area reports. A rejected/audit-failed claim is a CoverageGap, never authoritative
  // report prose (the writers render their inputs as verdicts). Baseline findings are separate.
  // A DOWNGRADED claim must carry its caveated `allowedWording` into synthesis + the report writers
  // too (not just hypothesesToFindings) — those prompts render `h.claim` directly, so an un-reworded downgrade
  // would overclaim in the user-facing reports. Apply the wording to the surviving hypothesis here (uses the
  // single `auditById` map built above). caveatedClaim handles a downgrade WITH or WITHOUT allowedWording (a
  // wording-less downgrade — e.g. one created by re-verify — gets a deterministic caveat, never the bare original).
  // claimAuditSurvivors owns this now (research/claimAudit.ts). Behaviour is unchanged — it is the same
  // filter and the same caveatedClaim call — but it is no longer a copy, which is what let the report-tiers
  // harness silently skip the step entirely. `rejectedIds` is still needed below for the per-bundle views.
  const survivors = claimAuditSurvivors(allHyp, allMit, allAudits);
  const survivingHyp = survivors.hypotheses;
  const survivingMit = survivors.mitigations;
  const synthHyp = survivingHyp;
  let synthesis: DeepSynthesis | undefined;
  if (rzHas(rz, 'synthesis')) {
    synthesis = (rz!.data.synthesis.synthesis ?? undefined) as DeepSynthesis | undefined;
    ctx.log(run, reusedLine(rz!, 'synthesize', synthesis ? 'cross-bundle synthesis (claim-audited)' : 'synthesis (none was produced)'));
  } else if (synthHyp.length) {
    ctx.log(run, `stage:synthesize · cross-bundle bottom line over ${synthHyp.length} verdict(s)${rejectedIds.size ? ` (${rejectedIds.size} claim-audit-rejected excluded)` : ''}`);
    try { const sy = await withBudgetNode('reserve', () => synthesizeAudit(synthHyp, survivingMit, { scopeDesc, bundles, root, authToken: ctx.live(run).authToken, mcpServers: measureServers, log: (m) => ctx.log(run, m), capabilities })); synthesis = sy.synthesis; }
    catch (e) { ctx.log(run, `stage:synthesize · synthesis failed (${e instanceof Error ? e.message : String(e)})`); }
    // NARROW synthesis-claim audit: the cross-bundle synthesis can INTRODUCE assertions beyond the
    // per-bundle verdicts. Audit each bottom-line bullet + lead against the audit-surviving verdicts; drop /
    // caveat any not supported (fail-closed). 'audit' node = always-admitted. The GATED synthesis then flows to
    // BOTH the leadership writer (bottomLine) and synthesisOverview (leads).
    if (synthesis) {
      try {
        const sa = await withBudgetNode('audit', () => runSynthesisClaimAudit({ synthesis, hypotheses: survivingHyp, mitigations: survivingMit, authToken: ctx.live(run).authToken, root, log: (m) => ctx.log(run, m) }));
        synthesis = sa.synthesis;
      } catch (e) {
        // FAIL-CLOSED: if the synthesis-claim audit escapes its own handling, DROP the un-audited synthesis
        // prose rather than ship it (the leadership writer + synthesisOverview write from the verdicts).
        ctx.log(run, `stage:synthesize · synthesis-claim audit failed (${e instanceof Error ? e.message : String(e)}) — dropping the un-audited synthesis (writers use the verdicts)`);
        synthesis = undefined;
      }
    }
  }

  // ◆ checkpoint: synthesis — the (claim-audited) cross-bundle synthesis, or null when none survived.
  ctx.saveCheckpoint(run, 'synthesis', { synthesis: synthesis ?? null }, { label: 'Synthesis', detail: synthesis ? 'areas + bottom line · claim-audited' : 'no synthesis produced' });

  // ── stage:findings — the detailed INTERNAL report (same Finding contract → reportHtml) ──
  // Evidence gate: measured+disposed hypotheses → Findings; unmeasured → CoverageGaps; synthesis
  // → overview TEXT (not findings). Baseline floor findings/gaps merge in directly.
  // Pass the claim-audit verdicts: a measured+disposed DOMAIN claim becomes a Finding only on
  // accept/downgrade; reject / audit-failure → claim_rejected CoverageGap (fail-closed). Pass `undefined` when
  // no domain claim was audited so the pure disposition path is used (baseline-only runs are unaffected).
  let findings: Finding[]; let gaps: CoverageGap[]; let answerBack: AnswerBackRow[] | undefined;
  // Phase 3 carry-forward bookkeeping (see the findings stage): how each carried finding was carried, its renamed
  // baseline hypothesis / mitigation (for the Execution report), and the prior findings left unsettled.
  const carriedHow: Record<string, string> = {}; const carryHyp: Hypothesis[] = []; const carryMit: Mitigation[] = []; const uncheckedLoose: string[] = [];
  // WHY each prior finding is unchecked (looseKey → reason), for both reports.
  const uncheckedWhy: Record<string, UncheckedWhy> = {};
  const notePending = (ps: PendingFinding[]): void => { for (const p of ps) { const k = findingKeysLoose(p.finding); uncheckedLoose.push(k); uncheckedWhy[k] = pendingUncheckedWhy(p); } };
  // Persisted with the findings cut so the NEXT scan can carry them again (carryForward.ts CarriedLane / PendingFinding).
  const carriedByLane: Record<string, CarriedLane> = {}; const pendingPrior: PendingFinding[] = [];
  if (rzHas(rz, 'findings')) {
    const fp = rz!.data.findings;
    findings = (fp.findings ?? []) as Finding[]; gaps = (fp.gaps ?? []) as CoverageGap[]; answerBack = (fp.answerBack ?? undefined) as AnswerBackRow[] | undefined;
    // A replayed findings cut keeps what it carried (and what is still pending) for the chain, and its Execution cards.
    Object.assign(carriedByLane, (fp.carried ?? {}) as Record<string, CarriedLane>); pendingPrior.push(...((fp.pending ?? []) as PendingFinding[]));
    Object.assign(carriedHow, (fp.carriedHow ?? {}) as Record<string, string>);
    for (const cl of Object.values(carriedByLane)) { carryHyp.push(...(cl.hypotheses ?? [])); carryMit.push(...(cl.mitigations ?? [])); }
    notePending(pendingPrior);
    ctx.log(run, reusedLine(rz!, 'findings', `${findings.length} finding(s) + ${gaps.length} coverage gap(s)`));
  } else {
    const { findings: hypFindings, gaps: hypGaps } = hypothesesToFindings(allHyp, allMit, allAudits.length ? auditById : undefined);
    findings = [...baselineFindings, ...hypFindings];
    gaps = [...laneGaps, ...hypGaps];
    // FINDING-LEVEL CARRY-FORWARD (incremental re-scan, Phase 3): for each lane that RE-RAN against a baseline, the
    // baseline findings it did not re-find are carried when their cited code is unchanged, re-verified (one bounded
    // agent turn each) when it changed. Fail-open: any error leaves the fresh findings untouched.
    if (incr && incr.findingCarry && incr.mode === 'incremental') {
      try {
        const lim = reverifyLimits();
        const curMetric = new Map(allHyp.map((h) => [String(h.id).toLowerCase(), String(h.agentMetric || h.decisiveMetric || '')]));
        // Every lane, INCLUDING the reused ones: a reused lane replays only its own output, so what its
        // baseline carried is carried again here (else it vanished and read "fixed" on the next scan).
        const co = await runCarryForward(perBundle.map((x) => {
          const pre = x.bundle.id.toUpperCase() + ':';
          // A REPLAYED lane re-derived nothing, so its revived findings are not "re-found" evidence for a prior finding
          // (the fuzzy tier would otherwise pair a carried / re-check row with its revived sibling, and the diff would
          // then call the unpaired baseline row fixed without a re-check); a DELTA lane's fresh set = its new verdicts.
          const dl = deltaLanes.get(x.bundle.id);
          const own = findings.filter((f) => (x.bundle.id === 'baseline' ? x.findings.includes(f) : String(f.id).toUpperCase().startsWith(pre)));
          return { id: x.bundle.id, replayed: replayedLanes.has(x.bundle.id), incomplete: Boolean(laneIncompleteReason(x.gaps)),
            fresh: dl ? own.filter((f) => dl.added.has(String(f.id).toLowerCase())) : replayedLanes.has(x.bundle.id) ? [] : own,
            ...(dl ? { delta: { recheck: dl.recheck, kept: dl.keep.map((k) => k.note) } } : {}) };
        }), {
          baselineAt: incr.baselineAt, baselineFindings: incr.baselineFindings, baselineLanes: incr.baselineLanes, baselineCarried: incr.baselineCarried ?? {}, baselinePending: incr.baselinePending ?? [],
          changed: changedSet, baselineRepos: incr.baselineRepos, root, reverifyMax: lim.max,
          // D: measurements are judged by the files they NAME; B: the fuzzy tier sees this run's hypothesis metrics.
          inputs: inputIndex, metricOf: (f) => curMetric.get(String(f.id).toLowerCase()) || undefined,
          // Re-checks are audit work (found in an end-to-end run): admitted while spent + one check fits under the cap
          // minus the report reserve — not starved by the bundle phase's 0.80·B line (budget.ts reverifyAdmit).
          budgetOk: () => reverifyAdmit(currentLedger(), lim.usd),
          reverify: (f) => withBudgetNode('audit', () => reverifyFinding(f, { root, diff: reverifyDiff(f, incr, root), authToken: ctx.live(run).authToken, maxUsd: lim.usd })),
          resolves: (f) => findingResolvesInWorkspace(f, root), looseKey: findingKeysLoose, log: (m) => ctx.log(run, m),
        });
        findings.push(...co.findings); Object.assign(carriedHow, co.carriedHow); carryHyp.push(...co.hypotheses); carryMit.push(...co.mitigations);
        // How each REVIVED finding of a delta lane stands (persisting (code / inputs unchanged) · measured <date>), and a
        // reused lane's measurements (D: "measured <date> (not re-measured)" / "persisting (inputs unchanged)").
        const bdate = incr.baselineAt.slice(0, 10);
        const present = new Set(findings.map((f) => String(f.id)));
        for (const [, dl] of deltaLanes) for (const k of dl.keep) if (present.has(String(k.f.id)) && !carriedHow[k.f.id]) carriedHow[k.f.id] = carryHow(k.note, bdate, k.inputs);
        for (const x of perBundle) {
          if (!replayedLanes.has(x.bundle.id) || deltaLanes.has(x.bundle.id)) continue;
          const hyp = new Set(x.hypotheses.map((h) => String(h.id).toLowerCase()));
          const mine = findings.filter((f) => hyp.has(String(f.id).toLowerCase()) || (x.bundle.id === 'baseline' && x.findings.includes(f)));
          for (const k of deltaLaneSplit(mine, changedSet, incr.baselineRepos, inputIndex).keep) if (k.note !== 'code' && !carriedHow[k.f.id]) carriedHow[k.f.id] = carryHow(k.note, bdate, k.inputs);
        }
        Object.assign(carriedByLane, co.carriedByLane); pendingPrior.push(...co.pending); notePending(co.pending);
        // A RECHECK open question only for a re-check that was skipped / unsettled — a finding whose lane did not run or
        // complete is tracked (pending, "not re-checked") but is not a new question in this run's reports.
        for (const pnd of co.pending) if (!pendingIsSettled(pnd)) gaps.push(reverifyGap(pnd.finding, pnd.bundleId, pnd.why));
      } catch (e) { ctx.log(run, `stage:findings · carry-forward skipped (${e instanceof Error ? e.message : String(e)}) — fresh findings only`); }
    } else if (incr?.baselinePending?.length) {
      // Carry-forward off: the prior unsettled items are not re-checked — they stay pending, "not re-checked", never fixed.
      pendingPrior.push(...incr.baselinePending); notePending(incr.baselinePending);
      for (const pnd of incr.baselinePending) if (!pendingIsSettled(pnd)) gaps.push(reverifyGap(pnd.finding, pnd.bundleId, pnd.why));
    }
    ctx.log(run, `stage:findings · ${findings.length} finding(s) (${baselineFindings.length} baseline) + ${gaps.length} coverage gap(s)${allAudits.length ? ` · ${allAudits.filter((a) => a.verdict === 'reject' || a.auditStatus !== 'audited').length} claim-audit-rejected` : ''}`);

    // Answer-back — only when the user supplied a brief: a DETERMINISTIC mapping of the run's
    // FINAL audited artifacts (the evidence-gated findings + gaps) → supported / refuted / unsettled, which
    // the report writers RENDER, never infer. Built from `findings`/`gaps` (not raw hypotheses) so a
    // self-gated hypothesis appears only as an unsettled gap row, never double-counted.
    // Gated on briefIsReal, not on truthiness: an answer-back is a promise that we checked what the
    // reader asked. There is nothing to answer back to when the "ask" was a placeholder.
    answerBack = briefIsReal ? answerBackRows(findings, gaps) : undefined;
    if (answerBack) ctx.log(run, `stage:findings · answer-back: ${answerBack.filter((r) => r.status === 'supported').length} supported · ${answerBack.filter((r) => r.status === 'refuted').length} ruled out · ${answerBack.filter((r) => r.status === 'unsettled').length} unsettled`);
  }
  // REPORT LENS SPLIT: label every finding business / security / engineering (+ the
  // capability of a business one) — HERE, once, over the fresh AND the replayed set: a findings cut written before the
  // labels existed simply has none, and gets them now. Existing labels are kept (findingLens.labelFindings). The capability
  // is the synthesis area membership the Execution Work plan groups by, so the brief's map and Execution agree.
  // Phase 2: with Comprehend's capability map, the capability comes from the finding's evidence vs the map's anchors
  // first (capabilities.capabilityFor), then the area name vs the capability names, else the area (Phase 1).
  // The synthesis' capability assignment per hypothesis (validated against the map) is step 3 of capabilityFor.
  findings = labelFindings(findings, { overrides: synthesis?.lensOverrides, groups: executionGroups(findings, gaps, synthesis?.areas), capabilities, assignments: synthesis?.capabilityAssignments });
  // Which capabilities this scan EXAMINED — a lane OPENED a file under an anchor (a Read, not a path a Glob / Grep result
  // merely listed; a lane recorded before `opened` existed is read back from its trace), or a finding / hypothesis cites
  // one. A capability none of them reached is grey on the map, never green. Every surface below groups by capability too.
  const laneOpenedPaths = [...new Set(perBundle.flatMap((x) => x.opened ?? openedFromTrace(x.trace, wsRepos)))];
  const hypCites = allHyp.map((h) => ({ claim: h.claim, note: h.measurement?.note }));
  const capMap = capabilities.length ? { capabilities, examined: examinedCapabilityIds(capabilities, { openedPaths: laneOpenedPaths, findings, hypotheses: hypCites }), ...(synthesis?.capabilityAssignments?.length ? { assignments: synthesis.capabilityAssignments } : {}) } : null;
  if (capMap) ctx.log(run, `stage:findings · capability map: ${capMap.examined.length} of ${capabilities.length} capabilit${capabilities.length === 1 ? 'y' : 'ies'} examined (${laneOpenedPaths.length} file(s) opened by the lanes) · ${findings.filter((f) => f.lens === 'business' && capabilities.some((c) => c.name === f.capability)).length} business finding(s) on a mapped capability · ${synthesis?.capabilityAssignments?.length ?? 0} synthesis capability assignment(s)`);
  const lensGroups = executionGroupsFor(findings, gaps, synthesis?.areas, capabilities);
  // ◆ checkpoint: findings — the iteration anchor (resume here to re-run only the report writers).
  ctx.saveCheckpoint(run, 'findings', { findings, gaps, answerBack: answerBack ?? null, ...(Object.keys(carriedByLane).length ? { carried: carriedByLane, carriedHow } : {}), ...(pendingPrior.length ? { pending: pendingPrior } : {}) }, { label: 'Findings', detail: `${findings.length} finding(s) · ${gaps.length} gap(s)${answerBack ? ' · answer-back rows' : ''}` });

  // ── stage:report — the deep-brief reports (the last nodes). The cross-bundle LEADERSHIP brief
  //    AND one AREA report per activated bundle that found something, all written CONCURRENTLY. Each runs on
  //    OpenAI gpt-5.5 when a key is present, else Claude, else a deterministic fallback — fail-open so a
  //    single writer never sinks the run. ──
  // Captured per-bundle area-report HTML (kept in memory only — the persisted metadata stays {id,title}) so the
  // Report Normalizer below can MERGE them with the leadership brief into one tabbed deliverable.
  // TWO-REPORT MODEL: a Full Scan ships exactly two reports — the Leadership brief
  // (written here) and the deterministic Execution report (rendered by finishRun from the model returned below). No
  // per-bundle area reports, no reconcile, no combined normalizer, no stand-alone provenance report.
  if (rzHas(rz, 'reports')) {
    // REPLAY — the reports checkpoint EMBEDS the leadership HTML. A pre-two-report cut may also carry area reports;
    // they are ignored (never re-saved), so a resumed child still ships only the two reports.
    const rep = rz!.data.reports;
    // REBIND the citation URLs: a replay copies the parent brief verbatim, so its /api/runs/<parent>/report
    // links would keep pointing at the parent — stale at once, and a 404 once that parent is trashed.
    if (rep.leadershipHtml) { run.leadershipHtml = rebindReportRefUrls(rep.leadershipHtml, run.id); ctx.saveReport(run.id + '-leadership', run.leadershipHtml); }
    ctx.log(run, reusedLine(rz!, 'report', `${rep.leadershipHtml ? 'leadership brief' : 'no leadership brief'} carried forward`));
  } else {
  const stamp = new Date().toISOString().slice(0, 10);
  const planes = ['code', hasWh && 'read-only warehouse', hasKv && 'key-value'].filter(Boolean).join(' + ');
  const meta = `${planes} · ${stamp}`;
  ctx.log(run, 'stage:report · writing the leadership brief (the Execution report is rendered deterministically at finish)');
  // Leadership: FREE-VIBE primary (Claude free-authors HTML → gpt-5.5 rewords; input/output secret-redacted),
  // with the STRUCTURED writer + its report red-team as the fail-open fallback. Area reports run concurrently
  // under the same 'reserve' node, as before.
  // systemKind = the run's OWN classification, and ONLY when there is a real one. An earlier version wired `compType`
  // here, but compType is never undefined — it falls back to 'manual selection' / 'resumed classification'
  // / the keyword guesses, and those would render as "a READ-ONLY audit of: manual selection". `classification`
  // (computed at the comprehend stage and checkpointed separately) is the optional real value, so this is
  // undefined on a manual / force-all / keyword-fallback / comprehend-failure run AND on a resume of one —
  // which is the branch the prompts' no-kind wording exists for. Both
  // prompts otherwise hardcode "a read-only recommendation/data audit", which is how an internal dev-tools
  // audit came out titled "Data & Recommendation System Audit" on a run comprehend had classified
  // `ranking: false`.
  const systemKind: string | undefined = classification;
  const orgLeadershipOpts: LeadershipWriterOpts = {
    company: run.targetName.replace(/^./, (c) => c.toUpperCase()), scopeDesc, meta,
    hypotheses: survivingHyp, mitigations: survivingMit, synthesis,
    // ONE gate for steering. `briefIsReal` already decides whether the brief drives the INVESTIGATION;
    // passing it here too keeps the report honest about the same decision. It used to be unconditional,
    // so "jordan test" was handed to the writer under the heading "THE READER'S ORIGINAL REQUEST — your
    // report must ANSWER this, in their framing/order": the report structured itself around a question
    // the sweep never pursued, and the answer-back rendered as "what you asked us to check". If a brief
    // is not real enough to steer the run, it is not real enough to be the report's inquiry.
    brief: briefIsReal ? run.brief : undefined, inquiry: briefIsReal ? run.brief : undefined, answerBack,
    authToken: ctx.live(run).authToken, triggeredBy: run.createdBy,
    variant: LEADERSHIP_VARIANT as LeadershipVariant, systemKind,
    // CROSS-REPORT CITATIONS. The engineering report is the deep-link target: it is the only tier rendered
    // DETERMINISTICALLY, so its anchors cannot be dropped by an LLM pass (the combined report is LLM-merged
    // and its guards check numbers/coverage but nothing about ids, so anchors do not survive it).
    // Same anchor map the renderer uses, from the shared helper, over the same array in the same order.
    reportRefs: buildReportRefs(findings, engineeringReportUrl(run.id)),
    // The tally the brief may state ("N confirmed findings"). GCP findings and the workspace evidence gate come
    // later; the final count is re-checked against the brief after them (FINDINGCOUNT, below).
    findingTotals: (({ confirmed, ruledOut }) => ({ confirmed, ruledOut }))(findingCounts(findings)),
    reportThemes: areaHealthThemes(lensGroups),
    // Leadership v5 (lens split): the author's business-only view + the injected capability map data. Only on v5 —
    // v0 / v4 keep Area health — and re-injected from the FINAL findings after GCP, like every other injected row.
    ...(LEADERSHIP_VARIANT === 'v5' ? { lens: leadershipLensFor(survivingHyp.map((h) => h.id), findings, gaps, lensGroups, synthesis?.lensOverrides, capMap) } : {}),
    log: (m) => ctx.log(run, m),   // cost captured by the ledger via the leaf wrappers (no onCost accumulator)
  };
  // BUDGET BACK-OFF: under reserve pressure, skip the ~3-pass free-vibe leadership (≈$1.4) and let
  // the structured writer + red-team branch below run instead — same posture as the structured red-team's own
  // reserveInvaded() gate. Area reports still run concurrently either way.
  // Leadership v5: the author is short, so it still runs when what is left of the cap covers its conservative estimate
  // (an end-to-end run: skipped with ≈$5 left of a $30 cap) — budget.leadershipAuthorAdmit.
  const vibeAdmit = leadershipAuthorAdmit(currentLedger(), Boolean(orgLeadershipOpts.lens) && lensSplitOn(orgLeadershipOpts));
  const vibeReserveOk = vibeAdmit.run;
  if (vibeAdmit.why) ctx.log(run, `stage:report · ${vibeAdmit.why}`);
  // ($15.09 on a $15.00 cap in one real run): a budget skip is a degradation the run hero shows, not only a log line.
  if (!vibeReserveOk) recordDegraded('leadership-writer', 'free-vibe leadership skipped — the run budget reserve was invaded (' + (lensSplitOn(orgLeadershipOpts) ? 'deterministic v5 brief' : 'structured writer') + ' used)');
  const vibeOrg = vibeReserveOk ? await withBudgetNode('reserve', () => writeLeadershipReportHtml(orgLeadershipOpts).catch(() => null)) : null;
  if (vibeOrg?.html) {
    // FREE-VIBE path. gpt-5.5 already did the executive-tone reword and the HTML is secret-redacted; the
    // The report red-team patches the STRUCTURED RecallReportInput and does not apply to free HTML, so it is
    // skipped here (a free-vibe-native red-team is a follow-up).
    run.leadershipHtml = vibeOrg.html;
    ctx.log(run, 'stage:report · leadership: free-vibe HTML (structured report red-team N/A to free HTML — skipped)');
  } else {
    // STRUCTURED fallback — the writer + the REPORT RED-TEAM (one independent gpt-5.5 pass over the
    // STRUCTURED leadership input → allowlisted patches: soften overclaims / add a caveat / drop a weak fix;
    // answer-back band off-limits). Skipped when the RESERVE is invaded so the run still finishes. Fail-open.
    ctx.log(run, 'stage:report · leadership: free-vibe unavailable — structured writer + report red-team fallback');
    const leadership = await withBudgetNode('reserve', () => writeLeadershipReport(orgLeadershipOpts));
    let leadershipFinal = leadership;
    const ledger = currentLedger();
    if (ledger?.reserveInvaded()) {
      ctx.log(run, 'stage:report · reserve budget invaded — skipping the report red-team (shipping the writer report as-is)');
      recordDegraded('report-redteam', 'skipped — the run budget reserve was invaded (writer report shipped as-is)');
    } else {
      try {
        const rt = await withBudgetNode('reserve', () => reportRedTeam({ report: leadership, authToken: ctx.live(run).authToken, root, log: (m) => ctx.log(run, m) }));
        leadershipFinal = rt.report;
        if (rt.applied) ctx.log(run, `stage:report · report red-team applied ${rt.applied} patch(es)`);
      } catch (e) { ctx.log(run, `stage:report · report red-team failed (${e instanceof Error ? e.message : String(e)}) — shipping the report unchanged`); }
    }
    // SANITIZE-LAST: the red-team mutates the report AFTER the writer's own sanitize, so redact once
    // more at the final render boundary — a red-team patch value can't introduce an un-redacted secret.
    // Same deterministic provenance banner the free-vibe path gets. Without this, a run that fell back to
    // the structured writer ships a leadership report with no provenance line at all — and the measured
    // share is a credibility claim that must not depend on which writer happened to succeed.
    // Citations on the FALLBACK path too. The free-vibe writer injects them itself; this path renders the
    // structured report and previously added only provenance, so a run that fell back under reserve pressure
    // shipped a brief with no engineering references at all. Both paths now cite.
    run.leadershipHtml = injectProvenance(
      injectDetailIndex(renderRecallReport(sanitizeReportInput(leadershipFinal)), orgLeadershipOpts.reportRefs ?? [], { themes: orgLeadershipOpts.reportThemes, ...(orgLeadershipOpts.lens ? { lens: orgLeadershipOpts.lens.brief, answerBack: lensAnswerBack(orgLeadershipOpts) } : {}) }),
      orgLeadershipOpts.generatedAt?.trim() || new Date().toISOString().slice(0, 10),
      orgLeadershipOpts.triggeredBy?.trim() ? orgLeadershipOpts.triggeredBy.trim().split('@')[0] : '',
      measuredSplit(survivingHyp, survivingMit),
    );
  }
  ctx.saveReport(run.id + '-leadership', run.leadershipHtml);   // persisted on disk like the internal report; survives restart
  ctx.log(run, 'stage:report · leadership brief ready');
  }
  // ◆ checkpoint: reports — the leadership brief (HTML embedded, see the replay note above). `bundleReports` stays in the
  // payload shape (always empty now) so the stage schema — and resume compatibility — is unchanged.
  ctx.saveCheckpoint(run, 'reports', { leadershipHtml: run.leadershipHtml ?? null, bundleReports: [] },
    { label: 'Leadership report', detail: run.leadershipHtml ? 'leadership brief saved' : 'no leadership brief' });

  // Persist the merged agent trajectory + tool tally the console used to DISCARD (only the CLI kept
  // trace.md). Stored via the SAME tenant-scoped run-report store; served at /api/runs/:id/trace; never
  // exposed on the public /share/<token> path (that serves only the final report). See store.ts.
  persistRunTrace(run, perBundle, ctx);

  // EXECUTION MODEL — per finding: fix · done when · how to verify · guardrail · found by, grouped by synthesis area,
  // plus the deterministic appendix (codeintel charts when the plane ran; the git-history spine). Built while the
  // workspace `root` still exists (executeOrgRun deletes it in its finally). Fail-open: no appendix on any error.
  let appendix: NonNullable<ExecutionModel['appendix']> = [];
  try { appendix = await buildExecutionAppendix(root, { codeintel: !!codeintelIdx, log: (m) => ctx.log(run, `stage:report · ${m}`) }); }
  catch (e) { ctx.log(run, `stage:report · execution appendix skipped (${e instanceof Error ? e.message : String(e)})`); }
  // The Code-intelligence card promises charts only when the Execution appendix actually carries them.
  run.codeintelInReports = appendix.some((a) => a.key === 'codeintel');
  // A lane reused by an incremental re-scan keeps its live-plane verdicts as "measured <date>" (proposal §3 option b).
  const measuredOnByBundle = Object.fromEntries(perBundle.filter((x) => x.reusedFrom && x.measuredAt).map((x) => [x.bundle.id, String(x.measuredAt).slice(0, 10)]));
  const execution = buildExecutionModel({ findings, hypotheses: [...survivingHyp, ...carryHyp], mitigations: [...survivingMit, ...carryMit], gaps, areas: synthesis?.areas, appendix, measuredOnByBundle, carriedById: carriedHow, lensOverrides: synthesis?.lensOverrides, capabilities });
  ctx.log(run, `stage:report · execution report: ${execution.groups.length} theme(s)${appendix.length ? ` · appendix: ${appendix.map((a) => a.key).join(', ')}` : ''}`);

  // Lineage (incremental re-scan): what a LATER scan of this target plans against — the activated bundles, the measure
  // planes that mounted, every lane's read set + spend, the node spend, and which bundles actually re-checked their
  // concerns this run (a lane that failed did not — its baseline findings are "unchecked", never "fixed").
  const lineage: LineageInfo = {
    bundleIds: bundles.map((x) => x.id),
    planeFps: mountedIdents.map((p) => p.fp).filter(Boolean),
    lanes: Object.fromEntries(perBundle.map((x) => [x.bundle.id, serializeLane(x)])),
    nodeSpend: currentLedger()?.nodeSpend() ?? {},
    checkedBundles: perBundle.filter((x) => !laneIncompleteReason(x.gaps)).map((x) => x.bundle.id),
    ...(uncheckedLoose.length ? { uncheckedLoose, uncheckedWhy } : {}),
    ranBundles: perBundle.map((x) => x.bundle.id),
    reused: { comprehend: Boolean(rzComp), lanes: [...replayedLanes] },
    ...(pendingPrior.length ? { pending: pendingPrior.map((p) => p.finding) } : {}),
    // Fuzzy tier (fuzzyMatch.ts): each finding's hypothesis metric rides in its keyed row, for the next scan's diff.
    metricById: Object.fromEntries([...allHyp, ...carryHyp].map((h) => [String(h.id).toLowerCase(), String(h.agentMetric || h.decisiveMetric || '')]).filter(([, m]) => m)),
  };
  return { findings, metrics: orgMetrics, costUsd: currentLedger()?.spent() ?? 0, coverageGaps: gaps, synthesisText: synthesisOverview(synthesis), answerBack, evalsToRun: allEvals, execution, lineage, lensOverrides: synthesis?.lensOverrides, ...(capabilities.length ? { capabilityMap: { capabilities, openedPaths: laneOpenedPaths, hypotheses: hypCites, ...(capMap?.assignments ? { assignments: [...capMap.assignments] } : {}) } } : {}) };
  }));   // end withMcpPolicy (read-only tool allowlist) + withPlaneManifest (mounted-plane hints)
}

// Recompute the rec-audit synthesis over the AUDIT-SURVIVING (+ reworded) claims when
// the claim audit changed anything, so a rejected claim can't linger in the report's hero synthesis text (which
// reportHtml prefers). If the audit accepted everything, the pre-computed synthesis is still valid — reuse it
// (no extra LLM call). If everything was rejected → no synthesis (findings/gaps still render). Fail-open: a
// recompute error keeps the prior synthesis.
export async function auditedRecAuditSynthesis(
  hyps: Hypothesis[], mits: Mitigation[], audits: AuditedClaim[], prior: DeepSynthesis | undefined,
  opts: { ledger: BudgetLedger; scopeDesc: string; root: string; mcpServers?: Record<string, unknown>; authToken?: string; log: (m: string) => void },
): Promise<DeepSynthesis | undefined> {
  const auditById = new Map(audits.map((a) => [a.hypothesisId, a]));
  const rejected = new Set(audits.filter((a) => a.verdict === 'reject' || a.auditStatus !== 'audited').map((a) => a.hypothesisId));
  const survHyp = hyps.filter((h) => !rejected.has(h.id)).map((h) => {
    const a = auditById.get(h.id);
    return a && a.verdict === 'downgrade' ? { ...h, claim: caveatedClaim(h.claim, a) } : h;
  });
  const survMit = mits.filter((m) => !rejected.has(m.hypothesisId));
  const changed = audits.some((a) => a.verdict !== 'accept' || a.auditStatus !== 'audited');
  // The base synthesis: when the claim audit CHANGED the set, `prior` (generated before the audit, over
  // rejected/uncaveated claims) is STALE → RE-SYNTHESIZE over the survivors; otherwise reuse `prior`.
  let base = prior;
  if (changed) {
    if (!survHyp.length) return undefined;
    opts.log(`stage:synthesize · re-synthesizing over ${survHyp.length} audit-surviving claim(s) (${rejected.size} rejected excluded)`);
    try { const sy = await withRunBudget(opts.ledger, 'reserve', () => synthesizeAudit(survHyp, survMit, { scopeDesc: opts.scopeDesc, root: opts.root, authToken: opts.authToken, mcpServers: opts.mcpServers, log: opts.log })); base = sy.synthesis; }
    catch { return undefined; }
  }
  if (!base) return undefined;
  // Gate the synthesis PROSE (bottomLine + leads) on the rec-audit path too, so un-audited
  // cross-bundle prose can't reach synthesisOverview here (the same gate the org path applies).
  // 'audit' node; fail-CLOSED (a failure drops the un-audited synthesis).
  try {
    const sa = await withRunBudget(opts.ledger, 'audit', () => runSynthesisClaimAudit({ synthesis: base, hypotheses: survHyp, mitigations: survMit, authToken: opts.authToken, root: opts.root, log: opts.log }));
    return sa.synthesis;
  } catch { return undefined; }
}

// Phase 3 carry-forward helpers: the evidence-free key of a prior finding, the open question a re-verify could not settle,
// and the diff hunks of a finding's changed evidence files (repo-relative, bounded).
function findingKeysLoose(f: Finding): string { return findingKeys(f).looseKey; }
function reverifyGap(f: Finding, bundleId: string, why: string): CoverageGap {
  return { id: `${carriedIdOf(f.id)}-RECHECK`, concern: `Still present? ${f.title}`, whyUnsettled: `the previous scan found this; its cited code changed since and ${why}`, nextDecisiveTest: `Re-check ${(f.evidence ?? []).map((e) => e.ref).slice(0, 2).join(', ') || 'its evidence'} against the current code (or run a Full rescan).`, source: 'incremental-reverify', status: 'not_evidenceable', bundleId };
}
function carriedIdOf(id: string): string { return String(id ?? '').replace(/[^A-Za-z0-9:-]/g, ''); }
function reverifyDiff(f: Finding, incr: NonNullable<ResumeSpec['incremental']>, root: string): string {
  const out: string[] = [];
  for (const p of evidenceFilePaths(f)) {
    const i = p.indexOf('/');
    const bRepo = incr.baselineRepos.find((r) => r.dir === p.slice(0, i));
    const repo = incr.repos.find((r) => r.fullName.toLowerCase() === (bRepo?.fullName ?? '').toLowerCase()) ?? (incr.repos.length === 1 ? incr.repos[0] : undefined);
    if (!repo?.baseSha || !repo.headSha) continue;
    const rel = bRepo ? p.slice(i + 1) : p;
    const d = gitDiffPath(join(root, repo.dir), repo.baseSha, repo.headSha, rel);
    if (d) out.push(d);
  }
  return out.join('\n').slice(0, 6000);
}

// Sum any number of per-tool tallies into one (undefined-safe).
function mergeTally(...tallies: (Record<string, number> | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tallies) for (const [k, v] of Object.entries(t ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

// Merge each bundle's Critique+Expert trajectory + tool tally into one run-level trace artifact and
// save it (tenant-scoped, like the reports). Best-effort: a trace failure never sinks the run.
//
// DATA-AT-REST POSTURE: the trace is diagnostic PROJECT DATA, not
// secrets — the agent is read-only and structurally credential-confined (no Bash/Web; file tools fenced
// to the repo by withinDir, so /proc + ~/.claude are unreachable), and tool args are already truncated
// (agent.ts onTrace, ≤300 chars). It is IN-KIND with the reports the store already persists (findings +
// evidence values) and shares their lifecycle: same tenant-scoped report store, gitignored `.data`,
// served only at the tenant-scoped /api/runs/:id/trace, never on the public /share path. It carries no
// tokens/credentials. (posture note #2.)
function persistRunTrace(run: Run, perBundle: { bundle: ExpertBundle; trace: string; toolTally: Record<string, number> }[], ctx: RunContext): void {
  try {
    const merged: Record<string, number> = {};
    const sections: string[] = [];
    for (const x of perBundle) {
      for (const [k, v] of Object.entries(x.toolTally)) merged[k] = (merged[k] ?? 0) + v;
      if (x.trace) sections.push(`### [${x.bundle.id}] ${x.bundle.title}\n\n${x.trace}`);
    }
    const tally = Object.entries(merged).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  ');
    if (tally) ctx.log(run, `stage:report · tools/MCPs pulled across bundles: ${tally}`);
    if (!sections.length) return;                                  // nothing captured (e.g. floor-scan fallback)
    const body = `# Run trace — ${run.targetName}\n\nTool tally: ${tally || '(none)'}\n\n${sections.join('\n\n---\n\n')}`;
    ctx.saveReport(run.id + '-trace', `<!doctype html><meta charset="utf-8"><title>Run trace · ${escapeHtml(run.targetName)}</title><body style="margin:0;background:#1b140f;color:#f6efe6;font:13px/1.6 ui-monospace,Menlo,monospace"><pre style="white-space:pre-wrap;word-break:break-word;padding:20px;margin:0">${escapeHtml(body)}</pre></body>`);
    // Only advertise the affordance if the write actually landed (saveReport swallows errors) — else
    // the "Run trace" button would 404.
    if (reportExists(run.id + '-trace')) run.hasTrace = true;
  } catch { /* best-effort — trace persistence never sinks a run */ }
}

// The GitHub clone / API credential of a source: the token pasted at Connect (in memory, or saved on this machine).
export async function tokenForRun(src: Source): Promise<string | undefined> {
  return src.token;
}

// The text an org run's Haiku title is generated from, or undefined for NO title call. Only an AGENTIC run with a
// real brief: a bare targetName ("1 folder", "1 public repo") is not a question, and the model answered it with a
// refusal or an invented title that then replaced the run's name; a deterministic run makes no
// LLM call at all.
export function orgRunTitleSource(run: Pick<Run, 'mode' | 'brief'>): string | undefined {
  const brief = String(run.brief ?? '').trim();
  return run.mode === 'agentic' && brief ? brief : undefined;
}

// One run = the whole org across every selected artifact: clone+mine the selected
// GitHub repos, scan the selected GCP projects (read-only), merge into ONE report.
export async function executeOrgRun(run: Run, ctx: RunContext): Promise<void> {
  ctx.live(run).abort = ctx.live(run).abort ?? new AbortController();
  return withRunAbort(ctx.live(run).abort!.signal, async () => {
  console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: run.id, tenant: run.tenant, event: 'start', mode: run.mode, target: run.targetName, hasBrief: Boolean(run.brief) }));
  // Main/org runs: Haiku title from the run brief / target, mirroring the accel-mini path. Fail-open:
  // any error / empty result keeps the run's existing targetName. Skipped if the user set a manual title
  // override (run.renamed) — a human edit always wins. A RESUMED child keeps the parent's title.
  const titleFrom = orgRunTitleSource(run);
  // The title runs before the run's ledger exists, so its Haiku spend is captured in a throwaway ledger and folded into
  // the run ledger once it is created (it used to be missing from run.costUsd).
  const titleLedger = new BudgetLedger(0);
  if (!run.renamed && !ctx.live(run).resumeSpec && titleFrom) {
    const gen = await withRunBudget(titleLedger, 'discovery', () => generateRunTitle(titleFrom, ctx.live(run).authToken));
    if (gen) { ctx.updateRun(run, (r) => { r.targetName = gen; ctx.log(r, `run title generated: ${gen}`); }); }
  }
  // Bind the run's SELF-CONTAINED source snapshot before ANY source read. Normally set at create (boundSources =
  // the live set, with raw tokens); if absent (a run whose in-memory companion didn't survive) rehydrate the
  // persisted non-secret snapshot (refs resolve per-run via tokenForRun). Legacy pre-pin runs (neither) fall back to
  // the live tenant set = old behavior. From here the whole execute graph reads runSourceSet(run) = boundSources.
  if (!ctx.live(run).boundSources) ctx.live(run).boundSources = (run.pinnedSources ?? ctx.tenantSources(run).map(persistableSource)).map((s) => rehydratePersistedSource(s));
  // DEFENSE-IN-DEPTH: re-apply the run's explicit data-plane selection to the bound snapshot. The create + resume paths
  // already scoped it; re-applying here makes the gate hold for every path that binds sources (the rehydrate fallback
  // above). A legacy run record (null filter) keeps its all-planes snapshot — loudly.
  const planeSel = { planeFilter: run.planeFilter ?? null };
  ctx.live(run).boundSources = scopeSourcesToSelection(ctx.live(run).boundSources!, planeSel);
  if (planeSel.planeFilter === null) ctx.log(run, '⚠ legacy run record (no per-run data-plane selection) — every connected data plane stays mountable');
  const srcSet = ctx.sourcesFor(run);
  const gh = srcSet.find((s) => s.kind === 'github');
  const local = srcSet.find((s) => s.kind === 'local');
  const giturl = srcSet.find((s) => s.kind === 'giturl');
  const findings: Finding[] = [];
  const coverageGaps: CoverageGap[] = [];
  let metrics: any = null;
  let synthesisText: string | undefined;
  let answerBack: AnswerBackRow[] | undefined;
  let evalsToRun: EvalToRun[] | undefined;
  let execution: ExecutionModel | undefined;
  let lensOverrides: LensOverride[] | undefined;   // report lens split: the synthesis overrides, for the final capability map
  let capabilityMap: OrgRunResult['capabilityMap'];   // Phase 2: Comprehend's map + the lanes' read paths, for the final map
  let costUsd: number | null = null;
  // Incremental re-scan (src/run/incrementalRun.ts): the plan against the baseline (set after the clone), the lineage the
  // pipeline hands back, and this run's keyed final findings (the next run's baseline keys).
  let incrRt: IncrRuntime | null = null;
  let lineageInfo: LineageInfo | undefined;
  // The run's budget ledger, kept for the post-discovery cross-project fact pass (priced into the run cost).
  let runLedger: BudgetLedger | undefined;
  // Cross-project memory: the sibling CONTRAST holder (opt-in) and the per-run repo-access checker (clone credential).
  let contrastHolder: ContrastHolder | undefined;
  let xpAccessMemo: ((f: { repo: string; repoFullName?: string; public?: boolean }) => Promise<boolean>) | undefined;
  const xpAccessFor = (m: WorkspaceManifest) => (xpAccessMemo ??= makeAccessChecker({
    repos: workspaceRepos(m, localNamesFor(srcSet)),
    localSourceIds: new Set(srcSet.filter((s) => s.kind === 'local').map((s) => s.id)),
    // The clone credential: the org GitHub token when this run clones GitHub-source repos, else tokenless (a public-URL
    // run reaches only public siblings) — exactly what the clone above used.
    probe: async (u, timeoutMs) => { const tok = gh && run.repoFilter && run.repoFilter.length ? await tokenForRun(gh) : undefined; return (await probeRepoAccess(u, tok, { timeoutMs })).ok; },
  }));
  const tmp = mkdtempSync(join(tmpdir(), 'theresa-org-'));
  try {
    // Gather every selected code target (cloned GitHub repos + copied local folders) into one
    // temp "org" dir, then analyze it ONCE. Local repos are COPIED (read-only snapshot); agents are read-only.
    // The WORKSPACE MANIFEST records each repo @ its resolved HEAD SHA (checkpoint/resume: a resumed child
    // re-clones from the manifest and checks out the pinned SHA, so it sees the exact code the parent measured).
    let ok = 0;
    // Every selected target that did NOT make it into the workspace, with WHY — the terminal message is built
    // from this, so an all-unreachable run says "could not access N selected repo(s): …" instead of "select one".
    const unreachable: UnreachableTarget[] = [];
    const manifest: WorkspaceManifest = { repos: [], localDirs: [] };
    const rz = ctx.live(run).resumeSpec;
    const pins: WorkspaceRepoPin[] = rz?.data.workspace?.manifest?.repos ?? [];
    if (rz && pins.length) {
      const token = gh ? await tokenForRun(gh) : undefined;
      ctx.log(run, `⟳ rebuilding workspace from ${rz.parentLabel}'s manifest — ${pins.length} repo(s) @ pinned SHAs`);
      const diverged: string[] = [];
      for (let i = 0; i < pins.length; i++) {
        const p = pins[i];
        ctx.log(run, `cloning ${p.fullName} (${i + 1}/${pins.length}) …`);
        try {
          const dest = join(tmp, p.dir);
          // A `public` pin (giturl) is re-cloned TOKENLESS regardless of any GitHub source connected in
          // THIS session — a public-URL scan must never silently gain a token's elevated read access on
          // resume (e.g. the repo went private since the parent run).
          await cloneRepo(p.cloneUrl, p.public ? undefined : token, dest, p.branch);
          if (p.sha && gitHeadSha(dest) !== p.sha && !gitCheckoutSha(dest, p.sha)) { diverged.push(p.fullName); ctx.log(run, `  ⚠ ${p.fullName}: pinned SHA ${p.sha.slice(0, 10)} unavailable — using current HEAD`); }
          manifest.repos.push({ ...p, sha: gitHeadSha(dest) ?? p.sha }); ok++;
        } catch (e) { const reason = e instanceof Error ? e.message : String(e); unreachable.push({ name: p.fullName, kind: 'repo', reason }); ctx.log(run, `  skipped ${p.fullName}: ${reason}`); }
      }
      // A pin that can't be honored (force-push etc.) weakens the self-consistent-cut guarantee: reused
      // measurements describe the PARENT's SHA while later stages read newer code. Accepted with a LOUD
      // summary (fail-open beats refusing 96 good repos over 1 divergent one).
      if (diverged.length) ctx.log(run, `⚠ ${diverged.length} repo(s) could not be pinned to the parent's SHAs (${diverged.slice(0, 5).join(', ')}${diverged.length > 5 ? ', …' : ''}) — reused measurements describe the parent's code; downstream stages read NEWER code for these repos`);
    } else {
      // FRESH (non-resume) run: github and giturl repos are each independently clone-able from a stable
      // URL, so BOTH live sources fire here when connected/selected together. On a RESUME, the `if (rz &&
      // pins.length)` branch above already rebuilt every repo (github AND giturl) from the unified pins
      // array — respecting each pin's `public` flag — so this `else` does NOT also run; this
      // used to be a separate top-level `if` outside the else-if chain and double-cloned every giturl
      // repo on resume (once from the pins rebuild, once again here from the live source).
      if (gh && run.repoFilter && run.repoFilter.length) {
        const token = await tokenForRun(gh);
        if (!token) ctx.log(run, `⚠ no GitHub clone credential resolved for this org — only public repos can be reached`);
        // A selected repo the listing no longer carries was dropped SILENTLY by the old `.filter` — report it.
        const { targets: repos, notListed } = resolveSelectedRepos(gh.repos ?? [], run.repoFilter);
        for (const u of notListed) { unreachable.push(u); ctx.log(run, `  skipped ${u.name}: ${u.reason}`); }
        // PRE-FLIGHT: reach every target with the SAME credential the clone uses (git ls-remote over the same
        // hermetic transport) BEFORE cloning, so an unreachable repo is named with git's own reason up front. Bounded
        // parallelism — refs only, no objects. The outcome is also recorded on the source's repo listing
        // (cloneable:false + reason) so the picker can stop offering repos this credential cannot clone.
        const probe = new Map<string, string | null>();
        for (let i = 0; i < repos.length; i += 6) {
          await Promise.all(repos.slice(i, i + 6).map(async (r) => { const p = await probeRepoAccess(r.cloneUrl, token); probe.set(r.fullName, p.ok ? null : p.reason); }));
        }
        markCloneable(gh.repos, probe);
        const liveGh = ctx.tenantSources(run).find((s) => s.kind === 'github' && s.id === gh.id);
        if (liveGh && liveGh !== gh) markCloneable(liveGh.repos, probe);
        const reachable = repos.filter((r) => probe.get(r.fullName) == null);
        for (const r of repos) {
          const reason = probe.get(r.fullName);
          if (reason != null) { unreachable.push({ name: r.fullName, kind: 'repo', reason }); ctx.log(run, `  skipped ${r.fullName}: ${reason}`); }
        }
        if (repos.length) ctx.log(run, `pre-flight: ${reachable.length}/${repos.length} selected repo(s) reachable with the clone credential`);
        for (let i = 0; i < reachable.length; i++) {
          const r = reachable[i];
          ctx.log(run, `cloning ${r.fullName} (${i + 1}/${reachable.length}) …`);
          const dir = r.fullName.split('/')[1] || ('repo' + i);
          try {
            const dest = join(tmp, dir);
            await cloneRepo(r.cloneUrl, token, dest);
            manifest.repos.push({ fullName: r.fullName, cloneUrl: r.cloneUrl, sha: gitHeadSha(dest), dir }); ok++;
          }
          catch (e) { const reason = e instanceof Error ? e.message : String(e); unreachable.push({ name: r.fullName, kind: 'repo', reason }); ctx.log(run, `  skipped ${r.fullName}: ${reason}`); }
        }
      }
      // PUBLIC github.com URLs (giturl source): clone TOKENLESS (no auth) — a private/404 repo just fails
      // and is skipped (fail-open). cloneUrl came from parseRepoRef (github.com-only), so
      // there is no arbitrary-host clone here. Included in the manifest (public:true) so a resume rebuilds
      // it from the pins branch above, tokenless, instead of re-running this live block.
      if (giturl && run.giturlFilter && run.giturlFilter.length) {
        // Dedupe against repos ALREADY cloned by the GitHub block above: the same repo can be selected from
        // both an authenticated GitHub source and this public-URL source, and cloning it twice would put two
        // copies in the workspace (double-scanned, wasted work). Skip any giturl repo whose fullName is
        // already in the manifest — the GitHub (authenticated) clone wins, since it can also read it private.
        const alreadyCloned = new Set(manifest.repos.map((p) => p.fullName));
        const repos = (giturl.giturlRepos ?? []).filter((r) => run.giturlFilter!.includes(r.fullName) && !alreadyCloned.has(r.fullName));
        for (let i = 0; i < repos.length; i++) {
          const r = repos[i];
          ctx.log(run, `cloning public ${r.fullName} (${i + 1}/${repos.length}) …`);
          const { dir: dest, name: dir } = uniqueChildDir(tmp, r.fullName.split('/')[1] || ('repo' + i));
          try {
            await cloneRepo(r.cloneUrl, undefined, dest);   // TOKENLESS public clone
            manifest.repos.push({ fullName: r.fullName, cloneUrl: r.cloneUrl, sha: gitHeadSha(dest), dir, public: true }); ok++;
          }
          catch (e) { const reason = `not a public github.com repo (private / not found) — ${e instanceof Error ? e.message : String(e)}`; unreachable.push({ name: r.fullName, kind: 'repo', reason }); ctx.log(run, `  skipped ${r.fullName}: ${reason}`); }
        }
      }
    }
    if (local && run.localFilter && run.localFilter.length) {
      // COPY (not symlink) the selected folders into the workspace: the agent's Glob/Grep and the
      // org-map scanner DON'T follow symlinks, so a symlinked repo reads as an empty scope. We copy a
      // read-only snapshot (keeping .git for history, skipping dep/build bloat); the source is untouched.
      const picked = (local.localRepos ?? []).filter((r) => run.localFilter!.includes(r.path));
      for (const r of picked) {
        let name = r.name, n = 2;                                  // unique dir name (folders can share a basename)
        while (existsSync(join(tmp, name))) name = `${r.name}-${n++}`;
        const dest = join(tmp, name);
        ctx.log(run, `copying local folder ${name} (read-only snapshot, skipping deps) …`);
        try {
          // Shared filter: skips dep/build dirs, symlinks and local secrets (.env, private keys, the data dir).
          cpSync(r.path, dest, { recursive: true, dereference: false, filter: localCopyFilter(r.path) });
          // never silently truncate: a copy that produced an empty tree is a bad path, not a clean repo
          if (!existsSync(dest) || !readdirSync(dest).length) { unreachable.push({ name: r.name, kind: 'folder', reason: 'copied empty (bad path?)' }); ctx.log(run, `  ⚠ ${r.name} copied EMPTY — skipped (bad path?)`); rmSync(dest, { recursive: true, force: true }); }
          else {
            ok++;
            // Cheap fingerprint (file count + bytes) so a RESUME can detect the folder changed since the
            // parent measured it — local dirs are re-copied LIVE, unlike SHA-pinned repos.
            const fp = dirFingerprint(dest);
            manifest.localDirs.push({ path: r.path, name, ...(fp ?? {}) });
            const pin = rz?.data.workspace?.manifest?.localDirs?.find((d: WorkspaceLocalPin) => d.path === r.path);
            if (pin && fp && pin.files != null && (pin.files !== fp.files || pin.bytes !== fp.bytes)) {
              ctx.log(run, `  ⚠ ${name} CHANGED since the parent run (${pin.files} files/${pin.bytes} B → ${fp.files}/${fp.bytes}) — reused measurements describe the parent's copy`);
            }
          }
        }
        catch (e) { const reason = e instanceof Error ? e.message : String(e); unreachable.push({ name: r.name, kind: 'folder', reason }); ctx.log(run, `  skipped ${r.name}: ${reason}`); }
      }
    }
    if (ok) {
      ctx.log(run, `analyzing ${ok} repo(s)`);
      // A ticked Design & Evolution report over a workspace with NO git history (uploaded / .git-less folders)
      // used to vanish silently at the very end ("[provenance] no git repos … skipped"). Say so at START, and record
      // it as a run degradation so the run page's banner shows it.
      // Two-report model: the stand-alone Design & Evolution report is gone (its git spine is the Execution appendix,
      // built whenever there is history), so a ticked run.docRecovery — an older client / a resumed parent — changes nothing.
      const deWarn = designEvolutionWarning({ ticked: false, available: docRecoveryEnabled(), agentic: run.mode === 'agentic', hasGitHistory: workspaceHasGitHistory(tmp) });
      if (deWarn) { ctx.updateRun(run, (r) => { noteDegraded(r, 'design-evolution', deWarn); }); ctx.log(run, `⚠ ${deWarn}`); }
      // ◆ checkpoint: workspace — inputs are already on the Run record (persisted); the payload adds the
      // pinned-SHA manifest a resume rebuilds from. Local folders resume from their live paths (re-copied;
      // a dirty folder is not faithfully resumable — accepted for v1, logged in the design doc).
      ctx.saveCheckpoint(run, 'workspace', { manifest },
        { label: 'Workspace ready', detail: `${manifest.repos.length} repo(s) @ pinned SHAs${manifest.localDirs.length ? ` + ${manifest.localDirs.length} local folder(s)` : ''}` });
      // Org-memory PUSH into the agentic COMPREHEND→CRITIQUE→EXPERT agents — recall once, version-pinned,
      // node-scoped (toolFree writers/QC excluded via runAgent). Fail-open + gated on THERESA_MEMORY_PUSH.
      // MUTUAL EXCLUSION with the auto-mounted OSV plane: a PUBLIC-ONLY-scope run (giturl-only
      // tenant, no other source) auto-mounts OSV and posts locked package coordinates to a third party, so it
      // must NOT also inject this org's private memory cards into the same prompts — a public third-party scan
      // runs without your org's private knowledge. THERESA_OSV=1 is the local-machine opt-in ,
      // so it does not force this suppression. Keeps the default public-URL scan path working (OSV reachable)
      // AND closes the private-memory→OSV leak by construction, instead of the unreachable useMemory-off gate.
      let orgMemPush = ''; let orgMemVersion: number | null = null;
      const orgMemId = run.orgId ?? orgIdForTenant(run.tenant);
      const osvSuppressMemory = osvPublicOnly(run, [...srcSet, ...envMcpSources()]);   // auto-mount scope; THERESA_OSV path is excluded on purpose
      if (osvSuppressMemory && run.useMemory !== false && orgMemId && memoryEnabled() && memoryPushEnabled()) {
        ctx.log(run, 'org-memory recall suppressed — public-only scope run with the OSV advisory plane auto-mounted (a public third-party scan does not inject this org\'s private memory)');
      }
      const orgMemRepos = (run.auditRepos ?? run.askRepos)?.map((r) => r.fullName) ?? (run.repoFilter?.length || run.giturlFilter?.length ? [...(run.repoFilter ?? []), ...(run.giturlFilter ?? [])] : undefined);
      // OSV suppression applies to the PULL too: fold !osvSuppressMemory into orgMemActive so a public-only
      // scan neither pushes NOR lets the agent pull this org's private memory (orgMemRecall reuses this below).
      const orgMemActive = Boolean(orgMemId) && memoryEnabled() && memoryPushEnabled() && run.useMemory !== false && !osvSuppressMemory;
      if (orgMemActive) {
        const { block, count, version, cards } = await execMemoryBrief(orgMemId!, run.targetName || '', run.brief || '', { actor: run.createdBy, repos: orgMemRepos });
        orgMemPush = block; orgMemVersion = version;
        if (block) { ctx.log(run, `org-memory push: ${count} card(s) @ memory v${version}`); for (const line of memoryCardLines(cards)) ctx.log(run, line); }
        else { const l = memoryRecallStatusLine({ requested: true, configured: true, pushEnabled: true, count: 0, version }); if (l) ctx.log(run, l); }
      } else {
        // Say WHY nothing was recalled (the scope line only says "memory recall on").
        const l = memoryRecallStatusLine({ requested: run.useMemory !== false, suppressed: osvSuppressMemory && memoryEnabled() && memoryPushEnabled() && Boolean(orgMemId), configured: memoryEnabled(), pushEnabled: memoryPushEnabled(), noOrg: !orgMemId });
        if (l) ctx.log(run, l);
      }
      // INCREMENTAL RE-SCAN — with the fresh clone in place, plan against the newest usable baseline of this exact target
      // set in this org: an `unchanged` / `incremental` plan installs a replay context (loaded from the BASELINE's
      // checkpoint sidecars) that the resume machinery below replays at $0. Agentic Full Scans only; a manual resume
      // child is never re-planned. Fail-open: any planning problem logs a reason and the run is a normal full scan.
      // Planned AFTER the org-memory recall: the pinned memory version is part of the inputs
      // signature — a lane that reasoned from memory cards is not reused once the org's memory changed.
      if (run.mode === 'agentic') {
        const planeSrc = [...srcSet, ...envMcpSources()];
        const prep = prepareIncremental(run, ctx, tmp, manifest, {
          planeFps: measurePlaneIdentities(planeSrc).map((p) => p.fp),
          codeintel: codeintelEnabled() && run.codeintel !== false,
          osv: osvPublicOnly(run, planeSrc) || process.env.THERESA_OSV === '1',
          memoryVersion: orgMemActive ? orgMemVersion : null,
        });
        if (prep) { incrRt = prep.rt; if (prep.spec) ctx.live(run).resumeSpec = prep.spec; }
      }
      // Org-memory PULL (symmetric with the push): memory-eligible agents can recall durable knowledge on demand
      // mid-run via mcp__orgmemory__memory_recall. Same org/repo scope + gating as the push above.
      const orgMemRecall = orgMemActive ? { orgId: orgMemId!, actor: run.createdBy, repos: orgMemRepos } : undefined;
      // Agentic runs drive the COMPREHEND → CRITIQUE → EXPERT pipeline (the v3 stages the console shows),
      // which also emits the second, leadership report. Deterministic runs stay on the evidence-only path.
      // Enter the per-run budget context so EVERY nested LLM leaf call (Claude agents + OpenAI text-out
      // steps) attributes its cost to one ledger — the authoritative run cost (incl. OpenAI, which the
      // old manual accumulator under-counted for budget purposes). The process-wide LLM semaphore lives
      // in the leaf wrappers; this context is per-run.
      // runLedgerHooks: the ledger also streams LIVE spend into run.costUsd and fail-open stages' recordDegraded rows into run.degraded.
      const ledger = new BudgetLedger(ctx.effectiveRunBudget, runLedgerHooks(run, ctx)); runLedger = ledger;   // force-all (no explicit budget) → unbounded, so no bundle is budget-skipped
      if (titleLedger.spent() > 0) ledger.spend('discovery', titleLedger.spent());   // the run title's Haiku call (made before this ledger)
      // Enter the per-run AUDIT context (flight recorder): every nested LLM leaf spools its full I/O to the
      // run's audit.jsonl. Separate ALS from the budget ledger; the run-end render reads it back.
      const auditRec = new AuditRecorder(ctx.reportArtifactPath(run.id, 'audit.jsonl'));
      // SIBLING RECALL (cross-project org memory §3, run.siblingRecall — explicit per-run opt-in, default off). The holder
      // is EMPTY here and filled after Comprehend; the access checker probes a sibling repo with the SAME credential this
      // run clones with (cached per run). Suppressed on a public-only OSV scope for the same reason org memory is: a
      // public third-party scan never carries this org's private knowledge.
      let sibling: { holder: ContrastHolder; canAccess: (f: FactCard) => Promise<boolean> } | undefined;
      // PUBLIC-ONLY OSV scope (recall used to be suppressed outright there): CONTRAST is allowed but
      // restricted to sibling facts of PUBLIC repos, checked with a TOKENLESS checker (a repo of this all-public workspace,
      // or a tokenless probe — a fact's stored `public` flag is ignored); no value-free line about a
      // private project is ever written. Private
      // org knowledge therefore never enters a run whose OSV plane posts to a third party. Org memory (backend cards)
      // push / pull stays suppressed there (above).
      if (run.siblingRecall === true && run.mode === 'agentic') {
        contrastHolder = { block: '', facts: [], ...(osvSuppressMemory ? { publicOnly: true } : {}) };
        const canAccess = osvSuppressMemory
          ? makeAccessChecker({ repos: workspaceRepos(manifest, localNamesFor(srcSet)).filter((r) => r.public), localSourceIds: new Set(), ignoreStoredPublic: true, probe: async (u, timeoutMs) => (await probeRepoAccess(u, undefined, { timeoutMs })).ok })
          : xpAccessFor(manifest);
        sibling = { holder: contrastHolder, canAccess };
        if (osvSuppressMemory) ctx.log(run, 'sibling recall: public-only scope (OSV advisory plane auto-mounted) — only facts from public repos are eligible; no line about a private project is given');
      }
      const runDiscovery = () => withContrastScope(contrastHolder, () => withMemoryPush(orgMemPush, () => withAuditRun(auditRec, () => withRunBudget(ledger, 'discovery', () =>
        run.mode === 'agentic' ? orgCritiqueExpert(run, tmp, ctx, { manifest, ...(sibling ? { sibling } : {}) }) : orgDeterministic(run, tmp, ctx)))));
      const res = await withMemoryRecall(orgMemRecall, runDiscovery);
      findings.push(...res.findings); metrics = res.metrics ?? metrics;
      if (res.coverageGaps) coverageGaps.push(...res.coverageGaps);
      synthesisText = res.synthesisText ?? synthesisText;
      answerBack = res.answerBack ?? answerBack;
      evalsToRun = res.evalsToRun ?? evalsToRun;
      execution = res.execution ?? execution;
      lensOverrides = res.lensOverrides ?? lensOverrides;
      capabilityMap = res.capabilityMap ?? capabilityMap;
      lineageInfo = res.lineage;
      costUsd = ledger.spent() || res.costUsd || costUsd;   // ledger is authoritative; res.costUsd is a fallback
    }
    // Report lens split: the GCP findings arrive after the findings stage labelled the rest — label them too (bundle-less
    // ⇒ business, no capability); every earlier label is kept as is.
    findings.splice(0, findings.length, ...labelFindings(findings, { capabilities: capabilityMap?.capabilities, assignments: capabilityMap?.assignments }));
    // CITATIONS, rebuilt from the FINAL findings. The block is injected while the brief is authored (inside
    // orgCritiqueExpert), but GCP findings are appended AFTER that returns — so the first block omitted every
    // GCP finding while the engineering report it cites includes them, contradicting its own claim to locate
    // the evidence for EACH finding. Re-injecting replaces it with the complete list.
    // The citations and the Combined findings index are numbered over the array the engineering report will
    // actually render — finish() applies the WORKSPACE-aware evidence gate, which can drop a finding the plain
    // gate keeps, and one dropped finding would shift every later F-id between the tiers.
    // CROSS-PROJECT INCONSISTENCY findings (§4): a finding citing a sibling fact from this run's CONTRAST block stays a
    // finding only when both sides are verified (this project's evidence resolves; the sibling file re-checked in the
    // workspace or at its SHA via the GitHub API with the clone credential) — mapped to i1 / i2 and tagged "Across
    // projects"; otherwise it becomes an open question. Deterministic apart from the re-check fetch; fail-open.
    let xpTags: Record<string, CrossProjectTag> = {};
    if (contrastHolder?.facts.length) {
      try {
        const cloneTok = gh && run.repoFilter && run.repoFilter.length ? await tokenForRun(gh) : undefined;
        const xr = await crossProjectFindings(findings, contrastHolder.facts, { root: tmp, repos: workspaceRepos(manifest, localNamesFor(srcSet)), isRuledOut: isRuledOutFinding, recheck: (full, sha, path) => githubFileAtSha(full, sha, path, cloneTok), runId: run.id });
        findings.splice(0, findings.length, ...xr.findings);
        coverageGaps.push(...xr.gaps);
        xpTags = xr.tags;
        if (execution && xr.demoted.length) execution = { ...execution, groups: execution.groups.map((g) => { const d = xr.demoted.filter((x) => g.findingIds.includes(x.id)); return d.length ? { ...g, findingIds: g.findingIds.filter((id) => !d.some((x) => x.id === id)), gapIds: [...g.gapIds, ...d.map((x) => x.gapId)] } : g; }) };
        const n = Object.keys(xr.tags).length;
        if (n || xr.demoted.length) ctx.log(run, `cross-project: ${n} inconsistency finding(s) settled on both sides${xr.demoted.length ? ` · ${xr.demoted.length} turned into open question(s) (sibling side not verifiable)` : ''}`);
      } catch (e) { ctx.log(run, `cross-project: finding check skipped (${e instanceof Error ? e.message : String(e)})`); }
    }
    const reportFindings = findings.filter((f) => findingResolvesInWorkspace(f, tmp));
    // SINCE LAST SCAN (incremental re-scan §5) — deterministic, over the SAME gated array the Execution report renders:
    // fixed / new / persisting / changed against the baseline's findings. A baseline finding whose bundle did not re-check
    // its concerns this run (lane failed, not activated, floor-scan fallback) is `unchecked`, never counted as fixed.
    const keyRows = incrRt ? keyRowsFor(reportFindings, tmp, (f) => lineageInfo?.metricById?.[String(f.id).toLowerCase()]) : [];
    // A carried / replayed finding keeps its "Across projects" tag: the previous run's keyed sidecar tags
    // are re-applied by finding key (stable across the tag) to findings this run did not re-tag.
    if (incrRt && keyRows.length) {
      try {
        const bt = baselineCrossProjectTags(ctx, incrRt);
        const keyOfId = new Map(keyRows.map((r) => [r.id, r.key]));
        const n = bt.size ? reapplyCrossProjectTags(reportFindings, (f) => keyOfId.get(String(f.id)), bt, xpTags) : 0;
        if (n) {
          const byId = new Map(reportFindings.map((f) => [String(f.id), f]));
          for (const r of keyRows) { const x = byId.get(r.id)?.xproj; if (x && !r.xproj) r.xproj = x; }
          ctx.log(run, `cross-project: ${n} carried finding(s) keep their "Across projects" tag from ${incrRt.baseline?.runId ?? incrRt.inherit?.baselineRunId}`);
        }
      } catch (e) { ctx.log(run, `cross-project: carried tags skipped (${e instanceof Error ? e.message : String(e)})`); }
    }
    const since = incrRt ? sinceLastScanFor(ctx, incrRt, keyRows, tmp, new Set(lineageInfo?.checkedBundles ?? []), new Set(lineageInfo?.uncheckedLoose ?? []), { uncheckedWhy: new Map(Object.entries(lineageInfo?.uncheckedWhy ?? {})), ranBundles: new Set(lineageInfo?.ranBundles ?? []) }) : null;
    if (since) {
      const c = since.counts;
      const byWhy = uncheckedByWhy(since.unchecked);
      ctx.log(run, `since last scan: ${c.fixed} fixed · ${c.new} new · ${c.persisting} persisting · ${c.changed} changed${c.unchecked ? ` · ${c.unchecked} not counted as fixed (${uncheckedBreakdown(byWhy)})` : ''} (baseline ${since.baseline.runId}, ${since.baseline.date})`);
      if (execution) execution = { ...execution, sinceLastScan: { baseline: { runId: since.baseline.runId, date: since.baseline.date, ...(since.baseline.sha ? { sha: since.baseline.sha } : {}) }, counts: c, tags: Object.fromEntries(Object.entries(since.tags).map(([id, t]) => [id, { status: t.status, ...(t.since ? { since: t.since } : {}) }])), fixed: since.fixed.map((f) => ({ title: f.title, severity: f.severity, ...(f.displayId ? { displayId: f.displayId } : {}) })), unchecked: since.unchecked.map((u) => ({ title: u.title, severity: u.severity, why: u.why })) } };
      ctx.updateRun(run, (r) => { if (r.incremental) r.incremental.since = { ...c, ...(c.unchecked ? { uncheckedWhy: byWhy } : {}) }; });
    }
    // CROSS-PROJECT ORG MEMORY (src/run/crossProject.ts, org-cross-project-memory.md §2) — fact cards are PREPARED here,
    // while the workspace still exists (deterministic manifests / codeintel / OSV + one budget-capped Haiku pass over the
    // final verdicts), and COMMITTED below only once the run completed. Derived run data like checkpoints — NOT gated on
    // run.writeMemory. Fail-open: a failure is logged + a run.degraded row; the run goes on.
    // No org scope (orgless + tenantless) ⇒ no cross-project memory at all, like lineage: xpRepos stays
    // empty so every block below is skipped.
    const xpOrgKey = orgKeyFor(run.orgId ?? orgIdForTenant(run.tenant), run.tenant);
    const xpOrg = xpOrgKey ?? '';
    const xpRepos = xpOrgKey ? workspaceRepos(manifest, localNamesFor(ctx.sourcesFor(run))) : [];
    const xpProjectOf = projectResolverFor(xpOrg, xpRepos);
    let pendingFacts: PendingFacts | null = null;
    if (run.mode === 'agentic' && (run.kind ?? 'org') === 'org' && ok && xpRepos.length) {
      pendingFacts = await prepareRunFacts({
        orgKey: xpOrg, runId: run.id, root: tmp, repos: xpRepos, projectOf: xpProjectOf, findings: reportFindings, isRuledOut: isRuledOutFinding,
        measuredOf: (f) => execution?.items[f.id]?.measured, ledger: runLedger, authToken: ctx.live(run).authToken, log: (m) => ctx.log(run, m),
        degrade: (reason) => { ctx.log(run, `⚠ org facts: ${reason}`); ctx.updateRun(run, (r) => { noteDegraded(r, 'org-facts', reason); }); },
      });
      if (runLedger) costUsd = runLedger.spent() || costUsd;   // the fact pass is part of the run's spend
    }
    // PRECEDENTS (§4) + the Leadership "Across your projects" row (§5) — deterministic, over the org findings store and
    // the planned contradiction edges. A project the run's clone credential cannot reach is named only "another project
    // in this org". Fail-open.
    let across: AcrossProjects | null = null;
    if (run.mode === 'agentic' && (run.kind ?? 'org') === 'org' && ok && xpRepos.length) {
      try {
        const projectsNow = listProjects(xpOrg);
        const currentPids = new Set(runProjectIds(xpOrg, xpRepos));
        const access = xpAccessFor(manifest);
        // Every repo of the project is probed in PARALLEL (deduped + bounded by the checker).
        const labelOf = async (pid: string): Promise<string> => {
          const p = projectsNow.find((x) => x.projectId === pid);
          if (!p) return RESTRICTED_PROJECT_LABEL;
          return (await Promise.all(p.repos.map((r) => access({ repo: r })))).some(Boolean) ? p.name : RESTRICTED_PROJECT_LABEL;
        };
        const prec = await precedentsFor(reportFindings, listOrgFindings(xpOrg), currentPids, isRuledOutFinding, labelOf, mergedProjectMap(xpOrg));
        const labels = new Map<string, string>();
        const otherPids = [...new Set((pendingFacts ? edgesForProjects(pendingFacts.plan.facts, pendingFacts.plan.edges, currentPids, 'contradicts') : []).map((e) => e.other.projectId))];
        await Promise.all(otherPids.map(async (pid) => { labels.set(pid, await labelOf(pid)); }));
        const info = acrossProjectsInfo(xpTags, pendingFacts, currentPids, (pid) => labels.get(pid) ?? RESTRICTED_PROJECT_LABEL);
        if (info) across = info;
        if (execution && (Object.keys(prec).length || Object.keys(xpTags).length)) {
          execution = { ...execution, ...(Object.keys(xpTags).length ? { crossProject: Object.fromEntries(Object.entries(xpTags).map(([id, t]) => [id, { project: t.project, key: t.key }])) } : {}), ...(Object.keys(prec).length ? { precedents: Object.fromEntries(Object.entries(prec).map(([id, p]) => [id, { project: p.project, date: p.date, ...(p.runId ? { runId: p.runId } : {}), ...(p.restricted ? { restricted: true } : {}) }])) } : {}) };
        }
        if (Object.keys(prec).length) ctx.log(run, `precedents: ${Object.keys(prec).length} finding(s) were already fixed in another project of this org`);
      } catch (e) { ctx.log(run, `cross-project: precedents skipped (${e instanceof Error ? e.message : String(e)})`); }
    }
    // The brief's prose may state a finding count; check it against the FINAL confirmed total (two-report "needs
    // care"). Deterministic and non-blocking: a mismatch is logged and surfaced as a run.degraded row, not rewritten.
    // The injected blocks are stripped first: they are deterministic, and their own counts (a capability tile, a lens row)
    // are not a claim about the run's total.
    // Leadership v5: the capability map + lens rows, rebuilt from the FINAL gated findings (GCP included) and the final
    // Execution groups, replace the authoring-time block exactly like Area health does on v0 / v4.
    const finalMap = capabilityMap ? { capabilities: capabilityMap.capabilities, examined: examinedCapabilityIds(capabilityMap.capabilities, { openedPaths: capabilityMap.openedPaths, findings: reportFindings, hypotheses: capabilityMap.hypotheses }), ...(capabilityMap.assignments ? { assignments: capabilityMap.assignments } : {}) } : null;
    const lens = LEADERSHIP_VARIANT === 'v5' ? lensBriefFor(reportFindings, coverageGaps, execution?.groups, lensOverrides, finalMap) : null;
    // v5: the "What you asked us to check" block, rebuilt from the same final data (each row's lens + capability from
    // the final findings / gaps / map — leadershipLensFor over the rows' ids), re-injected with the map below.
    const answerBackBlock = lens && answerBack?.length
      ? lensAnswerBackFrom(answerBack, { ...leadershipLensFor(answerBack.map((r) => r.id), reportFindings, coverageGaps, execution?.groups, lensOverrides, finalMap), brief: lens })
      : null;
    // v5: a count the brief qualifies by lens ("3 business issues") is checked against THAT lens's final count.
    const countMismatch = run.leadershipHtml ? findingCountCheck(stripDetailIndex(run.leadershipHtml), findingCounts(reportFindings).confirmed, lens ? lensCountsOf(lens) : undefined) : null;
    if (countMismatch) { ctx.log(run, `⚠ leadership brief: ${countMismatch.reason}`); ctx.updateRun(run, (r) => { noteDegraded(r, 'leadership-writer', countMismatch.reason); }); }
    if (run.leadershipHtml) {
      run.leadershipHtml = reinjectDetailIndex(run.leadershipHtml, buildReportRefs(reportFindings, engineeringReportUrl(run.id)), { ...(execution ? { themes: areaHealthThemes(execution.groups) } : {}), since, across, ...(lens ? { lens, answerBack: answerBackBlock } : {}) });
      ctx.saveReport(run.id + '-leadership', run.leadershipHtml);
    }
    // The COMBINED report was merged from the pre-GCP brief and saved before this point, so it kept the stale
    // index while /combined is the tier most people actually open. It is LLM-merged and re-running the
    // normalizer here would cost another pass, so the citation block is patched in place instead —
    // deterministic, and the only part of that document this change owns.
    // (Two-report model: there is no Combined report to re-index.)
    // Resolve every path the reports + findings cite against the workspace NOW (it is deleted in the finally
    // below) and save the run's link index; the serve-time pass turns those citations into GitHub permalinks at the
    // pinned SHA. Fail-open: any error ⇒ no sidecar ⇒ no links.
    try {
      const htmls = [run.leadershipHtml, run.combinedHtml, ...(run.bundleReports ?? []).map((b) => loadReport(run.id + '-bundle-' + b.id)), run.hasProvenance ? loadReport(run.id + '-provenance') : null];   // provenance is saved earlier in orgCritiqueExpert
      saveLinkIndexFile(ctx.reportArtifactPath(run.id, 'links.json'), buildLinkIndex(manifest, tmp, citedPaths(htmls, reportFindings.flatMap((f) => (f.evidence ?? []).map((e) => String(e.ref ?? ''))))));
    } catch (e) { ctx.log(run, `evidence links: skipped (${e instanceof Error ? e.message : String(e)})`); }
    if (!findings.length && !metrics) return ctx.fail(run, nothingAnalyzedMessage(unreachable));
    const vitals = metrics ? orgVitals(metrics) : { summary: { org: true, busFactor: 0 } };
    if (synthesisText) (vitals.summary as Record<string, unknown>).synthesis = synthesisText;   // agentic bottom-line → overview text (reportHtml prefers metrics.summary.synthesis)
    // Hand the evidence gate the live workspace (deleted in the finally below) so file/line refs are checked on disk.
    ctx.finish(run, { miner: 'org-aggregate', target: 'organization · ' + run.targetName, metrics: vitals, findings, coverageGaps, answerBack, evalsToRun, ...(execution ? { execution } : {}) }, costUsd, { workspaceRoot: tmp });
    // Run history (incremental re-scan): a COMPLETED agentic Full Scan records its lineage entry (the next scan's
    // baseline), its keyed final findings and the durable org findings store. Not gated on run.writeMemory — it is
    // run history, not memory. Fail-open (recordRunHistory never throws).
    // Cross-project org memory (src/run/crossProject.ts, org-cross-project-memory.md §1): a COMPLETED agentic Full Scan
    // registers its repos as org projects (one per repo unless the user already grouped them) and stamps each org
    // findings store row with its project. Same class as run history — derived run data, not gated on run.writeMemory.
    let projectOf: ((p?: string) => string | undefined) | undefined;
    if (run.status === 'complete' && run.mode === 'agentic' && (run.kind ?? 'org') === 'org' && xpOrgKey) {
      try {
        const n = registerCompletedRunProjects(xpOrg, xpRepos);
        projectOf = projectResolverFor(xpOrg, xpRepos);
        ctx.log(run, `org projects: ${xpRepos.length} repo(s) → ${n} project(s) in this org's registry`);
      } catch (e) { ctx.log(run, `org projects: not registered (${e instanceof Error ? e.message : String(e)})`); }
      if (pendingFacts) { try { ctx.log(run, commitRunFacts(pendingFacts)); } catch (e) { ctx.log(run, `org facts: not saved (${e instanceof Error ? e.message : String(e)})`); } }
    }
    recordRunHistory(run, ctx, incrRt, manifest, lineageInfo, keyRows, since, costUsd ?? 0, projectOf);
  } catch (e) {
    ctx.fail(run, e instanceof Error ? e.message : String(e));
  } finally {
    // Release this run's process-wide LLM-concurrency request (no-op for a deterministic run that never requested),
    // so a finished run never leaves the cap raised for the next run's discovery phase. Must be in
    // finally: it has to fire even when orgCritiqueExpert throws (e.g. a re-thrown auth error).
    releaseLlmConcurrency(run.id);
    // Wipe the BYO credential from the long-lived process the moment the run ends — it's
    // only needed during execution, and completed/errored runs linger in t.runs for history
    // (clearing the session token / logging out must not leave a bearer token behind).
    ctx.live(run).authToken = undefined;
    ctx.live(run).resumeSpec = undefined;   // release the replay payloads (can hold whole report HTMLs) once the run ends
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  });
}

// A collision-free child dir under `workspace` for `base` (repos can share a basename across owners) — appends
// -2/-3… on a clash. Used by BOTH the clone path and the local-copy path so neither silently drops a repo
// whose basename is already taken (the clone path once used a bare basename and lost the dupe).
export function uniqueChildDir(workspace: string, base: string): { dir: string; name: string } {
  const b = base || 'repo'; let name = b, n = 2;
  while (existsSync(join(workspace, name))) name = `${b}-${n++}`;
  return { dir: join(workspace, name), name };
}
