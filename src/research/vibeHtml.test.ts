import { test } from 'node:test';
import assert from 'node:assert/strict';
import { englishGapReason } from './vibeHtml.ts';
import { visibleText, rewordIsFaithful, redTeamIsFaithful } from './vibeHtml.ts';

// Locks in the free-vibe faithfulness gate's contract : the gates count numbers over VISIBLE
// TEXT only, so DATA numbers (prose / table cells / chart text labels / SVG <text>) are protected against
// fabrication & drift, while chart GEOMETRY (style widths, SVG path/x/y coords) is free to change (so the red-team
// can repair a broken chart). Guards against a future regex regression in visibleText.

test('visibleText: drops <style>/<script> blocks (so CSS/style digits are not counted)', () => {
  const t = visibleText('<style>.a{width:45%}</style><script>var x=12;</script><p>hello 7</p>');
  assert.equal(/45/.test(t), false, 'CSS width must be stripped');
  assert.equal(/12/.test(t), false, 'script digit must be stripped');
  assert.match(t, /hello 7/, 'visible prose number kept');
});

test('visibleText: drops tag ATTRIBUTES (style widths, SVG coords) but keeps text nodes incl. SVG <text>', () => {
  const t = visibleText('<div style="width:30%"><svg viewBox="0 0 100 50"><rect x="3" y="9"/><text>0.456</text></svg></div>');
  assert.equal(/30/.test(t), false, 'inline style width is an attribute → stripped');
  assert.equal(/100|50/.test(t), false, 'viewBox geometry → stripped');
  assert.equal(/\b3\b|\b9\b/.test(t), false, 'svg x/y coords → stripped');
  assert.match(t, /0\.456/, 'SVG <text> label is a text node → KEPT (a data number, gated)');
});

test('rewordIsFaithful: a pure prose polish that keeps every DATA number passes', () => {
  const orig = '<p>like rate is 0.456 vs the 0.50 line</p>';
  const next = '<p>the like rate sits at 0.456, below the 0.50 bar</p>';
  assert.equal(rewordIsFaithful(orig, next), true);
});

test('rewordIsFaithful: dropping or fabricating a DATA number fails (both directions)', () => {
  const orig = '<p>0.456 vs 0.50</p>';
  assert.equal(rewordIsFaithful(orig, '<p>below the 0.50 bar</p>'.padEnd(orig.length, ' ')), false, 'dropped 0.456 → reject');
  assert.equal(rewordIsFaithful(orig, '<p>0.456 vs 0.50 vs 0.99</p>'), false, 'fabricated 0.99 → reject');
});

test('rewordIsFaithful: changing only a CHART GEOMETRY number (style width) is NOT a data-number change → passes', () => {
  const orig = '<div style="width:22%"></div><p>AUC 0.456</p>';
  const next = '<div style="width:91%"></div><p>AUC 0.456</p>';   // width corrected to match the value; data number intact
  assert.equal(rewordIsFaithful(orig, next), true);
});

test('redTeamIsFaithful: may DROP a number (one-directional) but must add NO new visible data number', () => {
  const orig = '<p>0.456 and 0.50 and a weak claim of 0.99</p>';
  assert.equal(redTeamIsFaithful(orig, '<p>0.456 and 0.50</p>'.padEnd(orig.length, ' ')), true, 'dropping the weak 0.99 is allowed');
  assert.equal(redTeamIsFaithful(orig, '<p>0.456 and 0.50 and 0.99 and 0.71</p>'), false, 'introducing 0.71 → reject');
});

test('redTeamIsFaithful: repairing a bar WIDTH to match its value is accepted (geometry ungated)', () => {
  const orig = '<div class="bar" style="width:22%"></div><span>0.456</span>';
  const next = '<div class="bar" style="width:91%"></div><span>0.456</span>';
  assert.equal(redTeamIsFaithful(orig, next), true);
});

test('faithful gates: a truncated / too-small reply is rejected', () => {
  const orig = '<p>0.456</p>'.padEnd(200, ' ');
  assert.equal(rewordIsFaithful(orig, '<p>0.456</p>'), false, 'reword < 60% of orig length → reject');
  assert.equal(redTeamIsFaithful(orig, '<p>0.456</p>'), false, 'red-team < 50% of orig length → reject');
  assert.equal(rewordIsFaithful(orig, null), false);
  assert.equal(redTeamIsFaithful(orig, null), false);
});

// ── completeness gate: the authored report must carry a substantial English rendering ─────────────

const LONG_EN = 'This is a sufficiently long English rendering that passes the completeness check. '.repeat(14);

test('completeness gate: a substantial English document passes — no wrapper needed', () => {
  assert.equal(englishGapReason(`<!doctype html><body><main>${LONG_EN}</main></body>`), null);
});

test('completeness gate: a near-empty document is reported with its word count', () => {
  assert.match(englishGapReason('<!doctype html><body><p>Too short.</p><style>.a{width:10px}</style></body>') ?? '', /English rendering too thin \(\d+ words\)/);
});
