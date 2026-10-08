import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScopedReport, renderFlowDiagram, isRenderableFlow, type ScopedReportModel, type FlowSpec } from './scopedTemplateHtml.ts';
import { buildScopedReportModel } from './scopedTemplateModel.ts';
import type { ScopedDossier } from './research/scopedInvestigate.ts';

// These cover the CURRENT structure: a 3-tab report (Answer & How-it-works / Where-it-can-tighten / Scope &
// Evidence), unified `ul.list`, four-part tighten cards, dual-colour scope boxes, an effort tooltip, and a wrapping
// flow diagram + lightbox.

const MODEL_FLOW: FlowSpec = {
  lanes: [
    { title: 'WRITE', dir: 'in', edgeLabel: 'extract → dedupe → apply', steps: [
      { label: '4 write entry points', sub: 'unshaped candidates' },
      { label: 'Gate', sub: 'off by default · two keys', kind: 'gate' },
    ] },
    { title: 'READ', dir: 'out', edgeLabel: 'recall top-8', steps: [
      { label: 'Inject into agent prompts', sub: 'push brief + pull tool' },
      { label: 'Gate', sub: 'on by default · one gate', kind: 'gate' },
    ] },
  ],
  hub: { label: 'org_memory store', sub: ['intake-service backend', 'orgMemory.ts · HTTP · no local DB'] },
};

// RAW fields carry authored <code>/<span class="lead">; one PLAIN field (client) carries <script> + & to prove
// escaping. 4 tightening cards exercise all three effort chips.
const MODEL: ScopedReportModel = {
  brand: { name: 'Waggle', sub: 'Engineering Audit' },
  client: 'Acme <script>alert(1)</script> & Co. (sample)', // PLAIN field w/ hostile chars — must be escaped
  scope: 'Quick Ask · single question',
  date: '2026-07-17',
  confidential: 'Confidential · internal',
  question: "How does Waggle's org memory work, and where can it tighten?",
  breadcrumb: { dimension: 'Architecture', sub: 'Memory system' },
  scopeBlock: {
    covered: ['Waggle (source read directly)'],
    notCovered: ['the intake-service backend — inferred from the client contract only'],
  },
  bottomLine: [
    'Waggle owns no memory store — it is a thin HTTP client to the backend <code>org_memory</code> card store.',
    '<span class="lead">Reads are on by default, writes are off.</span> A write needs two keys.',
  ],
  mechanism: [
    '<span class="lead">Read path (adopt):</span> at run start the memory version is pinned and the 8 most relevant cards are recalled.',
    '<span class="lead">Write path (write):</span> four entry points POST candidates to the same backend intake spine.',
  ],
  flow: MODEL_FLOW,
  tightening: [
    { weakness: 'The two write master switches have nearly identical names', fix: 'Merge them into one switch, or warn at startup when they disagree', effort: 'quick_win', files: ['src/server.ts'] },
    { weakness: 'Free text is written to the org-wide memory without review', fix: 'Add a dry-run preview', effort: 'moderate', files: ['server.ts', 'orgMemory.ts'] },
    { weakness: 'A failed recall is silently swallowed (fail-open)', fix: 'Tell transport/HTTP errors apart from an empty result', effort: 'moderate', files: ['orgMemory.ts'] },
    { weakness: 'Repo-level recall is silently ignored', fix: 'Record the mode in effect', effort: 'project', files: ['orgMemory.ts'] },
  ],
  evidence: [
    '<code>orgMemory.ts:40-79</code> — HTTP client, fail-open',
    '<code>server.ts:1196-1211</code> — write-capable MCP, strict opt-in',
  ],
  notVerified: [
    'The real intake spine lives in the <code>intake-service</code> backend, not in this repo.',
  ],
};
const H = renderScopedReport(MODEL);

