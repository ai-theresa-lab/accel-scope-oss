// Anonymous usage telemetry (client side).
//
// ON by default; turned off by env THERESA_TELEMETRY=0|off|false|no (or DO_NOT_TRACK=1), or by the persisted user
// setting (`setTelemetryEnabled(false)`, stored in <data dir>/telemetry.json). Env off always wins.
//
// What is sent is decided by ONE strict whitelist builder, `buildEvent`: every field is re-derived from a typed,
// validated value; anything not on the list (repo names, paths, questions, tokens, ...) is never copied. The collector
// (telemetry-collector/schema.mjs) validates the same schema; src/telemetry.schema.test.ts keeps the two in sync.
//
// `--print-telemetry` (argv) or THERESA_TELEMETRY_PRINT=1 prints every payload to stderr as `[telemetry] <json>`.
// `track()` is fire-and-forget: it never throws, never blocks the caller, never retries, sends no cookies.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The project's collector (telemetry-collector/, Cloud Run). THERESA_TELEMETRY_URL overrides it (e.g. a self-hosted
// collector); an empty override is ignored. Turning telemetry off (env or Settings) sends nothing at all.
export const DEFAULT_TELEMETRY_URL = 'https://accel-scope-telemetry-355207447672.us-central1.run.app/v1/events';
export const TELEMETRY_TIMEOUT_MS = 3000;

// ---- schema (twin of telemetry-collector/schema.mjs) -------------------------------------------------------------

export const TELEMETRY_EVENTS = ['start', 'quick-ask', 'full-scan', 'incremental'] as const;
export const CONNECTOR_KINDS = ['github', 'giturl', 'local', 'warehouse', 'keyvalue', 'analytics', 'bi', 'custom'] as const;
export const COST_BUCKETS = ['0', '<1', '1-5', '5-10', '10-30', '30-100', '100+'] as const;
export const SEVERITY_KEYS = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const LENS_KEYS = ['business', 'security', 'engineering'] as const;
export const FINDINGS_KEYS = [...SEVERITY_KEYS, ...LENS_KEYS] as const;
export const KEY_PROVIDERS = ['anthropic', 'anthropic+openai', 'claude-subscription', 'claude-subscription+openai', 'unknown'] as const;
export const OUTCOMES = ['complete', 'error', 'stopped'] as const;

export const ID_LIST_RE = /^[a-z0-9-]{1,40}$/;
export const ID_LIST_MAX = 20;
export const MAX_DURATION_SEC = 30 * 24 * 3600;
export const MAX_FINDINGS_COUNT = 100000;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,40}$/;
const PLATFORM_RE = /^[a-z0-9_]{1,20}$/;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];
export type CostBucket = (typeof COST_BUCKETS)[number];
export type FindingsKey = (typeof FINDINGS_KEYS)[number];
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
export type Outcome = (typeof OUTCOMES)[number];

/** Exactly what goes on the wire. */
export interface TelemetryEvent {
  installId: string;
  version: string;
  os: string;
  arch: string;
  node: number;
  event: TelemetryEventName;
  bundles?: string[];
  connectorKinds?: ConnectorKind[];
  durationSec?: number;
  costBucket?: CostBucket;
  findings?: Partial<Record<FindingsKey, number>>;
  degradedStages?: string[];
  failedStages?: string[];
  keyProvider?: KeyProvider;
  outcome?: Outcome;
  ts: string;
}

/**
 * What callers may pass to `track` / `buildEvent`. Typed loosely on purpose: the builder re-validates every value,
 * so a caller handing over a whole run record is safe (unknown fields are ignored). `costUsd` is bucketed locally;
 * the raw number is never sent.
 */
export interface TelemetryFields {
  bundles?: unknown;
  connectorKinds?: unknown;
  durationSec?: unknown;
  costUsd?: unknown;
  costBucket?: unknown;
  findings?: unknown;
  degradedStages?: unknown;
  failedStages?: unknown;
  keyProvider?: unknown;
  outcome?: unknown;
  [extra: string]: unknown;
}

/** `buildEvent` input: the event name plus the optional fields. */
export interface TelemetryInput extends TelemetryFields {
  event?: unknown;
}

export interface BuildContext {
  installId?: string;
  version?: string;
  now?: Date;
}

