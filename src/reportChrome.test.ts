import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentHash, anchorAttr, dedupeAnchorIds, canonicalJson, REPORT_CSS, REPORT_STATUS, REPORT_STATUS_COLORS, REPORT_STATUS_CSS, statusChipHtml, statusFromVerdict } from './reportChrome.ts';

// contentHash + anchorAttr back the comment-anchoring feature: report blocks get a data-anchor-id that is
// CONTENT-derived (semantic key or contentHash), never positional — so a saved comment can never migrate onto
// a different block when the report is regenerated (insert/remove/reorder).

test('contentHash is deterministic and content-derived (same content → same id; different → different)', () => {
  assert.equal(contentHash('cache stampede on cold start'), contentHash('cache stampede on cold start'));
  assert.notEqual(contentHash('finding A'), contentHash('finding B'));
  assert.match(contentHash('anything at all'), /^[0-9a-f]{16}$/); // 64-bit hex digest — safe inside an attribute
});

test('contentHash hashes VERBATIM — no normalization: whitespace AND case are significant', () => {
  assert.notEqual(contentHash('a  b'), contentHash('a b')); // meaningful internal whitespace preserved
  assert.notEqual(contentHash('  x'), contentHash('x'));    // leading/trailing whitespace preserved (no trim)
  assert.notEqual(contentHash('src/a b.ts'), contentHash('src/a  b.ts')); // a path w/ double space is distinct
  // case is significant — a case-sensitive path ref must not conflate with its lowercased form
  assert.notEqual(contentHash('src/Foo.ts'), contentHash('src/foo.ts'));
  assert.notEqual(contentHash('The Claim'), contentHash('the claim'));
});

test('contentHash is a WIDE (64-bit) collision-resistant digest', () => {
  assert.match(contentHash('x'), /^[0-9a-f]{16}$/);                 // exactly 16 hex chars
  assert.equal(contentHash('exact input'), contentHash('exact input')); // deterministic
  const many = new Set(Array.from({ length: 2000 }, (_, i) => contentHash(`block-${i}`)));
  assert.equal(many.size, 2000, 'no collisions across 2000 distinct inputs');
});

test('anchorAttr emits an INERT, escaped, leading-space attribute', () => {
  assert.equal(anchorAttr('section-overview'), ' data-anchor-id="section-overview"');
  // hostile chars can never break out of the attribute
  assert.equal(anchorAttr('a"b<c'), ' data-anchor-id="a&quot;b&lt;c"');
});

test('dedupeAnchorIds makes duplicates unique (x, x-2, x-3), leaves distinct ids untouched, is deterministic', () => {
  assert.deepEqual(dedupeAnchorIds(['x', 'x', 'x']), ['x', 'x-2', 'x-3']);          // N identical → suffixed in order
  assert.deepEqual(dedupeAnchorIds(['a', 'b', 'c']), ['a', 'b', 'c']);              // all distinct → unchanged
  assert.deepEqual(dedupeAnchorIds(['a', 'b', 'a', 'b', 'a']), ['a', 'b', 'a-2', 'b-2', 'a-3']);
  assert.deepEqual(dedupeAnchorIds(['x', 'x']), dedupeAnchorIds(['x', 'x']));       // deterministic across runs
  assert.equal(new Set(dedupeAnchorIds(['x', 'x', 'x', 'y'])).size, 4);             // output is unique
});

test('canonicalJson: key order does not matter, arrays are ordered, undefined keys dropped, nesting canonicalized', () => {
  // same content in different key insertion order → identical serialization (so it hashes the same)
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
  // an undefined-valued key is dropped (so { ...f, id: undefined } excludes id)
  assert.equal(canonicalJson({ a: 1, id: undefined }), '{"a":1}');
  // array ORDER is meaningful (not sorted); nested objects are canonicalized recursively
  assert.notEqual(canonicalJson({ ev: [1, 2] }), canonicalJson({ ev: [2, 1] }));
  assert.equal(canonicalJson({ x: { d: 1, c: 2 } }), '{"x":{"c":2,"d":1}}');
  // a change in ANY nested field changes the output
  assert.notEqual(canonicalJson({ e: [{ ref: 'a', detail: 'x' }] }), canonicalJson({ e: [{ ref: 'a', detail: 'y' }] }));
});

test('dedupeAnchorIds: a generated suffix never collides with a RESERVED natural input id', () => {
  // the 2nd "x" cannot take "x-2" because "x-2" is another block's natural id → it skips to "x-3"
  const out = dedupeAnchorIds(['x', 'x', 'x-2']);
  assert.deepEqual(out, ['x', 'x-3', 'x-2']);
  assert.equal(new Set(out).size, out.length, 'no duplicate output');
  const inputs = new Set(['x', 'x', 'x-2']);
  out.forEach((o, i) => { if (o !== ['x', 'x', 'x-2'][i]) assert.ok(!inputs.has(o), `generated id ${o} must not equal any input`); });
});

