// Leadership v5 SHAPE (report lens split, Phase 2 shape pass): the deterministic post-author normalizer, the injected
// "What you asked us to check" block, and the validated tightening pass. Fixtures mirror an umami re-render
// (an at-a-glance list + a KPI strip above the <h1>, the asks repeated at the end, 531 EN words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeV5Shape, normalizeV5ShapeReport, tightenNeed, tightenRejectReason, tightenV5, maskForTighten, TIGHTEN_SLACK } from './research/leadershipShape.ts';
import { answerBackHtml, buildReportRefs, injectDetailIndex, reinjectDetailIndex, stripDetailIndex, type LensAnswerBack } from './reportAnchors.ts';
import { lensAnswerBackFrom } from './research/leadershipWriter.ts';
import { leadershipLensFor } from './findingLens.ts';
import { executionGroups } from './executionModel.ts';
import { vibePrompt } from './research/leadershipVibe.ts';
import { findingCountCheck, statedFindingCounts, wordCount } from './research/htmlQc.ts';
import { F, areas, gaps, labelled } from './findingLens.fixtures.ts';
import type { Hypothesis } from './research/investigation.ts';
import type { AnswerBackRow } from './schema.ts';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
const LEAD_EN = `<div class="lead">
    <div class="eyebrow">Bottom line</div>
    <p>Three confirmed defects touch two customer-facing capabilities.</p>
    <h3>Decisions needed</h3>
    <ol><li>Adopt one bounce definition — Product lead, next release.</li><li>Close the team gaps — Engineering lead, this sprint.</li></ol>
  </div>`;
const CARDS_EN = `<div class="cards">
    <div class="cap red"><h4>Website traffic dashboard</h4><ul><li>The same site can report different results by screen.</li></ul><span class="badge code">Read from code</span></div>
    <div class="cap amber"><h4>Teams &amp; member access</h4><ul><li>A team manager can hand out an equal-rank role.</li></ul><span class="badge code">Read from code</span></div>
  </div>`;
/** The umami re-render's shape: glance + KPI strip ABOVE the title, the asks repeated at the end. */
function umamiAuthored(): string {
  return `<!doctype html><html><head><style>.x{}</style></head><body>
<div class="wrap">
  <div class="meta">code · 2026-09-30 · read-only audit</div>

  <div class="tldr">
    <h2>At a glance — your three questions</h2>
    <ul><li>Dashboard numbers · bounce rate is computed three ways — confirmed.</li></ul>
  </div>

  <div class="kpi-strip">
    <div class="kpi"><div class="n">3</div><div class="l">confirmed business-logic issues</div></div>
    <div class="kpi"><div class="n">2</div><div class="l">capabilities affected</div></div>
  </div>

  <h1>Dashboard numbers and team access need fixes</h1>

  ${LEAD_EN}

  <!--capability-map-->

  ${CARDS_EN}

  <div class="note"><p><b>Checked and ruled out:</b> core totals reconcile.</p></div>

  <div class="ask">
    <h3>What you asked us to check</h3>
    <ul><li>Dashboard numbers: one confirmed problem.</li></ul>
  </div>
</div>
<script>function x(){}</script></body></html>`;
}
const seq = (html: string, marks: RegExp[]): number[] => marks.map((re) => { const m = re.exec(html); return m ? m.index : -1; });

// ── 1. normalizeV5Shape ───────────────────────────────────────────────────────────────────────────────────────────
test('normalizeV5Shape: drops the at-a-glance list, the KPI strip and the author answer-back', () => {
  const src = umamiAuthored();
  const r = normalizeV5ShapeReport(src);
  const v = r.html;
  assert.doesNotMatch(v, /At a glance|kpi-strip|What you asked us to check/);
  const [h1, lead, anchor, cards, note] = seq(v, [/<h1>/, /class="lead"/, /<!--capability-map-->/, /class="cards"/, /class="note"/]);
  assert.ok(h1 > 0 && h1 < lead && lead < anchor && anchor < cards && cards < note, `order h1 ${h1} < lead ${lead} < anchor ${anchor} < cards ${cards} < note ${note}`);
  assert.match(v, /class="meta"/, 'the meta line is kept');
  assert.equal(r.actions.length, 3, r.actions.join(' | '));
  assert.ok(wordCount(r.html) < wordCount(src), `${wordCount(src)} → ${wordCount(r.html)} words`);
  assert.equal(normalizeV5Shape(r.html), r.html, 'idempotent');
  assert.match(r.html, /<head><style>\.x\{\}<\/style><\/head>/, 'the head is untouched');
  assert.match(r.html, /<script>function x\(\)\{\}<\/script><\/body>/, 'a trailing script outside the column is untouched');
});

