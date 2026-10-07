// orgFacts.ts — structured, keyed, COMPARABLE fact cards + the org alias table + contradiction edges
// (cross-project org memory: fact cards, contradiction edges, freshness).
//
//   <THERESA_DATA_DIR>/org-facts/<orgKey>/facts.json   → { v, orgKey, updated, facts: FactCard[], edges: FactEdge[] }
//   <THERESA_DATA_DIR>/org-facts/<orgKey>/aliases.json → { v, orgKey, updated, aliases: FactAlias[] }
//
// A FACT is one project's claim about one canonical ENTITY KEY (`metric:dau`, `table:analytics.events`,
// `practice:freshness-check`, `dep:npm/react`), with a typed payload, evidence refs (repo-relative path[:line] @ SHA) and
// provenance {project, repo, sha, runId, measuredAt, confidence}. It follows the PRIOR+RE-VERIFY rule everywhere it is
// shown to an agent: a claim to re-check, never ground truth.
//
// FRESHNESS (§7), applied by ingestRunFacts on every completed scan of a project:
//   • re-observed → refreshed (payload / evidence / sha / run / lastSeen), state active;
//   • NOT re-observed on a re-scan of its project, evidence file still there → `disputed` (shown with a warning) — for a
//     DETERMINISTIC source (manifest / codeintel / osv) on the first miss; an LLM-extracted (`verdict`) fact only after
//     TWO consecutive missed re-scans (`missCount`: one Haiku pass that happened not to restate a fact is
//     not evidence the fact changed);
//   • NOT re-observed and its evidence file is gone → `retired`;
//   • TTL per kind (a metric definition outlives a dependency version) — an expired active fact READS as disputed.
//
// ALIASES: agent-proposed (unconfirmed) or operator-confirmed pairs of keys. An unconfirmed alias widens RECALL only; it
// is never used to ASSERT a conflict. EDGES are recomputed deterministically after every write, between ACTIVE facts of
// DIFFERENT projects with the same key (or a CONFIRMED alias) that disagree on a comparable field (COMPARABLE per kind,
// below). Fields absent on either side are not compared (unknown ≠ different). Two classes:
//   • `contradicts` — a DEFINITION kind (metric-def / table-contract / event-schema) recorded differently: a real conflict;
//   • `differs`     — a practice present in one project and not another, a different dependency major: a neutral
//                     difference, shown as such, never counted as a conflicting definition.
// CONCURRENCY: a run's facts are PLANNED at prepare time (a preview) and RE-PLANNED at commit, from the
// on-disk state read INSIDE scanLineage.withFileLock (commitIngest) — two runs committing concurrently both survive.
// Alias writes take the same lock. CAPS are per project and per kind, so one project's dependency list can
// never evict another project's metric definitions; edges are capped per kind by priority.
//
// Storage + isolation exactly like orgProjects.ts: local JSON under THERESA_DATA_DIR, org-scoped by directory
// (safeSeg(orgKey)) + an orgKey check on read; the exported functions are the storage seam for a later backend move.
// Fail-open: reads return empty, writes swallow errors.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { dataDir } from './store.ts';
import { safeSeg, withFileLock, writeJsonAtomic } from './scanLineage.ts';
import { redactSecrets } from './research/reportEvidence.ts';
import { listProjects } from './orgProjects.ts';

export const FACT_KINDS = ['metric-def', 'event-schema', 'table-contract', 'practice', 'dependency'] as const;
export type FactKind = typeof FACT_KINDS[number];
export type FactState = 'active' | 'disputed' | 'retired';
export type FactSource = 'manifest' | 'codeintel' | 'osv' | 'verdict' | 'operator';

/** Days a fact stays fresh without being re-observed (§7). */
export const FACT_TTL_DAYS: Record<FactKind, number> = { 'metric-def': 180, 'event-schema': 120, 'table-contract': 120, practice: 90, dependency: 30 };
/** The key prefix each kind must use. */
export const KEY_PREFIX: Record<FactKind, string> = { 'metric-def': 'metric:', 'event-schema': 'event:', 'table-contract': 'table:', practice: 'practice:', dependency: 'dep:' };

