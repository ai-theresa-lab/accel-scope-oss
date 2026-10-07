// REGRESSION of the 2026-09-29 end-to-end incremental re-scan
// (delta lanes + measurement carry): sindresorhus/p-limit, four code-native lanes (swe-arch / release-eng / api-stability /
// appsec), ONE file changed (.github/security.md) — and the re-scan saved nothing ($13.65 vs $14.17):
//   • every lane had read security.md → `reuse: lane X not reused — it read …/.github/security.md, which changed` ×4 →
//     every lane re-ran whole;
//   • the baseline findings were code-native MEASUREMENTS with no file rows → evidenceState 'none' → all sent to a
//     re-check, and every re-check was skipped because the re-run lanes had spent past 0.80·B;
//   • the re-run lanes re-found the same defects with re-worded titles → "new" + "not re-checked".
// A FAKE baseline (lineage entry + checkpoint sidecars in a temp THERESA_DATA_DIR) and a REAL two-commit git repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'incr-e2e-data-'));
process.env.THERESA_DATA_DIR = dataDir;
const { ensureStore, reportArtifactPath } = await import('../store.ts');
const { writeCheckpoint, CKPT_STAGE_VERSION } = await import('../checkpoints.ts');
const L = await import('../scanLineage.ts');
const IR = await import('./incrementalRun.ts');
const CF = await import('./carryForward.ts');
const { gitListFiles } = await import('./incremental.ts');
const { BudgetLedger, reverifyAdmit } = await import('../research/budget.ts');
ensureStore();

const ws = mkdtempSync(join(tmpdir(), 'incr-e2e-ws-'));
const repo = join(ws, 'p-limit');
const git = (...a: string[]): string => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t.io', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a]).toString().trim();
function write(rel: string, body: string): void { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), body); }
mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q', repo]);
write('.npmrc', 'package-lock=false\n');
write('.gitignore', 'node_modules\n');
write('package.json', '{"name":"p-limit","type":"module","exports":"./index.js"}\n');
write('index.js', 'export default function pLimit(n) {\n  return n;\n}\n');
write('readme.md', '# p-limit\n');
write('.github/workflows/main.yml', 'jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n');
write('.github/security.md', 'To report a security issue, use https://tidelift.com/security.\n');
git('add', '-A'); git('commit', '-q', '-m', 'base');
const baseSha = git('rev-parse', 'HEAD');
write('.github/security.md', 'To report a security issue, please use the GitHub security advisory form.\n');   // the ONE change
git('add', '-A'); git('commit', '-q', '-m', 'security policy');
const headSha = git('rev-parse', 'HEAD');

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dataDir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); });

