import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimAuditCarryLine, deltaFocusPaths, hypAsFinding, maxHypNumber, mergeDeltaLane, renumberDelta, staleRevivedHypotheses, unionReadSets, type DeltaLaneParts } from './deltaLane.ts';
import { deltaLaneSplit, runCarryForward, type CarryInput } from './carryForward.ts';
import type { Finding } from '../schema.ts';
import type { Hypothesis } from '../research/investigation.ts';

const H = (id: string, claim: string, source = 'probe:x', metric = 'm'): Hypothesis => ({ id, claim, symptom: 's', status: 'supported', decisiveMetric: metric, measurement: { metricId: metric, value: 1, direction: 'higher', nulls: [], source, evidence: { ref: `measurement:${id}`, source } as never } } as Hypothesis);
const parts = (hypotheses: Hypothesis[], over: Partial<DeltaLaneParts> = {}): DeltaLaneParts => ({ hypotheses, mitigations: hypotheses.map((h) => ({ hypothesisId: h.id, supported: true, mitigation: 'm', lever: 'fix', expectedEffect: '', guardrail: '', grounding: '' })), gaps: [], findings: [], trace: '', toolTally: {}, ...over });
const F = (id: string, title: string, ref: string, kind: 'metric' | 'computation' | 'file' = 'metric'): Finding => ({ id, dimension: 'architecture', title, claim: 'c', evidence: [{ kind, ref }], businessImpact: '', recommendation: '', severity: 'high', confidence: 'high', effort: 'moderate', source: 'recommendation-audit' });

test('maxHypNumber / renumberDelta: the delta is numbered past every id the lane ever used (revived, carried PREV-, re-check)', () => {
  assert.equal(maxHypNumber(['swe-arch:h3', 'SWE-ARCH:PREV-H7', 'SWE-ARCH:H2-RECHECK', 'x', 'baseline-h10-foo']), 10);
  const r = renumberDelta('swe-arch', { hypotheses: [H('swe-arch:h1', 'a'), H('swe-arch:h2', 'b')], mitigations: [{ hypothesisId: 'swe-arch:h2' } as never], gaps: [{ id: 'SWE-ARCH:H1', hypothesisId: 'swe-arch:h1', concern: '', whyUnsettled: '', nextDecisiveTest: '', source: '', status: 'unmeasured' }] }, 7);
  assert.deepEqual(r.hypotheses.map((h) => h.id), ['swe-arch:h8', 'swe-arch:h9']);
  assert.equal(r.hypotheses[0].measurement?.evidence?.ref, 'measurement:swe-arch:h8', 'the payload ref follows the id');
  assert.equal(r.mitigations[0].hypothesisId, 'swe-arch:h9');
  assert.equal(r.gaps[0].hypothesisId, 'swe-arch:h8'); assert.equal(r.gaps[0].id, 'SWE-ARCH:H8');
});

