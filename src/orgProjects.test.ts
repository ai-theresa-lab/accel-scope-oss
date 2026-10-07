import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// store.ts resolves THERESA_DATA_DIR at module load, so the modules are imported after the env is set.
const dir = mkdtempSync(join(tmpdir(), 'orgproj-'));
process.env.THERESA_DATA_DIR = dir;
const P = await import('./orgProjects.ts');
const API = await import('./orgMemoryApi.ts');
const ADMIN = { canWrite: true, admin: true, canSee: () => true };
const OF = await import('./orgFindings.ts');
const XP = await import('./run/crossProject.ts');
const { orgKeyFor } = await import('./scanLineage.ts');

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

test('repo keys: github source and public URL of the same repo are one project; local folders keyed by source', () => {
  assert.equal(P.repoKeyOfTarget('gh:Acme/App@default'), 'github:acme/app');
  assert.equal(P.repoKeyOfTarget('url:acme/app@default'), 'github:acme/app');
  assert.equal(P.repoKeyOfTarget('local:src_1:etl'), 'local:src_1:etl');
  assert.equal(P.repoKeyOfTarget('gcp:proj'), null);
  assert.equal(P.autoProjectId('github:acme/app'), P.autoProjectId('github:ACME/app'));
});

test('registry: a completed run auto-creates one project per repo, deterministic ids, idempotent', () => {
  const m = P.registerRunProjects('org_reg', ['github:acme/app', 'github:acme/etl']);
  assert.equal(m['github:acme/app'], P.autoProjectId('github:acme/app'));
  assert.equal(P.listProjects('org_reg').length, 2);
  P.registerRunProjects('org_reg', ['github:acme/app']);
  assert.equal(P.listProjects('org_reg').length, 2, 'a re-scan never duplicates');
  assert.equal(P.getProject('org_reg', m['github:acme/app'])?.name, 'acme/app');
});

test('user ops: rename, merge (old ids still resolve), split a monorepo by path', () => {
  const m = P.registerRunProjects('org_ops', ['github:acme/api', 'github:acme/web', 'github:acme/mono']);
  const r1 = P.applyProjectOp('org_ops', { op: 'rename', projectId: m['github:acme/api'], name: 'Backend API' });
  assert.ok(r1.ok);
  const mg = P.applyProjectOp('org_ops', { op: 'merge', projectIds: [m['github:acme/api'], m['github:acme/web']], name: 'Product' });
  assert.ok(mg.ok);
  if (!mg.ok) return;
  const merged = mg.projectIds[0];
  assert.equal(P.resolveProject('org_ops', 'github:acme/web'), merged);
  assert.equal(P.getProject('org_ops', m['github:acme/web'])?.projectId, merged, 'a folded id still resolves to the merged project');
  // A repo in two parts without paths is rejected; with paths it is a monorepo split.
  const bad = P.applyProjectOp('org_ops', { op: 'split', projectId: m['github:acme/mono'], parts: [{ name: 'A' }, { name: 'B' }] });
  assert.equal(bad.ok, false);
  const sp = P.applyProjectOp('org_ops', { op: 'split', projectId: m['github:acme/mono'], parts: [{ name: 'Mobile', paths: ['apps/mobile'] }, { name: 'Data', paths: ['pipelines'] }] });
  assert.ok(sp.ok);
  if (!sp.ok) return;
  assert.equal(P.resolveProject('org_ops', 'github:acme/mono', 'pipelines/dau.sql'), sp.projectIds[1]);
  assert.equal(P.resolveProject('org_ops', 'github:acme/mono', 'apps/mobile/x.ts'), sp.projectIds[0]);
  // A new scan of the already-split repo does not re-create a whole-repo project.
  P.registerRunProjects('org_ops', ['github:acme/mono']);
  assert.equal(P.listProjects('org_ops').filter((p) => p.repos.includes('github:acme/mono')).length, 2);
});

test('deploy prep: concurrent writers from separate processes never drop the projects another wrote; no temp / lock files left', async () => {
  // Each child is a separate process (e.g. a CLI run beside the console) racing on the same org registry.
  const mod = pathToFileURL(join(process.cwd(), 'src', 'orgProjects.ts')).href;
  const WRITERS = 6, PER = 25, START = Date.now() + 1500;   // a shared start time so the writers truly overlap
  const child = (w: number) => new Promise<number>((resolve) => {
    const repos = Array.from({ length: PER }, (_, i) => `github:race/w${w}-r${i}`);
    const code = `const P = await import(${JSON.stringify(mod)}); while (Date.now() < ${START}); for (const r of ${JSON.stringify(repos)}) P.registerRunProjects('org_race', [r]);`;
    const c = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, THERESA_DATA_DIR: dir }, stdio: 'ignore' });
    c.on('exit', (n) => resolve(n ?? 1));
  });
  const codes = await Promise.all(Array.from({ length: WRITERS }, (_, w) => child(w)));
  assert.deepEqual(codes, Array(WRITERS).fill(0));
  // A user op in this process lands on top of every child's write (read inside the lock).
  const first = P.listProjects('org_race')[0];
  assert.ok(P.applyProjectOp('org_race', { op: 'rename', projectId: first.projectId, name: 'Renamed' }).ok);
  const all = P.listProjects('org_race');
  assert.equal(all.length, WRITERS * PER, 'the projects of every writer survived');
  assert.equal(all.filter((p) => p.name === 'Renamed').length, 1);
  assert.deepEqual(readdirSync(join(dir, 'org-projects', 'org_race')), ['projects.json'], 'no .tmp or .lock left behind');
});

