import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRecallReport, recallFooter, reportHasCodeintelViz, anyReportHasCodeintelViz, RECALL_SUBTITLE, type RecallReportInput, type RecallSection } from './recallReportHtml.ts';
import { CODEINTEL_VIZ_MARKER } from './codeintelViz.ts';

const INPUT: RecallReportInput = {
  company: 'Acme',
  title: 'Recall stack review',
  question: 'Does each recall source earn its keep?',
  meta: 'single-day + 6h · read-only · 2026-06-25',
  bottomLine: 'Fix the config gap before trusting experiments; the two-tower keep/cut needs an A/B.',
  cards: [{ v: '0 / 3', label: 'config fidelity' }],
  sections: [
    { n: '01', heading: 'Can experiments be trusted? No', body: 'The live config differs from the audited one.',
      viz: { kind: 'table', head: ['source', 'declared', 'live'], rows: [['two-tower', 'off', '~3.2%']] } },
  ],
  decisive: 'Only a removal A/B can settle whether the two-tower source earns its cost.',
  recommendations: ['Audit on the deployed config.'],
  caveats: 'Read-only; experiment-dependent judgements flagged.',
};

test('renderRecallReport emits the deep-brief sections, cards, decisive box', () => {
  const html = renderRecallReport(INPUT);
  assert.match(html, /<h1>Recall stack review<\/h1>/);
  assert.match(html, /^<!doctype html><html lang="en">/);
  assert.doesNotMatch(html, /langtog|data-l=|class="lang-/, 'no language toggle or language classes');
  assert.match(html, /Bottom line/);
  assert.match(html, /0 \/ 3/);                      // metric card
  assert.match(html, /The decisive test/);
  assert.match(html, /removal A\/B/);               // decisive content
  assert.match(html, /<table>/);                     // section table rendered
  assert.match(html, /<th>source<\/th><th>declared<\/th><th>live<\/th>/);
  assert.match(html, /Recommendation/);
});

test('renderRecallReport is robust to empty optional parts (no cards / no decisive)', () => {
  const html = renderRecallReport({ ...INPUT, cards: [], decisive: '', recommendations: [] });
  assert.match(html, /Recall stack review/);
  assert.doesNotMatch(html, /The decisive test/);    // decisive box omitted when empty
});

// ── comment-anchoring: content-stable ids, NEVER the positional s.n (guards the anchor fix) ──────────────────────
// the data-anchor-id of the <section ...> fragment (a numbered section) whose <h2> contains `needle`
const sectionAnchorFor = (html: string, needle: string): string => {
  const frag = html.split('<section ').find((f) => f.includes(needle)) ?? '';
  return (frag.match(/data-anchor-id="([^"]+)"/) ?? [, ''])[1]!;
};

test('scaffold blocks carry FIXED semantic anchors; a keyed section uses section-<key>; NO section-<s.n> anywhere', () => {
  const html = renderRecallReport({
    ...INPUT,
    sections: [
      { n: '01', key: 'method-coverage', heading: 'Method coverage', body: 'b' },
      { n: '02', heading: 'Latency regressed', body: 'b' }, // LLM section, no key
    ],
  });
  const ids = [...html.matchAll(/data-anchor-id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['section-bottom-line', 'section-decisive', 'section-caveats', 'section-recommendations', 'section-method-coverage']) {
    assert.ok(ids.includes(id), `${id} present`);
  }
  assert.ok(!ids.some((x) => /^section-0\d$/.test(x)), 'no positional section-<s.n> anchor'); // s.n was 01/02
});

test('a section anchor follows its CONTENT, not its position: reorder-stable; heading change → new id; siblings unchanged', () => {
  const secA: RecallSection = { n: '01', heading: 'Alpha regression', body: 'x' };
  const secB: RecallSection = { n: '02', heading: 'Beta coupling', body: 'y' };
  const order1 = renderRecallReport({ ...INPUT, sections: [secA, secB] });
  const order2 = renderRecallReport({ ...INPUT, sections: [secB, secA] }); // swapped → s.n renumbers, content does not
  assert.equal(sectionAnchorFor(order1, 'Alpha'), sectionAnchorFor(order2, 'Alpha')); // non-positional
  assert.equal(sectionAnchorFor(order1, 'Beta'), sectionAnchorFor(order2, 'Beta'));
  assert.notEqual(sectionAnchorFor(order1, 'Alpha'), sectionAnchorFor(order1, 'Beta')); // distinct content → distinct id
  // reword Alpha → its id changes (orphan, correct); Beta's id is untouched (no mis-attach)
  const edited = renderRecallReport({ ...INPUT, sections: [{ ...secA, heading: 'Alpha regression REWORDED' }, secB] });
  assert.notEqual(sectionAnchorFor(edited, 'REWORDED'), sectionAnchorFor(order1, 'Alpha'));
  assert.equal(sectionAnchorFor(edited, 'Beta coupling'), sectionAnchorFor(order1, 'Beta'));
});

test('two UNKEYED sections sharing a heading but differing in BODY get DIFFERENT anchors (no collision)', () => {
  const secA: RecallSection = { n: '01', heading: 'Same heading', body: 'body ONE' };
  const secB: RecallSection = { n: '02', heading: 'Same heading', body: 'body TWO' };
  const html = renderRecallReport({ ...INPUT, sections: [secA, secB] });
  const idA = sectionAnchorFor(html, 'body ONE');
  const idB = sectionAnchorFor(html, 'body TWO');
  assert.ok(idA && idB);
  assert.notEqual(idA, idB, 'the body discriminates unkeyed sections that share a heading');
});

test('sections with genuinely IDENTICAL content are still UNIQUE via dedupe (section-<id>, -2, -3), deterministic', () => {
  // three sections with the SAME heading AND body (even the same semantic key) → same base id → deduped in order
  const twin = (n: string): RecallSection => ({ n, key: 'method-coverage', heading: 'Method coverage', body: 'identical' });
  const idsOf = (html: string): string[] => [...html.matchAll(/<section [^>]*data-anchor-id="([^"]+)"/g)].map((m) => m[1]);
  const ids1 = idsOf(renderRecallReport({ ...INPUT, sections: [twin('01'), twin('02'), twin('03')] }));
  const ids2 = idsOf(renderRecallReport({ ...INPUT, sections: [twin('01'), twin('02'), twin('03')] }));
  assert.deepEqual(ids1, ['section-method-coverage', 'section-method-coverage-2', 'section-method-coverage-3']);
  assert.deepEqual(ids1, ids2, 'deterministic across renders');
});

test('section fallback is delimiter-UNAMBIGUOUS (canonicalJson, not a |-join): |-colliding content gets DISTINCT ids', () => {
  // a naive [heading, body].join('|') maps BOTH of these to 'alpha|beta|z' — a false collision.
  const secA: RecallSection = { n: '01', heading: 'alpha|beta', body: 'z' };
  const secB: RecallSection = { n: '02', heading: 'alpha', body: 'beta|z' };
  const html = renderRecallReport({ ...INPUT, sections: [secA, secB] });
  const idA = sectionAnchorFor(html, 'alpha|beta'); // secA's en heading (unique substring)
  const idB = sectionAnchorFor(html, '<h2>alpha</h2>'); // secB's heading
  assert.ok(idA && idB);
  assert.notEqual(idA, idB, 'canonicalJson disambiguates field boundaries a |-join would conflate');
});

const sectionIds = (html: string): string[] => [...html.matchAll(/<section [^>]*data-anchor-id="([^"]+)"/g)].map((m) => m[1]);

test('unkeyed section hashes the FULL content incl. viz: same heading+body but DIFFERENT viz → DISTINCT ids (no dedupe)', () => {
  const heading = 'Chart';
  const body = 'same body';
  const secA: RecallSection = { n: '01', heading, body, viz: { kind: 'gauge', pct: 20, label: 'A' } };
  const secB: RecallSection = { n: '02', heading, body, viz: { kind: 'gauge', pct: 80, label: 'A' } };
  const ids = sectionIds(renderRecallReport({ ...INPUT, sections: [secA, secB] }));
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1], 'different viz → different base id (viz is part of the serialized content)');
  // bare base ids (section-<16 hex>), i.e. NO `-N` dedupe suffix (they didn't collide)
  assert.match(ids[0], /^section-[0-9a-f]{16}$/); assert.match(ids[1], /^section-[0-9a-f]{16}$/);
});