export const TELEMETRY_FIELDS: ReadonlyArray<{ name: keyof TelemetryEvent; description: string }> = [
  { name: 'installId', description: 'Random ID generated once for this install (UUID v4). Not derived from anything about you or your machine; reset when you turn telemetry off.' },
  { name: 'version', description: 'App version from package.json.' },
  { name: 'os', description: 'Operating system family (e.g. linux, darwin, win32).' },
  { name: 'arch', description: 'CPU architecture (e.g. x64, arm64).' },
  { name: 'node', description: 'Node.js major version.' },
  { name: 'event', description: 'What happened: start, quick-ask, full-scan or incremental.' },
  { name: 'bundles', description: 'IDs of the built-in expert bundles that ran (e.g. appsec, swe-arch). Never your project names.' },
  { name: 'connectorKinds', description: 'Kinds of sources connected (github, giturl, local, warehouse, keyvalue, analytics, bi, custom). Never names, URLs or credentials.' },
  { name: 'durationSec', description: 'Run duration in whole seconds.' },
  { name: 'costBucket', description: 'Model spend for the run as a coarse range: 0, <1, 1-5, 5-10, 10-30, 30-100 or 100+ (USD).' },
  { name: 'findings', description: 'Counts of findings by severity (critical/high/medium/low/info) and by lens (business/security/engineering). Never finding text.' },
  { name: 'degradedStages', description: 'Built-in pipeline stage names that fell back to a degraded path.' },
  { name: 'failedStages', description: 'Built-in pipeline stage names that failed.' },
  { name: 'keyProvider', description: 'Which kind of model credential was used: anthropic, anthropic+openai, claude-subscription, claude-subscription+openai or unknown. Never the key.' },
  { name: 'outcome', description: 'How the run ended: complete, error or stopped.' },
  { name: 'ts', description: 'Event time rounded down to the hour (UTC).' },
];

// ---- environment / persisted state -------------------------------------------------------------------------------

const OFF_VALUES = new Set(['0', 'off', 'false', 'no']);

function envDisabled(): boolean {
  const v = (process.env.THERESA_TELEMETRY ?? '').trim().toLowerCase();
  if (OFF_VALUES.has(v)) return true;
  const dnt = (process.env.DO_NOT_TRACK ?? '').trim().toLowerCase();
  return dnt !== '' && !OFF_VALUES.has(dnt);
}

function printEnabled(): boolean {
  if (process.argv.includes('--print-telemetry')) return true;
  const v = (process.env.THERESA_TELEMETRY_PRINT ?? '').trim().toLowerCase();
  return v !== '' && !OFF_VALUES.has(v);
}

function inTestRun(): boolean {
  return process.env.NODE_ENV === 'test' || !!process.env.NODE_TEST_CONTEXT;
}

function endpoint(): string {
  const v = (process.env.THERESA_TELEMETRY_URL ?? '').trim();
  if (v) {
    try {
      const u = new URL(v);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
    } catch { /* fall through to the default */ }
  }
  return DEFAULT_TELEMETRY_URL;
}

function dataDir(): string {
  return resolve(process.env.THERESA_DATA_DIR || './.data');
}

function stateFile(): string {
  return join(dataDir(), 'telemetry.json');
}

interface TelemetryState {
  installId?: string;
  enabled?: boolean;
  noticeShown?: boolean;
}

function readState(): TelemetryState {
  try {
    const f = stateFile();
    if (!existsSync(f)) return {};
    const raw = JSON.parse(readFileSync(f, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const r = raw as Record<string, unknown>;
    const s: TelemetryState = {};
    if (typeof r.installId === 'string' && UUID_V4_RE.test(r.installId)) s.installId = r.installId;
    if (typeof r.enabled === 'boolean') s.enabled = r.enabled;
    if (typeof r.noticeShown === 'boolean') s.noticeShown = r.noticeShown;
    return s;
  } catch {
    return {};
  }
}

function writeState(s: TelemetryState): boolean {
  try {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    const f = stateFile();
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, f);
    return true;
  } catch {
    return false;
  }
}

/** The persisted install id, created on first use. Returns null when telemetry is off (no id is minted then). */
function ensureInstallId(): string | null {
  if (!telemetryEnabled()) return readState().installId ?? null;
  const s = readState();
  if (s.installId) return s.installId;
  s.installId = randomUUID();
  writeState(s);
  return s.installId;
}

let cachedVersion: string | undefined;
function appVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  let v = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && VERSION_RE.test(pkg.version)) v = pkg.version;
  } catch { /* keep the fallback */ }
  cachedVersion = v;
  return v;
}