// ── document / chrome ─────────────────────────────────────────────────────────────────────────────────────
test('is a complete self-contained HTML document (doctype + inline style, no external hosts)', () => {
  assert.match(H, /^<!doctype html><html lang="en"><head>/);
  assert.match(H, /<style>[\s\S]*<\/style>/);
  assert.match(H, /<\/body><\/html>$/);
  assert.doesNotMatch(H, /https?:\/\//); // no CDN / remote font / remote image
});

test('bee masthead + wordmark + Quick Ask kicker over the confidential line', () => {
  assert.match(H, /<div class="wordmark"><b>Waggle<\/b><small>Engineering Audit<\/small><\/div>/);
  assert.match(H, /<span class="bee"><img src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}" alt="Waggle"/);
  assert.doesNotMatch(H, /PLACEHOLDER LOGO/); // the old placeholder hexagon SVG is gone
  assert.match(H, /Quick Ask<br \/>Confidential · internal/); // kicker over the (overridden) confidential line
  const dflt = renderScopedReport({ ...MODEL, confidential: undefined });
  assert.match(dflt, /Quick Ask<br \/>Confidential · Internal use only/, 'the default confidential line');
});

test('shares the theme-aware design system (light/dark custom properties)', () => {
  assert.match(H, /@media \(prefers-color-scheme: dark\)/);
  assert.match(H, /:root\[data-theme="dark"\]/);
  assert.match(H, /:root\[data-theme="light"\]/);
});

test('the question is the report title (h1); breadcrumb was removed', () => {
  assert.match(H, /<h1>How does Waggle&#39;s org memory work, and where can it tighten\?<\/h1>/);
  assert.doesNotMatch(H, /class="crumb"/); // breadcrumb gone
  assert.doesNotMatch(H, /This question falls under/);
  assert.match(H, /<b>Project<\/b> Acme/); // doc-meta project label
  assert.match(H, /<b>Scope<\/b> Quick Ask · single question/);
  assert.match(H, /<b>Generated<\/b> 2026-07-17/);
});

test('one language: plain <body>, no language spans, no language toggle', () => {
  assert.match(H, /<\/style>\n<\/head>\n<body>\n<div class="wrap">/);
  assert.doesNotMatch(H, /class="(en|zh)"/);
  assert.doesNotMatch(H, /langtog|data-l=/);
});

// ── 3-tab layout ──────────────────────────────────────────────────────────────────────────────────────────
test('3-tab layout: left nav (01/02/03), p1 initially active, panels + setTab script', () => {
  assert.match(H, /<nav class="scoped-tabs" role="tablist"/);
  // three numbered tabs, first active, in order
  assert.match(H, /<button class="stab active" role="tab" aria-controls="p1"[^>]*data-tab="p1"><span class="stab-n">01<\/span><span class="stab-t">Answer &amp; How it works<\/span>/);
  assert.match(H, /<button class="stab" role="tab" aria-controls="p2"[^>]*data-tab="p2"><span class="stab-n">02<\/span><span class="stab-t">Where it can tighten<\/span>/);
  assert.match(H, /<button class="stab" role="tab" aria-controls="p3"[^>]*data-tab="p3"><span class="stab-n">03<\/span><span class="stab-t">Scope &amp; Evidence<\/span>/);
  // panels, p1 active — each carries an inert data-anchor-id (semantic key section-<panel id>) for comment anchoring
  assert.match(H, /<section class="panel active" id="p1" role="tabpanel" data-panel="p1" data-anchor-id="section-p1">/);
  assert.match(H, /<section class="panel" id="p2"[^>]*data-panel="p2" data-anchor-id="section-p2">/);
  assert.match(H, /<section class="panel" id="p3"[^>]*data-panel="p3" data-anchor-id="section-p3">/);
  // switcher script
  assert.match(H, /function setTab\(id\)/);
  assert.match(H, /classList\.toggle\('active'/);
});

// ── p1 · Answer & How it works ────────────────────────────────────────────────────────────────────────────
test('p1 Answer: heading + honey lead callout + unified list; RAW <code>/<span class="lead"> survive', () => {
  assert.match(H, /<div class="p-h">Answer<\/div>\n        <div class="answer-lead">\n        <ul class="list">/);
  assert.match(H, /<li>Waggle owns no memory store — it is a thin HTTP client to the backend <code>org_memory<\/code>/);
  assert.match(H, /<li><span class="lead">Reads are on by default, writes are off\.<\/span> A write needs two keys\.<\/li>/);
});

test('p1 How it works: the flow diagram renders BEFORE the narrative paragraphs', () => {
  assert.match(H, /<div class="p-h">How it works<\/div>/);
  const p1 = H.match(/<section class="panel active" id="p1"[\s\S]*?<\/section>/)![0];
  assert.ok(p1.indexOf('<figure class="dg">') > -1 && p1.indexOf('<figure class="dg">') < p1.indexOf('<p class="body">'), 'flow before text');
  assert.match(p1, /<p class="body"><span class="lead">Read path \(adopt\):<\/span>/);
  // exactly ONE figure
  assert.equal((H.match(/<figure class="dg[^"]*"/g) || []).length, 1);
  assert.match(H, /<figure class="dg">/);
});

// ── p2 · Where it can tighten ─────────────────────────────────────────────────────────────────────────────
test('p2 tighten: four-part cards (title+chip / LOCATION / CONTEXT), frameless, effort TOOLTIP (not a legend bar)', () => {
  // the panel heading carries the effort info-tooltip, NOT a standing legend bar
  assert.match(H, /<div class="p-h">Where it can tighten<span class="lg-tip" tabindex="0" aria-label="Effort levels">i<span class="lg-pop"/);
  assert.match(H, /<span class="chip quick">quick<\/span><span class="lg-t">small, fast change<\/span>/);
  assert.doesNotMatch(H, /<div class="legend">/);
  const p2 = H.match(/<section class="panel" id="p2"[\s\S]*?<\/section>/)![0];
  // card 1: NN + fix as the bold title + colored chip
  assert.match(p2, /<div class="tp quick">\n          <div class="tp-h"><span class="tp-n">01<\/span><b class="tp-title">Merge them into one switch, or warn at startup when they disagree<\/b> <span class="chip quick">quick<\/span>/);
  assert.match(p2, /<span class="chip mod">moderate<\/span>/);
  assert.match(p2, /<span class="chip proj">project<\/span>/);
  // LOCATION (mono files block) + CONTEXT (weakness). These cards have no `title`, so THE ITEM segment is absent.
  assert.match(p2, /<div class="wi-k">Location<\/div>\n            <div class="wi-loc">server\.ts · orgMemory\.ts<\/div>/);
  assert.match(p2, /<div class="wi-k">Context<\/div>\n            <p class="wi-ctx">The two write master switches have nearly identical names<\/p>/);
  assert.doesNotMatch(p2, /The item/); // no THE ITEM (no distinct title on these cards)
  // frameless: .tp carries no border/background (the CSS strips it)
  assert.match(H, /\.tp \{ margin: 0; \}/);
  assert.doesNotMatch(H, /\.tp \{ border:/);
});

test('p2 tighten: a card WITH a short title shows THE ITEM segment with the fix', () => {
  const t = renderScopedReport({ ...MODEL, tightening: [{ title: 'Collapse the write flags', weakness: 'Two near-identical write flags', fix: 'Merge them into one', effort: 'quick_win', files: ['src/server.ts'] }] });
  assert.match(t, /<b class="tp-title">Collapse the write flags<\/b>/);
  assert.match(t, /<div class="wi-k">The item<\/div>\n            <p class="wi-ctx">Merge them into one<\/p>/);
});

// ── p3 · Scope & Evidence ─────────────────────────────────────────────────────────────────────────────────
test('p3: Scope dual-colour boxes + Evidence + Not-verified, all one unified list/box language', () => {
  const p3 = H.match(/<section class="panel" id="p3"[\s\S]*?<\/section>/)![0];
  // Scope = two same-style .p3-box in a .scope-grid; covered normal, not-covered dimmed
  assert.match(p3, /<div class="p-h">Scope<\/div>\n        <div class="scope-grid">/);
  assert.match(p3, /<div class="p3-box-k">Covered<\/div>\n        <ul class="list">\n          <li>Waggle \(source read directly\)<\/li>/);
  assert.match(p3, /<div class="p3-box-k">Not covered<\/div>\n        <ul class="list muted">\n          <li>the intake-service backend/);
  // Evidence + Not-verified reuse .p3-box + ul.list; RAW <code> survives
  assert.match(p3, /<div class="p-h">Evidence<\/div>\n        <div class="p3-box">\n        <ul class="list">\n          <li><code>orgMemory\.ts:40-79<\/code> — HTTP client/);
  assert.match(p3, /<div class="p-h">Not directly verified<\/div>\n        <div class="p3-box">\n        <ul class="list">\n          <li>The real intake spine lives in the <code>intake-service<\/code>/);
  // the OLD single-page primitives are gone
  assert.doesNotMatch(H, /class="ul\.bl"|class="bl"|class="ev"|class="note"|class="scope"[^-]/);
});

// ── escaping ──────────────────────────────────────────────────────────────────────────────────────────────
test('escaping: a PLAIN field with <script> / & comes out escaped, no live markup', () => {
  assert.match(H, /Acme &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Co\. \(sample\)/);
  assert.doesNotMatch(H, /<script>alert\(1\)<\/script>/); // no live injected markup
});

// ── responsive / print ────────────────────────────────────────────────────────────────────────────────────
test('@media print expands every panel and hides the tab nav', () => {
  assert.match(H, /@media print \{[\s\S]*?\.scoped-tabs \{ display: none; \}/);
  assert.match(H, /@media print \{[\s\S]*?\.panel \{ display: block !important; \}/);
});

// ── deterministic + omission ──────────────────────────────────────────────────────────────────────────────
test('deterministic: same model → byte-identical output; partial flag banners; empty sections omitted', () => {
  assert.equal(renderScopedReport(MODEL), H);
  const partial = renderScopedReport({ ...MODEL, partial: true });
  assert.match(partial, /<div class="partial">/);
  assert.match(partial, /Partial findings/);
  // a lean model → only the Answer panel (p1) remains; p2 / p3 are dropped
  const lean = renderScopedReport({ ...MODEL, mechanism: undefined, flow: undefined, tightening: undefined, scopeBlock: undefined, evidence: undefined, notVerified: undefined });
  assert.equal((lean.match(/class="panel/g) || []).length, 1);
  assert.match(lean, /data-tab="p1"/);
  assert.doesNotMatch(lean, /data-tab="p2"/);
  assert.doesNotMatch(lean, /data-tab="p3"/);
});

// ── flow diagram ──────────────────────────────────────────────────────────────────────────────────────────
test('an un-renderable flow is OMITTED (no mess); the How-it-works paragraphs still render', () => {
  const badFlow = { lanes: [{ title: 'a', steps: [{ label: '1' }, { label: '2' }, { label: '3' }, { label: '4' }, { label: '5' }] }] } as unknown as FlowSpec;
  assert.equal(isRenderableFlow(badFlow), false);
  const m = renderScopedReport({ ...MODEL, flow: badFlow });
  assert.doesNotMatch(m, /<figure class="dg"/); // diagram dropped
  assert.match(m, /<div class="p-h">How it works<\/div>/); // section still present (has paragraphs)
  assert.match(m, /<p class="body">/);
});

test('single-lane flow + hub: SVG height covers the hub (not clipped)', () => {
  const flow: FlowSpec = { lanes: [{ title: 'WRITE', dir: 'in', steps: [{ label: 'entry' }, { label: 'gate', kind: 'gate' }] }], hub: { label: 'store', sub: ['line a', 'line b'] } };
  const svg = renderFlowDiagram(flow);
  assert.ok(svg.length > 0, 'a 1-lane + hub flow is renderable');
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  assert.ok(m, 'viewBox present');
  const height = Number(m![2]);
  assert.ok(height >= 101, `SVG height ${height} must cover the hub bottom (≥101)`);
});

test('overlong flow labels WRAP to multiple lines (no ellipsis, full text preserved)', () => {
  const longStep = 'this is a very very very very long step title that would overflow the box edge';
  const longHub = 'an-extremely-long-hub-label-that-would-run-off-the-edge-of-the-node-box';
  const flow: FlowSpec = { lanes: [{ title: 'L', dir: 'in', steps: [{ label: longStep, sub: 'ok' }, { label: 'gate', kind: 'gate' }] }], hub: { label: longHub, sub: ['s'] } };
  const svg = renderFlowDiagram(flow);
  assert.ok(svg.length > 0);
  assert.doesNotMatch(svg, /…/); // labels WRAP instead of truncating
  assert.ok((svg.match(/<tspan /g) || []).length >= 4, 'long labels wrap into several tspan lines');
  const text = svg.replace(/<[^>]+>/g, '');
  assert.ok(text.replace(/\s+/g, '').includes(longStep.replace(/\s+/g, '')), 'the full step label is rendered (wrapped, not truncated)');
  assert.ok(text.includes(longHub), 'the full hub label is rendered (wrapped, not truncated)');
});


test('the flow diagram is clickable (lightbox affordance + self-contained JS)', () => {
  assert.match(H, /class="dg-hint">Click to enlarge/); // enlarge hint
  assert.match(H, /id="dgLightbox"/);
  assert.match(H, /aria-label="Close"/);
  assert.match(H, /cloneNode\(true\)/);
  assert.match(H, /e\.key==='Escape'/); // Esc closes
});

test('the flow arrow marker: exactly one marker per document, referenced by its arrows', () => {
  assert.equal((H.match(/<marker /g) || []).length, 1);
  assert.match(H, /<marker id="f-arw"/);
  assert.match(H, /marker-end="url\(#f-arw\)"/);
});

// ── h1 = LLM short title; original question moves to a reminder above the Answer ──────────────────────────
test('meta.title → h1 is the short title; the original question moves to the reminder block above the Answer', () => {
  const dossier: ScopedDossier = {
    question: 'How does the cold-start candidate pool get defined and refreshed on each request?', answer: 'a',
    bottomLine: ['The pool has three parts.'], dataPoints: [], evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const html = renderScopedReport(buildScopedReportModel(dossier, { client: 'A', scope: 'Q', date: '2026-07-20', title: 'Cold-start pool definition' }));
  assert.match(html, /<h1>Cold-start pool definition<\/h1>/); // h1 = the short title
  assert.doesNotMatch(html, /<h1>How does the cold-start/); // NOT the long question
  assert.match(html, /<title>[^<]*· Cold-start pool definition<\/title>/); // browser-tab title uses it too
  // the original question moved into the labelled reminder block…
  assert.match(html, /<div class="yourq">\n          <div class="yourq-k">Your question<\/div>\n          <p class="yourq-t">How does the cold-start candidate pool get defined and refreshed on each request\?<\/p>/);
  // …placed ABOVE the Answer, inside panel 1
  const p1 = html.match(/<section class="panel active" id="p1"[\s\S]*?<\/section>/)![0];
  assert.ok(p1.indexOf('class="yourq"') > -1 && p1.indexOf('class="yourq"') < p1.indexOf('<div class="p-h">Answer'), 'question reminder before the Answer heading');
});

test('no meta.title → h1 falls back to the question and there is NO reminder block (back-compat)', () => {
  // MODEL carries no title
  assert.match(H, /<h1>How does Waggle&#39;s org memory work, and where can it tighten\?<\/h1>/);
  assert.doesNotMatch(H, /class="yourq"/);
});

test('XSS: an untrusted title is HTML-ESCAPED in the h1 + <title>', () => {
  // title = run scope label / LLM title = UNTRUSTED → must never inject live markup.
  const dossier: ScopedDossier = {
    question: 'q?', answer: 'a', bottomLine: ['x'], dataPoints: [], evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const single = renderScopedReport(buildScopedReportModel(dossier, { client: 'A', scope: 'Q', date: '2026-07-20', title: '<script>x</script> a & b' }));
  assert.match(single, /<h1>&lt;script&gt;x&lt;\/script&gt; a &amp; b<\/h1>/); // escaped entities, not live tags
  assert.doesNotMatch(single, /<script>x<\/script>/); // the injected payload is NOT live anywhere in the doc
  assert.match(single, /<title>[^<]*&lt;script&gt;x&lt;\/script&gt;[^<]*<\/title>/); // browser-tab title escaped too

});

// ── buildScopedReportModel: secret safety + evidence assembly ──────────────────────────────────
test('buildScopedReportModel redacts secrets in the question (drives <title> + <h1>) before render', () => {
  const SECRET = 'sk-abcdef0123456789ghijklmnop'; // sk- + 26 credential chars → matches redactSecrets' key rule
  const dossier: ScopedDossier = {
    question: `why does key ${SECRET} fail on startup?`, answer: 'The API key is rejected because it is expired.',
    dataPoints: [], evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const model = buildScopedReportModel(dossier, { client: 'Acme', scope: 'Quick Ask', date: '2026-07-19' });
  assert.ok(!model.question.includes(SECRET), 'the raw secret must not appear in the model question');
  assert.match(model.question, /\[redacted-key\]/);
  const html = renderScopedReport(model);
  assert.ok(!html.includes(SECRET), 'the raw secret must not appear anywhere in the rendered report HTML');
});

test('buildScopedReportModel folds measured dataPoints into the evidence list, BEFORE the refs', () => {
  const dossier: ScopedDossier = {
    question: 'how many backend calls per overview load?', answer: 'About ten per load.',
    dataPoints: [
      { label: 'Backend calls per overview load', value: '~10–11', source: 'panorama-cache.ts:155-164' },
      { label: 'Cache TTL', value: '30s', source: 'constants.ts:12' },
    ],
    evidence: [{ ref: 'overview.tsx:88', detail: 'fires the fan-out' }],
    wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const model = buildScopedReportModel(dossier, { client: 'Acme', scope: 'Quick Ask', date: '2026-07-19' });
  assert.ok(model.evidence);
  // dataPoints FIRST, then the existing refs
  assert.match(model.evidence![0], /<span class="lead">Backend calls per overview load<\/span>: ~10–11 <code>panorama-cache\.ts:155-164<\/code>/);
  assert.match(model.evidence![1], /<span class="lead">Cache TTL<\/span>: 30s <code>constants\.ts:12<\/code>/);
  assert.match(model.evidence![2], /<code>overview\.tsx:88<\/code> — fires the fan-out/);
  // rendered inside the p3 evidence box as unified list items
  const html = renderScopedReport(model);
  assert.match(html, /<li><span class="lead">Backend calls per overview load<\/span>: ~10–11 <code>panorama-cache\.ts:155-164<\/code><\/li>/);
  assert.match(html, /<li><code>overview\.tsx:88<\/code> — fires the fan-out<\/li>/);
});

test('a secret-shaped token in a dataPoint value/source is redacted before it reaches the evidence line', () => {
  const SECRET = 'sk-abcdef0123456789ghijklmnop';
  const dossier: ScopedDossier = {
    question: 'what api key does the client use?', answer: 'It reads a key from the environment.',
    dataPoints: [{ label: 'Configured key', value: `key is ${SECRET}`, source: `env dump: ${SECRET}` }],
    evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const model = buildScopedReportModel(dossier, { client: 'Acme', scope: 'Quick Ask', date: '2026-07-19' });
  assert.ok(model.evidence && model.evidence.length === 1, 'the single dataPoint becomes one evidence line');
  assert.ok(!model.evidence![0].includes(SECRET), 'the raw secret must not appear in the evidence model line');
  assert.match(model.evidence![0], /\[redacted-key\]/);
  const html = renderScopedReport(model);
  assert.ok(!html.includes(SECRET), 'the raw secret must not appear anywhere in the rendered report HTML');
});

test('empty dataPoints leaves the evidence list as only the refs', () => {
  const dossier: ScopedDossier = {
    question: 'q', answer: 'a', dataPoints: [], evidence: [{ ref: 'file.ts:1', detail: 'the only ref' }],
    wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const model = buildScopedReportModel(dossier, { client: 'Acme', scope: 'Quick Ask', date: '2026-07-19' });
  assert.deepEqual(model.evidence, ['<code>file.ts:1</code> — the only ref']);
});

test('buildScopedReportModel: answer split into ≤4 sentences on . ! ? + whitespace — a dot inside a token never splits', () => {
  const dossier: ScopedDossier = {
    question: 'q', answer: 'It reads `feature.ts` first. Then 0.456 of calls hit the cache! Is that enough? Yes. Extra.',
    dataPoints: [], evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {},
  };
  const model = buildScopedReportModel(dossier, { client: 'A', scope: 'Q', date: '2026-07-20' });
  assert.deepEqual(model.bottomLine, ['It reads <code>feature.ts</code> first.', 'Then 0.456 of calls hit the cache!', 'Is that enough?', 'Yes.']);
});

test('buildScopedReportModel: the breadcrumb classification is English (keyword match, else the generic class)', () => {
  const base = { answer: 'a', dataPoints: [], evidence: [], wantsFixes: false, workItems: [], openQuestions: [], costUsd: 0, turns: 0, trace: '', toolTally: {} };
  assert.deepEqual(buildScopedReportModel({ ...base, question: 'Is the deploy pipeline safe to roll back?' }, { client: 'A', scope: 'Q', date: 'd' }).breadcrumb, { dimension: 'Delivery Flow', sub: 'CI / Deployment' });
  assert.deepEqual(buildScopedReportModel({ ...base, question: 'Why is this so slow?' }, { client: 'A', scope: 'Q', date: 'd' }).breadcrumb, { dimension: 'Technical Deep-Dive', sub: 'Custom investigation' });
});
