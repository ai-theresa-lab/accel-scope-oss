// Integration-style test of the incremental re-scan planner: a FAKE baseline — a
// lineage entry + checkpoint sidecars in a temp THERESA_DATA_DIR — and a REAL git repo with two commits standing in for
// the fresh clone. Asserts the planner's decision (which lanes are reused, whether Comprehend is), the replay context it
// installs, the since-last-scan diff (from the baseline's findings checkpoint via `git show` at the baseline SHA, and
// from the keyed-findings sidecar once the run is recorded), and the run-history write (lineage + org findings store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'incr-data-'));
process.env.THERESA_DATA_DIR = dataDir;
const { ensureStore, reportArtifactPath } = await import('../store.ts');
const { writeCheckpoint } = await import('../checkpoints.ts');
const L = await import('../scanLineage.ts');
const IR = await import('./incrementalRun.ts');
const OF = await import('../orgFindings.ts');
const { CKPT_STAGE_VERSION } = await import('../checkpoints.ts');
ensureStore();

const ws = mkdtempSync(join(tmpdir(), 'incr-ws-'));
const repo = join(ws, 'app');
const git = (...a: string[]): string => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t.io', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]).toString().trim();
function write(rel: string, body: string): void { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), body); }
mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q', repo]);
write('src/auth.ts', 'export function login(u) {\n  return check(u.password);\n}\n');
write('src/pipeline.ts', 'export function nightly() {\n  db.overwrite("revenue");\n}\n');
write('src/gone.ts', 'export const legacy = 1;\n');
git('add', '-A'); git('commit', '-q', '-m', 'base');
const baseSha = git('rev-parse', 'HEAD');
write('src/pipeline.ts', 'export function nightly() {\n  db.append("revenue");\n}\n');   // the cited line is EDITED
write('src/new.ts', 'export const added = true;\n');                                   // a file ADDED under src/
git('add', '-A'); git('commit', '-q', '-m', 'change');
const headSha = git('rev-parse', 'HEAD');

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dataDir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); });

const F = (id: string, title: string, ref: string, over: Record<string, unknown> = {}) => ({ id, dimension: 'architecture', title, claim: 'c', evidence: [{ kind: 'file', ref }], businessImpact: '', recommendation: '', severity: 'high', confidence: 'high', effort: 'moderate', source: 'recommendation-audit', ...over });
const lane = (bundleId: string, extra: Record<string, unknown>) => ({ bundleId, title: bundleId, hypotheses: [{ id: `${bundleId}:h1`, claim: 'x', status: 'supported' }], mitigations: [], findings: [], gaps: [], trace: '', toolTally: {}, ...extra });

