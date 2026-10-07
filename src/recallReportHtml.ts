// Leadership report renderer — the DEEP-BRIEF form (deep, sectioned, numbers-driven), modeled on a
// recall-coverage report and an approved leadership brief. It is NOT a thin bullet brief: the question → the bottom line + headline
// metric cards → numbered deep sections (paragraph + optional chart) → a decisive-test box → recommendations →
// data-sources/caveats. Every field is rendered as complete sentences (no truncation).
//
// The structured input is produced by research/leadershipWriter.ts (an LLM rewrite step that turns the measured
// verdicts into complete, de-jargoned prose). Self-contained: system fonts, inline CSS, no external asset.

import { anchorAttr, contentHash, dedupeAnchorIds, canonicalJson } from './reportChrome.ts';

export interface RecallCard { v: string; label: string }
// Per-section visualization — a small chart FITTED to that argument's point. The LLM picks the kind and
// supplies the numbers (only measured values from the verdicts); the renderer draws SAFE inline SVG/CSS
// (no model-authored HTML — values are coerced to numbers, all text escaped). Replaces the old single
// central evidence table: each bullet now carries the chart that fits it.
export type Viz =
  | { kind: 'bars'; unit?: string; bars: { label: string; value: number; sub?: string }[] }   // distribution / comparison
  | { kind: 'coverage'; total: number; covered: number; coveredLabel: string; gapLabel: string }  // in-vs-out split of one population
  | { kind: 'gauge'; pct: number; label: string }                                              // a single ratio / percentage
  | { kind: 'table'; head: Cell[]; rows: Cell[][] }                                        // rows of data when columns matter
  | { kind: 'svg'; svg: string };                                                          // pre-rendered, deterministic, already-escaped inline SVG/HTML (codeintelViz — NOT model-authored)
// A table cell is a plain value (string/number).
export type Cell = string | number;
// `key` (optional): a CONTENT-STABLE semantic anchor id for the comment feature — e.g. codeintelViz sets
// 'system-map' / 'shared-data-tables' so the anchor never shifts with the section's rendered position. When
// absent the renderer falls back to the displayed section number `n`. Never a bare array index.
export interface RecallSection { n: string; heading: string; body: string; viz?: Viz; key?: string }
export interface RecallReportInput {
  company: string;
  title: string;
  question: string;
  meta: string;                 // windows / sources / date
  bottomLine: string;
  cards: RecallCard[];
  sections: RecallSection[];
  decisive: string;             // the decisive-test conclusion
  recommendations: string[];
  caveats: string;
  answerBack?: string;              // "you asked X · supports Y · ruled out Z · could not settle W + next test" — present only when a brief was supplied
  // Leadership v5 (report lens split): the "Decisions needed" list, rendered INSIDE the lead card under the bottom line
  // (the verdict). Absent / empty ⇒ the lead card is the bottom line alone, as before.
  decisions?: string[];
  // The eyebrow line under the brand. This renderer began as a recsys brief and hard-coded
  // "recall coverage & incremental value" on EVERY report, so a code-native baseline area report carried a
  // recsys subtitle. Absent ⇒ a neutral per-tier subtitle; the recsys writers pass the recall one explicitly.
  subtitle?: string;
  // Did a LIVE measurement plane (warehouse / analytics / key-value …) actually produce a number in this
  // report? The footer's "numbers measured from production logs" claim is printed ONLY when true; absent/false
  // says what the report really is (a read-only diagnosis). Computed by the writer from the verdicts, never authored.
  measuredLive?: boolean;
  // Which report this is. 'leadership' (default — the historical footer) vs 'area' (a per-bundle report, which is
  // not a "leadership review").
  tier?: 'leadership' | 'area';
}

/** The recsys brief's own subtitle — for the recsys writers to pass as `subtitle`. */
export const RECALL_SUBTITLE = (company: string): string => company + ' · recall coverage & incremental value';

