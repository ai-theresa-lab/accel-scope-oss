import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'scanbase-'));
process.env.THERESA_DATA_DIR = dir;
const L = await import('../scanLineage.ts');
const { scanBaselineInfo, resolveBaselineFilters } = await import('./scanBaseline.ts');
const { CKPT_STAGE_VERSION } = await import('../checkpoints.ts');
test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

const targets = ['gh:acme/app@default', 'gh:acme/lib@default'];
const tk = L.targetKeyFor(targets);
L.recordLineage('org_a', tk, {
  v: 1, runId: 'rs_b', createdBy: 'dana@acme.io', createdAt: '2026-09-20T00:00:00.000Z', finishedAt: '2026-09-20T01:00:00.000Z', status: 'complete', targets,
  repos: [{ fullName: 'acme/app', dir: 'app', sha: 'a'.repeat(40) }, { fullName: 'acme/lib', dir: 'lib', sha: 'b'.repeat(40) }], localDirs: [],
  bundleIds: [], invariantIds: [], planeFps: [], briefHash: '', inputsSig: '', stageVersions: { ...CKPT_STAGE_VERSION }, ...L.registryHashes(),
  cuts: ['findings'], laneSpend: { 'data-eng': 3, appsec: 2 }, nodeSpend: { discovery: 1, bundle: 5, audit: 1, reserve: 2 }, totalSpend: 9, fullSpendUsd: 14, depth: 0, lastFullAt: '2026-09-20T01:00:00.000Z',
});
const access = [{ fullName: 'acme/app', cloneUrl: 'u1' }, { fullName: 'acme/lib', cloneUrl: 'u2' }];
const lanes = () => ({ 'data-eng': { bundleId: 'data-eng', readSet: ['acme/app/src/p.ts'] }, appsec: { bundleId: 'appsec', readSet: ['acme/lib/src/x.ts'] } });

test('scanBaselineInfo: one repo moved → changed count, file count, estimate = reports + the predicted lane cost (±)', async () => {
  const info = await scanBaselineInfo('org_a', tk, access, {
    headSha: async (r) => (r.fullName === 'acme/app' ? 'c'.repeat(40) : 'b'.repeat(40)),
    compare: async () => [{ status: 'modified', path: 'src/p.ts' }, { status: 'added', path: 'README.md' }],
    lanes, now: new Date('2026-09-25T00:00:00Z'),
  });
  assert.equal(info.baseline?.runId, 'rs_b'); assert.equal(info.baseline?.by, 'dana@acme.io');
  assert.deepEqual(info.repos, { total: 2, changed: 1, files: 2, unknown: 0 });
  // Point = reserve 2 + data-eng as a DELTA lane (1 changed read ⇒ 0.25 × $3) + audit 1 × (0.75 / 5)
  // = 2.90 (appsec reused, the repo Small ⇒ no Comprehend); range −20 % / +30 %.
  assert.deepEqual(info.estimate, { lowUsd: 2.32, highUsd: 3.77, fullUsd: 14 });
  assert.equal(info.full, undefined);
  // Delta lanes off ⇒ the changed lane is counted at its full cost (the pre-delta estimate).
  process.env.THERESA_INCR_DELTA_MAX_FILES = '0';
  try {
    const off = await scanBaselineInfo('org_a', tk, access, { headSha: async (r) => (r.fullName === 'acme/app' ? 'c'.repeat(40) : 'b'.repeat(40)), compare: async () => [{ status: 'modified', path: 'src/p.ts' }], lanes, now: new Date('2026-09-25T00:00:00Z') });
    assert.deepEqual(off.estimate, { lowUsd: 4.48, highUsd: 7.28, fullUsd: 14 }, 'point = 2 + 3 + 1 × 3/5 = 5.60');
  } finally { delete process.env.THERESA_INCR_DELTA_MAX_FILES; }
});

