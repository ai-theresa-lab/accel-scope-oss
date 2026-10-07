// The detection backbone: GENERAL "data-trust" invariants that every data-driven
// org should satisfy but commonly violates. A company's specific pain point is a
// SYMPTOM of a violated invariant — so detecting invariant *violations* generalizes
// across companies (this is NOT a hardcoded list of one company's issues). Each
// invariant ships a general investigative PLAYBOOK (evidence to gather + violation
// patterns + how to confirm) that an agent applies against whatever data sources
// are connected. No company-specific names appear here — only methods.

export interface Invariant {
  key: string;      // stable key (i1.. built-in | u1..uN user-derived, see research/deriveDimensions.ts)
  title: string;
  aim: string;      // the invariant the org should hold
  playbook: string; // general investigative method
  owner?: string;   // the BUNDLE that owns this invariant — 'baseline' (data-trust core) or a domain bundle id. Drives the picker grouping.
  mount?: 'floor' | 'bundle' | 'gated'; // UX/runtime policy: 'floor' = baseline data-trust core; 'bundle' = runs with its owner bundle; 'gated' = only on activation / explicit pick
  origin?: 'builtin' | 'user'; // undefined ⇒ built-in; 'user' ⇒ derived from the run brief
}

// CONSOLIDATED data-trust invariants: the former 11 general invariants condensed to 6, each tagged with its
// OWNER bundle (drives the invariant picker's grouping) + a mount policy. The five `baseline`/`floor` ones are the
// data-trust core; `i10` experiment validity is owned by the analytics bundle. Overlapping pairs were merged (i1+i5,
// i2+i3, i6+i7, i9+i11) and i8 cost-efficiency dropped from the trust core (operational, not data-trust). Keys are kept
// stable (survivors i1/i2/i4/i6/i9/i10) so INV_DIM + stored findings still resolve; the merged-away keys are retired.
export const INVARIANTS: Invariant[] = [
  {
    key: 'i1', owner: 'baseline', mount: 'floor',
    title: 'Metric definition — canonical & stable',
    aim: 'Each business metric has ONE canonical definition that every computation agrees on, and that definition does not silently change over time.',
    playbook: `Find the named metrics the org cares about (grep metric names across transform SQL, BI queries, app code, docs). For each, collect ALL computations of it (warehouse SQL, transform models, dashboard queries, app code), normalize them (parse the SQL), and compare numerator / denominator / filters / joins / window. FLAG metrics computed >1 way, or with no single owning definition. If a semantic-layer source exists, treat it as canonical and flag whatever disagrees.
STABILITY OVER TIME: diff a metric's defining SQL/code across git history; find edits that change semantics (a switched column/source, a changed filter, a windowing or unit change). Correlate each edit (and app/release versions) with step-changes in the metric. FLAG "the metric moved because the calculation changed, not because users changed" — the silent definition-change trap. Confirm with the divergent expression (file:line / model / query-id) and, for a drift, the diff + the step-change timing.`,
  },
  {
    key: 'i2', owner: 'baseline', mount: 'floor',
    title: 'Cross-source agreement & plausibility',
    aim: 'The same metric reconciles across independent sources within tolerance, and every metric obeys hard constraints (rates ≤ 100%, funnels monotonic, corroborating signals co-move).',
    playbook: `Identify metrics derivable from >1 independent source (e.g. an analytics platform AND the warehouse AND a mart). For a fixed window, compute the metric from each source (run read-only SQL where a warehouse tool is available; otherwise read the defining code). Quantify the discrepancy; FLAG gaps beyond a small tolerance and localize the cause (different event source / filter / join / dedup / timezone). Confirm with the two numbers + the divergence point.
PLAUSIBILITY & INTERNAL CONSISTENCY: run read-only checks (or inspect the defining SQL) for impossible/incoherent values — rates > 100%, non-monotonic funnels, a metric moving while an independent corroborating signal does not, or the same entity yielding materially different values via different columns/sources. FLAG each violation with the offending value and the query/column that produced it.`,
  },
  {
    key: 'i4', owner: 'baseline', mount: 'floor',
    title: 'Explainable change',
    aim: 'Every material metric movement decomposes into behavior / mix-shift / measurement / cycle / experiment.',
    playbook: `For a key metric, pull its time series (read-only SQL if available). Detect change-points. Assemble candidate causes from the connected sources: release/deploy markers (git tags, infra), schema/column changes, experiment starts, and a mix decomposition (group-by segment). FLAG movements the org cannot currently attribute, and show the decomposition (how much is behavior vs mix vs measurement vs cycle). The deliverable is a repeatable drill-path, not a one-off answer.`,
  },
  {
    key: 'i6', owner: 'baseline', mount: 'floor',
    title: 'Freshness & instrumentation coverage',
    aim: "Data arrives on time and complete, and the events/metrics the product's key loops need are actually logged and discoverable.",
    playbook: `FRESHNESS & CONTINUITY: from table metadata (INFORMATION_SCHEMA last-modified / row-count trend) or pipeline schedules, find tables that are stale, arriving late, or whose row counts dropped/zeroed. Check whether ANY freshness/volume monitoring exists. FLAG stale/incomplete critical tables AND the absence of freshness checks (so breaks are found by the weekly report, not same-day).
INSTRUMENTATION COVERAGE: infer the product's key user-journey loops (from code, PRDs, route/screen names). For each step, check whether the needed event is fired in code AND lands in the warehouse. FLAG journey steps with no instrumentation (any step of the product's key loops that fires no event) and metrics referenced but never logged. Confirm with the missing event name + where it should be fired.`,
  },
  {
    key: 'i9', owner: 'baseline', mount: 'floor',
    title: 'Reproducible & reviewable',
    aim: 'Analytical assets (queries, dashboards, transforms) are versioned, reviewed and documented, and every published number is reproducible, assumption-logged, and passes an automated correctness gate.',
    playbook: `VERSION CONTROL & REVIEWABILITY: compare what RUNS (queries in warehouse history, dashboards in the BI tool) against what is in git. FLAG dashboards / queries / pipeline SQL that exist but are not version-controlled (no diff / review / blame), undocumented joins, and analytical logic that lives only in a BI tool or a saved query.
PROVENANCE & GATING: assess whether analyses/reports are reproducible (saved query + inputs), whether assumptions are recorded, and whether anything checks a number BEFORE it is published. FLAG the absence of an accuracy gate (wrong numbers ship and are caught manually later), undocumented assumptions, and analyses a newcomer cannot reproduce. The remediation is typically a pre-publish accuracy gate + an assumptions log.`,
  },
  {
    key: 'i10', owner: 'analytics', mount: 'bundle',
    title: 'Experiment validity',
    aim: 'Assignment is balanced (SRM), arms are clean, readouts are stable and registered.',
    playbook: `Check experiment assignment for sample-ratio mismatch and drift; check arms for cross-platform leakage, fallback-as-real-arm, and keys changing mid-flight; check whether a single experiment registry / source of truth exists. FLAG SRM, unstable readouts (significance that flips with the window), and missing registry. Confirm with the imbalance numbers or the conflicting definitions.`,
  },
];

