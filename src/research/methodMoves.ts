// the archetype → required-decomposition registry. A claim ARCHETYPE maps to the set of decisive
// MOVES a senior practitioner runs to settle that kind of claim. This is the structural floor that turns a
// single-number finding into the exemplar's multi-angle decomposition: Preflight emits these moves as the plan's
// metricSet, the Expert executes each into a SubMeasurement, and the report renders the decomposition table.
//
// VALUE-FREE: a move is a METHOD QUESTION + (optionally) the plane it needs — never a company name, number, table,
// or expected answer (same rule as the seed bank). The intents below generalize to ANY incremental_value question
// (does CF recall add value over content recall? does a feature earn its cost?), not just the recsys exemplar.
//
// Only `incremental_value` is populated in this first slice; the other archetypes return [] (single-metric path,
// unchanged) until they are brought up eval-gated, one at a time.
import type { ClaimArchetype, MoveKind } from './investigation.ts';

export interface MoveSpec {
  kind: MoveKind;
  intent: string;           // the decisive sub-question (value-free)
  decision?: boolean;       // the move that ALONE proves keep/cut (the counterfactual/ablation) — gates promotion
  proxy?: boolean;          // a read-only proxy the agent should run when the decision move can't run read-only
}

// incremental_value — "does this component add value the rest of the system doesn't already cover, enough to
// justify its cost?" The exemplar's angles, as value-free method questions.
const INCREMENTAL_VALUE: MoveSpec[] = [
  { kind: 'population_denominator', proxy: true,
    intent: 'Establish the candidate UNIVERSE this component draws from (authoritative size + grain + window + dedup) — the denominator every share below is read against.' },
  { kind: 'alternative_coverage', proxy: true,
    intent: 'How much of that universe do the OTHER sources/alternatives already cover on their own? (the baseline the component must beat to be incremental).' },
  { kind: 'target_overlap', proxy: true,
    intent: 'Of the target component\'s contributed items, what share is ALSO surfaced by at least one other source (overlap) vs the union of all others — not just the obvious alternative.' },
  { kind: 'target_sole_footprint', proxy: true,
    intent: 'What share of the target\'s items is SOLE to it (no other source surfaces them)? Sole-rate is the ceiling on its possible unique value.' },
  { kind: 'reachable_denominator', proxy: true,
    intent: 'How much of the servable catalog can the target reach at all (its distinct footprint / total distinct served) — a small footprint caps incremental value regardless of overlap.' },
  { kind: 'sole_exposure_engagement', proxy: true,
    intent: 'Do the target\'s SOLE items actually get exposed after ranking and engaged vs the overall rate — or are they recalled but always outranked (dead weight)?' },
  { kind: 'proxy_vs_decision',
    intent: 'State explicitly whether each measured share is a PROXY for the keep/cut decision or the decision itself — "appears / is additional" is NOT "is valuable".' },
  { kind: 'counterfactual', decision: true,
    intent: 'The DECISIVE test: a serving-time ABLATION A/B — remove the component, measure top-line engagement delta vs a flat-band null. If it cannot run read-only, mark it a coverage gap and PROPOSE it (primary metric + flat-band null + guardrails + population/window) — do NOT claim keep/cut from the proxies alone.' },
];

const REGISTRY: Partial<Record<ClaimArchetype, MoveSpec[]>> = {
  incremental_value: INCREMENTAL_VALUE,
};

// The required decomposition for an archetype (empty for archetypes not yet brought up → single-metric path).
export function requiredMoves(archetype: ClaimArchetype | undefined): MoveSpec[] {
  return (archetype && REGISTRY[archetype]) || [];
}

// Does this archetype carry a decomposition (drives the metric-set path)?
export function hasDecomposition(archetype: ClaimArchetype | undefined): boolean {
  return requiredMoves(archetype).length > 0;
}

// Deterministic archetype fallback: if the planner did NOT set a valid archetype, infer
// `incremental_value` from incremental-value SIGNALS in the problem text, so an incremental-value-shaped problem doesn't
// silently fall through to the single-metric path. Value-free keyword match; defaults to 'generic' (no
// decomposition) so nothing is forced onto a problem that isn't actually an incremental-value question.
const INCREMENTAL_SIGNALS = [
  'incremental value', 'incremental contribution', 'add value', 'adds value', 'redundant', 'worth keeping',
  'worth the cost', 'unique contribution', 'sole-rate', 'sole rate', 'overlap', 'ablation', 'recall source',
  'candidate source', 'never exposed', 'dead weight', 'justify its', 'duplicate coverage',
];
export function inferArchetype(...texts: (string | undefined)[]): ClaimArchetype {
  const hay = texts.filter(Boolean).join('\n').toLowerCase();
  if (INCREMENTAL_SIGNALS.some((s) => hay.includes(s))) return 'incremental_value';
  return 'generic';
}

const VALID: ReadonlySet<string> = new Set<ClaimArchetype>([
  'incremental_value', 'metric_definition_drift', 'experiment_validity',
  'deterministic_breach', 'coverage_by_exposure', 'freshness', 'generic',
]);
export function normalizeArchetype(raw: unknown): ClaimArchetype | undefined {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return VALID.has(s) ? (s as ClaimArchetype) : undefined;
}

// Render the required move template into the Preflight prompt (so the planner fills a metricSet for this archetype).
export function renderMoveTemplate(archetype: ClaimArchetype): string {
  const moves = requiredMoves(archetype);
  if (!moves.length) return '';
  const body = moves.map((m, i) =>
    `  ${i + 1}. ${m.kind}${m.decision ? ' (DECISION move — alone proves keep/cut)' : m.proxy ? ' (read-only proxy ok)' : ''}: ${m.intent}`,
  ).join('\n');
  return `REQUIRED DECOMPOSITION for archetype "${archetype}" — plan ONE move per line into "metricSet" (each with ` +
    `its own intent + requiresPlane + a concrete read-only decisiveQuery or a one-sentence query intent). Measure ` +
    `every move; the DECISION move (counterfactual/ablation) usually can't run read-only — plan it, mark its plane, ` +
    `and the Expert will gap+propose it rather than fake a keep/cut from proxies:\n${body}`;
}
