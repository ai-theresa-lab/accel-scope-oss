import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadSetCollector, codeSearchProbe, currentReadSet, normalizeSnapshot, openedFromTrace, withReadSet } from './readSet.ts';
import { laneReadSetDecision, type RepoChange } from '../run/incremental.ts';

// A workspace with one repo cloned under the dir `app-1` (the dir name a run picks) = acme/app.
function ws(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'theresa-rs-'));
  mkdirSync(join(root, 'app-1', 'src'), { recursive: true });
  writeFileSync(join(root, 'app-1', 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'app-1', 'src', 'b.ts'), 'export const b = 2;\n');
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
const REPOS = [{ fullName: 'acme/app', dir: 'app-1' }];
const ch = (path: string, status: RepoChange['status'] = 'M', text = '', old = ''): RepoChange => ({ status, path, repo: 'acme/app', newText: () => text, oldText: () => old });

test('Read / Grep results are recorded workspace-relative, backslash paths included; outside-workspace paths are not', () => {
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    c.noteToolUse('Read', { file_path: 'app-1\\src\\a.ts' }, w.root);
    c.noteToolUse('Read', { file_path: join(w.root, 'app-1', 'src', 'b.ts') }, w.root);
    c.noteToolUse('Read', { file_path: join(tmpdir(), 'elsewhere.ts') }, w.root);
    c.noteToolResult('Grep', 'app-1/src/b.ts:1:export const b\nnot a path at all  here', w.root);
    assert.deepEqual(c.snapshot().readSet, ['app-1/src/a.ts', 'app-1/src/b.ts']);
  } finally { w.done(); }
});

test('Glob: relative, absolute (re-rooted) and backslash patterns; Grep keeps -i and a normalized glob', () => {
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    c.noteToolUse('Glob', { pattern: '**/*.sql', path: 'app-1' }, w.root);
    c.noteToolUse('Glob', { pattern: join(w.root, 'app-1', 'src').replace(/\\/g, '/') + '/*.ts' }, w.root);
    c.noteToolUse('Grep', { pattern: 'secret', path: 'app-1', glob: 'src\\**\\*.ts', '-i': true }, w.root);
    const s = c.snapshot();
    assert.deepEqual(s.globs, ['app-1/**/*.sql', 'app-1/src/*.ts']);
    assert.deepEqual(s.greps, [{ path: 'app-1', pattern: 'secret', glob: 'src/**/*.ts', ci: true }]);
  } finally { w.done(); }
});

test('repo_grep is a case-insensitive probe over its code-search terms; unmodelled syntax is opaque', () => {
  assert.equal(codeSearchProbe('Stripe.charge'), 'Stripe\\.charge');
  assert.equal(codeSearchProbe('foo bar'), 'foo|bar', 'implicit AND → any term (a superset)');
  assert.equal(codeSearchProbe('"exact phrase"'), 'exact phrase');
  assert.equal(codeSearchProbe('/rev(enue)?_total/'), 'rev(enue)?_total');
  assert.equal(codeSearchProbe('foo OR bar'), null);
  assert.equal(codeSearchProbe('foo language:go'), null);
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    c.noteToolUse('mcp__repogrep__repo_grep', { repo: 'acme/app', pattern: 'SECRET_KEY', path: 'src' }, w.root);
    c.noteToolUse('mcp__repogrep__repo_grep', { repo: 'acme/app', pattern: 'x NOT y' }, w.root);
    const s = normalizeSnapshot(c.snapshot(), REPOS);
    assert.deepEqual(s.greps, [{ path: 'acme/app/src', pattern: 'SECRET_KEY', ci: true }]);
    assert.deepEqual(s.opaque, ['repogrep:repo_grep']);
    // The probe is case-insensitive: a lower-case occurrence that appeared in a changed file re-runs the lane.
    assert.equal(laneReadSetDecision({ bundleId: 'x', readSet: [], greps: s.greps }, [ch('src/k.ts', 'M', 'const secret_key = 1', '')]).reuse, false);
  } finally { w.done(); }
});

