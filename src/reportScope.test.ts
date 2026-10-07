// Report scope (src/reportScope.ts): the scope list from each record a run may have, the /share policy, and the
// serve-time injection into every report shape — idempotent, and the Execution header no longer shows "people".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReportScope, injectReportScope, scopeForAudience, scopeInlineHtml, SCOPE_MARK, type ScopeEntry } from './reportScope.ts';
import { LINK_CLICK_JS, linkifyReport, type LinkIndex } from './reportLinks.ts';
import { renderFindingsHtml } from './reportHtml.ts';
import { injectProvenance } from './research/leadershipVibe.ts';
import { renderScopedReport } from './scopedTemplateHtml.ts';
import { buildScopedReportModel } from './scopedTemplateModel.ts';
import type { ScopedDossier } from './research/scopedInvestigate.ts';

const SHA = 'ec0ff50388c264ed8ce46f00967e92f7e71476ae';
const SHA2 = '0123456789abcdef0123456789abcdef01234567';
const manifest = { repos: [{ fullName: 'umami-software/umami', cloneUrl: 'https://github.com/umami-software/umami.git', sha: SHA, dir: 'umami', public: true }], localDirs: [] };

test('buildReportScope: the workspace manifest wins — repo + pinned commit, github hrefs, local folders by name', () => {
  const s = buildReportScope({ manifest: { repos: [...manifest.repos, { fullName: 'acme/api', cloneUrl: 'git@github.com:acme/api.git', sha: SHA2, dir: 'api', public: false }], localDirs: [{ name: 'design-docs', path: '/home/op/secret/design-docs' }] }, repoFilter: ['other/x'] })!;
  assert.deepEqual(s.map((e) => e.name), ['umami-software/umami', 'acme/api', 'design-docs']);
  assert.equal(s[0].href, 'https://github.com/umami-software/umami');
  assert.equal(s[0].shaHref, `https://github.com/umami-software/umami/tree/${SHA}`);
  assert.equal(s[0].public, true); assert.equal(s[1].public, false);
  assert.equal(s[2].kind, 'local'); assert.equal(s[2].href, undefined);
  assert.doesNotMatch(JSON.stringify(s), /\/home\/op/, 'a local folder is never a filesystem path');
});

test('buildReportScope: links sidecar, then clone-time code manifest, then filters (names only)', () => {
  const links: LinkIndex = { v: 1, repos: [{ owner: 'umami-software', repo: 'umami', sha: SHA, dir: 'umami', public: true }], paths: {} };
  assert.equal(buildReportScope({ links })![0].sha, SHA);
  const code = buildReportScope({ kind: 'ask', codeManifest: { repos: [{ fullName: 'acme/api', sha: SHA2 }], local: ['notes'] }, askRepos: [{ fullName: 'acme/ignored' }], publicNames: ['acme/api'] })!;
  assert.deepEqual(code.map((e) => [e.name, e.sha ?? null, e.public]), [['acme/api', SHA2, true], ['notes', null, false]]);
  const filters = buildReportScope({ repoFilter: ['acme/api'], giturlFilter: ['umami-software/umami'], localFilter: ['C:\\Users\\op\\work\\folder1'] })!;
  assert.deepEqual(filters.map((e) => [e.name, e.sha ?? null, e.public, e.kind]), [['acme/api', null, false, 'github'], ['umami-software/umami', null, true, 'github'], ['folder1', null, false, 'local']]);
  assert.equal(filters[0].href, 'https://github.com/acme/api');
});

test('buildReportScope: Quick Ask without a record uses askRepos + local names; empty ⇒ [] ("no code mounted"); legacy ⇒ null', () => {
  const ask = buildReportScope({ kind: 'ask', askRepos: [{ fullName: 'acme/api' }], askLocalNames: ['upload-1'] })!;
  assert.deepEqual(ask.map((e) => e.name), ['acme/api', 'upload-1']);
  assert.deepEqual(buildReportScope({ kind: 'ask', askRepos: [], askLocalNames: [] }), []);
  assert.equal(scopeInlineHtml([]), 'no code mounted');
  assert.equal(buildReportScope({ kind: 'org' }), null, 'a legacy org run with null filters is not reconstructible');
  assert.equal(buildReportScope({ kind: 'audit', auditRepos: [] }), null, 'an audit over AUDIT_ROOT is not knowable');
  assert.deepEqual(buildReportScope({ kind: 'audit', auditRepos: [{ fullName: 'acme/rec' }] })!.map((e) => e.name), ['acme/rec']);
});

