// crossProject.ts — the RUNTIME glue of cross-project org memory:
// executeOrgRun / orgCritiqueExpert call these at fixed points, and nothing else in the executor knows about projects.
//
//   • workspaceRepos — the run's workspace repos as (dir, repoKey, fullName, public, cloneUrl, sha) rows;
//   • projectResolverFor — dir-prefixed evidence path → org projectId (orgProjects.ts), for the org findings store;
//   • registerCompletedRunProjects — a COMPLETED agentic Full Scan's targets become projects (one per repo by default).
//
// Org scope is the run's FROZEN orgKey (scanLineage.orgKeyFor(run.orgId ?? orgIdForTenant(tenant), tenant)) — the same
// key lineage and the org findings store use. Fail-open everywhere: a failure here logs and never breaks a run.
import type { WorkspaceManifest } from '../checkpoints.ts';
import { listProjects, projectNameOf, registerRunProjects, repoKeyOfFullName, resolveProjectIn } from '../orgProjects.ts';
import { existsSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { applyAliasOp, commitIngest, currentFactState, planIngest, publicStill, type FactCard, type FactSource, type IngestInput, type IngestPlan } from '../orgFacts.ts';
import { FACTS_USD, applyOsvVerdicts, codeintelTableFacts, dependencyFacts, dropsText, factsLlmEnabled, verdictFacts, type FactDrops } from '../factExtract.ts';
import { findingResolvesInWorkspace, type CoverageGap, type Finding } from '../schema.ts';
import { edgesForProjects } from '../orgFacts.ts';
import { findingBundleId, normalizedTitleStem } from '../findingKey.ts';
import type { OrgFindingRecord } from '../orgFindings.ts';
import { codeintelDataLinks } from '../sources/codeintel.ts';
import type { ContrastFact, ContrastHolder } from '../memory/contrast.ts';
import { contrastBlock, currentEntityKeys, newSelectStats, safePath, selectSiblingFacts } from '../siblingRecall.ts';
import { lateStageSkipReason, withRunBudget, type BudgetLedger } from '../research/budget.ts';

export interface WsRepo { dir: string; repoKey: string; fullName?: string; public?: boolean; cloneUrl?: string; sha?: string; sourceId?: string }

/** The workspace's code roots (cloned repos + copied local folders) as repoKeys. `localNames`: source path → {sourceId, name}. */
export function workspaceRepos(manifest: WorkspaceManifest, localNames?: Map<string, { sourceId: string; name: string }>): WsRepo[] {
  const out: WsRepo[] = manifest.repos.map((r) => ({ dir: r.dir, repoKey: repoKeyOfFullName(r.fullName), fullName: r.fullName, ...(r.public ? { public: true } : {}), cloneUrl: r.cloneUrl, ...(r.sha ? { sha: r.sha } : {}) }));
  for (const d of manifest.localDirs) {
    const n = localNames?.get(d.path);
    out.push({ dir: d.name, repoKey: n ? `local:${n.sourceId}:${n.name}` : `local:${d.path}`, ...(n ? { sourceId: n.sourceId } : {}) });
  }
  return out;
}

/** Split a workspace-relative path (`<dir>/<rest>`) into its repo row + the repo-relative rest. */
export function splitWsPath(repos: WsRepo[], path: string | undefined): { repo: WsRepo; rel: string } | null {
  const p = String(path ?? '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
  if (!p) return null;
  const hit = repos.filter((r) => p === r.dir || p.startsWith(r.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0];
  if (hit) return { repo: hit, rel: p === hit.dir ? '' : p.slice(hit.dir.length + 1) };
  // A repo-relative cite in a single-repo workspace belongs to that repo.
  return repos.length === 1 ? { repo: repos[0], rel: p } : null;
}

/**
 * path → projectId for this run's workspace. A path under a repo resolves through the registry (monorepo path prefixes
 * honored); no / an unattributable path resolves only when the whole workspace is ONE project.
 */
export function projectResolverFor(orgKey: string, repos: WsRepo[]): (path?: string) => string | undefined {
  const projects = listProjects(orgKey);
  const all = [...new Set(repos.map((r) => resolveProjectIn(projects, r.repoKey)))];
  return (path?: string) => {
    const s = splitWsPath(repos, path);
    if (s) return resolveProjectIn(projects, s.repo.repoKey, s.rel || undefined);
    return all.length === 1 ? all[0] : undefined;
  };
}

/** The projects this run's workspace covers (registry-resolved, auto id when unregistered). */
export function runProjectIds(orgKey: string, repos: WsRepo[]): string[] {
  const projects = listProjects(orgKey);
  return [...new Set(repos.map((r) => resolveProjectIn(projects, r.repoKey)))];
}

/** A completed run registers its repos as projects (one per repo unless the user already assigned it). Returns count. */
export function registerCompletedRunProjects(orgKey: string, repos: WsRepo[]): number {
  const map = registerRunProjects(orgKey, repos.map((r) => r.repoKey));
  return new Set(Object.values(map)).size;
}

// ── fact cards at run end (src/factExtract.ts + src/orgFacts.ts) ─────────────────────────────────────────────────────
// PREPARE while the workspace exists (before finish — the Leadership "Across your projects" row reads the planned
// edges), COMMIT only once the run is complete. Derived run data like checkpoints / the org findings store: NOT gated on
// run.writeMemory. Fail-open: any failure logs, records a run.degraded row (stage `org-facts`) and the run goes on.

export interface PendingFacts {
  orgKey: string;
  runId: string;
  at: string;
  plan: IngestPlan;          // the PREVIEW (the Leadership row reads its edges); the commit re-plans from `input`
  input: IngestInput;
  aliases: { a: string; b: string }[];
  counts: { deps: number; tables: number; verdict: number; dropped: number; droppedBy?: FactDrops; osv: number };
  costUsd: number;
  llm: 'ran' | 'skipped' | 'failed' | 'off';
  llmWhy?: string;
}

/** Every (projectId, repo) pair the workspace covers — registry holders (monorepo splits) + the resolved default. */
export function scannedPairs(orgKey: string, repos: WsRepo[]): { projectId: string; repo: string }[] {
  const projects = listProjects(orgKey);
  const out = new Map<string, { projectId: string; repo: string }>();
  for (const r of repos) {
    for (const p of projects) if (p.repos.some((x) => x.toLowerCase() === r.repoKey.toLowerCase())) out.set(`${p.projectId}\n${r.repoKey}`, { projectId: p.projectId, repo: r.repoKey });
    const d = resolveProjectIn(projects, r.repoKey);
    out.set(`${d}\n${r.repoKey}`, { projectId: d, repo: r.repoKey });
  }
  return [...out.values()];
}

export async function prepareRunFacts(opts: {
  orgKey: string; runId: string; root: string; repos: WsRepo[]; projectOf: (path?: string) => string | undefined;
  findings: Finding[]; isRuledOut: (f: Finding) => boolean; measuredOf?: (f: Finding) => string | undefined;
  ledger?: BudgetLedger; authToken?: string; log: (m: string) => void; degrade: (reason: string) => void;
  llmCall?: Parameters<typeof verdictFacts>[0]['call'];
}): Promise<PendingFacts | null> {
  try {
    const at = new Date().toISOString();
    const deps = dependencyFacts(opts.root, opts.repos, opts.projectOf);
    const osv = applyOsvVerdicts(deps, opts.findings, opts.isRuledOut, opts.repos);
    const tables = codeintelTableFacts(opts.root, opts.repos, opts.projectOf);
    const sources: FactSource[] = ['manifest', 'osv'];
    // codeintel produced facts only when its contracts index is there — the bare directory is not a scan.
    if (existsSync(pjoin(opts.root, '.repowise-workspace', 'contracts.json'))) sources.push('codeintel');
    let llm: PendingFacts['llm'] = 'off', llmWhy: string | undefined, costUsd = 0;
    let verdict: Awaited<ReturnType<typeof verdictFacts>> = { facts: [], aliases: [], dropped: 0, costUsd: 0 };
    if (factsLlmEnabled() && opts.findings.length) {
      const skip = lateStageSkipReason(opts.ledger, FACTS_USD);
      if (skip) { llm = 'skipped'; llmWhy = skip; }
      else {
        try {
          const go = () => verdictFacts({ root: opts.root, repos: opts.repos, projectOf: opts.projectOf, findings: opts.findings, isRuledOut: opts.isRuledOut, measuredOf: opts.measuredOf, authToken: opts.authToken, maxUsd: FACTS_USD, ...(opts.llmCall ? { call: opts.llmCall } : {}) });
          verdict = opts.ledger ? await withRunBudget(opts.ledger, 'reserve', go) : await go();
          costUsd = verdict.costUsd;
          if (verdict.error) { llm = 'failed'; llmWhy = verdict.error; } else { llm = 'ran'; sources.push('verdict'); }
        } catch (e) { llm = 'failed'; llmWhy = e instanceof Error ? e.message : String(e); }
      }
    }
    if (llm === 'failed') opts.degrade(`fact extraction from the verdicts failed (${String(llmWhy).slice(0, 160)}) — deterministic facts only`);
    // A budget skip is recorded like reconcile / normalize skips: admission is lateStageSkipReason(ledger, FACTS_USD) —
    // the pass never STARTS once the cap is reached, past 0.90·B, or when what is left cannot cover its max ($FACTS_USD,
    // also its SDK maxBudgetUsd), so it never takes a run past its cap.
    if (llm === 'skipped') opts.degrade(`fact extraction from the verdicts skipped — ${llmWhy}; deterministic facts only`);
    const cur = currentFactState(opts.orgKey);
    const inWs = new Map(opts.repos.map((r) => [r.repoKey.toLowerCase(), r]));
    // Answers are cached, and once the workspace is gone an unknown fact is never retired (the commit re-plans later).
    const known = new Map<string, boolean>();
    const evidenceExists = (f: FactCard): boolean => {
      const r = inWs.get(f.repo.toLowerCase());
      if (!r) return true;   // not in this workspace — cannot tell, never retire
      const k = `${f.id}\n${f.evidence.map((e) => e.path).join('\n')}`;
      if (!known.has(k)) { if (!existsSync(opts.root)) return true; known.set(k, f.evidence.some((e) => existsSync(pjoin(opts.root, r.dir, e.path)))); }
      return known.get(k)!;
    };
    const input: IngestInput = { incoming: [...deps, ...tables, ...verdict.facts], run: { runId: opts.runId, at }, scanned: scannedPairs(opts.orgKey, opts.repos), evidenceExists, sources };
    const plan = planIngest(cur.facts, cur.aliases, input.incoming, input.run, input.scanned, input.evidenceExists, input.sources);
    return { orgKey: opts.orgKey, runId: opts.runId, at, plan, input, aliases: verdict.aliases, counts: { deps: deps.length, tables: tables.length, verdict: verdict.facts.length, dropped: verdict.dropped, ...(verdict.droppedBy ? { droppedBy: verdict.droppedBy } : {}), osv }, costUsd, llm, ...(llmWhy ? { llmWhy } : {}) };
  } catch (e) {
    opts.degrade(`fact extraction failed (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

/**
 * Persist a prepared fact set (completed runs only) + the agent-PROPOSED aliases (never confirmed). The commit RE-PLANS
 * against the on-disk state under the store lock (orgFacts.commitIngest), so a run that committed since this
 * run's prepare is merged. Call it while the workspace still exists (the evidence re-check reads it). Returns the log line.
 */
export function commitRunFacts(p: PendingFacts): string {
  const pl = commitIngest(p.orgKey, p.input);
  for (const a of p.aliases.slice(0, 30)) { try { applyAliasOp(p.orgKey, { op: 'propose', a: a.a, b: a.b }, 'agent', p.at, p.runId); } catch { /* fail-open */ } }
  const c = p.counts;
  const conflicts = pl ? pl.edges.filter((e) => e.type === 'contradicts').length : 0;
  return pl
    ? `org facts: ${pl.added} new · ${pl.refreshed} refreshed · ${pl.disputed} disputed · ${pl.retired} retired · ${conflicts} definition conflict edge(s) + ${pl.edges.length - conflicts} neutral difference(s) in the org (dependencies ${c.deps}${c.osv ? `, ${c.osv} with a known advisory` : ''} · tables ${c.tables} · verdict facts ${c.verdict}${c.dropped ? ` (+${c.dropped} dropped: ${dropsText(c.droppedBy) || 'no resolvable evidence / invalid'})` : ''} · verdict pass ${p.llm}${p.costUsd ? ` $${p.costUsd.toFixed(3)}` : ''}${p.aliases.length ? ` · ${p.aliases.length} alias(es) proposed` : ''})`
    : 'org facts: not saved (the fact store could not be written)';
}

// ── Phase 3: sibling CONTRAST recall · cross-project findings · precedents · the Leadership row ──────────────────────
/** Per-probe bound: a sibling access probe is a `git ls-remote`; a slow remote must not stall the run. */
export const ACCESS_PROBE_MS = Math.max(1000, Number(process.env.THERESA_SIBLING_PROBE_MS) || 8000);
/**
 * The per-run repo-access check (§6): a FRESH public flag ⇒ yes (a stale one is re-probed); in this workspace
 * ⇒ yes; a local folder of a source this run has ⇒ yes; a GitHub repo ⇒ `probe(cloneUrl, timeoutMs)` with the run's
 * CLONE credential. Probes are deduped by repo (concurrent callers share one in-flight probe), bounded by ACCESS_PROBE_MS,
 * and a thrown / timed-out probe is NO access. The cache lives only as long as the checker — one run.
 * At most `concurrency` (ACCESS_PROBE_CONCURRENCY, 6 — the clone pre-flight's batch size) probes are in flight at once;
 * the rest queue (their timeout starts when they start). `ignoreStoredPublic` (the PUBLIC-ONLY scope):
 * a fact's stored `public` flag is not trusted at all — only this workspace's repos or a fresh (tokenless) probe count.
 */
export const ACCESS_PROBE_CONCURRENCY = 6;
export function makeAccessChecker(opts: { repos: WsRepo[]; localSourceIds: Set<string>; probe: (cloneUrl: string, timeoutMs: number) => Promise<boolean>; timeoutMs?: number; now?: Date; concurrency?: number; ignoreStoredPublic?: boolean }): (f: { repo: string; repoFullName?: string; public?: boolean; lastSeen?: string }) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>();
  const inWs = new Set(opts.repos.map((r) => r.repoKey.toLowerCase()));
  const ms = opts.timeoutMs ?? ACCESS_PROBE_MS;
  const limit = Math.max(1, Math.floor(opts.concurrency ?? ACCESS_PROBE_CONCURRENCY));
  let active = 0;
  const waiting: (() => void)[] = [];
  const slot = (): Promise<void> => (active < limit ? (active++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => { active++; r(); })));
  const release = (): void => { active--; const next = waiting.shift(); if (next) next(); };
  const once = (url: string): Promise<boolean> => new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    let p: Promise<boolean>;
    try { p = Promise.resolve(opts.probe(url, ms)); } catch { clearTimeout(t); resolve(false); return; }
    p.then((v) => { clearTimeout(t); resolve(v === true); }, () => { clearTimeout(t); resolve(false); });
  });
  const bounded = async (url: string): Promise<boolean> => { await slot(); try { return await once(url); } finally { release(); } };
  return (f) => {
    if (!opts.ignoreStoredPublic && f.public && publicStill(f, opts.now)) return Promise.resolve(true);
    const rk = String(f.repo ?? '').toLowerCase();
    if (inWs.has(rk)) return Promise.resolve(true);
    if (rk.startsWith('local:')) return Promise.resolve(opts.localSourceIds.has(rk.split(':')[1] ?? ''));
    const full = f.repoFullName ?? (rk.startsWith('github:') ? rk.slice(7) : '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return Promise.resolve(false);
    const k = full.toLowerCase();
    if (!cache.has(k)) cache.set(k, bounded(`https://github.com/${full}.git`));
    return cache.get(k)!;
  };
}

/**
 * Comprehend's entity names (KPIs → metric keys, systems → event keys) for sibling recall: the REPLAYED
 * comprehend checkpoint's optional `kpis` / `systems` on a resume / incremental replay (absent on an older parent → []),
 * else the live Comprehend result, else [] (a manual bundle selection skips Comprehend — its keys then come from the
 * manifests, codeintel tables and own facts only). Capped; persisted back into the comprehend checkpoint by the caller.
 */
export function comprehendEntityNames(replayed: unknown, live: { kpis?: string[]; systems?: string[] } | null | undefined): { kpis: string[]; systems: string[] } {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').slice(0, 120)).filter(Boolean).slice(0, 60) : []);
  if (replayed && typeof replayed === 'object') { const r = replayed as { kpis?: unknown; systems?: unknown }; return { kpis: list(r.kpis), systems: list(r.systems) }; }
  return { kpis: list(live?.kpis), systems: list(live?.systems) };
}

/**
 * Build + install the CONTRAST block after Comprehend. Keys = Comprehend KPIs / systems + codeintel tables + this
 * workspace's dependency manifests + this project's own previous facts. Returns the log line ('' when nothing to add).
 */
export async function fillSiblingContrast(opts: {
  holder: ContrastHolder; orgKey: string; root: string; repos: WsRepo[]; comp?: { kpis?: string[]; systems?: string[] } | null;
  canAccess: (f: FactCard) => Promise<boolean>; now?: Date;
  /**
   * PUBLIC-ONLY scope (osvPublicOnly — the OSV advisory plane is auto-mounted and posts to a third party):
   * only sibling facts whose repo is PUBLIC are eligible — `canAccess` must then be the TOKENLESS checker (makeAccessChecker
   * with ignoreStoredPublic: a repo of this all-public workspace, or a bounded tokenless probe). Facts of private repos are removed BEFORE
   * ranking (they cannot crowd out public ones) and no value-free line is ever written (it would reveal a private
   * project's existence).
   */
  publicOnly?: boolean;
}): Promise<string> {
  const projects = listProjects(opts.orgKey);
  const current = new Set(runProjectIds(opts.orgKey, opts.repos));
  const { facts: allFacts, aliases } = currentFactState(opts.orgKey);
  const own = allFacts.filter((f) => current.has(f.projectId));
  let facts = allFacts;
  let pubNote = '';
  if (opts.publicOnly) {
    const others = allFacts.filter((f) => !current.has(f.projectId));
    const ok = await Promise.all(others.map(async (f) => { try { return (await opts.canAccess(f)) === true; } catch { return false; } }));
    const pub = others.filter((_, i) => ok[i]);
    facts = [...own, ...pub];
    // No count of what was left out: how many facts this org holds about non-public repos is itself private.
    pubNote = 'sibling recall: public-only scope — only facts from public repos are eligible · ';
  }
  const projectOf = projectResolverFor(opts.orgKey, opts.repos);
  const liveDeps = dependencyFacts(opts.root, opts.repos, projectOf);
  const depKeys = liveDeps.map((d) => d.key);
  const tables = codeintelDataLinks(opts.root).map((l) => l.table);
  const keys = currentEntityKeys({ kpis: opts.comp?.kpis, systems: opts.comp?.systems, tables, depKeys, ownFacts: own });
  // A dependency's major is compared against THIS run's manifests (first — they win over this project's stored, possibly
  // older, dependency facts): a project scanned for the first time has no stored facts, and without them every shared
  // dependency read as "same major".
  const nowIso = (opts.now ?? new Date()).toISOString();
  const liveCards: FactCard[] = liveDeps.map((d) => ({ ...d, id: `live-${d.key}-${d.repo}`, runId: 'this-run', measuredAt: nowIso, state: 'active', ttlDays: 30, firstSeen: nowIso, lastSeen: nowIso }));
  const stats = newSelectStats();
  const picks = selectSiblingFacts(facts, aliases, { currentProjects: current, keys, ownFacts: [...liveCards, ...own], stats, ...(opts.now ? { now: opts.now } : {}) });
  const nOther = new Set(facts.filter((f) => !current.has(f.projectId)).map((f) => f.projectId)).size;
  const sameMajor = [...stats.sameMajorKeys].filter((k) => !stats.pickedKeys.has(k)).length;
  const skipped = `${sameMajor ? ` · ${sameMajor} shared dependency key(s) identical (same major) skipped` : ''}${stats.inactive ? ` · ${stats.inactive} disputed / retired fact(s) skipped` : ''}`;
  const lead = pubNote ? pubNote : 'sibling recall: ';
  if (!picks.length) {
    const why = !nOther ? `no sibling-project facts yet (no other project in this org has facts${pubNote ? ' from a public repo' : ''})`
      : stats.matchedKeys.size && sameMajor === stats.matchedKeys.size ? `${stats.matchedKeys.size} shared key(s), all identical (same major) — nothing to contrast`
        : stats.matchedKeys.size ? `${stats.matchedKeys.size} shared key(s), none divergent or active — nothing to contrast${skipped}`
          : `no sibling-project facts share an entity with this project${skipped}`;
    return `${lead}${why} (${keys.size} key(s) checked, ${nOther} other project(s) with facts)`;
  }
  const cb = await contrastBlock(picks, (pid, repo) => projectNameOf(projects, pid, repo), opts.canAccess, undefined, { omitRestricted: opts.publicOnly === true });
  opts.holder.block = cb.block;
  opts.holder.facts = cb.facts;
  if (!cb.block) return `${lead}candidate facts found but none fit the CONTRAST budget${opts.publicOnly ? ' / are reachable without a credential' : ''}`;
  const nProj = new Set(cb.facts.map((f) => f.projectId)).size;
  return `${lead}CONTRAST block for Critic + Expert — ${cb.visible} fact(s) with evidence + ${cb.abstracted} value-free line(s) from ${nProj} other project(s) (${keys.size} entity key(s) here, ${stats.matchedKeys.size} shared${skipped}, ${cb.block.length} chars)`;
}

// ── cross-project inconsistency findings (§4) ─────────────────────────────────────────────────────────────────────────
/** Any sibling ref at all (a finding that cites none is untouched). */
const SIBLING_ANY = /sibling:[\w.-]+\/[\w.-]+\//i;
/**
 * The contrast fact evidence entry a finding CITES: for each of the fact's evidence entries, the exact
 * `sibling:<repo>/<path>` the CONTRAST line printed (siblingRecall.siblingRef — same path whitelist), ANCHORED — followed
 * only by an optional `:<line>`, an optional `@<sha>` and then the end / whitespace / closing punctuation — so any path
 * character (parentheses, brackets, `@`, `,` …) is allowed and `a.sql` never matches `a.sql.bak`.
 */
export function citedSiblingEvidence(text: string, c: Pick<ContrastFact, 'repoFullName' | 'repo' | 'evidence'>): { e: ContrastFact['evidence'][number]; ref: string } | null {
  const low = text.toLowerCase();
  const repo = safePath(c.repoFullName ?? c.repo).toLowerCase();
  for (const e of c.evidence) {
    const needle = `sibling:${repo}/${safePath(e.path).toLowerCase()}`;
    for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + 1)) {
      const m = /^(?::(\d+))?(?:@([0-9a-f]{7,40}))?(?=$|\s|[.,;:)\]'"`>]+(?:\s|$))/i.exec(text.slice(i + needle.length));
      if (m) return { e, ref: text.slice(i, i + needle.length + m[0].length) };
    }
  }
  return null;
}
export interface CrossProjectTag { project: string; key: string; ref: string; invariant?: 'i1' | 'i2'; runId?: string }
export interface CrossProjectResult { findings: Finding[]; gaps: CoverageGap[]; tags: Record<string, CrossProjectTag>; demoted: { id: string; gapId: string }[] }
/**
 * Settle the run's cross-project findings. A finding that CITES a sibling fact (the `sibling:<repo>/<path>…` ref the
 * CONTRAST block gave it) stays a finding only when BOTH sides are verified: this project's side by the run's own
 * workspace-resolvable evidence, the sibling side by re-checking the CITED evidence entry — in this
 * workspace when the sibling repo is part of it, else via `recheck` (the GitHub contents API at the fact's SHA with the
 * clone credential). Kept findings are classified i1 (a metric definition) or i2 (cross-source) in `finding.xproj` —
 * NEVER by rewriting `invariant`, which the finding key hashes — and get the sibling evidence as a `doc`
 * ref and an "Across projects" tag; the others become open questions (a CoverageGap) — never silently dropped.
 */
export async function crossProjectFindings(findings: Finding[], contrast: ContrastFact[], opts: { root: string; repos: WsRepo[]; isRuledOut: (f: Finding) => boolean; recheck: (fullName: string, sha: string, path: string) => Promise<boolean>; runId?: string }): Promise<CrossProjectResult> {
  const tags: Record<string, CrossProjectTag> = {};
  const gaps: CoverageGap[] = [];
  const demoted: { id: string; gapId: string }[] = [];
  const out: Finding[] = [];
  const usable = contrast.filter((c) => !c.restricted && c.repoFullName && c.evidence.length);
  for (const f of findings) {
    if (opts.isRuledOut(f) || !usable.length) { out.push(f); continue; }
    const text = [f.title, f.claim, f.recommendation, ...(f.evidence ?? []).flatMap((e) => [e.ref, e.detail])].map((x) => String(x ?? '')).join(' \n ');
    if (!SIBLING_ANY.test(text)) { out.push(f); continue; }
    // Match the cited ref to a contrast fact + the exact evidence entry it cites (same repo + path).
    let hit: { c: ContrastFact; e: ContrastFact['evidence'][number]; ref: string } | null = null;
    for (const c of usable) { const m = citedSiblingEvidence(text, c); if (m) { hit = { c, ...m }; break; } }
    const own = { ...f, evidence: (f.evidence ?? []).filter((e) => !/^\s*sibling:/i.test(String(e.ref ?? ''))) };
    const ownOk = findingResolvesInWorkspace(own, opts.root);
    let sibOk = false;
    if (hit) {
      const e = hit.e;
      const ws = opts.repos.find((r) => r.repoKey.toLowerCase() === hit!.c.repo.toLowerCase());
      if (ws) sibOk = existsSync(pjoin(opts.root, ws.dir, e.path));
      else if (e.sha ?? hit.c.sha) { try { sibOk = await opts.recheck(hit.c.repoFullName!, String(e.sha ?? hit.c.sha), e.path); } catch { sibOk = false; } }
    }
    if (hit && ownOk && sibOk) {
      const e = hit.e;
      const inv: 'i1' | 'i2' = f.invariant === 'i1' || f.invariant === 'i2' ? f.invariant : (hit.c.kind === 'metric-def' ? 'i1' : 'i2');
      const sibEv = { kind: 'doc' as const, ref: `sibling ${hit.c.repoFullName}/${e.path}${e.line ? `:${e.line}` : ''}${(e.sha ?? hit.c.sha) ? ` @${String(e.sha ?? hit.c.sha).slice(0, 7)}` : ''}`, detail: `project "${hit.c.projectName}" — ${hit.c.key} (re-checked this run)` };
      const tag = { project: hit.c.projectName, key: hit.c.key, ref: sibEv.ref, invariant: inv, ...(opts.runId ? { runId: opts.runId } : {}) };
      out.push({ ...own, evidence: [...own.evidence, sibEv], xproj: tag });
      tags[String(f.id)] = tag;
      continue;
    }
    const why = !hit ? 'it cites a sibling project\'s evidence that this run was not given' : !ownOk ? 'this project\'s side has no evidence that resolves in the workspace' : `the sibling side (${hit.c.key} in project "${hit.c.projectName}") could not be re-checked`;
    const gapId = `${String(f.id)}-XPROJ`;
    gaps.push({ id: gapId, concern: String(f.title ?? 'Cross-project inconsistency'), whyUnsettled: `Cross-project inconsistency not settled: ${why}.`, nextDecisiveTest: hit ? `Re-scan with the sibling repo ${hit.c.repoFullName} in the workspace (or reachable by the clone credential) and re-check ${hit.ref}.` : 'Re-run with "Compare with other projects in this org" on, so the sibling fact is recalled and can be re-checked.', source: 'cross-project', status: 'blocked', bundleId: findingBundleId(f), ...(f.invariant ? { invariant: String(f.invariant) } : {}) });
    demoted.push({ id: String(f.id), gapId });
  }
  return { findings: out, gaps, tags, demoted };
}

/**
 * Carried / replayed findings keep their "Across projects" tag: a finding of THIS run that has no tag yet
 * but whose key carried one in the baseline's keyed sidecar gets it back (on the finding + in the returned tag map).
 * Keys are stable across the tag, so the match is exact. Pure. Returns how many were re-applied.
 */
export function reapplyCrossProjectTags(findings: Finding[], keyOf: (f: Finding) => string | undefined, baselineTags: Map<string, CrossProjectTag>, tags: Record<string, CrossProjectTag>): number {
  let n = 0;
  for (const f of findings) {
    if (tags[String(f.id)] || f.xproj) continue;
    const k = keyOf(f);
    const t = k ? baselineTags.get(k) : undefined;
    if (!t) continue;
    const tag = { ...t, invariant: t.invariant ?? 'i2' };
    f.xproj = { invariant: tag.invariant, project: tag.project, key: tag.key, ref: tag.ref, ...(tag.runId ? { runId: tag.runId } : {}) };
    tags[String(f.id)] = tag;
    n++;
  }
  return n;
}

/** GitHub contents API check: does `path` exist in `fullName` at `sha`? (the sibling re-check when its repo is not cloned). */
export async function githubFileAtSha(fullName: string, sha: string, path: string, token?: string): Promise<boolean> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName) || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  const url = `https://api.github.com/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'accel-scope', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: ctl.signal });
    return r.status === 200;
  } catch { return false; } finally { clearTimeout(t); }
}

// ── precedents (§4 "found and fixed in project B") ────────────────────────────────────────────────────────────────────
/** The value-free label of a project the run's clone credential cannot reach. */
export const RESTRICTED_PROJECT_LABEL = 'another project in this org';
/**
 * A precedent. For a project the run cannot reach (label RESTRICTED_PROJECT_LABEL) the run id and the exact date are
 * withheld — `date` is the MONTH only and `restricted` is set: a run id or a day could identify the
 * other project's scan.
 */
export interface Precedent { project: string; date: string; runId?: string; restricted?: boolean; text: string }
const patternOf = (bundleId: string | undefined, invariant: string | undefined, title: string | undefined): string => `${bundleId ?? ''}|${String(invariant ?? '').toLowerCase()}|${normalizedTitleStem(title)}`;
/**
 * The same finding PATTERN (bundle + invariant + normalized title stem) fixed in ANOTHER project of the org (org findings
 * store). Deterministic. `projectLabel` returns the display name (or a value-free label when the run cannot reach that
 * project). The newest fix wins.
 */
export async function precedentsFor(findings: Finding[], records: OrgFindingRecord[], currentProjects: Set<string>, isRuledOut: (f: Finding) => boolean, projectLabel: (projectId: string) => Promise<string>, merged: Map<string, string> = new Map()): Promise<Record<string, Precedent>> {
  const fixed = new Map<string, { rec: OrgFindingRecord; at: string; runId: string }>();
  for (const r0 of records) {
    // A record of a merged-away project belongs to the project it was folded into.
    const r = r0.projectId && merged.has(r0.projectId) ? { ...r0, projectId: merged.get(r0.projectId)! } : r0;
    if (r.status !== 'fixed' || !r.projectId || currentProjects.has(r.projectId)) continue;
    const h = [...r.history].reverse().find((x) => x.status === 'fixed');
    if (!h) continue;
    const k = patternOf(r.bundleId, r.invariant, r.title);
    const prev = fixed.get(k);
    if (!prev || h.at > prev.at) fixed.set(k, { rec: r, at: h.at, runId: h.runId });
  }
  const out: Record<string, Precedent> = {};
  if (!fixed.size) return out;
  const labels = new Map<string, Promise<string>>();
  const labelOf = (pid: string) => { if (!labels.has(pid)) labels.set(pid, projectLabel(pid).catch(() => RESTRICTED_PROJECT_LABEL)); return labels.get(pid)!; };
  const hits = findings.filter((f) => !isRuledOut(f)).map((f) => ({ f, hit: fixed.get(patternOf(findingBundleId(f), f.invariant, f.title)) })).filter((x) => x.hit);
  const names = await Promise.all(hits.map((x) => labelOf(x.hit!.rec.projectId!)));
  hits.forEach(({ f, hit }, i) => {
    const project = names[i];
    if (project === RESTRICTED_PROJECT_LABEL) {
      const month = hit!.at.slice(0, 7);
      out[String(f.id)] = { project, date: month, restricted: true, text: `Precedent: fixed in ${project} in ${month}` };
    } else {
      const date = hit!.at.slice(0, 10);
      out[String(f.id)] = { project, date, runId: hit!.runId, text: `Precedent: fixed in project ${project} on ${date}` };
    }
  });
  return out;
}

/**
 * The Leadership "Across your projects" inputs: cross-project findings (ids) + the DEFINITION conflicts touching this
 * project. Only `contradicts` edges count (a practice / dependency-major difference is not a conflicting definition),
 * and `edges` counts distinct KEYS, not edge pairs — three sibling projects disagreeing on metric:dau are one
 * definition recorded differently.
 */
export function acrossProjectsInfo(tags: Record<string, CrossProjectTag>, pending: PendingFacts | null, currentProjects: Set<string>, projectLabel: (pid: string) => string): { findingIds: string[]; projects: string[]; edges: number; keys: string[] } | null {
  const edges = pending ? edgesForProjects(pending.plan.facts, pending.plan.edges, currentProjects, 'contradicts') : [];
  const ids = Object.keys(tags);
  if (!ids.length && !edges.length) return null;
  const projects = [...new Set([...Object.values(tags).map((t) => t.project), ...edges.map((e) => projectLabel(e.other.projectId))])];
  const keys = [...new Set(edges.map((e) => e.edge.key))];
  return { findingIds: ids, projects, edges: keys.length, keys: keys.slice(0, 6) };
}
