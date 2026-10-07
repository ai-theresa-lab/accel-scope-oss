// Renders a MinerResult into a self-contained, interactive HTML product report
// in the accel-scope design language (espresso / honey / cream, Geist + Geist Mono).
//
// This is the full visual deliverable: everything report.ts emits as markdown
// (vitals, scorecard, findings, hotspots, change-coupling, contributors,
// languages), presented as one browser-openable product with three tabs —
// Overview, Findings, and Evidence (the appendix tables).
//
// The Findings tab offers three interchangeable layouts over the same
// lens-filtered, impact/impact×effort/severity-sorted set, switchable from the
// toolbar: Split (two-pane explorer — list + drill-in to evidence and the
// agent-runnable remediation task), List (dense full-width rows for scanning),
// and Board (severity columns for triage). Opening a finding from List or Board
// drops into the Split detail.
//
// Same MinerResult in as report.ts — wired to the deterministic miner via cli.ts.
// No build step, framework, or external assets: the bee mark is inline SVG and
// interactivity is vanilla JS. Every value is derived from the Finding contract /
// metrics in schema.ts; the one derived number (impactScore) is a transparent
// ranking proxy documented below — nothing is fabricated.

import { uncheckedWhyText } from './sinceLastScan.ts';
import { readFileSync } from 'node:fs';
import { anchorAttr, contentHash, dedupeAnchorIds, canonicalJson, REPORT_STATUS_CSS, statusChipHtml, statusFromVerdict } from './reportChrome.ts';
import { assignDisplayIds, displayIdRank } from './findingIds.ts';
import { findingAnchorIds, isRuledOutFinding } from './reportAnchors.ts';
import { findingCounts } from './run/findingCounts.ts';
import { REMEDIATION_MD_JS } from './remediationMd.ts';
import { plural } from './plural.ts';
import type { Confidence, Dimension, Effort, Finding, MinerResult, Severity } from './schema.ts';

// ---- design tokens -------------------------------------------------------

const SEV_COLOR: Record<Severity, string> = {
  critical: '#C0392B',
  high: '#D97B2B',
  medium: '#B9911E',
  low: '#5E8C6A',
  info: '#8A7E6E',
};

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// The five product "lenses" from the design. The schema's six dimensions fold
// in: code_health + architecture both surface under "Code & architecture".
type LensKey = 'security' | 'delivery' | 'code' | 'product' | 'knowledge';

const LENS: Record<LensKey, { label: string; color: string }> = {
  security: { label: 'Security & supply chain', color: '#C0392B' },
  delivery: { label: 'Delivery flow', color: '#D97B2B' },
  code: { label: 'Code & architecture', color: '#8A5BB8' },
  product: { label: 'Product metrics', color: '#2F7D8C' },
  knowledge: { label: 'Knowledge risk', color: '#5E8C6A' },
};

const LENS_OF: Record<Dimension, LensKey> = {
  security_supply: 'security',
  delivery_flow: 'delivery',
  code_health: 'code',
  architecture: 'code',
  product_metrics: 'product',
  knowledge_risk: 'knowledge',
};

// The lens of a BUNDLE finding. deep.ts hypothesesToFindings stamps every recommendation-audit finding
// `dimension: 'product_metrics'` whatever bundle produced it, so a code-native self-scan labelled all 48
// findings "Product metrics". The finding id carries its bundle (`<bundle>:<hyp>`, uppercased), and for the
// CODE-NATIVE bundles that area is the truthful lens. Data/product bundles (baseline, data-eng, analytics,
// trust-safety, recsys-mle) keep product_metrics → "Product metrics", which is what they measure.
const BUNDLE_LENS: Record<string, LensKey> = {
  appsec: 'security',
  'saas-tenancy': 'security',
  'release-eng': 'delivery',
  'swe-arch': 'code',
  'api-stability': 'code',
  'mobile-ios': 'code',
  'mobile-android': 'code',
};
export function lensKeyFor(f: Pick<Finding, 'id' | 'dimension'>): LensKey {
  if (f.dimension === 'product_metrics') {
    const id = String(f.id ?? '');
    const bundle = id.includes(':') ? id.slice(0, id.indexOf(':')).toLowerCase() : '';
    if (BUNDLE_LENS[bundle]) return BUNDLE_LENS[bundle];
  }
  return LENS_OF[f.dimension] ?? 'code';
}

const EFFORT_LABEL: Record<Effort, string> = { quick_win: 'quick win', moderate: 'moderate', project: 'project' };
const EFFORT_RANK: Record<Effort, number> = { quick_win: 1, moderate: 3, project: 6 };

// impactScore — a transparent 0–10 ranking proxy derived from severity nudged by
// confidence. The schema carries categorical severity/confidence, not a numeric
// impact; this gives the value-ranking view (impact, impact×effort) something to
// sort on without inventing data. Same inputs → same number, every run.
const IMPACT_BASE: Record<Severity, number> = { critical: 9.2, high: 7.6, medium: 5.6, low: 3.6, info: 1.8 };
const CONF_ADJ: Record<Confidence, number> = { high: 0.4, medium: 0, low: -0.4 };

// Per-severity counts of the CONFIRMED findings: ruled-out rows (isRuledOutFinding) are skipped so the
// severity cells/bar always sum to the same confirmed number the header, run.findings and REMEDIATION.md show. PURE.
export function severityCounts(findings: readonly Pick<Finding, 'source' | 'severity'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) if (!isRuledOutFinding(f)) out[f.severity] = (out[f.severity] ?? 0) + 1;
  return out;
}

// The one "Ruled out:" prefix (idempotent), for every deterministic surface that lists a ruled-out row.
export function ruledOutTitle(title: string): string {
  const t = String(title ?? '').trim();
  return /^ruled out:/i.test(t) ? t : `Ruled out: ${t}`;
}

function impactScore(f: Finding): number {
  const raw = (IMPACT_BASE[f.severity] ?? 5) + (CONF_ADJ[f.confidence] ?? 0);
  return Math.round(Math.max(0, Math.min(10, raw)) * 10) / 10;
}

// ---- view model ----------------------------------------------------------

interface EvidenceVM {
  ref: string;
  detail: string;
  // A GitHub permalink at the scanned commit. NEVER set at render time — the serve-time link pass
  // (reportLinks.ts linkifyAccelData) adds it per request, so /share can apply its public-repos-only policy.
  href?: string;
}
interface RemRow {
  k: string;
  v: string;
}
interface FindingVM {
  id: string;
  anchorId: string; // content-stable comment anchor (finding-<hash of claim+lens+severity>) — NOT the positional f.id
  lensKey: LensKey;
  lensLabel: string;
  lensColor: string;
  severity: Severity;
  sevColor: string;
  impact: number;
  effortLabel: string;
  effortRank: number;
  claim: string; // headline (schema title)
  detail: string; // assertion paragraph (schema claim)
  evidence: EvidenceVM[];
  evidenceShort: string;
  business: string;
  remediation: RemRow[];
  blast: string; // top-right tag: invariant or source
  userDerived: boolean; // finding from a dimension minted from the user's brief (invariant u1..uN)
  confidence: Confidence;
  ruledOut: boolean; // A refuted recommendation-audit hypothesis (isRuledOutFinding) — rendered, never counted or exported as work
  // The run-wide display id ("F-01"), from findingIds.assignDisplayIds over this same array. Absent (undefined,
  // so JSON.stringify drops it) on a ruled-out row, which is not a finding and gets no number.
  displayId?: string;
  status: 'confirmed' | 'ruled-out'; // contract field for REMEDIATION.md / the console (mirrors ruledOut)
  // Two-report model — Execution fields (present only when MinerResult.execution is). `acceptance` is the REMEDIATION.md field the
  // REMEDIATION.md builder already reads; `verify` / `verifyKind` feed its "How to verify" block and the card.
  group?: string;
  acceptance?: string;
  verify?: string;
  verifyKind?: 'query' | 'procedure';
  measured?: string;
  // Incremental re-scan (src/sinceLastScan.ts): new / persisting since <date> / changed vs the baseline scan.
  since?: { status: 'new' | 'persisting' | 'changed'; since?: string };
  measuredOn?: string;
  carried?: string;
  // Cross-project org memory: the sibling project this finding was found inconsistent with ("Across projects" chip).
  crossProject?: string;
  // Report lens split (findingLens.ts): business | security | engineering. REMEDIATION.md orders security first on it.
  // Named reportLens because `lensKey` / `lensLabel` are the older dimension lens (and the builder reads `f.lens`).
  reportLens?: 'business' | 'security' | 'engineering';
}

// Two-report model — one Work-plan group (a synthesis area / business theme).
interface ExecGroupVM {
  key?: string;
  name: string;
  verdict?: string;
  framing?: string;
  rows: Array<{ anchorId: string; displayId?: string; claim: string; severity: Severity; sevColor: string; effortLabel: string; foundBy: string; since?: FindingVM['since']; crossProject?: string; exposure?: string }>;
  gaps: Array<{ concern: string; why: string; next: string; status: string }>;
}

interface StatCard {
  label: string;
  value: string;
  sub: string;
}
interface Hotspot {
  path: string;
  commits: number;
  churn: number;
  owner: string;
  share: string;
}
interface Coupling {
  a: string;
  b: string;
  co: number;
  degree: string;
  cross: boolean;
}
interface Contributor {
  id: string;
  commits: number;
  share: string;
  aliases: number;
  bot: boolean;
}