test('a codeintel query naming a file is opaque (it reads the cross-file index), not a single-file read', () => {
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    c.noteToolUse('mcp__codeintel__get_context', { file: 'app-1/src/a.ts' }, w.root);
    c.noteToolUse('mcp__codeintel__get_symbol', { name: 'os.path' }, w.root);
    const s = c.snapshot();
    assert.deepEqual(s.readSet, []);
    assert.deepEqual(s.opaque, ['codeintel:get_context', 'codeintel:get_symbol']);
    assert.equal(laneReadSetDecision({ bundleId: 'x', ...s }, [ch('src/b.ts')]).reuse, false, 'a dependent changed → the lane re-runs');
  } finally { w.done(); }
});

test('repo-dir renames: the snapshot is repo-normalized, so a later run with another dir name still compares', () => {
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    c.noteToolUse('Read', { file_path: 'app-1/src/a.ts' }, w.root);
    c.noteToolUse('Grep', { pattern: '^import', path: 'app-1/src' }, w.root);
    const s = normalizeSnapshot(c.snapshot(), REPOS);
    assert.deepEqual(s.readSet, ['acme/app/src/a.ts']);
    assert.deepEqual(s.greps, [{ path: 'acme/app/src', pattern: '^import' }]);
    // The next run cloned acme/app as `app` — the change is repo-normalized too, so the read still hits.
    assert.equal(laneReadSetDecision({ bundleId: 'x', ...s }, [ch('src/a.ts')]).reuse, false);
    assert.equal(laneReadSetDecision({ bundleId: 'x', ...s }, [ch('src/c.ts', 'A', 'const x = 1\nimport y from "z"', '')]).reuse, false, '^-anchored probe matches a mid-file import line');
  } finally { w.done(); }
});

test('withReadSet scopes the collector to one async lane', async () => {
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    assert.equal(currentReadSet(), undefined);
    await withReadSet(c, async () => { await Promise.resolve(); assert.equal(currentReadSet(), c); });
    assert.equal(currentReadSet(), undefined);
  } finally { w.done(); }
});

test('opened: a Read (and repo_read) is an opened file; a path a Glob / Grep RESULT listed is in readSet only', () => {
  const w = ws();
  try {
    const c = new ReadSetCollector(w.root, { repos: REPOS });
    c.noteToolUse('Read', { file_path: 'app-1/src/a.ts' }, w.root);
    c.noteToolResult('Glob', 'app-1/src/a.ts\napp-1/src/b.ts', w.root);
    c.noteToolResult('Grep', 'app-1/src/b.ts:1:export const b', w.root);
    c.noteToolUse('mcp__repogrep__repo_read', { repo: 'acme/app', path: 'src/b.ts' }, w.root);
    const s = c.snapshot();
    assert.deepEqual(s.readSet, ['app-1/src/a.ts', 'app-1/src/b.ts'], 'the reuse union is unchanged');
    assert.deepEqual(s.opened, ['app-1/src/a.ts', 'app-1/src/b.ts']);
    const listed = new ReadSetCollector(w.root, { repos: REPOS });
    listed.noteToolResult('Glob', 'app-1/src/a.ts\napp-1/src/b.ts', w.root);
    assert.deepEqual(listed.snapshot().readSet, ['app-1/src/a.ts', 'app-1/src/b.ts']);
    assert.deepEqual(listed.snapshot().opened, [], 'listed, never opened');
    assert.deepEqual(normalizeSnapshot(c.snapshot(), REPOS).opened, ['acme/app/src/a.ts', 'acme/app/src/b.ts']);
  } finally { w.done(); }
});

test('openedFromTrace: a lane recorded before `opened` — Read calls from its trace, cut at the repo dir, repo-normalized', () => {
  const trace = [
    '🔧 Glob  {"pattern":"app-1/src/**/*.ts"}',
    '🔧 Read  {"file_path":"app-1\\\\src\\\\a.ts"}',
    '🔧 Read  {"file_path":"C:\\\\Users\\\\x\\\\AppData\\\\Local\\\\Temp\\\\theresa-org-ab12\\\\app-1\\\\src\\\\b.ts","limit":40}',
    '🔧 Read  {"file_path":"/etc/hosts"}',
    '🔧 Grep  {"pattern":"x","path":"app-1/src/c.ts"}',
  ].join('\n');
  assert.deepEqual(openedFromTrace(trace, REPOS), ['acme/app/src/a.ts', 'acme/app/src/b.ts']);
  assert.deepEqual(openedFromTrace(undefined, REPOS), []);
});
