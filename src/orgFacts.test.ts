import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store.ts resolves THERESA_DATA_DIR at module load, so the modules are imported after the env is set.
const dir = mkdtempSync(join(tmpdir(), 'orgfacts-'));
process.env.THERESA_DATA_DIR = dir;
const F = await import('./orgFacts.ts');
const X = await import('./factExtract.ts');
const API = await import('./orgMemoryApi.ts');
const XP = await import('./run/crossProject.ts');
const P = await import('./orgProjects.ts');
const { COMPARE_HELPERS_JS } = await import('./serverUi.ts');
const ADMIN = { canWrite: true, admin: true, canSee: () => true };

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40);
function nf(over: Partial<import('./orgFacts.ts').NewFact> & { key: string; kind: import('./orgFacts.ts').FactKind; projectId: string; payload: Record<string, unknown> }): import('./orgFacts.ts').NewFact {
  return { repo: `github:acme/${over.projectId}`, repoFullName: `acme/${over.projectId}`, sha: SHA_A, confidence: 'high', source: 'verdict', evidence: [{ path: 'm/dau.sql', line: 3 }], ...over };
}

test('payload validation: typed per kind, strings redacted + capped, unknown shapes dropped', () => {
  const p = F.parsePayload('metric-def', { name: 'dau', formula: 'count(distinct user_id) -- key sk-ant-abcdefghijklmnopqrstuvwx', timezone: 'UTC', filters: ['not test', 'not test'] });
  assert.ok(p && !String(p.formula).includes('sk-ant-abcdefgh') && (p.filters as string[]).length === 1);
  assert.equal(F.parsePayload('practice', { practice: 'freshness-check' }), null, 'present is required');
  assert.equal(F.parsePayload('metric-def', { formula: 'x' }), null, 'name is required');
  assert.equal(String(F.parsePayload('metric-def', { name: 'x'.repeat(900) })?.name).length, 300);
});

test('contradictions: same key + different project + divergent comparable field; unknown ≠ different; same project never', () => {
  const now = '2026-09-20T00:00:00.000Z';
  const a = F.planIngest([], [], [
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'api', payload: { name: 'dau', formula: 'count(distinct user_id)', timezone: 'UTC' } }),
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'etl', payload: { name: 'dau', formula: 'COUNT( DISTINCT user_id )', timezone: 'America/Los_Angeles' } }),
    nf({ key: 'metric:wau', kind: 'metric-def', projectId: 'api', payload: { name: 'wau', timezone: 'UTC' } }),
    nf({ key: 'metric:wau', kind: 'metric-def', projectId: 'etl', payload: { name: 'wau', formula: 'x' } }),
    nf({ key: 'dep:npm/react', kind: 'dependency', projectId: 'api', payload: { ecosystem: 'npm', name: 'react', major: '18' }, source: 'manifest' }),
    nf({ key: 'dep:npm/react', kind: 'dependency', projectId: 'etl', payload: { ecosystem: 'npm', name: 'react', major: '17' }, source: 'manifest' }),
  ], { runId: 'rs_1', at: now }, [], () => true, ['verdict', 'manifest']);
  const byKey = new Map(a.edges.map((e) => [e.key, e]));
  assert.deepEqual(byKey.get('metric:dau')?.fields, ['timezone'], 'formulas normalize equal; the time zone differs');
  assert.ok(!byKey.has('metric:wau'), 'no field comparable on both sides → no conflict');
  assert.deepEqual(byKey.get('dep:npm/react')?.fields, ['major']);
  // A dependency major / practice presence is a neutral DIFFERENCE, not a contradiction.
  assert.equal(byKey.get('metric:dau')?.type, 'contradicts');
  assert.equal(byKey.get('dep:npm/react')?.type, 'differs');
});

