import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestPrompt, vibePrompt } from './leadershipVibe.ts';
import type { LeadershipWriterOpts } from './leadershipWriter.ts';

// These pin the rules that a real production Bottom line VIOLATED. Measured on run A's leadership
// report (the old prompt's own output, scored on deterministic axes): mean 69 words/bullet against a 45-word
// target, 3 sentences where 2 is the cap, five comma-chained claims in one bullet, a six-item imperative list as
// the "fix" half, six stacked qualifiers in another bullet, and a title reading "Data & Recommendation System
// Audit" for a run comprehend had classified as internal dev-tools. The old prompt contained NONE of these rules.

const base: LeadershipWriterOpts = {
  company: 'Acme', scopeDesc: 'the repository, assessed as one system', meta: 'code · 2026-09-14',
  hypotheses: [], mitigations: [],
};

test('the Bottom-line contract reaches the digest prompt', () => {
  const p = digestPrompt(base);
  // Tightened after a reader's review of the shipped report ("the TL;DR up front is too long"): the 45-word/2-sentence cap still
  // produced 3-line bullets, so a bullet is now ONE sentence. Shipped bullets measured 158/127/175 chars.
  assert.match(p, /Each bullet is ONE LINE — a single sentence, at most ~25 words/, 'length was unbounded; output averaged 69 words');
  assert.match(p, /THEME, NOT A LIST/, 'one bullet chained five findings');
  assert.match(p, /BUT A THEME IS NOT AN ABSTRACTION/, 'the theme rule produced "share one pattern" category labels');
  assert.match(p, /THE FIX HALF IS NOT A LIST EITHER/, 'and its fix half chained six imperatives');
  assert.match(p, /NEVER append a caveat/, 'bullets ended on "— while several open items still need…"');
  assert.match(p, /ONE hedge per bullet at most/, 'one bullet stacked six qualifiers');
});

// The rule used to be written out twice — planner and author — and a fix landed on the planner while the author
// kept the old text. One constant now feeds both, so this asserts the seam rather than the wording.
test('the Bottom-line contract is ONE definition, not two copies', () => {
  const p = digestPrompt(base);
  assert.equal((p.match(/THE FIX HALF IS NOT A LIST EITHER/g) ?? []).length, 1);
});

// comprehend classifies the audited system; the prompts used to hardcode "a read-only recommendation/data audit",
// so a dev-tools audit titled itself a recommendation-system audit. Twice, in two different runs.
test('the report is framed by the audited system, not by a hardcoded domain', () => {
  const kind = 'Internal dev-tools / AI engineering: a TypeScript+Node diagnostic engine';
  const p = digestPrompt({ ...base, systemKind: kind });
  assert.match(p, /Internal dev-tools \/ AI engineering/, 'the classification must reach the prompt');
  assert.match(p, /[Dd]o not assume a recommendation/);
  assert.doesNotMatch(digestPrompt(base), /a read-only recommendation\/data audit/, 'the hardcoded framing is gone');
});

// The reader's intake is sliced at 1600 chars under a rule that says "answer EACH ask, in their order".
test('a truncated intake is marked, not silently dropped', () => {
  const p = digestPrompt({ ...base, inquiry: 'Q'.repeat(2000) });
  assert.match(p, /TRUNCATED here: \+400 more characters/);
  assert.match(p, /never silently drop them/);
});

// ── A reader's review of the shipped report: "too engineering-heavy / not written for leadership / leaders want fewer words, more pictures, more numbers" ──
// The contract offered metric cards and bars as optional CONVENTIONS and required no count, so visual density
// swung run to run (84 cards → 10). The digest had also planned THIRTEEN sections for a leadership brief.
test('the leadership brief demands numbers and charts, not prose', () => {
  const d = digestPrompt(base);
  assert.match(d, /AT MOST 6 SECTIONS/, 'the digest planned 13 sections for a leadership brief');
  assert.match(d, /EVERY SECTION MUST BE LED BY NUMBERS/, 'sections opened with a paragraph instead of a number');
  assert.match(d, /THE LABEL IS THE HARD PART/, 'a card label is read alone, with no sentence to explain it');
  // and the AUTHOR must be told the same thing in countable terms, or the cards/charts swing run to run
  const v = vibePrompt(base, null);
  assert.match(v, /FEWER WORDS, MORE PICTURES, MORE NUMBERS/);
  assert.match(v, /EVERY section opens with a ROW OF METRIC CARDS/);
  // An earlier version asserted the UNCONDITIONAL form of this ("A report with no chart at all has failed"). That
  // sentence is now qualified, and the reason is worth stating because an existing test is being changed:
  // code review pointed out that it contradicted the chart FLOOR ("a chart needs at least 3
  // compared values"), and that an author handed both instructions resolves the conflict the only way it
  // can — by inventing a third value so a two-value comparison earns its chart. In an audit a fabricated
  // number is the worst possible outcome, worse than a missing chart.
  //
  // The original intent is preserved, and still asserted below: charts are DEMANDED, and a report that had
  // something plottable and plotted nothing has failed. What is removed is the push to draw when there is
  // nothing to draw.
  assert.match(v, /carries a CHART/, 'charts are still demanded');
  assert.match(v, /A report with nothing plotted has failed ONLY if it had something plottable/);
  assert.match(v, /NEVER invent a value to earn one/, 'and the fabrication escape hatch is closed');
  assert.match(v, /PROSE IS RATIONED/);
});

