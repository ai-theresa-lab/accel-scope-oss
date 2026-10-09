import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfDeclaredNonDefect } from './deep.ts';

test('a measurement that calls itself intended or documented behaviour is recognised; negations are not', () => {
  for (const t of [
    'documented intended behavior with an opt-in rejectOnClear path that rejects them, not a defect.',
    'a documented known-limitation (index.d.ts:22), not a defect',
    'a structural consequence of the runtime, not a correctness defect',
    'By design: the queue is unbounded',
    'a documented design trade-off that the opt-in resolves',
  ]) assert.equal(selfDeclaredNonDefect([t]), true, t);
  for (const t of [
    '0 delete calls on the expiry path — the map grows forever',
    'this is not by design; nothing documents it',
    'the code is not intended behaviour per the README',
    'a real bug: get() never deletes',
    undefined,
  ]) assert.equal(selfDeclaredNonDefect([t]), false, String(t));
});
