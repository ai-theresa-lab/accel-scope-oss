// Seed bank — anonymized, VALUE-FREE diagnostic method PATTERNS.
//
// A pattern is a reusable, generalizable "shape of a deep problem worth posing" distilled from a
// real audit, with every company-specific name, number, and conclusion stripped out. It carries
// only METHOD: the smell that should trigger the question, the falsifiable question itself, the
// DECISIVE test that settles it, and why it matters. It never names a company, a model, an
// experiment id, or an expected value — so it primes the Critique to ask an expert-grade question on
// ANY org of that type without importing one org's answers.
//
// Patterns are the Critique-half seed (what deep question to pose); the Expert half (how to measure
// + the verdict cascade) lives in the metric library + verdict code. The recsys lens (ranking.ts)
// embeds the same method prose so both halves stay aligned; this registry is the structured,
// selectable form a Comprehend step can prime per company type and that future patterns extend.
//
// Anti-reward-hacking: a pattern is a QUESTION + a NULL, never a finding. The agent must still
// discover the targets, measure against a floor it computes, and let the deterministic verdict
// dispose — a pattern only makes sure the right hard question gets ASKED.

export interface ProblemPattern {
  id: string;             // stable key, e.g. 'recall-source-incremental-value'
  title: string;
  appliesWhen: string[];  // signal keywords that make this pattern relevant (matched against connected text)
  smell: string;          // the observable smell that should trigger the question
  question: string;       // the falsifiable question to pose — value-free, no expected answer
  decisiveTest: string;   // the single measurement that settles keep/cut/fix — names a null, never a number
  why: string;            // the business / product consequence if the answer is bad
}

// Flagship pattern — abstracted from a recall-source audit. The deep move it encodes: a component
// is NOT justified by its standalone offline metric; it is justified by its INCREMENTAL contribution
// over what the rest of the system already covers, and the only test that settles "keep it" is a
// serving-time ablation against a flat-band null. Generalizes to any portfolio of candidate sources
// (learned retrieval / co-occurrence / popularity / fresh), any blended-ensemble component, and —
// by analogy — any feature, model, or pipeline stage defended by an offline number.
export const recallSourceIncrementalValue: ProblemPattern = {
  id: 'recall-source-incremental-value',
  title: 'Recall-source / component incremental value (is it worth keeping?)',
  appliesWhen: [
    'two-tower', 'two_tower', 'recall', 'retrieval', 'candidate generation', 'candidate retrieval',
    'recall source', 'multi-channel', 'ensemble', 'faiss', 'ann index', 'embedding tower', 'recsys',
  ],
  smell:
    'a learned/expensive candidate source (e.g. a two-tower) is merged with cheaper sources ' +
    '(co-occurrence, popularity, fresh) and defended by its OFFLINE recall, with no measurement of ' +
    'what it uniquely adds after ranking — or whether its unique items are ever exposed.',
  question:
    'Does this recall source add INCREMENTAL value the others do not already cover, enough to justify ' +
    'its latency/cost/complexity — or is it redundant / never-exposed dead weight? (Offline recall ' +
    'cannot answer this: a source can have high recall yet contribute nothing unique that survives ranking.)',
  decisiveTest:
    'Three readings, cheap → decisive: (1) per-source SOLE-RATE + overlap matrix — share of a source\'s ' +
    'contributed items NO other source surfaced; (2) per-source POST-RANKING EXPOSURE & ENGAGEMENT share ' +
    'on its uniquely-contributed items vs the overall engagement rate (are the unique items shown + engaged, ' +
    'or always outranked?); (3) the DECISIVE one — an ABLATION A/B: remove the source and measure top-line ' +
    'engagement loss vs a flat-band null. No loss beyond the band ⇒ a cut candidate. Report numbers + the null; ' +
    'never pre-judge which source to cut.',
  why:
    'A redundant or never-exposed source burns serving latency, index build, and on-call complexity for no ' +
    'user value, and inflates "recall" dashboards that drive model-selection the wrong way.',
};

// Companion pattern — the feedback-loop side of the same audit. Concentration is not inherently bad;
// it is bad when exposure share outruns engagement quality, because the logging then teaches the next
// model to concentrate further. Value-free: report the concentration + the per-decile engagement, never
// a target Gini.
export const exposureFeedbackAmplification: ProblemPattern = {
  id: 'exposure-feedback-amplification',
  title: 'Exposure concentration → feedback-loop amplification',
  appliesWhen: ['ranking', 'recsys', 'feed ranking', 'exposure', 'personaliz', 'recommend'],
  smell:
    'a small head of items takes most exposures and the system trains on its own exposure logs, with no ' +
    'check that the head\'s engagement rate justifies its exposure share.',
  question:
    'Is exposure concentration EARNED by higher engagement quality, or is the head merely over-shown — ' +
    'so the next model, trained on these logs, concentrates further (rich-get-richer)?',
  decisiveTest:
    'Engagement rate across exposure deciles: flat (or rising slower than exposure) across deciles ⇒ the ' +
    'head is over-shown, not better — an amplification loop. Compare output concentration vs training-data ' +
    'concentration over multiple windows; null = engagement rate independent of exposure decile.',
  why:
    'An unearned amplification loop starves the long tail / fresh supply, caps catalog utilization, and ' +
    'silently narrows the product over time while topline looks stable.',
};

// Data-engineering: a source quietly slows/stops updating but downstream tables + dashboards keep
// rendering (last value carried forward / partial loads), so no one notices until a decision is made
// on stale data. Generalizes to any scheduled pipeline.
export const silentFreshnessDecay: ProblemPattern = {
  id: 'silent-freshness-decay',
  title: 'Silent freshness decay (a source stops updating, dashboards still render)',
  appliesWhen: ['airflow', 'dbt', 'etl', 'pipeline', 'ingestion', 'freshness', 'warehouse', 'dataform', 'glue', 'backfill'],
  smell: 'a scheduled table is read everywhere but has no freshness assertion; a partial/empty load or a paused DAG would surface as "yesterday\'s numbers", not an error.',
  question: 'Is every decision-bearing table actually fresh on its declared cadence, or can a stalled/partial load go unnoticed because the last good rows are still served?',
  decisiveTest: 'Per-source max-event-time vs now and rows-per-period over a multi-window sample → classify live / lagging / stale / dead / one-off; null = the table meets its declared cadence with no gap. Cross-check row-count continuity for partial loads.',
  why: 'Stale-but-rendering data drives decisions on numbers that stopped being true, and silently biases any model trained on the gapped window.',
};

// Analytics: the same headline metric is computed differently across surfaces (app vs warehouse vs
// dashboard), so teams argue over which number is real and experiments read against the wrong one.
export const metricDefinedTwoWays: ProblemPattern = {
  id: 'metric-defined-two-ways',
  title: 'One metric, several definitions (sources of truth disagree)',
  appliesWhen: ['dashboard', 'metric', 'kpi', 'looker', 'tableau', 'funnel', 'cohort', 'north star', 'analytics', 'attribution'],
  smell: 'a headline metric (active user / conversion / retention) is defined in more than one place with a different denominator, filter, or window, and nothing reconciles them.',
  question: 'Does the headline metric resolve to ONE definition end-to-end, or do the app event, the warehouse model, and the dashboard each compute it differently?',
  decisiveTest: 'Reconstruct the metric from raw events with the documented definition and diff against each surface\'s number over the same window; enumerate the divergent filters/denominators/windows. Null = all surfaces agree within sampling noise on a shared definition.',
  why: 'Divergent definitions make every experiment read-out and board number contestable, and quietly route decisions to whichever surface flatters the result.',
};

