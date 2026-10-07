// Two-report model — the Execution report's structured data.
//
// PURE: no I/O, no LLM. Built at the end of an agentic Full Scan from what the run already holds (the evidence-gated
// findings, the hypotheses + mitigations they came from, the synthesis areas and the coverage gaps) and carried on
// MinerResult.execution to the deterministic renderer (reportHtml.ts). Everything the old per-bundle area reports
// uniquely said about "how to fix / how to verify" lives here now, per finding, instead of in N LLM-authored files.
//
// Two jobs:
//   • per finding: Fix · Expected effect · Done when · How to verify · Guardrail · Found by — from the finding's own
//     hypothesis + mitigation (joined by id: a finding id is the uppercased, bundle-prefixed hypothesis id);
//   • grouping: findings and open questions by the synthesis AREA (a business theme such as "KPI definition
//     integrity"), not by the bundle that raised them — one brief can send every bundle after the same concern, and
//     grouping by bundle put metric-definition findings under "Build / CI / release engineering" (umami sample run).
//     Near-duplicate findings from two bundles land in the same theme, next to each other.
import type { UncheckedWhy } from './sinceLastScan.ts';
import type { Finding, CoverageGap } from './schema.ts';
import type { Hypothesis } from './research/investigation.ts';
import type { Mitigation, SynthesisArea } from './research/deep.ts';
import { findingArea } from './findingIds.ts';
import type { AreaHealthTheme } from './reportAnchors.ts';
import { type LensOverride, gapLens, isFindingLens, lensFor, overrideMap } from './findingLens.ts';
import { externalSourceOf, planeOf, provenanceClassOf } from './research/evidencePlane.ts';
import { planeDisplayName } from './research/leadershipWriter.ts';
import { type Capability, capabilityForName, normCapName } from './research/capabilities.ts';

export interface ExecutionItem {
  fix?: string;
  expectedEffect?: string;
  doneWhen?: string;
  verify?: string;
  /** 'query' = a re-runnable SQL / probe text (rendered as code); 'procedure' = a command or steps in words. */
  verifyKind?: 'query' | 'procedure';
  guardrail?: string;
  measured?: string;
  foundBy?: string;
  /** Incremental re-scan: the lane was reused from the baseline and its live-plane measurement is carried as of this date (proposal §3 option b). */
  measuredOn?: string;
  /** Incremental re-scan (Phase 3): carried from the previous scan without re-deriving — `unchanged` (its cited code did not change) or `re-verified` (a targeted re-check confirmed it). */
  carried?: string;
  /** Report lens split: a SECURITY finding's exposure — how it was established (evidence tier) and on which plane. */
  exposure?: string;
}

export interface ExecutionGroup {
  key: string;
  name: string;
  verdict?: SynthesisArea['verdict'];
  framing?: string;
  /** Finding ids (as on Finding.id) in this group, in input order. */
  findingIds: string[];
  /** Coverage-gap ids in this group. */
  gapIds: string[];
}

export interface ExecutionModel {
  /** Keyed by Finding.id. */
  items: Record<string, ExecutionItem>;
  groups: ExecutionGroup[];
  /** Pre-rendered, self-contained appendix fragments (deterministic — codeintel charts, git history spine). */
  appendix?: { key: string; title: string; html: string }[];
  /** Incremental re-scan (src/sinceLastScan.ts): per-finding new / persisting since <date> / changed tags + the closing "Fixed since last scan" list. */
  sinceLastScan?: ExecutionSince;
  /** Cross-project org memory: findings settled as inconsistent with another project of the org (keyed by Finding.id). */
  crossProject?: Record<string, { project: string; key: string }>;
  /** Cross-project org memory: the same finding pattern already FIXED in another project (keyed by Finding.id). */
  /** For a project the run cannot reach: project = "another project in this org", date = YYYY-MM, no runId. */
  precedents?: Record<string, { project: string; date: string; runId?: string; restricted?: boolean }>;
}

