// Deep-audit investigation model — the stateful, hypothesis-driven core (Layer A).
//
// Turns the agent from a breadth-first checklist over fixed invariants into a depth-first
// INVESTIGATION, the way a human recsys audit actually runs: a high-level issue is
// decomposed into HYPOTHESES; each is triaged to a decisive METRIC drawn from a value-free
// library; the metric is MEASURED against a floor / null / named-parent; a deterministic
// code-side VERDICT is rendered; the result REFRAMES the working model into the next
// decisive test. (symptom → hypothesis → eval → verdict → reframe.)
//
// Anti-reward-hacking: the metric library is METHODS ONLY — each entry carries the
// question it answers, the value-free way to measure it, and the null it must beat — never
// a project's numbers, baselines, or conclusions. Every measured value is read against a
// floor the agent surfaces at run time; the VERDICT is code, not agent prose, so it is
// deterministic and auditable. The library generalizes to any retrieval/ranking org.

export type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'blocked-need-eval';

// The measurement plane a hypothesis needs (gates the Preflight source-availability lint + tells the measure
// agent which mounted plane to compute on). Defined HERE (the lowest-level model) and re-exported from
// auditPlan.ts so both the plan layer and `plannedMeasurement.requiresPlane` share ONE type (it was opened
// from the old warehouse/keyvalue/none union to include the analytics/bi/custom MCP planes; the code-native
// bundles opened it further to the codeintel index + GitHub repo-metadata planes, so a code-only project —
// e.g. a public-URL engine/SDK repo — gets MEASURED verdicts instead of 100% deferred eval proposals).
export type MeasurePlane = 'warehouse' | 'keyvalue' | 'analytics' | 'bi' | 'custom' | 'codeintel' | 'repometa' | 'osv' | 'none';

// ── THE CANONICAL PLANE CLASSIFICATION ──────────────────────────────────────────────────────────
//
// Two questions used to be answered by two independent lists, and they disagreed:
//   1. "can this plane produce a measurement?" — MEASURE_KIND, previously local to execute-org-run.
//   2. "does a ref from this plane count as measured against the reader's LIVE systems?" — the
//      provenance classifier in evidencePlane.
// Both were hand-maintained, and review found each of them wrong in turn: the provenance side let
// `repogrep` then `codeintel`/`repometa`/`osv` claim live measurement, and then claimed `slack` — which
// is mounted as a plane but deliberately is NOT a MeasurePlane, so the measurement router never treats it
// as one. A second list that has to be remembered is the defect, not the values in it.
//
// ONE keyed Record, exhaustive over MeasurePlane, so adding a plane is a COMPILE ERROR until someone
// classifies it. That is the property the original MEASURE_KIND was written as a Record to get, extended
// from a boolean to the distinction the reports actually make.
//
//   'live'     — queried against the reader's own running systems, now.
//   'external' — a real measurement, but not a live query: a public advisory DB, repository metadata
//                fetched from an API.
//   'code'     — derived from the source, INCLUDING an index of it. codeintel is a real MeasurePlane and
//                its metrics are genuine, but they are computed from a precomputed index of the cloned
//                repo, so they can never support "this could not have come from reading the repository".
export const MEASURE_PLANE_CLASS: Record<Exclude<MeasurePlane, 'none'>, 'live' | 'external' | 'code'> = {
  warehouse: 'live',
  keyvalue: 'live',
  analytics: 'live',
  bi: 'live',
  custom: 'live',
  repometa: 'external',
  osv: 'external',
  codeintel: 'code',
};

// Can this plane kind produce a measurement at all? A kind absent from MEASURE_PLANE_CLASS is not a
// MeasurePlane — `slack` and `repo` are mounted as readable planes but measure nothing — so it is neither
// live nor external, and a ref naming it earns no measured stamp.
export function isMeasurePlaneKind(kind: string | undefined): boolean {
  return Object.hasOwn(MEASURE_PLANE_CLASS, (kind ?? '').toLowerCase());
}

// ── claim archetype → required decomposition (the metric-SET contract) ──────────────────
// A Critique problem carries a claim ARCHETYPE; the archetype drives the set of decisive MOVES a senior
// practitioner runs to settle that kind of claim (methodMoves.ts is the registry). This is what turns a
// single-number finding into the exemplar's multi-angle decomposition. Defined here (lowest level) so the
// plan layer, the measure layer, and the report layer share ONE set of types.
export type ClaimArchetype = 'incremental_value' | 'metric_definition_drift' | 'experiment_validity'
  | 'deterministic_breach' | 'coverage_by_exposure' | 'freshness' | 'generic';

