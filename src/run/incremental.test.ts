import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetLeftOpen, classifyRepo, compileProbe, packageJsonDepsChanged, estimateIncremental, globMatchesAny, globToRegExp, incrSettings, laneIncompleteReason, laneReadSetDecision, parseNameStatus, planIncremental, structuralReason, type ChangedFile, type PlanInput, type RepoChange } from './incremental.ts';
import { CKPT_STAGE_VERSION } from '../checkpoints.ts';

const S = { smallMaxFiles: 3 };
const ch = (path: string, status: ChangedFile['status'] = 'M', text = '', old = '', oldPath?: string): RepoChange => ({ status, path, ...(oldPath ? { oldPath } : {}), repo: 'acme/app', newText: () => text, oldText: () => old });

test('parseNameStatus: M/A/D and renames/copies with both paths', () => {
  assert.deepEqual(parseNameStatus('M\tsrc/a.ts\nA\tsrc/b.ts\nD\tx.md\nR087\told/c.ts\tnew/c.ts\n'), [
    { status: 'M', path: 'src/a.ts' }, { status: 'A', path: 'src/b.ts' }, { status: 'D', path: 'x.md' }, { status: 'R', oldPath: 'old/c.ts', path: 'new/c.ts' },
  ]);
});

test('classifyRepo: unchanged / small / structural (threshold, manifest, migration, CI, build, layout)', () => {
  assert.equal(classifyRepo([], S).cls, 'unchanged');
  assert.equal(classifyRepo([{ status: 'M', path: 'src/a.ts' }], S).cls, 'small');
  assert.match(classifyRepo([1, 2, 3, 4].map((i) => ({ status: 'M' as const, path: `src/${i}.ts` })), S).reason, /4 files changed \(> 3\)/);
  for (const p of ['package.json', 'svc/go.mod', 'db/migrations/0001_init.sql', 'prisma/schema.prisma', '.github/workflows/ci.yml', 'Dockerfile', 'tsconfig.build.json']) {
    assert.equal(classifyRepo([{ status: 'M', path: p }], S).cls, 'structural', p);
  }
  assert.match(structuralReason([{ status: 'M', path: 'yarn.lock' }]) ?? '', /dependency manifest/);
  assert.match(classifyRepo([{ status: 'A', path: 'newpkg/x.ts' }], S, { before: ['src'], after: ['src', 'newpkg'] }).reason, /top-level layout changed \(\+newpkg\)/);
});

test('globToRegExp: ** spans dirs, * does not, {a,b}, no-slash globs match the basename anywhere', () => {
  assert.ok(globToRegExp('acme/app/src/**/*.ts').test('acme/app/src/a/b/c.ts'));
  assert.ok(globToRegExp('acme/app/src/**/*.ts').test('acme/app/src/c.ts'));
  assert.ok(!globToRegExp('acme/app/src/*.ts').test('acme/app/src/a/c.ts'));
  assert.ok(globToRegExp('*.{ts,tsx}').test('acme/app/deep/x.tsx'));
  assert.ok(!globToRegExp('*.py').test('acme/app/x.ts'));
});