const VAL_MAX = 300;
const LIST_MAX = 20;
// Caps: per project + kind, then an absolute ceiling that evicts retired → dependency → oldest first.
export const DEP_FACTS_PER_PROJECT = 400;
export const KIND_FACTS_PER_PROJECT = 800;
const FACTS_MAX = 20000;
const EDGES_MAX = 2000;
const EDGES_PER_KIND = 800;
/** Edge priority when the cap binds: definitions first, dependencies last. */
export const EDGE_KIND_PRIORITY: FactKind[] = ['metric-def', 'table-contract', 'event-schema', 'practice', 'dependency'];
/** The kinds whose disagreement is a real CONFLICT (a `contradicts` edge); the others only `differ`. */
export const DEFINITION_KINDS: ReadonlySet<FactKind> = new Set<FactKind>(['metric-def', 'table-contract', 'event-schema']);
const ALIASES_MAX = 1000;

// ── payload schemas (typed per kind; value strings capped + secret-redacted on the way in) ───────────────────────────
const str = z.string().transform((s) => redactSecrets(s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, VAL_MAX));
const optStr = str.optional();
const strList = z.array(str).max(60).transform((a) => [...new Set(a.filter(Boolean))].slice(0, LIST_MAX)).optional();
export const PAYLOAD_SCHEMAS = {
  'metric-def': z.object({ name: str, formula: optStr, sourceTables: strList, filters: strList, timezone: optStr, dedup: optStr, owner: optStr }),
  'event-schema': z.object({ name: str, properties: strList, required: strList, emitter: optStr, sink: optStr }),
  'table-contract': z.object({ table: str, role: z.enum(['producer', 'consumer', 'both']).optional(), producer: optStr, consumers: strList, freshnessSla: optStr, partitioning: optStr, checks: strList }),
  practice: z.object({ practice: str, present: z.boolean(), how: optStr, where: optStr }),
  dependency: z.object({ ecosystem: str, name: str, range: optStr, pinned: z.boolean().optional(), major: optStr, vuln: z.enum(['known', 'none', 'unknown']).optional(), advisories: strList }),
} as const;
export type FactPayload = Record<string, unknown>;

export interface FactEvidence { path: string; line?: number; sha?: string }
export interface FactCard {
  id: string;                 // hash(projectId, key, repo)
  key: string;                // canonical entity key (lower-case)
  kind: FactKind;
  projectId: string;
  repo: string;               // repoKey (github:owner/repo · local:<src>:<folder>)
  repoFullName?: string;      // owner/repo for github repos (evidence permalinks + the visibility probe)
  public?: boolean;           // a public github.com URL target (accessible to anyone by definition)
  sha?: string;
  runId: string;
  measuredAt: string;         // when the run observed it
  confidence: 'high' | 'medium' | 'low';
  source: FactSource;
  payload: FactPayload;
  evidence: FactEvidence[];
  state: FactState;
  ttlDays: number;
  firstSeen: string;
  lastSeen: string;
  stateReason?: string;
  missCount?: number;         // consecutive re-scans of its project that did not re-observe a `verdict` fact
}
export interface FactEdge { type: 'contradicts' | 'differs'; a: string; b: string; key: string; fields: string[]; via?: 'alias'; at: string }
export interface FactAlias { a: string; b: string; state: 'proposed' | 'confirmed'; by: 'agent' | 'operator'; runId?: string; at: string }
interface FactsFile { v: 1; orgKey: string; updated: string; facts: FactCard[]; edges: FactEdge[] }
interface AliasFile { v: 1; orgKey: string; updated: string; aliases: FactAlias[] }

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
export function factId(projectId: string, key: string, repo: string): string { return 'f-' + hash(`${projectId}\n${key}\n${repo.toLowerCase()}`); }