// The deterministic footer. Pure + exported so the claim/no-claim split is unit-tested directly.
export function recallFooter(input: Pick<RecallReportInput, 'company' | 'measuredLive' | 'tier'>): string {
  const area = input.tier === 'area';
  const what = area ? 'area report' : 'leadership review';
  const basis = input.measuredLive ? 'numbers measured from production logs' : 'read-only diagnosis of the connected sources';
  const tail = area ? '' : ' The detailed engineering report is separate.';
  return `accel-scope · ${input.company} · ${what} — ${basis}; experiment-dependent judgements flagged, not asserted.${tail}`;
}

// Does a rendered report actually CARRY the codeintel cross-repo viz? The console's code-intelligence card
// promised maps "rendered inside the generated reports" whenever the plane was ticked, but the sidecar is appended
// only when the index exists — so a run whose plane was unavailable/not indexed promised charts no report had.
// The run state should record this signal (e.g. `run.codeintelInReports = reports.some(reportHasCodeintelViz)`)
// and the card copy follow it. Two shapes carry the viz: the RecallReportInput reports render codeintelViz's
// sections with their SEMANTIC anchor keys (section-system-map / -shared-data-tables / -hidden-coupling /
// -code-health, see codeintelViz.ts), and the in-session HTML reports get the fragment wrapped in
// CODEINTEL_VIZ_MARKER (literal duplicated here — codeintelViz imports this module; a test pins them equal).
const CODEINTEL_VIZ_MARKER_LITERAL = '<!--codeintel-viz-sidecar-->';
const CODEINTEL_SECTION_ANCHOR = /data-anchor-id="section-(?:system-map|shared-data-tables|hidden-coupling|code-health)(?:-\d+)?"/;
export function reportHasCodeintelViz(html: string | null | undefined): boolean {
  const h = String(html ?? '');
  // The fragment form needs its marker AND its own wrapper — a bare marker could be echoed by a model.
  return (h.includes(CODEINTEL_VIZ_MARKER_LITERAL) && h.includes('<div class="codeintel-viz">')) || CODEINTEL_SECTION_ANCHOR.test(h);
}
// The run-level signal executeOrgRun records as `run.codeintelInReports` once the reports are final (after the
// viz sidecar re-append + normalize): true iff ANY delivered report (area / leadership / combined) carries the maps.
// A run whose plane was unavailable or not indexed therefore records FALSE, which is what lets the console card take
// its "unavailable" branch instead of the old unconditional "rendered inside the reports" promise.
export function anyReportHasCodeintelViz(htmls: readonly (string | null | undefined)[]): boolean {
  return htmls.some((h) => reportHasCodeintelViz(h));
}

/** The neutral eyebrow when no subtitle is supplied. */
function defaultSubtitle(input: Pick<RecallReportInput, 'company' | 'tier'>): string {
  return input.company + (input.tier === 'area' ? ' · area review' : ' · diagnostic review');
}

const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// One table cell: a string/number, escaped — an object renders empty, never "[object Object]".
const cell = (c: unknown): string => (c !== null && typeof c === 'object' ? '' : esc(c));

