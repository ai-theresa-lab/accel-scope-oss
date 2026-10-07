// Report lens split — part 3: Leadership v5 (business-only author input,
// the injected capability map, the one-line lens rows, the zero-business fallback, the word-budget advisory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityHealth, labelFindings, leadershipLensFor, lensBriefFor, noBusinessFindings } from './findingLens.ts';
import { executionGroups } from './executionModel.ts';
import { buildReportRefs, injectDetailIndex, reinjectDetailIndex, stripDetailIndex } from './reportAnchors.ts';
import { authorHypotheses, effectiveVariant, fallbackReport, lensAnswerBack, lensSplitOn, type LeadershipWriterOpts, writerPrompt } from './research/leadershipWriter.ts';
import { normalizeV5Shape } from './research/leadershipShape.ts';
import { digestPrompt, vibePrompt } from './research/leadershipVibe.ts';
import { contractFor } from './research/leadershipContracts.ts';
import { renderRecallReport } from './recallReportHtml.ts';
import { findingCountCheck, statedFindingCounts, statedFindingCountsByLens, wordBudgetCheck, wordCount } from './research/htmlQc.ts';
import type { CoverageGap, Finding } from './schema.ts';
import type { Hypothesis } from './research/investigation.ts';
import { F, areas, gaps, labelled } from './findingLens.fixtures.ts';

// ── Part 3: Leadership v5 ──────────────────────────────────────────────────────────────────────────────────────────

test('capabilityHealth: red = confirmed high/critical · amber = confirmed · green = only ruled out · grey = open only', () => {
  assert.equal(capabilityHealth({ confirmed: 2, highCrit: 1, ruledOut: 0 }), 'red');
  assert.equal(capabilityHealth({ confirmed: 1, highCrit: 0, ruledOut: 3 }), 'amber');
  assert.equal(capabilityHealth({ confirmed: 0, highCrit: 0, ruledOut: 1 }), 'green');
  assert.equal(capabilityHealth({ confirmed: 0, highCrit: 0, ruledOut: 0 }), 'grey', 'unmeasured is never green');
});

test('lensBriefFor: one tile per business capability (worst first), security + engineering as confirmed ids only', () => {
  const lf = labelled();
  const b = lensBriefFor(lf, gaps, executionGroups(lf, gaps, areas));
  assert.deepEqual(b.capabilities.map((t) => [t.name, t.health, t.findingIds.length, t.open]), [
    ['Checkout & billing', 'red', 1, 0], ['Retention reporting', 'amber', 1, 1], ['Other', 'amber', 1, 0],
  ]);
  assert.deepEqual(b.security, { findingIds: ['APPSEC:H1', 'APPSEC:H2', 'SAAS-TENANCY:H1'], highCrit: 1 });
  assert.deepEqual(b.engineering, { findingIds: ['RELEASE-ENG:H1'], highCrit: 0 }, 'the ruled-out engineering row is not counted');
  assert.equal(noBusinessFindings(b), false);
});

const view = (inner: string): string => `<html><body><div class="wrap"><h1>Brief</h1>${inner}</div></body></html>`;