test('mergeDeltaLane: new verdicts appended (renumbered), a re-worded duplicate of a KEPT finding dropped, trace + tally merged', () => {
  const base = parts([H('appsec:h1', 'GitHub Actions pinned to mutable tags.', 'code:grep uses: in .github/workflows/**', 'action_pin_rate')], { trace: 'base', toolTally: { Read: 2 } });
  const kept = [F('APPSEC:H1', 'GitHub Actions pinned to mutable tags', 'code:grep uses: in .github/workflows/**', 'computation')];
  const delta = parts([H('appsec:h1', 'Actions referenced by mutable tags instead of SHAs.', 'code:grep uses: in .github/workflows/**', 'action_pin_rate'), H('appsec:h2', 'The security policy advertises an unmonitored contact address.', 'probe:read(.github/security.md)', 'contact_route')], { trace: 'delta', toolTally: { Read: 1, Grep: 1 } });
  const mo = { metricOf: (h: Hypothesis) => h.decisiveMetric, keptMetricOf: (f: Finding) => (f.id === 'APPSEC:H1' ? 'action_pin_rate' : undefined) };
  const m = mergeDeltaLane('appsec', base, kept, ['APPSEC:H1', 'APPSEC:H2'], delta, mo);
  assert.deepEqual(m.duplicates, ['appsec:h3'], 'the re-worded re-find of the kept finding (renumbered h3) is dropped');
  assert.deepEqual(m.added, ['appsec:h4']);
  assert.deepEqual(m.out.hypotheses.map((h) => h.id), ['appsec:h1', 'appsec:h4']);
  assert.deepEqual(m.out.mitigations.map((x) => x.hypothesisId), ['appsec:h1', 'appsec:h4']);
  assert.match(m.out.trace, /^base\n\n── delta critique \(incremental re-scan\) ──\ndelta$/);
  assert.deepEqual(m.out.toolTally, { Read: 3, Grep: 1 });
  // Negative: a genuinely different new problem of the same lane is kept.
  assert.equal(mergeDeltaLane('appsec', base, kept, [], parts([H('appsec:h1', 'Postinstall script fetches and executes remote code.', 'probe:read(package.json)', 'fetch_exec')]), mo).added.length, 1);
});

test('mergeDeltaLane: a NEW defect that only shares the kept finding’s probe / file is not dropped as a duplicate', () => {
  const base = parts([H('release-eng:h1', 'Unpinned third-party actions in CI.', 'code:grep uses: in .github/workflows/ci.yml', 'pin_rate')]);
  const kept = [{ ...F('RELEASE-ENG:H1', 'Unpinned third-party actions in CI', 'code:grep uses: in .github/workflows/ci.yml', 'computation'), invariant: 're1' }];
  // Same probe, same file, dissimilar title, a different metric: a different defect.
  const d = parts([H('release-eng:h1', 'Missing test matrix for Node 22.', 'code:grep uses: in .github/workflows/ci.yml', 'matrix_coverage')]);
  const m = mergeDeltaLane('release-eng', base, kept, [], d, { metricOf: (h) => h.decisiveMetric, keptMetricOf: () => 'pin_rate' });
  assert.deepEqual(m.duplicates, []);
  assert.deepEqual(m.added, ['release-eng:h2']);
  // Also with no metric known on either side (invariant-less rows): overlap alone never pairs.
  const kept2 = [F('RELEASE-ENG:H1', 'Unpinned third-party actions in CI', 'code:grep uses: in .github/workflows/ci.yml', 'computation')];
  assert.deepEqual(mergeDeltaLane('release-eng', base, kept2, [], d).duplicates, []);
});

test('hypAsFinding / deltaFocusPaths / unionReadSets', () => {
  const f = hypAsFinding(H('swe-arch:h2', 'Single-module package with no internal boundaries. More text.', 'probe:glob+read(index.js)'));
  assert.equal(f.id, 'SWE-ARCH:H2'); assert.equal(f.title, 'Single-module package with no internal boundaries'); assert.equal(f.evidence[0].ref, 'probe:glob+read(index.js)');
  assert.deepEqual(deltaFocusPaths(['sindresorhus/p-limit/.github/security.md', 'other/x.ts'], [{ fullName: 'sindresorhus/p-limit', dir: 'p-limit' }]), ['p-limit/.github/security.md', 'other/x.ts']);
  const u = unionReadSets({ readSet: ['a', 'b'], globs: ['g'], greps: [{ path: '.', pattern: 'x' }], opaque: [], measured: [] }, { readSet: ['b', 'c'], globs: [], greps: [{ path: '.', pattern: 'x' }, { path: '.', pattern: 'y' }], opaque: ['q'], measured: ['repometa'] });
  assert.deepEqual(u, { readSet: ['a', 'b', 'c'], globs: ['g'], greps: [{ path: '.', pattern: 'x' }, { path: '.', pattern: 'y' }], opaque: ['q'], measured: ['repometa'] });
});

