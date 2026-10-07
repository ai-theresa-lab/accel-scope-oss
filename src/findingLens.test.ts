// Report lens split — part 1: the two finding labels (bundle default,
// synthesis override, capability = the synthesis area), and that labelling never moves a citation anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLens, gapLens, labelFindings, lensFor, overrideMap } from './findingLens.ts';
import { executionGroups } from './executionModel.ts';
import { buildReportRefs, findingAnchorIds } from './reportAnchors.ts';
import { synthesisPrompt, validLensOverrides } from './research/deep.ts';
import { applySynthesisAudit } from './research/synthesisClaimAudit.ts';
import type { Hypothesis } from './research/investigation.ts';
import { areas, findings, gaps, labelled } from './findingLens.fixtures.ts';

// ── Part 1: labels ─────────────────────────────────────────────────────────────────────────────────────────────────

test('defaultLens: security / engineering / business by bundle; unknown and derived dimensions are business', () => {
  for (const b of ['appsec', 'saas-tenancy', 'trust-safety']) assert.equal(defaultLens(b), 'security', b);
  for (const b of ['swe-arch', 'release-eng', 'api-stability', 'mobile-ios', 'mobile-android']) assert.equal(defaultLens(b), 'engineering', b);
  for (const b of ['baseline', 'data-eng', 'analytics', 'recsys-mle', 'u3', 'gcp-iam', undefined, '']) assert.equal(defaultLens(b), 'business', String(b));
  assert.equal(defaultLens('APPSEC'), 'security', 'case-insensitive');
  // invariant-scan finding without a bundle prefix: its invariant's owner decides (i1 → baseline → business; sw* → swe-arch).
  assert.equal(lensFor({ id: 'I1-0', invariant: 'i1', source: 'baseline' }), 'business');
  assert.equal(lensFor({ id: 'X-3', invariant: 'u2', source: 'research' }), 'business', 'derived dimension');
  assert.equal(lensFor({ id: 'MOBILE-IOS:H1', source: 'recommendation-audit' }, overrideMap([{ id: 'mobile-ios:h1', lens: 'business', reason: 'breaks checkout' }])), 'business', 'an override wins');
  assert.equal(gapLens({ id: 'APPSEC:H4', hypothesisId: 'appsec:h4' }), 'security');
});

test('labelFindings: one pure pass — lens on every finding, capability (synthesis area) only on business ones', () => {
  const before = JSON.stringify(findings);
  const out = labelled();
  assert.equal(JSON.stringify(findings), before, 'the input is not mutated');
  const by = new Map(out.map((f) => [f.id, f]));
  assert.equal(by.get('DATA-ENG:H1')!.lens, 'business'); assert.equal(by.get('DATA-ENG:H1')!.capability, 'Checkout & billing');
  assert.equal(by.get('ANALYTICS:H2')!.capability, 'Retention reporting');
  assert.equal(by.get('APPSEC:H1')!.lens, 'security'); assert.equal(by.get('APPSEC:H1')!.capability, undefined, 'a security finding in a business area has no capability');
  assert.equal(by.get('RELEASE-ENG:H1')!.lens, 'engineering');
  assert.equal(by.get('I1-0')!.lens, 'business'); assert.equal(by.get('I1-0')!.capability, undefined, 'no area claims it → no capability');
  // Idempotent and label-preserving: a checkpointed label is the record.
  assert.deepEqual(labelFindings(out, { groups: executionGroups(out, gaps, areas) }), out);
  const kept = labelFindings([{ ...findings[0], lens: 'engineering' }]);
  assert.equal(kept[0].lens, 'engineering'); assert.equal(kept[0].capability, undefined);
  // Overrides from the synthesis re-label, and move the capability with the lens.
  const ov = labelFindings(findings, { overrides: [{ id: 'appsec:h1', lens: 'business', reason: 'users can read each other’s orders' }], groups: executionGroups(findings, gaps, areas) });
  assert.equal(ov.find((f) => f.id === 'APPSEC:H1')!.capability, 'Checkout & billing');
});

test('labels never move a citation anchor (a replayed unlabelled checkpoint and a fresh labelled run link the same)', () => {
  assert.deepEqual(findingAnchorIds(labelled()), findingAnchorIds(findings));
  assert.deepEqual(buildReportRefs(labelled(), '/r').map((r) => [r.anchor, r.displayId]), buildReportRefs(findings, '/r').map((r) => [r.anchor, r.displayId]));
});

test('synthesis lens overrides: in the prompt schema, validated strictly, carried through the claim audit', () => {
  const hs = [{ id: 'mobile-ios:h1', claim: 'checkout button dead on iOS 17', status: 'supported', measurement: { value: 1 } }, { id: 'appsec:h2', claim: 'c', status: 'supported', measurement: { value: 1 } }] as unknown as Hypothesis[];
  const p = synthesisPrompt(hs, [], 'scope', '');
  assert.match(p, /\[report lens: engineering \(bundle default\)\] checkout button/);
  assert.match(p, /"lensOverrides":\[/); assert.match(p, /5\. REPORT LENS/);
  const known = hs.map((h) => h.id);
  const v = validLensOverrides([
    { id: 'mobile-ios:h1', lens: 'business', reason: '  breaks   checkout  ' },
    { id: 'mobile-ios:h1', lens: 'security', reason: 'dup — first wins' },
    { id: 'appsec:h2', lens: 'security', reason: 'no-op: already the default' },
    { id: 'appsec:h9', lens: 'business', reason: 'unknown id' },
    { id: 'appsec:h2', lens: 'marketing', reason: 'not a lens' },
    { id: 'appsec:h2', lens: 'business' },
    'junk', null,
  ], known);
  assert.deepEqual(v, [{ id: 'mobile-ios:h1', lens: 'business', reason: 'breaks checkout' }]);
  assert.deepEqual(validLensOverrides({ not: 'an array' }, known), []);
  assert.deepEqual(validLensOverrides([{ id: 'h1', lens: 'business', reason: 'short id reconciled' }], known).map((o) => o.id), ['mobile-ios:h1']);
  const gated = applySynthesisAudit({ bottomLine: '• x', leads: [], lensOverrides: v }, [{ id: 'synth:bottomLine:0', target: 'bottomLine', index: 0, text: 'x', basis: [], scope: 'covered_by_basis', verdict: 'accept', reason: '', auditStatus: 'audited' }]);
  assert.deepEqual(gated?.lensOverrides, v, 'an audited synthesis keeps its lens labels');
});
