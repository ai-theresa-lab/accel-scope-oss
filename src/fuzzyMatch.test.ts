import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceStems, fuzzyChanged, fuzzyFeatures, fuzzyPairs, fuzzySimilarity, fuzzyThreshold, fuzzyWords, jaccard } from './fuzzyMatch.ts';
import { diffSinceLastScan, type KeyedFinding } from './sinceLastScan.ts';
import { findingKeys, evidenceInputTokens } from './findingKey.ts';
import type { Finding } from './schema.ts';

const F = (id: string, title: string, evidence: Finding['evidence'], over: Partial<Finding> = {}): Finding => ({ id, dimension: 'architecture', title, claim: 'c', evidence, businessImpact: '', recommendation: '', severity: 'high', confidence: 'high', effort: 'moderate', source: 'recommendation-audit', ...over });
const M = (ref: string, kind: 'metric' | 'computation' = 'metric'): Finding['evidence'] => [{ kind, ref }];
const keyed = (f: Finding, metric?: string): KeyedFinding => { const k = findingKeys(f); return { f, k, fz: fuzzyFeatures(f, { metric, bundleId: k.bundleId }) }; };
const META = { runId: 'rs_base', date: '2026-09-01' };

test('fuzzyWords / jaccard: stopwords + numbers dropped, plural s folded; a re-worded title clears 0.5', () => {
  assert.deepEqual(fuzzyWords('The release workflows lack 3 provenance attestations'), ['release', 'workflow', 'lack', 'provenance', 'attestation']);
  const a = fuzzyWords('Release workflow lacks provenance attestation');
  const b = fuzzyWords('No provenance attestation in the release workflow');
  assert.ok(jaccard(a, b) >= 0.5, `J=${jaccard(a, b)}`);
  assert.ok(jaccard(fuzzyWords('Release workflow lacks provenance attestation'), fuzzyWords('Unpinned third-party actions in CI')) < 0.5);
  assert.equal(fuzzyThreshold({ THERESA_INCR_FUZZY: '0.7' } as NodeJS.ProcessEnv), 0.7);
  assert.equal(fuzzyThreshold({ THERESA_INCR_FUZZY: 'x' } as NodeJS.ProcessEnv), 0.5);
  assert.equal(fuzzyThreshold({ THERESA_INCR_FUZZY: '2' } as NodeJS.ProcessEnv), 0.5);
});

test('evidenceStems: file paths (no line numbers), kind:ref stems without digits, concrete paths named in a measurement', () => {
  const st = evidenceStems(F('X:H1', 't', [{ kind: 'file', ref: './app/src/a.ts:42' }, { kind: 'metric', ref: 'probe:glob+read(.npmrc, .github/workflows/main.yml) = 3' }]));
  assert.ok(st.includes('f:app/src/a.ts'));
  assert.ok(st.includes('metric:probe:glob+read(.npmrc, .github/workflows/main.yml) ='));
  assert.ok(st.includes('f:.github/workflows/main.yml'));
  assert.ok(!st.some((s) => s === 'f:.npmrc'), 'a bare basename is not a path stem (too loose to identify a defect)');
});

test('fuzzySimilarity: same bundle + invariant required; title OR metric OR evidence overlap; never across bundles / invariants', () => {
  const a = fuzzyFeatures(F('SWE-ARCH:H1', 'Release workflow lacks provenance attestation', M('probe:x'), { invariant: 're1' }));
  const b = fuzzyFeatures(F('SWE-ARCH:H7', 'No provenance attestation in the release workflow', M('probe:y'), { invariant: 're1' }));
  assert.ok(fuzzySimilarity(a, b)! > 0);
  // Negative: another bundle / another invariant, however similar the title.
  assert.equal(fuzzySimilarity(a, fuzzyFeatures(F('APPSEC:H1', 'No provenance attestation in the release workflow', M('probe:y'), { invariant: 're1' }))), null);
  assert.equal(fuzzySimilarity(a, fuzzyFeatures(F('SWE-ARCH:H2', 'No provenance attestation in the release workflow', M('probe:y'), { invariant: 're2' }))), null);
  // Negative: same bundle + invariant, dissimilar title, no metric, disjoint evidence.
  assert.equal(fuzzySimilarity(a, fuzzyFeatures(F('SWE-ARCH:H3', 'Unpinned third-party actions', M('probe:z'), { invariant: 're1' }))), null);
  // Metric name alone pairs.
  const m1 = fuzzyFeatures(F('SWE-ARCH:H1', 'Churn hotspot', M('probe:x'), { invariant: 'sw1' }), { metric: 'co_change_ratio' });
  const m2 = fuzzyFeatures(F('SWE-ARCH:H2', 'Hidden coupling between modules', M('probe:q'), { invariant: 'sw1' }), { metric: 'CO_CHANGE_RATIO' });
  assert.ok(fuzzySimilarity(m1, m2)! >= 1);
  // Evidence overlap ALONE does not pair (two different defects cite one file) …
  const e1 = fuzzyFeatures(F('SWE-ARCH:H1', 'God module', [{ kind: 'file', ref: 'p-limit/index.js:3' }], { invariant: 'sw1' }));
  const e2 = fuzzyFeatures(F('SWE-ARCH:H2', 'Single file owns everything', [{ kind: 'file', ref: 'index.js:10' }], { invariant: 'sw1' }));
  assert.equal(fuzzySimilarity(e1, e2), null);
  // … it is a bonus that lowers the title bar to half the threshold (suffix-tolerant file paths).
  const o1 = fuzzyFeatures(F('SWE-ARCH:H1', 'Workflow tokens have write permissions', [{ kind: 'file', ref: 'p-limit/.github/workflows/main.yml:3' }], { invariant: 'sw1' }));
  const o2 = fuzzyFeatures(F('SWE-ARCH:H2', 'Write permissions granted to the default token', [{ kind: 'file', ref: '.github/workflows/main.yml:9' }], { invariant: 'sw1' }));
  assert.ok(fuzzySimilarity(o1, o2, 0.8)! >= 0.9, 'J 0.5 ≥ 0.8/2 with an overlap → pairs');
  assert.equal(fuzzySimilarity(o1, fuzzyFeatures(F('SWE-ARCH:H2', 'Write permissions granted to the default token', [{ kind: 'file', ref: 'src/other.ts:1' }], { invariant: 'sw1' })), 0.8), null, 'the same J without an overlap does not');
});

