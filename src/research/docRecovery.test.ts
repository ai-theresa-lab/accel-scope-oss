import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSpine, repoNameOf } from './docRecovery.ts';
import { historyFragmentHtml } from '../executionAppendix.ts';

// Build a throwaway git repo with a controlled history: two phases (a >21d gap), a dead-end cluster (a dir of
// files added then deleted, absent from HEAD), a revert commit, and a planted secret in a commit subject.
// No real project data — everything invented (Non-Negotiable #6).
function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docrec-git-'));
  const G = (args: string[], date?: string) => execFileSync('git', ['-C', dir, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'ada', GIT_AUTHOR_EMAIL: 'ada@x.io', GIT_COMMITTER_NAME: 'ada', GIT_COMMITTER_EMAIL: 'ada@x.io',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    stdio: 'ignore',
  });
  G(['init', '-q', '-b', 'main']);
  const commit = (msg: string, date: string, author = 'ada') => execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', msg], {
    env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author}@x.io`, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: `${author}@x.io`, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdio: 'ignore',
  });
  const add = (path: string, body: string, date: string, msg: string, author = 'ada') => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
    G(['add', '-A']); commit(msg, date, author);
  };
  // ── Phase 1 (2025-01) — 6 commits, one authored by a soon-to-depart owner ──
  add('src/core/a.ts', 'export const a = 1;\n', '2025-01-02T10:00:00', 'initial core', 'ada');
  add('src/core/b.ts', 'export const b = 2;\n', '2025-01-03T10:00:00', 'add b', 'ben');
  add('src/core/c.ts', 'export const c = 3;\n', '2025-01-04T10:00:00', 'add c', 'ada');
  // a dead-end module: three files added here...
  add('src/legacy/x.ts', 'export const x = 0;\n', '2025-01-05T10:00:00', 'add legacy x', 'ada');
  add('src/legacy/y.ts', 'export const y = 0;\n', '2025-01-06T10:00:00', 'add legacy y', 'ada');
  add('src/legacy/z.ts', 'export const z = 0;\n', '2025-01-07T10:00:00', 'add legacy z', 'ben');
  // ── Phase 2 (2025-06, >21d gap) — >=5 commits so it stays a distinct phase; a secret in a subject, the
  // dead-end deletion, and a revert ──
  add('src/core/d.ts', 'export const d = 4;\n', '2025-06-02T10:00:00', 'feat: token ghp\x5fABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 leaked here', 'ada');
  unlinkSync(join(dir, 'src/legacy/x.ts')); unlinkSync(join(dir, 'src/legacy/y.ts')); unlinkSync(join(dir, 'src/legacy/z.ts'));
  G(['add', '-A']); commit('remove the whole legacy module', '2025-06-03T10:00:00', 'ada');
  add('src/core/e.ts', 'export const e = 5;\n', '2025-06-04T10:00:00', 'add e', 'ada');
  add('src/core/f.ts', 'export const f = 6;\n', '2025-06-05T10:00:00', 'add f', 'ada');
  add('src/core/g.ts', 'export const g = 7;\n', '2025-06-06T10:00:00', 'add g', 'ben');
  commit('Revert "add e"', '2025-06-07T10:00:00', 'ada');
  return dir;
}

test('buildSpine detects phases, the dead-end cluster, the revert, and ownership', async () => {
  const dir = tmpRepo();
  try {
    const s = await buildSpine(dir);
    assert.ok(s, 'spine built');
    assert.ok(s!.totalCommits >= 10, `>=10 commits (got ${s!.totalCommits})`);
    assert.ok(s!.phases.length >= 2, `the 5-month gap yields >=2 phases (got ${s!.phases.length})`);
    // dead-end: the src/legacy dir had 3 files added then deleted, absent from HEAD
    const legacy = s!.deadEnds.find((d) => d.dir === 'src/legacy');
    assert.ok(legacy, 'src/legacy dead-end cluster detected');
    assert.equal(legacy!.filesDeleted, 3, '3 legacy files deleted');
    // revert
    assert.ok(s!.reverts.some((r) => r.subject.startsWith('Revert')), 'the revert is captured');
    // ownership: both authors present, ada leads
    assert.equal(s!.ownership[0].author, 'ada');
    assert.ok(s!.ownership.some((o) => o.author === 'ben'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the history appendix built from a real spine REDACTS a secret in a revert subject', async () => {
  const dir = tmpRepo();
  try {
    const s = await buildSpine(dir);
    s!.reverts.push({ sha: 'abcdef1234', date: '2025-06-08', subject: 'Revert "token ghp\x5fABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"' });
    const html = historyFragmentHtml([s!]);
    assert.match(html, /Dead ends — added, then removed/);
    assert.doesNotMatch(html, /ghp\x5fABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/, 'the token never reaches the report');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildSpine returns null for a history too small to have a story', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docrec-tiny-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'only one'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x.io', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x.io', GIT_AUTHOR_DATE: '2025-01-01T00:00:00', GIT_COMMITTER_DATE: '2025-01-01T00:00:00' },
      stdio: 'ignore',
    });
    assert.equal(await buildSpine(dir), null, 'below MIN_REPO_COMMITS → null (no story)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('repoNameOf (ky test run): a Windows workspace path yields the dir name, not the whole temp path', () => {
  assert.equal(repoNameOf(String.raw`C:\Users\x\AppData\Local\Temp\theresa-org-ab\ky`), 'ky');
  assert.equal(repoNameOf('/tmp/theresa-org-ab/ky/'), 'ky');
  assert.equal(repoNameOf(String.raw`C:\ws\ky\ `.trim()), 'ky');
});