test('majorOf: exact / caret / tilde → a major; open or compound ranges → none, never flagged', () => {
  for (const [r, m] of [['^1.2', '1'], ['~1.2.3', '1'], ['1.2.3', '1'], ['=2.0.0', '2'], ['==3.1', '3'], ['v1.4.0', '1'], ['1.x', '1'], ['^0.14.0', '0'], ['4.17.21-beta.1', '4']] as const) assert.equal(X.majorOf(r), m, r);
  for (const r of ['>=1 <3', '>=2', '<3', '1.x || 2.x', '*', 'latest', '1 - 3', '[1.0,2.0)', 'git+https://x/y.git', 'workspace:*', '', undefined]) assert.equal(X.majorOf(r as string), undefined, String(r));
  const plan = F.planIngest([], [], [
    nf({ key: 'dep:npm/a', kind: 'dependency', projectId: 'api', payload: { ecosystem: 'npm', name: 'a', range: '^1.2' }, source: 'manifest' }),
    nf({ key: 'dep:npm/a', kind: 'dependency', projectId: 'etl', payload: { ecosystem: 'npm', name: 'a', range: '>=1 <3' }, source: 'manifest' }),
  ].map((d) => ({ ...d, payload: { ...d.payload, ...(X.majorOf(String(d.payload.range)) ? { major: X.majorOf(String(d.payload.range)) } : {}) } })), { runId: 'r', at: '2026-09-20T00:00:00.000Z' }, [], () => true, ['manifest']);
  assert.equal(plan.edges.length, 0, 'an ambiguous range is not a different major');
});

test('caps: per project + kind — one project\'s dependency flood never evicts another project\'s metric definitions; edges by priority', () => {
  const org = 'org_caps';
  const at = '2026-09-20T00:00:00.000Z';
  const metric = F.planIngest([], [], [nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'etl', payload: { name: 'dau', formula: 'a' } }), nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'api', payload: { name: 'dau', formula: 'b' } })], { runId: 'r0', at: '2026-01-01T00:00:00.000Z' }, [], () => true, ['verdict']);
  F.commitFacts(org, metric, at);
  const deps = Array.from({ length: F.DEP_FACTS_PER_PROJECT + 150 }, (_, i) => nf({ key: `dep:npm/p${i}`, kind: 'dependency', projectId: 'api', payload: { ecosystem: 'npm', name: `p${i}`, major: '1' }, source: 'manifest' }));
  const flood = F.planIngest(F.currentFactState(org).facts, [], deps, { runId: 'r1', at }, [], () => true, ['manifest']);
  F.commitFacts(org, flood, at);
  const kept = F.listFacts(org);
  assert.equal(kept.filter((f) => f.kind === 'dependency').length, F.DEP_FACTS_PER_PROJECT);
  assert.equal(kept.filter((f) => f.kind === 'metric-def').length, 2, 'the old metric definitions of both projects survive');
  // Edges: definitions outrank dependencies when capped; an edge whose fact is gone is dropped.
  const facts = F.listFacts(org);
  const e = (key: string, a: string, b: string, type: 'contradicts' | 'differs' = 'contradicts') => ({ type, a, b, key, fields: ['x'], at });
  const ids = facts.map((f) => f.id);
  const edges = [...Array.from({ length: 900 }, (_, i) => e(`dep:npm/p${i}`, ids[0], ids[1], 'differs')), e('metric:dau', ids[0], ids[1]), e('metric:gone', 'f-nope', ids[0])];
  const capped = F.capEdges(edges, facts);
  assert.equal(capped[0].key, 'metric:dau', 'metric definitions first');
  assert.ok(!capped.some((x) => x.key === 'metric:gone'), 'an edge to a vanished fact is dropped');
  assert.ok(capped.filter((x) => x.key.startsWith('dep:')).length <= 800, 'dependency edges capped per kind');
});

test('concurrent commits: two runs prepared on the same snapshot, committed one after the other → both runs\' facts survive', async () => {
  const org = 'org_race';
  const mkRepo = (d: string) => ({ dir: d, repoKey: `github:acme/${d}`, fullName: `acme/${d}`, sha: SHA_A });
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  for (const d of ['one', 'two']) { mkdirSync(join(ws, d), { recursive: true }); writeFileSync(join(ws, d, 'package.json'), JSON.stringify({ dependencies: { [`lib-${d}`]: '1.0.0' } })); }
  const prep = (d: string, id: string) => XP.prepareRunFacts({ orgKey: org, runId: id, root: ws, repos: [mkRepo(d)], projectOf: () => `p-${d}`, findings: [], isRuledOut: () => false, log: () => {}, degrade: () => {} });
  const a = await prep('one', 'rs_a'), b = await prep('two', 'rs_b');
  assert.ok(a && b);
  XP.commitRunFacts(a!);
  XP.commitRunFacts(b!);
  const keys = F.listFacts(org).map((f) => f.key).sort();
  assert.deepEqual(keys, ['dep:npm/lib-one', 'dep:npm/lib-two'], 'the second commit re-planned on top of the first');
  // Alias writes take the lock too and never drop a concurrent proposal.
  F.applyAliasOp(org, { op: 'propose', a: 'metric:a', b: 'metric:b' }, 'agent');
  F.applyAliasOp(org, { op: 'propose', a: 'metric:c', b: 'metric:d' }, 'agent');
  assert.equal(F.listAliases(org).length, 2);
  // Alias `remove` is operator-only.
  F.applyAliasOp(org, { op: 'remove', a: 'metric:a', b: 'metric:b' }, 'agent');
  assert.equal(F.listAliases(org).length, 2);
  F.applyAliasOp(org, { op: 'remove', a: 'metric:a', b: 'metric:b' }, 'operator');
  assert.equal(F.listAliases(org).length, 1);
  rmSync(ws, { recursive: true, force: true });
});