test('scanBaselineInfo: nothing moved ≈ reports only; unreachable repos → unknown; a due periodic full scan is announced; another org sees nothing', async () => {
  const same = await scanBaselineInfo('org_a', tk, access, { headSha: async (r) => (r.fullName === 'acme/app' ? 'a'.repeat(40) : 'b'.repeat(40)), compare: async () => null, lanes, now: new Date('2026-09-25T00:00:00Z') });
  assert.deepEqual(same.repos, { total: 2, changed: 0, files: 0, unknown: 0 });
  assert.deepEqual(same.estimate, { lowUsd: 1, highUsd: 2, fullUsd: 14 });
  const blind = await scanBaselineInfo('org_a', tk, access, { headSha: async () => undefined, compare: async () => null, lanes, now: new Date('2026-09-25T00:00:00Z') });
  assert.equal(blind.repos.changed, null); assert.equal(blind.repos.unknown, 2);
  const old = await scanBaselineInfo('org_a', tk, access, { headSha: async () => 'c'.repeat(40), compare: async () => null, lanes, now: new Date('2026-11-25T00:00:00Z') });
  assert.match(old.full ?? '', /periodic full scan is due \(the last full scan was 65 days ago\)/); assert.equal(old.estimate, null);
  const other = await scanBaselineInfo('org_b', tk, access, { headSha: async () => 'x', compare: async () => null, lanes });
  assert.equal(other.baseline, null);
});

test('the baseline preview only resolves ids that are the caller\'s own connected artifacts — any foreign id ⇒ no lookup', () => {
  const srcs = [{ id: 'gh1', kind: 'github', own: ['acme/app', 'acme/lib'] }, { id: 'loc', kind: 'local', own: ['/u/t1/app'] }, { id: 'g', kind: 'gcp', own: ['p1'] }];
  const idsOf = (s: { own: string[] }) => s.own;
  assert.deepEqual(resolveBaselineFilters({ gh1: ['acme/app'], g: ['p1'] }, srcs, idsOf), { repoFilter: ['acme/app'], giturlFilter: null, localFilter: null, projectFilter: ['p1'] });
  assert.equal(resolveBaselineFilters({ gh1: ['acme/app', 'othercorp/secret'] }, srcs, idsOf), null, 'a guessed repo name is refused');
  assert.equal(resolveBaselineFilters({ loc: ['/u/t2/their-folder'] }, srcs, idsOf), null, 'another member\'s folder path is refused');
  assert.deepEqual(resolveBaselineFilters({ nope: ['x'] }, srcs, idsOf), { repoFilter: null, giturlFilter: null, localFilter: null, projectFilter: null }, 'an unknown source id selects nothing');
});

// ── baseline preview fixes ──────────────────────────────────────────────────────────────────────────────────────────
const moved = { headSha: async (r: { fullName: string }) => (r.fullName === 'acme/app' ? 'c'.repeat(40) : 'b'.repeat(40)), lanes, now: new Date('2026-09-25T00:00:00Z') };
test('the preview runs the planner’s compat checks — a code / inputs change is announced as a full scan', async () => {
  const reg = L.registryHashes();
  const compat = { codeHash: reg.codeHash, inputsSig: '', manualBundles: null, bundleHashes: reg.bundleHashes };
  const ok = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => [{ status: 'modified', path: 'src/p.ts' }], compat });
  assert.equal(ok.full, undefined); assert.ok(ok.estimate);
  const code = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => [], compat: { ...compat, codeHash: 'other' } });
  assert.equal(code.full, 'the analysis prompts / code or the model changed since the baseline', 'old preview: "est. $0.22–$0.44"');
  assert.equal(code.estimate, null); assert.equal(code.baseline?.fullUsd, 14);
  const brief = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => [], compat: { ...compat, inputsSig: 'different-brief' } });
  assert.match(brief.full ?? '', /brief \/ memory-recall \/ codeintel inputs changed/);
  const unknownMem = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => [], compat: { ...compat, inputsSig: null } });
  assert.equal(unknownMem.full, undefined, 'an unknown inputs signature (org-memory version) is not a mismatch');
});

test('diverged history is counted from both sides; no read set / no file list ⇒ "estimate unavailable"', async () => {
  const dv = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => ({ files: [{ status: 'modified', path: 'src/p.ts' }, { status: 'modified', path: 'package.json' }], diverged: true }) });
  assert.deepEqual(dv.repos, { total: 2, changed: 1, files: 2, unknown: 0, diverged: true });
  const noRs = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => [{ status: 'modified', path: 'src/p.ts' }], lanes: () => ({ 'data-eng': { bundleId: 'data-eng' } }) });
  assert.equal(noRs.estimate, null); assert.match(noRs.estimateNote ?? '', /^estimate unavailable — a baseline lane predates read-set recording/);
  const noList = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => null });
  assert.equal(noList.estimate, null); assert.match(noList.estimateNote ?? '', /changed file list could not be fetched/);
});

