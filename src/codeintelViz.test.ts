import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeintelSignals, systemMapSvg, codeintelVizSections, looksLikeCodename, relabelCoversAll, visibleCycleCount, mapNodeCap, topMapNodeIds, codeintelVizFragment, appendCodeintelViz, CODEINTEL_VIZ_MARKER } from './codeintelViz.ts';

// Synthetic fixtures only — invented repo/table/service names (real project data never enters git).

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-'));
  const wsd = join(ws, '.repowise-workspace');
  mkdirSync(wsd, { recursive: true });
  writeFileSync(join(wsd, 'system_graph.json'), JSON.stringify({
    nodes: [{ id: 'svc-alpha', kind: 'service' }, { id: 'svc-beta', kind: 'service' }, { id: 'svc-gamma', kind: 'service' }],
    edges: [
      { source: 'svc-alpha', target: 'svc-beta', kind: 'db' },
      { source: 'svc-beta', target: 'svc-alpha', kind: 'db' },   // ← the cycle
      { source: 'svc-gamma', target: 'svc-alpha', kind: 'http' },
    ],
  }));
  writeFileSync(join(wsd, 'conformance.json'), JSON.stringify({
    cycles: [{ nodes: ['svc-alpha', 'svc-beta'], edge_ids: ['svc-alpha->svc-beta:db', 'svc-beta->svc-alpha:db'], length: 2 }],
  }));
  writeFileSync(join(wsd, 'cross_repo_edges.json'), JSON.stringify({
    co_changes: [
      { source_repo: 'svc-alpha', source_file: 'config/rules.json', target_repo: 'svc-beta', target_file: 'src/consumer.py', strength: 21.5, frequency: 88 },
      { source_repo: 'svc-alpha', source_file: 'app/rank.py', target_repo: 'svc-beta', target_file: 'src/consumer.py', strength: 9.1, frequency: 30 },
    ],
  }));
  writeFileSync(join(wsd, 'contracts.json'), JSON.stringify({
    contract_links: [
      { contract_id: 'data::orders_table', contract_type: 'data', provider_repo: 'svc-alpha', consumer_repo: 'svc-beta' },
      { contract_id: 'data::orders_table', contract_type: 'data', provider_repo: 'svc-alpha', consumer_repo: 'svc-gamma' },
      { contract_id: 'data::users_table', contract_type: 'data', provider_repo: 'svc-beta', consumer_repo: 'svc-alpha' },
    ],
  }));
  const hc = join(ws, '.theresa-codeintel');
  mkdirSync(hc, { recursive: true });
  writeFileSync(join(hc, 'health.json'), JSON.stringify({
    'svc-alpha': { avg: 6.3, hotspot: 2.4, files: 120, criticalFindings: 4, worst: [{ path: 'app/llm/call.py', score: 1.0, ccn: 22, nloc: 500, tested: false }] },
    'svc-beta': { avg: 8.8, hotspot: 4.9, files: 60, worst: [] },
  }));
  return ws;
}