// RANKING-INFRA invariants — code-structural durability checks specific to a recommender / search /
// ranking system, for the same read-only code auditor. NOT in the default set: gated on a ranking
// project (--ranking flag, or looksLikeRanking on the scope/brief), so a general audit is unaffected.
// Methods only — no company's asset names. These are findable by READING code + git (no measurement),
// which is what makes them fit the code auditor (vs the measurement-oriented rankingProfile used by deep.ts).
// RANKING-INFRA invariant (i12+i13 merged into one recsys-owned, gated check). Owned by the recsys-mle bundle;
// mount 'gated' — added only on a ranking project (--ranking / looksLikeRanking) or explicit pick.
export const RANKING_INVARIANTS: Invariant[] = [
  {
    key: 'i12', owner: 'recsys-mle', mount: 'gated',
    title: 'Train/serve & artifact fidelity',
    aim: "Experiments/model artifacts are referenced durably (registry/config + immutable versioned ids), and the serving path reconstructs training features faithfully with the deployed artifact's EMBEDDED config as the source of truth.",
    playbook: `DURABLE REFERENCES: grep the serving / training / eval code for (a) HARDCODED experiment keys or arm/variant/bucket names used in branch or gating logic, and (b) HARDCODED model paths / export names. FLAG experiment identifiers not sourced from a registry or config (you cannot add/retire an experiment without a deploy; orphaned keys accumulate; a typo silently mis-assigns). FLAG model loading by a MUTABLE reference — a "latest" tag, a symlink, or a path overwritten in place — instead of an immutable versioned export id (what gets served changes silently ⇒ a result is not reproducible). Check that the served model's version/build id is LOGGED, that the artifact the serving code loads is the SAME id the index/feature manifest references (pairing), and that training pins a random seed + a pinned data snapshot (not a glob like "*_val | latest").
TRAIN/SERVE FIDELITY: compare the training feature pipeline against the serving feature pipeline for parity — feature hashing, sequence truncation, point-in-time counters, timezone, default/null handling. FLAG serving features hand-rolled in a way that diverges from the training feature graph (re-introduces train/serve skew). Compare the declared / live config against the deployed export's EMBEDDED config; FLAG drift (the declared config is what gets reviewed, the embedded config is what actually ran — they diverge silently). FLAG any training run that changes more than one lever vs its NAMED parent (not attributable). Confirm each with file:line on each side; quantify (how many hardcoded keys, which loads are mutable).`,
  },
];

// DATA-ENGINEERING structural invariants — static, read-only code/config checks for the data-eng bundle
// (mounted when that bundle activates), the DE analogue of i12/i13. Methods only; distilled with codex.
export const DE_INVARIANTS: Invariant[] = [
  {
    key: 'de1', owner: 'data-eng', mount: 'bundle',
    title: 'Freshness / contract assertions on decision-bearing reads',
    aim: 'Every decision-bearing table has a declared cadence + a freshness/volume assertion and a declared schema/grain contract, so a stalled, partial, or reshaped load fails LOUDLY instead of serving last-good rows.',
    playbook: `Enumerate decision-bearing tables (read by dashboards / marts / serving / model training) and grep the pipeline (dbt tests / Airflow sensors / assertions / monitors) for a freshness AND a row-volume check on each. FLAG a decision-bearing read with NO freshness/volume assertion (a paused DAG or partial load surfaces as "yesterday's numbers", not an error) and a consumed table with no declared schema/grain contract. Anti-reward-hack: SEPARATE "no declared cadence" (a documentation gap) from "violates a declared cadence" (a live defect) — only the latter is a freshness breach. Confirm each with file:line + the table.`,
  },
  {
    key: 'de2', owner: 'data-eng', mount: 'bundle',
    title: 'Idempotent, parameterized loads & backfills',
    aim: 'Loads/backfills are idempotent and parameterized by window + source snapshot/watermark + grain, so a retry or backfill reproduces exactly one event-time replay rather than double-counting or overwriting history.',
    playbook: `Grep load/backfill jobs for (a) HARDCODED date/window literals instead of a passed window parameter, (b) append-only INSERT INTO / mutable-partition rewrites with no dedup or MERGE on the declared grain, and (c) no source snapshot/watermark pin. FLAG a non-idempotent load (re-running double-counts) and a backfill not parameterized by window+snapshot+grain. Anti-reward-hack: a duplicate defect needs an explicit, defensible GRAIN — do not infer one. Confirm with file:line.`,
  },
  {
    key: 'de3', owner: 'data-eng', mount: 'bundle',
    title: 'Scan-scope & reproducible dependencies',
    aim: 'Large-table SQL preserves partition/cluster pruning, and reproducible marts do not depend on mutable references — so cost is bounded to the declared output and a mart is rebuildable to the same bytes.',
    playbook: `In scheduled/large-table SQL, surface as CANDIDATE smells — to CONFIRM against the query plan / a pruned-equivalent dry-run, not auto-defects — functions/casts on the partition column, missing bounded (partition/date) predicates, and SELECT *; each CAN defeat pruning. Separately, FLAG a reproducible mart that reads a MUTABLE dependency (a "latest" tag, a globbed path, a mutable view, or an overwritten export) — its output is not reproducible. Anti-reward-hack: a full scan is a defect ONLY when the declared output is computable from a narrower scan that returns the same result; never flag scan SIZE alone. Confirm with file:line.`,
  },
];