test('lane read-set rule: a read file changed / a glob-matching file added / a grep probe newly matches → re-run; else reuse', () => {
  const lane = { bundleId: 'data-eng', readSet: ['acme/app/src/pipeline.ts'], globs: ['acme/app/src/**/*.sql'], greps: [{ path: 'acme/app', pattern: 'rev(enue)?_total', type: 'ts' }] };
  assert.match(laneReadSetDecision(lane, [ch('src/pipeline.ts')]).reason, /it read acme\/app\/src\/pipeline\.ts/);
  assert.equal(laneReadSetDecision(lane, [ch('src/pipeline.ts', 'M')]).reuse, false);
  assert.equal(laneReadSetDecision(lane, [ch('src/q.sql', 'M')]).reuse, true, 'a MODIFIED file does not change a Glob listing');
  assert.match(laneReadSetDecision(lane, [ch('src/q.sql', 'A')]).reason, /glob acme\/app\/src\/\*\*\/\*\.sql was added/);
  assert.match(laneReadSetDecision(lane, [ch('src/other.ts', 'M', 'const revenue_total = 1', 'x')]).reason, /search \/rev\(enue\)\?_total\/ matches/);
  assert.equal(laneReadSetDecision(lane, [ch('src/other.py', 'M', 'revenue_total', '')]).reuse, true, 'the probe type filter (ts) excludes .py');
  assert.match(laneReadSetDecision(lane, [ch('src/gone.ts', 'D', '', 'x = revenue_total')]).reason, /matches/, 'a deleted file that USED to match counts');
  assert.match(laneReadSetDecision(lane, [ch('src/new.ts', 'R', 'x', 'x', 'src/pipeline.ts')]).reason, /pipeline\.ts/, 'the old name of a rename counts');
  assert.equal(laneReadSetDecision({ ...lane, readSet: ['acme/app/src/other.ts'] }, [ch('README.md', 'M', 'hello', 'hi')]).reuse, true);
  assert.match(laneReadSetDecision({ bundleId: 'x' }, [ch('a.ts')]).reason, /no read set recorded/);
  assert.match(laneReadSetDecision({ bundleId: 'x', readSet: [], opaque: ['codeintel:search'] }, [ch('a.ts')]).reason, /cannot be attributed/);
  assert.equal(laneReadSetDecision({ bundleId: 'x', readSet: [], opaque: ['codeintel:search'] }, []).reuse, true, 'nothing changed → even an opaque lane is reusable');
  assert.match(laneReadSetDecision({ bundleId: 'x', readSet: [], greps: [{ path: '.', pattern: '(' }] }, [ch('a.ts')]).reason, /cannot be re-checked/, 'an uncompilable regex is conservative');
});

const REG = { registryHash: 'R', bundleHashes: { 'data-eng': 'h1', appsec: 'h2', baseline: 'h3' }, invariantHash: 'I' };
function input(over: Partial<PlanInput> = {}): PlanInput {
  const now = new Date('2026-09-28T00:00:00.000Z');
  return {
    settings: { ...incrSettings({}), smallMaxFiles: 200 }, fullRescan: false, now, baselineReason: 'x',
    baseline: {
      v: 1, runId: 'rs_base', createdAt: '2026-09-20T00:00:00.000Z', finishedAt: '2026-09-20T01:00:00.000Z', status: 'complete', targets: ['gh:acme/app@default'],
      repos: [{ fullName: 'acme/app', dir: 'app', sha: 'a1' }], localDirs: [], bundleIds: ['data-eng', 'appsec', 'baseline'], invariantIds: [], planeFps: ['fpW'],
      briefHash: 'b', inputsSig: 'sig', stageVersions: { ...CKPT_STAGE_VERSION }, ...REG, cuts: ['comprehend', 'barrier', 'findings'], laneSpend: {}, totalSpend: 10,
      depth: 0, lastFullAt: '2026-09-20T01:00:00.000Z',
    },
    repos: [{ fullName: 'acme/app', dir: 'app', sha: 'b2' }], localDirs: [], planeFps: ['fpW'], inputsSig: 'sig', briefHash: 'b', manualBundles: null, invariantIds: [],
    registry: REG, codeintel: false, osv: false,
    baselineLanes: {
      'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/src/pipeline.ts'] },
      appsec: { bundleId: 'appsec', readSet: ['acme/app/src/auth.ts'], measuredAt: '2026-09-20T00:10:00.000Z' },
      baseline: { bundleId: 'baseline', readSet: [] },
    },
    baselineComprehend: { codeintel: false, osv: false }, baselineManualBundles: null,
    gitDiff: () => ({ ok: true, files: [{ status: 'M', path: 'src/pipeline.ts' }] }), gitTop: () => ['src'], textAt: () => 'x',
    ...over,
  };
}

test('planIncremental: small diff → Comprehend reused, only the lanes that read changed files re-run; measuredAt carried', () => {
  const { plan } = planIncremental(input());
  assert.equal(plan.mode, 'incremental');
  assert.equal(plan.comprehend, 'reuse');
  assert.deepEqual(Object.fromEntries(Object.entries(plan.lanes).map(([k, v]) => [k, v.reuse])), { 'data-eng': false, appsec: true, baseline: true });
  assert.equal(plan.lanes.appsec.measuredAt, '2026-09-20T00:10:00.000Z');
  assert.match(plan.reason, /1 of 1 repo\(s\) changed \(1 file\(s\)\)/);
});