// ── two generations: the merged delta lane is what the next scan revives (and re-checks keep working) ───────────────
const REPOS = [{ fullName: 'sindresorhus/p-limit', dir: 'p-limit' }];
const IDX = { files: ['.npmrc', 'package.json', '.github/workflows/main.yml', '.github/security.md', 'index.js'].map((p) => `sindresorhus/p-limit/${p}`), repos: REPOS };
const cf = (over: Partial<CarryInput>): CarryInput => ({ baselineAt: '2026-09-20T00:00:00.000Z', baselineFindings: [], baselineLanes: {}, baselineCarried: {}, baselinePending: [], changed: new Set(), baselineRepos: REPOS, reverifyMax: 6, budgetOk: () => true, reverify: async () => ({ status: 'persisting', evidence: [], note: 'still there' }), resolves: () => true, looseKey: (f) => `lk:${f.title}`, inputs: IDX, ...over });

test('two-generation delta: gen 2 merges + re-checks, gen 3 revives the MERGED lane, numbering never collides, carried rows survive', async () => {
  // gen 1 (baseline): appsec h1 (workflows glob) + h2 (reads security.md).
  const g1Hyp = [H('appsec:h1', 'GitHub Actions pinned to mutable tags.', 'code:grep uses: in .github/workflows/**'), H('appsec:h2', 'Security policy lacks a disclosure SLA.', 'probe:read(.github/security.md)')];
  const g1Find = [F('APPSEC:H1', 'GitHub Actions pinned to mutable tags', 'code:grep uses: in .github/workflows/**', 'computation'), F('APPSEC:H2', 'Security policy lacks a disclosure SLA', 'probe:read(.github/security.md)')];
  // gen 2: security.md changed → h2 leaves the revived output for a re-check; h1 kept (inputs unchanged).
  const ch2 = new Set(['sindresorhus/p-limit/.github/security.md']);
  const s2 = deltaLaneSplit(g1Find, ch2, REPOS, IDX);
  assert.deepEqual(s2.keep.map((k) => [k.f.id, k.note]), [['APPSEC:H1', 'inputs']]);
  assert.deepEqual(s2.recheck.map((f) => f.id), ['APPSEC:H2']);
  const base2 = parts(g1Hyp.filter((h) => h.id === 'appsec:h1'));
  const m2 = mergeDeltaLane('appsec', base2, s2.keep.map((k) => k.f), ['appsec:h1', 'appsec:h2', 'APPSEC:H1', 'APPSEC:H2'], parts([H('appsec:h1', 'Postinstall script fetches remote code.', 'probe:read(package.json)')]));
  assert.deepEqual(m2.out.hypotheses.map((h) => h.id), ['appsec:h1', 'appsec:h3'], 'the new h1 → h3 (h2 is still the re-check candidate’s id)');
  const co2 = await runCarryForward([{ id: 'appsec', replayed: true, incomplete: false, fresh: [], delta: { recheck: s2.recheck } }], cf({ changed: ch2, baselineFindings: g1Find, baselineLanes: { appsec: { bundleId: 'appsec', hypotheses: g1Hyp } } }));
  assert.deepEqual(co2.findings.map((f) => f.id), ['APPSEC:PREV-H2'], 're-verified persisting → carried (not silently dropped, not "fixed")');
  // gen 3: nothing it depends on changed except security.md again → the MERGED lane (h1, h3) is revived; the delta's new
  // problem is numbered past h3 AND past the carried PREV-H2; the carried row goes to a re-check (its file changed).
  const g2Find = [g1Find[0], F('APPSEC:H3', 'Postinstall script fetches remote code', 'probe:read(package.json)'), ...co2.findings];
  const s3 = deltaLaneSplit(g2Find.filter((f) => ['APPSEC:H1', 'APPSEC:H3'].includes(f.id)), ch2, REPOS, IDX);
  assert.deepEqual(s3.keep.map((k) => k.f.id), ['APPSEC:H1', 'APPSEC:H3']);
  const m3 = mergeDeltaLane('appsec', parts(m2.out.hypotheses), s3.keep.map((k) => k.f), g2Find.map((f) => f.id), parts([H('appsec:h1', 'Security contact is a personal mailbox.', 'probe:read(.github/security.md)')]));
  assert.deepEqual(m3.added, ['appsec:h4']);
  let asked = 0;
  const co3 = await runCarryForward([{ id: 'appsec', replayed: true, incomplete: false, fresh: [], delta: { recheck: s3.recheck } }], cf({ changed: ch2, baselineFindings: g2Find, baselineCarried: co2.carriedByLane, baselineLanes: { appsec: { bundleId: 'appsec', hypotheses: m2.out.hypotheses } }, reverify: async () => { asked++; return { status: 'persisting', evidence: [], note: 'x' }; } }));
  assert.equal(asked, 1, 'the carried PREV-H2 (cites the changed file) is re-checked again');
  assert.deepEqual(co3.findings.map((f) => f.id), ['APPSEC:PREV-H2']);
  // A delta that did not complete parks its re-check candidates as pending ("not re-checked"), never drops them.
  const inc = await runCarryForward([{ id: 'appsec', replayed: true, incomplete: true, fresh: [], delta: { recheck: s2.recheck } }], cf({ changed: ch2, baselineFindings: g1Find }));
  assert.deepEqual(inc.pending.map((p) => p.finding.id), ['APPSEC:H2']);
  assert.match(inc.pending[0].why, /delta re-check did not complete/);
});

