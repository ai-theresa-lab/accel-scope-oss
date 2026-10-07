import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planItemsToHypotheses, inferPlane, concreteQueryPlane, type PlanItemJson } from './preflight.ts';
import { lintPlan } from './auditPlan.ts';

test('concreteQueryPlane: only executable SQL / real Redis commands resolve; prose → undefined', () => {
  assert.equal(concreteQueryPlane('SELECT count(*) FROM t'), 'warehouse');
  assert.equal(concreteQueryPlane('WITH x AS (SELECT 1) SELECT * FROM x'), 'warehouse');
  assert.equal(concreteQueryPlane('ZCARD pool:{u}'), 'keyvalue');
  assert.equal(concreteQueryPlane('GET catalog:size'), 'keyvalue');
  // prose that merely MENTIONS cache/warehouse, or STARTS with an English imperative that looks like a verb,
  // is NOT a concrete query → undefined (won't override a label).
  assert.equal(concreteQueryPlane('Measure cache miss rate from the warehouse events table; schema needed'), undefined);
  assert.equal(concreteQueryPlane('With cache telemetry, compute the divergence'), undefined);
  assert.equal(concreteQueryPlane('Select a representative cache key and read it'), undefined);
  assert.equal(concreteQueryPlane('Get cache miss rate from warehouse'), undefined);
  // a prose "Select … from Redis" / "Explain … from Redis" is textually SQL-ish but the standalone `redis`
  // word (and the non-SQL EXPLAIN) keep it from being taken as a concrete warehouse query.
  assert.equal(concreteQueryPlane('Select a representative cache key from Redis and read its TTL'), undefined);
  assert.equal(concreteQueryPlane('Explain cache miss rate from Redis'), undefined);
  // a key-value prose intent that is textually SELECT…FROM (mentions cache / "schema needed") must NOT be
  // taken as concrete warehouse — so an explicit 'keyvalue' label is preserved.
  assert.equal(concreteQueryPlane('Select candidate pool size from cache; schema needed'), undefined);
  assert.equal(concreteQueryPlane('Select the pool size from the serving cache'), undefined);
  // a REAL warehouse query whose table/column merely contains "cache" as a substring is still concrete SQL.
  assert.equal(concreteQueryPlane('SELECT hit_rate FROM cache_stats'), 'warehouse');
  assert.equal(concreteQueryPlane('SELECT cache_hit_rate FROM serving_logs'), 'warehouse');
  // STRONG SQL syntax wins over a standalone cache/ttl word — a genuine warehouse query.
  assert.equal(concreteQueryPlane('SELECT avg(ttl) FROM cache'), 'warehouse');          // aggregate call → strong SQL
  assert.equal(concreteQueryPlane('SELECT key, ttl FROM cache_entries WHERE ds = "2024-01-01"'), 'warehouse'); // WHERE clause → strong
  // a key-value prose intent with an English PARENTHETICAL must NOT be read as a SQL function call.
  assert.equal(concreteQueryPlane('Select candidate pool size from cache (ZCARD the serving set)'), undefined);
  assert.equal(concreteQueryPlane('Select the value from cache (use GET on the key)'), undefined);
  assert.equal(concreteQueryPlane(undefined), undefined);
});

