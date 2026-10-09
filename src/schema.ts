// The value unit of the whole tool: an evidence-backed Finding.
//
// Anti-hallucination contract: every Finding MUST carry >= 1 Evidence pointer
// that resolves to something concrete (a file:line, a commit, a PR, a metric
// query, a doc). A claim without resolvable evidence is dropped, never shipped.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { EvalToRun } from './research/deep.ts';
import type { ExecutionModel } from './executionModel.ts';

export type Dimension =
  | 'delivery_flow'   // DORA / PR throughput / cycle time / batch size
  | 'code_health'     // hotspots, churn, complexity, test coverage
  | 'architecture'    // coupling, modularity, drift vs documented design
  | 'knowledge_risk'  // bus factor, ownership concentration, knowledge islands
  | 'product_metrics' // funnel / retention / adoption tie-in (needs dashboards)
  | 'security_supply';// secrets, vulnerable deps, policy gaps

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Confidence = 'low' | 'medium' | 'high';
export type Effort = 'quick_win' | 'moderate' | 'project';

// Value axis — WHY fixing a finding is a big gain, not just how severe it is.
// Findings are ranked by impact × effort, so high-impact quick wins surface first.
export type ImpactAxis =
  | 'trust'           // decisions blocked / made on wrong numbers
  | 'cost'            // $ wasted on scan / compute / storage
  | 'velocity'        // manual toil / rework removed
  | 'business_metric' // direct effect on a product/revenue metric
  | 'security';       // exposure / compromise risk

export type EvidenceKind = 'file' | 'commit' | 'pr' | 'metric' | 'doc' | 'computation';

export interface Evidence {
  kind: EvidenceKind;
  ref: string;     // file:line, commit hash, PR url, metric query id, computation label
  detail?: string; // human-readable note / value backing the ref
}

export interface Finding {
  id: string;
  dimension: Dimension;
  title: string;
  claim: string;          // the assertion, with concrete numbers
  evidence: Evidence[];   // >= 1 required (enforced by assertFinding)
  businessImpact: string; // why it matters for business metrics / efficiency
  recommendation: string; // what to do about it
  severity: Severity;
  confidence: Confidence;
  effort: Effort;
  source: string;         // which miner/agent produced it
  invariant?: string;     // data-trust invariant violated (i1..i11), when applicable
  impact?: ImpactAxis;    // value axis — why fixing it is a big gain
  // Cross-project inconsistency tag (src/run/crossProject.ts): the i1 / i2 classification lives HERE,
  // never in `invariant`, so the finding's key (findingKey.ts hashes the invariant) is the same with sibling recall on
  // or off; persisted in the keyed sidecar and re-applied to the same finding on a carried / replayed scan.
  xproj?: { invariant: 'i1' | 'i2'; project: string; key: string; ref: string; runId?: string };
  // REPORT LENS: which report tells this finding's story. `business` findings are
  // the Leadership brief's subject (capability map + cards); `security` / `engineering` ones get one counted line there
  // and their full detail in Execution. Set by findingLens.ts labelFindings (bundle default, refined by the synthesis);
  // optional so older checkpoints still render (a missing label is computed at report time). Excluded from the
  // finding's anchor hash, so labelling never moves a citation.
  lens?: FindingLens;
  // The product capability / user journey a BUSINESS finding affects — Phase 1: the synthesis area it belongs to (the
  // same membership executionGroups uses). Undefined for security / engineering findings.
  capability?: string;
}

export type FindingLens = 'business' | 'security' | 'engineering';

// An applicable concern that could NOT be settled into a Finding — separated from `Finding` so the
// evidence gate stays real: a Finding always carries RESOLVED evidence; an unmeasured / blocked /
// budget-skipped / rejected concern becomes a CoverageGap (the consulting answer-back's "could not
// settle X; next test = N"), NEVER a finding dressed up with synthetic `eval:*` evidence. The
// shape is forward-compatible with the richer EvidencePayload/AuditedClaim artifacts.
export type CoverageGapStatus =
  | 'unmeasured'       // no datapoint / probe result yet — an eval must be run
  | 'blocked'          // needs access / an input the run didn't have
  | 'budget_skipped'   // the run hit the operating-envelope budget before measuring it
  | 'node_failed'      // a lane/agent failed (fail-open) and produced nothing here
  | 'not_evidenceable' // the concern can't be settled from the available read-only artifacts
  | 'claim_rejected';  // an independent audit rejected the claim → not an accepted finding

