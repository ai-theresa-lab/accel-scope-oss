import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorHtmlFile } from './htmlWriter.ts';

// A FAKE `codex` on PATH exercises authorHtmlFile's REAL codex branch — the spawn, the exit-status read, and the `ok`
// contract the writers' fallback hangs off — with no codex CLI, no OpenAI key and no network. This is the test that
// matters: runCodexExec RESOLVES a status instead of throwing, so `ok` is the ONLY failure signal a caller ever gets.
// scrubbedEnv() passes PATH through to the child (and drops everything else), which is why swapping PATH works here.

const fakeCodexDir = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-codex-'));
  const bin = join(dir, 'codex');
  writeFileSync(bin, `#!/bin/sh\nwhile read -r _; do :; done\n${body}\n`);   // drain the piped prompt, then act
  chmodSync(bin, 0o755);
  return dir;
};

async function withPath(dir: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.PATH;
  process.env.PATH = dir;   // ONLY the fake dir: a real codex on the machine must not leak into the test
  try { await fn(); } finally { process.env.PATH = prev; }
}

const scratchDir = () => mkdtempSync(join(tmpdir(), 'codex-scratch-'));
const noop = () => {};

test('codex branch: wrote the file + exit 0 → ok (no fallback)', async () => {
  const bin = fakeCodexDir(`printf '<html>drafted</html>' > report.html\nexit 0`);
  const scratch = scratchDir();
  try {
    await withPath(bin, async () => {
      const r = await authorHtmlFile(scratch, 'brief', 1, undefined, { label: 'test' }, noop, 'codex');
      assert.equal(r.ok, true, 'a clean codex round must NOT trigger the fallback');
      assert.equal(existsSync(join(scratch, 'report.html')), true);
      assert.equal(r.session, undefined, 'codex --ephemeral has no resumable session');
    });
  } finally { rmSync(bin, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('codex branch: non-zero exit → ok:false (this is what hands the round to Claude Code)', async () => {
  const bin = fakeCodexDir('exit 3');
  const scratch = scratchDir();
  try {
    await withPath(bin, async () => {
      const r = await authorHtmlFile(scratch, 'brief', 1, undefined, { label: 'test' }, noop, 'codex');
      assert.equal(r.ok, false, 'a failed codex round MUST report !ok — it never throws');
      assert.equal(existsSync(join(scratch, 'report.html')), false);
    });
  } finally { rmSync(bin, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('codex branch: codex NOT on PATH → ok:false (spawn ENOENT is resolved, not thrown)', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'no-codex-'));
  const scratch = scratchDir();
  try {
    await withPath(empty, async () => {
      const r = await authorHtmlFile(scratch, 'brief', 1, undefined, { label: 'test' }, noop, 'codex');
      assert.equal(r.ok, false, 'a missing codex binary must degrade to the fallback, not crash the run');
    });
  } finally { rmSync(empty, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('codex branch: exit 0 but NOTHING authored → ok:true, so the existsSync half of the guard is load-bearing', async () => {
  const bin = fakeCodexDir('exit 0');
  const scratch = scratchDir();
  try {
    await withPath(bin, async () => {
      const r = await authorHtmlFile(scratch, 'brief', 1, undefined, { label: 'test' }, noop, 'codex');
      assert.equal(r.ok, true, 'exit 0 reports ok…');
      assert.equal(existsSync(join(scratch, 'report.html')), false, '…so `!w.ok || !existsSync(REPORT)` is what catches this');
    });
  } finally { rmSync(bin, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('codex round reports usage-derived cost to onCost', async () => {
  // codex exec --json streams turn.completed events; parseUsage sums them. Emit one so the budget path is covered.
  const bin = fakeCodexDir(`printf '<html>x</html>' > report.html\necho '{"type":"turn.completed","usage":{"input_tokens":1000,"output_tokens":100}}'\nexit 0`);
  const scratch = scratchDir();
  let billed = 0;
  try {
    await withPath(bin, async () => {
      await authorHtmlFile(scratch, 'brief', 1, undefined, { label: 'test', onCost: (u) => { billed += u; } }, noop, 'codex');
    });
    assert.ok(billed > 0, 'codex spend must reach the run ledger (it is out-of-band, not a runAgent leaf)');
    // …priced from the shared table for the codex model, not the old flat gpt-5 rate ($1.25 / $10 per 1M).
    const { openaiCostUsd } = await import('./openaiPricing.ts');
    const { CODEX_MODEL } = await import('./htmlWriter.ts');
    assert.ok(Math.abs(billed - openaiCostUsd(CODEX_MODEL, { input: 1000, cached: 0, output: 100 })) < 1e-12);
  } finally { rmSync(bin, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

test('codex branch: codex exits WITHOUT reading a large prompt → ok:false, no uncaught EPIPE', async () => {
  // The prompt is far larger than a pipe buffer and the fake never reads stdin, so child.stdin.end(input) hits EPIPE.
  // runCodexExec must swallow that stream error (the exit status is the failure signal), not crash the process.
  const dir = mkdtempSync(join(tmpdir(), 'fake-codex-'));
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\nexit 2\n');
  chmodSync(join(dir, 'codex'), 0o755);
  const scratch = scratchDir();
  try {
    await withPath(dir, async () => {
      const r = await authorHtmlFile(scratch, 'x'.repeat(4 * 1024 * 1024), 1, undefined, { label: 'test' }, noop, 'codex');
      assert.equal(r.ok, false, 'an early codex exit is a clean round failure');
    });
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});
