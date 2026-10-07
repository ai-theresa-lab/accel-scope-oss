// HTML Quality Controller. The writer authors a self-contained report.html directly; this QC READS that HTML the
// way a human reviewer would — no ReportDraft schema. gpt-5.5 scores the rubrics against the report's VISIBLE text + its
// chart/drawer structure, checking every number against the TRUSTED ledger (the orchestrator's copy, never the writer's).
// A thin deterministic number-audit (the one byte-check that survives — the trust-layer floor) pre-flags un-ledgered
// numbers so the judge can't silently miss a hallucinated figure. Fail-open: a judge failure (no verdict / unparseable
// verdict) returns `judgeUnavailable` with NO HARD finding, and the loop ships the best snapshot (never blanks).
import { openaiComplete } from './openai.ts';
import { llmFailureReason, recordDegraded } from './budget.ts';
import { redactJson } from './reportEvidence.ts';
import { REPORT_STATUS } from '../reportChrome.ts';
import type { Ledger, QcFinding, ReportTier } from './reportRubric.ts';
import type { Hypothesis, MeasurePlane } from './investigation.ts';

// judgeUnavailable: the judge itself could not score this round. That is an OUTAGE, not a writer defect — the result then carries NO HARD finding the writer is asked to fix,
// and the loops stop re-writing (qcRoundStep) and ship the best draft; the run.degraded row records the outage.
// advisory: DETERMINISTIC SOFT findings (never HARD, never gate convergence) — shape/noise nudges the brief asks for
//; the loops append them to a feedback round that is happening anyway.
export interface HtmlQcResult { hard: QcFinding[]; soft: QcFinding[]; summary: string; unledgered: string[]; judgeUnavailable?: boolean; advisory?: QcFinding[] }

