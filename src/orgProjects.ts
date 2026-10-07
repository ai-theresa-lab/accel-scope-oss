// orgProjects.ts — the per-org PROJECT REGISTRY.
//
//   <THERESA_DATA_DIR>/org-projects/<orgKey>/projects.json → { v, orgKey, updated, projects: OrgProject[] }
//
// A repo is not a project: a project can span repos, and a monorepo can hold several projects (by path prefix). The
// registry is what the cross-project features key on — fact cards (orgFacts.ts), the org findings store's projectId
// (orgFindings.ts), sibling CONTRAST recall (siblingRecall.ts) and the Memory tab's Compare view.
//
//   • DEFAULT: one project per repo, AUTO-created from every COMPLETED agentic Full Scan's targets (registerRunProjects).
//     The auto projectId is DETERMINISTIC — `p-<hash(repoKey)>` — so a run can name its own project before the
//     registry file exists (sibling recall runs mid-scan) and a re-created registry gets the same ids back.
//   • repoKey: `github:<owner>/<repo>` for BOTH a GitHub-source repo and a public github.com URL (the same code, two ways
//     in), `local:<sourceId>:<folder>` for a local folder. GCP projects are data planes, not code, and are not projects.
//   • The user can rename / merge / split / create through POST /api/org/projects (applyProjectOp). A repo belongs to one
//     project, EXCEPT a monorepo split by path: then every project that holds the repo names its own path prefixes.
//
// STORAGE DECISION: local JSON under THERESA_DATA_DIR, org-scoped by directory exactly like scanLineage.ts /
// orgFindings.ts. The exported functions are the storage seam: a later move to a database swaps readFile/writeFile only.
// ISOLATION: orgKey = the frozen run.orgId / the session's acting org (never a request field); every path is built from
// sanitized segments (safeSeg) and a file is accepted only when its recorded orgKey equals the directory's. Fail-open:
// reads return empty, writes swallow errors (a registry failure never breaks a run).
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './store.ts';
import { safeSeg, withFileLock, writeJsonAtomic } from './scanLineage.ts';

export interface OrgProject {
  projectId: string;
  name: string;
  repos: string[];           // repoKeys (github:owner/repo · local:<srcId>:<folder>)
  paths?: string[];          // monorepo split: repo-relative path prefixes this project owns (applies to every repo)
  owners?: string[];
  auto: boolean;             // created by a scan (true) vs by the user (false)
  createdAt: string;
  updatedAt: string;
  mergedFrom?: string[];     // project ids folded into this one (so an old id still resolves)
}
interface ProjectsFile { v: 1; orgKey: string; updated: string; projects: OrgProject[] }

const NAME_MAX = 80;
const PROJECTS_MAX = 2000;
const h = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** The deterministic auto-project id of one repo. */
export function autoProjectId(repoKey: string): string { return `p-${h(repoKey.toLowerCase())}`; }