// Prose got de-jargoned and the same words reappeared in chart axes and card captions, where it is worse.
// Real labels from the run before this rule: "recall / precision", "scorer", "recall formula".
test('the jargon rule is a substitution table, and it covers labels', () => {
  const p = vibePrompt(base, null);
  assert.match(p, /TRANSLATE THE VOCABULARY/, 'a ban did not work — the words come out of the verdicts');
  assert.match(p, /THE LABELS ARE WHERE THIS RULE GETS FORGOTTEN/);
  assert.match(p, /BEFORE YOU EMIT, READ EVERY LABEL ON ITS OWN/);
});

// Review catch: the digest prompt told the planner to emit {value,label} metrics into a JSON schema that
// had no field for them — so they were either dropped by extractJson or folded into `evidence`, and the metric-card
// guarantee rested on the author prompt alone. These pin the field end-to-end: asked for, typed, and rendered.
test('the planner metrics have a home in the schema it is handed', () => {
  const p = digestPrompt(base);
  assert.match(p, /"metrics":\[\{"value"/, 'the JSON spec must carry the field the rule demands');
  assert.match(p, /in plain words a non-engineer reads alone/, 'a card label is read with no sentence around it');
});

test('the planned metrics reach the author, not just the planner', () => {
  const digest = {
    tldr: ['a', 'b', 'c'],
    sections: [{ n: '01', heading: 'Merge gates', thesis: 'nothing blocks a merge',
      evidence: ['0 gates'], metrics: [{ value: '0', label: 'checks that run before code ships' }] }],
  };
  const v = vibePrompt(base, digest as never);
  assert.match(v, /metric cards: 0 — checks that run before code ships/, 'digestBlock must render them');
  assert.match(v, /open on the metric cards listed for it/, 'and tell the author to lead with them');
});

// The closing "Checked & ruled out" note is a terse line each — bolting cards and a chart onto it is the opposite
// of the density rules' intent.
test('the ruled-out note is exempt from the per-section density rules', () => {
  assert.match(vibePrompt(base, null), /"Checked & ruled out" note is NOT a\s+section/);
});

// ── Review catch: cap() truncates, redactSecrets() runs on the joined block afterwards ──
// A secret straddling the cut would already have been sliced into a fragment the redaction patterns no
// longer recognise, so cap() redacts first and can only ever cut inside "[redacted-…]".
test('a secret straddling the cap is redacted, not sliced into a fragment', () => {
  const key = 'AKIA' + 'Q'.repeat(16);                 // matches \bAKIA[0-9A-Z]{16}\b
  const note = 'x'.repeat(232) + ' ' + key + ' trailing prose that the cap removes';
  const p = digestPrompt({
    ...base,
    hypotheses: [{ id: 'h1', claim: 'a claim', measurement: { value: 1, note } }] as never,
  });
  // Not just the whole key: capping first would leave "AKIAQQQ…", a fragment \bAKIA[0-9A-Z]{16}\b no longer
  // matches, so the block-level redaction below it would pass the fragment straight through.
  assert.doesNotMatch(p, /AKIA/, 'no part of the key may reach the prompt');
});

test('vibePrompt: states the run tally as COUNTS only when findingTotals is given', () => {
  assert.doesNotMatch(vibePrompt(base, null), /COUNTS — the run's final tally/);
  const p = vibePrompt({ ...base, findingTotals: { confirmed: 6, ruledOut: 1 } }, null);
  assert.match(p, /COUNTS — the run's final tally: 6 confirmed finding\(s\), 1 ruled out\./);
  assert.match(p, /Do NOT count the\s+verdicts above yourself/);
  assert.match(p, /A ruled-out check is\s+NOT a finding: never state a combined total/);
});
