// workspaceAccess.ts — why a selected code target did NOT make it into the run workspace.
//
// WHY. A run whose every selected repo failed to clone reported "Nothing analyzed — select at least one repository,
// folder, or GCP project." — telling a user who HAD selected 9 repos to select one. The real cause (the clone
// credential could not see them: git's 401/404, dropped by the clone loop) never reached the run. The workspace
// builder now records every unreachable target with its reason, and the terminal message is built from that record.
// PURE (unit-tested); the git probing itself lives in ../github.ts (probeRepoAccess / gitFailureReason).
import type { GhRepo } from '../github.ts';

export interface UnreachableTarget { name: string; reason: string; kind?: 'repo' | 'folder' }

// The selected GitHub repos resolved against the source's listing. A selected fullName the listing does not carry
// (the listing was refreshed with a narrower credential since the form was filled, or the profile's repo set
// changed) used to be dropped SILENTLY by a bare `.filter`; it is now reported as unreachable with that reason.
export function resolveSelectedRepos(listed: GhRepo[], selected: string[]): { targets: GhRepo[]; notListed: UnreachableTarget[] } {
  const byName = new Map(listed.map((r) => [r.fullName, r]));
  const targets: GhRepo[] = []; const notListed: UnreachableTarget[] = [];
  for (const name of [...new Set(selected)]) {
    const r = byName.get(name);
    if (r) targets.push(r);
    else notListed.push({ name, kind: 'repo', reason: "not in the connected GitHub source's repo list — reconnect GitHub or reload the org profile" });
  }
  return { targets, notListed };
}

// Record the pre-flight outcome ON the source's repo listing ("or is marked cloneable:false per repo"), so the
// picker can show which listed repos the clone credential cannot actually reach instead of letting the user tick
// them again. Mutates the given repo objects (the caller passes the workspace's live listing + the run's snapshot).
// Reachable repos are marked true (clears a stale false from an earlier failed probe).
export function markCloneable(repos: GhRepo[] | undefined, outcome: Map<string, string | null>): number {
  let marked = 0;
  for (const r of repos ?? []) {
    if (!outcome.has(r.fullName)) continue;
    const reason = outcome.get(r.fullName);
    r.cloneable = reason == null;
    if (reason == null) delete r.cloneError; else r.cloneError = reason;
    marked++;
  }
  return marked;
}

// The terminal "nothing analyzed" message. With unreachable targets on record it names them and why — never the
// misleading "select at least one repository"; with none (a genuinely empty workspace) it keeps the old wording.
export function nothingAnalyzedMessage(unreachable: UnreachableTarget[]): string {
  if (!unreachable.length) return 'Nothing analyzed — select at least one repository, folder, or GCP project.';
  const shown = unreachable.slice(0, 5).map((u) => `${u.name} (${u.reason})`).join('; ');
  const more = unreachable.length > 5 ? `; … and ${unreachable.length - 5} more (see the run log)` : '';
  const noun = unreachable.every((u) => u.kind !== 'folder') ? 'repo(s)' : unreachable.every((u) => u.kind === 'folder') ? 'folder(s)' : 'repo(s)/folder(s)';
  return `Nothing analyzed — could not access ${unreachable.length} selected ${noun}: ${shown}${more}`;
}
