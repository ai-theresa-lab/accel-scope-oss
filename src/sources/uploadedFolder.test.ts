import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadRelPaths, writeUploadedFiles } from './uploadedFolder.ts';

// An uploaded `Waggle` folder was scanned as `Waggle/Waggle/src/…`, because the
// browser's webkitRelativePath carries the picked folder's name and the writer kept it.

test('the shared leading segment equal to the folder name is stripped', () => {
  assert.deepEqual(uploadRelPaths(['Waggle/package.json', 'Waggle/src/server.ts', 'Waggle\\.github\\workflows\\ci.yml'], 'Waggle'),
    ['package.json', 'src/server.ts', '.github/workflows/ci.yml']);
});

test('no strip unless EVERY path shares that exact first segment', () => {
  assert.deepEqual(uploadRelPaths(['src/a.ts', 'src/b.ts'], 'proj'), ['src/a.ts', 'src/b.ts'], 'a common subdir that is not the folder name stays');
  assert.deepEqual(uploadRelPaths(['proj/a.ts', 'README.md'], 'proj'), ['proj/a.ts', 'README.md'], 'mixed roots stay as-is');
  assert.deepEqual(uploadRelPaths(['proj'], 'proj'), ['proj'], 'a bare file named like the folder is not stripped to empty');
});

test('traversal / empty / NUL paths are rejected (index-aligned null) and do not block the strip', () => {
  assert.deepEqual(uploadRelPaths(['proj/a.ts', 'proj/../../etc/passwd', '', 'proj/x\0y', '/proj/b.ts'], 'proj'), ['a.ts', null, null, null, 'b.ts']);
});

test('writeUploadedFiles lands the folder at the snapshot root and never escapes the base', () => {
  const base = mkdtempSync(join(tmpdir(), 'upl-'));
  try {
    const n = writeUploadedFiles(base, [
      { path: 'Waggle/package.json', content: '{}' },
      { path: 'Waggle/src/server.ts', content: 'x' },
      { path: 'Waggle/../escape.txt', content: 'no' },
    ], 'Waggle');
    assert.equal(n, 2);
    assert.equal(readFileSync(join(base, 'package.json'), 'utf8'), '{}');
    assert.ok(existsSync(join(base, 'src', 'server.ts')));
    assert.ok(!existsSync(join(base, 'Waggle')), 'no nested folder-name level');
    assert.ok(!existsSync(join(base, '..', 'escape.txt')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
