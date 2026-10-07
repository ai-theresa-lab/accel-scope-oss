import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredSplit } from './leadershipVibe.ts';
import { contractFor } from './leadershipContracts.ts';
import { externalSourceOf } from './evidencePlane.ts';
import type { Hypothesis } from './investigation.ts';

// A report built from live warehouse queries and one built by reading source rendered IDENTICALLY:
// run A was 91% code-reading, run B 63% measured, and nothing in either
// deliverable said so. The split is now computed here — never authored — because it is the report's
// credibility claim, and a model summarising its own provenance has every incentive to round up.

const h = (id: string, value: unknown, source?: string): Hypothesis => ({
  id, claim: `claim ${id}`, status: 'supported',
  measurement: { value, ...(source ? { evidence: { source } } : {}) },
} as unknown as Hypothesis);

test('only MEASURED hypotheses count as measured; unmeasured ones are not claims at all', () => {
  const s = measuredSplit([
    h('h1', 0.55, 'warehouse:analytics_dwd.events'),
    h('h2', 12, 'code:src/server.ts:1002'),
    h('h3', null),                                  // unmeasured → a coverage gap, not a report claim
  ]);
  assert.deepEqual([s.measured, s.total], [1, 2], 'h3 is excluded from BOTH counts, not counted as read');
  assert.deepEqual(s.planes, ['warehouse']);
});

test('a code-only run reports zero measured rather than quietly omitting the line', () => {
  const s = measuredSplit([h('h1', 1, 'code:a.ts'), h('h2', 2, 'static: b/c')]);
  assert.deepEqual([s.measured, s.total], [0, 2]);
  assert.deepEqual(s.planes, []);
});

test('compound refs count, and a CUSTOM plane only counts on a run that mounted it', () => {
  // Real ref shapes: planes get joined (`repo+redis+acmedash:`) and chained (`code:… ; redis:…`), so an
  // anchored prefix test undercounts them. The third ref names only a CUSTOM plane, and outside a mounted
  // manifest that earns nothing — the conservative direction, and the reason this is 2 and not 3.
  const s = measuredSplit([
    h('h1', 1, 'repo+redis+acmedash:analytics_dwd.x'),   // redis is a builtin → measured
    h('h2', 2, 'code:x.ts ; redis:scan(y:*)'),     // chained builtin      → measured
    h('h3', 3, 'acmedash:app_stats_event'),      // custom plane, unmounted here → NOT measured
  ]);
  assert.equal(s.measured, 2, 'an unmounted custom plane does not earn the stamp');
  assert.equal(s.total, 3);
  assert.deepEqual(s.planes, ['redis'], 'builtins are recognised without a manifest; the custom plane is not');
});

test('an empty run does not divide by zero or claim anything', () => {
  assert.deepEqual(measuredSplit([]), { measured: 0, total: 0, external: 0, planes: [], externalSources: [] });
});

test('v4 tells the writer to lead with measured findings and NOT to author the count', () => {
  const c = contractFor('v4').authorContentBlock;
  assert.match(c, /PROVENANCE IS THE CREDIBILITY/);
  assert.match(c, /MEASURED findings come FIRST, then RECORDED, then READ/);
  // Whitespace-tolerant: the contract is a wrapped template literal, so any phrase worth pinning can
  // fall across a line break plus indentation.
  assert.match(c, /do not report a count of what was measured/, 'the count is deterministic, not authored');
  assert.match(c, /Do not decorate a READ\s+finding with measurement language/);
});

test('v0 gains no provenance rules — the control is main, and main has none', () => {
  // This test used to pin "ONE AGGREGATED bullet folding the remaining" as the control's rule. An earlier change
  // DELETED that line on the default path (it is the source of the 72-word bullet this branch also
  // diagnosed), so the control moved with it — see leadershipControlArm.test.ts, which holds v0 to main.
  // What still belongs here is the narrower claim: provenance is v4's, and v0 must not quietly acquire it.
  const v0 = contractFor('v0');
  assert.doesNotMatch(v0.authorContentBlock, /PROVENANCE IS THE CREDIBILITY/);
  assert.doesNotMatch(v0.digestRules, /ONE AGGREGATED bullet folding the remaining/, 'the catch-all was deleted');
  assert.match(v0.digestRules, /a THEME bullet that NAMES the shared weakness/, 'and replaced it with a THEME bullet');
});