// Trust & Safety: unsafe/flagged content can be exposed or recommended BEFORE moderation reviews it,
// and coverage is reported over reviewed items — missing the exposed-before-review tail.
export const moderationCoverageGap: ProblemPattern = {
  id: 'moderation-coverage-gap',
  title: 'Moderation coverage gap (exposed before reviewed)',
  appliesWhen: ['moderation', 'trust and safety', 'abuse', 'nsfw', 'toxicity', 'content policy', 'safety', 'flagged'],
  smell: 'moderation runs async or by sampling, while serving/recommendation can surface freshly-created content immediately; "coverage" is measured over reviewed items, not over exposures.',
  question: 'Where policy REQUIRES pre-review, what share of EXPOSED content (esp. fresh UGC) reached users before any moderation decision — and for content reviewed later, what reach accrued past the policy SLA?',
  decisiveTest: 'Join exposures to the moderation-decision timeline: impression-weighted share of exposures whose item had no decision (or a later decision) at exposure time; segment by content age. Null = exposures-before-decision at/below the policy SLA (zero only where policy MANDATES pre-review; otherwise the SLA, not zero).',
  why: 'Where pre-review is required, unreviewed-but-exposed content is the scale path for harm, and a coverage number computed over reviewed items hides the exposed tail; whether a given exposure is a defect depends on the policy SLA, not the bare fact of exposure-before-review.',
};

// ── Data-engineering deep patterns (beyond silentFreshnessDecay) — distilled with codex. The decisive
// move in each is EQUIVALENCE to a correct reconstruction, not "big/old/full-scan = bad". ──
export const lineageBlastRadius: ProblemPattern = {
  id: 'lineage-blast-radius',
  title: 'Lineage blast radius (which decisions actually move if this source breaks?)',
  appliesWhen: ['lineage', 'dbt', 'airflow', 'pipeline', 'warehouse', 'dataform', 'etl', 'upstream', 'dependency'],
  smell: 'an upstream source/column is read by many downstream tables + dashboards but has no column-level lineage or freshness/volume gate, so its severity is judged by how central it LOOKS, not by what would actually change.',
  question: 'If this source lags, zeros out, or changes shape, WHICH decision-bearing assets actually change — its blast radius after the declared gates, not its raw fan-out?',
  decisiveTest: 'Read static lineage to enumerate downstream consumers, then recompute/query each decision-bearing output with the suspect source FROZEN (last-good), EXCLUDED, or replaced, and diff against the live output. Null = downstream outputs are invariant once their declared freshness/quality gates hold. Report which assets move vs which are gated; never assume fan-out equals impact.',
  why: 'Effort gets spent hardening central-looking tables while an ungated, narrowly-consumed source silently swings a board metric; blast radius — not centrality — is what to gate.',
};
export const lateArrivalBackfillEquivalence: ProblemPattern = {
  id: 'late-arrival-backfill-equivalence',
  title: 'Backfill / late-arrival equivalence (does the table equal one clean replay?)',
  appliesWhen: ['backfill', 'late data', 'late-arriving', 'retry', 'idempoten', 'insert into', 'partition', 'etl', 'ingestion', 'reprocess'],
  smell: 'an event-time table receives retries, backfills, or late data — often via INSERT INTO or mutable partitions — and correctness is judged by row counts, which survive double-counting.',
  question: 'Does the materialized target equal EXACTLY ONE event-time replay of its immutable inputs, or do retries/backfills double-count or silently overwrite history?',
  decisiveTest: 'Build an event_time × ingestion_time late-arrival matrix; check for duplicate/multiple versions on the declared grain around retry/backfill windows; and compare a per-partition checksum/grain count against a reconstructed clean replay of the immutable inputs. Null = idempotent-replay equivalence (target == one replay). Requires a stated grain — do not infer a duplicate defect without one.',
  why: 'Row counts can pass while history is double-counted or overwritten, so every metric and model trained on the table inherits the corruption with no error raised.',
};
export const partitionPruningCostEquivalence: ProblemPattern = {
  id: 'partition-pruning-cost-equivalence',
  title: 'Cost concentration → prunable-scan equivalence (is spend buying necessary work?)',
  appliesWhen: ['cost', 'spend', 'bytes', 'slot', 'full scan', 'partition', 'cluster', 'bigquery', 'snowflake', 'warehouse', 'query'],
  smell: 'a few query families dominate warehouse spend and repeatedly full-scan partitioned/clustered tables, but cost is discussed as "expensive queries" rather than "scan scope vs the output\'s declared grain".',
  question: 'Is the compute buying NECESSARY work, or scanning outside the output\'s declared grain/window — can the same result be produced from a pruned/materialized plan?',
  decisiveTest: 'Normalize query history into families by shape; inspect each plan for partitions/columns actually scanned (functions/casts on the partition column, missing bounded predicates, SELECT * in scheduled jobs); then dry-run an equivalent pruned/materialized query and compare result + bytes scanned. Null = identical result under the pruned plan. A full scan is a defect ONLY when the declared output is computable from a narrower scan — never flag size alone.',
  why: 'Concentrated, rewritable scan cost is the cheap decisive win; treating "big query" as the defect chases the wrong queries and misses the few that actually overscan.',
};

// ── Analytics / metric-trust deep patterns (beyond metricDefinedTwoWays) ──────────────────────────
export const segmentMixDecomposition: ProblemPattern = {
  id: 'segment-mix-decomposition',
  title: 'Segment-mix decomposition (does the topline survive a fixed-mix read?)',
  appliesWhen: ['metric', 'kpi', 'north star', 'retention', 'conversion', 'funnel', 'cohort', 'dashboard', 'analytics', 'segment', 'mix'],
  smell: 'a headline metric is flat or moving while the underlying mix (acquisition channel, geo, device, tenure, plan) shifts, and the read-out is a single aggregate with no within-segment view.',
  question: 'Does the headline read survive a FIXED-MIX and a WITHIN-SEGMENT decomposition, or is aggregate stability hiding offsetting segment moves / a mix shift (a Simpson-paradox read)?',
  decisiveTest: 'Compute the naive aggregate, then per-segment rates and weights on PRE-DECLARED eligibility segments; then standardize — apply the current period\'s rates to the prior mix, and the prior rates to the current mix — and see whether the headline direction holds. Null = the topline is invariant to mix standardization. Pre-declare segments before reading; choosing segments after seeing results adds analytical degrees of freedom that can change the sign or magnitude of the read.',
  why: 'A mix-driven topline routes the business to the wrong cause — celebrating or firefighting an aggregate that within every segment is moving the other way.',
};
export const registeredReadoutIntegrity: ProblemPattern = {
  id: 'registered-readout-integrity',
  title: 'Experiment read-out integrity (one registered read, or many degrees of freedom?)',
  appliesWhen: ['experiment', 'a/b', 'ab test', 'readout', 'read-out', 'metric', 'notebook', 'dashboard', 'analytics', 'significance'],
  smell: 'an experiment result is produced from notebooks/dashboards after launch, with a choice of metrics, windows, and segments available, and no pre-registered primary metric + read-out window.',
  question: 'Is the result reproducible under ONE pre-exposure read-out protocol (primary metric, exposure unit, window), or does it depend on analytical degrees of freedom chosen after seeing data?',
  decisiveTest: 'Check assignment health (sample-ratio mismatch, bucket stickiness); diff the registry-declared metric/unit/window/segments against what the read-out actually used; and recompute the FIRST eligible read-out from raw assignment/exposure/event logs. Null = a single registered read-out reproduces the claimed result. Measure registry-vs-actual mismatch + post-exposure choice — do not label intent.',
  why: 'Post-hoc choice of metric/window/segment adds analytical degrees of freedom that can change a result\'s sign or magnitude, so a read not fixed before exposure may not reproduce — and ship decisions then rest on an unstable read.',
};
export const frozenCohortDenominator: ProblemPattern = {
  id: 'frozen-cohort-denominator',
  title: 'Cohort denominator integrity (is eligibility fixed before the outcome?)',
  appliesWhen: ['cohort', 'retention', 'conversion', 'churn', 'funnel', 'denominator', 'survivorship', 'analytics', 'attribution'],
  smell: 'a retention/conversion cohort filters to active users, completed flows, known attributes, or joins to a post-outcome table — so the denominator uses information from AFTER the outcome window.',
  question: 'Is the cohort denominator FROZEN at eligibility time, or is it outcome-dependent (survivorship) — counting only the units that survived to produce the outcome?',
  decisiveTest: 'Rebuild the raw eligibility cohort as of the eligibility timestamp, BEFORE the outcome window; trace units that are later missing, deleted, or censored; and recompute the rate with documented censoring only. Null = a frozen eligibility denominator gives the same rate. Apply only documented censoring — do not drop units to clean the curve.',
  why: 'An outcome-dependent denominator manufactures survivorship, inflating retention/conversion and hiding exactly the churned users the metric is meant to catch.',
};

