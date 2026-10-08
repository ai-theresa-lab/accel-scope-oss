// Checkpoint / resume for the agentic org run.
//
// A checkpoint is a SELF-CONSISTENT cut of the pipeline: a small JSON payload on disk
// (next to the run's report sidecars) + a metadata row on the Run record. The parallel
// bundle phase is modeled as a MONOTONE FRONTIER identified by the SET of completed
// bundles (not a count) — lanes are independent until the barrier, so any subset is a
// consistent cut. No checkpoints INSIDE a lane: the Expert measure + area-report
// authoring share one persistent Claude session that cannot be re-attached after a
// process restart.
//
// Writes are FAIL-OPEN (a checkpoint failure never affects the run); resume validation
// is FAIL-CLOSED (a checkpoint that doesn't validate is not offered / not accepted).
// Payloads carry structured node outputs only — NEVER credentials.

import { writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { reportArtifactPath } from './store.ts';
import { redactJson } from './research/reportEvidence.ts';

export type CkptId =
  | 'workspace'    // inputs + workspace manifest (repos @ pinned SHAs)
  | 'comprehend'   // classification + activated bundles + org map
  | 'frontier'     // completed-bundle SET (updated per lane; subsumed by 'barrier')
  | 'barrier'      // all lanes complete (full perBundle)
  | 'claim-audit'  // audited + re-verified claims
  | 'synthesis'    // cross-bundle synthesis (post synthesis-claim-audit)
  | 'findings'     // findings + gaps + answer-back (the iteration anchor)
  | 'reports'      // leadership + per-bundle area reports saved
  | 'reconciled'   // post-reconcile report state (reconcile edits files in place)
  | 'combined';    // normalizer shipped (terminal — nothing downstream to resume)

export const CKPT_ORDER: CkptId[] = ['workspace', 'comprehend', 'frontier', 'barrier', 'claim-audit', 'synthesis', 'findings', 'reports', 'reconciled', 'combined'];
export function ckptRank(id: CkptId): number { return CKPT_ORDER.indexOf(id); }

// Bump a stage's version whenever its payload shape changes — resume is fail-closed on a mismatch.
// comprehend v2: + planeKinds (the measure-plane kinds mounted when the parent classified/measured —
// enforced on resume so a re-running lane can't silently degrade to code-only).
export const CKPT_STAGE_VERSION: Record<CkptId, number> = {
  workspace: 1, comprehend: 2, frontier: 1, barrier: 1, 'claim-audit': 1,
  synthesis: 1, findings: 1, reports: 1, reconciled: 1, combined: 1,
};

// One cloned repo, pinned: resume re-clones and checks out `sha` so the child run sees
// the exact code the parent measured (cloneRepo never recorded the SHA before this).
export interface WorkspaceRepoPin { fullName: string; cloneUrl: string; branch?: string; sha?: string; dir: string; public?: boolean; }
// `public: true` marks a giturl (public github.com URL, no-auth) pin — resume MUST re-clone it
// TOKENLESS even if a GitHub source with a PAT/App token is also connected in the resumed session
// (a public-URL scan must never silently gain elevated read access on resume).
// Local folders carry a CHEAP fingerprint (file count + total bytes) so a resume can detect —
// and loudly warn about — a folder that changed since the parent measured it (a
// faithful archive is future work). `hash` is a CONTENT hash over the sorted
// (relative path, size, sha256 of the bytes) of every file: a same-size edit changes it, where count + bytes do not.
// The copy's mtimes are the copy time, so they cannot stand in for content. Bounded: past DIR_HASH_MAX_BYTES /
// DIR_HASH_MAX_FILES the hash is omitted (undefined) — the incremental planner then treats the folder as changed.
export interface WorkspaceLocalPin { path: string; name: string; files?: number; bytes?: number; hash?: string; }
export interface WorkspaceManifest { repos: WorkspaceRepoPin[]; localDirs: WorkspaceLocalPin[]; }

const DIR_HASH_MAX_BYTES = 512 * 1024 * 1024, DIR_HASH_MAX_FILES = 100_000;
// Cheap recursive fingerprint of a copied workspace folder. Best-effort (undefined on any
// error); bounded by the copy itself having just walked the same tree.
export function dirFingerprint(dir: string, lim: { maxBytes?: number; maxFiles?: number } = {}): { files: number; bytes: number; hash?: string } | undefined {
  try {
    let files = 0, bytes = 0;
    const entries: { rel: string; p: string; size: number }[] = [];
    const walk = (d: string, rel: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p, r);
        else if (e.isFile()) { files++; let size = -1; try { size = statSync(p).size; bytes += size; } catch { /* count only */ } entries.push({ rel: r, p, size }); }
      }
    };
    walk(dir, '');
    const maxBytes = lim.maxBytes ?? DIR_HASH_MAX_BYTES, maxFiles = lim.maxFiles ?? DIR_HASH_MAX_FILES;
    if (bytes > maxBytes || files > maxFiles) return { files, bytes };
    const h = createHash('sha256');
    try {
      for (const e of entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
        h.update(`${e.rel}|${e.size}|`).update(createHash('sha256').update(readFileSync(e.p)).digest('hex')).update(';');
      }
    } catch { return { files, bytes }; }
    return { files, bytes, hash: h.digest('hex').slice(0, 32) };
  } catch { return undefined; }
}

