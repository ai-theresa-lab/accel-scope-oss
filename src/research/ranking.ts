// Optional RANKING / retrieval-ranking domain PROFILE.
//
// accel-scope's invariants (i1–i11) stay GENERAL — the anti-reward-hacking rule forbids
// encoding any company's specific pain list or answers in the detector. This profile is a
// value-free recsys investigative LENS that SHARPENS those general invariants when the
// project is a recommender / search / retrieval-ranking system. It contains METHODS only
// (suspicion → cheapest decisive probe → metric → floor → interpret) — no company's metric
// names, baselines, experiment ids, or numbers — so it generalizes to ANY recsys org and
// never imports a project's conclusions. The agent still discovers + evidences every issue
// itself and measures every metric against a floor it computes (never one taken from here).
//
// Activation: appended to the scout/investigate prompts when the project "looks like"
// ranking — either the user's --context mentions it, or the org map shows recsys signals.

export const RANKING_SIGNALS = [
  'ranking', 'recsys', 'recommend', 'retrieval', 'two-tower', 'two_tower', 'two tower',
  'recall@', 'faiss', 'ann index', 'embedding tower', 'user tower', 'item tower', 'dssm',
  'candidate generation', 'candidate retrieval', 'ranker', 'feed ranking', 'personaliz',
];

// True if any connected text (run context, org map, scope) signals a recsys/ranking
// system. Keyword-based + cheap; the profile only ADDS method depth, so a false positive is
// low-cost (extra recsys guidance the agent simply won't find targets for) and a false
// negative just falls back to the general invariants.
export function looksLikeRanking(...texts: (string | undefined)[]): boolean {
  const hay = texts.filter(Boolean).join('\n').toLowerCase();
  return RANKING_SIGNALS.some((s) => hay.includes(s));
}

// The value-free recsys method lens. Returns '' so callers can unconditionally interpolate it.
export function rankingProfile(active: boolean): string {
  if (!active) return '';
  return `RANKING / RETRIEVAL-RANKING PROFILE (this project looks like a recommender / search / retrieval-ranking system). General recsys investigative methods that SHARPEN the invariant above — apply them to THIS system's own artifacts; discover and evidence every issue yourself, and measure every metric against a floor YOU compute. Import no number from this text.

Recsys checks (each: suspicion → cheapest decisive probe → metric → floor → interpret):
- EVAL VALIDITY: is the reported offline metric an honest proxy for full-catalog serving? Re-score recall@k against the FULL item inventory (not in-batch / sampled negatives); compare to the random-chance floor = k / catalog_size at the SERVING denominator. Inspect the train/eval split (temporal vs random; item/user leakage across the boundary). Report ground-truth-in-index coverage with a CI. In-batch numbers are training-health only — never model selection.
- EXPERIMENT INTEGRITY: is the A/B valid AND is each training run single-variable vs a NAMED parent? Reconstruct arm membership (assignment may be buried in a request blob, not a column). Check SRM, arm stickiness, control purity, cross-experiment orthogonality. De-confound any population code-gated out of an arm (restrict both arms to the comparable population; report naive vs de-confounded delta). Diff a run's recipe against the DEPLOYED EXPORT ARTIFACT's embedded config — never the live/declared config (it drifts); >1 changed lever ⇒ not attributable.
- OBJECTIVE↔ONLINE GAP: what does the training label actually reward, and can an online arm be tied to a model build? Tally label composition (strong vs weak signal); compute held-out AUC for the true engagement signal vs the 0.5 random floor; check whether the retrieval objective is identical to the downstream ranker's (identical ⇒ redundant by construction). Require a model_version + post-transform feature vector in serving logs for attribution.
- REPRESENTATION / COLLAPSE: does the model personalize and add unique coverage, or collapse onto popularity/redundancy? Probe the user tower — embed two DISJOINT histories of the same user and measure cosine (≈1 ⇒ collapsed); also median pairwise user-embedding cosine across users. Two nulls on the same protocol the model must clear: the CONSTANT-USER null (serve one representative user's list to everyone) and the POPULARITY-LIST null (static top-K). Redundancy: per-channel sole-rate + overlap. Amplification: output concentration vs training concentration; engagement-rate flat across exposure deciles ⇒ head over-shown, not better (feedback loop).
- RECALL-SOURCE PORTFOLIO / INCREMENTAL VALUE: when retrieval MERGES several candidate sources (a learned two-tower, a co-occurrence / i2i source, a popularity / fresh source) before ranking, each source must justify its keep by INCREMENTAL value over what the others already cover — NOT by its standalone offline recall (a source can score high recall yet contribute nothing unique that survives ranking). Read three things, cheap → decisive: (1) per-source SOLE-RATE + overlap matrix — share of a source's contributed items NO other source surfaced; (2) per-source POST-RANKING EXPOSURE & ENGAGEMENT share on its uniquely-contributed items vs the overall engagement rate — are the unique items actually shown and engaged, or always outranked (dead weight)?; (3) the DECISIVE test is an ABLATION A/B — remove the source, measure top-line engagement loss vs a flat-band null; offline recall cannot settle "keep it", only the serving-time ablation can. A source whose unique items are never exposed, or whose ablation shows no loss beyond the band, is a cut candidate (latency / index-build / on-call complexity saved). Report the numbers + the null; never pre-judge which source to cut.
- DATA / PIPELINE: does training-data composition/sampling/freshness hold, and do configs match the data? Diff declared features vs the actual data header AFTER reading preprocessing transforms; MEASURE distinct-id cardinality + load factor before claiming a hash table saturated. Name the exact cap / downsample / dedup knob + value; check temporal-vs-random split for leakage. Probe per-source freshness (per-day rows, min/max date) → live/stale/dead/one-off; compare exposed-pool vs full-catalog size (tail exclusion inflates recall).
- SERVING INFRA: is the served model correctly paired, fresh, train/serve-faithful, routable? Verify the user-tower export id == the index manifest's export id. Check index rebuild automation (cron / build timestamp) + counter-feature staleness. Verify exact-scan vs lossy ANN, and train/serve feature parity (hashing, sequence truncation, timezone, point-in-time counters) via a live embedding probe. Compare documented vs observed traffic activation; confirm per-arm routing exists.
- CODE / PR HYGIENE: git-tracked live secrets (.env / *.pem / credentials / task-def files), recipe drift vs the deployed export, stale hardcoded paths/hosts, overlapping PRs racing the same caller path.

Objective design (when proposing or judging a metric improvement): pick a PRIMARY aligned to the business ask (not the training objective if they differ); add GUARDRAILS that block misleading wins (popularity-mimicry via user-embedding collapse; head amplification); keep a noisy north-star as a TARGET (measured, not gated); demote a replaced metric to TRACKING (observable, non-gating); every metric needs a measured FLOOR/null before it may gate a verdict.

Verdict cascade for a single-variable experiment vs a NAMED parent: failed → blocked; incomplete → pending; catastrophic guardrail breach → refuted; primary absent → pending; primary ≤ any must-beat null → refuted; primary worse than parent beyond a flat band → refuted; primary improved AND all guardrails hold → win; improved but a guardrail traded → no-free-lunch; flat or no parent → no-free-lunch. Anchor every "baseline" guardrail to the NAMED PARENT's measured value, not the original deployed baseline.

`;
}
