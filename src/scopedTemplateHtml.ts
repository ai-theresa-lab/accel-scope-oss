// Deterministic renderer for the Quick Ask (accel-mini) SCOPED report — a RESTRUCTURED "story" answer, and a
// LIGHTER sibling of the Full-Scan audit template. Quick Ask answers ONE scoped question, so this report drops
// the audit-only apparatus: NO six-dimension traffic-light dashboard, NO global overview, NO floating mini-TOC.
// It is a single-page narrative:
//   masthead → question (h1) → three tabs:
//   ① Answer (bullets) + How it works (narrative + optional flow diagram) →
//   ② Where it can tighten (merged weakness+fix cards) → ③ Scope & Evidence (compact refs + not directly verified).
//
// It REUSES the shared visual chrome (reportChrome.ts): the same <style> design tokens, masthead, doctype/head +
// footer shells — so Quick Ask and Full Scan are visibly ONE product. The story-specific layout primitives (scope
// block, numbered sections, bullet list, flow diagram, tightening cards, evidence list, note) are added via the
// docHead `extraCss` slot, all built from the SHARED design tokens (no new colors).
//
// PRESENTATION model, decoupled from the dossier: scopedTemplateModel.ts adapts the real investigateQuestion
// dossier → this model. The renderer stays pure + order-driven and is unit-testable in isolation.
// NO Date.now()/new Date(): `date` arrives pre-formatted.
//
// RAW-vs-escaped rule: PLAIN fields (question, breadcrumb, brand.*, client, scope, date, confidential, and the
// flow diagram's labels + tightening `files`) are escaped by the renderer. The RAW fields (plainSummary,
// bottomLine[], mechanism[], tightening[].weakness/.fix, evidence[], notVerified[], scopeBlock.*) may carry
// authored inline <code>/<span class="lead"> and are emitted VERBATIM — their adapter pre-escapes + secret-redacts them.

import { esc, anchorAttr, docHead, mastheadHtml } from './reportChrome.ts';

// ── fixed UI labels ─────────────────────────────────────────────────────────────────────────────────────────
export interface EffortChipLabels {
  quick_win: string;
  moderate: string;
  project: string;
}
export const SCOPED_LABELS = {
  docTitle: 'Quick Ask', // <title> segment: "<brand> · <docTitle> · <question>"
  kicker: 'Quick Ask', // masthead kicker (top-right)
  confidential: 'Confidential · Internal use only', // default confidential line (meta may override)
  metaClient: 'Project',
  metaScope: 'Scope',
  metaDate: 'Generated',
  yourQuestion: 'Your question', // reminder-block label above the answer
  scopeHeader: 'Scope',
  scopeCovered: 'Covered',
  scopeNotCovered: 'Not covered',
  bottomLine: 'Answer',
  howItWorks: 'How it works',
  tightening: 'Where it can tighten',
  tightenItem: 'The item', // work-items card: the fix/detailed-how sub-label, under the short title
  tightenLocation: 'Location', // work-items card: the mono file block sub-label
  tightenContext: 'Context', // work-items card: the weakness/background sub-label
  evidence: 'Evidence',
  notVerified: 'Not directly verified',
  navAnswer: 'Answer & How it works', // tab 01
  navScopeEvidence: 'Scope & Evidence', // tab 03
  evidenceSep: ' — ', // between an evidence ref and its detail
  effortChip: { quick_win: 'quick', moderate: 'moderate', project: 'project' } as EffortChipLabels,
  effortLegend: { quick_win: 'small, fast change', moderate: 'moderate effort', project: 'large · project-scale' } as EffortChipLabels,
  effortInfo: 'Effort levels', // aria-label for the effort info-tooltip icon
  enlargeHint: 'Click to enlarge', // flow-diagram corner affordance
  enlargeClose: 'Close', // flow-diagram lightbox close-button aria-label
  // RAW (carries <b>) — the cut-short banner body
  partialBanner:
    '⚠ <b>Partial findings</b> — this investigation was cut short before it finished; what follows is the portion already verified. Items still needing verification are listed under “Not directly verified” as a recommended dedicated follow-up.',
} as const;

// Effort token (quick_win | moderate | project) → chip CSS class (quick → green, mod → amber, proj → red).
export const EFFORT_CHIP_CLASS: Record<keyof EffortChipLabels, string> = {
  quick_win: 'quick',
  moderate: 'mod',
  project: 'proj',
};

// ── flow diagram spec (constrained, deterministically layout-able — NOT a general graph) ──────────────────
// A step is a single node in a lane. `kind` picks the visual: a plain 'box' or a 'gate' (amber). A lane is a
// horizontal row of ≤4 steps rendered left→right; `dir` says whether the lane flows INTO the hub ('in', its
// last step → hub) or OUT of the hub ('out', hub → its last step, then leftward). `edgeLabel` annotates the
// lane↔hub connector. A FlowSpec is 1–3 lanes + an optional shared `hub` node on the right.
export interface FlowStep {
  label: string;
  sub?: string;
  kind?: 'box' | 'gate';
}
export interface FlowLane {
  title: string;
  steps: FlowStep[]; // 1–4 steps
  dir?: 'in' | 'out'; // 'in' (default): lane → hub. 'out': hub → lane.
  edgeLabel?: string; // optional annotation on the lane↔hub connector arrow
}
export interface FlowSpec {
  lanes: FlowLane[]; // 1–3 lanes
  hub?: { label: string; sub?: string[] }; // shared node all lanes connect to (right side)
}

