// Evidence references become GitHub permalinks at the scanned commit (serve-time), under the /share policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLinkIndex, citedPaths, githubRepoOf, LINKS_MARK, linkifyReport, parseCitation, permalinkFor } from './reportLinks.ts';
import { renderFindingsHtml } from './reportHtml.ts';
import type { WorkspaceManifest } from './checkpoints.ts';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PUB = 'ffffffffffffffffffffffffffffffffffffffff';
function workspace(): { root: string; manifest: WorkspaceManifest; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'rx5-'));
  const put = (p: string) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), 'x\n'.repeat(80)); };
  put('api/src/server.ts'); put('api/src/shared.ts'); put('engine/src/shared.ts'); put('engine/README.md'); put('folder/notes.ts');
  const manifest: WorkspaceManifest = {
    repos: [
      { fullName: 'acme/api', cloneUrl: 'https://github.com/acme/api.git', sha: SHA, dir: 'api' },                 // private (GitHub source)
      { fullName: 'cocos/engine', cloneUrl: 'https://github.com/cocos/engine', sha: PUB, dir: 'engine', public: true }, // giturl target
    ],
    localDirs: [{ path: '/uploads/folder', name: 'folder' }],
  };
  return { root, manifest, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('citations parse with line ranges, plane tags and trailing prose; non-paths are rejected', () => {
  assert.deepEqual(parseCitation('src/a.ts:12-40'), { path: 'src/a.ts', a: 12, b: 40 });
  assert.deepEqual(parseCitation('src/a.ts#L7'), { path: 'src/a.ts', a: 7 });
  assert.deepEqual(parseCitation('code-inspection:api/src/server.ts:3718-3730,114 + src/run/shared.ts:23'), { path: 'api/src/server.ts', a: 3718, b: 3730 });
  assert.equal(parseCitation('HTTP 404'), null);
  assert.equal(parseCitation('../etc/passwd'), null);
  assert.equal(parseCitation('src/a.ts (the helper)', true), null, 'a code span must be exactly one ref');
  assert.deepEqual(githubRepoOf('git@github.com:acme/api.git'), { owner: 'acme', repo: 'api' });
  assert.equal(githubRepoOf('https://gitlab.com/acme/api.git'), null);
});

test('a permalink is built at the pinned SHA; local folders and unknown/ambiguous paths get none', () => {
  const w = workspace();
  try {
    const idx = buildLinkIndex(w.manifest, w.root, ['src/server.ts', 'api/src/server.ts', 'acme/api/src/server.ts', 'src/shared.ts', 'folder/notes.ts', 'src/missing.ts', 'README.md']);
    assert.equal(permalinkFor(idx, 'src/server.ts:10-12'), `https://github.com/acme/api/blob/${SHA}/src/server.ts#L10-L12`);
    assert.equal(permalinkFor(idx, 'api/src/server.ts:5'), `https://github.com/acme/api/blob/${SHA}/src/server.ts#L5`, 'workspace-relative cite');
    assert.equal(permalinkFor(idx, 'acme/api/src/server.ts'), `https://github.com/acme/api/blob/${SHA}/src/server.ts`, 'owner/repo-relative cite, no line');
    assert.equal(permalinkFor(idx, 'README.md:3'), `https://github.com/cocos/engine/blob/${PUB}/README.md#L3`);
    assert.equal(permalinkFor(idx, 'src/shared.ts:1'), null, 'two repos carry it — ambiguous, no link');
    assert.equal(permalinkFor(idx, 'folder/notes.ts:1'), null, 'a local folder is never linked');
    assert.equal(permalinkFor(idx, 'src/missing.ts:1'), null, 'a path that does not exist is never linked');
  } finally { w.done(); }
});

test('<code> spans in an LLM report link; <pre>, existing links and scripts are untouched; idempotent (marker)', () => {
  const w = workspace();
  try {
    const html = '<!doctype html><html><head><title>t</title></head><body>'
      + '<p>See <code>src/server.ts:10-12</code> and <code>folder/notes.ts:1</code> and <code>README.md</code>.</p>'
      + '<pre><code>src/server.ts:10</code></pre><a href="#x"><code>src/server.ts:3</code></a>'
      + '<script>var s="<code>src/server.ts:1</code>";</script></body></html>';
    const idx = buildLinkIndex(w.manifest, w.root, citedPaths([html], []));
    const out = linkifyReport(html, idx);
    assert.ok(out.includes(`<a href="https://github.com/acme/api/blob/${SHA}/src/server.ts#L10-L12" target="_blank" rel="noopener noreferrer" class="accel-ev-link"><code>src/server.ts:10-12</code></a>`));
    assert.ok(out.includes(`<a href="https://github.com/cocos/engine/blob/${PUB}/README.md" target="_blank"`));
    assert.ok(out.includes(' and <code>folder/notes.ts:1</code> and ') && !out.includes('notes.ts" target'), 'local folder untouched');
    assert.ok(out.includes('<pre><code>src/server.ts:10</code></pre>'), 'the <pre> drawer is never touched');
    assert.ok(out.includes('<a href="#x"><code>src/server.ts:3</code></a>'), 'an existing link is not nested');
    assert.ok(out.includes('<script>var s="<code>src/server.ts:1</code>";</script>'));
    assert.ok(out.startsWith(`<!doctype html><html><head>${LINKS_MARK}`), 'marker after <head>, never before the doctype');
    assert.equal(linkifyReport(out, idx), out, 'a second pass is a no-op');
    assert.equal(linkifyReport(html, null), html, 'no index → unchanged');
  } finally { w.done(); }
});

test('/share links only to public (giturl) repos; the private repo is not emitted at all', () => {
  const w = workspace();
  try {
    const html = '<html><head></head><body><code>src/server.ts:10</code> <code>README.md:2</code></body></html>';
    const idx = buildLinkIndex(w.manifest, w.root, citedPaths([html], []));
    const share = linkifyReport(html, idx, { publicOnly: true });
    assert.ok(!share.includes('github.com/acme'), 'no private owner/repo/SHA on the public link');
    assert.ok(!share.includes(SHA));
    assert.ok(share.includes(`https://github.com/cocos/engine/blob/${PUB}/README.md#L2`));
  } finally { w.done(); }
});

test('the engineering report\'s evidence rows get an href per serve, under the same policy', () => {
  const w = workspace();
  try {
    const f = (ref: string) => ({ id: 'X-1', dimension: 'code_health', title: `t ${ref}`, claim: 'c', evidence: [{ kind: 'file', ref }], businessImpact: 'b', recommendation: 'r', severity: 'high', confidence: 'high', effort: 'moderate', source: 's' });
    const html = renderFindingsHtml({ miner: 'm', target: 't', metrics: {}, findings: [f('src/server.ts:4-6'), f('README.md:1'), f('folder/notes.ts:2')] } as never, '2026-01-01');
    const idx = buildLinkIndex(w.manifest, w.root, citedPaths([], ['src/server.ts:4-6', 'README.md:1', 'folder/notes.ts:2']));
    const vm = (h: string) => JSON.parse(h.match(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/)![1]);
    const console = vm(linkifyReport(html, idx));
    assert.deepEqual(console.findings.map((x: any) => x.evidence[0].href), [`https://github.com/acme/api/blob/${SHA}/src/server.ts#L4-L6`, `https://github.com/cocos/engine/blob/${PUB}/README.md#L1`, undefined]);
    const share = vm(linkifyReport(html, idx, { publicOnly: true }));
    assert.deepEqual(share.findings.map((x: any) => x.evidence[0].href), [undefined, `https://github.com/cocos/engine/blob/${PUB}/README.md#L1`, undefined]);
    const json = linkifyReport(html, idx).match(/window\.__ACCEL_DATA__ = (\{[\s\S]*?\});<\/script>/)![1];
    assert.ok(!json.includes('<'), 'the re-serialized JSON still escapes <');
  } finally { w.done(); }
});

test('every report route passes the run\'s link index', async () => {
  const { readFileSync } = await import('node:fs');
  const srv = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  for (const route of ['/report', '/leadership', '/combined', '/workitems']) {
    const line = srv.split('\n').find((l) => l.includes(`if (m[2] === '${route}')`))!;
    assert.match(line, /reportForConsole\([^)]*, runLinks\(run\), runScope\(run\)\)/, route);   // + the report scope line
  }
  const org = readFileSync(new URL('./run/execute-org-run.ts', import.meta.url), 'utf8');
  assert.match(org, /saveLinkIndexFile\(ctx\.reportArtifactPath\(run\.id, 'links\.json'\), buildLinkIndex\(manifest, tmp, /, 'built while the workspace still exists');
});

// Click path: the pass injects ONE click handler with the marker (the report CSP has no allow-popups).
test('linkifyReport: injects the link-click handler exactly once, idempotently', async () => {
  const { LINK_CLICK_JS } = await import('./reportLinks.ts');
  const sha = 'b'.repeat(40);
  const idx = { v: 1 as const, repos: [{ owner: 'o', repo: 'r', sha, dir: 'r', public: true }], paths: { 'src/a.ts': [0, 'src/a.ts'] as [number, string] } };
  const once = linkifyReport('<!doctype html><html><head></head><body><code>src/a.ts:3</code></body></html>', idx);
  assert.equal(once.split(LINK_CLICK_JS).length - 1, 1);
  assert.match(once, /class="accel-ev-link"/);
  assert.equal(linkifyReport(once, idx), once);
  assert.match(LINK_CLICK_JS, /postMessage\(\{type:"accel-open-link"/);
  // The script's own guard refuses non-normal hrefs (.. / %2e / backslash) before navigating or posting.
  const guard = /\/%2e\|\\\/\\\.\{1,2\}\(\\\/\|\$\|#\)\|\\\\\/i/.exec(LINK_CLICK_JS);
  assert.ok(guard, 'LINK_CLICK_JS carries the non-normal-URL guard');
  const re = new Function(`return ${guard![0]}`)() as RegExp;
  assert.equal(re.test('https://github.com/a/b/blob/x/../../c'), true);
  assert.equal(re.test('https://github.com/a/b/blob/x/%2E%2E/c'), true);
  assert.equal(re.test('https://github.com/a/b/blob/x/a\\b'), true);
  assert.equal(re.test('https://github.com/a/b/blob/x/src/a.min.js#L2'), false);
});

// ky test run: engineering-report evidence refs are method descriptions with the files inside them.
test('permalinkFor: finds an embedded path in a descriptive evidence ref (and its workspace-relative form)', async () => {
  const { embeddedCitations, permalinkFor } = await import('./reportLinks.ts');
  const sha = 'c'.repeat(40);
  const idx = { v: 1 as const, repos: [{ owner: 'o', repo: 'r', sha, dir: 'r', public: true }], paths: { '.npmrc': [0, '.npmrc'] as [number, string], 'src/a.ts': [0, 'src/a.ts'] as [number, string] } };
  assert.deepEqual(embeddedCitations('code:glob+read (r/package.json, r/.npmrc)').map((c) => c.path), ['r/package.json', 'r/.npmrc']);
  assert.equal(permalinkFor(idx, 'code:glob+read (r/package.json, r/.npmrc)'), `https://github.com/o/r/blob/${sha}/.npmrc`);
  assert.equal(permalinkFor(idx, 'plane:unavailable→read (src/a.ts, readme.md)'), `https://github.com/o/r/blob/${sha}/src/a.ts`);
  assert.equal(permalinkFor(idx, 'repometa:meta_runs(2 pages)'), null);
  assert.equal(permalinkFor(idx, 'code:read (r/.npmrc)', { strict: true }), null, 'code spans stay strict');
});
