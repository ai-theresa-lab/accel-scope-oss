import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store.ts resolves THERESA_DATA_DIR at module load, so the modules are imported after the env is set.
const dir = mkdtempSync(join(tmpdir(), 'lineage-'));
process.env.THERESA_DATA_DIR = dir;
const L = await import('./scanLineage.ts');
const OF = await import('./orgFindings.ts');
const { CKPT_STAGE_VERSION } = await import('./checkpoints.ts');

function entry(runId: string, finishedAt: string, over: Record<string, unknown> = {}) {
  return {
    v: 1 as const, runId, createdBy: 'a@x.io', createdAt: finishedAt, finishedAt, status: 'complete' as const,
    targets: ['gh:acme/app@default'], repos: [{ fullName: 'acme/app', dir: 'app', sha: 'a'.repeat(40) }], localDirs: [],
    bundleIds: ['baseline'], invariantIds: [], planeFps: [], briefHash: 'b', inputsSig: 's',
    stageVersions: { ...CKPT_STAGE_VERSION }, ...L.registryHashes(), cuts: ['workspace', 'comprehend', 'barrier', 'findings'] as never[],
    laneSpend: { baseline: 1.5 }, totalSpend: 3, depth: 0, lastFullAt: finishedAt, ...over,
  };
}

test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

test('targetKey: the sorted target set — order-free, branch/kind-sensitive', () => {
  const a = L.runTargets({ repoFilter: ['Acme/App', 'acme/lib'], projectFilter: ['p1'] });
  const b = L.runTargets({ repoFilter: ['acme/lib', 'acme/app'], projectFilter: ['p1'] });
  assert.deepEqual(a, ['gcp:p1', 'gh:acme/app@default', 'gh:acme/lib@default']);
  assert.equal(L.targetKeyFor(a), L.targetKeyFor(b));
  assert.notEqual(L.targetKeyFor(L.runTargets({ giturlFilter: ['acme/app'] })), L.targetKeyFor(L.runTargets({ repoFilter: ['acme/app'] })));
  const locals = new Map([['/up/x', { sourceId: 'src_1', name: 'x' }]]);
  assert.deepEqual(L.runTargets({ localFilter: ['/up/x'] }, locals), ['local:src_1:x']);
});

test('baseline selection: newest complete entry with equal stage versions + a findings cut', () => {
  const tk = L.targetKeyFor(['gh:acme/app@default']);
  assert.equal(L.selectBaseline('org_a', tk).entry, null);
  assert.ok(L.recordLineage('org_a', tk, entry('rs_old', '2026-09-01T00:00:00.000Z')));
  assert.ok(L.recordLineage('org_a', tk, entry('rs_new', '2026-09-20T00:00:00.000Z')));
  assert.ok(L.recordLineage('org_a', tk, entry('rs_stale', '2026-09-25T00:00:00.000Z', { stageVersions: { ...CKPT_STAGE_VERSION, findings: 0 } })));
  const pick = L.selectBaseline('org_a', tk);
  assert.equal(pick.entry?.runId, 'rs_new', 'the stale-schema entry is skipped');
  assert.equal(L.selectBaseline('org_a', tk, { runExists: (id) => id !== 'rs_new' }).entry?.runId, 'rs_old', 'a purged run is skipped');
  assert.equal(L.selectBaseline('org_a', tk, { excludeRunId: 'rs_new', runExists: (id) => id === 'rs_new' }).entry, null);
});

test('org isolation: org B never sees org A\'s baseline (separate directory; orgKey checked on read)', () => {
  const tk = L.targetKeyFor(['gh:acme/app@default']);
  L.recordLineage('org_a', tk, entry('rs_a', '2026-09-26T00:00:00.000Z'));
  assert.equal(L.selectBaseline('org_b', tk).entry, null);
  assert.equal(L.listLineage('org_b', tk).length, 0);
  assert.ok(existsSync(join(dir, 'lineage', 'org_a')));
  assert.ok(!existsSync(join(dir, 'lineage', 'org_b')));
  // A traversal-shaped org id is sanitized into one plain segment under lineage/.
  // (an unsafe value is `~<sanitized>-<hash>` so it can never alias a safe one; safe values are unchanged.)
  assert.match(L.safeSeg('../../etc'), /^~__\.\._etc-[0-9a-f]{12}$/);
  assert.ok(!/[\\/]/.test(L.safeSeg('a/../b\\c')));
  assert.match(L.orgKeyFor(null, 'tenant/1')!, /^~t-tenant_1-[0-9a-f]{12}$/);
  assert.equal(L.orgKeyFor(null, 'tenant1'), 't-tenant1');
  assert.equal(L.orgKeyFor('org_x', 'tenant'), 'org_x');
});

