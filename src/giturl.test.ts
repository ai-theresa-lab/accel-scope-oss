import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoRef } from './github.ts';

// The "paste a public GitHub URL" Connect source (server.ts POST /api/sources kind:'giturl') validates
// every pasted line through parseRepoRef — which is BOTH the parser and the github.com-only SSRF guard.
// These tests pin that guard + the split/dedup/cap semantics the handler layers on top.

test('parseRepoRef accepts public github.com URLs (https, .git, trailing path) → cloneUrl', () => {
  for (const u of [
    'https://github.com/cocos/cocos4',
    'https://github.com/cocos/cocos4.git',
    'http://github.com/facebook/react',
    'github.com/octocat/Hello-World',
    'https://github.com/owner/repo/tree/main',
  ]) {
    const r = parseRepoRef(u);
    assert.ok(r, `should parse: ${u}`);
    assert.match(r!.cloneUrl, /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/, `clean github clone URL for ${u}`);
  }
  assert.equal(parseRepoRef('https://github.com/cocos/cocos4')!.fullName, 'cocos/cocos4');
});

test('parseRepoRef accepts owner/repo shorthand', () => {
  const r = parseRepoRef('cocos/cocos4');
  assert.equal(r?.fullName, 'cocos/cocos4');
  assert.equal(r?.cloneUrl, 'https://github.com/cocos/cocos4.git');
});

test('parseRepoRef REJECTS non-github / SSRF-shaped refs (the guard)', () => {
  for (const bad of [
    'https://gitlab.com/foo/bar',
    'https://evil.example.com/x/y',
    'ssh://git@internal/repo',
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data',
    'https://github.com.evil.com/a/b',   // not the github.com host
    'https://evil.test/path/github.com/owner/repo',   // "github.com/owner/repo" as PATH text on a different host — a substring search would wrongly accept this
    'https://evil.test/github.com:owner/repo',
    'not a url',
    '',
  ]) {
    assert.equal(parseRepoRef(bad), null, `must reject: ${bad}`);
  }
});

// The handler's line-processing (split on whitespace/commas, keep valid, dedup by fullName, cap 20) —
// mirrored here as a pure re-implementation so the behavior is pinned even though it lives inline.
function processUrls(raw: string, cap = 20): { added: string[]; rejected: string[]; capped: boolean } {
  const lines = raw.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
  const added: string[] = []; const rejected: string[] = []; const seen = new Set<string>(); let capped = false;
  for (const line of lines) {
    const r = parseRepoRef(line);
    if (!r) { rejected.push(line); continue; }
    if (seen.has(r.fullName)) continue;
    if (added.length >= cap) { capped = true; break; }
    seen.add(r.fullName); added.push(r.fullName);
  }
  return { added, rejected, capped };
}

test('handler semantics: split, keep-valid, reject-invalid, dedup, cap', () => {
  const res = processUrls('https://github.com/a/b\nhttps://gitlab.com/x/y  github.com/a/b\nc/d , garbage');
  assert.deepEqual(res.added, ['a/b', 'c/d']);          // a/b deduped; c/d shorthand kept
  assert.deepEqual(res.rejected.sort(), ['garbage', 'https://gitlab.com/x/y']);
  assert.equal(res.capped, false);

  const many = Array.from({ length: 25 }, (_, i) => `github.com/org/repo${i}`).join('\n');
  const capped = processUrls(many, 20);
  assert.equal(capped.added.length, 20);
  assert.equal(capped.capped, true);
});
