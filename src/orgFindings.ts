// orgFindings.ts — the DURABLE org findings store, keyed by (orgKey, targetKey, findingKey)
// (the cross-project org memory reads this store too).
//
//   <THERESA_DATA_DIR>/org-findings/<orgKey>/<targetKey>.json → { v, orgKey, targetKey, updated, records: OrgFindingRecord[] }
//
// One record per defect identity (findingKey.ts) per target: first seen / last seen (run + date + SHA), the title,
// severity and F-id as of the last run that saw it, and a bounded STATUS HISTORY (new / persisting / changed / fixed /
// ruled-out) — the run-over-run trend. Written at finish for every COMPLETED agentic Full Scan. It is RUN HISTORY, not
// memory: it is NOT gated on the "Draft memory from reports" tick (run.writeMemory), unlike memory.ts mergeLedger (the
// older write-only, tenant-slug-keyed ledger under process.cwd(), which stays exactly as it was). Nothing here primes a
// prompt; it only records what the scans found. Org isolation is by path (orgKey directory) + an orgKey check on read.
// F-ids are POSITIONAL by design (findingIds.assignDisplayIds ranks the whole gated list by severity → confidence →
// order), so a persisting defect's F-id moves whenever a new finding outranks it (or a carried one joins the list):
// `displayId` is the F-id at the LAST run, `firstDisplayId` the one it was first reported under (never rewritten) —
// the stable handle to quote across scans.
// Concurrency: the write runs under scanLineage.withFileLock with a writer-unique temp file — see there.
// Fail-open: reads return empty, writes log + swallow errors.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './store.ts';
import { safeSeg, withFileLock, writeJsonAtomic } from './scanLineage.ts';

export type OrgFindingStatus = 'new' | 'persisting' | 'changed' | 'fixed' | 'ruled-out';
export interface RunStamp { runId: string; at: string; sha?: string }
export interface OrgFindingRecord {
  findingKey: string;
  targetKey: string;
  title: string;
  severity: string;
  bundleId?: string;
  invariant?: string;
  evidencePath?: string;
  displayId?: string;          // the F-id at the last run that saw it (positional — it can move between runs)
  firstDisplayId?: string;     // the F-id it was FIRST reported under — kept for the record's lifetime
  projectId?: string;          // the org project (orgProjects.ts) the finding's evidence belongs to — cross-project memory
  status: OrgFindingStatus;    // as of the latest recorded run
  firstSeen: RunStamp;
  lastSeen: RunStamp;          // the last run that FOUND it (a `fixed` row keeps the run that last saw it open)
  history: { runId: string; at: string; status: OrgFindingStatus }[];   // newest last, bounded
}
interface OrgFindingsFile { v: 1; orgKey: string; targetKey: string; updated: string; records: OrgFindingRecord[] }

const HISTORY_CAP = 24;
function filePath(orgKey: string, targetKey: string): string { return join(dataDir(), 'org-findings', safeSeg(orgKey), safeSeg(targetKey) + '.json'); }
function readStore(orgKey: string, targetKey: string): OrgFindingsFile | null {
  try {
    const f = JSON.parse(readFileSync(filePath(orgKey, targetKey), 'utf8')) as OrgFindingsFile;
    if (f?.v !== 1 || !Array.isArray(f.records) || f.orgKey !== safeSeg(orgKey)) return null;
    return f;
  } catch { return null; }
}

