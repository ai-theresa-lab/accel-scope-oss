// Write a file that holds a secret (saved API keys, remembered connection credentials, the codex auth file) so that only
// the current user can read it. POSIX: mode 0600. Windows ignores the mode bits, so the file's inherited ACL is replaced
// with a single entry for the current user (icacls). Atomic: written to a temp file in the same directory, then renamed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Restrict an existing file to the current user on Windows. No-op elsewhere. Throws when icacls fails. */
export function restrictToCurrentUser(path: string): void {
  if (process.platform !== 'win32') return;
  const user = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
  if (!user) throw new Error('cannot determine the current Windows user');
  execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore', windowsHide: true });
}

export function writeSecretFile(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, data, { mode: 0o600 });
  try { restrictToCurrentUser(tmp); }
  catch (e) {
    // Fail-open but loud: the file is still written (the app keeps working) and the user is told it may be readable.
    console.log(JSON.stringify({ severity: 'WARNING', component: 'secret-file', event: 'acl-restrict-failed', file: path, error: e instanceof Error ? e.message : String(e) }));
  }
  renameSync(tmp, path);
}