const num = (n: unknown): number => { const x = Number(n); return Number.isFinite(x) ? x : 0; };
const fmt = (n: unknown): string => { const x = num(n); return (Number.isInteger(x) ? x : Number(x.toFixed(4))).toLocaleString('en-US'); };
// Draw one section's chart as SAFE inline SVG/CSS — values coerced to numbers, all text escaped.
function vizHtml(v: Viz): string {
  if (v.kind === 'bars' && Array.isArray(v.bars) && v.bars.length) {
    const max = Math.max(...v.bars.map((b) => num(b.value)), 1);
    return `<div class="viz vbars">${v.bars.map((b) => `<div class="vbar"><div class="vbar-l">${esc(b.label)}</div><div class="vbar-t"><div class="vbar-f" style="width:${Math.max(2, Math.round(num(b.value) / max * 100))}%"></div></div><div class="vbar-v mono">${esc(fmt(b.value))}${b.sub ? ` <span class="vbar-s">${esc(b.sub)}</span>` : ''}</div></div>`).join('')}</div>`;
  }
  if (v.kind === 'coverage') {
    const pct = num(v.total) > 0 ? num(v.covered) / num(v.total) * 100 : 0;
    return `<div class="viz vcov"><div class="vcov-bar"><div class="vcov-in" style="width:${pct.toFixed(1)}%"></div></div><div class="vcov-leg"><span><i class="vd in"></i>${esc(v.coveredLabel)} — <b class="mono">${esc(fmt(v.covered))}</b> (${pct.toFixed(1)}%)</span><span><i class="vd out"></i>${esc(v.gapLabel)} — <b class="mono">${esc(fmt(num(v.total) - num(v.covered)))}</b></span></div></div>`;
  }
  if (v.kind === 'gauge') {
    const p = Math.max(0, Math.min(100, num(v.pct))); const r = 34, c = 2 * Math.PI * r;
    // Keep sub-1% precision so a "razor-thin sliver" (e.g. 0.16%) doesn't display as a misleading "0%".
    const pTxt = p > 0 && p < 1 ? p.toFixed(2) : p.toFixed(0);
    return `<div class="viz vgauge"><svg viewBox="0 0 90 90" width="84" height="84" aria-hidden="true"><circle cx="45" cy="45" r="${r}" fill="none" stroke="#E7E0D4" stroke-width="9"/><circle cx="45" cy="45" r="${r}" fill="none" stroke="#FEC240" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(1)}" transform="rotate(-90 45 45)"/><text x="45" y="51" text-anchor="middle" font-size="${pTxt.length > 3 ? 15 : 19}" font-weight="600" fill="#3E261C">${pTxt}%</text></svg><div class="vgauge-l">${esc(v.label)}</div></div>`;
  }
  if (v.kind === 'table' && Array.isArray(v.rows) && v.rows.length) {
    return `<div class="tbl"><table><thead><tr>${(v.head ?? []).map((h) => `<th>${cell(h)}</th>`).join('')}</tr></thead><tbody>${v.rows.map((row) => `<tr>${row.map((cl) => `<td class="mono">${cell(cl)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  // Pre-rendered inline SVG/HTML produced DETERMINISTICALLY by codeintelViz (all repo-derived fields escaped
  // at build time; never model-authored) — emitted verbatim. Guarded to a string so a malformed viz is inert.
  if (v.kind === 'svg' && typeof v.svg === 'string') return v.svg;
  return '';
}
// The BASE comment anchor for a section: a semantic `key` when it has one (codeintel charts, named deterministic
// sidecars), else a contentHash of a CANONICAL serialization of the section's COMPLETE content. Mirrors the
// finding key ({ ...f, id: undefined }): serialize the WHOLE section with only the positional `n` (and the
// absent `key`) excluded, so heading, body, `viz`, and any future field are ALL included automatically — no
// hand-picked field list to fall out of sync (the field-enumeration treadmill). canonicalJson (not a delimiter-
// join) also keeps field boundaries UNAMBIGUOUS. `n` is NEVER hashed (renumbered by array position → would
// migrate a comment onto a different section). Ties among genuinely identical sections → dedupeAnchorIds.
function sectionAnchorId(s: RecallSection): string {
  return s.key ? `section-${s.key}` : `section-${contentHash(canonicalJson({ ...s, n: undefined, key: undefined }))}`;
}
function sectionHtml(s: RecallSection, anchorId: string): string {
  return `<section class="sec"${anchorAttr(anchorId)}><div class="sec-n">${esc(s.n)}</div><h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>${s.viz ? vizHtml(s.viz) : ''}</section>`;
}
// Render a section list with DOCUMENT-UNIQUE anchors: dedupe the full set of base ids in ONE pass (a duplicate
// is suffixed -2/-3 deterministically), reserving any `reservedIds` already emitted elsewhere in the same
// document (e.g. the recall report's fixed scaffold anchors), then stamp each section. `reservedIds` is empty
// for the standalone codeintel sidecar (no scaffold shares its document).
function renderSectionList(sections: RecallSection[], reservedIds: readonly string[] = []): string {
  const ids = dedupeAnchorIds(sections.map(sectionAnchorId), reservedIds);
  return sections.map((s, i) => sectionHtml(s, ids[i])).join('');
}

// Render a set of sections to HTML using the SAME sectionHtml/vizHtml as the full report (one source of
// truth for bars/table/svg drawing). Used by codeintelViz to append its deterministic sidecar into the
// in-session domain area report (a standalone HTML string), which supplies its own scoped `.sec/.viz/…` CSS.
export function renderSectionsHtml(sections: RecallSection[]): string {
  return renderSectionList(sections);
}

// The FIXED scaffold anchor vocabulary — every id a scaffold block CAN emit (some are conditional). Reserved
// UNCONDITIONALLY when deduping sections so a DYNAMIC section keyed with a scaffold name ALWAYS resolves to
// `section-<name>-2`, presence-invariant. Reserving only the scaffolds PRESENT this render would reintroduce
// presence-dependence: an absent optional scaffold's name would go to a section unsuffixed, then the scaffold
// later appearing would push the section to -2 and hand its old id to the scaffold → comment migration. Stability
// over pretty ids: a section keyed `decisive` is suffixed even when the decisive block is absent — deterministic.
const SCAFFOLD_ANCHOR_IDS = ['section-bottom-line', 'section-answer-back', 'section-decisive', 'section-recommendations', 'section-caveats'] as const;

export function renderRecallReport(input: RecallReportInput): string {
  const hasAnswerBack = Boolean(input.answerBack);
  const hasDecisive = Boolean(input.decisive);
  const hasRecs = input.recommendations.length > 0;
  // dedupe sections against the WHOLE scaffold vocabulary (not just the present blocks) — see SCAFFOLD_ANCHOR_IDS.
  const sectionsHtml = renderSectionList(input.sections, SCAFFOLD_ANCHOR_IDS);
  // Contrast floor: --muted / --honey-link colour the 11px mono labels (eyebrow, meta, .k kickers, footer), so both
  // clear WCAG AA 4.5:1 on the cream grounds (were #8A7E6E ≈ 3.7:1 and #9A6A0E ≈ 4.4:1). reportChrome.test.ts.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>accel-scope · ${esc(input.company)} · ${input.tier === 'area' ? 'area review' : 'diagnostic review'}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--espresso:#3E261C;--honey:#FEC240;--honey-link:#875D0B;--cream:#FAF8F4;--card:#FEFDFC;--line:#E7E0D4;--muted:#6F6455;--ink2:#5a4a3d;--red:#C0392B;--green:#2F7D54}
body{background:var(--cream);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--espresso);line-height:1.7;-webkit-font-smoothing:antialiased}
.mono{font-family:ui-monospace,Menlo,monospace}
.wrap{max-width:860px;margin:0 auto;padding:0 26px 90px}
.bar{position:sticky;top:0;background:rgba(250,248,244,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);z-index:10}
.bar-in{max-width:860px;margin:0 auto;padding:11px 26px;display:flex;align-items:center;gap:12px}
.blogo{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--honey-link);font-weight:600}
.top{padding:46px 0 22px}
.eyebrow{font-family:ui-monospace,monospace;font-size:11.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--honey-link);margin-bottom:14px}
h1{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1.22;max-width:26ch}
.q{color:var(--ink2);font-size:16px;margin-top:16px;max-width:72ch}
.meta{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--muted);margin-top:16px}
.lead{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--honey);border-radius:13px;padding:18px 20px;margin-top:26px}
.lead .k{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--honey-link);margin-bottom:8px}
.lead p{font-size:16px;color:var(--espresso)}
.lead .decisions{margin:4px 0 0 20px;font-size:15px;color:var(--espresso)}.lead .decisions li{margin:3px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 15px}
.card .v{font-size:23px;font-weight:600;letter-spacing:-.02em}.card .l{font-size:12.5px;color:var(--ink2);margin-top:6px;line-height:1.45}
.sec{margin-top:34px;border-top:1px solid var(--line);padding-top:22px}
.sec-n{font-family:ui-monospace,monospace;color:var(--honey-link);font-size:13px}
.sec h2{font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:1.32;margin:6px 0 12px;max-width:36ch}
.sec p{font-size:15px;color:var(--ink2);max-width:74ch}
.tbl{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:9px 13px;border-bottom:1px solid var(--line)}th{background:#F3EEE4;color:var(--ink2);font-weight:600}tr:last-child td{border-bottom:none}
.viz{margin-top:16px}
.vbars{display:flex;flex-direction:column;gap:8px}
.vbar{display:grid;grid-template-columns:minmax(110px,30%) 1fr auto;align-items:center;gap:12px;font-size:13px}
.vbar-l{color:var(--ink2)}.vbar-t{background:#F3EEE4;border-radius:6px;height:16px;overflow:hidden}.vbar-f{height:100%;background:var(--honey);border-radius:6px}
.vbar-v{color:var(--espresso);font-weight:600;white-space:nowrap}.vbar-s{color:var(--muted);font-weight:400}
.vcov-bar{height:22px;border-radius:7px;background:#E7E0D4;overflow:hidden}.vcov-in{height:100%;background:var(--green)}
.vcov-leg{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:13px;color:var(--ink2)}
.vd{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}.vd.in{background:var(--green)}.vd.out{background:#C9BCA8}
.vgauge{display:flex;align-items:center;gap:16px}.vgauge-l{font-size:14px;color:var(--ink2);max-width:46ch}
.decisive{background:#FBF1D8;border:1px solid var(--honey);border-radius:13px;padding:18px 20px;margin-top:30px}
.decisive .k{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--honey-link);margin-bottom:8px}
.decisive p{font-size:16px;color:var(--espresso)}
.recs{counter-reset:r;margin-top:14px}.rec{display:flex;gap:12px;padding:11px 0;border-top:1px solid var(--line)}.rec:first-child{border-top:none}
.rec::before{counter-increment:r;content:counter(r);flex:none;width:24px;height:24px;border-radius:50%;background:var(--espresso);color:#fff;font-family:ui-monospace,monospace;font-size:12px;display:flex;align-items:center;justify-content:center}
.rec-t{font-size:15px;padding-top:2px}
.caveat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-size:13.5px;color:var(--ink2);max-width:78ch;margin-top:14px}
.foot{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);font-family:ui-monospace,monospace;font-size:11px;color:var(--muted)}
</style></head><body>
<div class="bar"><div class="bar-in"><span class="blogo">accel-scope</span></div></div>
<div class="wrap">
 <div class="top"><div class="eyebrow">${esc(input.subtitle || defaultSubtitle(input))}</div>
  <h1>${esc(input.title)}</h1><p class="q">${esc(input.question)}</p>
  <div class="meta">${esc(input.meta)}</div></div>
 <div class="lead"${anchorAttr('section-bottom-line')}><div class="k">Bottom line</div><p>${esc(input.bottomLine)}</p>${input.decisions?.length ? `<div class="k" style="margin-top:12px">Decisions needed</div><ul class="decisions">${input.decisions.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>
 ${hasAnswerBack ? `<div class="lead" style="border-left-color:#4C6F91"${anchorAttr('section-answer-back')}><div class="k">How we addressed your brief</div><p>${esc(input.answerBack)}</p></div>` : ''}
 ${input.cards.length ? `<div class="cards">${input.cards.map((c) => `<div class="card"><div class="v mono">${esc(c.v)}</div><div class="l">${esc(c.label)}</div></div>`).join('')}</div>` : ''}
 <!--capability-map-->
 ${sectionsHtml}
 <!--answer-back-->
 ${hasDecisive ? `<div class="decisive"${anchorAttr('section-decisive')}><div class="k">The decisive test</div><p>${esc(input.decisive)}</p></div>` : ''}
 ${hasRecs ? `<div class="sec"${anchorAttr('section-recommendations')}><div class="sec-n">▸</div><h2>Recommendation</h2><div class="recs">${input.recommendations.map((r) => `<div class="rec"><div class="rec-t">${esc(r)}</div></div>`).join('')}</div></div>` : ''}
 <div class="sec"${anchorAttr('section-caveats')}><div class="sec-n">▸</div><h2>How we know / caveats</h2><div class="caveat">${esc(input.caveats)}</div></div>
 <div class="foot">${esc(recallFooter(input))}</div>
</div>
</body></html>`;
}