// The baseline run rs_base: lineage entry + comprehend / barrier / claim-audit / synthesis / findings sidecars.
const ORG = 'org_acme';
const run0 = { repoFilter: ['acme/app'] };
const targets = L.runTargets(run0);
const targetKey = L.targetKeyFor(targets);
const baseRun = { brief: undefined, useMemory: false, codeintel: false };
writeCheckpoint('rs_base', 'comprehend', { bundleIds: ['data-eng', 'appsec', 'swe-arch', 'baseline'], planes: [], planeKinds: [], codeintel: false, osv: false, companyType: 'saas' }, 'fp', { label: 'c' });
writeCheckpoint('rs_base', 'barrier', { lanes: {
  'data-eng': lane('data-eng', { readSet: ['acme/app/src/pipeline.ts'], spentUsd: 3 }),            // read the edited file → re-run
  appsec: lane('appsec', { readSet: ['acme/app/src/auth.ts'], greps: [{ path: 'acme/app', pattern: 'password' }], spentUsd: 2, measuredAt: '2026-09-20T00:05:00.000Z' }),  // untouched → reused
  'swe-arch': lane('swe-arch', { readSet: [], globs: ['acme/app/src/**/*.ts'], spentUsd: 1 }),       // a matching file was ADDED → re-run
  baseline: lane('baseline', { readSet: [], greps: [{ path: '.', pattern: 'revenue' }], spentUsd: 1 }),   // its search matches the edited file → re-run
} }, 'fp', { label: 'b' });
writeCheckpoint('rs_base', 'claim-audit', { audits: [{ hypothesisId: 'appsec:h1', verdict: 'accept', reason: 'ok', auditStatus: 'audited' }, { hypothesisId: 'data-eng:h1', verdict: 'accept', reason: 'ok', auditStatus: 'audited' }] }, 'fp', { label: 'ca' });
writeCheckpoint('rs_base', 'synthesis', { synthesis: null }, 'fp', { label: 's' });
writeCheckpoint('rs_base', 'findings', { findings: [
  F('APPSEC:H1', 'Password check bypass', 'app/src/auth.ts:2'),
  F('DATA-ENG:H1', 'Nightly job overwrites revenue', 'app/src/pipeline.ts:2'),
  F('DATA-ENG:H2', 'Legacy flag never read', 'app/src/gone.ts:1'),
], gaps: [], answerBack: null }, 'fp', { label: 'f' });
const reg = L.registryHashes();
L.recordLineage(ORG, targetKey, {
  v: 1, runId: 'rs_base', createdBy: 'dana@acme.io', createdAt: '2026-09-20T00:00:00.000Z', finishedAt: '2026-09-20T01:00:00.000Z', status: 'complete',
  targets, repos: [{ fullName: 'acme/app', dir: 'app', sha: baseSha }], localDirs: [], bundleIds: ['data-eng', 'appsec', 'swe-arch', 'baseline'], invariantIds: [], planeFps: [],
  briefHash: L.briefHashOf(undefined), inputsSig: L.inputsSigOf(baseRun), stageVersions: { ...CKPT_STAGE_VERSION }, ...reg,
  cuts: ['workspace', 'comprehend', 'barrier', 'claim-audit', 'synthesis', 'findings', 'reports'], laneSpend: { 'data-eng': 3, appsec: 2, 'swe-arch': 1, baseline: 1 },
  nodeSpend: { discovery: 1, bundle: 7, audit: 1, reserve: 2 }, totalSpend: 11, fullSpendUsd: 11, depth: 0, lastFullAt: '2026-09-20T01:00:00.000Z',
});

// Runs that still exist (a run the store cannot resolve is PURGED, not "exists").
const known = new Map<string, any>([['rs_base', { id: 'rs_base' }], ['rs_next', { id: 'rs_next' }]]);
function fakeCtx(run: any, live: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const ctx = {
    live: () => live, getRun: (id: string) => known.get(id), allRuns: () => [], updateRun: (r: any, m: (x: any) => void) => m(r), log: (_r: any, l: string) => { logs.push(l); },
    saveReport: () => {}, reportArtifactPath, saveCheckpoint: () => {}, finish: () => {}, fail: () => {}, sourcesFor: () => [], tenantSources: () => [], runBudget: 20, effectiveRunBudget: 20,
  };
  return { ctx: ctx as any, logs, run };
}
const newRun = (over: Record<string, unknown> = {}) => ({ id: 'rs_next', tenant: 't1', orgId: ORG, mode: 'agentic', kind: 'org', targetName: 'x', repoFilter: ['acme/app'], projectFilter: null, status: 'running', log: [], reportHtml: null, findings: 0, costUsd: null, useMemory: false, codeintel: false, createdBy: 'lee@acme.io', ...over });
const manifestAt = (sha: string) => ({ repos: [{ fullName: 'acme/app', cloneUrl: 'https://github.com/acme/app.git', dir: 'app', sha }], localDirs: [] });
const CUR = { planeFps: [], codeintel: false, osv: false };