test('share policy: a private repo keeps its name + short commit as plain text — no links; public repos keep both links', () => {
  const s = buildReportScope({ manifest: { repos: [...manifest.repos, { fullName: 'acme/api', cloneUrl: 'https://github.com/acme/api.git', sha: SHA2, dir: 'api' }], localDirs: [] } })!;
  const pub = scopeForAudience(s, { publicOnly: true });
  assert.equal(pub[0].shaHref, `https://github.com/umami-software/umami/tree/${SHA}`);
  assert.deepEqual(pub[1], { name: 'acme/api', kind: 'github', public: false, sha: SHA2.slice(0, 7) }, 'short commit only — the full SHA is dropped');
  const html = injectReportScope('<html><head></head><body><p>x</p></body></html>', s, { publicOnly: true, context: 'share' });
  assert.match(html, new RegExp(`acme/api @ ${SHA2.slice(0, 7)}(?!<\/a>)`), 'private: name @ short commit, plain text');
  assert.doesNotMatch(html, /github\.com\/acme/, 'no private link on /share');
  assert.doesNotMatch(html, new RegExp(SHA2.slice(0, 8)), 'never more than 7 chars of a private commit');
  // a private repo without a recorded commit is still just its name
  assert.deepEqual(scopeForAudience([{ name: 'acme/x', kind: 'github', public: false, href: 'https://github.com/acme/x' }], { publicOnly: true }), [{ name: 'acme/x', kind: 'github', public: false }]);
  // the "+N more" tooltip carries the private short commit too, still unlinked
  const many = scopeForAudience([...s, ...['a/1', 'a/2', 'a/3'].map((n) => buildReportScope({ repoFilter: [n] })![0])].reverse(), { publicOnly: true });
  assert.match(scopeInlineHtml(many), new RegExp(`title="[^"]*acme/api @ ${SHA2.slice(0, 7)}`));
  assert.match(html, /href="https:\/\/github\.com\/umami-software\/umami\/tree\/ec0ff50388c264ed8ce46f00967e92f7e71476ae"[^>]*>ec0ff50</);
  // the console (signed-in, own runs) keeps the private link
  assert.match(injectReportScope('<html><head></head><body></body></html>', s, { context: 'console' }), /github\.com\/acme\/api\/tree\/0123456789abcdef/);
});

test('more than 3 repos: first 3 + "+N more" with the rest in a tooltip', () => {
  const list: ScopeEntry[] = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'].map((n) => buildReportScope({ repoFilter: [n] })![0]);
  const h = scopeInlineHtml(list);
  assert.match(h, /a\/3<\/a> <span class="accel-scope-more" title="a\/4, a\/5">\+2 more<\/span>$/);
});

const scope = buildReportScope({ manifest })!;
const once = (html: string, ctx: 'console' | 'share' = 'console') => {
  const a = injectReportScope(html, scope, { context: ctx, publicOnly: ctx === 'share' });
  assert.equal(injectReportScope(a, scope, { context: ctx, publicOnly: ctx === 'share' }), a, 'idempotent (marker)');
  assert.equal(a.split(SCOPE_MARK).length, 2, 'one marker');
  return a;
};
const SCOPE_TEXT = /umami-software\/umami<\/a> @ <a [^>]*>ec0ff50<\/a>/;

