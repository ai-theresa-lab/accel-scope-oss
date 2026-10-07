import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAND_NAME, mastheadHtml, normalizeBrand, stripExternalFontLinks } from './reportChrome.ts';
import { renderRecallReport } from './recallReportHtml.ts';

// Reports once carried several spellings of the product brand (reversed word order, stray product names in the
// masthead alt text and the Quick Ask wordmark). One brand string, everywhere a report is rendered or briefed.

// Every report renderer and every writer brief that names the brand.
const SURFACES = [
  'recallReportHtml.ts', 'reportHtml.ts', 'reportChrome.ts', 'scopedTemplateHtml.ts', 'scopedTemplateModel.ts',
  'research/leadershipWriter.ts', 'research/reportContract.ts',
];
// The known wrong variants: a legacy product word, reversed order, or a non-canonical separator / casing.
const WRONG = /\btheresa\b|\bscope[\s-]*accel\b|\bAccel[\s-]*Scope\b|\baccel\s+scope\b/;

test('no renderer or writer brief spells the brand any way but "accel-scope"', () => {
  assert.equal(BRAND_NAME, 'accel-scope');
  for (const rel of SURFACES) {
    const src = readFileSync(new URL('./' + rel, import.meta.url), 'utf8');
    const hit = src.match(WRONG);
    assert.equal(hit, null, `${rel} carries a non-canonical brand string: "${hit?.[0]}"`);
  }
});

test('the shared masthead and the recall renderer emit the canonical brand', () => {
  const mh = mastheadHtml({ brand: { name: BRAND_NAME, sub: '' }, kicker: 'k', confidential: 'c' });
  assert.match(mh, /alt="accel-scope"/);
  assert.doesNotMatch(mh, WRONG);
  const html = renderRecallReport({
    company: 'Acme', title: 't', question: 'q', meta: 'm', bottomLine: 'b',
    cards: [], sections: [], decisive: '', recommendations: [], caveats: 'c',
  });
  assert.match(html, /<span class="blogo">accel-scope<\/span>/);
  assert.doesNotMatch(html, WRONG);
});

// A free-vibe leadership author can write "ACCEL SCOPE · AUDIT" as literal text.
test('normalizeBrand rewrites the brand in model-authored TEXT, never in tags / style / script', () => {
  const html = '<style>.accel-scope{text-transform:uppercase}</style><span class="brand accel-scope">ACCEL SCOPE · AUDIT</span><p>By Accel-Scope and accel scope.</p><script>var accel_scope = 1</script>';
  const out = normalizeBrand(html);
  assert.match(out, /<span class="brand accel-scope">accel-scope · AUDIT<\/span>/);
  assert.match(out, /By accel-scope and accel-scope\./);
  assert.match(out, /<style>\.accel-scope\{/);
  assert.match(out, /var accel_scope = 1/);
});

// The reading room logged a CSP error for the Google Fonts stylesheet on every report view.
test('font-host <link>s are stripped at serve time, and the deterministic report no longer emits one', () => {
  const html = '<head><link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">\n<link rel="icon" href="data:,"><style>a{}</style></head>';
  const out = stripExternalFontLinks(html);
  assert.doesNotMatch(out, /fonts\.(googleapis|gstatic)/);
  assert.match(out, /<link rel="icon" href="data:,">/);
  const src = readFileSync(new URL('./reportHtml.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fonts\.googleapis\.com/);
});
