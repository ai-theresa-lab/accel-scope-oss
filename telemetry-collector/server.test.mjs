import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createBatcher, createHandler, createRateLimiter } from './server.mjs';
import { FIELD_NAMES, toRow, validateEvent } from './schema.mjs';

const UUID = '3f8b2c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b';
const good = () => ({
  installId: UUID, version: '0.1.0', os: 'linux', arch: 'x64', node: 22, event: 'full-scan',
  bundles: ['appsec', 'swe-arch'], connectorKinds: ['github'], durationSec: 120, costBucket: '1-5',
  findings: { high: 2, security: 1 }, degradedStages: ['html-qc'], failedStages: [], keyProvider: 'anthropic',
  outcome: 'complete', ts: '2026-10-05T14:00:00.000Z',
});

test('validateEvent accepts a good event and drops unknown fields', () => {
  const v = validateEvent({ ...good(), repo: 'acme/private', ip: '1.2.3.4', findings: { high: 2, security: 1, title: 'x' } });
  assert.ok(v.ok);
  for (const k of Object.keys(v.event)) assert.ok(FIELD_NAMES.includes(k));
  assert.equal(v.event.repo, undefined);
  assert.deepEqual(v.event.findings, { high: 2, security: 1 });
});

test('validateEvent rejects invalid values', () => {
  const bad = [
    { installId: 'not-a-uuid' }, { installId: undefined }, { event: 'other' }, { node: 22.5 }, { node: -1 },
    { os: 'Linux Mint' }, { version: 'a b' }, { ts: '2026-10-05T14:37:00.000Z' }, { ts: 'yesterday' },
    { bundles: ['Bad Id'] }, { bundles: Array.from({ length: 21 }, (_, i) => `b${i}`) }, { bundles: 'appsec' },
    { connectorKinds: ['gitlab'] }, { durationSec: 1.5 }, { durationSec: -1 }, { costBucket: '7.42' },
    { findings: { high: -1 } }, { findings: { high: 1.5 } }, { findings: [1] }, { keyProvider: 'openai' },
    { outcome: 'crashed' }, { failedStages: [1] },
  ];
  for (const patch of bad) {
    const v = validateEvent({ ...good(), ...patch });
    assert.equal(v.ok, false, JSON.stringify(patch));
    assert.ok(!v.error.includes('Bad Id') && !v.error.includes('gitlab'), 'errors never echo values');
  }
  assert.equal(validateEvent(null).ok, false);
  assert.equal(validateEvent([good()]).ok, false);
});

test('toRow adds receivedDate and matches bq-schema.json columns', () => {
  const v = validateEvent(good());
  assert.ok(v.ok);
  const row = toRow(v.event, new Date('2026-10-06T00:30:00Z'));
  assert.equal(row.receivedDate, '2026-10-06');
  const schema = JSON.parse(readFileSync(new URL('./bq-schema.json', import.meta.url), 'utf8'));
  const cols = new Set(schema.map((c) => c.name));
  for (const k of Object.keys(row)) assert.ok(cols.has(k), `column ${k} missing from bq-schema.json`);
  for (const f of FIELD_NAMES) assert.ok(cols.has(f), `field ${f} missing from bq-schema.json`);
  const findings = schema.find((c) => c.name === 'findings');
  for (const k of Object.keys(row.findings)) assert.ok(findings.fields.some((f) => f.name === k));
});

test('rate limiter: per-install hourly cap, window reset, global cap', () => {
  let t = 0;
  const rl = createRateLimiter({ perInstallPerHour: 3, globalPerMinute: 5, now: () => t });
  assert.equal(rl.allow('a'), 'ok');
  assert.equal(rl.allow('a'), 'ok');
  assert.equal(rl.allow('a'), 'ok');
  assert.equal(rl.allow('a'), 'install');
  assert.equal(rl.allow('b'), 'ok');
  assert.equal(rl.allow('c'), 'ok');
  assert.equal(rl.allow('d'), 'global', 'global cap of 5/min reached');
  t += 60_000;
  assert.equal(rl.allow('d'), 'ok', 'global window resets after a minute');
  assert.equal(rl.allow('a'), 'install', 'install window still closed');
  t += 3600_000;
  assert.equal(rl.allow('a'), 'ok', 'install window resets after an hour');
});