export interface ScopedTighteningCard {
  title?: string; // RAW (adapter pre-escaped + md subset) — SHORT imperative action headline (the card heading). When absent the renderer uses `fix` as the heading and omits the THE ITEM segment (back-compat).
  weakness: string; // RAW — the background: WHY it matters (renders as CONTEXT)
  fix: string; // RAW — the concrete fix / HOW (renders as THE ITEM when a distinct title exists)
  effort?: keyof EffortChipLabels; // quick_win | moderate | project → colored chip; omitted → no chip
  files?: string[]; // PLAIN — renders as LOCATION mono block
}

export interface ScopedReportModel {
  brand: { name: string; sub: string }; // masthead wordmark — plain
  client: string; // plain (doc-meta)
  scope: string; // e.g. "Quick Ask · single question" — plain (doc-meta)
  date: string; // pre-formatted; the renderer never calls Date — plain
  confidential?: string; // optional classification override — plain
  title?: string; // SHORT report h1 (LLM-generated), PLAIN (escaped by the renderer). When present ⇒ h1 = title + the
                  // question moves to a reminder block above the Answer. When ABSENT ⇒ h1 falls back to `question`.
  question: string; // the ORIGINAL question — the h1 fallback AND the "your question" reminder above the Answer.
  breadcrumb: { dimension: string; sub: string }; // classification — no longer rendered (kept for back-compat)
  plainSummary?: string; // top plain-summary — no longer rendered (kept for back-compat)
  scopeBlock?: { covered: string[]; notCovered?: string[] }; // Scope — RAW entries
  bottomLine: string[]; // ① Answer — 2–4 bullets (the lead). RAW.
  mechanism?: string[]; // ② How it works — narrative paragraphs. RAW.
  flow?: FlowSpec; // ② flow diagram
  tightening?: ScopedTighteningCard[]; // ③ Where it can tighten — work-items cards.
  evidence?: string[]; // ④ Evidence — compact ref lines (RAW).
  notVerified?: string[]; // ⑤ Not directly verified — RAW notes.
  partial?: boolean; // the investigation was cut short → lead with a PARTIAL banner.
}