test('codeintel ages its facts only when its contracts index exists, not for a bare directory', async () => {
  const org = 'org_ci';
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'app', 'sql'), { recursive: true });
  writeFileSync(join(ws, 'app', 'sql', 't.sql'), 'select 1');
  const repos = [{ dir: 'app', repoKey: 'github:acme/app', fullName: 'acme/app', sha: SHA_A }];
  const seed = F.planIngest([], [], [nf({ key: 'table:x.t', kind: 'table-contract', projectId: 'p-app', repo: 'github:acme/app', payload: { table: 'x.t' }, source: 'codeintel', evidence: [{ path: 'sql/t.sql' }] })], { runId: 'r0', at: '2026-09-01T00:00:00.000Z' }, [], () => true, ['codeintel']);
  F.commitFacts(org, seed, '2026-09-01T00:00:00.000Z');
  mkdirSync(join(ws, '.repowise-workspace'), { recursive: true });   // the directory exists, but no contracts.json
  const p = await XP.prepareRunFacts({ orgKey: org, runId: 'rs_ci', root: ws, repos, projectOf: () => 'p-app', findings: [], isRuledOut: () => false, log: () => {}, degrade: () => {} });
  assert.ok(!p!.input.sources.includes('codeintel'));
  XP.commitRunFacts(p!);
  assert.equal(F.listFacts(org).find((f) => f.key === 'table:x.t')?.state, 'active');
  rmSync(ws, { recursive: true, force: true });
});

test('aliases: an UNCONFIRMED alias never asserts a conflict; a confirmed one does', () => {
  const org = 'org_alias';
  const at = '2026-09-20T00:00:00.000Z';
  const plan = F.planIngest([], [], [
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'api', payload: { name: 'dau', timezone: 'UTC' } }),
    nf({ key: 'metric:daily_active_users', kind: 'metric-def', projectId: 'etl', payload: { name: 'daily active users', timezone: 'PST' } }),
  ], { runId: 'rs_1', at }, [], () => true, ['verdict']);
  F.commitFacts(org, plan, at);
  assert.equal(F.listEdges(org).length, 0);
  F.applyAliasOp(org, { op: 'propose', a: 'metric:dau', b: 'metric:daily_active_users' }, 'agent', at, 'rs_1');
  assert.equal(F.listEdges(org).length, 0, 'proposed alias: recall only');
  assert.ok(F.equivalentKeys('metric:dau', F.listAliases(org), false).has('metric:daily_active_users'));
  // The agent cannot confirm its own alias.
  F.applyAliasOp(org, { op: 'confirm', a: 'metric:dau', b: 'metric:daily_active_users' }, 'agent', at);
  assert.equal(F.listAliases(org)[0].state, 'proposed');
  assert.equal(API.postOrgAliases(org, { op: 'confirm', a: 'metric:dau', b: 'metric:daily_active_users' }, ADMIN).status, 200);
  assert.equal(F.listEdges(org).length, 1);
  assert.equal(F.listEdges(org)[0].via, 'alias');
  assert.equal(API.postOrgAliases(org, { op: 'confirm', a: 'metric:dau', b: 'table:x' }, ADMIN).status, 400, 'an alias joins keys of one kind');
  assert.equal(API.postOrgAliases(org, { op: 'remove', a: 'metric:dau', b: 'metric:daily_active_users' }, { ...ADMIN, canWrite: false }).status, 403);
});