// One decisive sub-question in a decomposition. `incremental_value`'s moves are the exemplar's angles:
// population_denominator (how big is the universe) · alternative_coverage (what the rest already covers) ·
// target_overlap (the target vs the alternatives) · target_sole_footprint (uniquely the target's) ·
// reachable_denominator (the target's reach of the catalog) · sole_exposure_engagement (do its unique items
// get shown + engaged) · proxy_vs_decision (is this a proxy or the decision) · counterfactual (the ablation).
export type MoveKind = 'population_denominator' | 'alternative_coverage' | 'target_overlap'
  | 'target_sole_footprint' | 'reachable_denominator' | 'sole_exposure_engagement'
  | 'proxy_vs_decision' | 'counterfactual';

// A planned move (Preflight output, per move) — the decisive sub-question + how to measure it.
export interface PlanMove {
  kind: MoveKind | string;   // a registry MoveKind, or a bundle-specific move name
  intent: string;            // the decisive sub-question (value-free method, no company names/numbers)
  requiresPlane?: MeasurePlane;
  decisiveQuery?: string;    // concrete read-only query, or a one-sentence intent
  mustBeat?: string;         // the null/floor this move's value must clear
  proxyFor?: MoveKind | string; // when this is a read-only PROXY standing in for an ideal move that can't run read-only
  planGap?: string;          // set by lintPlan when this move is unsafe/unmounted → the Expert records it as a
                             // coverage_gap SubMeasurement (no budget spent) instead of running it (codex: preserve, don't drop)
}

// A measured move (Expert output, per move) — its own evidence-bound reading, gap, or N/A. The decomposition
// table renders these; the aggregate disposition is computed from them deterministically.
export interface SubMeasurement {
  moveId: string;            // stable id within the hypothesis (e.g. 'h1.m3')
  kind: MoveKind | string;
  intent: string;
  state: 'evidence_ref' | 'coverage_gap' | 'not_applicable';
  disposition?: 'supports' | 'refutes' | 'mixed' | 'neutral'; // the move's own read (agent-stated; aggregate is code)
  value?: number | string;   // the measured scalar/string, when state === 'evidence_ref'
  source?: string;           // warehouse:… / redis:… / <plane-server>:… — the live source
  query?: string;            // the SQL/probe text actually run (no secrets/PII)
  queryHash?: string;
  reason: string;            // for a gap/NA: why; for evidence: a one-line read of the number
}

// The decomposition-level disposition, aggregated over a hypothesis's SubMeasurement[] (code, never the agent).
// proxy_supported / *_with_caveats deliberately do NOT promote to a definitive Finding (they map to an
// AuditedClaim downgrade) — proxy evidence must never read as "keep/cut is proven".
export type DecompositionDisposition = 'confirmed' | 'refuted' | 'confirmed_with_caveats'
  | 'proxy_supported' | 'unresolved';

// The verdict cascade states (mirrors the rankingProfile prose, now a function).
import { createHash } from 'node:crypto';

// A stable, short content hash of a measurement's query/probe text — so an EvidencePayload's
// reproducibility is verifiable (the same query always hashes the same; the claim auditor reads it).
// Deterministic, never fabricated: a pure function of the normalized (whitespace-collapsed, trimmed) text.
export function queryHashOf(query: string | undefined): string | undefined {
  const q = (query ?? '').replace(/\s+/g, ' ').trim();
  if (!q) return undefined;
  return createHash('sha256').update(q).digest('hex').slice(0, 12);
}

export type VerdictState =
  | 'win'                // primary beats parent + clears every must-beat null, no guardrail traded
  | 'no-free-lunch'      // primary improved but a guardrail regressed (e.g. recall↑ tail↓)
  | 'refuted'            // primary ≤ a must-beat null, or worse than parent beyond the flat band
  | 'invalid-multilever' // >1 lever changed vs the named parent → not attributable
  | 'pending'            // measured but missing the parent/null it needs to gate
  | 'unmeasured';        // no datapoint / probe result yet — an eval must be run

// One method in the library the agent triages a hypothesis to. Value-free.
export interface MetricSpec {
  id: string;            // stable key, e.g. 'constant_user_null'
  title: string;
  question: string;      // the diagnostic question it settles
  definition: string;    // value-free method (how to measure it)
  nulls: string[];       // the must-beat baseline(s) — names only, values established at run time
  direction: 'higher' | 'lower'; // is a bigger or smaller value "better" for the model?
  probe?: string;        // recsys probe catalog name, if live-measurable; absent ⇒ must be proposed
  established: boolean;   // true = a known method; false = an agent-proposed new metric
}

export interface NullRef { name: string; value: number | null; } // value null ⇒ not yet measured

