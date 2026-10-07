import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppSettings, saveRunBudget, SettingsError, rememberCredentials, setRememberCredentials, loadCredentials, saveCredentials } from './appSettings.ts';
import { runBudget, setRunBudget } from './run/shared.ts';
import { connectionCredentials, persistableSource, rehydratePersistedSource } from './sources/persist.ts';
import type { Source } from './server.ts';

let dir = '';
let savedDir: string | undefined;
let savedBudget: string | undefined;
let budgetBefore = 0;
beforeEach(() => {
  savedDir = process.env.THERESA_DATA_DIR; savedBudget = process.env.THERESA_RUN_BUDGET;
  dir = mkdtempSync(join(tmpdir(), 'settings-'));
  process.env.THERESA_DATA_DIR = dir;
  delete process.env.THERESA_RUN_BUDGET;
  budgetBefore = runBudget();
});
afterEach(() => {
  if (savedDir === undefined) delete process.env.THERESA_DATA_DIR; else process.env.THERESA_DATA_DIR = savedDir;
  if (savedBudget === undefined) delete process.env.THERESA_RUN_BUDGET; else process.env.THERESA_RUN_BUDGET = savedBudget;
  setRunBudget(budgetBefore);
});

test('the per-run cap is validated, applied and persisted', () => {
  assert.equal(saveRunBudget(35), 35);
  assert.equal(runBudget(), 35);
  setRunBudget(20);
  loadAppSettings();
  assert.equal(runBudget(), 35, 'restored on boot');
  assert.throws(() => saveRunBudget(0), SettingsError);
  assert.throws(() => saveRunBudget('lots'), SettingsError);
  assert.throws(() => saveRunBudget(100000), SettingsError);
});

test('an explicit THERESA_RUN_BUDGET wins over the saved cap', () => {
  saveRunBudget(50);
  setRunBudget(7);
  process.env.THERESA_RUN_BUDGET = '7';
  loadAppSettings();
  assert.equal(runBudget(), 7);
});

test('connection credentials are remembered only when the setting is on, in a file of their own', () => {
  const gh: Source = { id: 'src_1', kind: 'github', name: 'GitHub', status: 'ready', detail: '', token: 'ghp_secret' };
  assert.equal(rememberCredentials(), false);
  saveCredentials({ src_1: connectionCredentials(gh) as Record<string, string> });
  assert.equal(existsSync(join(dir, 'credentials.json')), false, 'off by default — nothing written');
  setRememberCredentials(true);
  saveCredentials({ src_1: connectionCredentials(gh) as Record<string, string> });
  assert.deepEqual(loadCredentials(), { src_1: { token: 'ghp_secret' } });
  // the persisted (state.json) form never carries the token; rehydrating with the remembered credential is ready again
  const stored = persistableSource(gh);
  assert.equal((stored as Record<string, unknown>).token, undefined);
  assert.equal(rehydratePersistedSource(stored).status, 'error', 'without the remembered credential it needs a reconnect');
  const back = rehydratePersistedSource(stored, loadCredentials().src_1);
  assert.equal(back.status, 'ready');
  assert.equal(back.token, 'ghp_secret');
  setRememberCredentials(false);
  assert.equal(existsSync(join(dir, 'credentials.json')), false, 'turning it off deletes the file');
  assert.deepEqual(loadCredentials(), {});
  assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).rememberCredentials, false);
});

test('a credential embedded in an MCP URL never reaches the persisted form; remembered, it comes back', async () => {
  const { redactUrlCredentials } = await import('./sources/persist.ts');
  const secret = 'p' + 'w' + 'X9z7Q2';
  const url = `https://svc:${secret}@mcp.example.com/sse?region=us&api_key=${secret}`;
  const r = redactUrlCredentials(url);
  assert.equal(r.hadSecret, true);
  assert.ok(!r.safe.includes(secret), r.safe);
  assert.match(r.safe, /^https:\/\/mcp\.example\.com\/sse\?region=us&api_key=redacted$/);
  assert.deepEqual(redactUrlCredentials('https://mcp.example.com/sse?region=us'), { safe: 'https://mcp.example.com/sse?region=us', hadSecret: false });
  const src: Source = { id: 'src_9', kind: 'warehouse', name: 'Warehouse SQL', status: 'ready', detail: r.safe, mcpUrl: url };
  const stored = persistableSource(src);
  assert.ok(!JSON.stringify(stored).includes(secret), 'state.json form carries no secret');
  assert.equal(stored.credStripped, true);
  assert.equal(rehydratePersistedSource(stored).status, 'error', 'not remembered ⇒ reconnect');
  const back = rehydratePersistedSource(stored, connectionCredentials(src));
  assert.equal(back.status, 'ready');
  assert.equal(back.mcpUrl, url, 'remembered ⇒ the full URL comes back');
});
