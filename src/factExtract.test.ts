import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fact extraction bounds + evidence gates. store.ts resolves THERESA_DATA_DIR at module load.
const dir = mkdtempSync(join(tmpdir(), 'factx-'));
process.env.THERESA_DATA_DIR = dir;
const X = await import('./factExtract.ts');

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });
const SHA = 'd'.repeat(40);

test('manifest parsing is bounded: the limit stops parsing, oversize text is skipped, lines stay right', () => {
  const deps = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`pkg${i}`, `^1.${i}.0`]));
  const text = JSON.stringify({ name: 'x', dependencies: deps }, null, 2);
  const r = X.parseManifest('package.json', text, 25);
  assert.equal(r.length, 25);
  assert.deepEqual(r.slice(0, 2).map((d) => [d.name, d.line]), [['pkg0', 4], ['pkg1', 5]], 'line of the dependency key itself');
  assert.equal(X.parseManifest('requirements.txt', Array.from({ length: 50 }, (_, i) => `p${i}==1.0`).join('\n'), 7).length, 7);
  assert.equal(X.parseManifest('package.json', ' '.repeat(X.MANIFEST_MAX_BYTES + 1)).length, 0, 'over the byte cap → not parsed');
  const pom = '<project>\n' + Array.from({ length: 30 }, (_, i) => `<dependency>\n<groupId>g</groupId><artifactId>a${i}</artifactId><version>1.0</version>\n</dependency>`).join('\n') + '\n</project>';
  const p = X.parseManifest('pom.xml', pom, 3);
  assert.deepEqual(p.map((d) => [d.name, d.line]), [['g:a0', 2], ['g:a1', 5], ['g:a2', 8]]);
  // dependencyFacts: an oversize manifest file is not read; the per-repo cap holds across manifests.
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'app', 'sub'), { recursive: true });
  writeFileSync(join(ws, 'app', 'package.json'), text);
  writeFileSync(join(ws, 'app', 'sub', 'package.json'), JSON.stringify({ dependencies: { big: '1.0.0' } }) + ' '.repeat(X.MANIFEST_MAX_BYTES));
  const facts = X.dependencyFacts(ws, [{ dir: 'app', repoKey: 'github:acme/app', fullName: 'acme/app', sha: SHA }], () => 'p-app');
  assert.equal(facts.length, 400);
  assert.ok(!facts.some((f) => f.key === 'dep:npm/big'));
  rmSync(ws, { recursive: true, force: true });
});

test('verdict facts: the LITERAL file must exist (no glob trust) and a definition needs a salient token in it', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'web', 'app', '[id]'), { recursive: true });
  mkdirSync(join(ws, 'web', 'sql'), { recursive: true });
  writeFileSync(join(ws, 'web', 'app', '[id]', 'page.tsx'), 'export default function Page() { return null }\n');
  writeFileSync(join(ws, 'web', 'sql', 'orders.sql'), 'select count(distinct order_id)\nfrom analytics.orders\n');
  writeFileSync(join(ws, 'web', 'sql', 'unrelated.sql'), 'select 1\n');
  const repos = [{ dir: 'web', repoKey: 'github:acme/web', fullName: 'acme/web', sha: SHA }];
  const refs = ['web/app/[id]/page.tsx:1', 'web/app/[slug]/page.tsx:1', 'web/sql/orders.sql:1', 'web/sql/unrelated.sql:1', 'web/sql/*.sql'];
  const findings = [{ id: 'H1', title: 't', claim: 'c', severity: 'low', evidence: refs.map((ref) => ({ kind: 'file', ref })) }] as never[];
  const reply = JSON.stringify({ facts: [
    { kind: 'practice', key: 'practice:ci-gate', payload: { practice: 'ci-gate', present: true, where: 'the Page component' }, evidence: ['web/app/[id]/page.tsx:1'] },   // literal [id] file exists (+ a practice word in it) → kept
    { kind: 'practice', key: 'practice:schema-tests', payload: { practice: 'schema-tests', present: true }, evidence: ['web/app/[slug]/page.tsx:1'] },   // glob-shaped, missing → dropped
    { kind: 'practice', key: 'practice:pii-masking', payload: { practice: 'pii-masking', present: true }, evidence: ['web/sql/*.sql'] },   // a glob → dropped
    { kind: 'metric-def', key: 'metric:orders', payload: { name: 'orders', formula: 'count(distinct order_id)', sourceTables: ['analytics.orders'] }, evidence: ['web/sql/orders.sql:1'] },   // token present → kept
    { kind: 'table-contract', key: 'table:analytics.orders', payload: { table: 'analytics.orders' }, evidence: ['web/sql/unrelated.sql:1'] },   // file exists, table not in it → dropped
  ] });
  const r = await X.verdictFacts({ root: ws, repos, projectOf: () => 'p-web', findings, isRuledOut: () => false, call: async () => ({ text: reply, costUsd: 0 }) });
  assert.deepEqual(r.facts.map((f) => f.key).sort(), ['metric:orders', 'practice:ci-gate']);
  assert.equal(r.dropped, 3);
  assert.equal(X.literalFileText(ws, '../etc/passwd'), null);
  assert.equal(X.literalFileText(ws, 'web/sql/orders.sql', 99), null, 'a line past EOF');
  assert.deepEqual(X.salientTokens('metric-def', { formula: 'count(distinct user_id) filter (where is_test = false)' }), ['user_id', 'is_test']);
  rmSync(ws, { recursive: true, force: true });
});