test('normalizeV5Shape: a title written AFTER the lead card moves before it (with its eyebrow); the anchor follows the lead card', () => {
  const page = (inner: string): string => `<body><div class="wrap">${inner}</div></body>`;
  const src = page(`\n  ${LEAD_EN}\n  <div class="eyebrow">Leadership brief</div>\n  <h1>The verdict</h1>\n  <p class="sub">What we audited.</p>\n  ${CARDS_EN}\n  <!--capability-map-->\n  <div class="note">x</div>\n`);
  const out = normalizeV5Shape(src);
  const v = out;
  const [eb, h1, sub, lead, anchor, cards] = seq(v, [/class="eyebrow">Leadership brief/, /<h1>/, /class="sub"/, /class="lead"/, /<!--capability-map-->/, /class="cards"/]);
  assert.ok(eb < h1 && h1 < sub && sub < lead && lead < anchor && anchor < cards, `order ${[eb, h1, sub, lead, anchor, cards]}`);
  assert.equal((v.match(/capability-map/g) ?? []).length, 1, 'the anchor is moved, not duplicated');
  assert.equal(normalizeV5Shape(out), out);
  // A missing anchor is added right after the lead card, so the map always lands there.
  const added = normalizeV5Shape(page(`<h1>T</h1>${LEAD_EN}${CARDS_EN}`));
  assert.ok(/<\/div>\s*<!--capability-map-->\s*<div class="cards"/.test(added), 'anchor added after the lead card');
  // The lead card is found by its decisions heading, class or not ("Decisions to make").
  const box = '<div class="box"><p>The verdict.</p><h2>Decisions to make</h2><ol><li>Adopt one definition.</li></ol></div>';
  const boxOut = normalizeV5Shape(page(`${box}<h1>Title</h1>${CARDS_EN}`));
  const [b1, bL, bA] = seq(boxOut, [/<h1>/, /class="box"/, /<!--capability-map-->/]);
  assert.ok(b1 < bL && bL < bA, `order ${[b1, bL, bA]}`);
});

test('normalizeV5Shape: a KPI row without a class is found by shape (≥ 2 cards led by a bare number); a normal card grid is not', () => {
  const page = (inner: string): string => `<body><div class="wrap"><h1>T</h1>${LEAD_EN}<!--capability-map-->${inner}</div></body>`;
  const kpis = '<div class="row"><div><b>3</b> business issues</div><div><b>42%</b> of visits</div></div>';
  assert.doesNotMatch(normalizeV5Shape(page(kpis + CARDS_EN)), /42%/);
  const grid = page(CARDS_EN);
  assert.equal(normalizeV5Shape(grid), grid, 'capability cards are not a KPI strip; nothing else to change');
});

test('normalizeV5Shape: fail-open — unbalanced markup, nothing to change, an injected page', () => {
  const broken = '<body><div class="wrap"><h1>T</h1><div class="tldr"><h2>At a glance</h2>' + LEAD_EN + '</body>';
  assert.equal(normalizeV5Shape(broken), broken, 'cannot parse → unchanged');
  const plain = '<!doctype html><body><div class="wrap"><h1>x</h1></div></body>';
  assert.equal(normalizeV5Shape(plain), plain);
  // After injection (a data-detail-index block follows the anchor) the anchor is never moved away from its block.
  const lf = labelled();
  const refs = buildReportRefs(lf, '/r');
  const lens = leadershipLensFor(lf.map((f) => f.id), lf, gaps, executionGroups(lf, gaps, areas)).brief;
  const once = normalizeV5Shape(umamiAuthored());
  const injected = injectDetailIndex(once, refs, { lens });
  assert.equal(normalizeV5Shape(injected), injected, 'idempotent on the injected page too');
});

