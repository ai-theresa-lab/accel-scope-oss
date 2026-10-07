// Telemetry collector: one route, POST /v1/events (+ GET /health; /healthz too, but Cloud Run reserves paths ending in z).
//
// Privacy rules enforced by this file:
//  - It never reads the client IP (no req.socket.remoteAddress, no x-forwarded-for) and never reads any request
//    header other than content-type and content-length.
//  - It never logs request bodies or field values; logs carry counts and error names only.
//  - Only fields on the schema whitelist (schema.mjs) are stored; unknown fields are dropped.
// Cloud Run's own request logs DO record client IPs; deploy.sh adds a Cloud Logging exclusion for them.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MAX_BODY_BYTES, toRow, validateEvent } from './schema.mjs';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function log(event, fields = {}) {
  process.stdout.write(JSON.stringify({ component: 'telemetry-collector', event, ...fields }) + '\n');
}

/**
 * In-memory fixed-window rate limiter: `perInstallPerHour` events per installId per hour, and a global cap of
 * `globalPerMinute` events per minute. Returns 'ok' | 'install' | 'global'.
 */
export function createRateLimiter({ perInstallPerHour = 60, globalPerMinute = 1200, maxKeys = 50000, now = () => Date.now() } = {}) {
  const HOUR = 3600_000;
  const MIN = 60_000;
  const perInstall = new Map(); // installId -> { start, count }
  let globalWin = { start: 0, count: 0 };

  function prune(t) {
    for (const [k, w] of perInstall) if (t - w.start >= HOUR) perInstall.delete(k);
  }

  return {
    allow(installId) {
      const t = now();
      if (t - globalWin.start >= MIN) globalWin = { start: t, count: 0 };
      if (globalWin.count >= globalPerMinute) return 'global';
      let w = perInstall.get(installId);
      if (!w || t - w.start >= HOUR) {
        if (!w && perInstall.size >= maxKeys) {
          prune(t);
          if (perInstall.size >= maxKeys) return 'global';
        }
        w = { start: t, count: 0 };
        perInstall.set(installId, w);
      }
      if (w.count >= perInstallPerHour) return 'install';
      w.count++;
      globalWin.count++;
      return 'ok';
    },
    size() { return perInstall.size; },
  };
}

/**
 * Buffers rows and hands them to `write(rows)` in batches: when `maxRows` are buffered, or `intervalMs` after the
 * first buffered row (checked by a timer and on every add, since Cloud Run may throttle timers between requests).
 * Each row gets a stable insertId so BigQuery dedupes the single retry. The buffer is bounded (oldest dropped).
 */
export function createBatcher({ write, maxRows = 200, intervalMs = 5000, maxBuffer = 10000, now = () => Date.now(), onError = () => {} }) {
  let buf = [];
  let firstAt = 0;
  let inflight = Promise.resolve();
  const timer = setInterval(() => { if (buf.length && now() - firstAt >= intervalMs) void flush(); }, Math.min(intervalMs, 1000));
  timer.unref?.();

  function flush() {
    if (!buf.length) return inflight;
    const rows = buf;
    buf = [];
    firstAt = 0;
    inflight = inflight.then(async () => {
      try {
        await write(rows);
      } catch (e1) {
        try {
          await write(rows); // one retry; same insertIds => BigQuery dedupes
        } catch (e2) {
          onError(e2, rows.length);
        }
      }
    });
    return inflight;
  }

  return {
    add(json) {
      if (!buf.length) firstAt = now();
      buf.push({ insertId: randomUUID(), json });
      if (buf.length > maxBuffer) buf.splice(0, buf.length - maxBuffer);
      if (buf.length >= maxRows || now() - firstAt >= intervalMs) void flush();
    },
    flush,
    pending() { return buf.length; },
    async close() { clearInterval(timer); await flush(); },
  };
}

/** BigQuery streaming writer (insertAll with insertId). Imported lazily so tests never need the package. */
export async function createBigQueryWriter({ dataset, table }) {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const bq = new BigQuery(); // project + credentials from ADC
  const t = bq.dataset(dataset).table(table);
  return async (rows) => {
    await t.insert(rows, { raw: true, skipInvalidRows: false, ignoreUnknownValues: false });
  };
}

function send(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

/** The request handler. `limiter` and `batcher` are injected so tests run without network. */
export function createHandler({ limiter, batcher, now = () => new Date() }) {
  return (req, res) => {
    const url = req.url || '/';
    const path = url.split('?')[0];
    if (path === '/health' || path === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      return send(res, 200, { ok: true });
    }
    if (path !== '/v1/events') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') { req.resume(); return send(res, 415, { error: 'content-type must be application/json' }); }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) { req.resume(); return send(res, 413, { error: 'body too large' }); }

    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        send(res, 413, { error: 'body too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('error', () => { done = true; });
    req.on('end', () => {
      if (done) return;
      done = true;
      let raw;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'invalid json' });
      }
      const v = validateEvent(raw);
      if (!v.ok) return send(res, 400, { error: v.error });
      const verdict = limiter.allow(v.event.installId);
      if (verdict !== 'ok') return send(res, 429, { error: 'rate limited' });
      batcher.add(toRow(v.event, now()));
      return send(res, 202, { ok: true });
    });
  };
}

async function main() {
  const dataset = process.env.BQ_DATASET || 'accel_scope_telemetry';
  const table = process.env.BQ_TABLE || 'events';
  const port = Number(process.env.PORT) || 8080;
  const write = await createBigQueryWriter({ dataset, table });
  const batcher = createBatcher({
    write: async (rows) => { await write(rows); log('flush', { rows: rows.length }); },
    onError: (e, n) => log('insert-failed', { rows: n, error: e?.name || 'Error', code: e?.code }),
  });
  const limiter = createRateLimiter({
    perInstallPerHour: Number(process.env.RATE_PER_INSTALL_HOUR) || 60,
    globalPerMinute: Number(process.env.RATE_GLOBAL_MINUTE) || 1200,
  });
  const server = createServer(createHandler({ limiter, batcher }));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.listen(port, () => log('listening', { port, dataset, table }));

  const shutdown = async () => {
    log('shutdown', { pending: batcher.pending() });
    server.close();
    await batcher.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { log('fatal', { error: e?.name || 'Error', message: String(e?.message || '').slice(0, 200) }); process.exit(1); });
}