// ── Trust & Safety deep patterns (beyond moderationCoverageGap) ───────────────────────────────────
export const appealReversalStability: ProblemPattern = {
  id: 'appeal-reversal-stability',
  title: 'Decision stability under independent review (is enforcement precise, or just voluminous?)',
  appliesWhen: ['moderation', 'enforcement', 'appeal', 'reversal', 'reviewer', 'trust and safety', 'policy', 'safety', 'takedown'],
  smell: 'enforcement is reported as volume (actions taken) with no appeal/reversal or reviewer-disagreement linkage, so precision is assumed rather than measured.',
  question: 'Are enforcement decisions STABLE under independent re-review for the same policy version + evidence, or does the reported volume include decisions that flip when looked at again?',
  decisiveTest: 'Join enforcement → appeal → reversal by policy/model/reviewer/queue and measure appeal opportunity + selection; then run a BLINDED, stratified re-review that INCLUDES un-appealed decisions, not just appealed ones. Null = decision stability under independent review. Do not treat appeal rate as ground truth — appeal propensity is selected; pair it with the blind re-review.',
  why: 'Volume without stability hides both false positives (compliant content removed) and false negatives, and an appeal-only precision proxy is biased by who bothers to appeal.',
};
export const safetyLabelFeedbackLoop: ProblemPattern = {
  id: 'safety-label-feedback-loop',
  title: 'Safety-label feedback loop (is a safety signal also an optimization target?)',
  appliesWhen: ['moderation', 'safety', 'label', 'ranking', 'recommend', 'feature', 'training', 'trust and safety', 'engagement'],
  smell: 'moderation labels/scores appear in ranking or training features, or are updated after exposure, with no documented statement of whether safety state is purely an eligibility constraint.',
  question: 'Is safety state used ONLY as a documented eligibility constraint, or is it also feeding the engagement objective (so the system learns from / optimizes against the safety signal)?',
  decisiveTest: 'Trace static feature lineage from safety labels into ranking/training inputs; join label-at-serving to exposure/engagement for eligibility-matched items; and run an offline ablation / log replay holding label state constant. Null = NO UNDOCUMENTED path from the safety label/score into the ranking objective or training feedback — its role matches the documented config. Direction-free: labels may legitimately downrank, gate, or audit; the smell is UNDOCUMENTED optimization use, not the presence of a label.',
  why: 'If a safety signal silently shapes the training data, the system can learn to amplify borderline content (or over-suppress), and the safety label stops being a clean control.',
};
export const evasionClosure: ProblemPattern = {
  id: 'evasion-closure',
  title: 'Enforcement closure vs evasion (does a takedown close the entity, or just an id?)',
  appliesWhen: ['takedown', 'block', 'ban', 'reupload', 're-upload', 'evasion', 'recidivis', 'moderation', 'abuse', 'trust and safety'],
  smell: 'takedown/blocking acts on item or account ids while re-uploads create fresh ids, and "actioned" is counted per id with no linkage to successors.',
  question: 'Does enforcement close the linked CONTENT/ENTITY, or only the observed id — do actioned items/accounts recur under new ids before any applicable block/review?',
  decisiveTest: 'Link successors via available signals (content hash / perceptual hash / text / account / device / payment / IP), build the timeline action → linked re-upload → review → exposure, and measure recurrence reaching users before the applicable block/review decision. Null = enforcement closure (no linked recurrence reaches exposure outside policy). Use only available linkage signals; do not assert evasion without a defensible link.',
  why: 'Per-id enforcement can report high action volume while the same content/actor keeps reaching users under new ids — the harm is in the reachable repeats, not the first id.',
};

// ── Software-architecture deep patterns (swe-arch — the code-native bundle for engine/SDK/library orgs).
// The decisive move in each is an overlay of INDEPENDENT signals (churn × defect-fixes × tests × graph),
// never "big/old/complex = bad" alone. ──
export const changeAmplification: ProblemPattern = {
  id: 'change-amplification',
  title: 'Change amplification (every feature is a cross-module surgery)',
  appliesWhen: ['monorepo', 'refactor', 'tech debt', 'technical debt', 'architecture', 'coupling', 'game engine', 'sdk', 'framework', 'modules', 'c++'],
  smell: 'features and fixes repeatedly touch the same broad set of files across several modules/repos in one logical change, and "simple" changes keep growing review surface.',
  question: 'Is there a change amplifier — a shared god module, a leaky boundary, or duplicated knowledge — that forces one logical change to fan out across modules, and which boundary is leaking?',
  decisiveTest: 'From git history, cluster commits into logical changes and measure the modules touched per change (co-change sets); overlay the dependency fan-in/fan-out of the recurring shared files. Null = changes stay contained within their declared module boundary. Report the amplifier files + the co-change evidence; never flag mere size.',
  why: 'A change amplifier taxes every future feature with cross-module coordination and review load, and is where regressions from half-updated call sites are born.',
};
export const boundaryErosionCycles: ProblemPattern = {
  id: 'boundary-erosion-cycles',
  title: 'Boundary erosion (cycles and direction violations across declared layers)',
  appliesWhen: ['architecture', 'layering', 'module', 'monorepo', 'game engine', 'sdk', 'framework', 'refactor', 'dependency', 'c++'],
  smell: 'a "shared"/"common"/"utils" area keeps growing and everything imports it; imports point both ways between layers that docs/build files declare as one-directional.',
  question: 'Do the org\'s OWN declared boundaries still hold — is the dependency graph acyclic across them and does every edge point the declared direction — or has the architecture eroded into a tangle the docs no longer describe?',
  decisiveTest: 'Recover the declared layering (module layout, build targets, docs), build the import/include graph, and enumerate cross-boundary cycles + direction-violating edges with their concrete import sites. Null = acyclic across declared boundaries with all edges following the declared direction. A cycle inside one leaf module is not a violation.',
  why: 'Eroded boundaries make isolated testing and incremental builds impossible, turn refactors into big-bang rewrites, and mean the documented architecture no longer predicts change cost.',
};
export const hotspotDefectAdjacency: ProblemPattern = {
  id: 'hotspot-defect-adjacency',
  title: 'Hotspot ∩ defect density ∩ test gap (the risk overlay)',
  appliesWhen: ['tech debt', 'hotspot', 'bug', 'defect', 'refactor', 'code health', 'legacy', 'test coverage', 'game engine', 'sdk'],
  smell: 'the same few files keep appearing in fix commits, they rank worst on complexity/health, and no test changes ride along with the fixes.',
  question: 'Is defect-fixing concentrated in a small hot set that is ALSO the least tested and worst-structured — and is that overlay worsening — so the next regression is statistically already scheduled?',
  decisiveTest: 'Overlay three independent signals per file: churn (git), fix-commit density (bug-labelled/fix commits), and test co-change (does any test change with it). Null = fixes are not concentrated, or the concentrated set is test-covered. Report the overlay set with its evidence; size or complexity alone is not the defect.',
  why: 'The churn × defect × no-test intersection is where the next production regression comes from, and it silently taxes every release with re-fix work.',
};
export const busFactorCriticalPath: ProblemPattern = {
  id: 'bus-factor-critical-path',
  title: 'Ownership concentration on the critical path (bus factor)',
  appliesWhen: ['ownership', 'bus factor', 'maintainer', 'knowledge silo', 'departure', 'monorepo', 'game engine', 'sdk', 'core module'],
  smell: 'a subsystem every feature depends on has effectively one recent author (or its main author has departed), and changes by others there are rare, slow, or revert-prone.',
  question: 'Can the org still safely change its critical-path code without the one person who wrote it — or is delivery one departure away from stalling on a subsystem nobody else touches?',
  decisiveTest: 'From git history, compute per-module recent-author concentration and identify critical-path modules (high dependency fan-in) whose changes come from a single author; where an author departed, compare fix latency + revert rate on their modules before vs after. Null = critical-path modules have plural active ownership or a documented, evidenced handoff.',
  why: 'Single-owner critical code turns one resignation into a delivery stall, and review on that code is rubber-stamp because nobody else can evaluate it.',
};