// ── the enriched, TYPED grammar (the investigation discipline as output fields, not nodes) ──
// CONTRACT POLICY: OPTIONAL from the agent, REQUIRED after normalization. The measure agent fills these
// where it can; `normalizeArtifacts()` (below) completes a thin/missing reply with DETERMINISTIC defaults
// (never hallucinated values) so a measurement still settles a verdict and the artifacts are complete for
// the report. Only `value + a resolvable source` ever allows a Finding; everything here improves report
// quality and degrades to a caveat, never a crash or a fabricated number.

// The data/evidence contract for a measurement — the line between trustworthy and embarrassing numbers.
export interface DataContract {
  grain: string;             // the unit each row represents (request|item|user_day|arm|…); 'unknown' if unstated
  window?: string;           // time window / freshness of the underlying data
  dedupRule?: string;        // how duplicates on the grain are handled
  joinKeys?: string[];       // keys used to join sources (attribution safety)
  biases?: string[];         // known logging/selection biases / caveats
}
// What a pass/fail of this metric actually establishes — and what it does NOT (the claim boundary).
export interface MetricSemantics {
  proves: string;
  cannotProve: string;
  proxyOrDecision: 'proxy' | 'decision' | 'unknown'; // is the measured signal a proxy for a higher decision, or the decision itself?
  validGrain?: string;
}
// Counterfactual / peer comparison — NO hard enforcement (forcing it on a deterministic breach yields
// nonsense): `not_applicable` is a valid, reasoned state for binary/deterministic claims.
export interface Counterfactual {
  state: 'run' | 'not_run' | 'not_applicable';
  baseline?: string;         // null / peer / segment / historical
  delta?: string;            // the measured difference, when run
  reason?: string;           // why not_run / not_applicable
}
// The reproducible evidence behind a MEASURED value — the stable ref + a bounded payload.
// `ref` is the EvidenceRef the Finding cites; it resolves to THIS payload (closes the "bare measurement:h1
// is fake precision" gap — a measurement ref now carries the value/source/query it points at).
export interface EvidencePayload {
  ref: string;
  value: number | null;
  source: string;            // warehouse:… / redis:… / probe:… / datapoint id
  grain?: string;
  nulls: NullRef[];
  query?: string;            // the SQL / probe text, if any (no secrets/PII)
  queryHash?: string;
  sampleRows?: string[];     // a bounded result sample (no secrets/PII)
}

// A measured (or proposed-but-unmeasured) reading the agent returns for one hypothesis.
export interface Measurement {
  metricId: string;
  value: number | null;            // null ⇒ not measured (the hypothesis is blocked on an eval)
  direction: 'higher' | 'lower';
  nulls: NullRef[];                // must-beat baselines, with values where known
  parent?: { id: string; value: number | null } | null; // the NAMED parent, for guardrail metrics
  levers?: string[];               // single-variable change vs the parent (experiment attribution)
  guardrailTraded?: boolean;       // a guardrail regressed while primary improved (no-free-lunch)
  source?: string;                 // datapoint id / probe name / 'proposed'
  note?: string;
  supportsClaim?: boolean;         // the agent's EXPLICIT defect disposition: does the value CONFIRM the
                                   // (defect-framed) hypothesis (true) or REFUTE it / show healthy (false)?
                                   // Decoupled from the cascade verdict because "metric beats its null" does
                                   // NOT determine defect polarity (e.g. high like-AUC REFUTES "ignores likes").
  // ── enriched grammar (optional from agent; completed by normalizeArtifacts) ──
  dataContract?: DataContract;
  metricSemantics?: MetricSemantics;
  counterfactual?: Counterfactual;
  claimBoundaries?: string;        // the allowed scope of the claim (what it may / may not assert)
  nextDecisiveTest?: string;       // the next decisive experiment/probe (even for measured-but-insufficient)
  evidence?: EvidencePayload;      // the reproducible payload behind a MEASURED value
  // ── the decomposition for an archetype-driven hypothesis (else absent → single-metric path) ──
  subMeasurements?: SubMeasurement[];               // each required move's own reading/gap/NA
  decompositionDisposition?: DecompositionDisposition; // code-computed aggregate over subMeasurements
}

// Raw (untyped, all-optional) artifact fields a measure reply MAY include — normalized into the typed
// Measurement fields above. Kept separate from Measurement so a thin/garbage reply never blocks the parse.
export interface RawArtifacts {
  dataContract?: Partial<DataContract>;
  metricSemantics?: Partial<MetricSemantics>;
  counterfactual?: Partial<Counterfactual>;
  claimBoundaries?: string;
  nextDecisiveTest?: string;
  query?: string;
  sampleRows?: unknown;
}