test('two commits (delta lanes OFF): Comprehend reused (small diff); only the lane whose reads are untouched is reused; the replay context is installed', () => {
  const { ctx, logs, run } = fakeCtx(newRun());
  process.env.THERESA_INCR_DELTA_MAX_FILES = '0';
  let out: ReturnType<typeof IR.prepareIncremental>;
  try { out = IR.prepareIncremental(run, ctx, ws, manifestAt(headSha) as any, CUR)!; } finally { delete process.env.THERESA_INCR_DELTA_MAX_FILES; }
  if (!out) throw new Error('not eligible');
  assert.ok(out, 'eligible');
  const p = out.rt.plan;
  assert.equal(p.mode, 'incremental', p.reason);
  assert.equal(p.comprehend, 'reuse');
  assert.equal(p.repos[0].cls, 'small');
  assert.deepEqual(Object.fromEntries(Object.entries(p.lanes).map(([k, v]) => [k, v.reuse])), { 'data-eng': false, appsec: true, 'swe-arch': false, baseline: false });
  assert.match(p.lanes['data-eng'].reason, /it read acme\/app\/src\/pipeline\.ts, which changed/);
  assert.match(p.lanes['swe-arch'].reason, /glob acme\/app\/src\/\*\*\/\*\.ts was added \(acme\/app\/src\/new\.ts\)/);
  assert.match(p.lanes.baseline.reason, /search \/revenue\/ matches acme\/app\/src\/pipeline\.ts/);
  assert.equal(p.lanes.appsec.measuredAt, '2026-09-20T00:05:00.000Z');
  // The replay context the executor hands to orgCritiqueExpert: barrier cut, comprehend payload, reuse = {appsec}.
  assert.equal(out.spec!.ckpt, 'barrier');
  assert.deepEqual([...out.spec!.reuse], ['appsec']);
  assert.ok(out.spec!.data.comprehend, 'Comprehend is replayed');
  assert.equal(out.spec!.incremental!.audits.length, 2, 'the baseline verdicts ride along for the reused lane');
  assert.ok(out.spec!.incremental!.changedPaths.includes('acme/app/src/pipeline.ts'));
  // Phase 3 carry-forward inputs: the baseline findings + base→head SHAs per repo + the baseline dir map.
  assert.equal(out.spec!.incremental!.baselineFindings.length, 3);
  assert.deepEqual(out.spec!.incremental!.repos, [{ fullName: 'acme/app', dir: 'app', baseSha, headSha }]);
  assert.deepEqual(out.spec!.incremental!.baselineRepos, [{ fullName: 'acme/app', dir: 'app' }]);
  assert.equal(run.baselineRunId, 'rs_base');
  assert.deepEqual(run.incremental.lanesReused, ['appsec']);
  assert.ok(logs.some((l) => /^incremental: baseline rs_base \(2026-09-20 by dana\) — 1 of 1 repo\(s\) changed \(2 file\(s\)\)/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => l === 'reuse: lane data-eng not reused — it read acme/app/src/pipeline.ts, which changed'));
  assert.ok(logs.some((l) => /^reuse: lane appsec reused — .*measured 2026-09-20/.test(l)));
});

test('since last scan (from the baseline findings checkpoint via git show): persisting / changed / new / fixed', () => {
  const { ctx, run } = fakeCtx(newRun());
  const out = IR.prepareIncremental(run, ctx, ws, manifestAt(headSha) as any, CUR)!;
  const current = [
    F('APPSEC:H1', 'Password check bypass', 'app/src/auth.ts:2'),             // same text → persisting
    F('DATA-ENG:H1', 'Nightly job overwrites revenue', 'app/src/pipeline.ts:2'),  // edited line → changed
    F('DATA-ENG:H9', 'New flag added without a default', 'app/src/new.ts:1'),     // → new
  ];                                                                              // DATA-ENG:H2 (gone.ts) → fixed
  const rows = IR.keyRowsFor(current as any, ws);
  const since = IR.sinceLastScanFor(ctx, out.rt, rows, ws, new Set(['appsec', 'data-eng', 'swe-arch', 'baseline']))!;
  assert.ok(since);
  assert.deepEqual(since.statuses, ['persisting', 'changed', 'new']);
  assert.deepEqual(since.counts, { fixed: 1, new: 1, persisting: 1, changed: 1, unchecked: 0 });
  assert.equal(since.fixed[0].title, 'Legacy flag never read');
  assert.equal(since.baseline.date, '2026-09-20');
  // Not re-checked: without data-eng among the checked bundles, its vanished finding is unchecked, not fixed.
  assert.equal(IR.sinceLastScanFor(ctx, out.rt, rows, ws, new Set(['appsec']))!.counts.unchecked, 1);

  // Record the run (status complete): lineage entry (depth 1, chained) + keyed sidecar + org findings store.
  run.status = 'complete'; run.checkpoints = [{ id: 'findings' }, { id: 'barrier' }, { id: 'comprehend' }];
  IR.recordRunHistory(run, ctx, out.rt, manifestAt(headSha) as any, { bundleIds: ['data-eng', 'appsec', 'swe-arch', 'baseline'], planeFps: [], lanes: { appsec: lane('appsec', { spentUsd: 2 }) as any }, nodeSpend: { reserve: 2 }, checkedBundles: ['appsec'] }, rows, since, 4.5);
  const top = L.listLineage(ORG, targetKey)[0];
  assert.equal(top.runId, 'rs_next'); assert.equal(top.depth, 1); assert.equal(top.fullSpendUsd, 11); assert.equal(top.lastFullAt, '2026-09-20T01:00:00.000Z');
  assert.equal(top.repos[0].sha, headSha);
  const recs = OF.listTargetFindings(ORG, targetKey);
  assert.equal(recs.length, 3 + 1, 'three current + the fixed baseline row (recorded to close it)');
  assert.equal(recs.find((r) => r.title === 'Legacy flag never read')?.status, 'fixed');
  assert.equal(recs.find((r) => r.title === 'New flag added without a default')?.status, 'new');
});