// ── Release-engineering deep patterns (release-eng). The null is always the org's OWN declared gate/cadence,
// never an imported industry number. ──
export const retryUntilGreen: ProblemPattern = {
  id: 'retry-until-green',
  title: 'Retry-until-green (is CI a verdict or a negotiation?)',
  appliesWhen: ['flaky', 'flaky test', 'ci', 'github actions', 'jenkins', 'buildkite', 'retry', 'rerun', 're-run', 'quarantine', 'pipeline green'],
  smell: 're-running failed CI jobs until they pass is routine, a quarantine/skip list grows without shrinking, and nobody can say which failures were real.',
  question: 'Is a green pipeline a stable verdict on the same commit — or a negotiated outcome reached by re-running, so the signal that gates merges carries noise both ways (false red AND false green)?',
  decisiveTest: 'From CI run history, measure the share of runs that changed verdict on re-run with NO code change (retry-to-green), per workflow and over time; inventory the quarantine/skip list with each entry\'s age + owner. Null = a re-run does not change the verdict, and quarantines are owned + time-bounded.',
  why: 'A negotiated green trains engineers to ignore red, lets real regressions ride a re-roll into the default branch, and hides the true cost of the flake tax on every merge.',
};
export const mergeGateBypass: ProblemPattern = {
  id: 'merge-gate-bypass',
  title: 'Merge-gate bypass (does the declared gate actually gate?)',
  appliesWhen: ['branch protection', 'required check', 'merge queue', 'ci', 'admin merge', 'force merge', 'github actions', 'release process'],
  smell: 'the default branch is sometimes red, merges land while checks are pending/failed, and some checks exist but are not marked required.',
  question: 'Do merges to the default branch actually pass the gate the org DECLARES — or is there a routine path (admin merge, path filter, non-required check) by which substantive changes land ungated?',
  decisiveTest: 'Establish the declared gate from CI config + contribution docs; then, from merge/CI history, measure the share of default-branch merges whose required checks were green at merge time, and enumerate the bypass paths actually used. Null = the declared gate held for substantive merges; a documented, rare emergency bypass is process, not a defect.',
  why: 'A gate that can be routinely bypassed gives the org the compliance cost of CI without its protection — the audit trail says "checked" while regressions land ungated.',
};
export const releaseThenRevert: ProblemPattern = {
  id: 'release-then-revert',
  title: 'Release-then-revert (regressions detected by users, not by the pipeline)',
  appliesWhen: ['release', 'hotfix', 'revert', 'rollback', 'release train', 'release cadence', 'versioning', 'semver', 'changelog'],
  smell: 'reverts and hotfix releases cluster in the days right after each release, and patch releases routinely follow minors within the same cycle.',
  question: 'Does the release process catch regressions BEFORE shipping — or is the post-release window the real test environment, with users finding what the gate missed?',
  decisiveTest: 'From git tags + history, measure the density of reverts/hotfix commits in the window after each release versus the baseline rate between releases, over multiple releases. Null = post-release fix density is at the between-release baseline. Attribute clusters to their release; never judge a single incident.',
  why: 'A pipeline that ships regressions converts every release into an incident-response exercise and teaches the org to fear releasing — cadence then slows to compensate for missing verification.',
};
export const unpinnedBuildInputs: ProblemPattern = {
  id: 'unpinned-build-inputs',
  title: 'Unpinned build inputs (can a tagged release be rebuilt at all?)',
  appliesWhen: ['lockfile', 'pinned', 'toolchain', 'docker', 'base image', 'supply chain', 'cmake', 'bazel', 'gradle', 'npm install', 'curl'],
  smell: 'builds break with no code change; CI actions ride floating tags, dependencies have no committed lockfile, base images use mutable tags, and installers fetch "latest" at build time.',
  question: 'Is the release-path build a pure function of the tag — every toolchain, dependency, action, and base image pinned — or does it depend on the internet-of-today, so yesterday\'s release can no longer be rebuilt or trusted?',
  decisiveTest: 'Inventory the release path\'s inputs: manifests vs committed lockfiles, image tags vs digests, CI action refs vs SHAs, toolchain version declarations, fetch-at-build steps. Null = every release-path input is pinned (or floats under a documented update policy). Severity follows the release path, not dev-convenience workflows.',
  why: 'An unpinned release path means irreproducible builds, silent supply-chain drift into shipped artifacts, and no way to bisect "what changed" when users report a regression against the same source.',
};

// ── API-stability deep patterns (api-stability — for orgs whose product IS an SDK/engine/library, so the
// public API surface is the north-star asset). The null is the org's OWN declared versioning/deprecation
// contract; where none is declared, that absence is a documentation gap tracked separately, never a breach. ──
export const breakingChangeInMinor: ProblemPattern = {
  id: 'breaking-change-in-minor',
  title: 'Breaking changes riding "safe" version increments',
  appliesWhen: ['sdk', 'public api', 'semver', 'breaking change', 'library', 'framework', 'game engine', 'plugin api', 'changelog', 'versioning'],
  smell: 'users report breakage on patch/minor upgrades, migration threads follow "safe" releases, and nothing diffs the public surface against the version increment before shipping.',
  question: 'Do removals/renames/signature changes of the PUBLIC surface ship only under the increment the org\'s own versioning scheme declares for breaking changes — or do they ride minors and patches?',
  decisiveTest: 'Diff the public API surface (exported symbols / public headers / d.ts) between consecutive release tags; classify each removal/rename/signature change against the org\'s declared scheme. Null = breaking changes ship only under the declared breaking increment. No declared scheme = a documentation gap, tracked separately from a violation.',
  why: 'Every unannounced breaking change converts users\' upgrade path into an incident, teaches the ecosystem to pin old versions, and silently freezes the org\'s ability to ship security fixes users will actually take.',
};
export const deprecationWithoutWindow: ProblemPattern = {
  id: 'deprecation-without-window',
  title: 'Deprecation theater (marked but not honored, or removal without warning)',
  appliesWhen: ['deprecat', 'sdk', 'public api', 'semver', 'library', 'framework', 'migration guide', 'breaking change'],
  smell: 'symbols are removed without ever carrying a deprecation marker, or carry one and are removed in the very next release anyway, or stay "deprecated" forever with no removal plan — and no declared window exists.',
  question: 'Does the org honor a real deprecation contract — marked, migration-documented, and removed only after its declared window — or is the marker decorative?',
  decisiveTest: 'Build the deprecated→removed ledger from git history across releases: for each removed public symbol, was it marked, for how many releases, and with a migration note? Null = removals follow the declared deprecation window with a migration path. Measure both failure directions (removal-without-marking AND immortal deprecations).',
  why: 'A deprecation contract users cannot trust forces them to treat every upgrade as breaking, which suppresses adoption of new versions and multiplies the support surface the org must maintain.',
};
export const undocumentedPublicSurface: ProblemPattern = {
  id: 'undocumented-public-surface',
  title: 'Public surface outruns the documented surface',
  appliesWhen: ['sdk', 'public api', 'api reference', 'documentation', 'library', 'framework', 'game engine', 'docs coverage'],
  smell: 'the exported/public surface is far larger than the documented one, users learn APIs from source or forums, and issues reference symbols the docs never mention.',
  question: 'What share of the ACTUAL public surface (what users can reach) is documented and example-covered — and is the undocumented remainder deliberate (internal-but-exposed) or accidental?',
  decisiveTest: 'Enumerate the exported/public symbols from the code, diff against the API reference + examples; classify the undocumented remainder (deliberately internal / accidentally public / documented elsewhere). Null = the public surface is documented or explicitly tiered as internal. Report shares, never judge single symbols.',
  why: 'Undocumented-but-reachable APIs accumulate de-facto users the org does not know about, so every "internal" change becomes a potential silent breaking change (Hyrum\'s law) and the docs stop being the contract.',
};
export const silentApiChange: ProblemPattern = {
  id: 'silent-api-change',
  title: 'API-touching changes missing from release notes',
  appliesWhen: ['changelog', 'release notes', 'sdk', 'public api', 'library', 'framework', 'migration'],
  smell: 'release notes are thin or auto-generated while the diff between tags touches public headers/exports; users discover behavior changes from stack traces, not notes.',
  question: 'Does every public-surface-touching change between two releases appear in the release notes/changelog — or does the org ship API changes its own notes never mention?',
  decisiveTest: 'For consecutive release-tag pairs, list the public-surface files/symbols the diff touched and reconcile against the release notes/changelog entries. Null = API-touching changes are release-noted. Behavior changes under an unchanged signature count when tests/docs reveal them.',
  why: 'Unannounced API changes destroy the release notes as an upgrade contract — users either stop upgrading or budget a re-test of everything per release, both of which shrink the org\'s effective user base.',
};