/** Every record of one target in one org. */
export function listTargetFindings(orgKey: string, targetKey: string): OrgFindingRecord[] { return readStore(orgKey, targetKey)?.records ?? []; }
/** Every record of an org, across its targets. */
export function listOrgFindings(orgKey: string): OrgFindingRecord[] {
  let names: string[] = [];
  try { names = readdirSync(join(dataDir(), 'org-findings', safeSeg(orgKey))).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.flatMap((n) => listTargetFindings(orgKey, n.slice(0, -5)));
}
/** Every record of an org that belongs to one project (cross-project memory: precedents, the project's history). */
export function listProjectFindings(orgKey: string, projectId: string): OrgFindingRecord[] { return listOrgFindings(orgKey).filter((r) => r.projectId === projectId); }
/** One record by key. */
export function getOrgFinding(orgKey: string, targetKey: string, findingKey: string): OrgFindingRecord | undefined {
  return listTargetFindings(orgKey, targetKey).find((r) => r.findingKey === findingKey);
}

export interface RunFindingRow {
  findingKey: string; title: string; severity: string; status: OrgFindingStatus;
  bundleId?: string; invariant?: string; evidencePath?: string; displayId?: string;
  /** The org project the row belongs to (orgProjects.resolveProject over its evidence path) — set by the caller at write time. */
  projectId?: string;
  /** For a `fixed` row with no record yet (a baseline recorded before this store existed): the run that last saw it open. */
  prevSeen?: RunStamp;
}
/**
 * Record one completed run: every row the run found (new / persisting / changed / ruled-out) and every baseline row it
 * reported fixed. Rows not mentioned keep their record untouched (an unchecked bundle is not a fix). Idempotent per
 * runId (a re-record of the same run does not duplicate its history entry).
 */
export function recordRunFindings(orgKey: string, targetKey: string, run: RunStamp, rows: RunFindingRow[]): { added: number; updated: number; total: number } {
  try {
    return withFileLock(filePath(orgKey, targetKey), () => recordInner(orgKey, targetKey, run, rows));
  } catch (e) { console.warn(`[org-findings] could not record ${run.runId} (${e instanceof Error ? e.message : String(e)})`); return { added: 0, updated: 0, total: 0 }; }
}
function recordInner(orgKey: string, targetKey: string, run: RunStamp, rows: RunFindingRow[]): { added: number; updated: number; total: number } {
  // Runs INSIDE the lock: the read is the latest on-disk state, so the write merges instead of clobbering.
  const cur = readStore(orgKey, targetKey);
  const byKey = new Map((cur?.records ?? []).map((r) => [r.findingKey, r]));
  let added = 0, updated = 0;
  for (const row of rows) {
    const prev = byKey.get(row.findingKey);
    const hist = { runId: run.runId, at: run.at, status: row.status };
    if (!prev) {
      if (row.status === 'fixed') {
        if (!row.prevSeen) continue;   // nothing to close
        byKey.set(row.findingKey, {
          findingKey: row.findingKey, targetKey, title: row.title, severity: row.severity, ...(row.bundleId ? { bundleId: row.bundleId } : {}),
          ...(row.projectId ? { projectId: row.projectId } : {}),
          status: 'fixed', firstSeen: row.prevSeen, lastSeen: row.prevSeen,
          history: [{ runId: row.prevSeen.runId, at: row.prevSeen.at, status: 'new' }, hist],
        });
        added++;
        continue;
      }
      byKey.set(row.findingKey, {
        findingKey: row.findingKey, targetKey, title: row.title, severity: row.severity,
        ...(row.bundleId ? { bundleId: row.bundleId } : {}), ...(row.invariant ? { invariant: row.invariant } : {}),
        ...(row.evidencePath ? { evidencePath: row.evidencePath } : {}), ...(row.displayId ? { displayId: row.displayId, firstDisplayId: row.displayId } : {}),
        ...(row.projectId ? { projectId: row.projectId } : {}),
        status: row.status, firstSeen: run, lastSeen: run, history: [hist],
      });
      added++;
      continue;
    }
    prev.status = row.status;
    if (row.projectId) prev.projectId = row.projectId;
    if (row.status !== 'fixed') {
      prev.title = row.title; prev.severity = row.severity; prev.lastSeen = run;
      if (row.displayId) prev.displayId = row.displayId; else delete prev.displayId;
      if (row.displayId && !prev.firstDisplayId) prev.firstDisplayId = row.displayId;
      if (row.evidencePath) prev.evidencePath = row.evidencePath;
    }
    prev.history = [...prev.history.filter((x) => x.runId !== run.runId), hist].slice(-HISTORY_CAP);
    updated++;
  }
  const file: OrgFindingsFile = { v: 1, orgKey: safeSeg(orgKey), targetKey: safeSeg(targetKey), updated: run.at, records: [...byKey.values()] };
  writeJsonAtomic(filePath(orgKey, targetKey), file);
  return { added, updated, total: file.records.length };
}
