// API keys for the single-user app. All model usage bills the USER's own keys:
//   Anthropic  required for the agentic pipeline — ANTHROPIC_API_KEY (metered) or CLAUDE_CODE_OAUTH_TOKEN (a Claude
//              plan token from `claude setup-token`); without either, an existing local `claude` login is used.
//   OpenAI     optional — OPENAI_API_KEY. Report writers and QC judges try OpenAI first and fall back
//              to Claude without it.
// Sources, in priority order: the process environment (including a `.env` file in the working directory), then keys
// saved from Settings → API keys. A key entered in Settings lives in this process's memory unless "Save on this
// machine" is ticked, which writes <data dir>/keys.json with mode 0600. Keys are never logged, never persisted
// anywhere else, and only ever sent to the provider's own API.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeSecretFile } from './secretFile.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';

type KeyName = 'anthropic' | 'openai';
type KeySource = 'env' | 'saved' | 'settings';

export interface KeyStatus {
  set: boolean;
  source?: KeySource;
  hint?: string;                       // masked: first 7 + last 4 characters
  kind?: 'apikey' | 'oauth';           // anthropic only: metered API key vs Claude plan token
}
export interface ApiKeyStatus {
  anthropic: KeyStatus;
  openai: KeyStatus;
  claudeLogin: boolean;                // a local `claude` CLI login exists (used when no Anthropic key is set)
  ready: boolean;                      // the agentic pipeline has a Claude credential
  provider: 'anthropic' | 'anthropic+openai' | 'claude-subscription' | 'claude-subscription+openai' | 'none';
  savedOnMachine: boolean;
}

const sources: Partial<Record<KeyName, KeySource>> = {};

function dataDir(): string { return process.env.THERESA_DATA_DIR || join(process.cwd(), '.data'); }
function keysFile(): string { return join(dataDir(), 'keys.json'); }

function anthropicValue(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || undefined;
}
function valueOf(name: KeyName): string | undefined {
  return name === 'anthropic' ? anthropicValue() : (process.env.OPENAI_API_KEY || undefined);
}
function setAnthropic(token: string | undefined): void {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return;
  if (token.startsWith('sk-ant-oat')) process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  else process.env.ANTHROPIC_API_KEY = token;
}
function setOpenai(token: string | undefined): void {
  if (token) process.env.OPENAI_API_KEY = token; else delete process.env.OPENAI_API_KEY;
}

function readSaved(): Partial<Record<KeyName, string>> {
  try {
    const j = JSON.parse(readFileSync(keysFile(), 'utf8')) as Record<string, unknown>;
    const out: Partial<Record<KeyName, string>> = {};
    if (typeof j.anthropic === 'string' && j.anthropic) out.anthropic = j.anthropic;
    if (typeof j.openai === 'string' && j.openai) out.openai = j.openai;
    return out;
  } catch { return {}; }
}
function writeSaved(keys: Partial<Record<KeyName, string>>): void {
  const file = keysFile();
  if (!keys.anthropic && !keys.openai) { try { rmSync(file, { force: true }); } catch { /* best-effort */ } return; }
  mkdirSync(dataDir(), { recursive: true });
  writeSecretFile(file, JSON.stringify(keys));
}

/**
 * Is there a local `claude` CLI login the Agent SDK can fall back to? (presence check only — the secret is never read)
 * Linux and Windows keep it in <config dir>/.credentials.json; macOS keeps it in the login Keychain, so there we ask
 * `security` whether the item exists (without -w, which would print the secret). The Keychain answer is cached briefly.
 */
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
let keychainCache: { at: number; found: boolean } | undefined;
export function hasClaudeLogin(): boolean {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  if (existsSync(join(dir, '.credentials.json'))) return true;
  if (process.platform !== 'darwin') return false;
  if (keychainCache && Date.now() - keychainCache.at < 30_000) return keychainCache.found;
  let found = false;
  try {
    execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { stdio: 'ignore', timeout: 3000 });
    found = true;
  } catch { /* not found, no Keychain access, or no `security` binary */ }
  keychainCache = { at: Date.now(), found };
  return found;
}

/**
 * Boot: load `.env` (never overriding the real environment), then fill any key the environment lacks from the keys
 * saved on this machine, then point codex at a private home under the data dir (see provisionCodexAuth).
 */
export function initApiKeys(): void {
  try { if (existsSync('.env')) process.loadEnvFile('.env'); } catch { /* a malformed .env is ignored */ }
  if (anthropicValue()) sources.anthropic = 'env';
  if (process.env.OPENAI_API_KEY) sources.openai = 'env';
  const saved = readSaved();
  if (!sources.anthropic && saved.anthropic) { setAnthropic(saved.anthropic); sources.anthropic = 'saved'; }
  if (!sources.openai && saved.openai) { setOpenai(saved.openai); sources.openai = 'saved'; }
  provisionCodexAuth();
}