// ── EMPHASIS + DIAGRAM (boss feedback on the first v4 report: "more highlight and colour, and a
// diagram would be better"). The report used ZERO highlight markup — the <hl>/<red>/<green> vocabulary
// rubric R5 demands lives in the STRUCTURED path and the free-vibe contract never asked for it. v4 made
// it worse: cutting volume took bold from 42 spans to 4, so the page went flat.

test('v4 asks for emphasis that means something, and bounds it', () => {
  const c = contractFor('v4').authorContentBlock;
  assert.match(c, /EXACTLY ONE highlighted span per Bottom-line bullet/, 'one per bullet, not per number');
  assert.match(c, /speckle/, 'names the failure mode of emphasising everything');
  assert.match(c, /COLOUR MUST MEAN SOMETHING/);
  assert.match(c, /Never colour for decoration/);
});

test('v4 gates the diagram on a SHARED PATH and forbids inventing boxes', () => {
  const c = contractFor('v4').authorContentBlock;
  assert.match(c, /TWO OR MORE FINDINGS SIT ON ONE PATH/, 'a diagram is earned, not decorative');
  assert.match(c, /If the findings do not share a path, draw nothing/);
  assert.match(c, /LABEL EVERY ARROW with a verb/, 'an unlabelled arrow says "related somehow"');
  assert.match(c, /AT MOST 6 boxes/);
  // The one that matters most in an AUDIT: a drawn box reads as a found fact.
  assert.match(c, /Never invent a\s+component, a step or a system/);
  assert.match(c, /fabricated finding that happens to be drawn/);
});

test('the planner is asked to decide the shared-path question, so the writer is not guessing', () => {
  assert.match(contractFor('v4').digestRules, /DO THE ISSUES SHARE ONE PATH\?/);
  assert.match(contractFor('v4').digestRules, /If\s+they do not share a path, say that too/);
});

test('v0 gains no emphasis or diagram rules — the control stays the control', () => {
  const v0 = contractFor('v0').authorContentBlock;
  assert.doesNotMatch(v0, /EXACTLY ONE highlighted span/);
  assert.doesNotMatch(v0, /MECHANISM DIAGRAM/);
});

// ── THE THIRD STATE ─────────────────────────────────────────────────────────────────────────────
//
// The live-plane allowlist fixed an over-claim and introduced the mirror-image under-claim: with only two
// states, a recorded eval datapoint and a public advisory lookup both rendered as "READ FROM CODE". Neither
// is a live-system measurement and neither could have come from reading the repository, so both labels were
// wrong. Under-selling real measurement is the same defect as over-selling a code read — the report is
// misdescribing its own evidence either way.

test('a recorded measurement is neither a live query nor a code read', () => {
  const s = measuredSplit([
    h('h1', 1, 'warehouse:analytics_dwd.events'),      // live
    h('h2', 2, 'datapoint:recall_at_50'),       // really measured, just not live
    h('h3', 3, 'osv:GHSA-xxxx-yyyy-zzzz'),      // external advisory DB
    h('h4', 4, 'code:src/server.ts:1002'),      // read from source
  ]);
  assert.equal(s.measured, 1, 'only the live query is "measured against live systems"');
  assert.equal(s.external, 2, 'the datapoint and the advisory are recorded measurements');
  assert.equal(s.total, 4);
  assert.deepEqual(s.planes, ['warehouse']);
});

test('a code-derived INDEX is a code read, not a recorded measurement', () => {
  // codeintel is a precomputed index OF THE CLONED REPO, so it belongs in neither measured bucket — this is
  // the distinction round 5 established, and the third state must not quietly re-promote it.
  const s = measuredSplit([h('h1', 1, 'codeintel:dep_graph'), h('h2', 2, 'repogrep:owner/repo/a.ts')]);
  assert.deepEqual([s.measured, s.external], [0, 0]);
  assert.equal(s.total, 2);
});