// ANALYTICS / metric-trust structural invariants — static checks for the analytics bundle.
export const ANALYTICS_INVARIANTS: Invariant[] = [
  {
    key: 'an1', owner: 'analytics', mount: 'bundle',
    title: 'One canonical KPI definition per decision surface',
    aim: 'A headline metric that gates the SAME decision resolves to ONE canonical semantic definition (numerator/denominator/filter/window) end-to-end, so app, warehouse, and dashboard cannot quietly disagree.',
    playbook: `Locate each headline-metric definition across app events, warehouse models, and dashboards/saved queries. FLAG the same DECISION ROLE / semantic KPI computed with a divergent numerator/denominator/filter/window in more than one place — INCLUDING under different aliases — when nothing reconciles them. Anti-reward-hack: ALLOW intentionally VERSIONED variants ONLY when they are explicit AND reconciled (not merely differently named); a divergent alias serving the same decision is still a defect. Confirm with the two divergent definitions (file:line each).`,
  },
  {
    key: 'an2', owner: 'analytics', mount: 'bundle',
    title: 'Experiment config from a registry, not literals',
    aim: 'Experiment keys, arms, primary metric, exposure unit, and read-out window come from a registry/config — not ad-hoc notebook/dashboard literals — so a result is attributable and reproducible under one declared protocol.',
    playbook: `Grep experiment/analysis code + notebooks for HARDCODED experiment keys, arm names, primary-metric names, exposure units, or read-out windows used in the read-out, instead of being sourced from a registry/config. FLAG a read-out whose metric/unit/window is chosen in a notebook rather than declared. Anti-reward-hack: measure registry-vs-actual MISMATCH + post-exposure choice; do NOT label intent ("p-hacking"). Confirm with file:line.`,
  },
  {
    key: 'an3', owner: 'analytics', mount: 'bundle',
    title: 'Eligibility-before-outcome cohorts + reviewable published assets',
    aim: 'Cohort SQL fixes eligibility BEFORE any outcome join (no survivorship), attribution windows/source-priority are centralized + versioned, and decision dashboards/saved queries are version-controlled or exportable with a stable query hash.',
    playbook: `In cohort/retention/conversion SQL, FLAG a denominator built by joining to a POST-outcome table or filtering on post-outcome attributes (outcome-dependent ⇒ survivorship). FLAG last-touch/attribution logic duplicated across surfaces with divergent window/priority constants instead of one centralized definition. FLAG a decision-gating dashboard/query that is not version-controlled / has no stable exportable hash (not reproducible). Confirm with file:line.`,
  },
];

// TRUST & SAFETY structural invariants — static checks for the trust-safety bundle.
export const TS_INVARIANTS: Invariant[] = [
  {
    key: 'ts1', owner: 'trust-safety', mount: 'bundle',
    title: 'Policy & gating from versioned config, not hardcoded branches',
    aim: 'Serving gates source policy rules/thresholds (and age/region matrices) from a versioned policy config — not hardcoded branch logic duplicated across frontend/backend — so policy and enforcement cannot drift silently.',
    playbook: `Grep serving / gating / moderation code for HARDCODED policy thresholds, rule conditions, or age/region constants in branch logic instead of a versioned policy config, and for the SAME gating rule duplicated in frontend and backend with divergent constants. FLAG each — the written policy is then not the enforced policy, and a policy change requires code surgery. Confirm with file:line on each divergent side.`,
  },
  {
    key: 'ts2', owner: 'trust-safety', mount: 'bundle',
    title: 'Immutable decision provenance is logged',
    aim: 'Every moderation/enforcement decision logs immutable provenance — policy_version, model_version, queue/reviewer source, threshold/config version, and appeal linkage — so a decision is auditable and re-reviewable.',
    playbook: `Inspect the moderation/enforcement decision write path. FLAG a decision record missing any of: policy_version, model/classifier version, queue/reviewer source, the threshold/config version applied, or a link from action → appeal → reversal. Without these a decision cannot be tied to the policy+model that made it, and stability under re-review cannot be measured. Confirm with file:line + the missing field(s).`,
  },
  {
    key: 'ts3', owner: 'trust-safety', mount: 'bundle',
    title: 'Pre-exposure review gate + documented safety-label role + durable takedown linkage',
    aim: 'Where policy requires pre-review, the upload/feed/search/recommend path checks review state BEFORE exposure; safety labels feeding ranking/training carry a documented role; and takedown paths write durable linkage (hashes) that publish paths check.',
    playbook: `(a) In serving/recommend/search/feed paths, FLAG exposure of content that policy marks pre-review-required WITHOUT a review-state check before serving. (b) FLAG a safety label/score used as a ranking/training FEATURE with no documented role (eligibility constraint vs optimization input) — undocumented use is the smell, direction-free. (c) FLAG a takedown path that does not write a durable hash/linkage artifact, or a publish path that does not check the blocklist before serving (re-uploads evade per-id enforcement). Confirm with file:line.`,
  },
];

