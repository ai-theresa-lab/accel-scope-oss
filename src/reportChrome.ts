// Shared visual chrome for Waggle HTML reports — the ONE design system behind both the
// Full-Scan audit report (templateReportHtml.ts) and the Quick Ask scoped report (scopedTemplateHtml.ts), so
// the two read as ONE product. It holds the pieces that must be identical across reports:
//   • REPORT_CSS  — the design-system <style> block (tokens + components, theme-aware light/dark)
//   • docHead()   — the <!doctype>…</head> wrapper (single inline <style>, no external hosts)
//   • mastheadHtml() — the brand chrome (placeholder logo + wordmark, kicker + confidential line)
//   • renderFinding() — one P-badge finding row (.finding / .pbadge / .f-body)
//   • footerHtml() — the footer shell
//   • esc(), PLevel, P_CLASS, P_ORDER
// Pure + deterministic: NO Date.now()/new Date(), NO CDN / remote font / remote image (these reports are saved
// to disk / served standalone, so everything is inline and self-contained).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The logo icon, read from disk at module load and inlined as a data URI so every emitted report
// stays self-contained (no external asset). Same asset + technique as reportHtml.ts (the Full-Scan report), so
// the two share one brand mark. Server-side only — reportChrome is imported by the report renderers, never by
// browser code, so node:fs is safe here.
const BEE_DATA_URI = (() => {
  const png = readFileSync(new URL('./assets/logo.png', import.meta.url));
  return `data:image/png;base64,${png.toString('base64')}`;
})();

export type PLevel = 'P0' | 'P1' | 'P2' | 'P3';

// Presentation dimension id — the six audit dimensions. Mirrors schema.ts::Dimension (presentation
// copy). Shared here (rather than in a report-specific module) so the Quick Ask renderers resolve it from the
// design-system chrome that always ships.
export type DimId = 'delivery_flow' | 'code_health' | 'architecture' | 'knowledge_risk' | 'product_metrics' | 'security_supply';

// esc(): HTML-escape a PLAIN string for BOTH text and double-quoted-attribute contexts (also encodes " and '
// so a value can't break out of href="…"/style="…"). The RAW presentation fields (finding.text, calmNote,
// systemStructure, the scoped report's bottomLine/basis/recommendations) are emitted VERBATIM by the
// renderers — their adapters are responsible for escaping any untrusted data before wrapping it in markup.
export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// anchorAttr(): emit a single INERT ` data-anchor-id="<esc>"` attribute (note the leading space, so it drops
// straight before a tag's closing `>`). It marks a report block as addressable by a STABLE id for the
// dashboard's Notion-style comment-anchoring feature. Purely additive: it changes neither layout nor the
// report's own JS (tabs/toggles/lightbox key off class / data-panel / data-tab / data-id, never this). The id
// MUST be content-stable — a semantic key or a contentHash() of the block's stable content — NEVER a positional
// index/ordinal, so a comment stays pinned to its block across re-renders. Shared by every deterministic renderer
// so the attribute name + escaping stay consistent (reportHtml's client-JS finding cards read a server-computed
// `anchorId`, itself derived via contentHash below, since this helper can't run in the browser).
export function anchorAttr(id: string): string {
  return ` data-anchor-id="${esc(id)}"`;
}

// contentHash(): a deterministic, collision-resistant digest of a CONTENT key — used to derive content-stable
// anchor ids for report blocks with no natural stable id (findings, whose `f.id` is positional `<INV>-<index>`;
// LLM-authored sections, whose displayed number `n` is renumbered by array position). The input is hashed
// VERBATIM — NO normalization — because callers pass canonical serializations (canonicalJson) or semantic keys,
// which are already exact + deterministic; normalizing would only CONFLATE genuinely-distinct content (e.g. a
// path `src/a b.ts` vs `src/a  b.ts`, or case `Foo.ts` vs `foo.ts`). SHA-256 truncated to 16 hex chars (64-bit):
// collision-resistant, so distinct content practically never shares a base id ACROSS regenerations (dedupeAnchorIds
// only resolves collisions WITHIN a single render, so the digest itself must not collide). Contract: unchanged
// content → SAME id (a saved comment stays pinned); changed content → a NEW id (the comment orphans, which the FE
// handles). NEVER positional. NOT a cryptographic-authentication guarantee — a stable, low-collision addressing key.
export function contentHash(key: string): string {
  return createHash('sha256').update(String(key ?? '')).digest('hex').slice(0, 16);
}