test('parseProjectOp: untrusted body validated; bad repo keys and unknown ops rejected', () => {
  assert.equal(P.parseProjectOp({ op: 'create', name: 'x', repos: ['../../etc'] }).ok, false);
  assert.equal(P.parseProjectOp({ op: 'drop' }).ok, false);
  const ok = P.parseProjectOp({ op: 'create', name: '  New\u0000 proj ', repos: ['github:Acme/X'] });
  assert.ok(ok.ok && ok.op.op === 'create' && ok.op.name === 'New proj' && ok.op.repos[0] === 'github:acme/x');
});

// ── isolation ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('isolation: org A never reads or writes org B projects — path traversal and spoofed org fields are inert', () => {
  const A = orgKeyFor('org_A', 'tenantA')!, B = orgKeyFor('org_B', 'tenantB')!;
  P.registerRunProjects(B, ['github:secret/b-only']);
  P.registerRunProjects(A, ['github:acme/a-only']);
  // A's listing never contains B's repo.
  assert.ok(!JSON.stringify(API.getOrgProjects(A, true, () => true).body).includes('b-only'));
  // Traversal-shaped org keys stay inside the org-projects root and never alias B.
  for (const evil of ['../org_B', '..\\org_B', 'org_A/../org_B', '%2e%2e/org_B', '.org_B', 'org_B\u0000']) {
    assert.ok(!JSON.stringify(P.listProjects(evil)).includes('b-only'), `traversal key ${JSON.stringify(evil)} must not read B`);
    P.registerRunProjects(evil, ['github:evil/x']);
  }
  assert.ok(readdirSync(join(dir, 'org-projects')).every((d) => /^~?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(d)), 'every org directory is one sanitized segment (safeSeg: safe ids verbatim, anything else ~<sanitized>-<hash>)');
  assert.ok(readdirSync(dir).every((d) => d === 'org-projects' || d === 'org-findings'), 'nothing written beside the stores');
  assert.ok(!existsSync(join(dir, 'org_B')), 'nothing written outside org-projects/');
  assert.ok(!JSON.stringify(P.listProjects(B)).includes('evil/x'), 'B is untouched by traversal writes');
  // A spoofed org in the body is ignored: the write lands in A (the session's org), never B.
  const r = API.postOrgProjects(A, { op: 'create', name: 'Spoof', repos: ['github:acme/spoof'], orgKey: B, orgId: 'org_B', org: 'org_B' }, ADMIN);
  assert.equal(r.status, 200);
  assert.ok(JSON.stringify(P.listProjects(A)).includes('acme/spoof'));
  assert.ok(!JSON.stringify(P.listProjects(B)).includes('acme/spoof'));
  // A's renaming B's project id is a 404 — the id does not exist in A's registry.
  const bId = P.listProjects(B)[0].projectId;
  assert.equal(API.postOrgProjects(A, { op: 'rename', projectId: bId, name: 'pwn' }, ADMIN).status, 404);
  assert.equal(P.listProjects(B)[0].name, 'secret/b-only');
  // A file planted under A's directory claiming another org is rejected on read (defense-in-depth).
  const aDir = join(dir, 'org-projects', A);
  mkdirSync(aDir, { recursive: true });
  writeFileSync(join(aDir, 'projects.json'), JSON.stringify({ v: 1, orgKey: B, updated: 'x', projects: [{ projectId: 'p-x', name: 'forged', repos: ['github:secret/b-only'], auto: true, createdAt: '', updatedAt: '' }] }));
  assert.deepEqual(P.listProjects(A), []);
});

test('writes gated: POST /api/org/projects is 403 when console memory writes are off', () => {
  assert.equal(API.postOrgProjects('org_gate', { op: 'create', name: 'x', repos: ['github:a/b'] }, { ...ADMIN, canWrite: false }).status, 403);
  assert.deepEqual(P.listProjects('org_gate'), []);
});

test('org findings: rows carry the projectId resolved from the evidence path; org A cannot list org B findings', () => {
  const org = 'org_find';
  P.registerRunProjects(org, ['github:acme/app', 'github:acme/etl']);
  const repos = XP.workspaceRepos({ repos: [{ fullName: 'acme/app', cloneUrl: 'https://github.com/acme/app.git', dir: 'app' }, { fullName: 'acme/etl', cloneUrl: 'https://github.com/acme/etl.git', dir: 'etl' }], localDirs: [] });
  const of = XP.projectResolverFor(org, repos);
  assert.equal(of('etl/models/dau.sql'), P.autoProjectId('github:acme/etl'));
  assert.equal(of(undefined), undefined, 'a two-project workspace cannot attribute a path-less row');
  OF.recordRunFindings(org, 'tk1', { runId: 'rs_1', at: '2026-09-01T00:00:00Z' }, [
    { findingKey: 'k1', title: 'DAU uses UTC', severity: 'high', status: 'new', evidencePath: 'etl/models/dau.sql', projectId: of('etl/models/dau.sql') },
  ]);
  assert.equal(OF.listProjectFindings(org, P.autoProjectId('github:acme/etl')).length, 1);
  assert.equal(OF.listProjectFindings('org_other', P.autoProjectId('github:acme/etl')).length, 0);
  assert.equal(OF.listOrgFindings('../' + org).length, 0);
});
