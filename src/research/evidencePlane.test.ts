import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_LIVE_PLANES, evidenceKindFor, externalPlaneNames, isLivePlaneRef, measurePlaneNames, measuredShare, planeOf } from './evidencePlane.ts';
import { MEASURE_PLANE_CLASS, isMeasurePlaneKind } from './investigation.ts';

// Every ref below keeps the exact SHAPE of a ref from two real runs' findings checkpoints (run A and
// run B). The point of this module is to tell a BigQuery query over 120,000 users apart
// from a grep over a workflow file, and both shipped stamped identically as `computation`.
const MOUNTED = ['amplitude', 'redis', 'acmedash', 'repometa'];

test('a plain plane prefix is measured', () => {
  assert.equal(evidenceKindFor('acmedash:analytics_dwd.app_event_detail_hourly', MOUNTED), 'metric');
  assert.equal(evidenceKindFor('amplitude:search_result_click_{feed,chat} totals, 20260617-20260714', MOUNTED), 'metric');
});

test('COMPOUND refs are measured — the case an anchored ^plane: test gets wrong', () => {
  // These three shapes cost 5 of run B's 12 measured findings under an anchored test.
  assert.equal(evidenceKindFor('repo+redis+acmedash:analytics_dwd.app_event_detail_hourly', MOUNTED), 'metric', 'planes joined into one prefix token');
  assert.equal(evidenceKindFor('repo:config/strategy/default.json + redis:scan(search_click:*,i2i_sim:*)', MOUNTED), 'metric', 'a plane after a +');
  assert.equal(evidenceKindFor('code:acme-recsys/config/strategy/default.json + service.py:19-22 ; acmedash:app_recommend', MOUNTED), 'metric', 'a plane after a ;');
});

test('code reading is NOT measured, whatever prefix it wears', () => {
  for (const ref of [
    'static: Waggle/Waggle {src/eval/score.ts, eval/score.ts}',
    'code:Waggle/.github/workflows/*.yml + cloudbuild.yaml + package.json:21-22',
    'repo:Waggle/Dockerfile:55,60,70 + package-lock.json(grep \'@openai/codex\'=0)',
    'code set-diff: acme-rec-model/training/rec_model_v2/pipeline_mmoe.config',
    'code/artifact diff: recsys-training/checkpoints/rec_model_v2/export-final/pipeline.config',
  ]) assert.equal(evidenceKindFor(ref, MOUNTED), 'computation', ref.slice(0, 40));
});

test('a DERIVED result with no plane token is not a live measurement', () => {
  // Real ref. It IS a computed eval, but it is not a query against the project's systems on this run,
  // and `metric` is the credibility claim — it has to mean one thing.
  assert.equal(evidenceKindFor('feed_holdout.marginal_grouped_auc + fleetwide_lift_band + univariate_auc', MOUNTED), 'computation');
});

test('a plane only counts on a run that MOUNTED it', () => {
  const ref = 'acmedash:app_stats_event search_result_click% userId null-rate';
  assert.equal(evidenceKindFor(ref, MOUNTED), 'metric');
  assert.equal(evidenceKindFor(ref, []), 'computation', 'unmounted custom plane earns nothing');
  // The builtins always count — they are ours, not the user's.
  for (const p of BUILTIN_LIVE_PLANES) assert.equal(evidenceKindFor(`${p}:some/query`, []), 'metric', p);
});

test('prose mentioning a plane does not earn the stamp', () => {
  assert.equal(isLivePlaneRef('code:foo.ts — compare against the redis cache behaviour', MOUNTED), false);
  assert.equal(isLivePlaneRef('', MOUNTED), false);
  assert.equal(isLivePlaneRef(undefined, MOUNTED), false);
});

test('planeOf names the plane for display, and nothing for a read', () => {
  assert.equal(planeOf('repo+redis+acmedash:analytics_dwd.x', MOUNTED), 'redis', 'first live plane named in the ref');
  assert.equal(planeOf('amplitude:union(search_* uniques)', MOUNTED), 'amplitude');
  assert.equal(planeOf('static: Waggle/src', MOUNTED), undefined, 'a read gets no label rather than a misleading one');
});

test('measuredShare counts findings, not evidence rows, and ignores the evidence-less', () => {
  const f = (kinds: string[]) => ({ evidence: kinds.map((k) => ({ kind: k })) });
  const s = measuredShare([f(['metric']), f(['computation']), f(['computation', 'metric']), { evidence: [] }]);
  assert.deepEqual([s.measured, s.total], [2, 3], 'one metric row makes the finding measured; the empty one is not counted');
  assert.equal(Math.round(s.share * 100), 67);
  assert.deepEqual(measuredShare([]), { measured: 0, total: 0, share: 0 }, 'no divide-by-zero on an empty run');
});