test('planIncremental: same SHAs + same inputs → unchanged; any input drift is not unchanged', () => {
  assert.equal(planIncremental(input({ repos: [{ fullName: 'acme/app', dir: 'app', sha: 'a1' }] })).plan.mode, 'unchanged');
  const drift = planIncremental(input({ repos: [{ fullName: 'acme/app', dir: 'app', sha: 'a1' }], inputsSig: 'other' })).plan;
  assert.equal(drift.mode, 'full', 'brief changed + nothing changed on disk → Comprehend + every lane re-run → full');
  assert.match(drift.reason, /nothing reusable/);
});

test('planIncremental: strict compat drops to the next coarser level with a reason', () => {
  const reg = planIncremental(input({ registry: { ...REG, bundleHashes: { ...REG.bundleHashes, appsec: 'CHANGED' } } })).plan;
  assert.equal(reg.lanes.appsec.reuse, false); assert.equal(reg.lanes.appsec.reason, 'bundle playbook changed');
  const inv = planIncremental(input({ registry: { ...REG, invariantHash: 'NEW' } })).plan;
  assert.ok(Object.values(inv.lanes).every((l) => !l.reuse && l.reason === 'invariant registry changed'));
  assert.equal(inv.comprehend, 'reuse', 'an invariant registry change does not by itself re-run Comprehend');
  const planes = planIncremental(input({ planeFps: ['fpOther'] })).plan;
  assert.equal(planes.mode, 'full'); assert.match(planes.reason, /measure-plane set changed/);
  const invSel = planIncremental(input({ invariantIds: ['i3'] })).plan;
  assert.equal(invSel.lanes.baseline.reuse, false); assert.equal(invSel.lanes.appsec.reuse, true);
  const structural = planIncremental(input({ gitDiff: () => ({ ok: true, files: [{ status: 'M', path: 'package.json' }] }) })).plan;
  assert.equal(structural.comprehend, 'rerun'); assert.match(structural.comprehendWhy, /dependency manifest/);
  assert.equal(structural.lanes.appsec.reuse, true, 'a structural repo still tries lane reuse');
});

test('planIncremental: full scans — no baseline / requested / forced (depth, age) / unknown repo / repo set differs', () => {
  assert.match(planIncremental(input({ baseline: null, baselineReason: 'no earlier scan' })).plan.reason, /no earlier scan/);
  assert.match(planIncremental(input({ fullRescan: true })).plan.reason, /Full rescan requested/);
  const deep = planIncremental(input({ baseline: { ...input().baseline!, depth: 4 } })).plan;
  assert.equal(deep.mode, 'full'); assert.match(deep.forcedFull ?? '', /4 incremental run\(s\) deep/);
  const old = planIncremental(input({ baseline: { ...input().baseline!, lastFullAt: '2026-08-01T00:00:00.000Z' } })).plan;
  assert.match(old.reason, /58 days ago/);
  assert.match(planIncremental(input({ gitDiff: () => ({ ok: false, reason: 'base SHA a1 is not in the clone (force-push or history rewrite)' }) })).plan.reason, /force-push/);
  assert.match(planIncremental(input({ repos: [{ fullName: 'acme/app', dir: 'app', sha: 'b2' }, { fullName: 'acme/lib', dir: 'lib', sha: 'c' }] })).plan.reason, /\+acme\/lib/);
  assert.match(planIncremental(input({ settings: { ...incrSettings({ THERESA_INCR: '0' }) } })).plan.reason, /THERESA_INCR=0/);
  assert.match(planIncremental(input({ localDirs: [{ path: '/x', name: 'x', files: 1, bytes: 2 }] })).plan.reason, /local folder x/);
});

test('incrSettings: env-tunable with defaults', () => {
  assert.deepEqual(incrSettings({}), { enabled: true, smallMaxFiles: 200, forceFullEvery: 4, forceFullDays: 30, findingCarry: true, deltaMaxFiles: 20, deltaMaxProblems: 2 });
  assert.deepEqual(incrSettings({ THERESA_INCR_SMALL_MAX_FILES: '50', THERESA_INCR_FORCE_FULL_EVERY: '0', THERESA_INCR_FINDING_CARRY: '0', THERESA_INCR_DELTA_MAX_FILES: '0', THERESA_INCR_DELTA_MAX_PROBLEMS: '3' }), { enabled: true, smallMaxFiles: 50, forceFullEvery: 0, forceFullDays: 30, findingCarry: false, deltaMaxFiles: 0, deltaMaxProblems: 3 });
});