export interface CoverageGap {
  id: string;
  concern: string;             // the question / candidate defect that stays open
  whyUnsettled: string;        // why it couldn't be settled into a finding
  nextDecisiveTest: string;    // the experiment / probe / access that WOULD settle it
  source: string;              // which agent/lane surfaced it
  status: CoverageGapStatus;
  bundleId?: string;
  hypothesisId?: string;
  invariant?: string;          // data-trust invariant (i1..i13), when applicable
}

// One answer-back row — the consulting "we addressed your concern" mapping, built
// DETERMINISTICALLY from the run's own audited artifacts (never inferred by the report writer). The
// status polarity is strict to defeat reward-hacking: `supported` = a measured+CONFIRMED defect;
// `refuted` = a measured+REFUTED concern (ruled out healthy); `unsettled` = a CoverageGap / open
// hypothesis. Absence of a finding is `unsettled`, NEVER `refuted`. Run-local ids (the prefixed
// hypothesis / gap / finding ids); typed IntentMap + stable belief ids are future work.
export interface AnswerBackRow {
  id: string;
  bundleId?: string;
  status: 'supported' | 'refuted' | 'unsettled';
  concern: string;            // the claim/question, in plain words
  testedVia: string;          // how it was checked (the decisive metric / source), or '' if unsettled
  nextDecisiveTest?: string;  // for unsettled rows: the experiment/probe that would settle it
}

// One independent CLAIM AUDIT verdict — an evidence-aware auditor (GPT-5.5, tool-free over the
// measurement's EvidencePayload; tool-backed re-verify for the risky subset) sits between the Expert's
// measured disposition and the Finding contract. It is a SECOND, independent gate on top of the
// resolved-evidence requirement: a measured+disposed claim becomes a Finding ONLY if the auditor `accept`s
// or `downgrade`s it; `reject` (or an auditor that ran but couldn't settle this claim — fail-CLOSED) routes
// it to a `claim_rejected` CoverageGap. Keyed by the (bundle-prefixed) hypothesis id. The richer applicability
// / 4-state CoverageMatrix carry is the cross-cutting area-report track, not this contract.
export interface AuditedClaim {
  hypothesisId: string;
  verdict: 'accept' | 'downgrade' | 'reject';
  reason: string;                  // why the auditor accepted / downgraded / rejected (rendered + eval-judged)
  allowedWording?: string;         // downgrade: the caveated claim the report MAY make (never stronger than the evidence)
  severity?: Severity;             // auditor-set severity (a downgrade caps a confirmed defect below `high`)
  confidence?: Confidence;         // auditor-set confidence (a downgrade caps it)
  reverified?: boolean;            // a tool-backed re-verify actually ran for this claim (risky subset)
  reverifyNote?: string;           // what the re-verify found, if it ran
  // Audit OUTCOME for fail-closed accounting: a claim with no `audited` status (auditor failed / reply
  // unparseable / no verdict produced for this claim) is treated as NOT accepted → claim_rejected gap.
  auditStatus?: 'audited' | 'llm_failed' | 'unparseable';
}

// One audited CROSS-BUNDLE SYNTHESIS claim. The per-bundle Claim Auditor rules
// HYPOTHESIS-level claims; the cross-bundle synthesis can INTRODUCE new assertions (a bottom-line bullet or a
// lead that infers something across bundles — an elimination, a causal/priority/quantitative leap — not
// reducible to a single measured verdict). A NARROW auditor checks each synthesis claim FOLLOWS from the
// already-audited basis verdicts (it never re-audits evidence): `covered_by_basis` (a restatement/aggregation
// of audited claims — no-op) ships unchanged; a `synthesis_introduced` claim must be accept/downgrade/reject.
// Unlike a hypothesis claim, a rejected/unsupported synthesis claim is DROPPED (it has no underlying accepted
// per-bundle claim to caveat) — it is unsafe prose, NOT a CoverageGap (which is an unresolved concern from the brief).
export interface SynthesisClaim {
  id: string;                          // synth:bottomLine:1 / synth:lead:2
  target: 'bottomLine' | 'lead';
  index: number;                       // bullet index (bottomLine) or lead index
  text: string;
  basis: string[];                     // the hypothesis ids it draws on
  scope: 'covered_by_basis' | 'synthesis_introduced';
  verdict: 'accept' | 'downgrade' | 'reject';
  reason: string;
  allowedWording?: string;             // downgrade: the caveated text the report MAY use instead
  auditStatus?: 'audited' | 'llm_failed' | 'unparseable';   // non-`audited` ⇒ fail-closed (treated as not accepted)
}

