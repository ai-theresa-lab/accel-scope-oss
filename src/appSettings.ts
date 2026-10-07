// User settings that survive a restart (Settings page), stored as <data dir>/settings.json: the per-run spend cap and
// whether connection credentials are remembered on this machine. API keys and telemetry keep their own files
// (src/apiKeys.ts, src/telemetry.ts); remembered connection credentials live in <data dir>/credentials.json (0600).

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBudget, setRunBudget } from './run/shared.ts';

const MIN_BUDGET = 1;
const MAX_BUDGET = 1000;

interface Settings { runBudgetUsd?: number; rememberCredentials?: boolean }

function dataDir(): string { return process.env.THERESA_DATA_DIR || join(process.cwd(), '.data'); }
function settingsFile(): string { return join(dataDir(), 'settings.json'); }
function credentialsFile(): string { return join(dataDir(), 'credentials.json'); }

function read(): Settings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as Settings; } catch { return {}; }
}
function write(patch: Settings): void {
  const file = settingsFile();
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify({ ...read(), ...patch }));
  renameSync(file + '.tmp', file);
}

/** Boot: apply saved settings. An explicit THERESA_RUN_BUDGET in the environment wins over the saved cap. */
export function loadAppSettings(): void {
  const s = read();
  if (!process.env.THERESA_RUN_BUDGET && typeof s.runBudgetUsd === 'number') setRunBudget(s.runBudgetUsd);
}

export class SettingsError extends Error {}

/** Settings → Spending: change the per-run cap (USD) for new runs and persist it. Runs already started keep theirs. */
export function saveRunBudget(usd: unknown): number {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < MIN_BUDGET || n > MAX_BUDGET) throw new SettingsError(`The per-run cap must be between $${MIN_BUDGET} and $${MAX_BUDGET}.`);
  setRunBudget(n);
  write({ runBudgetUsd: runBudget() });
  return runBudget();
}

/** Settings → Connections: remember connection credentials (tokens, service-account keys) on this machine? Default off. */
export function rememberCredentials(): boolean { return read().rememberCredentials === true; }
export function setRememberCredentials(on: boolean): void {
  write({ rememberCredentials: on });
  if (!on) forgetCredentials();
}

/** Remembered connection credentials, keyed by source id. Empty when the setting is off or nothing is saved. */
export function loadCredentials(): Record<string, Record<string, string>> {
  if (!rememberCredentials()) return {};
  try { return JSON.parse(readFileSync(credentialsFile(), 'utf8')) as Record<string, Record<string, string>>; } catch { return {}; }
}
/** Replace the remembered credentials (mode 0600). A no-op that deletes the file when the setting is off. */
export function saveCredentials(byId: Record<string, Record<string, string>>): void {
  if (!rememberCredentials() || !Object.keys(byId).length) { forgetCredentials(); return; }
  const file = credentialsFile();
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(byId), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
function forgetCredentials(): void {
  try { rmSync(credentialsFile(), { force: true }); } catch { /* best-effort */ }
}