// Scoped-specific layout primitives — appended INSIDE the shared <style> (via docHead's extraCss slot), so they
// inherit every shared token (--surface / --border / --border-strong / --accent / --ink* / --mono / --p*-bg /
// --ok*). No new colors: the scoped report is the same design language as the audit report, a lighter layout.
export const SCOPED_EXTRA_CSS = `  /* ---------- Quick Ask (scoped "story") — 3-tab layout + unified format ---------- */

  /* Wider page than the shared 860 default: the 3-tab layout spends ~210px + 32px gap on the left nav, so a
     wider container keeps the right-hand text column at a comfortable ~770px. Scoped-only override (appended
     AFTER REPORT_CSS, so it wins over .wrap{max-width:var(--maxw)}); the shared --maxw token is left untouched. */
  .wrap { max-width: 1060px; }

  /* partial banner (header, when the investigation was cut short) */
  .partial { background: var(--p1-bg); border: 1px solid var(--p1); border-radius: 12px; padding: 14px 16px; margin: 16px 0 0; font-size: 14px; color: var(--ink); line-height: 1.6; }
  .partial b { color: var(--p1); }

  /* 3-tab layout: left vertical tab nav + right single-panel area */
  .qa-layout { display: flex; gap: 32px; margin-top: 28px; align-items: flex-start; }
  .scoped-tabs { flex: none; width: 210px; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 24px; }
  .stab { display: flex; align-items: baseline; gap: 10px; width: 100%; text-align: left; background: none; border: none; border-left: 2px solid transparent; border-radius: 8px; padding: 10px 12px; cursor: pointer; color: var(--ink-2); font-family: var(--sans); transition: background .14s ease, color .14s ease, border-color .14s ease; }
  .stab:hover { background: var(--surface-2); color: var(--ink); }
  .stab.active { background: var(--accent-soft); border-left-color: var(--accent); color: var(--ink); }
  .stab-n { flex: none; font-family: var(--mono); font-size: 11px; color: var(--accent); font-variant-numeric: tabular-nums; }
  .stab-t { font-size: 13px; line-height: 1.35; font-weight: 500; }
  .qa-panels { flex: 1 1 auto; min-width: 0; }
  .panel { display: none; }
  .panel.active { display: block; }

  /* in-panel section: ONE uniform heading (honey tick) + generous breathing room between sub-sections */
  .p-sec + .p-sec { margin-top: 32px; }
  .p-h { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-2); margin: 0 0 14px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .p-h::before { content: ""; display: inline-block; width: 14px; height: 2px; background: var(--accent); vertical-align: middle; margin-right: 8px; border-radius: 2px; }
  .sub-label { font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); margin: 14px 0 8px; }

  /* body copy + inline code (14px body tier / 12px meta tier) */
  p.body { font-size: 14px; color: var(--ink); line-height: 1.7; margin: 0 0 12px; }
  p.body:last-child { margin-bottom: 0; }
  .lead { font-weight: 600; color: var(--ink); }
  .qa-panels code { font-family: var(--mono); font-size: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; color: var(--ink-2); }

  /* the ONE unified list — Answer bullets, Evidence, Scope, Not-verified all share it (honey dot + even rhythm) */
  ul.list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; }
  ul.list li { position: relative; padding-left: 18px; font-size: 14px; color: var(--ink); line-height: 1.6; }
  ul.list li::before { content: ""; position: absolute; left: 2px; top: 9px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  ul.list.muted li { color: var(--ink-2); }
  ul.list.muted li::before { background: var(--ink-3); }

  /* CARD 1 of 3 — Answer lead callout (the ONLY honey-tinted card; the answer must jump out) */
  .answer-lead { background: var(--accent-soft); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 12px; padding: 14px 16px; }
  .answer-lead ul.list li { font-size: 15px; }

  /* "Your question" reminder — the ORIGINAL question above the Answer (when a short title drives the h1). Low-key:
     small label + slightly-muted italic text with a soft left rule; must not out-shout the honey Answer callout. */
  .yourq { margin: 0 0 20px; padding: 2px 0 2px 14px; border-left: 2px solid var(--border-strong); }
  .yourq-k { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; }
  .yourq-t { margin: 0; font-size: 14px; font-style: italic; color: var(--ink-2); line-height: 1.55; }

  /* CARD 2 of 3 — flow diagram (neutral surface; symmetric vertical margin). Click → self-contained lightbox.
     SVG-internal styles are scoped to svg.flow (not .dg) so the CLONED svg inside the lightbox is styled too. */
  .dg { position: relative; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 14px 16px; margin: 16px 0; overflow-x: auto; cursor: zoom-in; }
  .dg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .dg svg { display: block; width: 100%; height: auto; min-width: 600px; }
  .dg-hint { position: absolute; top: 10px; right: 12px; font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; pointer-events: none; opacity: .9; }
  .flow .box { fill: var(--surface-2); stroke: var(--border-strong); stroke-width: 1.5; }
  .flow .hub { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; }
  .flow .gate { fill: var(--p1-bg); stroke: var(--p1); stroke-width: 1.5; }
  .flow .t { fill: var(--ink); font: 600 13.5px var(--sans); }
  .flow .s { fill: var(--ink-3); font: 400 11px var(--sans); }
  .flow .lane { fill: var(--ink-3); font: 700 10.5px var(--sans); letter-spacing: .08em; }
  .flow .al { fill: var(--ink-2); font: 500 10.5px var(--sans); }
  .flow .arw { stroke: var(--ink-3); stroke-width: 1.6; fill: none; }

  /* flow lightbox (click-to-enlarge; fully self-contained — no external deps, no requests) */
  .dg-lb { position: fixed; inset: 0; z-index: 200; display: none; align-items: center; justify-content: center; background: rgba(20,14,9,.82); padding: 4vmin; }
  .dg-lb.open { display: flex; }
  .dg-lb-inner { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px; max-width: 96vw; max-height: 92vh; overflow: auto; box-shadow: 0 24px 70px rgba(0,0,0,.5); }
  .dg-lb-inner svg { display: block; width: min(88vw, 1100px); height: auto; }
  .dg-lb-close { position: fixed; top: 18px; right: 22px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--ink); font-size: 22px; line-height: 1; cursor: pointer; z-index: 201; }
  @media print { .dg { cursor: default; } .dg-hint, .dg-lb { display: none !important; } }

  /* effort chips + the heading info-tooltip that explains the three effort tiers (pure CSS hover/focus, no JS) */
  .chip { display: inline-block; vertical-align: middle; flex: none; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; letter-spacing: .02em; white-space: nowrap; }
  .chip.quick { color: var(--ok); background: var(--ok-bg); } .chip.mod { color: var(--p1); background: var(--p1-bg); } .chip.proj { color: var(--p0); background: var(--p0-bg); }
  /* ⓘ trigger sits to the right of the "Where it can tighten" heading; resets the heading's uppercase/spacing */
  .lg-tip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-left: 8px; border: 1px solid var(--border); border-radius: 50%; font-family: var(--mono); font-size: 10px; font-weight: 700; line-height: 1; letter-spacing: normal; text-transform: none; color: var(--ink-3); cursor: help; vertical-align: middle; user-select: none; }
  .lg-tip:hover, .lg-tip:focus-visible { color: var(--accent); border-color: var(--accent); outline: none; }
  .lg-pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 80; visibility: hidden; opacity: 0; transition: opacity .12s ease, visibility .12s ease; display: flex; flex-direction: column; gap: 8px; min-width: 220px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.16); text-transform: none; letter-spacing: normal; }
  .lg-tip:hover .lg-pop, .lg-tip:focus-within .lg-pop { visibility: visible; opacity: 1; }
  .lg-item { display: inline-flex; align-items: center; gap: 8px; }
  .lg-t { font-size: 12px; color: var(--ink-2); }

  /* tighten items = work-items 3-part (TITLE fix+chip / LOCATION mono files / CONTEXT weakness). NO outer card —
     like the classic work-items report: a clean numbered list, items separated by space + a faint hairline. The
     chip (+ top legend) carries effort, so there is no colored left rule. */
  .tp { margin: 0; }
  .tp + .tp { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
  .tp-h { margin: 0 0 12px; line-height: 1.45; }
  .tp-n { font-family: var(--mono); font-size: 12px; color: var(--accent); font-variant-numeric: tabular-nums; margin-right: 7px; }
  .tp-title { font-size: 15.5px; font-weight: 700; color: var(--ink); }
  .wi-part + .wi-part { margin-top: 12px; }
  .wi-k { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 5px; }
  .wi-loc { font-family: var(--mono); font-size: 12.5px; color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 11px; overflow-wrap: anywhere; }
  .wi-ctx { margin: 0; font-size: 14px; color: var(--ink); line-height: 1.6; }

  /* Scope & Evidence panel (p3) — ONE box language across Scope / Evidence / Not-verified so the whole tab reads as
     a set. Scope = two SAME-STYLE boxes side by side (stack on narrow), covered vs not-covered told apart by color. */
  .scope-grid { display: flex; flex-wrap: wrap; gap: 14px 28px; }
  /* frameless labelled list block — no border/background/radius, consistent with the tighten list. Covered vs
     not-covered are told apart by TEXT COLOUR (ul.list.muted), separated by the .scope-grid gap / .p-sec spacing. */
  .p3-box { flex: 1 1 260px; padding: 0; }
  .p3-box-k { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 10px; }

  /* responsive: narrow → tab nav collapses to a top horizontal bar (not sticky/overlapping) */
  @media (max-width: 860px) {
    .qa-layout { flex-direction: column; gap: 20px; }
    .scoped-tabs { width: auto; position: static; flex-direction: row; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
    .stab { width: auto; border-left: none; border-bottom: 2px solid transparent; padding: 8px 11px; }
    .stab.active { border-left: none; border-bottom-color: var(--accent); }
    .lg-pop { left: auto; right: 0; }  /* keep the effort tooltip inside the viewport on narrow screens */
  }

  /* print / PDF: expand EVERY panel + hide the tab nav (and the screen-only effort tooltip) so no content is lost */
  @media print {
    .scoped-tabs { display: none; }
    .qa-layout { display: block; }
    .panel { display: block !important; }
    .p-sec + .p-sec { margin-top: 26px; }
    .lg-tip { display: none; }
  }`;

