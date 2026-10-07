import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEvent, costBucket, examplePayload, markNoticeShown, setTelemetryEnabled, telemetryEnabled, telemetryNotice,
  telemetryStatus, track, TELEMETRY_FIELDS, DEFAULT_TELEMETRY_URL, CONNECTOR_KINDS, COST_BUCKETS, KEY_PROVIDERS,
  OUTCOMES, TELEMETRY_EVENTS, FINDINGS_KEYS, type FetchLike,
} from './telemetry.ts';

const ENV_KEYS = ['THERESA_DATA_DIR', 'THERESA_TELEMETRY', 'THERESA_TELEMETRY_URL', 'THERESA_TELEMETRY_PRINT', 'DO_NOT_TRACK'];
let saved: Record<string, string | undefined> = {};
let dir = '';

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), 'telemetry-'));
  process.env.THERESA_DATA_DIR = dir;
  // The built-in endpoint is empty until the collector is deployed; sending tests point at a test collector.
  process.env.THERESA_TELEMETRY_URL = 'https://collector.example.test/v1/events';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const UUID = '3f8b2c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b';
const ALLOWED = new Set(TELEMETRY_FIELDS.map((f) => f.name as string));
const SECRETS = ['acme-corp/private-repo', '/home/alice/src', 'how do we leak data?', 'ghp_abcdefSECRET', 'alice@example.com', '10.0.0.7', 'build-host-01', 'sk-ant\x2dapi03-SECRET'];

