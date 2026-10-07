// Audit plan — the Preflight node's output: a hypothesis tree + the decisive measurement
// plan, with STABLE, bundle-prefixed ids, that a deterministic LINT checks BEFORE the Expert spends any
// measure budget. The Expert (deepAudit) then EXECUTES the linted-OK plan (skipping its own intake); the
// adaptive part stays the per-hypothesis measure loop. Read-only throughout.
import type { Hypothesis } from './investigation.ts';
import { type MeasurePlane, type ClaimArchetype, type PlanMove } from './investigation.ts';
import type { CoverageGap } from '../schema.ts';

// MeasurePlane / ClaimArchetype / PlanMove live in investigation.ts (the lowest-level model) so
// `plannedMeasurement` and the plan layer share ONE set of types; re-exported here because preflight.ts +
// server.ts import them from auditPlan.
export type { MeasurePlane, ClaimArchetype, PlanMove };

// One planned hypothesis. The id is STABLE + bundle-prefixed (e.g. 'recsys-mle:h1') so it carries through
// deepAudit unchanged — the EvidencePayload ref (`measurement:<id>`) then matches the final hypothesis id
// (no post-hoc re-prefixing, which previously desynced the payload ref).
export interface PlanHypothesis {
  id: string;
  claim: string;
  symptom: string;
  decisiveMetric: string;
  mustBeat?: string;            // the null/floor (mirrors the intake schema)
  dataContract?: { grain?: string; window?: string; dedupRule?: string; joinKeys?: string[]; biases?: string[] };
  decisiveQuery?: string;       // the SQL/probe TEXT the Expert will run — or a query INTENT when schema is unknown
  requiresPlane?: MeasurePlane; // which measurement plane this hypothesis needs (gates source-availability lint)
  // an archetype-driven hypothesis carries a metricSet (the required decomposition) instead of one
  // decisive metric. When present, lintPlan lints each MOVE (SQL-safety + source availability) and the Expert
  // executes every move. Absent → the single-metric path above (unchanged).
  archetype?: ClaimArchetype;
  metricSet?: PlanMove[];
}

export interface AuditPlan {
  bundleId: string;
  hypotheses: PlanHypothesis[];
}

export type PlanLintState = 'ok' | 'rejected';
export interface PlanLintItem { id: string; state: PlanLintState; reason?: string; gapStatus?: CoverageGap['status']; }
export interface PlanLintResult {
  bundleId: string;
  items: PlanLintItem[];
  ok: PlanHypothesis[];                                                            // passed → execute
  rejected: { hyp: PlanHypothesis; reason: string; gapStatus: CoverageGap['status'] }[]; // failed → CoverageGap
}