// SOFTWARE-ARCHITECTURE structural invariants — static, read-only code/git checks for the swe-arch bundle
// (the code-native bundle for engine/SDK/library orgs with no data plane). Methods only; each carries an
// anti-reward-hacking clause so "big/old/unreferenced" alone is never the defect.
export const SW_INVARIANTS: Invariant[] = [
  {
    key: 'sw1', owner: 'swe-arch', mount: 'bundle',
    title: 'Declared module boundaries hold (no cross-boundary cycles / direction violations)',
    aim: 'The dependency graph respects the architecture the org itself declares (module/package layout, build targets, layering docs): no import cycles across declared boundaries and no dependencies pointing against the declared layering.',
    playbook: `Recover the DECLARED architecture first — module/package layout, build-system targets (CMake/Bazel/workspaces), and any layering statement in docs — then build the import/include graph (the codeintel plane's dependency graph where mounted; else grep imports/includes). FLAG (a) dependency cycles that cross a declared module boundary and (b) edges that point AGAINST the declared layering (e.g. a core/runtime module importing from an editor/tools module). Anti-reward-hack: a cycle wholly INSIDE one leaf module is NOT a defect, and an undeclared boundary you inferred yourself cannot be violated — only what the org itself declares counts. Confirm each with the concrete import edges (file:line on both ends).`,
  },
  {
    key: 'sw2', owner: 'swe-arch', mount: 'bundle',
    title: 'Change-concentrated code is tested and reviewable',
    aim: 'The files where change and defect-fixing concentrate (hotspots) carry tests that change with them and stay at a reviewable size/complexity — so the most-edited code is not also the least-verified.',
    playbook: `Rank files by change concentration (git churn from the codeintel index / pre-computed digest) and overlay fix-density (share of fix/bug-labelled commits touching them). For the top set, check (a) whether ANY test co-changes with them or references them, and (b) whether repeated fixes land without a test change. FLAG hot, fix-dense files with no test anywhere plus the fix commits that shipped test-less. Anti-reward-hack: file SIZE or AGE alone is never the defect — require the churn + fix-density overlay; a stable, rarely-touched large file is not a finding. Confirm with the file, its fix-commit evidence, and the absent/present test paths.`,
  },
  {
    key: 'sw3', owner: 'swe-arch', mount: 'bundle',
    title: 'No load-bearing dead weight or divergent duplicates',
    aim: 'Internal code with no inbound references is retired rather than maintained, and the same logic does not live in divergent parallel copies where a fix lands in one copy only.',
    playbook: `From the reference graph (codeintel dead-code/reference tools where mounted; else grep), find (a) internal files/symbols with NO inbound references and no recent change, and (b) duplicated parallel implementations of the same logic (copy-paste clusters) — then check git history for fixes that landed in ONE copy but not its twins. FLAG divergent duplicates with a one-sided fix (the live defect) and large unreferenced internal subsystems still being maintained. Anti-reward-hack: for an SDK/library/engine, the EXPORTED public API surface is consumed by users OUTSIDE the repo — an exported symbol with no in-repo caller is NOT dead code; restrict dead-weight claims to internal, non-exported code. Confirm with the reference evidence + the divergent diff (file:line each side).`,
  },
];

// RELEASE-ENGINEERING structural invariants — static, read-only checks over CI/build/release config + git/repo
// metadata for the release-eng bundle. Methods only.
export const RE_INVARIANTS: Invariant[] = [
  {
    key: 're1', owner: 'release-eng', mount: 'bundle',
    title: 'The declared merge gate actually gates',
    aim: 'The checks the org declares as required actually run and pass before merge — green is a verdict, not a negotiated outcome — and bypasses are rare, deliberate, and visible.',
    playbook: `Read the CI config (workflows / pipelines) + any branch-protection or CONTRIBUTING statement to establish the DECLARED gate. Then cross-check merges against it: merge commits landing while the gate was red or skipped, checks that exist but are not required, and paths (docs-only filters, matrix exclusions) that let substantive changes bypass the gate. Where a repo-metadata plane is mounted, measure the share of default-branch merges whose required checks were green at merge time. FLAG required-check theater and routine bypasses. Anti-reward-hack: a DOCUMENTED emergency-bypass process used rarely is process working, not a defect — the defect is routine or silent bypass. Confirm with the config (file:line) + the concrete merge evidence.`,
  },
  {
    key: 're2', owner: 'release-eng', mount: 'bundle',
    title: 'Release-path builds are reproducible from pinned inputs',
    aim: 'A tagged release can be rebuilt from the repo alone: toolchains, dependencies, base images, and CI actions on the RELEASE path are pinned (lockfiles committed, digests/SHAs, versioned toolchains), not floating.',
    playbook: `Inventory the release path's build inputs: dependency manifests vs committed lockfiles, container/base-image references (tag vs digest), CI action/plugin refs (branch/tag vs SHA), compiler/SDK/toolchain version declarations, and fetch-at-build steps (curl | sh, unpinned installers). FLAG floating references ON THE RELEASE PATH — a release that cannot be rebuilt to the same inputs from the tag alone. Anti-reward-hack: severity follows the RELEASE path — a floating ref in a dev-convenience workflow is a lesser note, not the finding; and a deliberately-floating input with a documented update policy (e.g. a scheduled dependency-bump bot) is process, not drift. Confirm each with file:line.`,
  },
  {
    key: 're3', owner: 'release-eng', mount: 'bundle',
    title: 'Tests are quarantined loudly, not silently',
    aim: 'Disabled/skipped/quarantined tests are visible, owned, and time-bounded (a linked issue + a triage trail), so the effective test suite does not silently shrink under a green badge.',
    playbook: `Grep the test tree + CI config for skip/disable/quarantine markers (skip/xfail/ignore/DISABLED_/.skip/exclude lists, retry-on-failure wrappers) and for tests DELETED in fix commits. For each, check age (when it was disabled), ownership (a linked issue/owner), and whether CI reports the skipped count anywhere. FLAG ageing, unowned silent quarantines, blanket retry-until-green wrappers, and fix commits that delete the failing test instead of the defect. Anti-reward-hack: a skip WITH a linked tracking issue and recent triage is process working — the defect is the silent, unowned, ageing quarantine, not the existence of skips. Confirm with file:line + the disabling commit.`,
  },
];

