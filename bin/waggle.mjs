#!/usr/bin/env node
// `waggle` launcher: runs the TypeScript CLI with Node's type stripping (no build step), passing arguments through.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 7)) {
  process.stdout.write(JSON.stringify({ error: `Waggle needs Node.js 22.7 or newer; this is Node.js ${process.versions.node}.` }) + '\n');
  process.exit(2);
}
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli-waggle.ts');
const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