test('the next run diffs against the keyed-findings SIDECAR of the recorded run; same SHA + inputs → unchanged fast path up to findings', () => {
  // rs_next (recorded above) is now the newest baseline — but it has no checkpoint sidecars of its own in this test, so
  // record a third entry pointing at rs_base's cuts under a fresh id would be artificial; instead exercise both paths:
  // (1) the sidecar read for since-last-scan, (2) the unchanged plan against rs_base by excluding rs_next.
  const { ctx } = fakeCtx(newRun({ id: 'rs_third' }));
  const rt = { orgKey: ORG, targetKey, targets, baseline: L.listLineage(ORG, targetKey)[0], plan: {} as any, summary: {} as any, repos: [{ fullName: 'acme/app', dir: 'app', sha: headSha }] };
  const rows = IR.keyRowsFor([F('APPSEC:H1', 'Password check bypass', 'app/src/auth.ts:2')] as any, ws);
  const since = IR.sinceLastScanFor(ctx, rt as any, rows, ws, new Set(['appsec', 'data-eng', 'swe-arch', 'baseline']))!;
  assert.deepEqual(since.counts, { fixed: 2, new: 0, persisting: 1, changed: 0, unchecked: 0 }, 'from rs_next\'s sidecar: 3 rows, 1 persists');
  // "persisting since <date>" is the org store's FIRST-SEEN date (rs_base was never recorded in the store here, so the
  // first record is rs_next's, written today) — not merely the baseline's date.
  assert.equal(since.tags['APPSEC:H1'].since, new Date().toISOString().slice(0, 10));

  // Unchanged: a lineage whose newest usable entry is rs_base at the SAME SHA as the workspace.
  const tk2 = L.targetKeyFor(['gh:acme/same@default']);
  L.recordLineage(ORG, tk2, { ...L.listLineage(ORG, targetKey).find((e) => e.runId === 'rs_base')!, targets: ['gh:acme/same@default'], repos: [{ fullName: 'acme/same', dir: 'app', sha: headSha }] });
  const { ctx: c2, logs, run: r2 } = fakeCtx(newRun({ id: 'rs_same', repoFilter: ['acme/same'] }));
  const out = IR.prepareIncremental(r2, c2, ws, { repos: [{ fullName: 'acme/same', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, CUR)!;
  assert.equal(out.rt.plan.mode, 'unchanged', out.rt.plan.reason);
  assert.equal(out.spec!.ckpt, 'findings');
  assert.deepEqual([...out.spec!.reuse].sort(), ['appsec', 'baseline', 'data-eng', 'swe-arch']);
  assert.ok(out.spec!.data.findings && out.spec!.data['claim-audit'] && out.spec!.data.synthesis);
  assert.ok(logs.some((l) => /no changes since 2026-09-20 — reusing the baseline up to its findings/.test(l)));

  // Full rescan: planned as full, but the baseline is still recorded for the since-last-scan diff.
  const { ctx: c3, run: r3 } = fakeCtx(newRun({ id: 'rs_full', repoFilter: ['acme/same'], fullRescan: true }));
  const fullOut = IR.prepareIncremental(r3, c3, ws, { repos: [{ fullName: 'acme/same', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, CUR)!;
  assert.equal(fullOut.rt.plan.mode, 'full'); assert.equal(fullOut.spec, null); assert.equal(fullOut.rt.baseline?.runId, 'rs_base');
  assert.match(r3.incremental.reason, /Full rescan requested/);

  // Org isolation end to end: the same target in another org has no baseline.
  const { ctx: c4, run: r4 } = fakeCtx(newRun({ id: 'rs_other', orgId: 'org_other' }));
  const iso = IR.prepareIncremental(r4, c4, ws, manifestAt(headSha) as any, CUR)!;
  assert.equal(iso.rt.baseline, null); assert.equal(iso.rt.plan.mode, 'full');
});

test('not eligible: a deterministic run / an ask run is never planned', () => {
  const { ctx } = fakeCtx(null);
  assert.equal(IR.prepareIncremental(newRun({ mode: 'deterministic' }) as any, ctx, ws, manifestAt(headSha) as any, CUR), null);
  assert.equal(IR.prepareIncremental(newRun({ kind: 'ask' }) as any, ctx, ws, manifestAt(headSha) as any, CUR), null);
});

// ── incremental review fixes ────────────────────────────────────────────────────────────────────────────────────────
const baseEntry = () => L.listLineage(ORG, targetKey).find((e) => e.runId === 'rs_base')!;
const seed = (runId: string, target: string, over: Record<string, unknown> = {}) => {
  const tk = L.targetKeyFor([target]);
  L.recordLineage(ORG, tk, { ...baseEntry(), runId, targets: [target], repos: [{ fullName: target.slice(3, -8), dir: 'app', sha: headSha }], ...over } as any);
  return tk;
};

test('a PURGED baseline (the store no longer resolves it) is skipped — the next older entry is used', () => {
  const pick = L.selectBaseline(ORG, targetKey, { runExists: IR.runExistsIn({ getRun: (id: string) => (id === 'rs_base' ? { id } : undefined) } as any) });
  assert.equal(pick.entry?.runId, 'rs_base', 'rs_next is purged (unresolvable) → fall back to rs_base');
  assert.equal(L.selectBaseline(ORG, targetKey, { runExists: IR.runExistsIn({ getRun: () => undefined } as any) }).entry, null);
  assert.equal(IR.runExistsIn({ getRun: () => ({ trashed: true }) } as any)('x'), false);
});

test('a run with neither org nor tenant has no lineage scope → not planned (full scan, nothing recorded)', () => {
  const { ctx, logs } = fakeCtx(null);
  assert.equal(IR.prepareIncremental(newRun({ orgId: undefined, tenant: undefined }) as any, ctx, ws, manifestAt(headSha) as any, CUR), null);
  assert.ok(logs.some((l) => /no org or tenant scope/.test(l)));
});

test('an "unchanged" target whose baseline chain stops before findings is downgraded to an honest incremental replay', () => {
  writeCheckpoint('rs_short', 'comprehend', { bundleIds: ['appsec'], planes: [], codeintel: false, osv: false }, 'fp', { label: 'c' });
  writeCheckpoint('rs_short', 'barrier', { lanes: { appsec: lane('appsec', { readSet: [] }) } }, 'fp', { label: 'b' });
  known.set('rs_short', { id: 'rs_short' });
  seed('rs_short', 'gh:acme/short@default');
  const { ctx, run } = fakeCtx(newRun({ id: 'rs_s2', repoFilter: ['acme/short'] }));
  const out = IR.prepareIncremental(run, ctx, ws, { repos: [{ fullName: 'acme/short', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, CUR)!;
  assert.equal(out.rt.plan.mode, 'incremental', out.rt.plan.reason);
  assert.match(out.rt.plan.reason, /checkpoint chain stops at barrier/);
  assert.equal(out.spec!.ckpt, 'barrier'); assert.deepEqual([...out.spec!.reuse], ['appsec']);
});

test('reusing nothing is a FULL scan — in the plan (unreadable comprehend, no lane) and in the recorded drift counter', () => {
  writeCheckpoint('rs_empty', 'barrier', { lanes: {} }, 'fp', { label: 'b' });
  known.set('rs_empty', { id: 'rs_empty' });
  const tk = seed('rs_empty', 'gh:acme/empty@default', { repos: [{ fullName: 'acme/empty', dir: 'app', sha: baseSha }], depth: 2 });
  const { ctx, run } = fakeCtx(newRun({ id: 'rs_e2', repoFilter: ['acme/empty'] }));
  const out = IR.prepareIncremental(run, ctx, ws, { repos: [{ fullName: 'acme/empty', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, CUR)!;
  assert.equal(out.rt.plan.mode, 'full', out.rt.plan.reason); assert.equal(out.spec, null);
  // A plan that promised reuse but replayed nothing at execute time also records a full scan (depth 0, lastFullAt now).
  run.status = 'complete'; run.checkpoints = [{ id: 'findings' }];
  const rt = { ...out.rt, plan: { ...out.rt.plan, mode: 'incremental' as const } };
  IR.recordRunHistory(run, ctx, rt, { repos: [{ fullName: 'acme/empty', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, { bundleIds: [], planeFps: [], lanes: {}, nodeSpend: {}, checkedBundles: [], reused: { comprehend: false, lanes: [] } }, [], null, 3);
  const top = L.listLineage(ORG, tk)[0];
  assert.equal(top.runId, 'rs_e2'); assert.equal(top.depth, 0); assert.notEqual(top.lastFullAt, baseEntry().lastFullAt); assert.equal(top.fullSpendUsd, 3);
});

test('a manual resume child continues its parent\'s drift chain instead of restarting at depth 0', () => {
  // rs_next (recorded by the since-last-scan test) is depth 1 against rs_base; its resume child inherits that.
  const { ctx, run } = fakeCtx(newRun({ id: 'rs_resumed' }), { resumeSpec: { parentId: 'rs_next' } });
  const out = IR.prepareIncremental(run, ctx, ws, manifestAt(headSha) as any, CUR)!;
  assert.equal(out.rt.plan.mode, 'full');
  assert.deepEqual(out.rt.inherit, { depth: 1, lastFullAt: '2026-09-20T01:00:00.000Z', fullSpendUsd: 11, baselineRunId: 'rs_base' });
  run.status = 'complete'; run.checkpoints = [{ id: 'findings' }];
  IR.recordRunHistory(run, ctx, out.rt, manifestAt(headSha) as any, { bundleIds: [], planeFps: [], lanes: {}, nodeSpend: {}, checkedBundles: [] }, [], null, 2);
  const e = L.listLineage(ORG, targetKey).find((x) => x.runId === 'rs_resumed')!;
  assert.equal(e.depth, 1); assert.equal(e.lastFullAt, '2026-09-20T01:00:00.000Z'); assert.equal(e.fullSpendUsd, 11);
  // A parent that never completed but ran incrementally against rs_base: one step deeper than rs_base.
  known.set('rs_failed', { id: 'rs_failed', baselineRunId: 'rs_base', incremental: { mode: 'incremental', baselineRunId: 'rs_base' } });
  assert.deepEqual(IR.resumeInheritance(ctx, ORG, targetKey, 'rs_failed'), { depth: 1, lastFullAt: '2026-09-20T01:00:00.000Z', fullSpendUsd: 11, baselineRunId: 'rs_base' });
});

test('GCP findings (outside the since-last-scan diff) are not written to the org store as "new" every run', () => {
  const tk = seed('rs_gcpbase', 'gh:acme/gcp@default');
  known.set('rs_gcpbase', { id: 'rs_gcpbase' });
  const { ctx, run } = fakeCtx(newRun({ id: 'rs_g2', repoFilter: ['acme/gcp'] }));
  const out = IR.prepareIncremental(run, ctx, ws, { repos: [{ fullName: 'acme/gcp', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, CUR)!;
  const rows = IR.keyRowsFor([F('APPSEC:H1', 'Password check bypass', 'app/src/auth.ts:2'), F('GCP-1', 'Public bucket', 'b', { source: 'gcp-iam', evidence: [] })] as any, ws);
  run.status = 'complete'; run.checkpoints = [{ id: 'findings' }];
  IR.recordRunHistory(run, ctx, out.rt, { repos: [{ fullName: 'acme/gcp', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any, { bundleIds: [], planeFps: [], lanes: {}, nodeSpend: {}, checkedBundles: [] }, rows, null, 1);
  const recs = OF.listTargetFindings(ORG, tk);
  assert.deepEqual(recs.map((r) => r.title), ['Password check bypass']);
});

test('the baseline findings cut hands its carried + pending records to the replay; pending rows ride the keyed sidecar and never read "fixed"', () => {
  const carried = { 'data-eng': { findings: [F('DATA-ENG:PREV-H2', 'Auth token logged', 'app/src/auth.ts:2')], hypotheses: [], mitigations: [] } };
  const pending = [{ bundleId: 'data-eng', finding: F('DATA-ENG:H7', 'Stale rollup view', 'app/src/pipeline.ts:2'), why: 'budget' }];
  writeCheckpoint('rs_cbase', 'comprehend', { bundleIds: ['data-eng'], planes: [], codeintel: false, osv: false }, 'fp', { label: 'c' });
  writeCheckpoint('rs_cbase', 'barrier', { lanes: { 'data-eng': lane('data-eng', { readSet: ['acme/app/src/pipeline.ts'] }) } }, 'fp', { label: 'b' });
  writeCheckpoint('rs_cbase', 'findings', { findings: carried['data-eng'].findings, gaps: [], answerBack: null, carried, pending }, 'fp', { label: 'f' });
  known.set('rs_cbase', { id: 'rs_cbase' });
  const tk = seed('rs_cbase', 'gh:acme/carry@default', { repos: [{ fullName: 'acme/carry', dir: 'app', sha: baseSha }] });
  const { ctx, run } = fakeCtx(newRun({ id: 'rs_c2', repoFilter: ['acme/carry'] }));
  const m = { repos: [{ fullName: 'acme/carry', cloneUrl: 'u', dir: 'app', sha: headSha }], localDirs: [] } as any;
  const out = IR.prepareIncremental(run, ctx, ws, m, CUR)!;
  assert.equal(out.rt.plan.mode, 'incremental', out.rt.plan.reason);
  assert.deepEqual(out.spec!.incremental!.baselineCarried, carried);
  assert.deepEqual(out.spec!.incremental!.baselinePending, pending);
  // Record this run with the prior item STILL pending: the sidecar keeps it as a pending baseline row …
  run.status = 'complete'; run.checkpoints = [{ id: 'findings' }];
  IR.recordRunHistory(run, ctx, out.rt, m, { bundleIds: ['data-eng'], planeFps: [], lanes: {}, nodeSpend: {}, checkedBundles: ['data-eng'], pending: [pending[0].finding as any] }, [], null, 1);
  known.set('rs_c2', { id: 'rs_c2' });
  // … so the NEXT run, which does not re-find it and re-checks nothing, reports it "not re-checked" — not fixed.
  const rt3 = { ...out.rt, baseline: L.listLineage(ORG, tk)[0] };
  assert.equal(rt3.baseline.runId, 'rs_c2');
  const loose = (f: any) => (IR.keyRowsFor([f], undefined)[0]).looseKey;
  const since = IR.sinceLastScanFor(ctx, rt3 as any, [], ws, new Set(['data-eng']), new Set([loose(pending[0].finding)]))!;
  assert.deepEqual(since.counts, { fixed: 0, new: 0, persisting: 0, changed: 0, unchecked: 1 });
  assert.equal(OF.listTargetFindings(ORG, tk).length, 0, 'a pending row is not a current finding in the org store');
});

test('canBeFixedIn — all repos unchanged ⇒ nothing fixed; an unknown repo is fixable only when every repo changed', () => {
  const repos = [{ dir: 'web' }, { dir: 'api' }];
  // Every repo unchanged: nothing can be fixed, path or not.
  assert.equal(IR.canBeFixedIn(undefined, repos, new Set(['web', 'api'])), false, 'a path-less measurement in a multi-repo workspace (was: true)');
  assert.equal(IR.canBeFixedIn('web/src/a.ts', repos, new Set(['web', 'api'])), false);
  // One repo unchanged: a finding of the changed repo may be fixed, one of the unchanged repo may not.
  const one = new Set(['web']);
  assert.equal(IR.canBeFixedIn('api/src/a.ts', repos, one), true);
  assert.equal(IR.canBeFixedIn('web/src/a.ts', repos, one), false);
  assert.equal(IR.canBeFixedIn(undefined, repos, one), false, 'unknown repo + some repo unchanged (was: true)');
  assert.equal(IR.canBeFixedIn('metric:probe:x', repos, one), false, 'a non-file primary evidence (no repo head)');
  // Every repo changed: anything may be fixed.
  assert.equal(IR.canBeFixedIn(undefined, repos, new Set()), true);
  // One-repo workspace: a repo-relative / path-less finding belongs to it.
  assert.equal(IR.canBeFixedIn('src/a.ts', [{ dir: 'app' }], new Set(['app'])), false);
  assert.equal(IR.canBeFixedIn(undefined, [{ dir: 'app' }], new Set()), true);
});

test('an OLD keyed sidecar row (no metric / evStems) goes through asKeyed and fuzzy-matches on its title only', async () => {
  const { diffSinceLastScan } = await import('../sinceLastScan.ts');
  const old = { id: 'RELEASE-ENG:H1', title: 'Release workflow lacks provenance attestation', severity: 'medium', source: 'recommendation-audit', ruledOut: false, key: 'k1', evidenceKey: 'e1', looseKey: 'l1', bundleId: 'release-eng', invariant: 're2' };
  const b = IR.asKeyed(old);
  assert.deepEqual(b.fz?.stems, []); assert.equal(b.fz?.metric, undefined); assert.equal(b.fz?.invariant, 're2');
  const cur = IR.asKeyed({ ...old, id: 'RELEASE-ENG:H3', title: 'No provenance attestation in the release workflow', key: 'k2', evidenceKey: 'e2', looseKey: 'l2', metric: 'attestation_coverage', evStems: ['metric:probe:read(main.yml)'] });
  assert.deepEqual(diffSinceLastScan([cur], [b], { runId: 'rs_old', date: '2026-09-01' }).statuses, ['persisting']);
  // Invariant-less old rows (deep-audit findings) never pair without a metric — and never throw.
  const noInv = IR.asKeyed({ ...old, invariant: undefined });
  const d = diffSinceLastScan([IR.asKeyed({ ...old, id: 'RELEASE-ENG:H3', invariant: undefined, key: 'k2', evidenceKey: 'e2', looseKey: 'l2', title: 'No provenance attestation in the release workflow' })], [noInv], { runId: 'rs_old', date: '2026-09-01' });
  assert.deepEqual(d.statuses, ['new']);
});

test('withActivation — a planned lane whose bundle Comprehend did not activate is "not activated", not "re-ran"', () => {
  const s: import('./incrementalRun.ts').IncrementalSummary = { mode: 'incremental', reason: 'r', lanesReused: ['analytics'], lanesRerun: ['data-eng', 'api-stability', 'saas-tenancy', 'product-logic'].map((id) => ({ id, reason: 'it read umami-software/umami/package.json, which changed' })), lanesDelta: [], repos: [], changedFiles: 5 };
  const w = IR.withActivation(s, ['analytics', 'saas-tenancy', 'product-logic']);
  assert.deepEqual(w.lanesRerun.map((l) => l.id), ['saas-tenancy', 'product-logic']);
  assert.deepEqual(w.lanesNotActivated?.map((l) => l.id), ['data-eng', 'api-stability']);
  assert.deepEqual(w.lanesReused, ['analytics']);
  // A newly activated bundle the baseline had no lane for runs fresh; a reused lane not activated is not reused either.
  const w2 = IR.withActivation(s, ['saas-tenancy', 'appsec']);
  assert.deepEqual(w2.lanesReused, []);
  assert.ok(w2.lanesNotActivated?.some((l) => l.id === 'analytics'));
  assert.match(w2.lanesRerun.find((l) => l.id === 'appsec')?.reason ?? '', /not in the baseline/);
  assert.equal(IR.withActivation(w, ['analytics', 'saas-tenancy', 'product-logic']).lanesNotActivated?.length, 2, 'idempotent');
  const full: import('./incrementalRun.ts').IncrementalSummary = { ...s, mode: 'full' };
  assert.equal(IR.withActivation(full, []), full);
});