export interface ExecutionSince {
  baseline: { runId: string; date: string; sha?: string };
  counts: { fixed: number; new: number; persisting: number; changed: number; unchecked: number };
  /** Keyed by Finding.id. */
  tags: Record<string, { status: 'new' | 'persisting' | 'changed'; since?: string }>;
  fixed: { title: string; severity: string; displayId?: string }[];
  unchecked: { title: string; severity: string; why?: UncheckedWhy }[];
}

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

// A finding id is the hypothesis id uppercased (deep.ts hypothesesToFindings: `h.id.toUpperCase()`), so the join is
// case-insensitive. A finding with no hypothesis (a GCP / deterministic-miner finding) simply gets no item fields.
const key = (id: string): string => String(id ?? '').toLowerCase();

function nullsText(m: Hypothesis['measurement']): string {
  return (m?.nulls ?? []).map((n) => `${clean(n.name)}=${n.value ?? '?'}`).filter(Boolean).join(', ');
}

/** The Execution fields for one finding. Missing inputs leave fields undefined — the renderer says "not drafted". */
export function executionItemFor(f: Pick<Finding, 'id' | 'recommendation'>, h: Hypothesis | undefined, mit: Mitigation | undefined): ExecutionItem {
  const m = h?.measurement;
  const nulls = nullsText(m);
  const item: ExecutionItem = {};
  // Fix: the mitigation's single concrete lever when there is one; otherwise the finding's own recommendation (which
  // deep.ts already writes honestly — "No specific fix was drafted — …" when no mitigation exists).
  const lever = clean(mit?.lever);
  item.fix = lever || clean(f.recommendation) || undefined;
  if (clean(mit?.expectedEffect)) item.expectedEffect = clean(mit!.expectedEffect);
  if (clean(mit?.guardrail)) item.guardrail = clean(mit!.guardrail);
  // Done when: the measured null restated as the acceptance check — the part a coding agent needs to know it is done.
  if (nulls) item.doneWhen = `The same check, re-run, meets: ${nulls}.`;
  if (m && m.value != null) item.measured = `${m.value}${nulls ? ` vs ${nulls}` : ''}`;
  const q = clean(m?.evidence?.query);
  const next = clean(m?.nextDecisiveTest) || clean(h?.evalProposal?.how);
  if (q) { item.verify = String(m!.evidence!.query).trim(); item.verifyKind = 'query'; }
  else if (next) { item.verify = next; item.verifyKind = 'procedure'; }
  const area = findingArea({ id: String(f.id ?? ''), invariant: undefined });
  if (area) item.foundBy = area.label;
  return item;
}

const DISPOSITION_AREA_KEYS = new Set(['confirmed-defects', 'open-questions', 'investigated-healthy']);

/**
 * Group finding + gap ids by synthesis area. An id no area claims goes to a trailing "Other" group; with no synthesis
 * areas at all, groups fall back to the bundle that raised them (so a run whose synthesis failed still groups).
 */
