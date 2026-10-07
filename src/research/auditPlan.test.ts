import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintPlan, planToHypotheses, rejectedToGaps, prefixBundle, isUnsafeQuery, type AuditPlan, type PlanHypothesis } from './auditPlan.ts';
import type { Hypothesis } from './investigation.ts';

const ph = (over: Partial<PlanHypothesis>): PlanHypothesis => ({
  id: 'recsys-mle:h1', claim: 'recall starves diversity', symptom: 's', decisiveMetric: 'pool size', ...over,
});
const plan = (hyps: PlanHypothesis[], bundleId = 'recsys-mle'): AuditPlan => ({ bundleId, hypotheses: hyps });
const both: Set<'warehouse' | 'keyvalue'> = new Set(['warehouse', 'keyvalue']);

// ── lint: the happy path keeps a well-formed hypothesis ──────────────────────────────────
test('lint: a well-formed hypothesis passes', () => {
  const r = lintPlan(plan([ph({ decisiveQuery: 'SELECT count(*) FROM impressions' })]), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 1);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.items[0].state, 'ok');
});

// ── lint: degenerate-plan rejections → not_evidenceable ──────────────────────────────────
test('lint: an id missing the bundle prefix is rejected (not_evidenceable)', () => {
  const r = lintPlan(plan([ph({ id: 'h1' })]), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 0);
  assert.equal(r.rejected[0].gapStatus, 'not_evidenceable');
  assert.match(r.rejected[0].reason, /bundle prefix/);
});

test('lint: a wrong-bundle prefix is rejected', () => {
  const r = lintPlan(plan([ph({ id: 'analytics:h1' })]), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 0);
  assert.equal(r.rejected[0].gapStatus, 'not_evidenceable');
});

test('lint: duplicate ids are rejected (only the first survives)', () => {
  const r = lintPlan(plan([ph({ id: 'recsys-mle:h1' }), ph({ id: 'recsys-mle:h1' })]), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /duplicate/);
});

test('lint: a missing claim or decisive metric is rejected', () => {
  const r = lintPlan(plan([ph({ claim: '' }), ph({ id: 'recsys-mle:h2', decisiveMetric: '  ' })]), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 0);
  assert.equal(r.rejected.length, 2);
  for (const x of r.rejected) assert.equal(x.gapStatus, 'not_evidenceable');
});

// ── lint: SQL safety → not_evidenceable ──────────────────────────────────────────────────
for (const q of ['DELETE FROM users', 'drop table x', 'SELECT 1; DROP TABLE y', 'UPDATE t SET a=1', 'CREATE TABLE z (a int)']) {
  test(`lint: an unsafe decisive query is rejected — ${q.slice(0, 20)}`, () => {
    const r = lintPlan(plan([ph({ decisiveQuery: q })]), { mountedPlanes: both, maxHypotheses: 3 });
    assert.equal(r.ok.length, 0);
    assert.equal(r.rejected[0].gapStatus, 'not_evidenceable');
    assert.match(r.rejected[0].reason, /read-only/);
  });
}

test('lint: a read-only SELECT and a plain query INTENT both pass', () => {
  const r = lintPlan(plan([
    ph({ id: 'recsys-mle:h1', decisiveQuery: 'SELECT date, count(*) FROM events GROUP BY 1' }),
    ph({ id: 'recsys-mle:h2', decisiveQuery: 'share of sessions whose candidate pool is below the floor' }),
  ]), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 2);
});

// ── lint: source availability → blocked ──────────────────────────────────────────────────
test('lint: a hypothesis needing an unmounted plane is blocked', () => {
  const r = lintPlan(plan([ph({ requiresPlane: 'keyvalue' })]), { mountedPlanes: new Set(['warehouse']), maxHypotheses: 3 });
  assert.equal(r.ok.length, 0);
  assert.equal(r.rejected[0].gapStatus, 'blocked');
  assert.match(r.rejected[0].reason, /keyvalue plane/);
});

test("lint: requiresPlane 'none' never blocks", () => {
  const r = lintPlan(plan([ph({ requiresPlane: 'none' })]), { mountedPlanes: new Set(), maxHypotheses: 3 });
  assert.equal(r.ok.length, 1);
});

test('lint: an analytics/bi hypothesis passes when that plane is mounted, blocks when not', () => {
  // analytics mounted → analytics hypothesis OK; bi NOT mounted → bi hypothesis blocked.
  const r = lintPlan(plan([
    ph({ id: 'recsys-mle:h1', requiresPlane: 'analytics', decisiveQuery: 'Segment D7 by cohort; schema needed' }),
    ph({ id: 'recsys-mle:h2', requiresPlane: 'bi', decisiveQuery: 'Read the experiment readout; schema needed' }),
  ]), { mountedPlanes: new Set(['warehouse', 'analytics']), maxHypotheses: 3 });
  assert.equal(r.ok.length, 1);
  assert.equal(r.ok[0].id, 'recsys-mle:h1');                 // analytics is mounted → passes
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].gapStatus, 'blocked');
  assert.match(r.rejected[0].reason, /bi plane/);            // bi not mounted → blocked gap
});

