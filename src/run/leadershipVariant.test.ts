import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// LEADERSHIP_VARIANT is read from the environment at MODULE LOAD, so it cannot be exercised by
// mutating process.env inside one test process — the first import freezes it. Each case therefore runs
// a real child process with the env set, which is also the only honest test of a deploy-time flag:
// the thing being verified is what the server computes at boot, not what a mock returns.

const read = (env: Record<string, string | undefined>): { variant: string; warned: boolean } => {
  const out = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '-e', "import('./src/run/shared.ts').then(m=>console.log('VARIANT='+m.LEADERSHIP_VARIANT))"],
    { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return { variant: (out.match(/VARIANT=(\S+)/) ?? [])[1] ?? '', warned: false };
};

test('DEFAULT is v5 — the lens-split business brief ships, and v4 / v0 are the env-var rollbacks', () => {
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: undefined }).variant, 'v5');
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: '' }).variant, 'v5', 'an empty env var is not a selection');
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: 'v4' }).variant, 'v4', 'the previous default stays reachable');
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: 'v0' }).variant, 'v0', 'the rollback must stay reachable');
});

test('a known variant is honoured, case- and whitespace-insensitively', () => {
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: 'v4' }).variant, 'v4');
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: ' V4 ' }).variant, 'v4', 'a deploy env often carries stray whitespace');
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: 'V5' }).variant, 'v5');
});

test('an unrecognised value falls back to v0 rather than throwing', () => {
  // A typo in a deploy env must degrade to MAIN's contract, not take the report stage down — this stage
  // runs at the END of a run that has already spent tens of dollars. The fallback is deliberately v0 and
  // not the new default: an unreadable env var should land on the arm that matches main.
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: 'v9' }).variant, 'v0');
  assert.equal(read({ THERESA_LEADERSHIP_VARIANT: 'latest' }).variant, 'v0');
});