// ── REFERENCE-ONLY PLANES MUST NOT CONFER THE MEASURED STAMP ────────────────────────────────────
//
// Found in code review, and it is the worst possible bug for this feature: the provenance work
// exists to stop a code read from wearing a measurement's credibility, and the first version did exactly
// that. `currentPlaneManifest()` carries EVERY mounted plane, including repogrep (kind:'repo'), which
// execute-org-run mounts as a read-only REFERENCE reader — explicitly excluded from MEASURE_KIND — and
// which deepAudit is allowed to use for code reads. Handing that raw manifest to planeOf() stamped
// `repogrep:owner/repo/file.ts` as "[MEASURED · repogrep]" and counted it in the report banner.

test('a reference-only plane is filtered out of the measure list', () => {
  const manifest = [
    { serverName: 'warehouse', kind: 'warehouse' },
    { serverName: 'repogrep', kind: 'repo' },        // reference-only: reads code, measures nothing
    { serverName: 'acmedash', kind: 'custom' },
  ];
  assert.deepEqual(measurePlaneNames(manifest), ['warehouse', 'acmedash'], 'repogrep must not be measure-capable');
});

// Round 5 of the same review found the deeper version: codeintel / repometa / osv ARE genuine deterministic
// measurement sources and ARE in MEASURE_KIND, but they are computed from a precomputed index of the CLONED
// REPOSITORY, from repo metadata, or by matching the repo's dependency list against a public advisory DB.
// The v4 contract promises a MEASURED verdict "could not have been produced by reading the repository", and
// every one of those could. A denylist needed a new round per plane kind; this is an allowlist.
test('code-derived measurement sources do NOT earn the live-systems stamp', () => {
  for (const kind of ['codeintel', 'repometa', 'osv', 'repo']) {
    assert.deepEqual(measurePlaneNames([{ serverName: kind, kind }]), [],
      `${kind} is computed from the repository, so it cannot be "measured against live systems"`);
    assert.equal(planeOf(`${kind}:some/ref`, measurePlaneNames([{ serverName: kind, kind }])), undefined);
  }
});

test('live data planes DO earn it, so the filter is not simply off', () => {
  const live = [
    { serverName: 'warehouse', kind: 'warehouse' }, { serverName: 'redis', kind: 'keyvalue' },
    { serverName: 'amplitude', kind: 'analytics' }, { serverName: 'looker', kind: 'bi' },
    { serverName: 'acmedash', kind: 'custom' },
  ];
  // slack is deliberately absent: it is mounted and readable but is not a MeasurePlane, so it measures
  // nothing. An earlier version of this list included it, which was the bug claude's review found.
  assert.deepEqual(measurePlaneNames(live), ['warehouse', 'redis', 'amplitude', 'looker', 'acmedash']);
});

test('an UNKNOWN plane kind earns nothing — the allowlist fails closed', () => {
  // The whole point of inverting the list: a plane kind added later must not inherit the strong claim just
  // because nobody remembered to exclude it. Under-selling a finding is the acceptable failure direction.
  assert.deepEqual(measurePlaneNames([{ serverName: 'somethingnew', kind: 'somethingnew' }]), []);
  assert.deepEqual(measurePlaneNames([{ serverName: 'noKind' }]), [], 'a plane with no kind is not known to be live');
});

test('a repo READ does not earn the measured stamp even when its plane is mounted', () => {
  // The exact ref shape from a console run, against the exact manifest that run mounts.
  const manifest = [{ serverName: 'repogrep', kind: 'repo' }, { serverName: 'acmedash', kind: 'custom' }];
  const names = measurePlaneNames(manifest);
  assert.equal(planeOf('repogrep:owner/repo/src/file.ts:42', names), undefined, 'a code read is not a measurement');
  assert.equal(evidenceKindFor('repogrep:owner/repo/src/file.ts:42', names), 'computation');
  // ...while the real data plane in the SAME manifest still counts, so the filter is not just "off".
  assert.equal(planeOf('acmedash:app_stats_event', names), 'acmedash');
  assert.equal(evidenceKindFor('acmedash:app_stats_event', names), 'metric');
});

test('a compound ref that names BOTH a repo read and a live plane still counts as measured', () => {
  // Direction matters: filtering reference planes must not throw away a genuine measurement that merely
  // mentions a repo read alongside it.
  const names = measurePlaneNames([{ serverName: 'repogrep', kind: 'repo' }, { serverName: 'warehouse', kind: 'warehouse' }]);
  assert.equal(planeOf('repogrep:src/a.ts ; warehouse:analytics_dwd.events', names), 'warehouse');
});