test('dedupeAnchorIds: pre-RESERVED ids (e.g. document scaffold) are kept; a matching input is suffixed, not duplicated', () => {
  // a section keyed like a scaffold block → suffixed; the scaffold id itself is NOT in this call's output
  assert.deepEqual(dedupeAnchorIds(['section-bottom-line'], ['section-bottom-line']), ['section-bottom-line-2']);
  // a distinct input is untouched by the reservation
  assert.deepEqual(dedupeAnchorIds(['section-x'], ['section-bottom-line']), ['section-x']);
  // reserved ids + inputs share one namespace; no output equals a reserved id or another output
  const out = dedupeAnchorIds(['a', 'a', 'b'], ['a', 'b']);
  assert.deepEqual(out, ['a-2', 'a-3', 'b-2']);
  assert.equal(new Set([...out, 'a', 'b']).size, 5, 'no output collides with a reserved id or another output');
});

// ── one status vocabulary / contrast floor ─────────────────────────────────────────────────────────

test('exactly four statuses, one chip class each', () => {
  assert.deepEqual(Object.keys(REPORT_STATUS), ['confirmed', 'ruled-out', 'needs-test', 'not-measurable']);
  assert.deepEqual(Object.values(REPORT_STATUS).map((s) => [s.label, s.cls]), [
    ['Confirmed', 'st-confirmed'],
    ['Ruled out', 'st-ruled-out'],
    ['Needs a test', 'st-needs-test'],
    ['Not measurable here', 'st-not-measurable'],
  ]);
  for (const s of Object.values(REPORT_STATUS)) assert.match(REPORT_STATUS_CSS, new RegExp(String.raw`\.${s.cls}\{`));
  assert.equal(statusChipHtml('needs-test'), '<span class="st st-needs-test">Needs a test</span>');
});

test('statusFromVerdict maps every existing verdict / disposition word onto the four', () => {
  const cases: Array<[unknown, string]> = [
    ['supported', 'confirmed'], ['confirmed', 'confirmed'], ['supports', 'confirmed'], ['win', 'confirmed'], ['no-free-lunch', 'confirmed'], [true, 'confirmed'],
    ['refuted', 'ruled-out'], ['healthy', 'ruled-out'], ['refutes', 'ruled-out'], ['invalid-multilever', 'ruled-out'], ['Ruled out', 'ruled-out'], [false, 'ruled-out'],
    ['open', 'needs-test'], ['blocked-need-eval', 'needs-test'], ['pending', 'needs-test'], ['unmeasured', 'needs-test'], ['unsettled', 'needs-test'],
    ['mixed', 'needs-test'], ['budget_skipped', 'needs-test'], ['node_failed', 'needs-test'], ['claim_rejected', 'needs-test'],
    ['blocked', 'not-measurable'], ['not_evidenceable', 'not-measurable'], ['not measurable here', 'not-measurable'], ['not_applicable', 'not-measurable'],
    ['something new', 'needs-test'], [undefined, 'needs-test'], ['', 'needs-test'],
  ];
  for (const [v, want] of cases) assert.equal(statusFromVerdict(v), want, String(v));
});