test('fuzzySimilarity: two DIFFERENT defects on the same file are not paired (fails on overlap-only pairing)', () => {
  const a = fuzzyFeatures(F('RELEASE-ENG:H1', 'Unpinned third-party actions in CI', [{ kind: 'file', ref: '.github/workflows/ci.yml:12' }], { invariant: 're1' }));
  const b = fuzzyFeatures(F('RELEASE-ENG:H4', 'Missing test matrix for Node 22', [{ kind: 'file', ref: '.github/workflows/ci.yml:30' }], { invariant: 're1' }));
  assert.equal(fuzzySimilarity(a, b), null);
  assert.deepEqual(fuzzyPairs([b], [a]), []);
  // The since-last-scan diff: the baseline defect A is not "persisting" as the new defect B.
  const d = diffSinceLastScan([keyed(F('RELEASE-ENG:H4', 'Missing test matrix for Node 22', [{ kind: 'file', ref: '.github/workflows/ci.yml:30' }], { invariant: 're1' }))],
    [keyed(F('RELEASE-ENG:H1', 'Unpinned third-party actions in CI', [{ kind: 'file', ref: '.github/workflows/ci.yml:12' }], { invariant: 're1' }))], META);
  assert.deepEqual(d.statuses, ['new']);
  assert.equal(d.counts.fixed, 1);
});

test('fuzzy tier: no invariant on either side pairs only on a metric match', () => {
  const a = fuzzyFeatures(F('APPSEC:H1', 'Release workflow lacks provenance attestation', M('probe:x')));
  const b = fuzzyFeatures(F('APPSEC:H2', 'Release workflow lacks provenance attestation', M('probe:y')));
  assert.equal(fuzzySimilarity(a, b), null, 'identical titles, no invariant, no metric');
  const am = fuzzyFeatures(F('APPSEC:H1', 'Release workflow lacks provenance attestation', M('probe:x')), { metric: 'attestation_coverage' });
  const bm = fuzzyFeatures(F('APPSEC:H2', 'No provenance attestation in the release workflow', M('probe:y')), { metric: 'attestation_coverage' });
  assert.ok(fuzzySimilarity(am, bm)! >= 1);
});

test('fuzzyPairs: a kind:ref stem shared by > 1 finding on one side is non-distinctive (ignored for overlap)', () => {
  const S = M('code:grep uses: in .github/workflows/**', 'computation');
  const cur = [fuzzyFeatures(F('APPSEC:H2', 'Actions referenced by mutable tags instead of SHAs', S, { invariant: 'sc2' }))];
  const one = [fuzzyFeatures(F('APPSEC:H1', 'GitHub Actions pinned to mutable tags', S, { invariant: 'sc2' }))];
  assert.deepEqual(fuzzyPairs(cur, one), [[0, 0]], 'J 0.375 + a distinctive overlap pairs');
  const two = [...one, fuzzyFeatures(F('APPSEC:H3', 'Workflow jobs run with write-all token', S, { invariant: 'sc2' }))];
  assert.deepEqual(fuzzyPairs(cur, two), [], 'the same probe backs two baseline findings → it identifies neither');
});

