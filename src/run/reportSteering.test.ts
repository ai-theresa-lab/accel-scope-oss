import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasRealBrief } from './shared.ts';

// Two report-steering bugs found in code review. Both are in executeOrgRun, which is not unit-callable
// (it drives a whole audit), so these tests pin the DECISIONS it makes, by reading the source at the three
// sites the bugs lived at. A source-reading test is weaker than calling the function — it is here because
// the alternative was no test at all on two confirmed bugs, and each assertion names the exact defect.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./execute-org-run.ts', import.meta.url), 'utf8');

test('a placeholder brief does not become the report\'s inquiry', () => {
  // WAS: `brief: run.brief, inquiry: run.brief` unconditionally. So "jordan test" reached the writer under
  // "THE READER'S ORIGINAL REQUEST — your report must ANSWER this, in their framing/order", and the report
  // structured itself around a question the investigation had already rejected and replaced with the sweep.
  assert.match(src, /brief: briefIsReal \? run\.brief : undefined, inquiry: briefIsReal \? run\.brief : undefined/,
    'both the brief and the inquiry must be gated on the SAME decision that gates the investigation');
  assert.doesNotMatch(src, /inquiry: run\.brief\b/, 'an ungated inquiry is the bug');
});

test('an answer-back is only promised when there was a real ask', () => {
  // WAS: `run.brief ? answerBackRows(...)`. Truthiness is the wrong test — "jordan test" is truthy, and the
  // report then rendered a "what you asked us to check" section against an ask nobody made.
  assert.doesNotMatch(src, /answerBack = run\.brief \?/, 'truthiness is not realness');
  assert.match(src, /answerBack = briefIsReal \? answerBackRows/);
  assert.match(src, /hasRealBrief\(run\.brief\) \? answerBackRows/, 'the floor-scan path too');
});

test('systemKind comes from the real classification, never from the display string', () => {
  // WAS: `rzComp?.companyType ?? comp?.companyType`. `compType` is persisted as `companyType`, and compType
  // is NEVER undefined — it falls back to 'manual selection' / 'resumed classification' / '… (keyword)'.
  // On a RESUME those came straight back out of the checkpoint and framed the report as
  // "a READ-ONLY audit of: manual selection". The fresh path was guarded; the resume path was not.
  assert.match(src, /const systemKind: string \| undefined = classification;/);
  assert.match(src, /classification: string \| undefined = rzComp/, 'the real value is resolved once');
  assert.match(src, /companyType: compType, classification,/, 'and persisted SEPARATELY from the display string');
  assert.doesNotMatch(src, /systemKind: string \| undefined = \(rzComp\?\.companyType/, 'the old read is the bug');
  assert.doesNotMatch(src, /systemKind: compType/, "the earlier version, which cannot ever be undefined");
});

test('the display string keeps its fallbacks — the fix separates the two, it does not merge them', () => {
  // compType is still the log/checkpoint display value and SHOULD carry 'manual selection' etc. The bug was
  // using it as the model-facing classification, not its own content.
  assert.match(src, /const compType: string = rzComp \? \(rzComp\.companyType \?\? 'resumed classification'\)/);
  assert.match(src, /'manual selection'/);
});

test('an OLD checkpoint, written before this change, degrades to the safe branch', () => {
  // A resume of a run checkpointed before this change has no `classification` key. That must read as undefined (no framing) rather
  // than falling back to `companyType` — which is precisely the value being avoided.
  assert.match(src, /\(rzComp as \{ classification\?: string \}\)\.classification \?\? undefined/);
});

// hasRealBrief is the single gate all three sites now share, so its own boundary stays pinned here too.
test('the shared gate still rejects the placeholder that caused all of this', () => {
  assert.equal(hasRealBrief('jordan test'), false);
  assert.equal(hasRealBrief('Can you read the entire codebase and examine if anything is critically wrong'), true);
});

test('the provenance banner is on BOTH writer paths, not just the free-vibe one', () => {
  // Code review caught that "unconditional across all arms" was really "…on the vibe path".
  // The fallback is the path a reader is least likely to know they are looking at, so a missing provenance
  // line there is the worst place for it to be missing.
  assert.match(src, /run\.leadershipHtml = injectProvenance\(/, 'the structured fallback injects it too');
  assert.match(src, /measuredSplit\(survivingHyp, survivingMit\)/, 'from the same verdicts AND mitigations the report was written from - the mitigations decide disposition, and an undisposed row is a coverage gap, not a finding');
  assert.doesNotMatch(src, /run\.leadershipHtml = renderRecallReport\(sanitizeReportInput\(leadershipFinal\)\);/,
    'the un-bannered render is the bug');
});