// Complete the enriched grammar from a (possibly thin) raw reply — DETERMINISTIC defaults, never invented
// numbers. `m` already holds value/source/nulls; `h` carries the claim + evalProposal fallback. Returns the
// typed fields to assign onto the Measurement.
export function normalizeArtifacts(m: Measurement, claim: string, evalHow: string | undefined, lib: MetricSpec[], raw?: RawArtifacts, refId?: string): {
  dataContract: DataContract; metricSemantics: MetricSemantics; counterfactual: Counterfactual; claimBoundaries: string; nextDecisiveTest: string; evidence?: EvidencePayload;
} {
  const spec = metricById(m.metricId, lib);
  const dc = raw?.dataContract ?? {};
  const dataContract: DataContract = {
    grain: (dc.grain && String(dc.grain).trim()) || 'unknown',
    window: dc.window ? String(dc.window) : undefined,
    dedupRule: dc.dedupRule ? String(dc.dedupRule) : undefined,
    joinKeys: Array.isArray(dc.joinKeys) ? dc.joinKeys.map(String) : [],
    biases: Array.isArray(dc.biases) ? dc.biases.map(String) : [],
  };
  const ms = raw?.metricSemantics ?? {};
  const metricSemantics: MetricSemantics = {
    // derive a neutral, value-free caveat from the metric SPEC + claim when the agent didn't state one —
    // never assert a proof the run didn't establish.
    proves: (ms.proves && String(ms.proves).trim()) || (spec ? `whether ${spec.question.replace(/\?$/, '')}` : `the measured value of ${m.metricId} vs its null`),
    cannotProve: (ms.cannotProve && String(ms.cannotProve).trim()) || 'anything beyond this metric vs this null at the measured grain',
    proxyOrDecision: ms.proxyOrDecision === 'proxy' || ms.proxyOrDecision === 'decision' ? ms.proxyOrDecision : 'unknown',
    validGrain: ms.validGrain ? String(ms.validGrain) : (dataContract.grain !== 'unknown' ? dataContract.grain : undefined),
  };
  const cf = raw?.counterfactual ?? {};
  const counterfactual: Counterfactual = cf.state === 'run' || cf.state === 'not_applicable'
    ? { state: cf.state, baseline: cf.baseline ? String(cf.baseline) : undefined, delta: cf.delta ? String(cf.delta) : undefined, reason: cf.reason ? String(cf.reason) : undefined }
    : { state: 'not_run', baseline: cf.baseline ? String(cf.baseline) : undefined, reason: (cf.reason && String(cf.reason)) || 'no counterfactual/peer comparison was run for this measurement' };
  const nullStr = m.nulls.map((n) => `${n.name}=${n.value ?? '?'}`).join(', ');
  const claimBoundaries = (raw?.claimBoundaries && String(raw.claimBoundaries).trim()) || `proves only the measured ${m.metricId}${nullStr ? ` vs [${nullStr}]` : ''} at the stated grain — not the broader claim "${claim.slice(0, 80)}"`;
  const nextDecisiveTest = (raw?.nextDecisiveTest && String(raw.nextDecisiveTest).trim()) || evalHow || 'state the must-beat null / named parent and re-read this measurement against it';
  // EvidencePayload only for a MEASURED value (value != null) with a concrete source — that's the payload the
  // Finding's ref resolves to. No payload ⇒ no fake-precise measurement: ref (the converter routes to a gap).
  const payloadQuery = raw?.query ? String(raw.query).slice(0, 2000) : undefined;
  const evidence: EvidencePayload | undefined = m.value != null && m.source
    ? { ref: `measurement:${refId ?? m.metricId}`, value: m.value, source: m.source, grain: dataContract.grain !== 'unknown' ? dataContract.grain : undefined, nulls: m.nulls, query: payloadQuery, queryHash: queryHashOf(payloadQuery), sampleRows: Array.isArray(raw?.sampleRows) ? raw!.sampleRows!.map(String).slice(0, 12) : undefined }
    : undefined;
  return { dataContract, metricSemantics, counterfactual, claimBoundaries, nextDecisiveTest, evidence };
}

// A structured, executable eval handoff — WHAT to measure, WHY, and HOW — so a downstream
// agent (the autoresearch executor, or a person) can RUN it and feed the datapoint back.
// Value-free: it specifies a method + the null to beat, never an expected value.
export interface EvalProposal {
  metric: string;            // the metric/datapoint to produce (library id or a proposed id)
  what: string;              // the measurement to produce (one line)
  why: string;               // which hypothesis it settles + what the result decides
  how: string;               // the method: denominator / split / sample + the probe or command to run
  probe?: string;            // a recsys probe-catalog name, if one fits (executor hint)
  inputsNeeded?: string[];   // exports / indexes / tables / access a downstream run needs
  mustBeat: string[];        // the nulls / floors the result is read against
  produces?: string;         // the datapoint id/shape it should yield (so it can be fed back)
}

