// scanLineage.ts — which earlier run is the BASELINE for a re-scan.
//
// Checkpoints are keyed by runId only. The lineage index adds the missing "same target, earlier run" lookup:
//
//   <THERESA_DATA_DIR>/lineage/<orgKey>/<targetKey>.json   → { v, orgKey, targetKey, targets, entries: LineageEntry[] }
//
//   • orgKey = the run's FROZEN run.orgId, else the tenant (`t-<tenant>`) the way other org-scoped state falls back when
//     no org resolves. The org is the isolation boundary: a lookup only ever opens its own org's directory, so org A
//     can never select org B's baseline (server-side, by path construction, not by filtering).
//   • targetKey = a hash of the SORTED target set: `gh:owner/repo@branch` (GitHub source), `url:owner/repo@branch`
//     (public github URL), `local:<sourceId>:<folder>`, `gcp:<project>`. The SAME TARGET, not the same run config.
//     Branch is `default` when the run clones the default branch (every Full Scan today).
//   • Entries are written at finish for COMPLETED agentic Full Scans only; the newest K (THERESA_INCR_KEEP, default 3)
//     are kept per target. Pruning drops an entry from the INDEX only — the run's checkpoint sidecars belong to the run
//     (the user may still resume it) and are never deleted here.
//
// Baseline selection (selectBaseline): the newest complete entry of the same org + target whose checkpoint STAGE
// VERSIONS equal the running code's (fail-closed — a payload shape change makes every cut unreadable) and which has at
// least the `findings` cut. The bundle / invariant REGISTRY hash is recorded here and compared PER LANE by the planner
// (src/run/incremental.ts, proposal §6): a changed playbook drops that lane (or Comprehend) to a re-run instead of
// discarding the whole baseline, so the "Since last scan" diff still has something to compare against.
// Paths are built from sanitized, injective segments only (safeSeg; no traversal). Fail-open: every read returns empty on
// error and every write logs + swallows its failure — lineage never breaks a run.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CKPT_STAGE_VERSION, type CkptId } from './checkpoints.ts';
import { dataDir } from './store.ts';
import { EXPERT_BUNDLES } from './research/experts.ts';
import { ALL_INVARIANTS } from './research/invariants.ts';

export const LINEAGE_KEEP = Math.max(1, Math.floor(Number(process.env.THERESA_INCR_KEEP)) || 3);

export interface LineageRepo { fullName: string; dir: string; sha?: string; public?: boolean }
export interface LineageEntry {
  v: 1;
  runId: string;
  createdBy?: string;
  createdAt: string;            // run start (ISO)
  finishedAt: string;           // when the entry was written (ISO)
  status: 'complete';
  targets: string[];
  repos: LineageRepo[];         // per-repo pinned SHA (the workspace manifest)
  localDirs: { name: string; path: string; files?: number; bytes?: number; hash?: string }[];   // hash = content fingerprint (checkpoints.dirFingerprint)
  bundleIds: string[];          // the activated bundle set (the comprehend cut)
  invariantIds: string[];       // the run's explicit invariant pick ([] = auto)
  manualBundles?: string[] | null;   // the run's MANUAL bundle selection (null = auto — Comprehend chose)
  planeFps: string[];           // measure-plane identity fingerprints that mounted (comprehend `planes[].fp`)
  briefHash: string;            // hash of the normalized brief
  inputsSig: string;            // hash of the lane-global inputs (brief + memory recall + codeintel choice) — the compared inputsFp
  stageVersions: Record<string, number>;
  registryHash: string;         // combined bundle + invariant registry hash
  bundleHashes: Record<string, string>;
  invariantHash: string;
  codeHash?: string;            // prompt-module source + model env hash (registryHashes().codeHash; absent on older entries)
  cuts: CkptId[];               // which checkpoint cuts exist for the run
  laneSpend: Record<string, number>;   // per-lane spend of the last time each lane actually RAN (carried when reused)
  nodeSpend?: Record<string, number>;  // discovery / bundle / audit / reserve spend of this run
  totalSpend: number;
  fullSpendUsd?: number;        // spend of the last FULL scan in this chain (the "instead of ~$c" figure)
  depth: number;                // 0 = a full scan; n = n incremental runs since the last full one
  lastFullAt: string;           // ISO time of the last full scan in the chain
  incremental?: { baselineRunId: string; mode: string };
}
interface LineageFile { v: 1; orgKey: string; targetKey: string; targets: string[]; entries: LineageEntry[] }

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
/**
 * A path segment that can never traverse, and INJECTIVE: an already-safe value ([A-Za-z0-9_.-], no
 * leading dot, ≤ 120 chars — every org id / tenant / target hash in practice) is used as-is, so existing files keep
 * their paths; anything else becomes `~<sanitized>-<hash>` — `~` never occurs in a safe value, so an unsafe value can
 * never alias a safe one (`a/b` and `a_b` used to share `a_b`), and the hash separates two unsafe values.
 */
