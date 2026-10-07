import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexAgentAvailable } from './codexAgent.ts';

// codex is the backend for report/synthesis steps unless explicitly forced to gpt (or codex/key absent). These
// lock the deterministic gating + fail-open contracts without spawning codex.

test('codexAgentAvailable is false when forced to gpt / claude, regardless of codex+key', () => {
  const q = process.env.THERESA_QC_JUDGE, w = process.env.THERESA_REPORT_WRITER;
  try {
    process.env.THERESA_QC_JUDGE = 'gpt';
    assert.equal(codexAgentAvailable(), false, 'THERESA_QC_JUDGE=gpt forces the gpt fallback');
    delete process.env.THERESA_QC_JUDGE;
    process.env.THERESA_REPORT_WRITER = 'claude';
    assert.equal(codexAgentAvailable(), false, 'THERESA_REPORT_WRITER=claude forces the fallback');
  } finally {
    if (q === undefined) delete process.env.THERESA_QC_JUDGE; else process.env.THERESA_QC_JUDGE = q;
    if (w === undefined) delete process.env.THERESA_REPORT_WRITER; else process.env.THERESA_REPORT_WRITER = w;
  }
});