test('rate limiter bounds its key map', () => {
  let t = 0;
  const rl = createRateLimiter({ maxKeys: 2, globalPerMinute: 1e6, now: () => t });
  assert.equal(rl.allow('a'), 'ok');
  assert.equal(rl.allow('b'), 'ok');
  assert.equal(rl.allow('c'), 'global');
  t += 3600_000;
  assert.equal(rl.allow('c'), 'ok', 'expired keys are pruned');
  assert.ok(rl.size() <= 2);
});

test('batcher flushes at maxRows, on interval, on close; retries once with the same insertIds', async () => {
  let t = 0;
  const batches = [];
  let failNext = 1;
  const b = createBatcher({
    maxRows: 3, intervalMs: 5000, now: () => t,
    write: async (rows) => {
      if (failNext-- > 0) throw new Error('transient');
      batches.push(rows);
    },
  });
  b.add({ n: 1 }); b.add({ n: 2 });
  assert.equal(b.pending(), 2);
  b.add({ n: 3 });
  await b.flush();
  assert.equal(batches.length, 1, 'flushed at maxRows after one retry');
  assert.deepEqual(batches[0].map((r) => r.json.n), [1, 2, 3]);
  assert.ok(batches[0].every((r) => typeof r.insertId === 'string' && r.insertId.length === 36));

  b.add({ n: 4 });
  t += 5000;
  b.add({ n: 5 }); // the add itself notices the interval elapsed
  await b.flush();
  assert.deepEqual(batches[1].map((r) => r.json.n), [4, 5]);

  b.add({ n: 6 });
  await b.close();
  assert.deepEqual(batches[2].map((r) => r.json.n), [6]);
});

test('batcher reports a failed retry and keeps going', async () => {
  const errs = [];
  const b = createBatcher({ maxRows: 1, write: async () => { throw new Error('down'); }, onError: (e, n) => errs.push(n) });
  b.add({ n: 1 });
  await b.close();
  assert.deepEqual(errs, [1]);
});

async function withServer(fn, { limiter } = {}) {
  const rows = [];
  const batcher = { add: (r) => rows.push(r), pending: () => 0 };
  const server = createServer(createHandler({ limiter: limiter ?? createRateLimiter(), batcher, now: () => new Date('2026-10-05T15:00:00Z') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, rows);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base, body, ctype = 'application/json') =>
  fetch(`${base}/v1/events`, { method: 'POST', headers: { 'content-type': ctype }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('HTTP: 202 for a good event, stored row is whitelisted', async () => {
  await withServer(async (base, rows) => {
    const r = await post(base, { ...good(), repo: 'acme/private', path: '/home/alice' });
    assert.equal(r.status, 202);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].receivedDate, '2026-10-05');
    assert.ok(!JSON.stringify(rows[0]).includes('acme') && !JSON.stringify(rows[0]).includes('alice'));
    const h = await fetch(`${base}/health`);
    assert.equal(h.status, 200);
  });
});

test('HTTP: rejects wrong content-type, bad JSON, invalid values, oversize bodies, other routes', async () => {
  await withServer(async (base, rows) => {
    assert.equal((await post(base, good(), 'text/plain')).status, 415);
    assert.equal((await post(base, '{nope')).status, 400);
    assert.equal((await post(base, { ...good(), event: 'nope' })).status, 400);
    assert.equal((await post(base, { ...good(), pad: 'x'.repeat(5000) })).status, 413);
    assert.equal((await fetch(`${base}/v1/events`)).status, 405);
    assert.equal((await fetch(`${base}/other`, { method: 'POST' })).status, 404);
    assert.equal(rows.length, 0);
  });
});

test('HTTP: 429 once an install exceeds its hourly cap', async () => {
  await withServer(async (base, rows) => {
    assert.equal((await post(base, good())).status, 202);
    assert.equal((await post(base, good())).status, 202);
    assert.equal((await post(base, good())).status, 429);
    assert.equal(rows.length, 2);
  }, { limiter: createRateLimiter({ perInstallPerHour: 2 }) });
});

test('server source never touches client IPs or other headers', () => {
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /remoteAddress|x-forwarded-for|x-real-ip|req\.socket|req\.connection|rawHeaders/i);
  const headerReads = [...src.matchAll(/req\.headers\[['"]([^'"]+)['"]\]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(headerReads)].sort(), ['content-length', 'content-type']);
  assert.doesNotMatch(src, /req\.headers(?!\[)/);
});