test('a scripts-only package.json change (judged from both sides) keeps Comprehend out of the estimate', async () => {
  const oldPkg = JSON.stringify({ name: 'app', scripts: { a: '1', b: '2' }, dependencies: { x: '1' } }), newPkg = JSON.stringify({ name: 'app', version: '2', scripts: { a: '1' }, dependencies: { x: '1' } });
  const files = [{ status: 'modified', path: 'package.json' }, { status: 'modified', path: 'src/ui.tsx' }];
  const judged = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => files, fileAt: async (_r, sha) => (sha === 'a'.repeat(40) ? oldPkg : newPkg) });
  const blind = await scanBaselineInfo('org_a', tk, access, { ...moved, compare: async () => files });
  // Both: no lane read package.json / ui.tsx ⇒ every lane reused; blind adds Comprehend (discovery $1) — conservative.
  assert.deepEqual(judged.estimate, { lowUsd: 1.6, highUsd: 2.6, fullUsd: 14 });
  assert.deepEqual(blind.estimate, { lowUsd: 2.4, highUsd: 3.9, fullUsd: 14 });
});

test('githubCompareFiles unions both sides when the baseline is not an ancestor of HEAD', async () => {
  const { githubCompareFiles } = await import('./scanBaseline.ts');
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    const fwd = /compare\/OLD\.\.\.HEAD$/.test(url);
    return { ok: true, json: async () => (fwd ? { status: 'diverged', files: [] } : { status: 'ahead', files: [{ filename: 'package.json', status: 'modified' }, { filename: 'src/a.tsx', status: 'added' }] }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const r = await githubCompareFiles({ fullName: 'umami-software/umami', cloneUrl: 'u' }, 'OLD', 'HEAD', fake);
  assert.equal(calls.length, 2);
  assert.deepEqual(r, { files: [{ status: 'modified', path: 'package.json' }, { status: 'removed', path: 'src/a.tsx' }], diverged: true }, 'old code: 0 files');
  const ahead = (async () => ({ ok: true, json: async () => ({ status: 'ahead', files: [{ filename: 'x.ts', status: 'modified' }] }) })) as unknown as typeof fetch;
  assert.deepEqual(await githubCompareFiles({ fullName: 'a/b', cloneUrl: 'u' }, 'OLD', 'HEAD', ahead), { files: [{ status: 'modified', path: 'x.ts' }] });
});

test('scanBaselineInfo: at most 6 remote probes in flight at once', async () => {
  const many = Array.from({ length: 20 }, (_, i) => `gh:acme/r${i}@default`);
  const mk = L.targetKeyFor(many);
  L.recordLineage('org_a', mk, {
    v: 1, runId: 'rs_many', createdAt: '2026-09-20T00:00:00.000Z', finishedAt: '2026-09-20T01:00:00.000Z', status: 'complete', targets: many,
    repos: many.map((_, i) => ({ fullName: `acme/r${i}`, dir: `r${i}`, sha: 'a'.repeat(40) })), localDirs: [],
    bundleIds: [], invariantIds: [], planeFps: [], briefHash: '', inputsSig: '', stageVersions: { ...CKPT_STAGE_VERSION }, ...L.registryHashes(),
    cuts: ['findings'], laneSpend: {}, nodeSpend: { discovery: 1, bundle: 1, audit: 1, reserve: 1 }, totalSpend: 4, depth: 0, lastFullAt: '2026-09-20T01:00:00.000Z',
  });
  let inFlight = 0, peak = 0;
  const probe = async <T>(v: T): Promise<T> => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return v; };
  const info = await scanBaselineInfo('org_a', mk, many.map((_, i) => ({ fullName: `acme/r${i}`, cloneUrl: `u${i}` })), {
    headSha: () => probe('c'.repeat(40)), compare: () => probe([{ status: 'modified' as const, path: 'a.ts' }]), lanes: () => ({}), now: new Date('2026-09-25T00:00:00Z'),
  });
  assert.equal(info.repos.changed, 20);
  assert.ok(peak <= 6, `peak in-flight probes ${peak}`);
});
