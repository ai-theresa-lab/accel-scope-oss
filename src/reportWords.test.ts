import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countReportWords, reportFileWords } from './reportWords.ts';

test('countReportWords: counts visible Latin words, ignores script/style/svg and tags', () => {
  const html = '<html><head><style>.a{color:red}</style><script>var x = "lots of words here";</script></head>'
    + '<body><h1>Three word title</h1><p>and <b>four</b> more words</p><svg><text>ignored svg text</text></svg></body></html>';
  assert.equal(countReportWords(html), 7);
});
test('countReportWords: a page with enough Latin text reads as its Latin length; a CJK-only page falls back to chars/2', () => {
  const en = Array.from({ length: 60 }, (_, i) => 'word' + String.fromCharCode(97 + (i % 26))).join(' ');
  assert.equal(countReportWords(`<p>${en}</p><p>\u8fd9\u662f\u4e2d\u6587\u5185\u5bb9</p>`), 60);
  assert.equal(countReportWords('<p>\u8fd9\u662f\u4e00\u4efd\u53ea\u6709\u4e2d\u6587\u7684\u62a5\u544a\u5185\u5bb9</p>'), 7);
});
test('reportFileWords: null for a missing file; memoized value refreshes when the file changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'));
  try {
    const p = join(dir, 'r.html');
    const t0 = 1_000_000;
    assert.equal(reportFileWords(p, t0), null);
    writeFileSync(p, '<p>one two three</p>');
    assert.equal(reportFileWords(p, t0), 3);
    writeFileSync(p, '<p>one two three four five</p>');
    // Within the stat TTL the memo is trusted (no stat on a network mount); after it the change is picked up.
    assert.equal(reportFileWords(p, t0 + 30_000), 3);
    assert.equal(reportFileWords(p, t0 + 61_000), 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('peekReportWords: never blocks — null until the background count lands, then the memoized count', async () => {
  const { peekReportWords, reportWordsSettled } = await import('./reportWords.ts');
  const dir = mkdtempSync(join(tmpdir(), 'rwp-'));
  try {
    const p = join(dir, 'r.html');
    writeFileSync(p, '<p>alpha beta gamma delta</p>');
    assert.equal(peekReportWords(p), null, 'first read is not counted inline');
    await reportWordsSettled();
    assert.equal(peekReportWords(p), 4);
    assert.equal(peekReportWords(join(dir, 'missing.html')), null);
    await reportWordsSettled();
    assert.equal(peekReportWords(join(dir, 'missing.html')), null, 'an absent file stays uncounted');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
