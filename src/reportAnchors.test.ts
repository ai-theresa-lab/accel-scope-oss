import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReportRefs, detailIndexHtml, engineeringReportUrl, findingAnchorIds, findingAnchorMap, injectDetailIndex, isRuledOutFinding, plainFindingLabel, rebindReportRefUrls, reinjectDetailIndex, stripDetailIndex, soleWrapperInnerEnd } from './reportAnchors.ts';
import { R7_CODENAME_RE, R7_PLUMBING_RE } from './research/reportRubric.ts';
import type { Finding } from './schema.ts';

// The leadership brief shipped with ZERO links while its own contract told the author "the engineering report
// carries the full detail and this brief links to it, so you are NOT the system of record" — and gave it no URL.
// The brief left detail out on the strength of a cross-reference that did not exist. These tests cover the
// deterministic citation that makes the claim true, and the ONE-MAP invariant that keeps a citation pointing at
// the block it names.

// NOTE the evidence ref does NOT embed `id`. My first version wrote `src/${id}.ts`, which put the positional id
// back into the CONTENT — so two findings that should have been content-identical hashed differently and the
// content-stability tests passed for the wrong reason. The fixture has to be independent of the id to test that.
const f = (id: string, title: string, extra: Record<string, unknown> = {}): Finding =>
  ({ id, title, claim: title, severity: 'high', lens: 'security', evidence: [{ kind: 'file', ref: 'src/x.ts' }], ...extra }) as unknown as Finding;

test('an anchor is derived from CONTENT, not position', () => {
  // The positional id is excluded deliberately: including it would move the anchor when an unrelated finding is
  // inserted ahead of it, orphaning every citation to it.
  const a = findingAnchorMap([f('INV-1', 'shared key reads any tenant')]);
  const b = findingAnchorMap([f('INV-9', 'shared key reads any tenant')]);
  assert.equal(a.get('INV-1'), b.get('INV-9'), 'same content ⇒ same anchor, whatever the id');
});

test('inserting a finding ahead of another does not move the second one\'s anchor', () => {
  const one = f('INV-2', 'credentials auto-mount across a domain');
  const before = findingAnchorMap([one]).get('INV-2');
  const after = findingAnchorMap([f('INV-1', 'something else entirely'), one]).get('INV-2');
  assert.equal(after, before, 'a citation must survive an unrelated finding appearing above it');
});

test('different content gets a different anchor', () => {
  const m = findingAnchorMap([f('a', 'first'), f('b', 'second')]);
  assert.notEqual(m.get('a'), m.get('b'));
});

test('identical-content findings are deduped, not collided', () => {
  // Two byte-identical findings share a base hash; dedupe suffixes the later one so a citation still addresses
  // exactly one block.
  const m = findingAnchorMap([f('x', 'same'), f('y', 'same')]);
  assert.notEqual(m.get('x'), m.get('y'), 'two blocks must not share one anchor');
  assert.match(m.get('y')!, /-2$/);
});