// The claim text a DOWNGRADED hypothesis may use anywhere it is rendered (the finding claim + title, the
// answer-back concern, synthesis, the leadership + area reports) — so a downgrade can never surface its
// original over-strong wording in any user-facing place. Prefer the auditor's
// `allowedWording`; if a downgrade carries none (e.g. a reverify-created downgrade), fall back to a
// deterministic CAVEAT on the original — never the bare original. accept/reject return the original unchanged
// (reject never ships as a finding anyway).
export function caveatedClaim(originalClaim: string, a: AuditedClaim | undefined): string {
  if (!a || a.verdict !== 'downgrade' || a.auditStatus !== 'audited') return originalClaim;
  const w = a.allowedWording?.trim();
  if (w) return w;
  return `${originalClaim} — CAVEATED (downgraded on independent audit): the evidence is weaker than a confirmed result${a.reason ? ` — ${a.reason}` : ''}; treat as a lead, not a settled finding.`;
}

export interface MinerResult {
  miner: string;
  target: string;
  metrics: Record<string, unknown>; // serializable evidence layer
  findings: Finding[];
  coverageGaps?: CoverageGap[];      // applicable-but-unsettled concerns (answer-back / open questions)
  answerBack?: AnswerBackRow[];      // the brief answer-back rows (present only when a brief was supplied)
  evalsToRun?: EvalToRun[];          // Layer 1: recsys-mle eval proposals to surface in the report (recsys bundle only)
  // Two-report model: present ⇒ the deterministic report renders as the EXECUTION report (work plan · per-finding fix /
  // done-when / verify · needs-a-test · appendix). Set only by the agentic Full Scan; every other caller omits it and
  // gets the detailed report exactly as before.
  execution?: ExecutionModel;
}