// API-STABILITY structural invariants — static, read-only code/git checks for the api-stability bundle
// (orgs whose product IS an SDK/engine/library: the public API surface is the north-star asset). The null is
// always the org's OWN declared versioning/deprecation contract; no declared contract = a documentation gap,
// tracked separately from a violation.
export const AS_INVARIANTS: Invariant[] = [
  {
    key: 'as1', owner: 'api-stability', mount: 'bundle',
    title: 'The public surface is explicit and tiered',
    aim: 'What is public is DECLARED (exports/visibility/headers), stability tiers (stable / experimental / internal) are marked where they exist, and internal code is not reachable through the public surface by accident.',
    playbook: `Recover the DECLARED public surface (export lists, public headers, d.ts, visibility markers, docs' "public API" statement) and diff it against what is REACHABLE (exported symbols users can import/link). FLAG (a) internal code accidentally reachable through the public surface with no internal/experimental marking, and (b) experimental/unstable APIs presented as stable in docs/examples. Anti-reward-hack: a deliberately-exposed low-level layer that docs mark "advanced / unstable" is a tier working, not a leak — only UNMARKED exposure counts. Confirm with the export site + the missing/present marker (file:line).`,
  },
  {
    key: 'as2', owner: 'api-stability', mount: 'bundle',
    title: 'Deprecate before removal, with a declared window',
    aim: 'A public symbol is removed only after carrying a deprecation marker for the org\'s declared window, with a migration note — so an upgrade never surprises a user who read the notes.',
    playbook: `From git history across release tags, build the deprecated→removed ledger for public symbols: for each REMOVED symbol, was it marked deprecated first, for how many releases, with a migration note? FLAG removal-without-marking, marking-then-immediate-removal (the marker is decorative), and — the opposite failure — "immortal" deprecations with no removal plan accumulating as permanent double surface. Anti-reward-hack: honor the org's OWN declared window (a fast-moving pre-1.0 project may declare a short one); with NO declared window, report the ledger + the missing policy as a documentation gap, not a breach. Confirm with the marking/removal commits (file:line each).`,
  },
  {
    key: 'as3', owner: 'api-stability', mount: 'bundle',
    title: 'API changes are release-noted under the declared version scheme',
    aim: 'Every public-surface-touching change ships under the version increment the org\'s scheme declares for it and appears in the release notes/changelog — the notes are a trustworthy upgrade contract.',
    playbook: `For consecutive release-tag pairs, list the public-surface files/symbols the diff touched (removals/renames/signature changes vs additions) and reconcile: (a) against the version increment — a breaking change under a non-breaking increment per the org's OWN declared scheme is the defect; (b) against the release notes/changelog — an API-touching change absent from the notes is the defect. Anti-reward-hack: additions under a minor are fine in semver-like schemes; a project that declares NO scheme gets the gap reported as documentation debt, not as violations. Confirm with the tag pair + the diff hunk + the (missing) note.`,
  },
];

// APPLICATION-SECURITY / SUPPLY-CHAIN structural invariants — static, read-only checks for the appsec bundle.
// DEFENSIVE posture only: inventory, provenance, and coverage — never exploitation. Overlap note: re2 (release-eng)
// owns build REPRODUCIBILITY (pinning as a rebuild property); sc1 owns supply-chain INTEGRITY (what executes and
// what ships) — the checks cross-reference rather than duplicate.
export const SC_INVARIANTS: Invariant[] = [
  {
    key: 'sc1', owner: 'appsec', mount: 'bundle',
    title: 'The dependency set is locked and advisories are consumable',
    aim: 'Every dependency manifest on the release path has a committed lockfile (the shipped set is knowable), no build/release step fetch-and-executes unverified remote content, and a process exists that can consume security advisories for the locked set.',
    playbook: `Inventory dependency manifests vs committed lockfiles on the RELEASE path; inventory fetch-and-execute sites (curl|sh, unpinned installers, floating action/image tags) in CI/build/bootstrap scripts. FLAG unlocked manifests whose resolved set changes per build, and unverified fetch-and-execute on the release path. Check whether ANY advisory intake exists (bot, audit job, documented review). Anti-reward-hack: a dev-convenience script outside the release path is a lesser note; a deliberately-floating input under a documented update policy is process. Confirm with file:line per site.`,
  },
  {
    key: 'sc2', owner: 'appsec', mount: 'bundle',
    title: 'Vendored artifacts carry provenance',
    aim: 'Every vendored binary/blob/forked third-party component records origin + version + checksum/attestation + license, and diverged forks track the upstream fixes they are missing — nothing in the tree is unauditable or silently swappable.',
    playbook: `Inventory vendored binaries, prebuilt/minified bundles, and forked third-party directories. For each: recorded origin+version? checksum or attestation? license? an upstream-sync trail? FLAG unattested blobs (unauditable, silently swappable) and silent forks that diverged from an upstream which has since shipped security fixes. Anti-reward-hack: a checked-in artifact that is REBUILT and verified by CI from pinned sources is attested by construction — the defect is the unverifiable artifact, not vendoring itself. Confirm with the artifact path + the missing provenance field(s).`,
  },
  {
    key: 'sc3', owner: 'appsec', mount: 'bundle',
    title: 'Untrusted-input surfaces are covered or risk-accepted; shipped defaults are safe',
    aim: 'Entry points that parse UNTRUSTED input (file formats, network messages, user content) carry fuzz/sanitizer coverage or a documented risk acceptance, and shipped config templates/samples default to safe settings.',
    playbook: `Map untrusted-input entry points from the code (format parsers, decoders, deserializers, script/asset loaders — for an engine, the asset pipeline). Cross with fuzz harnesses / sanitizer CI jobs / documented risk acceptance per surface; FLAG exposed-but-uncovered parsers, prioritized by exposure (reachable from user-supplied files/network). Separately, scan shipped config templates + quickstart samples for unsafe defaults (debug servers on all interfaces, permissive CORS, auth disabled) — for an SDK, the sample IS what users deploy. Anti-reward-hack: enumeration + coverage only — never attempt exploitation; a surface with a documented, dated risk acceptance is a decision, not a defect. Confirm with the entry point (file:line) + the coverage evidence.`,
  },
];