test('OSV: only the dependency named by its package coordinates, in the repo the evidence names', () => {
  const mk = (repo: string, name: string, eco = 'npm') => ({ key: `dep:${eco}/${name}`, kind: 'dependency' as const, projectId: `p-${repo}`, repo: `github:acme/${repo}`, confidence: 'high' as const, source: 'manifest' as const, payload: { ecosystem: eco, name } as Record<string, unknown>, evidence: [{ path: 'package.json' }] });
  const repos = [{ dir: 'api', repoKey: 'github:acme/api', fullName: 'acme/api' }, { dir: 'etl', repoKey: 'github:acme/etl', fullName: 'acme/etl' }];
  const deps = [mk('api', 'lodash'), mk('etl', 'lodash'), mk('api', 'axios'), mk('etl', 'requests', 'pypi')];
  const f = (claim: string, refs: string[]) => ({ id: 'O1', title: 'Known advisory', claim, severity: 'high', evidence: refs.map((ref) => ({ kind: 'file', ref })) }) as never;
  // Coordinates + the api manifest → only api's lodash (not etl's copy, not axios merely mentioned).
  const n = X.applyOsvVerdicts(deps, [f('OSV reports GHSA-35jh-r3h4-6jhm for npm:lodash@4.17.20; axios is also used here', ['api/package.json:12'])], () => false, repos);
  assert.equal(n, 1);
  assert.deepEqual(deps.filter((d) => d.payload.vuln === 'known').map((d) => `${d.repo}|${d.payload.name}`), ['github:acme/api|lodash']);
  assert.deepEqual(deps[0].payload.advisories, ['GHSA-35JH-R3H4-6JHM']);
  // A bare name mention without coordinates attributes nothing.
  const d2 = [mk('api', 'lodash')];
  assert.equal(X.applyOsvVerdicts(d2, [f('CVE-2021-23337 affects lodash templates', ['api/package.json:3'])], () => false, repos.slice(0, 1)), 0);
  // A purl / name@version works; with no file evidence a multi-repo workspace attributes nothing.
  const d3 = [mk('etl', 'requests', 'pypi')];
  assert.equal(X.applyOsvVerdicts(d3, [f('osv: pkg:pypi/requests@2.19.0 has CVE-2018-18074', [])], () => false, repos), 1, 'one-repo dependency set');
  const d4 = [mk('api', 'lodash'), mk('etl', 'lodash')];
  assert.equal(X.applyOsvVerdicts(d4, [f('lodash@4.17.20 has CVE-2021-23337', [])], () => false, repos), 0, 'ambiguous repo');
  assert.equal(X.namesPackage('see crates.io:serde@1.0.1', 'cargo', 'serde'), true);
  assert.equal(X.namesPackage('uses notlodash@1.0', 'npm', 'lodash'), false);
});

