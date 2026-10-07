import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as client from './telemetry.ts';
import * as collector from '../telemetry-collector/schema.mjs';

// The client (src/telemetry.ts) and the collector (telemetry-collector/schema.mjs) each carry the telemetry schema.
// They must agree exactly, or the collector rejects what the client sends (or the docs promise fields that are dropped).

const UUID = '3f8b2c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b';

test('field lists agree', () => {
  assert.deepEqual([...client.TELEMETRY_FIELDS.map((f) => f.name)].sort(), [...collector.FIELD_NAMES].sort());
});

test('enums and limits agree', () => {
  assert.deepEqual([...client.TELEMETRY_EVENTS], [...collector.EVENTS]);
  assert.deepEqual([...client.CONNECTOR_KINDS], [...collector.CONNECTOR_KINDS]);
  assert.deepEqual([...client.COST_BUCKETS], [...collector.COST_BUCKETS]);
  assert.deepEqual([...client.SEVERITY_KEYS], [...collector.SEVERITY_KEYS]);
  assert.deepEqual([...client.LENS_KEYS], [...collector.LENS_KEYS]);
  assert.deepEqual([...client.FINDINGS_KEYS], [...collector.FINDINGS_KEYS]);
  assert.deepEqual([...client.KEY_PROVIDERS], [...collector.KEY_PROVIDERS]);
  assert.deepEqual([...client.OUTCOMES], [...collector.OUTCOMES]);
  assert.equal(client.ID_LIST_RE.source, collector.ID_LIST_RE.source);
  assert.equal(client.ID_LIST_MAX, collector.ID_LIST_MAX);
  assert.equal(client.MAX_DURATION_SEC, collector.MAX_DURATION_SEC);
  assert.equal(client.MAX_FINDINGS_COUNT, collector.MAX_FINDINGS_COUNT);
});

test('every client payload passes the collector validator unchanged', () => {
  const ex = collector.validateEvent(client.examplePayload());
  assert.ok(ex.ok);
  assert.deepEqual(ex.event, client.examplePayload());

  const inputs: client.TelemetryInput[] = [
    { event: 'start' },
    { event: 'quick-ask', bundles: [], connectorKinds: [], findings: {}, outcome: 'error', keyProvider: 'unknown' },
    { event: 'incremental', bundles: Array.from({ length: 40 }, (_, i) => `b-${i}`), durationSec: 1e12, costUsd: 1e6, findings: { high: 1e12 } },
    { event: 'full-scan', connectorKinds: [...client.CONNECTOR_KINDS, ...client.CONNECTOR_KINDS], keyProvider: 'claude-subscription', outcome: 'stopped' },
  ];
  for (const input of inputs) {
    const e = client.buildEvent(input, { installId: UUID, now: new Date('2026-01-02T03:04:05Z') });
    assert.ok(e);
    const v = collector.validateEvent(JSON.parse(JSON.stringify(e)));
    assert.ok(v.ok, `rejected: ${v.ok ? '' : v.error}`);
    assert.deepEqual(v.event, JSON.parse(JSON.stringify(e)));
  }
});