// Conservative READ-ONLY SQL guard for the plan lint. IMPORTANT: this is DEFENSE-IN-DEPTH, not the security
// boundary — the warehouse/key-value MCP planes are themselves read-only (allowlisted reads), so a write can
// never actually execute; this only catches obviously-non-read plans PRE-BUDGET so they become a reported
// CoverageGap instead of wasting a measure turn. It is intentionally NOT a full SQL parser.
//
// Design (after several review rounds): match the CHARACTERISTIC SYNTAX of a write — multi-token shapes
// like `DELETE FROM`, `UPDATE <t> SET`, `INSERT INTO`, `CREATE TABLE`, `MERGE INTO`, `COMMENT ON` — NOT a bare
// leading verb. This is what makes it robust: those shapes occur in real writes but never in a read-only
// query, a column/table named like a verb (`SELECT count(*) load`), or an English prose INTENT (`Create a
// histogram…`, `Delete-rate analysis…`). Because the patterns match the write syntax ANYWHERE in the text,
// they also catch a write inside a CTE body (`WITH x AS (DELETE … RETURNING …) …`) or after EXPLAIN ANALYZE
// (which executes the statement) without any positional/EXPLAIN-prefix special-casing. String literals +
// comments are stripped first (literals BEFORE line comments, so a `--` inside a string can't hide text).
// SINGLE LEFT-TO-RIGHT PASS (not chained regexes): at each position consume whichever construct OPENS first
// — a comment, or a string/identifier literal — and emit a neutral placeholder. Sequential regexes have an
// ordering bug no order fixes: a literal can contain `/*` and a comment can contain `'`, so stripping
// either kind first can erase the other's delimiters and hide an intervening write (e.g. `SELECT '/*'; DROP
// TABLE users; SELECT '*/'`). A real lexer scans left-to-right; so does this. Placeholders keep token
// boundaries so the write-syntax patterns still match around them.
function stripSqlNoise(q: string): string {
  let out = '';
  const n = q.length;
  for (let i = 0; i < n;) {
    const c = q[i], c2 = q[i + 1];
    if (c === '-' && c2 === '-') { i += 2; while (i < n && q[i] !== '\n') i++; out += ' '; continue; }          // -- line comment
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(q[i] === '*' && q[i + 1] === '/')) i++; i += 2; out += ' '; continue; } // /* block comment */
    if (c === "'") { i++; while (i < n) { if (q[i] === "'" && q[i + 1] === "'") { i += 2; continue; } if (q[i] === "'") { i++; break; } i++; } out += "''"; continue; } // '…' string (with '' escape)
    if (c === '"') { i++; while (i < n) { if (q[i] === '"' && q[i + 1] === '"') { i += 2; continue; } if (q[i] === '"') { i++; break; } i++; } out += '""'; continue; } // "…" quoted ident/string
    if (c === '`') { i++; while (i < n && q[i] !== '`') i++; i++; out += '``'; continue; }                      // `…` backtick ident (MySQL/BigQuery)
    if (c === '[') { i++; while (i < n && q[i] !== ']') i++; i++; out += '[]'; continue; }                      // […] bracket ident (T-SQL)
    out += c; i++;
  }
  return out;
}
const WRITE_PATTERNS: RegExp[] = [
  /\bdelete\s+(?:[\w.,*]+\s+)*from\b/i,                                                                         // DELETE FROM … and MySQL multi-table `DELETE u FROM …` / `DELETE t1, t2 FROM …`
  /\binsert\s+(into|overwrite)\b/i,
  /\bupdate\b[\s\S]{1,80}?\bset\b[\s\S]{0,40}?=/i,                                                              // UPDATE [<t> [AS] u] SET <col> = … (the `=` keeps prose "update the set of …" safe)
  /\bdrop\s+(table|index|view|database|schema|function|procedure|materialized|sequence|trigger|role|user|type|column|constraint|policy)\b/i,
  /\bcreate\s+(or\s+replace\s+)?(temp(orary)?\s+|external\s+|materialized\s+)?(table|index|view|database|schema|function|procedure|sequence|trigger|role|user|type)\b/i,
  /\bcreate\s+(or\s+replace\s+)?\S+\s+as\s+(select|with)\b/i,                                                   // CTAS
  /\btruncate\s+(table\s+)?\S/i,
  /\balter\s+(table|index|view|database|schema|materialized|sequence|role|user|system|session|column|policy)\b/i,
  /\bmerge\s+into\b/i,
  /\bgrant\s+\S/i, /\brevoke\s+\S/i,
  /\bcomment\s+on\b/i,
  /\b(call|exec|execute)\s+\w+\s*\(/i,                                                                          // stored-proc call
  /\bselect\b[\s\S]*?\binto\b/i,                                                                                // SELECT … INTO (creates a table)
  /\bcopy\s+(into\s+)?\S+\s+(to|from)\b/i, /\bcopy\s+into\b/i, /\bunload\s+\S+\s+(to|from)\b/i,                 // bulk move / exfil (incl. Snowflake COPY INTO)
  /\bexport\s+data\b/i, /\bload\s+data\b/i,
  /\bvacuum\b/i, /\breindex\b/i, /\brefresh\s+materialized\b/i, /\block\s+table\b/i,                            // maintenance writes
];
// A SQL statement BATCH — a `;` followed by another SQL statement (anchored to a leading SQL keyword, so a
// PROSE semicolon "Compare X; then summarize Y" is NOT flagged). The plan lint contract rejects multi-statement
// queries: a batch could hide a write after a read, or run several reads the agent then binds arbitrarily.
const SQL_BATCH = /;\s*(?:select|with|insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|copy|unload|export|load|explain|call|exec|execute|comment|set|begin|commit|rollback|vacuum|refresh|lock|reindex|rename)\b/i;
export function isUnsafeQuery(query: string | undefined): boolean {
  const stripped = stripSqlNoise(query ?? '').trim();
  if (!stripped) return false;
  if (SQL_BATCH.test(stripped)) return true;                  // multi-statement SQL batch (a `;` then another statement)
  return WRITE_PATTERNS.some((re) => re.test(stripped));
}

// The SQL read-only lint guards planes that EXECUTE a query string. Code-reading planes (the clone via
// Read/Grep/Glob = 'none', the codeintel index, repometa, OSV) run no SQL and expose only read tools, so their
// decisive "query" is a natural-language reading plan — linting it as SQL rejected "Grep … call sites (" as a
// stored-proc CALL (a real run's strongest RCE finding shipped only as an open question). An
// ABSENT plane stays linted (conservative).
const NON_SQL_PLANES: ReadonlySet<string> = new Set(['none', 'codeintel', 'repometa', 'osv']);
export function unsafeForPlane(query: string | undefined, plane: MeasurePlane | undefined): boolean {
  return plane != null && NON_SQL_PLANES.has(plane) ? false : isUnsafeQuery(query);
}

// Deterministic, PRE-BUDGET lint (codex-scoped minimal set): degenerate-plan reject · source availability ·
// SQL safety · per-bundle cap. A rejected hypothesis becomes a CoverageGap (reported, not silently dropped);
// it NEVER silently falls back to unplanned measurement (that would defeat the gate).
export function lintPlan(plan: AuditPlan, opts: { mountedPlanes: Set<MeasurePlane>; maxHypotheses: number }): PlanLintResult {
  const items: PlanLintItem[] = [];
  const ok: PlanHypothesis[] = [];
  const rejected: PlanLintResult['rejected'] = [];
  const seen = new Set<string>();
  let runnable = 0;
  for (const h of plan.hypotheses) {
    const reject = (reason: string, gapStatus: CoverageGap['status']) => { items.push({ id: h.id || '(no id)', state: 'rejected', reason, gapStatus }); rejected.push({ hyp: h, reason, gapStatus }); };
    if (!h.id || !h.id.includes(':') || h.id.split(':')[0] !== plan.bundleId) { reject(`id "${h.id ?? ''}" is missing the bundle prefix "${plan.bundleId}:"`, 'not_evidenceable'); continue; }
    if (seen.has(h.id)) { reject(`duplicate id "${h.id}"`, 'not_evidenceable'); continue; }
    seen.add(h.id);
    const hasSet = Array.isArray(h.metricSet) && h.metricSet.length > 0;
    // A metric-set hypothesis is valid with a claim + a non-empty metricSet (no single decisiveMetric needed);
    // a single-metric hypothesis still needs claim + decisiveMetric.
    if (!h.claim?.trim() || (!hasSet && !h.decisiveMetric?.trim())) { reject('missing claim or decisive metric/metric-set', 'not_evidenceable'); continue; }
    if (hasSet) {
      // PER-MOVE lint: unsafe/unmounted INDIVIDUAL moves become planned move gaps (preserved on
      // the move via planGap), they don't reject the whole decomposition. Reject the hypothesis only if NO
      // runnable proxy move remains (the decision/counterfactual move is expected to gap+propose, so it doesn't
      // count toward runnability). This keeps the exemplar-style decomposition alive when e.g. the ablation
      // plane isn't mounted.
      let runnableProxy = 0;
      for (const m of h.metricSet!) {
        const isDecision = m.kind === 'counterfactual';
        if (m.planGap) continue;   // already gapped upstream (e.g. a backfilled missing required move) — not runnable
        if (unsafeForPlane(m.decisiveQuery, m.requiresPlane)) { m.planGap = 'move query is not read-only (write/DDL/multi-statement)'; continue; }
        if (m.requiresPlane && m.requiresPlane !== 'none' && !opts.mountedPlanes.has(m.requiresPlane)) { m.planGap = `requires the ${m.requiresPlane} plane, which is not mounted`; continue; }
        if (!isDecision) runnableProxy++;
      }
      if (runnableProxy === 0) { reject('metric-set has no runnable proxy move (all moves unsafe, unmounted, or unplanned)', 'blocked'); continue; }
    } else {
      if (unsafeForPlane(h.decisiveQuery, h.requiresPlane)) { reject('decisive query is not read-only (write/DDL/SELECT-INTO/multi-statement)', 'not_evidenceable'); continue; }
      if (h.requiresPlane && h.requiresPlane !== 'none' && !opts.mountedPlanes.has(h.requiresPlane)) { reject(`requires the ${h.requiresPlane} plane, which is not mounted`, 'blocked'); continue; }
    }
    if (runnable >= opts.maxHypotheses) { reject(`exceeds the per-bundle hypothesis cap (${opts.maxHypotheses})`, 'budget_skipped'); continue; }
    runnable++; ok.push(h); items.push({ id: h.id, state: 'ok' });
  }
  return { bundleId: plan.bundleId, items, ok, rejected };
}

// Linted-OK PlanHypotheses → the Hypothesis[] the measure loop consumes. The stable, bundle-prefixed ids
// carry through unchanged, so EvidencePayload refs (`measurement:<id>`) match the final id. The planning
// fields (decisive query / data contract / must-beat / plane) ride along as `plannedMeasurement` so the
// Expert EXECUTES the linted query rather than re-planning — making the SQL/source lint load-bearing.
export function planToHypotheses(planHyps: PlanHypothesis[]): Hypothesis[] {
  return planHyps.map((p) => ({
    id: p.id, claim: p.claim, symptom: p.symptom, status: 'open' as const,
    // a metric-set hypothesis has no single decisiveMetric — label it by its archetype for logs/fallbacks
    decisiveMetric: p.decisiveMetric || (p.archetype ? `${p.archetype} decomposition` : ''),
    plannedMeasurement: { mustBeat: p.mustBeat, dataContract: p.dataContract, decisiveQuery: p.decisiveQuery, requiresPlane: p.requiresPlane, archetype: p.archetype, metricSet: p.metricSet },
  }));
}

// Rejected plan items → CoverageGaps (so a lint-failed hypothesis is reported with its next test, not dropped).
export function rejectedToGaps(rejected: PlanLintResult['rejected'], bundleId: string): CoverageGap[] {
  return rejected.map((r) => ({
    id: r.hyp.id ? r.hyp.id.toUpperCase() : `${bundleId.toUpperCase()}-PLAN`,
    concern: r.hyp.claim || `(unnamed plan item in ${bundleId})`,
    whyUnsettled: `plan lint rejected before measurement: ${r.reason}`,
    nextDecisiveTest: `Fix the plan (${r.reason})${r.hyp.decisiveQuery ? `, then run: ${r.hyp.decisiveQuery.slice(0, 80)}` : ', then re-run the measurement'}.`,
    source: 'preflight:lint', status: r.gapStatus, bundleId, hypothesisId: r.hyp.id || undefined,
  }));
}

// LEGACY-path id prefixing: when the server merges per-bundle results from the NON-plan path,
// it must bundle-prefix the hypothesis ids — AND rewrite the EvidencePayload ref, which was minted from the
// unprefixed id inside deepAudit (a latent desync). The execute-plan path needs none of this (ids
// are already prefixed at plan creation).
export function prefixBundle(bundleId: string, hyps: Hypothesis[]): Hypothesis[] {
  const pfx = (id: string) => `${bundleId}:${id}`;
  return hyps.map((h) => {
    const newId = pfx(h.id);
    const ev = h.measurement?.evidence;
    const measurement = h.measurement
      ? { ...h.measurement, evidence: ev && ev.ref === `measurement:${h.id}` ? { ...ev, ref: `measurement:${newId}` } : ev }
      : h.measurement;
    return { ...h, id: newId, measurement };
  });
}