// ── lint: per-bundle cap → budget_skipped (only the overflow) ─────────────────────────────
test('lint: hypotheses beyond the per-bundle cap are budget_skipped', () => {
  const hyps = [1, 2, 3, 4, 5].map((n) => ph({ id: `recsys-mle:h${n}` }));
  const r = lintPlan(plan(hyps), { mountedPlanes: both, maxHypotheses: 3 });
  assert.equal(r.ok.length, 3);
  assert.equal(r.rejected.length, 2);
  for (const x of r.rejected) assert.equal(x.gapStatus, 'budget_skipped');
});

// ── converter: stable ids carry through (the payload-ref invariant) ─────────────────
test('planToHypotheses: keeps the stable bundle-prefixed id verbatim', () => {
  const hs = planToHypotheses([ph({ id: 'recsys-mle:h1' })]);
  assert.equal(hs[0].id, 'recsys-mle:h1');
  assert.equal(hs[0].status, 'open');
  assert.equal(hs[0].decisiveMetric, 'pool size');
});

// The load-bearing invariant: a planned id `recsys-mle:h1` measured through deepAudit's
// normalizeArtifacts (which mints `measurement:${h.id}`) yields payload ref `measurement:recsys-mle:h1`
// — i.e. the converter does NOT strip/rewrite the prefix, so the ref matches the final hypothesis id.
test('planToHypotheses: a planned id yields a matching measurement payload ref', () => {
  const h = planToHypotheses([ph({ id: 'recsys-mle:h1' })])[0];
  assert.equal(`measurement:${h.id}`, 'measurement:recsys-mle:h1');
});

// the converter must carry the planning fields so the Expert EXECUTES the plan (not re-plans).
test('planToHypotheses: carries decisiveQuery / dataContract / mustBeat / requiresPlane onto plannedMeasurement', () => {
  const h = planToHypotheses([ph({
    id: 'recsys-mle:h1', mustBeat: 'random floor', decisiveQuery: 'SELECT count(*) FROM impressions',
    requiresPlane: 'warehouse', dataContract: { grain: 'one row per impression', joinKeys: ['user_id'] },
  })])[0];
  assert.equal(h.plannedMeasurement?.decisiveQuery, 'SELECT count(*) FROM impressions');
  assert.equal(h.plannedMeasurement?.mustBeat, 'random floor');
  assert.equal(h.plannedMeasurement?.requiresPlane, 'warehouse');
  assert.equal(h.plannedMeasurement?.dataContract?.grain, 'one row per impression');
});

// ── isUnsafeQuery: surgical read-only guard (strip noise → leading-write / SELECT-INTO / multi-statement) ──
test('isUnsafeQuery: read-only SELECT / WITH / prose intent pass', () => {
  for (const q of [
    'SELECT count(*) FROM impressions WHERE ds >= "2024-01-01"',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'share of sessions whose candidate pool is below the floor',
    'SELECT update_time, create_date FROM events',           // column names containing keywords
    'SELECT load, comment FROM t',                            // columns literally named load / comment
    "SELECT 'we should not delete this' AS note FROM t",      // a write verb INSIDE a string literal
    'SELECT a FROM t -- drop table would be a comment here',  // a keyword in a line comment
  ]) assert.equal(isUnsafeQuery(q), false, q);
});

test('isUnsafeQuery: writes / DDL / SELECT-INTO / multi-statement are rejected', () => {
  for (const q of [
    'DELETE FROM users', 'drop table x', 'UPDATE t SET a=1', 'CREATE TABLE z (a int)',
    'TRUNCATE t', 'MERGE INTO t USING s ON …', 'GRANT SELECT ON t TO u', 'EXPORT DATA OPTIONS(...) AS SELECT 1',
    "UNLOAD ('SELECT 1') TO somewhere", 'REFRESH MATERIALIZED VIEW v', 'CALL my_proc()',
    'SELECT 1; DROP TABLE y',                                 // multi-statement
    'SELECT * INTO newtable FROM t',                          // SELECT … INTO creates a table
    'WITH x AS (SELECT 1) DELETE FROM users',                 // CTE-DML: write verb after the CTE's closing paren
    'WITH moved AS (DELETE FROM users RETURNING id) SELECT count(*) FROM moved',  // Postgres data-modifying CTE BODY
    'WITH u AS (UPDATE t SET a=1 RETURNING *) SELECT * FROM u',                   // write inside CTE body (after `(`)
    'UPDATE users AS u SET u.name = 1',                       // aliased UPDATE
    'WITH x AS (UPDATE users u SET active = false RETURNING *) SELECT * FROM x',  // aliased UPDATE in a CTE body
    'COPY INTO target FROM source',                           // Snowflake COPY INTO
    'DELETE u FROM users u JOIN stale s ON u.id = s.id',      // MySQL multi-table DELETE
    'DELETE t1, t2 FROM t1 JOIN t2 ON t1.id = t2.id',        // MySQL multi-target DELETE
    'SELECT count(*) FROM a; SELECT count(*) FROM b',         // batched multi-statement reads
  ]) assert.equal(isUnsafeQuery(q), true, q);
});

