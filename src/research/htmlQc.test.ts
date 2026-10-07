import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberAudit, runHtmlQc, visibleText, qcRoundStep, judgeUnavailableResult, type HtmlQcResult } from './htmlQc.ts';
import { BudgetLedger, withRunBudget } from './budget.ts';
import type { Ledger } from './reportRubric.ts';

const ledger: Ledger = { entries: [], text: '', numbers: new Set(['0.916', '91.6', '0.92', '998165', '64.9']) };

// The trust-layer floor: numberAudit flags a report number NOT in the ledger, but accepts ledgered values and their
// readable rounded/percent forms (so an honest "91.6%"/"0.92" isn't a false positive), and ignores years/small ints.
test('numberAudit flags un-ledgered numbers, accepts ledgered + rounded/percent forms', () => {
  const html = `<p>retention is <b>91.6%</b> (raw 0.916, rounded 0.92), pool <b>998,165</b>, and a bogus <b>73,402</b> appears.
    The year 2026 and rank 5 are fine. Coverage 64.9%.</p>`;
  const flagged = numberAudit(html, ledger);
  assert.ok(flagged.includes('73,402'), `the un-ledgered 73,402 must be flagged, got: ${flagged.join(',')}`);
  assert.ok(!flagged.some((n) => n.includes('91.6')), '91.6% is ledgered → not flagged');
  assert.ok(!flagged.includes('0.92') && !flagged.includes('0.916'), 'rounded/raw ledgered forms not flagged');
  assert.ok(!flagged.includes('998,165'), 'thousands-separated ledgered value not flagged');
  assert.ok(!flagged.includes('64.9') && !flagged.some((n) => n.includes('64.9')), '64.9% is ledgered → not flagged');
  assert.ok(!flagged.includes('2026'), 'a year is ignored');
  assert.ok(!flagged.includes('5'), 'a small int (rank) is ignored');
});

// an INTEGER count in the ledger must NOT certify a same-digits rate via the percent↔fraction alias
// (0.92 * 100 = 92 would wrongly clear a fabricated 0.92 against a count of 92). Aliasing is gated to non-integer values.
test('an integer count does NOT certify a same-digits rate', () => {
  const led: Ledger = { entries: [], text: '', numbers: new Set(['92', '215384']) };   // counts only, no rate
  const flagged = numberAudit('<p>stay rate is <b>0.92</b>; pool is <b>215,384</b>.</p>', led);
  assert.ok(flagged.includes('0.92'), 'a fabricated rate 0.92 must be FLAGGED, not certified by the integer count 92');
  assert.ok(!flagged.includes('215,384') && !flagged.includes('215384'), 'the genuine ledgered count is not flagged');
});

// a negative metric (-8.5%) must be audited WITH its sign, and a two-digit percentage must not be exempted.
test('numberAudit preserves negative signs + audits two-digit percentages', () => {
  const led: Ledger = { entries: [], text: '', numbers: new Set(['-8.5', '64.9']) };
  // a ledgered negative shown with its sign is cleared; the same digits shown POSITIVE (a different number) is flagged
  assert.ok(!numberAudit('<p>delta <b>-8.5%</b></p>', led).includes('-8.5%'), 'a ledgered negative (-8.5) shown as -8.5% is cleared');
  assert.ok(numberAudit('<p>delta <b>8.5%</b></p>', led).includes('8.5%'), 'a positive 8.5% (not ledgered; only -8.5 is) is flagged');
  // a two-digit percentage NOT in the ledger is no longer exempted by the small-int rule
  assert.ok(numberAudit('<p>share is <b>16%</b></p>', led).includes('16%'), 'an un-ledgered two-digit percentage 16% is flagged, not exempted');
});

// visibleText is what a reader sees — drops script/style/tags AND data: URIs (so a 500KB base64 logo never reaches the
// judge / the number scan).
test('visibleText strips script/style/tags and data: URIs', () => {
  const html = `<style>.x{color:red}</style><img src="data:image/png;base64,AAAABBBBCCCC1234"><script>var a=99;</script><h1>Stay rate</h1><p>is 91.6%</p>`;
  const t = visibleText(html);
  assert.ok(t.includes('Stay rate') && t.includes('91.6%'), 'visible prose is kept');
  assert.ok(!t.includes('color:red'), 'style stripped');
  assert.ok(!t.includes('var a') && !t.includes('99'), 'script stripped (its 99 must not leak into the number scan)');
  assert.ok(!t.includes('AAAABBBB') && !t.includes('1234'), 'data: URI stripped (base64 must not leak)');
});