// Evidence is RESOLVABLE iff it points at something concrete that already exists — NOT a promise of
// future work, and NOT a self-referential placeholder. KIND-AWARE: concrete-artifact kinds
// (file/commit/pr/doc/metric) reference real things by their nature, so a non-empty ref resolves — a file
// literally NAMED `synthesis.ts` or `none.md` must NOT be mis-rejected. Only `computation` refs mix real
// measurements (warehouse:/redis:/probe:/cluster:/history:/datapoint ids) with PLACEHOLDERS, so the guards
// apply there. This is what makes "no finding without resolvable evidence" true on the report path.
// `measurement:*` is the audit's OWN internal pointer (an EvidencePayload id), NOT a concrete source — an
// agent that returns `source: "measurement:h1"` gave no real source, so it must not satisfy the gate
// (it routes to a CoverageGap). The reproducible source it should have cited is warehouse:/redis:/probe:/….
const FUTURE_WORK_REF = /^\s*(eval|evals?|needs[_-]?eval|future[_-]?work|proposed|synthesis|synthesis[_-]?ref|measurement|tbd|todo|pending|unknown|none|n\/?a)\b/i;
const FUTURE_WORK_DETAIL = /\b(run the eval|needs an eval|decisive eval proposed|propose (an|the) eval|to be (run|measured|determined)|not (yet )?measured)\b/i;
//
// OPTIONAL EXISTENCE CHECK: with `opts.root` (the run's workspace root, while it still exists) a
// `file` ref must also RESOLVE there — the path exists and a cited line is within the file (`fileEvidenceResolves`).
// Without a root the kind-aware rule above is unchanged (a non-empty file ref is trusted), so every caller that has
// no workspace (CLI, audit runs, the deterministic miners at construction time) keeps today's behavior. Quick Ask
// checks its file-shaped dossier refs against its workspace too (scopedInvestigate.gateScopedEvidence).
export interface EvidenceCheckOpts { root?: string }
export function isResolvableEvidence(e: Evidence | undefined, opts?: EvidenceCheckOpts): boolean {
  if (!e) return false;
  const ref = (e.ref ?? '').trim();
  if (!ref) return false;
  if (e.kind === 'file' && opts?.root) return fileEvidenceResolves(ref, opts.root);
  // Concrete-artifact kinds: a non-empty ref is a real pointer (the placeholder check below is only for
  // the `computation` kind, where free-form refs can be future-work promises).
  if (e.kind === 'file' || e.kind === 'commit' || e.kind === 'pr' || e.kind === 'doc' || e.kind === 'metric') return true;
  if (FUTURE_WORK_REF.test(ref)) return false;                       // computation placeholder ref
  if (e.detail && FUTURE_WORK_DETAIL.test(e.detail)) return false;   // …or a future-work detail
  return true;
}
export function findingHasResolvableEvidence(f: Finding): boolean {
  return Array.isArray(f.evidence) && f.evidence.some((e) => isResolvableEvidence(e));
}
// The workspace-aware variant of the gate: same "at least one resolvable pointer" rule, but `file` refs are
// checked against `root`. `root` undefined ⇒ identical to findingHasResolvableEvidence. (A separate function, not an
// optional 2nd param, because callers pass findingHasResolvableEvidence straight to Array#filter, whose 2nd arg is
// the element index.)
export function findingResolvesInWorkspace(f: Finding, root: string | undefined): boolean {
  return Array.isArray(f.evidence) && f.evidence.some((e) => isResolvableEvidence(e, { root }));
}

// Parse a file-evidence ref into {path, line}. Accepts the shapes agents and miners actually emit:
// `a/b.ts`, `a/b.ts:42`, `a/b.ts:42-60`, `a/b.ts:42:7`, `a/b.ts#L42`, `a/b.ts#L42-L60`, and any of those
// followed by whitespace + prose (`a/b.ts:42 (function foo)`) or a trailing comma list. Exported for tests.
export function parseFileRef(ref: string): { path: string; line?: number } {
  const head = ref.trim().split(/[\s,;]+/)[0] ?? '';
  const m = /^(.*?)(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?:[-–:]\d+)?)?$/.exec(head);
  const path = (m?.[1] ?? head).replace(/^\.\//, '');
  const n = Number(m?.[2] ?? m?.[3]);
  return Number.isFinite(n) && n > 0 ? { path, line: n } : { path };
}

