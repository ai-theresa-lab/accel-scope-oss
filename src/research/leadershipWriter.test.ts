import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soften, firstSentence, planeDisplayName, planeDisplayList } from './leadershipWriter.ts';
import { injectProvenance } from './leadershipVibe.ts';

test('soften strips the code-token shapes a leadership reader must never see', () => {
  // snake_case
  assert.equal(soften('the two_tower_recall source'), 'the two tower recall source');
  // camelCase
  assert.match(soften('logQWeight is high'), /log\s?Q\s?Weight/);
  assert.ok(!/[a-z][A-Z]/.test(soften('userTowerCone drift')), 'no lowercase→Uppercase seam left');
  // file extension dropped
  assert.equal(soften('see default.json now'), 'see default now');
  // dotted code identifier split (but real abbreviations untouched)
  assert.equal(soften('reads dataset.events daily'), 'reads dataset events daily');
  assert.equal(soften('e.g. this'), 'e.g. this');               // 1–2 char sides not split
  // metric @
  assert.match(soften('recall@K proxy'), /recall at K/);
});

test('firstSentence returns a COMPLETE sentence — never a mid-word truncation', () => {
  const long = 'The deployed correction is over-applied at five times the documented strength, de-ranking popular items, and this hurts engagement across the board over a long tail of cases.';
  const out = firstSentence(long);
  assert.ok(out.endsWith('.'), 'ends at a sentence boundary');
  assert.ok(!/\b(streng|popula|engagem)$/.test(out), 'no mid-word cut');
  // softens inside the sentence too
  assert.ok(!soften('foo_bar baz.').includes('foo_bar'));
  // a sentence ends at . ! ? followed by whitespace
  assert.equal(firstSentence('First one! Second one.'), 'First one!');
});

// "1 measured via repometa rather than a live query" shipped in the leadership meta line.
test('the grey provenance banner is not written — the brief is returned unchanged, no codename can leak', () => {
  const src = '<html><body><p>x</p></body></html>';
  const html = injectProvenance(src, '2026-09-25', 'jdoe', { measured: 1, total: 3, external: 1, planes: ['acmedash'], externalSources: ['repometa'] });
  assert.equal(html, src);
  assert.doesNotMatch(html, /repometa|acmedash|Generated/);
});

test('planeDisplayName maps every known plane token and de-duplicates shared phrases', () => {
  assert.equal(planeDisplayName('repometa'), 'repository metadata');
  assert.equal(planeDisplayName('REPOMETA'), 'repository metadata');
  assert.equal(planeDisplayName('osv'), 'the OSV vulnerability database');
  assert.deepEqual(planeDisplayList(['datapoint', 'datapoints', 'redis']), ['recorded evaluation results', 'the live key-value store']);
  for (const t of ['repometa', 'osv', 'advisory', 'datapoint', 'codeintel', 'warehouse', 'redis', 'custom_mcp']) assert.doesNotMatch(planeDisplayName(t), /_|repometa|codeintel/);
});

// ── structured-path SOFT checks (headline length + card numbers restated) ──
import { leadershipDraftChecks } from './leadershipWriter.ts';
test('leadershipDraftChecks flags a long title and a card number restated more than once', () => {
  assert.deepEqual(leadershipDraftChecks({ title: 'The audit cannot certify itself', bottomLine: 'Correction is 5x.', cards: [{ v: '5x', label: 'x' }], sections: [] }), []);
  const f = leadershipDraftChecks({
    title: 'The pipeline has no merge gate and scores itself with two yardsticks that disagree on the same run',
    bottomLine: 'Correction is 5x its documented setting.', cards: [{ v: '5x', label: 'x' }],
    sections: [{ n: '01', heading: 'h', body: 'Applied 5x.' }],
  });
  assert.deepEqual(f.map((x) => x.id).sort(), ['HEADLINE', 'KPIREPEAT']);
  assert.ok(f.every((x) => x.severity === 'SOFT'));
});

// Test-run fixes (sindresorhus/ky, 2026-09-27): the deterministic answer-back is leadership copy, not a dump.
import { deterministicAnswerBack } from './leadershipWriter.ts';
test('soften keeps product names whole; firstSentence does not cut inside tokens', () => {
  assert.equal(soften('a TypeScript client on GitHub and macOS; logQWeight'), 'a TypeScript client on GitHub and macOS; log QWeight');
  assert.equal(firstSentence('The merge path in v2.0.0 drops headers. Second.'), 'The merge path in v2.0.0 drops headers.');
  assert.equal(firstSentence('Retry delay uses Date.now wrongly. More.'), 'Retry delay uses Date now wrongly.');
  const long = firstSentence('word '.repeat(80));
  assert.ok(long.length <= 182 && long.endsWith('…'), long);
});
test('deterministicAnswerBack: no next-test plumbing, budget-skipped rows counted not listed, capped lists', () => {
  const rows = [
    { id: 'a', status: 'supported' as const, concern: 'The release build is not a pure function of the tag.', testedVia: 'repometa' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'u' + i, status: 'unsettled' as const, concern: `Open question ${i} about \`src/x${i}.ts\`.`, testedVia: '', nextDecisiveTest: 'On the clone: `git log --follow` …' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'b' + i, status: 'unsettled' as const, concern: `Skipped ${i}.`, testedVia: '', nextDecisiveTest: 'Fix the plan (exceeds the per-bundle hypothesis cap (3)), then run: …' })),
  ];
  const ab = deterministicAnswerBack({ answerBack: rows, brief: 'Assess the release process.' } as never)!;
  assert.ok(ab);
  assert.doesNotMatch(ab, /next test:|git log|hypothesis cap|Fix the plan/);
  assert.match(ab, /You asked us to focus on: Assess the release process\./);
  assert.match(ab, /5 questions are still open/);
  assert.match(ab, /and 2 more/);
  assert.match(ab, /4 further questions were not examined within this run's budget/);
  assert.doesNotMatch(ab, /\.\./);
  assert.equal(deterministicAnswerBack({ answerBack: [] } as never), undefined, 'no rows → no answer-back');
});

// The deterministic fallback badges each item with its evidence tier and carries no recsys title.
import { fallbackReport } from './leadershipWriter.ts';
test('the deterministic leadership fallback labels items Measured / Read from code / Needs a test', () => {
  const hyp = (id: string, status: string, measurement?: Record<string, unknown>) => ({ id, claim: `Claim ${id} holds.`, status, measurement }) as never;
  const r = fallbackReport({
    company: 'Acme', scopeDesc: 'scope', meta: '', mitigations: [],
    hypotheses: [hyp('h1', 'supported', { value: '12%', source: 'warehouse: SELECT 1' }), hyp('h2', 'supported', { value: '3 call sites', source: 'src/a.ts:10' }), hyp('h3', 'blocked-need-eval')],
  });
  const body = r.sections.map((s) => s.body).join(' ');
  assert.match(body, /Claim h1 holds\. \[Measured: 12%\]\./);
  assert.match(body, /Claim h2 holds\. \[Read from code: 3 call sites\]\./);
  assert.match(body, /Claim h3 holds\. \[Needs a test\]\./);
  assert.equal(r.title, 'Acme — review');
});