test('truly-identical unkeyed sections (incl. viz) still dedupe deterministically (section-<hash>, -2, -3)', () => {
  const viz = { kind: 'gauge' as const, pct: 42, label: 'L' };
  const twin = (n: string): RecallSection => ({ n, heading: 'Same', body: 'same', viz });
  const ids1 = sectionIds(renderRecallReport({ ...INPUT, sections: [twin('01'), twin('02'), twin('03')] }));
  const ids2 = sectionIds(renderRecallReport({ ...INPUT, sections: [twin('01'), twin('02'), twin('03')] }));
  assert.equal(new Set(ids1).size, 3, 'three byte-identical sections still get three unique ids');
  assert.equal(ids1[1], `${ids1[0]}-2`); assert.equal(ids1[2], `${ids1[0]}-3`);
  assert.deepEqual(ids1, ids2, 'deterministic across renders');
});

test('decomposition-shaped sections: SAME claim (heading+body) but DIFFERENT table content → DISTINCT ids; reorder-stable', () => {
  // mirrors bundleReport decomposition: two hypotheses share a claim but measured different sub-measurement tables.
  // A claim-only `key` (the removed partial key) collided them; the unkeyed complete-content path includes the viz table.
  const heading = 'Decomposition · recall starves diversity';
  const body = 'measured angles';
  const secA: RecallSection = { n: '01', heading, body, viz: { kind: 'table', head: ['move', 'value'], rows: [['overlap', '0.42']] } };
  const secB: RecallSection = { n: '02', heading, body, viz: { kind: 'table', head: ['move', 'value'], rows: [['overlap', '0.91']] } };
  const ids = sectionIds(renderRecallReport({ ...INPUT, sections: [secA, secB] }));
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1], 'same claim, different table rows → different base id (the table is in the hash)');
  assert.match(ids[0], /^section-[0-9a-f]{16}$/); assert.match(ids[1], /^section-[0-9a-f]{16}$/); // bare base ids, no dedupe suffix
  // reorder → each id follows its content (secA keeps ids[0], secB keeps ids[1])
  assert.deepEqual(sectionIds(renderRecallReport({ ...INPUT, sections: [secB, secA] })), [ids[1], ids[0]]);
});