/** A lineage target (scanLineage.runTargets) → its repoKey, or null for a non-code target (gcp:). */
export function repoKeyOfTarget(target: string): string | null {
  const t = String(target ?? '');
  const m = /^(gh|url):(.+?)(@[^@]*)?$/.exec(t);
  if (m) return `github:${m[2].toLowerCase()}`;
  if (t.startsWith('local:')) return t;
  return null;
}
/** A workspace repo (owner/name) → its repoKey. */
export function repoKeyOfFullName(fullName: string): string { return `github:${String(fullName ?? '').toLowerCase()}`; }
/** A readable default name for a repoKey. */
export function defaultProjectName(repoKey: string): string {
  if (repoKey.startsWith('github:')) return repoKey.slice(7);
  if (repoKey.startsWith('local:')) return repoKey.split(':').slice(2).join(':') || repoKey;
  return repoKey;
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function filePath(orgKey: string): string { return join(dataDir(), 'org-projects', safeSeg(orgKey), 'projects.json'); }
function readFile(orgKey: string): ProjectsFile | null {
  try {
    const f = JSON.parse(readFileSync(filePath(orgKey), 'utf8')) as ProjectsFile;
    if (f?.v !== 1 || !Array.isArray(f.projects) || f.orgKey !== safeSeg(orgKey)) return null;
    return f;
  } catch { return null; }
}
function writeFile(orgKey: string, projects: OrgProject[], at: string): void {
  const file: ProjectsFile = { v: 1, orgKey: safeSeg(orgKey), updated: at, projects: projects.slice(0, PROJECTS_MAX) };
  writeJsonAtomic(filePath(orgKey), file);
}
/**
 * Read-modify-write the registry under scanLineage.withFileLock (deploy prep): the read happens INSIDE the lock so a
 * second process (e.g. a CLI run finishing while the console applies a user edit) merges on the latest
 * on-disk state, and writeJsonAtomic's writer-unique temp name means two writers never rename each other's temp.
 * `fn` returns the new list (persisted) or null (nothing to write). Throws when the lock cannot be taken.
 */
function updateRegistry<T>(orgKey: string, at: string, fn: (cur: OrgProject[]) => { projects: OrgProject[] | null; out: T }): T {
  return withFileLock(filePath(orgKey), () => {
    const r = fn(readFile(orgKey)?.projects ?? []);
    if (r.projects) writeFile(orgKey, r.projects, at);
    return r.out;
  });
}

/** Every project of an org (registered only — an unscanned repo has none yet). */
export function listProjects(orgKey: string): OrgProject[] { return readFile(orgKey)?.projects ?? []; }
export function getProject(orgKey: string, projectId: string): OrgProject | undefined {
  return listProjects(orgKey).find((p) => p.projectId === projectId || (p.mergedFrom ?? []).includes(projectId));
}

const normPath = (p: string): string => String(p ?? '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
/**
 * The project a (repo, path) belongs to: a project holding the repo whose path prefix matches (longest wins), else the
 * one holding the repo with no paths, else the repo's AUTO id (unregistered yet). Pure over the given list.
 */
export function resolveProjectIn(projects: OrgProject[], repoKey: string, path?: string): string {
  const rk = repoKey.toLowerCase();
  const holders = projects.filter((p) => p.repos.some((r) => r.toLowerCase() === rk));
  const rel = path ? normPath(path) : '';
  let best: { id: string; len: number } | null = null;
  for (const p of holders) for (const pre of p.paths ?? []) {
    const n = normPath(pre);
    if (n && rel && (rel === n || rel.startsWith(n + '/')) && (!best || n.length > best.len)) best = { id: p.projectId, len: n.length };
  }
  if (best) return best.id;
  const whole = holders.find((p) => !(p.paths ?? []).length);
  return whole?.projectId ?? holders[0]?.projectId ?? autoProjectId(repoKey);
}
export function resolveProject(orgKey: string, repoKey: string, path?: string): string { return resolveProjectIn(listProjects(orgKey), repoKey, path); }
/** projectId → display name (registered name, else the auto default for an auto id we can map back). */
export function projectNameOf(projects: OrgProject[], projectId: string, fallbackRepoKey?: string): string {
  const p = projects.find((x) => x.projectId === projectId || (x.mergedFrom ?? []).includes(projectId));
  return p?.name ?? (fallbackRepoKey ? defaultProjectName(fallbackRepoKey) : projectId);
}

/**
 * Register the repos a COMPLETED run scanned: each repoKey not held by any project gets its auto project (one per repo).
 * Existing assignments (a user merge / split / rename) are never touched. Returns repoKey → projectId.
 */
export function registerRunProjects(orgKey: string, repoKeys: string[], at: string = new Date().toISOString()): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    updateRegistry(orgKey, at, (cur) => {
      let changed = false;
      for (const rk0 of [...new Set(repoKeys.filter(Boolean))]) {
        const rk = rk0.startsWith('github:') ? rk0.toLowerCase() : rk0;
        if (!cur.some((p) => p.repos.some((r) => r.toLowerCase() === rk.toLowerCase()))) {
          const id = autoProjectId(rk);
          const clash = cur.find((p) => p.projectId === id);
          if (clash) clash.repos.push(rk);   // an emptied auto project reclaimed by its repo
          else cur.push({ projectId: id, name: defaultProjectName(rk), repos: [rk], auto: true, createdAt: at, updatedAt: at });
          changed = true;
        }
        out[rk0] = resolveProjectIn(cur, rk);
      }
      return { projects: changed ? cur : null, out: undefined };
    });
  } catch (e) { console.warn(`[projects] could not register run projects (${e instanceof Error ? e.message : String(e)})`); }
  return out;
}

// ── user operations ──────────────────────────────────────────────────────────────────────────────────────────────
export type ProjectOp =
  | { op: 'create'; name: string; repos: string[]; paths?: string[]; owners?: string[] }
  | { op: 'rename'; projectId: string; name: string }
  | { op: 'update'; projectId: string; owners?: string[]; paths?: string[] }
  | { op: 'merge'; projectIds: string[]; name?: string }
  | { op: 'split'; projectId: string; parts: { name: string; repos?: string[]; paths?: string[] }[] };

