import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBLEM_PATTERNS, patternsFor, renderPatterns, recallSourceIncrementalValue } from './patterns.ts';
import { recsysMle, mergedPatterns } from './experts.ts';

test('patternsFor matches recsys signals and ignores unrelated text', () => {
  assert.ok(patternsFor('two-tower retrieval with a faiss recall source').some((p) => p.id === 'recall-source-incremental-value'));
  assert.deepEqual(patternsFor('a generic crud backend with a postgres db'), []);
});

test('renderPatterns is empty for no patterns and value-free framing otherwise', () => {
  assert.equal(renderPatterns([]), '');
  const out = renderPatterns([recallSourceIncrementalValue]);
  assert.match(out, /SEED PATTERNS/);
  assert.match(out, /questions \+ nulls, never/);          // explicitly NOT findings
  assert.match(out, /ablation/i);                           // the decisive keep/cut test surfaces
  assert.match(out, /incremental value/i);
});

test('every pattern is a question + a null, carrying no expected number', () => {
  for (const p of PROBLEM_PATTERNS) {
    assert.ok(p.question.trim() && p.decisiveTest.trim() && p.why.trim());
    assert.ok(p.appliesWhen.length > 0);
    // value-free: NO literal percentage or decimal magnitude (e.g. 50%, 0.05, a bare 0.5, Gini 0.7)
    // baked into ANY string field — the contract is "no project numbers anywhere", not just decisiveTest.
    for (const f of [p.title, p.smell, p.question, p.decisiveTest, p.why]) {
      assert.doesNotMatch(f, /\d+(\.\d+)?\s*%|\d\.\d+/);
    }
  }
});

test('recsys bundle primes the recall-source seed pattern', () => {
  const ids = mergedPatterns([recsysMle]).map((p) => p.id);
  assert.ok(ids.includes('recall-source-incremental-value'));
  assert.deepEqual(mergedPatterns([]), []);
});