// ── 2. the injected answer-back ────────────────────────────────────────────────────────────────────────────────────
const hyp = (id: string): Hypothesis => ({ id, claim: id, status: 'supported', measurement: { value: 1 } } as unknown as Hypothesis);
function abFixture(): { rows: AnswerBackRow[]; ab: LensAnswerBack; refs: ReturnType<typeof buildReportRefs>; lens: ReturnType<typeof leadershipLensFor> } {
  const lf = labelled();
  const lens = leadershipLensFor([...lf.map((f) => f.id), ...gaps.map((g) => g.id)], lf, gaps, executionGroups(lf, gaps, areas));
  const rows: AnswerBackRow[] = [
    { id: 'ANALYTICS:H9', bundleId: 'analytics', status: 'unsettled', concern: 'cohort window unclear in `getRetention()`', testedVia: '', nextDecisiveTest: 'run the cohort query' },
    { id: 'APPSEC:H1', bundleId: 'appsec', status: 'supported', concern: 'tenant token readable by any tenant', testedVia: 'x' },
    { id: 'DATA-ENG:H1', bundleId: 'data-eng', status: 'supported', concern: 'Checkout totals double count when THERESA_DEDUP_WINDOW is unset. More detail follows.', testedVia: 'src/a.ts:3' },
    { id: 'ANALYTICS:H7', bundleId: 'analytics', status: 'unsettled', concern: 'x', testedVia: '', nextDecisiveTest: 'Fix the plan (exceeds the per-bundle hypothesis cap (3))' },
    { id: 'SWE-ARCH:H3', bundleId: 'swe-arch', status: 'refuted', concern: 'state machine race', testedVia: 'y' },
  ];
  return { rows, ab: lensAnswerBackFrom(rows, lens)!, refs: buildReportRefs(lf, '/api/runs/rs_x/report'), lens };
}

test('lensAnswerBackFrom: business rows only, confirmed → ruled out → not settled, one short de-jargoned clause, budget-skipped counted', () => {
  const { ab } = abFixture();
  assert.deepEqual(ab.items.map((i) => [i.status, i.clause, i.capabilities, i.findingIds]), [
    ['supported', 'Checkout totals double count when a configuration setting is unset', ['Checkout & billing'], ['DATA-ENG:H1']],
    ['unsettled', 'cohort window unclear in a function call', ['Retention reporting'], []],
  ], 'appsec (security) and swe-arch (engineering) rows are not the business brief’s');
  assert.equal(ab.skipped, 1, 'the hypothesis-cap row is a count, never a line');
  assert.equal(ab.more, 0);
  const many: AnswerBackRow[] = Array.from({ length: 9 }, (_, i) => ({ id: `DATA-ENG:Q${i}`, bundleId: 'data-eng', status: 'unsettled' as const, concern: `question ${i}`, testedVia: '' }));
  const capped = lensAnswerBackFrom(many, abFixture().lens)!;
  assert.equal(capped.items.length, 6); assert.equal(capped.more, 3);
  assert.equal(lensAnswerBackFrom([], abFixture().lens), null);
});

test('answer-back block: injected at the END of the content (after the cards), chips + capability + F-id links', () => {
  const { ab, refs, lens } = abFixture();
  const page = normalizeV5Shape(umamiAuthored());
  const out = injectDetailIndex(page, refs, { lens: lens.brief, answerBack: ab });
  const v = out;
  assert.equal((v.match(/class="detail-index answer-back"/g) ?? []).length, 1, 'one block');
  const [map, cards, note, abAt] = seq(v, [/class="detail-index lens-brief"/, /class="cards"/, /class="note"/, /class="detail-index answer-back"/]);
  assert.ok(map < cards && cards < note && note < abAt, `map ${map} < cards ${cards} < note ${note} < answer-back ${abAt}`);
  assert.match(v, /What you asked us to check/);
  assert.match(v, /Confirmed<\/span>Checkout totals double count/);
  assert.match(v, /Not settled/);
  const f = refs.find((r) => r.findingId === 'DATA-ENG:H1')!;
  assert.ok(v.includes(`<a href="${f.href}" style="font-weight:600;white-space:nowrap">${f.displayId}</a>`), 'F-id link');
  assert.match(v, /1 more not examined within this run’s budget/);
  assert.doesNotMatch(out, /tenant token readable|state machine race/);
  assert.deepEqual(statedFindingCounts(answerBackHtml(refs, ab)), [], 'never reads as a finding count');
  assert.equal(reinjectDetailIndex(out, refs, { lens: lens.brief, answerBack: ab }), out, 'idempotent strip-then-reinject (the GCP re-inject path)');
  assert.equal(stripDetailIndex(out).includes('answer-back'), false, 'stripped with the other injected blocks');
  assert.deepEqual(findingCountCheck(stripDetailIndex(out), 7), findingCountCheck(stripDetailIndex(injectDetailIndex(page, refs, { lens: lens.brief })), 7), 'FINDINGCOUNT is unchanged by the block');
});