const FULL = 'sindresorhus/p-limit';
const LANES = ['swe-arch', 'release-eng', 'api-stability', 'appsec'];
const M = (id: string, title: string, ref: string, kind: 'metric' | 'computation' = 'metric') => ({ id, dimension: 'architecture', title, claim: `${title}.`, evidence: [{ kind, ref, detail: 'measured' }], businessImpact: '', recommendation: '', severity: 'medium', confidence: 'high', effort: 'moderate', source: 'recommendation-audit' });
// The baseline findings, measurement-style (no file rows), refs shaped like the real run's.
const BASE_FINDINGS = [
  M('SWE-ARCH:H1', 'Single-module package with no internal boundaries', 'probe:glob+read(index.js,package.json)'),
  M('RELEASE-ENG:H1', 'Release workflow lacks provenance attestation', 'probe:glob+read(.npmrc,main.yml,package.json,.gitignore)'),
  M('API-STABILITY:H1', 'No deprecation policy for the public export', 'probe:glob+read(package.json,readme.md)'),
  M('APPSEC:H1', 'GitHub Actions pinned to mutable tags', 'code:grep uses: in .github/workflows/**', 'computation'),
  M('APPSEC:H2', 'Security policy routes reports to a third-party form', 'probe:read(.github/security.md)'),   // cites the changed file
];
// Each hypothesis's metric (deep-audit findings carry no invariant, so the fuzzy tier pairs a re-worded re-find on it).
const metricOfId = (id: string): string => `metric_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
const hypsOf = (lane: string) => BASE_FINDINGS.filter((f) => f.id.toLowerCase().startsWith(lane + ':')).map((f) => ({ id: f.id.toLowerCase(), claim: f.claim, symptom: 's', status: 'supported', decisiveMetric: metricOfId(f.id) }));
// Every lane READ security.md (the root cause of 4× "not reused") plus its own files.
const readSets: Record<string, string[]> = {
  'swe-arch': ['index.js', 'package.json', '.github/security.md'],
  'release-eng': ['.npmrc', 'package.json', '.gitignore', '.github/workflows/main.yml', '.github/security.md'],
  'api-stability': ['package.json', 'readme.md', '.github/security.md'],
  appsec: ['.github/workflows/main.yml', '.github/security.md', 'package.json'],
};
const ORG = 'org_e2e';
const targets = L.runTargets({ repoFilter: [FULL] });
const targetKey = L.targetKeyFor(targets);
writeCheckpoint('rs_e2e_base', 'comprehend', { bundleIds: LANES, planes: [], planeKinds: [], codeintel: false, osv: false, companyType: 'library' }, 'fp', { label: 'c' });
writeCheckpoint('rs_e2e_base', 'barrier', { lanes: Object.fromEntries(LANES.map((l) => [l, { bundleId: l, title: l, hypotheses: hypsOf(l), mitigations: [], findings: [], gaps: [], trace: '', toolTally: {}, readSet: readSets[l].map((p) => `${FULL}/${p}`), spentUsd: 3.2 }])) }, 'fp', { label: 'b' });
writeCheckpoint('rs_e2e_base', 'claim-audit', { audits: BASE_FINDINGS.map((f) => ({ hypothesisId: f.id.toLowerCase(), verdict: 'accept', reason: 'ok', auditStatus: 'audited' })) }, 'fp', { label: 'ca' });
writeCheckpoint('rs_e2e_base', 'synthesis', { synthesis: null }, 'fp', { label: 's' });
writeCheckpoint('rs_e2e_base', 'findings', { findings: BASE_FINDINGS, gaps: [], answerBack: null }, 'fp', { label: 'f' });
L.recordLineage(ORG, targetKey, {
  v: 1, runId: 'rs_e2e_base', createdBy: 'op@acme.io', createdAt: '2026-09-28T00:00:00.000Z', finishedAt: '2026-09-28T01:00:00.000Z', status: 'complete',
  targets, repos: [{ fullName: FULL, dir: 'p-limit', sha: baseSha }], localDirs: [], bundleIds: LANES, invariantIds: [], planeFps: [],
  briefHash: L.briefHashOf(undefined), inputsSig: L.inputsSigOf({ brief: undefined, useMemory: false, codeintel: false }), stageVersions: { ...CKPT_STAGE_VERSION }, ...L.registryHashes(),
  cuts: ['workspace', 'comprehend', 'barrier', 'claim-audit', 'synthesis', 'findings', 'reports'], laneSpend: Object.fromEntries(LANES.map((l) => [l, 3.2])),
  nodeSpend: { discovery: 0.6, bundle: 12.8, audit: 0.3, reserve: 0.5 }, totalSpend: 14.17, fullSpendUsd: 14.17, depth: 0, lastFullAt: '2026-09-28T01:00:00.000Z',
});

function fakeCtx(run: any) {
  const logs: string[] = [];
  const known = new Map<string, any>([['rs_e2e_base', { id: 'rs_e2e_base' }], ['rs_e2e_next', { id: 'rs_e2e_next' }]]);
  const ctx = { live: () => ({}), getRun: (id: string) => known.get(id), allRuns: () => [], updateRun: (r: any, m: (x: any) => void) => m(r), log: (_r: any, l: string) => { logs.push(l); }, saveReport: () => {}, reportArtifactPath, saveCheckpoint: () => {}, finish: () => {}, fail: () => {}, sourcesFor: () => [], tenantSources: () => [], runBudget: 20, effectiveRunBudget: 20 };
  return { ctx: ctx as any, logs };
}
const run = { id: 'rs_e2e_next', tenant: 't1', orgId: ORG, mode: 'agentic', kind: 'org', targetName: 'p-limit', repoFilter: [FULL], projectFilter: null, status: 'running', log: [], reportHtml: null, findings: 0, costUsd: null, useMemory: false, codeintel: false, createdBy: 'op@acme.io' } as any;
const manifest = { repos: [{ fullName: FULL, cloneUrl: `https://github.com/${FULL}.git`, dir: 'p-limit', sha: headSha }], localDirs: [] } as any;