test('isUnsafeQuery: a PROSE semicolon (not a SQL batch) is NOT flagged', () => {
  assert.equal(isUnsafeQuery('Compare counts across sources; then summarize the gap'), false);
  assert.equal(isUnsafeQuery('SELECT count(*) FROM t;'), false);   // a trailing semicolon on a single statement is fine
});

test('isUnsafeQuery: prose "update the set of …" without an assignment is NOT a false-positive', () => {
  assert.equal(isUnsafeQuery('update the set of users who churned last month'), false);  // no `=` → not an UPDATE…SET
});

test('isUnsafeQuery: a normal word ending in a verb-like substring is NOT flagged (FROM delete_log)', () => {
  for (const q of [
    'SELECT * FROM delete_log',          // table named delete_log — "delete" not in statement position
    'SELECT created_at, dropped FROM t', // columns
    'SELECT count(*) FROM (SELECT 1) sub', // read-only subquery
    'SELECT sum(load) FROM t',           // a column named `load` inside a function call — NOT a CTE-body write
    'SELECT (load) / total AS load_rate FROM t', // `load` after a grouping paren — safe
    'SELECT merge FROM t',               // a column named like a verb
    'EXPLAIN SELECT count(load) FROM t', // EXPLAIN of a READ is safe
    'SELECT count(*) load FROM t',       // implicit alias named like a soft verb
    'SELECT count(*) analyze FROM t',    // implicit alias `analyze`
    'SELECT analyze FROM t',             // column `analyze`
    'SELECT * FROM analyze',             // table `analyze`
    'SELECT count(*) AS analyze FROM t', // explicit alias `analyze`
  ]) assert.equal(isUnsafeQuery(q), false, q);
});

test('isUnsafeQuery: EXPLAIN [ANALYZE] wrapping a write is rejected (ANALYZE executes the DML)', () => {
  for (const q of ['EXPLAIN ANALYZE DELETE FROM users', 'EXPLAIN DELETE FROM users', 'EXPLAIN ANALYZE UPDATE t SET a=1']) {
    assert.equal(isUnsafeQuery(q), true, q);
  }
});

test('isUnsafeQuery: more write shapes — COMMENT ON, a `--`-inside-literal hiding a 2nd statement', () => {
  assert.equal(isUnsafeQuery("COMMENT ON TABLE t IS 'note'"), true);          // metadata DDL
  assert.equal(isUnsafeQuery("SELECT '--'; DELETE FROM users"), true);        // literal stripped before line-comment → 2nd stmt seen
});

test('isUnsafeQuery: a write hidden between block-comment delimiters that live INSIDE string literals', () => {
  // the single-pass lexer consumes the literals first, so `/*` and `*/` inside them are NOT a comment span
  // that could swallow the intervening DROP.
  assert.equal(isUnsafeQuery("SELECT '/*'; DROP TABLE users; SELECT '*/'"), true);
  // a genuine block comment that CONTAINS a quote is still a comment (no false-positive on the read after it)
  assert.equal(isUnsafeQuery("/* it's fine */ SELECT count(*) FROM t"), false);
  // a write-looking keyword INSIDE a real block comment / string is NOT a write
  assert.equal(isUnsafeQuery('SELECT 1 /* DROP TABLE x */ FROM t'), false);
  assert.equal(isUnsafeQuery("SELECT 'DELETE FROM users' AS note FROM t"), false);
});

test('isUnsafeQuery: an ENGLISH PROSE intent that starts with an imperative verb is NOT a false-positive', () => {
  // the characteristic-syntax approach (DELETE FROM / CREATE TABLE / UPDATE…SET) — not a bare leading verb —
  // is what lets these prose intents through (the Expert writes the real query, guarded by the read-only MCP).
  for (const q of [
    'Create a histogram of session lengths by cohort',
    'Delete-rate analysis: measure the share of sessions with a removal',
    'Update the dashboard query to reflect the new definition',
    'Compare counts across sources; then summarize the gap',          // a prose semicolon is not multi-statement
    'Count distinct served items per session',
  ]) assert.equal(isUnsafeQuery(q), false, q);
});

