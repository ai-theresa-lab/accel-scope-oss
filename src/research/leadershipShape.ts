// Leadership v5 — the brief's SHAPE, made deterministic (report lens split, Phase 2 shape pass).
//
// WHY. The v5 contract fixes the shape (title → the lead card → the capability map → one card per affected capability →
// one line each for open / ruled out), but the author is a model and the contract is advice. A re-render of
// the umami report put an "AT A GLANCE — YOUR THREE QUESTIONS" list and a 3-number KPI strip ABOVE the <h1>, the lead
// card after it, and repeated the asks again at the end ("WHAT YOU ASKED US TO CHECK") — 531 EN words against the ≈300
// target. Two contract rewrites had not removed it. So:
//   1. normalizeV5Shape — a pure post-author pass: REMOVE the at-a-glance block, any KPI strip and any author-written
//      answer-back (the answer-back is injected deterministically instead — reportAnchors.answerBackHtml), and REORDER so
//      the <h1> precedes the lead card and the `<!--capability-map-->` anchor sits right after it. Over the document
//      body, idempotent, and fail-open: any markup it cannot parse is returned unchanged.
//   2. tightenV5 — when the brief is still > 1.3× its budget, ONE cheap tool-free Claude pass that may only DELETE or
//      SHORTEN sentences; its output is validated deterministically (same headings, divs, badges, F-ids, placeholders,
//      no new number, shorter) and discarded on any mismatch. Budget-gated, fail-open, THERESA_LEADERSHIP_TIGHTEN=0 off.
import { visibleText, wordCount } from './htmlQc.ts';
import { LENS_MAP_ANCHOR, LENS_MAP_ANCHOR_RE, stripDetailIndex } from '../reportAnchors.ts';
import { currentLedger, llmFailureReason, recordDegraded } from './budget.ts';

// ── 1. normalizeV5Shape ────────────────────────────────────────────────────────────────────────────────────────────

interface Item { kind: 'el' | 'comment' | 'text'; at: number; raw: string; tag?: string; open?: string }
const VOID_TAG = /^(?:br|hr|img|input|meta|link|wbr|source|area|col|embed|param|track)$/i;

/** End offset (exclusive) of the element opening at `at`, by same-name depth; -1 when unbalanced. */
function elementEnd(s: string, at: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = at;
  let depth = 0;
  for (let t = re.exec(s); t; t = re.exec(s)) {
    if (t[2]) continue;
    depth += t[1] ? -1 : 1;
    if (depth === 0) return t.index + t[0].length;
  }
  return -1;
}

/** The top-level children of a fragment (elements, comments, non-blank text), with offsets; null on any parse doubt. */
function childrenOf(s: string): Item[] | null {
  const out: Item[] = [];
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/y;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; continue; }
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      if (e < 0) return null;
      out.push({ kind: 'comment', at: i, raw: s.slice(i, e + 3) }); i = e + 3; continue;
    }
    if (c === '<') {
      open.lastIndex = i;
      const m = open.exec(s);
      if (!m) return null;                                   // a stray '<' or a closing tag at the top: not a shape we know
      const tag = m[1].toLowerCase();
      if (tag === 'script' || tag === 'style') { const e = s.toLowerCase().indexOf(`</${tag}`, i); if (e < 0) return null; const g = s.indexOf('>', e); if (g < 0) return null; out.push({ kind: 'el', at: i, raw: s.slice(i, g + 1), tag, open: m[0] }); i = g + 1; continue; }
      const end = VOID_TAG.test(tag) || m[0].endsWith('/>') ? i + m[0].length : elementEnd(s, i, tag);
      if (end < 0) return null;
      out.push({ kind: 'el', at: i, raw: s.slice(i, end), tag, open: m[0] }); i = end; continue;
    }
    const n = s.indexOf('<', i);
    const e = n < 0 ? s.length : n;
    if (s.slice(i, e).trim()) out.push({ kind: 'text', at: i, raw: s.slice(i, e) });
    i = e;
  }
  return out;
}

// The container the brief's blocks are children of: the body itself, or — the usual shape — its sole wrapper column
// (`<div class="wrap">`), descended at most three levels. Offsets into the body; null on any parse doubt.
function containerOf(body: string): { start: number; end: number } | null {
  let start = 0, end = body.length;
  for (let depth = 0; depth < 3; depth++) {
    const kids = childrenOf(body.slice(start, end));
    if (!kids) return null;
    // A <script> / <style> beside the column (a page-level script after the wrapper) does not make it a non-sole wrapper.
    const els = kids.filter((k) => k.kind !== 'comment' && !(k.kind === 'el' && (k.tag === 'script' || k.tag === 'style')));
    if (els.length !== 1 || els[0].kind !== 'el' || !/^(?:div|main|article|section)$/.test(els[0].tag!) || /^<h1\b/i.test(els[0].raw)) break;
    const el = els[0];
    const innerStart = start + el.at + el.open!.length;
    const close = el.raw.lastIndexOf('</');
    if (close < 0) return null;
    start = innerStart; end = start - el.open!.length + close;
  }
  return { start, end };
}

