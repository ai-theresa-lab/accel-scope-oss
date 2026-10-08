import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestPrompt, vibePrompt } from './leadershipVibe.ts';
import { contractFor, BOTTOM_LINE_RULE } from './leadershipContracts.ts';
import type { LeadershipWriterOpts } from './leadershipWriter.ts';

// WHY THIS FILE EXISTS. `v0` is the experiment's control, and a control is worthless if it drifts from
// the branch it claims to reproduce. main moved under this branch: two earlier changes landed the systemKind
// framing, the single BOTTOM_LINE_RULE, the metric cards, the 6-section cap and the THEME bullet on the
// DEFAULT path — several of them fixing defects this branch had independently diagnosed. v0 was
// re-pointed at that text, and these tests hold it there, so a v4-vs-v0 number means "what v4 adds over
// main" rather than "what main already fixed".

const opts = (over: Partial<LeadershipWriterOpts> = {}): LeadershipWriterOpts => ({
  company: 'Acme', scopeDesc: 'repo x', meta: 'm',
  hypotheses: [{ id: 'h1', claim: 'a claim', status: 'supported', measurement: { value: 3 } }] as never,
  mitigations: [], ...over,
});

test('v0 carries the SHARED bottom-line rule — not a copy of it', () => {
  // The defect the shared rule fixed was two hand-copied copies that had already drifted apart. If v0 were to grow
  // its own paraphrase, the experiment would be measuring the paraphrase.
  const c = contractFor('v0');
  assert.ok(BOTTOM_LINE_RULE.length > 500, 'the rule is substantive, so an accidental empty import would be silent');
  assert.ok(c.digestRules.includes(BOTTOM_LINE_RULE), 'v0 digest interpolates the shared rule verbatim');
  assert.ok(c.authorContentBlock.includes(BOTTOM_LINE_RULE), 'v0 author interpolates the same one');
});

test('v4 deliberately SUPERSEDES the shared rule instead of appending it', () => {
  // v4 moves the fix out of the bullet and drops the third bullet's THEME role; the shared rule folds the
  // fix in "if it fits" and makes the third a THEME. Interpolating both would hand the planner two
  // incompatible shapes for one bullet. This test exists so the omission is never "fixed".
  const c = contractFor('v4');
  assert.ok(!c.digestRules.includes(BOTTOM_LINE_RULE), 'v4 must not append the rule it replaces');
  assert.match(c.digestRules, /The FIX is NOT in the bullet/);
  assert.match(c.digestRules, /There is NO aggregated \/ catch-all bullet/);
});

test('v0 keeps main OWN improvements: metric cards, the 6-section cap, no catch-all bullet', () => {
  const c = contractFor('v0');
  assert.match(c.digestRules, /AT MOST 6 SECTIONS/, 'section cap');
  assert.match(c.digestRules, /EVERY SECTION MUST BE LED BY NUMBERS/, 'metric cards');
  assert.match(c.digestRules, /THE LABEL IS THE HARD PART/, 'plain-word labels');
  assert.match(c.digestRules, /a THEME bullet that NAMES the shared weakness/, 'THEME bullet replaced the catch-all');
  assert.doesNotMatch(c.digestRules, /ONE AGGREGATED bullet folding the remaining/, 'catch-all bullet deleted');
});