// Does a `file` ref resolve inside `root`? Rules (fail-closed only where we can actually CHECK, trust otherwise):
//   • a URL or a glob pattern cannot be checked on disk → trusted (true), as without a root;
//   • an absolute path counts only if it lies inside root; a relative path must not escape root (`..`);
//   • the path must exist either at root/<path> (workspace-relative — how miners and agents cite, since agents
//     run with cwd = root) or at root/<repoDir>/<path> for one of root's immediate child dirs (a repo-relative
//     cite in a multi-repo workspace) — so a TRUE finding is not dropped for citing without its repo prefix;
//   • a cited line must be ≤ the file's line count (files > 8 MB skip the line check). A directory resolves
//     only when no line is cited.
export function fileEvidenceResolves(ref: string, root: string): boolean {
  const { path, line } = parseFileRef(ref);
  if (!path) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /[*?[\]{}]/.test(path)) return true;
  const absRoot = resolve(root);
  const inside = (p: string) => { const r = relative(absRoot, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  const candidates: string[] = [];
  if (isAbsolute(path)) { if (inside(resolve(path))) candidates.push(resolve(path)); }
  else {
    const direct = resolve(absRoot, path);
    if (!inside(direct)) return false;
    candidates.push(direct);
    try {
      for (const d of readdirNames(absRoot)) { const c = resolve(absRoot, d, path); if (inside(c)) candidates.push(c); }
    } catch { /* unreadable root → only the direct candidate */ }
  }
  for (const c of candidates) if (pathHoldsLine(c, line)) return true;
  return !isAbsolute(path) && uniqueSuffixMatch(path, line, absRoot) !== null;
}
function pathHoldsLine(abs: string, line: number | undefined): boolean {
  let st;
  try { st = statSync(abs); } catch { return false; }
  if (line == null) return true;
  if (!st.isFile()) return false;
  if (st.size > 8 * 1024 * 1024) return true;
  try { return line <= readFileSync(abs, 'utf8').split('\n').length; } catch { return false; }
}

// A cite that drops leading directories (`cache.js:10` for `repo/src/cache.js`) still names ONE file when exactly one
// workspace file ends with that path. Then it resolves — and canonicalFileRef can rewrite it to the full path. Two or
// more candidates (`index.js`) stay unresolved: the cite is ambiguous.
const INDEX_SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target', 'vendor']);
const INDEX_MAX_FILES = 50_000;
const indexCache = new Map<string, { at: number; files: string[] }>();
export function workspaceFileIndex(absRoot: string): string[] {
  const hit = indexCache.get(absRoot);
  if (hit && Date.now() - hit.at < 60_000) return hit.files;
  const files: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 16 || files.length >= INDEX_MAX_FILES) return;
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (files.length >= INDEX_MAX_FILES) return;
      const abs = join(dir, n);
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) { if (!INDEX_SKIP.has(n)) walk(abs, r, depth + 1); }
      else if (st.isFile()) files.push(r);
    }
  };
  walk(absRoot, '', 0);
  indexCache.set(absRoot, { at: Date.now(), files });
  return files;
}
function uniqueSuffixMatch(path: string, line: number | undefined, absRoot: string): string | null {
  const want = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!want || want.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null;
  const hits = workspaceFileIndex(absRoot).filter((f) => f === want || f.endsWith('/' + want));
  if (hits.length !== 1) return null;
  return pathHoldsLine(resolve(absRoot, hits[0]), line) ? hits[0] : null;
}

/** A file ref rewritten to its workspace-relative path when it resolves only through a unique suffix match
 *  (`cache.js:10` → `repo/src/cache.js:10`); the ref unchanged when it resolves as cited; null when it does not. */
export function canonicalFileRef(ref: string, root: string): string | null {
  if (!fileEvidenceResolves(ref, root)) return null;
  const { path, line } = parseFileRef(ref);
  if (isAbsolute(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /[*?[\]{}]/.test(path)) return ref;
  const absRoot = resolve(root);
  let dirs: string[] = [];
  try { dirs = readdirNames(absRoot); } catch { /* unreadable root */ }
  if ([resolve(absRoot, path), ...dirs.map((d) => resolve(absRoot, d, path))].some((c) => pathHoldsLine(c, line))) return ref;
  const full = uniqueSuffixMatch(path, line, absRoot);
  if (!full) return ref;
  const trimmed = ref.trim();
  const at = trimmed.indexOf(path);
  return at >= 0 ? trimmed.slice(0, at) + full + trimmed.slice(at + path.length) : full;
}
function readdirNames(dir: string): string[] {
  // Immediate child DIRECTORIES of the workspace root (the cloned/copied repos). statSync per entry keeps this free of
  // the Dirent API differences across Node versions; the workspace root holds a handful of repo dirs.
  return readdirSync(dir).filter((n) => { try { return statSync(join(dir, n)).isDirectory(); } catch { return false; } });
}

// Guard: enforce the evidence contract before a finding can leave a miner. Now also requires at least
// one RESOLVABLE evidence pointer (not just a non-empty array) — a finding backed only by an `eval:*` /
// synthesis / future-work ref is an unsettled concern, and belongs in `coverageGaps`, not `findings`.
export function assertFinding(f: Finding): Finding {
  if (!f.evidence || f.evidence.length === 0) {
    throw new Error(`Finding "${f.id}" has no evidence — violates the evidence contract`);
  }
  if (!findingHasResolvableEvidence(f)) {
    throw new Error(`Finding "${f.id}" has no RESOLVABLE evidence (only future-work / synthesis refs) — belongs in coverageGaps, not findings`);
  }
  return f;
}