test('estimateIncremental: unchanged ≈ the reports only; changed = reports + low lanes … every lane; bounded by the full cost', () => {
  const b = { ...input().baseline!, laneSpend: { a: 3, b: 4 }, nodeSpend: { discovery: 1, bundle: 7, audit: 1, reserve: 2 }, totalSpend: 11, fullSpendUsd: 14 };
  assert.deepEqual(estimateIncremental(b, { changedRepos: 0, totalRepos: 1 }), { lowUsd: 1, highUsd: 2, fullUsd: 14 });
  const e = estimateIncremental(b, { changedRepos: 1, totalRepos: 1, changedLanesLow: 3 });
  assert.equal(e.lowUsd, 5.3); assert.equal(e.highUsd, 11); assert.equal(e.fullUsd, 14);
});

// ── review fixes ────────────────────────────────────────────────────────────────────────────────────────────────────
test('grep probes are line-anchored (m flag); a leading (?i) becomes the i flag; an unknown inline flag is uncompilable', () => {
  assert.ok(compileProbe('^import .*lodash')!.test('// header\nimport x from "lodash"'), '^ anchors at every line, like ripgrep');
  assert.ok(compileProbe('(?i)select \*')!.test('SELECT * FROM t'));
  assert.equal(compileProbe('(?x) a b'), null);
  const lane = { bundleId: 'x', readSet: [], greps: [{ path: 'acme/app', pattern: '^import .*lodash' }] };
  assert.equal(laneReadSetDecision(lane, [ch('src/a.ts', 'M', '// c\nimport _ from "lodash"', '// c\n')]).reuse, false, 'a line-anchored probe that newly matches mid-file re-runs the lane');
  assert.equal(laneReadSetDecision({ ...lane, greps: [{ path: 'acme/app', pattern: '(?i)LODASH' }] }, [ch('src/a.ts', 'M', 'lodash', '')]).reuse, false);
});

test('slash globs match the repo-relative / scope-relative path too; an unevaluable glob counts as matching', () => {
  assert.ok(globMatchesAny('src/**/*.ts', ['acme/app/src/x.ts', 'src/x.ts']));
  assert.ok(globMatchesAny('src/[ab].ts', ['nothing']), 'a character class is not modelled → conservative match');
  assert.ok(globMatchesAny('src\**\*.ts', ['src/a/b.ts']), 'a backslash glob is normalized');
  const g = { bundleId: 'x', readSet: [], globs: ['src/**/*.ts'] };
  assert.equal(laneReadSetDecision(g, [ch('src/new.ts', 'A')]).reuse, false, 'an un-normalized slash glob still sees the added file');
  const probe = { bundleId: 'x', readSet: [], greps: [{ path: 'acme/app', glob: 'src/**/*.ts', pattern: 'secret' }] };
  assert.equal(laneReadSetDecision(probe, [ch('src/deep/k.ts', 'M', 'const secret = 1', '')]).reuse, false, 'the probe glob is relative to its scope');
  assert.equal(laneReadSetDecision(probe, [ch('lib/k.ts', 'M', 'const secret = 1', '')]).reuse, true, 'outside the glob → still reusable');
});

test('a failed / budget-cut / plan-empty baseline lane is never reused (a lint cap overflow is)', () => {
  assert.match(laneReadSetDecision({ bundleId: 'x', readSet: [], gaps: [{ status: 'node_failed' }] }, []).reason, /failed/);
  assert.equal(laneReadSetDecision({ bundleId: 'x', readSet: [], gaps: [{ status: 'budget_skipped', source: 'critique' }] }, []).reuse, false);
  assert.equal(laneReadSetDecision({ bundleId: 'x', readSet: [], gaps: [{ id: 'X-PLAN-EMPTY', status: 'not_evidenceable' }] }, []).reuse, false);
  assert.equal(laneReadSetDecision({ bundleId: 'x', readSet: [], gaps: [{ status: 'budget_skipped', source: 'preflight:lint' }] }, []).reuse, true);
  assert.equal(laneIncompleteReason([{ status: 'not_evidenceable', id: 'X-H1' }]), undefined);
  // An all-unchanged target whose baseline has a failed lane takes the incremental path: that lane re-runs.
  const failed = input({ repos: [{ fullName: 'acme/app', dir: 'app', sha: 'a1' }], baselineLanes: { ...input().baselineLanes, appsec: { bundleId: 'appsec', readSet: [], gaps: [{ status: 'node_failed' }] } } });
  const p = planIncremental(failed).plan;
  assert.equal(p.mode, 'incremental'); assert.equal(p.lanes.appsec.reuse, false); assert.equal(p.lanes['data-eng'].reuse, true);
});