// ── flow diagram layout (deterministic) ─────────────────────────────────────────────────────────────────────
// Box WIDTH is fixed; box HEIGHT is now DYNAMIC — a box grows to fit its wrapped label (+ optional sub-label), so
// long text is never truncated. A lane's row height = its tallest box; lanes stack by accumulating those heights.
const FLOW = {
  BW: 196, GX: 40, // step box width; gap between consecutive steps
  MARGIN_L: 22, MARGIN_R: 24, TOP: 8,
  LABEL_H: 20, LANE_VGAP: 40, // lane title band above each row; vertical gap between lanes
  HUB_W: 222, HUB_GAP: 210, // hub width; gap from the steps area
  RX: 10, HUB_RX: 12,
  // text metrics used for wrapping + dynamic box height
  BOX_PX: 14, BOX_PT: 18, BOX_PB: 18, // inner horizontal padding (per side); top/bottom padding
  T_SIZE: 13.5, T_LH: 20, // main label font size + line height (matches .flow .t)
  S_SIZE: 11, S_LH: 15, // sub-label font size + line height (matches .flow .s)
  LABEL_SUB_GAP: 6, // gap between the label block and the sub-label block
  BOX_MIN_H: 56, HUB_MIN_H: 80, // floors so a single-line box/hub keeps visual weight
} as const;

const rnd = (n: number): number => Math.round(n);

// ── text width estimate (deterministic; no font metrics at render time): full-width/CJK glyphs ≈ 1em, everything
// else ≈ 0.58em. Used by BOTH wrapText (box/hub labels → multi-line, never truncated) and clipLabel (short
// annotations — lane title / edge label — that stay one line).
function isWideGlyph(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi (incl. CJK Unified Ideographs)
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // full-width forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji / pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext-B+
  );
}
const glyphW = (ch: string, fontSize: number): number =>
  isWideGlyph(ch.codePointAt(0) ?? 0) ? fontSize : fontSize * 0.58;
function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += glyphW(ch, fontSize);
  return w;
}
// clipLabel(): return `s` unchanged if it already fits `maxW` px at `fontSize`; otherwise the longest prefix
// that fits WITH a trailing ellipsis. Deterministic; safe on empty/short strings. RETAINED as a util for the
// short single-line annotations (lane title, edge label) — box/hub labels now WRAP via wrapText instead.
function clipLabel(s: string, fontSize: number, maxW: number): string {
  if (!s || maxW <= 0 || textWidth(s, fontSize) <= maxW) return s;
  const ell = '…';
  const budget = maxW - glyphW(ell, fontSize);
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = glyphW(ch, fontSize);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return (out || [...s][0] || '') + ell;
}

// segmentize(): split into atomic wrap units — a space, a single CJK/wide glyph (breakable anywhere), or a run of
// Latin/other chars (a "word", broken only at its edges unless it alone overflows). Drives wrapText's greedy fill.
function segmentize(s: string): string[] {
  const segs: string[] = [];
  let buf = '';
  const flush = (): void => { if (buf) { segs.push(buf); buf = ''; } };
  for (const ch of s) {
    if (/\s/.test(ch)) { flush(); segs.push(' '); }
    else if (isWideGlyph(ch.codePointAt(0) ?? 0)) { flush(); segs.push(ch); }
    else buf += ch;
  }
  flush();
  return segs;
}

// wrapText(): greedily break `s` into lines that each fit `maxW` px at `fontSize` — prefers breaking at spaces /
// CJK boundaries, and hard-breaks a single word that is itself wider than the box. Deterministic; returns ≥1 line
// (never empty). This REPLACES ellipsis truncation for box/hub labels, so the full text is always visible.
function wrapText(s: string, fontSize: number, maxW: number): string[] {
  const src = String(s ?? '');
  if (!src.trim() || maxW <= 0) return [src];
  const lines: string[] = [];
  let line = '';
  const hardBreak = (seg: string): void => {
    for (const ch of seg) {
      if (line && textWidth(line + ch, fontSize) > maxW) { lines.push(line); line = ''; }
      line += ch;
    }
  };
  for (const seg of segmentize(src)) {
    if (seg === ' ') {
      if (line === '') continue; // collapse leading spaces / treat as a break opportunity
      if (textWidth(line + ' ', fontSize) <= maxW) line += ' ';
      continue;
    }
    if (textWidth(line + seg, fontSize) <= maxW) { line += seg; continue; }
    if (line === '') { hardBreak(seg); continue; } // seg alone overflows an empty line → break it by char
    lines.push(line.replace(/\s+$/, '')); // wrap: flush current line, then place seg on the next
    line = '';
    if (textWidth(seg, fontSize) > maxW) hardBreak(seg);
    else line = seg;
  }
  if (line.replace(/\s+$/, '')) lines.push(line.replace(/\s+$/, ''));
  return lines.length ? lines : [src];
}

