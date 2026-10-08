import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { requestGuard, isLocalSecretPath } from './requestGuard.ts';
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

test('glob patterns may not leave the analysis directory', () => {
  const root = resolve('/ws/repo');
  const inside = [`${root}/**/*.ts`, `${root}/src/*.{js,ts}`];
  for (const g of ['**/*.ts', 'src/**', '*.{js,ts}', 'a..b/*', '...', ...inside]) assert.equal(globWithinDir(g, root), true, g);
  for (const g of ['../**', 'src/../../**', '/etc/*', '~/.ssh/*', ...(process.platform === 'win32' ? ['C:/Users/**'] : []), '..\\x\\*', '{..,src}/**', '..', `${root}/../other/**`, resolve('/ws') + '/*']) {
    assert.equal(globWithinDir(g, root), false, g);
  }
});