// dedupeAnchorIds(): make a list of anchor ids UNIQUE within a single render, deterministically. The content
// hash (or a semantic key) is stable but not guaranteed unique — two blocks whose ENTIRE stable content is
// identical produce the same base id. The FIRST occurrence of a base id keeps it; a later duplicate gets the
// lowest `-<n>` suffix (from -2) that collides with NEITHER an already-emitted output NOR another block's
// RESERVED natural id — so a generated suffix can never land on an unrelated block's id (e.g. dedup of
// ['x','x','x-2'] yields ['x','x-3','x-2'], never a second 'x-2'). This is NOT the positional-id failure mode:
// a suffix only ever applies to blocks indistinguishable by content anyway (a comment on either is equally
// "right"), and the order is stable while that identical-content set is unchanged. Distinct-content blocks keep
// their pure content id. Apply ONCE over a renderer's full list of anchorable blocks — never per-block.
// `reservedIds`: ids already emitted ELSEWHERE in the SAME document that this list must not duplicate (e.g. a
// recall report's FIXED scaffold anchors — section-bottom-line/-caveats/…). They are treated as already-used
// (a dynamic block whose id equals one is suffixed) AND as reserved (a generated suffix avoids them), so the
// scaffold keeps its canonical id and a colliding dynamic block becomes `<id>-2`. This makes the dedupe
// document-wide, not just within the `ids` list.
export function dedupeAnchorIds(ids: string[], reservedIds: readonly string[] = []): string[] {
  const reserved = new Set<string>([...reservedIds, ...ids]);   // a generated suffix must avoid all of these
  const used = new Set<string>(reservedIds);                    // reserved ids count as already emitted
  return ids.map((id) => {
    if (!used.has(id)) { used.add(id); return id; }   // first occurrence keeps its natural id
    let n = 2;
    let candidate = `${id}-${n}`;
    while (used.has(candidate) || reserved.has(candidate)) { n += 1; candidate = `${id}-${n}`; }
    used.add(candidate);
    return candidate;
  });
}

// canonicalJson(): a DETERMINISTIC JSON serialization — object keys sorted recursively (so key insertion order
// can never change the output), array order preserved (it's meaningful content), undefined-valued keys dropped
// (matching JSON.stringify). Feed the result to contentHash to key a comment anchor on a block's COMPLETE stable
// content: pass the whole object and every field is included automatically — no hand-picked field list to fall
// out of sync when the shape grows (the field-enumeration treadmill). Exclude only positional identity (array
// index / a positional `id`) from what you pass in. Two objects hash the same ONLY when byte-identical content.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

// P level → badge CSS class / sort order (P0 highest). Shared so both reports badge + sort findings the same.
export const P_CLASS: Record<PLevel, string> = { P0: 'p0', P1: 'p1', P2: 'p2', P3: 'p3' };
export const P_ORDER: Record<PLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