// ── Application-security / supply-chain deep patterns (appsec). Defensive posture only: inventory + provenance
// + coverage, never exploitation. The null is the org's OWN declared policy where one exists. ──
export const knownVulnDependencyDebt: ProblemPattern = {
  id: 'known-vuln-dependency-debt',
  title: 'Known-vulnerable dependencies on the release path',
  appliesWhen: ['security', 'vulnerabilit', 'cve', 'dependenc', 'lockfile', 'sbom', 'supply chain', 'dependabot', 'npm audit'],
  smell: 'dependency manifests lack lockfiles or the locks are old; no process consumes vulnerability advisories; upgrades happen only when something breaks.',
  question: 'Which LOCKED dependency versions on the release path carry publicly-known vulnerabilities, how severe, and how long has a fixed version been available un-adopted?',
  decisiveTest: 'Resolve the locked dependency set (lockfiles / vendored manifests) and query it against a public advisory database (e.g. OSV); weight findings by severity and by whether the dependency ships in the release artifact vs dev-only; measure the lag from fixed-version-available to adopted. Null = no known high-severity advisory on the release path beyond the org\'s declared patch window.',
  why: 'A known vuln with a public fix is the cheapest attack in the book — the exposure is not the bug but the adoption lag, and an SDK/engine ships that lag to every downstream user.',
};
export const fetchAndExecuteSupplyChain: ProblemPattern = {
  id: 'fetch-and-execute-supply-chain',
  title: 'Fetch-and-execute build steps (the internet is in the build)',
  appliesWhen: ['supply chain', 'curl', 'install script', 'ci', 'github actions', 'docker', 'security', 'pipeline'],
  smell: 'build/CI/doc steps download and run scripts or binaries at build time (curl | sh, unpinned installers, floating action tags), so what executes depends on what the remote serves that day.',
  question: 'Where does the build/release path fetch-and-execute unverified remote content, and can any of those sites silently change what ships?',
  decisiveTest: 'Inventory every fetch-and-execute site on the build/release path (CI config, Dockerfiles, install/bootstrap scripts, doc quickstarts); classify each as pinned+verified (SHA/digest/checksum) vs floating/unverified. Null = no unverified fetch-and-execute on the release path; doc-only quickstarts rank lower but are counted.',
  why: 'One unverified fetch on the release path hands a remote party a write primitive into the shipped artifact — the classic supply-chain entry — and no amount of code review of the repo itself can see it.',
};
export const vendoredBlobProvenance: ProblemPattern = {
  id: 'vendored-blob-provenance',
  title: 'Vendored binaries / third-party code without provenance',
  appliesWhen: ['vendored', 'third-party', 'third party', 'binary', 'blob', 'prebuilt', 'security', 'license', 'supply chain', 'sbom'],
  smell: 'the tree carries prebuilt binaries, minified bundles, or forked third-party code with no recorded origin, version, checksum, or license — nobody can say what it is or rebuild it.',
  question: 'For every vendored artifact: what is it, where did it come from, can it be reproduced from source, and would anyone notice if it changed?',
  decisiveTest: 'Inventory vendored binaries/blobs/forked third-party dirs; for each, check recorded origin+version, checksum/attestation, license, and whether an upstream-sync process exists. Null = vendored artifacts carry provenance and are verifiable. A silent fork that has diverged from a patched upstream is the compound case — flag with the missing upstream fixes.',
  why: 'An unattested blob is unauditable and silently swappable, and a diverged silent fork keeps upstream\'s security fixes from ever arriving — both invisible to normal code review.',
};
export const untrustedInputFuzzGap: ProblemPattern = {
  id: 'untrusted-input-fuzz-gap',
  title: 'Untrusted-input surfaces without fuzz/sanitizer coverage',
  appliesWhen: ['fuzz', 'sanitizer', 'asan', 'parser', 'decoder', 'loader', 'file format', 'security', 'game engine', 'untrusted input', 'c++'],
  smell: 'the code parses untrusted input (asset files, network messages, user content) in a memory-unsafe language, and no fuzz harness, sanitizer CI job, or documented risk acceptance exists for those surfaces.',
  question: 'Which entry points consume UNTRUSTED input, and which of them have fuzz/sanitizer coverage (or a documented reason not to) — is the most exposed parser also the least tested?',
  decisiveTest: 'Map untrusted-input entry points (file-format parsers, decoders, network deserializers, script loaders) from the code; cross with fuzz harnesses / sanitizer CI presence per surface. Null = exposed surfaces are fuzzed/sanitized or carry documented risk acceptance. Report the surface × coverage matrix; never attempt exploitation.',
  why: 'For an engine/SDK, a malformed-asset crash is every downstream app\'s crash — and parser bugs in unsafe code are the canonical remote-compromise path; coverage gaps here are inherited by the whole ecosystem.',
};

