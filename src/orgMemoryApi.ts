// orgMemoryApi.ts — the console's cross-project org-memory endpoints as PURE handlers (server.ts is a thin wrapper), so
// workspace isolation is unit-tested at the exact seam the server calls.
//
//   GET  /api/org/projects                 → { org, canWrite, projects }
//   POST /api/org/projects  {op, …}        → create / rename / update / merge / split (gated by THERESA_MEMORY_WRITE_ENABLED)
//   GET  /api/org/facts?kind=&project=     → { org, facts, edges, aliases, projects }  (visibility-filtered)
//   GET  /api/org/facts/compare?kind=      → the deterministic Compare matrix (buildCompareMatrix)
//   POST /api/org/aliases {op, a, b}       → propose / confirm / remove an alias (user; gated like every console write)
//
// ISOLATION CONTRACT: every handler takes the orgKey the SERVER derived from the session (scanLineage.orgKeyFor over
// actingOrgId(session) + the session tenant). No handler reads an org / orgKey / orgId from the query string or the body —
// a spoofed `?org=` or `{orgKey: …}` is simply ignored — and the stores open only that org's directory (safeSeg path +
// an orgKey check on read). Writes follow the console memory-write master like /api/memory/save.
// VISIBILITY (§6 project-level visibility): `canSee(fact)` is the server's answer to "can this session's connected
// credential reach the fact's repo" — a fact the viewer cannot see is returned WITHOUT values or evidence (only that a
// project records something for that key, and whether it diverges); the project's name is withheld too. The viewer
// never learns another project's formula, table names or paths through this API.
import { applyProjectOp, listProjects, parseProjectOp, projectNameOf, type OrgProject } from './orgProjects.ts';
import { FACT_KINDS, publicStill, aliasGroups, applyAliasOp, effectiveState, factSummary, listAliases, listEdges, listFacts, parseAliasOp, type FactAlias, type FactCard, type FactEdge } from './orgFacts.ts';
import { permalinkFor, type LinkIndex } from './reportLinks.ts';

export interface ApiResult { status: number; body: unknown }

// ── visibility ─────────────────────────────────────────────────────────────────────────────────────────
/** Can the viewer reach this repo (a fact's repo, or a project's repo)? `public` = a public giturl target. */
export type CanSee = (f: { repo: string; public?: boolean; lastSeen?: string }) => boolean;
/**
 * The projects the viewer may NAME: a project with at least one repo the viewer can see (or a visible public fact).
 * Every other project is only COUNTED — its name and repos can carry customer / repo names.
 */
export function visibleProjects(projects: OrgProject[], canSee: CanSee, facts: FactCard[] = []): { visible: OrgProject[]; restricted: number } {
  const pub = new Set(facts.filter((f) => f.public === true && canSee(f)).map((f) => f.projectId));
  const visible = projects.filter((p) => pub.has(p.projectId) || p.repos.some((r) => canSee({ repo: r })));
  return { visible, restricted: projects.length - visible.length };
}
/** Every repo of the project is visible (a write that MOVES repos needs the whole project). */
const fullyVisible = (p: OrgProject, canSee: CanSee): boolean => p.repos.every((r) => canSee({ repo: r }));
/** A project as the viewer may see it: repos the viewer cannot reach are counted, never named. */
function projectView(p: OrgProject, canSee: CanSee): OrgProject & { hiddenRepos?: number } {
  const repos = p.repos.filter((r) => canSee({ repo: r }));
  return { ...p, repos, ...(repos.length < p.repos.length ? { hiddenRepos: p.repos.length - repos.length } : {}) };
}

// ── console write gate ────────────────────────────────────────────────────────────────────────────────────
/** Who is writing: the deployment master (THERESA_MEMORY_WRITE_ENABLED), the session's org role, and its visibility. */
export interface WriteGate { canWrite: boolean; admin: boolean; canSee: CanSee }
/**
 * The org-memory WRITE role: `platform_admin`, or `org_admin` of the ACTING org — the role the backend returns for
 * GET /api/org-profiles/orgs (orgProfiles.listActingOrgs, the same source as the /api/orgs switcher and the request-queue
 * platform_admin gate). Fail-closed: an unverifiable role (backend unreachable / unconfigured ⇒ null) is NOT an admin.
 */