test('local folders need an equal CONTENT hash; a target with no repo / folder is never unchanged', () => {
  const base = input().baseline!;
  const withDir = (bh: string | undefined, h: string | undefined) => input({ repos: [], baseline: { ...base, repos: [], localDirs: [{ path: '/x', name: 'x', files: 1, bytes: 2, ...(bh ? { hash: bh } : {}) }] }, localDirs: [{ path: '/x', name: 'x', files: 1, bytes: 2, ...(h ? { hash: h } : {}) }] });
  assert.equal(planIncremental(withDir('h1', 'h1')).plan.mode, 'unchanged');
  assert.equal(planIncremental(withDir('h1', 'h2')).plan.mode, 'full', 'same count + bytes, different content');
  assert.equal(planIncremental(withDir(undefined, 'h1')).plan.mode, 'full', 'a baseline without a content hash is not comparable');
  const gcpOnly = planIncremental(input({ repos: [], baseline: { ...base, repos: [] } })).plan;
  assert.equal(gcpOnly.mode, 'full'); assert.match(gcpOnly.reason, /no repo or local folder/);
});

// ── A: DELTA lanes (an end-to-end run: 1 changed file re-ran all 4 lanes) ───────────────────────────────────────────────
test('planIncremental delta: a lane whose changed reads are few is a DELTA lane (not re-run); over the threshold / Structural / no Critic / carry off → re-run', () => {
  const lanes = {
    'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/src/pipeline.ts', 'acme/app/src/a.ts', 'acme/app/src/b.ts'] },
    appsec: { bundleId: 'appsec', readSet: ['acme/app/src/auth.ts'] },
    baseline: { bundleId: 'baseline', readSet: ['acme/app/src/pipeline.ts'] },
  };
  const { plan } = planIncremental(input({ baselineLanes: lanes }));
  assert.equal(plan.mode, 'incremental');
  assert.deepEqual(plan.lanes['data-eng'].delta, { files: ['acme/app/src/pipeline.ts'], readCount: 3 });
  assert.equal(plan.lanes['data-eng'].reuse, false, 'a delta lane is not a whole-lane reuse');
  assert.equal(plan.lanes['data-eng'].reason, '1 of 3 read file(s) changed (acme/app/src/pipeline.ts)');
  assert.equal(plan.lanes.appsec.reuse, true);
  assert.equal(plan.lanes.baseline.delta, undefined, 'the floor lane has no Critic → it re-runs whole');
  assert.match(plan.reason, /1\/3 lane\(s\) reused · 1 delta/);
  // Over the threshold → the old full re-run, with the count in the reason.
  const over = planIncremental(input({ baselineLanes: lanes, settings: { ...incrSettings({ THERESA_INCR_DELTA_MAX_FILES: '1' }), smallMaxFiles: 200 }, gitDiff: () => ({ ok: true, files: [{ status: 'M', path: 'src/pipeline.ts' }, { status: 'M', path: 'src/a.ts' }] }) })).plan;
  assert.equal(over.lanes['data-eng'].delta, undefined);
  assert.match(over.lanes['data-eng'].reason, /2 of its read file\(s\) changed \(> 1, too many for a delta\)/);
  assert.equal(planIncremental(input({ baselineLanes: lanes, settings: { ...incrSettings({ THERESA_INCR_DELTA_MAX_FILES: '0' }), smallMaxFiles: 200 } })).plan.lanes['data-eng'].delta, undefined, '0 = delta lanes off');
  assert.equal(planIncremental(input({ baselineLanes: lanes, settings: { ...incrSettings({ THERESA_INCR_FINDING_CARRY: '0' }), smallMaxFiles: 200 } })).plan.lanes['data-eng'].delta, undefined, 'a delta needs carry-forward');
  // A Structural repo (a manifest changed) never takes the delta path.
  const st = planIncremental(input({ baselineLanes: { 'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/package.json'] } }, gitDiff: () => ({ ok: true, files: [{ status: 'M', path: 'package.json' }] }) })).plan;
  assert.equal(st.lanes['data-eng'].delta, undefined);
  // Opaque reads / an incomplete baseline lane cannot be judged per file → re-run.
  assert.equal(planIncremental(input({ baselineLanes: { 'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/src/pipeline.ts'], opaque: ['codeintel:q'] } } })).plan.lanes['data-eng'].delta, undefined);
  assert.equal(planIncremental(input({ baselineLanes: { 'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/src/pipeline.ts'], gaps: [{ status: 'node_failed' }] } } })).plan.lanes['data-eng'].delta, undefined);
  // Strict compat still wins: a changed playbook re-runs the lane even when its reads barely changed.
  assert.equal(planIncremental(input({ baselineLanes: lanes, registry: { ...REG, bundleHashes: { ...REG.bundleHashes, 'data-eng': 'NEW' } } })).plan.lanes['data-eng'].delta, undefined);
});

