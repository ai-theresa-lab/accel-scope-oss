import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recsysMle, bundlesFor, mergedLens, mergedLibrary, mergedPatterns, structuralChecksFor, resolveBundles, EXPERT_BUNDLES } from './experts.ts';
import { rankingProfile, looksLikeRanking } from './ranking.ts';
import { METRIC_LIBRARY, renderMetricLibrary } from './investigation.ts';
import { RANKING_INVARIANTS, invariantByKey } from './invariants.ts';

// The Phase-1 refactor must be behaviour-preserving: the recsys bundle just re-packages the
// existing recsys content, and the engine sources lens/library through bundles identically.

test('mergedPatterns folds cross-cutting TRUST_PATTERNS into a domain bundle, but not a baseline-only set', () => {
  const dp = mergedPatterns([recsysMle]).map((p) => p.id);
  assert.ok(dp.includes('cross-source-metric-disagreement'), 'a domain bundle gets the cross-cutting trust patterns');
  assert.ok(dp.includes('instrumentation-coverage-gap'));
  assert.ok(dp.includes('recall-source-incremental-value'), 'and keeps its own domain patterns');
  // no duplicate ids after the fold
  assert.equal(dp.length, new Set(dp).size, 'ids are de-duped');
  const baseline = EXPERT_BUNDLES.find((b) => b.id === 'baseline')!;
  const bp = mergedPatterns([baseline]).map((p) => p.id);
  assert.ok(!bp.includes('cross-source-metric-disagreement'), 'a baseline-only set does NOT get the fold (baseline runs research(), not the Critique)');
});

test('resolveBundles: always-on baseline rides by default (auto path) but is opt-out in a manual selection', () => {
  // AUTO path (default): baseline always included even when not listed
  assert.ok(resolveBundles(['recsys-mle']).some((b) => b.id === 'baseline'), 'auto keeps the floor');
  assert.ok(resolveBundles([]).some((b) => b.id === 'baseline'), 'auto keeps the floor even with no ids');
  // MANUAL path (includeAlwaysOn=false): baseline runs ONLY if explicitly ticked
  const manualNoBaseline = resolveBundles(['recsys-mle', 'data-eng'], false).map((b) => b.id);
  assert.deepEqual(manualNoBaseline.sort(), ['data-eng', 'recsys-mle'], 'manual w/o baseline excludes the floor');
  assert.ok(!manualNoBaseline.includes('baseline'));
  const manualWithBaseline = resolveBundles(['recsys-mle', 'baseline'], false).map((b) => b.id);
  assert.ok(manualWithBaseline.includes('baseline'), 'manual WITH baseline keeps the floor');
});

test('recsys-mle bundle re-packages the existing recsys content unchanged', () => {
  assert.equal(recsysMle.lens, rankingProfile(true));
  assert.deepEqual(recsysMle.metricLibrary, METRIC_LIBRARY);
  assert.deepEqual(recsysMle.structuralChecks, RANKING_INVARIANTS);
  assert.ok(EXPERT_BUNDLES.some((b) => b.id === 'recsys-mle'));
});

test('lens gating is identical to the old rankingProfile(boolean)', () => {
  assert.equal(mergedLens([recsysMle]), rankingProfile(true));  // ranking on  → recsys lens
  assert.equal(mergedLens([]), '');                              // ranking off → no lens
  assert.equal(rankingProfile(false), '');                      // (== the old non-ranking path)
});

test('metric library is preserved (default render unchanged)', () => {
  assert.deepEqual(mergedLibrary([recsysMle]), METRIC_LIBRARY);
  assert.equal(renderMetricLibrary(), renderMetricLibrary(recsysMle.metricLibrary));
});

test('bundlesFor mirrors looksLikeRanking for the recsys bundle', () => {
  const ranking = 'two-tower retrieval, recall@100, faiss ann index';
  const plain = 'a generic crud backend with a postgres db';
  assert.ok(bundlesFor(ranking).some((b) => b.id === 'recsys-mle'));
  assert.equal(looksLikeRanking(ranking), true);
  // non-recsys text mounts only the always-on baseline (the data-trust floor), not recsys.
  assert.deepEqual(bundlesFor(plain).map((b) => b.id), ['baseline']);
  assert.equal(looksLikeRanking(plain), false);
});

