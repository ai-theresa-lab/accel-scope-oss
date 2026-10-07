import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Console visibility + write gating of the cross-project org-memory API. store.ts resolves
// THERESA_DATA_DIR at module load, so the modules are imported after the env is set.
const dir = mkdtempSync(join(tmpdir(), 'orgmemapi-'));
process.env.THERESA_DATA_DIR = dir;
const F = await import('./orgFacts.ts');
const P = await import('./orgProjects.ts');
const API = await import('./orgMemoryApi.ts');

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

const AT = '2026-09-20T00:00:00.000Z';
const sha = 'c'.repeat(40);
const fact = (key: string, kind: import('./orgFacts.ts').FactKind, projectId: string, repo: string, payload: Record<string, unknown>, at = AT): import('./orgFacts.ts').NewFact =>
  ({ key, kind, projectId, repo, repoFullName: repo.slice(7), sha, confidence: 'high', source: 'verdict', payload, evidence: [{ path: 'm.sql', line: 1 }] });

/**
 * org_vis: project "app" (acme/app, visible) · project "secret" (acme/secret, NOT visible) · project "mixed" holding
 * acme/mixed-a (visible) + acme/mixed-b (NOT visible), with a NEWER fact on the invisible repo.
 */
function seed(org: string): { app: string; secret: string; mixed: string } {
  const app = 'p-app', secret = 'p-secret', mixed = 'p-mixed';
  const p1 = F.planIngest([], [], [
    fact('metric:dau', 'metric-def', app, 'github:acme/app', { name: 'dau', formula: 'count(distinct user_id)' }),
    fact('metric:dau', 'metric-def', secret, 'github:acme/secret', { name: 'dau', formula: 'count(distinct device_id)' }),
    fact('table:secret_billing.invoices', 'table-contract', secret, 'github:acme/secret', { table: 'secret_billing.invoices', freshnessSla: '1h' }),
    fact('metric:secret_margin', 'metric-def', secret, 'github:acme/secret', { name: 'secret margin', formula: 'rev - cost' }),
    fact('metric:revenue', 'metric-def', mixed, 'github:acme/mixed-a', { name: 'revenue', formula: 'sum(visible_amount)' }),
  ], { runId: 'rs_1', at: '2026-09-01T00:00:00.000Z' }, [], () => true, ['verdict']);
  // The invisible repo of the mixed project records a NEWER revenue fact.
  const p2 = F.planIngest(p1.facts, [], [fact('metric:revenue', 'metric-def', mixed, 'github:acme/mixed-b', { name: 'revenue', formula: 'sum(hidden_amount_b)' })], { runId: 'rs_2', at: AT }, [], () => true, ['verdict']);
  F.commitFacts(org, p2, AT);
  // Aliases: one between two visible keys, one joining a visible key with a key only the secret project records.
  F.applyAliasOp(org, { op: 'propose', a: 'metric:dau', b: 'metric:revenue' }, 'agent', AT);
  F.applyAliasOp(org, { op: 'propose', a: 'metric:dau', b: 'metric:secret_margin' }, 'agent', AT);
  const ok = (r: ReturnType<typeof P.applyProjectOp>) => { assert.ok(r.ok); return r; };
  ok(P.applyProjectOp(org, { op: 'create', name: 'app', repos: ['github:acme/app'] }));
  ok(P.applyProjectOp(org, { op: 'create', name: 'Secret Customer X', repos: ['github:acme/secret'] }));
  ok(P.applyProjectOp(org, { op: 'create', name: 'mixed', repos: ['github:acme/mixed-a', 'github:acme/mixed-b'] }));
  return { app, secret, mixed };
}
const canSee: import('./orgMemoryApi.ts').CanSee = (f) => f.repo === 'github:acme/app' || f.repo === 'github:acme/mixed-a';
const LEAKS = ['secret_billing', 'secret_margin', 'device_id', 'hidden_amount_b', 'acme/secret', 'mixed-b', 'Secret Customer X'];

