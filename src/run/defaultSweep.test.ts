import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SWEEP_BRIEF, hasRealBrief } from './shared.ts';

// run A was steered by an 11-character brief ("jordan test") and spent $55.43 auditing
// the tool's own eval internals. A blank or placeholder brief is not a neutral input — it hands the
// priorities to whichever bundles happened to activate.

test('placeholders and blanks are NOT questions', () => {
  for (const b of [undefined, '', '   ', 'test', 'jordan test', 'testing', 'demo', 'asdf', 'xxxx', 'TBD', 'n/a', 'none', 'check']) {
    assert.equal(hasRealBrief(b), false, JSON.stringify(b));
  }
});

test('a stated concern IS a question and must steer the run', () => {
  assert.equal(hasRealBrief('The team wants to inject search-derived signals into the feed ranker.'), true);
  assert.equal(hasRealBrief('Can you read the entire codebase and examine if anything is critically wrong'), true);
  // The boundary is length, not cleverness — a short but real ask still counts once it is a sentence.
  assert.equal(hasRealBrief('dashboard load is very slow when switching orgs'), true);
});

test('a SHORT precise request is a real question — the length gate is gone', () => {
  // The old rule rejected anything under 24 characters, which threw away
  // exactly the requests worth getting right. It also became load-bearing in a second place once the
  // report's inquiry and answer-back were gated on the same decision — so a short precise ask was not
  // merely unused for steering, it was erased from the report too.
  assert.equal(hasRealBrief('Audit OAuth callbacks'), true, '21 chars, and unambiguous');
  assert.equal(hasRealBrief('Check tenant isolation'), true, '22 chars — and "check" must NOT read as filler');
  assert.equal(hasRealBrief('why is DAU dropping'), true, '19 chars; a short question is still a question');
});

test('a smoke test with a name on it is still a smoke test', () => {
  // The motivating failure. "jordan test" used to be caught by the length gate; with that gone, it has to
  // be caught by SHAPE — a short brief carrying a filler token is a placeholder with a name attached.
  for (const b of ['jordan test', 'testing 123', 'test test test', 'asdf asdf', 'sam test']) {
    assert.equal(hasRealBrief(b), false, JSON.stringify(b));
  }
  // DELIBERATE CONSEQUENCE of the general rule: "demo run" ends in a real noun, so it reads as a request.
  // The rule tests the SHAPE of the phrase, and the shape here is verb-plus-object. This asymmetry is the
  // intended one: accepting an occasional weak brief costs a slightly worse sweep, while rejecting a real
  // one discards the user's actual question AND erases it from the report. Three rounds of review were
  // spent on the second failure mode; none on the first.
  assert.equal(hasRealBrief('demo run'), true, 'ends in an object, so it is treated as a request');
});

test('a single word is a label, not a concern — however meaningful the word', () => {
  for (const b of ['security', 'performance', 'tenancy', 'test', 'x']) {
    assert.equal(hasRealBrief(b), false, JSON.stringify(b));
  }
});

test('a placeholder followed by real text is still real', () => {
  // "test" as a prefix must not disqualify a genuine brief that happens to start with it.
  assert.equal(hasRealBrief('test coverage on the payments service looks thin — can you confirm'), true);
});

test('the sweep is a value-free TAXONOMY, not a list of answers', () => {
  // The anti-reward-hacking line: a default brief naming a company, a product or a known defect would be
  // a stored answer wearing the shape of a question, and it would apply to every future project.
  for (const banned of [/accel-?scope/i, /theresa/i, /bigquery/i, /redis/i, /google/i, /oauth/i]) {
    assert.doesNotMatch(DEFAULT_SWEEP_BRIEF, banned, `names something specific: ${banned}`);
  }
  for (const axis of [/ACCESS AND ISOLATION/, /CORRECTNESS AND DATA TRUST/, /CHANGE SAFETY/, /OPERABILITY AND COST/]) {
    assert.match(DEFAULT_SWEEP_BRIEF, axis);
  }
});