const cleanName = (s: unknown): string => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const cleanList = (v: unknown, max = 50, len = 200): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, len)).filter(Boolean))].slice(0, max) : []);
const isRepoKey = (s: string): boolean => /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) || /^local:[^:]+:.+$/.test(s);

/** Validate an untrusted request body into a ProjectOp (never reads an org field — the org comes from the session). */
export function parseProjectOp(body: unknown): { ok: true; op: ProjectOp } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const op = String(b.op ?? '');
  const reposOf = (v: unknown): string[] | { error: string } => {
    const r = cleanList(v).map((x) => (x.startsWith('github:') ? x.toLowerCase() : x));
    const bad = r.filter((x) => !isRepoKey(x));
    return bad.length ? { error: `not a repo key: ${bad.slice(0, 3).join(', ')} (use github:<owner>/<repo> or local:<source>:<folder>)` } : r;
  };
  if (op === 'create') {
    const name = cleanName(b.name); if (!name) return { ok: false, error: 'name is required' };
    const repos = reposOf(b.repos); if (!Array.isArray(repos)) return { ok: false, error: repos.error };
    if (!repos.length) return { ok: false, error: 'a project needs at least one repo' };
    return { ok: true, op: { op, name, repos, ...(Array.isArray(b.paths) ? { paths: cleanList(b.paths).map(normPath).filter(Boolean) } : {}), ...(Array.isArray(b.owners) ? { owners: cleanList(b.owners) } : {}) } };
  }
  if (op === 'rename') {
    const name = cleanName(b.name); const projectId = String(b.projectId ?? '');
    if (!projectId || !name) return { ok: false, error: 'projectId and name are required' };
    return { ok: true, op: { op, projectId, name } };
  }
  if (op === 'update') {
    const projectId = String(b.projectId ?? ''); if (!projectId) return { ok: false, error: 'projectId is required' };
    return { ok: true, op: { op, projectId, ...(Array.isArray(b.owners) ? { owners: cleanList(b.owners) } : {}), ...(Array.isArray(b.paths) ? { paths: cleanList(b.paths).map(normPath).filter(Boolean) } : {}) } };
  }
  if (op === 'merge') {
    const projectIds = cleanList(b.projectIds, 50, 64);
    if (projectIds.length < 2) return { ok: false, error: 'merge needs at least two projectIds' };
    return { ok: true, op: { op, projectIds, ...(cleanName(b.name) ? { name: cleanName(b.name) } : {}) } };
  }
  if (op === 'split') {
    const projectId = String(b.projectId ?? ''); if (!projectId) return { ok: false, error: 'projectId is required' };
    const partsIn = Array.isArray(b.parts) ? b.parts.slice(0, 20) : [];
    if (partsIn.length < 2) return { ok: false, error: 'split needs at least two parts' };
    const parts: { name: string; repos?: string[]; paths?: string[] }[] = [];
    for (const p of partsIn) {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const name = cleanName(o.name); if (!name) return { ok: false, error: 'every part needs a name' };
      const repos = o.repos === undefined ? undefined : reposOf(o.repos);
      if (repos && !Array.isArray(repos)) return { ok: false, error: repos.error };
      parts.push({ name, ...(repos ? { repos } : {}), ...(Array.isArray(o.paths) ? { paths: cleanList(o.paths).map(normPath).filter(Boolean) } : {}) });
    }
    return { ok: true, op: { op, projectId, parts } };
  }
  return { ok: false, error: 'op must be one of create / rename / update / merge / split' };
}

/**
 * Apply one user operation to an org's registry (pure over the current list + `at`; the caller persists).
 * Invariant kept: a repo is held by one project unless every holder names path prefixes (a monorepo split).
 */