// a QC judge that cannot run ships the draft UNSCORED — that is a degradation, not a healthy round.
test('an unavailable gpt QC judge records an html-qc degradation in the run context', async () => {
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const rows: string[] = [];
  try {
    const led = new BudgetLedger(100, { onDegraded: (stage, reason) => rows.push(`${stage}: ${reason}`) });
    const v = await withRunBudget(led, 'reserve', () => runHtmlQc('<p>x</p>', { ledger, dossierJson: '[]', tier: 'area' }));
    assert.equal(v.summary, 'QC unavailable');
    assert.deepEqual(rows, ['html-qc: area QC judge (gpt) unavailable: OPENAI_API_KEY not set — report shipped unscored']);
    // the outage is flagged, and it is NOT a HARD finding the writer is asked to fix (no edit can clear it).
    assert.equal(v.judgeUnavailable, true);
    assert.equal(v.hard.length, 0, 'an unavailable judge must produce zero HARD');
    assert.ok(!v.hard.some((f) => f.id === 'JUDGE'));
  } finally { if (saved !== undefined) process.env.OPENAI_API_KEY = saved; }
});

// ── the shared per-round decision of both HTML QC loops ──
const scored = (n: number): HtmlQcResult => ({ hard: Array.from({ length: n }, (_, i) => ({ id: `R${i}`, severity: 'HARD' as const, reason: 'r', fix: 'f' })), soft: [], summary: '', unledgered: [] });

test('a judge-unavailable round with no scored best ships THIS draft (unscored) and stops the loop', () => {
  const s = qcRoundStep(null, 0, { html: '<p>r1</p>', round: 1 }, judgeUnavailableResult('QC unavailable'), 2);
  assert.equal(s.stop, 'judge-unavailable');
  assert.equal(s.best.html, '<p>r1</p>');
  assert.equal(s.best.hard.length, 0, 'no writer-facing HARD residual is invented for an outage');
  assert.equal(s.best.unscored, true);
});

test('a judge-unavailable round keeps the scored best and still stops', () => {
  const r1 = qcRoundStep(null, 0, { html: 'a', round: 1 }, scored(2), 2);
  assert.equal(r1.stop, null);
  const r2 = qcRoundStep(r1.best, r1.stall, { html: 'b', round: 2 }, judgeUnavailableResult('QC parse fail'), 2);
  assert.equal(r2.stop, 'judge-unavailable');
  assert.equal(r2.best.html, 'a', 'the scored draft (known residual) wins over the unscored one');
  assert.equal(r2.best.hard.length, 2);
});

test('qcRoundStep keeps its semantics: converge at 0 HARD, stall after 2 non-improving rounds', () => {
  let st = qcRoundStep(null, 0, { html: 'a', round: 1 }, scored(3), 2);
  st = qcRoundStep(st.best, st.stall, { html: 'b', round: 2 }, scored(3), 2);   // tie → best moves to the newer draft, stall 1
  assert.equal(st.best.html, 'b'); assert.equal(st.stall, 1); assert.equal(st.stop, null);
  st = qcRoundStep(st.best, st.stall, { html: 'c', round: 3 }, scored(4), 2);   // worse → best kept, stall 2 → stop
  assert.equal(st.best.html, 'b'); assert.equal(st.stop, 'stalled');
  const c = qcRoundStep(st.best, st.stall, { html: 'd', round: 4 }, scored(0), 2);
  assert.equal(c.stop, 'converged'); assert.equal(c.best.html, 'd');
  // the analyst loop has no stall exit (stallLimit ∞)
  let a = qcRoundStep(null, 0, { html: 'a', round: 1 }, scored(1));
  for (let r = 2; r < 9; r++) { a = qcRoundStep(a.best, a.stall, { html: `x${r}`, round: r }, scored(2)); assert.equal(a.stop, null); }
});

test('an unparseable gpt verdict is also judge-unavailable (and recorded), never a PARSE HARD', async () => {
  // A verdict with no JSON object used to parse as `null` → a CLEAN pass; a malformed one became a HARD PARSE finding.
  // Both are outages now. Drive the parse path through a stubbed fetch so no network is touched.
  const savedKey = process.env.OPENAI_API_KEY; const savedFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'I could not review this.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const rows: string[] = [];
  try {
    const led = new BudgetLedger(100, { onDegraded: (stage, reason) => rows.push(`${stage}: ${reason}`) });
    const v = await withRunBudget(led, 'reserve', () => runHtmlQc('<p>x</p>', { ledger, dossierJson: '[]', tier: 'area' }));
    assert.equal(v.judgeUnavailable, true);
    assert.equal(v.hard.length, 0);
    assert.ok(rows.some((r) => r.startsWith('html-qc:') && /no parseable verdict/.test(r)), rows.join(' | '));
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  }
});

