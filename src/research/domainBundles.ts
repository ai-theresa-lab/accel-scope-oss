// Domain expert bundles beyond recsys — the multi-expert registry: a thin always-on
// BASELINE (data/metric-trust floor) + skeleton DE / Analytics / Trust&Safety bundles. Each is the
// same shape as recsysMle (Critique half: activationSignals + lens + seed patterns; Expert half:
// metricLibrary + triage + structuralChecks) so the engine runs them through the identical path; a
// Comprehend step selects which to activate per company type.
//
// SKELETON DEPTH (intentional): recsys-mle is the deep, validated bundle. These ship a real,
// value-free investigative lens + a handful of decisive metrics + seed patterns so they generate
// useful hypotheses today, and are meant to be deepened (more metrics, structural checks, validated
// nulls) the way recsys was. Value-free throughout: methods + nulls only, never a project's numbers.
import { type Invariant, baselineFloorInvariants, DE_INVARIANTS, ANALYTICS_INVARIANTS, TS_INVARIANTS, SW_INVARIANTS, RE_INVARIANTS, AS_INVARIANTS, SC_INVARIANTS, MOBILE_IOS_INVARIANTS, MOBILE_ANDROID_INVARIANTS, BL_INVARIANTS } from './invariants.ts';
import { type MetricSpec } from './investigation.ts';
import type { ExpertBundle } from './experts.ts'; // `import type` (not inline `{ type }`) so type-stripping fully ELIDES this edge — breaks the experts↔domainBundles runtime cycle so `mobileIos`/`mobileAndroid` can be imported directly, in any order
import { renderPlatformContract } from './mobilePlatformContract.ts';
import {
  type ProblemPattern, silentFreshnessDecay, metricDefinedTwoWays, moderationCoverageGap,
  lineageBlastRadius, lateArrivalBackfillEquivalence, partitionPruningCostEquivalence,
  segmentMixDecomposition, registeredReadoutIntegrity, frozenCohortDenominator,
  appealReversalStability, safetyLabelFeedbackLoop, evasionClosure,
  changeAmplification, boundaryErosionCycles, hotspotDefectAdjacency, busFactorCriticalPath,
  retryUntilGreen, mergeGateBypass, releaseThenRevert, unpinnedBuildInputs,
  breakingChangeInMinor, deprecationWithoutWindow, undocumentedPublicSurface, silentApiChange,
  knownVulnDependencyDebt, fetchAndExecuteSupplyChain, vendoredBlobProvenance, untrustedInputFuzzGap,
  MOBILE_PATTERNS, PRODUCT_LOGIC_PATTERNS,
} from './patterns.ts';