test('a revived hypothesis backing NO finding whose measurement read a changed file is re-derived, not carried', () => {
  const REPOS1 = [{ fullName: 'sindresorhus/p-limit', dir: 'p-limit' }];
  const IDX1 = { files: ['.github/security.md', 'package.json', 'index.js'].map((p) => `sindresorhus/p-limit/${p}`), repos: REPOS1 };
  const changed = new Set(['sindresorhus/p-limit/.github/security.md']);
  const hyps = [
    H('appsec:h1', 'Security policy lacks a disclosure SLA.', 'probe:read(.github/security.md)'),            // ruled out / healthy → backs no finding; read the changed file
    H('appsec:h2', 'Postinstall fetches remote code.', 'probe:read(package.json)'),                             // backs no finding; its input unchanged
    H('appsec:h3', 'Actions pinned to tags.', 'probe:read(.github/security.md)'),                               // backs a finding → deltaLaneSplit decides, not this
    { ...H('appsec:h4', 'Unmeasured.', ''), measurement: undefined, plannedMeasurement: { decisiveQuery: 'grep -n contact .github/security.md' } } as Hypothesis,
  ];
  assert.deepEqual(staleRevivedHypotheses(hyps, new Set(['appsec:h3']), changed, REPOS1, IDX1), ['appsec:h1', 'appsec:h4']);
  assert.deepEqual(staleRevivedHypotheses(hyps, new Set(), new Set(), REPOS1, IDX1), [], 'nothing changed');
});

test('claim-audit carry line counts reused and delta lanes apart', () => {
  assert.equal(claimAuditCarryLine(8, 1, 2, 'rs_prev'), 'stage:claim-audit · ⟳ 8 verdict(s) of 1 reused lane(s) + 2 Change lane(s) (their new verdicts are audited fresh) carried from rs_prev · $0');
  assert.equal(claimAuditCarryLine(3, 0, 3, 'p'), 'stage:claim-audit · ⟳ 3 verdict(s) of 3 Change lane(s) (their new verdicts are audited fresh) carried from p · $0');
  assert.equal(claimAuditCarryLine(5, 2, 0, 'p'), 'stage:claim-audit · ⟳ 5 verdict(s) of 2 reused lane(s) carried from p · $0');
});