export function safeSeg(s: string): string {
  const raw = String(s ?? '');
  if (/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}$/.test(raw)) return raw;
  const t = raw.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 80);
  return `~${t}-${sha(raw).slice(0, 12)}`;
}
/**
 * The org scope of a run's lineage / findings: the frozen run.orgId, else the tenant (`t-<tenant>`). null when the run
 * has NEITHER: such runs used to share one `t-none` scope, so unrelated org-less runs could select each
 * other's baselines — now lineage is simply off for them (full scan, nothing recorded). An org id that itself starts
 * with `t-` is forced into the hashed form so it can never alias a tenant scope.
 */
export function orgKeyFor(orgId: string | null | undefined, tenant: string | null | undefined): string | null {
  if (orgId) { const o = String(orgId); return /^t-/.test(o) ? `~${safeSeg(o).replace(/^~/, '')}-o` : safeSeg(o); }
  if (tenant) return safeSeg(`t-${String(tenant)}`);
  return null;
}

/** The target set of a Full Scan, from its (persisted) filters. Sorted + de-duplicated. */
export function runTargets(r: { repoFilter?: string[] | null; giturlFilter?: string[] | null; localFilter?: string[] | null; projectFilter?: string[] | null }, localNames?: Map<string, { sourceId: string; name: string }>): string[] {
  const out = new Set<string>();
  for (const f of r.repoFilter ?? []) out.add(`gh:${String(f).toLowerCase()}@default`);
  for (const f of r.giturlFilter ?? []) out.add(`url:${String(f).toLowerCase()}@default`);
  for (const p of r.localFilter ?? []) { const n = localNames?.get(p); out.add(n ? `local:${n.sourceId}:${n.name}` : `local:${p}`); }
  for (const p of r.projectFilter ?? []) out.add(`gcp:${p}`);
  return [...out].sort();
}
export function targetKeyFor(targets: string[]): string { return sha(JSON.stringify([...new Set(targets)].sort())); }

// ── registry hashes ──────────────────────────────────────────────────────────────────────────────────────────────────
// A stable serialization of a spec object: functions by source text, RegExps by source, keys sorted — so a changed
// playbook, lens, metric library or triage function changes the hash, and nothing else does.
function stable(v: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof v === 'function') return `fn:${v.toString()}`;
  if (v instanceof RegExp) return `re:${v.source}/${v.flags}`;
  if (Array.isArray(v)) return v.map((x) => stable(x, seen));
  if (v && typeof v === 'object') {
    if (seen.has(v as object)) return '[cycle]';
    seen.add(v as object);
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = stable((v as Record<string, unknown>)[k], seen);
    return o;
  }
  return v;
}
export function specHash(v: unknown): string { return sha(JSON.stringify(stable(v))); }

