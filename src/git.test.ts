// Fork-aware contributor counting.
//
// A forked repo carries its full upstream history, so counting every author in that
// history over-credits the org with upstream contributors. The fix is a fork-date cutoff:
// for a fork, only count commits AFTER the fork date. These tests build TEMP git repos with
// backdated commits and verify the cutoff at two levels: the raw `logAuthors` reader and the
// end-to-end `analyzeOrg` people aggregation.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logAuthors } from './git.ts';
import { analyzeOrg } from './org.ts';
import { parseForkCutoffs } from './cli-org.ts';

// --- temp-git helpers -------------------------------------------------------

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'setup'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'setup@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

// One commit authored (and committed) as `name <email>` at a fixed, backdated instant.
// Overriding both AUTHOR and COMMITTER date makes `git log --since` deterministic.
function commitAs(dir: string, name: string, email: string, isoDate: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const stamp = `${isoDate}T12:00:00 +0000`;
  execFileSync('git', ['commit', '-q', '-m', `edit ${file}`], {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: stamp,
    },
  });
}

const names = (rows: { name: string }[]): Set<string> => new Set(rows.map((r) => r.name));

// --- tests ------------------------------------------------------------------

test('logAuthors: since-cutoff returns only authors on/after the cutoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'theresa-git-la-'));
  try {
    initRepo(dir);
    // Upstream author well before the cutoff; org author well after it.
    commitAs(dir, 'Ada Upstream', 'ada@upstream-lib.example', '2020-01-01', 'a.txt', 'a1');
    commitAs(dir, 'Ben Internal', 'ben@ourorg.example', '2024-01-01', 'b.txt', 'b1');

    const all = await logAuthors(dir);
    assert.deepEqual(names(all), new Set(['Ada Upstream', 'Ben Internal']), 'no cutoff → both authors');

    const scoped = await logAuthors(dir, '2022-01-01');
    assert.deepEqual(names(scoped), new Set(['Ben Internal']), 'cutoff → only the post-fork author');

    // An empty cutoff string is a no-op (today's behavior), not an all-filter.
    const empty = await logAuthors(dir, '');
    assert.deepEqual(names(empty), new Set(['Ada Upstream', 'Ben Internal']), 'empty cutoff → all authors');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeOrg: fork cutoff excludes pre-fork upstream authors from org people', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theresa-org-fork-'));
  try {
    // "fork" repo: upstream history by Ada (pre-fork) + org work by Ben (post-fork).
    // Both authors need >=2 commits on their side of the cutoff so hasHistory (commits>1)
    // holds for the scoped view — a fork with a single post-fork commit is a snapshot.
    const fork = join(root, 'forked-lib');
    initRepo(fork);
    commitAs(fork, 'Ada Upstream', 'ada@upstream-lib.example', '2019-05-01', 'core.txt', 'v1');
    commitAs(fork, 'Ada Upstream', 'ada@upstream-lib.example', '2020-05-01', 'core.txt', 'v2');
    commitAs(fork, 'Ben Internal', 'ben@ourorg.example', '2023-05-01', 'patch.txt', 'p1');
    commitAs(fork, 'Ben Internal', 'ben@ourorg.example', '2024-05-01', 'patch.txt', 'p2');

    // normal (internal) repo: all history by Cleo, no cutoff.
    const normal = join(root, 'internal-svc');
    initRepo(normal);
    commitAs(normal, 'Cleo Native', 'cleo@ourorg.example', '2023-06-01', 'svc.txt', 's1');
    commitAs(normal, 'Cleo Native', 'cleo@ourorg.example', '2024-06-01', 'svc.txt', 's2');

    // Without cutoffs: every author in every history counts (A, B, C).
    const openRun = await analyzeOrg(root);
    const openPeople = new Set((openRun.metrics.people as { id: string }[]).map((p) => p.id));
    assert.equal(openRun.metrics.summary.people, 3, 'no cutoff → 3 people');
    assert.ok([...openPeople].some((id) => id.includes('Ada Upstream')), 'Ada present without cutoff');

    // With a fork cutoff on the forked repo: Ada (pre-fork upstream) drops out; Ben + Cleo remain.
    const scopedRun = await analyzeOrg(root, undefined, { 'forked-lib': '2022-01-01' });
    const scopedPeople = new Set((scopedRun.metrics.people as { id: string }[]).map((p) => p.id));
    assert.equal(scopedRun.metrics.summary.people, 2, 'fork cutoff → 2 people (upstream author excluded)');
    assert.ok([...scopedPeople].some((id) => id.includes('Ben Internal')), 'Ben (post-fork) counted');
    assert.ok([...scopedPeople].some((id) => id.includes('Cleo Native')), 'Cleo (non-fork repo) counted');
    assert.ok(![...scopedPeople].some((id) => id.includes('Ada Upstream')), 'Ada (pre-fork upstream) NOT counted');

    // The forked repo is flagged forkScoped in the per-repo metrics; the internal repo is not.
    const repoRows = scopedRun.metrics.repos as { name: string; forkScoped: boolean }[];
    assert.equal(repoRows.find((r) => r.name === 'forked-lib')?.forkScoped, true);
    assert.equal(repoRows.find((r) => r.name === 'internal-svc')?.forkScoped, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseForkCutoffs: parses basename=ISO pairs, skips malformed, keeps the timestamp intact', () => {
  assert.deepEqual(parseForkCutoffs(null), {});
  assert.deepEqual(parseForkCutoffs(''), {});
  assert.deepEqual(parseForkCutoffs('repo=2022-01-01'), { repo: '2022-01-01' });
  // Multiple pairs; ISO timestamps (which contain no '=') survive the first-'=' split.
  assert.deepEqual(
    parseForkCutoffs('a=2021-01-01T00:00:00Z, b=2022-06-30 '),
    { a: '2021-01-01T00:00:00Z', b: '2022-06-30' },
  );
  // Malformed pairs (no '=', leading '=', blank) are skipped, not thrown.
  assert.deepEqual(parseForkCutoffs('nope,=2020-01-01,good=2023-03-03'), { good: '2023-03-03' });
});