// ── identifier numerals are not metrics ──
test('numberAudit does NOT flag identifier numerals (each class)', () => {
  const empty: Ledger = { entries: [], text: '', numbers: new Set() };
  const cases: [string, string][] = [
    ['file:line', '<p>see src/server/app.ts:1234-1260 and lib/x.py:88</p>'],
    ['bare :line / L-refs', '<p>at line 412, also #L77-L90</p>'],
    ['git SHA', '<p>pinned at 3e9ea11 and 8240e90c7d1f2a3b4c5d6e7f8091a2b3c4d5e6f7</p>'],
    ['HTTP status', '<p>returns HTTP 404; status 401/403 on the admin route; a 503 Service Unavailable; any 5xx</p>'],
    ['dates + times', '<p>on 2026-09-27T14:05:09Z, 2026/09/27, 9/27/2026, Sep 27, 2026, 27 Sep, at 14:05</p>'],
    ['version strings', '<p>express 4.18.2 and v7.10, react 18.3.1-rc.2</p>'],
    ['<code>/<pre>/.mono', '<p>run <code>head -n 4096</code></p><pre>SELECT 7719 FROM t</pre><span class="mono small">8841</span>'],
    ['URL', '<p>see https://github.com/o/r/blob/abc/x.ts#L120 or www.example.com/p/3131</p><a href="https://x.io/a%2050%25">link</a>'],
    ['part of a word', '<p>base64, gpt-5.5, node:22, sha256, k8s, x86, R12 and H100</p>'],
    ['issue refs', '<p>fixed in #288 and #1024</p>'],
  ];
  for (const [label, html] of cases) assert.deepEqual(numberAudit(html, empty), [], `${label}: ${numberAudit(html, empty).join(',')}`);
});

test('numberAudit still flags REAL un-ledgered metrics next to identifiers', () => {
  const empty: Ledger = { entries: [], text: '', numbers: new Set() };
  const f = numberAudit('<p>In src/a.ts:120 (commit 3e9ea11) the stay rate is <b>73.4%</b> over <b>12,406</b> users; p95 is 340ms.</p>', empty);
  assert.ok(f.includes('73.4%'), f.join(','));
  assert.ok(f.includes('12,406'), f.join(','));
  assert.ok(f.includes('340'), 'a latency figure with a unit suffix is a metric, not an identifier');
  assert.ok(!f.some((t) => /120|3e9|9ea/.test(t)), f.join(','));
  // a negative / percentage metric in prose is unaffected by the word-attached rule
  assert.ok(numberAudit('<p>delta -8.5% vs baseline</p>', empty).includes('-8.5%'));
});

test('a numbers-ledger section is soft-flagged (never HARD); ordinary headings are not', async () => {
  const { numbersLedgerSection, advisoryChecks } = await import('./htmlQc.ts');
  for (const h of ['<h2>Numbers ledger</h2>', '<h3>Numbers key</h3>', '<summary>Numeral justification</summary>', '<h2>Where the numbers come from</h2>', '<section id="numbers-ledger"></section>']) {
    const f = numbersLedgerSection(`<body>${h}<p>x</p></body>`);
    assert.ok(f, h); assert.equal(f!.severity, 'SOFT'); assert.equal(f!.id, 'NUMBERSLEDGER');
  }
  assert.equal(numbersLedgerSection('<h2>Pool size by source</h2><h2>Key findings</h2><th>Numbers</th>'), null);
  assert.ok(advisoryChecks('<h2>Numbers ledger</h2>').every((f) => f.severity === 'SOFT'));
});

// ── the SQL rubric applies only to query-plane findings ──
import { drawerKindOf, drawerPlanes, rubricsArea } from './htmlQc.ts';
import type { Hypothesis } from './investigation.ts';
const hy = (id: string, plane?: string, source?: string): Hypothesis => ({ id, claim: 'c', symptom: 's', status: 'supported', decisiveMetric: 'm', ...(plane ? { plannedMeasurement: { requiresPlane: plane } } : {}), ...(source ? { measurement: { value: 1, source } } : {}) } as unknown as Hypothesis);

