import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The docs promise the codex model can be rolled back with `THERESA_CODEX_MODEL=gpt-5.5` and NO code change. This is
// the test for that promise: it asserts the env var reaches the actual `codex exec` argv, not just the constant.
//
// htmlWriter is imported DYNAMICALLY, inside the test, because CODEX_MODEL is resolved at module load — the env has to
// be set first. Do NOT add a static import of ./htmlWriter.ts to this file.

test('THERESA_CODEX_MODEL rolls the codex model back — env only, no code change', async () => {
  process.env.THERESA_CODEX_MODEL = 'gpt-5.5';
  const { CODEX_MODEL, authorHtmlFile } = await import('./htmlWriter.ts');
  assert.equal(CODEX_MODEL, 'gpt-5.5', 'the override must win over the gpt-5.6 default');

  // A fake codex that records the argv it was invoked with. scrubbedEnv() strips custom env vars from the child, so it
  // writes into its cwd — which authorHtmlFile sets to the scratch workspace.
  const bin = mkdtempSync(join(tmpdir(), 'fake-codex-'));
  writeFileSync(join(bin, 'codex'),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.141.0"; exit 0; fi\nwhile read -r _; do :; done\necho "$@" > argv.txt\nexit 0\n');
  chmodSync(join(bin, 'codex'), 0o755);
  const scratch = mkdtempSync(join(tmpdir(), 'codex-scratch-'));
  const prevPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    await authorHtmlFile(scratch, 'brief', 1, undefined, { label: 'rollback' }, () => {}, 'codex');
    const argv = readFileSync(join(scratch, 'argv.txt'), 'utf8');
    assert.match(argv, /-m gpt-5\.5\b/, 'the rolled-back model must reach the codex command line');
    assert.doesNotMatch(argv, /gpt-5\.6/, 'the default must not leak through');
  } finally {
    process.env.PATH = prevPath;
    delete process.env.THERESA_CODEX_MODEL;
    rmSync(bin, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