test('the planner is asked for metrics AND the renderer reads them — neither half is inert', () => {
  // A rule asking for {value,label} cards is inert unless the JSON skeleton offers the field, and the
  // field is inert unless digestBlock renders it. The skeleton lives outside the contract seam, so the
  // seam could silently drop it.
  assert.match(digestPrompt(opts({ variant: 'v0' })), /"metrics":\[\{"value"/);
});

test('systemKind framing reaches BOTH prompts, and absence is a real branch', () => {
  for (const build of [digestPrompt, (o: LeadershipWriterOpts) => vibePrompt(o, null)]) {
    const named = build(opts({ variant: 'v0', systemKind: 'Internal dev-tools / AI engineering' }));
    assert.match(named, /Internal dev-tools \/ AI engineering/);
    const anon = build(opts({ variant: 'v0' }));
    assert.doesNotMatch(anon, /audit of:\s*\./, 'no dangling "of:" when there is no classification');
    assert.doesNotMatch(anon, /recommendation\/data audit\b/, 'the old hardcoded framing must not come back');
  }
});

test('a systemKind is REDACTED before it reaches a prompt, on every arm', () => {
  // The seam moved the interpolation from the call site (where it used to be redacted) into the contract, so each
  // opening now owns redaction. comprehend's companyType is model-written text about the audited system.
  for (const variant of ['v0', 'v4'] as const) {
    const p = digestPrompt(opts({ variant, systemKind: 'a service using key sk-ant\x2dapi03-AAAABBBBCCCCDDDDEEEEFFFF' }));
    assert.doesNotMatch(p, /sk-ant\x2dapi03-AAAABBBBCCCCDDDDEEEEFFFF/, `${variant} leaked a secret into the prompt`);
  }
});

// ── THE CONTROL'S ACTUAL CLAIM: BYTES, NOT PHRASES ──────────────────────────────────────────────
//
// Code review made the point, and it was right: the tests above pin PHRASES, while
// the claim is byte identity of the ASSEMBLED prompt. Shared material outside LeadershipContract —
// verdictMaterial, the JSON skeleton, digestBlock, FREE_VIBE_CONTRACT — can move either v0 prompt while
// every phrase assertion stays green.
//
// Two tests, because the claim has two halves with different lifetimes:
//
//   1. A HASH, pinning the exact bytes v0 rendered at the merge point, verified against
//      `origin/main`'s own leadershipVibe.ts at f0f641b (all four hashes matched exactly).
//      This is the historical control verification, and it is EXPECTED to need regeneration when
//      shared prompt material legitimately changes — see the note on the test.
//   2. A STRUCTURAL invariant that does NOT rot: v0 and v4 must differ ONLY in their contract blocks.
//      That is the property a golden fixture is really protecting, and unlike frozen bytes it keeps
//      holding as the shared scaffolding evolves.

import { createHash } from 'node:crypto';

// The one documented exception to byte identity: the provenance tag is stamped into the verdict material
// on EVERY arm, control included, because gating it to v4 would have made it inert on the default path.
const stripProvenanceTags = (s: string): string => s.replace(/\[(?:MEASURED · [^\]]+|READ FROM CODE)\] /g, '');
const digest16 = (s: string): string => createHash('sha256').update(stripProvenanceTags(s), 'utf8').digest('hex').slice(0, 16);

// Frozen opts — the hashes below are only meaningful against exactly these.
const controlOpts = (systemKind?: string): LeadershipWriterOpts => ({
  company: 'Control', scopeDesc: 'the system under audit', meta: '2020-01-01',
  hypotheses: [{ id: 'h1', claim: 'a claim', status: 'supported', measurement: { value: 3, note: 'n' } }] as never,
  mitigations: [{ hypothesisId: 'h1', supported: true, lever: 'do the thing' }] as never,
  inquiry: 'why is x slow', brief: 'b', answerBack: [{ status: 'supported', concern: 'c' }] as never,
  systemKind, variant: 'v0',
});

test('v0 is byte-STABLE, and the exact ways it diverges from main are enumerated', () => {
  // CORRECTION to an earlier claim. v0 was once described as
  // "byte-identical to origin/main", and the verification behind it was weaker than the claim: it rendered
  // main's leadershipVibe.ts against THIS branch's reportContract.ts, so changes to the SHARED
  // FREE_VIBE_CONTRACT cancelled out on both sides and were never compared. What was actually verified is
  // that v0's CONTRACT BLOCKS and the prompt ASSEMBLY are main's, byte-for-byte — which the tests above
  // pin directly, and which is the part the variant seam could have broken.
  //
  // v0's rendered prompt deliberately differs from main's in exactly two ways, both SHARED by every arm
  // and every report (area reports included), neither belonging to a variant:
  //   1. the provenance tag in the verdict material (normalized out below);
  //   2. the FREE_VIBE_CONTRACT chart rules — "WHEN NOT TO DRAW ONE" — plus the reconciliation of the
  //      "every comparing section carries a chart / no chart has failed" rule, which CONTRADICTED them.
  //   3. the language rule moved INTO the shared contract, and the slash-joined two-language "Bottom line"
  //      card title was removed from every prompt that instructed it. The author hashes moved when that
  //      landed; the digest hashes did not, because the change is author-side only.
  //      Code review found that contradiction: under both instructions at once the author must break one, and
  //      the tempting repair is to invent a third value so a two-value comparison earns its chart. In an
  //      audit that is a fabricated number. The shared rule now defers to the three-value floor and says
  //      outright never to invent a value to earn a chart.
  //
  //   4. the report UX pass: the verdict material gains a derived "evidence tier:" line (and an
  //      "effort:" line only when the material carries one) — so BOTH digest and author hashes moved — and the
  //      author prompt gains the shared LEADERSHIP_SHAPE_BRIEF (headline length, numbers-once, tier badge,
  //      effort, chart takeaway + role="img"). Shared by every arm, not a variant.
  //
  //   5. ENGLISH-ONLY REPORTS: the shared FREE_VIBE_CONTRACT / glossary switched to one English rendering with no
  //      language toggle, and the per-arm language lines were dropped — so BOTH digest and author hashes moved.
  //      Shared by every arm and every report, not a variant.
  //   6. OPEN-SOURCE CLEANUP: the language machinery was removed outright — the glossary lists English terms only,
  //      the vocabulary-rule examples are English, the per-arm language lines and the second-language budget are
  //      gone — so BOTH digest and author hashes moved. Shared by every arm, not a variant.
  //   7. BRAND + NEUTRAL WORDING: the shared house-style block names the product as Waggle, and the shared
  //      prompt text speaks of the user rather than a client — author hashes only. Shared by every arm.
  //
  // So this test is a STABILITY pin, not an identity proof: it catches an unintended change to either v0
  // prompt, including one arriving through shared material. IF IT FAILS: work out which of the two lists
  // above you have extended, confirm it is intended and shared-by-design rather than a variant leaking
  // into the control, then update the hash. Never update it just to make a red test green.
  //      The vibe author prompt's own opening line now says "English business report" — author
  //      hashes only.
  //    · The product was renamed (the house-style brand line names it) — author hashes only.
  const expected = {
    nokindDigest: 'ff70f4448d7fb9af', nokindAuthor: 'ba26e467b7e28784',
    kindDigest: '60628c39c88d9b18', kindAuthor: '29c64adcbbaeec67',
  };
  const kind = 'Internal dev-tools / AI engineering';
  assert.equal(digest16(digestPrompt(controlOpts())), expected.nokindDigest, 'digest prompt, no classification');
  assert.equal(digest16(vibePrompt(controlOpts(), null)), expected.nokindAuthor, 'author prompt, no classification');
  assert.equal(digest16(digestPrompt(controlOpts(kind))), expected.kindDigest, 'digest prompt, classified');
  assert.equal(digest16(vibePrompt(controlOpts(kind), null)), expected.kindAuthor, 'author prompt, classified');
});

test('the chart rules do not contradict each other — an author is never forced to invent a value', () => {
  // The defect code review found: one shared rule demanded a chart for anything that compares, another forbade
  // a chart under three values, and both shipped in the same prompt. A rule set that cannot be satisfied
  // is worse than either rule alone, because the model resolves it by inventing data.
  const authored = vibePrompt(controlOpts(), null);
  assert.match(authored, /ACROSS THREE OR MORE VALUES carries a CHART/, 'the demand is bounded by the floor');
  assert.match(authored, /A CHART NEEDS AT LEAST 3 COMPARED VALUES/, 'and the floor is still stated');
  assert.match(authored, /NEVER invent a value to earn one/, 'the escape hatch is closed explicitly');
  assert.doesNotMatch(authored, /anything carries a CHART/, 'the unconditional form must not come back');
  // "no chart at all has failed" must never appear unqualified — that is the sentence that did the pushing.
  assert.doesNotMatch(authored, /A report with no chart at all has failed/);
  // Both arms are governed, since the rule is shared and neither contract restates it.
  for (const variant of ['v0', 'v4'] as const) {
    const p = vibePrompt({ ...controlOpts(), variant }, null);
    assert.match(p, /NEVER invent a value to earn one/, `${variant} must carry the reconciled rule`);
  }
});

test('v0 and v4 differ ONLY in their contract blocks — the scaffolding is genuinely shared', () => {
  // This is the rot-free half. Swap v0's contract text for v4's inside v0's RENDERED prompt; if the
  // scaffolding is shared, the result must equal v4's rendered prompt exactly. Any shared-material
  // change that reaches one arm and not the other breaks this, whatever the hashes say.
  const v0c = contractFor('v0'), v4c = contractFor('v4');
  for (const kind of [undefined, 'Internal dev-tools / AI engineering']) {
    const o0 = { ...controlOpts(kind), variant: 'v0' as const };
    const o4 = { ...controlOpts(kind), variant: 'v4' as const };

    const swapped = digestPrompt(o0)
      .replace(v0c.digestOpening(kind), v4c.digestOpening(kind))
      .replace(v0c.digestRules, v4c.digestRules);
    assert.equal(swapped, digestPrompt(o4), `digest scaffolding diverged (kind=${kind ? 'set' : 'unset'})`);

    let authorSwapped = vibePrompt(o0, null)
      .replace(v0c.authorOpening(kind), v4c.authorOpening(kind))
      .replace(v0c.authorContentBlock, v4c.authorContentBlock);
    // v4 also APPENDS a style block; v0 has none, so account for it rather than pretending it is shared.
    if (v4c.styleBlock) authorSwapped = `${authorSwapped}\n\n${v4c.styleBlock}`;
    assert.equal(authorSwapped, vibePrompt(o4, null), `author scaffolding diverged (kind=${kind ? 'set' : 'unset'})`);
  }
});