test('the contract describes all THREE states, so the writer can tell them apart', () => {
  const c = contractFor('v4').authorContentBlock;
  assert.match(c, /\[MEASURED · <plane>\]/);
  assert.match(c, /\[MEASURED · RECORDED/);
  assert.match(c, /\[READ FROM CODE\]/);
  assert.match(c, /do NOT demote it to a code reading either/, 'the under-claim is forbidden explicitly');
});

// v4's "one summary layer" rule fixed a real defect (a headline number for an issue with no bullet) and
// created a fabrication incentive: it fixed N at 3 while nothing upstream guarantees three surviving
// issues — claim audit can leave one. Told to produce exactly three bullets from one issue, the author
// either splits it or invents. Same shape as the chart contradiction: an unsatisfiable rule is resolved by
// making something up.
test('N is bounded by the material, so a short brief is not a failure', () => {
  for (const block of [contractFor('v4').digestRules, contractFor('v4').authorContentBlock]) {
    assert.match(block, /AT MOST 3|AT MOST 3 \(4 only/, 'N is a ceiling, not a target');
    assert.doesNotMatch(block, /N = 3 issues/, 'a fixed N is the defect');
  }
  assert.match(contractFor('v4').digestRules, /BOUNDED BY THE MATERIAL/);
  assert.match(contractFor('v4').digestRules, /NEVER pad to three/);
  assert.match(contractFor('v4').authorContentBlock, /do NOT pad to three/);
  // The anti-fabrication sentence is the load-bearing half — without it "at most 3" still reads as a target.
  for (const block of [contractFor('v4').digestRules, contractFor('v4').authorContentBlock]) {
    assert.match(block, /fabricated finding/, 'padding must be named as fabrication');
  }
});

// ── FOUR WAYS A NON-MEASUREMENT WAS EARNING A MEASURED STAMP ──────────

test('an UNMEASURED hypothesis is never in a measured state, whatever its source says', () => {
  // measuredPlaneOf() guarded on a value; provenanceOf() dropped the guard when the third state landed. An
  // open hypothesis legitimately keeps `source: 'warehouse:…'`, so the verdict block rendered
  // `[OPEN] [MEASURED · warehouse]` directly above "measured: not measured (needs an eval)".
  const s = measuredSplit([h('h1', null, 'warehouse:analytics_dwd.events')]);
  assert.deepEqual([s.measured, s.total, s.external], [0, 0, 0]);
});

test('a FUTURE-WORK ref is a promise, not evidence — in either measured state', () => {
  // schema.ts's FUTURE_WORK_REF calls these proposed work. A value-bearing hypothesis with `source:
  // 'eval:h1'` is excluded from claim audit as non-resolvable, so it survives claimAuditSurvivors and would
  // have reached the writer stamped as a measurement that happened.
  for (const ref of ['eval:h1', 'proposed:something', 'measurement:h2', 'tbd:later', 'pending:x']) {
    const s = measuredSplit([h('x', 1, ref)]);
    assert.deepEqual([s.measured, s.external], [0, 0], `${ref} must earn no measured state`);
  }
});

test('a MEASURED-BUT-UNDISPOSED row is not counted as a finding', () => {
  // hypothesesToFindings routes it to a CoverageGap, so the banner claiming "N findings measured against
  // your systems" was counting rows that never became findings.
  const open = { id: 'h1', claim: 'c', status: 'open', measurement: { value: 5, evidence: { source: 'warehouse:t' } } } as unknown as Hypothesis;
  assert.deepEqual(measuredSplit([open]), { measured: 0, total: 0, external: 0, planes: [], externalSources: [] });
  // ...but a mitigation settling it makes it a finding, so the exclusion is disposition and not status alone.
  const withMit = measuredSplit([open], [{ hypothesisId: 'h1', supported: true } as never]);
  assert.deepEqual([withMit.measured, withMit.total], [1, 1]);
});

test('the external label NAMES its source instead of guessing', () => {
  // One label said "an eval result or external advisory", which is false for repometa (CI pass rates and PR
  // history via the GitHub metadata API), and the raw source is not otherwise in the verdict material — so
  // the contract told the writer to say what produced the evidence while giving it no way to know.
  assert.equal(externalSourceOf('repometa:owner/repo/ci'), 'repometa');
  assert.equal(externalSourceOf('osv:GHSA-1234'), 'osv');
  assert.equal(externalSourceOf('datapoint:recall_at_50'), 'datapoint');
  assert.equal(externalSourceOf('code:a.ts'), undefined);
  assert.equal(externalSourceOf('eval:h1'), undefined, 'a promise has no external source to name');
});
