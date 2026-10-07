import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writerOrder, CODEX_MODEL, codexAvailable } from './htmlWriter.ts';

// The writers try OpenAI (codex) FIRST and fall back to Claude Code — writerOrder encodes that, and the round loops in
// analystReport.ts / normalizeReport.ts walk the list. These assertions are written to hold whether or not the codex
// CLI happens to be installed on the machine running the test.

const withEnv = (k: string, v: string | undefined, fn: () => void) => {
  const prev = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; }
};

test('writerOrder puts codex first and Claude Code last (when codex is available)', () => {
  withEnv('THERESA_REPORT_WRITER', undefined, () => {
    const order = writerOrder();
    assert.ok(order.length >= 1 && order.length <= 2);
    assert.equal(order.at(-1), 'claude', 'Claude Code is always the last resort');
    assert.equal(order.includes('codex'), codexAvailable(), 'codex is in the order iff its CLI is installed');
    if (order.length === 2) assert.deepEqual(order, ['codex', 'claude']);
  });
});

test('writerOrder never repeats a backend', () => {
  withEnv('THERESA_REPORT_WRITER', undefined, () => {
    const order = writerOrder();
    assert.equal(new Set(order).size, order.length);
  });
});

test('THERESA_REPORT_WRITER=claude pins Claude Code with no codex attempt', () => {
  withEnv('THERESA_REPORT_WRITER', 'claude', () => {
    assert.deepEqual(writerOrder(), ['claude']);
  });
});

test('THERESA_REPORT_WRITER=codex pins ONE backend (no fallback), degrading to claude if codex is absent', () => {
  withEnv('THERESA_REPORT_WRITER', 'codex', () => {
    const order = writerOrder();
    assert.equal(order.length, 1, 'an explicit pin disables the fallback');
    assert.equal(order[0], codexAvailable() ? 'codex' : 'claude');
  });
});

test('CODEX_MODEL is the single codex model definition and defaults to gpt-5.6', () => {
  // Module-level constant: only assert the default when the env override is not set in this process.
  if (!process.env.THERESA_CODEX_MODEL) assert.equal(CODEX_MODEL, 'gpt-5.6');
  assert.match(CODEX_MODEL, /^gpt-/);
});
