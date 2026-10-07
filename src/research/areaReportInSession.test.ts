import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapePreBlocks } from './reportEvidence.ts';

// the single-session Expert authors raw HTML and leaves bare operators in <pre> SQL drawers, so the browser
// swallows the predicate and the QC judge HARD-fails "SQL not re-runnable" every round. escapePreBlocks normalizes it.

test('escapePreBlocks escapes bare &,<,> only inside <pre>, leaving prose untouched', () => {
  const raw = `<h1>x</h1><pre>WHERE a < b AND c >= d AND e & f</pre><p>prose < keep &</p>`;
  const out = escapePreBlocks(raw);
  assert.match(out, /<pre>WHERE a &lt; b AND c &gt;= d AND e &amp; f<\/pre>/);
  // prose outside <pre> is NOT touched (only SQL drawers render broken from a bare <)
  assert.match(out, /<p>prose < keep &<\/p>/);
});

test('escapePreBlocks is idempotent — an already-escaped entity is not double-encoded', () => {
  const already = `<pre>WHERE a &lt; b AND c &gt;= d AND g &amp; h</pre>`;
  assert.equal(escapePreBlocks(already), already);
  // and applying it twice equals applying it once (no &amp;lt; drift)
  const raw = `<pre>x < y & z</pre>`;
  assert.equal(escapePreBlocks(escapePreBlocks(raw)), escapePreBlocks(raw));
});

test('escapePreBlocks handles multiple <pre> blocks and attributes on the tag', () => {
  const raw = `<pre class="sql">a < b</pre><span>ok</span><pre>c > d</pre>`;
  const out = escapePreBlocks(raw);
  assert.match(out, /<pre class="sql">a &lt; b<\/pre>/);
  assert.match(out, /<pre>c &gt; d<\/pre>/);
});

test('escapePreBlocks preserves numeric/hex/named entities inside <pre>', () => {
  const raw = `<pre>x &#39; y &#x27; z < w &nbsp; &eacute;</pre>`;
  const out = escapePreBlocks(raw);
  assert.match(out, /&#39;/);
  assert.match(out, /&#x27;/);
  assert.match(out, /z &lt; w/);
  assert.match(out, /&nbsp;/);      // well-formed named entity preserved, not &amp;nbsp;
  assert.match(out, /&eacute;/);
  assert.doesNotMatch(out, /&amp;nbsp;/);
});
