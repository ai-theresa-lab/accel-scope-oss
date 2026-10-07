// Report lens split Phase 2 — the CAPABILITY MAP: Comprehend's validated map (research/capabilities.ts), the capability
// assignment rule for findings, the "examined" set, the Critic's context, the Execution grouping by capability, the
// Leadership map drawing EVERY capability (grey = not examined, green = examined + nothing confirmed, ◆ = critical) and
// the v5 author's capability list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Capability, capabilityContextBlock, capabilityFor, capabilityForName, examinedCapabilityIds, findingEvidencePaths, parseCapabilities } from './research/capabilities.ts';
import { capabilityHealth, labelFindings, leadershipLensFor, lensBriefFor } from './findingLens.ts';
import { buildExecutionModel, capabilityGroups, executionGroups, executionGroupsFor } from './executionModel.ts';
import { buildReportRefs, injectDetailIndex, reinjectDetailIndex, wrapTileName } from './reportAnchors.ts';
import { renderRecallReport } from './recallReportHtml.ts';
import { critiquePrompt } from './research/critique.ts';
import { lensMaterialBlock, type LeadershipWriterOpts } from './research/leadershipWriter.ts';
import type { Hypothesis } from './research/investigation.ts';
import { type SynthesisArea, synthesisPrompt, validCapabilityAssignments } from './research/deep.ts';
import type { CoverageGap, Finding } from './schema.ts';
import type { SinceLastScan } from './sinceLastScan.ts';
import { F } from './findingLens.fixtures.ts';

const RAW = [
  { id: 'sharing', name: 'Sharing a report', kind: 'feature', summary: 'Owners share a read-only view of a report by link. Anyone with it can view.', anchors: { paths: ['src/app/share', 'src/lib/share.ts'], routes: ['/api/share'] }, critical: true },
  { id: 'dashboards', name: 'Traffic dashboards', kind: 'feature', summary: 'Customers see visitor and page-view numbers.', anchors: { paths: ['src/app', 'src/queries/stats'], tables: ['website_event'] } },
  { id: 'billing', name: 'Billing & plans', kind: 'journey', summary: 'Customers pick a plan and pay.', anchors: { paths: ['src/billing'] } },
  { id: 'data-retention', name: 'Data retention', kind: 'platform', summary: 'Old events are purged after the retention window.', anchors: { paths: ['src/jobs/purge'], tables: ['event_archive'] } },
];
const MAP: Capability[] = parseCapabilities(RAW);

test('parseCapabilities: strict per item, fail-open to none, ≤ 12, one-sentence summaries, repo-relative anchors', () => {
  assert.deepEqual(MAP.map((c) => c.id), ['sharing', 'dashboards', 'billing', 'data-retention']);
  assert.equal(MAP[0].summary, 'Owners share a read-only view of a report by link.', 'one sentence');
  assert.equal(MAP[0].critical, true); assert.equal(MAP[1].critical, undefined);
  for (const bad of [undefined, null, 'x', { a: 1 }, 42]) assert.deepEqual(parseCapabilities(bad), [], `not an array → none (${String(bad)})`);
  const mixed = parseCapabilities([
    ...RAW.slice(0, 1),
    { ...RAW[1], id: 'Not Kebab' },                                         // non-kebab id (normalised to lower-case, still has a space)
    { ...RAW[1], id: 'code-name', name: 'src/queries/stats' },               // a path, not a product name
    { ...RAW[1], id: 'snake', name: 'website_stats' },                      // a code identifier
    { ...RAW[1], id: 'kind', kind: 'module' },                              // unknown kind
    { ...RAW[1], id: 'extra', owner: 'x' },                                 // unknown key (strict)
    { ...RAW[1], id: 'no-anchor', name: 'Nothing anchored', anchors: { paths: [] } },
    { ...RAW[0], id: 'sharing' },                                           // duplicate id
    { ...RAW[1], id: 'dup-name', name: 'SHARING A REPORT' },                 // duplicate name
    { ...RAW[1], id: 'escape', name: 'Escapes', anchors: { paths: ['../etc', 'C:/x', '/abs/ok/'] } },
  ]);
  assert.deepEqual(mixed.map((c) => c.id), ['sharing', 'escape']);
  assert.deepEqual(mixed[1].anchors.paths, ['abs/ok'], 'parent-escaping + drive paths dropped, leading / trailing slash normalised');
  const many = parseCapabilities(Array.from({ length: 20 }, (_, i) => ({ ...RAW[2], id: `c-${i}`, name: `Capability ${String.fromCharCode(65 + i)}` })));
  assert.equal(many.length, 12);
});