test('v5 author prompt: told NOT to write an answer-back / at-a-glance / KPI strip; no TL;DR or kpi-strip instruction', () => {
  const lf = labelled();
  const hyps = lf.map((f) => hyp(f.id.toLowerCase()));
  const o = { company: 'Acme', scopeDesc: 's', meta: 'm', hypotheses: hyps, mitigations: [], variant: 'v5' as const, inquiry: 'Are our dashboard numbers right? Who can see shared reports?',
    answerBack: abFixture().rows, lens: leadershipLensFor(hyps.map((h) => h.id), lf, gaps, executionGroups(lf, gaps, areas)) };
  const p = vibePrompt(o, null);
  assert.match(p, /Do NOT write an\s+answer-back, an "at a glance" \/ TL;DR list, a KPI strip/);
  assert.match(p, /NOT YOURS — injected after you, deterministically/);
  assert.match(p, /NO TL;DR, NO "AT A GLANCE"/);
  assert.doesNotMatch(p, /OPEN WITH A TL;DR|mark the top KPI strip|weave a short "what you asked us to check" passage|Make your section headings echo their questions/);
  const v4 = vibePrompt({ ...o, variant: 'v4' }, null);
  assert.match(v4, /OPEN WITH A TL;DR/, 'v4 keeps its TL;DR');
  assert.match(v4, /weave a short "what you asked us to check" passage/, 'v4 keeps the authored answer-back');
});

// ── 3. the tightening pass ────────────────────────────────────────────────────────────────────────────────────────
const BUDGET = { words: 300 };
function longPage(): string {
  const li = (n: number): string => Array.from({ length: n }, (_, i) => `<li>Filler sentence number ${i} that runs long for the budget test.</li>`).join('');
  return `<!doctype html><html><head><style>.a{}</style></head><body><div class="wrap"><h1>Title</h1>${LEAD_EN}<!--capability-map--><div class="cards"><div class="cap red"><h4>Card</h4><ul>${li(45)}</ul><span class="badge code">F-01</span></div></div></div></body></html>`;
}
/** A faithful "model": deletes all but the first 5 filler <li>. */
const cutLis = (masked: string): string => masked.replace(/(<ul>)((?:<li>Filler[\s\S]*?<\/li>)+)(<\/ul>)/g, (_m, a: string, lis: string, b: string) => a + (lis.match(/<li>[\s\S]*?<\/li>/g) ?? []).slice(0, 5).join('') + b);
const promptHtml = (prompt: string): string => prompt.slice(prompt.indexOf('<!doctype'));

test('tightenV5: over 1.3× → ONE validated pass; the accepted draft keeps every heading, div, badge, F-id and marker', async () => {
  const src = longPage();
  const need = tightenNeed(src, BUDGET);
  assert.ok(need.over && need.words > BUDGET.words * TIGHTEN_SLACK, `${need.words} words`);
  const logs: string[] = [];
  let calls = 0;
  const r = await tightenV5(src, { budget: BUDGET, log: (m) => logs.push(m), ledger: null, env: {}, call: async (p) => { calls++; return { text: '```html\n' + cutLis(promptHtml(p)) + '\n```', costUsd: 0.02 }; } });
  assert.equal(calls, 1); assert.equal(r.accepted, true, r.reason);
  assert.ok(r.after! < r.before);
  assert.match(logs.join('\n'), new RegExp(`leadership tighten: ${r.before}→${r.after} words`));
  assert.match(r.html, /<style>\.a\{\}<\/style>/, 'the masked head is restored');
  assert.equal((r.html.match(/<!--capability-map-->/g) ?? []).length, 1, 'the anchor is restored');
  assert.equal(r.costUsd, 0.02);
});

