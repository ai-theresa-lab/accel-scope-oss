// Adapter: turn the real investigateQuestion DOSSIER (src/research/scopedInvestigate.ts) into the presentation
// `ScopedReportModel` consumed by scopedTemplateHtml.ts. DETERMINISTIC, ZERO-LLM — this REPLACES the old
// free-vibe LLM report-authoring pass for Quick Ask (saving that LLM call).
//
// How the enriched dossier maps to the RESTRUCTURED "story" report:
//   execSummary                           → In plain terms — top NON-TECHNICAL lead callout
//   bottomLine (?? split answer)          → ① Answer bullets (the lead)
//   mechanism (split to paragraphs) + flow → ② How it works narrative + optional flow diagram
//   tightening (?? mapped workItems)      → ③ Where it can tighten — merged weakness+fix cards
//   dataPoints + evidence                 → ④ Evidence (measured values folded in as inline lines, THEN ref list)
//   openQuestions                         → ⑤ Not directly verified
//   scope (?? derived from evidence/openQ) → the Scope block
//   truncated                             → the PARTIAL banner
//
// SECRET SAFETY: every dossier-derived string is redactSecrets()'d before escaping (RAW fields) or before
// reaching the renderer (the flow diagram's PLAIN labels, which the renderer escapes), so a secret in an
// answer / ref / weakness / flow label never reaches the rendered HTML.
//
// INLINE MARKDOWN: RAW prose fields (bottomLine / mechanism / tightening / evidence detail / scope / notVerified)
// support a tiny, safe markdown subset applied AFTER escaping — `backticks`→<code> and **bold**→<span class="lead">
// — so identifiers and the one or two emphasized phrases render like the approved mockup, deterministically.

import { esc, BRAND_NAME } from './reportChrome.ts';
import { redactSecrets } from './research/reportEvidence.ts';
import type { DimId } from './reportChrome.ts';
import type { ScopedDossier } from './research/scopedInvestigate.ts';
import { isRenderableFlow, SCOPED_LABELS, type FlowSpec, type ScopedTighteningCard, type ScopedReportModel } from './scopedTemplateHtml.ts';

export interface ScopedReportMeta {
  brand?: { name: string; sub: string };
  /** Optional SHORT LLM-generated title (generateRunTitle) → the report h1. When absent, the h1 falls back to the
   * question (back-compat) and the "your question" reminder block is omitted. */
  title?: string;
  client: string;
  scope: string;
  date: string; // pre-formatted, e.g. '2026-07-17' (the adapter/renderer never call Date)
  confidential?: string;
  /** Override the heuristic breadcrumb classification (a later LLM/heuristic can set this precisely). */
  classification?: { dimension: string; sub: string };
  /** Optional logger — used to note when a flow diagram is dropped for not being cleanly layout-able. */
  log?: (m: string) => void;
}

