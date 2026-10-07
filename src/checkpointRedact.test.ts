import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A scanned repo quoting `API_KEY=` in a measured sampleRow made the barrier/frontier checkpoints
// invalid JSON (the sidecar was redacted as serialized TEXT), so resume found "payload missing or unreadable" and
// re-ran every bundle. The store dir is resolved at module load, so both modules are imported after setting it.
test('writeCheckpoint → loadCheckpoint round-trips a payload that quotes API_KEY= (redacted, still valid JSON)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ckpt-redact-'));
  process.env.THERESA_DATA_DIR = dir;
  try {
    const { ensureStore } = await import('./store.ts');
    const { writeCheckpoint, loadCheckpoint } = await import('./checkpoints.ts');
    ensureStore();
    const payload = { hypotheses: [{ sampleRows: ['(no rows) runtime resolution of API_KEY='] }, { claim: 'The published start script', note: 'API_KEY=' + 'sk_' + 'live_abcdef123456' }] };
    assert.ok(writeCheckpoint('rs_redacttest', 'barrier', payload, 'fp', { label: 'barrier' }), 'the write succeeds');
    const got = loadCheckpoint('rs_redacttest', 'barrier');
    assert.ok(got, 'the checkpoint must be readable (it was unparseable before the fix)');
    assert.equal(got.payload.hypotheses.length, 2);
    assert.equal(got.payload.hypotheses[1].claim, 'The published start script');
    assert.doesNotMatch(JSON.stringify(got.payload), /sk_live_abcdef123456/, 'the secret is still redacted');
  } finally {
    delete process.env.THERESA_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