test('tightenV5: a draft that adds a number, drops a heading or a marker, or grows is REJECTED — the original ships', async () => {
  const src = longPage();
  const run = async (edit: (m: string) => string): Promise<string> => (await tightenV5(src, { budget: BUDGET, ledger: null, env: {}, call: async (p) => ({ text: edit(cutLis(promptHtml(p))), costUsd: 0.01 }) })).reason;
  assert.match(await run((m) => m.replace('Filler sentence number 1 ', 'Filler sentence number 1 costs $9,999 ')), /new number\(s\): 9,999/);
  assert.match(await run((m) => m.replace('<h4>Card</h4>', '')), /a heading changed/);
  assert.match(await run((m) => m.replace(/⟦K1⟧/, '')), /placeholder/);
  assert.match(await run((m) => m.replace('<div class="cards">', '<div class="cards grid">')), /card \/ container changed/);
  assert.match(await run((m) => m.replace('<span class="badge code">F-01</span>', '<span class="code">F-01</span>')), /badge/);
  assert.match(await run(() => 'Sorry, I cannot help with that.'), /placeholder/);
  const same = await tightenV5(src, { budget: BUDGET, ledger: null, env: {}, call: async (p) => ({ text: promptHtml(p), costUsd: 0 }) });
  assert.match(same.reason, /nothing was cut/); assert.equal(same.html, src);
  const threw = await tightenV5(src, { budget: BUDGET, ledger: null, env: {}, call: async () => { throw new Error('boom'); } });
  assert.equal(threw.html, src); assert.equal(threw.accepted, false);
  const { masked } = maskForTighten(src);
  assert.equal(tightenRejectReason(masked, masked.replace('F-01', 'F-02'), 10, 5), 'the finding ids changed');
  assert.equal(tightenRejectReason(masked, masked, 10, 12), 'the brief got longer');
  assert.equal(tightenRejectReason(masked, masked, 10, 10), 'nothing was cut');
});

test('tightenV5: skipped within budget, when disabled, and when the cap left is under $0.15 (logged, no call)', async () => {
  const noCall = async (): Promise<never> => { throw new Error('must not be called'); };
  const small = normalizeV5Shape(umamiAuthored());
  assert.equal((await tightenV5(small, { budget: BUDGET, ledger: null, env: {}, call: noCall })).reason, 'within budget');
  assert.equal((await tightenV5(longPage(), { budget: BUDGET, ledger: null, env: { THERESA_LEADERSHIP_TIGHTEN: '0' }, call: noCall })).reason, 'disabled');
  const logs: string[] = [];
  const b = await tightenV5(longPage(), { budget: BUDGET, ledger: { total: 30, remaining: () => 0.1 }, env: {}, log: (m) => logs.push(m), call: noCall });
  assert.equal(b.reason, 'budget'); assert.equal(b.html, longPage());
  assert.match(logs.join('\n'), /leadership tighten skipped — \$0\.10 left of the cap/);
  assert.equal((await tightenV5(longPage(), { budget: BUDGET, ledger: { total: Infinity, remaining: () => Infinity }, env: {}, call: async (p) => ({ text: cutLis(promptHtml(p)), costUsd: 0 }) })).accepted, true, 'an unbounded run is never budget-skipped');
});

test('WORDBUDGET / tighten count the AUTHORED words: injected blocks are stripped first', () => {
  const { ab, refs, lens } = abFixture();
  const page = normalizeV5Shape(umamiAuthored());
  const injected = injectDetailIndex(page, refs, { lens: lens.brief, answerBack: ab });
  assert.deepEqual(tightenNeed(injected, BUDGET), tightenNeed(page, BUDGET));
  assert.ok(F('X:H1', 't').id === 'X:H1');   // fixture import sanity
});
