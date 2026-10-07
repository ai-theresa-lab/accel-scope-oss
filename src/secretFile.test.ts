import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSecretFile } from './secretFile.ts';

test('writeSecretFile writes atomically and leaves no temp file', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'secret-')), 'sub', 'keys.json');
  writeSecretFile(p, '{"a":1}');
  assert.equal(readFileSync(p, 'utf8'), '{"a":1}');
  assert.equal(existsSync(p + '.tmp'), false);
  writeSecretFile(p, '{"a":2}');
  assert.equal(readFileSync(p, 'utf8'), '{"a":2}', 'overwrites');
});

test('only the current user can read the file (POSIX mode 0600 / Windows ACL)', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'secret-')), 'keys.json');
  writeSecretFile(p, 'x');
  if (process.platform !== 'win32') {
    assert.equal(statSync(p).mode & 0o777, 0o600);
    return;
  }
  const acl = execFileSync('icacls', [p], { encoding: 'utf8' });
  const entries = acl.split(/\r?\n/).map((l) => l.replace(p, '').trim()).filter((l) => /:\(/.test(l));
  assert.equal(entries.length, 1, `exactly one ACL entry, got:\n${acl}`);
  assert.match(entries[0], new RegExp(`${process.env.USERNAME}:\\(F\\)`, 'i'));
  assert.doesNotMatch(acl, /\(I\)/, 'no inherited entries');
});