test('Compare: a restricted fact contributes no key; all-restricted rows are dropped and only counted', () => {
  const org = 'org_vis';
  seed(org);
  const m = API.getOrgCompare(org, {}, P.listProjects(org), canSee, false).body as import('./orgMemoryApi.ts').CompareMatrix & { aliases: { proposed: { a: string; b: string }[] } };
  const json = JSON.stringify(m);
  for (const leak of LEAKS) assert.ok(!json.includes(leak), `Compare leaked ${leak}`);
  assert.deepEqual(m.rows.map((r) => r.key).sort(), ['metric:dau', 'metric:revenue']);
  assert.equal(m.restrictedEntries, 2, 'the secret table + the secret metric are counted, never named');
  const dau = m.rows.find((r) => r.key === 'metric:dau')!;
  const cell = Object.values(dau.cells).find((c) => c.restricted)!;
  assert.ok(cell && cell.key === undefined && cell.summary === undefined && cell.evidence === undefined, 'a restricted cell carries no key / value / evidence');
  assert.deepEqual(dau.keys, ['metric:dau']);
  // Aliases: only pairs of visible keys.
  assert.deepEqual(m.aliases.proposed.map((a) => `${a.a}~${a.b}`), ['metric:dau~metric:revenue']);
  // The rendered client view says how many are hidden, without names.
  assert.ok(m.projects.some((p) => p.restricted && /^another project \d$/.test(p.name)));
});

test('Compare: a mixed-visibility project shows its VISIBLE repo\'s fact, never the newer unreachable one', () => {
  const org = 'org_vis';
  const m = API.buildCompareMatrix(F.listFacts(org), F.listEdges(org), F.listAliases(org), P.listProjects(org), canSee);
  const rev = m.rows.find((r) => r.key === 'metric:revenue')!;
  const cell = rev.cells['p-mixed'];
  assert.ok(!cell.restricted);
  assert.match(cell.summary!, /visible_amount/);
  assert.equal(cell.facts, 1, 'only the visible fact is counted in the cell');
  // With full access the newest (mixed-b) wins.
  const all = API.buildCompareMatrix(F.listFacts(org), F.listEdges(org), [], P.listProjects(org), () => true);
  assert.match(all.rows.find((r) => r.key === 'metric:revenue')!.cells['p-mixed'].summary!, /hidden_amount_b/);
});

test('GET /api/org/facts + /api/org/projects: restricted facts / projects counted, never listed', () => {
  const org = 'org_vis';
  const facts = API.getOrgFacts(org, {}, P.listProjects(org), canSee).body as { facts: { key: string }[]; restrictedFacts: number; edges: { a: string; b: string; key: string; restricted?: boolean }[]; aliases: unknown[]; projects: { name: string; repos: number }[]; restrictedProjects: number };
  const json = JSON.stringify(facts);
  for (const leak of LEAKS) assert.ok(!json.includes(leak), `facts leaked ${leak}`);
  assert.equal(facts.restrictedFacts, 4);
  assert.ok(facts.edges.length >= 1 && facts.edges.every((e) => e.key === 'metric:dau' || e.key === 'metric:revenue'));
  assert.ok(facts.edges.filter((e) => e.restricted).every((e) => e.a === '' || e.b === ''), 'the unreachable side of an edge is blanked');
  assert.deepEqual(facts.projects.map((p) => `${p.name}:${p.repos}`).sort(), ['app:1', 'mixed:1']);
  assert.equal(facts.restrictedProjects, 1);
  const projects = API.getOrgProjects(org, false, canSee).body as { projects: { name: string; repos: string[]; hiddenRepos?: number }[]; restrictedProjects: number };
  const pj = JSON.stringify(projects);
  for (const leak of LEAKS) assert.ok(!pj.includes(leak), `projects leaked ${leak}`);
  assert.equal(projects.restrictedProjects, 1);
  assert.deepEqual(projects.projects.find((p) => p.name === 'mixed'), { ...projects.projects.find((p) => p.name === 'mixed')!, repos: ['github:acme/mixed-a'], hiddenRepos: 1 });
});