test('isUnsafeQuery: a backtick/bracket identifier named like a keyword does NOT false-positive', () => {
  assert.equal(isUnsafeQuery('SELECT `into` FROM `t`'), false);   // backtick (MySQL/BigQuery)
  assert.equal(isUnsafeQuery('SELECT [into] FROM [t]'), false);   // bracket (T-SQL)
});

test('isUnsafeQuery: a trailing semicolon on a single statement is fine; empty/undefined pass', () => {
  assert.equal(isUnsafeQuery('SELECT 1;'), false);
  assert.equal(isUnsafeQuery(''), false);
  assert.equal(isUnsafeQuery(undefined), false);
});

// ── rejectedToGaps: a lint failure is reported, never silently dropped ────────────────────
test('rejectedToGaps: a rejected item becomes a CoverageGap with its status + next test', () => {
  const r = lintPlan(plan([ph({ id: 'h1' })]), { mountedPlanes: both, maxHypotheses: 3 });
  const gaps = rejectedToGaps(r.rejected, 'recsys-mle');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].status, 'not_evidenceable');
  assert.equal(gaps[0].bundleId, 'recsys-mle');
  assert.equal(gaps[0].source, 'preflight:lint');
  assert.match(gaps[0].whyUnsettled, /plan lint rejected/);
  assert.ok(gaps[0].nextDecisiveTest.length > 0);
});

// ── prefixBundle (legacy path): rewrites BOTH the id and the EvidencePayload ref ───────────
test('prefixBundle: rewrites the hypothesis id and its measurement payload ref', () => {
  const hyps: Hypothesis[] = [{
    id: 'h1', claim: 'c', symptom: 's', status: 'confirmed',
    measurement: { metricId: 'm', value: 3, direction: 'higher', nulls: [], source: 'warehouse:q', evidence: { kind: 'computation', ref: 'measurement:h1', detail: 'd' } },
  } as unknown as Hypothesis];
  const out = prefixBundle('recsys-mle', hyps);
  assert.equal(out[0].id, 'recsys-mle:h1');
  assert.equal(out[0].measurement?.evidence?.ref, 'measurement:recsys-mle:h1');
});

test('prefixBundle: leaves a non-self-referential payload ref untouched', () => {
  const hyps: Hypothesis[] = [{
    id: 'h2', claim: 'c', symptom: 's', status: 'confirmed',
    measurement: { metricId: 'm', value: 3, direction: 'higher', nulls: [], source: 'warehouse:q2', evidence: { kind: 'computation', ref: 'warehouse:q2', detail: 'd' } },
  } as unknown as Hypothesis];
  const out = prefixBundle('recsys-mle', hyps);
  assert.equal(out[0].id, 'recsys-mle:h2');
  assert.equal(out[0].measurement?.evidence?.ref, 'warehouse:q2');  // a real source ref is not a self-pointer → untouched
});

test('prefixBundle: a hypothesis with no measurement just gets the id prefix', () => {
  const hyps: Hypothesis[] = [{ id: 'h3', claim: 'c', symptom: 's', status: 'open' } as unknown as Hypothesis];
  const out = prefixBundle('baseline', hyps);
  assert.equal(out[0].id, 'baseline:h3');
  assert.equal(out[0].measurement, undefined);
});

// ── the SQL lint must not reject a natural-language CODE-reading plan ─────────────────────────
test('lint: a code-only (plane none) reading plan with "call sites (" is NOT rejected as a stored-proc CALL', () => {
  const q = 'Read a.ts:3-5 to confirm `raw` flows unmodified into eval; then Grep the whole scope for `loadConfig(` call sites and inspect each; DEFECT confirmed if zero call sites (and zero code in loadConfig) validate the input';
  assert.equal(isUnsafeQuery(q), true, 'the SQL lint alone does misfire on this prose');
  const r = lintPlan(plan([ph({ id: 'swe-arch:h1', decisiveQuery: q, requiresPlane: 'none' })], 'swe-arch'), { mountedPlanes: new Set(), maxHypotheses: 3 });
  assert.equal(r.ok.length, 1, r.rejected.map((x) => x.reason).join('; '));
});

test('lint: the SQL lint still applies to SQL-executing planes and to an unlabeled plan', () => {
  const w = 'SELECT * INTO backup FROM users';
  assert.equal(lintPlan(plan([ph({ decisiveQuery: w, requiresPlane: 'warehouse' })]), { mountedPlanes: both, maxHypotheses: 3 }).ok.length, 0);
  assert.equal(lintPlan(plan([ph({ decisiveQuery: w })]), { mountedPlanes: both, maxHypotheses: 3 }).ok.length, 0);
});