test('capabilityFor: evidence path (longest prefix) → cited table / route → area name → none', () => {
  const at = (ref: string, o: Partial<Finding> = {}): Finding => F('PRODUCT-LOGIC:H1', 't', { evidence: [{ kind: 'file', ref }], ...o });
  // Longest prefix wins: src/app/share/… is under both "src/app" (dashboards) and "src/app/share" (sharing).
  assert.equal(capabilityFor(at('src/app/share/[id]/page.tsx:12'), MAP)?.id, 'sharing');
  assert.equal(capabilityFor(at('src/app/(main)/websites/page.tsx:3'), MAP)?.id, 'dashboards');
  // A workspace-prefixed or repo-normalised path reaches the same anchor.
  assert.equal(capabilityFor(at('umami/src/billing/plan.ts:9'), MAP)?.id, 'billing');
  assert.equal(capabilityFor(at('acme/app/src/lib/share.ts'), MAP)?.id, 'sharing', 'owner/name/<path> from a lane read set');
  assert.equal(capabilityFor(at('code:src/jobs/purge/run.ts:4'), MAP)?.id, 'data-retention', 'a code: evidence ref');
  // No path match → a table / route anchor cited exactly (never a substring of a longer identifier).
  assert.equal(capabilityFor(at('warehouse:select count(*) from event_archive where …', { evidence: [{ kind: 'metric', ref: 'warehouse:select count(*) from event_archive' }] }), MAP)?.id, 'data-retention');
  assert.equal(capabilityFor(at('x', { evidence: [{ kind: 'computation', ref: 'probe', detail: 'website_event_rollup is stale' }] }), MAP), undefined, 'website_event_rollup ≠ website_event');
  assert.equal(capabilityFor(at('x', { evidence: [{ kind: 'computation', ref: 'GET /api/share returns the owner id' }] }), MAP)?.id, 'sharing');
  assert.equal(capabilityFor(at('x', { evidence: [{ kind: 'computation', ref: 'GET /api/shares' }] }), MAP), undefined, 'a route is matched whole');
  // Nothing in the evidence → the synthesis area's name against the capability names.
  const none = at('lib/other/x.go:1');
  assert.equal(capabilityFor(none, MAP, 'Billing and plans')?.id, 'billing', 'punctuation-insensitive');
  assert.equal(capabilityFor(none, MAP, 'Report sharing')?.id, 'sharing', 'token overlap ≥ 1/2');
  assert.equal(capabilityFor(none, MAP, 'Release engineering'), undefined);
  assert.equal(capabilityFor(none, [], 'Billing & plans'), undefined, 'no map → none');
  assert.equal(capabilityForName('', MAP), undefined);
  assert.deepEqual(findingEvidencePaths(at('src/a.ts:10-20')), ['src/a.ts']);
});

test('labelFindings with a map: business findings get a map capability; the Phase 1 area is the fallback', () => {
  const areas: SynthesisArea[] = [{ key: 'm', name: 'Metric correctness', verdict: 'risk', framing: 'x', owner: 'o', basis: ['product-logic:h1', 'product-logic:h2', 'product-logic:h3', 'appsec:h1'] }];
  const fs = [
    F('PRODUCT-LOGIC:H1', 'shared view leaks', { evidence: [{ kind: 'file', ref: 'src/app/share/page.tsx:4' }] }),
    F('PRODUCT-LOGIC:H2', 'dashboard number means something else', { evidence: [{ kind: 'file', ref: 'src/queries/stats/pageviews.ts:40' }] }),
    F('PRODUCT-LOGIC:H3', 'unanchored', { evidence: [{ kind: 'file', ref: 'lib/x.go:1' }] }),
    F('APPSEC:H1', 'security', { evidence: [{ kind: 'file', ref: 'src/app/share/page.tsx:4' }] }),
  ];
  const out = labelFindings(fs, { groups: executionGroups(fs, [], areas), capabilities: MAP });
  assert.deepEqual(out.map((f) => [f.lens, f.capability]), [['business', 'Sharing a report'], ['business', 'Traffic dashboards'], ['business', 'Metric correctness'], ['security', undefined]]);
  // A Phase 1 area label written before the map existed is re-derived; a map label is kept.
  const again = labelFindings(out.map((f, i) => (i === 1 ? { ...f, capability: 'Metric correctness' } : f)), { capabilities: MAP });
  assert.equal(again[1].capability, 'Traffic dashboards');
  assert.equal(labelFindings([{ ...fs[2], lens: 'business', capability: 'Metric correctness' }])[0].capability, 'Metric correctness', 'no map → the record is kept');
});