// ── Mobile-native deep patterns (mobile-ios / mobile-android — the code-native bundles for a shippable
// mobile APP). Shared, platform-neutral METHOD only: each states the smell in both iOS and Android evidence
// forms, and the decisive move is an OVERLAY (a signature × its reachability / its declared intent), never a
// naked count. The null is the app's OWN declared intent or the platform's PUBLISHED contract — never a number
// lifted from any one app. These are folded into BOTH mobile bundles' Critique (see domainBundles.ts). ──
export const mainThreadConfinement: ProblemPattern = {
  id: 'main-thread-confinement',
  title: 'Main/UI-thread confinement (does blocking work reach the render thread?)',
  appliesWhen: ['ios', 'android', 'swift', 'kotlin', 'swiftui', 'uikit', 'jetpack compose', 'main thread', 'anr', 'jank', 'dispatchqueue', 'coroutine', 'runblocking'],
  smell:
    'I/O surfaces (network, disk, database, keychain/keystore, crypto) are invoked from code the UI thread runs — a ' +
    '@MainActor / main-queue context or a SwiftUI body on iOS; a lifecycle callback, a Composable, or an un-dispatched ' +
    'suspend/blocking call on Android — with no evidence the work is confined off the main thread.',
  question:
    'Is every blocking / long-running I/O surface confined OFF the main/UI thread on the paths a screen renders from — ' +
    'or can a render/lifecycle path reach one synchronously (→ jank on iOS, an ANR on Android)?',
  decisiveTest:
    'Enumerate I/O call sites, then OVERLAY each with reachability from a render/lifecycle symbol and with its ' +
    'dispatch context (off-main actor/dispatcher vs main). Null = I/O reachable from render is confined off-main. ' +
    'Never count DispatchQueue / runBlocking occurrences — a runBlocking on a known-background executor is healthy; ' +
    'the defect is the reachable-from-render × on-main intersection. Thread-of-execution not decidable statically is low-confidence.',
  why:
    'Main-thread I/O is the direct cause of dropped frames (iOS) and Application-Not-Responding kills (Android, a ' +
    'Play-tracked vital that gates store standing) — the most visible reliability defect a mobile user feels.',
};
export const lifecycleOwnershipLeak: ProblemPattern = {
  id: 'lifecycle-ownership-leak',
  title: 'Lifecycle ownership leak (an object outlives the screen that owns it)',
  appliesWhen: ['ios', 'android', 'swift', 'kotlin', 'retain cycle', 'memory leak', 'weak self', 'context leak', 'activity leak', 'lifecycle', 'globalscope', 'viewmodelscope', 'handler'],
  smell:
    'a long-lived owner strongly captures a screen-scoped object: on iOS a stored/escaping closure or delegate captures ' +
    'self without [weak self], or a Timer/observer is never invalidated; on Android a static/companion field or a ' +
    'non-static Handler holds an Activity/View/Context, or UI work launches on an unstructured scope (GlobalScope).',
  question:
    'Do screen-scoped objects get released when their screen goes away — or does a longer-lived owner strongly retain ' +
    'them (a retain cycle on iOS, a Context/Activity leak or unscoped coroutine on Android) so each visit leaks a screen?',
  decisiveTest:
    'Restrict to captures a LONGER-LIVED owner holds: stored/escaping self-captures without [weak self] (iOS), ' +
    'static/companion Context holders + non-static delayed Handlers (Android), UI-triggered launches not on a ' +
    'lifecycle-bound scope. OVERLAY with whether the captured type is a view/VM/Context. Null = screen-scoped objects ' +
    'are weakly held or lifecycle-scoped. A raw [weak self]-vs-self ratio, a companion-object count, or GlobalScope for ' +
    'app-lifetime work is NOT the defect. Actual leak confirmation needs runtime — mark that portion low-confidence.',
  why:
    'Leaked screens accumulate into memory pressure and OOM kills on constrained devices, drain battery, and turn a ' +
    'long session into a crash — a class of defect that never appears in a quick manual test.',
};
export const platformContractCompliance: ProblemPattern = {
  id: 'platform-contract-compliance',
  title: 'Platform / store contract (a HARD external gate, not a code smell)',
  appliesWhen: ['ios', 'android', 'app store', 'play store', 'privacy manifest', 'xcprivacy', 'targetsdk', 'app review', 'store rejection', 'required reason', 'data safety'],
  smell:
    'the app links tracking/analytics SDKs and calls platform-restricted APIs but declares nothing the platform now ' +
    'requires — no iOS privacy manifest / required-reason declarations, or an Android targetSdk under the level the ' +
    'store enforces / a cleartext or data-disclosure posture the store policy no longer accepts.',
  question:
    "Does the app satisfy the platform's OWN published, currently-enforced requirements for shipping — or is it carrying " +
    'a latent App-Store rejection / Play removal that a code review would never surface?',
  decisiveTest:
    "Reconcile the repo against the platform's PUBLISHED contract (see the dated platform-contract reference): iOS — a " +
    'privacy manifest present and covering every required-reason API family the code calls + every linked tracking SDK; ' +
    'Android — targetSdk at/above the store-enforced floor, cleartext default-deny in prod, data-disclosure posture. ' +
    "Null = the app meets the platform's published contract. The null is the platform's dated rule, never an invented " +
    'threshold; absence of tracking SDKs lightens the requirement rather than being a false positive.',
  why:
    'A missing privacy manifest or an under-target SDK is not style — it blocks the release outright at review, so it is ' +
    'the highest-consequence, most-deterministic finding a mobile audit can surface.',
};
export const permissionLeastPrivilege: ProblemPattern = {
  id: 'permission-least-privilege',
  title: 'Permission least-privilege & external attack surface',
  appliesWhen: ['ios', 'android', 'permission', 'androidmanifest', 'info.plist', 'exported', 'deep link', 'intent filter', 'usage description', 'entitlement', 'background mode'],
  smell:
    'the app declares permissions / capabilities that no code path exercises, declares one twice, or requests dangerous ' +
    'access without a runtime-request path; and externally-reachable entry points (exported components + deep links on ' +
    'Android, universal-link / URL-scheme handlers on iOS) accept input without an evident validation path.',
  question:
    'Is every declared permission/capability actually used and justified, and is every externally-reachable entry point ' +
    'intentionally public AND validating its inbound input — or is the app carrying over-broad access and an ' +
    'un-validated external surface?',
  decisiveTest:
    'Reconcile declared permissions/capabilities against actual API usage (over-broad = declared-never-used; also ' +
    'duplicates, dangerous-without-runtime-request); enumerate truly externally-reachable entry points and check inbound ' +
    'input handling. Null = declared access is used + justified and the external surface is intentional + input-validated. ' +
    'A permission is judged over-broad only against absent usage, and a vendor/OEM permission against whether its matching SDK is present.',
  why:
    'Over-broad permissions are a privacy-review liability and a store-listing risk; an un-validated exported/deep-link ' +
    'surface is the classic path by which another app or a crafted link drives the app into an unintended state.',
};
export const bridgeTrustBoundary: ProblemPattern = {
  id: 'bridge-trust-boundary',
  title: 'Native ↔ foreign-context bridge trust boundary',
  appliesWhen: ['ios', 'android', 'webview', 'javascript interface', 'addjavascriptinterface', 'wkscriptmessagehandler', 'method channel', 'react native', 'bridge', 'jsbridge', 'hybrid'],
  smell:
    'native code exposes a bridge to a less-trusted or foreign execution context — a WebView JS interface, a ' +
    'cross-platform-runtime channel (platform channel / native module / plugin) — and a handler hands a credential or a ' +
    'native capability across it, or loads content whose origin is not constrained to a first-party source.',
  question:
    'For each native↔foreign-context bridge: is inbound content origin-constrained and the interface minimal, and does ' +
    'any handler pass a credential / privileged native capability to code running in the foreign (web / cross-platform) ' +
    'context that could be attacker-influenced?',
  decisiveTest:
    'Enumerate bridges by GENERAL API signature (JS-enabled WebView + addJavascriptInterface/@JavascriptInterface/' +
    'WKScriptMessageHandler; cross-platform channels/native modules), and per handler check: origin/validation of the ' +
    'caller, minimality of the exposed surface, and whether a credential/native capability crosses the boundary. Null = ' +
    'bridges validate origin and expose no credential/privileged capability to attacker-influenceable content. Detected ' +
    'by signature, never by any specific bridge/channel name.',
  why:
    'A bridge that hands a live token or a filesystem/camera capability to web content turns any content-injection into a ' +
    'native-capability compromise — the highest-severity boundary in a hybrid mobile app, and invisible to a data-plane audit.',
};
export const inBinarySecretCapability: ProblemPattern = {
  id: 'in-binary-secret-capability',
  title: 'In-binary secret exposure (classified by capability, not by count)',
  appliesWhen: ['ios', 'android', 'secret', 'api key', 'hardcoded', 'token', 'signing', 'keystore', 'credential', 'dsn', 'client secret'],
  smell:
    'secrets appear hardcoded in source, resources, or build config that ship inside the distributable binary (extractable ' +
    'by any user) — mixed together with public-by-design client identifiers, and reasoned about as one undifferentiated pile.',
  question:
    'Which committed/in-binary secrets grant a SERVER-side or privileged CAPABILITY if extracted (a real exposure), and ' +
    'which are public-by-design client identifiers or weak-but-bounded items — and is each judged by what it can actually DO?',
  decisiveTest:
    'Detect candidates by general secret SHAPE (entropy + known key formats) across source/resources/build config, then ' +
    'classify each by CAPABILITY × REACHABILITY: a server-capable key on a shipped path is the defect; a public client ' +
    'identifier is a fact only; a weak credential whose backing artifact is NOT committed is reported WITH its bounded ' +
    'exposure. Null = no server-capability secret ships in the binary. Never lump a public identifier with a real secret; ' +
    'honor a documented, dated low-sensitivity acceptance.',
  why:
    'A mobile binary is handed to users, so an embedded server-capable key is a give-away credential; but a detector that ' +
    'screams at every client identifier is noise that gets the whole bundle ignored — capability is what makes it real.',
};
export const inputBoundaryCrashSurface: ProblemPattern = {
  id: 'input-boundary-crash-surface',
  title: 'Crash surface at external-input boundaries',
  appliesWhen: ['ios', 'android', 'swift', 'kotlin', 'force unwrap', 'crash', 'deep link', 'push notification', 'json decode', 'intent extra', 'null safety'],
  smell:
    'unconditional unwraps of untrusted data sit on the paths that decode EXTERNAL input — force-unwrap / try! / as! / ' +
    'forced subscript on iOS, !! / unchecked cast / unguarded Intent-extra reads on Android — where a malformed server ' +
    'response, deep link, push payload, or IPC message reaches them.',
  question:
    'On the paths that decode external input (network JSON, deep/universal links, push payloads, IPC/Intent extras), does ' +
    'the app avoid unconditional unwraps — or does a malformed input crash it deterministically?',
  decisiveTest:
    'OVERLAY unwrap/force-cast density with proximity to an external-input boundary (decode / deep-link / push / IPC entry). ' +
    'Null = external-input decode paths carry no unconditional unwrap. A raw force-unwrap / !! count is explicitly NOT the ' +
    'metric — an unwrap of a compile-time constant or a static regex is healthy; only the reachable-from-untrusted-input ones count.',
  why:
    'External-input crashes are attacker-triggerable and field-triggerable (one bad server payload or crafted link crashes ' +
    'every user at once), and they cluster exactly where a raw lint count is noisiest and least actionable.',
};

