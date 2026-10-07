// degraded.ts — the run's structured DEGRADATION record.
//
// Fail-open stays, but it is no longer silent: any stage that degrades appends one {stage, reason, at} entry to
// `run.degraded`, which the run page shows as a warning banner. This module is the single writer so every stage
// records the same shape; identical (stage, reason) pairs are recorded once, so a stage that degrades on every QC
// round does not flood the banner. PURE (no server state); callers persist through their usual run update path.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface RunDegradation { stage: string; reason: string; at: string }

export function noteDegraded(run: { degraded?: RunDegradation[] }, stage: string, reason: string, now: Date = new Date()): RunDegradation {
  const list = run.degraded ?? (run.degraded = []);
  const dup = list.find((d) => d.stage === stage && d.reason === reason);
  if (dup) return dup;
  const entry = { stage, reason, at: now.toISOString() };
  list.push(entry);
  return entry;
}

// Does the run workspace carry ANY git history? (a repo at the root, or one per top-level dir, as the
// workspace builder lays them out). A browser-uploaded folder never does (the upload sends file contents only), and
// a path-connected local folder may not — the Design & Evolution report is recovered FROM git history, so a run with
// none silently produced no report ("[provenance] no git repos in the workspace — provenance skipped").
export function workspaceHasGitHistory(root: string): boolean {
  try {
    if (existsSync(join(root, '.git'))) return true;
    return readdirSync(root, { withFileTypes: true }).some((d) => d.isDirectory() && existsSync(join(root, d.name, '.git')));
  } catch { return false; }
}

// The start-of-run warning for a ticked Design & Evolution report over a workspace with no git history, or null when there is nothing to warn about. `available` = the deployment gate
// (THERESA_DOC_RECOVERY) — a tick on an instance without it is a different, already-visible condition.
export function designEvolutionWarning(opts: { ticked: boolean; available: boolean; agentic: boolean; hasGitHistory: boolean }): string | null {
  if (!opts.ticked || !opts.available || !opts.agentic || opts.hasGitHistory) return null;
  return 'Design & Evolution report was requested, but no selected target has git history (uploaded or .git-less folders only) — it will not be produced. Select a GitHub / public-URL repo or a local folder with its .git to get it.';
}