/**
 * codex (the optional OpenAI coding agent the report writers use) reads its credentials from CODEX_HOME. Point it at a
 * home inside the data dir — never the user's own ~/.codex login — and write an API-key auth file from OPENAI_API_KEY.
 * Without an OpenAI key the file is removed, so codex can never bill anything but the key the user configured here.
 */
export function provisionCodexAuth(): void {
  try {
    if (!process.env.CODEX_HOME) process.env.CODEX_HOME = join(dataDir(), 'codex');
    const home = process.env.CODEX_HOME;
    const authPath = join(home, 'auth.json');
    const key = process.env.OPENAI_API_KEY;
    if (!key) { if (existsSync(authPath) && isManagedAuth(authPath)) rmSync(authPath, { force: true }); return; }
    if (existsSync(authPath) && !isManagedAuth(authPath)) return;   // never clobber a login someone created on purpose
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeSecretFile(authPath, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: key }));
  } catch (e) {
    console.log(JSON.stringify({ severity: 'WARNING', component: 'keys', event: 'codex-auth-failed', error: e instanceof Error ? e.message : String(e) }));
  }
}
function isManagedAuth(path: string): boolean {
  try { return (JSON.parse(readFileSync(path, 'utf8')) as { auth_mode?: string }).auth_mode === 'apikey'; } catch { return false; }
}

function mask(v: string): string { return v.length > 14 ? `${v.slice(0, 7)}…${v.slice(-4)}` : '••••'; }

export function apiKeyStatus(): ApiKeyStatus {
  const a = anthropicValue();
  const o = process.env.OPENAI_API_KEY;
  const claudeLogin = hasClaudeLogin();
  const saved = readSaved();
  const provider: ApiKeyStatus['provider'] = a
    ? (o ? 'anthropic+openai' : 'anthropic')
    : (claudeLogin ? (o ? 'claude-subscription+openai' : 'claude-subscription') : 'none');
  return {
    anthropic: a ? { set: true, source: sources.anthropic ?? 'env', hint: mask(a), kind: a.startsWith('sk-ant-oat') ? 'oauth' : 'apikey' } : { set: false },
    openai: o ? { set: true, source: sources.openai ?? 'env', hint: mask(o) } : { set: false },
    claudeLogin,
    ready: Boolean(a) || claudeLogin,
    provider,
    savedOnMachine: Boolean(saved.anthropic || saved.openai),
  };
}

/** The key provider label used by telemetry (no key material). */
export function keyProvider(): ApiKeyStatus['provider'] { return apiKeyStatus().provider; }

export class ApiKeyError extends Error {}

/**
 * Settings → API keys. `undefined` leaves a key unchanged; an empty string clears it. `save` true writes the keys
 * currently set from Settings to <data dir>/keys.json (0600); false removes the file. A key that came from the
 * environment can be overridden here for this process but is never written to disk.
 */
export function setApiKeys(input: { anthropic?: string; openai?: string; save?: boolean }): ApiKeyStatus {
  const a = input.anthropic === undefined ? undefined : String(input.anthropic).trim();
  const o = input.openai === undefined ? undefined : String(input.openai).trim();
  if (a && !/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(a)) throw new ApiKeyError('That does not look like an Anthropic key. Expected sk-ant-api… (API key) or sk-ant-oat… (Claude plan token from `claude setup-token`).');
  if (o && !/^sk-[A-Za-z0-9_-]{16,}$/.test(o)) throw new ApiKeyError('That does not look like an OpenAI key. Expected sk-….');
  if (a !== undefined) { setAnthropic(a || undefined); if (a) sources.anthropic = 'settings'; else delete sources.anthropic; }
  if (o !== undefined) { setOpenai(o || undefined); if (o) sources.openai = 'settings'; else delete sources.openai; provisionCodexAuth(); }
  // A cleared key is also dropped from the saved file, so it does not come back on the next start.
  const saved = readSaved();
  if ((a === '' && saved.anthropic) || (o === '' && saved.openai)) {
    writeSaved({ ...(a === '' ? {} : { anthropic: saved.anthropic }), ...(o === '' ? {} : { openai: saved.openai }) });
  }
  if (input.save !== undefined) {
    if (input.save) {
      const keep: Partial<Record<KeyName, string>> = {};
      for (const n of ['anthropic', 'openai'] as const) if (sources[n] && sources[n] !== 'env') { const v = valueOf(n); if (v) keep[n] = v; }
      writeSaved(keep);
      for (const n of ['anthropic', 'openai'] as const) if (keep[n]) sources[n] = 'saved';
    } else {
      writeSaved({});
      for (const n of ['anthropic', 'openai'] as const) if (sources[n] === 'saved') sources[n] = 'settings';
    }
  }
  return apiKeyStatus();
}

/** Test seam: forget where keys came from (the environment itself is the test's to manage). */
export function _resetKeySourcesForTest(): void { delete sources.anthropic; delete sources.openai; }