// WCAG relative-luminance contrast of two #rrggbb colors.
function contrast(a: string, b: string): number {
  const lum = (h: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const tok = (css: string, name: string): string => {
  const m = new RegExp(String.raw`--${name}:\s*(#[0-9A-Fa-f]{6})`).exec(css);
  assert.ok(m, `token --${name} present`);
  return m![1];
};

test('the deterministic renderers\' small-label tokens clear 4.5:1 on their own grounds', () => {
  const pairs: Array<[string, string, string]> = [];
  // reportChrome REPORT_CSS — light block (first :root) and the dark block.
  const light = REPORT_CSS.slice(0, REPORT_CSS.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = REPORT_CSS.slice(REPORT_CSS.indexOf('@media (prefers-color-scheme: dark)'), REPORT_CSS.indexOf(':root[data-theme="light"]'));
  for (const [css, tag] of [[light, 'light'], [dark, 'dark']] as const) {
    for (const bg of ['ground', 'surface', 'surface-2']) pairs.push([`chrome ${tag} ink-3/${bg}`, tok(css, 'ink-3'), tok(css, bg)]);
  }
  pairs.push(['chrome accent/accent-soft', tok(light, 'accent'), tok(light, 'accent-soft')]);
  pairs.push(['chrome na/na-bg (P3 badge)', tok(light, 'na'), tok(light, 'na-bg')]);
  const forced = REPORT_CSS.slice(REPORT_CSS.indexOf(':root[data-theme="light"]'), REPORT_CSS.indexOf(':root[data-theme="dark"]'));
  pairs.push(['chrome forced-light ink-3/ground', tok(forced, 'ink-3'), tok(forced, 'ground')]);
  // reportHtml.ts (engineering report) and recallReportHtml.ts (structured leadership / area) — read from source, the
  // tokens live in a module-private CSS string.
  const eng = readFileSync(new URL('./reportHtml.ts', import.meta.url), 'utf8');
  for (const fg of ['muted', 'honey-link']) for (const [bgName, bg] of [['cream', tok(eng, 'cream')], ['cream-card', tok(eng, 'cream-card')], ['selected card', '#FBF3E2'], ['hero', '#FBF6EC']]) pairs.push([`engineering ${fg}/${bgName}`, tok(eng, fg), bg]);
  const rec = readFileSync(new URL('./recallReportHtml.ts', import.meta.url), 'utf8');
  for (const fg of ['muted', 'honey-link']) for (const [bgName, bg] of [['cream', tok(rec, 'cream')], ['card', tok(rec, 'card')], ['table head', '#F3EEE4'], ['decisive', '#FBF1D8']]) pairs.push([`recall ${fg}/${bgName}`, tok(rec, fg), bg]);
  for (const [k, c] of Object.entries(REPORT_STATUS_COLORS)) pairs.push([`status chip ${k}`, c.fg, c.bg]);
  for (const [name, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}:1`);
});

test('the print/readability patch is idempotent and lands before </head>', async () => {
  const { withPrintPatch, REPORT_PRINT_PATCH, REPORT_PRINT_MARK } = await import('./reportChrome.ts');
  const doc = '<!doctype html><html><head><title>t</title></head><body><details><summary>s</summary>x</details></body></html>';
  const once = withPrintPatch(doc);
  assert.ok(once.includes(`${REPORT_PRINT_PATCH}</head>`));
  assert.equal(withPrintPatch(once), once, 'a second pass is a no-op');
  assert.equal(once.split(REPORT_PRINT_MARK).length, 3, 'one style + one script');
  assert.match(REPORT_PRINT_PATCH, /@media print\{/);
  assert.match(REPORT_PRINT_PATCH, /\.mini-toc,\.rail[^{]*\{display:none!important\}/, 'rails / assistant / toolbars hidden in print');
  assert.match(REPORT_PRINT_PATCH, /beforeprint[\s\S]*details:not\(\[open\]\)[\s\S]*'position','static','important'/, 'details expanded, fixed/sticky un-fixed');
  assert.match(REPORT_PRINT_PATCH, /break-inside:avoid/);
  assert.match(REPORT_PRINT_PATCH, /\.st-confirmed\{/, 'LLM reports that use the status chip classes get their styles');
  // umami sample run: clearing EVERY background erased the bar charts (a bar fill is an empty element whose width IS the
  // data). Backgrounds are cleared only on elements with content; empty elements print theirs.
  assert.match(REPORT_PRINT_PATCH, /\*:not\(:empty\),\*::before,\*::after\{background:transparent!important/);
  assert.match(REPORT_PRINT_PATCH, /:empty\{-webkit-print-color-adjust:exact;print-color-adjust:exact\}/);
  assert.doesNotMatch(REPORT_PRINT_PATCH, /\*,\*::before,\*::after\{[^}]*background:transparent/, 'no blanket background wipe');
  const script = REPORT_PRINT_PATCH.slice(REPORT_PRINT_PATCH.indexOf('<script'), REPORT_PRINT_PATCH.lastIndexOf('</script>')).replace(/^<script[^>]*>/, '');
  assert.doesNotThrow(() => new Function(script));
  assert.ok(withPrintPatch('<p>fragment</p>').startsWith(REPORT_PRINT_PATCH), 'a head-less fragment still gets it');
});

test('the console serve path applies the patch, after the link pass', () => {
  const srv = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const fn = (name: string) => srv.slice(srv.indexOf(`function ${name}(`), srv.indexOf('\n}', srv.indexOf(`function ${name}(`)));
  // report scope (reportScope.ts) wraps the link pass: links first, then the scope line, then the print patch
  assert.match(fn('reportForConsole'), /return withPrintPatch\(injectBeforeHead\(injectReportScope\(linkifyReport\(html, links\), scope \?\? null, \{ context: 'console' \}\), /);
});