test('verdict facts from code-native MEASUREMENT refs: the files a ref names resolve in the workspace; drops by reason (2026-09-29 E2E)', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'p-limit', '.github', 'workflows'), { recursive: true });
  writeFileSync(join(ws, 'p-limit', '.npmrc'), 'package-lock=false\n');
  writeFileSync(join(ws, 'p-limit', '.gitignore'), 'node_modules\nyarn.lock\n');
  writeFileSync(join(ws, 'p-limit', 'package.json'), '{"name":"p-limit","dependencies":{"yocto-queue":"^1.1.1"}}\n');
  writeFileSync(join(ws, 'p-limit', '.github', 'workflows', 'main.yml'), 'jobs:\n  test:\n    strategy:\n      matrix:\n        node-version: [20, 22]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n');
  const repos = [{ dir: 'p-limit', repoKey: 'github:sindresorhus/p-limit', fullName: 'sindresorhus/p-limit', public: true, sha: SHA }];
  const PROBE = 'probe:glob+read(.npmrc,main.yml,package.json,.gitignore)';
  const GREP = 'code:grep uses: in .github/workflows/**';
  const findings = [
    { id: 'RELEASE-ENG:H1', title: 'No lockfile is committed', claim: '.npmrc disables package-lock', severity: 'medium', evidence: [{ kind: 'metric', ref: PROBE }] },
    { id: 'APPSEC:H2', title: 'Workflow actions pinned to tags, not SHAs', claim: 'uses: actions/checkout@v4', severity: 'low', evidence: [{ kind: 'computation', ref: GREP }] },
    { id: 'RELEASE-ENG:H3', title: 'Glob cited as a FILE row', claim: 'x', severity: 'low', evidence: [{ kind: 'file', ref: 'p-limit/.github/workflows/*.yml' }, { kind: 'metric', ref: 'probe:read(missing.cfg)' }] },
  ] as never[];
  const reply = JSON.stringify({ facts: [
    { kind: 'practice', key: 'practice:lockfile-committed', payload: { practice: 'lockfile-committed', present: false, how: '.npmrc package-lock=false' }, evidence: [PROBE] },
    { kind: 'practice', key: 'practice:actions-pinned', payload: { practice: 'actions-pinned', present: false }, evidence: [GREP] },
    { kind: 'practice', key: 'practice:ci-matrix', payload: { practice: 'ci-matrix', present: true, how: 'node 20 + 22' }, evidence: [`computation: ${GREP}`] },   // the rendered kind label is tolerated
    { kind: 'table-contract', key: 'table:analytics.orders', payload: { table: 'analytics.orders' }, evidence: [PROBE] },   // files resolve, the table is in none → token-missing
    { kind: 'practice', key: 'practice:schema-tests', payload: { practice: 'schema-tests', present: true }, evidence: ['probe:read(missing.cfg)'] },   // names nothing that exists → no-file
    { kind: 'practice', key: 'practice:ci-gate', payload: { practice: 'ci-gate', present: true }, evidence: ['p-limit/.github/workflows/*.yml'] },   // a glob FILE row is never resolved → no-file
    { kind: 'practice', key: 'practice:changelog', payload: { practice: 'changelog', present: true }, evidence: ['probe:glob+read(.npmrc)'] },   // not a ref a verdict cited → no-file
    { kind: 'metric-def', key: 'nope', payload: {}, evidence: [PROBE] },   // invalid row
    { kind: 'practice', evidence: [] },   // invalid row
  ] });
  const r = await X.verdictFacts({ root: ws, repos, projectOf: () => 'p-plimit', findings, isRuledOut: () => false, call: async () => ({ text: reply, costUsd: 0 }) });
  assert.deepEqual(r.facts.map((f) => f.key).sort(), ['practice:actions-pinned', 'practice:ci-matrix', 'practice:lockfile-committed']);
  const lock = r.facts.find((f) => f.key === 'practice:lockfile-committed')!;
  // Only the named files that show the practice (a key / `how` word: package-lock in .npmrc, yarn.lock in .gitignore) —
  // main.yml and package.json resolve but say nothing about a lockfile (the gate is no longer vacuous).
  assert.deepEqual(lock.evidence.map((e) => e.path).sort(), ['.gitignore', '.npmrc']);
  assert.ok(lock.evidence.every((e) => e.sha === SHA));
  assert.equal(lock.public, true);
  assert.deepEqual(r.facts.find((f) => f.key === 'practice:actions-pinned')!.evidence.map((e) => e.path), ['.github/workflows/main.yml']);
  assert.deepEqual(r.droppedBy, { 'no-file': 3, 'token-missing': 1, 'invalid-json': 2, 'ambiguous-repo': 0 });
  assert.equal(r.dropped, 6);
  assert.equal(X.dropsText(r.droppedBy), 'no-file 3 · token-missing 1 · invalid-json 2');
  assert.equal(X.dropsText(X.noDrops()), '');
  rmSync(ws, { recursive: true, force: true });
});