test('capability map: an injected SVG (role=img + aria-label) with F-id links, replaces Area health, idempotent', () => {
  const lf = labelled();
  const refs = buildReportRefs(lf, '/api/runs/rs_x/report');
  const lens = lensBriefFor(lf, gaps, executionGroups(lf, gaps, areas));
  const out = injectDetailIndex(view('<p>verdict</p>'), refs, { themes: [{ key: 'k', name: 'THEME-ROW', findingIds: [] }], lens });
  assert.equal((out.match(/class="detail-index lens-brief"/g) ?? []).length, 1, 'one block');
  assert.doesNotMatch(out, /Area health|THEME-ROW/, 'the map replaces Area health — not both');
  assert.equal((out.match(/<svg class="capability-map" role="img" aria-label="/g) ?? []).length, 1);
  assert.match(out, /aria-label="Capability map: Checkout &amp; billing: confirmed high or critical issue — 1 confirmed · 1 high\+/);
  const f01 = refs.find((r) => r.findingId === 'DATA-ENG:H1')!;
  assert.ok(out.includes(`<a href="${f01.href}"><tspan`), 'a tile links its F-id into Execution');
  // Exactly ONE line each for Security and Engineering health — counts + technical report + F-ids, no titles.
  assert.match(out, /<b>Security<\/b> · 3 confirmed, 1 high or critical → <a href="\/api\/runs\/rs_x\/report">technical report<\/a>: /);
  assert.match(out, /<b>Engineering health<\/b> · 1 confirmed, 0 high or critical/);
  for (const t of ['tenant token readable', 'secret in CI logs', 'cross-tenant cache key', 'release build not pinned']) assert.ok(!out.includes(t), `no security / engineering detail: ${t}`);
  assert.equal(reinjectDetailIndex(out, refs, { lens }), out, 'idempotent re-inject');
  // A plain body (the structured renderer's shape) gets the same single map.
  const structured = injectDetailIndex('<!doctype html><body><p>x</p></body>', refs, { lens });
  assert.equal((structured.match(/<svg class="capability-map"/g) ?? []).length, 1);
  assert.match(structured, /aria-label="Capability map: /);
  // The injected lines never read as a finding count (FINDINGCOUNT runs over the stripped brief anyway).
  assert.deepEqual(statedFindingCounts(out), []);
  assert.equal(stripDetailIndex(out).includes('capability-map'), false);
});

test('zero business findings: the map becomes a two-tile engineering-health overview + one line saying so', () => {
  const lib = labelFindings([F('APPSEC:H1', 'floating CI tags', { severity: 'high' }), F('RELEASE-ENG:H2', 'unpinned release')]);
  const lens = lensBriefFor(lib, [], executionGroups(lib, [], undefined));
  assert.equal(noBusinessFindings(lens), true);
  const out = injectDetailIndex(view(''), buildReportRefs(lib, '/r'), { lens });
  assert.match(out, /No business-logic issues were in scope or found in this scan/);
  assert.match(out, /aria-label="Engineering health overview: Security: 1 confirmed · 1 high\+; Engineering health: 1 confirmed · 0 high\+"/);
  assert.doesNotMatch(out, /floating CI tags|unpinned release/);
});

test('capability map: a tile wraps its F-ids three per line (five on one line overflowed the tile)', () => {
  const many = labelFindings(['H1', 'H2', 'H3', 'H4', 'H5'].map((h) => F(`RELEASE-ENG:${h}`, `issue ${h}`)));
  const lens = lensBriefFor(many, [], executionGroups(many, [], undefined));
  const out = injectDetailIndex(view(''), buildReportRefs(many, '/r'), { lens });
  const svg = /<svg class="capability-map"[\s\S]*?<\/svg>/.exec(out)![0];
  const idLines = [...svg.matchAll(/<text [^>]*font-family:ui-monospace[^>]*>([\s\S]*?)<\/text>/g)].map((m) => (m[1].match(/F-\d+/g) ?? []).length);
  assert.deepEqual(idLines, [3, 2], 'the engineering tile carries its five ids on two lines');
  assert.match(svg, /viewBox="0 0 420 106"/, 'every tile grows by one line (88 → 106)');
});

const hyp = (id: string, claim: string): Hypothesis => ({ id, claim, status: 'supported', symptom: 's', decisiveMetric: 'm', measurement: { value: 3, note: `${claim} note` } } as unknown as Hypothesis);
const v5opts = (fs: Finding[] = labelled(), over: Partial<LeadershipWriterOpts> = {}, gs: CoverageGap[] = gaps): LeadershipWriterOpts => {
  const hyps = fs.map((f) => hyp(f.id.toLowerCase(), `${f.title} (claim)`));
  return {
    company: 'Acme', scopeDesc: 'scope', meta: 'm', hypotheses: hyps, mitigations: [], variant: 'v5',
    answerBack: [{ id: 'APPSEC:H1', bundleId: 'appsec', status: 'supported', concern: 'tenant token readable by any tenant', testedVia: 'x' }, { id: 'DATA-ENG:H1', bundleId: 'data-eng', status: 'supported', concern: 'checkout totals', testedVia: 'y' }],
    findingTotals: { confirmed: 7, ruledOut: 1 },
    lens: leadershipLensFor(hyps.map((h) => h.id), fs, gs, executionGroups(fs, gs, areas)),
    ...over,
  };
};

test('v5 author input: business verdicts in full, security + engineering as COUNTS only — in every prompt', () => {
  const o = v5opts();
  assert.equal(lensSplitOn(o), true);
  assert.deepEqual(authorHypotheses(o).map((h) => h.id), ['data-eng:h1', 'analytics:h2', 'i1-0']);
  for (const [name, p] of [['author', vibePrompt(o, null)], ['digest', digestPrompt(o)], ['structured', writerPrompt(o)]] as const) {
    assert.match(p, /checkout totals double count \(claim\)/, `${name}: business verdict present`);
    assert.match(p, name === 'structured' ? /- Checkout & billing \[red\]/ : /capability: Checkout & billing/, `${name}: its capability`);
    for (const t of ['tenant token readable', 'secret in CI logs', 'cross-tenant cache key', 'release build not pinned']) assert.ok(!p.includes(t), `${name} leaks "${t}"`);
    assert.match(p, /- Security: 3 confirmed \(1 high or critical\) — COUNT ONLY/, `${name}: security count`);
    assert.match(p, /- Engineering health: 1 confirmed \(0 high or critical\) — COUNT ONLY/, `${name}: engineering count`);
  }
  const author = vibePrompt(o, null);
  assert.match(author, /- Checkout & billing \[red\] — 1 confirmed, 1 high or critical/);
  assert.match(author, /COUNTS — the run's final tally: 7 confirmed finding\(s\)/, 'the COUNTS guarantee stays');
  assert.match(author, /ONE CARD PER AFFECTED CAPABILITY/);
  assert.match(author, /RIGHT AFTER the lead card's closing tag, write exactly this HTML comment on its own line:\s+<!--capability-map-->/, 'the map anchor');
  assert.doesNotMatch(author, /EVERY section opens with a ROW OF METRIC CARDS/, 'the house layout rules are replaced');
  assert.match(author, /TRANSLATE THE VOCABULARY/, 'the vocabulary rule is kept');
  assert.equal(contractFor('v5').budget?.words, 300);
});

test('v5 with zero business verdicts: the author is told so and never to invent business issues', () => {
  const lib = labelFindings([F('APPSEC:H1', 'floating CI tags'), F('RELEASE-ENG:H2', 'unpinned release')]);
  const o = v5opts(lib, {}, []);
  const p = vibePrompt(o, null);
  assert.match(p, /ZERO BUSINESS FINDINGS: nothing in this scan is a business-logic finding/);
  assert.match(p, /NEVER invent a business issue/);
  assert.doesNotMatch(p, /floating CI tags|unpinned release/);
  const fb = fallbackReport(o);
  assert.equal(fb.bottomLine, 'No business-logic issues were in scope or found in this scan. Security and engineering health are summarised in one line each below.');
  assert.doesNotMatch(JSON.stringify(fb), /floating CI tags|unpinned release/, 'the structured fallback follows the lens split');
});

test('v5 structured fallback: one section per affected capability, business answer-back only — injected, not rendered', () => {
  const o = v5opts();
  const fb = fallbackReport(o);
  assert.deepEqual(fb.sections.map((s) => s.heading), ['Checkout & billing', 'Retention reporting', 'Other', 'Also checked']);
  const js = JSON.stringify(fb);
  for (const t of ['tenant token readable', 'secret in CI logs', 'release build not pinned']) assert.ok(!js.includes(t), `fallback leaks "${t}"`);
  // v5: no renderer answer-back card (it sat between the lead card and the map); the deterministic block is injected.
  assert.equal(fb.answerBack, undefined);
  const ab = lensAnswerBack(o);
  assert.deepEqual(ab?.items.map((i) => [i.status, i.clause, i.capabilities]), [['supported', 'checkout totals', ['Checkout & billing']]], 'business rows only');
  const html = injectDetailIndex(renderRecallReport(fb), o.reportRefs ?? [], { lens: o.lens!.brief, answerBack: ab });
  assert.equal((html.match(/class="detail-index answer-back"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /tenant token readable/);
});

// ── The v5 fallback is the v5 SHAPE (umami E2E: the structured fallback wrote ~1,200 EN words, 7 sections, charts) ──
// An umami-shaped run: a 12-capability map, 3 business findings with long engineering claims, 3 security findings,
// open questions, several answer-back rows and synthesis leads.
function umamiLike(): LeadershipWriterOpts {
  const caps = Array.from({ length: 12 }, (_, i) => ({ id: `cap-${i}`, name: ['Website traffic dashboard', 'Teams & member access', 'Public sharing of dashboards & reports', 'Realtime visitors', 'Custom events & properties', 'Conversion goals & funnels', 'Revenue analytics', 'Visitor retention', 'Session replay & heatmaps', 'Saved reports & dashboards', 'Campaign tracking links & pixels', 'Sign-in, accounts & API keys'][i], kind: 'feature' as const, summary: 'Customers use this part of the product every day to understand their visitors.', anchors: { paths: [`src/app/api/c${i}`] }, ...(i < 4 ? { critical: true } : {}) }));
  const long = 'resolves to three different definitions across the overview card, the breakdown table and the expanded metrics view, and the overview masks the divergence with a Math.min clamp in WebsiteMetricsBar.tsx so a customer comparing surfaces sees numbers that cannot be reconciled';
  const fs = labelFindings([
    F('ANALYTICS:H2', 'Bounce rate definitions diverge', { severity: 'high', claim: `Bounce ${long}.`, evidence: [{ kind: 'file', ref: 'src/app/api/c0/route.ts:49' }] }),
    F('DATA-ENG:H3', 'Team delete leaves data', { claim: `Deleting a team in cloud mode soft-deletes links, pixels and boards but ${long}.`, evidence: [{ kind: 'file', ref: 'src/app/api/c1/route.ts:9' }] }),
    F('PRODUCT-LOGIC:H3', 'Add-user role check missing', { severity: 'low', claim: `The POST add-user handler omits the TEAM_ROLE_RANK caller-vs-body comparison that ${long}.`, evidence: [{ kind: 'file', ref: 'src/app/api/c1/users.ts:3' }] }),
    F('SAAS-TENANCY:H1', 'share window', { severity: 'medium' }), F('SAAS-TENANCY:H2', 'share tokens never expire', { severity: 'high' }), F('SAAS-TENANCY:H3', 'team delete orphans', { severity: 'high' }),
  ], { capabilities: caps });
  const gs: CoverageGap[] = ['PRODUCT-LOGIC:H1', 'PRODUCT-LOGIC:H2', 'ANALYTICS:H1', 'DATA-ENG:H1'].map((id) => ({ id, concern: `Do both backends agree on ${id}?`, whyUnsettled: 'u', nextDecisiveTest: 'n', source: 's', status: 'unmeasured', hypothesisId: id.toLowerCase() }));
  const hyps = fs.map((f) => ({ ...hyp(f.id.toLowerCase(), f.claim), measurement: { value: 3, note: 'n', source: 'code:src/x.ts' } } as unknown as Hypothesis));
  const map = { capabilities: caps, examined: caps.slice(0, 9).map((c) => c.id), assignments: [{ id: 'analytics:h1', capabilityId: 'cap-0' }] };
  return {
    company: 'Umami', scopeDesc: 'umami-software/umami — a read-only audit of the whole product, its analytics numbers, sharing and team access', meta: 'code · 2026-09-30', hypotheses: hyps, mitigations: [], variant: 'v5',
    synthesis: { bottomLine: '• Share tokens never expire (security)\n• Bounce has three definitions', leads: [{ title: 'Bounce rate is defined three different ways, so customers cannot trust the headline number', detail: 'd', grounding: 'g', basis: ['analytics:h2'] }, { title: 'Share tokens never expire', detail: 'd', grounding: 'g', basis: ['saas-tenancy:h2'] }] },
    answerBack: fs.map((f) => ({ id: f.id, bundleId: f.id.split(':')[0].toLowerCase(), status: 'supported' as const, concern: f.claim, testedVia: 'code' })),
    findingTotals: { confirmed: 6, ruledOut: 2 },
    reportRefs: buildReportRefs(fs, '/api/runs/rs_x/report'),
    lens: leadershipLensFor(hyps.map((h) => h.id), fs, gs, executionGroups(fs, gs, undefined), undefined, map),
  };
}

test('v5 fallback: title · verdict + labelled counts + decisions · one ≤2-line card per affected capability · one line — ≤ 350 words', () => {
  const o = umamiLike();
  const fb = fallbackReport(o);
  assert.match(fb.title, /^Umami: 3 business issues to decide on$/);
  assert.match(fb.bottomLine, /^Bounce rate is defined three different ways, so customers cannot trust the headline number\. /, 'the verdict is the business-only synthesis lead');
  assert.doesNotMatch(fb.bottomLine, /Share tokens/, 'a security lead never becomes the verdict');
  assert.match(fb.bottomLine, /Confirmed in this scan: 3 business issues · 3 security · 0 engineering \(6 in total\)\./);
  assert.ok(fb.decisions!.length >= 1 && fb.decisions!.length <= 3, 'one to three decisions');
  assert.match(fb.decisions![0], /^Fix Website traffic dashboard first \(1 high-severity issue\) — product owner with the engineering lead; recommended this sprint\.$/);
  assert.deepEqual(fb.sections.map((s) => s.heading), ['Website traffic dashboard', 'Teams & member access', 'Also checked']);
  assert.equal(fb.cards.length, 0, 'no KPI strip');
  assert.ok(fb.sections.every((s) => !s.viz), 'no charts');
  for (const s of fb.sections.slice(0, -1)) assert.ok(s.body.length <= 230, `≤ 2 lines: ${s.body}`);
  assert.doesNotMatch(JSON.stringify(fb.sections), /TEAM_ROLE_RANK|WebsiteMetricsBar|\.tsx/, 'de-jargoned');
  assert.match(fb.sections[1].body, /Plus 1 more issue here\. \(F-\d\d, F-\d\d\)$/);
  const html = renderRecallReport(fb);
  // THE v5 SHAPE, the same order the free-vibe shape pass enforces: title → lead card (verdict + decisions) → the map →
  // the capability cards → the short open / ruled-out line → the injected answer-back. No KPI strip, no glance list.
  const page = injectDetailIndex(html, o.reportRefs ?? [], { lens: o.lens!.brief, answerBack: lensAnswerBack(o) });
  const at = (re: RegExp): number => { const m = re.exec(page); assert.ok(m, `missing ${re}`); return m!.index; };
  const order = [at(/<h1>/), at(/Decisions needed/), at(/class="detail-index lens-brief"/), at(/<h2>Website traffic dashboard<\/h2>/), at(/Also checked/), at(/class="detail-index answer-back"/)];
  assert.deepEqual([...order].sort((a, b) => a - b), order, `v5 order: ${order.join(' < ')}`);
  assert.doesNotMatch(page, /How we addressed your brief|kpi-strip|At a glance/);
  assert.equal(normalizeV5Shape(page), page, 'the shape pass leaves the fallback alone (already in shape)');
  assert.equal(reinjectDetailIndex(page, o.reportRefs ?? [], { lens: o.lens!.brief, answerBack: lensAnswerBack(o) }), page, 'idempotent at the anchors');
  const n = wordCount(html);
  assert.ok(n <= 350, `${n} words`);
  assert.equal(contractFor('v5').budget?.words, 300);
  // The counts line never reads as the run's total (FINDINGCOUNT): "3 business issues" is compared to the business count.
  const b = o.lens!.brief;
  assert.equal(findingCountCheck(html, 6, { business: 3, security: b.security.findingIds.length, engineering: 0 }), null);
});

test('FINDINGCOUNT scoped by lens: a count qualified by business / security / engineering is compared to that lens', () => {
  assert.deepEqual(statedFindingCountsByLens('<p>3 business issues · 2 confirmed security findings · 4 findings · two engineering-health problems</p>'),
    [{ n: 3, lens: 'business' }, { n: 2, lens: 'security' }, { n: 4 }, { n: 2, lens: 'engineering' }]);
  const lens = { business: 3, security: 3, engineering: 0 };
  // umami E2E: "The three confirmed defects" in a business-only brief on a 6-finding run fired the advisory.
  assert.ok(findingCountCheck('<p>The three confirmed defects are proven.</p>', 6), 'no lens data: the old check is unchanged');
  assert.equal(findingCountCheck('<p>The three confirmed defects are proven.</p>', 6, lens), null, 'v5: an unqualified count may be the business count');
  assert.equal(findingCountCheck('<p>6 findings in total, 3 business issues.</p>', 6, lens), null);
  assert.equal(findingCountCheck('<p>4 business issues.</p>', 6, lens)?.reason, 'the prose states 4 business finding(s) (the run confirmed 3 business)', 'a lens miss reads as one clause, never against the total');
  assert.equal(findingCountCheck('<p>4 business issues · 5 findings.</p>', 6, lens)?.reason, 'the prose states 4 business finding(s) (the run confirmed 3 business); 5 finding(s) (the run confirmed 6 in total)');
  assert.match(findingCountCheck('<p>2 security issues.</p>', 6, lens)?.reason ?? '', /2 security/);
  assert.equal(findingCountCheck('<p>2 security issues.</p>', 6), null, 'a lens-qualified count is never compared to the total');
  assert.match(findingCountCheck('<p>5 findings.</p>', 6, lens)?.reason ?? '', /states 5 finding/);
});

test('v5 without lens data (a rec audit) runs as v4; v0 / v4 prompts are untouched by the lens data', () => {
  assert.equal(effectiveVariant({ variant: 'v5' }), 'v4');
  const o = v5opts();
  const noLens = { ...o, lens: undefined };
  assert.equal(vibePrompt(noLens, null), vibePrompt({ ...noLens, variant: 'v4' }, null));
  for (const variant of ['v0', 'v4'] as const) assert.equal(vibePrompt({ ...o, variant }, null), vibePrompt({ ...o, variant, lens: undefined }, null), `${variant} ignores lens`);
});

test('WORDBUDGET: counts the brief\'s words, flags one >20% over its declared budget (SOFT)', () => {
  const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  assert.equal(wordCount(view(`<p>${words(10)}</p>`)), 11, 'the h1 counts too');
  assert.equal(wordBudgetCheck(view(`<p>${words(350)}</p>`), { words: 300 }), null, 'within slack');
  const f = wordBudgetCheck(view(`<p>${words(400)}</p>`), { words: 300 });
  assert.equal(f?.id, 'WORDBUDGET'); assert.equal(f?.severity, 'SOFT');
  assert.match(f!.reason, /401 words \(budget ≈300\)/);
  assert.equal(wordBudgetCheck('<p>short</p>', undefined), null);
  assert.equal(findingCountCheck('<p>3 findings</p>', 3), null);
});