// ---- public: settings --------------------------------------------------------------------------------------------

/** True unless env turns it off or the user turned it off in Settings. Env off always wins. */
export function telemetryEnabled(): boolean {
  if (envDisabled()) return false;
  return readState().enabled !== false;
}

/**
 * Persist the user's choice. Turning telemetry OFF also forgets the install id, so turning it back on later starts
 * a fresh anonymous id. Returns the effective state after the change (still false when env forces it off).
 */
export function setTelemetryEnabled(on: boolean): boolean {
  const s = readState();
  s.enabled = !!on;
  if (!on) delete s.installId;
  writeState(s);
  return telemetryEnabled();
}

/** Record that the first-run notice was shown. */
export function markNoticeShown(): void {
  const s = readState();
  if (s.noticeShown) return;
  s.noticeShown = true;
  writeState(s);
}

export interface TelemetryStatus {
  enabled: boolean;
  envDisabled: boolean;
  installId: string | null;
  noticeShown: boolean;
  endpoint: string;
}

export function telemetryStatus(): TelemetryStatus {
  return {
    enabled: telemetryEnabled(),
    envDisabled: envDisabled(),
    installId: ensureInstallId(),
    noticeShown: readState().noticeShown === true,
    endpoint: endpoint(),
  };
}

/** Plain-English first-run notice: what is sent, what is never sent, how to turn it off. */
export function telemetryNotice(): string {
  return [
    'Anonymous usage telemetry is ON. It helps us see which features are used and where runs fail.',
    'Sent per event: a random install ID, app version, OS, CPU architecture, Node.js major version, the event type,',
    'the built-in expert bundle IDs that ran, the kinds of sources connected, run duration, a coarse cost range,',
    'finding counts by severity and lens, the names of pipeline stages that degraded or failed, the kind of model',
    'credential used, the run outcome, and the time rounded to the hour.',
    'Never sent: repository names or URLs, code, file paths, questions, finding text, reports, keys, emails,',
    'hostnames or usernames. The collector does not read or store IP addresses.',
    'To turn it off: Settings > Telemetry, or set THERESA_TELEMETRY=0 (DO_NOT_TRACK=1 also works).',
    'To see exactly what is sent: run with --print-telemetry or THERESA_TELEMETRY_PRINT=1.',
  ].join('\n');
}

// ---- public: payload ---------------------------------------------------------------------------------------------

/** Map a USD amount to a coarse bucket. Non-numeric / negative / non-finite -> undefined. */
export function costBucket(usd: unknown): CostBucket | undefined {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return undefined;
  if (usd === 0) return '0';
  if (usd < 1) return '<1';
  if (usd < 5) return '1-5';
  if (usd < 10) return '5-10';
  if (usd < 30) return '10-30';
  if (usd < 100) return '30-100';
  return '100+';
}

function hourTs(d: Date): string {
  const t = new Date(d.getTime());
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

function idList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== 'string' || !ID_LIST_RE.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= ID_LIST_MAX) break;
  }
  return out;
}

function count(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  return Math.min(Math.round(v), MAX_FINDINGS_COUNT);
}

function includes<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/**
 * Strict whitelist builder over `{ event, ...fields }`. Returns null when `event` is not a known event name. Context fields (installId, version,
 * os, arch, node, ts) always come from the runtime / `ctx`, never from `fields`. Invalid optional values are dropped.
 */