test('kind is matched case-insensitively, and a nameless plane is dropped', () => {
  assert.deepEqual(measurePlaneNames([{ serverName: 'rg', kind: 'REPO' }]), [], 'kind casing must not defeat the filter');
  assert.deepEqual(measurePlaneNames([{ kind: 'warehouse' }]), [], 'a plane with no serverName cannot be named in a ref');
});

// ── THE STAMP AND THE REVERIFY RISK MUST READ A REF THE SAME WAY ────────────────────────────────
//
// scoreClaimRisk() used the ANCHORED livePlaneRe() while evidenceKindFor() used the
// compound-aware scanner. A compound ref was therefore stamped MEASURED but scored 0 for "live-plane value
// with no reproducible query" — so with the reverify set capped, the unreproducible live measurements were
// precisely the claims that could reach the report without a rerun. Worst-case direction for a provenance
// feature: the stamp makes a claim MORE credible while the risk score makes it LESS likely to be checked.

test('every ref the stamp calls MEASURED is also seen as live by the risk scorer', () => {
  const names = ['acmedash'];
  for (const ref of [
    'warehouse:analytics_dwd.events',
    'repo+redis+acmedash:analytics_dwd.x',           // compound, joined on '+'
    'code:src/x.ts:12 ; redis:scan(y:*)',      // compound, chained
    'acmedash:app_stats_event',              // custom plane, mounted here
  ]) {
    assert.equal(evidenceKindFor(ref, names), 'metric', `stamp disagrees: ${ref}`);
    assert.equal(isLivePlaneRef(ref, names), true, `the risk scorer would let this skip reverification: ${ref}`);
  }
});

test('and a ref that is NOT measured is not treated as live either', () => {
  for (const ref of ['code:src/a.ts', 'static: b/c', 'derived from the manifest', '']) {
    assert.equal(evidenceKindFor(ref, []), 'computation', ref);
    assert.equal(isLivePlaneRef(ref, []), false, ref);
  }
});

// ── ONE CANONICAL LIST, NOT TWO ─────────────────────────────────────────────────────────────────
//
// The provenance classifier and the measurement router were two hand-maintained
// lists answering two related questions, and they disagreed. The classifier had been wrong three times in
// a row (repogrep, then codeintel/repometa/osv, then slack), and each fix was a new value in the same
// second list. `slack` is the clearest case: it is mounted as a readable plane, deliberately is NOT a
// MeasurePlane, the router already excluded it — and the classifier called it live.

test('slack is mounted but measures nothing, so it earns no stamp', () => {
  assert.equal(isMeasurePlaneKind('slack'), false, 'slack is not a MeasurePlane');
  assert.deepEqual(measurePlaneNames([{ serverName: 'slack', kind: 'slack' }]), []);
  assert.deepEqual(externalPlaneNames([{ serverName: 'slack', kind: 'slack' }]), []);
});

test('the classifier and the measurement router read the SAME canonical Record', () => {
  // Every kind the classifier calls live or external must be a plane the router accepts as measuring
  // something. A live/external kind the router rejects is exactly the slack bug.
  for (const [kind, cls] of Object.entries(MEASURE_PLANE_CLASS)) {
    assert.equal(isMeasurePlaneKind(kind), true, `${kind} must be a MeasurePlane`);
    assert.ok(['live', 'external', 'code'].includes(cls), `${kind} has a real class`);
  }
  // And the partition is the one the reports depend on.
  assert.equal(MEASURE_PLANE_CLASS.warehouse, 'live');
  assert.equal(MEASURE_PLANE_CLASS.keyvalue, 'live');
  assert.equal(MEASURE_PLANE_CLASS.osv, 'external');
  assert.equal(MEASURE_PLANE_CLASS.repometa, 'external');
  // codeintel is a REAL MeasurePlane whose metrics are genuine, but they come from an index of the cloned
  // repo — so it can never support "this could not have come from reading the repository".
  assert.equal(MEASURE_PLANE_CLASS.codeintel, 'code');
});

test('a kind absent from the Record is not a measurement at all', () => {
  for (const kind of ['repo', 'slack', 'box', 'gcp', 'somethingnew', '']) {
    assert.equal(isMeasurePlaneKind(kind), false, kind || '(empty)');
    assert.deepEqual(measurePlaneNames([{ serverName: 'x', kind }]), []);
  }
});