test('the sweep asks for decisions, bounds the claim, and keeps the tool out of its own scope', () => {
  assert.match(DEFAULT_SWEEP_BRIEF, /somebody must DECIDE about/, 'a finding must be actionable, not merely true');
  assert.match(DEFAULT_SWEEP_BRIEF, /only where the connected sources can evidence it/);
  assert.match(DEFAULT_SWEEP_BRIEF, /cannot settle/, 'it must say what it could not reach');
  // The specific failure this exists to stop: 6 of 15 hypotheses auditing the tool's own eval machinery.
  assert.match(DEFAULT_SWEEP_BRIEF, /not spend the sweep on the tool's own internals/);
});

// Borrowed from root-cause debugging practice, which a security taxonomy does not carry. Both earn
// their place from this session: the dev-tools report listed FOUR separate control failures that were
// really four holes in ONE path a change takes to production — a fact only visible once they were drawn
// on one line. And Waggle already mines git history deterministically, but nothing asked the
// investigation to use it.
test('the sweep prefers the cause to the symptom', () => {
  assert.match(DEFAULT_SWEEP_BRIEF, /PREFER THE CAUSE TO THE SYMPTOM/);
  assert.match(DEFAULT_SWEEP_BRIEF, /are one finding about that path, not four/);
  assert.match(DEFAULT_SWEEP_BRIEF, /one layer too high/);
});

test('the sweep reads the change history and knows when to give up', () => {
  assert.match(DEFAULT_SWEEP_BRIEF, /USE THE CHANGE HISTORY/);
  assert.match(DEFAULT_SWEEP_BRIEF, /localises the cause/);
  assert.match(DEFAULT_SWEEP_BRIEF, /three attempts to evidence a suspicion all fail, drop it/, 'do not ship a suspicion');
});

// A fair observation from review: axis 1 used to carry a four-item "give particular
// weight to" list while axes 2-4 were one general sentence each. Nothing in it named a product or a
// number, so it passed the ban-list above — but the asymmetry itself was a thumb on the scale toward the
// finding class this session had already found, which is a subtler form of the same defect. The specifics
// moved to where they belong: they are `saas-tenancy` METRICS (isolation_key_derivation,
// unresolved_principal_disposition, credential_autobind_on_auth, session_identifier_at_rest). A bundle is
// the right home for domain specifics; the default brief is the neutral taxonomy that selects bundles.
test('no axis is weighted more heavily than the others', () => {
  const axes = DEFAULT_SWEEP_BRIEF.match(/^\d\. [A-Z][^\n]*/gm) ?? [];
  assert.equal(axes.length, 4, 'four axes');
  const lengths = axes.map((a) => a.length);
  const ratio = Math.max(...lengths) / Math.min(...lengths);
  assert.ok(ratio < 2.2, `one axis is ${ratio.toFixed(1)}x another — that emphasis steers the sweep: ${JSON.stringify(lengths)}`);
});

test('the sweep does not carry the tenancy bundle\'s specifics as prose', () => {
  // These are metric questions, and a default brief that states them is a stored answer about where to
  // look. The bundle asks them; the brief must not.
  for (const specific of [/keys tenancy/i, /binds credentials/i, /session identifier stays valid/i, /who else can read that store/i]) {
    assert.doesNotMatch(DEFAULT_SWEEP_BRIEF, specific, `belongs to the saas-tenancy bundle, not the brief: ${specific}`);
  }
  // ...but the axis must still ASK the general question, or the trim removed the guidance too.
  assert.match(DEFAULT_SWEEP_BRIEF, /who is refused, on what evidence, and what an unresolved principal gets instead/);
});

// "test" is both the commonest smoke-test marker and an ordinary verb, and the first fix got it wrong in the
// other direction: treating it as filler rejected "Test payment retries", "Test OAuth logout" and "Test
// coverage gaps". The distinction is POSITION, not presence — a smoke test puts the marker last, after a name
// or nothing, because the marker IS the content; a real request leads with it as a verb and names an object.
test('"test" as a VERB leads a real request', () => {
  for (const b of ['Test payment retries', 'Test OAuth logout', 'Test coverage gaps', 'Testing the checkout flow end to end']) {
    assert.equal(hasRealBrief(b), true, JSON.stringify(b));
  }
});

test('"test" TRAILING a name is still a smoke test', () => {
  for (const b of ['jordan test', 'sam test', 'foo test', 'test test test']) {
    assert.equal(hasRealBrief(b), false, JSON.stringify(b));
  }
});

// ── A BRIEF IN AN UNSPACED SCRIPT WAS BEING THROWN AWAY ─────────────────────────────────────────
//
// The token rule is built on whitespace-delimited words and `\w` is ASCII-only, so a brief written in Chinese
// tokenized to NOTHING and was discarded as a placeholder, and one with a single English term kept only that term
// and fell under the two-token floor. Whitespace tokens are not a measure of content in an unspaced script;
// characters are. The fixtures are written as \u escapes.
test('a Chinese request is a real brief', () => {
  for (const b of ['\u8bf7\u68c0\u67e5\u79df\u6237\u9694\u79bb\u662f\u5426\u5b89\u5168', '\u5ba1\u8ba1 OAuth \u56de\u8c03', '\u8fd9\u4e2a\u591a\u4e00\u4e9bhighlight\u548ccolor\u5982\u679c\u6709\u56fe\u66f4\u597d\u4e86', '\u767b\u5f55\u540e\u80fd\u4e0d\u80fd\u8bfb\u5230\u522b\u7684\u79df\u6237\u7684\u6570\u636e']) {
    assert.equal(hasRealBrief(b), true, b);
  }
});

test('a Japanese request is a real brief', () => {
  assert.equal(hasRealBrief('\u8a8d\u8a3c\u30d5\u30ed\u30fc\u3092\u76e3\u67fb\u3057\u3066\u304f\u3060\u3055\u3044'), true);
});

test('but a CJK placeholder is still a placeholder', () => {
  // These three are literally "test" (Simplified / Traditional Chinese, Japanese) — below the floor of four.
  for (const b of ['\u6d4b\u8bd5', '\u6e2c\u8a66', '\u30c6\u30b9\u30c8']) assert.equal(hasRealBrief(b), false, b);
});

test('a mixed-script brief counts its ASCII tokens too', () => {
  // Two CJK characters alone are below the floor, but with a real ASCII phrase alongside it is a request.
  assert.equal(hasRealBrief('\u5ba1\u8ba1 OAuth callback handling'), true);
});