test('examinedCapabilityIds: a lane read set or any finding evidence touching an anchor', () => {
  assert.deepEqual(examinedCapabilityIds(MAP, { openedPaths: ['acme/umami/src/billing/checkout.ts', 'acme/umami/README.md'] }), ['billing']);
  // "src/app" is an anchor of dashboards: reading a share page examines both (prefix), a ruled-out row counts too.
  assert.deepEqual(examinedCapabilityIds(MAP, { openedPaths: ['o/r/src/app/share/x.tsx'] }), ['sharing', 'dashboards']);
  assert.deepEqual(examinedCapabilityIds(MAP, { findings: [F('X:H1', 'Ruled-out purge', { evidence: [{ kind: 'metric', ref: 'warehouse:select 1 from event_archive' }] })] }), ['data-retention']);
  assert.deepEqual(examinedCapabilityIds(MAP, {}), []);
});

test('the Critic gets "the product\'s capabilities" as context (never evidence); nothing without a map', () => {
  const block = capabilityContextBlock(MAP);
  assert.match(block, /THE PRODUCT'S CAPABILITIES/);
  assert.match(block, /NOT evidence/);
  assert.match(block, /- Sharing a report \(feature, critical\): Owners share a read-only view of a report by link\. — code: src\/app\/share, src\/lib\/share\.ts, route \/api\/share/);
  assert.equal(capabilityContextBlock([]), '');
  assert.equal(capabilityContextBlock(undefined), '');
  const withMap = critiquePrompt({ root: '.', scopeDesc: 's', bundles: [], capabilities: MAP }, 'LENS', '', 3);
  assert.ok(withMap.includes(block) && withMap.indexOf(block) < withMap.indexOf('LENS'), 'before the lens');
  assert.doesNotMatch(critiquePrompt({ root: '.', scopeDesc: 's', bundles: [] }, 'LENS', '', 3), /THE PRODUCT'S CAPABILITIES/);
  // Untrusted model output: backticks / tags / fences are neutralised.
  assert.doesNotMatch(capabilityContextBlock(parseCapabilities([{ ...RAW[2], summary: 'Pay ```<script>``` now.' }])), /```|<script>/);
});

// A mapped run: business findings on two capabilities, one ruled-out check, one security and one engineering finding.
const areas: SynthesisArea[] = [{ key: 'num', name: 'Traffic dashboards', verdict: 'risk', framing: 'numbers', owner: 'o', basis: ['analytics:h9', 'swe-arch:h2'] }];
const fs = labelFindings([
  F('PRODUCT-LOGIC:H1', 'shared view shows more than the owner shared', { severity: 'high', evidence: [{ kind: 'file', ref: 'src/app/share/page.tsx:4' }] }),
  F('PRODUCT-LOGIC:H2', 'bounce rate label vs computation', { evidence: [{ kind: 'file', ref: 'src/queries/stats/bounce.ts:40' }] }),
  F('PRODUCT-LOGIC:H3', 'Ruled-out: purge honours the window', { severity: 'info', evidence: [{ kind: 'file', ref: 'src/jobs/purge/run.ts:4' }] }),
  F('APPSEC:H1', 'token in logs', { severity: 'critical' }),
  F('SWE-ARCH:H2', 'god module'),
], { groups: executionGroups([], [], areas), capabilities: MAP });
const gs: CoverageGap[] = [{ id: 'ANALYTICS:H9', concern: 'unique visitors definition', whyUnsettled: 'u', nextDecisiveTest: 'n', source: 'recommendation-audit', status: 'unmeasured', hypothesisId: 'analytics:h9' }];
const examined = examinedCapabilityIds(MAP, { openedPaths: [], findings: fs });

test('capabilityHealth with a map: green = examined + nothing confirmed, grey = not examined', () => {
  assert.equal(capabilityHealth({ confirmed: 0, highCrit: 0, ruledOut: 0, examined: true }), 'green');
  assert.equal(capabilityHealth({ confirmed: 0, highCrit: 0, ruledOut: 0, examined: false }), 'grey');
  assert.equal(capabilityHealth({ confirmed: 1, highCrit: 1, ruledOut: 0, examined: false }), 'red', 'a confirmed finding still decides');
  assert.equal(capabilityHealth({ confirmed: 0, highCrit: 0, ruledOut: 0 }), 'grey', 'Phase 1 unchanged without a map');
});

test('lensBriefFor with a map: EVERY capability is a tile — red / amber / green / grey, critical first within a colour', () => {
  const b = lensBriefFor(fs, gs, executionGroupsFor(fs, gs, areas, MAP), undefined, { capabilities: MAP, examined });
  assert.equal(b.mapped, true);
  assert.deepEqual(b.capabilities.map((t) => [t.name, t.health, t.findingIds.length, t.open, Boolean(t.critical)]), [
    ['Sharing a report', 'red', 1, 0, true],
    ['Traffic dashboards', 'amber', 1, 1, false],
    ['Data retention', 'green', 0, 0, false],     // examined (a ruled-out check touched its anchor)
    ['Billing & plans', 'grey', 0, 0, false],     // never examined
  ]);
  assert.deepEqual(b.security.findingIds, ['APPSEC:H1']);
  assert.deepEqual(b.engineering.findingIds, ['SWE-ARCH:H2']);
  // A budget-skipped (planned, never examined) business check is not an open question on a mapped brief (umami E2E:
  // 14 cap-overflow rows drew an "Other · 14 open" tile); Phase 1 still counts it.
  const skipped: CoverageGap = { id: 'PRODUCT-LOGIC:H9', concern: 'c', whyUnsettled: 'cap', nextDecisiveTest: 'n', source: 'preflight:lint', status: 'budget_skipped', hypothesisId: 'product-logic:h9', bundleId: 'product-logic' };
  const withSkip = lensBriefFor(fs, [...gs, skipped], executionGroupsFor(fs, [...gs, skipped], areas, MAP), undefined, { capabilities: MAP, examined });
  assert.ok(!withSkip.capabilities.some((t) => t.name === 'Other'), 'no "Other" tile from a budget-skipped check');
  assert.ok(lensBriefFor(fs, [skipped], executionGroups(fs, [skipped], areas)).capabilities.some((t) => t.name === 'Other' && t.open === 1));
  // Without a map: Phase 1 behaviour (only the capabilities findings sit in, no mapped flag).
  const p1 = lensBriefFor(fs, gs, executionGroups(fs, gs, areas));
  assert.equal(p1.mapped, undefined);
  assert.ok(!p1.capabilities.some((t) => t.name === 'Billing & plans'));
});

test('the injected map draws every capability, marks critical ones, and says grey = not examined', () => {
  const lens = lensBriefFor(fs, gs, executionGroupsFor(fs, gs, areas, MAP), undefined, { capabilities: MAP, examined });
  const out = injectDetailIndex('<!doctype html><body><p>x</p></body>', buildReportRefs(fs, '/api/runs/rs_x/report'), { lens });
  for (const n of ['Sharing a report', 'Traffic dashboards', 'Data retention', 'Billing &amp; plans']) assert.ok(out.includes(`>${n}</text>`), `tile ${n}`);
  assert.match(out, /<text class="cap-critical"[^>]*>◆<\/text>/);
  assert.equal((out.match(/class="cap-critical"/g) ?? []).length, 1, 'one ◆, on the critical tile only');
  assert.match(out, /aria-label="Capability map: Sharing a report \(critical\): confirmed high or critical issue — 1 confirmed · 1 high\+; Traffic dashboards: confirmed issue — 1 confirmed · 1 open; Data retention: examined, nothing confirmed — 1 checked healthy; Billing &amp; plans: not examined in this scan"/);
  assert.match(out, />not examined in this scan<\/span>/, 'legend: grey = not examined');
  assert.match(out, /◆ critical capability/);
  assert.match(out, /grey ones were not examined in this scan/);
});

test('Execution: business findings grouped by capability name (map order), security first, every finding once', () => {
  const groups = capabilityGroups(executionGroups(fs, gs, areas), fs, MAP);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.findingIds, g.gapIds]), [
    ['cap:sharing', 'Sharing a report', ['PRODUCT-LOGIC:H1'], []],
    // The synthesis area "Traffic dashboards" IS a capability: folded in whole (its engineering finding + open question too).
    ['cap:dashboards', 'Traffic dashboards', ['PRODUCT-LOGIC:H2', 'SWE-ARCH:H2'], ['ANALYTICS:H9']],
    ['cap:data-retention', 'Data retention', ['PRODUCT-LOGIC:H3'], []],
    ['other', 'Other', ['APPSEC:H1'], []],
  ]);
  assert.equal(groups[0].framing, 'Owners share a read-only view of a report by link.', 'framed by the capability summary');
  assert.deepEqual(capabilityGroups(executionGroups(fs, gs, areas), fs, []), executionGroups(fs, gs, areas), "no map → unchanged");
  const model = buildExecutionModel({ findings: fs, hypotheses: [], mitigations: [], gaps: gs, areas, capabilities: MAP });
  assert.deepEqual(model.groups.map((g) => g.name), ['Security', 'Sharing a report', 'Traffic dashboards', 'Data retention']);
  const ids = model.groups.flatMap((g) => g.findingIds);
  assert.equal(ids.length, fs.length); assert.equal(new Set(ids).size, fs.length);
  // No map: the Phase 1 grouping, unchanged.
  assert.deepEqual(buildExecutionModel({ findings: fs, hypotheses: [], mitigations: [], gaps: gs, areas }).groups.map((g) => g.name), ['Security', 'Traffic dashboards', 'Other']);
});

test('v5 author: the capability list (name + summary + status) in product language', () => {
  const hyp = (id: string, claim: string): Hypothesis => ({ id, claim, status: 'supported', symptom: 's', decisiveMetric: 'm', measurement: { value: 1 } } as unknown as Hypothesis);
  const hyps = fs.map((f) => hyp(f.id.toLowerCase(), f.title));
  const o: LeadershipWriterOpts = {
    company: 'Acme', scopeDesc: 's', meta: 'm', hypotheses: hyps, mitigations: [], variant: 'v5',
    lens: leadershipLensFor(hyps.map((h) => h.id), fs, gs, executionGroupsFor(fs, gs, areas, MAP), undefined, { capabilities: MAP, examined }),
  };
  const block = lensMaterialBlock(o);
  assert.match(block, /the PRODUCT's own capabilities/);
  assert.match(block, /Use these NAMES verbatim/);
  assert.match(block, /- Sharing a report \[red\] \(critical\) — 1 confirmed, 1 high or critical\n {4}what users get: Owners share a read-only view of a report by link\./);
  assert.match(block, /- Data retention \[green\] — 1 checked and ruled out, examined, nothing confirmed/);
  assert.match(block, /- Billing & plans \[grey\] — not examined in this scan\n {4}what users get: Customers pick a plan and pay\./);
  assert.doesNotMatch(block, /token in logs|god module/, 'security / engineering stay counts only');
  assert.equal(o.lens!.capabilityOf['product-logic:h1'], 'Sharing a report');
});

// ── Phase 2 fixes from an end-to-end run on the umami repo ─────────────────────────────────────────────────────────

test('capabilityFor step 3: the synthesis assignment — after the anchors, before the area name', () => {
  // The bounce-rate finding cited query files no anchor covers, so it kept its synthesis area ("Analytics metric trust").
  const bounce = F('ANALYTICS:H2', 'Bounce has three definitions', { evidence: [{ kind: 'file', ref: 'getWebsiteStats.ts:49 vs getBreakdown.ts:45' }] });
  assert.equal(capabilityFor(bounce, MAP, 'Analytics metric trust'), undefined, 'old rule: nothing reaches it');
  assert.equal(capabilityFor(bounce, MAP, 'Analytics metric trust', 'dashboards')?.id, 'dashboards');
  assert.equal(capabilityFor(bounce, MAP, 'Billing & plans', 'dashboards')?.id, 'dashboards', 'the assignment beats the area name');
  assert.equal(capabilityFor(F('X:H1', 't', { evidence: [{ kind: 'file', ref: 'src/billing/p.ts' }] }), MAP, undefined, 'dashboards')?.id, 'billing', 'an anchor match beats the assignment');
  assert.equal(capabilityFor(bounce, MAP, undefined, 'no-such-capability'), undefined, 'an unknown id is ignored');
  const out = labelFindings([bounce], { capabilities: MAP, assignments: [{ id: 'analytics:h2', capabilityId: 'dashboards' }] });
  assert.equal(out[0].capability, 'Traffic dashboards');
});

test('validCapabilityAssignments: known hypothesis + a map capability id, first wins; the prompt lists the map', () => {
  const known = ['analytics:h2', 'product-logic:h1', 'data-eng:h1', 'appsec:h1'];
  const v = validCapabilityAssignments([
    { id: 'analytics:h2', capabilityId: 'dashboards' },
    { id: 'ANALYTICS:H2', capabilityId: 'billing' },                  // duplicate id (case-insensitive) → first wins
    { id: 'product-logic:h1', capabilityId: 'Sharing a report' },     // a NAME, not an id
    { id: 'product-logic:h9', capabilityId: 'sharing' },              // unknown hypothesis
    { id: 'data-eng:h1', capabilityId: ' Billing ' },                 // id normalised
    { id: 'appsec:h1' },                                              // no capability
    'junk', null,
  ], known, MAP);
  assert.deepEqual(v, [{ id: 'analytics:h2', capabilityId: 'dashboards' }, { id: 'data-eng:h1', capabilityId: 'billing' }]);
  assert.deepEqual(validCapabilityAssignments([{ id: 'analytics:h2', capabilityId: 'dashboards' }], known, []), [], 'no map → none');
  assert.deepEqual(validCapabilityAssignments({ a: 1 }, known, MAP), []);
  const hs = [{ id: 'analytics:h2', claim: 'c', status: 'supported', symptom: 's', decisiveMetric: 'm', measurement: { value: 1 } }] as unknown as Hypothesis[];
  const p = synthesisPrompt(hs, [], 'scope', '', MAP);
  assert.match(p, /6\. CAPABILITY: for each BUSINESS-lens hypothesis/);
  assert.match(p, /- dashboards: Traffic dashboards — Customers see visitor and page-view numbers\./);
  assert.match(p, /"capabilityIds":\[/);
  assert.doesNotMatch(synthesisPrompt(hs, [], 'scope', ''), /CAPABILITY:|capabilityIds/, 'no map → the prompt is unchanged');
});

test('mapped brief: no synthesis-area tile — one "Not tied to a single feature" tile; untied open questions are a line', () => {
  const ar: SynthesisArea[] = [
    { key: 'trust', name: 'Analytics metric trust', verdict: 'critical', framing: 'x', owner: 'o', basis: ['analytics:h2', 'analytics:h1'] },
    { key: 'parity', name: 'Cross-backend reporting parity', verdict: 'risk', framing: 'y', owner: 'o', basis: ['product-logic:h1', 'product-logic:h2'] },
  ];
  const lf = labelFindings([
    F('ANALYTICS:H2', 'Bounce has three definitions', { severity: 'high', evidence: [{ kind: 'file', ref: 'getWebsiteStats.ts:49' }] }),
    F('DATA-ENG:H7', 'Totals drift', { evidence: [{ kind: 'file', ref: 'lib/other.go:1' }] }),
  ], { groups: executionGroups([], [], ar), capabilities: MAP, assignments: [{ id: 'analytics:h2', capabilityId: 'dashboards' }] });
  const g = (id: string, concern: string): CoverageGap => ({ id, concern, whyUnsettled: 'u', nextDecisiveTest: 'n', source: 's', status: 'unmeasured', hypothesisId: id.toLowerCase() });
  const gs2 = [g('PRODUCT-LOGIC:H1', 'Do both backends agree?'), g('PRODUCT-LOGIC:H2', 'Is GET /api/share rate limited?'), g('ANALYTICS:H1', 'Visitors defined twice')];
  const mapIn = { capabilities: MAP, examined: ['dashboards'], assignments: [{ id: 'analytics:h2', capabilityId: 'dashboards' }, { id: 'analytics:h1', capabilityId: 'dashboards' }] };
  const b = lensBriefFor(lf, gs2, executionGroupsFor(lf, gs2, ar, MAP), undefined, mapIn);
  const names = b.capabilities.map((t) => t.name);
  assert.ok(!names.includes('Analytics metric trust') && !names.includes('Cross-backend reporting parity') && !names.includes('Other'), names.join(', '));
  assert.deepEqual(b.capabilities.find((t) => t.name === 'Traffic dashboards')!.findingIds, ['ANALYTICS:H2'], 'the synthesis assignment places the bounce finding');
  assert.equal(b.capabilities.find((t) => t.name === 'Traffic dashboards')!.open, 1, 'an assigned open question sits on its capability');
  assert.equal(b.capabilities.find((t) => t.name === 'Sharing a report')!.open, 1, 'an open question citing a route anchor');
  const untied = b.capabilities.at(-1)!;
  assert.deepEqual([untied.name, untied.findingIds, untied.untied], ['Not tied to a single feature', ['DATA-ENG:H7'], true], 'last');
  assert.equal(b.untiedOpen, 1, 'the parity question is counted, not drawn');
  const out = injectDetailIndex('<!doctype html><body><p>x</p></body>', buildReportRefs(lf, '/r'), { lens: b });
  assert.match(out, /1 open question not tied to a single feature/);
  // The author's per-hypothesis capability uses the same names.
  const ll = leadershipLensFor(['analytics:h2', 'data-eng:h7', 'analytics:h1', 'product-logic:h1'], lf, gs2, executionGroupsFor(lf, gs2, ar, MAP), undefined, mapIn);
  assert.deepEqual([ll.capabilityOf['analytics:h2'], ll.capabilityOf['data-eng:h7'], ll.capabilityOf['analytics:h1'], ll.capabilityOf['product-logic:h1']], ['Traffic dashboards', 'Not tied to a single feature', 'Traffic dashboards', undefined]);
});

test('examined = a lane OPENED an anchored file, or evidence / a hypothesis cites it — never a listing, prose, or a shared table', () => {
  assert.deepEqual(examinedCapabilityIds(MAP, { openedPaths: ['acme/umami/src/billing/checkout.ts'] }), ['billing']);
  assert.deepEqual(examinedCapabilityIds(MAP, {}), [], 'a lane that only listed files examined nothing');
  const shared = parseCapabilities([...RAW, { id: 'realtime', name: 'Realtime visitors', kind: 'feature', summary: 's.', anchors: { paths: ['src/realtime'], tables: ['website_event'] } }]);
  const byTable = F('X:H1', 't', { evidence: [{ kind: 'metric', ref: 'warehouse:select 1 from website_event' }] });
  assert.deepEqual(examinedCapabilityIds(shared, { findings: [byTable] }), [], 'website_event is anchored by two capabilities — it names neither');
  assert.deepEqual(examinedCapabilityIds(MAP, { findings: [byTable] }), ['dashboards'], 'a table only one capability anchors');
  assert.deepEqual(examinedCapabilityIds(MAP, { findings: [F('X:H2', 'purge of event_archive', { evidence: [{ kind: 'computation', ref: 'probe' }] })] }), [], 'the title prose is not evidence');
  assert.deepEqual(examinedCapabilityIds(MAP, { hypotheses: [{ claim: 'GET /api/share leaks the owner', note: 'read src/billing/plan.ts' }] }), ['sharing', 'billing']);
});

// ── Map placement: right after the lead card (umami E2E: the map sat at the very bottom of the brief) ────────────────
const mapLens = () => lensBriefFor(fs, gs, executionGroupsFor(fs, gs, areas, MAP), undefined, { capabilities: MAP, examined });
const since: SinceLastScan = { baseline: { runId: 'rs_b', date: '2026-09-20', sha: 'abc1234' }, counts: { fixed: 1, new: 2, persisting: 3, changed: 0, unchecked: 0 }, tags: {}, fixed: [], unchecked: [], statuses: [] };
const vibe = (inner: string): string => `<html><body><div class="wrap">${inner}</div></body></html>`;

test('v5 map placement: at the author\'s <!--capability-map--> anchor; Since-last-scan right after the map; idempotent', () => {
  const refs = buildReportRefs(fs, '/r');
  const page = vibe('<h1>T</h1><div class="lead">VERDICT</div><!--capability-map--><section>CARD-A</section><p>TAIL</p>');
  const out = injectDetailIndex(page, refs, { lens: mapLens(), since });
  const iLead = out.indexOf('VERDICT'), iMap = out.indexOf('lens-brief', iLead), iSince = out.indexOf('since-last-scan', iLead), iCard = out.indexOf('CARD-A');
  assert.ok(iLead < iMap && iMap < iSince && iSince < iCard, 'lead card → map → since → cards');
  assert.equal((out.match(/class="detail-index lens-brief"/g) ?? []).length, 1, 'one map');
  assert.ok(out.indexOf('lens-brief') < out.indexOf('TAIL'), 'not at the bottom any more');
  assert.equal(reinjectDetailIndex(out, refs, { lens: mapLens(), since }), out, 'strip-then-reinject is idempotent');
  // v0 / v4 (Area health, no lens) keep the end-of-content position.
  const ah = injectDetailIndex(page, refs, { themes: [{ key: 'k', name: 'THEME', findingIds: [fs[0].id] }] });
  assert.ok(ah.indexOf('area-health') > ah.indexOf('TAIL'), 'Area health stays at the end');
});

test('v5 map placement fallbacks: after the lead-looking element under the <h1>; else after the <h1>; else the content top', () => {
  const refs = buildReportRefs(fs, '/r');
  const lead = injectDetailIndex(vibe('<h1>T</h1><div class="meta">META</div><div class="tldr-card">VERDICT</div><section class="cap">CARD</section>'), refs, { lens: mapLens() });
  assert.ok(lead.indexOf('VERDICT') < lead.indexOf('lens-brief') && lead.indexOf('lens-brief') < lead.indexOf('CARD'), 'after the TL;DR card, not after the meta strip');
  const next = injectDetailIndex(vibe('<h1>T</h1><p>VERDICT</p><h2>A</h2><p>CARD</p>'), refs, { lens: mapLens() });
  assert.ok(next.indexOf('VERDICT') < next.indexOf('lens-brief') && next.indexOf('lens-brief') < next.indexOf('CARD'), 'after the element that follows the title');
  const top = injectDetailIndex(vibe('<p>NO TITLE</p>'), refs, { lens: mapLens() });
  assert.ok(top.indexOf('<div class="wrap"><div class="detail-index lens-brief"') > 0, 'top of the content, inside the column');
  assert.equal(reinjectDetailIndex(lead, refs, { lens: mapLens() }), lead);
});

test('v5 map placement (structured fallback brief): right after the lead card, before the sections, re-injected in place', () => {
  const refs = buildReportRefs(fs, '/r');
  const html = renderRecallReport({ company: 'Acme', title: 'T', question: 'q', meta: 'm', bottomLine: 'VERDICT', decisions: ['DECIDE'], cards: [], sections: [{ n: '01', heading: 'CARD', body: 'b' }], decisive: '', recommendations: [], caveats: 'c' });
  const out = injectDetailIndex(html, refs, { lens: mapLens(), since });
  const iMap = out.indexOf('lens-brief');
  assert.ok(out.indexOf('DECIDE') < iMap && iMap < out.indexOf('since-last-scan') && out.indexOf('since-last-scan') < out.indexOf('CARD'), 'lead (verdict + decisions) → map → since → cards');
  assert.equal(reinjectDetailIndex(out, refs, { lens: mapLens(), since }), out);
});

test('tile names wrap onto two lines (tspan) instead of being cut; only a name longer than two lines is cut; ◆ kept', () => {
  assert.deepEqual(wrapTileName('Website traffic dashboard'), ['Website traffic', 'dashboard']);
  assert.deepEqual(wrapTileName('Public sharing of dashboards & reports', true), ['Public sharing of', 'dashboards & reports']);
  assert.deepEqual(wrapTileName('Teams & member access'), ['Teams & member access']);
  const long = wrapTileName('Campaign tracking links, pixels, attribution and every other marketing surface');
  assert.equal(long.length, 2); assert.match(long[1], /…$/);
  assert.deepEqual(wrapTileName('Not tied to a single feature'), ['Not tied to a single', 'feature']);
  const caps = parseCapabilities([{ ...RAW[0], name: 'Public sharing of dashboards & reports' }, { ...RAW[1], name: 'Website traffic dashboard' }]);
  const lf = labelFindings([F('PRODUCT-LOGIC:H1', 'x', { severity: 'high', evidence: [{ kind: 'file', ref: 'src/app/share/p.ts' }] })], { capabilities: caps });
  const out = injectDetailIndex('<!doctype html><body><p>x</p></body>', buildReportRefs(lf, '/r'), { lens: lensBriefFor(lf, [], executionGroupsFor(lf, [], undefined, caps), undefined, { capabilities: caps, examined: [] }) });
  assert.ok(out.includes('<tspan x="18">Public sharing of</tspan><tspan x="18" dy="18">dashboards &amp; reports</tspan>'), 'the critical tile wraps');
  assert.ok(out.includes('>Website traffic</tspan>') && !out.includes('dashb…'), 'no cut label');
  assert.match(out, /<text class="cap-critical"[^>]*>◆<\/text>/);
  assert.match(out, /viewBox="0 0 420 106"/, 'every tile grows by one name line (88 → 106)');
});

test('capability parsing: an unknown key (e.g. a translated name field) drops the item — the schema is strict', () => {
  const caps = parseCapabilities([{ id: 'sharing', name: 'Sharing a report', kind: 'feature', summary: 'Share a report.', anchors: { paths: ['src/share'] } },
    { id: 'billing', name: 'Billing & plans', nameLocal: 'x', kind: 'feature', summary: 'Pay.', anchors: { paths: ['src/billing'] } }]);
  assert.deepEqual(caps.map((c) => c.id), ['sharing']);
});