test('full workspace → all four sections, system map highlights the cycle in red', () => {
  const ws = makeWorkspace();
  try {
    const secs = codeintelVizSections(ws, { tier: 'area' });
    const headings = secs.map((s) => s.heading);
    assert.ok(headings.includes('Cross-repo system map'), 'system map present');
    assert.ok(headings.includes('Shared data tables'), 'shared tables present');
    assert.ok(headings.includes('Cross-repo hidden coupling'), 'co-change present');
    assert.ok(headings.some((h) => h.startsWith('Code-health')), 'health present');
    // sections are sequentially numbered by the caller-facing builder (filled in withCodeintelViz), here n=''
    const mapSec = secs.find((s) => s.heading === 'Cross-repo system map')!;
    assert.equal(mapSec.viz?.kind, 'svg');
    const svg = (mapSec.viz as { kind: 'svg'; svg: string }).svg;
    assert.match(svg, /<svg/, 'is an svg');
    assert.match(svg, /#C0392B/, 'cycle drawn in red');
    assert.match(svg, /svc-alpha/, 'area tier keeps real service ids');
    // comment anchors: every chart section carries a SEMANTIC key (stable regardless of position), and the
    // system-map svg wrapper carries an explicit chart anchor — none is positional.
    assert.match(svg, /data-anchor-id="chart-system-map"/, 'system-map svg wrapper is anchored');
    assert.equal(mapSec.key, 'system-map');
    assert.equal(secs.find((s) => s.heading === 'Shared data tables')!.key, 'shared-data-tables');
    assert.equal(secs.find((s) => s.heading === 'Cross-repo hidden coupling')!.key, 'hidden-coupling');
    assert.equal(secs.find((s) => s.heading.startsWith('Code-health'))!.key, 'code-health');
    // shared tables: grouped, orders_table has 2 links
    const tblSec = secs.find((s) => s.heading === 'Shared data tables')!;
    const bars = (tblSec.viz as { kind: 'bars'; bars: { label: string; value: number }[] }).bars;
    assert.equal(bars[0].label, 'orders_table');
    assert.equal(bars[0].value, 2);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('empty / missing workspace → no sections, no throw', () => {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-empty-'));
  try {
    assert.equal(readCodeintelSignals(ws), undefined);
    assert.deepEqual(codeintelVizSections(ws), []);
    assert.deepEqual(codeintelVizSections(join(ws, 'does-not-exist')), []);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('malformed JSON is tolerated (fail-open), never throws', () => {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-bad-'));
  try {
    const wsd = join(ws, '.repowise-workspace');
    mkdirSync(wsd, { recursive: true });
    writeFileSync(join(wsd, 'system_graph.json'), '{not json');
    writeFileSync(join(wsd, 'contracts.json'), JSON.stringify({ contract_links: { not: 'an array' } }));
    writeFileSync(join(wsd, 'conformance.json'), JSON.stringify({ cycles: 'nope' }));
    let secs; assert.doesNotThrow(() => { secs = codeintelVizSections(ws, { tier: 'area' }); });
    assert.deepEqual(secs, []);  // nothing usable → no sections
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('malformed ELEMENT shapes (null link, numeric contract_id, null node/cycle) are skipped, not thrown', () => {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-elem-'));
  try {
    const wsd = join(ws, '.repowise-workspace');
    mkdirSync(wsd, { recursive: true });
    writeFileSync(join(wsd, 'system_graph.json'), JSON.stringify({ nodes: [null, { id: 'a' }, { id: 'b' }], edges: [null, { source: 'a', target: 'b', kind: 'db' }] }));
    writeFileSync(join(wsd, 'conformance.json'), JSON.stringify({ cycles: [null, { nodes: ['a', 'b'] }] }));
    writeFileSync(join(wsd, 'cross_repo_edges.json'), JSON.stringify({ co_changes: [null, { source_repo: 'a', target_repo: 'b', frequency: 3 }] }));
    writeFileSync(join(wsd, 'contracts.json'), JSON.stringify({ contract_links: [null, { contract_id: 123, contract_type: 'data' }, { contract_id: 'data::t', contract_type: 'data', provider_repo: 'a', consumer_repo: 'b' }] }));
    let secs: ReturnType<typeof codeintelVizSections> = [];
    assert.doesNotThrow(() => { secs = codeintelVizSections(ws, { tier: 'area' }); });
    const rendered = JSON.stringify(secs);
    assert.match(rendered, /"label":"t"/);    // the one well-formed table link renders (data:: prefix stripped)
    assert.doesNotMatch(rendered, /123/);  // the numeric contract_id was skipped, not rendered
    assert.ok(secs.some((s) => s.heading === 'Cross-repo system map'), 'the guarded graph still maps');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('sanitizeReportInput DROPS a model-authored svg but redact-and-KEEPS a trusted (marked) codeintel svg', async () => {
  const { sanitizeReportInput, markTrustedSvgViz } = await import('./research/reportEvidence.ts');
  const base = {
    company: 'x', title: 't', question: '', meta: '', bottomLine: 'b',
    cards: [], recommendations: [], decisive: '', caveats: '',
  };
  // (a) untrusted model svg → dropped
  const model = sanitizeReportInput({ ...base, sections: [{ n: '01', heading: 'h', body: 'b', viz: { kind: 'svg', svg: '<svg><script>alert(1)</script></svg>' } }] });
  assert.equal(model.sections[0].viz, undefined, 'a model-authored svg viz is stripped by sanitize');
  // (b) trusted svg with a secret → KEPT and redacted (markup intact)
  const trusted = markTrustedSvgViz({ kind: 'svg' as const, svg: '<svg><text>config/AKI\x41IOSFODNN7EXAMPLE.json</text></svg>' });
  const kept = sanitizeReportInput({ ...base, sections: [{ n: '01', heading: 'h', body: 'b', viz: trusted }] });
  const v = kept.sections[0].viz as { kind: string; svg: string } | undefined;
  assert.equal(v?.kind, 'svg', 'a trusted svg is kept');
  assert.doesNotMatch(v!.svg, /AKI\x41IOSFODNN7EXAMPLE/, 'and its secret is redacted');
  assert.match(v!.svg, /<svg><text>/, 'markup intact');
});

test('leadership tier is R7-safe — no snake_case ids / paths / codenames leak', () => {
  const ws = makeWorkspace();
  try {
    const relabel = { 'svc-alpha': 'Recommendations', 'svc-beta': 'Content service' };  // gamma & tables intentionally unmapped
    const secs = codeintelVizSections(ws, { tier: 'leadership', relabel });
    // serialize every rendered label/field and assert no raw identifier survives
    const rendered = JSON.stringify(secs);
    assert.doesNotMatch(rendered, /svc-alpha|svc-beta|svc-gamma/, 'raw service ids stripped');
    assert.doesNotMatch(rendered, /orders_table|users_table/, 'raw table ids stripped');
    assert.doesNotMatch(rendered, /app\/rank\.py|src\/consumer\.py|call\.py/, 'file paths dropped');
    assert.match(rendered, /Recommendations/, 'mapped label used');
    assert.match(rendered, /Service \d|Shared table \d/, 'unmapped ids de-identified generically');
    // and the SVG itself carries no raw id
    const svg = (secs.find((s) => s.viz?.kind === 'svg')!.viz as { svg: string }).svg;
    assert.ok(!/svc-alpha|svc-beta|svc-gamma/.test(svg), 'svg labels de-identified');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('area tier co-change is a file-level table; leadership collapses to service pairs', () => {
  const ws = makeWorkspace();
  try {
    const area = codeintelVizSections(ws, { tier: 'area' }).find((s) => s.heading === 'Cross-repo hidden coupling')!;
    assert.equal(area.viz?.kind, 'table');
    const lead = codeintelVizSections(ws, { tier: 'leadership' }).find((s) => s.heading === 'Cross-service hidden coupling')!;
    assert.equal(lead.viz?.kind, 'bars');  // repo↔repo bars, no file paths
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('a secret-shaped substring in a tenant name is REDACTED on every viz surface incl. the SVG, both tiers', () => {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-secret-'));
  try {
    const wsd = join(ws, '.repowise-workspace');
    mkdirSync(wsd, { recursive: true });
    const secret = 'AKI\x41IOSFODNN7EXAMPLE';  // AWS-access-key-shaped, at natural boundaries so redactSecrets (word-anchored, app-wide) catches it
    // secret in a NODE id → appears in the system-map SVG <text> labels
    writeFileSync(join(wsd, 'system_graph.json'), JSON.stringify({ nodes: [{ id: `svc-${secret}` }, { id: 'b' }], edges: [{ source: `svc-${secret}`, target: 'b', kind: 'db' }] }));
    writeFileSync(join(wsd, 'conformance.json'), JSON.stringify({ cycles: [] }));
    writeFileSync(join(wsd, 'cross_repo_edges.json'), JSON.stringify({ co_changes: [{ source_repo: 'a', source_file: `config/${secret}.json`, target_repo: 'b', target_file: 'x.py', frequency: 5 }] }));
    writeFileSync(join(wsd, 'contracts.json'), JSON.stringify({ contract_links: [{ contract_id: `data::${secret}`, contract_type: 'data', provider_repo: 'a', consumer_repo: 'b' }] }));
    const hc = join(ws, '.theresa-codeintel'); mkdirSync(hc, { recursive: true });
    writeFileSync(join(hc, 'health.json'), JSON.stringify({ a: { avg: 5, worst: [{ path: `src/${secret}.ts`, score: 2 }] } }));
    for (const tier of ['area', 'leadership'] as const) {
      const secs = codeintelVizSections(ws, { tier });
      const rendered = JSON.stringify(secs);
      assert.doesNotMatch(rendered, new RegExp(secret), `[${tier}] secret redacted on every surface (svg / co-change / shared-table / health)`);
      const svg = (secs.find((s) => s.viz?.kind === 'svg')?.viz as { svg?: string } | undefined)?.svg ?? '';
      assert.ok(!svg.includes(secret), `[${tier}] secret not in the SVG node labels`);
    }
    // area keeps the redaction placeholder (proof the pass ran, not just de-identification)
    assert.match(JSON.stringify(codeintelVizSections(ws, { tier: 'area' })), /redacted-aws-key/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('red edges are drawn ONLY for a fully-visible cycle; a cycle with a hidden (capped) node draws none', () => {
  // 17 nodes → top-16 shown, the lowest-degree node (svc-16, degree 0 in the hub) is hidden.
  const nodes = Array.from({ length: 17 }, (_, i) => ({ id: `svc-${String(i).padStart(2, '0')}` }));
  const edges = Array.from({ length: 15 }, (_, i) => ({ source: 'svc-00', target: `svc-${String(i + 1).padStart(2, '0')}`, kind: 'db' }));  // hub: svc-00 deg15, svc-01..15 deg1, svc-16 deg0 (hidden)
  // The legend always carries one red `stroke="#C0392B"` swatch, so count red edge STROKES: legend = 1,
  // each drawn red edge adds one more (node fills use fill=, not stroke=, so they don't inflate this).
  const redEdges = (svg: string) => (svg.match(/stroke="#C0392B"/g) || []).length - 1;
  const hiddenCycle = [{ nodes: ['svc-00', 'svc-01', 'svc-16'] }];  // svc-16 is capped out → cycle NOT fully visible
  assert.equal(visibleCycleCount({ nodes, edges }, hiddenCycle), 0, 'a cycle with a hidden node is not counted');
  assert.equal(redEdges(systemMapSvg({ nodes, edges }, hiddenCycle)), 0, 'and it draws NO red edge (even the shown svc-00↔svc-01 pair stays grey)');
  const fullCycle = [{ nodes: ['svc-00', 'svc-01'] }];  // both shown → fully visible
  assert.equal(visibleCycleCount({ nodes, edges }, fullCycle), 1, 'a fully-visible cycle is counted');
  assert.ok(redEdges(systemMapSvg({ nodes, edges }, fullCycle)) >= 1, 'and it draws a red edge — caption count and drawn red edges agree');
});

test('a conformance cycle whose adjacent EDGE is missing from the graph is not counted and draws no red', () => {
  // nodes A,B,C all rendered; graph has A-B and A-C but NOT B-C. Conformance claims the cycle A-B-C.
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const edges = [{ source: 'A', target: 'B', kind: 'db' }, { source: 'A', target: 'C', kind: 'db' }];  // B-C absent
  const redEdges = (svg: string) => (svg.match(/stroke="#C0392B"/g) || []).length - 1;  // minus the legend swatch
  const cycle = [{ nodes: ['A', 'B', 'C'] }];
  assert.equal(visibleCycleCount({ nodes, edges }, cycle), 0, 'a cycle with a missing graph edge is not counted');
  assert.equal(redEdges(systemMapSvg({ nodes, edges }, cycle)), 0, 'and no edge is drawn red (the caption would say 0, matching the map)');
  // add the missing edge → now fully drawn, counted, and red
  const closed = [...edges, { source: 'B', target: 'C', kind: 'db' }];
  assert.equal(visibleCycleCount({ nodes, edges: closed }, cycle), 1, 'closing the cycle makes it count');
  assert.ok(redEdges(systemMapSvg({ nodes, edges: closed }, cycle)) >= 3, 'all three segments drawn red');
});

test('systemMapSvg with <2 nodes returns empty (nothing to draw)', () => {
  assert.equal(systemMapSvg({ nodes: [{ id: 'only' }], edges: [] }, []), '');
  assert.equal(systemMapSvg({ nodes: [], edges: [] }, []), '');
});

test('size caps: a pathological graph is capped to the node limit', () => {
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `svc-${i}`, kind: 'service' }));
  const edges = Array.from({ length: 200 }, (_, i) => ({ source: `svc-${i % 80}`, target: `svc-${(i + 1) % 80}`, kind: 'db' }));
  const svg = systemMapSvg({ nodes, edges }, []);
  const circles = (svg.match(/<circle/g) || []).length;
  assert.ok(circles > 0 && circles <= 16, `node circles capped to 16, got ${circles}`);
});

test('looksLikeCodename matches the R7 rubric set (snake_case / i2i / usercf / *.py / path / ::), not plain English', () => {
  assert.ok(looksLikeCodename('orders_table'));
  assert.ok(looksLikeCodename('app/rank.py'));
  assert.ok(looksLikeCodename('rank.py'));       // bare filename (no path)
  assert.ok(looksLikeCodename('i2i'));           // bare abbreviation
  assert.ok(looksLikeCodename('usercf'));
  assert.ok(looksLikeCodename('svc::lambda'));
  assert.ok(!looksLikeCodename('Recommendations service'));
  assert.ok(!looksLikeCodename('SmartFeed'));         // product feature name (no underscore) passes
});

test('leadership relabel with a codename value (i2i / rank.py) falls back to a generic, does not leak it', () => {
  const ws = makeWorkspace();
  try {
    const relabel = { 'svc-alpha': 'i2i', 'data::orders_table': 'orders_table' };  // both codename-shaped → rejected
    const rendered = JSON.stringify(codeintelVizSections(ws, { tier: 'leadership', relabel }));
    assert.doesNotMatch(rendered, /\bi2i\b/, 'codename relabel value rejected');
    assert.doesNotMatch(rendered, /orders_table/, 'codename table relabel rejected');
    assert.match(rendered, /Service \d|Shared table \d/, 'fell back to a generic');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// ── HTML-fragment form (for the in-session DOMAIN area reports) ──────────────────────────────────────
// crude but sufficient well-formedness check: every tag opens/closes balanced (ignoring void <line>/<circle>/
// <text .../> self-closed forms the renderer emits) — enough to prove we never inject broken markup.
function svgTagsBalanced(html: string): boolean {
  for (const tag of ['div', 'style', 'svg', 'section', 'table', 'span']) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) return false;
  }
  return true;
}

test('codeintelVizFragment: self-contained, marker + scoped CSS + heading, charts present', () => {
  const ws = makeWorkspace();
  try {
    const frag = codeintelVizFragment(ws, { tier: 'area' });
    assert.ok(frag.startsWith(CODEINTEL_VIZ_MARKER), 'carries the idempotency marker');
    assert.match(frag, /<style>[\s\S]*\.codeintel-viz/, 'ships its own scoped CSS');
    assert.match(frag, /<div class="ci-hd">Cross-repo code intelligence/, 'the heading');
    assert.doesNotMatch(frag, /class="(en|zh)"|lang-/, 'no language spans or toggle rules');
    assert.match(frag, /<svg/, 'system map svg present');
    assert.match(frag, /svc-alpha/, 'area tier keeps real ids');
    assert.ok(svgTagsBalanced(frag), 'fragment tags are balanced (well-formed)');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('codeintelVizFragment: empty when no signals', () => {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-frag-empty-'));
  try {
    assert.equal(codeintelVizFragment(ws), '');
    assert.equal(codeintelVizFragment(join(ws, 'nope')), '');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('appendCodeintelViz: injects before </body>, rebuild-idempotent, no-op when workspaceDir undefined or no signals', () => {
  const ws = makeWorkspace();
  try {
    const doc = '<!doctype html><html><body><h1>report</h1></body></html>';
    const once = appendCodeintelViz(doc, ws, { tier: 'area' });
    assert.ok(once.includes(CODEINTEL_VIZ_MARKER), 'fragment injected');
    assert.ok(once.indexOf(CODEINTEL_VIZ_MARKER) < once.indexOf('</body>'), 'injected BEFORE </body>');
    assert.ok(once.indexOf('<h1>report</h1>') < once.indexOf(CODEINTEL_VIZ_MARKER), 'after the original body content');
    // REBUILD-idempotent — a second pass strips the prior fragment and re-appends exactly one
    const twice = appendCodeintelViz(once, ws, { tier: 'area' });
    assert.equal((twice.match(new RegExp(CODEINTEL_VIZ_MARKER, 'g')) || []).length, 1, 'exactly one fragment after re-assert');
    assert.equal((twice.match(/<!--\/codeintel-viz-sidecar-->/g) || []).length, 1, 'one closing marker too (no nesting)');
    // no-op: plane off (undefined workspaceDir) or no signals → returns the doc with any prior fragment stripped
    assert.equal(appendCodeintelViz(doc, undefined, { tier: 'area' }), doc, 'no-op when plane did not run');
    assert.equal(appendCodeintelViz(once, undefined, { tier: 'area' }), doc, 'plane-off strips a stale fragment back to the original');
    const empty = mkdtempSync(join(tmpdir(), 'civiz-noop-'));
    try { assert.equal(appendCodeintelViz(doc, empty, { tier: 'area' }), doc, 'no-op when no signals'); }
    finally { rmSync(empty, { recursive: true, force: true }); }
    // body-less input: falls back to appending at the end, still once
    const noBody = appendCodeintelViz('<div>x</div>', ws, { tier: 'area' });
    assert.ok(noBody.startsWith('<div>x</div>') && noBody.includes(CODEINTEL_VIZ_MARKER), 'appends at end when no </body>');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('appendCodeintelViz: a secret in a tenant name is redacted in the injected fragment', () => {
  const ws = mkdtempSync(join(tmpdir(), 'civiz-frag-secret-'));
  try {
    const wsd = join(ws, '.repowise-workspace'); mkdirSync(wsd, { recursive: true });
    const secret = 'AKI\x41IOSFODNN7EXAMPLE';
    writeFileSync(join(wsd, 'system_graph.json'), JSON.stringify({ nodes: [{ id: `svc-${secret}` }, { id: 'b' }], edges: [{ source: `svc-${secret}`, target: 'b', kind: 'db' }] }));
    writeFileSync(join(wsd, 'conformance.json'), JSON.stringify({ cycles: [] }));
    const out = appendCodeintelViz('<html><body></body></html>', ws, { tier: 'area' });
    assert.ok(out.includes(CODEINTEL_VIZ_MARKER), 'fragment present');
    assert.doesNotMatch(out, new RegExp(secret), 'secret redacted in the injected fragment');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// ── the all-or-nothing relabel guard ────────────────────────────────────────────────────────────
// A leadership map whose relabel map covers only SOME drawn nodes renders "The feed service" beside
// "Service 3", and the reader cannot tell whether the anonymous ones are unimportant or just unmapped.
// A 16-node probe with 4 of 20 ids unmapped read worse than either extreme.
//
// An earlier attempt at this fell back to the RAW ids for the whole figure. The R7 test above caught
// it — that publishes a project's real repo names into a leadership deliverable. R7 wins; the opt-in
// below suppresses the figure instead, and stays OFF by default because generic de-identification is
// the documented shipped behaviour.

test('relabelCoversAll: complete, partial, codename-valued, and empty maps', () => {
  const ids = ['svc-alpha', 'svc-beta'];
  assert.equal(relabelCoversAll(ids, { 'svc-alpha': 'Recommendations', 'svc-beta': 'Content service' }), true);
  assert.equal(relabelCoversAll(ids, { 'svc-alpha': 'Recommendations' }), false, 'partial coverage is not coverage');
  assert.equal(relabelCoversAll(ids, { 'svc-alpha': 'Recommendations', 'svc-beta': 'user_sessions' }), false, 'a codename VALUE does not count as named');
  assert.equal(relabelCoversAll(ids, { 'svc-alpha': 'Recommendations', 'svc-beta': '  ' }), false, 'blank does not count as named');
  assert.equal(relabelCoversAll(ids, undefined), false);
  assert.equal(relabelCoversAll([], { a: 'A' }), false, 'nothing drawn is not "all covered"');
});

test('requireCompleteRelabel is OFF by default (shipped behaviour preserved) and suppresses the map when ON', () => {
  const ws = makeWorkspace();
  try {
    const partial = { 'svc-alpha': 'Recommendations', 'svc-beta': 'Content service' };  // gamma unmapped
    const sigs = readCodeintelSignals(ws)!;

    const dflt = systemMapSvg(sigs.graph, sigs.cycles, { tier: 'leadership', relabel: partial });
    assert.ok(dflt.length > 0, 'default still draws the map');
    assert.match(dflt, /Service \d/, 'and de-identifies the unmapped node generically');
    assert.doesNotMatch(dflt, /svc-alpha|svc-beta|svc-gamma/, 'never a raw id, either way');

    const strict = systemMapSvg(sigs.graph, sigs.cycles, { tier: 'leadership', relabel: partial, requireCompleteRelabel: true });
    assert.equal(strict, '', 'opt-in: an incomplete map yields NO figure rather than a half-anonymous one');

    const complete = { ...partial, 'svc-gamma': 'Media processing' };
    const full = systemMapSvg(sigs.graph, sigs.cycles, { tier: 'leadership', relabel: complete, requireCompleteRelabel: true });
    assert.ok(full.length > 0, 'a complete map draws under the opt-in');
    assert.match(full, /Media processing/);
    assert.doesNotMatch(full, /Service \d/, 'and nothing is left generic');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// The leadership cap is what turned the probe from a hairball into a readable figure: 16 nodes on a
// circle is the "inventory of the whole system" the diagramming guidance warns against.
test('leadership caps the map far below the area tier', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `svc-${String(i).padStart(2, '0')}` }));
  const edges = nodes.flatMap((n, i) => (i ? [{ source: nodes[0].id, target: n.id, kind: 'db' }] : []));
  const area = systemMapSvg({ nodes, edges }, []);
  const lead = systemMapSvg({ nodes, edges }, [], { tier: 'leadership', relabel: Object.fromEntries(nodes.map((n, i) => [n.id, `Service area ${i}`])) });
  const dots = (svg: string) => (svg.match(/<circle /g) || []).length;
  assert.equal(dots(area), 16, 'area draws the engineer-scale map');
  assert.equal(dots(lead), 6, 'leadership draws only what the decision turns on');
});

// ── AN ARROW IS A CLAIM: A 3-CYCLE MUST NOT GROW REVERSE EDGES ──────────────────────────────────
//
// `isCycle` was treated as "mutual", so every segment of a longer cycle was drawn
// with an arrowhead at BOTH ends. A→B→C→A rendered as six dependencies where the graph has three, and the
// caption called them three "mutual" pairs. In an audit diagram a drawn arrow is a finding, so this was a
// renderer fabricating findings — the exact thing the v4 contract's diagram rule forbids the AUTHOR to do.

const startMarkers = (svg: string): number => (svg.match(/marker-start="url\(#ci-arrow-cycle\)"/g) ?? []).length;
// Count by the ARROWHEAD, not the colour: the legend swatch is drawn in the cycle colour too and has no
// marker, and counting it is how the first version of this helper reported 2 edges for a single pair.
const cycleLines = (svg: string): number => (svg.match(/marker-end="url\(#ci-arrow-cycle\)"/g) ?? []).length;

test('a one-way 3-cycle draws three one-way arrows, not six', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { source: 'a', target: 'b', kind: 'db' },
    { source: 'b', target: 'c', kind: 'db' },
    { source: 'c', target: 'a', kind: 'db' },
  ];
  const svg = systemMapSvg({ nodes, edges }, [{ nodes: ['a', 'b', 'c'] }]);
  assert.ok(svg, 'the map renders');
  assert.equal(cycleLines(svg!), 3, 'three cycle edges, one per real dependency');
  assert.equal(startMarkers(svg!), 0, 'NO reverse arrowhead — the graph contains no reverse edge');
});

test('a genuinely MUTUAL pair still gets both arrowheads — that smell is the point', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b', kind: 'db' }, { source: 'b', target: 'a', kind: 'db' }];
  const svg = systemMapSvg({ nodes, edges }, [{ nodes: ['a', 'b'] }]);
  assert.ok(svg);
  assert.equal(cycleLines(svg!), 1, 'the two directions are ONE line');
  assert.equal(startMarkers(svg!), 1, 'with a head at both ends');
});

test('a 3-cycle where ONE pair is also mutual gets exactly one double-headed edge', () => {
  // The mixed case is where an all-or-nothing rule goes wrong in either direction.
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { source: 'a', target: 'b', kind: 'db' }, { source: 'b', target: 'a', kind: 'db' },   // mutual
    { source: 'b', target: 'c', kind: 'db' }, { source: 'c', target: 'a', kind: 'db' },   // one-way
  ];
  const svg = systemMapSvg({ nodes, edges }, [{ nodes: ['a', 'b', 'c'] }]);
  assert.ok(svg);
  assert.equal(startMarkers(svg!), 1, 'only the truly mutual pair is double-headed');
  assert.equal(cycleLines(svg!), 3, 'a↔b collapsed to one line, plus b→c and c→a');
});

test('the caption counts cycles with the SAME node cap the map drew with', () => {
  // The map used the tier cap (leadership 6) while visibleCycleCount used its default (16), so a cycle the
  // leadership map cannot draw was still described by the prose as "drawn in red".
  //
  // Getting this graph right took two attempts, and the first one is worth recording: topMapNodeIds ranks
  // by CONNECTIVITY, so a cycle pair is normally pulled INTO the map however small the cap — which is good
  // behaviour, and it means a naive "cycle among later nodes" fixture proves nothing. The divergence needs
  // nodes that genuinely outrank the cycle, so: a dense clique of six, and a low-degree pair off to the side.
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `svc-${String(i).padStart(2, '0')}` }));
  const edges: { source: string; target: string; kind: string }[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) edges.push({ source: `svc-0${i}`, target: `svc-0${j}`, kind: 'api' });
  edges.push({ source: 'svc-10', target: 'svc-11', kind: 'db' }, { source: 'svc-11', target: 'svc-10', kind: 'db' });
  const cycles = [{ nodes: ['svc-10', 'svc-11'] }];

  assert.equal(mapNodeCap({ tier: 'leadership' }), 6);
  assert.equal(mapNodeCap({ tier: 'area' }), 16);
  assert.equal(mapNodeCap({ tier: 'leadership', maxNodes: 9 }), 9, 'an explicit override still wins');

  assert.deepEqual(topMapNodeIds({ nodes, edges }, mapNodeCap({ tier: 'leadership' })),
    ['svc-00', 'svc-01', 'svc-02', 'svc-03', 'svc-04', 'svc-05'], 'the clique outranks the cycle pair');
  assert.equal(visibleCycleCount({ nodes, edges }, cycles, mapNodeCap({ tier: 'leadership' })), 0,
    'not counted, because the leadership map does not draw it');
  // ...and at the area cap it is both drawable and counted, so the assertion above is not vacuous.
  assert.equal(visibleCycleCount({ nodes, edges }, cycles, mapNodeCap({ tier: 'area' })), 1);
  // The old default-argument call is what produced the mismatch: it says 1 while the map draws 0.
  assert.equal(visibleCycleCount({ nodes, edges }, cycles), 1, 'the uncapped call is why the cap must be passed');
});

test('an unrelated HTTP reverse edge does not make a DB cycle "mutual"', () => {
  // A->B(db) on a shared-DB cycle, plus an unrelated B->A(http), was drawn as
  // ONE double-headed red line and captioned a "mutual shared-database" pair — fabricating a reverse DB
  // dependency out of an HTTP call. Mutual now requires the reverse edge to be the SAME KIND.
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { source: 'a', target: 'b', kind: 'db' },
    { source: 'b', target: 'c', kind: 'db' },
    { source: 'c', target: 'a', kind: 'db' },
    { source: 'b', target: 'a', kind: 'http' },   // unrelated, and NOT a shared-DB dependency
  ];
  const svg = systemMapSvg({ nodes, edges }, [{ nodes: ['a', 'b', 'c'] }]);
  assert.ok(svg);
  assert.equal(startMarkers(svg!), 0, 'no reverse DB arrowhead — the reverse edge is an HTTP call');
  assert.equal(cycleLines(svg!), 3, 'three db cycle edges');
  // ...and the http edge is not painted as part of the shared-DB cycle either.
  assert.match(svg!, /stroke-dasharray="5 3"/, 'the http edge still renders, in its own encoding');
});

test('a mutual pair of the SAME kind is still collapsed and double-headed', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b', kind: 'db' }, { source: 'b', target: 'a', kind: 'db' }];
  const svg = systemMapSvg({ nodes, edges }, [{ nodes: ['a', 'b'] }]);
  assert.equal(startMarkers(svg!), 1);
  assert.equal(cycleLines(svg!), 1);
});

test('a graph that omits edge kind keeps its red cycle edges', () => {
  // The kind gate must not silently blank the map for a graph with no kinds at all.
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }];
  const svg = systemMapSvg({ nodes, edges } as never, [{ nodes: ['a', 'b'] }]);
  assert.ok(svg);
  assert.equal(cycleLines(svg!), 1, 'kindless edges still draw the cycle');
});

test('an HTTP-only cycle is neither drawn red nor counted as a shared-DB cycle', () => {
  // An earlier kind gate made the renderer paint only db/kindless edges red,
  // but visibleCycleCount still counted a cycle whatever its edge kinds — so an HTTP or co-change cycle in
  // conformance.json was announced as "N shared-database cycle(s) drawn in red" over an SVG with no red edge.
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b', kind: 'http' }, { source: 'b', target: 'a', kind: 'http' }];
  const cycles = [{ nodes: ['a', 'b'] }];
  assert.equal(visibleCycleCount({ nodes, edges }, cycles, mapNodeCap({ tier: 'area' })), 0,
    'not a shared-database cycle, so not counted as one');
  const svg = systemMapSvg({ nodes, edges }, cycles);
  assert.ok(svg);
  assert.equal(cycleLines(svg!), 0, 'and no red cycle edge is drawn');
});

test('a co-change cycle is treated the same way', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b', kind: 'co_change' }, { source: 'b', target: 'a', kind: 'co_change' }];
  assert.equal(visibleCycleCount({ nodes, edges }, [{ nodes: ['a', 'b'] }], mapNodeCap()), 0);
});

test('a DB cycle is still counted and still drawn — the filter is not just off', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b', kind: 'db' }, { source: 'b', target: 'a', kind: 'db' }];
  const cycles = [{ nodes: ['a', 'b'] }];
  assert.equal(visibleCycleCount({ nodes, edges }, cycles, mapNodeCap()), 1);
  assert.equal(cycleLines(systemMapSvg({ nodes, edges }, cycles)!), 1);
});

test('the count and the drawing agree on a MIXED-kind cycle', () => {
  // a->b is db, b->c is http: the loop is not a shared-DB cycle, so neither half may claim it.
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { source: 'a', target: 'b', kind: 'db' },
    { source: 'b', target: 'c', kind: 'http' },
    { source: 'c', target: 'a', kind: 'db' },
  ];
  const cycles = [{ nodes: ['a', 'b', 'c'] }];
  assert.equal(visibleCycleCount({ nodes, edges }, cycles, mapNodeCap()), 0, 'one non-db segment breaks it');
  const svg = systemMapSvg({ nodes, edges }, cycles);
  assert.equal(cycleLines(svg!), 0, 'so nothing is painted as a shared-DB cycle either');
});