// isRenderableFlow(): the guardrail for "if it can't be laid out cleanly, omit". A FlowSpec is renderable iff it
// has 1–3 lanes and every lane has 1–4 steps (each with a label). Anything else → the caller omits the diagram.
// (Returns a plain boolean, NOT a type predicate: a well-TYPED FlowSpec can still be un-renderable — narrowing
// its rejection to `never` would be a lie.)
export function isRenderableFlow(flow: FlowSpec | null | undefined): boolean {
  if (!flow || !Array.isArray(flow.lanes)) return false;
  if (flow.lanes.length < 1 || flow.lanes.length > 3) return false;
  for (const l of flow.lanes) {
    if (!l || !Array.isArray(l.steps) || l.steps.length < 1 || l.steps.length > 4) return false;
    if (l.steps.some((s) => !s || typeof s.label !== 'string' || !s.label.trim())) return false;
  }
  return true;
}

type NodeMetrics = { h: number; labelLines: string[]; subLines: string[] };

// centeredText(): a vertically-stacked, horizontally-centered multi-line <text> — first line at `firstBaseline`,
// each subsequent <tspan> dy=lineHeight below. Every tspan re-sets x=cx so text-anchor:middle centers each line.
function centeredText(cls: string, cx: number, firstBaseline: number, lineHeight: number, lines: string[]): string {
  if (!lines.length) return '';
  return `<text class="${cls}" x="${cx}" y="${rnd(firstBaseline)}" text-anchor="middle">${lines
    .map((ln, i) => `<tspan x="${cx}"${i ? ` dy="${lineHeight}"` : ''}>${esc(ln)}</tspan>`)
    .join('')}</text>`;
}

// measureNode(): wrap `label` to `innerW`, combine with the (pre-wrapped) `subLines`, and return the line arrays +
// the node's total height (padding + label lines + gap + sub lines), floored at `minH`. Used for boxes AND the hub.
function measureNode(label: string, subLines: string[], innerW: number, minH: number): NodeMetrics {
  const labelLines = wrapText(label, FLOW.T_SIZE, innerW);
  const blockH = labelLines.length * FLOW.T_LH + (subLines.length ? FLOW.LABEL_SUB_GAP + subLines.length * FLOW.S_LH : 0);
  return { h: Math.max(minH, FLOW.BOX_PT + blockH + FLOW.BOX_PB), labelLines, subLines };
}

// renderNode(): draw a rect of height `boxH` at (x,y) with its wrapped label + sub-label block VERTICALLY CENTERED
// inside it (so short boxes in a tall lane row still read as centered).
function renderNode(x: number, y: number, w: number, boxH: number, rx: number, cls: string, met: NodeMetrics): string {
  const cx = x + w / 2;
  const blockH = met.labelLines.length * FLOW.T_LH + (met.subLines.length ? FLOW.LABEL_SUB_GAP + met.subLines.length * FLOW.S_LH : 0);
  const blockTop = y + (boxH - blockH) / 2;
  let out = `<rect class="${cls}" x="${rnd(x)}" y="${rnd(y)}" width="${w}" height="${rnd(boxH)}" rx="${rx}"/>`;
  out += centeredText('t', cx, blockTop + FLOW.T_LH / 2 + FLOW.T_SIZE * 0.34, FLOW.T_LH, met.labelLines);
  if (met.subLines.length) {
    const subTop = blockTop + met.labelLines.length * FLOW.T_LH + FLOW.LABEL_SUB_GAP;
    out += centeredText('s', cx, subTop + FLOW.S_LH / 2 + FLOW.S_SIZE * 0.34, FLOW.S_LH, met.subLines);
  }
  return out;
}