export interface Hypothesis {
  id: string;                      // h1, h2, …
  claim: string;                   // the falsifiable assertion under test
  symptom: string;                 // which intake symptom it explains
  status: HypothesisStatus;
  decisiveMetric: string;          // MetricSpec.id (or a proposed metric id)
  measurement?: Measurement;
  verdict?: VerdictState;
  evalProposal?: EvalProposal;     // when blocked: the structured eval a downstream agent can run
  spawnedFrom?: string;            // reframe lineage (which hypothesis/result produced this one)
  agentMetric?: string;            // unforced mode: the measurement the bot named IN ITS OWN WORDS
  triaged?: string;               // unforced mode: nearest library id (post-hoc, for the diff only — NOT shown to the agent)
  // the Preflight-APPROVED measurement plan to EXECUTE (set only in execute-plan mode). The
  // measure agent runs THIS query/method instead of re-planning, so the deterministic plan lint (SQL-safety,
  // source availability) is load-bearing, not advisory. Same shape as PlanHypothesis's planning fields.
  plannedMeasurement?: {
    mustBeat?: string;
    dataContract?: { grain?: string; window?: string; dedupRule?: string; joinKeys?: string[]; biases?: string[] };
    decisiveQuery?: string;
    requiresPlane?: MeasurePlane;
    // when set, the measure agent executes the metricSet (the archetype's decomposition) and
    // returns SubMeasurement[], instead of one decisive metric. Absent → the single-metric path (unchanged).
    archetype?: ClaimArchetype;
    metricSet?: PlanMove[];
  };
}

