import { test } from 'node:test';
import assert from 'node:assert/strict';

// The writer brief and the QC rubric are ONE contract. A rubric the brief never asks for is a rubric the writer can
// only fail, round after round, until the loop burns its budget and ships the residual HARD — so these assert the
// bullets that a HARD rubric depends on, not prose style.

// ── the "no numbers ledger" brief line and its SOFT check are one contract ──
import { NUMBERS_LEDGER_BRIEF, numbersLedgerSection, RUBRICS_AREA, RUBRICS_LEAD } from './htmlQc.ts';
test('the numbers-ledger brief line and the check that soft-flags one exist', () => {
  assert.equal(NUMBERS_LEDGER_BRIEF, 'Do not add a numbers key / numbers ledger / numeral-justification section.');
  assert.equal(numbersLedgerSection('<h2>Numbers ledger</h2>')?.severity, 'SOFT', 'paired check is SOFT — a brief nudge is never HARD-gated');
  // …and the judge is told identifiers are not TRACE material, so it cannot re-create the pressure the brief removes.
  for (const r of [RUBRICS_AREA, RUBRICS_LEAD]) assert.match(r, /Identifiers are NOT numbers to trace/);
});

// ── decisive tests that can actually run — brief and rubric key on the SAME drawerPlanes() ──
import { CODE_DRAWER_RULE, drawerPlanes, rubricsArea } from './htmlQc.ts';
import type { Hypothesis } from './investigation.ts';
const codeHyp = (id: string, plane: string): Hypothesis => ({ id, claim: 'c', symptom: 's', status: 'supported', decisiveMetric: 'm', plannedMeasurement: { requiresPlane: plane } } as unknown as Hypothesis);
test('a code-native area is scored for runnable commands, never SQL', () => {
  const hyps = [codeHyp('swe:h1', 'codeintel'), codeHyp('swe:h2', 'none')];
  assert.match(CODE_DRAWER_RULE, /command/);
  const r = rubricsArea(drawerPlanes(hyps));
  assert.doesNotMatch(r, /re-runnable query/); assert.match(r, /runnable command/);
});
test('a mixed area keeps SQL for query-plane findings and names the code-read ones', () => {
  const hyps = [codeHyp('x:h1', 'warehouse'), codeHyp('x:h2', 'repometa')];
  assert.match(rubricsArea(drawerPlanes(hyps)), /drawer: "command"/);
});

// ── area report shape — brief ⇄ SOFT rubric pairs, statuses from the shared vocabulary ──
import { AREA_SHAPE_BRIEF, glanceTableCheck, statusVocabCheck } from './htmlQc.ts';
import { REPORT_STATUS } from '../reportChrome.ts';
test('the area shape brief asks for the at-a-glance table, <details> per hypothesis, and ONLY the four statuses', () => {
  const p = AREA_SHAPE_BRIEF;
  assert.match(p, /Hypotheses at a glance/);
  assert.match(p, /inside a <details> — collapsed by default; add `open` only for a Confirmed defect/);
  for (const s of Object.values(REPORT_STATUS)) { assert.ok(p.includes(s.label) && p.includes(s.cls), s.label); }
  // the paired checks exist and are SOFT (a brief requirement the rubric checks, never HARD-gated)
  assert.equal(glanceTableCheck('<p>x</p>')?.severity, 'SOFT');
  assert.equal(statusVocabCheck('<span class="st">Supported</span>')?.severity, 'SOFT');
});

// ── leadership brief shape — every path that writes a leadership brief carries the rules its SOFT checks read ──
import { LEADERSHIP_SHAPE_BRIEF, HEADLINE_MAX, headlineCheck, kpiRepeatCheck, tierBadgeCheck } from './htmlQc.ts';
import { vibePrompt } from './leadershipVibe.ts';
import { writerPrompt } from './leadershipWriter.ts';
import type { LeadershipWriterOpts } from './leadershipWriter.ts';
const lOpts: LeadershipWriterOpts = { company: 'Acme', scopeDesc: 'the repo', meta: 'code', hypotheses: [], mitigations: [] };
test('the free-vibe leadership brief carries the shape rules; the checks are SOFT', () => {
  assert.ok(vibePrompt(lOpts, null).includes(LEADERSHIP_SHAPE_BRIEF));
  assert.match(LEADERSHIP_SHAPE_BRIEF, /at most 16 words. /);
  assert.match(LEADERSHIP_SHAPE_BRIEF, /class="kpi-strip"/, 'the KPI check keys on this marker');
  assert.match(LEADERSHIP_SHAPE_BRIEF, /Measured \/ Read from code \/ Needs a test/);
  assert.match(LEADERSHIP_SHAPE_BRIEF, /quick win \/ moderate \/ large/);
  assert.match(LEADERSHIP_SHAPE_BRIEF, /role="img" and an aria-label/);
  const s = writerPrompt(lOpts);
  assert.match(s, new RegExp(`at most ${HEADLINE_MAX} words\.`));
  assert.match(s, /NUMBERS ONCE/);
  for (const f of [headlineCheck(`<h1>${'word '.repeat(20)}</h1>`), kpiRepeatCheck('<div class="kpi-strip">42%</div><p>42% 42% 42%</p>'), tierBadgeCheck('<p>x</p>')]) assert.equal(f?.severity, 'SOFT');
});
test('the verdict material hands the author the evidence tier (derived) and an effort only when present', () => {
  const hyps = [
    { id: 'h1', claim: 'a code read', status: 'supported', measurement: { value: 3, source: 'src/a.ts:10' } },
    { id: 'h2', claim: 'not settled', status: 'open' },
  ] as never;
  const p = vibePrompt({ ...lOpts, hypotheses: hyps, mitigations: [{ hypothesisId: 'h1', supported: true, lever: 'fix', effort: 'quick_win' }] as never }, null);
  assert.match(p, /a code read\n\s+measured: 3\n\s+evidence tier: Read from code\n\s+effort: quick win/);
  assert.match(p, /not settled\n\s+measured: not measured \(needs an eval\)\n\s+evidence tier: Needs a test\n(?!\s+effort)/);
});
