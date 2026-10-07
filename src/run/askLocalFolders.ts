// askLocalFolders.ts — the Quick Ask's EXPLICIT local-folder scope (connected / browser-uploaded folders).
//
// Quick Ask scope is explicit (no repo ticked ⇒ no code mounted), so a connected local folder is mounted ONLY when the
// ask names it. The picker (GET /api/ask/repos → `local`) lists each folder under an OPAQUE, STABLE id —
// `<sourceId>:<sha1(path)[0..10]>` — never the absolute filesystem path. POST /api/ask sends the ticked ids back in
// `localFolders`; they are validated here against the workspace's connected local source(s) (unknown id / non-array ⇒ 400,
// absent ⇒ none), stored on the run as ids, and resolved back to paths at staging time (resolveAskRoot), so a folder
// disconnected between create and run is skipped rather than read from a stale path.
//
// PURE (no server state) so the gate is unit-tested.
import { createHash } from 'node:crypto';
import type { Source } from '../server.ts';

export interface AskLocalFolder { id: string; name: string; path: string; uploadedAt?: string; count?: number }

export function askLocalFolderId(sourceId: string, path: string): string {
  return `${sourceId}:${createHash('sha1').update(path).digest('hex').slice(0, 10)}`;
}

// Every connected local folder the ask could mount (server-side view — carries `path`; strip it before sending).
export function askLocalFolderChoices(sources: Pick<Source, 'id' | 'kind' | 'localRepos'>[]): AskLocalFolder[] {
  const out: AskLocalFolder[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.kind !== 'local') continue;
    for (const r of s.localRepos ?? []) {
      const id = askLocalFolderId(s.id, r.path);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: r.name, path: r.path, ...(r.uploadedAt ? { uploadedAt: r.uploadedAt } : {}), ...(r.count != null ? { count: r.count } : {}) });
    }
  }
  return out;
}

// The client view (GET /api/ask/repos `local`): no filesystem path.
export function askLocalFolderList(sources: Pick<Source, 'id' | 'kind' | 'localRepos'>[]): { id: string; name: string; uploadedAt?: string; count?: number }[] {
  return askLocalFolderChoices(sources).map(({ path: _p, ...rest }) => rest);
}

// POST /api/ask body.localFolders — absent/null ⇒ none; not an array ⇒ 400; an id that is not a connected folder ⇒ 400.
export function parseAskLocalFolders(body: Record<string, unknown>, sources: Pick<Source, 'id' | 'kind' | 'localRepos'>[]): { ok: true; ids: string[] } | { ok: false; error: string } {
  const v = body.localFolders;
  if (v === undefined || v === null) return { ok: true, ids: [] };
  if (!Array.isArray(v)) return { ok: false, error: 'localFolders must be an array of folder ids' };
  const known = new Set(askLocalFolderChoices(sources).map((f) => f.id));
  const ids = [...new Set(v.map((x) => String(x)))];
  const bad = ids.filter((id) => !known.has(id));
  if (bad.length) return { ok: false, error: `localFolders: ${bad.slice(0, 5).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a connected folder — reload the page and re-select` };
  return { ok: true, ids };
}

// Staging-time resolution: the selected ids → the folders still connected (in selection order) + the ids now gone.
export function resolveAskLocalFolders(ids: string[], sources: Pick<Source, 'id' | 'kind' | 'localRepos'>[]): { folders: { path: string; name: string }[]; missing: string[] } {
  const byId = new Map(askLocalFolderChoices(sources).map((f) => [f.id, f]));
  const folders: { path: string; name: string }[] = [];
  const missing: string[] = [];
  for (const id of ids) { const f = byId.get(id); if (f) folders.push({ path: f.path, name: f.name }); else missing.push(id); }
  return { folders, missing };
}
