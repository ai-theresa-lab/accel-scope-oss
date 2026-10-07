import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lensKeyFor, renderFindingsHtml } from './reportHtml.ts';
import { buildReportRefs } from './reportAnchors.ts';
import type { Finding, MinerResult } from './schema.ts';

// Guards the anchor fix: finding comment-anchors must be CONTENT-stable, never the positional f.id
// (`<INVARIANT>-<array-index>`), which would migrate a saved comment onto a different finding when the set is
// regenerated. The finding cards render CLIENT-SIDE, so each finding's `anchorId` travels in the embedded
// __ACCEL_DATA__ view-model JSON; the RUNTIME card builders (fcard/lrow/bcard) read that anchorId.

const mkFinding = (over: Partial<Finding>): Finding => ({
  id: 'X-01', dimension: 'code_health', title: 'Headline claim', claim: 'assertion with concrete numbers',
  evidence: [{ kind: 'file', ref: 'a.ts:1' }], businessImpact: 'why it matters', recommendation: 'do X',
  severity: 'high', confidence: 'high', effort: 'quick_win', source: 'test', ...over,
});
const mkResult = (findings: Finding[]): MinerResult => ({ miner: 'test', target: 'repo', metrics: {}, findings });
const anchorIds = (html: string): string[] => [...html.matchAll(/"anchorId":"(finding-[^"]+)"/g)].map((m) => m[1]); // captures -2/-3 dedupe suffix too

test('finding anchors derive from CONTENT (finding-<hash>), and are REORDER-stable (not positional f.id)', () => {
  const a = mkFinding({ id: 'I1-01', title: 'Alpha' });
  const b = mkFinding({ id: 'I1-02', title: 'Beta' });
  const ids1 = anchorIds(renderFindingsHtml(mkResult([a, b]), '2026-01-01'));
  const ids2 = anchorIds(renderFindingsHtml(mkResult([b, a]), '2026-01-01')); // same findings, swapped order
  assert.equal(ids1.length, 2);
  ids1.forEach((x) => assert.match(x, /^finding-[a-z0-9]+$/));
  assert.deepEqual([...ids1].sort(), [...ids2].sort()); // each id follows its finding, not its position
  assert.equal(new Set(ids1).size, 2);                  // distinct content → distinct ids
});

test('anchor keys on CONTENT, not f.id: changed claim → new id; same content under a different f.id → same id', () => {
  const before = anchorIds(renderFindingsHtml(mkResult([mkFinding({ id: 'I1-01', title: 'Cache stampede' })]), 'd'))[0];
  // reword the headline (same positional f.id) → a NEW anchor (comment orphans — correct, not mis-attach)
  const reworded = anchorIds(renderFindingsHtml(mkResult([mkFinding({ id: 'I1-01', title: 'Cache stampede on cold start' })]), 'd'))[0];
  assert.notEqual(before, reworded);
  // identical content under a DIFFERENT positional f.id → the SAME anchor (proves keyed on content, not f.id)
  const sameContentDiffId = anchorIds(renderFindingsHtml(mkResult([mkFinding({ id: 'Z9-99', title: 'Cache stampede' })]), 'd'))[0];
  assert.equal(before, sameContentDiffId);
});

