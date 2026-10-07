import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBudgetSkip, BUDGET_SKIP_MARKER, isAuthError, withinDir } from './agent.ts';

// writableCwd (HTML-writer) safety: Write/Edit are confined to the scratch cwd by withinDir. This is the security boundary
// that keeps a writer from touching the scanned repo / credentials, so it must reject the classic escapes: parent-escape (..), absolute paths elsewhere, and the PREFIX TRICK (/scratch vs /scratch0). rootReal mirrors
// runAgent (realpathSync(cwd)) so symlinked tmp roots compare consistently.
test('withinDir confines writes to the scratch root — blocks parent/absolute/prefix-trick escapes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-')));
  assert.equal(withinDir(join(root, 'report.html'), root), true, 'a file directly in the scratch dir is allowed (created by Write)');
  assert.equal(withinDir(join(root, 'sub/deep.html'), root), true, 'a nested path under scratch is allowed');
  assert.equal(withinDir('', root), true, 'no path → defaults to cwd, safe');
  assert.equal(withinDir(join(root, '../escape.html'), root), false, 'parent-escape is blocked');
  assert.equal(withinDir('/etc/passwd', root), false, 'an absolute path outside scratch (a credential / the repo) is blocked');
  const sibling = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-'))) ; // a different scratch dir
  assert.equal(withinDir(join(sibling, 'x.html'), root), false, 'a sibling scratch dir is not within this root');
  const prefix = root + '0';   // PREFIX TRICK: name has `root` as a string prefix
  mkdirSync(prefix, { recursive: true });
  assert.equal(withinDir(join(prefix, 'x.html'), root), false, 'a prefix-overlapping sibling must NOT count as within (no startsWith bug)');
});

// Contract the verify step (and any fail-open-KEEP consumer) relies on: a run the budget envelope
// declined to START is distinguishable from a genuine agent error / unparseable reply, so adversarial
// consumers can fail CLOSED on it instead of fail-open keeping an unverified claim.
test('isBudgetSkip detects the leaf-gate budget-skip marker only', () => {
  assert.equal(isBudgetSkip({ error: `${BUDGET_SKIP_MARKER} (>=80%)` }), true);
  assert.equal(isBudgetSkip({ error: 'maxTurns reached' }), false, 'a real agent error is not a budget skip');
  assert.equal(isBudgetSkip({ error: '' }), false);
  assert.equal(isBudgetSkip({}), false, 'a successful run is not a budget skip');
  assert.equal(isBudgetSkip(null), false);
  assert.equal(isBudgetSkip(undefined), false);
});

// Contract the Analyst loop relies on: a hard auth failure (dead BYO credential) must be
// distinguishable from a transient error, so the loop can re-throw the former (run-stopping) while still
// fail-opening on the latter. Anchored to auth signals — must NOT match maxTurns / 429 / 5xx / timeout.
test('isAuthError flags credential failures only, not transient errors', () => {
  for (const m of ['401 Unauthorized', 'HTTP 403', 'authentication_error', 'authentication failed',
    'invalid api key', 'invalid_api_key', 'invalid x-api-key', 'invalid bearer token', 'unauthorized',
    'oauth token expired', 'oauth credential revoked']) {
    assert.equal(isAuthError(m), true, `should flag: ${m}`);
  }
  for (const m of ['maxTurns reached', 'rate limited: 429', '500 internal server error', '503 unavailable',
    'request timeout', 'ECONNRESET', 'overloaded_error', '']) {
    assert.equal(isAuthError(m), false, `should NOT flag (transient): ${m}`);
  }
});