const classOf = (open = ''): string => (/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i.exec(open) ?? []).slice(1).find((x) => x !== undefined) ?? '';
const textOf = (html: string): string => visibleText(html).replace(/\s+/g, ' ').trim();
// The block's own label: its first heading, or its first eyebrow / kicker / label element.
const HEAD_RE = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>|<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["']?[^"'>]*\b(?:eyebrow|kicker|k|label|title|head|heading|overline)\b[^>]*>([\s\S]*?)<\/\3\s*>/i;
const headOf = (raw: string): string => { const m = HEAD_RE.exec(raw); return m ? textOf(m[2] ?? m[4] ?? '') : ''; };

export const GLANCE_RE = /at[\s-]+a[\s-]+glance|\bglance\b/i;
export const ASKED_RE = /what you asked|you asked us|asked us to (?:check|look)|your (?:\w+ )?questions|how we addressed your/i;
const DECISIONS_RE = /decisions? (?:needed|to make)/i;
const KPI_CLASS_RE = /\b(?:kpi(?:s|-strip|-row|strip|row)?|stat(?:s)?-(?:row|strip)|metric-(?:row|strip|cards))\b/i;
const LEAD_CLASS = /\b(?:lead|verdict|hero|bottom-?line)\b/i;
const META_CLASS = /\b(?:eyebrow|meta|kicker|overline)\b/i;
const SUB_CLASS = /\b(?:sub|subtitle|deck|dek|standfirst|meta)\b/i;
const NUMBER_LEAD = /^[~≈<>+−-]?\$?\d[\d.,]*\s*(?:%|x|×|k|m)?(?:\s|$)/i;

/** A row of ≥ 2 small cards whose main content is a bare number (the KPI strip the v5 contract bans), or class kpi-*. */
function isKpiStrip(it: Item): boolean {
  if (KPI_CLASS_RE.test(classOf(it.open))) return true;
  const inner = it.raw.slice(it.open!.length, it.raw.lastIndexOf('</'));
  const kids = childrenOf(inner);
  if (!kids || kids.length < 2 || kids.some((k) => k.kind !== 'el')) return false;
  return kids.every((k) => { const t = textOf(k.raw); return t.length > 0 && t.length <= 60 && NUMBER_LEAD.test(t); });
}

export interface ShapeReport { html: string; actions: string[] }

function normalizeBody(body: string): ShapeReport {
  const same = { html: body, actions: [] as string[] };
  const box = containerOf(body);
  if (!box) return same;
  const inner = body.slice(box.start, box.end);
  const kids = childrenOf(inner);
  if (!kids || !kids.length) return same;
  // Units: each child with the whitespace before it, so a moved / removed block takes its own indentation along.
  const units = kids.map((k, i) => ({ k, lead: inner.slice(i === 0 ? 0 : kids[i - 1].at + kids[i - 1].raw.length, k.at) }));
  const trail = inner.slice(kids[kids.length - 1].at + kids[kids.length - 1].raw.length);
  const injected = (u: (typeof units)[number]): boolean => /data-detail-index\s*=/i.test(u.k.open ?? '');
  const isAnchor = (u: (typeof units)[number]): boolean => u.k.kind === 'comment' && LENS_MAP_ANCHOR_RE.test(u.k.raw);
  const hasH1 = (u: (typeof units)[number]): boolean => u.k.kind === 'el' && (u.k.tag === 'h1' || /<h1\b/i.test(u.k.raw));
  const els = units.filter((u) => u.k.kind === 'el' && !injected(u));
  // The lead card: the block holding "Decisions needed", else a lead-classed block, else the block before the anchor.
  const anchorAt = units.findIndex(isAnchor);
  const lead = els.find((u) => DECISIONS_RE.test(textOf(u.k.raw)) && !hasH1(u))
    ?? els.find((u) => LEAD_CLASS.test(classOf(u.k.open)) && !hasH1(u) && !GLANCE_RE.test(headOf(u.k.raw)))
    ?? (anchorAt > 0 && units[anchorAt - 1].k.kind === 'el' && !injected(units[anchorAt - 1]) && !hasH1(units[anchorAt - 1]) ? units[anchorAt - 1] : undefined);
  const h1 = els.find(hasH1);
  const actions: string[] = [];
  // REMOVE: the at-a-glance block, any KPI strip, any author-written answer-back. Never the lead card or the title.
  // A bare heading ("<h2>At a glance</h2><ul>…</ul>" at the top level) takes the list / paragraphs right after it along.
  const drop = new Set<(typeof units)[number]>();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.k.kind !== 'el' || u === lead || u === h1 || injected(u)) continue;
    const head = /^h[2-6]$/.test(u.k.tag!) ? textOf(u.k.raw) : headOf(u.k.raw);
    const why = GLANCE_RE.test(head) ? 'an at-a-glance block' : ASKED_RE.test(head) ? 'an author-written answer-back' : isKpiStrip(u.k) ? 'a KPI strip' : '';
    if (!why) continue;
    drop.add(u); actions.push(`removed ${why}${head ? ` ("${head.slice(0, 48)}")` : ''}`);
    if (/^h[2-6]$/.test(u.k.tag!)) {
      for (let j = i + 1; j < units.length; j++) {
        const n = units[j];
        if (n.k.kind !== 'el' || !/^(?:ul|ol|p|table|dl)$/.test(n.k.tag!) || n === lead) break;
        drop.add(n); i = j;
      }
    }
  }
  let order = units.filter((u) => !drop.has(u));
  // REORDER: the <h1> (with an eyebrow / meta line right before it, and a subtitle line right after it) goes before the
  // lead card when the author put it after.
  if (lead && h1 && order.indexOf(h1) > order.indexOf(lead)) {
    const hi = order.indexOf(h1);
    const pre = hi > 0 && order[hi - 1] !== lead && order[hi - 1].k.kind === 'el' && META_CLASS.test(classOf(order[hi - 1].k.open)) && textOf(order[hi - 1].k.raw).length <= 160 ? order[hi - 1] : null;
    const post = order[hi + 1] && order[hi + 1].k.kind === 'el' && order[hi + 1] !== lead && SUB_CLASS.test(classOf(order[hi + 1].k.open)) && textOf(order[hi + 1].k.raw).length <= 240 ? order[hi + 1] : null;
    const block = [pre, h1, post].filter((x): x is (typeof units)[number] => !!x);
    order = order.filter((u) => !block.includes(u));
    order.splice(order.indexOf(lead), 0, ...block);
    actions.push('moved the title before the lead card');
  }
  // The capability-map anchor right after the lead card — moved there, or added when the author left it out. Not on a
  // view that already carries an injected block (the block follows its anchor; moving one would split them).
  let rebuilt = order.map((u) => u.lead + u.k.raw).join('') + trail;
  if (lead && !units.some(injected)) {
    const a = order.findIndex(isAnchor);
    const li = order.indexOf(lead);
    if (a !== li + 1) {
      const nested = a < 0 && LENS_MAP_ANCHOR_RE.test(inner);
      if (!nested) {
        const kept = order.filter((u) => !isAnchor(u));
        const at = kept.indexOf(lead) + 1;
        const anchorUnit = a >= 0 ? order[a] : { k: { kind: 'comment' as const, at: -1, raw: LENS_MAP_ANCHOR }, lead: lead.lead || '\n' };
        kept.splice(at, 0, anchorUnit);
        order = kept;
        rebuilt = order.map((u) => u.lead + u.k.raw).join('') + trail;
        actions.push(`${a >= 0 ? 'moved' : 'added'} the capability-map anchor right after the lead card`);
      }
    }
  }
  if (!actions.length) return same;
  return { html: body.slice(0, box.start) + rebuilt + body.slice(box.end), actions };
}