// renderFlowDiagram(): a deterministic FlowSpec → SVG renderer. Box heights are DYNAMIC (wrapped text, never
// truncated); a lane's row height = its tallest box; lanes stack by accumulating those heights so nothing
// overlaps; the hub + its connector arrows are re-anchored to the new positions. Returns '' when not cleanly
// layout-able. Self-contained (no external hosts, one arrow marker).
export function renderFlowDiagram(flow: FlowSpec, figureClass = ''): string {
  if (!isRenderableFlow(flow)) return '';
  const nLanes = flow.lanes.length;
  const maxSteps = Math.max(...flow.lanes.map((l) => l.steps.length));
  const stepsW = maxSteps * FLOW.BW + (maxSteps - 1) * FLOW.GX;
  const hasHub = !!(flow.hub && flow.hub.label);
  const innerW = FLOW.BW - 2 * FLOW.BOX_PX;

  const stepX = (i: number): number => FLOW.MARGIN_L + i * (FLOW.BW + FLOW.GX);

  // Measure every step; each lane's ROW HEIGHT = its tallest box. Then stack the lanes by accumulating those
  // heights (+ the title band + the inter-lane gap) so variable-height boxes never collide with the lane below.
  const laneMet: NodeMetrics[][] = flow.lanes.map((l) =>
    l.steps.map((s) => measureNode(s.label, s.sub && s.sub.trim() ? wrapText(s.sub, FLOW.S_SIZE, innerW) : [], innerW, FLOW.BOX_MIN_H)),
  );
  const laneRowH = laneMet.map((ms) => Math.max(...ms.map((mm) => mm.h)));
  const boxesTop: number[] = [];
  const laneBottom: number[] = [];
  let cursor = FLOW.TOP;
  for (let j = 0; j < nLanes; j++) {
    boxesTop[j] = cursor + FLOW.LABEL_H; // title band above the boxes
    laneBottom[j] = boxesTop[j] + laneRowH[j];
    cursor = laneBottom[j] + FLOW.LANE_VGAP;
  }
  const laneCy = (j: number): number => boxesTop[j] + laneRowH[j] / 2;

  // Hub — measured like a node (wrapped label + wrapped subs), floored, vertically CENTERED on the whole lane band.
  const hubX = FLOW.MARGIN_L + stepsW + FLOW.HUB_GAP;
  const hubInnerW = FLOW.HUB_W - 2 * FLOW.BOX_PX;
  const hubSubLines = hasHub ? (flow.hub!.sub ?? []).slice(0, 3).flatMap((s) => wrapText(s, FLOW.S_SIZE, hubInnerW)) : [];
  const hubMet: NodeMetrics = hasHub
    ? measureNode(flow.hub!.label, hubSubLines, hubInnerW, FLOW.HUB_MIN_H)
    : { h: 0, labelLines: [], subLines: [] };
  const rowsTop = boxesTop[0];
  const rowsBottom = laneBottom[nLanes - 1];
  const hubY = hasHub ? (rowsTop + rowsBottom) / 2 - hubMet.h / 2 : 0;

  const width = hasHub ? hubX + FLOW.HUB_W + FLOW.MARGIN_R : FLOW.MARGIN_L + stepsW + FLOW.MARGIN_R;
  const height = Math.max(rowsBottom, hasHub ? hubY + hubMet.h : 0) + FLOW.TOP;
  const attachY = (j: number): number => hubY + (hubMet.h * (j + 1)) / (nLanes + 1);
  const laneTitleMaxW = width - FLOW.MARGIN_L - FLOW.MARGIN_R; // left-aligned, spans the inner width

  const arwId = 'f-arw';
  const parts: string[] = [];

  // hub (drawn first so arrows overlay its edge cleanly)
  if (hasHub) parts.push(renderNode(hubX, hubY, FLOW.HUB_W, hubMet.h, FLOW.HUB_RX, 'hub', hubMet));

  flow.lanes.forEach((lane, j) => {
    const cy = rnd(laneCy(j));
    const m = lane.steps.length;
    const dir: 'in' | 'out' = lane.dir === 'out' ? 'out' : 'in';
    parts.push(`<text class="lane" x="${FLOW.MARGIN_L}" y="${rnd(boxesTop[j] - 6)}">${esc(clipLabel(lane.title, 10.5, laneTitleMaxW))}</text>`); // .lane font: 10.5px
    // every box in the lane is drawn at the lane's row height (the max) so the row aligns; content stays centered.
    lane.steps.forEach((step, i) =>
      parts.push(renderNode(stepX(i), boxesTop[j], FLOW.BW, laneRowH[j], FLOW.RX, step.kind === 'gate' ? 'gate' : 'box', laneMet[j][i])),
    );

    // inter-step arrows (horizontal, at the lane's vertical center)
    for (let i = 0; i < m - 1; i++) {
      if (dir === 'in') parts.push(`<path class="arw" d="M${stepX(i) + FLOW.BW},${cy} L${stepX(i + 1) - 6},${cy}" marker-end="url(#${arwId})"/>`);
      else parts.push(`<path class="arw" d="M${stepX(i + 1)},${cy} L${stepX(i) + FLOW.BW + 6},${cy}" marker-end="url(#${arwId})"/>`);
    }

    // hub connector for this lane's terminal (rightmost) step — endpoints recomputed for the variable-height layout
    if (hasHub) {
      const lastRight = stepX(m - 1) + FLOW.BW;
      const ay = rnd(attachY(j));
      if (dir === 'in') {
        const end = hubX - 6;
        const dx = end - lastRight;
        parts.push(`<path class="arw" d="M${lastRight},${cy} C${rnd(lastRight + dx * 0.5)},${cy} ${rnd(end - dx * 0.35)},${ay} ${end},${ay}" marker-end="url(#${arwId})"/>`);
      } else {
        const end = lastRight + 6;
        const dx = hubX - end;
        parts.push(`<path class="arw" d="M${hubX},${ay} C${rnd(hubX - dx * 0.35)},${ay} ${rnd(end + dx * 0.5)},${cy} ${end},${cy}" marker-end="url(#${arwId})"/>`);
      }
      if (lane.edgeLabel) {
        const midX = rnd((lastRight + hubX) / 2);
        const ly = dir === 'in' ? cy + 23 : cy - 21;
        parts.push(`<text class="al" x="${midX}" y="${rnd(ly)}" text-anchor="middle">${esc(clipLabel(lane.edgeLabel, 10.5, FLOW.HUB_GAP - 20))}</text>`); // .al font: 10.5px
      }
    }
  });

  const aria = esc(`${flow.lanes.map((l) => l.title).join(' / ')}${hasHub ? ` → ${flow.hub!.label}` : ''}`);
  const hint = SCOPED_LABELS.enlargeHint;
  return `<figure class="dg${figureClass}">
      <span class="dg-hint">${esc(hint)}</span>
      <svg viewBox="0 0 ${rnd(width)} ${rnd(height)}" role="img" class="flow" aria-label="${aria}">
        <defs><marker id="${arwId}" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-3)"/></marker></defs>
        ${parts.join('\n        ')}
      </svg>
    </figure>`;
}