test('Execution report: the header shows repo @ commit (no "people"); a strip under it carries the scope in the console', () => {
  const exec = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · umami', metrics: { summary: { org: true, repos: 1, people: 409, commits: 1200 } }, findings: [] }, '2026-10-01', false);
  const header = (h: string) => /<header class="topbar" id="repTopbar">[\s\S]*?<\/header>/.exec(h)![0];
  assert.doesNotMatch(header(exec), /people/, 'the renderer no longer puts the contributor count in the header');
  // an OLD stored report still says "409 people" — serving replaces the whole span
  const old = exec.replace(/(<span class="mono" style="font-size:11.5px;color:var\(--muted\)">)1 repo(<\/span>)/, '$11 repo · 409 people$2');
  assert.match(header(old), /409 people/);
  for (const ctx of ['console', 'share'] as const) {
    const out = once(old, ctx);
    assert.doesNotMatch(header(out), /people/);
    assert.match(header(out), SCOPE_TEXT);
    assert.match(out, /<\/header><div class="accel-scope-strip"[^>]*>Scope: <a /);
  }
  assert.doesNotMatch(once(old, 'console'), /:not\(\[style\*="none"\]\)\+\.accel-scope-strip\{display:none\}/, 'console: strip always shown');
  assert.match(once(old, 'share'), /#repTopbar:not\(\[style\*="none"\]\)\+\.accel-scope-strip\{display:none\}/, 'share: strip only where the header is hidden');
});

test('Leadership brief: injectProvenance writes no banner — the English Scope line is the one line on top', () => {
  const fresh = injectProvenance('<html><head></head><body><h1>Brief</h1></body></html>', '2026-10-01', 'jdoe');
  assert.equal(fresh, '<html><head></head><body><h1>Brief</h1></body></html>', 'injectProvenance writes no banner');
  const out = once(fresh);
  assert.doesNotMatch(out, /Generated 2026-10-01|Requested by/);
  assert.match(out, /<body><div class="accel-scope-line"[^>]*>Scope: <a [^>]*>umami-software\/umami<\/a> @ <a [^>]*>ec0ff50<\/a><\/div>\s*<h1>Brief/);
});

test('Quick Ask (scoped report): one Scope line at the top of the body', () => {
  const dossier: ScopedDossier = { question: 'q?', answer: 'a', bottomLine: ['b'], dataPoints: [], evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {} };
  const ask = renderScopedReport(buildScopedReportModel(dossier, { client: 'A', scope: 'Quick Ask · single question', date: '2026-10-03', title: 'T' }));
  const out = once(ask);
  assert.match(out, /<div class="accel-scope-line"[^>]*>Scope: <a [^>]*>umami-software\/umami<\/a> @ <a [^>]*>ec0ff50<\/a><\/div>/);
  assert.equal(out.match(/class="accel-scope-line"/g)?.length, 1, 'exactly one scope line');
  const empty = injectReportScope('<html><head></head><body><p>x</p></body></html>', [], { context: 'console' });
  assert.match(empty, /<div class="accel-scope-line"[^>]*>Scope: no code mounted<\/div>/);
  assert.doesNotMatch(empty, /accel-open-link/, 'no click router without links');
});

test('legacy / other reports (work items, area, combined): one line after <body>; unknowable scope ⇒ unchanged', () => {
  const plain = '<!doctype html><html><head><title>x</title></head><body><main>w</main></body></html>';
  const out = once(plain);
  assert.match(out, /<body><div class="accel-scope-line"[^>]*>Scope: [\s\S]*?<\/div><main>/);
  assert.equal(out.match(/class="accel-scope-line"/g)?.length, 1, 'exactly one scope line');
  assert.ok(out.startsWith('<!doctype html><html><head>' + SCOPE_MARK), 'marker inside <head>, never before the doctype');
  assert.equal(injectReportScope(plain, null), plain);
});

test('click router: added once — not when reportLinks already injected its handler', () => {
  const plain = '<html><head></head><body></body></html>';
  assert.equal(once(plain).split(LINK_CLICK_JS).length, 2);
  const idx: LinkIndex = { v: 1, repos: [{ owner: 'umami-software', repo: 'umami', sha: SHA, dir: 'umami', public: true }], paths: { 'src/a.ts': [0, 'src/a.ts'] } };
  const linked = linkifyReport('<html><head></head><body><code>src/a.ts:3</code></body></html>', idx);
  assert.equal(injectReportScope(linked, scope, { context: 'console' }).split(LINK_CLICK_JS).length, 2, 'still exactly one handler');
});
