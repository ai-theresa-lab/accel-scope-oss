import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpointHealLogLine, dirFingerprint, healCheckpointIndex, type CkptId, type CkptMeta } from './checkpoints.ts';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const meta = (id: CkptId, label: string = id): CkptMeta => ({ id, at: '2026-09-25T00:00:00.000Z', bytes: 1, stageVersion: 1, label });

// "◆ checkpoint index healed from disk" was logged 5+ times in a row. A run past the
// barrier keeps its 'frontier' sidecar on disk while the healed index drops it, so every read re-"healed".
test('a healed past-barrier index does not re-heal on the next read', () => {
  const disk = new Map<CkptId, CkptMeta>([['workspace', meta('workspace')], ['frontier', meta('frontier', 'Bundle frontier · 3/4')], ['barrier', meta('barrier')], ['findings', meta('findings')]]);
  const onDisk = (id: CkptId) => disk.get(id);
  const first = healCheckpointIndex([meta('workspace')], onDisk);           // the index lagged a crash
  assert.equal(first.changed, true);
  assert.deepEqual(first.rows.map((r) => r.id), ['workspace', 'barrier', 'findings']);   // barrier subsumes frontier
  const second = healCheckpointIndex(first.rows, onDisk);
  assert.equal(second.changed, false);
  assert.deepEqual(second.rows, first.rows);
});

test('a stale index row is replaced by the on-disk meta; an unsorted-but-equal index is not a heal', () => {
  const onDisk = (id: CkptId) => (id === 'frontier' ? meta('frontier', 'Bundle frontier · 2/3') : undefined);
  const r = healCheckpointIndex([meta('frontier', 'Bundle frontier · 1/3')], onDisk);
  assert.equal(r.changed, true);
  assert.equal(r.rows[0].label, 'Bundle frontier · 2/3');
  const unsorted = [meta('findings'), meta('workspace')];
  assert.equal(healCheckpointIndex(unsorted, () => undefined).changed, false);
  assert.equal(healCheckpointIndex(unsorted, null).changed, false);   // not eligible → no disk reads, no heal
});

test('consecutive identical heal lines are coalesced', () => {
  const line = checkpointHealLogLine(3, 'something else');
  assert.match(line ?? '', /checkpoint index healed from disk — 3 cut\(s\)/);
  assert.equal(checkpointHealLogLine(3, line!), null);
  assert.notEqual(checkpointHealLogLine(4, line!), null);   // a different heal is a new event
});

// Count + bytes miss a same-size edit; the content hash does not.
test('dirFingerprint: a same-size edit changes the content hash; identical trees hash equal; over the bound → no hash', () => {
  const d = mkdtempSync(join(tmpdir(), 'theresa-fp-'));
  try {
    mkdirSync(join(d, 'sub'));
    writeFileSync(join(d, 'sub', 'a.txt'), 'abc'); writeFileSync(join(d, 'b.txt'), 'xy');
    const a = dirFingerprint(d)!;
    assert.equal(a.files, 2); assert.equal(a.bytes, 5); assert.ok(a.hash);
    assert.equal(dirFingerprint(d)!.hash, a.hash, 'deterministic');
    writeFileSync(join(d, 'sub', 'a.txt'), 'abd');
    const b = dirFingerprint(d)!;
    assert.equal(b.bytes, a.bytes); assert.notEqual(b.hash, a.hash);
    assert.equal(dirFingerprint(d, { maxBytes: 1 })!.hash, undefined);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