test('laneReadSetDecision hits: every changed file the lane depends on (read / glob-added / grep), current names', () => {
  const lane = { bundleId: 'data-eng', readSet: ['acme/app/src/pipeline.ts'], globs: ['acme/app/src/**/*.sql'], greps: [{ path: 'acme/app', pattern: 'revenue' }] };
  const d = laneReadSetDecision(lane, [ch('src/pipeline.ts'), ch('src/q.sql', 'A'), ch('src/x.ts', 'M', 'revenue', ''), ch('README.md', 'M', 'hi', 'ho')]);
  assert.deepEqual(d.hits, ['acme/app/src/pipeline.ts', 'acme/app/src/q.sql', 'acme/app/src/x.ts']);
  assert.match(d.reason, /it read acme\/app\/src\/pipeline\.ts/, 'the first reason is unchanged');
  assert.deepEqual(laneReadSetDecision(lane, [ch('README.md', 'M', 'hi', 'ho')]).hits, []);
  assert.equal(laneReadSetDecision({ bundleId: 'x', readSet: [], opaque: ['q'] }, [ch('a.ts')]).hits, undefined);
});

// ── incremental re-scan fixes ──────────────────────────────────────────────────────────────────────────────────────────────
test('a package.json edit is a dependency-manifest change only when a dependency field moved', () => {
  const base = { name: 'umami', version: '3.3.0', scripts: { build: 'next build', 'start-docker': 'pnpm run start:docker' }, dependencies: { next: '15.0.0', react: '19.0.0' }, devDependencies: { tsx: '4' } };
  const j = (o: unknown): string => JSON.stringify(o, null, 2);
  assert.equal(packageJsonDepsChanged(j(base), j({ ...base, version: '3.4.0', scripts: { build: 'next build' }, description: 'x' })), false, 'version / scripts / description only');
  assert.equal(packageJsonDepsChanged(j(base), j({ ...base, dependencies: { react: '19.0.0', next: '15.0.0' } })), false, 'key order is not a change');
  assert.equal(packageJsonDepsChanged(j(base), j({ ...base, dependencies: { ...base.dependencies, next: '15.1.0' } })), true, 'a dependency bump');
  for (const k of ['devDependencies', 'peerDependencies', 'optionalDependencies', 'engines', 'workspaces', 'overrides', 'resolutions']) assert.equal(packageJsonDepsChanged(j(base), j({ ...base, [k]: { added: '1' } })), true, k);
  assert.equal(packageJsonDepsChanged(undefined, j(base)), undefined, 'a missing side → unknown');
  assert.equal(packageJsonDepsChanged('{ not json', j(base)), undefined, 'unparseable → unknown');
  // classifyRepo: scripts-only ⇒ Small; deps / unknown / an ADDED package.json / pyproject ⇒ still Structural.
  const scriptsOnly = { depsChanged: () => false };
  assert.equal(classifyRepo([{ status: 'M', path: 'package.json' }, { status: 'M', path: 'src/a.tsx' }], S, undefined, scriptsOnly).cls, 'small');
  assert.match(classifyRepo([{ status: 'M', path: 'package.json' }], S, undefined, scriptsOnly).reason, /no dependency field changed/);
  assert.equal(classifyRepo([{ status: 'M', path: 'package.json' }], S, undefined, { depsChanged: () => true }).cls, 'structural');
  assert.equal(classifyRepo([{ status: 'M', path: 'package.json' }], S, undefined, { depsChanged: () => undefined }).cls, 'structural', 'unknown stays conservative');
  assert.equal(classifyRepo([{ status: 'M', path: 'package.json' }], S).cls, 'structural', 'no judge ⇒ conservative (old behavior)');
  assert.equal(classifyRepo([{ status: 'A', path: 'pkgs/new/package.json' }], S, undefined, scriptsOnly).cls, 'structural', 'a new package is structural');
  assert.equal(classifyRepo([{ status: 'M', path: 'pyproject.toml' }], S, undefined, scriptsOnly).cls, 'structural', 'pyproject stays conservative');
  assert.equal(classifyRepo([{ status: 'M', path: 'package.json' }, { status: 'M', path: 'pnpm-lock.yaml' }], S, undefined, scriptsOnly).cls, 'structural', 'a lockfile change is still structural');
});