// ── The value-free metric library — the triage target ────────────────────────────────────
// Seeded from the established retrieval/ranking diagnostics (the same methods encoded in
// research/ranking.ts and the probe catalog). The agent SELECTS from this; a question with no
// matching entry becomes an agent-PROPOSED metric (established:false) and an eval to run.
export const METRIC_LIBRARY: MetricSpec[] = [
  {
    id: 'full_catalog_recall', title: 'Full-catalog recall@k vs floor',
    question: 'Is the reported offline metric an honest proxy for full-catalog serving?',
    definition: 'Score recall@k by searching the FULL item index (not in-batch / sampled negatives); read against the random-chance floor = k / catalog_size at the serving denominator. In-batch numbers are training-health only.',
    nulls: ['random_chance', 'popularity_list_null'], direction: 'higher', probe: 'full_catalog_recall', established: true,
  },
  {
    id: 'constant_user_null', title: 'Constant-user null (personalization value)',
    question: 'Does the user tower personalize, or would one fixed list serve everyone as well?',
    definition: 'Serve ONE representative user’s top-K list to every user and score recall@k. The model’s real per-user recall MUST materially beat this; recall ≈ null ⇒ personalization adds nothing.',
    nulls: ['constant_user_null'], direction: 'higher', probe: 'constant_user_null', established: true,
  },
  {
    id: 'popularity_null', title: 'Popularity-list null (must-beat floor)',
    question: 'Does the learned retriever beat a static top-K popular list?',
    definition: 'Serve the static global top-K most-popular items to everyone and score recall@k. A learned retriever at-or-below this is, for ranking purposes, a popularity recommender.',
    nulls: ['popularity_list_null'], direction: 'higher', probe: 'popularity_null', established: true,
  },
  {
    id: 'user_tower_cone', title: 'User-tower collapse (cone)',
    question: 'Has the user tower collapsed toward a single vector / popularity recommender?',
    definition: 'Mean pairwise cosine of sampled user embeddings (≈1 ⇒ collapsed). No absolute floor — compare to the NAMED PARENT model’s measured cone; a child rising toward 1 traded diversity for the headline.',
    nulls: ['named_parent_cone'], direction: 'lower', probe: 'cone', established: true,
  },
  {
    id: 'disjoint_history_cosine', title: 'Disjoint-history sensitivity',
    question: 'Does the user tower actually respond to user history?',
    definition: 'Embed two DISJOINT histories of the same user and measure cosine (≈1 ⇒ history barely moves the vector; the tower ignores behavior). A model-side probe — no retrieval needed.',
    nulls: ['identity_ceiling'], direction: 'lower', established: true,
  },
  {
    id: 'per_cohort_recall', title: 'Per-cohort generalization (active vs cold)',
    question: 'Does recall hold on the cold/low-activity cohort the aggregate hides?',
    definition: 'Break full-catalog recall@k down per user cohort (active vs cold/low-active); gap = 1 − weakest/strongest. A large gap ⇒ the model works for heavy users but fails the new-user population.',
    nulls: ['within_cohort_random_chance'], direction: 'higher', probe: 'full_catalog_recall', established: true,
  },
  {
    id: 'banded_tail_recall', title: 'Popularity-banded / tail recall',
    question: 'Does the model retrieve beyond the popular head, or only the top-1%?',
    definition: 'Conditional recall@k by item-popularity band (top-100 / 100–1k / 1k–top1% / beyond-1%). Reveals the rank where recall cliffs and whether any tail mass is recovered.',
    nulls: ['beyond_head_random_chance'], direction: 'higher', established: false,
  },
  {
    id: 'effective_catalog_size', title: 'Effective catalog size (ECS) + amplification',
    question: 'How many items does the model effectively use, and does it amplify concentration?',
    definition: 'ECS = exp(entropy) of the top-K slot distribution across users (interpretable in items, unsaturated where Gini isn’t). Amplification = output-N50 ÷ training-N50 (>1 ⇒ the model concentrates harder than its own training data).',
    nulls: ['training_distribution_ecs'], direction: 'higher', established: false,
  },
  {
    id: 'like_vs_dwell_auc', title: 'Objective↔online alignment (like-AUC vs dwell-AUC)',
    question: 'Does the model predict the engagement signal the business wants, or only dwell?',
    definition: 'Held-out AUC for the true engagement signal (like/save/share) vs the 0.5 random floor, alongside dwell-AUC. like-AUC ≤ 0.5 ⇒ the model does not rank by likes at all; a large dwell≫like gap ⇒ objective↔online divergence.',
    nulls: ['auc_random_0p5'], direction: 'higher', established: true,
  },
  {
    id: 'redundancy_sole_rate', title: 'Redundancy (sole-rate + per-channel overlap)',
    question: 'Does the retriever add UNIQUE coverage, or duplicate incumbent channels?',
    definition: 'Over logged candidates, per-channel sole-rate (items only this channel proposed) + overlap@K with each incumbent recall source. High overlap with i2i/popular ⇒ redundant-by-construction.',
    nulls: ['incumbent_channel_overlap'], direction: 'higher', established: false,
  },
  {
    id: 'recall_source_unique_exposure', title: 'Recall-source unique-item exposure & engagement (incremental value)',
    question: 'Do a recall source\'s UNIQUELY-contributed items actually get exposed and engaged, or are they always outranked (dead weight)?',
    definition: 'Over logged candidates+serving+engagement, isolate items ONLY this source contributed (sole-rate set), then compute their post-ranking exposure share and their engagement rate vs the overall rate. Warehouse-computable from candidate/exposure/engagement logs over a multi-window sample. Unique items rarely exposed, or exposed but engaged below the overall rate ⇒ the source adds recall on paper but no surviving value.',
    nulls: ['overall_engagement_rate', 'zero_unique_exposure'], direction: 'higher', established: false,
  },
  {
    id: 'recall_source_ablation_lift', title: 'Recall-source ablation lift (decisive keep/cut test)',
    question: 'Removing this recall source, does top-line engagement drop beyond a flat band — i.e. is the source worth its latency/cost?',
    definition: 'The decisive serving-time test: an A/B that removes the source from the merge and measures top-line engagement delta vs a flat-band null. VALUE = the magnitude of the engagement LOSS caused by removing the source, so direction is "higher" = a bigger loss = the source is more load-bearing (keep it); a value within the flat band = no measurable loss = a cut candidate. Offline recall cannot settle "keep it". Needs a live experiment — bind it if a past ablation arm exists in the warehouse; otherwise propose it.',
    nulls: ['flat_band_no_engagement_loss'], direction: 'higher', established: false,
  },
  {
    id: 'serving_identity', title: 'Served-index identity + freshness',
    question: 'Is the served model the one the team thinks it is, fresh, and train/serve-faithful?',
    definition: 'Read the live index manifest: served item-tower export id == deployed user-tower export id; index build timestamp vs now; index_type (IVF/HNSW ⇒ lossy ANN ceiling) and normalize_embeddings vs training. Config flags lie — read the loaded artifact.',
    nulls: ['export_pairing_match'], direction: 'higher', probe: 'serving_identity', established: true,
  },
  {
    id: 'experiment_single_variable', title: 'Single-variable attribution vs a named parent',
    question: 'Is a training experiment a clean +1-lever change from a NAMED parent?',
    definition: 'Diff a run’s recipe against the DEPLOYED EXPORT ARTIFACT’s embedded config (not the live/declared config — it drifts). >1 changed lever ⇒ the result is not attributable to any single cause; its win/loss verdict is INVALID.',
    nulls: ['named_parent_recipe'], direction: 'higher', established: true,
  },
];

export function metricById(id: string, lib: MetricSpec[] = METRIC_LIBRARY): MetricSpec | undefined {
  return lib.find((m) => m.id === id);
}