export function isOrgMemoryAdmin(acting: { role: string; orgs: { id: string }[] } | null | undefined, actingOrgId: string | null | undefined): boolean {
  if (!acting) return false;
  if (acting.role === 'platform_admin') return true;
  return acting.role === 'org_admin' && !!actingOrgId && acting.orgs.some((o) => o.id === actingOrgId);
}
function gateError(g: WriteGate): ApiResult | null {
  if (!g.canWrite) return { status: 403, body: { error: 'memory writes are disabled on this deployment' } };
  if (!g.admin) return { status: 403, body: { error: 'changing org projects or aliases needs the org_admin (or platform_admin) role' } };
  return null;
}

export function getOrgProjects(orgKey: string, canWrite: boolean, canSee: CanSee): ApiResult {
  const { visible, restricted } = visibleProjects(listProjects(orgKey), canSee, listFacts(orgKey));
  return { status: 200, body: { org: orgKey, canWrite, projects: visible.map((p) => projectView(p, canSee)), restrictedProjects: restricted } };
}

/**
 * A user registry write. Beyond the gate: every repo the body NAMES must be visible to the caller, and every
 * project the op touches (by id, or because `create` would take a repo away from it) must be FULLY visible — a write
 * never silently re-homes a repo of a project the caller cannot see (rename needs only a visible project). A project
 * the caller cannot see at all is a 404, exactly like one of another org.
 */
