import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GhRepo } from '../github.ts';
import { markCloneable, nothingAnalyzedMessage, resolveSelectedRepos } from './workspaceAccess.ts';

// A real run: every selected repo failed to clone (the listing and the clone used different
// credentials), git's 401/404 was dropped, and the run told the user to "select at least one repository".

const repo = (fullName: string): GhRepo => ({ fullName, cloneUrl: `https://github.com/${fullName}.git`, private: true, defaultBranch: 'main', pushedAt: '' });

test('all targets unreachable ⇒ an accurate "could not access N selected repo(s)" message, never "select at least one"', () => {
  const msg = nothingAnalyzedMessage([
    { name: 'org/a', kind: 'repo', reason: 'HTTP 404 (repository not found, or the credential cannot see it) — remote: Repository not found.' },
    { name: 'org/b', kind: 'repo', reason: 'HTTP 403 — The requested URL returned error: 403' },
  ]);
  assert.match(msg, /could not access 2 selected repo\(s\): org\/a \(HTTP 404/);
  assert.match(msg, /org\/b \(HTTP 403/);
  assert.doesNotMatch(msg, /select at least one/);
});

test('nothingAnalyzedMessage keeps the old wording only when nothing was attempted, and bounds a long list', () => {
  assert.match(nothingAnalyzedMessage([]), /select at least one repository/);
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `org/r${i}`, kind: 'repo' as const, reason: 'HTTP 404' }));
  const m = nothingAnalyzedMessage(many);
  assert.match(m, /could not access 8 selected repo\(s\)/);
  assert.match(m, /and 3 more/);
  assert.match(nothingAnalyzedMessage([{ name: 'up', kind: 'folder', reason: 'copied empty' }]), /1 selected folder\(s\)/);
});

test('resolveSelectedRepos reports a selected repo the listing does not carry (it used to vanish silently)', () => {
  const { targets, notListed } = resolveSelectedRepos([repo('org/a'), repo('org/b')], ['org/a', 'org/ghost', 'org/a']);
  assert.deepEqual(targets.map((r) => r.fullName), ['org/a']);
  assert.equal(notListed.length, 1);
  assert.equal(notListed[0].name, 'org/ghost');
  assert.match(notListed[0].reason, /not in the connected GitHub source/);
});

test('markCloneable records the pre-flight outcome per repo (false + reason, true clears a stale failure)', () => {
  const list = [repo('org/a'), repo('org/b'), repo('org/c')];
  list[1].cloneable = false; list[1].cloneError = 'old';
  const n = markCloneable(list, new Map([['org/a', 'HTTP 404 — nope'], ['org/b', null]]));
  assert.equal(n, 2);
  assert.equal(list[0].cloneable, false);
  assert.equal(list[0].cloneError, 'HTTP 404 — nope');
  assert.equal(list[1].cloneable, true);
  assert.equal(list[1].cloneError, undefined);
  assert.equal(list[2].cloneable, undefined, 'an unprobed repo stays unmarked');
});