test('freshness: re-observed → refreshed; not re-observed on a re-scan → disputed; evidence gone → retired; TTL', () => {
  const t0 = '2026-08-01T00:00:00.000Z', t1 = '2026-09-01T00:00:00.000Z';
  const first = F.planIngest([], [], [
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'api', payload: { name: 'dau', timezone: 'UTC' } }),
    nf({ key: 'metric:mau', kind: 'metric-def', projectId: 'api', payload: { name: 'mau', timezone: 'UTC' } }),
    nf({ key: 'metric:gone', kind: 'metric-def', projectId: 'api', payload: { name: 'gone' }, evidence: [{ path: 'old.sql' }] }),
    nf({ key: 'metric:other', kind: 'metric-def', projectId: 'etl', payload: { name: 'other' } }),
  ], { runId: 'rs_1', at: t0 }, [], () => true, ['verdict']);
  const second = F.planIngest(first.facts, [], [
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'api', payload: { name: 'dau', timezone: 'UTC' } }),
  ], { runId: 'rs_2', at: t1 }, [{ projectId: 'api', repo: 'github:acme/api' }], (f) => f.evidence[0].path !== 'old.sql', ['verdict']);
  const st = new Map(second.facts.map((f) => [f.key, f]));
  assert.equal(st.get('metric:dau')?.state, 'active');
  assert.equal(st.get('metric:dau')?.firstSeen, t0);
  assert.equal(st.get('metric:dau')?.lastSeen, t1);
  assert.equal(st.get('metric:mau')?.state, 'active', 'an LLM (verdict) fact survives ONE missed re-scan');
  assert.equal(st.get('metric:mau')?.missCount, 1);
  assert.equal(st.get('metric:gone')?.state, 'retired');
  const again = F.planIngest(second.facts, [], [], { runId: 'rs_2b', at: t1 }, [{ projectId: 'api', repo: 'github:acme/api' }], () => true, ['verdict']);
  assert.equal(again.facts.find((f) => f.key === 'metric:mau')?.state, 'disputed', 'two consecutive misses → disputed');
  const back = F.planIngest(second.facts, [], [nf({ key: 'metric:mau', kind: 'metric-def', projectId: 'api', payload: { name: 'mau', timezone: 'UTC' } })], { runId: 'rs_2c', at: t1 }, [{ projectId: 'api', repo: 'github:acme/api' }], () => true, ['verdict']);
  assert.equal(back.facts.find((f) => f.key === 'metric:mau')?.missCount, undefined, 're-observation resets the miss count');
  assert.equal(st.get('metric:other')?.state, 'active', 'another project was not re-scanned');
  // A run whose verdict pass did not run does not dispute verdict facts.
  const third = F.planIngest(first.facts, [], [], { runId: 'rs_3', at: t1 }, [{ projectId: 'api', repo: 'github:acme/api' }], () => true, ['manifest']);
  assert.ok(third.facts.every((f) => f.state === 'active'));
  // TTL: a dependency not seen for > 30 days reads as disputed.
  const dep = F.planIngest([], [], [nf({ key: 'dep:npm/x', kind: 'dependency', projectId: 'api', payload: { ecosystem: 'npm', name: 'x' }, source: 'manifest' })], { runId: 'r', at: t0 }, [], () => true, ['manifest']).facts[0];
  assert.equal(F.effectiveState(dep, new Date('2026-08-15T00:00:00Z')).state, 'active');
  assert.equal(F.effectiveState(dep, new Date('2026-09-15T00:00:00Z')).state, 'disputed');
});