export function postOrgProjects(orgKey: string, body: unknown, gate: WriteGate): ApiResult {
  const denied = gateError(gate); if (denied) return denied;
  const parsed = parseProjectOp(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const op = parsed.op;
  const cur = listProjects(orgKey);
  const byId = (id: string) => cur.find((p) => p.projectId === id || (p.mergedFrom ?? []).includes(id));
  const named = op.op === 'create' ? op.repos : op.op === 'split' ? op.parts.flatMap((p) => p.repos ?? []) : [];
  const unseen = named.filter((r) => !gate.canSee({ repo: r }));
  if (unseen.length) return { status: 403, body: { error: `you cannot see ${unseen.length} of the named repo(s) with your connected credential` } };
  const ids = op.op === 'rename' || op.op === 'update' || op.op === 'split' ? [op.projectId] : op.op === 'merge' ? op.projectIds : [];
  for (const id of ids) {
    const p = byId(id);
    if (!p || !visibleProjects([p], gate.canSee).visible.length) return { status: 404, body: { error: 'project not found' } };
    if (op.op !== 'rename' && !fullyVisible(p, gate.canSee)) return { status: 403, body: { error: `project "${p.name}" holds repos you cannot see — ask an admin who can see all of them` } };
  }
  if (op.op === 'create' && !(op.paths ?? []).length) {
    const lower = new Set(op.repos.map((r) => r.toLowerCase()));
    const blocked = cur.some((p) => !(p.paths ?? []).length && p.repos.some((r) => lower.has(r.toLowerCase())) && !fullyVisible(p, gate.canSee));
    if (blocked) return { status: 403, body: { error: 'a named repo belongs to a project that also holds repos you cannot see — nothing was moved' } };
  }
  const r = applyProjectOp(orgKey, op);
  if (!r.ok) return { status: r.error === 'project not found' ? 404 : 400, body: { error: r.error } };
  return { status: 200, body: { ok: true, projectIds: r.projectIds, projects: visibleProjects(r.projects, gate.canSee).visible.map((p) => projectView(p, gate.canSee)) } };
}

// ── fact cards · Compare · aliases (Phase 2) ─────────────────────────────────────────────────────────────────────────
/** A GitHub permalink for one fact evidence ref (reportLinks.permalinkFor over a one-repo index), or null. */
export function factEvidenceHref(f: FactCard, e: FactCard['evidence'][number]): string | null {
  const sha = e.sha ?? f.sha;
  if (!f.repoFullName || !sha) return null;
  const [owner, repo] = f.repoFullName.split('/');
  if (!owner || !repo) return null;
  const idx: LinkIndex = { v: 1, repos: [{ owner, repo, sha, dir: '', public: f.public === true }], paths: { [e.path]: [0, e.path] } };
  return permalinkFor(idx, `${e.path}${e.line ? `:${e.line}` : ''}`);
}

/** A VISIBLE fact as the viewer sees it (a restricted fact is never returned one by one — only counted). */
export function viewFact(f: FactCard, now: Date = new Date()): Record<string, unknown> {
  const st = effectiveState(f, now);
  return {
    id: f.id, key: f.key, kind: f.kind, projectId: f.projectId, state: st.state, ...(st.reason ? { stateReason: st.reason } : {}), measuredAt: f.measuredAt,
    repo: f.repo, ...(f.repoFullName ? { repoFullName: f.repoFullName } : {}), ...(f.sha ? { sha: f.sha } : {}), runId: f.runId, confidence: f.confidence, source: f.source,
    payload: f.payload, summary: factSummary(f), evidence: evidenceView(f),
  };
}
function evidenceView(f: FactCard): { label: string; href?: string }[] {
  return f.evidence.map((e) => {
    const sha = e.sha ?? f.sha;
    const href = factEvidenceHref(f, e);
    return { label: `${e.path}${e.line ? `:${e.line}` : ''}${sha ? ` @${sha.slice(0, 7)}` : ''}`, ...(href ? { href } : {}) };
  });
}
/** Aliases whose BOTH keys the viewer already sees on a visible fact (an alias names keys). */
function visibleAliases(aliases: FactAlias[], visibleKeys: Set<string>): FactAlias[] {
  return aliases.filter((a) => visibleKeys.has(a.a) && visibleKeys.has(a.b));
}

export interface CompareCell { projectId: string; state: string; divergent: boolean; differs?: boolean; restricted?: boolean; summary?: string; evidence?: { label: string; href?: string }[]; facts: number; key?: string; measuredAt?: string }
export interface CompareRow { key: string; keys: string[]; kind: string; divergent: boolean; fields: string[]; differs?: boolean; diffFields?: string[]; cells: Record<string, CompareCell> }
export interface CompareMatrix { kinds: string[]; kind: string | null; projects: { projectId: string; name: string; restricted: boolean }[]; rows: CompareRow[]; truncated: boolean; totalRows: number; restrictedEntries: number }

/**
 * The deterministic Compare view (§5): rows = entity keys (grouped by CONFIRMED alias), columns = projects, cells = the
 * freshest non-retired VISIBLE fact of that project for the key. A cell is `divergent` when one of its facts has a
 * `contradicts` edge (a definition recorded differently) and `differs` when it has only a neutral `differs` edge (a
 * practice / dependency major). Rows sorted: divergent first, then the number of projects that record the
 * key, then the key. No LLM.
 * VISIBILITY: a fact the viewer cannot see contributes NO key (not the row name, not `keys`, not a cell) —
 * a restricted cell says only "recorded" / "records a different value". A row with no visible cell is dropped and only
 * COUNTED (`restrictedEntries`). A mixed project (one visible + one unreachable repo) shows its VISIBLE facts only.
 */
export function buildCompareMatrix(facts: FactCard[], edges: FactEdge[], aliases: FactAlias[], projects: OrgProject[], canSee: CanSee, opts: { kind?: string | null; now?: Date; maxRows?: number } = {}): CompareMatrix {
  const now = opts.now ?? new Date();
  const kind = opts.kind && (FACT_KINDS as readonly string[]).includes(opts.kind) ? opts.kind : null;
  const groups = aliasGroups(aliases, true);
  const root = (k: string) => groups.get(k) ?? k;
  const live = facts.filter((f) => f.state !== 'retired' && (!kind || f.kind === kind));
  const divergentFields = new Map<string, Set<string>>(), differFields = new Map<string, Set<string>>();
  for (const e of edges) {
    const m = (e.type ?? 'contradicts') === 'contradicts' ? divergentFields : differFields;
    for (const id of [e.a, e.b]) { const s = m.get(id) ?? new Set<string>(); for (const x of e.fields) s.add(x); m.set(id, s); }
  }
  const rowsMap = new Map<string, { kind: string; byProject: Map<string, FactCard[]> }>();
  for (const f of live) {
    const r = `${f.kind}|${root(f.key)}`;
    const row = rowsMap.get(r) ?? { kind: f.kind, byProject: new Map<string, FactCard[]>() };
    const list = row.byProject.get(f.projectId) ?? []; list.push(f); row.byProject.set(f.projectId, list);
    rowsMap.set(r, row);
  }
  const seenProjects = new Map<string, { restricted: boolean; repo: string }>();
  const rows: CompareRow[] = [];
  let restrictedEntries = 0;
  for (const row of rowsMap.values()) {
    const cells: Record<string, CompareCell> = {};
    const fields = new Set<string>(), dfields = new Set<string>();
    const keys = new Set<string>();
    const cellProjects: { pid: string; visible: boolean; repo: string }[] = [];
    for (const [pid, list] of row.byProject) {
      const vis = list.filter((f) => canSee(f));
      const div = list.some((f) => divergentFields.has(f.id));
      const dif = !div && list.some((f) => differFields.has(f.id));
      for (const f of list) { for (const x of divergentFields.get(f.id) ?? []) fields.add(x); for (const x of differFields.get(f.id) ?? []) dfields.add(x); }
      if (vis.length) {
        const best = [...vis].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
        for (const f of vis) keys.add(f.key);
        cells[pid] = { projectId: pid, state: effectiveState(best, now).state, divergent: div, ...(dif ? { differs: true } : {}), summary: factSummary(best), evidence: evidenceView(best), facts: vis.length, key: best.key, measuredAt: best.measuredAt };
      } else {
        cells[pid] = { projectId: pid, state: 'active', divergent: div, ...(dif ? { differs: true } : {}), restricted: true, facts: 0 };
      }
      cellProjects.push({ pid, visible: vis.length > 0, repo: vis[0]?.repo ?? '' });
    }
    if (!keys.size) { restrictedEntries++; continue; }   // nothing on this row the viewer may see: counted, never named
    for (const c of cellProjects) {
      const sp = seenProjects.get(c.pid);
      seenProjects.set(c.pid, { restricted: (sp?.restricted ?? true) && !c.visible, repo: sp?.repo || c.repo });
    }
    const sortedKeys = [...keys].sort();
    const differs = Object.values(cells).some((c) => c.differs);
    rows.push({ key: sortedKeys[0], keys: sortedKeys, kind: row.kind, divergent: Object.values(cells).some((c) => c.divergent), fields: [...fields].sort(), ...(differs ? { differs, diffFields: [...dfields].sort() } : {}), cells });
  }
  rows.sort((a, b) => Number(b.divergent) - Number(a.divergent) || Object.keys(b.cells).length - Object.keys(a.cells).length || a.key.localeCompare(b.key));
  const max = opts.maxRows ?? 400;
  const cols = [...seenProjects.entries()].map(([projectId, v]) => ({ projectId, name: v.restricted ? '' : projectNameOf(projects, projectId, v.repo || undefined), restricted: v.restricted }))
    .sort((a, b) => Number(a.restricted) - Number(b.restricted) || a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId));
  // A restricted project's name is withheld (it can carry a repo name); number them so the columns stay distinct.
  let n = 0; for (const c of cols) if (c.restricted) c.name = `another project ${++n}`;
  return { kinds: [...FACT_KINDS], kind, projects: cols, rows: rows.slice(0, max), truncated: rows.length > max, totalRows: rows.length, restrictedEntries };
}

