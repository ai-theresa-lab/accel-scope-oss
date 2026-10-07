import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store.ts resolves THERESA_DATA_DIR at module load, so it is imported after the env is set.
const dir = mkdtempSync(join(tmpdir(), 'store-'));
process.env.THERESA_DATA_DIR = dir;
const S = await import('./store.ts');
test.after(() => { delete process.env.THERESA_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

test('reportExists: answered from one cached listing that follows this process\'s own saves and deletes', () => {
  S.ensureStore();
  assert.equal(S.reportExists('rs_cache'), false);           // primes the listing
  S.saveReport('rs_cache-leadership', '<p>x</p>');
  assert.equal(S.reportExists('rs_cache-leadership'), true, 'a save is visible at once, not after the TTL');
  assert.equal(S.reportExists('rs_cache'), false);
  S.deleteReport('rs_cache', 'leadership');
  assert.equal(S.reportExists('rs_cache-leadership'), false, 'a delete is visible at once');
});