test('planIncremental — a scripts-only package.json change keeps Comprehend and makes its reader a DELTA lane', () => {
  const oldPkg = JSON.stringify({ name: 'app', version: '1.0.0', scripts: { a: 'x', b: 'y' }, dependencies: { lodash: '4' } });
  const newPkg = JSON.stringify({ name: 'app', version: '1.1.0', scripts: { a: 'x' }, dependencies: { lodash: '4' } });
  const inp = input({
    gitDiff: () => ({ ok: true, files: [{ status: 'M', path: 'package.json' }, { status: 'M', path: 'src/ui.tsx' }] }),
    textAt: (_r, sha, p) => (p === 'package.json' ? (sha === 'HEAD' ? newPkg : oldPkg) : 'x'),
    baselineLanes: {
      'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/package.json', 'acme/app/src/pipeline.ts'] },
      appsec: { bundleId: 'appsec', readSet: ['acme/app/src/auth.ts'] },
    },
  });
  const { plan } = planIncremental(inp);
  assert.equal(plan.repos[0].cls, 'small');
  assert.equal(plan.comprehend, 'reuse');
  assert.ok(plan.lanes['data-eng'].delta, 'the lane that read package.json still sees it changed — as a delta, not a full re-run');
  assert.deepEqual(plan.lanes['data-eng'].delta!.files, ['acme/app/package.json']);
  assert.equal(plan.lanes.appsec.reuse, true);
  // The same diff with a dependency bump stays Structural (Comprehend re-runs, no delta lanes).
  const dep = planIncremental({ ...inp, textAt: (_r, sha, p) => (p === 'package.json' ? (sha === 'HEAD' ? JSON.stringify({ name: 'app', dependencies: { lodash: '5' } }) : oldPkg) : 'x') }).plan;
  assert.equal(dep.repos[0].cls, 'structural'); assert.equal(dep.comprehend, 'rerun'); assert.ok(!dep.lanes['data-eng'].delta);
});

test('hypotheses the budget left OPEN make the lane an incomplete check (never reused, never "checked")', () => {
  const hyps = [
    { id: 'saas-tenancy:h1', status: 'open', claim: 'share links never expire', decisiveMetric: 'share_expiry' },
    { id: 'saas-tenancy:h2', status: 'supported', claim: 'x', measurement: { value: 1 } },
    { id: 'saas-tenancy:h3', status: 'blocked-need-eval', claim: 'y' },
  ];
  const lo = budgetLeftOpen('saas-tenancy', hyps);
  assert.deepEqual(lo.keep.map((h) => h.id), ['saas-tenancy:h2', 'saas-tenancy:h3']);
  assert.equal(lo.gaps.length, 1);
  assert.deepEqual({ id: lo.gaps[0].id, status: lo.gaps[0].status, hyp: lo.gaps[0].hypothesisId }, { id: 'SAAS-TENANCY:H1', status: 'budget_skipped', hyp: 'saas-tenancy:h1' });
  // The recorded gap is what a later scan reads: the lane is incomplete ⇒ not reusable (old code: no gap ⇒ "complete").
  assert.match(laneIncompleteReason(lo.gaps) ?? '', /cut short by the budget/);
  assert.equal(laneReadSetDecision({ bundleId: 'saas-tenancy', readSet: [], gaps: lo.gaps }, []).reuse, false);
  assert.equal(budgetLeftOpen('x', [{ id: 'x:h1', status: 'open', measurement: { value: null } }]).gaps.length, 0, 'a measured (even null) hypothesis is not "left open"');
});
