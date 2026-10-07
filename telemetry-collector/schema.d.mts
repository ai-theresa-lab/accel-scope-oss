// Type declarations for schema.mjs so src/telemetry.schema.test.ts type-checks under `tsc --noEmit`.
export declare const FIELD_NAMES: readonly string[];
export declare const REQUIRED_FIELDS: readonly string[];
export declare const EVENTS: readonly string[];
export declare const CONNECTOR_KINDS: readonly string[];
export declare const COST_BUCKETS: readonly string[];
export declare const SEVERITY_KEYS: readonly string[];
export declare const LENS_KEYS: readonly string[];
export declare const FINDINGS_KEYS: readonly string[];
export declare const KEY_PROVIDERS: readonly string[];
export declare const OUTCOMES: readonly string[];
export declare const ID_LIST_RE: RegExp;
export declare const ID_LIST_MAX: number;
export declare const UUID_V4_RE: RegExp;
export declare const VERSION_RE: RegExp;
export declare const PLATFORM_RE: RegExp;
export declare const HOUR_TS_RE: RegExp;
export declare const MAX_DURATION_SEC: number;
export declare const MAX_FINDINGS_COUNT: number;
export declare const MAX_NODE_MAJOR: number;
export declare const MAX_BODY_BYTES: number;
export declare function validateEvent(raw: unknown):
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; error: string };
export declare function toRow(event: Record<string, unknown>, receivedAt?: Date): Record<string, unknown>;