export function buildEvent(input: TelemetryInput, ctx: BuildContext = {}): TelemetryEvent | null {
  const f: Record<string, unknown> = input && typeof input === 'object' ? input : {};
  const event = f.event;
  if (!includes(TELEMETRY_EVENTS, event)) return null;
  const installId = ctx.installId && UUID_V4_RE.test(ctx.installId) ? ctx.installId : '00000000-0000-4000-8000-000000000000';
  const version = ctx.version && VERSION_RE.test(ctx.version) ? ctx.version : appVersion();
  const os = PLATFORM_RE.test(process.platform) ? process.platform : 'other';
  const arch = PLATFORM_RE.test(process.arch) ? process.arch : 'other';
  const node = Math.min(Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10) || 0, 999);

  const out: TelemetryEvent = { installId, version, os, arch, node, event, ts: hourTs(ctx.now ?? new Date()) };

  const bundles = idList(f.bundles);
  if (bundles) out.bundles = bundles;
  if (Array.isArray(f.connectorKinds)) {
    const kinds: ConnectorKind[] = [];
    for (const k of f.connectorKinds) if (includes(CONNECTOR_KINDS, k) && !kinds.includes(k)) kinds.push(k);
    out.connectorKinds = kinds;
  }
  if (typeof f.durationSec === 'number' && Number.isFinite(f.durationSec) && f.durationSec >= 0) {
    out.durationSec = Math.min(Math.round(f.durationSec), MAX_DURATION_SEC);
  }
  const bucket = includes(COST_BUCKETS, f.costBucket) ? f.costBucket : costBucket(f.costUsd);
  if (bucket) out.costBucket = bucket;
  if (f.findings && typeof f.findings === 'object' && !Array.isArray(f.findings)) {
    const src = f.findings as Record<string, unknown>;
    const findings: Partial<Record<FindingsKey, number>> = {};
    for (const k of FINDINGS_KEYS) {
      const n = count(src[k]);
      if (n !== undefined) findings[k] = n;
    }
    out.findings = findings;
  }
  const degraded = idList(f.degradedStages);
  if (degraded) out.degradedStages = degraded;
  const failed = idList(f.failedStages);
  if (failed) out.failedStages = failed;
  if (includes(KEY_PROVIDERS, f.keyProvider)) out.keyProvider = f.keyProvider;
  if (includes(OUTCOMES, f.outcome)) out.outcome = f.outcome;
  return out;
}

/** A representative payload (for the README / Settings panel). Uses a placeholder install id. */
export function examplePayload(): TelemetryEvent {
  return buildEvent({
    event: 'full-scan',
    bundles: ['appsec', 'swe-arch', 'product-logic'],
    connectorKinds: ['github', 'warehouse'],
    durationSec: 1834,
    costUsd: 7.42,
    findings: { critical: 0, high: 2, medium: 5, low: 3, info: 1, business: 4, security: 3, engineering: 4 },
    degradedStages: ['html-qc'],
    failedStages: [],
    keyProvider: 'anthropic',
    outcome: 'complete',
  }, { installId: '3f8b2c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b', now: new Date('2026-10-05T14:37:12Z') }) as TelemetryEvent;
}

// ---- public: transport -------------------------------------------------------------------------------------------

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; credentials?: 'omit'; redirect?: 'error' }) => Promise<unknown>;

export interface TrackOptions {
  /** Injected transport (tests). Supplying one bypasses the NODE_ENV=test / node --test skip, never the opt-out. */
  fetch?: FetchLike;
  now?: Date;
}

/**
 * Fire-and-forget. Call as `void track(...)`. Resolves true when the POST was attempted and answered 2xx, false
 * otherwise (disabled, test run, invalid event, network error, timeout). Never rejects, never retries.
 */
export function track(event: TelemetryEventName, fields: TelemetryFields = {}, opts: TrackOptions = {}): Promise<boolean> {
  try {
    if (!telemetryEnabled()) return Promise.resolve(false);
    const installId = ensureInstallId();
    if (!installId) return Promise.resolve(false);
    const payload = buildEvent({ ...(fields && typeof fields === 'object' ? fields : {}), event }, { installId, now: opts.now });
    if (!payload) return Promise.resolve(false);
    const body = JSON.stringify(payload);
    if (printEnabled()) {
      try { process.stderr.write(`[telemetry] ${body}\n`); } catch { /* ignore */ }
    }
    if (!opts.fetch && inTestRun()) return Promise.resolve(false);
    const url = endpoint();
    if (!url) return Promise.resolve(false);
    const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    if (typeof doFetch !== 'function') return Promise.resolve(false);
    return Promise.resolve()
      .then(() => doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `waggle/${payload.version}` },
        body,
        signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
        credentials: 'omit',
        redirect: 'error',
      }))
      .then((res) => {
        const status = (res as { status?: unknown } | null)?.status;
        return typeof status === 'number' && status >= 200 && status < 300;
      })
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