test('all three finding view renderers (fcard/lrow/bcard) stamp f.anchorId — the positional finding-<f.id> form is gone', () => {
  const html = renderFindingsHtml(mkResult([mkFinding({})]), 'd');
  assert.equal((html.match(/data-anchor-id="' \+ esc\(f\.anchorId\) \+ '"/g) || []).length, 3, 'fcard + lrow + bcard');
  assert.doesNotMatch(html, /data-anchor-id="finding-' \+ esc\(f\.id\)/); // no positional finding anchor anywhere
});

test('case is significant: findings whose evidence ref differs ONLY by case (Foo.ts vs foo.ts) get DISTINCT anchors', () => {
  const a = mkFinding({ evidence: [{ kind: 'file', ref: 'src/Foo.ts:1' }] });
  const b = mkFinding({ evidence: [{ kind: 'file', ref: 'src/foo.ts:1' }] });
  const [ia, ib] = anchorIds(renderFindingsHtml(mkResult([a, b]), 'd'));
  assert.notEqual(ia, ib, 'case-distinct paths are distinct blocks on a case-sensitive FS — must not collide');
  // bare base ids (finding-<16 hex>), i.e. NO `-N` dedupe suffix (they didn't collide)
  assert.match(ia, /^finding-[0-9a-f]{16}$/); assert.match(ib, /^finding-[0-9a-f]{16}$/);
});

test('the anchor hashes the FULL content: a change in ANY single field → DISTINCT base id (no dedupe suffix)', () => {
  const idOf = (over: Partial<Finding>): string => anchorIds(renderFindingsHtml(mkResult([mkFinding({ invariant: 'i3', ...over })]), 'd'))[0];
  const baseId = idOf({});
  const variants: Array<[string, Partial<Finding>]> = [
    ['evidence.ref', { evidence: [{ kind: 'file', ref: 'z.ts:99' }] }],
    ['evidence.detail', { evidence: [{ kind: 'file', ref: 'a.ts:1', detail: 'an extra note' }] }],
    ['recommendation', { recommendation: 'do something completely different' }],
    ['businessImpact', { businessImpact: 'a totally different business impact' }],
    ['effort', { effort: 'project' }],
    ['confidence', { confidence: 'low' }],
    ['severity', { severity: 'critical' }],
    ['source', { source: 'a-different-miner' }],
    ['invariant', { invariant: 'i7' }],
    ['title', { title: 'A different headline' }],
    ['claim', { claim: 'a different assertion body' }],
  ];
  for (const [label, over] of variants) {
    const vid = idOf(over);
    assert.notEqual(vid, baseId, `differing in ${label} must change the base anchor`);
    assert.match(vid, /^finding-[0-9a-f]{16}$/, `${label}: bare base id (16-hex), NOT a -N dedupe suffix`);
  }
});

test('findings with IDENTICAL stable content get UNIQUE deduped anchors (x, x-2, x-3), deterministic across runs', () => {
  const twin = { title: 'Same', dimension: 'code_health' as const, severity: 'high' as const, claim: 'same assertion' };
  const three = [mkFinding({ ...twin, id: 'A-01' }), mkFinding({ ...twin, id: 'B-02' }), mkFinding({ ...twin, id: 'C-03' })];
  const ids1 = anchorIds(renderFindingsHtml(mkResult(three), 'd'));
  const ids2 = anchorIds(renderFindingsHtml(mkResult(three), 'd'));
  assert.equal(new Set(ids1).size, 3, 'three content-identical findings still get three DISTINCT anchor ids');
  assert.match(ids1[1], /-2$/); assert.match(ids1[2], /-3$/); // deterministic suffix order
  assert.equal(ids1[1], `${ids1[0]}-2`); assert.equal(ids1[2], `${ids1[0]}-3`);
  assert.deepEqual(ids1, ids2, 'deterministic across renders');
});

test('static top-level sections + evidence tables carry semantic anchors', () => {
  const html = renderFindingsHtml(mkResult([mkFinding({})]), 'd');
  for (const id of ['section-overview', 'section-findings', 'section-evidence', 'table-hotspots', 'table-contributors']) {
    assert.ok(html.includes(`data-anchor-id="${id}"`), `${id} present`);
  }
});

// The citation highlight is added as ' anchor-hit' (leading space) and cleared 2.6s later. That removal regex is
// authored inside the String.raw RUNTIME block, where a dropped backslash silently degrades it to "zero-or-more
// literal s": the class still goes, the SPACE stays, and className grows by one space per citation navigation.
// Asserting on the EMITTED html because the escape has to survive all the way into the shipped runtime.
test('the anchor-hit highlight clears WITH its leading space (emitted regex is \\s*, not the literal-s typo)', () => {
  const html = renderFindingsHtml(mkResult([mkFinding({})]), 'd');
  const escaped = String.raw`replace(/\s*anchor-hit/g`;   // what the runtime must contain
  const collapsed = 'replace(/s*anchor-hit/g';                    // what a dropped backslash leaves behind
  assert.ok(html.includes(escaped), 'emitted runtime must carry the backslash-s escape');
  assert.ok(!html.includes(collapsed), 'collapsed form leaves a trailing space behind on every navigation');
});

// ── a local, .git-less self-scan on a $108 run printed
// "0 repos · 0 people · $0 · 0.0% test ratio (0/0 files)" and labelled every code-native finding "Product metrics".
const vmOf = (html: string): any => JSON.parse(html.match(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/)![1]);

test('with no git history the header and vitals say "not available", never 0 — and cost comes from the run', () => {
  const org: MinerResult = { miner: 'org-aggregate', target: 'organization · x', metrics: { summary: { org: true, busFactor: 0 } }, findings: [mkFinding({})] };
  const html = renderFindingsHtml(org, '2026-09-25T00:00:00Z', true, undefined, 108.18);
  assert.doesNotMatch(html, /0 repos · 0 people/);
  assert.doesNotMatch(html, /· \$0</, 'no fabricated $0');
  assert.match(html, /not available \(no git history\)/);
  assert.match(html, /2026-09-25 · \$108\.18/, 'the run cost is shown');
  const vm = vmOf(html);
  {
    const tr = vm.vitals.find((v: any) => v.label === 'Test ratio');
    assert.equal(tr.value, '—');
    assert.equal(vm.vitals.find((v: any) => v.label === 'Repositories').value, '—');
    assert.equal(vm.vitals.find((v: any) => v.label === 'Findings').value, '1', 'the finding count is still a fact');
  }
  // Cost unknown ⇒ omitted, not "$0".
  assert.doesNotMatch(renderFindingsHtml(org, '2026-09-25', true), /\$0\b/);
});

test('a run WITH git history keeps its real numbers', () => {
  const org: MinerResult = { miner: 'org-aggregate', target: 'o', metrics: { summary: { org: true, repos: 3, people: 7, busFactor: 2, testRatio: 0.25, codeFiles: 40 } }, findings: [] };
  const html = renderFindingsHtml(org, '2026-09-25', true);
  // Report scope: the header carries the repo count, never the contributor count (an open-source repo's every git
  // author read as a team size); the people number stays in the labelled vitals.
  const header = /<header class="topbar" id="repTopbar">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  assert.match(header, /3 repos/);
  assert.doesNotMatch(header, /people/);
  assert.doesNotMatch(html, /no git history/);
});

test('a code-native bundle finding takes its bundle\'s lens, not "Product metrics"', () => {
  assert.equal(lensKeyFor({ id: 'API-STABILITY:H6', dimension: 'product_metrics' }), 'code');
  assert.equal(lensKeyFor({ id: 'APPSEC:H1', dimension: 'product_metrics' }), 'security');
  assert.equal(lensKeyFor({ id: 'RELEASE-ENG:H2', dimension: 'product_metrics' }), 'delivery');
  assert.equal(lensKeyFor({ id: 'SAAS-TENANCY:H1', dimension: 'product_metrics' }), 'security');
  // Data/product bundles keep Product metrics; a non-product dimension is never overridden.
  assert.equal(lensKeyFor({ id: 'RECSYS-MLE:H1', dimension: 'product_metrics' }), 'product');
  assert.equal(lensKeyFor({ id: 'API-STABILITY:H6', dimension: 'knowledge_risk' }), 'knowledge');
  const html = renderFindingsHtml(mkResult([mkFinding({ id: 'SWE-ARCH:H1', dimension: 'product_metrics' })]), 'd');
  assert.match(html, /"lensLabel":"Code &? ?(?:&amp;)?[^"]*architecture"/);
  assert.doesNotMatch(html, /"lensLabel":"Product metrics"/);
});

// A 1-repo deterministic org report printed "1 repos · 2 people" / "across 1 repos".
test('a one-repo / one-person / one-finding org report uses the singular', () => {
  const r: MinerResult = { miner: 'org-aggregate', target: 'org', metrics: { summary: { org: true, repos: 1, people: 1, commits: 1 } }, findings: [mkFinding({})] };
  const html = renderFindingsHtml(r, 'd');
  assert.doesNotMatch(html, /\b1 (repos|people|findings)\b/);
  assert.match(html, /1 repo\b/);
  assert.match(html, /1 person\b/);
});

// History present but 0 classified files → no "0.0% · 0 / 0 files".
test('no classified code files → the test ratio reads "not available", not 0.0% · 0 / 0 files', () => {
  const r: MinerResult = { miner: 'org-aggregate', target: 'org', metrics: { summary: { org: true, repos: 2, people: 3, commits: 40, codeFiles: 0, testFiles: 0, testRatio: 0 } }, findings: [mkFinding({})] };
  const html = renderFindingsHtml(r, 'd');
  assert.doesNotMatch(html, /0 \/ 0 files/);
  assert.doesNotMatch(html, /test ratio 0\.0%/i);
  assert.match(html, /no code files classified/);
});

// ── report UX pass ─────────────────────────────────────────────────────────────────────

test('__ACCEL_DATA__ findings carry displayId (confirmed only) + status, and the ids match the leadership refs', () => {
  const fs = [
    mkFinding({ id: 'A-1', title: 'medium one', severity: 'medium' }),
    mkFinding({ id: 'SWE-ARCH:H2', title: 'healthy check', severity: 'info', source: 'recommendation-audit' }),
    mkFinding({ id: 'A-3', title: 'critical one', severity: 'critical' }),
  ];
  const vm = vmOf(renderFindingsHtml(mkResult(fs), '2026-01-01'));
  assert.deepEqual(vm.findings.map((f: any) => [f.displayId, f.status]), [['F-02', 'confirmed'], [undefined, 'ruled-out'], ['F-01', 'confirmed']]);
  assert.ok(!('displayId' in vm.findings[1]), 'absent (not null) on a ruled-out row');
  // Same run → same id everywhere: the leadership citation for "critical one" is F-01 too.
  const refs = buildReportRefs(fs, '/r');
  assert.deepEqual(refs.map((r) => [r.displayId, r.title]), [['F-01', 'critical one'], ['F-02', 'medium one']]);
  assert.equal(refs[0].anchor, vm.findings[2].anchorId);
});

test('a ruled-out row is titled "Ruled out: …" and its detail offers no remediation task', () => {
  const html = renderFindingsHtml(mkResult([mkFinding({ id: 'SWE-ARCH:H2', title: 'Cache is healthy', severity: 'info', source: 'recommendation-audit' })]), '2026-01-01');
  assert.equal(vmOf(html).findings[0].claim, 'Ruled out: Cache is healthy');
  assert.match(html, /f\.status === 'ruled-out'[\s\S]{0,40}No action/, 'the detail pane swaps the task block for "No action"');
  assert.match(html, /<span class="st st-ruled-out">Ruled out<\/span>/, 'cards wear the shared ruled-out chip');
});

test('answer-back and open-question rows use the shared status chips', () => {
  const html = renderFindingsHtml({ ...mkResult([mkFinding({})]),
    answerBack: [{ concern: 'is the cache stale', status: 'refuted' }, { concern: 'is the key shared', status: 'supported' }] as never,
    coverageGaps: [{ id: 'g', concern: 'freshness', whyUnsettled: 'no warehouse', nextDecisiveTest: 'query', source: 's', status: 'blocked' }, { id: 'h', concern: 'drift', whyUnsettled: 'not run', nextDecisiveTest: 'run', source: 's', status: 'unmeasured' }],
  }, '2026-01-01', false, 'check the cache');
  assert.match(html, /<span class="st st-ruled-out">Ruled out<\/span> is the cache stale/);
  assert.match(html, /<span class="st st-confirmed">Confirmed<\/span> is the key shared/);
  assert.match(html, /<span class="st st-not-measurable">Not measurable here<\/span> <b>freshness/);
  assert.match(html, /<span class="st st-needs-test">Needs a test<\/span> <b>drift/);
  assert.match(html, /\.st-confirmed\{/, 'the chip CSS ships with the report');
});

test('the evidence list renders a serve-time permalink only for https://github.com/ hrefs', () => {
  const html = renderFindingsHtml(mkResult([mkFinding({})]), '2026-01-01');
  assert.ok(!('href' in vmOf(html).findings[0].evidence[0]), 'no link is baked in at render time (share policy is per serve)');
  const evref = new Function('esc', `${html.match(/function evref\(e\)\{[\s\S]*?\n  \}/)![0]}; return evref;`)((x: string) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));
  assert.match(evref({ ref: 'a.ts:1', href: 'https://github.com/o/r/blob/abc/a.ts#L1' }), /^<a class="accel-ev-link" href="https:\/\/github\.com\/o\/r\/blob\/abc\/a\.ts#L1" target="_blank" rel="noopener noreferrer"/);
  assert.equal(evref({ ref: 'a.ts:1', href: 'javascript:alert(1)' }), 'a.ts:1');
  assert.equal(evref({ ref: 'a.ts:1' }), 'a.ts:1');
});
