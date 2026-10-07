import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPARE_HELPERS_JS, CONNECT_SUCCESS_CLEAR_FIELD_IDS, READING_HELPERS_JS, SCAN_FORM_HELPERS_JS, SHELL_HELPERS_JS, connectSuccessClearFieldIds, renderApp } from './serverUi.ts';
import { DATA_PLANE_KINDS } from './run/planeSelection.ts';

test('connect success clears only fields owned by the acted source kind', () => {
  assert.deepEqual(connectSuccessClearFieldIds('github'), ['ghToken']);
  assert.deepEqual(connectSuccessClearFieldIds('warehouse'), ['whSaJson', 'whUrl', 'whToken']);
  assert.deepEqual(connectSuccessClearFieldIds('keyvalue'), ['kvUrl', 'kvToken']);
  assert.deepEqual(connectSuccessClearFieldIds('local'), ['localPath']);
  assert.deepEqual(connectSuccessClearFieldIds('giturl'), ['giturlUrls']);
  assert.deepEqual(connectSuccessClearFieldIds('gcp'), [], 'the GCP connector is gone');
  assert.deepEqual(connectSuccessClearFieldIds('box'), [], 'the eval-box connector is gone');
  assert.deepEqual(connectSuccessClearFieldIds('mcp'), []);
  assert.deepEqual(connectSuccessClearFieldIds('unknown'), []);

  assert.equal(connectSuccessClearFieldIds('warehouse').includes('ghToken'), false);
  assert.equal(connectSuccessClearFieldIds('github').includes('whUrl'), false);
  assert.equal(connectSuccessClearFieldIds('giturl').includes('localPath'), false);
});

test('rendered client uses the shared scoped connect-clear mapping', () => {
  const html = renderApp();
  assert.ok(html.includes(`var CONNECT_CLEAR_FIELDS = ${JSON.stringify(CONNECT_SUCCESS_CLEAR_FIELD_IDS)};`));
  assert.ok(html.includes('clearSubmittedConnectionFields(kind,clearSnap);'));
  assert.equal(JSON.stringify(CONNECT_SUCCESS_CLEAR_FIELD_IDS).includes('mcpList'), false, 'MCP set textarea must not be cleared after connect');
});

test('Quick Ask has a SINGLE Ask button (deterministic template is the default; no V2/beta button)', () => {
  const html = renderApp();
  // the one Ask button, original label, drives the default path
  assert.match(html, /id="askBtn" data-act="startask"[^>]*>Ask →<\/button>/);
  // the beta V2 button + its dispatch are gone
  assert.doesNotMatch(html, /askV2Btn/);
  assert.doesNotMatch(html, /startaskv2/);
  assert.doesNotMatch(html, /Ask V2/);
  // startAsk posts NO renderer flag (server defaults to the new template); no per-click v2 body branch
  assert.doesNotMatch(html, /body\.renderer='v2'/);
});

// ── New Full Scan form + run page ──────────────────────────────────────────────────────────────
// The helpers are evaluated from the SAME source string the browser runs (SCAN_FORM_HELPERS_JS is interpolated
// verbatim into CLIENT), so these tests pin the shipped behavior, not a copy of it.
type AnyFn = (...a: any[]) => any;
const H = new Function(`${SCAN_FORM_HELPERS_JS}; return { plural, srcChipCount, fixCountPlurals, runTitle, costWord, scanSelStorageKey, snapshotScanSel, restoreScanSel, runTitleBare, scanSummary, duplicateRepoTargets, localFolderSub, recentCostHint, spendInfo, degradedRows, codeintelCardCopy, laneBundleIds, planeChoices, isDeterministicRun, detEventStage, detPipeline, SCAN_PLANE_KINDS };`)() as Record<string, AnyFn> & { SCAN_PLANE_KINDS: string[] };

test('the whole embedded client script still parses', () => {
  const html = renderApp();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const client = scripts.find((s) => s.includes('function renderRunConfig'));
  assert.ok(client, 'CLIENT script present');
  assert.doesNotThrow(() => new Function(client!));
});

test('Nothing is pre-ticked; a remembered selection re-ticks only ids that still exist', () => {
  const fresh = H.restoreScanSel(null, ['gh::a/x', 'gh::a/y'], ['wh1']);
  assert.deepEqual(fresh, { art: { 'gh::a/x': false, 'gh::a/y': false }, planes: { wh1: false }, memoryRecall: false });
  const saved = H.snapshotScanSel({ 'gh::a/x': true, 'gh::a/y': false, 'gh::gone': true }, { wh1: true }, true);
  assert.deepEqual(saved, { art: ['gh::a/x', 'gh::gone'], planes: ['wh1'], memoryRecall: true });
  const back = H.restoreScanSel(JSON.parse(JSON.stringify(saved)), ['gh::a/x', 'gh::a/y'], ['wh1', 'wh2']);
  assert.deepEqual(back.art, { 'gh::a/x': true, 'gh::a/y': false });
  assert.equal('gh::gone' in back.art, false, 'a disconnected id is never resurrected');
  assert.deepEqual(back.planes, { wh1: true, wh2: false });
  assert.equal(back.memoryRecall, true);
  assert.notEqual(H.scanSelStorageKey('org_a'), H.scanSelStorageKey('org_b'));
  // the client wires it: defaults come from restoreScanSel (no blanket `=true`), saved on a successful start
  const html = renderApp();
  assert.match(html, /restoreScanSel\(saved, allArtifactKeys\(\)/);
  assert.doesNotMatch(html, /state\.artSel\[s\.id\+'::'\+a\.id\]=true;/);
  assert.match(html, /rememberScanSel\(\);/);
});

test('Scope summary line + confirm threshold (repos > 5, or any data plane)', () => {
  const s = H.scanSummary({ repos: 1, publicRepos: 0, folders: 1, planes: 0, bundles: null, memoryRecall: false, cap: 100 });
  assert.equal(s.text, '1 repo · 1 folder · 0 data sources · bundles: auto · memory recall off · compare with my other projects: off · save learnings off · per-run cap $100');
  assert.match(H.scanSummary({ repos: 1, saveLearnings: true }).text, / · save learnings on/);
  assert.equal(s.needsConfirm, false);
  assert.equal(H.scanSummary({ repos: 4, publicRepos: 2 }).needsConfirm, true, '6 repos');
  assert.equal(H.scanSummary({ repos: 5 }).needsConfirm, false, '5 repos is fine');
  assert.equal(H.scanSummary({ repos: 1, planes: 1 }).needsConfirm, true);
  assert.match(H.scanSummary({ repos: 0, folders: 2, planes: 2, bundles: 3, memoryRecall: true, cap: 0 }).text, /2 folders · 2 data sources · 3 bundles · memory recall on · compare with my other projects: off · save learnings off · no per-run cap/);
  // The sibling-recall tick.
  assert.match(H.scanSummary({ repos: 1, siblingRecall: true }).text, /memory recall off · compare with my other projects: on · save learnings off$/);
  assert.match(H.scanSummary({ publicRepos: 2, siblingRecall: true, publicOnly: true }).text, /compare with my other projects: on \(public projects only\)/);
  assert.match(H.scanSummary({ publicRepos: 2, siblingRecall: false, publicOnly: true }).text, /compare with my other projects: off · save learnings off$/);
  // UI-4: the no-git-history warning follows the selection (0 repos + ≥1 uploaded folder), not a removed tick.
  assert.equal(H.scanSummary({ repos: 0, folders: 1 }).warn, 'Uploaded folders carry no git history — the History appendix and churn metrics will be empty.');
  assert.equal(H.scanSummary({ repos: 1, folders: 1 }).warn, '');
  assert.equal(H.scanSummary({ repos: 0, publicRepos: 1, folders: 1 }).warn, '');
  const html = renderApp();
  assert.match(html, /data-act="startrun-confirm"/);
  assert.match(html, /planeFilter:planeFilter,memoryRecall:memoryRecall/);
  assert.doesNotMatch(html, /boxFilter/, 'exec boxes are gone — the server ignores boxFilter, the console no longer sends it');
  assert.doesNotMatch(html, /useMemory:useMem,writeMemory:writeMem,codeintel/, 'the Full Scan no longer sends the hidden always-on useMemory');
  assert.match(html, /id="orgMemoryRecall"/);
});

test('The form offers exactly the server data-plane kinds', () => {
  assert.deepEqual([...H.SCAN_PLANE_KINDS].sort(), [...DATA_PLANE_KINDS].sort());
  const pc = H.planeChoices([
    { id: 'g', kind: 'github', name: 'GitHub' }, { id: 'w', kind: 'warehouse', name: 'BQ' }, { id: 'k', kind: 'keyvalue', name: 'Redis', status: 'error' },
    { id: 'bx', kind: 'box', name: 'Eval boxes', boxes: [{ id: 'b1', label: 'gpu-1', purpose: 'eval' }] },
  ]);
  assert.deepEqual(pc.planes.map((p: { id: string }) => p.id), ['w', 'k']);
  assert.equal(pc.planes[1].error, true);
  assert.equal(pc.boxes, undefined, 'no exec boxes');
});

test('Config controls are keyboard-operable ARIA checkboxes / radios', () => {
  const html = renderApp();
  assert.match(html, /class="cfg-srcdd-row" data-art="'\+esc\(k\)\+'" data-srcq="'\+esc\(hay\)\+'" role="checkbox" tabindex="0" aria-checked=/);
  assert.match(html, /data-act="bundles-auto" role="radio" tabindex="0" aria-checked=/);
  assert.match(html, /role="radiogroup" aria-label="Expert bundles"/);
  assert.match(html, /data-bpick="'\+esc\(b\.key\)\+'" role="checkbox" tabindex="0"/);
  assert.match(html, /data-act="src-dd" data-src="'\+esc\(s\.id\)\+'" role="button" tabindex="0" aria-haspopup="true"/);
  assert.match(html, /if\(e\.key!==' '&&e\.key!=='Enter'&&e\.key!=='Spacebar'\) return;/);
});

test('The source dropdown closes on outside click and Esc', () => {
  const html = renderApp();
  assert.match(html, /function closeSrcDropdown\(refocus\)/);
  assert.match(html, /el\.closest\('\.cfg-srcdd-pop'\)\)\) return;\s*closeSrcDropdown\(false\);/);   // outside = neither the chip nor the in-flow popover
  assert.match(html, /e\.key==='Escape'&&state\.openSrc/);
});

test('The same repo ticked in two sources is flagged; uploaded folders show time + file count', () => {
  const sources = [
    { id: 'gh', kind: 'github', name: 'GitHub', artifacts: [{ id: 'example-org/accel-scope', label: 'example-org/accel-scope' }, { id: 'o/other', label: 'o/other' }] },
    { id: 'pu', kind: 'giturl', name: 'Public URL', artifacts: [{ id: 'https://github.com/Example-Org/accel-scope.git', label: 'example-org/accel-scope' }] },
  ];
  const sel = { 'gh::example-org/accel-scope': true, 'gh::o/other': true, 'pu::https://github.com/Example-Org/accel-scope.git': true };
  assert.deepEqual(H.duplicateRepoTargets(sources, sel), [{ repo: 'example-org/accel-scope', sources: ['GitHub', 'Public URL'] }]);
  assert.deepEqual(H.duplicateRepoTargets(sources, { ...sel, 'pu::https://github.com/Example-Org/accel-scope.git': false }), []);
  const now = Date.parse('2026-09-25T12:00:00Z');
  const recent = H.localFolderSub({ uploadedAt: '2026-09-24T18:05:00Z', count: 1234 }, now);
  assert.match(recent, /^local folder · uploaded Sep 2[45], \d{1,2}:05:00\s[AP]M · 1234 files$/);
  // Two uploads of the same folder seconds apart must not share a label.
  assert.notEqual(H.localFolderSub({ uploadedAt: '2026-09-25T20:22:28.632Z', count: 3 }, now), H.localFolderSub({ uploadedAt: '2026-09-25T20:22:31.840Z', count: 3 }, now));
  assert.match(H.localFolderSub({ uploadedAt: '2025-12-01T12:00:00Z', count: 1 }, now), /2025.*· 1 file$/);
  assert.equal(H.localFolderSub({}, now), 'local folder', 'a path-connected folder (no upload metadata) is unchanged');
});