test('domain bundles register + activate on their signals; baseline is always on', () => {
  const ids = EXPERT_BUNDLES.map((b) => b.id);
  for (const id of ['recsys-mle', 'baseline', 'data-eng', 'analytics', 'trust-safety', 'swe-arch', 'release-eng', 'api-stability', 'appsec', 'mobile-ios', 'mobile-android']) assert.ok(ids.includes(id), id);
  assert.ok(bundlesFor('').some((b) => b.id === 'baseline'));                                  // always on
  assert.ok(bundlesFor('our airflow + dbt warehouse pipeline').some((b) => b.id === 'data-eng'));
  assert.ok(bundlesFor('the looker dashboard KPI / north star metric').some((b) => b.id === 'analytics'));
  assert.ok(bundlesFor('content moderation + nsfw safety policy').some((b) => b.id === 'trust-safety'));
  // code-native bundles (engine/SDK + CI/release orgs — e.g. a public game-engine repo with no data plane)
  assert.ok(bundlesFor('a C++ game engine SDK, one big monorepo').some((b) => b.id === 'swe-arch'));
  assert.ok(bundlesFor('github actions builds are flaky, cmake toolchain').some((b) => b.id === 'release-eng'));
  assert.ok(bundlesFor('semver discipline for our public api, deprecation policy').some((b) => b.id === 'api-stability'));
  assert.ok(bundlesFor('supply chain security, dependabot + lockfile hygiene').some((b) => b.id === 'appsec'));
  // mobile-app bundles (shippable iOS/Android apps) — activate on platform-app signals, not on each other
  assert.ok(bundlesFor('an ios app, xcodeproj + info.plist, swiftui screens').some((b) => b.id === 'mobile-ios'));
  assert.ok(bundlesFor('android app with AndroidManifest, jetpack compose, targetSdk 35').some((b) => b.id === 'mobile-android'));
  const iosOnly = bundlesFor('an ios app, xcodeproj + info.plist').map((b) => b.id);
  assert.ok(!iosOnly.includes('mobile-android'), 'ios-only text must not activate mobile-android');
  // a plain data-backend text does NOT activate the code-native or mobile bundles (their signals are code/CI/platform-specific)
  const plainIds = bundlesFor('a generic crud backend with a postgres db').map((b) => b.id);
  for (const cn of ['swe-arch', 'release-eng', 'api-stability', 'appsec', 'mobile-ios', 'mobile-android']) assert.ok(!plainIds.includes(cn), cn + ' must not activate on plain data text');
  for (const b of EXPERT_BUNDLES) {                                                             // every bundle well-formed
    assert.equal(typeof b.lens, 'string');
    assert.equal(typeof b.triage, 'function');
    assert.ok(Array.isArray(b.metricLibrary));
  }
});

test('structuralChecksFor returns the bundle invariants (i12/i13 when recsys active)', () => {
  assert.deepEqual(structuralChecksFor([recsysMle]), RANKING_INVARIANTS);
  assert.deepEqual(structuralChecksFor([]), []);
});

test('domain bundles are deepened toward recsys depth: seed patterns + structural checks + metric library', () => {
  const by = (id: string) => EXPERT_BUNDLES.find((b) => b.id === id)!;
  for (const id of ['data-eng', 'analytics', 'trust-safety', 'swe-arch', 'release-eng', 'api-stability', 'appsec', 'mobile-ios', 'mobile-android']) {
    const b = by(id);
    assert.ok((b.patterns ?? []).length >= 4, `${id}: expected >=4 seed patterns, got ${(b.patterns ?? []).length}`);
    assert.ok(b.structuralChecks.length >= 3, `${id}: expected >=3 structural invariants, got ${b.structuralChecks.length}`);
    assert.ok(b.metricLibrary.length >= 8, `${id}: expected >=8 metric specs, got ${b.metricLibrary.length}`);
  }
  // the new domain + mobile structural invariants resolve by key, so `--invariants de1/…/sw1/…/ios1/and1` work + structuralChecksFor surfaces them
  for (const k of ['de1', 'de2', 'de3', 'an1', 'an2', 'an3', 'ts1', 'ts2', 'ts3', 'sw1', 'sw2', 'sw3', 're1', 're2', 're3', 'as1', 'as2', 'as3', 'sc1', 'sc2', 'sc3', 'ios1', 'ios2', 'ios3', 'ios4', 'and1', 'and2', 'and3', 'and4']) assert.ok(invariantByKey(k), `invariant ${k} resolves`);
  // every activated domain bundle's structural checks resolve back through the registry (no orphan keys)
  for (const id of ['data-eng', 'analytics', 'trust-safety', 'swe-arch', 'release-eng', 'api-stability', 'appsec', 'mobile-ios', 'mobile-android']) for (const inv of by(id).structuralChecks) assert.ok(invariantByKey(inv.key), `${id} ${inv.key} registered`);
});