export function executionGroups(findings: Pick<Finding, 'id'>[], gaps: Pick<CoverageGap, 'id' | 'hypothesisId' | 'bundleId' | 'status'>[], areas: SynthesisArea[] | undefined): ExecutionGroup[] {
  const groups: ExecutionGroup[] = [];
  const byKey = new Map<string, ExecutionGroup>();
  const ensure = (k: string, init: Omit<ExecutionGroup, 'findingIds' | 'gapIds'>): ExecutionGroup => {
    let g = byKey.get(k);
    if (!g) { g = { ...init, findingIds: [], gapIds: [] }; byKey.set(k, g); groups.push(g); }
    return g;
  };
  // deep.ts deterministicAreas (the synthesis fallback when the agent's reply does not parse) buckets by DISPOSITION —
  // "Confirmed defects" / "Open" / "Investigated & healthy" — not by business theme. Both reports already show status,
  // so those buckets carry no grouping signal: treat them as no areas and group by the bundle that raised each item
  // (umami verification run: one "Confirmed defects" theme held every finding).
  areas = (areas ?? []).filter((a) => !DISPOSITION_AREA_KEYS.has(a.key));
  const owner = new Map<string, SynthesisArea>();
  for (const a of areas) for (const b of a.basis ?? []) if (!owner.has(key(b))) owner.set(key(b), a);
  const place = (id: string, hypId: string | undefined, bundle: string | undefined, into: 'findingIds' | 'gapIds'): void => {
    const a = owner.get(key(hypId ?? id));
    if (a) { ensure('area:' + a.key, { key: a.key, name: a.name, verdict: a.verdict, framing: a.framing })[into].push(id); return; }
    if (!(areas && areas.length)) {
      const fa = findingArea({ id: hypId ?? id, invariant: undefined }) ?? (bundle ? findingArea({ id: `${bundle}:x`, invariant: undefined }) : null);
      if (fa) { ensure('bundle:' + fa.key, { key: fa.key, name: fa.label })[into].push(id); return; }
    }
    // A planned check the run never got to (budget) is not an "other" question — it is a known, unexamined one; say so.
    if (into === 'gapIds' && gapStatus.get(id) === 'budget_skipped') { ensure('not-examined', { key: 'not-examined', name: 'Planned, not examined (run budget ran out)' })[into].push(id); return; }
    ensure('other', { key: 'other', name: into === 'gapIds' ? 'Other open questions' : 'Other' })[into].push(id);
  };
  const gapStatus = new Map(gaps.map((g) => [String(g.id), g.status]));
  for (const f of findings) place(String(f.id), String(f.id), undefined, 'findingIds');
  for (const g of gaps) place(String(g.id), g.hypothesisId, g.bundleId, 'gapIds');
  // Areas in the synthesis' own order (it ranks them); then "Other"; then the unexamined checks; empty groups dropped.
  const tail = (k: string): number => (k === 'not-examined' ? 2 : k === 'other' ? 1 : 0);
  const order = new Map((areas ?? []).map((a, i) => [a.key, i]));
  return groups
    .filter((g) => g.findingIds.length || g.gapIds.length)
    .sort((a, b) => tail(a.key) - tail(b.key) || (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

// ── Report lens split Phase 2: with a CAPABILITY MAP, business findings are grouped by CAPABILITY ─────────────────────
// A business finding labelled with a map capability (findingLens.labelFindings) moves into that capability's group
// (named by the capability, framed by its one-sentence summary); a synthesis-area group whose NAME is a map capability
// is folded into it whole (its other members too, so one name never heads two groups). Capability groups come first, in
// map order; the remaining area groups, "Other" and the unexamined checks follow as before. Without a map: unchanged.
export const CAPABILITY_GROUP_PREFIX = 'cap:';
export function capabilityGroups(groups: ExecutionGroup[], findings: Pick<Finding, 'id' | 'lens' | 'capability'>[], caps: readonly Capability[] | undefined): ExecutionGroup[] {
  if (!caps?.length) return groups;
  const byName = new Map(caps.map((c) => [normCapName(c.name), c]));
  const pos = new Map(findings.map((f, i) => [String(f.id), i]));
  const target = new Map<string, Capability>();
  for (const f of findings) {
    const c = f.lens === 'business' && typeof f.capability === 'string' ? byName.get(normCapName(f.capability)) : undefined;
    if (c) target.set(String(f.id), c);
  }
  const capGroup = new Map<string, ExecutionGroup>();
  const ensure = (c: Capability): ExecutionGroup => {
    let g = capGroup.get(c.id);
    if (!g) { g = { key: CAPABILITY_GROUP_PREFIX + c.id, name: c.name, ...(c.summary ? { framing: c.summary } : {}), findingIds: [], gapIds: [] }; capGroup.set(c.id, g); }
    return g;
  };
  const rest: ExecutionGroup[] = [];
  for (const g of groups) {
    const whole = g.key === 'other' || g.key === 'not-examined' || g.key === SECURITY_GROUP_KEY ? undefined : capabilityForName(g.name, caps);
    if (whole && normCapName(whole.name) === normCapName(g.name)) {
      const cg = ensure(whole);
      if (g.verdict && !cg.verdict) cg.verdict = g.verdict;
      cg.findingIds.push(...g.findingIds.filter((id) => !target.has(id) || target.get(id) === whole)); cg.gapIds.push(...g.gapIds);
      for (const id of g.findingIds) { const t = target.get(id); if (t && t !== whole) ensure(t).findingIds.push(id); }
      continue;
    }
    const keep = g.findingIds.filter((id) => !target.has(id));
    for (const id of g.findingIds) { const t = target.get(id); if (t) ensure(t).findingIds.push(id); }
    if (keep.length || g.gapIds.length) rest.push({ ...g, findingIds: keep });
  }
  const capOut = caps.map((c) => capGroup.get(c.id)).filter((g): g is ExecutionGroup => Boolean(g && (g.findingIds.length || g.gapIds.length)))
    // Members in the findings' input order (the order every other group keeps), whichever group they came from.
    .map((g) => ({ ...g, findingIds: [...new Set(g.findingIds)].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9)), gapIds: [...new Set(g.gapIds)] }));
  return [...capOut, ...rest];
}

/** executionGroups + the Phase 2 capability regrouping — the ONE grouping every surface reads when a map exists. */
export function executionGroupsFor(findings: Pick<Finding, 'id' | 'lens' | 'capability'>[], gaps: Pick<CoverageGap, 'id' | 'hypothesisId' | 'bundleId' | 'status'>[], areas: SynthesisArea[] | undefined, caps?: readonly Capability[]): ExecutionGroup[] {
  return capabilityGroups(executionGroups(findings, gaps, areas), findings, caps);
}

// ── Report lens split: Execution is SECURITY FIRST ─────────────────────────
// A "Security" group leads the Work plan: every security-lens finding (and open question), ordered by severity, then
// effort (quick wins first), then input order — the order an engineer should close exposure in. Its members are taken
// OUT of their theme groups, so every finding still appears exactly once. Idempotent: an existing Security group is
// rebuilt, never duplicated. The F-ids are untouched (findingIds.ts numbers the gated array by severity/confidence), so
// Leadership, Execution and REMEDIATION.md still name each finding the same way.
export const SECURITY_GROUP_KEY = 'security';
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const EFFORT_RANK: Record<string, number> = { quick_win: 1, moderate: 3, project: 6 };

export function securityFirstGroups(groups: ExecutionGroup[], findings: Pick<Finding, 'id' | 'invariant' | 'source' | 'severity' | 'effort' | 'lens'>[], gaps: Pick<CoverageGap, 'id' | 'hypothesisId' | 'bundleId'>[], overrides?: readonly LensOverride[]): ExecutionGroup[] {
  const ov = overrideMap(overrides);
  const isSec = (f: (typeof findings)[number]): boolean => (isFindingLens(f.lens) ? f.lens : lensFor(f, ov)) === 'security';
  const idx = findings.map((f, i) => i).filter((i) => isSec(findings[i]));
  idx.sort((a, b) => ((SEV_RANK[findings[a].severity] ?? 5) - (SEV_RANK[findings[b].severity] ?? 5))
    || ((EFFORT_RANK[findings[a].effort] ?? 4) - (EFFORT_RANK[findings[b].effort] ?? 4)) || (a - b));
  const secIds = [...new Set(idx.map((i) => String(findings[i].id)))];
  const secGaps = [...new Set(gaps.filter((g) => gapLens(g, ov) === 'security').map((g) => String(g.id)))];
  const fs = new Set(secIds); const gs = new Set(secGaps);
  const rest = groups.filter((g) => g.key !== SECURITY_GROUP_KEY)
    .map((g) => ({ ...g, findingIds: g.findingIds.filter((id) => !fs.has(id)), gapIds: g.gapIds.filter((id) => !gs.has(id)) }))
    .filter((g) => g.findingIds.length || g.gapIds.length);
  if (!secIds.length && !secGaps.length) return rest;
  return [{ key: SECURITY_GROUP_KEY, name: 'Security', framing: 'Ordered by severity, then effort. Exposure = how each finding was established and on which plane.', findingIds: secIds, gapIds: secGaps }, ...rest];
}

/** A finding's exposure line: the evidence tier + the plane (live / recorded), else "Read from code". Deterministic. */
export function findingExposure(f: Pick<Finding, 'evidence'>): string {
  const ev = f.evidence ?? [];
  // `metric` is stamped only for a live plane this run mounted (deep.ts), so it carries a tenant plane's name too.
  const live = ev.find((e) => e?.kind === 'metric');
  if (live) { const p = planeOf(live.ref); return `Measured · ${p ? planeDisplayName(p) : 'a live system'}`; }
  for (const e of ev) {
    if (provenanceClassOf(e?.ref) !== 'external') continue;
    const src = externalSourceOf(e.ref);
    return `Measured · ${src ? planeDisplayName(src) : 'an external source'} (recorded, not a live query)`;
  }
  return 'Read from code · the repository';
}

/** The whole Execution model for a run. */
export function buildExecutionModel(opts: {
  findings: Finding[];
  hypotheses: Hypothesis[];
  mitigations: Mitigation[];
  gaps?: CoverageGap[];
  areas?: SynthesisArea[];
  appendix?: ExecutionModel['appendix'];
  /** Incremental re-scan: bundle id → the date a REUSED lane's live-plane measurements were taken (carried, proposal §3 b). */
  measuredOnByBundle?: Record<string, string>;
  /** Phase 3: finding id → how it was carried forward (see ExecutionItem.carried). */
  carriedById?: Record<string, string>;
  /** Report lens split: the synthesis' validated per-hypothesis lens overrides (a gap's lens reads them too). */
  lensOverrides?: readonly LensOverride[];
  /** Report lens split Phase 2: Comprehend's capability map — business findings are grouped by capability. */
  capabilities?: readonly Capability[];
}): ExecutionModel {
  const ov = overrideMap(opts.lensOverrides);
  const hyp = new Map(opts.hypotheses.map((h) => [key(h.id), h]));
  const mit = new Map(opts.mitigations.map((m) => [key(m.hypothesisId), m]));
  const items: Record<string, ExecutionItem> = {};
  for (const f of opts.findings) {
    items[f.id] = executionItemFor(f, hyp.get(key(f.id)), mit.get(key(f.id)));
    const owner = findingArea({ id: String(f.id ?? ''), invariant: f.invariant })?.key ?? String(f.id ?? '').split(':')[0].toLowerCase();
    const on = owner ? opts.measuredOnByBundle?.[owner] : undefined;
    if (on) items[f.id].measuredOn = on;
    const carried = opts.carriedById?.[f.id];
    if (carried) items[f.id].carried = carried;
    if ((isFindingLens(f.lens) ? f.lens : lensFor(f, ov)) === 'security') items[f.id].exposure = findingExposure(f);
  }
  const groups = securityFirstGroups(executionGroupsFor(opts.findings, opts.gaps ?? [], opts.areas, opts.capabilities), opts.findings, opts.gaps ?? [], opts.lensOverrides);
  return { items, groups, ...(opts.appendix?.length ? { appendix: opts.appendix } : {}) };
}

/** The Leadership brief's "Area health" rows: the synthesis themes (the unexamined / other buckets are Execution-only). */
export function areaHealthThemes(groups: ExecutionGroup[]): AreaHealthTheme[] {
  return groups.filter((g) => g.key !== 'not-examined' && g.key !== 'other').map((g) => ({
    key: g.key, name: g.name, ...(g.verdict ? { verdict: g.verdict } : {}), ...(g.framing ? { framing: g.framing } : {}),
    findingIds: g.findingIds, gapCount: g.gapIds.length,
  }));
}