// VISIBLE text a reader sees: drop script/style/data-URIs/tags. Numbers in prose/headings/bullets live here.
export function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/data:[^"')\s]+/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ── numerals that are IDENTIFIERS, not metrics ──────────────────────────────────────────────────────────────
// The audit used to flag every numeral, so a code-native report's file:line refs, SHAs, HTTP codes, dates, versions and
// `base64`/`gpt-5.5`/`node:22` came back as "un-ledgered numbers" — and the writer, told to justify each one, grew a
// "numbers ledger" section of pure QC appeasement. None of these is a measured value, so none can be in the ledger.
// Elements whose content is code/identifiers by construction: <code>/<pre>/<kbd>/<samp> and anything classed `mono`.
const CODE_ELEMENT_RE = /<(code|pre|kbd|samp)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const MONO_ELEMENT_RE = /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*(?:"[^"]*\bmono\b[^"]*"|'[^']*\bmono\b[^']*')[^>]*>[\s\S]*?<\/\1\s*>/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s"'<>]+/gi;
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const HTTP_REASON = '(?:OK|Created|Accepted|No Content|Moved Permanently|Found|See Other|Not Modified|Temporary Redirect|Permanent Redirect|Bad Request|Unauthorized|Payment Required|Forbidden|Not Found|Method Not Allowed|Not Acceptable|Request Timeout|Conflict|Gone|Payload Too Large|Unprocessable (?:Entity|Content)|Too Many Requests|Internal Server Error|Not Implemented|Bad Gateway|Service Unavailable|Gateway Timeout)';
// Applied to the VISIBLE text, in order (URLs and file refs first, so their digits never reach a later pattern).
const IDENTIFIER_RES: RegExp[] = [
  URL_RE,
  /[\w./-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+(?:[-–:]\d+)?|#L\d+(?:-L?\d+)?)/g,                  // file:line[-line] · file#L12-L30
  /(?:^|(?<=\s))(?:#L|L|:)\d+(?:[-–]L?\d+)?\b/g,                                                  // bare :123 / L123 refs
  /\blines?\s+\d+(?:\s*[-–]\s*\d+)?\b/gi,                                                          // "line 42", "lines 10-20"
  /(?<![\w.])\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g,                      // ISO date [+ time]
  /(?<![\w.])\d{4}\/\d{1,2}\/\d{1,2}(?![\w.])|(?<![\w.])\d{1,2}\/\d{1,2}\/\d{2,4}(?![\w.])/g,     // 2026/09/27 · 9/27/2026
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?\\b`, 'g'),   // Sep 27, 2026 · 27 Sep
  /(?<![\w.:])\d{1,2}:\d{2}(?::\d{2})?(?![\w.:])/g,                                              // 14:05[:09]
  /(?<![\w.])v?\d+\.\d+\.\d+(?:[-+][\w.]+)?(?![\w])/g,                                             // semver 1.2.3[-rc.1]
  /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?:\s+code)?|response\s+code)\s*[:=]?\s*[1-5]\d{2}(?:\s*(?:\/|,|or|and)\s*[1-5]\d{2})*\b/gi,   // HTTP 404 · status 401/403
  new RegExp(`\\b[1-5]\\d{2}\\s+${HTTP_REASON}\\b`, 'gi'),                                          // 404 Not Found
  /\b[1-5]xx\b/gi,                                                                                  // 5xx
  /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi,                                          // git SHA (7–40 hex, ≥1 letter + ≥1 digit)
  /(?<![\w&])#\d+\b/g,                                                                              // #123 issue/PR refs
  /\b[A-Za-z_]+[-:]?\d[\w.]*(?:[-:]\d[\w.]*)*/g,                                                     // part of a word: base64 · gpt-5.5 · node:22 · k8s · R9
];
// The report text with every identifier numeral removed — what the number audit actually scores. Exported for tests.
export function auditableText(html: string): string {
  const stripped = html.replace(CODE_ELEMENT_RE, ' ').replace(MONO_ELEMENT_RE, ' ');
  let text = visibleText(stripped);
  for (const re of IDENTIFIER_RES) text = text.replace(re, ' ');
  return text;
}

// Thin deterministic number-audit (trust-layer floor, NOT a return to the schema). Pull numbers from the visible text and
// flag any material one not present in the trusted ledger (rounding- + percent-tolerant). Ignores years and small ints
// (ranks / source counts), and every IDENTIFIER numeral — see auditableText. Returns up to 25 un-ledgered tokens —
// fed to the judge as "verify or fix these".
export function numberAudit(html: string, ledger: Ledger): string[] {
  const text = auditableText(html);
  const ledgerNums = ledger.numbers;   // Set<string> (already includes harvested rounded forms)
  const norm = (s: string) => s.replace(/[,%$]/g, '').replace(/\.0+$/, '');
  const inLedger = (tok: string): boolean => {
    const t = norm(tok); if (!t) return true;
    if (ledgerNums.has(tok) || ledgerNums.has(t)) return true;
    const v = Number(t); if (!Number.isFinite(v)) return true;
    for (const ln of ledgerNums) {
      const lv = Number(norm(ln)); if (!Number.isFinite(lv)) continue;
      if (Math.abs(lv - v) < 1e-9) return true;
      // ≤1% rounding tolerance ONLY for a non-integer rate (0.9164→0.92). An integer COUNT must match exactly — a 1%
      // band would wrongly certify 990,001 against a ledger 1,000,000; exact/harvested forms cover counts.
      if (lv !== 0 && !Number.isInteger(lv) && Math.abs((v - lv) / lv) < 0.01) return true;
      // fraction↔percent ONLY for a NON-INTEGER ledger value (a real rate/percent like 0.916 or 91.6). An integer
      // ledger value (a count like 92) must NOT certify a same-digits rate 0.92 via 0.92*100=92 — the
      // legit percent form is already harvested into the ledger, so this aliasing is for non-integer values only.
      if (!Number.isInteger(lv) && (Math.abs(lv * 100 - v) < 0.5 || Math.abs(lv - v * 100) < 0.5)) return true;
    }
    return false;
  };
  const unmatched = new Set<string>();
  // ALSO audit percentages that live ONLY in chart markup — bar widths / SVG geometry in inline styles + attributes that
  // visibleText strips out. Scan the body markup (script/style/data: removed) for %-tokens too.
  // Code/mono elements and URLs (a `%20` in an href) are identifiers here too.
  const bodyMarkup = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/data:[^"')\s]+/g, ' ')
    .replace(CODE_ELEMENT_RE, ' ').replace(MONO_ELEMENT_RE, ' ').replace(URL_RE, ' ');
  const tokens = [...(text.match(/-?\d[\d,]*\.?\d+%?|-?\d+%/g) ?? []), ...(bodyMarkup.match(/\d[\d,]*\.?\d*%/g) ?? [])];
  // capture a leading minus so a negative metric (-8.5%) is audited as -8.5, not 8.5
  for (const tok of tokens) {
    const bare = tok.replace(/[,%]/g, '');
    if (/^-?(19|20)\d{2}$/.test(bare)) continue;                     // a year
    const v = Number(norm(tok));
    // exempt ONLY a single-digit bare integer (a rank / section number) — NOT a percentage and NOT a 2-digit count, which
    // can be a headline metric and must still face the audit.
    if (!tok.includes('%') && Number.isInteger(v) && Math.abs(v) < 10) continue;
    if (!inLedger(tok)) unmatched.add(tok);
  }
  return [...unmatched].slice(0, 25);
}

// Identifiers are not measured numbers — the judge must not raise TRACE on them either, or the writer grows a ledger.
export const TRACE_IDENTIFIERS_NOTE = 'Identifiers are NOT numbers to trace: file:line refs, git SHAs, HTTP status codes, dates, version strings, issue refs, numerals inside <code>/<pre>/.mono or a URL, and numerals that are part of a word (base64, gpt-5.5, node:22).';
// ── which kind of decisive-test drawer a finding can actually carry ─────────────────────────────────────────
// A SQL drawer is re-runnable only when the finding was measured on a plane that EXECUTES a query. A code-native
// finding (the clone via Read/Grep = 'none', the codeintel index, repometa, OSV — the same set auditPlan's
// NON_SQL_PLANES exempts from the SQL lint) has no tables; demanding "re-runnable SQL" for it made the writer invent
// pseudo-SQL over tables that do not exist. Its drawer is a runnable command (git/grep/gh/curl) or a numbered procedure.
export interface PlaneMix { sql: boolean; code: boolean }
const QUERY_PLANES: ReadonlySet<string> = new Set<MeasurePlane>(['warehouse', 'analytics', 'bi', 'custom', 'keyvalue']);
const CODE_PLANES: ReadonlySet<string> = new Set<MeasurePlane>(['none', 'codeintel', 'repometa', 'osv']);
const QUERY_SOURCE_HEADS = new Set(['warehouse', 'bigquery', 'bq', 'analytics', 'amplitude', 'bi', 'redis', 'keyvalue', 'probe', 'sql']);
const CODE_SOURCE_HEADS = new Set(['codeintel', 'repometa', 'osv', 'advisory', 'repogrep', 'repo', 'git', 'clone', 'code', 'file', 'grep']);
// 'query' | 'command' for one hypothesis, from its planned plane, else its evidence source; undefined when unknowable.
export function drawerKindOf(h: Hypothesis): 'query' | 'command' | undefined {
  const plane = h.plannedMeasurement?.requiresPlane;
  if (plane && QUERY_PLANES.has(plane)) return 'query';
  if (plane && CODE_PLANES.has(plane)) return 'command';
  const m = (h.measurement ?? {}) as { source?: string; evidence?: { source?: string } };
  const src = String(m.evidence?.source ?? m.source ?? '').trim().toLowerCase();
  if (!src) return undefined;
  const head = src.split(/[:\s/]/)[0];
  if (QUERY_SOURCE_HEADS.has(head)) return 'query';
  if (CODE_SOURCE_HEADS.has(head) || /^[\w./-]+\.[a-z][a-z0-9]{0,7}(?::\d+(?:-\d+)?)?$/.test(src.split(/\s/)[0])) return 'command';
  return 'query';   // an unrecognised named source (a custom MCP server) — conservative: keep the SQL rule
}
// The report-level mix. Nothing knowable ⇒ the historical SQL-only contract (never silently drop a rubric).
export function drawerPlanes(hypotheses: Hypothesis[]): PlaneMix {
  const kinds = hypotheses.map(drawerKindOf).filter(Boolean);
  if (!kinds.length) return { sql: true, code: false };
  return { sql: kinds.includes('query'), code: kinds.includes('command') };
}
// The brief/rubric wording, ONE place for each so the writer and the judge read the same rule.
export const CODE_DRAWER_RULE = 'the decisive-test drawer (a <details>) behind each finding is a RUNNABLE command (git / grep / gh / curl against the scanned repo) or a numbered manual procedure — NEVER SQL: this area was measured from code, not a database, so there are no tables to query, and SQL over invented tables fails QC.';
export function drawerRubric(mix: PlaneMix = { sql: true, code: false }): string {
  if (mix.sql && !mix.code) return '- SQL: each chart/number has its re-runnable query in a <details> drawer.';
  if (!mix.sql) return "- DRAWER: each finding's decisive test sits in a <details> drawer as a runnable command (git / grep / gh / curl) or a numbered manual procedure. This area was measured from CODE — there is no SQL plane, so do NOT require SQL; a SQL drawer over tables that do not exist FAILS.";
  return '- SQL: a finding measured on a data plane (dossier `drawer: "query"`) has its re-runnable query in a <details> drawer; a finding read from code / the code index / repo metadata / advisories (`drawer: "command"`) instead has a runnable command (git / grep / gh / curl) or a numbered manual procedure — do NOT require SQL for it, and SQL over tables that do not exist FAILS.';
}
export function rubricsArea(mix?: PlaneMix): string {
  return `- TRACE: every number in the visible text traces to ledger.json (rounding allowed: 0.9164→0.92/91.6%) or is explicitly labelled analyst-computed with the computation shown. ${TRACE_IDENTIFIERS_NOTE}
- CHARTS: every section with quantitative results carries a FITTING rendered chart (an <svg> or CSS bars) AND a one-line text takeaway; a quantitative claim with NO chart fails.
${drawerRubric(mix)}
- DEPTH: senior-grade — distinguishes a proxy metric from the keep/cut decision, names the decisive test, decomposes overlaps; not a shallow restatement.
- HONEST: only measured numbers, rounded readably; no over-claim (a proxy is not a proven keep/cut); flags what read-only cannot settle.
- COVERAGE: a section answers every dossier claim; open questions name the next test.
- ENGLISH: the report is written in English (a non-English technical identifier quoted verbatim is fine).
- SELFCONTAINED: no external/CDN requests, no <iframe>/<form>; renders offline.`;
}
export const RUBRICS_AREA = rubricsArea();
export const RUBRICS_LEAD = `- TRACE: every number traces to ledger.json (rounding allowed) or is labelled analyst-computed. ${TRACE_IDENTIFIERS_NOTE}
- DEPTH: senior business framing — proxy vs the keep/cut decision, the decisive test, the business consequence.
- HONEST: only measured numbers, rounded; no over-claim; flags what read-only cannot settle.
- COVERAGE: addresses every dossier claim in business terms.
- ENGLISH: the report is written in English.
- PLAIN: NO plumbing — no SQL, no command lines, no file/table names, and NO internal codenames (snake_case ids, bare i2i/usercf). Say it in plain business English (the product's own feature name, e.g. SmartFeed, is fine). A leadership brief has NO chart SQL drawers.
- CHARTS: every quantitative point carries a fitting chart + a one-line takeaway.
- SELFCONTAINED: no external/CDN requests, no <iframe>/<form>.`;

// ── DETERMINISTIC ADVISORY checks (SOFT — never HARD, never gate convergence, never block shipping) ───────────────
// Each pairs with a brief line (reportPromptContract.test.ts). A brief-only nudge may not be HARD-gated, so these ride
// as `advisory`: logged, and appended to a feedback round the HARD findings already triggered.
const soft = (id: string, reason: string, fix: string): QcFinding => ({ id, severity: 'SOFT', reason, fix });
const tagText = (inner: string): string => inner.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// a "numbers key / numbers ledger / numeral-justification" section is QC-appeasement noise: the certified numbers
// live in the ledger the QC already holds, and a reader gains nothing from a table justifying every figure.
export const NUMBERS_LEDGER_BRIEF = 'Do not add a numbers key / numbers ledger / numeral-justification section.';
const NUMBERS_LEDGER_RE = /\bnumbers?\s+(?:key|ledger|legend|glossary|index|justification|provenance|audit|appendix|used(?:\s+in\s+this\s+report)?)\b|\bnumeral[-\s]+(?:justification|key|ledger|index)\b|\bwhere\s+(?:the|these|our|each)\s+numbers?\s+comes?\s+from\b/i;
export function numbersLedgerSection(html: string): QcFinding | null {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  for (const m of body.matchAll(/<(h[1-6]|summary|caption|legend|dt|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const t = tagText(m[2]);
    if (t.length <= 80 && NUMBERS_LEDGER_RE.test(t)) return soft('NUMBERSLEDGER', `the report carries a numbers-ledger section ("${t.slice(0, 50)}") — QC-appeasement noise, not reader content`, 'delete the section; state each figure where it is used (certified, or labelled analyst-computed with the math inline)');
  }
  if (/\b(?:id|class)\s*=\s*["'][^"']*\bnumbers?-(?:ledger|key|legend)\b/i.test(body)) return soft('NUMBERSLEDGER', 'the report carries a numbers-ledger block', 'delete it; state each figure where it is used');
  return null;
}

// AREA report shape. The brief asks for it; these SOFT checks nudge (never HARD — a layout miss must not make
// the loop unwinnable). The status vocabulary is the four (reportChrome.REPORT_STATUS), with its chip classes.
const STATUS_DEFS = Object.values(REPORT_STATUS);
export const STATUS_VOCAB_BRIEF = `A status is ONLY one of these four, rendered as a chip \`<span class="st st-…">\`: ${STATUS_DEFS.map((d) => `${d.label} (${d.cls})`).join(' / ')}. No other verdict label (never "Supported", "Refuted", "Partially confirmed", "Inconclusive", "Healthy", "Open").`;
export const AREA_SHAPE_BRIEF = `- REPORT SHAPE (the reader sees every verdict before any evidence):
  (a) DIRECTLY after the bottom line, a "Hypotheses at a glance" <table>: one row per hypothesis — id · one plain line · status chip · a link (#anchor) to its section.
  (b) Each hypothesis's detail sits inside a <details> — collapsed by default; add \`open\` only for a Confirmed defect.
  (c) ${STATUS_VOCAB_BRIEF}`;
const GLANCE_RE = /hypothes[ie]s\s+at\s+a\s+glance/i;
export function glanceTableCheck(html: string): QcFinding | null {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const at = body.search(GLANCE_RE);
  if (at >= 0 && /<table\b/i.test(body.slice(at, at + 20000))) return null;
  return soft('GLANCE', at < 0 ? 'no "Hypotheses at a glance" table after the bottom line' : 'the "Hypotheses at a glance" heading has no <table> under it', 'add the at-a-glance table directly after the bottom line: id · one line · status chip · link to its section');
}
const ALLOWED_STATUS = STATUS_DEFS.map((d) => d.label).sort((a, b) => b.length - a.length);
export function statusVocabCheck(html: string): QcFinding | null {
  const bad = new Set<string>();
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  for (const m of body.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const cls = m[2].split(/\s+/);
    if (!cls.some((c) => c === 'st' || /^st-[a-z-]+$/.test(c) || c === 'status' || c === 'verdict')) continue;
    const orig = tagText(m[3]);
    let t = orig;
    if (!t || t.length > 40) continue;
    for (const a of ALLOWED_STATUS) t = t.split(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' ');
    t = t.replace(/[\s·/|:,()\-—–]+/g, ' ').trim();
    if (/\p{L}/u.test(t)) bad.add(orig.slice(0, 30));
  }
  if (!bad.size) return null;
  return soft('STATUSVOCAB', `status chip(s) use a label outside the four statuses: ${[...bad].slice(0, 6).map((b) => `"${b}"`).join(', ')}`, `use only ${STATUS_DEFS.map((d) => d.label).join(' / ')} with their st-* chip classes`);
}

// LEADERSHIP brief shape. Shared by the free-vibe author (leadershipVibe), the structured writer
// (leadershipWriter) and the analyst's leadership tier. Every check below is SOFT.
export const EVIDENCE_TIERS = ['Measured', 'Read from code', 'Needs a test'] as const;
export const EFFORT_LABELS = [
  { key: 'quick_win', label: 'quick win' },
  { key: 'moderate', label: 'moderate' },
  { key: 'large', label: 'large' },
] as const;
export const HEADLINE_MAX = 16;
export const LEADERSHIP_SHAPE_BRIEF = `LEADERSHIP SHAPE (checked on every brief):
• HEADLINE: the page title (<h1>) is ONE short judgement — at most ${HEADLINE_MAX} words. Detail goes to the TL;DR / Bottom line, never into the title.
• NUMBERS ONCE: mark the top KPI strip with class="kpi-strip". Each KPI number appears AT MOST TWICE — once in that strip and at most one more mention. Section cards do NOT repeat the KPI strip; they carry that section's OWN numbers.
• EVIDENCE TIER: every finding carries exactly one evidence-tier badge — ${EVIDENCE_TIERS.join(' / ')} — from the verdict's "evidence tier" line when it has one, else: measured on a live or recorded plane → Measured; read from the source → Read from code; not settled → Needs a test. Never upgrade one.
• EFFORT: when a verdict gives an "effort" line, the finding shows it (${EFFORT_LABELS.map((e) => e.label).join(' / ')}). Never invent an effort the material does not give.
• CHARTS: every chart or diagram has a one-line text takeaway beside it, and its <svg> (or chart container) carries role="img" and an aria-label stating that takeaway.`;

// Leadership v5 (lens split): the same checks without the two that CONTRADICT its contract — "mark the top KPI strip" and
// "detail goes to the TL;DR" invited exactly the KPI strip + at-a-glance list the umami v5 author put above its title.
export const LEADERSHIP_SHAPE_BRIEF_V5 = `LEADERSHIP SHAPE (checked on every brief):
• HEADLINE: the page title (<h1>) is ONE short judgement — at most ${HEADLINE_MAX} words. Detail goes to the lead card, never into the title. The title is the FIRST thing on the page.
• EVIDENCE TIER: every finding carries exactly one evidence-tier badge — ${EVIDENCE_TIERS.join(' / ')} — from the verdict's "evidence tier" line when it has one, else: measured on a live or recorded plane → Measured; read from the source → Read from code; not settled → Needs a test. Never upgrade one.
• EFFORT: when a verdict gives an "effort" line, the finding shows it (${EFFORT_LABELS.map((e) => e.label).join(' / ')}). Never invent an effort the material does not give.`;

// Headline length in English words (a number counts as a word).
export function headlineWords(text: string): number {
  return (text.replace(/\s+/g, ' ').trim().match(/[A-Za-z0-9][\w'’.%×-]*/g) ?? []).length;
}
const firstH1 = (html: string): string | undefined => { const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i); return m ? m[1] : undefined; };
export function headlineCheck(html: string): QcFinding | null {
  const inner = firstH1(html);
  if (inner == null) return null;
  const t = tagText(inner);
  const n = headlineWords(t);
  return n > HEADLINE_MAX ? soft('HEADLINE', `the headline is too long (${n} words: "${t.slice(0, 60)}") — max ${HEADLINE_MAX} words`, 'make the title one short judgement; move the detail into the TL;DR / Bottom line') : null;
}
// The inner HTML of the element opened at `start` (tag-depth aware, same tag name). Undefined if unclosed-at-open.
function elementInner(html: string, start: number): string {
  const open = /<([a-z][a-z0-9]*)\b[^>]*>/iy; open.lastIndex = start;
  const m = open.exec(html); if (!m) return '';
  const tag = m[1].toLowerCase(); const from = start + m[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi'); re.lastIndex = from;
  let depth = 1;
  for (let t = re.exec(html); t; t = re.exec(html)) { if (t[2]) continue; depth += t[1] ? -1 : 1; if (depth === 0) return html.slice(from, t.index); }
  return html.slice(from);
}
const KPI_NUM_RE = /(?<![\w.])\d[\d,]*(?:\.\d+)?\s?(?:%|x|×)?(?!\w|\.\d)/g;
const kpiKey = (tok: string): string => tok.replace(/\s/g, '').replace(/,/g, '').replace(/×/g, 'x');
export function kpiRepeatCheck(html: string): QcFinding | null {
  const over = new Map<string, number>();
  const at = html.search(/<[a-z][a-z0-9]*\b[^>]*\bclass\s*=\s*["'][^"']*\bkpi-strip\b/i);
  if (at < 0) return null;
  const strip = tagText(elementInner(html, at));
  const text = visibleText(html);
  for (const tok of new Set(strip.match(KPI_NUM_RE) ?? [])) {
    const key = kpiKey(tok);
    if (/^\d$/.test(key)) continue;   // a lone single digit is too ambiguous to count
    const n = (text.match(KPI_NUM_RE) ?? []).filter((t) => kpiKey(t) === key).length;
    if (n > 2) over.set(tok.trim(), Math.max(over.get(tok.trim()) ?? 0, n));
  }
  if (!over.size) return null;
  return soft('KPIREPEAT', `KPI number(s) repeated more than twice: ${[...over].slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(', ')}`, 'show each KPI in the kpi-strip plus at most ONE mention; section cards carry their own numbers, not the strip again');
}
// Prose that states how many findings there are must match the run's confirmed count (two-report "needs care": a
// brief said "all three confirmed findings" on a run with 6). Matches "<n> (confirmed) findings/issues/problems",
// and "all <n> …". Number words up to twelve; digits any size.
const EN_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
// A count QUALIFIED by a report lens ("3 business issues", "2 confirmed security findings") is that lens's
// count, not the run's total (umami E2E: a correct "3 business issues" brief on a 6-finding run would have fired).
export type LensCounts = { business: number; security: number; engineering: number };
type CountLens = keyof LensCounts;
const EN_LENS = String.raw`(?:(business|security|engineering)(?:[- ](?:logic|lens|health))?\s+)`;
/** Every finding count the prose states, with its lens when the count is qualified by one. */
export function statedFindingCountsByLens(html: string): { n: number; lens?: CountLens }[] {
  const text = visibleText(html);
  const out: { n: number; lens?: CountLens }[] = [];
  const en = new RegExp(String.raw`\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+${EN_LENS}?(?:confirmed\s+)?${EN_LENS}?(?:findings|issues|problems|defects)\b`, 'gi');
  for (const m of text.matchAll(en)) {
    // "0 of 8 findings measured" (the provenance banner) is a share of all checks, not a finding count.
    if (/\bof\s+$/i.test(text.slice(Math.max(0, (m.index ?? 0) - 4), m.index))) continue;
    const w = m[1].toLowerCase(); const lens = (m[2] ?? m[3])?.toLowerCase() as CountLens | undefined;
    out.push({ n: /^\d+$/.test(w) ? Number(w) : EN_NUM[w], ...(lens ? { lens } : {}) });
  }
  return out;
}
export function statedFindingCounts(html: string): number[] {
  return statedFindingCountsByLens(html).map((c) => c.n);
}
/**
 * `lens` (a lens-split brief, Leadership v5): a count qualified by a lens is compared to THAT lens's count; an unqualified
 * count may be the run's total or — the brief is written from the business verdicts only — the business count.
 */
export function findingCountCheck(html: string, confirmed: number | undefined, lens?: LensCounts): QcFinding | null {
  if (confirmed == null) return null;
  const wrongLens: string[] = []; const wrongTotal: string[] = [];
  for (const c of statedFindingCountsByLens(html)) {
    // A lens-qualified count is never a claim about the total; without lens counts there is nothing to compare it to.
    if (c.lens) { if (lens && c.n !== lens[c.lens]) wrongLens.push(`${c.n} ${c.lens} finding(s) (the run confirmed ${lens[c.lens]} ${c.lens})`); continue; }
    if (c.n !== confirmed && !(lens && c.n === lens.business)) wrongTotal.push(String(c.n));
  }
  // One readable clause per kind (walkthrough: the old single template read "12 business (the run confirmed 11
  // business) finding(s) but the run confirmed 12" — a lens miss wrongly compared to the total too).
  const totals = [...new Set(wrongTotal)];
  const parts = [...new Set(wrongLens), ...(totals.length ? [`${totals.join(' / ')} finding(s) (the run confirmed ${confirmed} in total)`] : [])];
  return parts.length ? soft('FINDINGCOUNT', `the prose states ${parts.join('; ')}`, `state the count as ${confirmed} (the run's confirmed total), or label it by lens ("N business issues"), or drop the number`) : null;
}
export function tierBadgeCheck(html: string): QcFinding | null {
  const text = visibleText(html);
  if (EVIDENCE_TIERS.some((t) => text.includes(t))) return null;
  return soft('TIERBADGE', 'no finding carries an evidence-tier badge', `badge each finding ${EVIDENCE_TIERS.join(' / ')} from its verdict's evidence tier`);
}
// Report lens split (Leadership v5): the brief's WORD BUDGET, in English words of the visible text. The contract
// DECLARES the budget; this only reports a brief that runs more than 20% over it. SOFT, never a gate: an enforced cap
// would truncate.
export const WORD_BUDGET_SLACK = 1.2;
export function wordCount(html: string): number {
  return (visibleText(html).match(/[A-Za-z0-9][\w'’.%×-]*/g) ?? []).length;
}
export function wordBudgetCheck(html: string, budget: { words: number } | undefined): QcFinding | null {
  if (!budget?.words) return null;
  const n = wordCount(html);
  return n > budget.words * WORD_BUDGET_SLACK ? soft('WORDBUDGET', `the brief is over its word budget: ${n} words (budget ≈${budget.words})`, 'cut to the verdict, the decisions and one short card per affected capability; the injected map and lens lines carry the rest') : null;
}

export function leadershipAdvisories(html: string, opts: { confirmed?: number; budget?: { words: number }; lensCounts?: LensCounts } = {}): QcFinding[] {
  return [headlineCheck(html), kpiRepeatCheck(html), tierBadgeCheck(html), findingCountCheck(html, opts.confirmed, opts.lensCounts), wordBudgetCheck(html, opts.budget)].filter((f): f is QcFinding => f !== null);
}

// All deterministic advisories for one tier.
export function advisoryChecks(html: string, tier: ReportTier = 'area'): QcFinding[] {
  const out = [numbersLedgerSection(html)];
  if (tier === 'area') out.push(glanceTableCheck(html), statusVocabCheck(html));
  return [...out.filter((f): f is QcFinding => f !== null), ...(tier === 'leadership' ? leadershipAdvisories(html) : [])];
}
// Render advisories as feedback lines, clearly marked as non-blocking.
export function advisoryFeedback(advisory: QcFinding[] | undefined): string[] {
  return (advisory ?? []).map((f) => `- [${f.id}] (advisory — not blocking) ${f.reason} → ${f.fix}`);
}

// Attach the deterministic advisories to a judge result (also to a judge-unavailable one — they are the only signal then).
export function withAdvisory(v: HtmlQcResult, html: string, tier: ReportTier = 'area'): HtmlQcResult {
  const advisory = advisoryChecks(html, tier);
  return advisory.length ? { ...v, advisory, soft: [...v.soft, ...advisory] } : v;
}

// Score report.html. ctx.ledger/dossier are the TRUSTED orchestrator copies (the judge's ground truth).
export async function runHtmlQc(html: string, ctx: { ledger: Ledger; dossierJson: string; tier?: ReportTier; requireOpenQuestions?: boolean; planes?: PlaneMix; log?: (m: string) => void; onJudgeRaw?: (raw: string, prompt: string) => void }): Promise<HtmlQcResult> {
  return withAdvisory(await judgeHtml(html, ctx), html, ctx.tier ?? 'area');
}
async function judgeHtml(html: string, ctx: Parameters<typeof runHtmlQc>[1]): Promise<HtmlQcResult> {
  const tier = ctx.tier ?? 'area';
  const text = visibleText(html);
  const safeHtml = html.replace(/data:[^"')\s]+/g, 'data:[inlined-asset]');   // strip base64 → keep token budget sane
  const chartCount = (html.match(/<svg|class="[^"]*bar/gi) || []).length;
  const unledgered = numberAudit(html, ctx.ledger);
  const prompt = `You are a STRICT Quality Controller for an evidence-backed audit report (rendered as report.html). Read it as a human reviewer would, then score these HARD rubrics and return STRICT JSON only.
${tier === 'leadership' ? RUBRICS_LEAD : rubricsArea(ctx.planes)}
${tier === 'area' && ctx.requireOpenQuestions ? '- OPENQ: the report renders BOTH (a) a method-coverage matrix — which diagnostic methods were applied to each claim — AND (b) an "Open questions" section listing each coverage gap (concern · why unsettled · next decisive test). The caller supplied open-questions.json (coverage + gaps); a report that omits EITHER FAILS.' : ''}
${unledgered.length ? `A deterministic pre-scan flagged these report numbers as NOT found in the ledger — for EACH, either confirm it is justified (in the ledger under rounding, or labelled analyst-computed with the math shown) or raise a TRACE finding: ${unledgered.join(', ')}.` : 'The deterministic pre-scan found no un-ledgered numbers.'}
The HTML has ~${chartCount} chart-ish elements — verify they are REAL charts with data, not empty.

Return ONLY this JSON (no prose, no fences):
{"hard":[{"id":"TRACE|CHARTS|SQL|DRAWER|DEPTH|HONEST|COVERAGE|ENGLISH|PLAIN|SELFCONTAINED","reason":"...","fix":"...","evidence":"the exact number/phrase"}],"soft":[{"id":"...","reason":"...","fix":"..."}],"summary":"one sentence: is it shippable, and the single biggest gap"}

# REPORT — VISIBLE TEXT (what the reader sees):
${text.slice(0, 18000)}
# REPORT — RAW HTML (assets stripped; chart elements + drawers; truncated):
${safeHtml.slice(0, 12000)}
# dossier — EVERY claim to cover (the caller caps per-claim so all claims survive, not a global truncation):
${ctx.dossierJson}
# ledger.json (the ONLY certified numbers):
${redactJson({ numbers: [...ctx.ledger.numbers], entries: ctx.ledger.entries }).slice(0, 9000)}`;
  let text2 = '';
  // NO maxTokens cap: gpt-5.5 is a reasoning model — a cap counts reasoning tokens and starves the completion to
  // empty. Omitting it lets the model use what it needs; the findings JSON stays small regardless. Never cap an LLM call.
  try { const r = await openaiComplete({ prompt, label: `html-qc:${tier}`, log: ctx.log }); text2 = r.text; ctx.onJudgeRaw?.(r.text, prompt); }
  catch (e) {
    // the draft ships UNSCORED — record it (one banner row per tier; the per-round text stays in the log).
    recordDegraded('html-qc', `${tier} QC judge (gpt) unavailable: ${llmFailureReason((e as Error).message)} — report shipped unscored`);
    // NO HARD finding. A "QC judge unavailable" HARD is something no writer edit can clear, so it used to pin
    // every round at "1 HARD" and burn the whole rewrite budget (seen on real area reports). The outage is recorded
    // above; the loop reads judgeUnavailable and ships the best draft instead of re-writing.
    return judgeUnavailableResult('QC unavailable', unledgered);
  }
  try {
    const m = text2.match(/\{[\s\S]*\}/); const p = m ? JSON.parse(m[0]) : null;
    if (!p || typeof p !== 'object') throw new Error('no JSON object');
    const norm = (a: unknown): QcFinding[] => Array.isArray(a) ? a.filter((x) => x && typeof x === 'object').map((x) => ({ id: String((x as QcFinding).id ?? '?'), severity: 'HARD' as const, reason: String((x as QcFinding).reason ?? ''), fix: String((x as QcFinding).fix ?? '') })) : [];
    return { hard: norm(p?.hard), soft: norm(p?.soft).map((f) => ({ ...f, severity: 'SOFT' as const })), summary: typeof p?.summary === 'string' ? p.summary : '', unledgered };
  } catch {
    // An unparseable verdict is the same outage as no verdict: the writer cannot fix the judge's output format.
    recordDegraded('html-qc', `${tier} QC judge (gpt) returned no parseable verdict — report shipped unscored`);
    return judgeUnavailableResult('QC parse fail', unledgered);
  }
}

// The one shape of a round the judge could not score: zero HARD, zero SOFT, flagged — never a writer defect.
export function judgeUnavailableResult(summary: string, unledgered: string[] = []): HtmlQcResult {
  return { hard: [], soft: [], summary, unledgered, judgeUnavailable: true };
}

// ── The per-round decision both HTML QC loops share (areaReportInSession + analystReport) ─────────────────────────
// PURE so the loop's exits are unit-testable without a writer or a judge. Given the best-so-far and this round's
// scored draft, returns the new best + whether to stop:
//   'judge-unavailable' — the judge could not score. Stop re-writing NOW and ship the best draft: every further
//        round would be scored by the same dead judge, so it is pure spend. A round with no scored best yet ships
//        this (unscored) draft rather than nothing. A scored best is kept over the unscored one — its residual is
//        known; this draft's is not.
//   'converged'         — 0 HARD.
//   'stalled'           — `stallLimit` consecutive rounds failed to beat the best HARD count (the no-progress exit).
export interface QcBest { html: string; hard: QcFinding[]; round: number; unscored?: boolean }
export type QcStop = 'judge-unavailable' | 'converged' | 'stalled' | null;
export function qcRoundStep(best: QcBest | null, stall: number, draft: { html: string; round: number }, v: HtmlQcResult, stallLimit = Number.POSITIVE_INFINITY): { best: QcBest; stall: number; stop: QcStop } {
  if (v.judgeUnavailable) return { best: best ?? { html: draft.html, hard: [], round: draft.round, unscored: true }, stall, stop: 'judge-unavailable' };
  const improved = !best || v.hard.length < best.hard.length;
  const next = !best || v.hard.length <= best.hard.length ? { html: draft.html, hard: v.hard, round: draft.round } : best;
  if (v.hard.length === 0) return { best: next, stall: 0, stop: 'converged' };
  const s = improved ? 0 : stall + 1;
  return { best: next, stall: s, stop: s >= stallLimit ? 'stalled' : null };
}
