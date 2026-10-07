import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_VIBE_CONTRACT } from './reportContract.ts';

// These pin the chart rules that PRODUCTION OUTPUT violated, measured on real reports:
//   · run A (v1) drew "1 of 2" as a half-filled single-bar track and "0%" as an EMPTY
//     track — two figures conveying nothing the sentence had not already said.
//   · run B (v4) drew "Feed users who search vs. do not" as a lone 16.3% coverage bar,
//     restating the KPI tile directly above it.
// Both are entries in the dataviz anti-pattern catalog ("a one-bar bar chart, or a 2-slice pie →
// a stat tile; the number IS the chart"). The old contract had CORRECTNESS rules for charts (width
// proportional to value, valid viewBox, table cell counts) but nothing that said when NOT to draw one,
// so a correct chart of a single number passed every check it had.

test('the contract says when NOT to draw a chart, not only how to draw one correctly', () => {
  assert.match(FREE_VIBE_CONTRACT, /AT LEAST 3 COMPARED VALUES/, 'a single value / two-part share must route to a stat tile');
  assert.match(FREE_VIBE_CONTRACT, /NO CHART WHOSE ONLY CONTENT IS A NUMBER ALREADY SHOWN/, 'a lone bar restating a headline tile adds nothing');
});

// The first wording was "never draw the same number twice", and it over-pruned. Measured: post-change run
// r3 turned a single 16.3% coverage bar into a FOUR-window comparison against the go/no-go threshold —
// the right outcome — while r4 dropped the coverage chart entirely, because its headline number also
// appeared in a tile. A chart that contextualises a known number is the point of charting, so the rule
// now asks what the figure ADDS rather than whether the number repeats.
test('the duplicate rule does not forbid putting a known number in context', () => {
  assert.match(FREE_VIBE_CONTRACT, /IN CONTEXT/, 'context is the exception that makes the rule usable');
  assert.match(FREE_VIBE_CONTRACT, /is NOT a duplicate/);
  assert.match(FREE_VIBE_CONTRACT, /what the figure adds beyond the number/, 'the test the writer should apply');
});

test('the single-bar and empty-track cases are named explicitly, not left to inference', () => {
  // Named because both shipped: a generic "prefer a tile for one value" did not stop either one.
  assert.match(FREE_VIBE_CONTRACT, /1 of 2/, 'the half-filled single-bar case');
  // Whitespace-tolerant: the contract is a wrapped template literal, so any phrase long enough to be
  // worth pinning can fall across a line break plus indentation. A literal-space regex here passed
  // locally on a one-line draft and broke the moment the sentence wrapped.
  assert.match(FREE_VIBE_CONTRACT, /empty track\s+shows nothing at all/, 'the 0% empty-track case');
  assert.match(FREE_VIBE_CONTRACT, /two-slice donut/);
});

test('the dual-axis prohibition is present — the catalogue calls it the #1 chart mistake', () => {
  assert.match(FREE_VIBE_CONTRACT, /ONE SCALE PER PLOT/);
  assert.match(FREE_VIBE_CONTRACT, /index both to a common base/, 'and gives the remedy, not just the ban');
});

test('mark and label rules that keep a chart readable are stated', () => {
  assert.match(FREE_VIBE_CONTRACT, /NO VALUE-RAMP ON UNORDERED CATEGORIES/);
  assert.match(FREE_VIBE_CONTRACT, /SELECTIVE LABELS ONLY/, 'never a number on every bar');
  assert.match(FREE_VIBE_CONTRACT, /No dashed gridlines/);
  assert.match(FREE_VIBE_CONTRACT, /never be clipped by its own bar/);
});

// The correctness rules must SURVIVE the addition — they are why charts stopped contradicting their
// own numbers, and a rewrite that drops them trades one defect class for another.
test('the pre-existing chart-correctness rules are still in force', () => {
  assert.match(FREE_VIBE_CONTRACT, /WIDTH must be proportional to its value on a STATED scale/);
  assert.match(FREE_VIBE_CONTRACT, /valid viewBox/);
  assert.match(FREE_VIBE_CONTRACT, /A chart that would render visibly wrong is worse than none/);
});