test('a measurement ref resolves in the citing finding’s OWN repo; an unknown repo + a name in two repos is ambiguous-repo; practice words must appear', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  for (const d of ['web', 'api']) { mkdirSync(join(ws, d, '.github', 'workflows'), { recursive: true }); mkdirSync(join(ws, d, 'src'), { recursive: true }); }
  writeFileSync(join(ws, 'web', '.github', 'workflows', 'main.yml'), 'jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n');
  writeFileSync(join(ws, 'api', '.github', 'workflows', 'main.yml'), 'jobs:\n  t:\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n');
  writeFileSync(join(ws, 'api', 'src', 'server.ts'), 'export {}\n');
  const repos = [{ dir: 'web', repoKey: 'github:acme/web', fullName: 'acme/web', sha: SHA }, { dir: 'api', repoKey: 'github:acme/api', fullName: 'acme/api', sha: SHA }];
  const P_API = 'probe:read(main.yml) api pinned', P_BARE = 'probe:read(main.yml)';
  const findings = [
    // api's finding: its repo is known from its other (file) evidence row.
    { id: 'APPSEC:H1', title: 'Actions pinned to SHAs', claim: 'c', severity: 'low', evidence: [{ kind: 'file', ref: 'api/src/server.ts:1' }, { kind: 'metric', ref: P_API }] },
    // no repo can be told: a bare name that exists in both repos.
    { id: 'APPSEC:H2', title: 'Actions pinned to tags', claim: 'c', severity: 'low', evidence: [{ kind: 'metric', ref: P_BARE }] },
  ] as never[];
  const reply = JSON.stringify({ facts: [
    { kind: 'practice', key: 'practice:actions-pinned', payload: { practice: 'actions-pinned', present: true }, evidence: [P_API] },
    { kind: 'practice', key: 'practice:ci-matrix', payload: { practice: 'ci-matrix', present: false }, evidence: [P_BARE] },
    { kind: 'practice', key: 'practice:changelog', payload: { practice: 'changelog', present: true }, evidence: [P_API] },   // resolves, no "changelog" in it → token-missing
  ] });
  const idxFirst = await X.verdictFacts({ root: ws, repos, projectOf: (p) => (p?.startsWith('api/') ? 'p-api' : 'p-web'), findings, isRuledOut: () => false, call: async () => ({ text: reply, costUsd: 0 }) });
  assert.deepEqual(idxFirst.facts.map((f) => [f.key, f.repo, f.projectId, f.evidence.map((e) => e.path)]), [['practice:actions-pinned', 'github:acme/api', 'p-api', ['.github/workflows/main.yml']]], 'attributed to api, not to web (first in workspace order)');
  assert.deepEqual(idxFirst.droppedBy, { 'no-file': 0, 'token-missing': 1, 'invalid-json': 0, 'ambiguous-repo': 1 });
  assert.equal(X.dropsText(idxFirst.droppedBy), 'token-missing 1 · ambiguous-repo 1');
  assert.deepEqual(X.salientTokens('practice', { practice: 'lockfile-committed', how: '.npmrc package-lock=false' }, 'practice:lockfile-committed'), ['lockfile', 'committed', 'npmrc', 'package', 'lock']);
  rmSync(ws, { recursive: true, force: true });
});

test('the verdict-pass prompt asks for PRACTICE facts from code-native verdicts and allows measurement refs (2026-09-29 E2E)', () => {
  const p = X.factsPrompt([{ title: 't', claim: 'c', ruledOut: false, refs: ['probe:glob+read(.npmrc)'] }]);
  for (const s of ['practice:lockfile-committed', 'practice:actions-pinned', 'practice:ci-matrix', 'probe:glob+read(.npmrc,main.yml,package.json,.gitignore)', 'code:grep uses: in .github/workflows/**', 'cite that ref verbatim']) assert.ok(p.includes(s), s);
});

test('literalFileText / workspaceFileIndex never follow a symlink out of the workspace', async (t) => {
  const { symlinkSync } = await import('node:fs');
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET\n');
  const ws = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(ws, 'app'), { recursive: true });
  writeFileSync(join(ws, 'app', 'ok.txt'), 'fine\n');
  try { symlinkSync(outside, join(ws, 'app', 'linkdir'), 'junction'); } catch { t.skip('no directory symlinks / junctions on this host'); rmSync(ws, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); return; }
  let fileLink = true;
  try { symlinkSync(join(outside, 'secret.txt'), join(ws, 'app', 'link.txt'), 'file'); } catch { fileLink = false; }
  assert.equal(X.literalFileText(ws, 'app/ok.txt'), 'fine\n');
  assert.equal(X.literalFileText(ws, 'app/linkdir/secret.txt'), null, 'through a symlinked / junction directory');
  if (fileLink) assert.equal(X.literalFileText(ws, 'app/link.txt'), null, 'a file symlink');
  const { idx } = X.workspaceFileIndex(ws, [{ dir: 'app', repoKey: 'local:s1', fullName: 'local/app' }]);
  assert.deepEqual(idx.files, ['local/app/ok.txt'], 'the walk skips symlinks');
  rmSync(ws, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
});