test('planItemsToHypotheses: a key-value prose SELECT…FROM intent keeps its explicit keyvalue label', () => {
  const kvProse = [{ claim: 'c', symptom: 's', decisiveMetric: 'pool size', decisiveQuery: 'Select candidate pool size from cache; schema needed', requiresPlane: 'keyvalue' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', kvProse)[0].requiresPlane, 'keyvalue');
});

test('inferPlane: cache signals → keyvalue, SQL signals → warehouse, neither → none', () => {
  assert.equal(inferPlane('ZCARD candidate_pool:{user}', 'pool size'), 'keyvalue');
  assert.equal(inferPlane(undefined, 'set membership of the served pool'), 'keyvalue');
  assert.equal(inferPlane('GET catalog:size', 'catalog size'), 'keyvalue');       // a Redis GET read
  assert.equal(inferPlane('SELECT count(*) FROM impressions GROUP BY ds', 'exposure share'), 'warehouse');
  assert.equal(inferPlane(undefined, 'reconcile the metric across warehouse tables'), 'warehouse');
  assert.equal(inferPlane(undefined, 'count of experiment arms in the config file'), 'none');
});

test('inferPlane: code-native signals route to repometa / codeintel / osv (before the warehouse fallback)', () => {
  assert.equal(inferPlane(undefined, 'CI pass rate over default-branch workflow runs'), 'repometa');
  assert.equal(inferPlane(undefined, 'retry-to-green share per workflow'), 'repometa');
  assert.equal(inferPlane(undefined, 'release cadence from published tags'), 'repometa');
  assert.equal(inferPlane(undefined, 'dependency cycle count across declared module boundaries'), 'codeintel');
  assert.equal(inferPlane(undefined, 'hotspot churn and code health concentration'), 'codeintel');
  // a concrete SQL query still wins (concreteQueryPlane runs first)
  assert.equal(inferPlane('SELECT count(*) FROM ci_runs WHERE ds > "x"', 'pass rate'), 'warehouse');
  // metric IDS route like their space-separated titles (underscores/hyphens normalized)
  assert.equal(inferPlane(undefined, 'known_vuln_release_path'), 'osv');
  assert.equal(inferPlane(undefined, 'fix_adoption_lag'), 'osv');
  assert.equal(inferPlane(undefined, 'breaking_change_nonmajor_count'), 'repometa');
  assert.equal(inferPlane(undefined, 'deprecation_window_adherence'), 'repometa');
  assert.equal(inferPlane(undefined, 'retry_to_green_rate'), 'repometa');
  assert.equal(inferPlane(undefined, 'changelog_completeness'), 'repometa');
  assert.equal(inferPlane(undefined, 'release note completeness for API changes'), 'repometa');
  assert.equal(inferPlane(undefined, 'cross_boundary_cycle_count'), 'codeintel');
});

test('inferPlane: a concrete SQL query wins over key-value-sounding metric text', () => {
  // metric text mentions "candidate pool size" but the decisive query is SQL → must route to warehouse, not keyvalue.
  assert.equal(inferPlane('SELECT approx_count_distinct(item) FROM served_pool', 'candidate pool size'), 'warehouse');
  assert.equal(inferPlane('WITH p AS (SELECT * FROM pool) SELECT count(*) FROM p', 'pool size'), 'warehouse');
});

test('planItemsToHypotheses: TRUSTS an explicit valid requiresPlane label; infers only when absent/invalid', () => {
  // An explicit, valid label is trusted verbatim — we do NOT override it by classifying the query text
  // (that proved fragile; the failure it guarded is a cheap wasted read-only turn). The planner is ours.
  const kv = [{ claim: 'c', symptom: 's', decisiveMetric: 'exposure share', decisiveQuery: 'SELECT count(*) FROM impressions', requiresPlane: 'keyvalue' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', kv)[0].requiresPlane, 'keyvalue');     // trusted, not flipped to warehouse
  const wh = [{ claim: 'c', symptom: 's', decisiveMetric: 'cache miss rate', decisiveQuery: 'Measure cache miss rate from the warehouse events table; schema needed', requiresPlane: 'warehouse' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', wh)[0].requiresPlane, 'warehouse');    // a cache-mentioning prose intent keeps its warehouse label
  const none = [{ claim: 'c', symptom: 's', decisiveMetric: 'm', requiresPlane: 'none' }] as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', none)[0].requiresPlane, 'none');
  // ABSENT / invalid label → INFER from the query + metric text.
  const absentSql = [{ claim: 'c', symptom: 's', decisiveMetric: 'rate', decisiveQuery: 'SELECT count(*) FROM events' }] as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', absentSql)[0].requiresPlane, 'warehouse');
  const invalid = [{ claim: 'c', symptom: 's', decisiveMetric: 'pool size', decisiveQuery: 'ZCARD pool:{u}', requiresPlane: 'mongo' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', invalid)[0].requiresPlane, 'keyvalue');  // invalid label → inferred from the Redis command
  // a label with harmless casing/whitespace is normalized + trusted, not treated as invalid.
  const messy = [{ claim: 'c', symptom: 's', decisiveMetric: 'm', decisiveQuery: 'compute it; schema needed', requiresPlane: 'Warehouse ' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', messy)[0].requiresPlane, 'warehouse');
});

test('planItemsToHypotheses: TRUSTS the analytics/bi/custom labels (not just warehouse/keyvalue/none)', () => {
  // A product-analytics intent (no SQL syntax) keeps its explicit 'analytics' label instead of being inferred
  // to 'none' — so it reaches the measure step routed at the Amplitude plane.
  const analytics = [{ claim: 'c', symptom: 's', decisiveMetric: 'D7 retention by cohort', decisiveQuery: 'Segment D7 retention by signup cohort over 8 weeks; schema needed', requiresPlane: 'analytics' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('analytics', analytics)[0].requiresPlane, 'analytics');
  const bi = [{ claim: 'c', symptom: 's', decisiveMetric: 'experiment readout', decisiveQuery: 'Read the v1_rec experiment readout for the primary metric; schema needed', requiresPlane: 'BI' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('analytics', bi)[0].requiresPlane, 'bi');   // normalized casing + trusted
  const custom = [{ claim: 'c', symptom: 's', decisiveMetric: 'm', decisiveQuery: 'q', requiresPlane: 'custom' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('analytics', custom)[0].requiresPlane, 'custom');
});

test('planItemsToHypotheses: mints stable bundle-prefixed ids deterministically', () => {
  const items: PlanItemJson[] = [
    { claim: 'pool starves diversity', symptom: 's1', decisiveMetric: 'ZCARD of the pool', requiresPlane: 'keyvalue' },
    { claim: 'valid_play defined twice', symptom: 's2', decisiveMetric: 'reconcile thresholds', decisiveQuery: 'SELECT count(*) FROM plays', requiresPlane: 'warehouse' },
  ];
  const hs = planItemsToHypotheses('recsys-mle', items);
  assert.deepEqual(hs.map((h) => h.id), ['recsys-mle:h1', 'recsys-mle:h2']);
  assert.equal(hs[0].requiresPlane, 'keyvalue');
  assert.equal(hs[1].decisiveQuery, 'SELECT count(*) FROM plays');
});

test('planItemsToHypotheses: ids the LLM proposed are ignored — the runner owns ids', () => {
  // An item carrying its own (wrong/unprefixed) id field must NOT leak through; the runner re-mints.
  const items = [{ id: 'totally-made-up', claim: 'c', symptom: 's', decisiveMetric: 'm' }] as unknown as PlanItemJson[];
  const hs = planItemsToHypotheses('analytics', items);
  assert.equal(hs[0].id, 'analytics:h1');
});

test('planItemsToHypotheses: KEEPS under-specified items (with a content field) so lint reports them — no silent drop', () => {
  // a missing-claim/metric item must become a reported CoverageGap, not vanish at parse time.
  const items: PlanItemJson[] = [
    { claim: '', symptom: 'has symptom', decisiveMetric: 'm' },             // no claim, but has content → kept, lint rejects
    { claim: 'real defect', symptom: 's', decisiveMetric: 'metric A' },     // kept
    { claim: 'no metric', symptom: 's', decisiveMetric: '   ' },            // blank metric → kept, lint rejects
    { claim: 'second defect', symptom: 's', decisiveMetric: 'metric B' },   // kept
  ];
  const hs = planItemsToHypotheses('recsys-mle', items);
  assert.deepEqual(hs.map((h) => h.id), ['recsys-mle:h1', 'recsys-mle:h2', 'recsys-mle:h3', 'recsys-mle:h4']);
  // lint then rejects the two under-specified ones (not_evidenceable), keeps the two complete ones.
  const lint = lintPlan({ bundleId: 'recsys-mle', hypotheses: hs }, { mountedPlanes: new Set(), maxHypotheses: 6 });
  assert.deepEqual(lint.ok.map((h) => h.claim), ['real defect', 'second defect']);
  assert.equal(lint.rejected.length, 2);
  for (const x of lint.rejected) assert.equal(x.gapStatus, 'not_evidenceable');
});

test('planItemsToHypotheses: a TRULY empty entry (no content at all) is discarded as parse noise', () => {
  const items = [{}, { claim: 'real', symptom: 's', decisiveMetric: 'm' }] as PlanItemJson[];
  const hs = planItemsToHypotheses('recsys-mle', items);
  assert.deepEqual(hs.map((h) => h.id), ['recsys-mle:h1']);   // the {} is dropped; the real one re-indexes to h1
});

test('planItemsToHypotheses: normalizes the data contract (empty fields → undefined, falsy join keys filtered)', () => {
  const items: PlanItemJson[] = [{
    claim: 'c', symptom: 's', decisiveMetric: 'm',
    dataContract: { grain: 'one row per session', window: '', dedupRule: '', joinKeys: ['user_id', ''], biases: ['survivorship'] },
  }];
  const [h] = planItemsToHypotheses('recsys-mle', items);
  assert.equal(h.dataContract?.grain, 'one row per session');
  assert.equal(h.dataContract?.window, undefined);
  assert.deepEqual(h.dataContract?.joinKeys, ['user_id']);
  assert.deepEqual(h.dataContract?.biases, ['survivorship']);
});

test('planItemsToHypotheses: an invalid/omitted requiresPlane is INFERRED, never silently undefined', () => {
  // invalid plane + no SQL/cache signal → 'none' (code-derivable), not undefined (which lint reads as no-plane).
  const bad = [{ claim: 'c', symptom: 's', decisiveMetric: 'm', requiresPlane: 'mongo' }] as unknown as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', bad)[0].requiresPlane, 'none');
  // omitted plane + a SQL query → inferred 'warehouse'.
  const sql = [{ claim: 'c', symptom: 's', decisiveMetric: 'rate', decisiveQuery: 'SELECT count(*) FROM events' }] as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', sql)[0].requiresPlane, 'warehouse');
  // omitted plane + a cache-cardinality intent → inferred 'keyvalue'.
  const kv = [{ claim: 'c', symptom: 's', decisiveMetric: 'pool size', decisiveQuery: 'ZCARD on the candidate pool key' }] as PlanItemJson[];
  assert.equal(planItemsToHypotheses('recsys-mle', kv)[0].requiresPlane, 'keyvalue');
});

test('planItemsToHypotheses: undefined input yields an empty plan (no throw)', () => {
  assert.deepEqual(planItemsToHypotheses('recsys-mle', undefined), []);
});

// End-to-end of the deterministic half: parsed planner output → minted ids → lint passes a clean plan.
test('planItemsToHypotheses + lintPlan: a clean planned set passes the gate with matching ids', () => {
  const items: PlanItemJson[] = [
    { claim: 'a', symptom: 's', decisiveMetric: 'm1', decisiveQuery: 'SELECT 1', requiresPlane: 'warehouse' },
    { claim: 'b', symptom: 's', decisiveMetric: 'm2', requiresPlane: 'none' },
  ];
  const hyps = planItemsToHypotheses('recsys-mle', items);
  const lint = lintPlan({ bundleId: 'recsys-mle', hypotheses: hyps }, { mountedPlanes: new Set(['warehouse']), maxHypotheses: 6 });
  assert.equal(lint.ok.length, 2);
  assert.equal(lint.rejected.length, 0);
  assert.deepEqual(lint.ok.map((h) => h.id), ['recsys-mle:h1', 'recsys-mle:h2']);
});
