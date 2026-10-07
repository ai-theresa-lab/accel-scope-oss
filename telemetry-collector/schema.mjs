// Telemetry event schema shared by the collector (server.mjs) and checked against the client
// (src/telemetry.ts) by src/telemetry.schema.test.ts. Keep the two in sync: every constant here has a twin
// in the client, and the test fails if the field lists, enums or limits drift apart.
//
// validateEvent() is strict: unknown top-level fields and unknown `findings` keys are DROPPED, while a known
// field with an invalid value REJECTS the whole event (the server answers 400).

export const FIELD_NAMES = Object.freeze([
  'installId', 'version', 'os', 'arch', 'node', 'event', 'bundles', 'connectorKinds', 'durationSec',
  'costBucket', 'findings', 'degradedStages', 'failedStages', 'keyProvider', 'outcome', 'ts',
]);

export const REQUIRED_FIELDS = Object.freeze(['installId', 'version', 'os', 'arch', 'node', 'event', 'ts']);

export const EVENTS = Object.freeze(['start', 'quick-ask', 'full-scan', 'incremental']);
export const CONNECTOR_KINDS = Object.freeze([
  'github', 'giturl', 'local', 'warehouse', 'keyvalue', 'analytics', 'bi', 'custom',
]);
export const COST_BUCKETS = Object.freeze(['0', '<1', '1-5', '5-10', '10-30', '30-100', '100+']);
export const SEVERITY_KEYS = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);
export const LENS_KEYS = Object.freeze(['business', 'security', 'engineering']);
export const FINDINGS_KEYS = Object.freeze([...SEVERITY_KEYS, ...LENS_KEYS]);
export const KEY_PROVIDERS = Object.freeze(['anthropic', 'anthropic+openai', 'claude-subscription', 'unknown']);
export const OUTCOMES = Object.freeze(['complete', 'error', 'stopped']);

export const ID_LIST_RE = /^[a-z0-9-]{1,40}$/;
export const ID_LIST_MAX = 20;
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const VERSION_RE = /^[0-9A-Za-z.+-]{1,40}$/;
export const PLATFORM_RE = /^[a-z0-9_]{1,20}$/;
export const HOUR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$/;
export const MAX_DURATION_SEC = 30 * 24 * 3600;
export const MAX_FINDINGS_COUNT = 100000;
export const MAX_NODE_MAJOR = 999;
export const MAX_BODY_BYTES = 4096;

const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function idList(name, v) {
  if (!Array.isArray(v)) return `${name} must be an array`;
  if (v.length > ID_LIST_MAX) return `${name} has too many entries`;
  for (const s of v) if (typeof s !== 'string' || !ID_LIST_RE.test(s)) return `${name} has an invalid entry`;
  return null;
}

/**
 * Validate one decoded JSON event. Returns { ok: true, event } with ONLY whitelisted fields, or
 * { ok: false, error } (a short static message: it never echoes the submitted value).
 */
export function validateEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object' };
  const out = {};
  for (const f of REQUIRED_FIELDS) if (raw[f] === undefined || raw[f] === null) return { ok: false, error: `missing ${f}` };

  if (typeof raw.installId !== 'string' || !UUID_V4_RE.test(raw.installId)) return { ok: false, error: 'invalid installId' };
  out.installId = raw.installId;
  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) return { ok: false, error: 'invalid version' };
  out.version = raw.version;
  if (typeof raw.os !== 'string' || !PLATFORM_RE.test(raw.os)) return { ok: false, error: 'invalid os' };
  out.os = raw.os;
  if (typeof raw.arch !== 'string' || !PLATFORM_RE.test(raw.arch)) return { ok: false, error: 'invalid arch' };
  out.arch = raw.arch;
  if (!isInt(raw.node, 0, MAX_NODE_MAJOR)) return { ok: false, error: 'invalid node' };
  out.node = raw.node;
  if (!EVENTS.includes(raw.event)) return { ok: false, error: 'invalid event' };
  out.event = raw.event;
  if (typeof raw.ts !== 'string' || !HOUR_TS_RE.test(raw.ts) || Number.isNaN(Date.parse(raw.ts))) return { ok: false, error: 'invalid ts' };
  out.ts = new Date(raw.ts).toISOString();

  for (const f of ['bundles', 'degradedStages', 'failedStages']) {
    if (raw[f] === undefined || raw[f] === null) continue;
    const err = idList(f, raw[f]);
    if (err) return { ok: false, error: err };
    out[f] = [...raw[f]];
  }
  if (raw.connectorKinds !== undefined && raw.connectorKinds !== null) {
    if (!Array.isArray(raw.connectorKinds) || raw.connectorKinds.length > CONNECTOR_KINDS.length) return { ok: false, error: 'invalid connectorKinds' };
    for (const k of raw.connectorKinds) if (!CONNECTOR_KINDS.includes(k)) return { ok: false, error: 'invalid connectorKinds' };
    out.connectorKinds = [...new Set(raw.connectorKinds)];
  }
  if (raw.durationSec !== undefined && raw.durationSec !== null) {
    if (!isInt(raw.durationSec, 0, MAX_DURATION_SEC)) return { ok: false, error: 'invalid durationSec' };
    out.durationSec = raw.durationSec;
  }
  if (raw.costBucket !== undefined && raw.costBucket !== null) {
    if (!COST_BUCKETS.includes(raw.costBucket)) return { ok: false, error: 'invalid costBucket' };
    out.costBucket = raw.costBucket;
  }
  if (raw.findings !== undefined && raw.findings !== null) {
    if (typeof raw.findings !== 'object' || Array.isArray(raw.findings)) return { ok: false, error: 'invalid findings' };
    const f = {};
    for (const k of FINDINGS_KEYS) {
      const v = raw.findings[k];
      if (v === undefined || v === null) continue;
      if (!isInt(v, 0, MAX_FINDINGS_COUNT)) return { ok: false, error: 'invalid findings' };
      f[k] = v;
    }
    out.findings = f;
  }
  if (raw.keyProvider !== undefined && raw.keyProvider !== null) {
    if (!KEY_PROVIDERS.includes(raw.keyProvider)) return { ok: false, error: 'invalid keyProvider' };
    out.keyProvider = raw.keyProvider;
  }
  if (raw.outcome !== undefined && raw.outcome !== null) {
    if (!OUTCOMES.includes(raw.outcome)) return { ok: false, error: 'invalid outcome' };
    out.outcome = raw.outcome;
  }
  return { ok: true, event: out };
}

/** Map a validated event to a BigQuery row (see bq-schema.json). `receivedDate` is the server's UTC date. */
export function toRow(event, receivedAt = new Date()) {
  const row = {
    receivedDate: receivedAt.toISOString().slice(0, 10),
    ts: event.ts,
    installId: event.installId,
    version: event.version,
    os: event.os,
    arch: event.arch,
    node: event.node,
    event: event.event,
    bundles: event.bundles ?? [],
    connectorKinds: event.connectorKinds ?? [],
    degradedStages: event.degradedStages ?? [],
    failedStages: event.failedStages ?? [],
  };
  if (event.durationSec !== undefined) row.durationSec = event.durationSec;
  if (event.costBucket !== undefined) row.costBucket = event.costBucket;
  if (event.keyProvider !== undefined) row.keyProvider = event.keyProvider;
  if (event.outcome !== undefined) row.outcome = event.outcome;
  if (event.findings !== undefined) row.findings = { ...event.findings };
  return row;
}
