// Durable state for the console — zero-dependency JSON persistence so the server
// survives restarts (sessions, connections, run history) and can point
// THERESA_DATA_DIR at a mounted volume. Reports are
// large HTML, so they live as individual files, not inside the state blob.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, statSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.THERESA_DATA_DIR || join(process.cwd(), '.data');
const REPORTS = join(DIR, 'reports');
const STATE = join(DIR, 'state.json');

// The data-dir base (THERESA_DATA_DIR; /data in the Docker image) — for the org-scoped stores that live
// beside reports/ (lineage/, org-findings/: src/scanLineage.ts, src/orgFindings.ts). Resolved once at load, like DIR.
export function dataDir(): string { return DIR; }

// The data dir holds run history, reports and chats (code-derived content), so on POSIX it is private to the current
// user (0700; state and chats are written 0600). On Windows it inherits the parent folder's ACL — under the user
// profile by default, which is already private to that user.
export function ensureStore(): void {
  mkdirSync(REPORTS, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') { try { chmodSync(DIR, 0o700); } catch { /* not the owner: leave as is */ } }
}

export function loadState(): any {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; }
}

// state.json's last-modified time in epoch-ms (0 if it doesn't exist / can't stat). Used ONLY by the boot
// reconcile to detect a concurrent writer (another revision advancing state during a rolling deploy) between the
// fresh re-read and the reconcile write-back, so restore() can SKIP its save rather than clobber newer state.
export function stateMtimeMs(): number {
  try { return statSync(STATE).mtimeMs; } catch { return 0; }
}

// Atomic write (tmp + rename) so a crash mid-write never corrupts state.
export function saveState(state: unknown): void {
  try {
    const tmp = STATE + '.tmp';
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, STATE);
  } catch (e) {
    // best-effort; never crash the request path on a save failure — but a SILENT failure makes the
    // durable state lag memory invisibly (a restart then resurrects the stale copy: lost logs, lost
    // checkpoint index rows). Log it so a lagging state.json is diagnosable from the server log.
    console.log(JSON.stringify({ severity: 'WARNING', component: 'store', event: 'save-state-failed', error: e instanceof Error ? e.message : String(e) }));
  }
}

// Chat conversations for the report chat assistant — a single JSON blob (small: text only, no large HTML),
// atomic-written like state.json so a restart keeps the user's report Q&A history.
const CHATS = join(DIR, 'chats.json');
export function loadChats(): any { try { return JSON.parse(readFileSync(CHATS, 'utf8')); } catch { return null; } }
export function saveChats(blob: unknown): void {
  try { const tmp = CHATS + '.tmp'; writeFileSync(tmp, JSON.stringify(blob), { mode: 0o600 }); renameSync(tmp, CHATS); } catch { /* best-effort */ }
}

export function saveReport(runId: string, html: string): void {
  const name = runId.replace(/[^\w-]/g, '') + '.html';
  try { writeFileSync(join(REPORTS, name), html); reportList?.names.add(name); } catch { /* best-effort */ }
}

// /api/state asks "does <id>[-kind].html exist?" up to eight times per run. On a network-mounted data dir every existsSync
// is a round trip, so ~60 runs cost ~5 s per page load. One directory listing, cached briefly, answers them
// all: this process's own saves / deletes keep it current, and the TTL picks up a file another process (e.g. a CLI run)
// wrote. An unreadable directory falls back to existsSync.
const REPORT_LIST_TTL_MS = 15_000;
let reportList: { at: number; names: Set<string> } | null = null;
function reportNames(): Set<string> | null {
  const now = Date.now();
  if (reportList && now - reportList.at < REPORT_LIST_TTL_MS) return reportList.names;
  try { reportList = { at: now, names: new Set(readdirSync(REPORTS)) }; } catch { reportList = null; }
  return reportList?.names ?? null;
}

// The on-disk path of a stored report HTML (`<base>.html`, the SAME name saveReport/loadReport use) — for callers that
// only need metadata (e.g. the reading-time word count, which stats + memoizes instead of re-reading every request).
export function reportHtmlPath(base: string): string {
  return join(REPORTS, base.replace(/[^\w-]/g, '') + '.html');
}

export function loadReport(runId: string): string | null {
  try { return readFileSync(join(REPORTS, runId.replace(/[^\w-]/g, '') + '.html'), 'utf8'); } catch { return null; }
}

// Cheap existence check (existsSync — no read), used to flag whether a run has a second report
// (e.g. `<id>-leadership`) without loading it. Keeps the /api/state listing light.
export function reportExists(runId: string): boolean {
  const name = runId.replace(/[^\w-]/g, '') + '.html';
  const names = reportNames();
  if (names) return names.has(name);
  try { return existsSync(join(REPORTS, name)); } catch { return false; }
}

// Path for a NON-html run artifact in the SAME report store (e.g. the audit-log JSONL sidecar
// `<id>-audit.jsonl`). REPORTS stays private; the audit recorder writes to this path incrementally
// and the run-end render reads it back. `suffix` is caller-controlled (not user input), e.g. 'audit.jsonl'.
export function reportArtifactPath(runId: string, suffix: string): string {
  return join(REPORTS, runId.replace(/[^\w-]/g, '') + '-' + suffix);
}

// Permanently delete a stored report (or a suffixed sidecar report, e.g. deleteReport(id,'leadership') →
// `<id>-leadership.html`). Mirrors saveReport's filename convention. Best-effort; a missing file is fine.
export function deleteReport(runId: string, suffix?: string): void {
  const base = (suffix ? runId + '-' + suffix : runId).replace(/[^\w-]/g, '');
  try { rmSync(join(REPORTS, base + '.html'), { force: true }); reportList?.names.delete(base + '.html'); } catch { /* best-effort */ }
}
// Permanently delete a NON-html sidecar artifact (e.g. the audit JSONL at reportArtifactPath(id,'audit.jsonl')).
export function deleteArtifact(runId: string, suffix: string): void {
  try { rmSync(reportArtifactPath(runId, suffix), { force: true }); } catch { /* best-effort */ }
}
