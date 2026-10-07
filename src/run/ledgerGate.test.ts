import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerMergeDecision } from './ledgerGate.ts';

// A real run: 53 findings were merged into the org's findings ledger although the run's
// "Save learnings to org memory" (formerly "Draft memory from reports") tick was OFF. The merge is now gated on that opt-in and a skip is logged.

test('no memory-write opt-in ⇒ no ledger merge, and the skip is disclosed', () => {
  for (const run of [{}, { writeMemory: false }]) {
    const d = ledgerMergeDecision(run, 53);
    assert.equal(d.merge, false);
    assert.match(d.log ?? '', /findings ledger: not updated/);
    assert.match(d.log ?? '', /53 finding\(s\) not recorded/);
  }
  assert.doesNotMatch(ledgerMergeDecision({}, 0).log ?? '', /not recorded/);
});

test('explicit opt-in ⇒ merge, no skip line', () => {
  assert.deepEqual(ledgerMergeDecision({ writeMemory: true }, 5), { merge: true });
});
