import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designEvolutionWarning, noteDegraded, workspaceHasGitHistory, type RunDegradation } from './degraded.ts';

test('noteDegraded appends {stage, reason, at} once per distinct (stage, reason)', () => {
  const run: { degraded?: RunDegradation[] } = {};
  const at = new Date('2026-09-25T00:00:00Z');
  noteDegraded(run, 'html-qc', 'judge unavailable', at);
  noteDegraded(run, 'html-qc', 'judge unavailable', at);   // every QC round degrades → one banner row
  noteDegraded(run, 'reconcile', 'skipped (codex unavailable)', at);
  assert.deepEqual(run.degraded, [
    { stage: 'html-qc', reason: 'judge unavailable', at: '2026-09-25T00:00:00.000Z' },
    { stage: 'reconcile', reason: 'skipped (codex unavailable)', at: '2026-09-25T00:00:00.000Z' },
  ]);
});

// Design & Evolution ticked + a .git-less uploaded folder silently produced no report.
test('a workspace with no git history is detected (root repo or one repo per top-level dir)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-git-'));
  try {
    mkdirSync(join(root, 'uploaded'));
    writeFileSync(join(root, 'uploaded', 'a.ts'), 'x');
    assert.equal(workspaceHasGitHistory(root), false);
    mkdirSync(join(root, 'cloned', '.git'), { recursive: true });
    assert.equal(workspaceHasGitHistory(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
  assert.equal(workspaceHasGitHistory(join(root, 'gone')), false);
});

test('the start-of-run warning fires only for a ticked, available, agentic run with no git history', () => {
  const base = { ticked: true, available: true, agentic: true, hasGitHistory: false };
  assert.match(designEvolutionWarning(base) ?? '', /no selected target has git history/);
  assert.equal(designEvolutionWarning({ ...base, hasGitHistory: true }), null);
  assert.equal(designEvolutionWarning({ ...base, ticked: false }), null);
  assert.equal(designEvolutionWarning({ ...base, available: false }), null);
  assert.equal(designEvolutionWarning({ ...base, agentic: false }), null);
});