interface ViewModel {
  target: string;
  date: string;
  miner: string;
  isOrg: boolean;
  showEvidence: boolean;
  topbar: { commits: string; people: string; cost: string };
  hero: { headline: string; emphasis: string; para: string; stats: StatCard[] };
  vitals: StatCard[];
  languages: Array<{ ext: string; count: number }>;
  summary: {
    total: number;
    ruledOut: number; // Refuted rows carried beside `total` (the confirmed count), never inside it
    sev: Array<{ label: string; n: number; color: string }>;
    sevBar: Array<{ flex: number; color: string }>;
    lenses: Array<{ label: string; n: number; color: string }>;
    synthesis: string;
    synthMeta: string;
  };
  hotspots: { rows: Hotspot[]; total: number };
  coupling: { rows: Coupling[]; total: number };
  contributors: { rows: Contributor[]; total: number };
  lensFilters: Array<{ key: string; label: string }>;
  findings: FindingVM[];
  mode?: 'execution';
  execution?: { groups: ExecGroupVM[]; appendix: Array<{ key: string; title: string; html: string }>; since?: NonNullable<MinerResult['execution']>['sinceLastScan'] };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function pct(v: unknown, digits = 0): string {
  return `${(num(v) * 100).toFixed(digits)}%`;
}
// "name <email>" → "name"; bare value passes through.
function shortName(s: string): string {
  const i = s.indexOf(' <');
  return (i >= 0 ? s.slice(0, i) : s).trim() || s;
}
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

// Per-language tag color — a warm, design-compatible palette (no blue/grey, per
// the brand guideline). Fixed hues for common languages; anything unmapped gets
// a stable color hashed from its extension so it stays consistent across runs.
const LANG_COLOR: Record<string, string> = {
  ts: '#2F7D8C', tsx: '#8A5BB8', js: '#B9911E', jsx: '#D97B2B', mjs: '#9A6A0E', cjs: '#9A6A0E',
  json: '#5E8C6A', html: '#C0392B', css: '#8A5BB8', scss: '#8A5BB8', sass: '#8A5BB8',
  md: '#8A7E6E', mdx: '#8A7E6E', txt: '#8A7E6E',
  yaml: '#2F7D54', yml: '#2F7D54', toml: '#B9911E', ini: '#B9911E',
  py: '#2F7D8C', go: '#2F7D54', rs: '#C0392B', rb: '#C0392B', java: '#D97B2B', kt: '#8A5BB8',
  sh: '#5E8C6A', bash: '#5E8C6A', sql: '#9A6A0E', php: '#8A5BB8', c: '#2F7D8C', cpp: '#2F7D8C', h: '#2F7D8C',
};
const LANG_PALETTE = ['#C0392B', '#D97B2B', '#B9911E', '#9A6A0E', '#5E8C6A', '#2F7D54', '#8A5BB8', '#2F7D8C'];

function langColor(ext: string): string {
  const key = ext.toLowerCase().replace(/^\./, '');
  if (LANG_COLOR[key]) return LANG_COLOR[key];
  if (!key || key === '(none)' || key === 'none') return '#8A7E6E';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return LANG_PALETTE[h % LANG_PALETTE.length];
}

// Agentic synthesis can arrive as newline-separated bullet points; render them as a tight list
// (else a single paragraph). Backward-compatible with the deterministic single-string synthesis.
/** The Execution report's "Precedent" row (+ REMEDIATION.md): an unreachable project shows no run id and only a month. */
export function precedentText(p: { project: string; date: string; runId?: string; restricted?: boolean }): string {
  // No run id in reader-facing text (2026-10-05: internal serial numbers removed from reports) — project + date only.
  return p.restricted || !p.runId ? `fixed in ${p.restricted ? p.project : `project ${p.project}`} in ${p.date.slice(0, 7)}` : `fixed in project ${p.project} on ${p.date}`;
}
function stripBullet(s: string): string { return s.replace(/^\s*[•\-*]\s+/, '').trim(); }
function synthLines(text: string): string[] { return text.split(/\r?\n/).map(stripBullet).filter(Boolean); }
function renderSynthBody(text: string): string {
  const lines = synthLines(text);
  if (lines.length > 1) {
    return `<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.55;color:#F3E8DA">${lines.map((l) => `<li style="margin:5px 0">${escapeHtml(l)}</li>`).join('')}</ul>`;
  }
  return `<p style="font-size:13.5px;line-height:1.5;color:#F3E8DA">${escapeHtml(text)}</p>`;
}

function buildViewModel(result: MinerResult, stamp: string, costUsd?: number | null): ViewModel {
  const m = (result.metrics ?? {}) as any;
  const s = (m.summary ?? {}) as any;
  // Was the deterministic git layer actually available? A local, .git-less folder (or an org run whose
  // analyzeOrg produced no metrics at all) leaves every vital at 0, and the header printed
  // "0 repos · 0 people · $0 · 0.0% test ratio (0/0 files)" on a $108 run — zeros presented as facts. When the
  // layer had nothing to read, every git-derived number renders as "—" with the reason, never as 0.
  const isOrg0 = s.org === true || result.miner === 'org-aggregate' || result.miner === 'research-org';
  const noHistory = isOrg0 ? !(num(s.repos, 0) > 0) : !(num(s.commits, 0) > 0);
  const NA = '—';
  const NA_SUB = 'not available (no git history)';
  const gv = (v: string): string => (noHistory ? NA : v);          // git-derived value
  const gs = (sub: string): string => (noHistory ? NA_SUB : sub);  // …and its sub-label
  // Cost comes from the RUN (the caller's authoritative total, else a summary-carried figure). Unknown ⇒ no
  // cost shown at all — the old hard-coded '$0' was a fabricated number on every report.
  const costN = typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : (typeof s.costUsd === 'number' && Number.isFinite(s.costUsd) ? s.costUsd : null);
  const findings = [...result.findings];
  // The anchor map is computed ONCE, by the shared helper the leadership writer also calls, so a citation in
  // the brief and the block it points at can never disagree. dedupeAnchorIds is order-sensitive for
  // identical-content findings, which is exactly why this must not be recomputed independently downstream.
  const anchorIds = findingAnchorIds(findings);
  // Display ids over the SAME array, from the ONE id function the leadership list and the Combined index use.
  const displayIds = assignDisplayIds(findings);

  const ex = result.execution;
  const groupOf = new Map<string, string>();
  for (const g of ex?.groups ?? []) for (const id of g.findingIds) if (!groupOf.has(id)) groupOf.set(id, g.name);
  const fvm: FindingVM[] = findings.map((f, i) => {
    const lensKey = lensKeyFor(f);
    const ev: EvidenceVM[] = (f.evidence ?? []).map((e) => ({ ref: e.ref, detail: e.detail ?? '' }));
    const it = ex?.items[f.id];
    // Execution: the rows an engineer / coding agent acts on, in the order they act on them. "Recommended fix" is the
    // key the REMEDIATION.md builder reads as the fix; Done when rides as `acceptance` (its own block, and the
    // builder's Acceptance line); How to verify rides as `verify`. Internal provenance (Source / Invariant) is dropped.
    const rem: RemRow[] = ex
      ? [
          { k: 'Recommended fix', v: it?.fix || 'No specific fix was drafted — fix the problem described above.' },
          // Cross-project org memory (deterministic): the same finding pattern already fixed elsewhere in the org, and the
          // sibling project this one was found inconsistent with. Rows, so REMEDIATION.md carries them too.
          ...(ex.precedents?.[f.id] ? [{ k: 'Precedent', v: precedentText(ex.precedents[f.id]) }] : []),
          ...(ex.crossProject?.[f.id] ? [{ k: 'Across projects', v: `inconsistent with project ${ex.crossProject[f.id].project} (${ex.crossProject[f.id].key}) — this project's side measured in this scan, the other side re-checked at its recorded commit` }] : []),
          ...(it?.expectedEffect ? [{ k: 'Expected effect', v: it.expectedEffect }] : []),
          ...(it?.guardrail ? [{ k: 'Guardrail', v: it.guardrail }] : []),
          ...(it?.foundBy ? [{ k: 'Found by', v: it.foundBy }] : []),
          // Report lens split: a security card states its exposure (evidence tier + plane); REMEDIATION.md prints it too.
          ...(it?.exposure ? [{ k: 'Exposure', v: it.exposure }] : []),
          { k: 'Effort', v: EFFORT_LABEL[f.effort] ?? f.effort },
        ]
      : [{ k: 'Recommendation', v: f.recommendation }, { k: 'Effort', v: EFFORT_LABEL[f.effort] ?? f.effort }, { k: 'Confidence', v: f.confidence }];
    if (!ex && f.invariant) rem.push({ k: 'Invariant', v: f.invariant });
    if (!ex) rem.push({ k: 'Source', v: f.source });
    return {
      id: f.id,
      // Comment anchor from the finding's COMPLETE stable content, NOT f.id (which is `<INVARIANT>-<array-index>`
      // → migrates onto a different finding on regen). We hash a CANONICAL serialization of the whole finding
      // (every field it carries — title, claim, evidence[ref+detail], businessImpact, recommendation, effort,
      // confidence, severity, source, invariant, …) with only the positional `id` excluded, so NO field can be
      // omitted from the identity (no hand-picked key list to fall out of sync). Correctness-first: two findings
      // collide ONLY when byte-identical across their entire content — genuinely the same card — and the dedupe
      // pass below is a harmless tiebreak for exactly those. A distinct finding NEVER shares a base id, so the
      // array-order-dependent dedupe suffix can never migrate a comment onto the wrong finding.
      anchorId: anchorIds[i],
      lensKey,
      lensLabel: LENS[lensKey].label,
      lensColor: LENS[lensKey].color,
      severity: f.severity,
      sevColor: SEV_COLOR[f.severity] ?? '#8A7E6E',
      impact: impactScore(f),
      effortLabel: EFFORT_LABEL[f.effort] ?? f.effort,
      effortRank: EFFORT_RANK[f.effort] ?? 4,
      // A ruled-out row is titled "Ruled out: …" on every card, so a checked-and-healthy hypothesis can never be
      // read as one more defect in a list of defects.
      claim: isRuledOutFinding(f) ? ruledOutTitle(f.title) : f.title,
      detail: f.claim,
      evidence: ev,
      evidenceShort: ev.length ? baseName(ev[0].ref) : '',
      business: f.businessImpact,
      remediation: rem,
      blast: f.invariant ? f.invariant.toUpperCase() : f.source,
      userDerived: /^u\d+$/i.test(String(f.invariant ?? '')), // u1..uN = minted from the user's brief
      confidence: f.confidence,
      ruledOut: isRuledOutFinding(f),
      displayId: displayIds[i],
      status: isRuledOutFinding(f) ? 'ruled-out' : 'confirmed',
      ...(ex ? {
        ...(f.lens ? { reportLens: f.lens } : {}),
        ...(groupOf.get(f.id) ? { group: groupOf.get(f.id) } : {}),
        ...(it?.doneWhen ? { acceptance: it.doneWhen } : {}),
        ...(it?.verify ? { verify: it.verify, verifyKind: it.verifyKind ?? 'procedure' } : {}),
        ...(it?.measured ? { measured: it.measured } : {}),
        ...(it?.measuredOn ? { measuredOn: it.measuredOn } : {}),
        ...(it?.carried ? { carried: it.carried } : {}),
        ...(ex.sinceLastScan?.tags[f.id] && !isRuledOutFinding(f) ? { since: ex.sinceLastScan.tags[f.id] } : {}),
        ...(ex.crossProject?.[f.id] && !isRuledOutFinding(f) ? { crossProject: ex.crossProject[f.id].project } : {}),
      } : {}),
    };
  });
  // Within-render uniqueness: two findings with IDENTICAL stable content share a base anchor hash; suffix the
  // genuine duplicates (finding-<hash>, finding-<hash>-2, …) in one pass over the full set. Only ever affects
  // content-indistinguishable findings; distinct findings keep their pure content hash. (See dedupeAnchorIds.)
  // findingAnchorMap already deduped; this pass now only matters for a finding with no id, which falls back
  // to the inline hash above and therefore bypassed the shared dedupe.
  const dedupedAnchors = dedupeAnchorIds(fvm.map((f) => f.anchorId));
  fvm.forEach((f, i) => { f.anchorId = dedupedAnchors[i]; });

  // Two-report model — the Work plan: confirmed findings grouped by synthesis area, each group with its open questions.
  // Duplicate Finding.ids are matched positionally (each id consumes the next unclaimed card with that id).
  let execution: ViewModel['execution'];
  let lensFiltersOut: Array<{ key: string; label: string }> | undefined;
  let applyThemes: (() => void) | undefined;
  if (ex) {
    const pool = new Map<string, FindingVM[]>();
    for (const f of fvm) { if (f.ruledOut) continue; const a = pool.get(f.id) ?? []; a.push(f); pool.set(f.id, a); }
    const gapById = new Map((result.coverageGaps ?? []).map((g) => [String(g.id), g]));
    const groups: ExecGroupVM[] = ex.groups.map((g) => ({
      key: g.key,
      name: g.name,
      ...(g.verdict ? { verdict: g.verdict } : {}),
      ...(g.framing ? { framing: g.framing } : {}),
      // Theme groups list in F-id order; the SECURITY group keeps its own order (severity, then effort — executionModel.ts).
      rows: g.findingIds.map((id) => pool.get(id)?.shift()).filter((f): f is FindingVM => !!f).sort((a, b) => (g.key === 'security' ? 0 : displayIdRank(a.displayId) - displayIdRank(b.displayId))).map((f) => ({
        anchorId: f.anchorId, ...(f.displayId ? { displayId: f.displayId } : {}), claim: f.claim, severity: f.severity,
        sevColor: f.sevColor, effortLabel: f.effortLabel, foundBy: ex.items[f.id]?.foundBy ?? '', ...(f.since ? { since: f.since } : {}), ...(f.crossProject ? { crossProject: f.crossProject } : {}),
        ...(ex.items[f.id]?.exposure ? { exposure: ex.items[f.id].exposure } : {}),
      })),
      gaps: g.gapIds.map((id) => gapById.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({
        concern: x.concern, why: x.whyUnsettled, next: x.nextDecisiveTest, status: x.status,
      })),
    })).filter((g) => g.rows.length || g.gaps.length);
    // A confirmed finding no group claimed (should not happen — executionGroups sends leftovers to "Other") still gets a row.
    const left = [...pool.values()].flat();
    if (left.length) groups.push({ name: 'Other', rows: left.map((f) => ({ anchorId: f.anchorId, ...(f.displayId ? { displayId: f.displayId } : {}), claim: f.claim, severity: f.severity, sevColor: f.sevColor, effortLabel: f.effortLabel, foundBy: ex.items[f.id]?.foundBy ?? '' })), gaps: [] });
    execution = { groups, appendix: ex.appendix ?? [], ...(ex.sinceLastScan ? { since: ex.sinceLastScan } : {}) };
    // The Findings pane filters and labels by THEME, not by lens: in a Full Scan the lens comes from the bundle that raised
    // the finding (lensKeyFor), which put metric-definition findings under "Delivery flow" (umami). The severity/lens
    // summary in the Appendix was computed above from the real lenses and is unaffected.
    applyThemes = () => {
      const THEME_COLORS = ['#B0413E', '#9A6A0E', '#2F6E8F', '#5B7F3A', '#7A4E9A', '#8A7E6E'];
      const themes = [...new Set(fvm.filter((f) => !f.ruledOut).map((f) => f.group ?? 'Other'))];
      fvm.forEach((f) => {
        const t = f.group ?? 'Other';
        const i = Math.max(0, themes.indexOf(t));
        f.lensKey = (`theme-${i}`) as LensKey; f.lensLabel = t; f.lensColor = THEME_COLORS[i % THEME_COLORS.length];
      });
      lensFiltersOut = [{ key: 'all', label: 'All' }, ...themes.map((t, i) => ({ key: `theme-${i}`, label: t }))];
    };
  }

  // severity summary + stacked bar (crit→info, non-empty only). Over CONFIRMED findings only — the ruled-out rows
  // are `info` recommendation-audit rows, so counting them made "48 confirmed · by severity" sit over bars summing to 53.
  const sevCounts = severityCounts(findings);
  const sevOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  const sev = sevOrder.filter((k) => sevCounts[k]).map((k) => ({ label: k, n: sevCounts[k], color: SEV_COLOR[k] }));
  const sevBar = sevOrder.filter((k) => sevCounts[k]).map((k) => ({ flex: sevCounts[k], color: SEV_COLOR[k] }));

  // lens summary, sorted desc. The "by lens" card counts CONFIRMED rows (same number as the header); the filter
  // chips below still cover every rendered row, so a lens holding only ruled-out cards stays reachable.
  const lensCounts: Record<string, number> = {};
  const confirmedLensCounts: Record<string, number> = {};
  for (const f of fvm) {
    lensCounts[f.lensKey] = (lensCounts[f.lensKey] ?? 0) + 1;
    if (!f.ruledOut) confirmedLensCounts[f.lensKey] = (confirmedLensCounts[f.lensKey] ?? 0) + 1;
  }
  const lenses = (Object.keys(confirmedLensCounts) as LensKey[])
    .map((k) => ({ key: k, label: LENS[k].label, n: confirmedLensCounts[k], color: LENS[k].color }))
    .sort((a, b) => b.n - a.n);

  const lensOrder: LensKey[] = ['security', 'delivery', 'code', 'product', 'knowledge'];
  const present = lensOrder.filter((k) => lensCounts[k]);
  const lensFilters = [{ key: 'all', label: 'All' }, ...present.map((k) => ({ key: k, label: shortLens(k) }))];

  // synthesis (computed from metrics — no project specifics hardcoded)
  // "confirmed findings" = the confirmed count only — the ruled-out rows still render (as ruled out), but the
  // header/hero/synthesis must agree with run.findings, which is the same findingCounts split.
  const { confirmed: total, ruledOut: ruledOutN } = findingCounts(findings);
  const critHigh = (sevCounts.critical ?? 0) + (sevCounts.high ?? 0);
  const topLens = lenses[0];
  const busFactor = num(s.busFactor, 0);
  const topShare = num(s.topContributorShare, 0);
  const testRatio = num(s.testRatio, 0);
  // With history but NO classified code files, the ratio is 0/0 — "not available", never "0.0%".
  const noCodeFiles = !(num(s.codeFiles, 0) > 0);
  const trValue = (): string => gv(noCodeFiles ? NA : pct(testRatio, 1));
  const trSub = (sub: string): string => gs(noCodeFiles ? 'not available (no code files classified)' : sub);
  // An agentic run (e.g. the recsys/data-trust audit's synthesis stage) can supply its own bottom-line
  // narrative; prefer it over the deterministic, repo-metric-derived synthesis when present.
  const providedSynth = typeof s.synthesis === 'string' && s.synthesis.trim() ? s.synthesis.trim() : null;
  // An assessment that could not run (e.g. bus factor on a folder with no git history) is an open question, not a
  // finding — and a zero-finding report must not call that a clean run.
  const openQs = (result.coverageGaps ?? []).length;
  const synthesis = providedSynth ?? (total === 0
    ? (openQs
      ? `No findings surfaced for this target, and ${plural(openQs, 'question')} could not be settled (see Open questions). Re-run with the agentic layer for deeper, data-trust analysis.`
      : 'No findings surfaced for this target. The deterministic evidence layer ran clean — re-run with the agentic layer for deeper, data-trust analysis.')
    : `${critHigh} of ${total} confirmed findings are critical or high${topLens ? `, concentrated in ${topLens.label.toLowerCase()}` : ''}. ` +
      (noHistory ? 'Repository vitals are not available (no git history). '
        : `Bus factor ${busFactor || '—'}${topShare ? ` (top contributor ${pct(topShare)})` : ''}; test ratio ${noCodeFiles ? 'not available' : pct(testRatio, 1)}. `) +
      'Fix the high-severity, low-effort findings first — they top the impact×effort sort.');
  const synthMeta = (noHistory ? ['vitals not available (no git history)', plural(total, 'finding')]
    : [`bus factor ${busFactor || '—'}`, `${num(s.codeFiles, 0)} code files`, (noCodeFiles ? 'test ratio not available' : `${pct(testRatio, 1)} tested`), plural(total, 'finding')]).join(' · ');

  // vitals stat cards — org-level when this is an org/research run, repo-level otherwise
  const isOrg = isOrg0;
  const vitals: StatCard[] = isOrg ? [
    { label: 'Repositories', value: gv(String(num(s.repos, 0))), sub: gs('analyzed') },
    { label: 'People', value: gv(String(num(s.people, 0))), sub: gs('contributors') },
    { label: 'Org bus factor', value: gv(String(busFactor || '—')), sub: gs('ownership concentration') },
    { label: 'Total commits', value: gv(String(num(s.commits, 0))), sub: gs('non-merge') },
    { label: 'Repos w/ secrets', value: gv(String(num(s.reposWithSecrets, 0))), sub: gs('committed credentials') },
    { label: 'Test ratio', value: trValue(), sub: trSub('avg across repos') },
    { label: 'Code files', value: gv(String(num(s.codeFiles, 0))), sub: gs('tracked') },
    { label: 'Findings', value: String(total), sub: 'confirmed' },
  ] : [
    { label: 'Commits', value: gv(String(num(s.commits, 0))), sub: gs('non-merge') },
    { label: 'Velocity', value: gv(`~${num(s.commitsPerWeek, 0)}/wk`), sub: gs(`avg ${num(s.avgFilesPerCommit, 0)} files/commit`) },
    { label: 'History', value: gv(`${num(s.spanWeeks, 0)}w`), sub: gs(`${s.firstCommit ?? '—'} → ${s.lastCommit ?? '—'}`) },
    { label: 'People', value: gv(String(num(s.people, 0))), sub: gs(`from ${num(s.rawIdentities, 0)} raw ids`) },
    { label: 'Bus factor', value: gv(String(busFactor || '—')), sub: gs(topShare ? `top ${pct(topShare)}` : 'ownership') },
    { label: 'Test ratio', value: trValue(), sub: trSub(`${num(s.testFiles, 0)} / ${plural(num(s.codeFiles, 0), 'file')}`) },
    { label: 'Code files', value: gv(String(num(s.codeFiles, 0))), sub: gs('tracked') },
    { label: 'Big commits', value: gv(String(num(s.bigCommits, 0))), sub: gs('> 30 files') },
  ];

  const languages = (m.languages ?? []).slice(0, 8).map((l: any) => ({ ext: String(l.ext ?? '?'), count: num(l.count, 0) }));

  const hsAll = (m.hotspots ?? []) as any[];
  const hotspots = {
    total: hsAll.length,
    rows: hsAll.slice(0, 12).map((h) => ({ path: String(h.path ?? ''), commits: num(h.commits), churn: num(h.churn), owner: shortName(String(h.topAuthor ?? '—')), share: pct(h.topShare) })),
  };
  const cpAll = (m.coupling ?? []) as any[];
  const coupling = {
    total: cpAll.length,
    rows: cpAll.slice(0, 10).map((c) => ({ a: String(c.a ?? ''), b: String(c.b ?? ''), co: num(c.coChanges), degree: pct(c.degree), cross: !!c.crossModule })),
  };
  const ctAll = (m.contributors ?? []) as any[];
  const contributors = {
    total: ctAll.length,
    rows: ctAll.slice(0, 12).map((c) => ({ id: shortName(String(c.id ?? '—')), commits: num(c.commits), share: pct(c.share), aliases: num(c.aliasCount), bot: !!c.isBot })),
  };

  // hero (overview briefing band) — editorial thesis headline + four big
  // at-a-glance stats. Everything is derived from the metrics above; the
  // agentic/research layer may supply richer copy via metrics.summary
  // (headline / headlineEmphasis / synthesis / heroStats), which overrides the
  // deterministic derivation when present. Nothing is fabricated by default.
  const criticalN = sevCounts.critical ?? 0;
  const topLensLabel = topLens ? topLens.label : '';
  // top finding by impact — the lead concern the brief opens on.
  const topFinding = fvm.slice().sort((a, b) => b.impact - a.impact)[0];
  const derivedHeadline = total === 0
    ? (openQs ? `No findings surfaced for this target — ${plural(openQs, 'question')} could not be settled.` : 'No findings surfaced for this target — the deterministic layer ran clean.')
    : `${critHigh} of ${total} confirmed findings are critical or high${topLensLabel ? `, concentrated in ${topLensLabel.toLowerCase()}` : ''}.`;
  const derivedEmphasis = topLensLabel ? topLensLabel.toLowerCase() : (total ? `${critHigh} of ${total}` : '');
  const derivedHeroPara = total === 0
    ? 'Re-run with the agentic layer for deeper, data-trust analysis across the connected sources.'
    : `${topFinding ? `Lead concern: ${topFinding.claim}. ` : ''}Fix the high-severity, low-effort findings first — they top the impact × effort sort and prevent recurrence ${isOrg ? 'org-wide' : 'across the repo'}.`;
  const derivedHeroStats: StatCard[] = isOrg ? [
    { label: 'confirmed findings', value: String(total), sub: noHistory ? 'this run' : `across ${plural(num(s.repos, 0), 'repo')}` },
    { label: 'critical', value: String(criticalN), sub: 'highest severity' },
    { label: 'repos w/ secrets', value: gv(String(num(s.reposWithSecrets, 0))), sub: gs('committed credentials') },
    { label: 'test ratio', value: trValue(), sub: trSub(`${num(s.testFiles, 0)} / ${plural(num(s.codeFiles, 0), 'file')}`) },
  ] : [
    { label: 'confirmed findings', value: String(total), sub: 'this repository' },
    { label: 'critical + high', value: String(critHigh), sub: `of ${plural(total, 'finding')}` },
    { label: 'test ratio', value: trValue(), sub: trSub(`${num(s.testFiles, 0)} / ${plural(num(s.codeFiles, 0), 'file')}`) },
    { label: 'bus factor', value: gv(String(busFactor || '—')), sub: gs(topShare ? `top ${pct(topShare)}` : 'ownership') },
  ];
  const heroStatsRaw = Array.isArray(s.heroStats) && s.heroStats.length
    ? (s.heroStats as any[]).slice(0, 4).map((h) => ({ label: String(h.label ?? ''), value: String(h.value ?? h.v ?? ''), sub: String(h.sub ?? '') }))
    : derivedHeroStats;
  const hero = {
    headline: typeof s.headline === 'string' && s.headline.trim() ? s.headline.trim() : derivedHeadline,
    emphasis: typeof s.headlineEmphasis === 'string' && s.headlineEmphasis.trim() ? s.headlineEmphasis.trim() : derivedEmphasis,
    para: providedSynth ? (synthLines(providedSynth)[0] ?? providedSynth) : derivedHeroPara,
    stats: heroStatsRaw as StatCard[],
  };

  applyThemes?.();   // after the lens summary above, which must read the real lenses
  return {
    target: result.target,
    date: stamp.slice(0, 10),
    miner: result.miner,
    isOrg,
    showEvidence: hotspots.total > 0 || contributors.total > 0,
    topbar: noHistory
      ? { commits: NA_SUB, people: '', cost: costN == null ? '' : `$${costN.toFixed(2)}` }
      : { commits: isOrg ? plural(num(s.repos, 0), 'repo') : plural(num(s.commits, 0), 'commit'), people: plural(num(s.people, 0), 'person', 'people'), cost: costN == null ? '' : `$${costN.toFixed(2)}` },
    hero,
    vitals,
    languages,
    summary: { total, ruledOut: ruledOutN, sev, sevBar, lenses, synthesis, synthMeta },
    hotspots,
    coupling,
    contributors,
    lensFilters: lensFiltersOut ?? lensFilters,
    findings: fvm,
    ...(execution ? { mode: 'execution' as const, execution, showEvidence: true } : {}),
  };
}

function shortLens(k: LensKey): string {
  const map: Record<LensKey, string> = { security: 'Security', delivery: 'Delivery', code: 'Code', product: 'Product', knowledge: 'Knowledge' };
  return map[k];
}

// ---- the bee mark ---------------------------------------------------------
// The logo icon, read from disk at module load and inlined as a
// data URI so the emitted report.html stays self-contained (no external asset).
// Downscaled to 128px — it renders at 30px in the top bar.

const BEE_DATA_URI = (() => {
  const png = readFileSync(new URL('./assets/logo.png', import.meta.url));
  return `data:image/png;base64,${png.toString('base64')}`;
})();

const BEE_IMG = `<img src="${BEE_DATA_URI}" alt="accel-scope" style="width:100%;height:100%;display:block;object-fit:cover;">`;

// ---- static CSS (design system as classes) --------------------------------

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  /* Contrast floor: --muted / --honey-link colour the 10–12px mono labels, so both clear WCAG AA 4.5:1 on the cream
     grounds (were #8A7E6E ≈ 3.7:1 and #9A6A0E ≈ 4.4:1). reportChrome.test.ts computes it. */
  --espresso:#3E261C;--espresso-hover:#2A1A12;--honey:#FEC240;--honey-link:#875D0B;
  --cream:#FAF8F4;--cream-card:#FEFDFC;--line:#E7E0D4;--muted:#6F6455;--ink2:#5a4a3d;
}
html{scroll-behavior:smooth;}
body{background:#FAF8F4;font-family:'Geist',system-ui,sans-serif;color:#3E261C;-webkit-font-smoothing:antialiased;line-height:1.5;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
::selection{background:#FEC240;color:#3E261C;}
.mono{font-family:'Geist Mono',ui-monospace,monospace;}
.eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
.scrolly::-webkit-scrollbar{width:9px;height:9px;}
.scrolly::-webkit-scrollbar-thumb{background:#E7E0D4;border-radius:9px;}
.scrolly::-webkit-scrollbar-track{background:transparent;}

/* top bar */
.topbar{background:rgba(250,248,244,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);flex:none;}
.topbar-in{padding:13px 28px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.bee{width:30px;height:30px;border-radius:8px;box-shadow:0 2px 7px rgba(62,38,28,.16);overflow:hidden;flex:none;}
.tb-sep{margin-left:18px;padding-left:18px;border-left:1px solid var(--line);display:flex;align-items:center;gap:9px;}
.tb-right{margin-left:auto;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.dot{width:7px;height:7px;border-radius:50%;background:#2F7D54;}
.btn{background:var(--espresso);color:#fff;font-family:inherit;font-size:13.5px;font-weight:500;border:none;border-radius:10px;padding:9px 16px;cursor:pointer;transition:background .15s;box-shadow:0 8px 22px rgba(62,38,28,.18);}
.btn:hover{background:var(--espresso-hover);}

/* tab nav */
.tabs{flex:none;display:flex;gap:2px;padding:0 28px;border-bottom:1px solid var(--line);background:var(--cream);}
.tab{font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;letter-spacing:.04em;color:var(--muted);background:none;border:none;border-bottom:2px solid transparent;padding:14px 15px;cursor:pointer;transition:all .15s;}
.tab:hover{color:var(--espresso);}
.tab.active{color:var(--espresso);border-bottom-color:var(--honey);font-weight:600;}
.tab .n{font-size:11px;color:var(--honey-link);margin-left:6px;}

/* stage + panels */
.stage{flex:1;display:flex;flex-direction:column;min-height:0;}
.panel{display:none;}
.panel.active{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;}
.doc{max-width:1140px;margin:0 auto;width:100%;padding:26px 40px 56px;}
.sechead{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px;margin:34px 0 18px;}
.sechead:first-child{margin-top:0;}
.sechead h2{font-size:22px;font-weight:600;letter-spacing:-.02em;}
.sechead .n{font-family:'Geist Mono',ui-monospace,monospace;color:var(--honey-link);font-size:13px;}

.card{background:var(--cream-card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;box-shadow:0 8px 22px rgba(62,38,28,.05);}

/* hero (overview briefing) */
/* flex:none — the overview panel is a flex column; overflow:hidden would otherwise
   make the hero a shrinkable flex item (min-size resolves to 0) and a short viewport
   clips the headline/synthesis/stats. Pinning the basis keeps it full-height and lets
   the panel scroll instead. */
.hero{position:relative;flex:none;background:radial-gradient(900px 420px at 88% -8%, #FDEBC4 0%, rgba(253,235,196,0) 60%), #FBF6EC;border-bottom:1px solid var(--line);overflow:hidden;}
.hero-in{position:relative;max-width:1140px;margin:0 auto;padding:48px 40px 40px;}
.hero-eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--honey-link);margin-bottom:18px;display:flex;align-items:center;gap:12px;}
.hero-eyebrow::before{content:"";width:22px;height:1px;background:var(--honey-link);display:inline-block;}
.hero h1{font-size:46px;font-weight:600;letter-spacing:-.03em;line-height:1.08;max-width:18ch;text-wrap:balance;}
.hero h1 .hl{color:var(--honey-link);}
.hero p{font-size:18px;color:var(--ink2);max-width:62ch;margin-top:18px;text-wrap:pretty;line-height:1.5;}
.herostats{display:flex;gap:40px;margin-top:34px;flex-wrap:wrap;}
.herostat{min-width:140px;}
.herostat .n{font-size:52px;font-weight:600;letter-spacing:-.04em;line-height:.95;color:var(--honey-link);}
.herostat .l{font-size:14px;font-weight:600;margin-top:8px;letter-spacing:-.01em;}
.herostat .s{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:3px;}

/* vitals */
.vitals{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.stat{background:var(--cream-card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 8px 22px rgba(62,38,28,.05);}
.stat .v{font-size:30px;font-weight:600;letter-spacing:-.035em;line-height:1;color:var(--honey-link);}
.stat .l{font-size:13.5px;font-weight:500;margin-top:10px;letter-spacing:-.01em;}
.stat .s{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:4px;}

/* summary band (overview) */
.summary{display:grid;grid-template-columns:1.4fr 1fr 1.3fr;gap:16px;margin-top:24px;}
.sev-cells{display:flex;gap:10px;}
.sev-cell{flex:1;text-align:center;background:var(--cream);border:1px solid var(--line);border-radius:11px;padding:13px 6px;}
.sev-n{font-size:28px;font-weight:600;letter-spacing:-.035em;line-height:1;color:var(--honey-link);}
.sevbar{display:flex;height:8px;border-radius:5px;overflow:hidden;margin-top:15px;}
.lens-row{display:flex;align-items:center;gap:10px;font-size:13px;}
.swatch{width:8px;height:8px;border-radius:2px;flex:none;}
.synth{background:var(--espresso);color:#F3E8DA;border-radius:16px;padding:18px 20px;box-shadow:0 8px 22px rgba(62,38,28,.16);}
.synth .meta{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--honey);margin-top:14px;border-top:1px solid rgba(243,232,218,.18);padding-top:12px;}
.chips{display:flex;gap:9px;flex-wrap:wrap;}
.chip{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;background:var(--cream);border:1px solid var(--line);border-radius:7px;padding:3px 9px;}
.lang{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;border-radius:8px;padding:5px 11px;border:1px solid;display:inline-flex;gap:8px;align-items:center;}
.lang .dot2{width:8px;height:8px;border-radius:3px;flex:none;}
.lang b{color:var(--honey-link);}

/* tables (evidence) */
.tbl-wrap{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--cream-card);}
table{width:100%;border-collapse:collapse;font-size:13px;}
thead th{text-align:left;font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:500;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--cream);}
tbody td{padding:11px 16px;border-bottom:1px solid var(--line);color:var(--ink2);}
tbody tr:last-child td{border-bottom:none;}
td.path{font-family:'Geist Mono',ui-monospace,monospace;color:var(--honey-link);word-break:break-all;}
td.numc{font-family:'Geist Mono',ui-monospace,monospace;text-align:right;color:var(--honey-link);white-space:nowrap;}
.tagx{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;border-radius:5px;padding:2px 8px;}
.trunc{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;color:var(--muted);margin-top:14px;}

/* toolbar (findings) */
.toolbar{flex:none;padding:14px 28px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--line);flex-wrap:wrap;}
.pills{display:flex;gap:7px;flex-wrap:wrap;}
.pill{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;border:1px solid var(--line);background:var(--cream-card);color:var(--espresso);border-radius:9px;padding:6px 13px;cursor:pointer;transition:all .15s;}
.pill:hover{border-color:#3E261C;}
.pill.active{background:var(--espresso);color:#fff;border-color:var(--espresso);}

/* two-pane (findings) */
.panes{flex:1;display:grid;grid-template-columns:1.15fr 1fr;min-height:0;}
.pane-list{overflow:auto;border-right:1px solid var(--line);padding:18px 24px 40px;}
.pane-detail{overflow:auto;padding:26px 30px 52px;background:var(--cream-card);}
.list{display:flex;flex-direction:column;gap:10px;}
.fcard{background:var(--cream-card);border:1px solid var(--line);border-radius:13px;padding:15px 17px;cursor:pointer;transition:all .14s;}
.fcard:hover{border-color:#3E261C;}
.fcard.sel{background:#FBF3E2;border-color:#3E261C;box-shadow:0 8px 22px rgba(62,38,28,.12);}
.frow{display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap;}
.badge{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:#fff;border-radius:5px;padding:2px 7px;}
.fid{font-size:10.5px;font-weight:600;letter-spacing:.04em;color:var(--espresso);background:#F3EEE4;border:1px solid var(--line);border-radius:5px;padding:1px 6px;}
.udtag{font-family:'Geist Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:#fff;background:#9A6A0E;border-radius:5px;padding:2px 6px;}
.fclaim{font-weight:600;font-size:15px;letter-spacing:-.01em;line-height:1.32;margin-bottom:10px;text-wrap:pretty;}
.dtitle{font-size:24px;letter-spacing:-.025em;font-weight:600;line-height:1.18;margin-bottom:10px;text-wrap:pretty;}
.ddetail{font-size:15px;color:var(--ink2);margin-bottom:22px;text-wrap:pretty;line-height:1.55;}
.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px;}
.score{background:var(--cream);border:1px solid var(--line);border-radius:12px;padding:14px 15px;}
.score .v{font-size:26px;font-weight:600;letter-spacing:-.035em;margin-top:5px;color:var(--honey-link);}
.deyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--honey-link);font-weight:500;margin-bottom:11px;}
.evidence{background:var(--espresso);border-radius:13px;padding:15px 17px;margin-bottom:24px;}
.evrow{display:flex;gap:10px;padding:5px 0;font-family:'Geist Mono',ui-monospace,monospace;font-size:12.5px;color:#E7D8C8;align-items:baseline;}
.bizimpact{font-size:14.5px;color:var(--ink2);background:var(--cream);border:1px solid var(--line);border-left:3px solid var(--honey);border-radius:11px;padding:14px 16px;margin-bottom:24px;line-height:1.55;}
.rep-brief{margin:0 0 8px;background:var(--cream-card);border:1px solid var(--line);border-left:3px solid var(--honey);border-radius:13px;padding:14px 16px;}
.rep-brief summary{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--honey-link);cursor:pointer;list-style:none;}
.rep-brief summary::-webkit-details-marker{display:none;}
.rep-brief summary::before{content:"▸ ";color:var(--honey-link);}
.rep-brief[open] summary::before{content:"▾ ";}
.rep-brief p{font-size:14px;color:var(--ink2);line-height:1.6;margin-top:11px;white-space:pre-wrap;overflow-wrap:anywhere;}
.rep-gaps{margin:0 0 8px;background:var(--cream-card);border:1px solid var(--line);border-left:3px solid #4C6F91;border-radius:13px;padding:14px 16px;}
.rep-gaps summary{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#4C6F91;cursor:pointer;list-style:none;}
.rep-gaps summary::-webkit-details-marker{display:none;}
.rep-gaps summary::before{content:"▸ ";color:#4C6F91;}
.rep-gaps[open] summary::before{content:"▾ ";}
.rep-gaps ul{margin:11px 0 0;padding-left:18px;}
.rep-gaps li{font-size:14px;color:var(--ink2);line-height:1.55;margin:0 0 12px;overflow-wrap:anywhere;}
.rep-gaps li b{color:var(--ink);}
.rep-gaps .gap-why{color:var(--muted);font-size:13px;margin-top:2px;}
.rep-gaps .gap-next{font-size:13px;margin-top:3px;}
.rep-gaps .gap-next span{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#4C6F91;}
.rep-ab{margin:0 0 8px;background:var(--cream-card);border:1px solid var(--line);border-left:3px solid var(--honey);border-radius:13px;padding:14px 16px;}
.rep-ab summary{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--honey-link);cursor:pointer;list-style:none;}
.rep-ab summary::-webkit-details-marker{display:none;}
.rep-ab summary::before{content:"▸ ";color:var(--honey-link);}
.rep-ab[open] summary::before{content:"▾ ";}
.rep-ab ul{margin:11px 0 0;padding-left:18px;}
.rep-ab li{font-size:14px;color:var(--ink2);line-height:1.55;margin:0 0 8px;overflow-wrap:anywhere;}
.rep-ab .ab-tag{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:6px;margin-right:6px;}
.rep-ab .ab-supported{background:#F7E8E5;color:#9D4B3E;}
.rep-ab .ab-refuted{background:#EAF2E8;color:#5C7F67;}
.rep-ab .ab-via{color:var(--muted);font-size:12.5px;}
.remwrap{border:1px solid var(--line);border-radius:13px;overflow:hidden;}
.remrow{display:grid;grid-template-columns:120px 1fr;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line);align-items:baseline;}
.remfoot{display:flex;align-items:center;gap:10px;padding:13px 16px;background:var(--cream);}
.empty{padding:60px 24px;text-align:center;color:var(--muted);font-size:14px;}

/* deep-link highlight: a block arrived at via report.html#anchor-id gets a brief outline so the reader can
   see WHICH block the citation meant. Transient (2.6s) and outline-only, so it never shifts layout. */
.anchor-hit{outline:2px solid #FEC240;outline-offset:2px;transition:outline-color .4s ease;}

/* findings view selector (split / list / board) */
.viewsel{display:flex;gap:2px;background:var(--cream);border:1px solid var(--line);border-radius:9px;padding:2px;}
.vbtn{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;border:none;background:transparent;color:var(--muted);border-radius:7px;padding:5px 12px;cursor:pointer;transition:all .14s;}
.vbtn:hover{color:var(--espresso);}
.vbtn.active{background:var(--espresso);color:#fff;}
.fview{flex:1;min-height:0;overflow:auto;}

/* findings — list view (dense full-width rows) */
.listwrap{max-width:1000px;margin:0 auto;padding:20px 28px 50px;}
.lmetahdr{font-size:11px;color:var(--muted);margin-bottom:14px;}
.llist{display:flex;flex-direction:column;gap:8px;}
.lrow{display:grid;grid-template-columns:92px 1fr auto 60px;gap:18px;align-items:center;background:var(--cream-card);border:1px solid var(--line);border-radius:11px;padding:13px 18px;cursor:pointer;transition:all .14s;}
.lrow:hover{border-color:#3E261C;}
.lsev{font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.07em;text-transform:uppercase;font-weight:600;}
.lmid{min-width:0;}
.lclaim{font-weight:600;font-size:14px;letter-spacing:-.01em;line-height:1.3;text-wrap:pretty;}
.lmeta{display:flex;align-items:center;gap:7px;margin-top:5px;}
.lmeta .mono{font-size:10.5px;color:var(--muted);}
.leff{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);text-align:right;white-space:nowrap;}
.limpact{font-size:24px;font-weight:600;letter-spacing:-.035em;line-height:1;color:var(--honey-link);text-align:right;}

/* findings — board view (severity columns) */
.board{padding:20px 24px 50px;display:grid;gap:14px;align-items:start;}
.bcol{min-width:0;}
.bcolhd{display:flex;align-items:center;gap:8px;margin-bottom:13px;padding-bottom:10px;}
.bcolhd .lbl{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;}
.bcoln{font-family:'Geist Mono',ui-monospace,monospace;margin-left:auto;color:var(--honey-link);font-weight:600;font-size:15px;}
.bcards{display:flex;flex-direction:column;gap:9px;}
.bcard{background:var(--cream-card);border:1px solid var(--line);border-radius:11px;padding:12px 13px;cursor:pointer;transition:all .14s;}
.bcard:hover{border-color:#3E261C;}
.bcardtop{display:flex;align-items:flex-start;gap:10px;}
.bclaim{font-weight:600;font-size:13px;line-height:1.32;flex:1;text-wrap:pretty;}
.bimpact{font-size:20px;font-weight:600;letter-spacing:-.03em;color:var(--honey-link);line-height:1;flex:none;}
.bmeta{display:flex;align-items:center;gap:6px;margin-top:9px;}
.bmeta .mono{font-size:10px;color:var(--muted);}

@media (max-width:900px){
  .vitals{grid-template-columns:repeat(2,1fr);}
  .summary{grid-template-columns:1fr;}
  .panes{grid-template-columns:1fr;}
  .pane-list{border-right:none;border-bottom:1px solid var(--line);}
  .board{grid-template-columns:1fr !important;}
  .hero h1{font-size:31px;}
  .hero p{font-size:16px;}
  .herostats{gap:26px;}
  .herostat .n{font-size:40px;}
}
`;

// ---- client runtime -------------------------------------------------------
// IMPORTANT: assembled into a TS backtick template below, so this string must
// contain no backticks and no "${" — DOM is built with string concatenation.

const RUNTIME = String.raw`
(function(){
  var D = window.__ACCEL_DATA__;

  // When the report is iframed inside the console, hide its own topbar so the
  // console's contextual topbar (with its Export action) is the single chrome —
  // avoids the duplicate header + duplicate Export button. Standalone / published
  // (/share) reports are top-level documents and keep their header + Export.
  (function(){
    var framed = true;
    try { framed = (window.self !== window.top); } catch (e) { framed = true; } // cross-origin frame ⇒ treat as framed
    if (framed) { var tb = document.getElementById('repTopbar'); if (tb) tb.style.display = 'none'; }
  })();
  var SORTS = ['impact','quickwin','severity'];
  var SORTLABEL = { impact:'impact', quickwin:'impact × effort', severity:'severity' };
  var SEVRANK = { critical:0, high:1, medium:2, low:3, info:4 };
  var VIEWS = ['split','list','board'];
  var VIEWLABEL = { split:'Split', list:'List', board:'Board' };
  var SEVLABEL = { critical:'Critical', high:'High', medium:'Medium', low:'Low', info:'Info' };
  var state = { tab:'overview', lens:'all', sort:'impact', view:'split', selId: (D.findings[0] || {}).id || null, selAnchor: null };

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function effRank(f){ return f.effortRank || 4; }
  // UserDerived badge — finding from a dimension minted from the user's brief.
  function ud(f){ return f.userDerived ? '<span class="udtag" title="Investigated because you raised it in your brief">brief</span>' : ''; }
  // A confirmed card shows its run-wide F-id; a ruled-out card shows the shared "Ruled out" status chip
  // instead (it has no F-id). A report stored before display ids has neither field and renders exactly as before.
  function fid(f){
    if (f.displayId) return '<span class="fid mono">' + esc(f.displayId) + '</span>';
    return f.status === 'ruled-out' ? '<span class="st st-ruled-out">Ruled out</span>' : '';
  }
  // An evidence ref the serve-time link pass resolved carries a GitHub permalink (https://github.com/… only —
  // anything else is rendered as text, so a tampered data blob cannot smuggle in another scheme).
  function evref(e){
    var h = String(e.href || '');
    if (/^https:\/\/github\.com\/[^"<>\s]+$/.test(h)) return '<a class="accel-ev-link" href="' + esc(h) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-underline-offset:2px">' + esc(e.ref) + '</a>';
    return esc(e.ref);
  }

  function visible(){
    // Execution report: a ruled-out row is not work — it lives in the Appendix, not the Findings pane.
    var arr = D.findings.filter(function(f){ return (state.lens === 'all' || f.lensKey === state.lens) && !(D.mode === 'execution' && f.ruledOut); }).slice();
    if (state.sort === 'impact') arr.sort(function(a,b){ return b.impact - a.impact; });
    else if (state.sort === 'quickwin') arr.sort(function(a,b){ return (b.impact/effRank(b)) - (a.impact/effRank(a)); });
    else arr.sort(function(a,b){ return SEVRANK[a.severity] - SEVRANK[b.severity]; });
    return arr;
  }
  function selected(){
    var all = D.findings;
    // ANCHOR FIRST: Finding.id is not unique, so selecting by id alone reveals the FIRST finding with that
    // id — which would make a citation to the second one point the reader at the wrong evidence. Same defect
    // class as the by-id anchor map this PR already fixed; it reappeared here in the selection state.
    if (state.selAnchor) { for (var a=0;a<all.length;a++) if (all[a].anchorId === state.selAnchor) return all[a]; }
    for (var i=0;i<all.length;i++) if (all[i].id === state.selId) return all[i];
    var vis = visible();
    return vis[0] || all[0] || null;
  }

  function setTab(t){
    state.tab = t;
    var tabs = document.querySelectorAll('.tab');
    for (var i=0;i<tabs.length;i++) tabs[i].className = 'tab' + (tabs[i].getAttribute('data-tab')===t ? ' active' : '');
    var panels = document.querySelectorAll('.panel');
    for (var j=0;j<panels.length;j++) panels[j].className = 'panel' + (panels[j].getAttribute('data-panel')===t ? ' active' : '');
  }

  function renderToolbar(){
    var pills = D.lensFilters.map(function(f){
      var on = state.lens === f.key ? ' active' : '';
      return '<button class="pill' + on + '" data-act="lens" data-lens="' + esc(f.key) + '">' + esc(f.label) + '</button>';
    }).join('');
    document.getElementById('pills').innerHTML = pills;
    var views = VIEWS.map(function(v){
      var on = state.view === v ? ' active' : '';
      return '<button class="vbtn' + on + '" data-act="view" data-view="' + v + '">' + esc(VIEWLABEL[v]) + '</button>';
    }).join('');
    document.getElementById('viewsel').innerHTML = views;
    document.getElementById('sortbtn').textContent = SORTLABEL[state.sort];
  }

  function fcard(f){
    var on = f.id === state.selId ? ' sel' : '';
    return '<div class="fcard' + on + '" data-act="select" data-id="' + esc(f.id) + '" data-anchor-id="' + esc(f.anchorId) + '" style="border-left:3px solid ' + f.sevColor + '">' +
      '<div class="frow">' +
        fid(f) +
        '<span class="badge" style="background:' + f.sevColor + '">' + esc(f.severity) + '</span>' +
        ud(f) +
        '' + /* internal id (H#) + metric-code tag intentionally hidden — business-first report */
        '<span style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink2)"><span class="swatch" style="background:' + f.lensColor + '"></span>' + esc(f.lensLabel) + '</span>' +
      '</div>' +
      '<div class="fclaim">' + esc(f.claim) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span class="chip">impact <b>' + f.impact.toFixed(1) + '</b></span>' +
        '<span class="chip">' + esc(f.effortLabel) + '</span>' +
        (f.evidenceShort ? '<span class="mono" style="font-size:11px;color:var(--muted);margin-left:auto">' + esc(f.evidenceShort) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function renderList(){
    var vis = visible();
    document.getElementById('listmeta').textContent = vis.length + ' findings · ranked by ' + SORTLABEL[state.sort];
    document.getElementById('list').innerHTML = vis.length ? vis.map(fcard).join('') : '<div class="empty">No findings in this lens.</div>';
  }

  function renderDetail(){
    var f = selected();
    var host = document.getElementById('detail');
    if (!f){ host.innerHTML = '<div class="empty">No findings for this target.</div>'; return; }
    var ev = (f.evidence || []).map(function(e){
      return '<div class="evrow"><span style="color:var(--honey);flex:none">&rarr;</span>' +
        '<span style="word-break:break-all">' + evref(e) + (e.detail ? ' <span style="color:#B9A38C">— ' + esc(e.detail) + '</span>' : '') + '</span></div>';
    }).join('') || '<div class="evrow"><span style="color:#B9A38C">no evidence pointers</span></div>';
    var rem = (f.remediation || []).map(function(r){
      return '<div class="remrow"><span class="mono" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">' + esc(r.k) + '</span>' +
        '<span style="font-size:14px;color:var(--espresso)">' + esc(r.v) + '</span></div>';
    }).join('');
    host.innerHTML =
      '<div class="frow" style="margin-bottom:14px">' +
        fid(f) +
        '<span class="badge" style="background:' + f.sevColor + '">' + esc(f.severity) + '</span>' +
        ud(f) +
        '' + /* internal id (H#) hidden — business-first report */
        '<span style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2)"><span class="swatch" style="background:' + f.lensColor + '"></span>' + esc(f.lensLabel) + '</span>' +
        '<span class="mono" style="margin-left:auto;font-size:11.5px;color:var(--honey-link)">conf ' + esc(f.confidence) + ' · verified ✓</span>' +
      '</div>' +
      '<h2 class="dtitle">' + esc(f.claim) + '</h2>' +
      '<p class="ddetail">' + esc(f.detail) + '</p>' +
      '<div class="scores">' +
        '<div class="score"><div class="eyebrow">Impact</div><div class="v">' + f.impact.toFixed(1) + '<span style="font-size:14px;color:var(--muted)">/10</span></div></div>' +
        '<div class="score"><div class="eyebrow">Effort</div><div class="v">' + esc(f.effortLabel) + '</div></div>' +
        '<div class="score"><div class="eyebrow">Evidence</div><div class="v">' + (f.evidence ? f.evidence.length : 0) + '<span style="font-size:14px;color:var(--muted)"> refs</span></div></div>' +
      '</div>' +
      '<div class="deyebrow">Evidence · resolvable</div>' +
      '<div class="evidence">' + ev + '</div>' +
      '<div class="deyebrow">Business impact</div>' +
      '<p class="bizimpact">' + esc(f.business) + '</p>' +
      (D.mode === 'execution' && f.status !== 'ruled-out' ? execBlocks(f) : '') +
      // A ruled-out row is not work — no "agent-runnable remediation task" and no Copy task button.
      (f.status === 'ruled-out'
        ? '<div class="deyebrow">No action</div><p class="bizimpact">Checked and ruled out — listed for completeness, not a remediation item.</p>'
        : '<div class="deyebrow">Remediation task · agent-runnable</div>' +
      '<div class="remwrap">' + rem +
        '<div class="remfoot"><span class="mono" style="font-size:11.5px;color:var(--muted)">' + esc(f.lensLabel) + ' · impact ' + f.impact.toFixed(1) + ' · ' + esc(f.effortLabel) + '</span>' +
        '<button class="btn mono" style="margin-left:auto;font-size:12px;padding:8px 14px" data-act="copy" data-id="' + esc(f.id) + '">Copy task &rarr;</button></div>' +
      '</div>');
  }

  // Execution report: the two blocks that make a finding closable — the check that says it is done, and how to re-run it.
  function execBlocks(f){
    var out = '';
    if (f.group) out = '<div class="mono" style="font-size:11px;color:var(--muted);margin:-12px 0 18px">Theme · ' + esc(f.group) + (f.since ? ' · ' + esc(f.since.status === 'new' ? 'new since last scan' : f.since.status === 'changed' ? 'changed since last scan' : 'persisting since ' + (f.since.since || 'last scan')) : '') + '</div>' + out;
    if (f.carried) out += '<div class="mono" style="font-size:11px;color:var(--muted);margin:-8px 0 14px">' + esc(f.carried) + '</div>';
    if (f.crossProject) out += '<div class="mono" style="font-size:11px;color:#2F4F7A;margin:-8px 0 14px">Across projects · inconsistent with project ' + esc(f.crossProject) + '</div>';
    if (f.measuredOn) out += '<div class="mono" style="font-size:11px;color:var(--muted);margin:-8px 0 14px">measured ' + esc(f.measuredOn) + ' · carried from the previous scan (the code it measured did not change)</div>';
    out += '<div class="deyebrow">Done when</div>' +
      '<div class="exec-block">' + (f.acceptance ? esc(f.acceptance) : 'No measured check was recorded — re-run the evidence above and confirm the problem is gone.') + (f.measured ? '<div class="mono" style="font-size:11.5px;color:var(--muted);margin-top:6px">measured now: ' + esc(f.measured) + '</div>' : '') + '</div>';
    if (f.verify) out += '<div class="deyebrow">How to verify</div>' + (f.verifyKind === 'query' ? '<pre class="exec-code">' + esc(f.verify) + '</pre>' : '<div class="exec-block">' + esc(f.verify) + '</div>');
    return out;
  }

  // ---- list view (dense full-width rows) ----
  function lrow(f){
    return '<div class="lrow" data-act="open" data-id="' + esc(f.id) + '" data-anchor-id="' + esc(f.anchorId) + '" style="border-left:3px solid ' + f.sevColor + '">' +
      '<span class="lsev" style="color:' + f.sevColor + '">' + esc(f.severity) + '</span>' +
      '<div class="lmid">' + (fid(f) ? '<div style="margin-bottom:4px">' + fid(f) + '</div>' : '') +
        '<div class="lclaim">' + esc(f.claim) + '</div>' +
        '<div class="lmeta"><span class="swatch" style="background:' + f.lensColor + '"></span><span class="mono">' + esc(f.lensLabel) + ' · ' + esc(f.effortLabel) + '</span>' + ud(f) + '</div>' +
      '</div>' +
      '<span class="leff">impact</span>' +
      '<span class="limpact">' + f.impact.toFixed(1) + '</span>' +
    '</div>';
  }
  function listViewHtml(){
    var vis = visible();
    if (!vis.length) return '<div class="empty">No findings in this lens.</div>';
    return '<div class="listwrap">' +
      '<div class="mono lmetahdr">' + vis.length + ' findings · ranked by ' + SORTLABEL[state.sort] + '</div>' +
      '<div class="llist">' + vis.map(lrow).join('') + '</div>' +
    '</div>';
  }

  // ---- board view (one column per severity present) ----
  function bcard(f){
    return '<div class="bcard" data-act="open" data-id="' + esc(f.id) + '" data-anchor-id="' + esc(f.anchorId) + '">' +
      '<div class="bcardtop"><div class="bclaim">' + esc(f.claim) + '</div><div class="bimpact">' + f.impact.toFixed(1) + '</div></div>' +
      '<div class="bmeta">' + fid(f) + '<span class="swatch" style="background:' + f.lensColor + '"></span><span class="mono">' + esc(f.effortLabel) + ' · ' + esc(f.lensLabel) + '</span>' + ud(f) + '</div>' +
    '</div>';
  }
  function boardViewHtml(){
    var vis = visible();
    if (!vis.length) return '<div class="empty">No findings in this lens.</div>';
    var order = ['critical','high','medium','low','info'];
    var cols = order.filter(function(sv){ return vis.some(function(f){ return f.severity === sv; }); });
    var html = cols.map(function(sv){
      var items = vis.filter(function(f){ return f.severity === sv; });
      var color = items[0].sevColor;
      return '<div class="bcol">' +
        '<div class="bcolhd" style="border-bottom:2px solid ' + color + '"><span class="lbl" style="color:' + color + '">' + esc(SEVLABEL[sv] || sv) + '</span><span class="bcoln">' + items.length + '</span></div>' +
        '<div class="bcards">' + items.map(bcard).join('') + '</div>' +
      '</div>';
    }).join('');
    return '<div class="board" style="grid-template-columns:repeat(' + cols.length + ',1fr)">' + html + '</div>';
  }

  // ---- mount the active view into the findings body ----
  function mountView(){
    var body = document.getElementById('findings-body');
    if (state.view === 'split'){
      body.className = 'panes';
      body.innerHTML =
        '<div class="pane-list scrolly">' +
          '<div class="mono" id="listmeta" style="font-size:11px;color:var(--muted);margin-bottom:12px"></div>' +
          '<div class="list" id="list"></div>' +
        '</div>' +
        '<div class="pane-detail scrolly" id="detail"></div>';
      renderList();
      renderDetail();
    } else if (state.view === 'list'){
      body.className = 'fview scrolly';
      body.innerHTML = listViewHtml();
    } else {
      body.className = 'fview scrolly';
      body.innerHTML = boardViewHtml();
    }
  }

  function renderFindings(){ renderToolbar(); mountView(); }

  function copyTask(f){
    var lines = ['# ' + f.claim, '', f.detail, '', 'Evidence:'];
    (f.evidence||[]).forEach(function(e){ lines.push('- ' + e.ref + (e.detail ? ' - ' + e.detail : '')); });
    lines.push('', 'Business impact: ' + f.business, '');
    (f.remediation||[]).forEach(function(r){ lines.push(r.k + ': ' + r.v); });
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
  }

  // Export is handled by window.__theresaExportRemediation (defined from the shared
  // REMEDIATION_EXPORT_JS in its own <script>), so the exact same builder backs the
  // report's own button AND the server's serve-time retrofit for already-stored reports.

  document.addEventListener('click', function(ev){
    var t = ev.target;
    while (t && t !== document.body && !t.getAttribute('data-act')) t = t.parentNode;
    if (!t || t === document.body) return;
    var act = t.getAttribute('data-act');
    if (act === 'tab'){ setTab(t.getAttribute('data-tab')); }
    else if (act === 'lens'){ state.lens = t.getAttribute('data-lens'); renderFindings(); }
    else if (act === 'sort'){ state.sort = SORTS[(SORTS.indexOf(state.sort)+1) % SORTS.length]; renderFindings(); }
    else if (act === 'view'){ state.view = t.getAttribute('data-view'); renderFindings(); }
    // NOTE both handlers also set selAnchor from the clicked card: selected() resolves selAnchor FIRST, so
    // leaving a citation's anchor in place would pin the detail pane to the cited finding for the rest of the
    // session no matter what the reader clicked. Every card carries its own anchor, so setting it here both
    // clears the override and keeps duplicate-id findings selectable.
    else if (act === 'select'){ state.selId = t.getAttribute('data-id'); state.selAnchor = t.getAttribute('data-anchor-id'); renderToolbar(); renderList(); renderDetail(); }
    else if (act === 'open'){ state.selId = t.getAttribute('data-id'); state.selAnchor = t.getAttribute('data-anchor-id'); state.view = 'split'; renderFindings(); }
    else if (act === 'gotofindings'){ setTab('findings'); }
    // Execution Work plan → open that finding in the Findings pane (split view, selected, scrolled).
    else if (act === 'gotofinding'){ ev.preventDefault(); state.selAnchor = t.getAttribute('data-goto-anchor'); state.selId = null; state.lens = 'all'; state.view = 'split'; setTab('findings'); renderFindings(); var fs = selected(); if (fs) state.selId = fs.id; }
    else if (act === 'copy'){ var id=t.getAttribute('data-id'); var f=null,a=D.findings; for(var i=0;i<a.length;i++) if(a[i].id===id) f=a[i]; if(f){ copyTask(f); t.textContent='Copied ✓'; setTimeout(function(){ t.innerHTML='Copy task &rarr;'; }, 1400); } }
    else if (act === 'export'){ if (window.__theresaExportRemediation) window.__theresaExportRemediation(); }
  });

  if (!D.showEvidence) { var et = document.querySelector('.tab[data-tab="evidence"]'); if (et) et.style.display = 'none'; }
  // ---- cross-report anchor resolution (the ref half) --------------------------------------
  // A citation in the leadership brief points at report.html#anchor-id. Those ids live on
  // data-anchor-id, NOT on a plain id attribute, because each finding is rendered by THREE client-side views
  // (split / list / board) and only one is mounted at a time — an id attribute would either duplicate or not
  // exist yet when the browser tried to jump. So we resolve it ourselves: reveal the finding first
  // (switch to the Findings tab, clear the lens filter, select it), THEN scroll to whatever block now
  // carries the anchor. Scaffold anchors (table-*, chart-*) need no reveal and fall through to the scroll.
  // panelOf(): which tab owns the element carrying this anchor. A scaffold anchor can live under Evidence
  // (table-hotspots) or Overview while another tab is active, and scrollIntoView CANNOT expose an element
  // inside a hidden .panel — so the panel has to be activated first, for scaffold anchors as well as findings.
  function panelOf(el){
    for (var n = el; n && n !== document.body; n = n.parentNode) {
      if (n.getAttribute && n.getAttribute("data-panel")) return n.getAttribute("data-panel");
    }
    return null;
  }
  function gotoAnchor(){
    var h = (location.hash || "").replace(/^#/, "");
    if (!h || !/^[A-Za-z0-9_-]+$/.test(h)) return;
    var hit = null;
    for (var i=0;i<(D.findings||[]).length;i++) if (D.findings[i].anchorId === h) { hit = D.findings[i]; break; }
    if (hit) {
      // clear the lens filter so a finding filtered out of the current view is still revealed, and select by
      // ANCHOR so a duplicate id cannot resolve to the wrong finding.
      state.lens = "all"; state.selId = hit.id; state.selAnchor = hit.anchorId;
      setTab("findings"); renderFindings();
    }
    setTimeout(function(){
      var el = document.querySelector('[data-anchor-id="' + h + '"]');
      if (!el) return;
      var panel = panelOf(el);
      if (panel && panel !== state.tab) { setTab(panel); if (panel === "findings") renderFindings(); }
      setTimeout(function(){
        var target = document.querySelector('[data-anchor-id="' + h + '"]') || el;
        if (target.scrollIntoView) target.scrollIntoView({ block: "center" });
        target.className = target.className + " anchor-hit";
        setTimeout(function(){ target.className = target.className.replace(/\s*anchor-hit/g, ""); }, 2600);
      }, 0);
    }, 0);
  }
  window.addEventListener("hashchange", gotoAnchor);

  renderFindings();
  setTab('overview');
  // AFTER the default tab is set: gotoAnchor used to run before this line, so setTab("overview") hid the
  // panel it had just revealed and every full-navigation citation landed on the overview with its target
  // invisible — i.e. the feature did not work at all on the path that matters most, a fresh page load.
  gotoAnchor();
})();
`;

// The ONE REMEDIATION.md builder now lives in remediationMd.ts, shared verbatim by the report's
// own Export (REMEDIATION_EXPORT_JS below, which also rides the serve-time retrofit) and the console's run-page export
// (serverUi.ts). Re-exported here so existing importers of reportHtml.ts keep one import site.
export { REMEDIATION_MD_JS };

// Client-side REMEDIATION.md export, shared by the report's own runtime (so a
// standalone/downloaded file exports offline) AND the server's serve-time retrofit
// for already-stored reports whose frozen JS still binds Export to window.print().
// It defines window.__theresaExportRemediation, reading window.__ACCEL_DATA__ (not a
// closure var, so it works when injected into a frozen document). Plain ES5; embedded
// verbatim into a <script>, so it must contain no backticks, no ${…}, no </script>.
// It carries REMEDIATION_MD_JS (the builder) with it, so the serve-time retrofit brings the ruled-out filter too.
export const REMEDIATION_EXPORT_JS = REMEDIATION_MD_JS + String.raw`
window.__theresaExportRemediation = function(){
  var D = window.__ACCEL_DATA__ || {};
  var target = D.target ? String(D.target) : 'diagnosis';
  var base = target.split(/[\\/]/).pop() || 'diagnosis';
  var md = remediationMarkdown({ title: target, findings: D.findings || [], after: ' · accel-scope diagnostic' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = base + '-REMEDIATION.md';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
};
`;

// ---- document assembly ----------------------------------------------------

// `costUsd`: the run's own total spend, rendered in the header. Omitted/null ⇒ no cost is shown (never a
// fabricated "$0"); a caller without it may also carry `metrics.summary.costUsd`.
export function renderFindingsHtml(result: MinerResult, stamp: string, embedded = false, brief?: string, costUsd?: number | null): string {
  const vm = buildViewModel(result, stamp, costUsd);
  if (vm.mode === 'execution') return renderExecutionHtml(vm, result, brief);
  const dataJson = JSON.stringify(vm).replace(/</g, '\\u003c');
  const targetName = baseName(vm.target) || vm.target;
  // The user's brief (their NL request) — its own block in the overview, never the title.
  // BRIEF_LONG is the shared "is this brief long" threshold (matches the run detail's clamp cutoff).
  const BRIEF_LONG = 240;
  const briefText = String(brief ?? '').trim();
  const briefBlock = briefText
    ? `<details class="rep-brief"${briefText.length <= BRIEF_LONG ? ' open' : ''}><summary>Your brief · what you asked us to focus on</summary><p>${escapeHtml(briefText)}</p></details>`
    : '';

  // Coverage gaps — applicable concerns we could NOT settle into a finding (no resolved evidence). These
  // are kept SEPARATE from findings (the evidence gate) and surfaced honestly as the answer-back's "could
  // not settle X; next test = N", so an unmeasured concern is reported, not dropped or faked.
  const gaps = result.coverageGaps ?? [];
  const gapsBlock = gaps.length
    ? `<details class="rep-gaps"${gaps.length <= 5 ? ' open' : ''}><summary>Open questions · ${gaps.length} concern(s) we could not settle — and the next decisive test</summary><ul>${gaps.map((g) => `<li>${statusChipHtml(statusFromVerdict(g.status))} <b>${escapeHtml(g.concern)}</b><div class="gap-why">${escapeHtml(g.whyUnsettled)}</div><div class="gap-next"><span>Next decisive test:</span> ${escapeHtml(g.nextDecisiveTest)}</div></li>`).join('')}</ul></details>`
    : '';

  // Evals to run (recsys) — Layer 1: the recsys-mle bundle proposes structured, runnable evals (metric ·
  // what · why · how) for hypotheses it could not fully settle. Surfaced verbatim (value-free) so the user
  // can RUN them and feed the datapoint back. Populated only for the recsys bundle; empty ⇒ block omitted.
  const evals = result.evalsToRun ?? [];
  const evalsBlock = evals.length
    ? `<details class="rep-gaps"${evals.length <= 5 ? ' open' : ''}><summary>Evals to run (recsys) · ${evals.length} proposed measurement(s) to settle the open recsys questions</summary><ul>${evals.map((e) => `<li><b>${escapeHtml(e.proposal.metric)}</b> — ${escapeHtml(e.proposal.what)}<div class="gap-why">${escapeHtml(e.proposal.why)}</div><div class="gap-next"><span>How:</span> ${escapeHtml(e.proposal.how)}</div></li>`).join('')}</ul></details>`
    : '';

  // The answer-back and open-question rows wear the shared status chips (Confirmed / Ruled out / Needs a test /
  // Not measurable here), mapped from their stored status by the one pure statusFromVerdict.
  // Answer-back — when a brief was supplied, the SETTLED rows (supported / ruled-out); the
  // unsettled rows are the Open-questions block above. Strict polarity: supported = confirmed defect,
  // refuted = checked-healthy. Rendered deterministically from MinerResult.answerBack.
  const settledRows = (result.answerBack ?? []).filter((r) => r.status !== 'unsettled');
  // Header is "what we found, mapped to your brief" (not "we addressed every brief belief"): until a typed
  // IntentMap + per-belief mapping exists, these are the run's evidenced findings framed against
  // the brief, not a 1:1 belief→finding map.
  const answerBackBlock = briefText && settledRows.length
    ? `<details class="rep-ab" open><summary>What we found, mapped to your brief · ${settledRows.filter((r) => r.status === 'supported').length} confirmed · ${settledRows.filter((r) => r.status === 'refuted').length} ruled out</summary><ul>${settledRows.map((r) => `<li>${statusChipHtml(statusFromVerdict(r.status))} ${escapeHtml(r.concern)}${r.testedVia ? `<span class="ab-via"> · checked via ${escapeHtml(r.testedVia)}</span>` : ''}</li>`).join('')}</ul></details>`
    : '';

  // --- overview pieces ---
  const heroHeadlineHtml = (() => {
    const h = vm.hero.headline;
    const e = vm.hero.emphasis;
    const i = e ? h.indexOf(e) : -1;
    if (i >= 0) return `${escapeHtml(h.slice(0, i))}<span class="hl">${escapeHtml(e)}</span>${escapeHtml(h.slice(i + e.length))}`;
    return escapeHtml(h);
  })();
  const heroStats = vm.hero.stats
    .map((h) => `<div class="herostat"><div class="n">${escapeHtml(h.value)}</div><div class="l">${escapeHtml(h.label)}</div><div class="s">${escapeHtml(h.sub)}</div></div>`)
    .join('');
  const vitalsCards = vm.vitals
    .map((v) => `<div class="stat"><div class="v">${escapeHtml(v.value)}</div><div class="l">${escapeHtml(v.label)}</div><div class="s">${escapeHtml(v.sub)}</div></div>`)
    .join('');
  const sevCells = vm.summary.sev
    .map((c) => `<div class="sev-cell"><div class="sev-n" style="color:${c.color}">${c.n}</div><div class="eyebrow" style="margin-top:6px">${escapeHtml(c.label)}</div></div>`)
    .join('') || '<div class="sev-cell"><div class="sev-n">0</div><div class="eyebrow" style="margin-top:6px">findings</div></div>';
  const sevBar = vm.summary.sevBar.map((b) => `<div style="flex:${b.flex};background:${b.color}"></div>`).join('') || '<div style="flex:1;background:var(--line)"></div>';
  const lensRows = vm.summary.lenses
    .map((l) => `<div class="lens-row"><span class="swatch" style="background:${l.color}"></span><span style="flex:1;color:var(--ink2)">${escapeHtml(l.label)}</span><span class="mono" style="font-size:12.5px;font-weight:500">${l.n}</span></div>`)
    .join('') || '<div class="lens-row" style="color:var(--muted)">no findings</div>';
  const langChips = vm.languages.map((l) => {
    const c = langColor(l.ext);
    return `<span class="lang" style="background:${c}1F;border-color:${c}5C"><span class="dot2" style="background:${c}"></span>${escapeHtml(l.ext)} <b>${l.count}</b></span>`;
  }).join('') || '<span class="chip" style="color:var(--muted)">none detected</span>';
  const languagesSection = vm.languages.length ? `<div class="sechead"><span class="n">02</span><h2>Languages</h2></div><div class="chips">${langChips}</div>` : '';

  // --- evidence tables ---
  const hotspotRows = vm.hotspots.rows
    .map((h) => `<tr><td class="path">${escapeHtml(h.path)}</td><td class="numc">${h.commits}</td><td class="numc">${h.churn}</td><td>${escapeHtml(h.owner)}</td><td class="numc">${escapeHtml(h.share)}</td></tr>`)
    .join('') || '<tr><td colspan="5" style="color:var(--muted)">no hotspots</td></tr>';
  const couplingTable = vm.coupling.total
    ? `<div class="sechead"><span class="n">B</span><h2>Top change-coupling pairs</h2></div>
       <div class="tbl-wrap"><table${anchorAttr('table-coupling')}><thead><tr><th>File A</th><th>File B</th><th style="text-align:right">Co-changes</th><th style="text-align:right">Degree</th><th>Cross-module</th></tr></thead><tbody>${
         vm.coupling.rows.map((c) => `<tr><td class="path">${escapeHtml(c.a)}</td><td class="path">${escapeHtml(c.b)}</td><td class="numc">${c.co}</td><td class="numc">${escapeHtml(c.degree)}</td><td>${c.cross ? '<span class="tagx" style="background:#FBF0EE;color:#C0392B">yes</span>' : '<span class="tagx" style="background:var(--cream);color:var(--muted)">no</span>'}</td></tr>`).join('')
       }</tbody></table></div>${truncNote(vm.coupling.rows.length, vm.coupling.total)}`
    : '';
  const contribRows = vm.contributors.rows
    .map((c) => `<tr><td>${escapeHtml(c.id)}${c.bot ? ' <span class="tagx" style="background:var(--cream);color:var(--muted)">bot</span>' : ''}</td><td class="numc">${c.commits}</td><td class="numc">${escapeHtml(c.share)}</td><td class="numc">${c.aliases}</td></tr>`)
    .join('') || '<tr><td colspan="4" style="color:var(--muted)">no contributors</td></tr>';

  const findingsCountLabel = vm.summary.total ? `<span class="n">${vm.summary.total}</span>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>accel-scope · ${escapeHtml(targetName)} · diagnostic</title>
<style>${CSS}${REPORT_STATUS_CSS}</style>
</head>
<body>

  <!-- Report's own topbar. Always rendered so standalone/published (/share) reports
       keep their header + Export. Hidden at runtime when the report is iframed inside
       the console (which supplies its own topbar + Export) — see repTopbar handling.
       The meta span after the target name carries the repo / commit count only — no contributor count (an open-source
       repo's every git author, e.g. "409 people", read as a team size; it stays in the Appendix vitals, labelled). At
       serve time reportScope.ts replaces this span with the audited repo(s) @ commit. -->
  <header class="topbar" id="repTopbar">
    <div class="topbar-in">
      <span class="bee">${BEE_IMG}</span>
      <div style="display:flex;align-items:baseline;gap:9px">
        <span style="font-weight:600;font-size:15.5px;letter-spacing:-.01em">accel-scope</span>
        <span class="eyebrow">diagnostic report</span>
      </div>
      <div class="tb-sep" style="display:flex;align-items:center;gap:9px">
        <span style="font-weight:600;font-size:14px">${escapeHtml(targetName)}</span>
        <span class="mono" style="font-size:11.5px;color:var(--muted)">${escapeHtml(vm.topbar.commits)}</span>
      </div>
      <div class="tb-right">
        <span style="display:flex;align-items:center;gap:7px" class="mono"><span class="dot"></span><span style="font-size:11.5px;color:var(--muted)">read-only</span></span>
        <span class="mono" style="font-size:11.5px;color:var(--muted)">${escapeHtml([vm.date, vm.topbar.cost].filter(Boolean).join(' · '))}</span>
        <button class="btn" data-act="export">Export REMEDIATION.md</button>
      </div>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-act="tab" data-tab="overview">Overview</button>
    <button class="tab" data-act="tab" data-tab="findings">Findings${findingsCountLabel}</button>
    <button class="tab" data-act="tab" data-tab="evidence">Evidence</button>
  </nav>

  <div class="stage">

    <!-- OVERVIEW -->
    <section class="panel active" data-panel="overview"${anchorAttr('section-overview')}>
      <div class="hero">
        <div class="hero-in">
          <div class="hero-eyebrow">Diagnostic synthesis</div>
          <h1>${heroHeadlineHtml}</h1>
          <p>${escapeHtml(vm.hero.para)}</p>
          <div class="herostats">${heroStats}</div>
        </div>
      </div>
      <div class="doc">
        ${briefBlock}
        ${answerBackBlock}
        ${gapsBlock}
        ${evalsBlock}
        <div class="sechead"><span class="n">01</span><h2>${vm.isOrg ? 'Organization' : 'Repository'} vitals</h2></div>
        <div class="vitals">${vitalsCards}</div>

        <div class="summary">
          <div class="card">
            <div class="eyebrow" style="margin-bottom:13px">${vm.summary.total} confirmed · by severity${vm.summary.ruledOut ? ` · ${vm.summary.ruledOut} ruled out (not counted)` : ''}</div>
            <div class="sev-cells">${sevCells}</div>
            <div class="sevbar">${sevBar}</div>
          </div>
          <div class="card">
            <div class="eyebrow" style="margin-bottom:13px">by lens</div>
            <div style="display:flex;flex-direction:column;gap:9px">${lensRows}</div>
          </div>
          <div class="synth">
            <div class="eyebrow" style="color:var(--honey);margin-bottom:11px">Synthesis · the cross-cutting read</div>
            ${renderSynthBody(vm.summary.synthesis)}
            <div class="meta">${escapeHtml(vm.summary.synthMeta)}</div>
          </div>
        </div>

        ${languagesSection}

        <div style="margin-top:26px"><button class="btn" data-act="gotofindings">Explore ${plural(vm.summary.total, 'finding')} &rarr;</button></div>
      </div>
    </section>

    <!-- FINDINGS -->
    <section class="panel" data-panel="findings"${anchorAttr('section-findings')}>
      <div class="toolbar">
        <span class="eyebrow">Filter</span>
        <div class="pills" id="pills"></div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div class="viewsel" id="viewsel"></div>
          <div style="display:flex;align-items:center;gap:9px">
            <span class="eyebrow">Sort</span>
            <button class="pill" id="sortbtn" data-act="sort">impact</button>
          </div>
        </div>
      </div>
      <div id="findings-body" class="panes"></div>
    </section>

    <!-- EVIDENCE -->
    <section class="panel" data-panel="evidence"${anchorAttr('section-evidence')}>
      <div class="doc">
        <div class="sechead"><span class="n">A</span><h2>Top hotspots · by change frequency</h2></div>
        <div class="tbl-wrap"><table${anchorAttr('table-hotspots')}>
          <thead><tr><th>File</th><th style="text-align:right">Commits</th><th style="text-align:right">Churn</th><th>Top owner</th><th style="text-align:right">Share</th></tr></thead>
          <tbody>${hotspotRows}</tbody>
        </table></div>${truncNote(vm.hotspots.rows.length, vm.hotspots.total)}

        ${couplingTable}

        <div class="sechead"><span class="n">${vm.coupling.total ? 'C' : 'B'}</span><h2>Contributors · after identity resolution</h2></div>
        <div class="tbl-wrap"><table${anchorAttr('table-contributors')}>
          <thead><tr><th>Identity</th><th style="text-align:right">Commits</th><th style="text-align:right">Share</th><th style="text-align:right">Aliases</th></tr></thead>
          <tbody>${contribRows}</tbody>
        </table></div>${truncNote(vm.contributors.rows.length, vm.contributors.total)}
      </div>
    </section>

  </div>

<script>window.__ACCEL_DATA__ = ${dataJson};</script>
<script>${REMEDIATION_EXPORT_JS}</script>
<script>${RUNTIME}</script>
</body>
</html>`;
}

// ---- Two-report model: the EXECUTION report --------------------------------------------------------------------------------
// Same shell as the detailed report (CSS tokens, topbar, tabs, the client runtime for the Findings pane, the
// REMEDIATION.md export) so it looks like one product with the Leadership brief. Three tabs:
//   Work plan — what to fix, grouped by business theme, each group with the questions still open in it;
//   Findings  — one card per confirmed finding: problem · evidence · fix · done when · how to verify · guardrail;
//   Appendix  — ruled out · vitals · severity/lens · languages · evidence tables · codeintel charts · git history.
// No answer-back, no KPI strip, no narrative synthesis: those are the Leadership brief's (no-overlap rule).
const VERDICT_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  critical: { label: 'Critical', bg: '#FBE9E7', fg: '#B03A2E' },
  risk: { label: 'At risk', bg: '#FDF1DC', fg: '#8A5A00' },
  watch: { label: 'Watch', bg: '#F3EEE4', fg: '#5A4A3D' },
  healthy: { label: 'Healthy', bg: '#E6F2EA', fg: '#2F7D54' },
};
// Incremental re-scan: the work-plan row's since-last-scan chip.
function sinceChip(s?: { status: string; since?: string }): string {
  if (!s) return '';
  const label = s.status === 'new' ? 'new' : s.status === 'changed' ? 'changed' : `persisting since ${s.since ?? 'last scan'}`;
  const st = s.status === 'new' ? 'background:#FDF1DC;color:#8A5A00' : s.status === 'changed' ? 'background:#F3EEE4;color:#5A4A3D' : 'background:#EEF1F5;color:#3D4B5A';
  return ` <span class="tagx" style="${st};font-weight:600;margin-left:6px;white-space:nowrap">${escapeHtml(label)}</span>`;
}
// Cross-project org memory: the work-plan row's "Across projects" chip (+ the sibling project's name).
function acrossChip(project?: string): string {
  return project ? ` <span class="tagx" style="background:#E8EEF7;color:#2F4F7A;font-weight:600;margin-left:6px;white-space:nowrap">${escapeHtml(`Across projects · ${project}`)}</span>` : '';
}
function verdictChip(v?: string): string {
  const st = v ? VERDICT_STYLE[v] : undefined;
  return st ? `<span class="tagx" style="background:${st.bg};color:${st.fg};font-weight:600">${st.label}</span>` : '';
}

function renderExecutionHtml(vm: ViewModel, result: MinerResult, brief?: string): string {
  const dataJson = JSON.stringify(vm).replace(/</g, '\\u003c');
  const targetName = baseName(vm.target) || vm.target;
  const ex = vm.execution!;
  const confirmed = vm.findings.filter((f) => !f.ruledOut);
  const ruledOut = vm.findings.filter((f) => f.ruledOut);
  const gapsN = ex.groups.reduce((n, g) => n + g.gaps.length, 0);
  const critHigh = confirmed.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
  const quickWins = confirmed.filter((f) => f.effortRank <= 1).length;
  const drafted = confirmed.filter((f) => f.remediation.some((r) => r.k === 'Recommended fix' && !/^No specific fix was drafted/.test(r.v))).length;

  const stats = [
    { value: String(confirmed.length), label: 'findings to fix', sub: `${drafted} with a drafted fix` },
    { value: String(critHigh), label: 'critical + high', sub: `of ${plural(confirmed.length, 'finding')}` },
    { value: String(quickWins), label: 'quick wins', sub: 'low effort' },
    { value: String(gapsN), label: 'need a test', sub: 'open questions' },
  ].map((h) => `<div class="herostat"><div class="n">${escapeHtml(h.value)}</div><div class="l">${escapeHtml(h.label)}</div><div class="s">${escapeHtml(h.sub)}</div></div>`).join('');

  const briefText = String(brief ?? '').trim();
  const briefBlock = briefText ? `<details class="rep-brief"><summary>Your brief · the scope this plan answers</summary><p>${escapeHtml(briefText)}</p></details>` : '';

  const groupsHtml = ex.groups.map((g, gi) => {
    // A group that IS a bundle (no synthesis themes) makes "Found by" repeat the heading on every row — drop the column.
    const showFoundBy = g.rows.some((r) => r.foundBy && r.foundBy !== g.name);
    const showExposure = g.rows.some((r) => r.exposure);
    const rows = g.rows.map((r) => `<tr>`
      + `<td style="white-space:nowrap">${r.displayId ? `<a class="fid mono" href="#${escapeHtml(r.anchorId)}" data-act="gotofinding" data-goto-anchor="${escapeHtml(r.anchorId)}" style="text-decoration:none">${escapeHtml(r.displayId)}</a>` : ''}</td>`
      + `<td><a href="#${escapeHtml(r.anchorId)}" data-act="gotofinding" data-goto-anchor="${escapeHtml(r.anchorId)}" style="color:var(--espresso);text-decoration:none;font-weight:500">${escapeHtml(r.claim)}</a>${sinceChip(r.since)}${acrossChip(r.crossProject)}</td>`
      + `<td><span class="badge" style="background:${r.sevColor}">${escapeHtml(r.severity)}</span></td>`
      + `<td class="mono" style="font-size:12px;white-space:nowrap">${escapeHtml(r.effortLabel)}</td>`
      + (showExposure ? `<td style="font-size:12px;color:var(--ink2)">${escapeHtml(r.exposure ?? '')}</td>` : '')
      + (showFoundBy ? `<td style="font-size:12px;color:var(--muted)">${escapeHtml(r.foundBy)}</td>` : '') + `</tr>`).join('');
    const table = g.rows.length
      ? `<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Finding</th><th>Severity</th><th>Effort</th>${showExposure ? '<th>Exposure</th>' : ''}${showFoundBy ? '<th>Found by</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`
      : '';
    const gaps = g.gaps.length
      ? `<details class="rep-gaps" style="margin-top:12px"${g.gaps.length <= 3 ? ' open' : ''}><summary>Needs a test · ${g.gaps.length} open question${g.gaps.length === 1 ? '' : 's'} in this area</summary><ul>${g.gaps.map((x) => `<li>${statusChipHtml(statusFromVerdict(x.status))} <b>${escapeHtml(x.concern)}</b><div class="gap-why">${escapeHtml(x.why)}</div><div class="gap-next"><span>Next decisive test:</span> ${escapeHtml(x.next)}</div></li>`).join('')}</ul></details>`
      : '';
    return `<div class="sechead"><span class="n">${String(gi + 1).padStart(2, '0')}</span><h2>${escapeHtml(g.name)}</h2>${verdictChip(g.verdict)}</div>`
      + (g.framing ? `<p style="color:var(--ink2);margin:-6px 0 14px;font-size:14.5px;line-height:1.55">${escapeHtml(g.framing)}</p>` : '')
      + table + gaps;
  }).join('') || '<div class="empty">No findings or open questions for this run.</div>';
  // Incremental re-scan: the closing "Fixed since last scan" list (+ what was not re-checked, which is never called fixed).
  const since = ex.since;
  const fixedHtml = since
    ? `<div class="sechead"${anchorAttr('section-fixed-since')}><span class="n">✓</span><h2>Fixed since last scan</h2></div>`
      + `<p style="color:var(--ink2);margin:-6px 0 14px;font-size:14px;line-height:1.55">${escapeHtml(`Compared with the scan of ${since.baseline.date}${since.baseline.sha ? ` @ ${since.baseline.sha.slice(0, 7)}` : ''}: ${since.counts.fixed} fixed · ${since.counts.new} new · ${since.counts.persisting} persisting${since.counts.changed ? ` · ${since.counts.changed} changed` : ''}.`)}</p>`
      + (since.fixed.length
        ? `<ul class="exec-ro">${since.fixed.map((f) => `<li>${f.displayId ? `<span class="mono" style="color:var(--muted)">${escapeHtml(f.displayId)} (then)</span> ` : ''}<b>${escapeHtml(f.title)}</b> <span class="mono" style="font-size:11.5px;color:var(--muted)">${escapeHtml(f.severity)}</span></li>`).join('')}</ul>`
        : '<div class="empty">Nothing from the last scan was fixed.</div>')
      + (since.unchecked.length ? `<details class="rep-gaps" style="margin-top:12px"><summary>Not counted as fixed · ${since.unchecked.length}</summary><ul>${since.unchecked.map((u) => `<li><b>${escapeHtml(u.title)}</b> <span class="gap-why">${escapeHtml(uncheckedWhyText(u.why))}, so it is not counted as fixed</span></li>`).join('')}</ul></details>` : '')
    : '';

  // --- appendix -------------------------------------------------------------------------------------------------------------
  const ruledOutBlock = ruledOut.length
    ? `<div class="sechead"><span class="n">A</span><h2>Checked and ruled out</h2></div><ul class="exec-ro">${ruledOut.map((f) => `<li><b>${escapeHtml(f.claim)}</b><div class="gap-why">${escapeHtml(f.detail)}</div></li>`).join('')}</ul>`
    : '';
  const vitalsCards = vm.vitals.map((v) => `<div class="stat"><div class="v">${escapeHtml(v.value)}</div><div class="l">${escapeHtml(v.label)}</div><div class="s">${escapeHtml(v.sub)}</div></div>`).join('');
  const sevCells = vm.summary.sev.map((c) => `<div class="sev-cell"><div class="sev-n" style="color:${c.color}">${c.n}</div><div class="eyebrow" style="margin-top:6px">${escapeHtml(c.label)}</div></div>`).join('') || '<div class="sev-cell"><div class="sev-n">0</div><div class="eyebrow" style="margin-top:6px">findings</div></div>';
  const sevBar = vm.summary.sevBar.map((b) => `<div style="flex:${b.flex};background:${b.color}"></div>`).join('') || '<div style="flex:1;background:var(--line)"></div>';
  const lensRows = vm.summary.lenses.map((l) => `<div class="lens-row"><span class="swatch" style="background:${l.color}"></span><span style="flex:1;color:var(--ink2)">${escapeHtml(l.label)}</span><span class="mono" style="font-size:12.5px;font-weight:500">${l.n}</span></div>`).join('') || '<div class="lens-row" style="color:var(--muted)">no findings</div>';
  const hotspotRows = vm.hotspots.rows.map((h) => `<tr><td class="path">${escapeHtml(h.path)}</td><td class="numc">${h.commits}</td><td class="numc">${h.churn}</td><td>${escapeHtml(h.owner)}</td><td class="numc">${escapeHtml(h.share)}</td></tr>`).join('');
  const contribRows = vm.contributors.rows.map((c) => `<tr><td>${escapeHtml(c.id)}${c.bot ? ' <span class="tagx" style="background:var(--cream);color:var(--muted)">bot</span>' : ''}</td><td class="numc">${c.commits}</td><td class="numc">${escapeHtml(c.share)}</td><td class="numc">${c.aliases}</td></tr>`).join('');
  const couplingRows = vm.coupling.rows.map((c) => `<tr><td class="path">${escapeHtml(c.a)}</td><td class="path">${escapeHtml(c.b)}</td><td class="numc">${c.co}</td><td class="numc">${escapeHtml(c.degree)}</td></tr>`).join('');
  const evidenceTables = (vm.hotspots.total ? `<div class="sechead"><span class="n">D</span><h2>Hotspots · by change frequency</h2></div><div class="tbl-wrap"><table${anchorAttr('table-hotspots')}><thead><tr><th>File</th><th style="text-align:right">Commits</th><th style="text-align:right">Churn</th><th>Top owner</th><th style="text-align:right">Share</th></tr></thead><tbody>${hotspotRows}</tbody></table></div>${truncNote(vm.hotspots.rows.length, vm.hotspots.total)}` : '')
    + (vm.coupling.total ? `<div class="sechead"><span class="n">E</span><h2>Change-coupling pairs</h2></div><div class="tbl-wrap"><table${anchorAttr('table-coupling')}><thead><tr><th>File A</th><th>File B</th><th style="text-align:right">Co-changes</th><th style="text-align:right">Degree</th></tr></thead><tbody>${couplingRows}</tbody></table></div>${truncNote(vm.coupling.rows.length, vm.coupling.total)}` : '')
    + (vm.contributors.total ? `<div class="sechead"><span class="n">F</span><h2>Contributors · after identity resolution</h2></div><div class="tbl-wrap"><table${anchorAttr('table-contributors')}><thead><tr><th>Identity</th><th style="text-align:right">Commits</th><th style="text-align:right">Share</th><th style="text-align:right">Aliases</th></tr></thead><tbody>${contribRows}</tbody></table></div>${truncNote(vm.contributors.rows.length, vm.contributors.total)}` : '');
  const extra = ex.appendix.map((a, i) => `<div class="sechead"${anchorAttr('appendix-' + a.key)}><span class="n">${String.fromCharCode(71 + i)}</span><h2>${escapeHtml(a.title)}</h2></div><div class="exec-frag">${a.html}</div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>accel-scope · ${escapeHtml(targetName)} · execution report</title>
<style>${CSS}${REPORT_STATUS_CSS}${EXEC_CSS}</style>
</head>
<body>
  <header class="topbar" id="repTopbar">
    <div class="topbar-in">
      <span class="bee">${BEE_IMG}</span>
      <div style="display:flex;align-items:baseline;gap:9px">
        <span style="font-weight:600;font-size:15.5px;letter-spacing:-.01em">accel-scope</span>
        <span class="eyebrow">execution report</span>
      </div>
      <div class="tb-sep" style="display:flex;align-items:center;gap:9px">
        <span style="font-weight:600;font-size:14px">${escapeHtml(targetName)}</span>
        <span class="mono" style="font-size:11.5px;color:var(--muted)">${escapeHtml(vm.topbar.commits)}</span>
      </div>
      <div class="tb-right">
        <span style="display:flex;align-items:center;gap:7px" class="mono"><span class="dot"></span><span style="font-size:11.5px;color:var(--muted)">read-only</span></span>
        <span class="mono" style="font-size:11.5px;color:var(--muted)">${escapeHtml([vm.date, vm.topbar.cost].filter(Boolean).join(' · '))}</span>
        <button class="btn" data-act="export">Export REMEDIATION.md</button>
      </div>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-act="tab" data-tab="overview">Work plan</button>
    <button class="tab" data-act="tab" data-tab="findings">Findings${confirmed.length ? `<span class="n">${confirmed.length}</span>` : ''}</button>
    <button class="tab" data-act="tab" data-tab="evidence">Appendix</button>
  </nav>

  <div class="stage">
    <section class="panel active" data-panel="overview"${anchorAttr('section-overview')}>
      <div class="hero">
        <div class="hero-in">
          <div class="hero-eyebrow">Execution report · how to fix it and how to prove it is fixed</div>
          <div class="herostats">${stats}</div>
        </div>
      </div>
      <div class="doc">
        ${briefBlock}
        ${groupsHtml}
        ${fixedHtml}
      </div>
    </section>

    <section class="panel" data-panel="findings"${anchorAttr('section-findings')}>
      <div class="toolbar">
        <span class="eyebrow">Filter</span>
        <div class="pills" id="pills"></div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div class="viewsel" id="viewsel"></div>
          <div style="display:flex;align-items:center;gap:9px">
            <span class="eyebrow">Sort</span>
            <button class="pill" id="sortbtn" data-act="sort">impact</button>
          </div>
        </div>
      </div>
      <div id="findings-body" class="panes"></div>
    </section>

    <section class="panel" data-panel="evidence"${anchorAttr('section-evidence')}>
      <div class="doc">
        ${ruledOutBlock}
        <div class="sechead"><span class="n">B</span><h2>${vm.isOrg ? 'Organization' : 'Repository'} vitals</h2></div>
        <div class="vitals">${vitalsCards}</div>
        <div class="sechead"><span class="n">C</span><h2>Severity and lens</h2></div>
        <div class="summary" style="grid-template-columns:1fr 1fr">
          <div class="card">
            <div class="eyebrow" style="margin-bottom:13px">${vm.summary.total} confirmed · by severity</div>
            <div class="sev-cells">${sevCells}</div>
            <div class="sevbar">${sevBar}</div>
          </div>
          <div class="card">
            <div class="eyebrow" style="margin-bottom:13px">by lens</div>
            <div style="display:flex;flex-direction:column;gap:9px">${lensRows}</div>
          </div>
        </div>
        ${evidenceTables}
        ${extra}
      </div>
    </section>
  </div>

<script>window.__ACCEL_DATA__ = ${dataJson};</script>
<script>${REMEDIATION_EXPORT_JS}</script>
<script>${RUNTIME}</script>
</body>
</html>`;
}

const EXEC_CSS = `
.exec-ro{list-style:none;padding:0;margin:0 0 8px;display:flex;flex-direction:column;gap:10px}
.exec-ro li{background:var(--cream-card);border:1px solid var(--line);border-radius:12px;padding:12px 15px;font-size:14px}
.exec-frag{overflow-x:auto}
.exec-block{background:var(--cream);border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-bottom:18px;font-size:14px;color:var(--espresso);line-height:1.55}
.exec-code{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;background:var(--espresso);color:#F4E9D8;border-radius:12px;padding:13px 15px;margin-bottom:18px}
@media (max-width:760px){.summary{grid-template-columns:1fr!important}}
`;

function truncNote(shown: number, total: number): string {
  return total > shown ? `<div class="trunc">Showing top ${shown} of ${total}.</div>` : '';
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