export function applyProjectOpTo(projects: OrgProject[], op: ProjectOp, at: string): { ok: true; projects: OrgProject[]; projectIds: string[] } | { ok: false; error: string } {
  const list = projects.map((p) => ({ ...p, repos: [...p.repos], ...(p.paths ? { paths: [...p.paths] } : {}) }));
  const find = (id: string) => list.find((p) => p.projectId === id || (p.mergedFrom ?? []).includes(id));
  const takeRepos = (repos: string[], except?: string) => {
    for (const p of list) if (p.projectId !== except && !(p.paths ?? []).length) p.repos = p.repos.filter((r) => !repos.some((x) => x.toLowerCase() === r.toLowerCase()));
  };
  const dropEmpty = () => { for (let i = list.length - 1; i >= 0; i--) if (!list[i].repos.length) list.splice(i, 1); };
  switch (op.op) {
    case 'create': {
      const id = `p-${randomBytes(6).toString('hex')}`;
      if (!(op.paths ?? []).length) takeRepos(op.repos);
      list.push({ projectId: id, name: op.name, repos: op.repos, ...(op.paths?.length ? { paths: op.paths } : {}), ...(op.owners?.length ? { owners: op.owners } : {}), auto: false, createdAt: at, updatedAt: at });
      dropEmpty();
      return { ok: true, projects: list, projectIds: [id] };
    }
    case 'rename': {
      const p = find(op.projectId); if (!p) return { ok: false, error: 'project not found' };
      p.name = op.name; p.updatedAt = at;
      return { ok: true, projects: list, projectIds: [p.projectId] };
    }
    case 'update': {
      const p = find(op.projectId); if (!p) return { ok: false, error: 'project not found' };
      if (op.owners) { if (op.owners.length) p.owners = op.owners; else delete p.owners; }
      if (op.paths) { if (op.paths.length) p.paths = op.paths; else { delete p.paths; takeRepos(p.repos, p.projectId); } }
      p.updatedAt = at;
      return { ok: true, projects: list, projectIds: [p.projectId] };
    }
    case 'merge': {
      const ps = op.projectIds.map(find);
      if (ps.some((p) => !p)) return { ok: false, error: 'project not found' };
      const uniq = [...new Set(ps as OrgProject[])];
      if (uniq.length < 2) return { ok: false, error: 'merge needs two different projects' };
      const [into, ...rest] = uniq;
      into.repos = [...new Set([...into.repos, ...rest.flatMap((p) => p.repos)])];
      into.mergedFrom = [...new Set([...(into.mergedFrom ?? []), ...rest.flatMap((p) => [p.projectId, ...(p.mergedFrom ?? [])])])];
      // A merge of whole-repo projects stays whole-repo; path prefixes survive only when every part had them.
      if (uniq.every((p) => (p.paths ?? []).length)) into.paths = [...new Set(uniq.flatMap((p) => p.paths ?? []))]; else delete into.paths;
      into.name = op.name ?? into.name; into.auto = false; into.updatedAt = at;
      const gone = new Set(rest.map((p) => p.projectId));
      return { ok: true, projects: list.filter((p) => !gone.has(p.projectId)), projectIds: [into.projectId] };
    }
    case 'split': {
      const src = find(op.projectId); if (!src) return { ok: false, error: 'project not found' };
      const ids: string[] = [];
      const parts = op.parts.map((pt, i) => {
        const repos = pt.repos ?? src.repos;
        const bad = repos.filter((r) => !src.repos.some((x) => x.toLowerCase() === r.toLowerCase()));
        return { pt, repos, bad, id: i === 0 ? src.projectId : `p-${randomBytes(6).toString('hex')}` };
      });
      const bad = parts.flatMap((p) => p.bad);
      if (bad.length) return { ok: false, error: `a part names a repo the project does not hold: ${bad.slice(0, 3).join(', ')}` };
      // A repo in more than one part must be split by path in every part that holds it.
      for (const r of src.repos) {
        const holders = parts.filter((p) => p.repos.some((x) => x.toLowerCase() === r.toLowerCase()));
        if (holders.length > 1 && holders.some((p) => !(p.pt.paths ?? []).length)) return { ok: false, error: `${r} is in more than one part — give each of those parts its path prefixes (a monorepo split)` };
      }
      const out = list.filter((p) => p.projectId !== src.projectId);
      for (const p of parts) {
        ids.push(p.id);
        out.push({ projectId: p.id, name: p.pt.name, repos: p.repos, ...(p.pt.paths?.length ? { paths: p.pt.paths } : {}), ...(src.owners?.length ? { owners: src.owners } : {}), auto: false, createdAt: p.id === src.projectId ? src.createdAt : at, updatedAt: at, ...(p.id === src.projectId && src.mergedFrom ? { mergedFrom: src.mergedFrom } : {}) });
      }
      return { ok: true, projects: out, projectIds: ids };
    }
  }
}

/** Apply + persist one user operation (org from the SESSION, never the body). */
export function applyProjectOp(orgKey: string, op: ProjectOp, at: string = new Date().toISOString()): { ok: true; projects: OrgProject[]; projectIds: string[] } | { ok: false; error: string } {
  try {
    return updateRegistry(orgKey, at, (cur) => {
      const r = applyProjectOpTo(cur, op, at);
      return { projects: r.ok ? r.projects : null, out: r };
    });
  } catch { return { ok: false, error: 'the project registry could not be saved' }; }
}
