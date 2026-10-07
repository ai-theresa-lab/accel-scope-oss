// Expert bundle registry — the pluggable domain content the hypothesis-audit engine
// (research/deep.ts) consumes. One engine, many bundles. A bundle has two halves:
//   • Critique half — what to look for in this domain (activation signals + investigative lens)
//   • Expert half   — how to measure / decide (metric library + triage + code-structural checks)
// The engine is bundle-agnostic; this file holds the bundles. recsys-mle is the first, assembled
// from the existing recsys content (ranking.ts / investigation.ts / invariants.ts) — behaviour is
// unchanged. Future bundles (DE / Analytics / Trust&Safety / a thin always-on baseline) register
// here, and a Comprehend step selects which to activate per company type.
import type { Invariant } from './invariants.ts';
import { RANKING_INVARIANTS } from './invariants.ts';
import { RANKING_SIGNALS, rankingProfile } from './ranking.ts';
import { METRIC_LIBRARY, nearestLibraryMetric, type MetricSpec } from './investigation.ts';
import { type ProblemPattern, recallSourceIncrementalValue, exposureFeedbackAmplification, TRUST_PATTERNS } from './patterns.ts';
import { DOMAIN_BUNDLES } from './domainBundles.ts';

export interface ExpertBundle {
  id: string;
  title: string;
  // ── Critique half ──
  activationSignals: string[];                    // company-type keywords that mount this bundle
  alwaysOn?: boolean;                             // mount unconditionally (the data-trust baseline floor), regardless of signals
  lens: string;                                   // investigative lens injected into the audit prompts
  patterns?: ProblemPattern[];                    // seed-bank method shapes this domain primes the Critique with
  // ── Expert half ──
  metricLibrary: MetricSpec[];                    // the decisive-metric triage menu
  triage: (text: string) => string | undefined;  // unforced-mode: map a free-text metric → nearest library id
  structuralChecks: Invariant[];                  // code-structural invariants (e.g. recsys i12/i13)
}

// First bundle: recsys / ranking (MLE). Assembled from existing recsys exports — no content moved.
export const recsysMle: ExpertBundle = {
  id: 'recsys-mle',
  title: 'Recsys / ranking (MLE)',
  activationSignals: RANKING_SIGNALS,
  lens: rankingProfile(true),
  patterns: [recallSourceIncrementalValue, exposureFeedbackAmplification],
  metricLibrary: METRIC_LIBRARY,
  triage: nearestLibraryMetric,
  structuralChecks: RANKING_INVARIANTS,
};

// recsys-mle (deep) + the domain bundles (baseline always-on floor + DE / Analytics / Trust&Safety skeletons).
export const EXPERT_BUNDLES: ExpertBundle[] = [recsysMle, ...DOMAIN_BUNDLES];

// NOTE (Phase 1): bundlesFor / structuralChecksFor / ExpertBundle.triage exist + are tested but the
// CLIs still activate via opts.ranking ⇒ [recsysMle]. Phase 2 wires Comprehend-driven activation
// (company-type → bundle set) + multi-expert triage / i-check gating onto the production path.

// Bundles whose activation signals appear in any connected text, PLUS every always-on bundle (the
// baseline floor). Generalizes looksLikeRanking() to N bundles. (A future Comprehend step can pass
// an explicit company-type set instead.)
export function bundlesFor(...texts: (string | undefined)[]): ExpertBundle[] {
  const hay = texts.filter(Boolean).join('\n').toLowerCase();
  return EXPERT_BUNDLES.filter((b) => b.alwaysOn || b.activationSignals.some((s) => hay.includes(s.toLowerCase())));
}

// Resolve an EXPLICIT bundle-id list (e.g. what the Comprehend agent chose) into bundles. By default the always-on
// BASELINE floor is included regardless of the list (the AUTO path — Comprehend/keyword — always keeps the floor). Pass
// includeAlwaysOn=false for an EXPLICIT MANUAL selection where the user deliberately picked the exact set: then the
// baseline floor rides ONLY if its id is in the list, so the user can run domain bundles WITHOUT the floor.
// ids are de-duped and unknown ids ignored. bundlesFor (keyword match) is the always-on fallback.
export function resolveBundles(ids: string[], includeAlwaysOn = true): ExpertBundle[] {
  const want = new Set((ids ?? []).map((s) => String(s).toLowerCase()));
  const out: ExpertBundle[] = [];
  const seen = new Set<string>();
  for (const b of EXPERT_BUNDLES) {
    if (((includeAlwaysOn && b.alwaysOn) || want.has(b.id.toLowerCase())) && !seen.has(b.id)) { out.push(b); seen.add(b.id); }
  }
  return out;
}

// Compose the active bundles' content. join('\n') + de-dup-by-id keep multi-bundle composition
// robust; single-bundle (today) is unaffected — one element joins to itself, ids don't collide.
export const mergedLens = (bundles: ExpertBundle[]): string => bundles.map((b) => b.lens).join('\n');
export const mergedLibrary = (bundles: ExpertBundle[]): MetricSpec[] => {
  const seen = new Set<string>();
  return bundles.flatMap((b) => b.metricLibrary).filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
};
export const structuralChecksFor = (bundles: ExpertBundle[]): Invariant[] => bundles.flatMap((b) => b.structuralChecks);
export const mergedPatterns = (bundles: ExpertBundle[]): ProblemPattern[] => {
  const seen = new Set<string>();
  // Cross-cutting DATA-TRUST patterns: fold TRUST_PATTERNS into any DOMAIN bundle's Critique (a non-alwaysOn
  // bundle), so recsys/data-eng/analytics/trust-safety raise metric-trust issues locally — the coverage the always-on
  // baseline used to guarantee, now carried where the domain evidence is (baseline itself uses research(), not this).
  // De-duped by id, so a bundle that already lists one of them (e.g. analytics → metricDefinedTwoWays) isn't doubled.
  const trust = bundles.some((b) => !b.alwaysOn) ? TRUST_PATTERNS : [];
  return [...bundles.flatMap((b) => b.patterns ?? []), ...trust].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
};