// ── code / prompt revision ──
// The bundle + invariant specs are only part of what shapes a lane's output: the PROMPTS and parsing live in these
// modules' source, and the model is picked by env. Their source text (read once per process) + every *MODEL* env var
// fold into `codeHash`, so a prompt / code change (or a model switch) invalidates automatic reuse instead of replaying
// verdicts the current code would not produce. Deterministic: same files + same env ⇒ same hash; a missing file hashes
// as `missing`.
export const PROMPT_MODULES = ['research/critique.ts', 'research/deep.ts', 'research/investigation.ts', 'research/claimAudit.ts', 'research/comprehend.ts', 'research/experts.ts', 'research/domainBundles.ts', 'research/patterns.ts', 'research/invariants.ts', 'research/preflight.ts', 'research/incrReverify.ts', 'research/capabilities.ts'];
export function codeRevisionHash(sources: { name: string; text: string | null }[], env: Record<string, string | undefined>): string {
  const models = Object.keys(env).filter((k) => /MODEL/.test(k) && env[k]).sort().map((k) => [k, env[k]]);
  return sha(JSON.stringify([...sources].sort((a, b) => a.name.localeCompare(b.name)).map((s) => [s.name, s.text == null ? 'missing' : sha(s.text)]).concat([['models', JSON.stringify(models)]])));
}
function readPromptSources(): { name: string; text: string | null }[] {
  return PROMPT_MODULES.map((name) => { let text: string | null = null; try { text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'); } catch { /* missing */ } return { name, text }; });
}

export interface RegistryHashes { bundleHashes: Record<string, string>; invariantHash: string; codeHash: string; registryHash: string }
let registryMemo: RegistryHashes | null = null;
/** Per-bundle + invariant-registry + code-revision hashes of the RUNNING code (memoized: static per process). */
export function registryHashes(): RegistryHashes {
  if (registryMemo) return registryMemo;
  const bundleHashes: Record<string, string> = {};
  for (const b of EXPERT_BUNDLES) bundleHashes[b.id] = specHash(b);
  const invariantHash = specHash(ALL_INVARIANTS);
  const codeHash = codeRevisionHash(readPromptSources(), process.env);
  registryMemo = { bundleHashes, invariantHash, codeHash, registryHash: sha(JSON.stringify([bundleHashes, invariantHash, codeHash])) };
  return registryMemo;
}

export function briefHashOf(brief: string | undefined | null): string { return sha(String(brief ?? '').replace(/\s+/g, ' ').trim()); }
/**
 * The lane-global inputs fingerprint (proposal §6 "a compared inputsFp"): a lane re-runs when any of these changed.
 * `memoryVersion`: the org-memory generation the run pinned for its push / recall (execMemoryBrief) when
 * memory recall was ON — the cards are prompt context, so new memory ⇒ not the same inputs. null / undefined (recall
 * off or unavailable) leaves the signature exactly as before.
 */
export function inputsSigOf(r: { brief?: string | null; useMemory?: boolean; codeintel?: boolean }, memoryVersion?: number | null): string {
  return sha(JSON.stringify([briefHashOf(r.brief), r.useMemory !== false, r.codeintel !== false, ...(memoryVersion != null ? [`mem:${memoryVersion}`] : [])]));
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function lineagePath(orgKey: string, targetKey: string): string { return join(dataDir(), 'lineage', safeSeg(orgKey), safeSeg(targetKey) + '.json'); }
function readFile(orgKey: string, targetKey: string): LineageFile | null {
  try {
    const f = JSON.parse(readFileSync(lineagePath(orgKey, targetKey), 'utf8')) as LineageFile;
    if (f?.v !== 1 || !Array.isArray(f.entries)) return null;
    // Defense-in-depth: the file must belong to the org whose directory we opened.
    if (f.orgKey !== safeSeg(orgKey)) return null;
    return f;
  } catch { return null; }
}

/** The lineage entries of one target in one org, newest first. */
export function listLineage(orgKey: string, targetKey: string): LineageEntry[] {
  const f = readFile(orgKey, targetKey);
  return f ? [...f.entries].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)) : [];
}

// ── concurrent writers ──
// Every read-modify-write here is SYNCHRONOUS, so within one server process it cannot interleave with another (the
// event loop runs it to completion) — the console is a single process. What can race is a SECOND PROCESS on the
// same data dir (a local CLI run): `withFileLock` serializes those with an O_EXCL lock file
// (stale after LOCK_STALE_MS — a crashed holder never wedges the store), the read happens INSIDE the lock (so the write
// merges the latest on-disk state), and the temp file is unique per writer (pid + random) so two writers can never
// rename each other's half-written temp. A multi-instance deployment with a non-POSIX shared volume needs a database.
const LOCK_STALE_MS = 30_000, LOCK_WAIT_MS = 3_000;
const LOCK_BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const sleepSync = (ms: number): void => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* spin-free fallback: no wait */ } };
export function withFileLock<T>(p: string, fn: () => T): T {
  const lock = p + '.lock';
  mkdirSync(dirname(p), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | null = null;
  while (fd == null) {
    try { fd = openSync(lock, 'wx'); }
    catch (e) {
      // Windows: a lock file another writer is deleting refuses a new open with EPERM / EACCES until the delete lands.
      if (!LOCK_BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      if (Date.now() > deadline) throw new Error(`${basename(p)} is locked by another writer`);
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); continue; } } catch { /* gone or mid-delete: retry */ }
      sleepSync(5);
    }
  }
  try { return fn(); }
  finally { try { closeSync(fd); } catch { /* ignore */ } try { unlinkSync(lock); } catch { /* ignore */ } }
}
/** Atomic JSON write via a writer-unique temp file + rename. */
export function writeJsonAtomic(p: string, v: unknown): void {
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(v, null, 1));
    // Windows: a rename over a file another process briefly holds open fails with EPERM / EACCES / EBUSY; retry briefly.
    for (let i = 0; ; i++) {
      try { renameSync(tmp, p); break; }
      catch (e) { if (i >= 20 || !LOCK_BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e; sleepSync(25); }
    }
  } catch (e) { try { unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

/** Record one completed run (fail-open, but a failure is LOGGED). Keeps the newest LINEAGE_KEEP entries; a re-record of the same runId replaces it. */
export function recordLineage(orgKey: string, targetKey: string, entry: LineageEntry): boolean {
  try {
    const p = lineagePath(orgKey, targetKey);
    withFileLock(p, () => {
      const cur = readFile(orgKey, targetKey);
      const entries = [entry, ...(cur?.entries ?? []).filter((e) => e.runId !== entry.runId)]
        .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, LINEAGE_KEEP);
      const file: LineageFile = { v: 1, orgKey: safeSeg(orgKey), targetKey: safeSeg(targetKey), targets: entry.targets, entries };
      writeJsonAtomic(p, file);
    });
    return true;
  } catch (e) { console.warn(`[lineage] could not record ${entry.runId} (${e instanceof Error ? e.message : String(e)})`); return false; }
}

export interface BaselineChoice { entry: LineageEntry | null; reason: string }
/**
 * The baseline for a new run of `targetKey` in `orgKey`: the newest complete entry with equal checkpoint stage versions
 * and a `findings` cut, whose run still exists (`runExists`, when given — a trashed / purged run has no sidecars). The
 * reason says why there is none (shown in the config summary line and the run log).
 */
export function selectBaseline(orgKey: string, targetKey: string, opts: { runExists?: (runId: string) => boolean; excludeRunId?: string } = {}): BaselineChoice {
  const all = listLineage(orgKey, targetKey).filter((e) => e.runId !== opts.excludeRunId);
  if (!all.length) return { entry: null, reason: 'no earlier completed Full Scan of this exact target set in this org' };
  const cur = JSON.stringify(CKPT_STAGE_VERSION);
  let why = '';
  for (const e of all) {
    if (e.status !== 'complete') { why ||= `${e.runId} did not complete`; continue; }
    if (JSON.stringify(e.stageVersions) !== cur) { why ||= `${e.runId}'s checkpoints use older stage versions`; continue; }
    if (!e.cuts.includes('findings')) { why ||= `${e.runId} has no findings checkpoint`; continue; }
    if (opts.runExists && !opts.runExists(e.runId)) { why ||= `${e.runId} is no longer available (trashed or purged)`; continue; }
    return { entry: e, reason: `baseline ${e.runId} (${e.finishedAt.slice(0, 10)})` };
  }
  return { entry: null, reason: `no usable baseline — ${why}` };
}