test('drawerKindOf / drawerPlanes classify planes (code-native = none/codeintel/repometa/osv)', () => {
  for (const p of ['none', 'codeintel', 'repometa', 'osv']) assert.equal(drawerKindOf(hy('h', p)), 'command', p);
  for (const p of ['warehouse', 'analytics', 'bi', 'keyvalue']) assert.equal(drawerKindOf(hy('h', p)), 'query', p);
  assert.equal(drawerKindOf(hy('h', undefined, 'src/server.ts:120')), 'command', 'a file:line source is a code read');
  assert.equal(drawerKindOf(hy('h', undefined, 'warehouse:events_daily')), 'query');
  assert.equal(drawerKindOf(hy('h')), undefined);
  assert.deepEqual(drawerPlanes([]), { sql: true, code: false }, 'nothing knowable → the historical SQL contract');
  assert.deepEqual(drawerPlanes([hy('a', 'codeintel'), hy('b', 'none')]), { sql: false, code: true });
  assert.deepEqual(drawerPlanes([hy('a', 'codeintel'), hy('b', 'warehouse')]), { sql: true, code: true });
});

test('the SQL rubric is NOT raised for a code-plane report with a shell drawer (judge prompt)', async () => {
  const savedKey = process.env.OPENAI_API_KEY; const savedFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"hard":[],"soft":[],"summary":"ok"}' } }], usage: {} }), { status: 200 })) as typeof fetch;
  try {
    let seen = '';
    const html = '<h2>Finding</h2><details><summary>Decisive test</summary><pre>git log --oneline -- src/auth.ts | wc -l</pre></details>';
    const v = await runHtmlQc(html, { ledger, dossierJson: '[]', tier: 'area', planes: drawerPlanes([hy('a', 'codeintel')]), onJudgeRaw: (_r, p) => { seen = p; } });
    assert.equal(v.hard.length, 0);
    assert.doesNotMatch(seen, /- SQL: each chart\/number has its re-runnable query/, 'no SQL rubric for a code-only report');
    assert.match(seen, /- DRAWER: .*runnable command \(git \/ grep \/ gh \/ curl\)/);
    assert.match(seen, /SQL drawer over tables that do not exist FAILS/);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  }
  // default / query-plane reports keep the SQL rubric verbatim; a mixed one scopes it per finding
  assert.match(rubricsArea(), /- SQL: each chart\/number has its re-runnable query in a <details> drawer\./);
  assert.match(rubricsArea({ sql: true, code: true }), /drawer: "command"[\s\S]*do NOT require SQL for it/);
});

// ── area report shape — SOFT advisories only ──
import { glanceTableCheck, statusVocabCheck, advisoryChecks as advisories } from './htmlQc.ts';
test('the at-a-glance table is soft-checked', () => {
  const ok = '<div class="bl">Bottom line</div><h2>Hypotheses at a glance</h2><table><tr><td>h1</td></tr></table>';
  assert.equal(glanceTableCheck(ok), null);
  assert.equal(glanceTableCheck('<h2><span>Hypothesis at a glance</span></h2><table></table>'), null);
  const missing = glanceTableCheck('<h2>Findings</h2><p>x</p>');
  assert.equal(missing?.id, 'GLANCE'); assert.equal(missing?.severity, 'SOFT');
  assert.equal(glanceTableCheck('<h2>Hypotheses at a glance</h2><ul><li>h1</li></ul>')?.id, 'GLANCE', 'heading without a table');
});
test('a status chip outside the four report statuses is soft-flagged; the four pass', () => {
  const good = '<span class="st st-confirmed"><b>Confirmed</b></span> <span class="st st-ruled-out">Ruled out</span> <span class="status">Needs a test</span> <span class="verdict">Not measurable here</span>';
  assert.equal(statusVocabCheck(good), null);
  const bad = statusVocabCheck('<span class="st st-confirmed">Supported</span><span class="verdict">Partially confirmed</span><span class="badge">Measured</span>');
  assert.equal(bad?.id, 'STATUSVOCAB'); assert.equal(bad?.severity, 'SOFT');
  assert.match(bad!.reason, /"Supported"/); assert.match(bad!.reason, /"Partially confirmed"/);
  assert.doesNotMatch(bad!.reason, /Measured/, 'a non-status badge class is not a verdict label');
  // a label in another script is not one of the four either
  assert.equal(statusVocabCheck('<span class="st st-confirmed">\u5df2\u786e\u8ba4</span>')?.id, 'STATUSVOCAB');
});
test('shape advisories run on the AREA tier only and are never HARD', () => {
  const html = '<h2>Findings</h2><span class="st">Refuted</span>';
  const a = advisories(html, 'area');
  assert.deepEqual(a.map((f) => f.id).sort(), ['GLANCE', 'STATUSVOCAB']);
  assert.ok(a.every((f) => f.severity === 'SOFT'));
  assert.ok(!advisories(html, 'leadership').some((f) => f.id === 'GLANCE' || f.id === 'STATUSVOCAB'));
});