test('fuzzyPairs: one-to-one, highest similarity first', () => {
  const I = { invariant: 're1' };
  const base = [fuzzyFeatures(F('X:H1', 'Release workflow lacks provenance attestation', M('probe:a'), I)), fuzzyFeatures(F('X:H2', 'Release workflow lacks signing', M('probe:b'), I))];
  const cur = [fuzzyFeatures(F('X:H9', 'Release workflow lacks provenance attestation step', M('probe:c'), I))];
  assert.deepEqual(fuzzyPairs(cur, base, 0.3), [[0, 0]], 'the closer baseline row wins; the other stays unmatched');
  assert.deepEqual(fuzzyPairs([cur[0], cur[0]], base, 0.3).length, 2, 'two current rows take two distinct baseline rows');
  assert.deepEqual(fuzzyPairs([undefined], base), []);
});

test('fuzzyChanged: severity or the cited file set differs ⇒ changed', () => {
  const a = fuzzyFeatures(F('X:H1', 't', [{ kind: 'file', ref: 'app/a.ts:1' }]));
  assert.equal(fuzzyChanged(a, fuzzyFeatures(F('X:H2', 't2', [{ kind: 'file', ref: 'a.ts:9' }]))), false);
  assert.equal(fuzzyChanged(a, fuzzyFeatures(F('X:H2', 't2', [{ kind: 'file', ref: 'app/b.ts:9' }]))), true);
  assert.equal(fuzzyChanged(a, fuzzyFeatures(F('X:H2', 't2', [{ kind: 'file', ref: 'app/a.ts:1' }], { severity: 'low' }))), true);
});

test('sinceLastScan fuzzy tier: re-worded measurement findings read persisting, not new + not re-checked (fails on the 3-key diff)', () => {
  const base = [
    keyed(F('RELEASE-ENG:H1', 'Release workflow lacks provenance attestation', M('probe:glob+read(.npmrc,main.yml,package.json,.gitignore)'), { invariant: 're2' })),
    keyed(F('APPSEC:H1', 'GitHub Actions pinned to mutable tags', M('code:grep uses: in .github/workflows/**', 'computation'), { invariant: 'sc2' })),
  ];
  const cur = [
    keyed(F('RELEASE-ENG:H3', 'No provenance attestation in the release workflow', M('probe:glob+read(package.json,main.yml)'), { invariant: 're2' })),
    keyed(F('APPSEC:H2', 'Actions referenced by mutable tags instead of SHAs', M('code:grep uses: in .github/workflows/**', 'computation'), { invariant: 'sc2' })),
  ];
  const d = diffSinceLastScan(cur, base, META, { checkedBundles: new Set(['release-eng', 'appsec']) });
  assert.deepEqual(d.statuses, ['persisting', 'persisting']);
  assert.deepEqual(d.counts, { fixed: 0, new: 0, persisting: 2, changed: 0, unchecked: 0 });
  // Without features (the old diff) the same rows were 2 new + 2 fixed.
  const strip = (x: KeyedFinding): KeyedFinding => ({ f: x.f, k: x.k });
  const old = diffSinceLastScan(cur.map(strip), base.map(strip), META, { checkedBundles: new Set(['release-eng', 'appsec']) });
  assert.equal(old.counts.new, 2);
  // Negative: a genuinely new defect in the same bundle stays new; a same-title finding of ANOTHER bundle does not match.
  const n = diffSinceLastScan([keyed(F('RELEASE-ENG:H4', 'Changelog not updated on release', M('probe:q'), { invariant: 're2' })), keyed(F('SWE-ARCH:H1', 'Release workflow lacks provenance attestation', M('probe:glob+read(.npmrc)'), { invariant: 're2' }))], base, META);
  assert.deepEqual(n.statuses, ['new', 'new']);
  // The severity moved ⇒ changed.
  const c = diffSinceLastScan([keyed(F('RELEASE-ENG:H3', 'No provenance attestation in the release workflow', M('probe:x'), { invariant: 're2', severity: 'low' }))], [base[0]], META);
  assert.deepEqual(c.statuses, ['changed']);
});

test('evidenceInputTokens: file names, paths and globs named in measurement refs (not versions, not prose)', () => {
  const t = evidenceInputTokens(F('X:H1', 't', [{ kind: 'metric', ref: 'probe:glob+read(.npmrc,main.yml,package.json,.gitignore)' }, { kind: 'computation', ref: 'code:grep uses: in .github/workflows/**', detail: 'v4.2.1 e.g. 3 of 4 in src/*.{ts,js} — see https://github.com/a/b' }]));
  for (const x of ['.npmrc', 'main.yml', 'package.json', '.gitignore', '.github/workflows/**', 'src/*.{ts,js}']) assert.ok(t.includes(x), x);
  for (const x of ['v4.2.1', 'e.g', 'glob', 'uses', '4.2.1']) assert.ok(!t.includes(x), x);
  assert.deepEqual(evidenceInputTokens(F('X:H1', 't', [{ kind: 'file', ref: 'a/b.ts:1' }])), [], 'file rows are not measurement inputs');
});