/** A canonical entity key: lower-case, prefix kept, whitespace → '_', bounded, only [a-z0-9_.:/@-]. */
export function canonicalKey(k: string): string {
  return String(k ?? '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.:/@-]/g, '').slice(0, 160);
}
export function kindOfKey(k: string): FactKind | null {
  for (const kind of FACT_KINDS) if (k.startsWith(KEY_PREFIX[kind])) return kind;
  return null;
}

/** Validate one payload against its kind (strict — unknown kinds / malformed payloads are dropped). */
export function parsePayload(kind: FactKind, payload: unknown): FactPayload | null {
  const r = PAYLOAD_SCHEMAS[kind].safeParse(payload);
  if (!r.success) return null;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.data as Record<string, unknown>)) if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) o[k] = v;
  return o;
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function factsPath(orgKey: string): string { return join(dataDir(), 'org-facts', safeSeg(orgKey), 'facts.json'); }
function aliasPath(orgKey: string): string { return join(dataDir(), 'org-facts', safeSeg(orgKey), 'aliases.json'); }
function readJson<T extends { v: 1; orgKey: string }>(p: string, orgKey: string): T | null {
  try {
    const f = JSON.parse(readFileSync(p, 'utf8')) as T;
    return f?.v === 1 && f.orgKey === safeSeg(orgKey) ? f : null;
  } catch { return null; }
}
function writeJson(p: string, v: unknown): boolean {
  try { mkdirSync(join(p, '..'), { recursive: true }); writeJsonAtomic(p, v); return true; } catch { return false; }
}
function readFacts(orgKey: string): FactsFile {
  const f = readJson<FactsFile>(factsPath(orgKey), orgKey);
  // An edge written before the contradicts / differs split is re-classified by its key's kind on read.
  const edgeType = (e: FactEdge): FactEdge['type'] => { const k = kindOfKey(e.key); return k && DEFINITION_KINDS.has(k) ? 'contradicts' : 'differs'; };
  if (!f || !Array.isArray(f.facts)) return { v: 1, orgKey: safeSeg(orgKey), updated: '', facts: [], edges: [] };
  const edges = Array.isArray(f.edges) ? f.edges.map((e) => ({ ...e, type: edgeType(e) })) : [];
  return { ...f, ...remapMergedProjects(f.facts, edges, mergedProjectMap(orgKey)) };
}

/** Merged-away project id → the project it was folded into (orgProjects `mergedFrom`). */
export function mergedProjectMap(orgKey: string): Map<string, string> {
  const m = new Map<string, string>();
  try { for (const p of listProjects(orgKey)) for (const old of p.mergedFrom ?? []) m.set(old, p.projectId); } catch { /* registry unreadable: no remap */ }
  return m;
}
/**
 * Attribute the facts of a merged-away project to the project it was folded into: its facts get
 * the surviving projectId (and that project's fact id, the freshest copy wins), and an edge between a project and its
 * own former self is dropped — otherwise a merge shows up as a cross-project contradiction and the old facts never age.
 */