export interface CkptMeta {
  id: CkptId;
  at: string;                 // ISO capture time
  bytes: number;              // payload file size (display)
  stageVersion: number;       // CKPT_STAGE_VERSION at capture — fail-closed on mismatch
  producerGitSha?: string;    // Waggle code version at capture — mismatch ⇒ 'code_changed' (allowed; the iteration case)
  label: string;              // display ("Bundle frontier · 2/3")
  detail?: string;            // display sub ("recsys-mle ✓ · baseline ✓ · data-eng lost")
  bundlesDone?: string[];     // frontier/barrier: the completed-bundle SET — the identity of the cut
  spentUsd?: number;          // ledger.spent() at capture → the child's "reused from parent" display
}

interface CkptFile { v: 1; runId: string; meta: CkptMeta; inputsFp: string; payload: unknown; }

function ckptPath(runId: string, id: CkptId): string { return reportArtifactPath(runId, `ckpt-${id}.json`); }

// The running Waggle code version (memoized). Undefined when not a git checkout
// (e.g. a container image built without .git) — compat then rests on stage versions alone.
let gitShaCache: string | undefined | null = null;
export function producerGitSha(): string | undefined {
  if (gitShaCache !== null) return gitShaCache;
  try {
    // stderr ignored: the deploy image has no .git, where git's "fatal: not a git repository" is the expected answer.
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: process.cwd(), timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: process.cwd(), timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '+dirty' : '';
    gitShaCache = sha ? sha + dirty : undefined;
  } catch { gitShaCache = undefined; }
  return gitShaCache;
}

// Inputs fingerprint — a resume pins the child's inputs to the parent's, so this exists to
// detect on-disk payloads that no longer belong to the run record claiming them (defensive).
export function inputsFingerprint(inputs: unknown): string {
  return createHash('sha256').update(JSON.stringify(inputs ?? null)).digest('hex').slice(0, 16);
}

// Write one checkpoint payload (fail-open). Returns the meta row to keep on the Run
// record, or null when the write failed (the run continues either way).
export function writeCheckpoint(
  runId: string, id: CkptId, payload: unknown, inputsFp: string,
  display: { label: string; detail?: string; bundlesDone?: string[]; spentUsd?: number },
): CkptMeta | null {
  try {
    const meta: CkptMeta = {
      id, at: new Date().toISOString(), bytes: 0,
      stageVersion: CKPT_STAGE_VERSION[id], producerGitSha: producerGitSha(),
      label: display.label, detail: display.detail, bundlesDone: display.bundlesDone,
      spentUsd: display.spentUsd != null ? Number(display.spentUsd.toFixed(2)) : undefined,
    };
    const file: CkptFile = { v: 1, runId, meta, inputsFp, payload };
    const p = ckptPath(runId, id);
    // SECRET-REDACT the whole sidecar before it touches disk: lane snapshots carry raw
    // hypothesis/trace/report text that the RENDER path redacts but a JSON sidecar otherwise would
    // not. redactJson redacts each STRING LEAF — redacting the serialized text let a k=v rule swallow
    // JSON structure and left the checkpoint unparseable (resume then had nothing to reuse).
    writeFileSync(p, redactJson(file));
    try { meta.bytes = statSync(p).size; } catch { /* display-only */ }
    return meta;
  } catch { return null; }
}

