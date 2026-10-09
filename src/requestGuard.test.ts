import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { requestGuard, isLocalSecretPath, localCopyFilter } from './requestGuard.ts';
import { globWithinDir } from './research/agent.ts';

const req = (headers: Record<string, string>) => ({ headers });

test('loopback hosts are served on any port; other hosts are refused (DNS rebinding)', () => {
  for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317', 'localhost:8080', 'localhost']) {
    assert.equal(requestGuard(req({ host }), 'GET'), null, host);
  }
  for (const host of ['evil.example', 'evil.example:4317', '192.168.1.5:4317', 'localhost.evil.example:4317', '']) {
    assert.match(String(requestGuard(req({ host }), 'GET')), /Host not allowed/, host || '(empty)');
  }
});

test('a state-changing request from another origin is refused (CSRF); same-origin and non-browser clients pass', () => {
  const host = 'localhost:4317';
  assert.equal(requestGuard(req({ host, origin: 'http://localhost:4317', 'sec-fetch-site': 'same-origin' }), 'POST'), null);
  assert.equal(requestGuard(req({ host }), 'POST'), null, 'curl sends no Origin');
  assert.match(String(requestGuard(req({ host, origin: 'https://evil.example' }), 'POST')), /Cross-site/);
  assert.match(String(requestGuard(req({ host, origin: 'null' }), 'POST')), /Cross-site/, 'sandboxed report frame');
  assert.match(String(requestGuard(req({ host, 'sec-fetch-site': 'cross-site' }), 'DELETE')), /Cross-site/);
  assert.match(String(requestGuard(req({ host, origin: 'http://localhost:9999' }), 'POST')), /Cross-site/, 'another local app');
  assert.equal(requestGuard(req({ host, origin: 'https://evil.example' }), 'GET'), null, 'a cross-site GET cannot read the response');
});

test('local secret files and the data dir are never copied into a scan workspace', () => {
  for (const f of ['.env', '.env.local', '.env.production', 'server.pem', 'tls.key', 'id_rsa', 'id_ed25519', 'cert.p12']) {
    assert.equal(isLocalSecretPath(join('/repo', f)), true, f);
  }
  for (const f of ['.env.example', '.env.sample', '.env.template', 'env.ts', 'keys.ts', 'README.md', 'id_rsa.pub']) {
    assert.equal(isLocalSecretPath(join('/repo', f)), false, f);
  }
  const saved = process.env.THERESA_DATA_DIR;
  process.env.THERESA_DATA_DIR = resolve('/repo/.data');
  try { assert.equal(isLocalSecretPath(resolve('/repo/.data')), true); } finally {
    if (saved === undefined) delete process.env.THERESA_DATA_DIR; else process.env.THERESA_DATA_DIR = saved;
  }
});

test('a local-folder copy keeps source and templates but drops secrets, deps and symlinks', () => {
  const base = mkdtempSync(join(tmpdir(), 'waggle-copy-'));
  const root = join(base, 'repo'), dest = join(base, 'out');
  const files = ['.env', '.env.local', '.env.example', 'nested/pkg/.env', 'server.pem', 'id_rsa', 'src/app.ts', 'node_modules/x/index.js'];
  for (const f of files) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), 'x'); }
  // Exercises the real-path symlink branch; Windows needs extra permission to create one.
  if (process.platform !== 'win32') symlinkSync(join(base, 'outside'), join(root, 'link'));
  try {
    cpSync(root, dest, { recursive: true, dereference: false, filter: localCopyFilter(root) });
    for (const f of ['.env.example', 'src/app.ts']) assert.equal(existsSync(join(dest, f)), true, f);
    for (const f of ['.env', '.env.local', 'nested/pkg/.env', 'server.pem', 'id_rsa', 'node_modules', 'link']) {
      assert.equal(existsSync(join(dest, f)), false, f);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a root under a dir named env or build is still copied (SKIP is relative to the root)', () => {
  const base = mkdtempSync(join(tmpdir(), 'waggle-copy-'));
  const root = join(base, 'env', 'repo'), dest = join(base, 'out');
  mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src', 'a.ts'), 'x');
  try {
    cpSync(root, dest, { recursive: true, dereference: false, filter: localCopyFilter(root) });
    assert.equal(existsSync(join(dest, 'src', 'a.ts')), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('connecting the data dir itself as a local folder copies nothing from it', () => {
  const base = mkdtempSync(join(tmpdir(), 'waggle-copy-'));
  const data = join(base, 'data'), dest = join(base, 'out');
  mkdirSync(data); writeFileSync(join(data, 'keys.json'), '{}');
  const saved = process.env.THERESA_DATA_DIR;
  process.env.THERESA_DATA_DIR = data;
  try {
    cpSync(data, dest, { recursive: true, dereference: false, filter: localCopyFilter(data) });
    assert.equal(existsSync(join(dest, 'keys.json')), false);
    assert.equal(existsSync(dest), false, 'callers treat a missing dest as copied empty');
  } finally {
    if (saved === undefined) delete process.env.THERESA_DATA_DIR; else process.env.THERESA_DATA_DIR = saved;
    rmSync(base, { recursive: true, force: true });
  }
});

test('dep/build dirs are skipped under a Windows-style root too', () => {
  // Synthetic paths: lstat on a missing path is caught, so only the SKIP and secret checks decide.
  const root = 'C:\\work\\app';
  const keep = localCopyFilter(root);
  for (const rel of ['\\node_modules', '\\node_modules\\x\\index.js', '\\pkg\\dist\\a.js', '\\.venv']) assert.equal(keep(root + rel), false, rel);
  for (const rel of ['\\src\\app.ts', '\\environment.ts']) assert.equal(keep(root + rel), true, rel);
  assert.equal(keep('C:\\env\\app'), true, 'a root under a dir named env is not skipped');
});

test('every local-folder copy into a scan workspace uses the shared filter (Quick Ask and Full Scan)', () => {
  for (const rel of ['./server.ts', './run/execute-org-run.ts']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const copies = src.match(/cpSync\([^;]*/g) ?? [];
    assert.ok(copies.length > 0, `${rel} copies a local folder`);
    for (const c of copies) assert.match(c, /filter: localCopyFilter\(/, `${rel}: ${c.slice(0, 80)}`);
  }
});

test('glob patterns may not leave the analysis directory', () => {
  const root = resolve('/ws/repo');
  const inside = [`${root}/**/*.ts`, `${root}/src/*.{js,ts}`];
  for (const g of ['**/*.ts', 'src/**', '*.{js,ts}', 'a..b/*', '...', ...inside]) assert.equal(globWithinDir(g, root), true, g);
  for (const g of ['../**', 'src/../../**', '/etc/*', '~/.ssh/*', ...(process.platform === 'win32' ? ['C:/Users/**'] : []), '..\\x\\*', '{..,src}/**', '..', `${root}/../other/**`, resolve('/ws') + '/*']) {
    assert.equal(globWithinDir(g, root), false, g);
  }
});