/** The <body> content of a document (the whole string when it has no <body>), as offsets. */
export function bodyRange(html: string): { start: number; end: number } {
  const open = /<body\b[^>]*>/i.exec(html);
  if (!open) return { start: 0, end: html.length };
  const start = open.index + open[0].length;
  const close = html.toLowerCase().lastIndexOf('</body');
  return { start, end: close >= start ? close : html.length };
}

/** The v5 shape pass with what it did (for the run log). */
export function normalizeV5ShapeReport(html: string): ShapeReport {
  try {
    const { start, end } = bodyRange(html);
    const r = normalizeBody(html.slice(start, end));
    if (!r.actions.length) return { html, actions: [] };
    return { html: html.slice(0, start) + r.html + html.slice(end), actions: r.actions };
  } catch { return { html, actions: [] }; }   // fail-open: never lose the brief over a shape pass
}
export function normalizeV5Shape(html: string): string { return normalizeV5ShapeReport(html).html; }

// ── 2. the tightening pass ─────────────────────────────────────────────────────────────────────────────────────────

export const TIGHTEN_SLACK = 1.3;
export const TIGHTEN_MIN_USD = 0.15;
export const TIGHTEN_MODEL = (process.env.THERESA_LEADERSHIP_TIGHTEN_MODEL || 'claude-haiku-4-5').trim();
type Budget = { words: number };

