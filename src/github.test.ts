import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFailureReason, probeRepoAccess } from './github.ts';

// The clone loop used to swallow git's stderr, so a repo the clone credential could not reach surfaced only as
// "Nothing analyzed — select at least one repository". gitFailureReason is what now reaches the run log.

test('gitFailureReason keeps git stderr, spells out the HTTP status, and never echoes the argv', () => {
  const e = Object.assign(new Error('Command failed: git -c credential.helper= clone https://github.com/o/r.git /tmp/x\nfatal: unable to access'), {
    stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found\n",
  });
  const r = gitFailureReason(e);
  assert.match(r, /^HTTP 404/);
  assert.match(r, /Repository not found/);
  assert.doesNotMatch(r, /Command failed/);
});

test('gitFailureReason extracts an explicit status code and scrubs the token', () => {
  const tok = 'ghp_SECRETSECRET';
  const e = { stderr: `fatal: unable to access 'https://x-access-token:${tok}@github.com/o/r.git/': The requested URL returned error: 403` };
  const r = gitFailureReason(e, tok);
  assert.match(r, /^HTTP 403/);
  assert.ok(!r.includes(tok), 'token must be scrubbed');
  assert.match(r, /\*\*\*/);
});

test('gitFailureReason maps a disabled-prompt auth failure to 401, a kill to a timeout, and falls back to message', () => {
  assert.match(gitFailureReason({ stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }), /^HTTP 401/);
  assert.equal(gitFailureReason({ killed: true, signal: 'SIGTERM' }), 'timed out reaching the remote');
  assert.equal(gitFailureReason(new Error('Command failed: git ls-remote x\nsomething odd')), 'something odd');
  assert.equal(gitFailureReason({}), 'git exited without an error message');
});

test('probeRepoAccess: a reachable repo is ok, a missing one fails with a reason (never throws)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-probe-'));
  try {
    const repo = join(dir, 'r');
    execFileSync('git', ['init', '-q', repo]);
    writeFileSync(join(repo, 'a.txt'), 'x');
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.']);
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
    assert.deepEqual(await probeRepoAccess(repo, undefined), { ok: true });
    const miss = await probeRepoAccess(join(dir, 'nope'), undefined);
    assert.equal(miss.ok, false);
    assert.ok(!miss.ok && miss.reason.length > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
