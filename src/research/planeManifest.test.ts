import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPlaneManifest, currentPlaneManifest, planeHints, type PlaneInfo } from './planeManifest.ts';

const PLANES: PlaneInfo[] = [
  { serverName: 'warehouse', kind: 'warehouse', exposes: 'BigQuery SQL' },
  { serverName: 'amplitude', kind: 'analytics', exposes: 'product analytics: funnels, DAU, retention' },
  { serverName: 'acmedash', kind: 'bi', exposes: 'BI dashboard: experiment readouts, DQ notes' },
];

// ── Outside a run context: legacy fallback (the CLI paths never set the manifest) ───────────────────
test('planeHints: outside a run returns the caller legacy string verbatim (empty default)', () => {
  assert.equal(currentPlaneManifest().length, 0);
  assert.equal(planeHints(), '');
  assert.equal(planeHints('a READ-ONLY warehouse (SQL via a mounted MCP).'), 'a READ-ONLY warehouse (SQL via a mounted MCP).');
});

// ── Inside a run context: lists every mounted plane by mcp__<server>__* + what it exposes ────────────
test('planeHints: inside withPlaneManifest lists each plane and ignores the legacy string', async () => {
  await withPlaneManifest(PLANES, async () => {
    assert.equal(currentPlaneManifest().length, 3);
    const hints = planeHints('LEGACY TEXT THAT MUST NOT APPEAR');
    assert.ok(!hints.includes('LEGACY TEXT'), 'legacy string is ignored when a manifest is set');
    // every plane is described by its real mcp__<server>__* prefix + its exposes line
    for (const p of PLANES) {
      assert.ok(hints.includes(`mcp__${p.serverName}__*`), `lists ${p.serverName}`);
      assert.ok(hints.includes(p.exposes), `describes ${p.serverName}`);
    }
    // an analytics plane is NOT mislabeled as warehouse SQL 
    assert.ok(hints.toLowerCase().includes('product analytics'));
  });
});

// ── [] ENTERS an empty manifest (overrides any outer one → legacy); undefined inherits (no-op) ────────
test('withPlaneManifest: [] enters an empty manifest and undefined inherits — both yield the legacy hint at top level', async () => {
  await withPlaneManifest([], async () => {
    assert.equal(currentPlaneManifest().length, 0);
    assert.equal(planeHints('legacy'), 'legacy');
  });
  await withPlaneManifest(undefined, async () => {
    assert.equal(planeHints('legacy'), 'legacy');
  });
});

// ── A nested [] OVERRIDES an outer manifest (the fail-open fallback rebuilds a different mcpServers set) ─
test('withPlaneManifest: nested [] overrides an outer manifest so a fallback never advertises unmounted planes', async () => {
  await withPlaneManifest(PLANES, async () => {
    assert.equal(currentPlaneManifest().length, 3);
    await withPlaneManifest([], async () => {
      assert.equal(currentPlaneManifest().length, 0, 'inner [] clears the outer 3-plane manifest');
      assert.equal(planeHints('legacy'), 'legacy');
    });
    assert.equal(currentPlaneManifest().length, 3, 'outer manifest restored after the nested scope');
  });
});

// ── ALS isolation: the manifest does not leak out of its run scope ──────────────────────────────────
test('planeManifest: scope is restored after the run body returns', async () => {
  await withPlaneManifest(PLANES, async () => {
    assert.equal(currentPlaneManifest().length, 3);
  });
  assert.equal(currentPlaneManifest().length, 0, 'manifest cleared once the run scope exits');
});