/** Authored words (injected blocks stripped, as WORDBUDGET counts), and whether they run over 1.3× the budget. */
export function tightenNeed(html: string, budget: Budget): { words: number; over: boolean } {
  const words = wordCount(stripDetailIndex(html));
  return { words, over: words > budget.words * TIGHTEN_SLACK };
}

// What the model must not touch is swapped for opaque placeholders: the <head>, styles, scripts, SVGs, every HTML comment
// (the capability-map anchor included) and any injected block. Fewer tokens, and nothing there to "tidy".
const PH = (i: number): string => `⟦K${i}⟧`;
const PH_RE = /⟦K(\d+)⟧/g;
export function maskForTighten(html: string): { masked: string; kept: string[] } {
  const kept: string[] = [];
  const keep = (m: string): string => { kept.push(m); return PH(kept.length - 1); };
  let s = html.replace(/<head\b[\s\S]*?<\/head\s*>/i, keep).replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, keep).replace(/<!--[\s\S]*?-->/g, keep);
  // Injected blocks (data-detail-index): whole-element, by div depth.
  for (let m = /<div\b[^>]*data-detail-index\s*=[^>]*>/i.exec(s); m; m = /<div\b[^>]*data-detail-index\s*=[^>]*>/i.exec(s)) {
    const end = elementEnd(s, m.index, 'div');
    if (end < 0) break;
    s = s.slice(0, m.index) + keep(s.slice(m.index, end)) + s.slice(end);
  }
  return { masked: s, kept };
}
export function unmaskTightened(s: string, kept: string[]): string { return s.replace(PH_RE, (_m, i: string) => kept[Number(i)] ?? ''); }

export function tightenPrompt(masked: string, before: number, budget: Budget): string {
  return `You are TIGHTENING a finished HTML brief for a busy executive. It is over its length budget: it has ${before}
words (target ≈${budget.words}).
DELETE or SHORTEN sentences INSIDE the existing elements until it fits its target. Rules — breaking ANY of them
discards your whole edit:
• Keep every heading (<h1>…<h6>) with its exact text, every <div> with its exact tag and attributes in the same order,
  every badge, every finding id (F-01, F-02 …), and every placeholder token like ⟦K3⟧ exactly once and in place.
• You may delete a whole <li> or <p>, or cut words inside one. Keep the verdict sentence and each "decision" item's
  decision + who decides.
• NEVER add anything: no new word, number, claim, element or attribute. Never change or round a number.
Output ONLY the complete edited HTML, from its first character to its last — no explanation, no code fence.

${masked}`;
}