// The shared design-system CSS — every token (colors, type, spacing) + component (cards, health rows, TOC,
// findings + P-badges, masthead, footer, mini-toc) both reports draw from. Theme-aware: a dark
// prefers-color-scheme block plus explicit :root[data-theme] overrides (the viewer's toggle wins both ways).
// Emitted inside a single <style> by docHead(). (Kept verbatim from the approved Full-Scan template so the
// audit report stays visually unchanged; the scoped report reuses the exact same tokens/components.)
export const REPORT_CSS = `  :root {
    /* Warm neutrals — espresso / honey / cream (matches the console + reportHtml.ts) */
    --ground: #FAF8F4;
    --surface: #FEFDFC;
    --surface-2: #FBF3E2;
    --border: #E7E0D4;
    --border-strong: #D6CBB8;
    --ink: #3E261C;
    --ink-2: #5a4a3d;
    /* Contrast floor: --ink-3 / --accent / --na carry the tiny mono labels (kickers, P3 badge, bundle tags), so each
       clears WCAG AA 4.5:1 on the cream grounds (was #8A7E6E ≈ 3.6–3.9:1, #9A6A0E ≈ 4.2:1). reportChrome.test.ts. */
    --ink-3: #6F6455;
    /* structural accent — honey-link (warm), kept away from the semantic hues */
    --accent: #875D0B;
    --accent-soft: #FBF0D9;
    /* semantic (health) — separate from accent; hues preserved, neutrals warmed to read on cream */
    --p0: #C0392B;
    --p0-bg: #F8E5E1;
    --p1: #D97B2B;
    --p1-bg: #FBEFD9;
    --p2: #B08A2A;
    --p2-bg: #F8F1DC;
    --ok: #2F7D54;
    --ok-bg: #E1F0E7;
    --na: #625849;
    --na-bg: #F1ECE2;

    --mono: "Geist Mono", ui-monospace, Menlo, Consolas, monospace;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
    --maxw: 860px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #120D08;
      --surface: #1C150E;
      --surface-2: #241A12;
      --border: #33261B;
      --border-strong: #463524;
      --ink: #F1E6D8;
      --ink-2: #C9B6A4;
      --ink-3: #9C7F66;
      --accent: #FEC240;
      --accent-soft: rgba(254,194,64,.12);
      --p0: #f0736e; --p0-bg: #2c1919;
      --p1: #e0a253; --p1-bg: #2a2114;
      --p2: #d0b25e; --p2-bg: #262112;
      --ok: #5DBE8B; --ok-bg: rgba(93,190,139,.16);
      --na: #9C7F66; --na-bg: #241A12;
    }
  }
  :root[data-theme="light"] {
    --ground: #FAF8F4; --surface: #FEFDFC; --surface-2: #FBF3E2; --border: #E7E0D4; --border-strong: #D6CBB8;
    --ink: #3E261C; --ink-2: #5a4a3d; --ink-3: #6F6455; --accent: #875D0B; --accent-soft: #FBF0D9;
    --p0: #C0392B; --p0-bg: #F8E5E1; --p1: #D97B2B; --p1-bg: #FBEFD9; --p2: #B08A2A; --p2-bg: #F8F1DC;
    --ok: #2F7D54; --ok-bg: #E1F0E7; --na: #625849; --na-bg: #F1ECE2;
  }
  :root[data-theme="dark"] {
    --ground: #120D08; --surface: #1C150E; --surface-2: #241A12; --border: #33261B; --border-strong: #463524;
    --ink: #F1E6D8; --ink-2: #C9B6A4; --ink-3: #9C7F66; --accent: #FEC240; --accent-soft: rgba(254,194,64,.12);
    --p0: #f0736e; --p0-bg: #2c1919; --p1: #e0a253; --p1-bg: #2a2114; --p2: #d0b25e; --p2-bg: #262112;
    --ok: #5DBE8B; --ok-bg: rgba(93,190,139,.16); --na: #9C7F66; --na-bg: #241A12;
  }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); line-height: 1.62; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: var(--maxw); margin: 0 auto; padding: 40px 24px 96px; }

  .doc-head { margin: 22px 0 14px; }
  .doc-head h1 { font-size: 30px; line-height: 1.2; margin: 0 0 10px; letter-spacing: -.01em; text-wrap: balance; }
  .doc-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--ink-3); font-size: 13.5px; }
  .doc-meta b { color: var(--ink-2); font-weight: 600; }
  .rule { height: 1px; background: var(--border); border: 0; margin: 26px 0; }

  h2.sec { font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3); font-weight: 700; margin: 0 0 14px; }

  /* ---------- global overview ---------- */
  .overview { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 22px; }
  .ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; }
  @media (max-width: 620px) { .ov-grid { grid-template-columns: 1fr; } }
  .ov-item .k { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; font-weight: 600; }
  .ov-item .v { font-size: 14.5px; color: var(--ink); }
  .repo-chip { display: inline-block; font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; margin: 0 5px 5px 0; color: var(--ink-2); }
  .sys-note { grid-column: 1 / -1; font-size: 14px; color: var(--ink-2); line-height: 1.6; }
  .sys-note code { font-family: var(--mono); }
  .bundle-tag { display: inline-block; font-size: 12.5px; background: var(--accent-soft); color: var(--accent); border-radius: 6px; padding: 2px 9px; margin: 0 5px 5px 0; font-weight: 600; }

  .lang-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin: 4px 0 9px; border: 1px solid var(--border); }
  .lang-seg { height: 100%; }
  .lang-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--ink-2); }
  .lang-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .lang-legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

  /* ---------- health summary table ---------- */
  .health { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
  .hrow { display: grid; grid-template-columns: 220px 1fr; align-items: center; gap: 14px; padding: 13px 18px; border-top: 1px solid var(--border); }
  .hrow:first-child { border-top: 0; }
  .hname { font-weight: 600; font-size: 15px; }
  .hname small { display: block; font-weight: 400; font-size: 11.5px; color: var(--ink-3); font-family: var(--mono); letter-spacing: .02em; margin-top: 1px; }
  .status { display: inline-flex; align-items: center; gap: 9px; font-size: 13.5px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; flex: none; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 16%, transparent); }
  .status .q { color: var(--ink-2); }
  .status .q b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .s-p0 { color: var(--p0); } .s-p1 { color: var(--p1); } .s-ok { color: var(--ok); } .s-na { color: var(--na); }
  .hrow.r-p0 { background: color-mix(in srgb, var(--p0-bg) 55%, transparent); }
  a.hrow { text-decoration: none; color: inherit; cursor: pointer; transition: background .12s ease; }
  a.hrow:hover { background: var(--surface-2); }
  a.hrow.r-p0:hover { background: color-mix(in srgb, var(--p0-bg) 72%, transparent); }

  /* ---------- table of contents (document style) ---------- */
  .toc { padding: 4px 2px; }
  .toc-row { display: flex; align-items: baseline; text-decoration: none; color: var(--ink); padding: 6px 0; }
  .toc-row:hover .toc-title { color: var(--accent); }
  .toc-num { flex: none; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .toc-title { flex: none; text-wrap: nowrap; }
  .toc-leader { flex: 1 1 auto; border-bottom: 1px dotted var(--border-strong); margin: 0 10px; transform: translateY(-4px); }
  .toc-val { flex: none; color: var(--ink-3); font-size: 13px; font-variant-numeric: tabular-nums; }
  .toc-l1 { font-weight: 600; font-size: 15.5px; }
  .toc-l1 .toc-num { width: 1.7em; }
  .toc-l1 + .toc-l2 { margin-top: 2px; }
  .toc-l2 { font-size: 14px; padding-left: 26px; color: var(--ink-2); }
  .toc-l2 .toc-num { width: 2.6em; }

  .anchor { scroll-margin-top: 20px; }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }

  /* ---------- dimension detail ---------- */
  .dim { margin-top: 26px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
  .dim-head { display: flex; align-items: center; gap: 12px; padding: 15px 18px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
  .dim-head .dot { width: 12px; height: 12px; }
  .dim-head h3 { margin: 0; font-size: 17px; letter-spacing: -.01em; }
  .dim-head .code { font-family: var(--mono); font-size: 11.5px; color: var(--ink-3); margin-left: auto; }
  .dim-body { padding: 6px 18px 16px; }

  .subcat { margin-top: 14px; }
  .subcat > .sc-label { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); font-weight: 700; margin: 0 0 8px; border-left: 3px solid var(--border-strong); padding-left: 9px; }

  .finding { display: grid; grid-template-columns: 46px 1fr; gap: 12px; padding: 11px 0; border-top: 1px dashed var(--border); }
  .subcat .finding:first-of-type { border-top: 0; }
  .pbadge { font-family: var(--mono); font-size: 12px; font-weight: 700; text-align: center; height: 22px; line-height: 22px; border-radius: 6px; letter-spacing: .02em; }
  .p0 { color: var(--p0); background: var(--p0-bg); }
  .p1 { color: var(--p1); background: var(--p1-bg); }
  .p2 { color: var(--p2); background: var(--p2-bg); }
  .p3 { color: var(--na); background: var(--na-bg); }
  .f-body p { margin: 0; font-size: 14.5px; color: var(--ink); }
  .f-body code { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; color: var(--ink-2); }

  .dim.calm .dim-body { padding: 14px 18px 16px; }
  .calm-note { font-size: 14px; color: var(--ink-2); display: flex; align-items: flex-start; gap: 9px; }
  .calm-note .dot { margin-top: 5px; }
  .calm-note code { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; color: var(--ink-2); }

  /* ---------- masthead / brand ---------- */
  .masthead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 2px 0 15px; margin-top: 16px; border-bottom: 2px solid var(--ink); }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand svg { display: block; }
  .bee { width: 34px; height: 34px; border-radius: 8px; box-shadow: 0 2px 7px rgba(62,38,28,.16); overflow: hidden; flex: none; }
  .wordmark { line-height: 1.12; }
  .wordmark b { font-size: 19px; font-weight: 700; letter-spacing: -.01em; color: var(--ink); }
  .wordmark small { display: block; font-size: 10px; font-weight: 600; letter-spacing: .17em; text-transform: uppercase; color: var(--ink-3); margin-top: 3px; }
  .mh-right { text-align: right; font-size: 10.5px; line-height: 1.6; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; }

  /* ---------- floating mini TOC ---------- */
  .mini-toc { position: fixed; right: 16px; top: 50%; transform: translateY(-50%); z-index: 60; display: flex; flex-direction: column; align-items: flex-end; gap: 9px; padding: 12px 8px; }
  .mini-item { display: flex; align-items: center; gap: 10px; justify-content: flex-end; text-decoration: none; }
  .mini-item .lbl { font-size: 13px; white-space: nowrap; color: var(--ink-2); background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 3px 9px; opacity: 0; transform: translateX(8px); transition: opacity .18s ease, transform .18s ease; pointer-events: none; box-shadow: 0 6px 18px rgba(0,0,0,.08); }
  .mini-item .tick { width: 20px; height: 2px; border-radius: 2px; background: var(--border-strong); transition: width .18s ease, background .18s ease; flex: none; }
  .mini-item.sub .tick { width: 12px; }
  .mini-toc:hover .lbl { opacity: 1; transform: none; }
  .mini-item:hover .tick, .mini-item.active .tick { width: 26px; background: var(--accent); }
  .mini-item.active .lbl { color: var(--ink); font-weight: 600; border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
  @media (max-width: 1120px) { .mini-toc { display: none; } }
  @media (prefers-reduced-motion: reduce) { .mini-item .lbl, .mini-item .tick { transition: none; } }

  footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--border); color: var(--ink-3); font-size: 12.5px; line-height: 1.7; }
  footer b { color: var(--ink-2); }`;