// ── leadership shape — SOFT deterministic checks ──
import { headlineCheck, headlineWords, kpiRepeatCheck, tierBadgeCheck, leadershipAdvisories } from './htmlQc.ts';
test('headline length — ≤16 words', () => {
  assert.equal(headlineWords('The audit cannot certify its own findings'), 7);
  assert.equal(headlineCheck('<body><h1>The audit cannot certify its own findings</h1></body>'), null);
  const longEn = '<h1>The audit pipeline has no merge gate and scores itself with two different yardsticks that disagree on the same run</h1>';
  const f = headlineCheck(`<body>${longEn}</body>`);
  assert.equal(f?.id, 'HEADLINE'); assert.equal(f?.severity, 'SOFT'); assert.match(f!.reason, /20 words/);
  assert.equal(headlineCheck('<p>no title</p>'), null);
});
test('a KPI number may appear at most twice (strip + one mention)', () => {
  const strip = '<div class="kpi-strip"><div class="card"><b>12.4x</b> over-weighting</div><div class="card"><b>31%</b> share</div></div>';
  const ok = `<body>${strip}<ul><li>Correction is 12.4x its documented strength.</li></ul><section><div class="card"><b>7,120</b></div></section></body>`;
  assert.equal(kpiRepeatCheck(ok), null);
  const bad = `<body>${strip}<p>12.4x too strong.</p><section><div class="card"><b>12.4x</b></div><p>again 12.4 x</p></section></body>`;
  const f = kpiRepeatCheck(bad);
  assert.equal(f?.id, 'KPIREPEAT'); assert.equal(f?.severity, 'SOFT'); assert.match(f!.reason, /12\.4x ×4/);
  assert.equal(kpiRepeatCheck('<p>no strip 5 5 5 5</p>'), null, 'no kpi-strip marker → nothing to check');
});
test('evidence-tier badges are soft-checked; the leadership advisories are all SOFT', () => {
  assert.equal(tierBadgeCheck('<span class="tier">Read from code</span>'), null);
  assert.equal(tierBadgeCheck('<span>Needs a test</span>'), null);
  assert.equal(tierBadgeCheck('<p>no badges</p>')?.id, 'TIERBADGE');
  assert.ok(leadershipAdvisories('<h1>x</h1>').every((f) => f.severity === 'SOFT'));
});

// ── FINDINGCOUNT: the brief's stated finding count must match the run's confirmed total (two-report "needs care") ──
import { findingCountCheck, statedFindingCounts } from './htmlQc.ts';
test('statedFindingCounts: digits and number words', () => {
  assert.deepEqual(statedFindingCounts('<p>We found all three confirmed findings and 6 issues.</p>'), [3, 6]);
  assert.deepEqual(statedFindingCounts('<p>Twelve problems in total; eleven defects are open.</p>'), [12, 11]);
  assert.deepEqual(statedFindingCounts('<p>Latency rose 3x; 12 tables checked.</p>'), []);
});
test('findingCountCheck: flags a count that disagrees with the confirmed total, SOFT only', () => {
  const f = findingCountCheck('<p>all three confirmed findings</p>', 6);
  assert.equal(f?.id, 'FINDINGCOUNT');
  assert.equal(f?.severity, 'SOFT');
  assert.equal(findingCountCheck('<p>6 confirmed findings · six issues</p>', 6), null);
  assert.equal(findingCountCheck('<p>all three confirmed findings</p>', undefined), null);
});
test('leadershipAdvisories: carries FINDINGCOUNT only when the confirmed total is given', () => {
  const html = '<h1>x</h1><p>two findings</p>';
  assert.ok(!leadershipAdvisories(html).some((f) => f.id === 'FINDINGCOUNT'));
  assert.ok(leadershipAdvisories(html, { confirmed: 5 }).some((f) => f.id === 'FINDINGCOUNT'));
});

test('statedFindingCounts: the provenance banner share "0 of 8 findings measured" is not a finding count', () => {
  assert.deepEqual(statedFindingCounts('<div>Generated · 0 of 8 findings measured against live systems</div><p>7 confirmed findings</p>'), [7]);
  assert.equal(findingCountCheck('<div>0 of 8 findings measured</div><p>7 findings</p>', 7), null);
});