/**
 * GET /api/org/facts: the VISIBLE facts in full + a COUNT of the restricted ones (no key, no id); an edge
 * between two visible facts in full, one with an unreachable side as `{ a|b: '', restricted }` on the visible fact's key;
 * aliases and projects filtered to what the viewer can already see.
 */
export function getOrgFacts(orgKey: string, q: { kind?: string | null; project?: string | null }, projects: OrgProject[], canSee: CanSee): ApiResult {
  const facts = listFacts(orgKey, { ...(q.kind ? { kind: q.kind } : {}), ...(q.project ? { projectId: q.project } : {}) });
  const vis = facts.filter((f) => canSee(f));
  const byId = new Map(vis.map((f) => [f.id, f]));
  const edges = listEdges(orgKey).filter((e) => byId.has(e.a) || byId.has(e.b)).map((e) => (byId.has(e.a) && byId.has(e.b) ? e
    : { type: e.type, a: byId.has(e.a) ? e.a : '', b: byId.has(e.b) ? e.b : '', key: (byId.get(e.a) ?? byId.get(e.b))!.key, fields: [] as string[], at: e.at, restricted: true }));
  const pv = visibleProjects(projects, canSee, facts);
  return { status: 200, body: {
    org: orgKey, facts: vis.map((f) => viewFact(f)), restrictedFacts: facts.length - vis.length, edges,
    aliases: visibleAliases(listAliases(orgKey), new Set(vis.map((f) => f.key))),
    projects: pv.visible.map((p) => ({ projectId: p.projectId, name: p.name, repos: p.repos.filter((r) => canSee({ repo: r })).length })), restrictedProjects: pv.restricted,
  } };
}

