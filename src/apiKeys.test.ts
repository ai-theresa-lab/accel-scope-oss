import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiKeyStatus, initApiKeys, provisionCodexAuth, setApiKeys, ApiKeyError, _resetKeySourcesForTest } from './apiKeys.ts';

const ENV = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'THERESA_DATA_DIR', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'];
let saved: Record<string, string | undefined> = {};
let dir = '';
const A = 'sk-ant\x2dapi03-' + 'a'.repeat(40);
const OAT = 'sk-ant\x2doat01-' + 'b'.repeat(40);
const O = 'sk-proj-' + 'c'.repeat(40);

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), 'keys-'));
  process.env.THERESA_DATA_DIR = dir;
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'no-claude-login');
  _resetKeySourcesForTest();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

test('no key and no claude login ⇒ not ready, provider none', () => {
  const s = apiKeyStatus();
  assert.equal(s.ready, false);
  assert.equal(s.provider, 'none');
  assert.equal(s.anthropic.set, false);
});

test('a key from the environment is reported with its source and a masked hint', () => {
  process.env.ANTHROPIC_API_KEY = A;
  initApiKeys();
  const s = apiKeyStatus();
  assert.equal(s.ready, true);
  assert.equal(s.anthropic.source, 'env');
  assert.equal(s.anthropic.kind, 'apikey');
  assert.ok(s.anthropic.hint && !s.anthropic.hint.includes(A.slice(12, 30)), 'the hint never carries the key body');
});

test('setApiKeys routes a Claude plan token to CLAUDE_CODE_OAUTH_TOKEN and an API key to ANTHROPIC_API_KEY', () => {
  setApiKeys({ anthropic: OAT });
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, OAT);
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(apiKeyStatus().anthropic.kind, 'oauth');
  setApiKeys({ anthropic: A });
  assert.equal(process.env.ANTHROPIC_API_KEY, A);
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('malformed keys are rejected without changing anything', () => {
  assert.throws(() => setApiKeys({ anthropic: 'not-a-key' }), ApiKeyError);
  assert.throws(() => setApiKeys({ openai: 'sk-short' }), ApiKeyError);
  assert.equal(apiKeyStatus().anthropic.set, false);
});

test('keys stay in memory unless saved; saving writes a 0600 file that a restart loads', () => {
  setApiKeys({ anthropic: A, openai: O });
  assert.equal(existsSync(join(dir, 'keys.json')), false, 'memory only by default');
  const s = setApiKeys({ save: true });
  assert.equal(s.savedOnMachine, true);
  const file = join(dir, 'keys.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { anthropic: A, openai: O });
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  // simulate a restart: the environment is empty, the saved file fills it
  delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; _resetKeySourcesForTest();
  initApiKeys();
  assert.equal(process.env.ANTHROPIC_API_KEY, A);
  assert.equal(apiKeyStatus().anthropic.source, 'saved');
});

test('an environment key is never written to disk, and clearing a saved key removes it from the file', () => {
  process.env.ANTHROPIC_API_KEY = A;
  initApiKeys();
  setApiKeys({ openai: O, save: true });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'keys.json'), 'utf8')), { openai: O });
  setApiKeys({ openai: '' });
  assert.equal(existsSync(join(dir, 'keys.json')), false);
  assert.equal(process.env.OPENAI_API_KEY, undefined);
});

test('codex gets a private home with an API-key auth file only while an OpenAI key is set', () => {
  provisionCodexAuth();
  const home = process.env.CODEX_HOME!;
  assert.ok(home.startsWith(dir), 'never the user’s own ~/.codex');
  assert.equal(existsSync(join(home, 'auth.json')), false);
  setApiKeys({ openai: O });
  assert.equal(JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).OPENAI_API_KEY, O);
  setApiKeys({ openai: '' });
  assert.equal(existsSync(join(home, 'auth.json')), false);
});

test('an auth file the user created on purpose is never overwritten', () => {
  process.env.CODEX_HOME = join(dir, 'mine');
  mkdirSync(join(dir, 'mine'), { recursive: true });
  writeFileSync(join(dir, 'mine', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
  setApiKeys({ openai: O });
  assert.equal(JSON.parse(readFileSync(join(dir, 'mine', 'auth.json'), 'utf8')).auth_mode, 'chatgpt');
});