// Load one checkpoint payload. Fail-closed: any read/parse/shape problem ⇒ null.
export function loadCheckpoint(runId: string, id: CkptId): { meta: CkptMeta; payload: any } | null {
  try {
    const file = JSON.parse(readFileSync(ckptPath(runId, id), 'utf8')) as CkptFile;
    if (file?.v !== 1 || file.runId !== runId || file.meta?.id !== id) return null;
    return { meta: file.meta, payload: file.payload };
  } catch { return null; }
}

// HEAD SHA of a just-cloned repo (workspace-manifest pin). Sync + bounded: one exec per
// clone, on the run's own worker path. Undefined on any failure (the pin is best-effort;
// a pin-less repo resumes at HEAD with a logged warning instead of failing the resume).
export function gitHeadSha(dir: string): string | undefined {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 5000 }).toString().trim() || undefined; } catch { return undefined; }
}
// Detached checkout of a pinned SHA in a resume-rebuilt clone. False on failure (e.g. the
// SHA was force-pushed away) — the caller logs and keeps HEAD rather than failing the run.
export function gitCheckoutSha(dir: string, sha: string): boolean {
  try { execFileSync('git', ['-C', dir, 'checkout', '--detach', '--quiet', sha], { timeout: 30_000 }); return true; } catch { return false; }
}

export type CkptCompat = { status: 'ok' | 'code_changed' | 'incompatible'; why?: string };

// Compatibility of a stored checkpoint against the CURRENTLY RUNNING code.
//  - stage-schema mismatch / unreadable file ⇒ incompatible (fail-closed)
//  - producer git SHA differs ⇒ code_changed (allowed — that IS the iteration-reuse case)
export function checkpointCompat(runId: string, meta: CkptMeta): CkptCompat {
  if (meta.stageVersion !== CKPT_STAGE_VERSION[meta.id]) {
    return { status: 'incompatible', why: `stage schema v${meta.stageVersion} → v${CKPT_STAGE_VERSION[meta.id]}` };
  }
  if (!loadCheckpoint(runId, meta.id)) return { status: 'incompatible', why: 'checkpoint payload missing or unreadable' };
  const cur = producerGitSha();
  if (meta.producerGitSha && cur && meta.producerGitSha !== cur) {
    return { status: 'code_changed', why: `produced by ${meta.producerGitSha}, running ${cur}` };
  }
  return { status: 'ok' };
}

// ── Index self-heal (the pure half of server.ts effectiveCheckpoints) ────────────────────────
// Merge the run record's checkpoint INDEX with the on-disk sidecar metas (the sidecars are the
// source of truth — see effectiveCheckpoints). `onDisk` is null when the run isn't checkpoint-
// eligible (no disk reads). 'barrier' subsumes 'frontier'; rows come back in rank order.
//
// `changed` compares the merged rows against the index NORMALIZED the same way (frontier dropped
// under a barrier, rank-sorted). The old check flagged a change whenever an on-disk
// cut was missing from the index — but a run past the barrier still has its 'frontier' sidecar on
// disk while the healed index (correctly) drops it, so EVERY read re-"healed" and logged
// "◆ checkpoint index healed from disk" again (5+ identical lines in a row). Now a
// read that adopts nothing new reports no change.
export function healCheckpointIndex(index: CkptMeta[], onDisk: ((id: CkptId) => CkptMeta | undefined) | null): { rows: CkptMeta[]; changed: boolean } {
  const normalize = (m: Map<CkptId, CkptMeta>): CkptMeta[] => {
    if (m.has('barrier')) m.delete('frontier');
    return [...m.values()].sort((a, b) => ckptRank(a.id) - ckptRank(b.id));
  };
  const before = normalize(new Map(index.map((c) => [c.id, c])));
  const byId = new Map(index.map((c) => [c.id, c]));
  if (onDisk) {
    for (const id of CKPT_ORDER) {
      // The on-disk meta wins even when an index row EXISTS — a lagged index can be STALE, not just missing.
      const meta = onDisk(id);
      if (meta) byId.set(id, meta);
    }
  }
  const rows = normalize(byId);
  return { rows, changed: JSON.stringify(rows) !== JSON.stringify(before) };
}

// The heal log line, or null when it would repeat the run's LAST log line verbatim (coalesce
// consecutive identical heal lines — one per heal event, never a burst).
export function checkpointHealLogLine(rows: number, lastLogLine: string | undefined): string | null {
  const line = `◆ checkpoint index healed from disk — ${rows} cut(s) (the run record had lagged)`;
  return lastLogLine === line ? null : line;
}