test('retention: only the newest K entries are kept; a re-record of the same run replaces it', () => {
  const tk = L.targetKeyFor(['gh:acme/keep@default']);
  for (let i = 1; i <= 5; i++) L.recordLineage('org_k', tk, entry(`rs_${i}`, `2026-09-0${i}T00:00:00.000Z`));
  L.recordLineage('org_k', tk, entry('rs_5', '2026-09-05T00:00:00.000Z', { totalSpend: 9 }));
  const ls = L.listLineage('org_k', tk);
  assert.deepEqual(ls.map((e) => e.runId), ['rs_5', 'rs_4', 'rs_3']);
  assert.equal(ls[0].totalSpend, 9);
  assert.deepEqual(readdirSync(join(dir, 'lineage', 'org_k')), [tk + '.json']);
});

test('registry hashes: per bundle + invariants, stable within a process', () => {
  const a = L.registryHashes(); const b = L.registryHashes();
  assert.equal(a.registryHash, b.registryHash);
  assert.ok(a.bundleHashes.baseline && a.invariantHash);
  assert.notEqual(L.specHash({ f: () => 1 }), L.specHash({ f: () => 2 }), 'a changed function body changes the hash');
});

test('org findings store: first/last seen + status history; fixed closes; unmentioned rows untouched; org-scoped', () => {
  const tk = 'tk1';
  const r1 = { runId: 'rs_1', at: '2026-09-01T00:00:00.000Z', sha: 'aaa' };
  const r2 = { runId: 'rs_2', at: '2026-09-08T00:00:00.000Z', sha: 'bbb' };
  OF.recordRunFindings('org_f', tk, r1, [
    { findingKey: 'k1', title: 'A', severity: 'high', status: 'new', displayId: 'F-01' },
    { findingKey: 'k2', title: 'B', severity: 'low', status: 'new' },
    { findingKey: 'k3', title: 'C', severity: 'low', status: 'new' },
  ]);
  OF.recordRunFindings('org_f', tk, r2, [
    { findingKey: 'k1', title: 'A2', severity: 'high', status: 'persisting', displayId: 'F-02' },
    { findingKey: 'k2', title: 'B', severity: 'low', status: 'fixed' },
    { findingKey: 'k4', title: 'D', severity: 'medium', status: 'new' },
  ]);
  const k1 = OF.getOrgFinding('org_f', tk, 'k1')!;
  assert.equal(k1.firstSeen.runId, 'rs_1'); assert.equal(k1.lastSeen.runId, 'rs_2'); assert.equal(k1.title, 'A2'); assert.equal(k1.displayId, 'F-02');
  assert.deepEqual(k1.history.map((h) => h.status), ['new', 'persisting']);
  const k2 = OF.getOrgFinding('org_f', tk, 'k2')!;
  assert.equal(k2.status, 'fixed'); assert.equal(k2.lastSeen.runId, 'rs_1', 'a fixed row keeps the run that last saw it open');
  assert.equal(OF.getOrgFinding('org_f', tk, 'k3')!.history.length, 1, 'an unmentioned row is untouched');
  assert.equal(OF.listTargetFindings('org_f', tk).length, 4);
  assert.equal(OF.listOrgFindings('org_f').length, 4);
  assert.equal(OF.listOrgFindings('org_other').length, 0);
  OF.recordRunFindings('org_f', tk, r2, [{ findingKey: 'k1', title: 'A2', severity: 'high', status: 'persisting' }]);
  assert.equal(OF.getOrgFinding('org_f', tk, 'k1')!.history.length, 2, 're-recording the same run does not duplicate history');
});

// ── incremental review fixes ────────────────────────────────────────────────────────────────────────────────────────
test('safeSeg is injective (a/b vs a_b), idempotent on safe values; no org + no tenant → no lineage scope', () => {
  assert.notEqual(L.safeSeg('a/b'), L.safeSeg('a_b'));
  assert.notEqual(L.safeSeg('a/b'), L.safeSeg('a?b'));
  assert.equal(L.safeSeg('org_123'), 'org_123');
  assert.equal(L.orgKeyFor(null, null), null);
  assert.equal(L.orgKeyFor(undefined, ''), null);
  assert.notEqual(L.orgKeyFor('t-acme', null), L.orgKeyFor(null, 'acme'), 'an org id shaped like a tenant scope never aliases it');
});

