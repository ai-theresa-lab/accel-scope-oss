import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hypTitle } from './deep.ts';

// the internal report's synthesis showed titles cut mid-word with no ellipsis.
test('hypTitle: an over-long claim is cut on a word boundary with an ellipsis', () => {
  const claim = 'API_KEY is a hardcoded, exported credential literal in source (a.ts:7) with no in-repo runtime resolution path, env lookup or secret-manager fallback anywhere';
  const t = hypTitle(claim);
  assert.ok(t.endsWith('…'), t);
  assert.ok(t.length <= 97, t);
  assert.ok(claim.startsWith(t.slice(0, -1)), 'a prefix of the claim');
  assert.match(claim.slice(t.length - 1), /^\s/, 'the cut falls between words');
});

test('hypTitle: a usable first clause and a short claim are kept whole', () => {
  assert.equal(hypTitle('The published start script executes eval on config. More detail follows here.'), 'The published start script executes eval on config');
  assert.equal(hypTitle('Short claim.'), 'Short claim');
});
