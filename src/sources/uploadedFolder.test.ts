import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadRelPaths, writeUploadedFiles } from './uploadedFolder.ts';

// An uploaded `accel-scope` folder was scanned as `accel-scope/accel-scope/src/…`, because the
// browser's webkitRelativePath carries the picked folder's name and the writer kept it.

test('the shared leading segment equal to the folder name is stripped', () => {
  assert.deepEqual(uploadRelPaths(['accel-scope/package.json', 'accel-scope/src/server.ts', 'accel-scope\\.github\\workflows\\ci.yml'], 'accel-scope'),
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
      { path: 'accel-scope/package.json', content: '{}' },
      { path: 'accel-scope/src/server.ts', content: 'x' },
      { path: 'accel-scope/../escape.txt', content: 'no' },
    ], 'accel-scope');
    assert.equal(n, 2);
    assert.equal(readFileSync(join(base, 'package.json'), 'utf8'), '{}');
    assert.ok(existsSync(join(base, 'src', 'server.ts')));
    assert.ok(!existsSync(join(base, 'accel-scope')), 'no nested folder-name level');
    assert.ok(!existsSync(join(base, '..', 'escape.txt')));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
