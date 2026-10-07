import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOnePatch, applyReportPatches, parseRedTeamPatches, hasPatchesArray, redTeamPrompt, type RedTeamPatch } from './reportRedTeam.ts';
import { BudgetLedger, BUDGET_ALLOC } from './budget.ts';
import type { RecallReportInput } from '../recallReportHtml.ts';

const B = (s: string): string => s;
const report = (): RecallReportInput => ({
  company: 'Acme', title: B('t'), question: B('q'), meta: 'm',
  bottomLine: B('Recall is the bottleneck'),
  cards: [{ v: '12%', label: B('lift') }],
  sections: [{ n: '01', heading: B('Recall'), body: B('Recall is too low and definitely the only cause') }],
  decisive: B('A/B the pool size'),
  recommendations: [B('Raise the pool cap'), B('Rewrite the ranker')],
  caveats: B('Single-window sample'),
  answerBack: B('you asked X · supports Y'),
});

// ── applyOnePatch: replace / append_caveat / drop on allowlisted paths ────────────────────────────
test('applyOnePatch: replace a singleton field (bottomLine)', () => {
  const { report: r, applied } = applyOnePatch(report(), { path: 'bottomLine', action: 'replace', value: B('Recall is a likely bottleneck') });
  assert.ok(applied);
  assert.equal(r.bottomLine, 'Recall is a likely bottleneck');
});

test('applyOnePatch: append_caveat to caveats', () => {
  const { report: r, applied } = applyOnePatch(report(), { path: 'caveats', action: 'append_caveat', value: B('no counterfactual was run') });
  assert.ok(applied);
  assert.match(r.caveats, /Single-window sample no counterfactual was run/);
});

test('applyOnePatch: replace + drop a recommendation', () => {
  const rep = applyOnePatch(report(), { path: 'recommendations[1]', action: 'replace', value: B('Investigate the ranker (exploratory)') });
  assert.equal(rep.report.recommendations[1], 'Investigate the ranker (exploratory)');
  const dropped = applyOnePatch(report(), { path: 'recommendations[0]', action: 'drop' });
  assert.equal(dropped.report.recommendations.length, 1);
  assert.equal(dropped.report.recommendations[0], 'Rewrite the ranker');
});

test('applyOnePatch: replace a section body; drop a whole section', () => {
  const body = applyOnePatch(report(), { path: 'sections[0].body', action: 'replace', value: B('Recall is low; one of several candidate causes') });
  assert.match(body.report.sections[0].body, /one of several candidate causes/);
  const drop = applyOnePatch(report(), { path: 'sections[0]', action: 'drop' });
  assert.equal(drop.report.sections.length, 0);
});

// ── applyOnePatch: rejections (allowlist + bounds + shape) ─────────────────────────────────────────
test('applyOnePatch: answerBack / cards / title are NOT editable (off-limits)', () => {
  for (const path of ['answerBack', 'cards[0]', 'cards[0].label', 'title', 'company', 'meta', 'question']) {
    const { applied } = applyOnePatch(report(), { path, action: 'replace', value: B('x') });
    assert.equal(applied, false, path);
  }
});

test('applyOnePatch: out-of-bounds index / missing value / drop-singleton are no-ops', () => {
  assert.equal(applyOnePatch(report(), { path: 'recommendations[9]', action: 'drop' }).applied, false);
  assert.equal(applyOnePatch(report(), { path: 'sections[5].body', action: 'replace', value: B('x') }).applied, false);
  assert.equal(applyOnePatch(report(), { path: 'bottomLine', action: 'replace' }).applied, false);   // no value
  assert.equal(applyOnePatch(report(), { path: 'bottomLine', action: 'drop' }).applied, false);       // can't drop a singleton
  assert.equal(applyOnePatch(report(), { path: 'sections[0].body', action: 'drop' }).applied, false); // drop a section via sections[N], not a field
});

test('applyOnePatch: a malformed value (not a string, or blank) is a no-op, never a throw', () => {
  assert.equal(applyOnePatch(report(), { path: 'bottomLine', action: 'replace', value: { en: 'an object' } as unknown as string }).applied, false);
  assert.equal(applyOnePatch(report(), { path: 'bottomLine', action: 'replace', value: '   ' }).applied, false);
});