// MOBILE-iOS structural invariants — static, read-only code/config checks for the mobile-ios bundle (a shippable
// iOS APP, not an SDK/library). Methods only; framework-agnostic (SwiftUI/UIKit/ObjC · SPM/CocoaPods/Carthage ·
// XcodeGen/raw-pbxproj) and every check is an OVERLAY against the app's OWN declared intent or the platform's
// published contract — never a naked count, never a fixture's literals. No company names appear here.
export const MOBILE_IOS_INVARIANTS: Invariant[] = [
  {
    key: 'ios1', owner: 'mobile-ios', mount: 'bundle',
    title: 'Blocking work is confined off the main thread',
    aim: 'I/O and long-running work reachable from a render/lifecycle path run OFF the main actor/queue, so the UI thread never blocks (the direct cause of jank).',
    playbook: `Enumerate I/O surfaces (URLSession/network, file/disk, database e.g. Core Data / SQLite, keychain, crypto) and OVERLAY each with (a) reachability from a @MainActor context / SwiftUI body / view-lifecycle method (codeintel call-graph where mounted, else directory-role + grep) and (b) its dispatch context. FLAG an I/O surface reachable from render that runs on the main actor/queue synchronously, and any DispatchQueue.main.sync on a UI path. Anti-reward-hack: NEVER count DispatchQueue / Task occurrences — the defect is the reachable-from-render × on-main INTERSECTION; whether a given call truly executes on main is often runtime-only, so mark those low-confidence rather than asserting. Confirm with file:line on the I/O site + the reaching render path.`,
  },
  {
    key: 'ios2', owner: 'mobile-ios', mount: 'bundle',
    title: 'Screen-scoped objects are not retained by a longer-lived owner',
    aim: 'Objects scoped to a screen/view are released when the screen goes away — no retain cycle from a stored/escaping closure or an un-invalidated observer/timer holds them alive.',
    playbook: `Restrict to captures a LONGER-LIVED owner holds: stored properties, escaping closures kept by a service/singleton, Combine sinks, NotificationCenter observers, and Timers that strongly capture self without [weak self] and are never invalidated; delegates declared strong. OVERLAY with whether the capturing/captured type is a view/view-model (leaks a screen). FLAG the stored-escaping strong self-capture set + the un-balanced observer/timer set. Anti-reward-hack: a non-escaping closure (map/filter/animation block) needs no [weak self]; a raw [weak self]-vs-self ratio is NOT the metric; actual leak confirmation needs an instrument — mark it low-confidence, do not assert a leak statically. Confirm with file:line + the owning type.`,
  },
  {
    key: 'ios3', owner: 'mobile-ios', mount: 'bundle',
    title: 'The App Store platform contract is satisfied on the release path',
    aim: "The app meets Apple's OWN published, currently-enforced shipping requirements — a privacy manifest covering the required-reason APIs + tracking SDKs it uses, purpose strings for every protected resource it accesses, and release-config values (entitlements, ATS, environment) that are store-correct — so no latent App-Store rejection ships.",
    playbook: `Reconcile the repo against the dated App Store platform-contract reference: (a) PRIVACY MANIFEST present and covering every required-reason API family the code calls + every linked tracking/attribution/analytics SDK — FLAG a qualifying app with a missing/incomplete manifest; (b) PERMISSION STRINGS — reconcile permission-guarded API usage against declared NS*UsageDescription (however Info.plist is injected): FLAG used-but-undeclared (crash/rejection) and declared-but-unused (over-broad); (c) RELEASE CONFIG — entitlement/ATS/environment values that differ by build config resolve to store-correct values on the release path. Anti-reward-hack: the null is Apple's published rule, never an invented threshold; absence of a tracking SDK lightens the requirement (not a false positive); a deviation WITH a documented scoped reason (e.g. a narrow ATS exception) is fact+reason, an undocumented prod-breaking value (e.g. a development-only capability on a store build) is the defect. Confirm with file:line + the specific rule.`,
  },
  {
    key: 'ios4', owner: 'mobile-ios', mount: 'bundle',
    title: 'Bridge & input boundaries do not leak capability or crash on untrusted input',
    aim: 'Native↔foreign-context bridges (WebView JS handlers, cross-platform channels) validate origin and expose no credential/privileged capability to attacker-influenceable content; external-input decode paths carry no unconditional unwrap; and no server-capability secret ships in the binary.',
    playbook: `(a) BRIDGE TRUST: enumerate bridges by GENERAL signature (JS-enabled WKWebView + WKScriptMessageHandler; cross-platform channels/native modules) — per handler FLAG missing origin/caller validation, a non-minimal exposed surface, or a credential/native capability handed to the foreign context; detect by signature, NEVER by a specific bridge/channel name. (b) INPUT-BOUNDARY CRASH: OVERLAY force-unwrap/try!/as!/forced-subscript density with proximity to an external-input boundary (network decode, universal-link/URL-scheme handler, push payload, IPC) — FLAG unconditional unwraps reachable from untrusted input; a raw ! count is NOT the metric (a try! on a static regex is healthy). (c) IN-BINARY SECRET: detect by general secret SHAPE, classify by CAPABILITY × REACHABILITY — a server-capable key on a shipped path is the defect, a public client identifier is fact-only, honor a documented low-sensitivity acceptance. Confirm each with file:line.`,
  },
];