// Generic triage over a bundle's OWN library (recsys has its bespoke nearestLibraryMetric). Token
// overlap between the free-text metric and each spec's id/title/question; undefined if nothing matches.
function makeTriage(lib: MetricSpec[]): (text: string) => string | undefined {
  return (text: string) => {
    // WORD-level match (not substring) so short domain tokens like `lag`/`ann` don't false-match inside
    // larger words (flagging / channel). length >= 3 keeps short domain terms (lag/etl/dbt/kpi/ann).
    const tWords = new Set((text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    let best: string | undefined; let bestScore = 0;
    for (const m of lib) {
      const kws = `${m.id} ${m.title} ${m.question}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const score = kws.reduce((n, kw) => n + (tWords.has(kw) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = m.id; }
    }
    return bestScore > 0 ? best : undefined;
  };
}

const bundle = (b: Omit<ExpertBundle, 'triage'> & { triage?: ExpertBundle['triage'] }): ExpertBundle =>
  ({ ...b, triage: b.triage ?? makeTriage(b.metricLibrary) });

// ── BASELINE — thin, always-on data/metric-trust floor ──────────────────────────────────────
// No domain metric library of its own; its value is the GENERAL lens + the 11 data-trust invariants
// as structural checks. mergedLibrary skips its empty library, so it composes cleanly with any domain.
const baselineLens = `DATA / METRIC-TRUST BASELINE (always on). For ANY data-bearing system, sanity-check the trust spine before domain depth — each: suspicion → cheapest decisive probe → metric → floor → interpret:
- DEFINITION CONSISTENCY: does each headline metric resolve to ONE definition end-to-end (event → warehouse → dashboard)? Diff the surfaces over one window.
- CROSS-SOURCE AGREEMENT: do independent sources of the same quantity agree within sampling noise? Reconcile counts on a shared key.
- FRESHNESS & CONTINUITY: is every decision-bearing table fresh on its declared cadence with no row-count gap? max-event-time vs now + rows-per-period.
- INSTRUMENTATION COVERAGE: are the events a claim depends on actually logged for the population it claims? Measure logged share vs the served population.
- EXPLAINABLE CHANGE / PROVENANCE: is every recent metric jump explained by a shipped change, and is the analysis that gates a decision reproducible from raw + a pinned query?
Discover and evidence each issue yourself; measure every metric against a floor you compute. Import no number from this text.`;

export const baseline: ExpertBundle = bundle({
  id: 'baseline', title: 'Data & metric trust (baseline)',
  activationSignals: [],          // never matched by keyword; mounted via alwaysOn (see experts.ts)
  alwaysOn: true,
  lens: baselineLens,
  patterns: [],
  metricLibrary: [],              // the floor is the invariant set, not a metric menu
  structuralChecks: baselineFloorInvariants(),   // curated ≤5 trust-spine invariants (THERESA_BASELINE_MAX_INVARIANTS), not all 11
});

// ── DATA ENGINEERING ──────────────────────────────────────────────────────────────────────
const deLib: MetricSpec[] = [
  { id: 'freshness_lag', title: 'Per-source freshness lag', question: 'Is each decision-bearing table fresh on its declared cadence?',
    definition: 'max(event_time) vs now and rows-per-period over a multi-window sample → live / lagging / stale / dead / one-off. Separate "no declared cadence" (a doc gap, tracked separately) from "violates a declared cadence" (the live defect). Warehouse-computable.',
    nulls: ['fresh_on_declared_cadence'], direction: 'lower', established: false },
  { id: 'schema_contract_drift', title: 'Schema / contract drift', question: 'Does the live table schema still match what downstream consumers + configs assume?',
    definition: 'Diff the live column set/types against the declared contract (dbt schema / config) and against what consumers read; count breaking changes (dropped/retyped columns) shipped without a migration.',
    nulls: ['declared_contract_match'], direction: 'lower', established: false },
  { id: 'duplicate_row_rate', title: 'Duplicate / non-idempotent load rate', question: 'Do re-runs / backfills double-count rows on the table\'s grain?',
    definition: 'Rows vs distinct-on-grain-key rows over a window; spikes around backfill/retry windows ⇒ non-idempotent load. Needs a stated grain. Warehouse-computable.',
    nulls: ['unique_on_grain'], direction: 'lower', established: false },
  { id: 'null_rate_spike', title: 'Null / default-value spike', question: 'Did a key column quietly start arriving null/defaulted (a broken upstream join/feature)?',
    definition: 'Per-column null/empty/default share over time; a step change ⇒ a broken upstream. Warehouse-computable.',
    nulls: ['historical_null_share'], direction: 'lower', established: false },
  // ── deeper decisive metrics (distilled with codex) — each settles by EQUIVALENCE to a correct reconstruction ──
  { id: 'lineage_blast_radius', title: 'Lineage blast radius', question: 'If a source breaks, which decision-bearing assets actually change after the declared gates?',
    definition: 'From static lineage, enumerate downstream consumers of a suspect source/column, then recompute each decision-bearing output with the source FROZEN (last-good) / EXCLUDED / replaced and diff vs live; report the count + identity of assets that move vs those held invariant by a declared gate. Blast radius, not fan-out. Warehouse + code computable.',
    nulls: ['no_ungated_downstream_dependency'], direction: 'lower', established: false },
  { id: 'backfill_replay_equivalence', title: 'Backfill / replay equivalence', question: 'Does the materialized table equal exactly one event-time replay of its immutable inputs?',
    definition: 'Compare a per-partition checksum / distinct-on-grain count of the target against a reconstructed clean replay of the immutable inputs over the same window; any divergence ⇒ double-count or overwrite. For an ORDERED change-log / CDC source the replay must also apply deletes/tombstones in order. Requires the declared grain. Warehouse-computable.',
    nulls: ['idempotent_replay_equivalence'], direction: 'lower', established: false },
  { id: 'late_arrival_correction_rate', title: 'Late-arrival / watermark correctness', question: 'Do late-arriving rows land in their event-time window, or silently in the load window?',
    definition: 'Cross-tab event_time × ingestion_time over a multi-window sample; share of rows whose ingestion window differs from their event window, and whether the watermark / late-data policy accounts for them. Warehouse-computable.',
    nulls: ['event_time_watermark_holds'], direction: 'lower', established: false },
  { id: 'partition_pruning_efficiency', title: 'Partition-pruning efficiency', question: 'Is scheduled compute pruned to the declared output window, or scanning beyond it?',
    definition: 'For the top query families by spend, EFFICIENCY = the share of scanned bytes that fall within the declared output grain/window (plan inspection); dry-run an equivalent pruned plan and compare result + bytes. Lower efficiency ⇒ overscan a pruned plan can close — judged by OUTPUT EQUIVALENCE, never scan size alone. Higher is better.',
    nulls: ['pruned_to_declared_window'], direction: 'higher', established: false },
  { id: 'query_cost_concentration_by_family', title: 'Cost concentration by query family', question: 'Is warehouse spend concentrated in a few rewriteable query families?',
    definition: 'Normalize query history into families by shape; rank by total bytes/slots; report the share held by the top families and whether each top family is rewriteable (pruning / materialization) to the SAME result. Warehouse-computable from query history.',
    nulls: ['cost_not_concentrated_in_rewriteable_family'], direction: 'lower', established: false },
  { id: 'source_to_target_reconciliation', title: 'Source ↔ target reconciliation', question: 'Do a pipeline\'s source and materialized target agree on the declared grain?',
    definition: 'Reconcile counts/sums on a shared business key + grain between the source and the target over a window; report the relative gap and whether it exceeds the load/dedup contract. Warehouse-computable.',
    nulls: ['source_target_grain_equivalence'], direction: 'lower', established: false },
  { id: 'join_fanout_cardinality', title: 'Join fanout / cardinality contract', question: 'Does each join hold its declared grain — no unexpected fanout or dropped keys?',
    definition: 'Declare each join\'s grain; compare entity counts before/after the join, the fanout ratio (output rows per input key), and the dropped-key share (keys present upstream, absent after). Drift from the declared grain ⇒ silent fanout (double-count) or dropout (under-count). Warehouse-computable.',
    nulls: ['join_holds_declared_grain'], direction: 'lower', established: false },
];

export const dataEngineering: ExpertBundle = bundle({
  id: 'data-eng', title: 'Data engineering (pipelines / warehouse)',
  activationSignals: ['airflow', 'dbt', 'etl', 'elt', 'ingestion', 'data pipeline', 'pipeline', 'dataform', 'glue', 'kafka', 'warehouse', 'bigquery', 'snowflake', 'backfill', 'lineage'],
  lens: `DATA-ENGINEERING PROFILE (scheduled pipelines / warehouse). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The decisive move is EQUIVALENCE to a correct reconstruction, never "big/old/full-scan = bad":
- FRESHNESS & CONTINUITY: per-source max-event-time vs now + rows-per-period → live/lagging/stale/dead; a stalled or partial load that still serves last-good rows is the silent failure. Separate "no declared cadence" from "violates cadence".
- SCHEMA / CONTRACT DRIFT: diff live schema vs the declared contract + what consumers read; a breaking change shipped without a migration is the defect.
- IDEMPOTENCY & BACKFILL EQUIVALENCE: does the target equal exactly ONE event-time replay of immutable inputs? Per-partition checksum/grain vs a reconstructed replay; row counts can pass while history double-counts. Needs a stated grain.
- LATE-ARRIVAL CORRECTNESS: event_time × ingestion_time — do late rows land in their event window, or silently in the load window past the watermark?
- LINEAGE BLAST RADIUS: not fan-out — recompute each decision-bearing output with a suspect source frozen/excluded and see which actually move after their declared gates.
- COMPLETENESS: per-column null/default share over time; a step change is a broken upstream join/feature.
- COST AS PRUNABLE-SCAN EQUIVALENCE: normalize query history into families; for the few that dominate spend, is the same result computable from a pruned/materialized plan? Flag overscan (functions on partition cols, missing bounded predicates, SELECT *), not size.
- SOURCE↔TARGET RECONCILIATION: reconcile counts/sums on a shared key+grain between source and target.
Discover + evidence every issue; measure every metric against a floor you compute. Import no number from this text.`,
  patterns: [silentFreshnessDecay, lineageBlastRadius, lateArrivalBackfillEquivalence, partitionPruningCostEquivalence],
  metricLibrary: deLib,
  structuralChecks: DE_INVARIANTS,
});

// ── ANALYTICS / METRIC TRUST ────────────────────────────────────────────────────────────────
const analyticsLib: MetricSpec[] = [
  { id: 'metric_definition_divergence', title: 'Metric definition divergence', question: 'Does a headline metric resolve to ONE definition across app / warehouse / dashboard?',
    definition: 'Reconstruct the metric from raw events with the documented definition; diff against each surface over the same window; enumerate divergent filters/denominators/windows. Flag the same DECISION ROLE / semantic KPI computed with divergent logic — including under different aliases — when nothing reconciles them; allow intentionally versioned variants ONLY when they are explicit AND reconciled.',
    nulls: ['single_shared_definition'], direction: 'lower', established: false },
  { id: 'cross_source_metric_gap', title: 'Cross-source metric gap', question: 'Do two independent sources of the same metric agree within sampling noise?',
    definition: 'Compute the same quantity from each source on a shared key + window; report the relative gap and whether it exceeds sampling noise.',
    nulls: ['within_sampling_noise'], direction: 'lower', established: false },
  { id: 'unexplained_metric_change', title: 'Unexplained metric change', question: 'Is every recent jump in a headline metric explained by a shipped change?',
    definition: 'Align metric change-points to a deploy/config/definition-change log; an unexplained step ⇒ a silent calc change or data break.',
    nulls: ['change_explained_by_ship'], direction: 'lower', established: false },
  { id: 'analysis_reproducibility', title: 'Analysis provenance & gating', question: 'Can a decision-gating analysis be reproduced from raw + a pinned query?',
    definition: 'Re-run the gating analysis from raw with the pinned query/notebook; check it is version-controlled, parameterized, and reproduces the cited number.',
    nulls: ['reproduces_from_pinned_source'], direction: 'higher', established: false },
  // ── deeper decisive metrics (distilled with codex) — measure the DEGREES OF FREEDOM, never label intent ──
  { id: 'segment_mix_decomposition', title: 'Segment-mix decomposition', question: 'Does the headline read survive a fixed-mix / within-segment decomposition?',
    definition: 'Compute the naive aggregate, then per-segment rates + weights on PRE-DECLARED eligibility segments; standardize current rates to prior mix and prior rates to current mix; report whether the headline direction holds. A reversal ⇒ a mix / Simpson read. Pre-declare segments. Warehouse-computable.',
    nulls: ['topline_invariant_to_mix_standardization'], direction: 'higher', established: false },
  { id: 'experiment_assignment_balance', title: 'Experiment assignment balance (SRM)', question: 'Does the realized arm assignment match the design?',
    definition: 'Compare realized arm sizes to the designed split and check bucket stickiness / re-assignment over the exposure window; a sample-ratio mismatch ⇒ a broken assignment or logging that invalidates the read-out. Warehouse-computable from assignment logs.',
    nulls: ['assignment_matches_design'], direction: 'higher', established: false },
  { id: 'realized_exposure_contamination', title: 'Realized treatment exposure / contamination', question: 'Did the treatment actually reach the assigned arm, and is the control uncontaminated?',
    definition: 'Beyond assignment balance: measure realized treatment DELIVERY to the assigned arm, cross-device / shared-identity bleed, and control-arm contamination (control units that received the treatment). Balanced assignment alone does not establish the arms differ ONLY by the intended exposure. Warehouse-computable from assignment + delivery logs.',
    nulls: ['realized_exposure_matches_assignment'], direction: 'higher', established: false },
  { id: 'readout_multiplicity', title: 'Read-out multiplicity vs registry', question: 'Is the result one registered read, or chosen from many metrics/windows/segments after launch?',
    definition: 'Diff the registry-declared primary metric / exposure unit / window / segments against what the published read-out used; recompute the FIRST eligible read-out from raw logs. Measure registry-vs-actual mismatch + post-exposure choice — do not label intent.',
    nulls: ['registered_single_readout'], direction: 'lower', established: false },
  { id: 'cohort_denominator_churn', title: 'Cohort denominator integrity', question: 'Is the cohort denominator frozen at eligibility time (no survivorship)?',
    definition: 'Rebuild the raw eligibility cohort as of the eligibility timestamp BEFORE the outcome window; trace units later missing/deleted/censored; recompute with documented censoring only and diff vs the reported rate. Warehouse-computable.',
    nulls: ['frozen_eligibility_denominator'], direction: 'lower', established: false },
  { id: 'attribution_window_divergence', title: 'Attribution-window divergence', question: 'Does attribution resolve to ONE centralized window / source-priority across surfaces?',
    definition: 'Compare the documented/configured attribution window + source-priority across surfaces (not cherry-picked alternatives); count surfaces with duplicated last-touch logic and divergent window/priority constants. Code + warehouse computable.',
    nulls: ['single_attribution_window'], direction: 'lower', established: false },
  { id: 'dashboard_source_control_coverage', title: 'Published-asset reviewability', question: 'Are decision dashboards / saved queries version-controlled or hash-stable?',
    definition: 'Inventory decision-gating dashboards/saved queries; share that are version-controlled or exportable with a stable query hash (reproducible) vs ad-hoc/unpinned. Code-computable.',
    nulls: ['published_assets_are_reviewable'], direction: 'higher', established: false },
];

export const analytics: ExpertBundle = bundle({
  id: 'analytics', title: 'Analytics / metric trust',
  activationSignals: ['dashboard', 'looker', 'tableau', 'metric', 'kpi', 'north star', 'funnel', 'cohort', 'retention', 'attribution', 'analytics', 'amplitude', 'mixpanel', 'experiment analysis'],
  lens: `ANALYTICS / METRIC-TRUST PROFILE (dashboards / experiment read-outs / KPIs). Value-free methods — each: suspicion → decisive probe → metric → floor → interpret. Measure DEGREES OF FREEDOM + reconstruction, never label intent:
- DEFINITION CONSISTENCY: does a headline metric resolve to ONE definition end-to-end? Reconstruct from raw and diff every surface; enumerate divergent filter/denominator/window. Allow intentionally versioned variants — only same-name + same-decision + divergent logic is the defect.
- CROSS-SOURCE AGREEMENT: reconcile the same quantity from two independent sources on a shared key; a gap beyond sampling noise is the defect.
- SEGMENT-MIX DECOMPOSITION: does a flat/moving topline survive a fixed-mix + within-segment read on PRE-DECLARED segments? A standardized reversal is a Simpson/mix read. Don't segment-shop.
- EXPERIMENT INTEGRITY: assignment balance (SRM) + bucket stickiness; then registry-vs-actual read-out (metric/unit/window/segments) recomputed from the first eligible read — the issue is analytical degrees of freedom, not intent.
- COHORT DENOMINATOR: is eligibility frozen BEFORE the outcome window? An outcome-dependent denominator manufactures survivorship.
- ATTRIBUTION: compare the documented/configured window + source-priority across surfaces (not cherry-picked windows); duplicated last-touch with divergent constants is the defect.
- EXPLAINABLE CHANGE: align metric change-points to a ship/config/definition log; an unexplained step ⇒ silent calc change.
- PROVENANCE & GATING: a decision-gating analysis must reproduce from raw + a pinned, version-controlled query, and decision dashboards must be version-controlled / hash-stable.
Discover + evidence every issue; measure against a floor you compute. Import no number from this text.`,
  patterns: [metricDefinedTwoWays, segmentMixDecomposition, registeredReadoutIntegrity, frozenCohortDenominator],
  metricLibrary: analyticsLib,
  structuralChecks: ANALYTICS_INVARIANTS,
});

// ── TRUST & SAFETY ───────────────────────────────────────────────────────────────────────────
const tsLib: MetricSpec[] = [
  { id: 'exposed_before_review_rate', title: 'Exposed-before-review rate', question: 'What share of exposed content reached users before any moderation decision?',
    definition: 'Join exposures to the moderation-decision timeline; impression-weighted share of exposures whose item had no decision (or a later one) at exposure time. Segment by content age. Warehouse-computable.',
    nulls: ['policy_review_sla'], direction: 'lower', established: false },
  { id: 'moderation_coverage', title: 'Moderation coverage', question: 'What share of decision-eligible content (and engagement volume) is actually reviewed?',
    definition: 'Reviewed items / decision-eligible items, and the same weighted by impressions; a high item-coverage with low impression-coverage hides an exposed tail.',
    nulls: ['policy_target_coverage'], direction: 'higher', established: false },
  { id: 'policy_enforcement_gap', title: 'Policy ↔ enforcement gap', question: 'Does enforcement match the written policy, or has it drifted?',
    definition: 'Sample items against each written rule; rate of rule-violating items that passed (false-negative) and compliant items blocked (false-positive).',
    nulls: ['written_policy'], direction: 'lower', established: false },
  { id: 'gating_correctness', title: 'Age / region gating correctness', question: 'Is restricted content correctly gated by age/region at serving time?',
    definition: 'Sample restricted items served to ineligible cohorts (age/region) per the gating rule. For a HARD gate whose policy declares zero tolerance (age/region), any non-zero leak is the defect; for a soft/SLA policy, measure against the declared SLA, not zero. Warehouse-computable.',
    nulls: ['zero_ineligible_exposure_for_hard_gate', 'within_policy_sla_for_soft'], direction: 'lower', established: false },
  // ── deeper decisive metrics (distilled with codex) — appeals are not ground truth; use the policy SLA null ──
  { id: 'decision_stability_under_review', title: 'Decision stability under review', question: 'Are enforcement decisions stable under independent re-review for the same policy + evidence?',
    definition: 'Join enforcement → appeal → reversal by policy/model/reviewer/queue and measure appeal opportunity + selection; then a BLINDED, stratified re-review that INCLUDES un-appealed decisions. Appeal rate alone is a selected, biased proxy — pair it with the blind re-review. Warehouse + sampling.',
    nulls: ['decision_stability_under_independent_review'], direction: 'higher', established: false },
  { id: 'blind_rereview_disagreement', title: 'Blind re-review disagreement', question: 'How often does an independent blinded reviewer disagree on the same policy version + evidence?',
    definition: 'Stratified blind re-review of past decisions (actioned + not-actioned); rate of disagreement with the original decision under the same policy version. A high rate ⇒ inconsistent enforcement, independent of appeal volume.',
    nulls: ['policy_consistent_rereview'], direction: 'lower', established: false },
  { id: 'repeat_evasion_exposure', title: 'Repeat / evasion exposure', question: 'Do actioned items/accounts recur under new ids and reach users before re-action?',
    definition: 'Link successors via available signals (content/perceptual hash, text, account, device, payment, IP); timeline action → linked re-upload → review → exposure; recurrence reaching users before the applicable block/review. Use only defensible linkage. Warehouse-computable.',
    nulls: ['enforcement_closure'], direction: 'lower', established: false },
  { id: 'post_report_exposure_latency', title: 'Post-report exposure latency', question: 'After a report/flag, does content keep reaching users beyond the policy SLA?',
    definition: 'From report/flag time to action time, impression-weighted exposure accrued past the declared policy SLA window; segment by content age. Measured against the SLA null, not zero. Warehouse-computable.',
    nulls: ['no_post_report_exposure_beyond_policy_sla'], direction: 'lower', established: false },
  { id: 'decision_provenance_coverage', title: 'Decision provenance coverage', question: 'Does every moderation decision log the provenance needed to audit it?',
    definition: 'Share of decision records carrying policy_version, model_version, queue/reviewer source, threshold/config version, and appeal linkage. Missing provenance ⇒ a decision cannot be tied to the policy+model that made it. Warehouse-computable.',
    nulls: ['decision_provenance_complete'], direction: 'higher', established: false },
  { id: 'reach_weighted_later_removed_exposure', title: 'Reach-weighted later-removed exposure', question: 'How much reach did content that was LATER removed accrue while live?',
    definition: 'For items eventually actioned, the impression/reach accrued before action, weighted by reach, vs the policy SLA; isolates the scaled-harm tail that an item-count coverage number hides. Warehouse-computable.',
    nulls: ['no_actioned_content_exposure_outside_policy_sla'], direction: 'lower', established: false },
];

export const trustSafety: ExpertBundle = bundle({
  id: 'trust-safety', title: 'Trust & safety',
  activationSignals: ['moderation', 'trust and safety', 'trust & safety', 'abuse', 'nsfw', 'toxicity', 'content policy', 'safety', 'flagged', 'csam', 'harmful', 'age gating'],
  lens: `TRUST & SAFETY PROFILE (moderation / policy enforcement / harmful-content exposure). Value-free methods — each: suspicion → decisive probe → metric → floor → interpret. Use the POLICY SLA as the null (not zero, except hard gates); appeals are not ground truth:
- EXPOSURE BEFORE REVIEW: join exposures to the moderation-decision timeline; impression-weighted share exposed before any decision is the scale path — but only a defect where policy REQUIRES pre-review; otherwise measure against the SLA.
- REACH-WEIGHTED LATER-REMOVED EXPOSURE: for items eventually actioned, reach accrued before action vs the SLA — the scaled-harm tail an item-count coverage number hides.
- COVERAGE (item vs impression): reviewed/eligible and the same impression-weighted; high item-coverage with low impression-coverage hides an exposed tail.
- DECISION STABILITY: appeal→reversal joined + a BLINDED stratified re-review including un-appealed decisions; appeal rate alone is a selected proxy.
- ENFORCEMENT CLOSURE vs EVASION: link successors (hash/account/device/IP); do actioned items recur under new ids and reach users before re-action? Per-id action volume can hide reachable repeats.
- POLICY ↔ ENFORCEMENT DRIFT: sample against each written rule; false-negative (violating passed) + false-positive (compliant blocked) rates.
- GATING CORRECTNESS: restricted content served to ineligible age/region cohorts — for a hard zero-tolerance gate any leak is the defect; for soft policy, measure vs the SLA.
- SAFETY-LABEL FEEDBACK INTEGRITY: is a safety label/score used ONLY as a documented eligibility constraint, or also as a ranking/training optimization input? Direction-free — undocumented optimization use is the smell, not the label's presence.
- DECISION PROVENANCE: every decision should log policy_version, model_version, reviewer/queue, threshold/config version, appeal linkage — else it cannot be audited.
Discover + evidence every issue; measure against a floor you compute. Import no number from this text.`,
  patterns: [moderationCoverageGap, appealReversalStability, safetyLabelFeedbackLoop, evasionClosure],
  metricLibrary: tsLib,
  structuralChecks: TS_INVARIANTS,
});

// ── SOFTWARE ARCHITECTURE & CODE HEALTH — the code-native bundle for orgs whose PRODUCT is a codebase
// (game engine / SDK / library / framework / app) with no data plane to audit. Its measurement planes are
// the code-native ones: the codeintel index (dependency graph / hotspots / co-change / health / dead code),
// the pre-computed git digest, and the clone itself — NOT the warehouse. ─────────────────────────────────
const swArchLib: MetricSpec[] = [
  { id: 'change_amplification', title: 'Change amplification (modules per logical change)', question: 'Does one logical change stay inside its module, or fan out across the codebase?',
    definition: 'Cluster commits into logical changes (same author+window or explicit change id) and measure modules/repos touched per change over a multi-window sample; overlay the dependency fan of the recurring shared files to name the amplifier. Codeintel/git-digest-computable (co-change pairs + dependency graph).',
    nulls: ['changes_contained_within_module_boundary'], direction: 'lower', established: false },
  { id: 'cross_boundary_cycle_count', title: 'Cross-boundary dependency cycles', question: 'Is the dependency graph acyclic across the org\'s DECLARED module boundaries?',
    definition: 'Recover the declared boundaries (module/package layout, build targets, docs), build the import/include graph, and count cycles that cross a declared boundary (a cycle inside one leaf module does not count). Codeintel-computable (workspace architecture/cycles), else grep imports.',
    nulls: ['acyclic_across_declared_boundaries'], direction: 'lower', established: false },
  { id: 'layering_direction_violations', title: 'Layering direction violations', question: 'Do dependency edges follow the layering the org itself declares (e.g. core never imports editor/tools)?',
    definition: 'From the declared layering, count edges pointing AGAINST the declared direction, with the concrete import sites. Only a boundary the org itself declares can be violated. Codeintel/code-computable.',
    nulls: ['edges_follow_declared_direction'], direction: 'lower', established: false },
  { id: 'hotspot_churn_complexity', title: 'Hotspot churn × complexity concentration', question: 'Is change concentrated in files that are also the worst-structured, and is that set worsening?',
    definition: 'Rank files by churn (git) × complexity/health (codeintel defect-calibrated score); measure the concentration of total churn in the worst-health set and its trend across windows. Codeintel-computable (get_risk/get_health + hotspots). GIT-BEHAVIORAL caveat: churn/co-change need an actively-developed history — mark low-confidence on a shallow or squashed clone.',
    nulls: ['hotspot_health_stable'], direction: 'lower', established: false },
  { id: 'fix_density_test_gap_overlap', title: 'Fix-dense files without tests', question: 'Are the files where defect-fixing concentrates covered by tests that change with them?',
    definition: 'Overlay fix-commit density (bug/fix-labelled commits per file) with test co-change (any test file changing alongside); measure the share of fix-dense files with NO co-changing or referencing test. Size/age alone never qualifies a file. Codeintel/git-digest-computable.',
    nulls: ['fix_dense_files_are_tested'], direction: 'lower', established: false },
  { id: 'internal_dead_code_share', title: 'Internal dead-code share', question: 'How much INTERNAL (non-exported) code has no inbound references yet is still maintained?',
    definition: 'From the reference graph, the share of internal files/symbols with no inbound references and no recent change — EXCLUDING the exported public API surface (an SDK\'s exports are consumed outside the repo and are NOT dead). Codeintel-computable (get_dead_code) with the export carve-out applied.',
    nulls: ['no_maintained_internal_dead_weight'], direction: 'lower', established: false },
  { id: 'divergent_duplicate_fixes', title: 'Divergent duplicates (one-sided fixes)', question: 'Does the same logic live in parallel copies where a fix landed in one copy only?',
    definition: 'Detect duplicated implementation clusters (copy-paste similarity), then check git history for fixes that landed in one copy but not its twins; count one-sided fixes with the divergent diff as evidence. Code+git-computable.',
    nulls: ['no_one_sided_fix_in_duplicates'], direction: 'lower', established: false },
  { id: 'ownership_concentration_critical_path', title: 'Ownership concentration on the critical path', question: 'Is critical-path code (high fan-in) effectively single-author?',
    definition: 'Per-module recent-author concentration from git history, intersected with dependency fan-in (criticality); the share of critical-path modules whose recent changes come from one author. Where an author departed, compare fix latency/revert rate on their modules before vs after. Git-digest/codeintel-computable.',
    nulls: ['critical_path_plural_ownership'], direction: 'lower', established: false },
  { id: 'god_module_fan_ratio', title: 'God-module fan ratio', question: 'Does one module\'s fan-in + fan-out outrun the rest of the graph so far that every change routes through it?',
    definition: 'Fan-in + fan-out per module vs the graph median; identify modules an order beyond the norm and overlay their co-change footprint (do changes elsewhere drag them in). Codeintel-computable (dependency graph + co-change).',
    nulls: ['fan_within_graph_norm'], direction: 'lower', established: false },
];

export const sweArch: ExpertBundle = bundle({
  id: 'swe-arch', title: 'Software architecture & code health',
  activationSignals: ['game engine', 'rendering engine', 'sdk', 'framework', 'monorepo', 'refactor', 'tech debt', 'technical debt', 'code health', 'code quality', 'coupling', 'dead code', 'legacy code', 'bus factor', 'c++'],
  lens: `SOFTWARE-ARCHITECTURE / CODE-HEALTH PROFILE (engine / SDK / library / app codebases). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The decisive move is an OVERLAY of independent signals (churn × defect-fixes × tests × dependency graph) measured against the org's OWN declared architecture — never "big/old/complex = bad" alone. Measurement planes are code-native: the codeintel index (dependency graph, hotspots, co-change, health, dead code), the pre-computed git digest, and the clone itself:
- CHANGE AMPLIFICATION: do logical changes stay inside their declared module, or fan out? Co-change sets from history + the dependency fan of the recurring shared files name the amplifier.
- BOUNDARY EROSION: recover the DECLARED layering (module layout, build targets, docs) and test it — cross-boundary cycles + direction-violating edges, with concrete import sites. A cycle inside one leaf module is not a defect; an undeclared boundary you inferred cannot be violated.
- HOTSPOT RISK OVERLAY: churn × complexity/health × fix-commit density × test co-change. The defect is the INTERSECTION (fix-dense, worst-health, untested), not any single signal.
- DEAD WEIGHT & DUPLICATES: internal unreferenced code still being maintained, and duplicated logic where a fix landed one-sided. For an SDK/engine the EXPORTED public surface is consumed outside the repo — exports with no in-repo caller are NOT dead code.
- OWNERSHIP / BUS FACTOR: single-author concentration on high-fan-in modules; after a departure, fix latency + revert rate on their modules is the readable consequence.
- GIT-SIGNAL CONFIDENCE: churn/co-change/ownership need real history — on a shallow, squashed, or import-only clone mark them low-confidence and lean on the static graph instead.
Discover + evidence every issue; measure against a floor you compute from THIS system. Import no number from this text.`,
  patterns: [changeAmplification, boundaryErosionCycles, hotspotDefectAdjacency, busFactorCriticalPath],
  metricLibrary: swArchLib,
  structuralChecks: SW_INVARIANTS,
});

// ── BUILD / CI / RELEASE ENGINEERING — the delivery-pipeline bundle. Its null is always the org's OWN
// declared gate/cadence (never an imported industry number); its measurement planes are the repo-metadata
// plane (CI runs / releases / tags via the GitHub API), the git digest, and the CI/build config in the clone. ──
const releaseEngLib: MetricSpec[] = [
  { id: 'ci_pass_rate', title: 'Default-branch CI pass rate', question: 'How often is the default branch\'s required pipeline actually green?',
    definition: 'Share of default-branch runs of the REQUIRED workflows that concluded green, per workflow over a multi-window sample. Repo-metadata-computable (CI run history); read against the org\'s declared gate, not an external benchmark.',
    nulls: ['green_at_declared_gate'], direction: 'higher', established: false },
  { id: 'retry_to_green_rate', title: 'Retry-to-green (flake) rate', question: 'How often does a re-run flip the verdict with no code change?',
    definition: 'Share of runs whose conclusion changed on re-run of the SAME commit (run_attempt beyond the first that flipped red→green), per workflow and over time. Repo-metadata-computable.',
    nulls: ['rerun_does_not_change_verdict'], direction: 'lower', established: false },
  { id: 'time_to_green', title: 'Time to green', question: 'How long from push/PR to a green required-check verdict?',
    definition: 'Median latency from head-commit push to the last required check turning green, over a multi-window sample; separate queue wait from run time where the data allows. Repo-metadata-computable; the floor is the org\'s own declared turnaround, if any.',
    nulls: ['within_declared_turnaround'], direction: 'lower', established: false },
  { id: 'build_duration_trend', title: 'Build duration trend (same targets)', question: 'Is the build getting slower for the SAME work, or just building more?',
    definition: 'Duration trend per workflow/job over windows, normalized for matrix/target growth (a longer build that builds MORE is not a defect); flag same-target drift. Repo-metadata-computable.',
    nulls: ['duration_stable_per_target'], direction: 'lower', established: false },
  { id: 'quarantined_test_debt', title: 'Quarantined-test debt', question: 'How many tests are skipped/disabled, how old are the quarantines, and who owns them?',
    definition: 'Inventory skip/disable/quarantine markers + CI exclude lists from the clone; per entry, age (disabling commit) and ownership (linked issue). The defect is the silent, unowned, ageing quarantine — an owned, time-bounded skip is process working. Code+git-computable.',
    nulls: ['quarantines_owned_and_time_bounded'], direction: 'lower', established: false },
  { id: 'merge_gate_bypass_share', title: 'Merge-gate bypass share', question: 'What share of default-branch merges landed without the declared gate green?',
    definition: 'Cross-reference default-branch merges against required-check conclusions at merge time; enumerate the bypass paths actually used (admin merge, non-required check, path filter). Repo-metadata-computable. A documented, rare emergency bypass is not a defect; routine/silent bypass is.',
    nulls: ['declared_gate_held'], direction: 'lower', established: false },
  { id: 'post_release_regression_density', title: 'Post-release regression density', question: 'Do reverts/hotfixes cluster right after releases (users find what the gate missed)?',
    definition: 'Density of revert/hotfix commits in the window after each release vs the between-release baseline, over multiple releases (never judge one incident). Git-digest/repo-metadata-computable (tags + commit history).',
    nulls: ['post_release_fix_density_at_baseline'], direction: 'lower', established: false },
  { id: 'release_cadence_regularity', title: 'Release cadence vs declared rhythm', question: 'Does the org release on the rhythm it declares, or in irregular bursts?',
    definition: 'Inter-release intervals from tags/releases vs the DECLARED cadence (release docs/train schedule); irregularity only counts against a declared rhythm — "no declared cadence" is a doc gap, tracked separately. Repo-metadata-computable.',
    nulls: ['matches_declared_cadence'], direction: 'higher', established: false },
  { id: 'version_increment_discipline', title: 'Version-increment discipline', question: 'Do version increments match the change surface (breaking changes ride majors, not patches)?',
    definition: 'For each release pair, compare the version increment against breaking-change signals (changelog "breaking" entries, public-API surface diffs, migration notes); count breaking changes shipped under a patch/minor increment per the org\'s declared scheme. Git-computable from tags + the public surface.',
    nulls: ['increments_match_declared_scheme'], direction: 'higher', established: false },
  { id: 'build_input_pinning_coverage', title: 'Release-path input pinning', question: 'Is the release build a pure function of the tag — every input pinned?',
    definition: 'Inventory release-path build inputs (manifests vs committed lockfiles, image tags vs digests, CI action refs vs SHAs, toolchain declarations, fetch-at-build steps) and measure the pinned share. Severity follows the release path; a deliberately-floating input under a documented update policy is process, not drift. Code-computable.',
    nulls: ['release_path_inputs_pinned'], direction: 'higher', established: false },
];

export const releaseEng: ExpertBundle = bundle({
  id: 'release-eng', title: 'Build / CI / release engineering',
  activationSignals: ['github actions', 'ci/cd', 'continuous integration', 'jenkins', 'buildkite', 'circleci', 'gitlab ci', 'flaky', 'build system', 'build time', 'cmake', 'bazel', 'gradle', 'release process', 'release train', 'release cadence', 'semver', 'toolchain', 'nightly'],
  lens: `BUILD / CI / RELEASE-ENGINEERING PROFILE (delivery pipeline). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The NULL is always the org's OWN declared gate / cadence / scheme — never an imported industry number. Measurement planes: the repo-metadata plane (CI run history, releases, tags via the GitHub API), the git digest, and the CI/build config in the clone:
- CI SIGNAL INTEGRITY: is green a stable verdict on the same commit, or a negotiated outcome? Retry-to-green share on unchanged commits + the quarantine ledger (each entry's age + owner) settle it.
- MERGE-GATE INTEGRITY: establish the DECLARED gate (CI config + contribution docs), then cross-check merges against it — share of default-branch merges green at merge time, and which bypass paths get used. A documented rare emergency bypass is process; routine/silent bypass is the defect.
- REGRESSION DETECTION LOCUS: do reverts/hotfixes cluster after releases (users are the test environment) or spread at the baseline rate? Multi-release windows, never one incident.
- BUILD PERFORMANCE: same-target duration trend — building MORE is not a defect; the same work getting slower is.
- REPRODUCIBILITY & PINNING: is the release build a pure function of the tag? Inventory lockfiles / image digests / action SHAs / toolchain pins on the RELEASE path; dev-convenience workflows rank lower.
- VERSION DISCIPLINE: breaking-change signals vs the increments the org's own scheme declares; "no declared cadence/scheme" is a documentation gap, tracked separately from a violated one.
Discover + evidence every issue; measure against the org's own declared floor. Import no number from this text.`,
  patterns: [retryUntilGreen, mergeGateBypass, releaseThenRevert, unpinnedBuildInputs],
  metricLibrary: releaseEngLib,
  structuralChecks: RE_INVARIANTS,
});

// ── API STABILITY / SDK DEVX — for orgs whose PRODUCT is an SDK/engine/library/framework: the public API
// surface is the north-star asset. Measurement planes: the repometa plane's tag-to-tag compare (public-surface
// diffs between releases), releases/changelog metadata, and the clone (exports, markers, docs, examples).
// The null is ALWAYS the org's own declared versioning/deprecation contract. ────────────────────────────────
const apiStabilityLib: MetricSpec[] = [
  { id: 'public_api_churn_per_release', title: 'Public-surface churn per release', question: 'How much of the public API surface changes per release, and is the rate compatible with the declared stability promise?',
    definition: 'Between consecutive release tags, the share of public-surface files/symbols (exported headers / d.ts / public modules) touched, split into additions vs removals/renames/signature changes. Repo-metadata-computable (tag-to-tag compare) + clone (what counts as public).',
    nulls: ['churn_compatible_with_declared_stability'], direction: 'lower', established: false },
  { id: 'breaking_change_nonmajor_count', title: 'Breaking changes under non-breaking increments', question: 'Do removals/renames/signature changes ship only under the increment the org\'s scheme declares for breaking changes?',
    definition: 'Classify each public-surface removal/rename/signature change between tag pairs against the version increment per the org\'s DECLARED scheme; count breaks riding patch/minor. No declared scheme = documentation gap, tracked separately. Repo-metadata + clone computable.',
    nulls: ['breaking_only_under_declared_increment'], direction: 'lower', established: false },
  { id: 'deprecation_window_adherence', title: 'Deprecation-window adherence', question: 'Are public symbols removed only after their declared deprecation window, with a migration note?',
    definition: 'The deprecated→removed ledger from git history across releases: per removed public symbol — marked first? for how many releases? migration note present? Measures BOTH failure directions (removal-without-marking + marking-then-immediate-removal). Git/repo-metadata-computable.',
    nulls: ['removals_follow_declared_window'], direction: 'higher', established: false },
  { id: 'immortal_deprecation_share', title: 'Immortal-deprecation share', question: 'Do deprecations actually retire, or accumulate as permanent double surface?',
    definition: 'Share of currently-deprecated public symbols older than the declared window (or several release cycles when none is declared) with no removal plan; the maintenance double-surface the marker was supposed to bound. Clone + git computable.',
    nulls: ['deprecations_time_bounded'], direction: 'lower', established: false },
  { id: 'api_docs_coverage', title: 'Public-surface documentation coverage', question: 'What share of the reachable public surface is documented (or explicitly tiered internal)?',
    definition: 'Enumerate exported/public symbols from the code; the share covered by the API reference / doc comments, with the undocumented remainder classified (deliberately internal vs accidentally public). Clone-computable.',
    nulls: ['public_surface_documented_or_tiered'], direction: 'higher', established: false },
  { id: 'example_coverage_public_modules', title: 'Example coverage of public modules', question: 'Are the public modules users start from exercised by shipped examples/samples?',
    definition: 'Share of top-level public modules/subsystems referenced by at least one shipped example/sample/tutorial; the entry-path coverage that determines whether users learn from docs or from source. Clone-computable.',
    nulls: ['entry_modules_example_covered'], direction: 'higher', established: false },
  { id: 'changelog_completeness', title: 'Release-note completeness for API changes', question: 'Does every public-surface-touching change between releases appear in the release notes?',
    definition: 'Reconcile the tag-to-tag public-surface diff against the release notes/changelog entries; share of API-touching changes that are noted. Repo-metadata-computable (compare + releases).',
    nulls: ['api_changes_release_noted'], direction: 'higher', established: false },
  { id: 'stability_tier_marking', title: 'Stability-tier marking coverage', question: 'Are experimental/unstable APIs marked as such everywhere users meet them (code, docs, examples)?',
    definition: 'Share of non-stable public APIs carrying an explicit tier marker at their definition AND in docs/examples that reference them; unmarked experimental surface presented as stable is the defect. Clone-computable.',
    nulls: ['tiers_marked_at_every_touchpoint'], direction: 'higher', established: false },
];

export const apiStability: ExpertBundle = bundle({
  id: 'api-stability', title: 'Public API stability / SDK DevX',
  activationSignals: ['sdk', 'public api', 'semver', 'breaking change', 'deprecat', 'api stability', 'api reference', 'plugin api', 'game engine', 'framework', 'migration guide', 'changelog'],
  lens: `API-STABILITY / SDK-DEVX PROFILE (the product IS an SDK / engine / library — the public API surface is the north-star asset). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The NULL is always the org's OWN declared versioning/deprecation contract; a missing contract is a documentation gap, tracked separately from a violation. Measurement planes: the repo-metadata plane's tag-to-tag compare (public-surface diffs between releases), releases/changelog metadata, and the clone (exports, tier markers, docs, examples):
- SURFACE EXPLICITNESS: recover the DECLARED public surface and diff it against what users can actually reach; unmarked internal-but-reachable code and experimental APIs presented as stable are the defects.
- BREAKING-CHANGE DISCIPLINE: classify every public-surface removal/rename/signature change between consecutive tags against the increment the org's scheme declares for it. Additions under a minor are fine in semver-like schemes.
- DEPRECATION CONTRACT: the deprecated→removed ledger — marked first, for the declared window, with a migration note. Both failure directions count: removal-without-marking AND immortal deprecations that never retire.
- DOCS AS THE CONTRACT: exported surface vs documented surface (the undocumented remainder classified, not just counted), example coverage of the entry modules, and release-note completeness for API-touching diffs.
- ECOSYSTEM CONSEQUENCE: where evidence exists (issues, pinned-version patterns in downstream manifests), read whether users upgrade or pin — the observable price of a broken upgrade contract.
Discover + evidence every issue; measure against the org's own declared floor. Import no number from this text.`,
  patterns: [breakingChangeInMinor, deprecationWithoutWindow, undocumentedPublicSurface, silentApiChange],
  metricLibrary: apiStabilityLib,
  structuralChecks: AS_INVARIANTS,
});

// ── APPLICATION SECURITY / SUPPLY CHAIN — defensive posture ONLY: inventory, provenance, coverage; never
// exploitation. Measurement planes: the clone (lockfiles, CI/build config, vendored artifacts, parser
// surfaces), the OSV advisory plane (known-vuln lookup for locked versions — public, read-only), and the
// repo-metadata plane. Overlap note: release-eng's re2 owns build REPRODUCIBILITY; sc1 owns supply-chain
// INTEGRITY — cross-referenced, not duplicated. ──────────────────────────────────────────────────────────────
const appsecLib: MetricSpec[] = [
  { id: 'known_vuln_release_path', title: 'Known-vuln exposure on the release path', question: 'Which locked dependency versions shipping in the release artifact carry publicly-known vulnerabilities, at what severity?',
    definition: 'Resolve the locked dependency set (lockfiles / vendored manifests), query it against a public advisory database (the OSV plane), and weight by severity and by release-artifact vs dev-only reach. This IS a live measurement on the OSV plane. Null honors the org\'s declared patch window.',
    nulls: ['no_high_severity_on_release_path_beyond_window'], direction: 'lower', established: false },
  { id: 'fix_adoption_lag', title: 'Security-fix adoption lag', question: 'When a fixed version exists for a known vuln, how long until the lock adopts it?',
    definition: 'Per advisory affecting a locked version: the interval from fixed-version-available (advisory data) to lock update (git history of the lockfile); the exposure is the lag, not the bug. OSV + git computable.',
    nulls: ['fixes_adopted_within_declared_window'], direction: 'lower', established: false },
  { id: 'lockfile_coverage', title: 'Lockfile coverage of manifests', question: 'Is the shipped dependency set knowable — does every release-path manifest have a committed lockfile?',
    definition: 'Share of dependency manifests on the release path with a committed, current lockfile; an unlocked manifest means the shipped set changes per build and advisories cannot be evaluated against it. Clone-computable.',
    nulls: ['release_path_manifests_locked'], direction: 'higher', established: false },
  { id: 'fetch_execute_sites', title: 'Unverified fetch-and-execute sites', question: 'Where does the build/release path download and run remote content without verification?',
    definition: 'Inventory curl|sh, unpinned installer downloads, floating action/image tags across CI/build/bootstrap scripts; classify pinned+verified (SHA/digest/checksum) vs unverified, release-path vs dev-only. Clone-computable.',
    nulls: ['no_unverified_fetch_execute_on_release_path'], direction: 'lower', established: false },
  { id: 'vendored_artifact_provenance', title: 'Vendored-artifact provenance coverage', question: 'Can every vendored binary/blob/fork be traced to an origin and verified?',
    definition: 'Share of vendored binaries / prebuilt bundles / forked third-party dirs carrying recorded origin+version, checksum/attestation, and license; a CI-rebuilt-and-verified artifact counts as attested by construction. Clone-computable.',
    nulls: ['vendored_artifacts_attested'], direction: 'higher', established: false },
  { id: 'diverged_fork_upstream_debt', title: 'Diverged-fork upstream security debt', question: 'Have silently-forked third-party components missed security fixes their upstream has since shipped?',
    definition: 'For each vendored fork: divergence point (git/provenance), then upstream advisories/fixes published after that point that the fork has not absorbed. OSV + repo-metadata computable where the upstream is public.',
    nulls: ['forks_track_upstream_security_fixes'], direction: 'lower', established: false },
  { id: 'untrusted_surface_fuzz_coverage', title: 'Untrusted-input surface coverage', question: 'Which untrusted-input entry points (parsers/decoders/loaders) have fuzz/sanitizer coverage or documented risk acceptance?',
    definition: 'Map untrusted-input entry points from the code; per surface, fuzz harness / sanitizer CI / documented acceptance presence, prioritized by exposure. Enumeration + coverage only — never exploitation. Clone-computable.',
    nulls: ['exposed_surfaces_covered_or_accepted'], direction: 'higher', established: false },
  { id: 'shipped_default_safety', title: 'Shipped-default safety', question: 'Do the config templates and quickstart samples the org ships default to safe settings?',
    definition: 'Scan shipped config templates + samples/quickstarts for unsafe defaults (debug endpoints exposed, permissive CORS, auth off, world-readable storage) — for an SDK the sample IS what users deploy. Clone-computable.',
    nulls: ['samples_default_safe'], direction: 'higher', established: false },
  { id: 'advisory_intake_presence', title: 'Advisory-intake presence', question: 'Does ANY process consume security advisories for the locked set (bot, audit job, documented review)?',
    definition: 'Presence + recency of an advisory intake: dependency-update bot config, scheduled audit jobs, a documented review cadence, security policy files; "no intake at all" is the structural defect independent of today\'s vuln count. Clone-computable.',
    nulls: ['advisory_intake_exists'], direction: 'higher', established: false },
];

export const appsec: ExpertBundle = bundle({
  id: 'appsec', title: 'Application security / supply chain',
  activationSignals: ['security', 'vulnerabilit', 'cve', 'supply chain', 'dependabot', 'lockfile', 'sbom', 'fuzz', 'sanitizer', 'owasp', 'security policy', 'vendored'],
  lens: `APPLICATION-SECURITY / SUPPLY-CHAIN PROFILE. DEFENSIVE posture only: inventory, provenance, and coverage — never exploitation, never a proof-of-concept. Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The NULL honors the org's OWN declared policy (patch window, risk acceptances) where one exists. Measurement planes: the clone (lockfiles, CI/build config, vendored artifacts, parser surfaces), the OSV advisory plane (known-vuln lookup for locked versions), and the repo-metadata plane:
- KNOWN-VULN DEBT: resolve the LOCKED set and query the advisory database; weight by severity and release-artifact reach. The exposure is the ADOPTION LAG (fix available → lock updated), not the bug's existence.
- LOCKABILITY: an unlocked release-path manifest means the shipped set is unknowable and advisories cannot even be evaluated — a structural defect independent of today's vuln count.
- FETCH-AND-EXECUTE: inventory every site where the build/release path runs remote content (curl|sh, unpinned installers, floating tags); one unverified site is a write primitive into the shipped artifact. Release-path severity first; re2 (release-eng) owns the reproducibility framing — cross-reference, don't duplicate.
- VENDORED PROVENANCE: every blob/fork traceable + verifiable; a diverged silent fork is compound — it also blocks upstream's security fixes from arriving.
- UNTRUSTED-INPUT COVERAGE: map the parser/decoder/loader surfaces consuming untrusted input (for an engine: the asset pipeline) and cross with fuzz/sanitizer/risk-acceptance coverage. Enumerate + measure; NEVER attempt exploitation.
- SHIPPED DEFAULTS: the config templates and samples users copy ARE the deployed posture for an SDK's ecosystem.
Discover + evidence every issue; measure against the org's own declared floor. Import no number from this text.`,
  patterns: [knownVulnDependencyDebt, fetchAndExecuteSupplyChain, vendoredBlobProvenance, untrustedInputFuzzGap],
  metricLibrary: appsecLib,
  structuralChecks: SC_INVARIANTS,
});

// ── MOBILE-iOS — the code-native bundle for a shippable iOS APP (not an SDK/library, which routes to
// api-stability/swe-arch). Measurement planes are code-native: the clone (Swift/ObjC + Info.plist/entitlements/
// build config), the codeintel index (reachability overlays), the git digest, and the repometa plane. The null is
// the app's OWN declared intent or the platform's PUBLISHED contract (mobilePlatformContract.ts) — never a fixture's
// number. Every metric is framework-agnostic (SwiftUI/UIKit/ObjC · SPM/CocoaPods/Carthage · XcodeGen/raw-pbxproj). ──
const mobileIosLib: MetricSpec[] = [
  { id: 'ios_main_io_confinement', title: 'Main-thread I/O confinement', question: 'Is I/O reachable from a render/lifecycle path confined off the main actor/queue?',
    definition: 'Enumerate I/O surfaces (network/file/DB/keychain/crypto) and OVERLAY each with reachability from a @MainActor context / SwiftUI body / view lifecycle (codeintel call-graph, else directory-role + grep) and its dispatch context. The metric is the reachable-from-render × on-main INTERSECTION, not a DispatchQueue count. Thread-of-execution not statically decidable ⇒ low-confidence.',
    nulls: ['io_confined_off_main'], direction: 'lower', established: false },
  { id: 'ios_escaping_capture_cycle', title: 'Retain-cycle risk in stored/escaping closures', question: 'Do longer-lived owners strongly capture screen-scoped self without [weak self]?',
    definition: 'Restrict to stored/escaping closures (service/singleton-held, Combine sinks, NotificationCenter observers, Timers) + strong delegates capturing self without [weak self] and never invalidated; overlay with whether the captured type is a view/VM. Non-escaping closures excluded. A [weak self]-vs-self ratio is NOT the metric. Leak confirmation is runtime ⇒ low-confidence.',
    nulls: ['screen_scoped_objects_weak_or_scoped'], direction: 'lower', established: false },
  { id: 'ios_privacy_manifest_completeness', title: 'Privacy-manifest completeness', question: 'Does a privacy manifest cover every required-reason API + tracking SDK the app uses?',
    definition: "Reconcile against Apple's published contract: manifest present in app + linked SDKs, covering each required-reason API family the code calls + each linked tracking/attribution/analytics SDK. Null is Apple's dated rule, not a threshold; absence of tracking SDKs lightens the requirement. This IS a live clone measurement.",
    nulls: ['privacy_manifest_covers_used_apis_and_sdks'], direction: 'higher', established: false },
  { id: 'ios_permission_string_coverage', title: 'Permission usage-string coverage', question: 'Does each permission-guarded API used have a specific usage string, with no orphan strings?',
    definition: 'Reconcile permission-guarded API usage against declared NS*UsageDescription strings (however Info.plist is injected). Report BOTH directions: used-but-undeclared (crash/rejection) and declared-but-unused (over-broad). Clone-computable and framework-agnostic on where the plist lives.',
    nulls: ['permission_usage_declared_iff_used'], direction: 'higher', established: false },
  { id: 'ios_release_config_correctness', title: 'Release-config store-correctness', question: 'Do build/signing/entitlement/ATS values differ-by-config resolve to store-correct values on the release path?',
    definition: 'For values that differ by build config (entitlements, ATS exceptions, environment/capability flags), check the RELEASE-path resolution. A documented, scoped deviation (e.g. a narrow ATS exception with a stated reason) is fact+reason; an undocumented prod-breaking value (e.g. a development-only capability on a store build) is the defect. Clone-computable.',
    nulls: ['release_config_store_correct'], direction: 'higher', established: false },
  { id: 'ios_shipped_secret_capability', title: 'In-binary secret capability', question: 'Which hardcoded/in-binary secrets grant a server/privileged capability if extracted?',
    definition: 'Detect by general secret SHAPE (entropy + known key formats) across source/resources/build config; classify by CAPABILITY × REACHABILITY — a server-capable key on a shipped path is the defect, a public client identifier is fact-only, honor a documented low-sensitivity acceptance. Never lump a public identifier with a real secret. Clone-computable.',
    nulls: ['no_server_capability_secret_in_binary'], direction: 'lower', established: false },
  { id: 'ios_bridge_surface_trust', title: 'Native↔foreign-context bridge trust', question: 'Do WebView/cross-platform bridges validate origin and expose no credential/native capability to foreign content?',
    definition: 'Enumerate bridges by GENERAL signature (JS-enabled WKWebView + WKScriptMessageHandler; cross-platform channels/native modules); per handler check origin/caller validation, surface minimality, and whether a credential/native capability crosses to attacker-influenceable content. Detected by signature, never by a specific bridge name. Clone-computable.',
    nulls: ['bridges_validate_and_leak_no_capability'], direction: 'higher', established: false },
  { id: 'ios_forced_unwrap_at_boundary', title: 'Force-unwrap at external-input boundaries', question: 'Do external-input decode paths carry unconditional unwraps that crash on malformed input?',
    definition: 'OVERLAY force-unwrap/try!/as!/forced-subscript density with proximity to an external-input boundary (network decode, universal-link/URL-scheme handler, push payload, IPC). The metric is the reachable-from-untrusted-input subset — a raw ! count is explicitly rejected (a try! on a static regex is healthy). Clone + codeintel computable.',
    nulls: ['input_paths_have_no_unconditional_unwrap'], direction: 'lower', established: false },
];

export const mobileIos: ExpertBundle = bundle({
  id: 'mobile-ios', title: 'Mobile app — iOS',
  // Keyword activation is the coarse FAIL-OPEN net; Comprehend is authoritative for the app-vs-SDK call (its prompt
  // routes a pure SDK/library to api-stability/swe-arch). So these lean APP-specific and deliberately OMIT tokens a
  // LIBRARY also carries — project/config files (Info.plist/Podfile/Package.resolved/entitlements) AND UI-framework
  // tokens (SwiftUI/UIKit, which a SwiftUI/UIKit component library carries too) — to avoid activating on an iOS library.
  activationSignals: ['xcodeproj', 'xcworkspace', 'app store', 'testflight', 'ios app', 'iphone', 'ipados', 'apns', 'xcprivacy'],
  lens: `MOBILE-iOS PROFILE (a shippable iOS APP — NOT an SDK/library). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The decisive move is an OVERLAY of independent signals against the app's OWN declared intent, never "count of X = bad". Be framework-agnostic: hold across SwiftUI / UIKit / ObjC-bridged, SPM / CocoaPods / Carthage, XcodeGen-generated and raw-pbxproj projects; where the app uses one shape, do NOT report the other as "missing". Measurement planes are code-native: the clone (Swift/ObjC + Info.plist/entitlements/build config), the codeintel index (reachability), the git digest:
- MAIN-THREAD CONFINEMENT: I/O reachable from a render/lifecycle path must run off the main actor/queue. Overlay I/O signature × reachability × dispatch context — never count DispatchQueue/Task; runtime-only facts are low-confidence.
- LIFECYCLE / MEMORY: a longer-lived owner strongly capturing a screen-scoped object (stored/escaping self-capture without [weak self], un-invalidated observer/Timer) leaks a screen. Restrict to stored/escaping captures; leak confirmation is runtime.
- PLATFORM / STORE CONTRACT: satisfy Apple's OWN published contract on the release path (privacy manifest, permission strings, store-correct release config). A HARD external gate, not a smell.
- PERMISSION LEAST-PRIVILEGE & EXTERNAL SURFACE: declared capabilities used + justified; universal-link/URL-scheme entry points intentional + input-validated.
- BRIDGE TRUST BOUNDARY: native↔foreign-context bridges (WebView JS handlers, cross-platform channels) validate origin and leak no credential/native capability — detect by GENERAL signature, never a bridge name.
- IN-BINARY SECRET CAPABILITY: classify committed/in-binary secrets by capability × reachability; a public client identifier is fact-only.
- INPUT-BOUNDARY CRASH SURFACE: unconditional unwraps reachable from external input (network/deep-link/push/IPC) — overlay with the boundary, never a raw ! count.
${renderPlatformContract('ios')}
Discover + evidence every issue; measure against a floor you compute from THIS app or the platform's published contract. Import no number from any other app.`,
  patterns: MOBILE_PATTERNS,
  metricLibrary: mobileIosLib,
  structuralChecks: MOBILE_IOS_INVARIANTS,
});

// ── MOBILE-ANDROID — the code-native bundle for a shippable Android APP. Planes: the clone (Kotlin/Java +
// AndroidManifest / Gradle build config / network-security config), the codeintel index, the git digest, repometa.
// Null = the app's OWN declared intent or Google Play's published contract. Framework-agnostic (Compose/XML-Views/
// Fragments · Kotlin-DSL/Groovy · version-catalog/scattered). ──
const mobileAndroidLib: MetricSpec[] = [
  { id: 'and_main_io_confinement', title: 'Main-thread / ANR confinement', question: 'Is I/O reachable from a UI/lifecycle path dispatched off the Main dispatcher, and no runBlocking on a main path?',
    definition: 'Enumerate I/O surfaces (Room/SQLite, SharedPreferences.commit, network, file, crypto) and overlay with reachability from a UI/lifecycle path (Composable, Activity/Fragment lifecycle, onBind) and its dispatcher/thread. A runBlocking on a known-background executor (e.g. an OkHttp Authenticator) is healthy; the metric is the reachable-from-UI × on-main intersection, never a runBlocking count. Thread-of-execution not statically decidable ⇒ low-confidence.',
    nulls: ['io_confined_off_main'], direction: 'lower', established: false },
  { id: 'and_context_leak_risk', title: 'Context / lifecycle leak risk', question: 'Is a Context/Activity/View held beyond its lifecycle?',
    definition: 'Flag static/companion fields of a Context/Activity/View type, non-static Handlers posting delayed work holding a Context, and singletons retaining an Activity; overlay with whether the held type is UI-scoped. Most Context via DI application-context is safe → narrow to genuinely lifecycle-bound refs. A companion-object count is not a defect; leak confirmation is runtime ⇒ low-confidence.',
    nulls: ['context_holders_app_or_lifecycle_scoped'], direction: 'lower', established: false },
  { id: 'and_coroutine_scope_discipline', title: 'Coroutine lifecycle-scope discipline', question: 'Do UI-triggered coroutines run on a lifecycle-bound scope rather than an unstructured one?',
    definition: 'Share of UI-triggered launches on viewModelScope/lifecycleScope/repeatOnLifecycle vs GlobalScope / an ad-hoc scope tied to no lifecycle; overlay with whether the work touches UI/Context. GlobalScope for legitimately app-lifetime work is fine. Clone-computable.',
    nulls: ['ui_work_is_lifecycle_scoped'], direction: 'higher', established: false },
  { id: 'and_permission_least_privilege', title: 'Permission least-privilege', question: 'Is every declared permission used + justified, with no duplicates or dangerous-without-request?',
    definition: 'Reconcile declared <uses-permission> against actual API usage; flag declared-never-used (over-broad), duplicate declarations, dangerous permissions with no runtime-request path; judge a vendor/OEM permission against whether its matching SDK is present. Clone-computable (manifest ⋈ code).',
    nulls: ['declared_permissions_used_and_justified'], direction: 'lower', established: false },
  { id: 'and_exported_surface_safety', title: 'Exported-surface safety', question: 'Are exported components + deep links intentional and validating inbound input?',
    definition: "Enumerate android:exported=true + implicit intent-filters (incl. BROWSABLE deep-link hosts); judged against the app's declared intent — an intentionally public component is not a defect. Flag a component exported without evident intent, and an exported entry point reading inbound intent/extras without validation. Clone-computable (manifest ⋈ component code).",
    nulls: ['exported_surface_intentional_and_validated'], direction: 'lower', established: false },
  { id: 'and_store_config_compliance', title: 'Play store-config compliance', question: 'Does targetSdk meet the enforced floor, cleartext is default-deny in prod, and release shrinking matches intent?',
    definition: "Reconcile against Google Play's dated contract: targetSdk ≥ the enforced floor, cleartext default-deny in the RELEASE build (a debug/loopback carve-out is healthy), release minify/shrink per the app's own intent, data-collecting SDKs as the disclosure surface. A deviation with a documented scoped reason (e.g. R8 compat mode for a stated reason) is fact+reason. Clone-computable.",
    nulls: ['meets_play_published_contract'], direction: 'higher', established: false },
  { id: 'and_webview_bridge_trust', title: 'WebView / JS-bridge trust', question: 'Do JS interfaces load trusted content, expose a minimal surface, and hand no credential/capability to JS?',
    definition: 'Enumerate JS-enabled WebViews (javaScriptEnabled) + their interfaces by GENERAL signature (addJavascriptInterface / @JavascriptInterface; cross-platform channels/native modules); per interface flag un-constrained content origin, a non-minimal surface, or a method handing a credential/native capability to JS. Detected by signature, never a specific interface name. Clone-computable.',
    nulls: ['js_interfaces_minimal_trusted_no_capability'], direction: 'higher', established: false },
  { id: 'and_committed_credential_capability', title: 'Committed-credential capability', question: 'Which committed credentials grant a server/privileged capability if extracted?',
    definition: 'Detect committed secrets by general SHAPE across source/resources/build config; classify by CAPABILITY × REACHABILITY — a server-capable key is the defect; a weak credential whose BACKING ARTIFACT is not committed (e.g. a signing password with no committed keystore) is reported WITH its bounded exposure; a public identifier / owner-declared low-sensitivity file is fact + acceptance. Clone-computable.',
    nulls: ['no_server_capability_credential_committed'], direction: 'lower', established: false },
  { id: 'and_release_prerelease_deps', title: 'Pre-release deps on the release path', question: 'Are there alpha/beta/rc/SNAPSHOT or unresolvable-out-of-repo dependencies on the release path?',
    definition: 'From the version catalog / build graph, flag pre-release (alpha/beta/rc/-SNAPSHOT) or unresolvable out-of-repo dependencies that ship on the RELEASE path; severity follows the release path — a dev-only dependency, or a documented pre-release pin under an update policy, is a note not a defect. Scoped vs release-eng/appsec: this is the mobile "irreversible release" framing — cross-ref, not duplicate. Clone-computable.',
    nulls: ['release_path_deps_stable_and_resolvable'], direction: 'lower', established: false },
];

export const mobileAndroid: ExpertBundle = bundle({
  id: 'mobile-android', title: 'Mobile app — Android',
  // App-leaning fail-open net (Comprehend is authoritative): OMIT tokens a library module also carries
  // (androidmanifest/minsdk/targetsdk/androidx/gradle AND jetpack-compose, which a Compose UI-widget library carries
  // too) so an Android LIBRARY does not activate this bundle; rely on app-distinguishing tokens (applicationId,
  // .aab/.apk, Play, a launcher activity).
  activationSignals: ['android app', 'applicationid', '.aab', '.apk', 'play store', 'google play', 'launcher activity'],
  lens: `MOBILE-ANDROID PROFILE (a shippable Android APP). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The decisive move is an OVERLAY of independent signals against the app's OWN declared intent, never "count of X = bad". Be framework-agnostic: hold across Jetpack Compose / XML Views / Fragments, Kotlin-DSL / Groovy build scripts, version-catalog / scattered-literal dependencies; where the app uses one shape, do NOT report the other as "missing". Measurement planes are code-native: the clone (Kotlin/Java + AndroidManifest / Gradle build config / network-security config), the codeintel index (reachability), the git digest:
- MAIN-THREAD / ANR CONFINEMENT: I/O reachable from a UI/lifecycle path runs off the Main dispatcher; no runBlocking on a main path. A runBlocking on a known-background executor is healthy; overlay reachability × dispatcher, never count occurrences.
- LIFECYCLE / LEAK & SCOPE: no static/companion Context holder, leaking Handler, or singleton retaining an Activity; UI-triggered coroutines are lifecycle-scoped. Most DI application-context is safe; a companion-object count is not a defect.
- MANIFEST LEAST-PRIVILEGE & EXPORTED SURFACE: declared permissions used + justified (no duplicates/over-broad); exported components + deep links intentional + input-validated.
- STORE-CONFIG COMPLIANCE: meet Google Play's OWN published contract (targetSdk floor, cleartext default-deny in prod, data-safety disclosure surface). A documented scoped deviation (e.g. R8 compat mode) is fact+reason.
- WEBVIEW / JS-BRIDGE TRUST: JS interfaces load trusted content, are minimal, and hand no credential/native capability to JS — detect by GENERAL signature, never an interface name.
- COMMITTED-CREDENTIAL CAPABILITY: classify by capability × reachability; a weak credential whose backing artifact is not committed is bounded, a public identifier is fact-only.
- RELEASE IRREVERSIBILITY: no pre-release/unresolvable deps on the release path (mobile ships to users and cannot be instantly rolled back).
${renderPlatformContract('android')}
Discover + evidence every issue; measure against a floor you compute from THIS app or the platform's published contract. Import no number from any other app.`,
  patterns: MOBILE_PATTERNS,
  metricLibrary: mobileAndroidLib,
  structuralChecks: MOBILE_ANDROID_INVARIANTS,
});

// Domain bundles registered alongside recsys-mle (see experts.ts EXPERT_BUNDLES).
// ── MULTI-TENANT ACCESS & ISOLATION — the lens the registry did not have ─────────────────────────
//
// WHY IT EXISTS. Every bundle above audits what a system COMPUTES: data trust, ranking, moderation,
// architecture, release, supply chain, mobile. None of them audits who may USE the system and what a
// session can reach once admitted. On a run over a multi-tenant web console, the activated set
// (swe-arch / release-eng / appsec) produced 11 findings, none above `medium`, while two independent
// reads of the same repository found three CRITICAL issues: an authenticated entry point that enforces
// no admission check, a tenancy key derived from a user-controlled attribute, and an unresolved
// principal falling through to a default scope that auto-applies stored credential references.
// The machine did not miss them by reasoning badly. It never asked, because no lens owns the question.
//
// Code-native, like swe-arch: it measures on the clone and the git digest, not on a warehouse. Every
// method below is a general property of a multi-principal system — no product, vendor, framework or
// environment-variable name appears here, and none should be added. A lens that names one system's
// specifics stops being a detector and becomes a stored answer.
const tenancyLib: MetricSpec[] = [
  { id: 'admission_path_coverage', title: 'Admission coverage across authenticated entry points', question: 'Does EVERY path that mints a session enforce the same admission check?',
    definition: 'Enumerate the code paths that create an authenticated session; for each, whether the configured admission check (allowlist, domain rule, invite, group membership) is applied before the session is minted. The metric is the share of paths enforcing it. One exempt path sets the real policy — and a path that is itself disabled when another is active makes its check dead code. Clone-computable.',
    nulls: ['every_session_minting_path_enforces_admission'], direction: 'higher', established: false },
  { id: 'isolation_key_derivation', title: 'What the isolation key is derived from', question: 'Is the string that separates tenants derived from an attribute the principal controls or shares?',
    definition: 'Identify the value keying per-tenant state, then trace its origin. A key derived from a shared or self-asserted attribute (an address fragment, a claim, a header) collides for unrelated principals by construction. Report the derivation and the set of principals that can collide on one key. Clone-computable.',
    nulls: ['isolation_key_is_an_explicit_non_derivable_identity'], direction: 'higher', established: false },
  { id: 'scope_filtered_read_coverage', title: 'Reads filtered by acting scope', question: 'Do tenant-scoped READ endpoints filter by the acting scope, or only some of them?',
    definition: 'For each endpoint returning tenant-held state, whether results are filtered by the acting scope. Partial coverage is the defect worth naming: one collection filtered and a sibling unfiltered is an isolation boundary that holds for some data and not others. Clone-computable.',
    nulls: ['all_tenant_scoped_reads_filter_by_acting_scope'], direction: 'higher', established: false },
  { id: 'unresolved_principal_disposition', title: 'Disposition of an unresolved principal', question: 'When a principal maps to no known scope, does the system fail closed or fall through to a default?',
    definition: 'Trace the lookup that resolves a principal to its scope and record the behaviour on a miss, on malformed configuration, and on an empty map. A fall-through to an instance-wide default grants the default scope to anyone unrecognised; combined with any automatic binding of stored credential references it is a disclosure path opened by signing in. Clone-computable.',
    nulls: ['unresolved_principal_is_refused'], direction: 'higher', established: false },
  { id: 'credential_autobind_on_auth', title: 'Credential references bound without an explicit grant', question: 'Does authenticating cause stored credential references to be applied to the session?',
    definition: 'Whether the authentication path applies a stored profile carrying credential references, and whether that application is conditioned on an explicit grant to the principal. Count the reference kinds reachable and what each resolves to at execution time. The defect is binding without a grant, not the existence of stored references. Clone-computable.',
    nulls: ['credentials_bind_only_on_explicit_grant'], direction: 'higher', established: false },
  { id: 'session_identifier_at_rest', title: 'Session identifiers in durable shared storage', question: 'Are live session identifiers written to a store readable by more principals than hold the sessions?',
    definition: 'Whether session identifiers are persisted, to what medium, under what access control, and for how long they remain valid. A bearer identifier in shared durable storage is replayable by every reader of that store for the remainder of its lifetime, independent of the credential hygiene applied to other fields. Clone-computable.',
    nulls: ['session_identifiers_are_not_persisted_to_shared_storage'], direction: 'lower', established: false },
  { id: 'spend_ceiling_coverage', title: 'Spend ceilings by scope', question: 'At which scopes does a cost ceiling exist — per request, per principal, per period, in aggregate?',
    definition: 'Enumerate the paths that can incur metered cost and, for each, which ceilings apply. A per-request ceiling bounds one request and nothing else: total exposure is requests times the ceiling. Record any configuration that removes a ceiling as a side effect of a differently-named setting. Clone-computable.',
    nulls: ['a_ceiling_exists_above_the_single_request'], direction: 'higher', established: false },
  { id: 'capability_gate_kind', title: 'Capabilities gated by configuration rather than principal', question: 'Are elevated capabilities gated by process configuration instead of by who is asking?',
    definition: 'For each capability beyond the system\'s stated posture (host filesystem access, remote execution, egress), whether the gate is a process-level setting or a per-principal authorization. A process-level gate grants the capability to every admitted principal at once, so its blast radius is the admitted set, not the operator who enabled it. Clone-computable.',
    nulls: ['elevated_capabilities_are_gated_per_principal'], direction: 'higher', established: false },
  { id: 'shared_queue_fairness', title: 'Fairness of shared execution slots', question: 'Do shared execution slots bound work per principal, or only in total?',
    definition: 'For each shared queue or concurrency limit, whether admission is per principal or global, and which request classes bypass it entirely. A global limit with no per-principal bound lets one principal\'s backlog delay every other without any abusive intent. Clone-computable.',
    nulls: ['shared_slots_bound_work_per_principal'], direction: 'higher', established: false },
];

const TENANCY_INVARIANTS: Invariant[] = [
  { key: 't1', title: 'Admission is enforced on every path that mints a session', owner: 'saas-tenancy', mount: 'bundle',
    aim: 'Every code path creating an authenticated session applies the same admission decision; no path is exempt and no configured check is left unreachable.',
    playbook: 'Enumerate session-minting paths. For each, locate the admission check and confirm it runs before the session exists. Flag any path that skips it, and any check rendered unreachable because its path is disabled whenever another is enabled — a check that cannot run is not a control.' },
  { key: 't2', title: 'The isolation key is an identity, not a derived attribute', owner: 'saas-tenancy', mount: 'bundle',
    aim: 'Per-tenant state is keyed on an explicit identity that two unrelated principals cannot share.',
    playbook: 'Find the value keying tenant state and trace its derivation. If it is computed from a self-asserted or shared attribute, enumerate the principals that collide on one key and what that key grants access to.' },
  { key: 't3', title: 'An unresolved principal is refused, not defaulted', owner: 'saas-tenancy', mount: 'bundle',
    aim: 'A principal that maps to no known scope is refused; it never inherits an instance-wide default, and authenticating never binds credentials it was not granted.',
    playbook: 'Trace scope resolution on a miss, on malformed configuration and on an empty map. Then trace what the authentication path applies to the resolved scope, and whether any credential reference is bound without an explicit grant.' },
  { key: 't4', title: 'Cost and capacity are bounded above the single request', owner: 'saas-tenancy', mount: 'bundle',
    aim: 'A ceiling exists at a scope larger than one request, and shared execution slots bound work per principal.',
    playbook: 'Enumerate metered paths and shared queues. Record the scope of every ceiling and every bypass. A per-request ceiling with no principal, period or aggregate ceiling above it bounds nothing that matters.' },
];

export const saasTenancy: ExpertBundle = bundle({
  id: 'saas-tenancy', title: 'Multi-tenant access & isolation',
  activationSignals: ['multi-tenant', 'multitenant', 'tenant', 'console', 'operator console', 'dashboard', 'saas', 'sign-in', 'sign in', 'login', 'oauth', 'workspace', 'seats', 'self-serve', 'internal tool', 'admin'],
  lens: `MULTI-TENANT ACCESS & ISOLATION PROFILE (who may use the system, and what a session can reach once admitted). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. Read the code paths; do not assume the deployed configuration:
- ADMISSION COVERAGE: enumerate every path that mints a session and check each applies the admission decision. One exempt path sets the real policy. A check on a path that is disabled whenever another is enabled is DEAD CODE, not a control — say so.
- DELEGATED ADMISSION: where the gate is an external identity provider's configuration rather than code, name that explicitly; it means the policy is not in the repository and cannot be reviewed there.
- ISOLATION KEY: find the value keying per-tenant state and trace its derivation. A key derived from a shared or self-asserted attribute collides by construction — enumerate who collides and what the key grants.
- READ-SIDE SCOPE: check which tenant-scoped reads filter by acting scope. PARTIAL coverage is the finding: one collection filtered and its sibling unfiltered is a boundary that holds for some data and not others.
- UNRESOLVED PRINCIPAL: trace scope resolution on a miss, on malformed configuration, and on empty configuration. Fall-through to an instance default grants that scope to anyone unrecognised.
- CREDENTIAL BINDING: does authenticating apply stored credential references, and is that conditioned on an explicit grant? Follow each reference to what it resolves to at execution time. Binding without a grant is the defect; stored references are not.
- SESSION DURABILITY: are session identifiers persisted, where, readable by whom, valid for how long? A bearer identifier in shared storage is replayable for its remaining lifetime regardless of how carefully other fields are stripped.
- SPEND CONTAINMENT: enumerate metered paths and the scope of each ceiling. A per-request ceiling bounds one request; exposure is requests times that ceiling. Note any setting that removes a ceiling as a side effect of a differently-named option.
- CAPABILITY GATES: for capabilities beyond the stated posture, is the gate process configuration or per-principal authorization? A process-level gate grants to every admitted principal at once.
- SHARED-SLOT FAIRNESS: are concurrency limits per principal or global, and which request classes bypass them? A global limit lets one principal's backlog delay everyone with no abusive intent.
Discover and evidence every issue against the code. State plainly what only the deployed configuration can settle — that is a coverage gap, not a finding, and not a reason to soften the code fact.`,
  metricLibrary: tenancyLib,
  structuralChecks: TENANCY_INVARIANTS,
});

// ── PRODUCT LOGIC — business rules & application logic (Phase 2) ───────────
//
// WHY IT EXISTS. The Leadership brief is the BUSINESS report: where the product's business and application logic is
// wrong, as its users and the business experience it. Before this bundle nothing audited business rules as such — the
// data bundles check whether numbers are trustworthy, the code-native ones whether the code and delivery are sound,
// the security ones whether access is contained. None asks whether a limit shown in the UI is the limit the server
// enforces, whether every order / subscription / invite state is handled, whether a shared view shows exactly what the
// product says it shows, or whether the number on a customer's dashboard is what its label says. On a product repo those
// are the findings a leader acts on, and without a lens that owns them the brief falls back to an engineering overview.
//
// Code-native: it measures on the clone (and the git digest / codeintel index when mounted), and on the warehouse or an
// API plane when one is mounted (a customer-facing number can then be recomputed, not only read). GENERALIZATION-FIRST
// (the mobile bundles' "generalization mandate", applied here): every method reconciles two surfaces
// of the SAME product — its declared rule (UI copy, docs, types, constants, config, migrations) against another place
// that implements or enforces it. No product, feature, framework, table or route name appears below, and none should be
// added: a lens that names one product's features stops being a detector and becomes a stored answer. Defensive and
// read-only throughout; an access mismatch is reported as business when it breaks a product promise (the isolation /
// authentication hardening lens stays with appsec / saas-tenancy).
const productLogicLib: MetricSpec[] = [
  { id: 'rule_parity_divergence', title: 'Business-rule parity across surfaces', question: 'Does each business rule (limit, validation, price / entitlement, eligibility) give the same answer on every surface that implements it?',
    definition: 'Per rule with user or revenue consequence: every site that implements or states it (constants, validators, schema constraints, server guards, client checks, UI copy, docs), reconciled on the same inputs incl. edge values. The metric is the share of rules whose sites disagree on some input — an OVERLAY of declared vs enforced, never a count of validators. Two sites deferring to one shared definition are one rule. Clone-computable.',
    nulls: ['every_rule_resolves_to_one_definition'], direction: 'lower', established: false },
  { id: 'state_handling_coverage', title: 'Lifecycle-state handling coverage', question: 'For each declared status / type set, does every consumer that branches on it handle every reachable state?',
    definition: 'Declared state set (enum / union / check constraint / migration) × the consumers that branch on it (switches, query filters, guards, renders, jobs, exports) → the state × consumer matrix; the metric is the share of (reachable state, consumer) cells that fall through a silent default. A documented deliberate default counts as handled. Clone-computable.',
    nulls: ['every_reachable_state_handled_by_every_consumer'], direction: 'higher', established: false },
  { id: 'terminal_state_leak', title: 'Terminal states still acted on', question: 'Is an entity in a terminal state (removed, cancelled, expired) still counted, served, billed or processed?',
    definition: 'Per terminal state the product declares: the read / aggregate / job paths that should exclude it and whether they do (filter present on the query, or the row removed). The defect is the declared-terminal × still-included intersection. Clone-computable; warehouse-measurable when mounted (rows in a terminal state inside a live aggregate).',
    nulls: ['terminal_states_excluded_everywhere'], direction: 'lower', established: false },
  { id: 'access_model_parity', title: 'Declared vs enforced access per capability', question: 'Does every route / query guard enforce exactly the product\'s declared access model — no wider, no narrower?',
    definition: 'The product\'s declared model (role / permission maps, ownership, team membership, sharing and public-view settings, UI gating) × the guard each route / query applies to a protected entity → the capability × role matrix of declared vs enforced; wider-than-declared and narrower-than-declared cells are the metric. Read-only code reconciliation — never a live probe. Clone-computable.',
    nulls: ['enforced_access_equals_declared_access'], direction: 'lower', established: false },
  { id: 'shared_view_scope', title: 'What a shared or public view actually exposes', question: 'Does a shared / public / embedded view return only what the product says it shares?',
    definition: 'Per share mechanism (share link, public page, embed, export link): the fields / entities / time ranges its handler returns vs the product\'s own statement of what is shared (settings copy, docs, the owner-facing UI). The metric is the set difference returned − declared, weighted by the owner\'s data it reveals. Clone-computable.',
    nulls: ['shared_views_return_only_declared_scope'], direction: 'lower', established: false },
  { id: 'displayed_metric_label_parity', title: 'Customer-facing number vs its label', question: 'Does each number shown to customers compute what its own label, tooltip and docs say?',
    definition: 'Pair each customer-facing number (dashboard tile, export column, digest email) with the query / formula behind it; state the definition each side implies (population, distinctness, filters, window, unit) and flag a mismatch. The metric is the share of surfaced numbers whose computation contradicts their own label — never a count of charts. Clone-computable; recomputable on a mounted warehouse / API plane.',
    nulls: ['every_label_matches_its_computation'], direction: 'lower', established: false },
  { id: 'cross_surface_number_agreement', title: 'Same-label numbers agree across surfaces', question: 'Do two surfaces (or two storage / query paths) that show the "same" number compute it the same way?',
    definition: 'For each label shown on more than one surface, or computed by more than one back-end / query path, diff the implied definitions; on a mounted data plane recompute both on one shared window. A gap that tracks the definition (not the data) is the defect. Clone-computable; measurable when a data plane is mounted.',
    nulls: ['same_label_same_definition'], direction: 'lower', established: false },
  { id: 'window_boundary_correctness', title: 'User-facing window boundaries', question: 'Do date ranges, periods and retention / expiry windows apply one timezone and one inclusivity rule, as the product states?',
    definition: 'Trace each user-facing window from its input to the query / job applying it: bucket timezone, inclusivity of each end, stored unit. The metric is the number of windows where a boundary value can land in two buckets or none, or where the applied window differs from the product\'s stated one (e.g. a retention setting enforced over a different span). Clone-computable.',
    nulls: ['one_timezone_and_inclusivity_rule_per_window'], direction: 'lower', established: false },
  { id: 'amount_rounding_points', title: 'Rounding / conversion points per amount', question: 'Is each user-visible amount rounded and converted at exactly one point?',
    definition: 'Per amount a user sees or pays (price, usage, credit, average): every rounding / currency / unit conversion step from source to display; more than one lossy step, or display and charge rounding differently, is the defect — the declared-once × applied-twice overlay. Clone-computable.',
    nulls: ['one_rounding_point_per_amount'], direction: 'lower', established: false },
  { id: 'side_effect_idempotency', title: 'Apply-once guarantees on user-visible side effects', question: 'When the trigger of a user-visible side effect re-runs, is the effect applied once?',
    definition: 'Enumerate paths applying a user-visible side effect (charge, credit, message, counter, created record) that can re-run (client retry, queue redelivery, overlapping schedule, webhook replay); per path, the guard making a re-run a no-op (idempotency key, unique constraint, compare-and-set). The metric is re-runnable × unguarded — not a count of handlers. Clone-computable.',
    nulls: ['every_rerunnable_effect_guarded'], direction: 'lower', established: false },
  { id: 'switch_integrity', title: 'Integrity of user-visible flags and settings', question: 'Are the flags / settings that change user-visible behaviour live, single-sourced and applied at every layer?',
    definition: 'Inventory flags / env settings / edition checks read in user-facing paths with where each is defined, defaulted and read; classify dead (one reachable value), contradictory (two switches for one behaviour that can disagree), half-applied (gates one layer of a capability but not the others). The metric is the declared-switch × applied-layer mismatch set. Clone-computable.',
    nulls: ['user_visible_switches_live_and_fully_applied'], direction: 'lower', established: false },
  { id: 'lifecycle_promise_enforcement', title: 'Data-lifecycle promises vs enforcement', question: 'Does the code enforce the data lifecycle the product promises its users (retention, deletion, cascade on removal)?',
    definition: 'The product\'s declared lifecycle for user data (retention settings, "delete my data / this item", removal of an owning entity) × the code paths that enforce it (scheduled purge, cascade, soft-delete filters on every read). The metric is the set of promised lifecycle rules with no enforcing path, or enforced over a different scope / window than declared. Clone-computable; warehouse-measurable when mounted (rows past the declared window).',
    nulls: ['declared_lifecycle_rules_enforced'], direction: 'lower', established: false },
];

export const productLogic: ExpertBundle = bundle({
  id: 'product-logic', title: 'Business rules & application logic',
  activationSignals: ['business logic', 'business rule', 'billing', 'subscription', 'pricing', 'checkout', 'entitlement', 'invoice', 'refund', 'quota', 'plan limit', 'state machine', 'order status', 'feature flag', 'sharing', 'share link', 'public link', 'permissions', 'user role', 'data retention', 'retention policy', 'user-facing', 'customer-facing'],
  lens: `PRODUCT-LOGIC PROFILE (business rules & application logic — does the product do what its users and the business were promised?). Value-free methods — each: suspicion → cheapest decisive probe → metric → floor → interpret. The NULL is ALWAYS the product's OWN declared rule — its UI copy, docs, types, constants, config, migrations — reconciled against ANOTHER surface of the same product; never a rule, threshold or feature expectation imported from outside. Start from the product's capabilities (the features and journeys its users rely on) and ask of each what it promises. Measurement planes: the clone (routes, handlers, queries, schema / migrations, UI copy), the git digest / codeintel index when mounted, and a warehouse or API plane when mounted (then recompute a customer-facing number rather than only read its code):
- RULE PARITY: the same rule (limit, validation, price / entitlement, eligibility) implemented in two places — client vs server, two services, UI label vs computation — that disagree on some input. Two sites deferring to one shared definition are ONE rule; a stricter client check over an authoritative server is UX.
- STATE COMPLETENESS: a declared status / type set vs the consumers that branch on it — unhandled values falling through a silent default, states no write can reach, terminal states (removed / cancelled / expired) still counted, served or billed.
- ACCESS vs PRODUCT RULES: the product's own access model (roles, ownership, teams, sharing / public views) vs each route / query guard — wider than declared (a shared view exposing more than the product says) or narrower (a granted capability refused). READ-ONLY reconciliation of code against code; never probe a live endpoint. It is a business finding when it breaks a product promise — leave authentication / isolation hardening to the security bundles.
- CUSTOMER-FACING NUMBERS: a number customers see (dashboards, exports, emails) computed differently from its label / docs, or two surfaces / storage back-ends that show the same label computing it differently.
- TIME & MONEY BOUNDARIES: timezone and day boundaries, range-end inclusivity, off-by-one period windows, retention / expiry windows, rounding and currency conversion in user-facing aggregates or charges — a boundary value must land in exactly one bucket.
- APPLY-ONCE: a user-visible side effect (charge, credit, message, counter, created record) whose trigger can re-run with no idempotency guard.
- SWITCHES: flags / settings / edition checks that change user-visible behaviour but are dead, contradictory, or half-applied (the UI gated, the capability still reachable, or the reverse).
- DATA LIFECYCLE: the retention / deletion / cascade the product promises vs the code that enforces it.
State each problem as what USERS or the BUSINESS experience (a customer charged twice, a shared view showing data its owner never shared, a dashboard number that means something else), then the code fact. Discover and evidence every issue against the code; say plainly what only the deployed configuration or live data can settle — that is an open question, not a finding. Import no number from this text.`,
  patterns: PRODUCT_LOGIC_PATTERNS,
  metricLibrary: productLogicLib,
  structuralChecks: BL_INVARIANTS,
});

export const DOMAIN_BUNDLES: ExpertBundle[] = [baseline, dataEngineering, analytics, trustSafety, sweArch, releaseEng, apiStability, appsec, mobileIos, mobileAndroid, saasTenancy, productLogic];