// ── applyReportPatches: in order, drops re-index but earlier patches already applied ──────────────
test('applyReportPatches: applies a batch, counts applied, skips invalid', () => {
  const patches: RedTeamPatch[] = [
    { path: 'bottomLine', action: 'replace', value: B('Recall is a likely bottleneck') },
    { path: 'answerBack', action: 'replace', value: B('hacked') },        // rejected
    { path: 'caveats', action: 'append_caveat', value: B('single window') },
  ];
  const { report: r, applied } = applyReportPatches(report(), patches);
  assert.equal(applied, 2);
  assert.equal(r.bottomLine, 'Recall is a likely bottleneck');
  assert.equal(r.answerBack!, 'you asked X · supports Y');             // untouched
  assert.match(r.caveats, /single window/);
});

test('applyReportPatches: multiple drops in one batch hit the RIGHT elements (descending-index, no shift)', () => {
  // recommendations = [Raise the pool cap, Rewrite the ranker]; drop BOTH → empty (not an off-by-one).
  const both = applyReportPatches(report(), [{ path: 'recommendations[0]', action: 'drop' }, { path: 'recommendations[1]', action: 'drop' }]);
  assert.equal(both.applied, 2);
  assert.equal(both.report.recommendations.length, 0);
  // drop[0] + replace[1] in one batch: the replace targets the ORIGINAL index 1, then the drop removes original 0.
  const rep = (): RecallReportInput => ({ ...report(), recommendations: [B('a'), B('b'), B('c')] });
  const mixed = applyReportPatches(rep(), [{ path: 'recommendations[0]', action: 'drop' }, { path: 'recommendations[1]', action: 'replace', value: B('B!') }]);
  assert.equal(mixed.applied, 2);
  assert.deepEqual(mixed.report.recommendations, ['B!', 'c']);   // original[1] replaced, original[0] dropped
});

// ── parseRedTeamPatches: tolerant + drops malformed ───────────────────────────────────────────────
test('parseRedTeamPatches: parses valid patches, skips bad action/path/missing-value-where-needed', () => {
  const text = '```json\n{"patches":[' +
    '{"path":"bottomLine","action":"replace","value":"e","reason":"overclaim"},' +
    '{"path":"caveats","action":"frobnicate","value":"e"},' +                       // bad action → skipped
    '{"action":"drop"},' +                                                         // no path → skipped
    '{"path":"recommendations[0]","action":"drop"}' +
    ']}\n```';
  const out = parseRedTeamPatches(text);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((p) => p.path), ['bottomLine', 'recommendations[0]']);
});

test('parseRedTeamPatches: an empty / unparseable reply → no patches', () => {
  assert.deepEqual(parseRedTeamPatches('no json'), []);
  assert.deepEqual(parseRedTeamPatches('```json\n{"patches":[]}\n```'), []);
});

test('hasPatchesArray: distinguishes a real {patches:[]} reply from unparseable', () => {
  assert.equal(hasPatchesArray('```json\n{"patches":[]}\n```'), true);    // valid clean → accept (don't fall to Claude)
  assert.equal(hasPatchesArray('```json\n{"patches":[{"path":"bottomLine","action":"drop"}]}\n```'), true);
  assert.equal(hasPatchesArray('no json here'), false);                   // unparseable → fall to Claude
  assert.equal(hasPatchesArray('```json\n{"oops":1}\n```'), false);       // JSON but no patches array → fall to Claude
  assert.equal(hasPatchesArray(undefined), false);
});

test('redTeamPrompt: lists the editable paths + the patch grammar, never answerBack', () => {
  const p = redTeamPrompt(report());
  assert.match(p, /recommendations\[0\]/);
  assert.match(p, /sections\[0\]\.body/);
  assert.match(p, /replace\|append_caveat\|drop/);
  assert.ok(!/answerBack/i.test(p), 'answerBack is not an editable path');
});

// ── BudgetLedger.reserveInvaded ───────────────────────────────────────────────────────────────────
test('reserveInvaded: true once non-reserve spend eats into the protected reserve slice', () => {
  const total = 100; const led = new BudgetLedger(total);
  const nonReserveCap = total * (1 - BUDGET_ALLOC.reserve);   // e.g. 80 when reserve=0.20
  led.spend('bundle', nonReserveCap - 1);
  assert.equal(led.reserveInvaded(), false);
  led.spend('audit', 2);                                       // now non-reserve spend ≥ cap
  assert.equal(led.reserveInvaded(), true);
  // reserve's OWN spend does not count toward invasion
  const led2 = new BudgetLedger(total); led2.spend('reserve', total);
  assert.equal(led2.reserveInvaded(), false);
  // no budget cap → never invaded
  assert.equal(new BudgetLedger(0).reserveInvaded(), false);
});