// MOBILE-ANDROID structural invariants — static, read-only code/config checks for the mobile-android bundle (a
// shippable Android APP). Methods only; framework-agnostic (Compose/XML-Views/Fragments · Kotlin-DSL/Groovy ·
// version-catalog/scattered) and OVERLAY-based against the app's OWN intent or the platform contract. No company names.
export const MOBILE_ANDROID_INVARIANTS: Invariant[] = [
  {
    key: 'and1', owner: 'mobile-android', mount: 'bundle',
    title: 'Blocking work is confined off the main thread (no ANR path)',
    aim: 'I/O and long-running work reachable from a UI/lifecycle path run off the Main dispatcher, and no runBlocking sits on a main-thread path — so the app does not trigger an ANR (a Play-tracked vital).',
    playbook: `Enumerate I/O surfaces (Room/SQLite, SharedPreferences.commit, network, file, crypto) and OVERLAY each with reachability from a UI/lifecycle path (Composable, Activity/Fragment lifecycle callback, onBind) and its coroutine dispatcher / thread. FLAG I/O reachable from the UI thread that is not dispatched off-main, and runBlocking on a main-thread path. Anti-reward-hack: NEVER count runBlocking / Dispatchers occurrences — a runBlocking on a known-background executor (e.g. an OkHttp Authenticator/Interceptor) is healthy; the defect is the reachable-from-UI × on-main intersection; thread-of-execution not decidable statically is low-confidence (note the absence of a StrictMode dev policy as supporting, not decisive). Confirm with file:line + the reaching UI path.`,
  },
  {
    key: 'and2', owner: 'mobile-android', mount: 'bundle',
    title: 'No Context/lifecycle leak; coroutines are lifecycle-scoped',
    aim: 'Context/Activity/View references do not outlive their lifecycle (no static/companion Context holders, no leaking Handlers, no singletons holding an Activity), and UI-triggered coroutines run on a lifecycle-bound scope — so screens are released and background work is cancelled with them.',
    playbook: `FLAG (a) static/companion-object fields of a Context/Activity/View type and non-static Handlers posting delayed work that capture a Context; (b) singletons/long-lived holders retaining an Activity/View; (c) UI-triggered coroutine launches NOT on a lifecycle-bound scope (viewModelScope/lifecycleScope/repeatOnLifecycle) — GlobalScope or an ad-hoc CoroutineScope tied to no lifecycle. OVERLAY with whether the held/launching type is UI-scoped. Anti-reward-hack: most Context obtained via DI application-context is SAFE — narrow to genuinely lifecycle-bound refs; a companion-object COUNT is not a defect; GlobalScope for legitimately app-lifetime work is fine (overlay with "does it touch UI/Context"); real leak confirmation needs runtime — mark low-confidence. Confirm with file:line + the holder/scope.`,
  },
  {
    key: 'and3', owner: 'mobile-android', mount: 'bundle',
    title: 'Least-privilege manifest, intentional exported surface, and store-config compliance',
    aim: "Declared permissions are used + justified, exported components + deep links are intentional and input-validated, and the build meets Google Play's published contract (targetSdk floor, cleartext default-deny in prod, data-safety disclosure surface) — so the app is neither over-privileged nor un-publishable.",
    playbook: `(a) PERMISSION LEAST-PRIVILEGE: reconcile declared <uses-permission> against actual API usage — FLAG declared-never-used (over-broad), duplicate declarations, dangerous permissions with no runtime-request path; judge a vendor/OEM permission against whether its matching SDK is present. (b) EXPORTED SURFACE: enumerate android:exported=true + implicit intent-filters (incl. BROWSABLE deep-link hosts) — FLAG a component exported without evident intent, and an exported entry point reading inbound intent/extras without validation. (c) STORE CONFIG: reconcile against the dated Play platform-contract reference — targetSdk ≥ the enforced floor, cleartext default-deny in the RELEASE build (a debug/loopback carve-out is healthy), release minify/shrink per the app's own intent, data-collecting SDKs as the disclosure surface. Anti-reward-hack: the store null is Play's published rule; "no declared cadence/scheme" style gaps (e.g. no declared targetSdk) are separate config gaps; a deviation WITH a documented scoped reason (e.g. R8 compat mode chosen for a stated compatibility reason) is fact+reason, not a defect. Confirm with file:line + the rule.`,
  },
  {
    key: 'and4', owner: 'mobile-android', mount: 'bundle',
    title: 'WebView/JS bridges are trustworthy and committed credentials are capability-bounded',
    aim: 'Every JS interface + JS-enabled WebView loads trusted content, exposes a minimal surface, and hands no credential/native capability to JS; and no committed credential grants a server/privileged capability if extracted.',
    playbook: `(a) BRIDGE TRUST: enumerate JS-enabled WebViews (javaScriptEnabled) and their interfaces by GENERAL signature (addJavascriptInterface / @JavascriptInterface; cross-platform channels/native modules) — per interface FLAG content whose origin is not constrained to first-party, a non-minimal exposed surface, or a method handing a credential/native capability to JS; detect by signature, NEVER by a specific interface name. (b) COMMITTED-CREDENTIAL CAPABILITY: detect committed secrets by general SHAPE across source/resources/build config, classify by CAPABILITY × REACHABILITY — a server-capable key is the defect; a weak credential whose BACKING ARTIFACT is not committed (e.g. a signing password with no committed keystore) is reported WITH its bounded exposure; a public client identifier / an owner-declared low-sensitivity config file is fact + acceptance. Anti-reward-hack: never lump a public identifier with a real secret; the verdict is what the credential can DO, not that a literal was found. Confirm each with file:line.`,
  },
];