function assertSchema(e: Record<string, unknown>): void {
  for (const k of Object.keys(e)) assert.ok(ALLOWED.has(k), `unexpected field ${k}`);
  assert.match(e.installId as string, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(e.version as string, /^[0-9A-Za-z.+-]{1,40}$/);
  assert.equal(typeof e.os, 'string');
  assert.equal(typeof e.arch, 'string');
  assert.ok(Number.isInteger(e.node));
  assert.ok((TELEMETRY_EVENTS as readonly string[]).includes(e.event as string));
  assert.match(e.ts as string, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
  for (const f of ['bundles', 'degradedStages', 'failedStages']) {
    if (e[f] === undefined) continue;
    const arr = e[f] as unknown[];
    assert.ok(Array.isArray(arr) && arr.length <= 20);
    for (const s of arr) assert.match(s as string, /^[a-z0-9-]{1,40}$/);
  }
  if (e.connectorKinds !== undefined) for (const k of e.connectorKinds as string[]) assert.ok((CONNECTOR_KINDS as readonly string[]).includes(k));
  if (e.durationSec !== undefined) assert.ok(Number.isInteger(e.durationSec) && (e.durationSec as number) >= 0);
  if (e.costBucket !== undefined) assert.ok((COST_BUCKETS as readonly string[]).includes(e.costBucket as string));
  if (e.keyProvider !== undefined) assert.ok((KEY_PROVIDERS as readonly string[]).includes(e.keyProvider as string));
  if (e.outcome !== undefined) assert.ok((OUTCOMES as readonly string[]).includes(e.outcome as string));
  if (e.findings !== undefined) {
    for (const [k, v] of Object.entries(e.findings as object)) {
      assert.ok((FINDINGS_KEYS as readonly string[]).includes(k), `findings key ${k}`);
      assert.ok(Number.isInteger(v) && v >= 0);
    }
  }
}

test('costBucket maps USD to the fixed buckets', () => {
  assert.equal(costBucket(0), '0');
  assert.equal(costBucket(0.01), '<1');
  assert.equal(costBucket(0.999), '<1');
  assert.equal(costBucket(1), '1-5');
  assert.equal(costBucket(4.99), '1-5');
  assert.equal(costBucket(5), '5-10');
  assert.equal(costBucket(10), '10-30');
  assert.equal(costBucket(29.9), '10-30');
  assert.equal(costBucket(30), '30-100');
  assert.equal(costBucket(100), '100+');
  assert.equal(costBucket(12345), '100+');
  assert.equal(costBucket(-1), undefined);
  assert.equal(costBucket(Number.NaN), undefined);
  assert.equal(costBucket(Infinity), undefined);
  assert.equal(costBucket('5'), undefined);
});

test('buildEvent never copies unknown fields (repo, path, question, token, ...)', () => {
  const input = {
    event: 'full-scan', bundles: ['appsec'], repo: SECRETS[0], path: SECRETS[1], question: SECRETS[2], token: SECRETS[3],
    email: SECRETS[4], ip: SECRETS[5], hostname: SECRETS[6], apiKey: SECRETS[7], report: '<html>secret</html>',
    installId: 'attacker-chosen', version: 'evil', os: 'evil', ts: '1999-01-01T00:00:00Z',
    findings: { high: 2, title: SECRETS[2], repo: SECRETS[0] },
  };
  const e = buildEvent(input, { installId: UUID, version: '1.2.3', now: new Date('2026-10-05T14:37:12Z') });
  assert.ok(e);
  const json = JSON.stringify(e);
  for (const s of [...SECRETS, 'secret', 'attacker', 'evil', '1999']) assert.ok(!json.includes(s), `leaked ${s}`);
  assertSchema(e as unknown as Record<string, unknown>);
  assert.equal(e.installId, UUID);
  assert.equal(e.version, '1.2.3');
  assert.equal(e.ts, '2026-10-05T14:00:00.000Z');
  assert.deepEqual(e.findings, { high: 2 });
});

test('buildEvent validates every value against its schema', () => {
  const e = buildEvent({
    event: 'incremental',
    bundles: ['appsec', 'Bad Id', '../etc', 'x'.repeat(41), 7, 'swe-arch', 'appsec', ...Array.from({ length: 30 }, (_, i) => `b${i}`)],
    connectorKinds: ['github', 'github', 'gitlab', 'https://example.com', 'warehouse', 'slack', null],
    durationSec: 12.6,
    costUsd: 7.42,
    findings: { critical: 1.4, high: -3, medium: 'many', low: 1e9, info: 0, business: 2, security: Number.NaN },
    degradedStages: ['html-qc', 'Has Space'],
    failedStages: 'normalize',
    keyProvider: 'openai',
    outcome: 'crashed',
  }, { installId: UUID });
  assert.ok(e);
  assertSchema(e as unknown as Record<string, unknown>);
  assert.equal(e.bundles!.length, 20);
  assert.deepEqual(e.bundles!.slice(0, 3), ['appsec', 'swe-arch', 'b0']);
  assert.deepEqual(e.connectorKinds, ['github', 'warehouse']);
  assert.equal(e.durationSec, 13);
  assert.equal(e.costBucket, '5-10');
  assert.deepEqual(e.findings, { critical: 1, low: 100000, info: 0, business: 2 });
  assert.deepEqual(e.degradedStages, ['html-qc']);
  assert.equal(e.failedStages, undefined);
  assert.equal(e.keyProvider, undefined);
  assert.equal(e.outcome, undefined);
});

test('buildEvent rejects unknown events and accepts an explicit costBucket', () => {
  assert.equal(buildEvent({ event: 'exfiltrate' }), null);
  assert.equal(buildEvent({}), null);
  assert.equal(buildEvent(null as never), null);
  const e = buildEvent({ event: 'start', costBucket: '30-100', costUsd: 1 }, { installId: UUID });
  assert.equal(e?.costBucket, '30-100');
});

test('examplePayload is schema-valid and every documented field is covered', () => {
  const e = examplePayload();
  assertSchema(e as unknown as Record<string, unknown>);
  for (const k of Object.keys(e)) assert.ok(TELEMETRY_FIELDS.some((f) => f.name === k));
  assert.equal(new Set(TELEMETRY_FIELDS.map((f) => f.name)).size, TELEMETRY_FIELDS.length);
  for (const f of TELEMETRY_FIELDS) assert.ok(f.description.length > 10);
});

test('enabled by default; env off values win over the persisted setting', () => {
  assert.equal(telemetryEnabled(), true);
  for (const v of ['0', 'off', 'FALSE', ' no ']) {
    process.env.THERESA_TELEMETRY = v;
    assert.equal(telemetryEnabled(), false, v);
  }
  process.env.THERESA_TELEMETRY = '1';
  assert.equal(telemetryEnabled(), true);
  assert.equal(setTelemetryEnabled(true), true);
  process.env.THERESA_TELEMETRY = 'off';
  assert.equal(telemetryEnabled(), false, 'env off beats a persisted on');
  assert.equal(telemetryStatus().envDisabled, true);
  delete process.env.THERESA_TELEMETRY;
  process.env.DO_NOT_TRACK = '1';
  assert.equal(telemetryEnabled(), false);
});

test('setting persists in <data dir>/telemetry.json with the install id and noticeShown', () => {
  const st = telemetryStatus();
  assert.equal(st.enabled, true);
  assert.equal(st.noticeShown, false);
  assert.equal(st.endpoint, 'https://collector.example.test/v1/events');
  assert.match(st.installId!, /^[0-9a-f-]{36}$/);
  assert.equal(telemetryStatus().installId, st.installId, 'id is stable');
  markNoticeShown();
  const file = join(dir, 'telemetry.json');
  const saved1 = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved1.installId, st.installId);
  assert.equal(saved1.noticeShown, true);

  assert.equal(setTelemetryEnabled(false), false);
  assert.equal(telemetryEnabled(), false);
  const off = telemetryStatus();
  assert.equal(off.installId, null, 'turning off forgets the id');
  assert.equal(off.noticeShown, true);
  assert.equal(setTelemetryEnabled(true), true);
  assert.notEqual(telemetryStatus().installId, st.installId, 're-enabling mints a fresh id');
});

test('a corrupt state file falls back to defaults', () => {
  writeFileSync(join(dir, 'telemetry.json'), '{not json');
  assert.equal(telemetryEnabled(), true);
  assert.equal(telemetryStatus().noticeShown, false);
});

test('THERESA_TELEMETRY_URL overrides the endpoint; garbage falls back', () => {
  process.env.THERESA_TELEMETRY_URL = 'https://collector.example.test/v1/events';
  assert.equal(telemetryStatus().endpoint, 'https://collector.example.test/v1/events');
  process.env.THERESA_TELEMETRY_URL = 'file:///etc/passwd';
  assert.equal(telemetryStatus().endpoint, DEFAULT_TELEMETRY_URL);
});

test('track posts the whitelisted payload with minimal headers', async () => {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => { calls.push({ url, init }); return { status: 202 }; };
  const ok = await track('quick-ask', { bundles: ['appsec'], repo: 'acme/private', question: 'secret?' } as never, { fetch });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://collector.example.test/v1/events');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.deepEqual(Object.keys(calls[0]!.init.headers).sort(), ['content-type', 'user-agent']);
  assert.equal(calls[0]!.init.headers['content-type'], 'application/json');
  assert.match(calls[0]!.init.headers['user-agent']!, /^accel-scope\/\S+$/);
  assert.equal(calls[0]!.init.credentials, 'omit');
  const body = JSON.parse(calls[0]!.init.body);
  assertSchema(body);
  assert.equal(body.event, 'quick-ask');
  assert.equal(body.installId, telemetryStatus().installId);
  assert.ok(!calls[0]!.init.body.includes('acme') && !calls[0]!.init.body.includes('secret'));
});

test('track sends nothing when disabled (env or setting)', async () => {
  let n = 0;
  const fetch: FetchLike = async () => { n++; return { status: 202 }; };
  process.env.THERESA_TELEMETRY = '0';
  assert.equal(await track('start', {}, { fetch }), false);
  delete process.env.THERESA_TELEMETRY;
  setTelemetryEnabled(false);
  assert.equal(await track('start', {}, { fetch }), false);
  assert.equal(n, 0);
  assert.equal(existsSync(join(dir, 'telemetry.json')) && JSON.parse(readFileSync(join(dir, 'telemetry.json'), 'utf8')).installId, undefined);
});

test('track skips the network under node --test unless a fetch is injected', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test', 'this file runs under node --test');
  const realFetch = globalThis.fetch;
  let hit = false;
  globalThis.fetch = (async () => { hit = true; return new Response(null, { status: 202 }); }) as typeof fetch;
  try {
    assert.equal(await track('start'), false);
    assert.equal(hit, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('track never throws or rejects: network error, timeout-style abort, bad status, sync throw', async () => {
  assert.equal(await track('start', {}, { fetch: async () => { throw new Error('ECONNREFUSED'); } }), false);
  assert.equal(await track('start', {}, { fetch: () => { throw new Error('sync'); } }), false);
  assert.equal(await track('start', {}, { fetch: async () => ({ status: 500 }) }), false);
  assert.equal(await track('start', {}, { fetch: async () => null }), false);
  assert.equal(await track('bogus' as never, {}, { fetch: async () => ({ status: 202 }) }), false);
  let signal: AbortSignal | undefined;
  await track('start', {}, { fetch: async (_u, init) => { signal = init.signal; return { status: 202 }; } });
  assert.ok(signal instanceof AbortSignal, 'a timeout signal is attached');
});

test('print mode writes one [telemetry] JSON line to stderr, identical to the body sent', async () => {
  process.env.THERESA_TELEMETRY_PRINT = '1';
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; };
  let sent = '';
  try {
    await track('full-scan', { outcome: 'complete', costUsd: 0 }, { fetch: async (_u, init) => { sent = init.body; return { status: 202 }; } });
  } finally {
    (process.stderr as { write: unknown }).write = orig;
  }
  const tl = lines.filter((l) => l.startsWith('[telemetry] '));
  assert.equal(tl.length, 1);
  assert.equal(tl[0], `[telemetry] ${sent}\n`);
  assert.equal(JSON.parse(sent).costBucket, '0');
});

test('telemetryNotice lists the fields and the opt-out, with no CJK', () => {
  const n = telemetryNotice();
  assert.match(n, /THERESA_TELEMETRY=0/);
  assert.match(n, /--print-telemetry/);
  assert.match(n, /install ID/i);
  assert.match(n, /Never sent/);
  assert.doesNotMatch(n, /[\u3000-\u9fff]/);
});

test('the built-in endpoint is the project collector over https', () => {
  delete process.env.THERESA_TELEMETRY_URL;
  assert.match(DEFAULT_TELEMETRY_URL, /^https:\/\/[a-z0-9.-]+\/v1\/events$/);
  assert.equal(telemetryStatus().endpoint, DEFAULT_TELEMETRY_URL);
});