test('the org-memory version enters the inputs signature only when memory recall ran', () => {
  const r = { brief: 'b', useMemory: true, codeintel: false };
  assert.equal(L.inputsSigOf(r), L.inputsSigOf(r, null), 'recall off / unavailable → the signature is unchanged');
  assert.notEqual(L.inputsSigOf(r, 3), L.inputsSigOf(r, 4));
  assert.notEqual(L.inputsSigOf(r, 3), L.inputsSigOf(r));
});

test('codeRevisionHash moves with a prompt module\'s text or a *MODEL* env var, and nothing else', () => {
  const src = [{ name: 'research/critique.ts', text: 'prompt v1' }, { name: 'research/deep.ts', text: 'x' }];
  const h = L.codeRevisionHash(src, { ANTHROPIC_MODEL: 'm1', PATH: '/bin' });
  assert.equal(h, L.codeRevisionHash([...src].reverse(), { PATH: '/usr/bin', ANTHROPIC_MODEL: 'm1' }), 'order-free; non-model env ignored');
  assert.notEqual(h, L.codeRevisionHash([{ ...src[0], text: 'prompt v2' }, src[1]], { ANTHROPIC_MODEL: 'm1' }));
  assert.notEqual(h, L.codeRevisionHash(src, { ANTHROPIC_MODEL: 'm2' }));
  assert.notEqual(h, L.codeRevisionHash([src[0], { ...src[1], text: null }], { ANTHROPIC_MODEL: 'm1' }));
  const reg = L.registryHashes();
  assert.ok(reg.codeHash, 'the running code has a code hash');
  assert.ok(L.PROMPT_MODULES.includes('research/critique.ts'));
});

test('a stale lock is broken; writes leave no temp / lock files; a held lock fails loudly (logged), not silently', () => {
  const tk = L.targetKeyFor(['gh:acme/lock@default']);
  const p = join(dir, 'lineage', 'org_lock', tk + '.json');
  L.recordLineage('org_lock', tk, entry('rs_l1', '2026-09-01T00:00:00.000Z'));
  // A crashed writer's lock, 60 s old → broken, the write proceeds.
  writeFileSync(p + '.lock', ''); const old = new Date(Date.now() - 60_000); utimesSync(p + '.lock', old, old);
  assert.equal(L.recordLineage('org_lock', tk, entry('rs_l2', '2026-09-02T00:00:00.000Z')), true);
  assert.deepEqual(readdirSync(join(dir, 'lineage', 'org_lock')), [tk + '.json']);
  assert.deepEqual(L.listLineage('org_lock', tk).map((e) => e.runId), ['rs_l2', 'rs_l1'], 'the second write merged the first (read inside the lock)');
  // A live lock held by another writer → the record fails and says so.
  writeFileSync(p + '.lock', '');
  const warn = console.warn; const seen: string[] = []; console.warn = (m: string) => { seen.push(m); };
  try { assert.equal(L.recordLineage('org_lock', tk, entry('rs_l3', '2026-09-03T00:00:00.000Z')), false); }
  finally { console.warn = warn; rmSync(p + '.lock', { force: true }); }
  assert.match(seen[0] ?? '', /\[lineage\] could not record rs_l3 .*locked/);
});

test('the org store keeps the FIRST F-id a finding was reported under while displayId follows the latest run', () => {
  OF.recordRunFindings('org_fid', 'tk', { runId: 'r1', at: '2026-09-01T00:00:00.000Z' }, [{ findingKey: 'k', title: 't', severity: 'high', status: 'new', displayId: 'F-03' }]);
  OF.recordRunFindings('org_fid', 'tk', { runId: 'r2', at: '2026-09-02T00:00:00.000Z' }, [{ findingKey: 'k', title: 't', severity: 'high', status: 'persisting', displayId: 'F-07' }]);
  const r = OF.getOrgFinding('org_fid', 'tk', 'k')!;
  assert.equal(r.displayId, 'F-07'); assert.equal(r.firstDisplayId, 'F-03');
});