// The shared mobile method spine — both mobile-ios and mobile-android prime their Critique with these
// (via mergedPatterns; de-duped by id, so activating both does not double them).
export const MOBILE_PATTERNS: ProblemPattern[] = [
  mainThreadConfinement, lifecycleOwnershipLeak, platformContractCompliance, permissionLeastPrivilege,
  bridgeTrustBoundary, inBinarySecretCapability, inputBoundaryCrashSurface,
];

// ── Product-logic deep patterns (product-logic, Phase 2) ─────────────────────
// Every bundle above audits whether a system's DATA, MODELS, CODE or DELIVERY are sound. None asks whether the product's
// own business rules do what its users and the business were promised: a limit enforced in the UI but not on the server,
// a status nobody handles, a share link that shows more than the product says it does, a number on a customer's screen
// computed differently from its label. These are the findings a leader acts on. Method only: every pattern's null is
// the product's OWN declared rule (its UI copy, docs, types, constants, config, migrations) reconciled against another
// surface of the SAME product — never a rule, threshold or feature name imported from any one app. Defensive and
// read-only: an authorization question is asked as "does the guard match the product's own promise", never probed. ──
export const businessRuleParity: ProblemPattern = {
  id: 'business-rule-parity',
  title: 'One business rule, two implementations that disagree',
  appliesWhen: ['quota', 'usage limit', 'plan limit', 'validation', 'pricing', 'eligib', 'billing', 'subscription', 'entitlement', 'business rule', 'business logic'],
  smell: 'the same rule (a limit, a validation, a price, an eligibility condition) is written in more than one place — a client-side check and a server-side check, two services, a UI label and the code that computes it — with nothing tying them to one definition.',
  question: 'Do the independent implementations of this rule give the SAME answer for the same input, or does one surface allow, charge, count or reject what another does not?',
  decisiveTest: 'Locate every site that implements or states the rule (constants, validators, schema constraints, UI copy, docs); reconcile their bounds / conditions / formulas on the same inputs, including the edge values. Null = every site resolves to one definition (shared constant or one enforcing layer that the others defer to).',
  why: 'A rule that differs by surface is broken for someone by construction — users are rejected for what the UI allowed, or get what the business never sells — and every support ticket about it looks like a one-off.',
};
export const lifecycleStateCompleteness: ProblemPattern = {
  id: 'lifecycle-state-completeness',
  title: 'A status set the code does not fully handle',
  appliesWhen: ['status enum', 'state machine', 'workflow', 'lifecycle', 'order status', 'subscription', 'invite', 'soft delete', 'archived'],
  smell: 'an entity carries a status / type enum, but the branches that act on it (switches, filters, guards, UI renders, background jobs) each list a different subset of its values.',
  question: 'For each declared state, is every transition the product allows actually handled — and can an entity reach a state nothing handles, or leave a terminal state it should never leave?',
  decisiveTest: 'Recover the declared state set (enum / type / constraint / migration) and the transitions (writes that set it); cross with every consumer that branches on it. Report the state × consumer matrix: unhandled values (fall-through / default), unreachable states, and terminal states still acted on (e.g. a removed entity still counted or served). Null = every consumer handles every reachable state explicitly or by a documented default.',
  why: 'An unhandled state is a user stuck in limbo — an item that cannot be finished, a removed record that still shows up, a paid plan treated as free — and it hides until one user hits the exact path.',
};
export const productAccessRuleParity: ProblemPattern = {
  id: 'product-access-rule-parity',
  title: 'Who may see or do what: the product\'s promise vs the guards',
  appliesWhen: ['user role', 'permission', 'sharing', 'share link', 'team member', 'viewer', 'public link', 'access control', 'invite', 'collaborat'],
  smell: 'the product states an access model (roles, ownership, team membership, public / shared views) in its UI, types or docs, but each route or query applies its own ad-hoc check — some by role, some by ownership, some not at all.',
  question: 'For each capability the product exposes, does the guard on the route / query enforce exactly the product\'s own rule for who may see or do it — no more, no less?',
  decisiveTest: 'Recover the product\'s declared access model (role enums, permission maps, sharing settings, UI gating) and, per route / query touching a protected entity, the check it applies. Report the capability × role matrix of declared vs enforced; flag an enforced set wider than declared (a shared view exposing more than the product says) and narrower than declared (a paid or granted feature refused). Read-only reconciliation — never probe a live endpoint. Null = enforced equals declared for every capability.',
  why: 'An access rule that disagrees with the product\'s promise either leaks a customer\'s data to people they never shared it with, or blocks the people they did — both break the product\'s core promise, not just its security posture.',
};
export const displayedMetricSemantics: ProblemPattern = {
  id: 'displayed-metric-semantics',
  title: 'A number customers see is not what its label says',
  appliesWhen: ['dashboard', 'chart', 'stats', 'csv export', 'digest email', 'customer-facing', 'user-facing', 'business logic'],
  smell: 'a customer-facing number (a dashboard tile, an export column, a digest email) is computed by a query or formula whose population, deduplication, filter or unit differs from its label, tooltip or docs — or two surfaces label the same thing and compute it differently.',
  question: 'Does each customer-facing number compute what its own label and docs say, and do two surfaces that show the "same" number compute it the same way?',
  decisiveTest: 'For each surfaced number, pair the label / docs text with the code that computes it (query, aggregation, formula) and state the definition each implies (population, distinctness, filters, window, unit); diff across surfaces that show the same label, including alternative storage back-ends or query paths. Null = every label matches its computation and same-label numbers share one definition.',
  why: 'Customers make decisions on the numbers the product shows them; a number that silently means something else is a broken product promise that no error log will ever surface.',
};
export const periodAndAmountBoundaries: ProblemPattern = {
  id: 'period-and-amount-boundaries',
  title: 'Time windows and amounts off at the boundary',
  appliesWhen: ['timezone', 'time zone', 'date range', 'billing cycle', 'invoice', 'currency', 'rounding', 'data retention', 'retention policy', 'expir'],
  smell: 'user-facing aggregates, quotas or charges bucket by day / month or cut a range, and the code mixes the user\'s timezone with the server\'s, treats range ends inconsistently (inclusive vs exclusive), or rounds / converts amounts in more than one place.',
  question: 'At the boundaries a user can see — the start and end of a day, a period, a retention window, a billing cycle — does the product count, charge or keep exactly what its own rule says?',
  decisiveTest: 'Trace each user-facing window from input (the selected range / plan period / retention setting) to the query or job that applies it: timezone of the bucket, inclusivity of each end, the unit of the stored value, and every rounding / conversion step. Null = one timezone rule and one inclusivity rule per window, one rounding point per amount; a boundary value lands in exactly one bucket.',
  why: 'Boundary errors look like small numbers but hit every user every period — a day of data in the wrong bucket, a customer charged or cut off a day early, data kept past or deleted before its promised window.',
};
export const sideEffectApplyOnce: ProblemPattern = {
  id: 'side-effect-apply-once',
  title: 'A user-visible side effect applied twice on retry',
  appliesWhen: ['webhook', 'idempot', 'redeliver', 'at-least-once', 'credits', 'charge', 'notification', 'usage counter'],
  smell: 'an operation that a user can see the effect of (a credit, a charge, a sent message, a usage counter, a created record) runs in a handler, job or webhook that can be retried or delivered twice, with no idempotency key or uniqueness guard.',
  question: 'If the triggering request, job or delivery runs twice, is the user-visible effect applied once — or twice?',
  decisiveTest: 'Enumerate the paths that apply a user-visible side effect; for each, whether it can re-run (client retry, queue redelivery, cron overlap, webhook replay) and what makes a second run a no-op (idempotency key, unique constraint, compare-and-set, dedupe table). Null = every re-runnable path has a guard that makes the second application a no-op.',
  why: 'A double-applied effect is a customer charged twice, messaged twice or over-counted — visible, embarrassing, and usually found by the customer first.',
};
export const contradictoryFlagConfig: ProblemPattern = {
  id: 'contradictory-flag-config',
  title: 'Feature flags and config that silently change what users get',
  appliesWhen: ['feature flag', 'feature toggle', 'kill switch', 'self-host', 'edition', 'cloud mode'],
  smell: 'user-visible behaviour is switched by flags / env settings / edition checks, some of which are never set anywhere, always one value, contradict each other, or gate the UI but not the server path behind it.',
  question: 'Which flags or settings change what users can see or do, and are any dead (one value everywhere), contradictory (two flags for one behaviour that can disagree) or half-applied (the UI hidden, the capability still reachable, or the reverse)?',
  decisiveTest: 'Inventory every flag / setting read in a user-facing path, with where it is defined, defaulted and read; classify dead (single reachable value), contradictory (two switches for one behaviour with a disagreeing combination) and half-applied (gates one layer of a capability but not the others). Null = every user-visible switch is live, single-sourced and applied at every layer of its capability.',
  why: 'A half-applied or contradictory switch means the product behaves differently from what anyone configured — a feature "off" that still works, or "on" that silently does nothing — and nobody can say which is intended.',
};
// The product-logic Critique's seed spine (via domainBundles.ts productLogic).
export const PRODUCT_LOGIC_PATTERNS: ProblemPattern[] = [
  businessRuleParity, lifecycleStateCompleteness, productAccessRuleParity, displayedMetricSemantics,
  periodAndAmountBoundaries, sideEffectApplyOnce, contradictoryFlagConfig,
];