test('refs carry a deep link when a URL is known, and no dead link when it is not', () => {
  const findings = [f('a', 'first finding')];
  const withUrl = buildReportRefs(findings, '/api/runs/rs_1/report');
  assert.match(withUrl[0].href!, /^\/api\/runs\/rs_1\/report#finding-[a-f0-9]{16}$/);
  const without = buildReportRefs(findings);
  assert.equal(without[0].href, undefined, 'no URL ⇒ no href');
  assert.equal(without[0].anchor, withUrl[0].anchor, 'the anchor is the same either way');
});

test('a ref with no href renders as TEXT, never as a dead link', () => {
  // A citation that 404s is worse than one that reads as prose: it invites the reader to follow it.
  const html = detailIndexHtml(buildReportRefs([f('a', 'first finding')]));
  assert.doesNotMatch(html, /<a\s/, 'must not emit an anchor tag with nowhere to go');
  assert.match(html, /first finding/);
  assert.match(html, /engineering report/);
});

test('no findings ⇒ no citation block at all', () => {
  assert.equal(detailIndexHtml([]), '');
  assert.equal(injectDetailIndex('<body><div class="wrap">x</div></body>', []), '<body><div class="wrap">x</div></body>');
});

// ── the injection lands INSIDE the brief's content column ───────────────────────────────────────
const page = (inner: string) => `<!doctype html><body>
<div class="wrap">${inner}</div></body>`;

test('the brief gets ONE block, inside the body', () => {
  const out = injectDetailIndex(page('<p>English</p>'), buildReportRefs([f('a', 'a finding')], '/r'));
  assert.equal((out.match(/class="detail-index"/g) ?? []).length, 1, 'one block');
  assert.match(out, /Where the detail lives/);
  assert.match(out, /This brief carries only what a decision needs/);
  assert.ok(out.indexOf('class="detail-index"') < out.indexOf('</body>'), 'inside the body');
});

test('the block lands INSIDE the sole wrapper column, not after it', () => {
  const out = injectDetailIndex(page('<p>English</p>'), buildReportRefs([f('a', 'a finding')], '/r'));
  assert.match(out, /<p>English<\/p><div class="detail-index"[\s\S]*<\/div><\/div><\/body>/, 'the wrapper closes after the block');
});

test('nested cards do not truncate the walk — the block goes at the content\'s END', () => {
  const nested = page('<div class="card"><div class="kpi"><span>0 of 3</span></div></div><p>tail</p>');
  const out = injectDetailIndex(nested, buildReportRefs([f('a', 'a finding')], '/r'));
  const tail = out.indexOf('tail');
  const block = out.indexOf('class="detail-index"');
  assert.ok(block > tail, 'a depth-matched walk puts it after the last content, not after the first </div>');
});

test('unbalanced markup does not corrupt the document, and still gets its citations', () => {
  const broken = '<div class="wrap"><div>unclosed';
  const out = injectDetailIndex(broken, buildReportRefs([f('a', 'x')], '/r'));
  assert.ok(out.startsWith(broken), 'the original markup must be left exactly as it was');
  assert.match(out, /class="detail-index"/, 'and the citations are not silently dropped');
});

test('a title is escaped, so a finding cannot inject markup into the brief', () => {
  const html = detailIndexHtml(buildReportRefs([f('a', '<img src=x onerror=alert(1)>')], '/r'));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

// ── POSITIONAL, because a Finding id is not unique ───────────────────────────────────────────────
//
// Caught by an EXISTING test in reportHtml.test.ts, not by me: my first version keyed the anchor map by
// `f.id`, and that suite legitimately renders two findings sharing one id (mkFinding defaults id:'X-01').
// The map collapsed them, so the second finding's citation pointed at the first finding's block — a citation
// that confidently sends the reader to the wrong evidence. The renderer was positional all along.

test('two findings sharing an id get DISTINCT anchors', () => {
  const dupes = [f('X-01', 'first finding'), f('X-01', 'second finding')];
  const ids = findingAnchorIds(dupes);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1], 'distinct content ⇒ distinct anchors even under one id');
});

test('buildReportRefs emits one citation per FINDING, not per id', () => {
  const refs = buildReportRefs([f('X-01', 'first'), f('X-01', 'second')], '/r');
  assert.equal(refs.length, 2, 'a duplicate id must not silently drop a citation');
  assert.notEqual(refs[0].anchor, refs[1].anchor);
  assert.deepEqual(refs.map((r) => r.title), ['first', 'second']);
});

test('the by-id map keeps the FIRST occurrence and is documented as lossy', () => {
  // Kept for callers that genuinely key by id; the positional form is the one to reach for.
  const m = findingAnchorMap([f('X-01', 'first'), f('X-01', 'second')]);
  assert.equal(m.size, 1);
  assert.equal(m.get('X-01'), findingAnchorIds([f('X-01', 'first'), f('X-01', 'second')])[0]);
});

test('a document with no <body> is treated as one body and gets its citations', () => {
  const out = injectDetailIndex('<div class=wrap><p>English</p></div>', buildReportRefs([f('a', 'x')], '/r'));
  assert.match(out, /class="detail-index"/);
});

test('the structured leadership fallback injects citations, not just the free-vibe writer', () => {
  // The structured fallback rendered the brief and added only provenance, so a run that fell back under
  // reserve pressure shipped with zero engineering references — the same gap provenance once had.
  const org = readFileSync(new URL('./run/execute-org-run.ts', import.meta.url), 'utf8');
  assert.match(org, /injectDetailIndex\(renderRecallReport\(sanitizeReportInput\(leadershipFinal\)\)/);
});

// ── report-anchor regressions, part 2 ──────────────────────────────────────────────────────────────────

test('each entry is labelled with its F-id', () => {
  const html = detailIndexHtml(buildReportRefs([f('a', 'shared key reads any tenant'), f('b', 'second', { severity: 'critical' })], '/r'));
  assert.match(html, /The full evidence for each finding is in the engineering report/);
  assert.match(html, /F-01 · second/, 'the critical finding is F-01');
  assert.match(html, /F-02 · shared key reads any tenant/);
});

test('"Where the detail lives" is grouped by area, with a count per group and the F-id per item', () => {
  const refs = buildReportRefs([
    f('SWE-ARCH:H1', 'god file holds every job', { severity: 'medium', source: 'recommendation-audit' }),
    f('RE2-01', 'floating action tags', { invariant: 're2', severity: 'high' }),
    f('SWE-ARCH:H2', 'layer cycle', { severity: 'high', source: 'recommendation-audit' }),
    f('GCP-1', 'stale table', { severity: 'low' }),
    f('SWE-ARCH:H3', 'healthy check', { severity: 'info', source: 'recommendation-audit' }),
  ], '/r');
  assert.deepEqual(refs.map((r) => r.displayId), ['F-01', 'F-02', 'F-03', 'F-04'], 'ruled-out row excluded, F-id order');
  const html = detailIndexHtml(refs);
  const groups = [...html.matchAll(/class="di-gh"[^>]*>([^<]+)<span[^>]*>· (\d+)<\/span>/g)].map((m) => [m[1].trim(), Number(m[2])]);
  assert.deepEqual(groups, [
    ['Found by: Build / CI / release engineering', 1],
    ['Found by: Software architecture &amp; code health', 2],
    ['Other findings', 1],
  ], 'groups ordered by their most severe member; the un-owned finding is last');
  assert.ok(html.indexOf('F-02 · layer cycle') < html.indexOf('F-03 · god file holds every job'), 'items in F-id order within a group');
  assert.doesNotMatch(html, /healthy check/, 'a ruled-out row is not a citation');
});

test('an ordinary finding click clears the citation override', () => {
  // selected() resolves selAnchor FIRST, so leaving a citation's anchor set pinned the detail pane to the cited
  // finding for the rest of the session however the reader clicked. Every card carries its own anchor, so the
  // handlers set it from the clicked card — clearing the override and keeping duplicate-id findings selectable.
  const rh = readFileSync(new URL('./reportHtml.ts', import.meta.url), 'utf8');
  for (const act of ['select', 'open']) {
    const line = rh.split(/\r?\n/).find((l) => l.includes(`act === '${act}'`))!;
    assert.match(line, /state\.selAnchor = t\.getAttribute\('data-anchor-id'\)/, `${act} must reset selAnchor`);
  }
});

// ── report-anchor regressions, part 3 ──────────────────────────────────────────────────────────────────

test('the citation block is REPLACEABLE, so a later, complete list can supersede it', () => {
  // Needed because GCP findings are appended AFTER the brief is authored: the first block omitted them while
  // the engineering report it cites includes them, contradicting its claim to locate the evidence for EACH
  // finding. Re-injection must replace, not append a second block.
  const doc = page('<p>English</p>');
  const first = injectDetailIndex(doc, buildReportRefs([f('a', 'code finding')], '/api/runs/r1/report'));
  assert.equal((first.match(/class="detail-index"/g) ?? []).length, 1);
  const second = reinjectDetailIndex(first, buildReportRefs([f('a', 'code finding'), f('g', 'gcp finding')], '/api/runs/r1/report'));
  assert.equal((second.match(/class="detail-index"/g) ?? []).length, 1, 'replaced, not duplicated');
  assert.match(second, /gcp finding/, 'the late finding is now cited');
});

test('re-injection is idempotent', () => {
  const refs = buildReportRefs([f('a', 'x')], '/r');
  const once = reinjectDetailIndex(page('<p>e</p>'), refs);
  assert.equal(reinjectDetailIndex(once, refs), once);
});

test('stripDetailIndex leaves a document with no citation block alone', () => {
  const doc = page('<p>English</p>');
  assert.equal(stripDetailIndex(doc), doc);
});

test('replay rebinds citation URLs onto the child run', () => {
  // A resume copies the parent brief verbatim, so its links kept pointing at the parent — stale at once, and a
  // 404 once that parent is trashed.
  const parent = injectDetailIndex(page('<p>e</p>'), buildReportRefs([f('a', 'x')], '/api/runs/rs_parent/report'));
  assert.match(parent, /\/api\/runs\/rs_parent\/report#finding-/);
  const child = rebindReportRefUrls(parent, 'rs_child');
  assert.match(child, /\/api\/runs\/rs_child\/report#finding-/);
  assert.doesNotMatch(child, /rs_parent/, 'no parent id may survive the replay');
});

test('rebinding preserves the anchor, so a citation still lands on the same finding', () => {
  const refs = buildReportRefs([f('a', 'x')], '/api/runs/p/report');
  const anchor = refs[0].anchor;
  const child = rebindReportRefUrls(injectDetailIndex(page('<p>e</p>'), refs), 'c');
  assert.ok(child.includes(`/api/runs/c/report#${anchor}`), 'only the run id changes, never the anchor');
});

// ── report-anchor regressions, part 4 ──────────────────────────────────────────────────────────────────

test('the STRUCTURED report (recallReportHtml) gets citations too', () => {
  const structured = '<!doctype html><html><head></head><body><div class="wrap">'
    + '<div class="lead">Bottom line</div></div></body></html>';
  const out = injectDetailIndex(structured, buildReportRefs([f('a', 'a finding')], '/api/runs/r/report'));
  assert.match(out, /class="detail-index"/, 'the structured report must get a block');
  assert.ok(out.indexOf('detail-index') < out.indexOf('</body>'), 'inside the body');
  assert.match(out, />Where the detail lives</);
});

test('the block is replaceable', () => {
  const structured = '<!doctype html><body><p>x</p></body>';
  const once = injectDetailIndex(structured, buildReportRefs([f('a', 'x')], '/r'));
  const twice = reinjectDetailIndex(once, buildReportRefs([f('a', 'x'), f('b', 'y')], '/r'));
  assert.equal((twice.match(/class="detail-index"/g) ?? []).length, 1, 'replaced, not duplicated');
  assert.match(twice, /y/);
});

test('two-report model: the leadership brief (the only LLM report) is refreshed with the final, GCP-inclusive Area health', () => {
  // GCP findings are appended after the brief is authored, so the re-injection at finish is what makes its F-id links
  // cover every finding. There is no Combined report any more.
  const org = readFileSync(new URL('./run/execute-org-run.ts', import.meta.url), 'utf8');
  // Incremental re-scan: the same re-injection also carries the deterministic "Since last scan" row (`since`), and
  // cross-project org memory its "Across your projects" row (`across`).
  assert.match(org, /run\.leadershipHtml = reinjectDetailIndex\(run\.leadershipHtml, buildReportRefs\(reportFindings, engineeringReportUrl\(run\.id\)\), \{ \.\.\.\(execution \? \{ themes: areaHealthThemes\(execution\.groups\) \} : \{\}\), since, across, \.\.\.\(lens \? \{ lens, answerBack: answerBackBlock \} : \{\}\) \}\)/);
  // v5 shape pass: the injected answer-back is rebuilt from the same final data and re-injected with the map.
  assert.match(org, /lensAnswerBackFrom\(answerBack, \{ \.\.\.leadershipLensFor\(answerBack\.map\(\(r\) => r\.id\), reportFindings, coverageGaps, execution\?\.groups, lensOverrides, finalMap\), brief: lens \}\)/);
  // Report lens split: on v5 the capability map (lens) is rebuilt from the same final findings + Execution groups.
  assert.match(org, /const lens = LEADERSHIP_VARIANT === 'v5' \? lensBriefFor\(reportFindings, coverageGaps, execution\?\.groups, lensOverrides, finalMap\) : null;/);
  assert.doesNotMatch(org, /saveReport\(run\.id \+ '-combined'/);
});

// ── report-anchor regressions, part 5 ──────────────────────────────────────────────────────────────────

test('re-injection NEVER deletes citations without replacing them', () => {
  // reinject strips FIRST, so if nothing could be written back the document would lose the block it already had and
  // gain nothing. A failed injection (here: nothing to inject) returns the original untouched.
  const withBlock = '<p>brief</p>' + detailIndexHtml(buildReportRefs([f('a', 'x')], '/r'));
  assert.match(withBlock, /class="detail-index"/);
  assert.equal(reinjectDetailIndex(withBlock, []), withBlock, 'nothing to inject ⇒ leave the existing citations exactly as they were');
});

test('a document with no citations gets one appended at the end of its body', () => {
  const plain = '<body><p>nothing here</p></body>';
  const out = reinjectDetailIndex(plain, buildReportRefs([f('a', 'x')], '/r'));
  assert.match(out, /^<body><p>nothing here<\/p><div class="detail-index"[\s\S]*<\/div><\/body>$/);
  assert.equal(reinjectDetailIndex(plain, []), plain, 'and nothing at all without refs');
});

// ── report-anchor regressions, part 6 ──────────────────────────────────────────────────────────────────

test('citation URLs are ABSOLUTE when BASE_URL is set, so an exported report still resolves them', () => {
  // A leadership or combined report can be EXPORTED to a dashboard, where a root-relative
  // /api/runs/... resolves against the DASHBOARD's origin and that route does not exist — so every citation in
  // an exported artifact was broken. Same for a downloaded or emailed file.
  const prev = process.env.BASE_URL;
  try {
    process.env.BASE_URL = 'https://scope.example.com';
    assert.equal(engineeringReportUrl('rs_1'), 'https://scope.example.com/api/runs/rs_1/report');
    process.env.BASE_URL = 'https://scope.example.com/';   // trailing slash must not double up
    assert.equal(engineeringReportUrl('rs_1'), 'https://scope.example.com/api/runs/rs_1/report');
  } finally { if (prev === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = prev; }
});

test('with no BASE_URL it stays relative rather than guessing a host', () => {
  // An absolute URL built on a guessed host would be worse than a relative one.
  const prev = process.env.BASE_URL;
  try {
    delete process.env.BASE_URL;
    assert.equal(engineeringReportUrl('rs_1'), '/api/runs/rs_1/report');
  } finally { if (prev !== undefined) process.env.BASE_URL = prev; }
});

test('replay rebinding still works on an ABSOLUTE citation URL', () => {
  // rebindReportRefUrls matches the path portion, so it must keep working once the host is present — otherwise
  // a resumed run would keep citing the parent from an absolute link.
  const html = injectDetailIndex(page('<p>e</p>'),
    buildReportRefs([f('a', 'x')], 'https://scope.example.com/api/runs/rs_parent/report'));
  const child = rebindReportRefUrls(html, 'rs_child');
  assert.match(child, /https:\/\/scope\.example\.com\/api\/runs\/rs_child\/report#finding-/);
  assert.doesNotMatch(child, /rs_parent/);
});

// ── report-anchor regressions, part 7 ──────────────────────────────────────────────────────────────────

test('a finding the evidence gate will DROP gets no citation', () => {
  // finishRun() removes findings without resolvable evidence just before rendering the engineering report, so
  // citations built from the ungated array pointed at anchors that never existed.
  const good = f('a', 'has evidence');
  const bad = { id: 'b', title: 'no evidence', claim: 'x', severity: 'high', evidence: [] } as unknown as Finding;
  const refs = buildReportRefs([good, bad], '/r');
  assert.equal(refs.length, 1, 'the ungated finding must not be cited');
  assert.equal(refs[0].title, 'has evidence');
});

test('dropping an earlier identical finding does not invalidate a survivor\'s anchor', () => {
  // The subtle half: dedupe suffixes are order-sensitive, so removing an EARLIER identical-content finding
  // renumbers the survivors. Gating before the anchors are computed is what keeps a surviving link valid.
  const dupe = f('a', 'same content');
  const ungated = { ...f('b', 'same content'), evidence: [] } as unknown as Finding;
  // ungated sits FIRST, so an un-gated computation would give the survivor a -2 suffix it should not have
  const refs = buildReportRefs([ungated, dupe], '/r');
  assert.equal(refs.length, 1);
  assert.doesNotMatch(refs[0].anchor, /-2$/, 'the survivor keeps its clean base anchor');
  assert.equal(refs[0].anchor, buildReportRefs([dupe], '/r')[0].anchor, 'and it matches what the report will render');
});

// ── report-anchor regressions, part 8 ──────────────────────────────────────────────────────────────────

test('a RESTYLED marker is still found, so no duplicate index is left behind', () => {
  // The normalizer may validly restyle the leadership markup, including the marker's quoting, and its checks
  // pass because they do not preserve attribute quotes. An exact-string search then failed to find the pre-GCP
  // block, so the stale index SURVIVED and a second was appended — duplicate, conflicting citation lists in the
  // tier most people open. The round-5 non-destructive guard does not catch this: injection genuinely succeeds.
  const structured = '<!doctype html><body><p>x</p></body>';
  const once = injectDetailIndex(structured, buildReportRefs([f('a', 'first')], '/r'));
  const restyled = once.replace('data-detail-index="1"', "data-detail-index='1'");
  const again = reinjectDetailIndex(restyled, buildReportRefs([f('a', 'first'), f('b', 'second')], '/r'));
  assert.equal((again.match(/class="detail-index"/g) ?? []).length, 1, 'exactly one index, not two');
  assert.match(again, /second/, 'and it is the NEW one');
});

test('an unquoted marker is found too', () => {
  const structured = '<!doctype html><body><p>x</p></body>';
  const once = injectDetailIndex(structured, buildReportRefs([f('a', 'x')], '/r'));
  const restyled = once.replace('data-detail-index="1"', 'data-detail-index=1');
  assert.equal((reinjectDetailIndex(restyled, buildReportRefs([f('a', 'x')], '/r')).match(/class="detail-index"/g) ?? []).length, 1);
});

test('the replacement goes back WHERE IT WAS, not at the end of the document', () => {
  // The normalizer nests each report inside its own data-report-tab panel, so a replacement appended before
  // </body> sits outside every panel and stays visible while the reader browses the area-report tabs.
  const doc = '<!doctype html><body><div data-report-tab="leadership"><p>lead</p>'
    + 'MARK</div><div data-report-tab="area"><p>area</p></div></body>';
  const withBlock = doc.replace('MARK', existingBlock());
  const out = reinjectDetailIndex(withBlock, buildReportRefs([f('a', 'x')], '/r'));
  const idx = out.indexOf('class="detail-index"');
  assert.ok(idx > 0 && idx < out.indexOf('data-report-tab="area"'), 'stays inside the leadership panel');
});
// an injected block, via the public injector, so the test does not depend on a private helper
function existingBlock(): string {
  const s = injectDetailIndex('<!doctype html><body></body>', buildReportRefs([f('z', 'old')], '/r'));
  return s.slice(s.indexOf('<div class="detail-index"'), s.indexOf('</body>'));
}

// ── the leadership footer listed every finding — ruled-out rows included — as raw
// engineering headlines (file refs, env names) cut at a fixed length mid-token ("…THERESA_ALLOWED_E").

test('ruled-out (refuted) rows are NOT cited; confirmed rows keep the anchors the engineering report renders', () => {
  const confirmed = f('REC:H1', 'a confirmed defect', { source: 'recommendation-audit', severity: 'high' });
  const ruledOut = f('REC:H2', 'a healthy candidate cause', { source: 'recommendation-audit', severity: 'info' });
  const later = f('REC:H3', 'another confirmed defect', { source: 'recommendation-audit', severity: 'medium' });
  const all = [confirmed, ruledOut, later];
  const refs = buildReportRefs(all, '/r');
  assert.deepEqual(refs.map((r) => r.findingId), ['REC:H1', 'REC:H3']);
  // The anchors still come from the FULL rendered array, so the confirmed links resolve in the engineering report.
  const ids = findingAnchorIds(all);
  assert.deepEqual(refs.map((r) => r.anchor), [ids[0], ids[2]]);
  assert.equal(isRuledOutFinding(ruledOut), true);
  assert.equal(isRuledOutFinding(f('B-1', 'baseline info finding', { source: 'baseline', severity: 'info' })), false, 'only the recommendation-audit encodes refuted-as-info');
});

test('labels are plain English — no file:line, env names, snake_case codenames or regexes', () => {
  const raw = 'Google OAuth callback in src/server.ts:3784-3797 mints a session with no THERESA_ALLOWED_EMAILS check; swing_i2i matches /^a.*b$/i';
  const label = plainFindingLabel(raw, 500);
  assert.doesNotMatch(label, /server\.ts|:3784|THERESA_ALLOWED_EMAILS|swing_i2i|\/\^a/);
  assert.doesNotMatch(label, R7_CODENAME_RE, 'the R7 codename rule passes on the label');
  assert.doesNotMatch(label, R7_PLUMBING_RE, 'the R7 plumbing rule passes on the label');
  assert.match(label, /no configuration setting check/, 'a determiner before a removed token keeps the phrase grammatical');
  assert.match(plainFindingLabel('claude-review.yml triggers on any comment'), /^A CI\/config file triggers/);
});

test('a long label is cut on a WORD boundary with an ellipsis, never mid-token', () => {
  const label = plainFindingLabel('The Google sign-in callback mints a session without checking the allowed email list and drops the deep link', 60);
  assert.ok(label.length <= 60, `≤ max (${label.length})`);
  assert.match(label, /…$/);
  const words = 'The Google sign-in callback mints a session without checking the allowed email list and drops the deep link'.split(' ');
  for (const w of label.replace(/…$/, '').split(' ')) assert.ok(words.includes(w), `"${w}" is a whole word`);
});

test('a title that was itself sliced mid-word is re-labelled from the claim', () => {
  const claim = 'The OAuth callback never consults the email allow-list so any Google account can sign in to the console today';
  const sliced = claim.slice(0, 47);   // "…the email allo" — hypTitle's raw slice fallback
  const [ref] = buildReportRefs([f('X:H1', sliced, { claim })], '/r');
  assert.ok(!ref.title.includes('allo…') && !/\ballo$/.test(ref.title), ref.title);
  assert.ok(ref.title.startsWith('The OAuth callback never consults the email allow-list'), ref.title);
});

// Two generic "a code identifier" placeholders made the leadership footer unreadable.
test('a removed code span is named by what it is (command / source file / function call / credential setting)', () => {
  const a = plainFindingLabel('The published start script executes `node dist/index.js`, but the repo ships only `src/a.ts` with no build step', 500);
  assert.equal(a, 'The published start script executes a command, but the repo ships only a source file with no build step');
  const b = plainFindingLabel('`API_KEY` is a hardcoded, exported credential literal; `loadConfig(raw)` passes it to eval', 500);
  assert.match(b, /^A credential setting is a hardcoded/);
  assert.match(b, /a function call passes it to eval/);
  assert.match(plainFindingLabel('SLACK_BOT_TOKEN is committed', 500), /^A credential setting is committed/);
  for (const l of [a, b]) { assert.doesNotMatch(l, R7_CODENAME_RE); assert.doesNotMatch(l, R7_PLUMBING_RE); }
});

test('umami sample run: the detail block lands INSIDE the body\'s sole content wrapper, styled from the report tokens', () => {
  assert.equal(soleWrapperInnerEnd('<div class="wrap"><p>a</p><div>b</div></div>'), '<div class="wrap"><p>a</p><div>b</div>'.length);
  assert.equal(soleWrapperInnerEnd('<div>a</div><div>b</div>'), '<div>a</div><div>b</div>'.length, 'two top-level children: end of body');
  assert.equal(soleWrapperInnerEnd('<p>text</p>'), '<p>text</p>'.length);
  const doc = '<html><body><div class="wrap"><h1>Brief</h1></div></body></html>';
  const out = injectDetailIndex(doc, [{ findingId: 'RELEASE-ENG:H1', anchor: 'f-a', title: 'x', displayId: 'F-01', area: { key: 'release-eng', label: 'Build / CI / release engineering' } }]);
  assert.match(out, /<h1>Brief<\/h1><div class="detail-index"[\s\S]*?<\/div><\/div><\/body>/, 'the block closes inside .wrap');
  assert.match(out, /Found by: Build \/ CI \/ release engineering/);
  assert.match(out, /var\(--line,#e5e1d9\)/);
  assert.doesNotMatch(out, /system-ui/, 'inherits the report font');
});

test('umami sample run: split code names are quoted so the label reads as a name', () => {
  assert.equal(plainFindingLabel('The has_custom_event/bounce predicate is written two ways'), 'The “has custom event”/bounce predicate is written two ways');
  assert.equal(plainFindingLabel('the getWebsiteStats path computes it twice'), 'the “get website stats” path computes it twice');
});