// ── the full document ───────────────────────────────────────────────────────────────────────────────────────
export function renderScopedReport(model: ScopedReportModel): string {
  const {
    brand, client, scope, date, confidential, title, question,
    scopeBlock, bottomLine, mechanism, flow, tightening, evidence, notVerified, partial,
  } = model;
  const L = SCOPED_LABELS;
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  const empty = (s?: string): boolean => !s;

  const partialBanner = partial ? `\n  <div class="partial">${L.partialBanner}</div>\n` : '';

  // A uniform in-panel section: heading (RAW HTML) + body. `headingExtra` is appended to the right of the title
  // (used only by the tighten panel's effort tooltip).
  const panelSection = (headingHtml: string, body: string, headingExtra = ''): string =>
    `      <div class="p-sec">\n        <div class="p-h">${headingHtml}${headingExtra}</div>\n${body}\n      </div>`;
  // The ONE unified list (honey dot + even rhythm). Items are RAW. `muted` greys not-covered. NOTE: the
  // modifier is `muted`, NOT `dim` — the shared REPORT_CSS has an unrelated `.dim` (Full-Scan dimension card:
  // white surface + border + radius) that would wrongly frame a `.list.dim` not-covered list.
  const list = (items: string[], muted = false): string =>
    `        <ul class="list${muted ? ' muted' : ''}">\n          ${items.map((x) => `<li>${x}</li>`).join('\n          ')}\n        </ul>`;

  // ── Panel 1 · Answer & How it works ──────────────────────────────────────────────────────────────────────
  const p1: string[] = [];
  // When a distinct short title drives the h1, the ORIGINAL question moves here — a low-key labelled reminder ABOVE
  // the Answer. `question` is already redacted (model.question) and escaped here — same safety as when it was the h1.
  if (title) p1.push(`        <div class="yourq">\n          <div class="yourq-k">${esc(L.yourQuestion)}</div>\n          <p class="yourq-t">${esc(question)}</p>\n        </div>`);
  const bl = bottomLine.filter((b) => !empty(b));
  if (bl.length) {
    p1.push(panelSection(esc(L.bottomLine), `        <div class="answer-lead">\n${list(bl)}\n        </div>`));
  }
  const mech = (mechanism ?? []).filter((b) => !empty(b));
  // The lightbox clones the figure that was clicked.
  const flowHtml = flow && isRenderableFlow(flow) ? renderFlowDiagram(flow) : '';
  if (mech.length || flowHtml) {
    const paras = mech.map((p) => `        <p class="body">${p}</p>`).join('\n');
    const body = [flowHtml ? `        ${flowHtml}` : '', paras].filter(Boolean).join('\n'); // flow FIRST, then text
    p1.push(panelSection(esc(L.howItWorks), body));
  }

  // ── Panel 2 · Where it can tighten — effort tooltip on the heading, then the work-items cards ─────────────
  const p2: string[] = [];
  const tight = (tightening ?? []).filter((t) => t && (!empty(t.weakness) || !empty(t.fix)));
  if (tight.length) {
    // Effort tooltip (pure-CSS hover/focus).
    const effortTip = `<span class="lg-tip" tabindex="0" aria-label="${esc(L.effortInfo)}">i<span class="lg-pop" role="tooltip">${(['quick_win', 'moderate', 'project'] as const)
      .map((k) => `<span class="lg-item"><span class="chip ${EFFORT_CHIP_CLASS[k]}">${esc(L.effortChip[k])}</span><span class="lg-t">${esc(L.effortLegend[k])}</span></span>`)
      .join('')}</span></span>`;
    // Work-items 4-part card: TITLE (short action, bold + chip) / THE ITEM (fix) / LOCATION (files) / CONTEXT
    // (weakness). fix/weakness/title are RAW; files are PLAIN. THE ITEM only when a distinct
    // title exists (else fix IS the heading). Frameless numbered list (hairline between items).
    const cards = tight
      .map((t, i) => {
        const cls = t.effort ? ` ${EFFORT_CHIP_CLASS[t.effort]}` : '';
        const chip = t.effort ? ` <span class="chip ${EFFORT_CHIP_CLASS[t.effort]}">${esc(L.effortChip[t.effort] ?? '')}</span>` : '';
        const hasTitle = !empty(t.title);
        const heading = hasTitle ? t.title! : t.fix;
        const item = hasTitle && !empty(t.fix)
          ? `\n          <div class="wi-part">\n            <div class="wi-k">${esc(L.tightenItem)}</div>\n            <p class="wi-ctx">${t.fix}</p>\n          </div>`
          : '';
        const loc = t.files?.length
          ? `\n          <div class="wi-part">\n            <div class="wi-k">${esc(L.tightenLocation)}</div>\n            <div class="wi-loc">${t.files.map((f) => esc(f)).join(' · ')}</div>\n          </div>`
          : '';
        const ctx = !empty(t.weakness)
          ? `\n          <div class="wi-part">\n            <div class="wi-k">${esc(L.tightenContext)}</div>\n            <p class="wi-ctx">${t.weakness}</p>\n          </div>`
          : '';
        return `        <div class="tp${cls}">\n          <div class="tp-h"><span class="tp-n">${pad2(i + 1)}</span><b class="tp-title">${heading}</b>${chip}</div>${item}${loc}${ctx}\n        </div>`;
      })
      .join('\n');
    p2.push(panelSection(esc(L.tightening), cards, effortTip));
  }

  // ── Panel 3 · Scope & Evidence — Scope (dual boxes) + Evidence + Not directly verified ────────────────────
  const covered = (scopeBlock?.covered ?? []).filter((b) => !empty(b));
  const notCovered = (scopeBlock?.notCovered ?? []).filter((b) => !empty(b));
  const ev = (evidence ?? []).filter((b) => !empty(b));
  const nv = (notVerified ?? []).filter((b) => !empty(b));
  const p3box = (inner: string): string => `        <div class="p3-box">\n${inner}\n        </div>`;
  const scopeBox = (labelHtml: string, items: string[], muted: boolean): string =>
    `          <div class="p3-box">\n            <div class="p3-box-k">${labelHtml}</div>\n${list(items, muted)}\n          </div>`;
  const p3: string[] = [];
  if (covered.length || notCovered.length) {
    const boxes = [
      covered.length ? scopeBox(esc(L.scopeCovered), covered, false) : '',
      notCovered.length ? scopeBox(esc(L.scopeNotCovered), notCovered, true) : '',
    ].filter(Boolean).join('\n');
    p3.push(panelSection(esc(L.scopeHeader), `        <div class="scope-grid">\n${boxes}\n        </div>`));
  }
  if (ev.length) p3.push(panelSection(esc(L.evidence), p3box(list(ev))));
  if (nv.length) p3.push(panelSection(esc(L.notVerified), p3box(list(nv))));

  // ── assemble the tabs — only panels WITH content; numbered by rendered position; the first is active ──────
  const panels: { id: string; nav: string; body: string }[] = [];
  if (p1.length) panels.push({ id: 'p1', nav: esc(L.navAnswer), body: p1.join('\n') });
  if (p2.length) panels.push({ id: 'p2', nav: esc(L.tightening), body: p2.join('\n') });
  if (p3.length) panels.push({ id: 'p3', nav: esc(L.navScopeEvidence), body: p3.join('\n') });

  const tabsNav = panels
    .map((p, i) => `      <button class="stab${i === 0 ? ' active' : ''}" role="tab" aria-controls="${p.id}" data-act="tab" data-tab="${p.id}"><span class="stab-n">${pad2(i + 1)}</span><span class="stab-t">${p.nav}</span></button>`)
    .join('\n');
  // Each panel is a top-level anchorable SECTION. p.id (p1/p2/p3) is a fixed per-panel-TYPE key (p1 is always
  // the Answer panel, p2 Tightening, p3 Scope & Evidence — assigned by kind, not by rendered position), so it is
  // a content-stable anchor. anchorAttr is inert; setTab keeps keying off data-panel.
  const panelsHtml = panels
    .map((p, i) => `    <section class="panel${i === 0 ? ' active' : ''}" id="${p.id}" role="tabpanel" data-panel="${p.id}"${anchorAttr('section-' + p.id)}>\n${p.body}\n    </section>`)
    .join('\n');

  // Tab switcher (Full-Scan setTab pattern). No backticks / no ${} inside — this file's return is a plain template
  // literal. Self-contained. On print, CSS forces every panel open + hides the nav, so a PDF keeps ALL content.
  const tabScript = panels.length
    ? `\n<script>\n(function(){\n  var tabs=document.querySelectorAll('.scoped-tabs .stab');\n  function setTab(id){\n    var ps=document.querySelectorAll('.qa-panels .panel');\n    for(var i=0;i<ps.length;i++){ps[i].classList.toggle('active',ps[i].getAttribute('data-panel')===id);}\n    for(var j=0;j<tabs.length;j++){tabs[j].classList.toggle('active',tabs[j].getAttribute('data-tab')===id);}\n  }\n  for(var k=0;k<tabs.length;k++){tabs[k].addEventListener('click',function(){setTab(this.getAttribute('data-tab'));});}\n})();\n</script>`
    : '';

  // Flow lightbox — only when a diagram exists. Self-contained; event delegation means a `.dg` in a hidden panel
  // isn't clickable, so it opens only the currently-visible diagram and coexists with setTab.
  const flowLightbox = flowHtml
    ? `\n<div class="dg-lb" id="dgLightbox" role="dialog" aria-modal="true" aria-label="${esc(L.enlargeHint)}">\n  <button class="dg-lb-close" type="button" aria-label="${esc(L.enlargeClose)}">×</button>\n  <div class="dg-lb-inner"></div>\n</div>\n<script>\n(function(){\n  var lb=document.getElementById('dgLightbox'); if(!lb) return;\n  var inner=lb.querySelector('.dg-lb-inner');\n  var figs=document.querySelectorAll('.dg');\n  for(var i=0;i<figs.length;i++){figs[i].setAttribute('role','button');figs[i].setAttribute('tabindex','0');}\n  function openFig(fig){var svg=fig.querySelector('svg'); if(!svg) return; inner.innerHTML=''; inner.appendChild(svg.cloneNode(true)); lb.classList.add('open'); document.body.style.overflow='hidden';}\n  function closeLb(){lb.classList.remove('open'); inner.innerHTML=''; document.body.style.overflow='';}\n  document.addEventListener('click',function(e){var t=e.target; if(!t) return; if(t.closest){if(t.closest('.dg-lb-close')){closeLb();return;} var fig=t.closest('.dg'); if(fig){openFig(fig);return;}} if(t===lb){closeLb();}});\n  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&lb.classList.contains('open')){closeLb();return;} var a=document.activeElement; if((e.key==='Enter'||e.key===' ')&&a&&a.classList&&a.classList.contains('dg')){e.preventDefault(); openFig(a);}});\n})();\n</script>`
    : '';

  const confidLine = esc(confidential && confidential.length ? confidential : L.confidential);
  // h1 = the SHORT title when present, else the question (back-compat). title is UNTRUSTED PLAIN text (run scope
  // label / LLM title) — HTML-escaped here; the <title> tag is escaped by docHead.
  const titleText = title || question;
  const h1Html = esc(titleText);

  return `${docHead(`${brand.name} · ${L.docTitle} · ${titleText}`, SCOPED_EXTRA_CSS)}
<body>
<div class="wrap">
  ${mastheadHtml({ brand, kicker: esc(L.kicker), confidential: confidLine })}

  <div class="doc-head">
    <h1>${h1Html}</h1>
    <div class="doc-meta">
      <span><b>${esc(L.metaClient)}</b> ${esc(client)}</span>
      <span><b>${esc(L.metaScope)}</b> ${esc(scope)}</span>
      <span><b>${esc(L.metaDate)}</b> ${esc(date)}</span>
    </div>
  </div>
${partialBanner}
  <div class="qa-layout">
    <nav class="scoped-tabs" role="tablist" aria-label="${esc(L.docTitle)}">
${tabsNav}
    </nav>
    <div class="qa-panels">
${panelsHtml}
    </div>
  </div>
</div>${tabScript}${flowLightbox}
</body></html>`;
}