export function remapMergedProjects(facts: FactCard[], edges: FactEdge[], merged: Map<string, string>): { facts: FactCard[]; edges: FactEdge[] } {
  if (!merged.size || !facts.some((x) => merged.has(x.projectId))) return { facts, edges };
  const idMap = new Map<string, string>();
  const byId = new Map<string, FactCard>();
  for (const x of facts) {
    const projectId = merged.get(x.projectId) ?? x.projectId;
    const card = projectId === x.projectId ? x : { ...x, projectId, id: factId(projectId, x.key, x.repo) };
    idMap.set(x.id, card.id);
    const prev = byId.get(card.id);
    if (!prev || newestFirst(card, prev) < 0) byId.set(card.id, card);
  }
  const out = [...byId.values()];
  const proj = new Map(out.map((x) => [x.id, x.projectId]));
  const seen = new Set<string>();
  const kept = edges.flatMap((e) => {
    const a = idMap.get(e.a) ?? e.a, b = idMap.get(e.b) ?? e.b;
    if (a === b || !proj.has(a) || !proj.has(b) || proj.get(a) === proj.get(b)) return [];
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${e.type}\n${x}\n${y}`;
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ ...e, a: x, b: y }];
  });
  return { facts: out, edges: kept };
}
function writeFacts(orgKey: string, facts: FactCard[], edges: FactEdge[], at: string): boolean {
  const kept = capFacts(facts);
  return writeJson(factsPath(orgKey), { v: 1, orgKey: safeSeg(orgKey), updated: at, facts: kept, edges: capEdges(edges, kept) } satisfies FactsFile);
}
const freshness = (f: FactCard): number => (f.state === 'active' ? 2 : f.state === 'disputed' ? 1 : 0);
const newestFirst = (a: FactCard, b: FactCard): number => freshness(b) - freshness(a) || b.lastSeen.localeCompare(a.lastSeen) || a.id.localeCompare(b.id);
/**
 * Per-project, per-kind caps: each project keeps its DEP_FACTS_PER_PROJECT freshest dependency facts and
 * KIND_FACTS_PER_PROJECT freshest facts of every other kind — so no project's dependency list (or another project's
 * anything) ever evicts a metric definition. The absolute FACTS_MAX ceiling then drops retired facts, then dependency
 * facts, then the oldest. Order of the survivors is preserved.
 */
export function capFacts(facts: FactCard[]): FactCard[] {
  const groups = new Map<string, FactCard[]>();
  for (const f of facts) { const g = `${f.projectId}\n${f.kind}`; const a = groups.get(g) ?? []; a.push(f); groups.set(g, a); }
  const keep = new Set<string>();
  for (const list of groups.values()) {
    const cap = list[0].kind === 'dependency' ? DEP_FACTS_PER_PROJECT : KIND_FACTS_PER_PROJECT;
    for (const f of [...list].sort(newestFirst).slice(0, cap)) keep.add(f.id);
  }
  let out = facts.filter((f) => keep.has(f.id));
  if (out.length > FACTS_MAX) {
    const rank = (f: FactCard) => (f.state === 'retired' ? 0 : f.kind === 'dependency' ? 1 : 2);
    const survivors = new Set([...out].sort((a, b) => rank(b) - rank(a) || newestFirst(a, b)).slice(0, FACTS_MAX).map((f) => f.id));
    out = out.filter((f) => survivors.has(f.id));
  }
  return out;
}
/** Edges between facts that still exist, capped per kind (EDGES_PER_KIND) and overall by EDGE_KIND_PRIORITY. */
export function capEdges(edges: FactEdge[], facts: FactCard[]): FactEdge[] {
  const ids = new Set(facts.map((f) => f.id));
  const pr = (e: FactEdge) => { const k = kindOfKey(e.key); const i = k ? EDGE_KIND_PRIORITY.indexOf(k) : -1; return i < 0 ? EDGE_KIND_PRIORITY.length : i; };
  const perKind = new Map<number, number>();
  const out: FactEdge[] = [];
  for (const e of edges.filter((x) => ids.has(x.a) && ids.has(x.b)).sort((p, q) => pr(p) - pr(q) || Number(p.type !== 'contradicts') - Number(q.type !== 'contradicts') || p.key.localeCompare(q.key) || p.a.localeCompare(q.a) || p.b.localeCompare(q.b))) {
    const k = pr(e), n = perKind.get(k) ?? 0;
    if (n >= EDGES_PER_KIND) continue;
    perKind.set(k, n + 1);
    out.push(e);
    if (out.length >= EDGES_MAX) break;
  }
  return out;
}

/**
 * A stored `public` flag is TRUSTED only while fresh: a repo can go private after the scan that saw it public,
 * so the flag counts for PUBLIC_TTL_DAYS since the fact's last observation — after that the fact must be re-probed with
 * the run's clone credential (makeAccessChecker) / is treated as not public by the console (canSeeFromSources).
 */
export const PUBLIC_TTL_DAYS = 7;
export function publicStill(f: { public?: boolean; lastSeen?: string }, now: Date = new Date()): boolean {
  if (f.public !== true) return false;
  const age = (now.getTime() - Date.parse(String(f.lastSeen ?? ''))) / 86_400_000;
  return Number.isFinite(age) && age <= PUBLIC_TTL_DAYS;
}

/** The fact's EFFECTIVE state now: an active fact past its TTL reads as disputed (reason 'ttl'). */
export function effectiveState(f: FactCard, now: Date = new Date()): { state: FactState; reason?: string } {
  if (f.state !== 'active') return { state: f.state, ...(f.stateReason ? { reason: f.stateReason } : {}) };
  const age = (now.getTime() - Date.parse(f.lastSeen)) / 86_400_000;
  return Number.isFinite(age) && age > f.ttlDays ? { state: 'disputed', reason: `not re-observed for ${Math.floor(age)} days (TTL ${f.ttlDays})` } : { state: 'active' };
}

export function listFacts(orgKey: string, filt: { kind?: string; projectId?: string; includeRetired?: boolean } = {}): FactCard[] {
  return readFacts(orgKey).facts.filter((f) => (!filt.kind || f.kind === filt.kind) && (!filt.projectId || f.projectId === filt.projectId) && (filt.includeRetired || f.state !== 'retired'));
}
export function listEdges(orgKey: string): FactEdge[] { return readFacts(orgKey).edges; }
export function listAliases(orgKey: string): FactAlias[] {
  const f = readJson<AliasFile>(aliasPath(orgKey), orgKey);
  return f && Array.isArray(f.aliases) ? f.aliases : [];
}

// ── aliases ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Groups of equivalent keys (union-find). `confirmedOnly` = the groups that may ASSERT a conflict. */
export function aliasGroups(aliases: FactAlias[], confirmedOnly: boolean): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  for (const a of aliases) {
    if (confirmedOnly && a.state !== 'confirmed') continue;
    if (!parent.has(a.a)) parent.set(a.a, a.a);
    if (!parent.has(a.b)) parent.set(a.b, a.b);
    const ra = find(a.a), rb = find(a.b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const out = new Map<string, string>();
  for (const k of parent.keys()) out.set(k, find(k));
  return out;
}
/** Every key equivalent to `key` (itself included). */
export function equivalentKeys(key: string, aliases: FactAlias[], confirmedOnly: boolean): Set<string> {
  const g = aliasGroups(aliases, confirmedOnly);
  const root = g.get(key);
  if (!root) return new Set([key]);
  return new Set([...g.entries()].filter(([, r]) => r === root).map(([k]) => k).concat(key));
}

export type AliasOp = { op: 'propose' | 'confirm' | 'remove'; a: string; b: string };
export function parseAliasOp(body: unknown): { ok: true; op: AliasOp } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const op = String(b.op ?? '');
  if (op !== 'propose' && op !== 'confirm' && op !== 'remove') return { ok: false, error: 'op must be propose / confirm / remove' };
  const a = canonicalKey(String(b.a ?? '')), c = canonicalKey(String(b.b ?? ''));
  if (!a || !c || a === c) return { ok: false, error: 'a and b must be two different entity keys' };
  const ka = kindOfKey(a), kb = kindOfKey(c);
  if (!ka || ka !== kb) return { ok: false, error: 'an alias joins two keys of the same kind (e.g. metric:dau ≈ metric:daily_active_users)' };
  return { ok: true, op: { op, a, b: c } };
}
/** Apply one alias op. `by` = who: the agent may only PROPOSE; an operator proposes, confirms or removes. */
// `remove` is OPERATOR-only: an agent may only propose; an agent `remove` / `confirm` changes nothing
// beyond what a proposal would. The read-modify-write runs under the alias file lock, and the edge recompute under the
// facts lock (lock order alias → facts; commitIngest takes only the facts lock).
export function applyAliasOp(orgKey: string, op: AliasOp, by: 'agent' | 'operator', at: string = new Date().toISOString(), runId?: string): FactAlias[] {
  if (op.op === 'remove' && by !== 'operator') return listAliases(orgKey);
  const run = (): FactAlias[] => {
    const cur = listAliases(orgKey);
    const same = (x: FactAlias) => (x.a === op.a && x.b === op.b) || (x.a === op.b && x.b === op.a);
    let next = cur;
    if (op.op === 'remove') next = cur.filter((x) => !same(x));
    else {
      const prev = cur.find(same);
      const state: FactAlias['state'] = op.op === 'confirm' && by === 'operator' ? 'confirmed' : (prev?.state ?? 'proposed');
      const row: FactAlias = { a: op.a < op.b ? op.a : op.b, b: op.a < op.b ? op.b : op.a, state, by: prev && prev.by === 'operator' ? 'operator' : by, at, ...(runId ? { runId } : prev?.runId ? { runId: prev.runId } : {}) };
      next = [...cur.filter((x) => !same(x)), row].slice(-ALIASES_MAX);
    }
    writeJson(aliasPath(orgKey), { v: 1, orgKey: safeSeg(orgKey), updated: at, aliases: next } satisfies AliasFile);
    // A confirmed/removed alias changes which facts contradict: recompute the edges (under the facts lock).
    if (op.op !== 'propose') lockedOr(factsPath(orgKey), () => { const f = readFacts(orgKey); writeFacts(orgKey, f.facts, computeContradictions(f.facts, next, new Date(at)), at); }, undefined);
    return next;
  };
  return lockedOr(aliasPath(orgKey), run, listAliases(orgKey));
}
/** Run `fn` under the file lock; fail-open to `fallback` when the lock cannot be taken (a wedged writer never breaks a run). */
function lockedOr<T>(p: string, fn: () => T, fallback: T): T {
  try { return withFileLock(p, fn); } catch { return fallback; }
}

// ── contradictions ───────────────────────────────────────────────────────────────────────────────────────────────────
const normText = (v: unknown): string => String(v ?? '').toLowerCase().replace(/[`"'()\s]+/g, ' ').replace(/\s*([,=<>+*/-])\s*/g, '$1').trim();
const normSet = (v: unknown): string => (Array.isArray(v) ? [...new Set(v.map(normText))].sort().join('|') : '');
/** The comparable fields of each kind → a normalized comparable value (undefined = not comparable on this fact). */
export const COMPARABLE: Record<FactKind, Record<string, (p: FactPayload) => string | undefined>> = {
  'metric-def': {
    formula: (p) => (p.formula ? normText(p.formula) : undefined),
    timezone: (p) => (p.timezone ? normText(p.timezone).replace(/^(etc\/)?(utc|gmt)(\+0|0)?$/, 'utc') : undefined),
    dedup: (p) => (p.dedup ? normText(p.dedup) : undefined),
    filters: (p) => (Array.isArray(p.filters) && p.filters.length ? normSet(p.filters) : undefined),
  },
  'table-contract': {
    freshnessSla: (p) => (p.freshnessSla ? normText(p.freshnessSla) : undefined),
    checksPresent: (p) => (Array.isArray(p.checks) ? (p.checks.length ? 'yes' : 'no') : undefined),
  },
  practice: { present: (p) => (typeof p.present === 'boolean' ? String(p.present) : undefined) },
  dependency: { major: (p) => (p.major ? String(p.major) : undefined) },
  'event-schema': {},
};
/** The fields on which two same-kind facts DISAGREE (only fields comparable on both). A field whose normalized value
 *  is '?' (ambiguous — e.g. a dependency range with no single major) is never compared. */
export function divergentFields(kind: FactKind, a: FactPayload, b: FactPayload): string[] {
  const out: string[] = [];
  for (const [field, fn] of Object.entries(COMPARABLE[kind] ?? {})) {
    const x = fn(a), y = fn(b);
    if (x !== undefined && y !== undefined && x !== '?' && y !== '?' && x !== y) out.push(field);
  }
  return out;
}
/**
 * Deterministic edges over a fact set: ACTIVE (effective) facts of DIFFERENT projects, same key or a CONFIRMED alias (an
 * unconfirmed alias never asserts a conflict), same kind, divergent comparable fields. A DEFINITION kind yields a
 * `contradicts` edge; a practice / dependency only a neutral `differs` edge.
 */
export function computeContradictions(facts: FactCard[], aliases: FactAlias[], now: Date = new Date()): FactEdge[] {
  const groups = aliasGroups(aliases, true);
  const root = (k: string) => groups.get(k) ?? k;
  const byRoot = new Map<string, FactCard[]>();
  for (const f of facts) {
    if (effectiveState(f, now).state !== 'active') continue;
    const r = `${f.kind}|${root(f.key)}`;
    const a = byRoot.get(r) ?? []; a.push(f); byRoot.set(r, a);
  }
  const edges: FactEdge[] = [];
  const at = now.toISOString();
  for (const list of byRoot.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.projectId === b.projectId) continue;
      const fields = divergentFields(a.kind, a.payload, b.payload);
      if (!fields.length) continue;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      edges.push({ type: DEFINITION_KINDS.has(a.kind) ? 'contradicts' : 'differs', a: x.id, b: y.id, key: root(a.key), fields, ...(a.key !== b.key ? { via: 'alias' as const } : {}), at });
    }
  }
  return capEdges(edges, facts);
}

// ── ingest (the run-end write) ───────────────────────────────────────────────────────────────────────────────────────
export interface NewFact {
  key: string; kind: FactKind; projectId: string; repo: string; repoFullName?: string; public?: boolean; sha?: string;
  confidence: FactCard['confidence']; source: FactSource; payload: FactPayload; evidence: FactEvidence[];
}
export interface IngestPlan { facts: FactCard[]; edges: FactEdge[]; added: number; refreshed: number; disputed: number; retired: number }
/** Everything planIngest needs besides the current state — kept by the caller so the commit can RE-PLAN. */
export interface IngestInput { incoming: NewFact[]; run: { runId: string; at: string }; scanned: { projectId: string; repo: string }[]; evidenceExists: (f: FactCard) => boolean; sources: FactSource[] }
/**
 * Merge one completed run's facts into an org's current fact set (PURE — the caller persists via commitFacts).
 *   scanned: the (projectId, repo) pairs this run scanned — only facts of those pairs are aged by non-observation.
 *   evidenceExists: does a not-re-observed fact's evidence file still exist in THIS run's workspace?
 * `sources` limits aging to the fact sources this run actually produced (a run whose LLM pass was skipped does not
 * dispute every verdict-derived fact of the project).
 */
export function planIngest(cur: FactCard[], aliases: FactAlias[], incoming: NewFact[], run: { runId: string; at: string }, scanned: { projectId: string; repo: string }[], evidenceExists: (f: FactCard) => boolean, sources: FactSource[]): IngestPlan {
  const byId = new Map(cur.map((f) => [f.id, { ...f }]));
  const seen = new Set<string>();
  let added = 0, refreshed = 0, disputed = 0, retired = 0;
  for (const n of incoming) {
    const key = canonicalKey(n.key);
    if (!key || kindOfKey(key) !== n.kind) continue;
    const id = factId(n.projectId, key, n.repo);
    if (seen.has(id)) continue;   // first observation of a key per (project, repo) wins within one run
    seen.add(id);
    const prev = byId.get(id);
    const card: FactCard = {
      id, key, kind: n.kind, projectId: n.projectId, repo: n.repo, ...(n.repoFullName ? { repoFullName: n.repoFullName } : {}), ...(n.public ? { public: true } : {}),
      ...(n.sha ? { sha: n.sha } : {}), runId: run.runId, measuredAt: run.at, confidence: n.confidence, source: n.source, payload: n.payload,
      evidence: n.evidence.slice(0, 6), state: 'active', ttlDays: FACT_TTL_DAYS[n.kind], firstSeen: prev?.firstSeen ?? run.at, lastSeen: run.at,
    };
    byId.set(id, card);
    if (prev) refreshed++; else added++;
  }
  const scannedSet = new Set(scanned.map((s) => `${s.projectId}\n${s.repo.toLowerCase()}`));
  const srcSet = new Set(sources);
  for (const f of byId.values()) {
    if (seen.has(f.id) || f.state === 'retired') continue;
    if (!scannedSet.has(`${f.projectId}\n${f.repo.toLowerCase()}`) || !srcSet.has(f.source) || f.source === 'operator') continue;
    if (!evidenceExists(f)) { f.state = 'retired'; f.stateReason = `evidence file gone at run ${run.runId}`; delete f.missCount; retired++; continue; }
    if (f.state === 'disputed') continue;
    // An LLM-extracted fact needs TWO consecutive misses; a deterministic one is disputed on the first.
    const misses = (f.missCount ?? 0) + 1;
    if (f.source === 'verdict' && misses < 2) { f.missCount = misses; continue; }
    f.state = 'disputed'; f.stateReason = `not re-observed by the re-scan ${run.runId}${misses > 1 ? ` (${misses} re-scans in a row)` : ''}`; f.missCount = misses; disputed++;
  }
  const facts = [...byId.values()];
  return { facts, edges: computeContradictions(facts, aliases, new Date(run.at)), added, refreshed, disputed, retired };
}
export function currentFactState(orgKey: string): { facts: FactCard[]; aliases: FactAlias[] } { return { facts: readFacts(orgKey).facts, aliases: listAliases(orgKey) }; }
/** Persist a plan AS IS (tests / seeding). A run commits through commitIngest, which re-plans under the lock. */
export function commitFacts(orgKey: string, plan: IngestPlan, at: string): boolean { return lockedOr(factsPath(orgKey), () => writeFacts(orgKey, plan.facts, plan.edges, at), false); }
/**
 * The run-end write: under the facts file lock, RE-READ the on-disk facts + aliases, re-run the PURE
 * planIngest with this run's input, and write — so a run that committed between this run's prepare and commit is
 * merged, never overwritten. Returns the committed plan, or null when the store could not be locked / written.
 */
export function commitIngest(orgKey: string, input: IngestInput): IngestPlan | null {
  return lockedOr(factsPath(orgKey), () => {
    const plan = planIngest(readFacts(orgKey).facts, listAliases(orgKey), input.incoming, input.run, input.scanned, input.evidenceExists, input.sources);
    return writeFacts(orgKey, plan.facts, plan.edges, input.run.at) ? plan : null;
  }, null);
}

/** Edges touching one project (the Leadership "Across your projects" row, the Execution report). `type` filters. */
export function edgesForProjects(facts: FactCard[], edges: FactEdge[], projectIds: Set<string>, type?: FactEdge['type']): { edge: FactEdge; mine: FactCard; other: FactCard }[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: { edge: FactEdge; mine: FactCard; other: FactCard }[] = [];
  for (const e of edges) {
    if (type && (e.type ?? 'contradicts') !== type) continue;
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    if (projectIds.has(a.projectId) && !projectIds.has(b.projectId)) out.push({ edge: e, mine: a, other: b });
    else if (projectIds.has(b.projectId) && !projectIds.has(a.projectId)) out.push({ edge: e, mine: b, other: a });
  }
  return out;
}

/** A one-line, value-carrying summary of a fact's payload (the Compare cell + the CONTRAST line). */
export function factSummary(f: Pick<FactCard, 'kind' | 'payload'>): string {
  const p = f.payload as Record<string, any>;
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : '');
  const parts: string[] = [];
  switch (f.kind) {
    case 'metric-def':
      if (p.formula) parts.push(String(p.formula));
      if (p.timezone) parts.push(`${p.timezone} day`);
      if (p.dedup) parts.push(`dedup ${p.dedup}`);
      if (list(p.filters)) parts.push(`filters: ${list(p.filters)}`);
      if (list(p.sourceTables)) parts.push(`from ${list(p.sourceTables)}`);
      break;
    case 'event-schema':
      if (list(p.properties)) parts.push(`properties: ${list(p.properties)}`);
      if (list(p.required)) parts.push(`required: ${list(p.required)}`);
      if (p.emitter) parts.push(`emitted by ${p.emitter}`);
      if (p.sink) parts.push(`→ ${p.sink}`);
      break;
    case 'table-contract':
      if (p.role) parts.push(p.role);
      if (p.freshnessSla) parts.push(`freshness SLA ${p.freshnessSla}`);
      if (Array.isArray(p.checks)) parts.push(p.checks.length ? `checks: ${list(p.checks)}` : 'no checks');
      if (list(p.consumers)) parts.push(`consumers: ${list(p.consumers)}`);
      if (p.partitioning) parts.push(`partitioned by ${p.partitioning}`);
      break;
    case 'practice':
      parts.push(p.present ? 'present' : 'absent');
      if (p.how) parts.push(String(p.how));
      if (p.where) parts.push(`in ${p.where}`);
      break;
    case 'dependency':
      if (p.range) parts.push(String(p.range));
      if (p.pinned === true) parts.push('pinned');
      if (p.vuln === 'known') parts.push(`known advisory${list(p.advisories) ? ` (${list(p.advisories)})` : ''}`);
      break;
  }
  return (parts.join('; ') || '(recorded)').slice(0, 400);
}