test('Cost wording, plurals, no "0 findings" for Quick Ask, Scope label subtitle', () => {
  assert.equal(H.costWord('running'), 'est. cost');
  assert.equal(H.costWord('complete'), 'cost');
  assert.equal(H.costWord('error'), 'cost');
  assert.equal(H.plural(1, 'repo'), '1 repo');
  assert.equal(H.plural(2, 'box', 'boxes'), '2 boxes');
  assert.equal(H.fixCountPlurals('1 repos · 1 folders · 11 repos · 21 projects'), '1 repo · 1 folder · 11 repos · 21 projects');
  assert.equal(H.fixCountPlurals('1 public repos'), '1 public repo');
  // The run title (hero <h2>, topbar, history, report library) repairs legacy stored target names too.
  assert.equal(H.runTitle({ targetName: '1 repos · 1 folders' }), 'Full Scan · 1 repo · 1 folder');
  assert.equal(H.runTitle({ targetName: '2 repos · 1 folder' }), 'Full Scan · 2 repos · 1 folder');
  assert.equal(H.runTitle({ targetName: '' }), 'Full Scan run');
  assert.equal(H.runTitle({ renamed: 'My 1 repos run', targetName: '1 repos' }), 'My 1 repos run', 'a user rename is verbatim');
  assert.equal(H.runTitle({ kind: 'ask', targetName: 'why 1 repos?' }), 'Quick Ask · why 1 repos?', 'ask text is verbatim');
  const html = renderApp();
  assert.match(html, /run\.kind==='ask'\?'answer ready'/);
  assert.match(html, /scopeLabel:String\(state\.scopeText\|\|''\)\.trim\(\)\|\|undefined/);
  assert.match(html, /class="scan-hero-scope"/);
  assert.doesNotMatch(html, /ask-hero-cost">est\. cost/);
});

test('Chooser cost hints come from recent actuals, or nothing', () => {
  const runs = [
    { kind: 'ask', status: 'complete', costUsd: 4.55 }, { kind: 'ask', status: 'running', costUsd: 1 }, { kind: 'ask', status: 'complete', costUsd: 2.1 },
    { status: 'complete', costUsd: 108.18 }, { kind: 'design', status: 'complete', costUsd: 0 },
  ];
  assert.equal(H.recentCostHint(runs, 'ask'), '$2.10–$4.55 over the last 2 runs');
  assert.equal(H.recentCostHint(runs, 'scan'), 'last run $108');
  assert.equal(H.recentCostHint(runs, 'design'), '', 'a $0 run is not an actual');
  assert.equal(H.recentCostHint([], 'ask'), '');
  const html = renderApp();
  assert.doesNotMatch(html, /nc-opt-m">[^<]*~\$1/);
  assert.match(html, /id="ncCostAsk"/);
});

test('The config explainer graph is labeled static, with no "activated N bundles"', () => {
  const html = renderApp();
  assert.match(html, /How a full scan runs · illustration, not this run/);
  assert.match(html, /var rootSub=isPrev\s*\? 'classifies the system, then activates the bundles that fit/);
});

test('Live spend against the cap, over-cap note, actual cost when terminal', () => {
  assert.deepEqual(H.spendInfo({ status: 'running', liveCostUsd: 42.5, costUsd: null }, 100), { label: 'spent so far', value: '$42.50', cap: '$100 per-run cap', overPct: 0 });
  assert.deepEqual(H.spendInfo({ status: 'complete', costUsd: 108.18 }, 100), { label: 'cost', value: '$108', cap: '$100 per-run cap', overPct: 8 });
  assert.equal(H.spendInfo({ status: 'running', costUsd: null }, null).value, '—');
  assert.equal(H.spendInfo({ status: 'running', costUsd: 3 }, 0).cap, '', 'an uncapped run shows no cap');
  assert.doesNotMatch(renderApp(), /\(instance\)|instance cap/, 'the cap is the per-run cap, not an "instance" cap');
});

test('Degradation banner rows from run.degraded + the boot OpenAI auth flag', () => {
  assert.deepEqual(H.degradedRows({}, null), []);
  const rows = H.degradedRows({ degraded: [{ stage: 'reconcile', reason: 'skipped (OpenAI 401)', at: 'x' }] }, false);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stage, 'openai');
  assert.deepEqual(rows[1], { stage: 'reconcile', reason: 'skipped (OpenAI 401)' });
  assert.match(renderApp(), /class="run-degraded" role="status"/);
});

test('The code-intelligence card claims maps only when a report carries them', () => {
  assert.equal(H.codeintelCardCopy({ codeintelInReports: true }).link, true);
  assert.match(H.codeintelCardCopy({ codeintelInReports: true }).body, /rendered inside the generated reports/);
  const off = H.codeintelCardCopy({ codeintelInReports: false, status: 'complete' });
  assert.match(off.body, /unavailable or not indexed/);
  assert.doesNotMatch(off.body, /rendered inside/);
  assert.doesNotMatch(H.codeintelCardCopy({ status: 'complete' }).body, /rendered inside/);
  assert.doesNotMatch(H.codeintelCardCopy({ status: 'running' }).body, /rendered inside the generated/);
  assert.doesNotMatch(renderApp(), /repowise index — rendered inside the generated reports/);
});

test('Graph lanes union the announced bundles with the frontier checkpoint + produced area reports', () => {
  const ids = H.laneBundleIds(['recsys-mle', 'baseline', 'data-eng'],
    [{ id: 'workspace' }, { id: 'frontier', bundlesDone: ['baseline', 'saas-tenancy'] }],
    [{ id: 'recsys-mle', title: 'Recs' }, { id: 'saas-tenancy', title: 'SaaS tenancy' }]);
  assert.deepEqual(ids, ['recsys-mle', 'baseline', 'data-eng', 'saas-tenancy']);
  assert.deepEqual(H.laneBundleIds(null, [], []), []);
  assert.deepEqual(H.laneBundleIds(null, [{ id: 'barrier', bundlesDone: ['a'] }], null), ['a']);
});

// ── Shell, navigation, copy, a11y, mobile ──────────────────────────────────────────────────────────
// Same pattern as above: SHELL_HELPERS_JS is the exact block CLIENT interpolates, evaluated here with `new Function`.
const S = new Function(`${SHELL_HELPERS_JS}; return { esc, topbarRunId, keySourceText, providerText, TYPICAL_COST, memEvMetaLine, humanError, fmtDate, fmtClock, fmtDay, fmtEventTime, lastEventTime, relTime, mdLite, sourceKindLabel, friendlySourceDetail, bundleDisplayName, BUNDLE_ORDER, libKindOf, filterLibraryRuns, findingsLabel, libraryEmptyText, actionConfirmText, costHintText };`)() as Record<string, AnyFn> & { BUNDLE_ORDER: string[] };
const APP = renderApp();
const CSS_TEXT = (APP.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];

test('The topbar status strip is bound to the route run and hidden elsewhere', () => {
  const ctx = { activeRunId: 'rs_live', reportRunId: null, reportFolderRun: null, askDetailId: null };
  assert.equal(S.topbarRunId('run', '?run=rs_a', { ...ctx, activeRunId: 'rs_a' }), 'rs_a');
  assert.equal(S.topbarRunId('run', '?run=rs_a', { ...ctx, activeRunId: null }), 'rs_a', 'a deep link before state catches up');
  assert.equal(S.topbarRunId('run', '', { ...ctx, configOpen: true }), null, 'a New-scan compose shows no run');
  assert.equal(S.topbarRunId('report', '?run=rs_old', { ...ctx, reportRunId: 'rs_old' }), 'rs_old', 'reading an old report never shows the live run');
  assert.equal(S.topbarRunId('report', '', { ...ctx, reportFolderRun: 'rs_f' }), 'rs_f');
  assert.equal(S.topbarRunId('report', '', ctx), null, 'the report LIBRARY has no run');
  assert.equal(S.topbarRunId('ask', '', { ...ctx, askDetailId: 'rs_q' }), 'rs_q');
  assert.equal(S.topbarRunId('ask', '', { ...ctx, askDetailId: 'rs_q', askComposing: true }), null);
  for (const v of ['connect', 'memory', 'settings', 'audit', 'design', '']) assert.equal(S.topbarRunId(v, '?run=rs_a', ctx), null, v);
  assert.match(APP, /var _tbid=topbarRunId\(view,location\.search,\{/);
  assert.doesNotMatch(APP, /var _tr=barRun\(\);/, 'the old "any live run" picker is gone');
});

test('errors read as sentences', () => {
  assert.equal(S.humanError('parent run not found'), 'Parent run not found.');
  assert.equal(S.humanError('', 'Could not save the keys.'), 'Could not save the keys.');
  assert.equal(S.humanError('Already fine!'), 'Already fine!');
});

test('history strips: All / Running / Completed / Failed (the request-queue "Pending" tab is gone)', () => {
  assert.match(APP, /var _hf=historyFilter\('run'\);/);
  assert.match(APP, /var _hf=historyFilter\('ask'\);/);
  assert.doesNotMatch(APP, /historyFilter\('design'\)/, 'the Design Doc tab (and its history strip) was removed');
  assert.match(APP, /state\.runFilter=t\.getAttribute\('data-run-filter'\);/);
  assert.doesNotMatch(APP, /data-run-filter="pending"|data-ask-filter="pending"|queuePendingCardsHtml/);
  assert.match(APP, /<button class="run-filter active" data-run-filter="all">All<\/button>/);
});

test('Connect drawer — Esc closes it, no invisible click-swallowing backdrop, focus in and back', () => {
  assert.match(APP, /id="connPanel" class="cx-panel" style="display:none" role="dialog"/);
  assert.match(APP, /else if\(_cp&&_cp\.style\.display==='flex'\)\{ closeConnPanel\(\); \}/);
  assert.doesNotMatch(CSS_TEXT, /body\.conn-panel-open \.cx-backdrop\{background:transparent;\}/);
  assert.match(CSS_TEXT, /@media \(min-width:1100px\)\{body\.conn-panel-open \.cx-backdrop\{display:none!important;\}\}/);
  assert.match(APP, /state\.connReturnFocus=\(ae&&ae!==document\.body\)\?ae:null;/);
  assert.match(APP, /var x=p&&p\.querySelector\('\.cx-panel-x'\); if\(x\)\{ try\{ x\.focus\(\); \}catch\(_\)\{\} \}/);
});

test('Destructive, paid and outward actions confirm (with a real cost hint) and look the part', () => {
  assert.match(S.actionConfirmText('remove', { title: 'Q3 scan' }), /Trash/);
  assert.match(S.actionConfirmText('resume', { costUsd: 108.18 }), /PAID[\s\S]*\$108 in total/);
  assert.doesNotMatch(S.actionConfirmText('resume', {}), /\$/, 'no invented cost');
  assert.equal(S.costHintText(0), '');
  for (const k of ['remove', 'resume']) assert.match(APP, new RegExp(`confirm\\(actionConfirmText\\('${k}'`), k);
  assert.doesNotMatch(APP, /actionConfirmText\('publish'/, 'publishing a public link is gone');
  assert.match(APP, /class="rf-side-act danger" data-act="report-trash"/);
  assert.match(APP, /Start run from here <span class="paid-tag">paid<\/span>/);
});

test('One verb for new runs, one filter vocabulary, one bundle display-name map', () => {
  assert.doesNotMatch(APP, /data-design-filter="running">Active</);
  assert.doesNotMatch(APP, /data-design-filter="complete">Delivered</);
  assert.doesNotMatch(APP, /Run diagnosis →|New diagnosis<\/b>|>\+ New diagnosis|Run a diagnosis →|>Go to Run</);
  assert.match(APP, /Run full scan →<\/button>/);
  for (const id of S.BUNDLE_ORDER) assert.notEqual(S.bundleDisplayName(id), id, `${id} has a display name`);
  assert.equal(S.bundleDisplayName('saas-tenancy', 'SaaS tenancy'), 'SaaS tenancy', 'a derived bundle keeps its area title');
  assert.equal(S.bundleDisplayName('recsys-mle', 'Recommendation quality'), 'MLE / Recsys', 'the map wins over the per-report title');
  assert.match(APP, /var BUNDLES=BUNDLE_ORDER\.map\(function\(k\)\{ return \{key:k,label:bundleDisplayName\(k\)\}; \}\);/);
  // The Run output's area entries come from reportGuide, which names them through the same map.
  assert.match(APP, /return \(typeof bundleDisplayName==='function'\)\?bundleDisplayName\(id,t\)/);
  assert.match(APP, /label:'Area · '\+nm/);
});

test('No codenames / internals in user-facing copy', () => {
  assert.equal(S.friendlySourceDetail('GitHub PAT · Secret Manager acme-gh-pat · resolved per run'), 'GitHub PAT · Secret Manager · resolved per run');
  assert.equal(S.friendlySourceDetail('BigQuery · SA key via Secret Manager (acme-bq-sa-key) · read-only'), 'BigQuery · SA key via Secret Manager · read-only');
  assert.equal(S.friendlySourceDetail('/data/uploads/t_1/accel-scope · 1 repo(s) · read-only'), '1 repo · read-only');
  assert.equal(S.friendlySourceDetail('2 public repo(s) · URL, no auth'), '2 public repos · URL, no auth', 'walkthrough: stored "(s)" details read as a real plural');
  assert.equal(S.friendlySourceDetail('1 public repo(s) · URL, no auth'), '1 public repo · URL, no auth');
  assert.equal(S.friendlySourceDetail('octocat · 12 repos · read-only'), 'octocat · 12 repos · read-only');
  assert.equal(S.sourceKindLabel('giturl'), 'public repos');
  assert.equal(S.sourceKindLabel('local'), 'local folders');
  for (const k of ['gcp', 'slack', 'box', 'claude']) assert.equal(S.sourceKindLabel(k), 'this source', `${k} is no longer a source kind`);
  assert.match(APP, /Disconnect '\+esc\(sourceKindLabel\(kind\)\)/);
  assert.doesNotMatch(APP, /accel-mini · one investigate agent|repowise index \+ cross-repo|>value-free<|<\/b> in engine|run an Accel-mini Ask/);
  assert.match(APP, /esc\(localFolderSub\(a\)\)/, 'uploaded folders show date + count, not the server path');
});

test('The Report Assistant overlays and its pill never floats over other screens', () => {
  assert.doesNotMatch(CSS_TEXT, /body\.cd-open\{padding-right/);
  assert.match(APP, /f\.style\.display=\(currentView\(\)==='report'\)\?'flex':'none';/);
  assert.match(APP, /if\(ctxR&&tgl\) ctxR\.insertBefore\(fab,tgl\);/);
  assert.match(CSS_TEXT, /\.ctx-right \.cdfab\{position:static;/);
});

test('Phone width — topbar collapses, nothing forces the page wider, report tabs scroll sideways', () => {
  const m720 = CSS_TEXT.slice(CSS_TEXT.lastIndexOf('@media (max-width:720px){'));
  assert.match(m720, /\.ctx-run,\.ctx-runstats,\.ctx-meta\{display:none!important;\}/);
  // Letting the right cluster shrink pushed the theme toggle 10px past 390px; the LEAD shrinks now.
  assert.match(m720, /\.ctx-lead\{flex:1 1 0;min-width:0;/, 'the title side absorbs the squeeze (it was flex:none → 422px document)');
  // Console polish: the left rail (and its phone collapse toggle) is gone; the report tabs scroll sideways instead.
  assert.match(CSS_TEXT, /\.report-tabs\{padding:0 12px;gap:8px;overflow-x:auto;/);
  assert.match(CSS_TEXT, /\.rtab\{[^}]*flex:none;white-space:nowrap;/, 'a tab never wraps');
  assert.doesNotMatch(APP, /rail-toggle|report-rail|rr-toggle/);
});

// WCAG relative-luminance contrast, computed from the SHIPPED token values.
function lum(hex: string) { const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function contrast(a: string, b: string) { const x = lum(a.replace('#', '')), y = lum(b.replace('#', '')); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function tokens(block: string) { const out: Record<string, string> = {}; for (const m of block.matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})/g)) out[m[1]] = m[2]; return out; }

test('Micro-label tokens meet 4.5:1 in both themes; dark Load button fixed; focus ring token', () => {
  const rootAt = CSS_TEXT.indexOf(':root{');
  const light = tokens(CSS_TEXT.slice(rootAt, CSS_TEXT.indexOf('}', rootAt)));
  const darkAt = CSS_TEXT.indexOf('[data-theme=dark]{');
  const dark = { ...light, ...tokens(CSS_TEXT.slice(darkAt, CSS_TEXT.indexOf('}', darkAt))) };
  for (const fg of ['muted', 'num', 'honey-link']) for (const bg of ['cream', 'cream-card', 'card2', 'honey-soft']) {
    assert.ok(contrast(light[fg], light[bg]) >= 4.5, `light --${fg} on --${bg}: ${contrast(light[fg], light[bg]).toFixed(2)}`);
  }
  for (const fg of ['muted', 'num', 'honey-link']) for (const bg of ['cream', 'cream-card', 'card2']) {
    assert.ok(contrast(dark[fg], dark[bg]) >= 4.5, `dark --${fg} on --${bg}: ${contrast(dark[fg], dark[bg]).toFixed(2)}`);
  }
  assert.ok(contrast(light['nav-muted'], light['nav-bg']) >= 4.5, 'sidebar micro-labels on the espresso rail');
  assert.ok(contrast(light['nav-muted'], '#0C0805') >= 4.5, 'sidebar micro-labels on the dark-theme rail');
  // the dark-theme honey buttons: their text is pinned to espresso (was the flipped light ink → 1.31:1)
  assert.match(CSS_TEXT, /\[data-theme=dark\] \.side-cta,[^{]*\{color:#3E261C;\}/);
  assert.ok(contrast('#3E261C', light.honey) >= 4.5);
  assert.match(CSS_TEXT, /--focus-ring:/);
  assert.match(CSS_TEXT, /:focus-visible\{outline:none;box-shadow:var\(--focus-ring\);\}/);
});

test('Memory provenance escapes the parts, then joins with the entity (no &amp;middot;)', () => {
  assert.doesNotMatch(APP, /esc\(\[p\.run_type,p\.run_id\]\.filter\(Boolean\)\.join\(' &middot; '\)\)/);
  assert.match(APP, /\[p\.run_type,p\.run_id\]\.filter\(Boolean\)\.map\(esc\)\.join\(' &middot; '\)/);
});

test('Every date uses the UI locale; old dates carry the year; relative then absolute', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  assert.equal(S.fmtDate('2026-09-14T12:00:00Z', now), 'Sep 14');
  assert.equal(S.fmtDate('2025-12-01T12:00:00Z', now), 'Dec 1, 2025');
  assert.equal(S.fmtDay('2026-08-02T12:00:00Z'), 'Aug 2, 2026');
  assert.match(S.fmtClock('2026-08-02T12:05:00Z'), /^\d{1,2}:05\s[AP]M$/);
  assert.equal(S.relTime(new Date(now - 2 * 86400000).toISOString(), now), '2d ago');
  assert.equal(S.relTime('2026-09-14T12:00:00Z', now), 'Sep 14', 'not the old year-less "9/14"');
  assert.equal(S.relTime('2025-09-01T12:00:00Z', now), 'Sep 1, 2025');
  assert.equal(S.relTime('', now), '');
  assert.doesNotMatch(APP, /toLocale(Date|Time)?String\(\)|toLocale(Date|Time)?String\(undefined/);
});

test('mdLite renders a safe subset and never passes raw HTML through', () => {
  assert.equal(S.mdLite('**bold** and *it* and _it2_ and `a_b`'), '<div class="md-p"><strong>bold</strong> and <em>it</em> and <em>it2</em> and <code class="md-code">a_b</code></div>');
  assert.equal(S.mdLite('keep snake_case_ids intact'), '<div class="md-p">keep snake_case_ids intact</div>');
  assert.equal(S.mdLite('`**not bold**`'), '<div class="md-p"><code class="md-code">**not bold**</code></div>');
  assert.equal(S.mdLite('- one\n- two'), '<ul class="md-ul"><li>one</li><li>two</li></ul>');
  assert.equal(S.mdLite('[docs](https://example.com/a?b=1&c=2)'), '<div class="md-p"><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></div>');
  assert.equal(S.mdLite('[x](javascript:alert(1))'), '<div class="md-p">[x](javascript:alert(1))</div>', 'only http(s) links');
  const xss = S.mdLite('<img src=x onerror=alert(1)> [a](https://e.com/"onmouseover="x)');
  assert.doesNotMatch(xss, /<img|"onmouseover/);
  assert.match(APP, /'<div class="mem-full-body md">'\+mdLite\(body\)/, 'Memory card bodies');
});

test('the Design Doc tab is gone: no nav item, panel, chooser option or API call', () => {
  assert.doesNotMatch(APP, /data-go="design"/);
  assert.doesNotMatch(APP, /data-panel="design"/);
  assert.doesNotMatch(APP, /choose-design|designBriefModal|\/api\/design/);
  assert.doesNotMatch(APP, /design_doc/);
  // A LEGACY design run (persisted before the removal) is still a library report, never a Full Scan.
  assert.equal(S.libKindOf({ kind: 'design' }), 'design');
});

test('Report library search + kind filter; the count is labeled', () => {
  const runs = [
    { id: 'rs_1', kind: 'ask', targetName: 'cold start', question: 'How is cold-start defined?' },
    { id: 'rs_2', targetName: 'accel-scope', renamed: 'Self audit' },
    { id: 'rs_3', kind: 'design', targetName: 'memory system' },
  ];
  const ids = (xs: { id: string }[]) => xs.map((r) => r.id);
  assert.deepEqual(ids(S.filterLibraryRuns(runs, '', 'all')), ['rs_1', 'rs_2', 'rs_3']);
  assert.deepEqual(ids(S.filterLibraryRuns(runs, 'SELF', 'all')), ['rs_2']);
  assert.deepEqual(ids(S.filterLibraryRuns(runs, 'cold-start', 'ask')), ['rs_1']);
  assert.deepEqual(ids(S.filterLibraryRuns(runs, '', 'scan')), ['rs_2']);
  assert.equal(S.findingsLabel(18), '18 findings');
  assert.equal(S.findingsLabel(1), '1 finding');
  assert.equal(S.findingsLabel(null), '');
  assert.match(APP, /id="libSearch" type="search"/);
  assert.match(APP, /data-act="lib-kind" data-kind="/);
});

test('Skip link to main content; ✎ is a real Rename button', () => {
  assert.match(APP, /<a class="skip-link" href="#mainContent" data-act="skip-main">Skip to main content<\/a>\s*<aside class="sidebar">/);
  assert.match(APP, /<div class="stage" id="mainContent" tabindex="-1">/);
  assert.doesNotMatch(APP, /<span class="run-title-pencil"/);
  assert.equal((APP.match(/<button type="button" class="run-title-pencil"[^>]*aria-label="Rename"/g) || []).length, 2, 'run history card + report library card');
  assert.doesNotMatch(APP, /<button class="run-card '\+\(r\.id===state\.activeRunId/, 'the rename button is not nested in a <button>');
  // EVERY ✎ button (incl. the Full Scan / Quick Ask hero rd-rename controls) is named "Rename", not by its glyph.
  const pencils = APP.match(/<button\b[^>]*>✎<\/button>/g) || [];
  assert.ok(pencils.length >= 4, `expected ≥4 ✎ buttons, saw ${pencils.length}`);

  for (const b of pencils) { assert.match(b, /aria-label="Rename"/, b); assert.match(b, /type="button"/, b); }
});

test('shell helpers: esc still escapes the four HTML-significant characters', () => {
  assert.equal(S.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

// ── UI fixes ─────────────────────────────────────────────────────────────────────────────────
test('A link URL with _underscores_ is not rewritten by the italic rule; the link text still is', () => {
  assert.equal(S.mdLite('- item [docs](https://example.com/docs/_private_/x)'), '<ul class="md-ul"><li>item <a href="https://example.com/docs/_private_/x" target="_blank" rel="noopener noreferrer">docs</a></li></ul>');
  assert.equal(S.mdLite('[_see_ **this**](https://e.com/a_b_c)'), '<div class="md-p"><a href="https://e.com/a_b_c" target="_blank" rel="noopener noreferrer"><em>see</em> <strong>this</strong></a></div>');
});

test('Public-URL and uploaded-folder source chips have real nouns (not "items")', () => {
  assert.equal(H.srcChipCount('giturl', 0, 3), '0 / 3 repos');
  assert.equal(H.srcChipCount('local', 2, 3), '2 / 3 folders');
  assert.match(APP, /esc\(srcChipCount\(s\.kind,sel,tot\)\)/);
});

test('A source chip with exactly one repo/folder uses the singular noun', () => {
  assert.equal(H.srcChipCount('local', 0, 1), '0 / 1 folder');
  assert.equal(H.srcChipCount('giturl', 0, 1), '0 / 1 repo');
  assert.equal(H.srcChipCount('github', 1, 1), '1 / 1 repo');
  assert.equal(H.srcChipCount('analytics', 0, 0), '0 / 0 datasets');
  assert.equal(H.srcChipCount('mystery', 1, 1), '1 / 1 item');
  assert.equal(H.srcChipCount('mystery', 1, 2), '1 / 2 items');
});

test('A kind filter with no reports says so; a search that matches nothing says that', () => {
  assert.equal(S.libraryEmptyText({ trash: true, total: 3 }), 'Trash is empty.');
  assert.equal(S.libraryEmptyText({ total: 0 }), 'No finished reports yet — run a Quick Ask or a full scan.');
  assert.equal(S.libraryEmptyText({ total: 2, query: '', kind: 'ask', kindLabel: 'Quick Ask' }), 'No Quick Ask reports yet.');
  assert.equal(S.libraryEmptyText({ total: 2, query: 'foo', kind: 'all' }), 'No reports match this search.');
  assert.equal(S.libraryEmptyText({ total: 2, query: 'foo', kind: 'ask', kindLabel: 'Quick Ask' }), 'No Quick Ask reports match this search.');
});

test('Removing an uploaded folder asks first and is danger-styled', () => {
  assert.match(S.actionConfirmText('remove-folder', { title: 'tinyproj' }), /^Remove the folder "tinyproj" from this workspace\?\n\n.*cannot be undone/s);
  assert.match(APP, /function localRemove\(p,label\)\{ if\(!confirm\(actionConfirmText\('remove-folder'/);
  assert.match(APP, /data-act="local-remove"[^>]*color:var\(--crit\)/);
});

test('The + New chooser describes Full Scan by the app run mode', () => {
  assert.match(renderApp({ runMode: 'agentic' }), /agentic · 8-stage · resumable from checkpoints · read-only/);
  assert.match(renderApp({ runMode: 'agentic' }), /Audit the selected code end-to-end: an expert team per area poses and measures problems, then writes a Leadership brief \+ an Execution report\./);
  const det = renderApp({ runMode: 'deterministic' });
  assert.doesNotMatch(det, /agentic · 8-stage/);
  assert.match(det, /deterministic · evidence only · no agents/);
});

test('Event times use the 12-hour console clock; a synthesized done keeps the last backend time; no fixed report time zone', () => {
  assert.match(S.fmtEventTime(Date.parse('2026-09-25T20:24:52Z')), /^\d{1,2}:24:52\s[AP]M$/);
  assert.equal(S.fmtEventTime(null), '');
  assert.equal(S.lastEventTime([{ t: 1000 }, { t: 2000 }, { t: null }]), 2000);
  assert.equal(S.lastEventTime([{ t: null }]), null);
  assert.doesNotMatch(APP, /America\/Los_Angeles/);
  assert.match(APP, /parseRunEvent\('done · '[^\n]*state\.detailEvents\.length,lastEventTime\(state\.detailEvents\)\)/);
});

test('A deterministic full scan gets a 2-node pipeline, a 2-stage topbar and Scan/Report event labels', () => {
  const done = { mode: 'deterministic', status: 'complete', findings: 3 };
  assert.equal(H.isDeterministicRun(done), true);
  assert.equal(H.isDeterministicRun({ mode: 'agentic', status: 'complete' }), false);
  assert.equal(H.isDeterministicRun({ mode: 'deterministic', kind: 'ask', status: 'complete' }), false);
  assert.equal(H.isDeterministicRun({ mode: 'deterministic', status: 'config' }), false, 'the config explainer stays the agentic illustration');
  const p = H.detPipeline(done);
  assert.deepEqual(p.steps.map((s: { st: string }) => s.st), ['done', 'done']);
  assert.equal(p.total, 2); assert.equal(p.label, 'Internal report');
  assert.match(p.steps[1].sub, /^3 findings · deterministic$/);
  assert.equal(H.detPipeline({ mode: 'deterministic', status: 'running' }).label, 'Evidence scan');
  assert.equal(H.detEventStage('done · 3 findings'), 'Report');
  assert.equal(H.detEventStage('cloning octocat/Hello-World'), 'Scan');
  assert.match(APP, /if\(isDeterministicRun\(run\)\)\{   \/\/ The deterministic pipeline is two nodes/);
});

test('390px topbar keeps its right cluster, the source popover is in flow, micro-label tokens meet AA', () => {
  assert.match(APP, /\.ctx-right\{flex:0 0 auto;gap:6px;\}/, 'the right cluster no longer shrinks past its content at phone width');
  assert.doesNotMatch(APP, /\.userchip|\.side-org/, 'no user chip / org panel CSS left');
  assert.match(APP, /\.report-toggle \.rt-meta\{margin-left:0;flex:1 1 0;\}/, 'the reading-room id · date: one ellipsized line (base rule: min-width:0 + ellipsis), never overflowing');
  assert.match(APP, /\.report-toggle \.rt-meta\{font-size:12px;color:var\(--muted\);margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\}/);
  assert.match(APP, /\.report-toggle \.rt-kind\{display:none;\}/, 'phone: the kind label is dropped (the active tab names it)');
  assert.match(APP, /\.cfg-srcdd-pop\{position:static;/, 'the popover pushes the bundle section down instead of covering the radios');
  assert.match(APP, /cfg-srcdd cfg-srcdd-panel/);
  assert.match(APP, /--ok:#256B46;/, 'complete / connected badges: 5.39:1 on --ok-soft (was 4.21)');
  assert.match(APP, /\.mem-stat \.k\.warn\{color:var\(--high-ink\);\}/);
  assert.match(APP, /\[data-theme=dark\] \.cfg-radio\.on \.cfg-radio-sub\{color:var\(--ink2\);\}/);
  assert.doesNotMatch(APP, /opacity:\.5;font-size:1[12]px">✎/, 'no half-opacity rename pencils');
  assert.doesNotMatch(APP, /\.rd-rename\{[^}]*opacity:\.65/);
});

// Report reading guide — READING_HELPERS_JS is the exact block CLIENT interpolates (after SHELL_HELPERS_JS, whose
// bundleDisplayName it uses), evaluated here with `new Function`.
const G = new Function(`${SHELL_HELPERS_JS}\n${READING_HELPERS_JS}; return { readMinutes, reportGuide, reportFrameSrc, accelOpenLinkAllowed, stripWorkspacePath };`)() as Record<string, AnyFn>;

test('stripWorkspacePath (ky test run): event lines drop the ephemeral workspace prefix on Windows and POSIX', () => {
  assert.equal(G.stripWorkspacePath(String.raw`⚠ C:\Users\D\AppData\Local\Temp\theresa-org-MLgmMR\ky: mining failed`), '⚠ ky: mining failed');
  assert.equal(G.stripWorkspacePath('read /tmp/theresa-org-ab12/ky/source/core/Ky.ts'), 'read ky/source/core/Ky.ts');
  assert.equal(G.stripWorkspacePath('workspace /tmp/theresa-org-ab12 ready'), 'workspace  ready');
  assert.equal(G.stripWorkspacePath('plain ky/source/index.ts:12'), 'plain ky/source/index.ts:12');
  assert.equal(G.stripWorkspacePath(null), '');
});

test('small UI fixes (ky test run): zero memory tallies, older-build badge, no duplicated giturl copy', () => {
  const html = renderApp();
  assert.match(html, /Not saved to memory — this run did not write memory/);
  assert.doesNotMatch(html, /Not saved to memory for this run\./, 'that line lived in the reading-room rail memory card (removed by the console polish)');
  assert.match(html, /older build · reusable/);
  assert.doesNotMatch(html, /⚠ code changed/);
  assert.equal((html.match(/no token needed/gi) || []).length, 1, 'the giturl drawer says it once');
  assert.match(html, /stripWorkspacePath\(e\.msg\)/);
});
type GuideEntry = { kind: string; key: string; label: string; line: string; frame: boolean; recommended?: boolean; bundleId?: string };
const guide = (run: unknown) => G.reportGuide(run) as GuideEntry[];

test('Read time is words / 220 wpm, rounded, at least 1 minute; unknown size → omitted', () => {
  assert.equal(G.readMinutes(1100), 5);
  assert.equal(G.readMinutes(1430), 7, '6.5 rounds up');
  assert.equal(G.readMinutes(30), 1, 'never "~0 min"');
  for (const v of [undefined, null, 0, -5, 'abc', NaN, Infinity]) assert.equal(G.readMinutes(v), null);
});

test('Two-report model: a Full Scan offers exactly Leadership + Execution; other work types keep their lists', () => {
  // An agentic Full Scan — even an OLD one that still has combined / area / provenance files — offers only the two reports.
  const full = { id: 'rs_1', kind: 'org', mode: 'agentic', status: 'complete', findings: 7, leadership: true, combined: true, provenance: true, hasTrace: true, hasAudit: true,
    bundleReports: [{ id: 'baseline', title: 'Data trust floor' }], reportWords: { internal: 'x' } };
  const g = guide(full);
  assert.deepEqual(g.map((e) => e.kind), ['leadership', 'internal']);
  assert.equal(g.filter((e) => e.recommended).length, 1);
  assert.equal(g[0].recommended, true);
  assert.equal(g[0].line, 'Decision makers · what to act on first · ~5 min');
  assert.equal(g[1].label, 'Execution report');
  assert.equal(g[1].line, 'Engineers & coding agents · fix · done when · how to verify', 'no read time when the size is unknown / invalid');
  assert.ok(g.every((e) => e.frame), 'both open in the reading room');
  assert.equal(guide({ ...full, reportWords: { leadership: 2200 } })[0].line, 'Decision makers · what to act on first · ~10 min', 'a known leadership size replaces the ~5 default');
  const noLead = guide({ id: 'rs_2', kind: 'org', mode: 'agentic', findings: 1 });
  assert.deepEqual(noLead.map((e) => e.kind), ['internal']); assert.equal(noLead[0].recommended, true);
  const det = guide({ id: 'rs_3', kind: 'org', mode: 'deterministic', findings: 0 });
  assert.equal(det[0].label, 'Detailed report', 'a deterministic scan has no Execution model');

  // Rec audit keeps its list (leadership + detailed + REMEDIATION.md); Quick Ask unchanged.
  const audit = guide({ id: 'a_1', kind: 'audit', leadership: true, findings: 2, hasTrace: true });
  assert.deepEqual(audit.map((e) => e.kind), ['leadership', 'internal', 'remediation', 'trace']);
  const ask = guide({ id: 'q_1', kind: 'ask', workItems: true });
  assert.deepEqual(ask.map((e) => e.kind), ['internal', 'workitems'], 'no REMEDIATION.md entry for a Quick Ask');
  assert.equal(ask[0].label, 'Answer');
  // A LEGACY Design Doc run (the tab was removed) still opens its saved report — no plan.md entry, no REMEDIATION.md.
  const legacyDesign = guide({ id: 'dd_1', kind: 'design', status: 'complete', hasPlan: true });
  assert.deepEqual(legacyDesign.map((e) => e.kind), ['internal']);
  assert.equal(legacyDesign[0].label, 'Design doc (legacy)');
});

test('polish: "Open report" opens the Start-here report (Leadership for a Full Scan), named buttons keep their kind', () => {
  const K = new Function(`${SHELL_HELPERS_JS}\n${READING_HELPERS_JS}; return { startHereKind };`)() as Record<string, AnyFn>;
  assert.equal(K.startHereKind({ kind: 'org', mode: 'agentic', leadership: true }), 'leadership');
  assert.equal(K.startHereKind({ kind: 'org', mode: 'agentic' }), 'internal', 'no Leadership file → Execution');
  assert.equal(K.startHereKind({ kind: 'audit', combined: true }), 'combined');
  assert.equal(K.startHereKind({ kind: 'ask', workItems: true }), 'internal', 'a Quick Ask opens its answer');
  assert.equal(K.startHereKind(null), 'internal');
  assert.match(APP, /function openReport\(id\)\{ var k=startHereKind\(runById\(id\)\);/);
  assert.doesNotMatch(APP, /class="btn ghost openrep"[^>]*>Open '\+esc\(internalReportLabel/, 'a button naming the Execution report opens Execution (data-rk), not the Start-here pick');
});

test('polish: the New Full Scan "how a full scan runs" graph is a blank template (no state from an earlier run)', () => {
  assert.match(APP, /timelineHtml\(\{status:'config'\},\{\},-1\)/, 'no stage counts passed in');
  assert.match(APP, /function nodeSt\(k\)\{ return isPrev\?'queued':nodeStatus\(k,run,curIdx\); \}/);
  assert.match(APP, /function laneSt\(k,b\)\{ return isPrev\?'queued':laneNodeStatus\(k,b,run\); \}/);
  assert.match(APP, /var rk=isPrev\?'':laneReuseKind\(/, 'no reused / Change tag on the template');
  assert.match(APP, /\(isPrev\?'':'<span class="g-lane2-ct"/, 'no per-lane event counts');
  assert.match(APP, /\(isPrev\?'<span class="g-inchip">findings<\/span>'/, 'no findings count');
});

test('polish: plain labels — Code to scan, Data sources (both forms), a Connect intro line', () => {
  assert.match(APP, /<span class="eyebrow cfg-lab">Code to scan<\/span>/);
  assert.equal((APP.match(/>Data sources<\/span>/g) ?? []).length, 2, 'Full Scan + Quick Ask');
  assert.doesNotMatch(APP, /Artifacts to scan|Data planes &amp; exec boxes|eval machine/);
  assert.match(APP, /<p class="cx-intro">Connect read-only sources: code \(GitHub, public URLs, local folders\) and data \(BigQuery, data MCPs, key-value stores\)\. Nothing here is ever modified\.<\/p>/);
});

test('polish: Full Scan + Quick Ask history cards lead with the run title; the id is secondary', () => {
  assert.match(APP, /var inner=titleCell   \/\/ polish/);
  assert.match(APP, /var inner='<span class="run-card-title lead" title="'\+esc\(runTitleBare\(r\)\)\+'">'/);
  assert.match(APP, /\.run-card-id\{[^}]*color:var\(--muted\)/);
});

test('polish: the repo picker hides an empty "Default · repos investigated to date" group', () => {
  assert.match(APP, /if\(defaults\.length\) html\+='<div style="font-size:10\.5px;[^']*'\+deflabel\+'<\/div>'/);
});

test('Quick Ask repo picker: nothing pre-ticked; every row is labelled by its own repo name', () => {
  // The "repos investigated to date" are listed but not ticked for an ask.
  assert.match(APP, /if\(!state\[ns\+'RepoSel'\]\)\{ state\[ns\+'RepoSel'\]=\{\}; \}/);
  assert.match(APP, /Repos · <b id="askRepoCount">0<\/b>/);
  // map(row) would hand row(fn, label, sub) the array index and the whole array.
  assert.doesNotMatch(APP, /\.map\(row\)/);
});

test('polish: the Checkpoints "older build" badge explains itself in plain words', () => {
  assert.match(APP, /<span class="sbadge" title="made by an earlier version of accel-scope — resuming still works; results may differ slightly">older build · reusable<\/span>/);
});

test('polish: Memory → Compare with fewer than two projects says so above the table (the table stays)', () => {
  const C = new Function(`${COMPARE_HELPERS_JS}; return { compareMatrixHtml };`)() as Record<string, AnyFn>;
  const row = { key: 'dep:npm/x', kind: 'dependency', keys: ['dep:npm/x'], cells: { p1: { summary: 'x@1', state: 'active', key: 'dep:npm/x', measuredAt: '2026-10-01' } } };
  const one = C.compareMatrixHtml({ rows: [row], projects: [{ projectId: 'p1', name: 'acme/app' }], kinds: ['dependency'] }) as string;
  assert.match(one, /<p class="cmp-single" role="note">Compare needs at least two projects; scan another repo to see differences\.<\/p>/);
  assert.match(one, /<table class="cmp-table">/, 'the single column is still shown for inspection');
  const two = C.compareMatrixHtml({ rows: [row], projects: [{ projectId: 'p1', name: 'a' }, { projectId: 'p2', name: 'b' }], kinds: [] }) as string;
  assert.doesNotMatch(two, /cmp-single/);
});

test('boot: no login — the app starts straight away; the key inputs sit in a form (Enter saves)', () => {
  assert.match(APP, /selectSource\('github'\);\s*startApp\(\);\s*\}\)\(\);/);
  assert.match(APP, /function startApp\(\)\{ showBoot\(\);[\s\S]{0,400}loadState\(\)\.then\(hideBoot,hideBoot\); loadSettings\(\); applyView\(currentView\(\)\);/);

  assert.match(APP, /'<form class="set-keys" id="'\+prefix\+'KeyForm" autocomplete="off" onsubmit="return false">'/);
  assert.match(APP, /f\.id==='setKeyForm'\|\|f\.id==='frKeyForm'\)\)\{ e\.preventDefault\(\); saveKeys\(/);
});

test('polish: on phones the reading-room tab row shows a scroll shadow while more tabs are off-screen', () => {
  assert.match(APP, /\.report-tabs\{padding:0 12px;gap:8px;overflow-x:auto;scrollbar-width:none;\s*background:linear-gradient\(to left,var\(--cream-card\) 45%,rgba\(0,0,0,0\)\) right center\/34px 100% no-repeat local,/);
});

test('Every reading-room kind maps to its report route (the "Open in new tab" target)', () => {
  assert.equal(G.reportFrameSrc('rs_1', 'internal'), '/api/runs/rs_1/report');
  assert.equal(G.reportFrameSrc('rs_1', 'leadership'), '/api/runs/rs_1/leadership');
  assert.equal(G.reportFrameSrc('rs_1', 'workitems'), '/api/runs/rs_1/workitems');
  assert.equal(G.reportFrameSrc('rs_1', 'combined'), '/api/runs/rs_1/combined');
  assert.equal(G.reportFrameSrc('rs_1', 'provenance'), '/api/runs/rs_1/provenance');
  assert.equal(G.reportFrameSrc('rs 1', 'bundle', 'a/b'), '/api/runs/rs%201/bundle/a%2Fb');
});

test('Run output + report tabs use the guide; tabs for every kind; labelled loading; open in new tab', () => {
  assert.ok(APP.includes(READING_HELPERS_JS.trim()), 'the client embeds the tested helper block verbatim');
  assert.match(APP, /var guide=reportGuide\(run\);/, 'Run output renders the Start-here guide');
  assert.match(APP, /<span class="sg-tag">Start here<\/span>/);
  // Console polish: the reading room's report switch is a TAB row above the frame (the left rail — run brief,
  // Read nav, reusable-method card — is gone); the tabs are the guide's frame entries, the recommended one badged.
  assert.match(APP, /var tabs=guide\.filter\(function\(e\)\{ return e\.frame; \}\)/, 'the tabs are the guide');
  assert.match(APP, /<span class="rtab-rec">Start here<\/span>/);
  assert.match(APP, /role="tab" '\+guideOpenAttr\(run,e\)/, 'a tab opens through report-open-art (keeps ?run=&kind= in sync)');
  assert.match(APP, /<nav class="report-tabs" id="reportTabs"/);
  assert.doesNotMatch(APP, /reportRailQuestion|reportRailMemory|Reusable method learned<\/h4>/, 'no rail brief / memory card');
  assert.match(APP, /id="reportLoading" role="status" aria-live="polite" hidden><div class="rl-lab">Loading report…<\/div><div class="rl-sk h">/);
  assert.match(APP, /class="rt-newtab" href="'\+esc\(src\)\+'" target="_blank" rel="noopener"/);
  assert.match(APP, /var f=swapReportFrame\(want,true\);/, 'every kind opens through the one reading-room opener');
});

// Click path: the console opens only a commit-pinned GitHub blob permalink into one of the viewed run's own repos.
test('accelOpenLinkAllowed: only commit-pinned blob permalinks into the run\'s own repos', () => {
  const sha = 'a'.repeat(40);
  const run = { repoFilter: ['Acme/api'], giturlFilter: ['octocat/Hello-World'] };
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/src/a.ts#L3-L9`, run), true);   // case-insensitive owner/repo
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/octocat/Hello-World/blob/${sha}/README`, run), true);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/evil/x/blob/${sha}/a.ts`, run), false);           // not this run's repo
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/main/a.ts`, run), false);           // not commit-pinned
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/a.ts?x=secret`, run), false); // no query strings
  assert.equal(G.accelOpenLinkAllowed(`https://evil.com/acme/api/blob/${sha}/a.ts`, run), false);
  assert.equal(G.accelOpenLinkAllowed(`javascript:alert(1)`, run), false);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/a.ts`, undefined), false);
  // report scope: the repo root + its commit-pinned tree, same repo check; scopeRepos = a Quick Ask's / Rec audit's repos
  assert.equal(G.accelOpenLinkAllowed('https://github.com/acme/api', run), true);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/tree/${sha}`, run), true);
  assert.equal(G.accelOpenLinkAllowed('https://github.com/acme/api/tree/main', run), false);
  assert.equal(G.accelOpenLinkAllowed('https://github.com/evil/x', run), false);
  assert.equal(G.accelOpenLinkAllowed('https://github.com/acme/ask-repo', { scopeRepos: ['acme/ask-repo'] }), true);
  assert.equal(G.accelOpenLinkAllowed('https://github.com/acme/api/../evil', run), false);
  // Non-normal URLs collapse in the browser and could walk out of the allowed owner/repo prefix.
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/../../../evil/x/blob/${sha}/a.ts`, run), false);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/%2e%2e/%2e%2e/a.ts`, run), false);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/./a.ts`, run), false);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/a\\..\\b.ts`, run), false);
  assert.equal(G.accelOpenLinkAllowed(`https://github.com/acme/api/blob/${sha}/src/a.min.js#L2`, run), true);  // dots inside a name are fine
});

// Test-run findings (sindresorhus/ky, 2026-09-27) — regressions pinned at the rendered-page level.
test('test-run fixes: dropdown rows count as inside clicks; reports node is status-driven; honest progress; copy', () => {
  const html = renderApp({ runMode: 'agentic' });
  // the in-flow source popover (.cfg-srcdd-pop) is NOT an outside click — ticking a repo must not close the list
  assert.match(html, /el\.closest\('\.cfg-srcdd'\)\|\|el\.closest\('\.cfg-srcdd-pop'\)/);
  // the compact Reports node carries the pipeline status, never a hard-coded honey highlight
  assert.doesNotMatch(html, /class="g-tnode hi'/);
  assert.match(html, /var reports='<div class="g-tnode '\+rSt/);
  // progress = completed stages; a failed run shows no invented %
  assert.doesNotMatch(html, /if\(r\.status==='error'\) return 58;/);
  assert.match(html, /stageIdx\(latestStage\(\)\)\/RUN_STAGES\.length/);
  assert.match(html, /function progressLabel\(r\)/);
  // positioning copy + readable source monograms (no '··' for the Data MCPs row)
  assert.doesNotMatch(html, /self-serve console/);
  assert.match(html, /mcp:'MCP'/);
});

// ── Quick Ask gets the same explicit per-run plane / box picker as the Full Scan form ─────────────────────────
const P = new Function(`${SHELL_HELPERS_JS}\n${SCAN_FORM_HELPERS_JS}; return { planeChoices, planePickerHtml, filterEventRows, eventFilterChip };`)() as Record<string, AnyFn>;
test('The shared plane picker renders nothing ticked by default and namespaces its data-act per form', () => {
  const pc = P.planeChoices([{ id: 'wh', kind: 'warehouse', name: 'BQ' }, { id: 'bx', kind: 'box', boxes: [{ id: 'b1', label: 'eval-a' }] }, { id: 'gh', kind: 'github' }]);
  const ask = P.planePickerHtml(pc, {}, 'ask');
  assert.match(ask, /data-act="askplane-pick" data-id="wh"/);
  assert.doesNotMatch(ask, /box-pick|b1/, 'no exec boxes');
  assert.doesNotMatch(ask, /aria-checked="true"/, 'nothing pre-ticked');
  const scan = P.planePickerHtml(pc, { wh: true }, '');
  assert.match(scan, /data-act="plane-pick" data-id="wh" role="checkbox" tabindex="0" aria-checked="true"/);
  assert.match(P.planePickerHtml({ planes: [] }, {}, 'ask'), /None connected/);
});
test('The Ask compose hosts the picker and POSTs planeFilter (no boxFilter)', () => {
  const html = renderApp();
  assert.match(html, /id="askPlaneBox"/);
  assert.match(html, /api\('\/api\/ask',\{method:'POST',body:\{[^}]*planeFilter:_apf\.planeFilter\}\}/);
});

// ── UI-3/6: Rec audit runs are titled / pilled as Rec audit; a bare title exists for places that show the kind ──────
test('UI-3/6: runTitle has an audit branch; runTitleBare drops the kind prefix', () => {
  assert.equal(H.runTitle({ kind: 'audit', targetName: 'ranking / data-trust audit' }), 'Rec audit · ranking / data-trust audit');
  assert.equal(H.runTitleBare({ kind: 'audit', targetName: 'x' }), 'x');
  assert.equal(H.runTitleBare({ kind: 'ask', targetName: 'why?' }), 'why?');
  assert.equal(H.runTitleBare({ targetName: '1 repos' }), '1 repo');
  assert.equal(H.runTitleBare({ renamed: 'Mine', kind: 'ask', targetName: 'q' }), 'Mine');
  const html = renderApp();
  assert.match(html, /run\.kind==='audit'\?'REC AUDIT \(LEGACY\)'/);
  assert.match(html, /<span class="rt-title" title="'\+esc\(runTitleBare\(run\)\)\+'">'\+esc\(runTitleBare\(run\)\)/);   // console polish: ellipsized, full title in the tooltip
});

test('UI-5: the checkpoint line promises the same inputs, not a re-run "on CURRENT code"', () => {
  const html = renderApp();
  assert.match(html, /resume from any of them to re-run later stages with the same inputs/);
  assert.doesNotMatch(html, /on CURRENT code \(inputs pinned\)/);
});

test('UI-10: "Hide tool calls" drops only eventKind tool rows and says how many it hid', () => {
  const evs = [{ kind: 'run', idx: 1 }, { kind: 'tool', idx: 2 }, { kind: 'error', idx: 3 }, { kind: 'tool', idx: 4 }, { kind: 'reused', idx: 5 }];
  assert.deepEqual(P.filterEventRows(evs, false), { rows: evs, hidden: 0 });
  const on = P.filterEventRows(evs, true);
  assert.deepEqual(on.rows.map((e: { idx: number }) => e.idx), [1, 3, 5]);
  assert.equal(on.hidden, 2);
  assert.match(P.eventFilterChip(true, 2), /class="ev-filter on" data-act="toggle-hide-tools" aria-pressed="true"[^>]*>Hide tool calls · 2</);
  assert.match(P.eventFilterChip(false, 0), /aria-pressed="false"[^>]*>Hide tool calls</);
  const html = renderApp();
  assert.match(html, /a==='toggle-hide-tools'/);
  assert.match(html, /localStorage\.setItem\('theresa\.hideToolEvents'/);
});

test('UI-11: bundle lane counts read "N events" (pluralized) with a tooltip', () => {
  const html = renderApp();
  assert.match(html, /<span class="g-lane2-ct" title="Log events this bundle lane has emitted so far">'\+esc\(plural\(laneEvents\(b\.key\),'event'\)\)/);
  assert.doesNotMatch(html, /laneEvents\(b\.key\)\+' ev<\/span>/);
  assert.equal(H.plural(1, 'event'), '1 event');
  assert.equal(H.plural(55, 'event'), '55 events');
});

test('UI-12: checkpoint sub-text clamps to 2 lines with the full text as a tooltip', () => {
  const html = renderApp();
  assert.match(html, /\.ck-sub\{[^}]*-webkit-line-clamp:2;[^}]*overflow:hidden/);
  assert.match(html, /'<div class="ck-sub" title="'\+esc\(c\.detail\)\+'">'\+esc\(c\.detail\)/);
});

test('UI-13: the Report library always shows the total-spend cell (single user, no roles)', () => {
  const html = renderApp();
  assert.match(html, /\+cell\(hasSpend\?esc\(money\(spendTot\)\):'—','total spend'\)\+/);
  assert.doesNotMatch(html, /canSeeSpend|state\.role/);
});

test('UI-14: the memory version is a muted footer, not a headline stat', () => {
  const html = renderApp();
  assert.doesNotMatch(html, /<div class="k">memory version<\/div>/);
  assert.match(html, /var verFoot='<div class="mem-ver">memory version v'\+esc\(version\)/);
  assert.match(html, /\.mem-stats\{display:grid;grid-template-columns:repeat\(3,/);
});

test('UI-15: memory card footer spells out confidence / version', () => {
  const html = renderApp();
  assert.match(html, /foot\.push\('confidence '\+esc\(conf\)\)/);
  assert.match(html, /foot\.push\('version '\+esc\(ver\)\)/);
  assert.doesNotMatch(html, /foot\.push\('conf '\+/);
});

test('UI-16: a memory-history row links its run in-app and shows the actor', () => {
  const both = S.memEvMetaLine({ run_id: 'ak_1<x', actor: 'dana@example.com' });
  assert.match(both, /run <a class="mem-ev-runlink" href="\/run\?run=ak_1%3Cx" data-act="mem-open-run" data-id="ak_1&lt;x">ak_1&lt;x<\/a>/);
  assert.match(both, / &middot; by dana@example\.com<\/div>$/);
  assert.equal(S.memEvMetaLine({ actor: 'ops' }), '<div class="mem-ev-run">by ops</div>');
  assert.equal(S.memEvMetaLine({}), '');
  const html = renderApp();
  assert.match(html, /a==='mem-open-run'/);
});

test('UI-17: the two Quick Ask memory cards have distinct titles', () => {
  const html = renderApp();
  assert.match(html, /<h3>Pattern recognized<\/h3>/);
  assert.match(html, /<h3>Written to memory<\/h3>/);
  assert.doesNotMatch(html, /<h3>Memory<\/h3><span class="eyebrow">(pattern recognized|write-to-memory)/);
});

test('UI-18: no "published" badge (public links are gone); "superseded" explains itself', () => {
  const html = renderApp();
  assert.doesNotMatch(html, />published<\/span>|shareUrl|Publish standalone|Unpublish/);
  assert.match(html, /<span class="sbadge info" title="Replaced by a resumed child run[^"]*">superseded<\/span>/);
});

test('UI-19: the manual bundle picker has a Select all / none toggle', () => {
  const html = renderApp();
  assert.match(html, /data-act="bundles-all">'\+\(nBunSel===BUNDLES\.length\?'Select none':'Select all'\)/);
  assert.match(html, /a==='bundles-all'\)\{ if\(!state\.overrideBundles\) return;/);
});

test('UI-20: on /report the topbar shows only status + cost (no stage bar)', () => {
  const html = renderApp();
  assert.match(html, /if\(view==='report'\)\{ if\(rs\)\{ rs\.innerHTML='<span><b>'\+esc\(money\(_tr\.costUsd\)\)\+'<\/b> spend<\/span>'; \} return; \}\s*ti\.textContent=runTitle\(_tr\);/);
});

test('UI-21: Start here and the library share internalReportLabel; area chips show no raw bundle id', () => {
  const html = renderApp();
  assert.doesNotMatch(html, /Detailed report \(internal\)/);
  assert.doesNotMatch(html, /area-specific · '\+br\.id/);
  assert.equal((html.match(/label:internalReportLabel\(r\)/g) || []).length, 4, 'both reportGuide paths + both runReportArtifacts paths');
});

test('UI-22: the report iframe sandbox matches REPORT_CSP (no allow-popups; links go via postMessage)', () => {
  const html = renderApp();
  assert.match(html, /<iframe id="reportFrame" title="diagnostic report" sandbox="allow-scripts allow-downloads"/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-popups/);
  assert.match(html, /d\.type!=='accel-open-link'/, 'the console still opens validated evidence links itself');
});

// Incremental re-scan: the New Full Scan BASELINE line + the run page's note,
// evaluated from the SAME helper source the browser runs.
test('baselineLine: no baseline / loading / changed repos + estimate / full-rescan tick / forced full', () => {
  const B = new Function(`${SCAN_FORM_HELPERS_JS}; return { baselineLine, incrementalNote };`)() as Record<string, (...a: unknown[]) => any>;
  assert.equal(B.baselineLine(null, false).show, false);
  assert.match(B.baselineLine({ loading: true }, false).text, /checking/);
  const none = B.baselineLine({ baseline: null, reason: 'no earlier completed Full Scan of this exact target set in this org' }, false);
  assert.match(none.text, /^Baseline: none — no earlier completed Full Scan.*This run is a full scan\.$/); assert.equal(none.canFullRescan, false);
  const info = { baseline: { runId: 'rs_1', date: '2026-09-20', by: 'dana@acme.io', depth: 0 }, repos: { total: 4, changed: 3, files: 57, unknown: 0 }, estimate: { lowUsd: 4, highUsd: 6, fullUsd: 14 } };
  const bl = B.baselineLine(info, false);
  assert.equal(bl.text, 'Baseline: 2026-09-20 by dana · 3 of 4 repos changed (57 files) · est. $4.00–$6.00 instead of ~$14.00');
  assert.equal(bl.canFullRescan, true);
  assert.equal(B.baselineLine(info, true).text, 'Baseline: 2026-09-20 by dana · 3 of 4 repos changed (57 files) · full rescan (~$14.00)');
  assert.match(B.baselineLine({ ...info, full: 'a periodic full scan is due (the baseline chain is 4 incremental scans deep)', estimate: null }, false).text, /full scan — a periodic full scan is due/);
  assert.match(B.baselineLine({ ...info, repos: { total: 1, changed: null, files: null, unknown: 1 } }, false).text, /repo changes unknown/);
  assert.equal(B.baselineLine({ ...info, repos: { total: 1, changed: 0, files: 0, unknown: 0 } }, false).text.split(' · ')[1], '0 of 1 repo changed');
});

test('incrementalNote: unchanged / incremental (reused + why the rest re-ran) / full with a baseline / since counts', () => {
  const B = new Function(`${SCAN_FORM_HELPERS_JS}; return { incrementalNote };`)() as Record<string, (...a: unknown[]) => string[]>;
  assert.deepEqual(B.incrementalNote(undefined), []);
  assert.match(B.incrementalNote({ mode: 'unchanged', baselineRunId: 'rs_1', baselineAt: '2026-09-20T01:00:00Z', lanesReused: ['a'], lanesRerun: [] })[0], /^No changes since the scan of 2026-09-20 — reused its results/);
  const inc = B.incrementalNote({ mode: 'incremental', baselineRunId: 'rs_1', baselineAt: '2026-09-20T01:00:00Z', comprehend: 'reuse', lanesReused: ['appsec'], lanesRerun: [{ id: 'data-eng', reason: 'it read acme/app/src/p.ts, which changed' }], changedFiles: 2, since: { fixed: 1, new: 2, persisting: 5, changed: 0, unchecked: 0 } });
  assert.equal(inc[0], 'Incremental re-scan vs the scan of 2026-09-20 — 1 of 2 lanes reused (appsec) · Comprehend reused · 2 changed files');
  assert.equal(inc[1], 're-ran data-eng — it read acme/app/src/p.ts, which changed');
  assert.equal(inc[2], 'Since last scan: 1 fixed · 2 new · 5 persisting');
  assert.match(B.incrementalNote({ mode: 'full', reason: 'full scan — Full rescan requested', baselineRunId: 'rs_1', lanesReused: [], lanesRerun: [] })[0], /^Full scan — Full rescan requested \(the previous scan was used for the comparison only\)$/);
  // DELTA lanes: counted in the lane total, named, one line each with the re-check count.
  const dl = B.incrementalNote({ mode: 'incremental', baselineRunId: 'rs_1', comprehend: 'reuse', lanesReused: [], lanesRerun: [], lanesDelta: [{ id: 'swe-arch', reason: '1 of 12 read file(s) changed (sindresorhus/p-limit/.github/security.md)', files: 1, rechecks: 0 }, { id: 'appsec', reason: '1 of 9 read file(s) changed (x)', files: 1, rechecks: 1 }], changedFiles: 1 });
  assert.equal(dl[0], 'Incremental re-scan vs the previous scan — 0 of 2 lanes reused · 2 re-checked only what changed (swe-arch, appsec) · Comprehend reused · 1 changed file');
  assert.equal(dl[1], 'swe-arch — re-checked 1 changed file of 12 it read (sindresorhus/p-limit/.github/security.md)');
  assert.equal(dl[2], 'appsec — re-checked 1 changed file of 9 it read (x) · 1 earlier finding re-checked');
});

test('polish: the incremental note uses the graph display names and explains a Change lane in plain words', () => {
  const B = new Function(`${SHELL_HELPERS_JS}\n${SCAN_FORM_HELPERS_JS}; return { incrementalNote, laneReuseTag };`)() as Record<string, (...a: unknown[]) => any>;
  const out = B.incrementalNote({ mode: 'incremental', baselineRunId: 'rs_1', comprehend: 'reuse', lanesReused: ['appsec'], lanesRerun: [{ id: 'swe-arch', reason: 'it read x' }], lanesNotActivated: [{ id: 'data-eng', reason: 'r' }], lanesDelta: [{ id: 'product-logic', reason: '1 of 607 read file(s) changed', files: 1, rechecks: 0 }, { id: 'release-eng', reason: 'odd reason', files: 2 }], changedFiles: 1 }) as string[];
  const name = (id: string) => S.bundleDisplayName(id) as string;
  assert.ok(name('product-logic') !== 'product-logic', 'the map has a display name');
  assert.ok(out[0].includes(`reused (${name('appsec')})`) && out[0].includes(`re-checked only what changed (${name('product-logic')}, ${name('release-eng')})`) && out[0].includes(`not activated (${name('data-eng')})`));
  assert.ok(out.includes(`${name('product-logic')} — re-checked 1 changed file of 607 it read`));
  assert.ok(out.includes(`${name('release-eng')} — re-checked only the changed files — odd reason`));
  assert.ok(out.includes(`re-ran ${name('swe-arch')} — it read x`));
  const derived = B.incrementalNote({ mode: 'incremental', baselineRunId: 'rs_1', lanesReused: ['saas-tenancy'], lanesRerun: [] }) as string[];
  assert.match(derived[0], /reused \(SaaS tenancy\)/, 'an unmapped derived bundle id still reads as words');
  assert.ok(!out.join(' | ').match(/(^|[^a-z-])(product-logic|appsec|swe-arch|data-eng)([^a-z-]|$)/), 'no raw bundle ids');
  assert.match(B.laneReuseTag('reused', {}, 'a').title, /^reused: nothing it read changed — \$0/);
  assert.match(B.laneReuseTag('delta', { lanesDelta: [{ id: 'a', files: 1 }] }, 'a').title, /^Change: only the changed files were re-checked/);
});

// ── incremental re-scan UI ──────────────────────────────────────────────────────────────────────────────
test('incrementalNote names lanes Comprehend did not activate instead of "re-ran" them; since breakdown', () => {
  const B = new Function(`${SCAN_FORM_HELPERS_JS}; return { incrementalNote };`)() as Record<string, (...a: unknown[]) => string[]>;
  const out = B.incrementalNote({ mode: 'incremental', baselineRunId: 'rs_A', comprehend: 'rerun', comprehendWhy: 'the brief changed', lanesReused: ['analytics'], lanesRerun: [{ id: 'product-logic', reason: 'it read x, which changed' }], lanesNotActivated: [{ id: 'data-eng', reason: 'r' }, { id: 'api-stability', reason: 'r' }], changedFiles: 5, since: { fixed: 0, new: 0, persisting: 3, changed: 0, unchecked: 9, uncheckedWhy: { 'recheck-budget': 4, 'not-run': 5 } } });
  assert.equal(out[0], 'Incremental re-scan vs the previous scan — 1 of 2 lanes reused (analytics) · 2 not activated (data-eng, api-stability) · Comprehend re-ran (the brief changed) · 5 changed files');
  assert.ok(!out.some((l) => /^re-ran (data-eng|api-stability)/.test(l)), 'old: "re-ran data-eng" for a bundle that never ran');
  assert.ok(out.includes('not activated this time: data-eng — Comprehend did not pick it; its earlier findings read "not re-checked"'));
  assert.equal(out[out.length - 1], 'Since last scan: 0 fixed · 0 new · 3 persisting · 9 not counted as fixed (4 re-check skipped (budget) · 5 review not run)');
});

test('Lane cards reflect reused / delta / re-ran / new from run.incremental and the replay markers', () => {
  const B = new Function(`${SCAN_FORM_HELPERS_JS}; return { laneReuseKind, laneReuseTag };`)() as Record<string, (...a: unknown[]) => any>;
  const inc = { mode: 'incremental', lanesReused: ['analytics'], lanesDelta: [{ id: 'product-logic', reason: '2 of 40 read file(s) changed', files: 2, rechecks: 1 }], lanesRerun: [{ id: 'saas-tenancy', reason: 'it read p.json' }, { id: 'appsec', reason: 'not in the baseline — activated by this run’s Comprehend, so it runs fresh' }] };
  assert.deepEqual(['analytics', 'product-logic', 'saas-tenancy', 'appsec', 'other'].map((k) => B.laneReuseKind(inc, k, {})), ['reused', 'delta', 'rerun', 'new', '']);
  assert.equal(B.laneReuseKind({ mode: 'unchanged' }, 'x', {}), 'reused', 'run C: every lane replayed');
  assert.equal(B.laneReuseKind(undefined, 'x', { cached: true }), 'reused', 'a manual resume: the "⟳ lane reused" marker');
  assert.equal(B.laneReuseKind(undefined, 'x', { delta: true }), 'delta');
  assert.equal(B.laneReuseKind({ mode: 'full' }, 'x', {}), '');
  assert.deepEqual(B.laneReuseTag('delta', inc, 'product-logic').text, 'Change · 2 files');
  assert.equal(B.laneReuseTag('delta', inc, 'product-logic').bold, 'Change', 'console polish: the UI label is a bold "Change", no Δ glyph');
  { const t = B.laneReuseTag('delta', inc, 'product-logic'); assert.doesNotMatch(t.text + ' ' + t.title, /Δ|delta/i); }
  assert.equal(B.laneReuseTag('reused', inc, 'analytics').cls, 'cached');
  assert.match(B.laneReuseTag('rerun', inc, 'saas-tenancy').title, /it read p\.json/);
  assert.equal(B.laneReuseTag('', inc, 'x'), null);
  // The client parses the lane replay markers (they never contained "⟳ reused") and styles a delta lane.
  const html = renderApp();
  assert.ok(html.includes("raw.indexOf('⟳ lane reused')>=0") && html.includes("raw.indexOf('⟳ lane revived')>=0"));
  assert.match(html, /\.g-lane2\.delta\{/);
});

test('The live hero follows run.costUsd — polled while the run is live, terminal totals untouched', () => {
  const B = new Function(`${SCAN_FORM_HELPERS_JS}; return { liveSpendDue, mergeLiveSpend, spendInfo };`)() as Record<string, (...a: unknown[]) => any>;
  assert.equal(B.liveSpendDue(undefined, 1000, 5000), true);
  assert.equal(B.liveSpendDue(1000, 4000, 5000), false);
  assert.equal(B.liveSpendDue(1000, 6000, 5000), true);
  const run: Record<string, unknown> = { status: 'running', costUsd: null };
  assert.equal(B.spendInfo(run, 10).value, '—', 'the old state: nothing re-polled during the run');
  assert.equal(B.mergeLiveSpend(run, { costUsd: 3.21 }), true);
  assert.equal(B.spendInfo(run, 10).value, '$3.21');
  assert.equal(B.mergeLiveSpend(run, { costUsd: 3.21 }), false, 'unchanged → no re-render');
  assert.equal(B.mergeLiveSpend({ status: 'complete', costUsd: 8.93 }, { costUsd: 8.5 }), false, 'never overwrites a terminal total');
  assert.equal(B.mergeLiveSpend(run, { costUsd: null }), false);
  assert.ok(renderApp().includes('pollLiveSpend(id);'), 'the run stream polls the spend');
});

test('The baseline line says "full scan — <reason>", flags diverged history and an unavailable estimate', () => {
  const B = new Function(`${SCAN_FORM_HELPERS_JS}; return { baselineLine };`)() as Record<string, (...a: unknown[]) => any>;
  const b = { runId: 'rs_A', date: '2026-10-01', by: 'dana@example.com', depth: 0, fullUsd: 28.94 };
  assert.equal(B.baselineLine({ baseline: b, full: 'the brief / memory-recall / codeintel inputs changed since the baseline', repos: { total: 1, changed: 0, files: 0, unknown: 0 }, estimate: null }, false).text,
    'Baseline: 2026-10-01 by dana · 0 of 1 repo changed · full scan — the brief / memory-recall / codeintel inputs changed since the baseline (~$28.94)', 'old: "est. $0.22–$0.44"');
  assert.equal(B.baselineLine({ baseline: b, repos: { total: 1, changed: 1, files: 5, unknown: 0, diverged: true }, estimate: { lowUsd: 4.1, highUsd: 6.6, fullUsd: 28.94 } }, false).text,
    'Baseline: 2026-10-01 by dana · 1 of 1 repo changed (≤ 5 files, diverged history) · est. $4.10–$6.60 instead of ~$28.94');
  assert.match(B.baselineLine({ baseline: b, repos: { total: 1, changed: 1, files: null, unknown: 0 }, estimate: null, estimateNote: 'estimate unavailable — the changed file list could not be fetched' }, false).text, /· estimate unavailable — the changed file list could not be fetched$/);
});

// Quick Ask alignment — run scope is explicit: an ask with no repo ticked mounts NO code, and the compose form says so.
test('askScopeSummary: no repos ⇒ "code not mounted"; otherwise counts repos / folders / planes', () => {
  const A = new Function(`${SCAN_FORM_HELPERS_JS}; return { askScopeSummary };`)() as Record<string, AnyFn>;
  assert.match(A.askScopeSummary(0, 0, 0), /^No repos or folders selected — code not mounted \(data-only ask\) · no data sources\./);
  assert.match(A.askScopeSummary(0, 1, 0), /code not mounted.*· 1 data source\./);
  assert.match(A.askScopeSummary(2, 2, 0), /^2 repos cloned read-only · 2 data sources\./);
  assert.match(A.askScopeSummary(0, 0, 1), /^1 folder copied read-only · no data sources/);
  assert.match(A.askScopeSummary(1, 0, 2), /^1 repo cloned · 2 folders copied read-only/);
  assert.match(A.askScopeSummary(1, 0, 0, { recall: true, save: false }), /no data sources · memory recall on · save learnings off\. Read-only/);
});

test('askExtraGroups / askSplitSelection: public URL repos + uploaded folders are their own groups and fields', () => {
  const A = new Function(`${SCAN_FORM_HELPERS_JS}; return { askExtraGroups, askSplitSelection };`)() as Record<string, AnyFn>;
  const data = { public: ['umami-software/umami', 'org/a', 'umami-software/umami'], local: [{ id: 'loc:abc', name: 'notes', count: 2, uploadedAt: '2026-10-03T01:02:03Z' }, { id: '' }] };
  const g = A.askExtraGroups(data, ['org/a']);
  assert.deepEqual(g.public, ['umami-software/umami'], 'deduped, and a repo already listed among the org repos is not repeated');
  assert.deepEqual(g.local, [{ key: 'local:loc:abc', label: 'notes', sub: '2 files · 2026-10-03' }]);
  assert.deepEqual(A.askExtraGroups({}, []), { public: [], local: [] });
  assert.deepEqual(A.askSplitSelection(['umami-software/umami', 'local:loc:abc', 'local:loc:gone'], data), { repos: ['umami-software/umami'], localFolders: ['loc:abc'] }, 'a stale folder tick is dropped');
});

// Quick Ask run health (parity with the Full Scan): the ask detail shows the same degraded banner as the Full Scan run hero.
test('degradedBannerHtml: one escaped row per degraded stage; empty when healthy', () => {
  const B = new Function(`${SHELL_HELPERS_JS}\n${SCAN_FORM_HELPERS_JS}; return { degradedBannerHtml, degradedRows };`)() as Record<string, AnyFn>;
  assert.equal(B.degradedBannerHtml(B.degradedRows({}, null)), '');
  const html = B.degradedBannerHtml(B.degradedRows({ degraded: [{ stage: 'ask-translate', reason: 'translation unavailable <x>' }, { stage: 'budget', reason: 'exceeded cap by 5%' }] }, null));
  assert.match(html, /class="run-degraded"/);
  assert.match(html, /2 stages degraded/);
  // Polish: plain stage names; the raw row stays in the title tooltip for debugging.
  assert.match(html, /<li title="ask-translate: translation unavailable &lt;x&gt;"><b>Translation<\/b> — translation unavailable &lt;x&gt;<\/li>/);
  assert.match(html, /<b>Spend cap<\/b> — exceeded cap by 5%/);
});

test('polish: degraded banner never shows env-var names; an OpenAI key that is missing / rejected reads as a fallback', () => {
  const B = new Function(`${SHELL_HELPERS_JS}\n${SCAN_FORM_HELPERS_JS}; return { degradedBannerHtml, degradedRows, degradedStageLabel, plainDegradedReason };`)() as Record<string, AnyFn>;
  assert.equal(B.degradedStageLabel('leadership-writer'), 'Leadership writing');
  assert.equal(B.degradedStageLabel('report-redteam'), 'Report review');
  assert.equal(B.degradedStageLabel('org-facts'), 'Fact extraction');
  assert.equal(B.degradedStageLabel('html-qc'), 'Report quality check');
  assert.equal(B.degradedStageLabel('ask-translate'), 'Translation');
  assert.equal(B.degradedStageLabel('some-new_stage'), 'Some new stage', 'unknown ids become words');
  const fb = 'the OpenAI model was unavailable, so a fallback was used';
  assert.equal(B.plainDegradedReason('Leadership: red-team skipped (OPENAI_API_KEY not set) — report shipped un-reviewed'), `Leadership: red-team skipped (${fb}) — report shipped un-reviewed`);
  assert.equal(B.plainDegradedReason('OPENAI_API_KEY was rejected at boot (401) — codex/gpt stages ran degraded'), `${fb} — codex/gpt stages ran degraded`);
  assert.equal(B.plainDegradedReason('OpenAI writer failed: OpenAI auth failed (401) — check OPENAI_API_KEY — fell back to Claude'), `OpenAI writer failed: ${fb} — fell back to Claude`);
  assert.equal(B.plainDegradedReason('codex judge: HTTP 401 Unauthorized from OpenAI'), fb);
  assert.equal(B.plainDegradedReason('skipped — under THERESA_FACTS_USD left'), 'skipped — under a server setting left');
  const rows = B.degradedRows({ degraded: [{ stage: 'report-redteam', reason: 'red-team skipped (OPENAI_API_KEY not set)' }] }, false);
  const html = B.degradedBannerHtml(rows) as string;
  const visible = html.replace(/ title="[^"]*"/g, '');
  assert.doesNotMatch(visible, /OPENAI_API_KEY|[A-Z]+_[A-Z_]+/, 'no env-var name outside the tooltip');
  assert.match(visible, /<b>OpenAI model<\/b> — the OpenAI model was unavailable, so a fallback was used/);
  assert.match(html, /title="report-redteam: red-team skipped \(OPENAI_API_KEY not set\)"/, 'raw reason kept in the tooltip');
  assert.match(APP, /var degradedBanner=degradedBannerHtml\(dRows\);/, 'the Full Scan hero uses the same renderer');
});

test('Quick Ask plane picker lists only the kinds the ask mounts (pinned to planeSelection ASK_PLANE_KINDS)', async () => {
  const { ASK_PLANE_KINDS } = await import('./run/planeSelection.ts');
  const Q = new Function(`${SCAN_FORM_HELPERS_JS}; return { planeChoices, ASK_PLANE_KINDS };`)() as { planeChoices: AnyFn; ASK_PLANE_KINDS: string[] };
  assert.deepEqual([...Q.ASK_PLANE_KINDS].sort(), [...ASK_PLANE_KINDS].sort());
  const pc = Q.planeChoices([{ id: 'wh', kind: 'warehouse' }, { id: 'amp', kind: 'analytics' }, { id: 'kv', kind: 'keyvalue' }, { id: 'sl', kind: 'slack' }], Q.ASK_PLANE_KINDS);
  assert.deepEqual(pc.planes.map((p: { id: string }) => p.id), ['wh', 'kv']);
});

test('reading-room tabs: a tab switch pushes a history entry; initial load / library replaces; the active tab adds none', () => {
  const R = new Function(`${READING_HELPERS_JS}; return { reportHistoryOp };`)() as Record<string, AnyFn>;
  const a = '/report?run=rs_1&kind=leadership', b = '/report?run=rs_1&kind=internal';
  assert.equal(R.reportHistoryOp(a, b, true), 'push', 'tab switch → Back returns to the previous tab');
  assert.equal(R.reportHistoryOp('/report', a, false), 'replace', 'initial open keeps replaceState');
  assert.equal(R.reportHistoryOp(a, a, true), null, 're-clicking the active tab adds no entry');
  assert.equal(R.reportHistoryOp(a, a, false), null);
  const html = renderApp();
  // the flag is consumed at the top of syncReportUrl (even when it returns early) and drives push vs replace
  assert.match(html, /function syncReportUrl\(\)\{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*var tabPush=!!state\.reportTabPush; state\.reportTabPush=false;\s*if\(!state\.reportUrlApplied/);
  assert.match(html, /var op=reportHistoryOp\(location\.pathname\+location\.search,u,tabPush\);\s*if\(op==='push'\) history\.pushState\(null,'',u\); else if\(op==='replace'\) history\.replaceState\(null,'',u\);/);
  // only a click INSIDE the reading-room tab bar sets it (library cards keep replacing)
  assert.match(html, /a==='report-open-art'\)\{[^\n]*\n\s*state\.reportTabPush=!!\(t\.closest&&t\.closest\('#reportTabs'\)&&currentView\(\)==='report'&&state\.reportRunId\);/);
  // popstate on /report re-opens the report the URL names (restores the tab)
  assert.match(html, /addEventListener\('popstate',function\(\)\{[\s\S]{0,200}if\(currentView\(\)==='report'\)\{ if\(!applyReportUrl\(\)\)/);
});

test('reading-room iframe: re-pointed by swapping in a fresh clone, never by f.src= (no hidden-frame Back entries)', () => {
  const html = renderApp();
  assert.match(html, /function swapReportFrame\(src,show\)\{[\s\S]{0,200}var f=old\.cloneNode\(false\);[\s\S]{0,200}old\.parentNode\.replaceChild\(f,old\);/);
  assert.match(html, /var f=swapReportFrame\(want,true\);/, 'openInReadingRoom loads the report through the swap');
  assert.doesNotMatch(html, /\b(?:f|rf)\.src\s*=\s*(?:want|'about:blank')/, 'no in-place iframe re-navigation is left');
  assert.equal((html.match(/swapReportFrame\('',false\)/g) ?? []).length, 2, '← All reports + backToAllReports blank it the same way');
});

test('walkthrough copy: no dead "Run tab" pointer, plain Full Scan copy, explained ticks, honest empty states', () => {
  const APP = renderApp({ runMode: 'agentic' });
  assert.doesNotMatch(APP, /in the Run tab/, 'there is no "Run tab" — the sidebar says Full Scan / Quick Ask');
  assert.equal((APP.match(/pick which to scan in New Full Scan or Quick Ask\./gi) ?? []).length, 3);
  assert.match(APP, /First <b>Comprehend<\/b> classifies your system and picks the expert <b>bundles<\/b> \(areas such as Data Eng or Security\)/);
  // Polish: ONE name for the memory-write tick across Full Scan + Quick Ask (request fields unchanged: writeMemory).
  assert.match(APP, /id="orgWriteMemory"[^\n]*><span>Save learnings to memory <span style="color:var\(--muted\)">— after the run, durable facts it verified are added to your local memory — reviewable and revertable in Memory → History<\/span><\/span><\/label>/);
  assert.match(APP, /id="askWriteMemory"> Save learnings to memory<\/label>/);
  assert.match(APP, /<p class="hint" id="askSaveHint" hidden>Save learnings to memory: after the run, durable facts it verified/);
  assert.doesNotMatch(APP, /Draft memory from reports|Write learnings to memory/);
  assert.match(APP, /saveLearnings:state\.orgWriteMemory===true/, 'the Full Scan summary line states it');
  for (const id of ['orgMemoryRecall', 'orgSiblingRecall']) assert.match(APP, new RegExp(`id="${id}"[^\n]*?><span>`), `${id}: label text is ONE flex item (wraps under itself on a phone)`);
  assert.match(APP, /id="askUseMemory" checked> Recall memory<\/label>/, 'same term as the Full Scan tick');
  assert.match(APP, /<span>Recall memory <span/);
  assert.match(APP, /id="askScope" aria-label="Scope label \(optional\)" placeholder="Scope label \(optional\) — e\.g\./);
  assert.match(APP, /class="ask-empty-hint">No Quick Asks yet — <b>\+ New Quick Ask<\/b> asks one scoped question/);
  assert.match(APP, /data-act="mem-extract-report"[^>]*title="Paid — one model call/);
  assert.match(APP, /Memory fills when a run ticks &ldquo;Save learnings to memory&rdquo;/);
  const A = new Function(`${SCAN_FORM_HELPERS_JS}; return { askScopeSummary };`)() as Record<string, AnyFn>;
  assert.match(A.askScopeSummary(1, 0, 0), /^1 repo cloned read-only · no data sources\. Read-only — nothing is written to your sources\.$/);

});

// 2026-10-05: internal serial numbers (rs_… / ak_… run ids) are not shown to users — history cards, the report library,
// the run heroes and the reading-room bar show titles / dates only (a user-set alias still shows). The id stays in
// data attributes, URLs and search, where it is functional.
test('no run id is displayed: history cards, library card, run heroes, reading-room bar', () => {
  assert.doesNotMatch(APP, /esc\(r\.alias\|\|r\.id\)/, 'cards show the alias, never fall back to the id');
  assert.doesNotMatch(APP, /esc\(run\.alias\|\|run\.id\)/, 'run heroes never fall back to the id');
  assert.doesNotMatch(APP, /esc\(scopeLbl\|\|run\.alias\|\|run\.id\)/);
  assert.match(APP, /'<span class="rt-meta mono" title="'\+esc\(when\|\|''\)\+'">'\+esc\(when\|\|''\)\+'<\/span>'/, 'the reading-room bar shows the date only');
  assert.doesNotMatch(APP, /logLine\('ask '\+res\.d\.id\+' started'/);
  assert.match(APP, /data-run="'\+esc\(r\.id\)\+'"/, 'the id still keys the card');
});

// ── Open-source single-user app (2026-10-06): no login, no org / tenant / request-queue surfaces, a Settings page for the
// user's own API keys + per-run cap + telemetry, and a first-run key prompt. English only.
test('single user: no login overlay, sign-in, sign-out, session handling or /api/me', () => {
  for (const re of [/id="overlay"/, /class="login"/, /data-act="login/, /data-act="logout"/, /Sign in|Sign out|signed out|session expired/i, /postLoginNext/, /\/api\/me\b/, /\/login\b/, /data-authed|data-oauth|data-googlelogin|data-requirebyo/, /userchip|id="userWho"/]) {
    assert.doesNotMatch(APP, re, String(re));
  }
});

test('English only: no CJK character in the console source or the rendered page', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./serverUi.ts', import.meta.url), 'utf8');
  const CJK = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;
  assert.doesNotMatch(src, CJK, 'serverUi.ts');
  // The shared REMEDIATION.md builder (remediationMd.ts) is embedded verbatim; everything the console itself renders is English.
  const { REMEDIATION_MD_JS } = await import('./remediationMd.ts');
  assert.doesNotMatch(renderApp({ runMode: 'agentic', localAudit: true, codeintelAvailable: true }).replace(REMEDIATION_MD_JS.trim(), ''), CJK);
  assert.doesNotMatch(APP, /\u4e2d\u6587|bilingual|lang-zh/i);
});

test('no legacy brand, hosted-console wording or raw org ids in the console', () => {
  // The product word is accel-scope; the THERESA_* env prefix and theresa.* storage keys are code, not copy.
  assert.doesNotMatch(APP, /\bTheresa\b/);
  assert.doesNotMatch(APP, /operator console|org_[0-9a-f]{8}/i);

  assert.match(APP, /<title>accel-scope<\/title>/);
  assert.match(APP, /<span class="nm">accel-scope<\/span>/);
});

test('removed server endpoints are never called', () => {
  for (const p of ['/api/org-profiles', '/api/queue', '/api/login', '/api/logout', "/api/me'", '/api/me?', '/share/', "/share'", '/api/audit', '/api/connect/gcp', '/api/connect/slack', '/api/connect/github/app', '/api/claude-auth', '/api/orgs', '/api/acting-org', '/api/sources/box/remove', '/api/export/projects', '/export\'', '/api/auth/google']) {
    assert.ok(!APP.includes(p), `still references ${p}`);
  }
  assert.doesNotMatch(APP, /boxFilter|queueItemId|data-panel="queue"|data-panel="audit"|data-go="queue"|savedOrgPanel|exportModal/);
  // Connectors that remain: GitHub token, public URLs, local folders, BigQuery SA key / warehouse MCP, key-value, data MCPs.
  assert.match(APP, /var kinds=\['github','giturl','local','warehouse','mcp','keyvalue'\];/);
  assert.match(APP, /id="whSaJson"/);
  assert.match(APP, /if\(saJson\) body\.saJson=saJson;/);
  assert.doesNotMatch(APP, /id="gcpJson"|id="slackFields"|id="boxFields"|id="claudeFields"|connRow\('claude'|Run on your Claude plan/, 'the Claude-plan pseudo-source moved to Settings');
});

test('renderApp takes the single-user options only and stamps the version', () => {
  const html = renderApp({ version: '1.4.0', runMode: 'deterministic' });
  assert.match(html, /<body data-runmode="deterministic" data-localaudit="0" data-codeintel="0" data-docrecovery="0" data-version="1\.4\.0"/);
  assert.match(html, /<div class="side-ver" id="footVersion">v1\.4\.0<\/div>/);
  assert.match(renderApp({ version: '<x>' }), /data-version="x"/, 'the version is sanitised');
});

test('Settings: sidebar entry, /settings route, panel, and the three sections with their endpoints', () => {
  assert.match(APP, /<button class="navitem" data-go="settings"[^>]*>[\s\S]*?<span class="lbl">Settings<\/span><\/button>/);
  assert.match(APP, /p==='settings'\)\?p:''/, 'the /settings route is a known view');
  assert.match(APP, /<section class="panel" data-panel="settings">\s*<div class="doc">\s*<div id="settingsBody"><\/div>/);
  assert.match(APP, /api\('\/api\/settings'\)/);
  assert.match(APP, /postJson\('\/api\/settings\/keys',body\)/);
  assert.match(APP, /postJson\('\/api\/settings\/budget',\{usd:v\}\)/);
  assert.match(APP, /postJson\('\/api\/settings\/telemetry',body\)/);
  assert.match(APP, /postJson\('\/api\/settings\/connections',\{remember:!!remember\}\)/);
  assert.match(APP, /All usage bills your own API keys\. Keys are only sent to Anthropic \/ OpenAI\./);
  assert.match(APP, /Save keys on this machine/);
  assert.match(APP, /Remember connection credentials on this machine/);
  assert.match(APP, /Typical costs: Quick Ask ~\$0\.3–1, Full Scan ~\$5–30\./);
  assert.match(APP, /THERESA_TELEMETRY=0/);
  assert.match(APP, /--print-telemetry/);
  assert.match(APP, /Report writing, report quality checks and translation use OpenAI when this key is present, and fall back to Claude/);
  assert.match(APP, /<pre class="set-pre">'\+esc\(ex\)\+'<\/pre>'/, 'the example payload is pretty JSON in a <pre>');
});

test('Settings helpers: key source + provider wording, typical costs', () => {
  assert.equal(S.keySourceText({ set: false }), 'not set');
  assert.equal(S.keySourceText({ set: true, source: 'env', kind: 'apikey' }), 'API key from the environment (.env) — never written to disk');
  assert.equal(S.keySourceText({ set: true, source: 'saved', kind: 'oauth' }), 'Claude plan token saved on this machine (keys.json)');
  assert.equal(S.keySourceText({ set: true, source: 'settings' }), 'API key set in Settings — memory only, gone on restart');
  assert.match(S.providerText('anthropic+openai'), /OpenAI key for report writing/);
  assert.match(S.providerText('none'), /add your Anthropic key/);
  assert.deepEqual(S.TYPICAL_COST, { ask: '~$0.3–1', scan: '~$5–30' });
});

test('first run: a key prompt above every tab, and Quick Ask / Full Scan are blocked until a key is set', () => {
  assert.match(APP, /<section class="firstrun" id="firstRun" role="region" aria-label="Add your Anthropic API key" hidden><\/section>/);
  assert.match(APP, /var show=keysMissing\(\)&&currentView\(\)!=='settings';/);
  assert.match(APP, /Add your Anthropic API key to get started/);
  assert.match(APP, /keyFormHtml\('fr',/, 'the same key form as Settings, saved inline');
  assert.match(APP, /function keysMissing\(\)\{ return !!\(state\.settings&&state\.settings\.keys&&state\.settings\.keys\.ready===false\); \}/);
  assert.match(APP, /\+\(needTok\?keyGateHtml\(\):''\)/, 'the Full Scan form says why it is blocked + links to Settings');
  assert.match(APP, /var startDisabled=\(!nSel\|\|needTok\|\|/);
  assert.match(APP, /if\(keysMissing\(\)\)\{ renderAskGate\(\); return; \}/, 'Quick Ask refuses too');
  assert.match(APP, /id="askByoHint"[^>]*>Add your Anthropic API key before asking — <a href="\/settings" data-act="go-settings">open Settings<\/a>/);
});

test('telemetry notice: OK / Turn off / What is sent?', () => {
  assert.match(APP, /<div class="tele-banner" id="teleBanner" role="status" hidden><\/div>/);
  assert.match(APP, /var show=!!\(t&&t\.enabled&&!t\.noticeShown\);/);
  assert.match(APP, /a==='telemetry-ok'\)\{ setTelemetry\(\{noticeShown:true\}\); \}/);
  assert.match(APP, /a==='telemetry-off'\)\{ setTelemetry\(\{enabled:false,noticeShown:true\}\); \}/);
  assert.match(APP, /What is sent\?<\/a>/);
});

test('spend: the New Full Scan / Quick Ask forms show the per-run cap with a link to Settings', () => {
  assert.match(APP, /function capLineHtml\(\)\{[^\n]*Per-run cap: <b>[^\n]*change in Settings<\/a><\/span>'; \}/);
  assert.match(APP, /\+'<div class="cap-row">'\+capLineHtml\(\)\+'<\/div>'/);
  assert.match(APP, /<p class="hint" id="askCapLine"><\/p>/);
});

test('connections: a source whose credential was not saved offers a clear Reconnect', () => {
  assert.match(APP, /var actTxt=st==='connected'\?'Manage':\(st==='reconnect'\?'Reconnect':'Connect'\);/);
  assert.match(APP, /else if\(src&&src\.status==='error'\) setT\('connBody','Reconnect needed — '/);
});

test('Memory is a local store: no Tier-2 / Tier-3 / global library UI', () => {
  assert.doesNotMatch(APP, /Tier-[123]|tier-[123]|global library|org_global|mem-tier-pick|memIsT3|cross-company/);
  for (const v of ['cards', 'history', 'compare', 'add']) assert.match(APP, new RegExp(`data-act="mem-view" data-view="${v}"`), v);
  assert.match(APP, /a==='mem-revert'/);
});

test('report chat: no session / Claude-plan wording; a missing key surfaces the server message', () => {
  assert.doesNotMatch(APP, /Connect your Claude plan|Session expired/);
  assert.match(APP, /if\(res\.status===428\)\{[^\n]*state\.cdErr=\(d&&d\.error\)\|\|'Add your Anthropic API key in Settings first\.'/);
});