test('manifests: npm / pypi / go / cargo / maven / gradle parsed with line numbers, pinned + major', () => {
  const npm = X.parseManifest('package.json', '{\n  "dependencies": {\n    "react": "^18.2.0",\n    "lodash": "4.17.21"\n  }\n}');
  assert.deepEqual(npm.map((d) => [d.name, d.range, d.line]), [['react', '^18.2.0', 3], ['lodash', '4.17.21', 4]]);
  assert.deepEqual(X.parseManifest('requirements.txt', 'Requests==2.31.0\n# c\npandas>=2\n-r other.txt').map((d) => [d.name, d.range, d.line]), [['Requests', '==2.31.0', 1], ['pandas', '>=2', 3]]);
  assert.deepEqual(X.parseManifest('go.mod', 'module x\nrequire (\n\tgithub.com/a/b v1.2.3\n)\nrequire c.io/d v0.1.0').map((d) => d.name), ['github.com/a/b', 'c.io/d']);
  assert.deepEqual(X.parseManifest('Cargo.toml', '[dependencies]\nserde = "1.0"\ntokio = { version = "1.3", features = ["x"] }').map((d) => [d.name, d.range]), [['serde', '1.0'], ['tokio', '1.3']]);
  assert.equal(X.parseManifest('pom.xml', '<project><dependency><groupId>g</groupId><artifactId>a</artifactId><version>2.0</version></dependency></project>')[0].name, 'g:a');
  assert.equal(X.parseManifest('build.gradle', 'dependencies {\n implementation "com.x:y:3.1.0"\n}')[0].range, '3.1.0');
  assert.equal(X.parseManifest('pyproject.toml', '[project]\ndependencies = [\n  "httpx>=0.27",\n]\n')[0].name, 'httpx');
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'app', 'node_modules', 'z'), { recursive: true });
  writeFileSync(join(ws, 'app', 'package.json'), '{"dependencies":{"react":"18.2.0"}}');
  writeFileSync(join(ws, 'app', 'node_modules', 'z', 'package.json'), '{"dependencies":{"evil":"1"}}');
  const repos = [{ dir: 'app', repoKey: 'github:acme/app', fullName: 'acme/app', sha: SHA_A }];
  const facts = X.dependencyFacts(ws, repos, () => 'p-app');
  assert.deepEqual(facts.map((f) => [f.key, f.payload.pinned, f.payload.major, f.evidence[0].path]), [['dep:npm/react', true, '18', 'package.json']]);
  rmSync(ws, { recursive: true, force: true });
});

test('verdict pass: strict validation — uncited / unresolvable evidence dropped, keys canonicalized, secrets redacted', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'etl', 'models'), { recursive: true });
  writeFileSync(join(ws, 'etl', 'models', 'dau.sql'), 'select\n count(distinct user_id)\nfrom events -- UTC\n');
  const repos = [{ dir: 'etl', repoKey: 'github:acme/etl', fullName: 'acme/etl', sha: SHA_B }];
  const findings = [{ id: 'H1', title: 'DAU is computed in UTC', claim: 'models/dau.sql counts distinct user_id per UTC day', severity: 'high', evidence: [{ kind: 'file', ref: 'etl/models/dau.sql:2' }] }] as never[];
  let prompt = '';
  const reply = JSON.stringify({ facts: [
    { kind: 'metric-def', key: 'Metric:DAU', payload: { name: 'dau', formula: 'count(distinct user_id) ghp\x5fabcdefghijklmnopqrstuvwxyz0123', timezone: 'UTC' }, evidence: ['etl/models/dau.sql:2'], confidence: 'high' },
    { kind: 'metric-def', key: 'metric:revenue', payload: { name: 'revenue' }, evidence: ['etl/models/revenue.sql:1'] },   // not cited
    { kind: 'practice', key: 'practice:freshness-check', payload: { practice: 'freshness-check', present: false }, evidence: ['etl/models/dau.sql:99'] },   // line past EOF
    { kind: 'dependency', key: 'dep:npm/x', payload: {}, evidence: ['etl/models/dau.sql:2'] },   // kind not allowed from the LLM
  ], aliases: [{ a: 'metric:dau', b: 'metric:daily_active_users' }, { a: 'metric:dau', b: 'table:x' }] });
  const r = await X.verdictFacts({ root: ws, repos, projectOf: () => 'p-etl', findings, isRuledOut: () => false, call: async (p) => { prompt = p; return { text: 'sure:\n' + reply, costUsd: 0.01 }; } });
  assert.ok(prompt.includes('etl/models/dau.sql:2') && prompt.includes('REPO-DERIVED DATA'));
  assert.equal(r.facts.length, 1);
  assert.equal(r.dropped, 3, 'uncited ref · line past EOF · a kind the LLM may not emit');
  assert.equal(r.facts[0].key, 'metric:dau');
  assert.deepEqual(r.facts[0].evidence, [{ path: 'models/dau.sql', line: 2, sha: SHA_B }]);
  assert.ok(!String(r.facts[0].payload.formula).includes('ghp_abcdef'));
  assert.deepEqual(r.aliases, [{ a: 'metric:dau', b: 'metric:daily_active_users' }]);
  const bad = await X.verdictFacts({ root: ws, repos, projectOf: () => 'p-etl', findings, isRuledOut: () => false, call: async () => ({ text: 'not json', costUsd: 0 }) });
  assert.ok(bad.error && !bad.facts.length);
  rmSync(ws, { recursive: true, force: true });
});