test('document-wide dedupe: a dynamic section keyed like a SCAFFOLD block never duplicates the scaffold anchor', () => {
  // `key: 'bottom-line'` would render `section-bottom-line` — the SAME id the fixed scaffold block emits.
  const clash: RecallSection = { n: '01', key: 'bottom-line', heading: 'Clash', body: 'x' };
  const html = renderRecallReport({ ...INPUT, sections: [clash] });
  const allIds = [...html.matchAll(/data-anchor-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(allIds).size, allIds.length, 'ALL data-anchor-id values in the document are unique (no ambiguous target)');
  assert.ok(allIds.includes('section-bottom-line'), 'the scaffold keeps its canonical section-bottom-line');
  assert.ok(allIds.includes('section-bottom-line-2'), 'the colliding dynamic section is suffixed to section-bottom-line-2');
});

test('scaffold reservation is PRESENCE-INVARIANT: a section keyed with an OPTIONAL scaffold name is suffixed even when that scaffold is ABSENT', () => {
  const clash: RecallSection = { n: '01', key: 'decisive', heading: 'D', body: 'x' };
  const idsOf = (html: string): string[] => [...html.matchAll(/data-anchor-id="([^"]+)"/g)].map((m) => m[1]);
  // decisive scaffold ABSENT (empty decisive) — the section keyed 'decisive' STILL suffixes to section-decisive-2
  const absentIds = idsOf(renderRecallReport({ ...INPUT, decisive: '', sections: [clash] }));
  assert.ok(!absentIds.includes('section-decisive'), 'no decisive scaffold block is rendered');
  assert.ok(absentIds.includes('section-decisive-2'), 'the dynamic section is STILL suffixed (reserved unconditionally)');
  assert.equal(new Set(absentIds).size, absentIds.length, 'all ids unique');
  // decisive scaffold PRESENT — the dynamic section's id is IDENTICAL (presence can't reassign it); scaffold keeps canonical id
  const presentIds = idsOf(renderRecallReport({ ...INPUT, decisive: 'the test', sections: [clash] }));
  assert.ok(presentIds.includes('section-decisive'), 'the decisive scaffold keeps its canonical id when present');
  assert.ok(presentIds.includes('section-decisive-2'), 'the dynamic section keeps section-decisive-2 regardless of presence');
  assert.equal(new Set(presentIds).size, presentIds.length, 'all ids unique when the scaffold IS present');
});

// ── the baseline area report of a code-only self-scan carried the recsys subtitle
// "recall coverage & incremental value" and a footer claiming "numbers measured from production logs".
test('no recsys subtitle unless the writer asks for it; neutral per-tier eyebrow otherwise', () => {
  const plain = renderRecallReport(INPUT);
  assert.doesNotMatch(plain, /recall coverage/);
  assert.match(plain, /Acme · diagnostic review/);
  assert.match(renderRecallReport({ ...INPUT, tier: 'area' }), /Acme · area review/);
  assert.match(renderRecallReport({ ...INPUT, subtitle: RECALL_SUBTITLE('Acme') }), /Acme · recall coverage &amp; incremental value/);
});

test('the footer claims production measurement ONLY when a live plane measured', () => {
  assert.doesNotMatch(renderRecallReport(INPUT), /production logs/);
  assert.match(renderRecallReport({ ...INPUT, measuredLive: true }), /numbers measured from production logs/);
  const area = recallFooter({ company: 'Baseline', tier: 'area', measuredLive: false });
  assert.doesNotMatch(area, /leadership review|production logs/);
  assert.match(area, /area report — read-only diagnosis/);
});

// ── the console promised codeintel maps "inside the reports" when none carried them.
test('reportHasCodeintelViz detects the viz in both report shapes, and nothing else', () => {
  const withMap = renderRecallReport({ ...INPUT, sections: [{ n: '01', key: 'system-map', heading: 'Cross-repo system map', body: 'b' }] });
  assert.equal(reportHasCodeintelViz(withMap), true, 'RecallReportInput shape (semantic section anchor)');
  assert.equal(reportHasCodeintelViz(renderRecallReport(INPUT)), false, 'no codeintel sections → no signal');
  assert.equal(reportHasCodeintelViz(`<html>${CODEINTEL_VIZ_MARKER}<style></style><div class="codeintel-viz">x</div><!--/codeintel-viz-sidecar--></html>`), true, 'in-session HTML fragment shape');
  assert.equal(reportHasCodeintelViz(`<p>${CODEINTEL_VIZ_MARKER}</p>`), false, 'a bare echoed marker is not a viz');
  assert.equal(reportHasCodeintelViz(undefined), false);
});

test('anyReportHasCodeintelViz — a run whose reports carry no viz records false', () => {
  const plain = renderRecallReport(INPUT);
  const withMap = renderRecallReport({ ...INPUT, sections: [{ n: '01', key: 'code-health', heading: 'Code health', body: 'b' }] });
  assert.equal(anyReportHasCodeintelViz([plain, plain, undefined, null]), false, 'plane unavailable / not indexed → false');
  assert.equal(anyReportHasCodeintelViz([]), false, 'no reports at all → false');
  assert.equal(anyReportHasCodeintelViz([plain, withMap]), true, 'one report carrying the maps is enough');
});
