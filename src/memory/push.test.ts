import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryPush, currentMemoryPush, nodeIsMemoryEligible } from './push.ts';

test('withMemoryPush scopes the push-core; outside scope is undefined', () => {
  assert.equal(currentMemoryPush(), undefined);
  withMemoryPush('CORE', () => assert.equal(currentMemoryPush(), 'CORE'));
  assert.equal(currentMemoryPush(), undefined);
});

test('blank push-core is a no-op (never opens a scope)', () => {
  withMemoryPush('', () => assert.equal(currentMemoryPush(), undefined));
  withMemoryPush('   ', () => assert.equal(currentMemoryPush(), undefined));
});

test('toolFree nodes are memory-free; investigate + unlabeled are eligible', () => {
  assert.ok(nodeIsMemoryEligible('investigate'));
  assert.ok(nodeIsMemoryEligible(undefined));
  for (const free of ['report-qc', 'claim-audit', 'synthesis-claim-audit', 'leadership-writer', 'area-report', 'vibe-html', 'red-team', 'preflight']) {
    assert.ok(!nodeIsMemoryEligible(free), `${free} must be memory-free`);
  }
});