// ── escaping + inline-markdown helpers (RAW fields → pre-escaped + secret-redacted, then md subset) ────────
const red = (s: unknown): string => esc(redactSecrets(String(s ?? '')));
const codeTag = (s: unknown): string => `<code>${red(s)}</code>`;
// mdInline: escape+redact FIRST (neutralizes any real markup), THEN apply the safe md subset on the escaped text.
const mdInline = (s: unknown): string =>
  red(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="lead">$1</span>');

// ── prose splitting ───────────────────────────────────────────────────────────────────────────────────────
// Split on .!? FOLLOWED BY whitespace, so a period inside a token (e.g. `feature.ts`, `0.456`) does NOT split.
// Returns trimmed, non-empty sentences.
function toSentences(text: string): string[] {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [t];
}
// Paragraphs: split on blank lines; a single-blob mechanism stays one paragraph.
function toParagraphs(text: string): string[] {
  const t = String(text ?? '').trim();
  if (!t) return [];
  return t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

// ── the Where-it-can-tighten cards ───────────────────────────────────────────────────────────────────────────────────
const EFFORTS = new Set(['quick_win', 'moderate', 'project']);
const normEffort = (e?: string): ScopedTighteningCard['effort'] | undefined =>
  e && EFFORTS.has(e) ? (e as ScopedTighteningCard['effort']) : undefined;

// One tighten card as built from the dossier.
type PartTightening = { title?: string; weakness: string; fix: string; effort?: ScopedTighteningCard['effort']; files: string[] };
function buildTighteningParts(d: ScopedDossier): PartTightening[] {
  // Prefer the merged `tightening` (now carrying a SHORT action `title`); else map legacy workItems — the old
  // work-item `title` (a short action) → the card title, and its `detail` → the fix (the HOW). Each card:
  // title? (short action) + fix (how) + weakness (why) + effort + files; the renderer gates THE ITEM on `title`.
  return (d.tightening?.length
    ? d.tightening.map((t) => {
        const card: PartTightening = { weakness: mdInline(t.weakness), fix: mdInline(t.fix), files: (t.files ?? []).map((f) => redactSecrets(f)) };
        if (t.title) card.title = mdInline(t.title);
        if (t.effort) card.effort = t.effort;
        return card;
      })
    : d.workItems.map((w) => {
        const card: PartTightening = { weakness: '', fix: mdInline(w.detail), files: (w.files ?? []).map((f) => redactSecrets(f)) };
        if (w.title) card.title = mdInline(w.title);
        const eff = normEffort(w.effort);
        if (eff) card.effort = eff;
        return card;
      })
  ).filter((c) => c.weakness || c.fix);
}

// ── the Scope block ─────────────────────────────────────────────────────────────────────────────
// Take a ref like `recall/coldstart.ts:31` → an informative repo-relative prefix for the DERIVED fallback
// (used only when the dossier carries no explicit scope). We keep up to the FIRST TWO path segments rather
// than collapsing to the bare top-level dir: `src/server.ts:12` → `src/server.ts`,
// `packages/backend/src/x.ts:5` → `packages/backend`, `README.md:3` → `README.md`. A bare `src` was too coarse
// to be a meaningful "covered area". Callers dedupe the results.
function refPrefix(ref: string): string {
  const path = String(ref ?? '').split(':')[0].trim();
  if (!path) return '';
  return path.split('/').filter(Boolean).slice(0, 2).join('/');
}
function buildScopeBlock(d: ScopedDossier): { covered: string[]; notCovered?: string[] } | undefined {
  if (d.scope) {
    const covered = d.scope.covered.map(mdInline);
    const notCovered = d.scope.notCovered?.map(mdInline);
    if (covered.length || notCovered?.length) {
      return notCovered?.length ? { covered, notCovered } : { covered };
    }
  }
  // Derived minimal fallback: covered = distinct evidence-ref prefixes; notCovered = the open questions.
  const prefixes = [...new Set(d.evidence.map((e) => refPrefix(e.ref)).filter(Boolean))].slice(0, 5);
  const covered = prefixes.map(mdInline);
  const notCovered = d.openQuestions.map(mdInline);
  if (!covered.length && !notCovered.length) return undefined;
  return notCovered.length ? { covered, notCovered } : { covered };
}

// ── the flow diagram (pass through; redact PLAIN labels, renderer escapes; drop+log if not layout-able) ────
function redactFlow(f: FlowSpec): FlowSpec {
  const rd = (s: string): string => redactSecrets(s);
  return {
    lanes: f.lanes.map((l) => ({
      title: rd(l.title),
      dir: l.dir,
      edgeLabel: l.edgeLabel ? rd(l.edgeLabel) : undefined,
      steps: l.steps.map((s) => ({ label: rd(s.label), sub: s.sub ? rd(s.sub) : undefined, kind: s.kind })),
    })),
    hub: f.hub ? { label: rd(f.hub.label), sub: f.hub.sub?.map(rd) } : undefined,
  };
}

// ── breadcrumb classification (lightweight keyword heuristic; meta.classification overrides) ──────────────
// The six canonical dimension display names (the Full Scan names the dimensions the same way).
export const DIM_TITLES: Record<DimId, string> = {
  product_metrics: 'Data & Metric Trust',
  security_supply: 'Security & Supply Chain',
  code_health: 'Code Health',
  architecture: 'Architecture',
  knowledge_risk: 'Knowledge Risk',
  delivery_flow: 'Delivery Flow',
};
interface DimClass {
  dim: DimId; // the dimension — display title from DIM_TITLES
  sub: string; // the sub-category
  kw: string[]; // matched case-insensitively against the question
}
const CLASSES: DimClass[] = [
  { dim: 'security_supply', sub: 'Security & Access', kw: ['secret', 'credential', 'auth', 'iam', 'vulnerab', 'cve', 'security', 'leak', 'permission', 'supply chain'] },
  { dim: 'delivery_flow', sub: 'CI / Deployment', kw: ['ci', 'cd', 'deploy', 'release', 'pipeline', 'build', 'rollout', 'rollback'] },
  {
    dim: 'product_metrics',
    sub: 'Data & Metrics',
    kw: ['metric', 'data', 'dashboard', 'dau', 'retention', 'conversion', 'ranking', 'recall', 'cold start', 'embedding', 'a/b', 'experiment', 'tracking'],
  },
  { dim: 'knowledge_risk', sub: 'Knowledge & People', kw: ['bus factor', 'doc', 'readme', 'owner', 'onboarding', 'handover'] },
  { dim: 'code_health', sub: 'Code Quality & Tests', kw: ['test', 'coverage', 'complex', 'refactor', 'lint', 'tech debt', 'churn', 'hotspot'] },
  {
    dim: 'architecture',
    sub: 'Architecture & Dependencies',
    kw: ['architecture', 'coupling', 'dependency', 'module', 'design', 'structure', 'memory', 'layer'],
  },
];

// Generic fallback when no keyword matches.
const GENERIC_CLASS = { dimension: 'Technical Deep-Dive', sub: 'Custom investigation' };

export function classifyQuestion(question: string): { dimension: string; sub: string } {
  const q = String(question ?? '').toLowerCase();
  for (const c of CLASSES) {
    if (c.kw.some((k) => q.includes(k.toLowerCase()))) return { dimension: DIM_TITLES[c.dim], sub: c.sub };
  }
  return { ...GENERIC_CLASS };
}

// ── parts: the presentation pieces built from the dossier ──────────────────────────────────────────────────
interface ScopedParts {
  bottomLine: string[];
  mechanism: string[];
  evidence: string[];
  tightening: PartTightening[];
  scopeCovered: string[];
  scopeNotCovered: string[];
  notVerified: string[];
  flow?: FlowSpec;
}
function buildParts(d: ScopedDossier, log?: (m: string) => void): ScopedParts {
  // ① Answer — explicit bottomLine, else the answer split into ≤4 sentences.
  const bottomLine = (d.bottomLine?.length ? d.bottomLine : toSentences(d.answer).slice(0, 4)).map(mdInline);
  // ② How it works — mechanism paragraphs + (optional) flow diagram.
  const mechanism = (d.mechanism ? toParagraphs(d.mechanism) : []).map(mdInline);
  let flow: FlowSpec | undefined;
  if (d.flow) {
    if (isRenderableFlow(d.flow)) flow = redactFlow(d.flow);
    else log?.(`  ⚠ scoped report: flow diagram omitted — spec not cleanly layout-able (${d.flow.lanes?.length ?? 0} lane(s))`);
  }
  // ④ Evidence — measured dataPoints (concrete grounding → FIRST) folded in as inline lines, THEN the compact
  // "<code>ref</code> — detail" evidence refs.
  const dataPointLines = (d.dataPoints ?? []).map((p) => {
    const head = mdInline(`**${p.label}**: ${p.value}`);
    return p.source ? `${head} ${codeTag(p.source)}` : head;
  });
  const evidenceRefs = d.evidence.map((e) => `${codeTag(e.ref)}${e.detail ? `${SCOPED_LABELS.evidenceSep}${mdInline(e.detail)}` : ''}`);
  const sb = buildScopeBlock(d);
  return {
    bottomLine,
    mechanism,
    evidence: [...dataPointLines, ...evidenceRefs],
    tightening: buildTighteningParts(d),
    scopeCovered: sb?.covered ?? [],
    scopeNotCovered: sb?.notCovered ?? [],
    notVerified: d.openQuestions.map(mdInline),
    flow,
  };
}

// ── the adapter ──────────────────────────────────────────────────────────────────────────────────────────
export function buildScopedReportModel(dossier: ScopedDossier, meta: ScopedReportMeta): ScopedReportModel {
  const p = buildParts(dossier, meta.log);
  const model: ScopedReportModel = {
    brand: meta.brand ?? { name: BRAND_NAME, sub: '' },   // the one brand string (reportChrome.BRAND_NAME)
    client: meta.client,
    scope: meta.scope,
    date: meta.date,
    // SECRET SAFETY: the question drives the <title> + <h1> and is only HTML-escaped at render time — so redact
    // credentials here.
    question: redactSecrets(dossier.question),
    breadcrumb: meta.classification ?? classifyQuestion(dossier.question),
    bottomLine: p.bottomLine,
    partial: dossier.truncated || undefined,
  };
  if (meta.confidential) model.confidential = meta.confidential;
  // SHORT h1 title (LLM-generated / user scope label = UNTRUSTED). Store PLAIN (redacted); the renderer
  // HTML-escapes it. No mdInline — a title needs no inline markdown, and treating it RAW would be an XSS hole. Only
  // set when provided; else h1 falls back to the (also redacted+escaped) question.
  if (meta.title && meta.title.trim()) model.title = redactSecrets(meta.title.trim());
  if (dossier.execSummary && dossier.execSummary.trim()) model.plainSummary = mdInline(dossier.execSummary);
  if (p.scopeCovered.length || p.scopeNotCovered.length) {
    model.scopeBlock = p.scopeNotCovered.length ? { covered: p.scopeCovered, notCovered: p.scopeNotCovered } : { covered: p.scopeCovered };
  }
  if (p.mechanism.length) model.mechanism = p.mechanism;
  if (p.flow) model.flow = p.flow;
  if (p.tightening.length) {
    model.tightening = p.tightening.map((s) => {
      const card: ScopedTighteningCard = { weakness: s.weakness, fix: s.fix, files: s.files };
      if (s.title) card.title = s.title;
      if (s.effort) card.effort = s.effort;
      return card;
    });
  }
  if (p.evidence.length) model.evidence = p.evidence;
  if (p.notVerified.length) model.notVerified = p.notVerified;
  return model;
}