export function getOrgCompare(orgKey: string, q: { kind?: string | null }, projects: OrgProject[], canSee: CanSee, canWrite: boolean): ApiResult {
  const aliases = listAliases(orgKey);
  const facts = listFacts(orgKey);
  const m = buildCompareMatrix(facts, listEdges(orgKey), aliases, projects, canSee, { kind: q.kind ?? null });
  const va = visibleAliases(aliases, new Set(facts.filter((f) => canSee(f)).map((f) => f.key)));
  return { status: 200, body: { org: orgKey, canWrite, ...m, aliases: { confirmed: va.filter((a) => a.state === 'confirmed').map((a) => ({ a: a.a, b: a.b })), proposed: va.filter((a) => a.state === 'proposed').map((a) => ({ a: a.a, b: a.b, by: a.by })) } } };
}

/** A user alias op: a key recorded ONLY by facts the caller cannot see is refused — it names them. */
export function postOrgAliases(orgKey: string, body: unknown, gate: WriteGate): ApiResult {
  const denied = gateError(gate); if (denied) return denied;
  const p = parseAliasOp(body);
  if (!p.ok) return { status: 400, body: { error: p.error } };
  const facts = listFacts(orgKey, { includeRetired: true });
  const visibleKeys = new Set(facts.filter((f) => gate.canSee(f)).map((f) => f.key));
  if ([p.op.a, p.op.b].some((k) => !visibleKeys.has(k) && facts.some((f) => f.key === k))) return { status: 403, body: { error: 'an alias key is recorded only by projects you cannot see' } };
  const next = applyAliasOp(orgKey, p.op, 'operator');
  return { status: 200, body: { ok: true, aliases: visibleAliases(next, visibleKeys) } };
}

/**
 * The console viewer's visibility: a fact is visible when its repo is public (a giturl target), when the session's
 * connected GitHub source LISTS the repo (the listing is what that credential can see; a repo the pre-flight marked
 * `cloneable:false` does not count), when a connected public-URL source carries it, or — for a local folder — when the
 * session has that local source. (A RUN checks with probeRepoAccess and the clone credential instead: siblingRecall.ts.)
 */
export interface SourceLike { kind: string; id: string; repos?: { fullName: string; cloneable?: boolean }[]; giturlRepos?: { fullName: string }[]; localRepos?: { name: string }[] }
export function canSeeFromSources(sources: SourceLike[]): CanSee {
  const gh = new Set<string>(), local = new Set<string>();
  for (const s of sources) {
    if (s.kind === 'github') for (const r of s.repos ?? []) if (r.cloneable !== false) gh.add(r.fullName.toLowerCase());
    if (s.kind === 'giturl') for (const r of s.giturlRepos ?? []) gh.add(r.fullName.toLowerCase());
    if (s.kind === 'local') for (const r of s.localRepos ?? []) local.add(`local:${s.id}:${r.name}`);
  }
  // A stored public flag counts only while fresh (orgFacts.publicStill); a stale one needs a listed repo.
  return (f) => publicStill(f as { public?: boolean; lastSeen?: string }) || (f.repo.startsWith('github:') ? gh.has(f.repo.slice(7).toLowerCase()) : local.has(f.repo));
}