// Post-hoc triage for UNFORCED mode: map a metric the agent named in its own words to the nearest
// library id, by keyword overlap. Used ONLY to diff what the bot drew against our menu — it is
// never shown to the agent and never constrains it. Returns undefined if nothing matches.
const TRIAGE_KEYWORDS: Record<string, string[]> = {
  full_catalog_recall: ['full catalog', 'full inventory', 'full index', 'serving denominator', 'in-batch', 'sampled negative', 'random chance floor', 'recall@'],
  constant_user_null: ['constant user', 'one user', 'single fixed list', 'same list to', 'fixed list', 'one fixed', 'personalization adds'],
  popularity_null: ['popularity null', 'popularity list', 'popular list', 'top-k popular', 'most popular', 'static top'],
  user_tower_cone: ['cone', 'pairwise cosine', 'embedding cosine', 'user-embedding', 'collapse', 'collinear', 'tower collapse'],
  disjoint_history_cosine: ['disjoint', 'two histories', 'different histories', 'history sensitivity', 'ignores history'],
  per_cohort_recall: ['cohort', 'active vs', 'cold', 'low-active', 'low active', 'segment', 'generaliz', 'new-user'],
  banded_tail_recall: ['banded', 'tail recall', 'popularity band', 'by item rank', 'beyond top', 'head vs tail'],
  effective_catalog_size: ['effective catalog', 'ecs', 'entropy', 'gini', 'concentration', 'n50', 'amplification', 'coverage', 'distinct items', 'diversity'],
  like_vs_dwell_auc: ['auc', 'like vs dwell', 'like-auc', 'dwell', 'valid_stay', 'objective', 'label reward', 'engagement signal'],
  redundancy_sole_rate: ['sole-rate', 'sole rate', 'overlap', 'redundan', 'incumbent', 'i2i', 'unique coverage', 'unique candidate', 'channel'],
  serving_identity: ['serving', 'served index', 'export id', 'faiss', 'index manifest', 'freshness', 'stale index', 'ann', 'train/serve'],
  experiment_single_variable: ['single-variable', 'single variable', 'one lever', 'named parent', 'attribution', 'a/b valid', 'srm', 'arm'],
};
export function nearestLibraryMetric(text: string): string | undefined {
  const t = (text || '').toLowerCase();
  let best: string | undefined; let bestScore = 0;
  for (const [id, kws] of Object.entries(TRIAGE_KEYWORDS)) {
    const score = kws.reduce((n, kw) => n + (t.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return bestScore > 0 ? best : undefined;
}

// Render the library into a prompt block (the triage menu).
export function renderMetricLibrary(lib: MetricSpec[] = METRIC_LIBRARY): string {
  return lib.map((m) =>
    `- ${m.id} — ${m.title} (better = ${m.direction}; ${m.probe ? `live probe: ${m.probe}` : 'no live probe — would need a proposed eval'})\n    Q: ${m.question}\n    method: ${m.definition}\n    must beat: ${m.nulls.join(', ')}`,
  ).join('\n');
}

// ── The verdict cascade — deterministic, code-side (agent measures, code judges) ──────────
// v1: handles direction (higher/lower better), must-beat nulls, named-parent guardrail,
// multi-lever attribution, and a no-free-lunch flag. The flat band is the relative margin
// within which "no better than parent" is treated as flat.
export const FLAT_BAND = 0.02;

export function verdict(m: Measurement | undefined): VerdictState {
  if (!m || m.value == null) return 'unmeasured';
  if (m.levers && m.levers.length > 1) return 'invalid-multilever';

  const better = (a: number, b: number) => (m.direction === 'higher' ? a > b : a < b);
  const worseBeyondBand = (a: number, b: number) =>
    m.direction === 'higher' ? a < b * (1 - FLAT_BAND) : a > b * (1 + FLAT_BAND);

  // Refute if it fails to beat any KNOWN must-beat null (an unmeasured null cannot refute).
  for (const n of m.nulls) {
    if (n.value == null) continue;
    if (!better(m.value, n.value)) return 'refuted';
  }
  // Guardrail vs the named parent.
  if (m.parent && m.parent.value != null) {
    if (worseBeyondBand(m.value, m.parent.value)) return 'refuted';
    if (m.guardrailTraded) return 'no-free-lunch';
    return 'win';
  }
  // No parent to gate against, but it cleared its nulls.
  if (!m.nulls.some((n) => n.value != null)) return 'pending'; // nothing measured to gate on
  return 'win';
}

// The verdict to RECORD on a hypothesis: the cascade verdict, reconciled with the measure agent's explicit disposition.
// The cascade only knows metric-vs-null, so for a "DEFECT iff count = 0" contract a measured 0 fails its null and
// reads 'refuted' while the agent (and statusFor) say the defect is confirmed — the log and the barrier checkpoint
// then carried `supported [verdict=refuted]`, and the finding text said "verdict refuted".
// Only a DIRECT polarity contradiction is flipped; pending / multilever / unmeasured stay as the cascade says.
export function dispositionVerdict(m: Measurement | undefined): VerdictState {
  const v = verdict(m);
  if (!m || m.value == null) return v;
  if (m.supportsClaim === true && v === 'refuted') return 'win';
  if (m.supportsClaim === false && (v === 'win' || v === 'no-free-lunch')) return 'refuted';
  return v;
}

export function statusFromVerdict(v: VerdictState): HypothesisStatus {
  switch (v) {
    case 'win': return 'supported';                 // the hypothesis (e.g. "X is a real win") holds
    case 'no-free-lunch': return 'supported';       // a real, but caveated, effect
    case 'refuted': case 'invalid-multilever': return 'refuted';
    case 'unmeasured': return 'blocked-need-eval';
    case 'pending': default: return 'open';
  }
}

// The hypothesis status (supported = defect real / refuted = healthy). PREFERS the measure agent's
// explicit defect disposition (`supportsClaim`) because the cascade verdict only knows metric-vs-null,
// not defect polarity — for a defect-framed hypothesis whose metric is "higher = healthier" (e.g.
// like-AUC, arms-varying), a cascade "win" actually means the defect is ABSENT. Falls back to
// statusFromVerdict(verdict(m)) when the agent left supportsClaim unset (back-compat).
export function statusFor(m: Measurement | undefined): HypothesisStatus {
  if (!m || m.value == null) return 'blocked-need-eval';
  if (m.supportsClaim === true) return 'supported';
  if (m.supportsClaim === false) return 'refuted';
  return statusFromVerdict(verdict(m));
}

// aggregate a hypothesis's decomposition (SubMeasurement[]) into ONE disposition, deterministically
// (never the agent). The key anti-overclaim rule: when the DECISION move — the counterfactual /
// ablation that alone proves keep-or-cut — is not measured, the most we may say is `proxy_supported`, never a
// definitive confirmed/refuted, no matter how complete the proxy stack is. The caller maps proxy_supported /
// *_with_caveats to an AuditedClaim downgrade so proxy evidence can't ship as a settled Finding.
//   - confirmed/refuted: the decision move HAS evidence (and its read supports/refutes the claim); no required
//     proxy move contradicts it.
//   - confirmed_with_caveats: decision move stands, but a required supporting move is a gap (doesn't flip polarity).
//   - proxy_supported: no decision-move evidence, but the proxy stack is complete (every non-counterfactual
//     required move measured) → "read-only evidence indicates", an OPEN finding, not a proven keep/cut.
//   - unresolved: a required move whose absence can flip the conclusion is missing AND the proxy stack is partial.
export function aggregateDisposition(
  subs: SubMeasurement[] | undefined,
  headlineSupportsClaim: boolean | undefined,
): DecompositionDisposition | undefined {
  if (!subs || !subs.length) return undefined;
  const measured = (s: SubMeasurement) => s.state === 'evidence_ref';
  const decision = subs.find((s) => s.kind === 'counterfactual');
  const support = subs.filter((s) => s.kind !== 'counterfactual');
  const proxyComplete = support.length > 0 && support.every((s) => measured(s) || s.state === 'not_applicable');
  // The decision move counts as run ONLY if it has a real value (state evidence_ref is not enough — a value-less
  // "evidence_ref" can't prove keep/cut).
  const decisionRan = Boolean(decision && measured(decision) && decision.value != null);
  if (decisionRan) {
    // the ablation actually ran with a value → a definitive read — but ONLY when its polarity is EXPLICIT
    // (its own supports/refutes, or the headline boolean). An ambiguous decision (mixed/neutral/unstated) does
    // NOT promote to confirmed/refuted — it is unresolved.
    const dd = decision!.disposition;
    const polarity: 'confirmed' | 'refuted' | null =
      dd === 'supports' ? 'confirmed' : dd === 'refutes' ? 'refuted'
      : (dd == null && headlineSupportsClaim === true) ? 'confirmed'
      : (dd == null && headlineSupportsClaim === false) ? 'refuted'
      : null;   // 'mixed' / 'neutral' / unstated-without-headline → ambiguous
    if (polarity == null) return 'unresolved';
    const supportGap = support.some((s) => s.state === 'coverage_gap');
    return supportGap && polarity === 'confirmed' ? 'confirmed_with_caveats' : polarity;
  }
  // decision move did NOT run (or ran without a value) → never definitive. Complete proxy stack ⇒
  // proxy_supported; else unresolved.
  return proxyComplete ? 'proxy_supported' : 'unresolved';
}

// Does a decomposition disposition permit a definitive Finding? Only confirmed/refuted/confirmed_with_caveats
// promote; proxy_supported + unresolved must stay OPEN (→ CoverageGap / downgrade).
export function decompositionPromotes(d: DecompositionDisposition | undefined): boolean {
  return d === 'confirmed' || d === 'refuted' || d === 'confirmed_with_caveats';
}