export const PROBLEM_PATTERNS: ProblemPattern[] = [
  recallSourceIncrementalValue,
  exposureFeedbackAmplification,
  silentFreshnessDecay, lineageBlastRadius, lateArrivalBackfillEquivalence, partitionPruningCostEquivalence,
  metricDefinedTwoWays, segmentMixDecomposition, registeredReadoutIntegrity, frozenCohortDenominator,
  moderationCoverageGap, appealReversalStability, safetyLabelFeedbackLoop, evasionClosure,
  changeAmplification, boundaryErosionCycles, hotspotDefectAdjacency, busFactorCriticalPath,
  retryUntilGreen, mergeGateBypass, releaseThenRevert, unpinnedBuildInputs,
  breakingChangeInMinor, deprecationWithoutWindow, undocumentedPublicSurface, silentApiChange,
  knownVulnDependencyDebt, fetchAndExecuteSupplyChain, vendoredBlobProvenance, untrustedInputFuzzGap,
  ...MOBILE_PATTERNS,
  ...PRODUCT_LOGIC_PATTERNS,
];

// Patterns whose activation signals appear in any connected text (scope / org map / brief). Same
// cheap keyword match as bundlesFor — a Comprehend step can later pass an explicit set instead.
export function patternsFor(...texts: (string | undefined)[]): ProblemPattern[] {
  const hay = texts.filter(Boolean).join('\n').toLowerCase();
  return PROBLEM_PATTERNS.filter((p) => p.appliesWhen.some((s) => hay.includes(s.toLowerCase())));
}

// Render selected patterns as a value-free priming block for the Critique prompt. Returns '' for an
// empty set so callers can interpolate unconditionally.
export function renderPatterns(patterns: ProblemPattern[]): string {
  if (!patterns.length) return '';
  const body = patterns.map((p, i) =>
    `${i + 1}. ${p.title}\n   - smell: ${p.smell}\n   - ask: ${p.question}\n   - decisive test: ${p.decisiveTest}\n   - why it matters: ${p.why}`,
  ).join('\n');
  return `SEED PATTERNS (anonymized method shapes of deep, high-value problems for this domain — use them to ` +
    `make sure the SHARP question gets asked where the evidence fits; they are questions + nulls, never ` +
    `findings, and carry no expected answer. Only pose one if you actually find the smell in THIS system):\n${body}\n`;
}

// ── Cross-cutting DATA-TRUST patterns ──────────────────────────────────────────────────────────────────────
// Data-trust is not just a standalone floor — it is CROSS-CUTTING. These value-free patterns are folded into EVERY
// domain Critique (see experts.ts `mergedPatterns`), so recsys / data-eng / analytics / trust-safety raise metric-trust
// issues LOCALLY, every run — the concerns the always-on `baseline` used to own, now carried where the domain evidence
// is. Two are reused from above (definition + freshness); two are added here (cross-source agreement + instrumentation
// coverage). Baseline stays a selectable dedicated data-trust pass (Comprehend's call); these keep coverage present cheaply.
export const crossSourceMetricDisagreement: ProblemPattern = {
  id: 'cross-source-metric-disagreement',
  title: 'Two surfaces report the "same" metric differently',
  appliesWhen: ['metric', 'kpi', 'dashboard', 'report', 'warehouse', 'event', 'analytics', 'rate', 'funnel', 'north star'],
  smell:
    'a headline metric is computed in more than one place (a dashboard, a warehouse query, an app event) and the ' +
    'definitions have drifted — different denominators, populations, or calibers — so stakeholders quote numbers that do not reconcile.',
  question:
    'Do the independent definitions of this metric AGREE once computed on the SAME population and window, or does the ' +
    'gap come from denominator / caliber / source differences rather than a real movement?',
  decisiveTest:
    'recompute each definition on one shared population + window and compare; a persistent gap that tracks the ' +
    'definition (not the data) confirms a cross-source disagreement, not a real change.',
  why: 'decisions get made on whichever number is at hand; a silent definitional gap misroutes attention and erodes trust in every downstream metric.',
};
export const instrumentationCoverageGap: ProblemPattern = {
  id: 'instrumentation-coverage-gap',
  title: 'A rate whose numerator event is not emitted for the whole population',
  appliesWhen: ['event', 'instrumentation', 'tracking', 'amplitude', 'telemetry', 'emit', 'analytics', 'rate', 'funnel', 'sdk', 'client'],
  smell:
    'a rate uses a client / event-count numerator that some platform, app version, or code path fails to emit — so the ' +
    'rate moves with instrumentation coverage, not with the underlying behavior.',
  question:
    'Is the numerator event actually emitted across EVERY segment (platform / version / surface) the denominator counts, ' +
    'or is a cohort structurally under-counted?',
  decisiveTest:
    'measure the event\'s emission-presence rate by segment; a segment whose presence rate is far below the others ' +
    'confirms a coverage gap, not a behavior change.',
  why: 'an uninstrumented cohort makes a healthy surface look broken (or hides a real regression), and every rate built on that event inherits the blind spot.',
};
// The shared set folded into every domain Critique. metricDefinedTwoWays (single canonical definition) + silentFreshnessDecay
// (freshness / ingestion lag) are reused from above; the two new ones cover cross-source agreement + instrumentation coverage.
export const TRUST_PATTERNS: ProblemPattern[] = [metricDefinedTwoWays, silentFreshnessDecay, crossSourceMetricDisagreement, instrumentationCoverageGap];