// docHead(): the <!doctype>…</head> wrapper shared by every report. `title` is PLAIN (escaped here). An
// optional `extraCss` is appended INSIDE the same <style> so a report may add its own layout primitives while
// inheriting all shared tokens + components (empty by default → byte-identical to the base head).
export function docHead(title: string, extraCss = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${REPORT_CSS}${extraCss ? `\n${extraCss}` : ''}
</style>
</head>`;
}

// mastheadHtml(): the shared brand chrome — a swappable placeholder hexagon+T logo and the brand wordmark on
// the left; a small right-aligned kicker ('Audit report' for the audit, 'Quick Ask' for Quick Ask) over the
// confidential line. Returns the <header>…</header> block (its own absolute indentation) so the caller places
// it with a 2-space lead (`  ${mastheadHtml(...)}`), matching the surrounding document indentation.
// `kicker` / `confidential` are RAW here (the caller escapes them); the plain brand name/sub are escaped here.
// The ONE product brand string. Reports once carried several spellings of the brand (reversed word order, stray
// product names in the masthead alt text and the Quick Ask wordmark). Every report renderer, the normalizer brief
// and this chrome use this spelling; brandConsistency.test.ts scans the renderer sources.
export const BRAND_NAME = 'Waggle';

// Reports are served under REPORT_CSP (style-src/font-src allow inline + data: only — reports are self-contained by
// contract), so a Google Fonts <link> is blocked, logs a CSP console error on every report view and loads nothing
// Stored reports still carry it, and a model writer may emit one: strip font-host
// <link>s at serve time; the CSS font stacks already fall back to system fonts.
export function stripExternalFontLinks(html: string): string {
  return String(html ?? '').replace(/<link\b[^>]*\bhref=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>\s*/gi, '');
}

// The same for MODEL-authored HTML (the free-vibe reports), which no renderer controls: an author may hard-code its
// own casing (all capitals, say) or the product's former name. Rewrites either, in any casing / separator, in TEXT only —
// tags, attributes, <script> and <style> are left alone (a CSS text-transform stays the author's choice).
const BRAND_VARIANT = /\b(?:accel[\s-]*scope|waggle)\b/gi;
export function normalizeBrand(html: string): string {
  return String(html ?? '').split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]*>)/i)
    .map((seg) => (seg.startsWith('<') ? seg : seg.replace(BRAND_VARIANT, BRAND_NAME)))
    .join('');
}

export function mastheadHtml(opts: { brand: { name: string; sub: string }; kicker: string; confidential: string }): string {
  return `<header class="masthead">
    <div class="brand">
      <span class="bee"><img src="${BEE_DATA_URI}" alt="${BRAND_NAME}" style="width:100%;height:100%;display:block;object-fit:cover;"></span>
      <div class="wordmark"><b>${esc(opts.brand.name)}</b>${opts.brand.sub ? `<small>${esc(opts.brand.sub)}</small>` : ''}</div>
    </div>
    <div class="mh-right">${opts.kicker}<br />${opts.confidential}</div>
  </header>`;
}

// renderFinding(): one P-badge finding row (the shared .finding / .pbadge / .f-body component). `text` is RAW
// (may carry authored inline <code>) — the caller/adapter must escape any untrusted data first.
export function renderFinding(f: { p: PLevel; text: string }): string {
  return `<div class="finding">
          <div class="pbadge ${P_CLASS[f.p]}">${f.p}</div>
          <div class="f-body"><p>${f.text}</p></div>
        </div>`;
}

// footerHtml(): the shared footer shell; `body` is the report-specific closing note (RAW — authored, may
// carry <b>/<code>). Returns <footer>…</footer> for a 2-space-lead placement (`  ${footerHtml(...)}`).
export function footerHtml(body: string): string {
  return `<footer>
    ${body}
  </footer>`;
}

// ── the ONE status vocabulary ─────────────────────────────────────────────────────────────────────────────
// Reports used six-plus verdict words for four states ("supported", "healthy", "checked & healthy", "refuted",
// "open — needs an experiment", "blocked-need-eval", "unmeasured", …), so the same hypothesis read as a different kind
// of result in each tier. Every deterministic renderer and the findings index now speak exactly these four, with one
// chip style each, and the writer briefs (group Y) tell the LLM authors to use the same class names. The chip carries
// its OWN foreground + background (never inherits the host design's tokens), so it stays legible inside any
// LLM-authored design; each pair clears WCAG AA 4.5:1 (reportChrome.test.ts computes it).
export type ReportStatus = 'confirmed' | 'ruled-out' | 'needs-test' | 'not-measurable';
export interface ReportStatusDef { label: string; cls: string }
export const REPORT_STATUS: Readonly<Record<ReportStatus, ReportStatusDef>> = {
  confirmed: { label: 'Confirmed', cls: 'st-confirmed' },
  'ruled-out': { label: 'Ruled out', cls: 'st-ruled-out' },
  'needs-test': { label: 'Needs a test', cls: 'st-needs-test' },
  'not-measurable': { label: 'Not measurable here', cls: 'st-not-measurable' },
};
// Chip colors (fg on bg, light). Exported so the contrast test reads the SAME values the CSS is built from.
export const REPORT_STATUS_COLORS: Readonly<Record<ReportStatus, { fg: string; bg: string }>> = {
  confirmed: { fg: '#8E2A1E', bg: '#F8E5E1' },
  'ruled-out': { fg: '#1D5E3C', bg: '#E1F0E7' },
  'needs-test': { fg: '#6E4A0B', bg: '#FBEFD9' },
  'not-measurable': { fg: '#4F463B', bg: '#EFEAE1' },
};
export const REPORT_STATUS_CSS = `.st{display:inline-block;font:600 11px/1.6 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;text-transform:uppercase;border-radius:6px;padding:1px 7px;white-space:nowrap;vertical-align:baseline}`
  + (Object.keys(REPORT_STATUS) as ReportStatus[]).map((k) => `.${REPORT_STATUS[k].cls}{color:${REPORT_STATUS_COLORS[k].fg}!important;background:${REPORT_STATUS_COLORS[k].bg}!important}`).join('');

/**
 * Map ANY existing verdict / disposition / status word onto the four report statuses. Pure.
 *
 * The inputs this codebase emits: hypothesis status (supported / refuted / open / blocked-need-eval), the writers'
 * disposition (confirmed / healthy / open), investigation VerdictState (win / no-free-lunch / refuted /
 * invalid-multilever / pending / unmeasured), answer-back (supported / refuted / unsettled), mitigation
 * `supported` booleans, evidence disposition (supports / refutes / mixed / neutral), and CoverageGapStatus
 * (unmeasured / blocked / budget_skipped / node_failed / not_evidenceable / claim_rejected).
 * "Not measurable here" is reserved for a question the run's read-only planes CANNOT settle (blocked access,
 * not evidenceable, no applicable plane); anything that merely has not been measured YET is "Needs a test".
 * An unknown word maps to "Needs a test" — never to Confirmed or Ruled out, which are claims the data must make.
 */
export function statusFromVerdict(v: unknown): ReportStatus {
  if (v === true) return 'confirmed';
  if (v === false) return 'ruled-out';
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  switch (s) {
    case 'confirmed': case 'supported': case 'supports': case 'win': case 'no-free-lunch': case 'defect': case 'accept': case 'accepted':
      return 'confirmed';
    case 'ruled-out': case 'refuted': case 'refutes': case 'healthy': case 'checked-&-healthy': case 'invalid-multilever': case 'retracted':
      return 'ruled-out';
    case 'not-measurable': case 'not-measurable-here': case 'unmeasurable': case 'blocked': case 'not-evidenceable': case 'not-applicable': case 'n/a':
      return 'not-measurable';
    default:
      // open / needs-test / blocked-need-eval / pending / unmeasured / unsettled / mixed / neutral / budget-skipped /
      // node-failed / claim-rejected / anything new.
      return 'needs-test';
  }
}

/** One status chip. */
export function statusChipHtml(s: ReportStatus): string {
  const d = REPORT_STATUS[s];
  return `<span class="st ${d.cls}">${esc(d.label)}</span>`;
}

// ── the ONE serve-time readability + print patch, for EVERY report kind ───────────────────────────────────
// Reports are frozen HTML — engineering, leadership, area, Combined, work items, provenance, trace, audit — and most of
// them are LLM-designed, so printing (or "Save as PDF") one used to give a clipped first screen: the engineering report
// is a 100vh flex app with inner scrollers, toggles/rails/assistant widgets print on top of the content, collapsed
// <details> print collapsed, sticky headers repeat, and dark designs print light-on-dark. This block fixes print for all
// of them WITHOUT restyling the on-screen design (everything but the chip classes sits under @media print). It also
// carries REPORT_STATUS_CSS, so an LLM-authored report that uses the status chip classes (as the writer briefs ask) gets
// the shared chip styles. A `beforeprint` script opens every <details> for the print and restores them afterwards, and
// un-fixes any fixed/sticky element CSS cannot select by computed style. Injected by server.ts on BOTH serve paths
// (console + /share); the `data-accel-print` marker makes a second injection a no-op.
export const REPORT_PRINT_MARK = 'data-accel-print="1"';
const PRINT_CSS = `@media print{
html,body{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;background:#fff!important;color:#000!important}
body{display:block!important}
*,*::before,*::after{color:#000!important;box-shadow:none!important;text-shadow:none!important}
*:not(:empty),*::before,*::after{background:transparent!important;-webkit-print-color-adjust:economy;print-color-adjust:economy}
:empty{-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{background:#fff!important}
.mini-toc,.rail,.toc-rail,.side-rail,.assistant,#assistant,[data-assistant],.chat-fab,#repTopbar,.toolbar,.viewsel,.tabbar,.tabs,button{display:none!important}
.stage,.panel.active,.panes,.pane-list,.pane-detail,.fview,.rp-panel.active,main,.app-main,.wrap,.doc{display:block!important;overflow:visible!important;height:auto!important;max-height:none!important}
details>summary{list-style:none}
details:not([open])>*:not(summary){display:block!important}
a{text-decoration:underline!important}
.card,.fcard,.lrow,.bcard,.stat,.score,.finding,.dim,.sec,.lead,.caveat,.decisive,.detail-index,.findings-index tr,figure,svg,img,table tr,li{break-inside:avoid;page-break-inside:avoid}
h1,h2,h3,h4{break-after:avoid;page-break-after:avoid}
.st{border:1px solid #000!important}
}`;
const PRINT_SCRIPT = `(function(){var opened=[],unfixed=[];
window.addEventListener('beforeprint',function(){opened=[];unfixed=[];
var ds=document.querySelectorAll('details:not([open])');for(var i=0;i<ds.length;i++){ds[i].setAttribute('open','');opened.push(ds[i]);}
var all=document.body?document.body.getElementsByTagName('*'):[];for(var j=0;j<all.length;j++){var p=getComputedStyle(all[j]).position;if(p==='fixed'||p==='sticky'){unfixed.push([all[j],all[j].style.getPropertyValue('position'),all[j].style.getPropertyPriority('position')]);all[j].style.setProperty('position','static','important');}}});
window.addEventListener('afterprint',function(){for(var i=0;i<opened.length;i++)opened[i].removeAttribute('open');for(var j=0;j<unfixed.length;j++){var u=unfixed[j];if(u[1])u[0].style.setProperty('position',u[1],u[2]);else u[0].style.removeProperty('position');}opened=[];unfixed=[];});
})();`;
export const REPORT_PRINT_PATCH = `<style ${REPORT_PRINT_MARK}>${REPORT_STATUS_CSS}${PRINT_CSS}</style><script ${REPORT_PRINT_MARK}>${PRINT_SCRIPT}</script>`;

/** Add the print/readability patch before </head> (or at the top of a head-less fragment). Idempotent. */
export function withPrintPatch(html: string): string {
  const src = String(html ?? '');
  if (src.includes(REPORT_PRINT_MARK)) return src;
  const i = src.search(/<\/head>/i);
  return i >= 0 ? src.slice(0, i) + REPORT_PRINT_PATCH + src.slice(i) : REPORT_PRINT_PATCH + src;
}