// ── the integration-style check: two projects, one org, conflicting metric definitions ──────────────────────────────
test('two synthetic projects in one org: contradiction edge, Compare matrix, visibility, and org B sees none of it', async () => {
  const org = 'org_two', orgB = 'org_bystander';
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  for (const [d, body] of [['api', 'select count(distinct user_id) -- UTC day\n'], ['etl', 'select count(distinct device_id) -- local day\n']] as const) {
    mkdirSync(join(ws, d, 'metrics'), { recursive: true });
    writeFileSync(join(ws, d, 'metrics', 'dau.sql'), body);
    writeFileSync(join(ws, d, 'package.json'), JSON.stringify({ dependencies: { react: d === 'api' ? '^18.2.0' : '^17.0.2' } }));
  }
  const manifest = { repos: [{ fullName: 'acme/api', cloneUrl: 'https://github.com/acme/api.git', dir: 'api', sha: SHA_A }, { fullName: 'acme/etl', cloneUrl: 'https://github.com/acme/etl.git', dir: 'etl', sha: SHA_B }], localDirs: [] };
  const repos = XP.workspaceRepos(manifest);
  const projectOf = XP.projectResolverFor(org, repos);
  const findings = [
    { id: 'H1', title: 'DAU counts users per UTC day', claim: 'api computes DAU as distinct user_id per UTC day', severity: 'medium', evidence: [{ kind: 'file', ref: 'api/metrics/dau.sql:1' }] },
    { id: 'H2', title: 'DAU counts devices per local day', claim: 'etl computes DAU as distinct device_id per local day', severity: 'high', evidence: [{ kind: 'file', ref: 'etl/metrics/dau.sql:1' }] },
  ] as never[];
  const reply = JSON.stringify({ facts: [
    { kind: 'metric-def', key: 'metric:dau', payload: { name: 'dau', formula: 'count(distinct user_id)', timezone: 'UTC' }, evidence: ['api/metrics/dau.sql:1'] },
    { kind: 'metric-def', key: 'metric:dau', payload: { name: 'dau', formula: 'count(distinct device_id)', timezone: 'local' }, evidence: ['etl/metrics/dau.sql:1'] },
  ] });
  const logs: string[] = [];
  const pending = await XP.prepareRunFacts({ orgKey: org, runId: 'rs_two', root: ws, repos, projectOf, findings, isRuledOut: () => false, log: (m) => logs.push(m), degrade: (m) => logs.push('DEGRADED ' + m), llmCall: async () => ({ text: reply, costUsd: 0.02 }) });
  assert.ok(pending);
  P.registerRunProjects(org, repos.map((r) => r.repoKey));
  const line = XP.commitRunFacts(pending!);
  assert.match(line, /definition conflict edge/);
  const edges = F.listEdges(org);
  const dau = edges.find((e) => e.key === 'metric:dau');
  assert.deepEqual(dau?.fields, ['formula', 'timezone']);
  assert.ok(edges.some((e) => e.key === 'dep:npm/react' && e.fields.includes('major') && e.type === 'differs'));
  // Compare: a viewer who can see both projects gets values + permalinks; one who can see only api gets a restricted column.
  const projects = P.listProjects(org);
  const both = API.buildCompareMatrix(F.listFacts(org), edges, [], projects, () => true);
  const row = both.rows.find((r) => r.key === 'metric:dau')!;
  assert.ok(row.divergent && both.rows[0].divergent, 'divergent rows sort first');
  const apiId = P.autoProjectId('github:acme/api'), etlId = P.autoProjectId('github:acme/etl');
  assert.match(row.cells[etlId].summary!, /device_id/);
  assert.equal(row.cells[apiId].evidence![0].href, `https://github.com/acme/api/blob/${SHA_A}/metrics/dau.sql#L1`);
  const onlyApi = API.buildCompareMatrix(F.listFacts(org), edges, [], projects, (f) => f.repo === 'github:acme/api');
  const r2 = onlyApi.rows.find((r) => r.key === 'metric:dau')!;
  assert.ok(r2.cells[etlId].restricted && r2.cells[etlId].divergent);
  assert.ok(!JSON.stringify(onlyApi).includes('device_id') && !JSON.stringify(onlyApi).includes('acme/etl'), 'no value, repo or name of the unreachable project leaks');
  // Visibility from the viewer's connected sources.
  const see = API.canSeeFromSources([{ kind: 'github', id: 'gh', repos: [{ fullName: 'acme/api' }, { fullName: 'acme/etl', cloneable: false }] }]);
  const facts = F.listFacts(org);
  assert.equal(see(facts.find((f) => f.repo === 'github:acme/api')!), true);
  assert.equal(see(facts.find((f) => f.repo === 'github:acme/etl')!), false, 'a pre-flight-unreachable repo does not count');
  const viaApi = API.getOrgFacts(org, {}, projects, see).body as { facts: { repo?: string }[]; restrictedFacts: number };
  assert.ok(viaApi.restrictedFacts > 0 && viaApi.facts.every((f) => f.repo === 'github:acme/api'), 'restricted facts are only counted');
  // The rendered Compare HTML (the exact client code): divergent cells highlighted, links escaped + github-only.
  const H = new Function(`${COMPARE_HELPERS_JS}; return { compareMatrixHtml };`)() as { compareMatrixHtml: (d: unknown) => string };
  const html = H.compareMatrixHtml(API.getOrgCompare(org, {}, projects, () => true, false).body);
  assert.match(html, /cmp-div/);
  assert.match(html, /differs on formula, timezone/);
  assert.match(html, /href="https:\/\/github\.com\/acme\/api\/blob\//);
  assert.match(H.compareMatrixHtml({ rows: [], kinds: ['metric-def'] }), /Nothing to compare yet/);
  const evil = H.compareMatrixHtml({ kinds: [], projects: [{ projectId: 'p', name: '<img src=x onerror=1>' }], rows: [{ key: 'metric:x', kind: 'metric-def', keys: ['metric:x'], divergent: false, fields: [], cells: { p: { state: 'active', summary: '<script>x</script>', evidence: [{ label: 'a', href: 'javascript:alert(1)' }], key: 'metric:x', measuredAt: '' } } }] });
  assert.ok(!evil.includes('<script>x') && !evil.includes('<img src') && !evil.includes('javascript:'));
  // Console polish: the live Compare search — key / kind / visible values / project names, case-insensitive, all terms.
  const S = new Function(`${COMPARE_HELPERS_JS}; return { compareMatrixHtml, compareResultsHtml, cmpFilterRows };`)() as { compareMatrixHtml: (d: unknown, q?: string) => string; compareResultsHtml: (d: unknown, q?: string) => string; cmpFilterRows: (rows: unknown[], cols: unknown[], q: string) => { key: string }[] };
  const sd = { kinds: ['dependency', 'practice'], projects: [{ projectId: 'a', name: 'Web App' }, { projectId: 'b', name: 'Billing' }, { projectId: 'c', name: 'Secret', restricted: true }], rows: [
    { key: 'dep:react', kind: 'dependency', keys: ['dep:react'], divergent: false, cells: { a: { state: 'active', summary: 'react 18.2.0', key: 'dep:react', evidence: [{ label: 'package.json' }] } } },
    { key: 'practice:lockfile', kind: 'practice', keys: ['practice:lockfile'], divergent: true, fields: ['policy'], cells: { b: { state: 'active', summary: 'commits a pnpm lockfile', key: 'practice:lockfile', evidence: [] }, c: { restricted: true, divergent: true } } },
    { key: 'dep:lodash', kind: 'dependency', keys: ['dep:lodash'], divergent: false, cells: { c: { restricted: true, summary: 'lodash 4 HIDDEN', key: 'dep:lodash' } } }] };
  const keys = (q: string) => S.cmpFilterRows(sd.rows, sd.projects, q).map((r) => r.key);
  assert.deepEqual(keys(''), ['dep:react', 'practice:lockfile', 'dep:lodash']);
  assert.deepEqual(keys('REACT'), ['dep:react'], 'case-insensitive key match');
  assert.deepEqual(keys('practices'), ['practice:lockfile'], 'the kind label');
  assert.deepEqual(keys('pnpm'), ['practice:lockfile'], 'a visible cell value');
  assert.deepEqual(keys('billing'), ['practice:lockfile'], 'a project the row has a cell in');
  assert.deepEqual(keys('hidden'), [], 'a restricted cell contributes no values');
  assert.deepEqual(keys('secret lodash'), ['dep:lodash'], 'every term must match (a restricted project NAME is visible)');
  assert.match(S.compareMatrixHtml(sd, 'react'), /id="cmpSearch"[^>]*value="react"/);
  assert.match(S.compareMatrixHtml(sd, 'react'), /data-act="mem-cmp-kind"/, 'kind chips stay beside the search');
  assert.match(S.compareResultsHtml(sd, 'react'), /<b>1<\/b> of 3 keys/);
  assert.match(S.compareResultsHtml(sd, ''), /^<div class="cmp-stats mono">3 keys/);
  assert.match(S.compareResultsHtml(sd, 'zzz<b>'), /No keys match &ldquo;zzz&lt;b&gt;&rdquo;/);
  assert.doesNotMatch(S.compareMatrixHtml({ rows: [], kinds: [] }), /cmpSearch/, 'no search box on the empty view');
  // Org B: nothing.
  assert.deepEqual(F.listFacts(orgB), []);
  assert.deepEqual(F.listEdges(orgB), []);
  assert.equal((API.getOrgCompare(orgB, {}, [], () => true, false).body as { rows: unknown[] }).rows.length, 0);
  assert.deepEqual(F.listFacts('../' + org), []);
  rmSync(ws, { recursive: true, force: true });
});

test('merged projects: facts of a merged-away project move to the survivor; no self-contradiction edge; precedents follow', async () => {
  const now = '2026-09-20T00:00:00.000Z';
  const plan = F.planIngest([], [], [
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'api', payload: { name: 'dau', timezone: 'UTC' } }),
    nf({ key: 'metric:dau', kind: 'metric-def', projectId: 'etl', payload: { name: 'dau', timezone: 'America/Los_Angeles' } }),
  ], { runId: 'rs_m', at: now }, [], () => true, ['verdict']);
  assert.equal(plan.edges.length, 1, 'two projects disagree before the merge');
  const out = F.remapMergedProjects(plan.facts, plan.edges, new Map([['etl', 'api']]));
  assert.deepEqual([...new Set(out.facts.map((x) => x.projectId))], ['api']);
  assert.equal(out.edges.length, 0, 'a project never contradicts its own former self');
  assert.ok(out.facts.every((x) => x.id === F.factId(x.projectId, x.key, x.repo)), 'ids follow the surviving project');
  // The same repo seen under both ids collapses to one card (the freshest wins).
  const dup = F.planIngest([], [], [
    nf({ key: 'metric:x', kind: 'metric-def', projectId: 'old', repo: 'github:acme/r', payload: { name: 'x', timezone: 'UTC' } }),
    nf({ key: 'metric:x', kind: 'metric-def', projectId: 'new', repo: 'github:acme/r', payload: { name: 'x', timezone: 'UTC' } }),
  ], { runId: 'rs_d', at: now }, [], () => true, ['verdict']);
  assert.equal(F.remapMergedProjects(dup.facts, dup.edges, new Map([['old', 'new']])).facts.length, 1);
  assert.equal(F.remapMergedProjects(plan.facts, plan.edges, new Map()).facts, plan.facts, 'no merges: untouched');
  // A "fixed" record of the merged-away project is the survivor's own history, not another project's precedent.
  const rec = { status: 'fixed', projectId: 'etl', bundleId: 'appsec', invariant: 'sc1', title: 'Pinned actions', history: [{ status: 'fixed', at: now, runId: 'rs_f' }] } as never;
  const f = { id: 'APPSEC:H1', title: 'Pinned actions', invariant: 'sc1' } as never;
  const label = async () => 'ETL';
  assert.equal(Object.keys(await XP.precedentsFor([f], [rec], new Set(['api']), () => false, label)).length, 1, 'without the merge map it reads as another project');
  assert.deepEqual(await XP.precedentsFor([f], [rec], new Set(['api']), () => false, label, new Map([['etl', 'api']])), {});
});