test('incremental re-scan regression: 1 changed file ⇒ all 4 lanes DELTA (not re-run); measurements carried "inputs unchanged" except the one citing security.md; reworded re-finds persist; re-checks admitted at 0.85·B', async () => {
  const { ctx, logs } = fakeCtx(run);
  const out = IR.prepareIncremental(run, ctx, ws, manifest, { planeFps: [], codeintel: false, osv: false })!;
  const plan = out.rt.plan;
  assert.equal(plan.mode, 'incremental', plan.reason);
  assert.equal(plan.repos[0].cls, 'small', '.github/security.md is not CI / build config');
  // (1) all four lanes are DELTA lanes, none re-runs whole (was: 4× "not reused — it read …security.md").
  for (const l of LANES) {
    assert.deepEqual(plan.lanes[l].delta?.files, [`${FULL}/.github/security.md`], l);
    assert.ok(logs.includes(`reuse: lane ${l} Change — 1 of ${readSets[l].length} read file(s) changed (${FULL}/.github/security.md) · Change critique + ${l === 'appsec' ? 1 : 0} re-check(s)`), logs.join('\n'));
    assert.ok(!logs.some((x) => x.startsWith(`reuse: lane ${l} not reused`)), l);
  }
  assert.deepEqual(run.incremental.lanesRerun, []);
  assert.deepEqual(run.incremental.lanesDelta.map((d: any) => [d.id, d.files, d.rechecks]), [['swe-arch', 1, 0], ['release-eng', 1, 0], ['api-stability', 1, 0], ['appsec', 1, 1]]);
  assert.match(plan.reason, /0\/4 lane\(s\) reused · 4 delta/);
  const inc = out.spec!.incremental!;

  // (2) the revived findings: persisting (inputs unchanged) — their named files resolve in the workspace and did not
  // change — except APPSEC:H2, which reads security.md → a targeted re-check.
  const changed = new Set(inc.changedPaths.map((p) => p.toLowerCase()));
  const inputs = { files: gitListFiles(repo).map((p) => `${FULL}/${p}`.toLowerCase()), repos: [{ fullName: FULL, dir: 'p-limit' }] };
  const splits = Object.fromEntries(LANES.map((l) => [l, CF.deltaLaneSplit(inc.baselineFindings.filter((f) => f.id.toLowerCase().startsWith(l + ':')), changed, inc.baselineRepos, inputs)]));
  assert.deepEqual(LANES.flatMap((l) => splits[l].keep.map((k) => [k.f.id, k.note])), [['SWE-ARCH:H1', 'inputs'], ['RELEASE-ENG:H1', 'inputs'], ['API-STABILITY:H1', 'inputs'], ['APPSEC:H1', 'inputs']]);
  assert.deepEqual(LANES.flatMap((l) => splits[l].recheck.map((f) => f.id)), ['APPSEC:H2']);

  // (3) re-checks are admitted with the lanes at 0.85·B (the old !reserveInvaded() gate skipped every one).
  const ledger = new BudgetLedger(20); ledger.spend('bundle', 17);
  assert.equal(ledger.reserveInvaded(), true);
  let asked = 0;
  const carryIn = (fresh: Record<string, any[]>) => CF.runCarryForward(LANES.map((l) => ({ id: l, replayed: true, incomplete: false, fresh: fresh[l] ?? [], delta: { recheck: splits[l].recheck } })), {
    baselineAt: inc.baselineAt, baselineFindings: inc.baselineFindings, baselineLanes: inc.baselineLanes as any, baselineCarried: {}, baselinePending: [], changed, baselineRepos: inc.baselineRepos,
    reverifyMax: 6, budgetOk: () => reverifyAdmit(ledger, 0.4), reverify: async () => { asked++; return { status: 'persisting', evidence: [{ kind: 'metric', ref: 'probe:read(.github/security.md)' }], note: 'still routed to a third party' }; },
    resolves: () => true, looseKey: (f) => f.title, inputs, metricOf: (f) => curMetric(f),
  });
  // The delta critique's re-find was measured on the same metric as its baseline twin (the Expert triaged to the same id).
  const curMetric = (f: { id: string }): string => (f.id === 'APPSEC:H3' ? metricOfId('APPSEC:H2') : metricOfId(f.id));
  const noFind = await carryIn({});
  assert.equal(asked, 1, 'the one re-check RAN');
  assert.deepEqual(noFind.findings.map((f) => f.id), ['APPSEC:PREV-H2']);
  assert.equal(noFind.pending.length, 0);

  // (4) the delta critique RE-FOUND the security.md defect with a re-worded title → the fuzzy tier pairs it (no
  // re-check spent), and since-last-scan reports 0 new, 0 fixed, 5 persisting.
  asked = 0;
  const reworded = M('APPSEC:H3', 'Security reports routed to a third-party form instead of GitHub advisories', 'probe:read(.github/security.md)');
  const refind = await carryIn({ appsec: [reworded] });
  assert.equal(asked, 0); assert.equal(refind.findings.length, 0);
  const kept = LANES.flatMap((l) => splits[l].keep.map((k) => k.f));
  const rows = IR.keyRowsFor([...kept, reworded] as any, ws, curMetric);
  const since = IR.sinceLastScanFor(ctx, out.rt, rows, ws, new Set(LANES))!;
  assert.deepEqual(since.counts, { fixed: 0, new: 0, persisting: 5, changed: 0, unchecked: 0 });
  // Without the fuzzy features (the old 3-key diff) the re-worded re-find read "new" and its twin "fixed".
  const { diffSinceLastScan } = await import('../sinceLastScan.ts');
  const baseK = IR.baselineKeyedFindings(ctx, out.rt.baseline!, ws, out.rt.repos)!.map((b) => ({ f: b.f, k: b.k }));
  const curK = rows.map((r) => ({ f: { id: r.id, title: r.title, severity: r.severity as any, source: r.source }, k: { key: r.key, evidenceKey: r.evidenceKey, looseKey: r.looseKey, bundleId: r.bundleId } }));
  const old = diffSinceLastScan(curK, baseK, { runId: 'rs_e2e_base', date: '2026-09-28' }, { checkedBundles: new Set(LANES) });
  assert.deepEqual([old.counts.new, old.counts.fixed], [1, 1]);
});