test('writes: role-gated (org_admin of the acting org / platform_admin), fail-closed, and visibility-checked', () => {
  const org = 'org_vis';
  assert.equal(API.isOrgMemoryAdmin(null, 'org_x'), false, 'unverifiable role → not an admin');
  assert.equal(API.isOrgMemoryAdmin({ role: 'member', orgs: [{ id: 'org_x' }] }, 'org_x'), false);
  assert.equal(API.isOrgMemoryAdmin({ role: 'org_admin', orgs: [{ id: 'org_y' }] }, 'org_x'), false, 'an admin of ANOTHER org');
  assert.equal(API.isOrgMemoryAdmin({ role: 'org_admin', orgs: [{ id: 'org_x' }] }, 'org_x'), true);
  assert.equal(API.isOrgMemoryAdmin({ role: 'platform_admin', orgs: [] }, 'org_x'), true);
  const member = { canWrite: true, admin: false, canSee };
  const admin = { canWrite: true, admin: true, canSee };
  assert.equal(API.postOrgProjects(org, { op: 'create', name: 'n', repos: ['github:acme/app'] }, member).status, 403);
  assert.equal(API.postOrgAliases(org, { op: 'confirm', a: 'metric:dau', b: 'metric:revenue' }, member).status, 403);
  // Naming a repo the caller cannot see.
  assert.equal(API.postOrgProjects(org, { op: 'create', name: 'grab', repos: ['github:acme/secret'] }, admin).status, 403);
  assert.ok(P.listProjects(org).some((p) => p.name === 'Secret Customer X' && p.repos.includes('github:acme/secret')), 'the secret project is untouched');
  // Re-homing a VISIBLE repo out of a project that also holds an invisible repo is refused (no silent strip).
  assert.equal(API.postOrgProjects(org, { op: 'create', name: 'steal', repos: ['github:acme/mixed-a'] }, admin).status, 403);
  assert.deepEqual(P.listProjects(org).find((p) => p.name === 'mixed')!.repos, ['github:acme/mixed-a', 'github:acme/mixed-b']);
  // A project the caller cannot see is a 404; a partly visible one may be renamed but not merged / split.
  const secretId = P.listProjects(org).find((p) => p.name === 'Secret Customer X')!.projectId;
  const mixedId = P.listProjects(org).find((p) => p.name === 'mixed')!.projectId;
  const appId = P.listProjects(org).find((p) => p.name === 'app')!.projectId;
  assert.equal(API.postOrgProjects(org, { op: 'rename', projectId: secretId, name: 'pwn' }, admin).status, 404);
  assert.equal(API.postOrgProjects(org, { op: 'merge', projectIds: [appId, mixedId] }, admin).status, 403);
  assert.equal(API.postOrgProjects(org, { op: 'rename', projectId: mixedId, name: 'mixed 2' }, admin).status, 200);
  // An alias naming a key only the secret project records is refused.
  assert.equal(API.postOrgAliases(org, { op: 'confirm', a: 'metric:dau', b: 'metric:secret_margin' }, admin).status, 403);
  const ok = API.postOrgAliases(org, { op: 'confirm', a: 'metric:dau', b: 'metric:revenue' }, admin);
  assert.equal(ok.status, 200);
  assert.ok(!JSON.stringify(ok.body).includes('secret_margin'), 'the response lists only visible aliases');
  // Creating a project from a visible, unowned repo works; the response lists only visible projects.
  const cr = API.postOrgProjects(org, { op: 'create', name: 'new', repos: ['github:acme/app'] }, admin);
  assert.equal(cr.status, 200);
  assert.ok(!JSON.stringify(cr.body).includes('Secret Customer X'));
});
