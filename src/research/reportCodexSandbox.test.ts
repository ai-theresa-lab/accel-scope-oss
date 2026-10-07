import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportCodexSandboxBlocked, reportCodexAvailable, writerOrder } from './htmlWriter.ts';
import { codexAgentAvailable } from './codexAgent.ts';

// By default, with no OS sandbox (THERESA_CODEX_NO_SANDBOX=1, i.e. a container) the report pipeline never runs codex
// unsandboxed; only THERESA_REPORT_CODEX_REQUIRE_SANDBOX=0 opts in to the risk. The writers
// route to Claude and the codex file-task / QC steps to the tool-free gpt fallback. These hold whether or not the codex CLI is installed on the test machine.

const KEYS = ['THERESA_REPORT_CODEX_REQUIRE_SANDBOX', 'THERESA_CODEX_NO_SANDBOX', 'THERESA_REPORT_WRITER', 'THERESA_QC_JUDGE'] as const;
function withEnv(env: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void): void {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) { const v = env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fn();
  } finally {
    for (const k of KEYS) { const v = prev[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('without an OS sandbox codex is blocked by default; only an explicit =0 allows it', () => {
  withEnv({ THERESA_CODEX_NO_SANDBOX: '1' }, () => assert.equal(reportCodexSandboxBlocked(), true));                      // default: blocked
  withEnv({ THERESA_REPORT_CODEX_REQUIRE_SANDBOX: '1', THERESA_CODEX_NO_SANDBOX: '1' }, () => assert.equal(reportCodexSandboxBlocked(), true));
  withEnv({ THERESA_REPORT_CODEX_REQUIRE_SANDBOX: '0', THERESA_CODEX_NO_SANDBOX: '1' }, () => assert.equal(reportCodexSandboxBlocked(), false)); // explicit opt-in
  withEnv({}, () => assert.equal(reportCodexSandboxBlocked(), false));                                                    // local: codex's own sandbox works
});

test('when blocked, every report-pipeline codex path takes its codex-less route', () => {
  withEnv({ THERESA_REPORT_CODEX_REQUIRE_SANDBOX: '1', THERESA_CODEX_NO_SANDBOX: '1' }, () => {
    assert.equal(reportCodexAvailable(), false);
    assert.deepEqual(writerOrder(), ['claude'], 'HTML writers → the Claude writer');
    withEnv({ THERESA_REPORT_CODEX_REQUIRE_SANDBOX: '1', THERESA_CODEX_NO_SANDBOX: '1', THERESA_REPORT_WRITER: 'codex' }, () =>
      assert.deepEqual(writerOrder(), ['claude'], 'even an explicit codex pin never runs unsandboxed'));
    assert.equal(codexAgentAvailable(), false, 'codex file-task steps → gpt-5.5 fallback');
  });
});