const headings = (h: string): string[] => [...h.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => `${m[1].toLowerCase()}:${textOf(m[2])}`);
const divOpens = (h: string): string[] => (h.match(/<div\b[^>]*>/gi) ?? []).map((x) => x.replace(/\s+/g, ' '));
const fids = (h: string): string => [...new Set(visibleText(h).match(/\bF-\d{2,3}\b/g) ?? [])].sort().join(',');
const badges = (h: string): number => (h.match(/<[a-z][a-z0-9]*\b[^>]*\bclass\s*=\s*["']?[^"'>]*\bbadge\b/gi) ?? []).length;
const numbers = (h: string): string[] => visibleText(h).match(/\d+(?:[.,]\d+)*/g) ?? [];

/** Why a tightened draft is refused (compared to the masked input it was made from), or null to accept it. */
export function tightenRejectReason(maskedBefore: string, maskedAfter: string, before: number, after: number): string | null {
  const ph = (s: string): string => [...s.matchAll(PH_RE)].map((m) => m[1]).join(',');
  if (ph(maskedAfter) !== ph(maskedBefore)) return 'a protected block (placeholder) was dropped, duplicated or moved';
  if (headings(maskedAfter).join('\n') !== headings(maskedBefore).join('\n')) return 'a heading changed';
  if (divOpens(maskedAfter).join('\n') !== divOpens(maskedBefore).join('\n')) return 'a card / container changed';
  if (badges(maskedAfter) !== badges(maskedBefore)) return 'a badge was dropped';
  if (fids(maskedAfter) !== fids(maskedBefore)) return 'the finding ids changed';
  const had = new Set(numbers(maskedBefore));
  const added = numbers(maskedAfter).filter((n) => !had.has(n));
  if (added.length) return `new number(s): ${[...new Set(added)].slice(0, 4).join(', ')}`;
  if (after > before) return 'the brief got longer';
  if (after === before) return 'nothing was cut';
  return null;
}

export interface TightenResult { html: string; ran: boolean; accepted: boolean; reason: string; before: number; after?: number; costUsd: number }
export interface TightenOpts {
  budget: Budget;
  authToken?: string;
  log?: (m: string) => void;
  /** Test seam: the model call (default: runAgent, tool-free, TIGHTEN_MODEL, one turn). */
  call?: (prompt: string) => Promise<{ text: string; costUsd: number; error?: string }>;
  /** Test seam: the budget ledger (default: the run's). */
  ledger?: { total: number; remaining(): number } | null;
  env?: Record<string, string | undefined>;
}
const fmt = (n: number): string => `${n} words`;

/**
 * ONE budget-gated tightening pass over a v5 brief that runs more than 1.3× its word budget. Fail-open everywhere: a
 * skip, a model failure or a draft that fails validation keeps the input unchanged (and says why in the log).
 */
export async function tightenV5(html: string, o: TightenOpts): Promise<TightenResult> {
  const log = o.log ?? (() => {});
  const env = o.env ?? process.env;
  const before = tightenNeed(html, o.budget);
  const counts = before.words;
  const done = (reason: string, extra: Partial<TightenResult> = {}): TightenResult => ({ html, ran: false, accepted: false, reason, before: counts, costUsd: 0, ...extra });
  if (String(env.THERESA_LEADERSHIP_TIGHTEN ?? '').trim() === '0') { log('  ↳ leadership tighten: disabled (THERESA_LEADERSHIP_TIGHTEN=0)'); return done('disabled'); }
  if (!before.over) { log(`  ↳ leadership tighten: not needed (${fmt(counts)}; budget ≈${o.budget.words} × ${TIGHTEN_SLACK})`); return done('within budget'); }
  const ledger = o.ledger === undefined ? currentLedger() : o.ledger;
  if (ledger && ledger.total !== Infinity && ledger.remaining() < TIGHTEN_MIN_USD) {
    const why = `leadership tighten skipped — $${ledger.remaining().toFixed(2)} left of the cap (needs ≈$${TIGHTEN_MIN_USD.toFixed(2)}); the brief ships over its word budget (${fmt(counts)})`;
    log(`  ↳ ${why}`); recordDegraded('leadership-writer', why);
    return done('budget');
  }
  const { masked, kept } = maskForTighten(html);
  const call = o.call ?? (async (prompt: string) => {
    const { runAgent } = await import('./agent.ts');
    const r = await runAgent({ cwd: process.cwd(), prompt, model: TIGHTEN_MODEL, maxTurns: 1, toolFree: true, maxBudgetUsd: 0.4, authToken: o.authToken, label: 'leadership-tighten' });
    return { text: String(r.text || r.allText || ''), costUsd: r.costUsd ?? 0, ...(r.error ? { error: r.error } : {}) };
  });
  let r: { text: string; costUsd: number; error?: string };
  try { r = await call(tightenPrompt(masked, counts, o.budget)); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); log(`  ↳ leadership tighten: failed (${llmFailureReason(m)}) — keeping the brief (${fmt(counts)})`); return done('call failed', { ran: true }); }
  // The draft: from its first tag (a stray fence or preamble dropped) to its last.
  const raw = String(r.text ?? '').replace(/^[\s\S]*?(?=<(?:!doctype|html|body|div|⟦)|⟦K)/i, '').replace(/```\s*$/, '').trim();
  if (!raw) { log(`  ↳ leadership tighten: no draft${r.error ? ` (${llmFailureReason(r.error)})` : ''} — keeping the brief (${fmt(counts)})`); return done('no draft', { ran: true, costUsd: r.costUsd }); }
  const out = unmaskTightened(raw, kept);
  const afterNeed = tightenNeed(out, o.budget);
  const after = afterNeed.words;
  const reject = tightenRejectReason(masked, raw, counts, after);
  if (reject) { log(`  ↳ leadership tighten: rejected (${reject}) — keeping the brief (${fmt(counts)})`); return done(`rejected: ${reject}`, { ran: true, after, costUsd: r.costUsd }); }
  log(`  ↳ leadership tighten: ${counts}→${after} words`);
  return { html: out, ran: true, accepted: true, reason: 'accepted', before: counts, after, costUsd: r.costUsd };
}