// PRODUCT-LOGIC structural invariants — the product-logic bundle (Phase 2): does the
// product's own business / application logic do what its users and the business were promised? Every check reconciles
// TWO surfaces of the SAME product (a declared rule vs its enforcement, one implementation vs another, a label vs its
// computation) — the null is the product's own declared rule, never a rule or threshold imported from elsewhere. Methods
// only; no product, framework or feature name appears here. Access questions are read-only reconciliations of the
// product's declared model against its guards (the security lens stays with appsec / saas-tenancy).
export const BL_INVARIANTS: Invariant[] = [
  {
    key: 'bl1', owner: 'product-logic', mount: 'bundle',
    title: 'One business rule, one answer on every surface',
    aim: 'Each business rule the product applies — a limit, a validation, a price or plan entitlement, an eligibility condition, a customer-facing number — resolves to ONE definition across every place that implements or states it (client and server, two services, the UI label or docs and the code that computes it).',
    playbook: `Pick the rules that carry user or revenue consequence (limits, plan entitlements, validations on user input, eligibility, customer-facing metrics). For each, locate EVERY site that implements or states it: constants, validators, schema / database constraints, server guards, client checks, UI copy and docs. Reconcile them on the same inputs, including edge values; for a customer-facing number, pair its label / tooltip / docs with the query or formula behind it and state the definition each implies (population, distinctness, filters, window, unit), and diff surfaces that show the same label (incl. alternative storage back-ends or query paths). FLAG a rule whose sites disagree on some input, and a number whose computation contradicts its label. Anti-reward-hack: two sites that both defer to one shared definition are ONE rule; a stricter client check with the server as the authority is UX, not a defect, unless the server is looser than the product states. Confirm with file:line on each side.`,
  },
  {
    key: 'bl2', owner: 'product-logic', mount: 'bundle',
    title: 'Every lifecycle state the product declares is handled',
    aim: 'For each entity with a declared status / type set, every consumer that branches on it handles every reachable state, no state is reachable that nothing handles, and a terminal state (removed, cancelled, expired) is never acted on as if live.',
    playbook: `Recover the declared state set (enum / union type / check constraint / migration) and the writes that set each state (the transitions). Cross with every consumer that branches on it — switches, filters in queries, guards, UI renders, scheduled jobs, exports. Build the state × consumer matrix. FLAG (a) a reachable state a consumer falls through on (silent default), (b) a declared state no write can reach (dead, or a missing transition the product promises), (c) a terminal state still counted, served or billed. Anti-reward-hack: a documented default branch that intentionally covers several states is a decision, not a gap; judge against the product's own stated lifecycle. Confirm with the declaration + the consumer (file:line).`,
  },
  {
    key: 'bl3', owner: 'product-logic', mount: 'bundle',
    title: "Who may see or do what matches the product's own access model",
    aim: 'The guard on every route / query that reads or changes a protected entity enforces exactly the product’s declared access model — its roles, ownership, team membership and sharing / public-view settings — no wider and no narrower.',
    playbook: `Recover the product's DECLARED access model from its own artifacts: role / permission enums and maps, sharing settings and share-link types, UI gating, docs. Per route / query touching a protected entity (read, change, export, share), record the check it applies. Build the capability × role matrix of declared vs enforced. FLAG an enforced set wider than declared (a shared or public view returning more than the product says it shows, a role able to do what the product reserves for another) and narrower (a granted capability refused). READ-ONLY: reconcile code against code — never probe a live endpoint or attempt access. Report as a business finding when it breaks a product promise; pure isolation / authentication hardening belongs to the security bundles. Confirm with the declared rule + the guard (file:line).`,
  },
  {
    key: 'bl4', owner: 'product-logic', mount: 'bundle',
    title: 'User-visible effects land in the right period, once',
    aim: 'User-facing windows (date ranges, billing / usage periods, retention and expiry) apply ONE timezone and ONE inclusivity rule, amounts are rounded / converted at ONE point, a user-visible side effect (a charge, credit, message, counter, created record) is applied once even when its trigger re-runs, and every flag / setting that changes user-visible behaviour is live, single-sourced and applied at every layer of its capability.',
    playbook: `(a) BOUNDARIES: trace each user-facing window from its input (the selected range, the plan period, the retention setting) to the query or job that applies it — bucket timezone, inclusivity of each end, stored unit, every rounding / conversion step; FLAG a boundary value that can land in two buckets or none, and a retention / expiry rule applied differently from what the product states. (b) APPLY-ONCE: enumerate paths that apply a user-visible side effect and can re-run (client retry, queue redelivery, overlapping schedule, webhook replay); FLAG one with no idempotency key / uniqueness guard / compare-and-set. (c) SWITCHES: inventory flags / settings read in user-facing paths; FLAG dead (one reachable value), contradictory (two switches for one behaviour that can disagree) and half-applied (the UI gated, the capability still reachable, or the reverse). Anti-reward-hack: a documented, deliberate boundary choice applied consistently is a rule, not a defect; judge against the product's own statement. Confirm with file:line.`,
  },
];

// All invariants the auditor knows (general + ranking-infra + domain + code-native + mobile + product-logic) — for key lookup so
// --invariants i12/de1/an1/ts1/sw1/re1/as1/sc1/ios1/and1/bl1 resolve.
export const ALL_INVARIANTS: Invariant[] = [...INVARIANTS, ...RANKING_INVARIANTS, ...DE_INVARIANTS, ...ANALYTICS_INVARIANTS, ...TS_INVARIANTS, ...SW_INVARIANTS, ...RE_INVARIANTS, ...AS_INVARIANTS, ...SC_INVARIANTS, ...MOBILE_IOS_INVARIANTS, ...MOBILE_ANDROID_INVARIANTS, ...BL_INVARIANTS];

// The always-on data-trust FLOOR = the baseline-OWNED invariants (owner 'baseline', mount 'floor') — the consolidated
// data-trust core (5 of them — metric definition, cross-source & plausibility, explainable change, freshness &
// instrumentation, reproducible & reviewable). No priority list to maintain — ownership drives it. Optionally shrunk by
// THERESA_BASELINE_MAX_INVARIANTS (default = all baseline-core, currently 5; the picker still exposes every invariant
// for explicit manual selection — this only bounds the AUTOMATIC floor).
export function baselineFloorInvariants(): Invariant[] {
  const core = INVARIANTS.filter((i) => i.owner === 'baseline' && i.mount === 'floor');
  const envN = Math.floor(Number(process.env.THERESA_BASELINE_MAX_INVARIANTS));
  const cap = Number.isFinite(envN) && envN > 0 ? Math.min(envN, core.length) : core.length;
  return core.slice(0, cap);
}

export function invariantByKey(k: string): Invariant | undefined {
  return ALL_INVARIANTS.find((i) => i.key === k);
}
