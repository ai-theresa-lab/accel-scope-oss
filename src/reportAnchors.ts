// CROSS-REPORT REFERENCES — the `\ref{}` half of the anchoring scheme.
//
// reportChrome.ts already provides the `\label{}` half: contentHash() mints a CONTENT-STABLE id for a report
// block (never positional, so it survives re-renders) and dedupeAnchorIds() makes those ids unique within one
// document. What was missing is anything that RESOLVES such an id, and any way for one report to cite another.
//
// WHY THIS LIVES IN ITS OWN MODULE, rather than each caller deriving ids: dedupeAnchorIds() can suffix a
// colliding id to `-2`, and it does so over the FULL list in one render. An independent recomputation elsewhere
// would produce the un-suffixed id and dangle. The engineering renderer and the leadership writer therefore ask
// the SAME function, in the same order, for the same map — exactly the "two lists that disagreed" failure this
// codebase has already been bitten by twice (the plane classifier vs the measurement router).
import { canonicalJson, contentHash, dedupeAnchorIds } from './reportChrome.ts';
import { findingHasResolvableEvidence, type Finding } from './schema.ts';
import { R7_CODENAME_RE, R7_PLUMBING_RE } from './research/reportRubric.ts';
import { assignDisplayIds, displayIdRank, findingArea } from './findingIds.ts';
import { sinceLastScanLine, uncheckedByWhy, uncheckedWhyText, UNCHECKED_WHYS, type SinceLastScan } from './sinceLastScan.ts';
import type { CapabilityHealth, CapabilityTile, LensBrief, LensLine } from './findingLens.ts';

/** The anchor id for one finding, BEFORE document-wide dedupe. Content-derived, never positional. */
function baseFindingAnchor(f: Finding): string {
  // `id` is excluded because a Finding's own id is POSITIONAL (`<INV>-<index>`): including it would make the
  // anchor move when an unrelated finding is inserted ahead of it, orphaning every citation to it.
  // `lens` / `capability` are excluded too: they are REPORT labels (findingLens.ts), computed at report time for an
  // older checkpoint that lacks them, so hashing them would move every anchor between a fresh run and its replay.
  return `finding-${contentHash(canonicalJson({ ...f, id: undefined, lens: undefined, capability: undefined }))}`;
}

/**
 * findingId -> stable anchor id, deduped document-wide, in the order the findings are given.
 *
 * Callers MUST pass the findings in the same order the engineering report renders them, because dedupe is
 * order-sensitive for identical-content findings. In practice both callers use the run's own findings array.
 */
export function findingAnchorIds(findings: Finding[]): string[] {
  return dedupeAnchorIds(findings.map(baseFindingAnchor));
}

/**
 * findingId -> anchor, for callers that key by id.
 *
 * POSITIONAL is the primary form (findingAnchorIds) because a Finding id is NOT guaranteed unique — the
 * engineering report renders by position, and an existing test legitimately renders two findings that share
 * one id. A by-id map silently collapsed them onto one anchor, so the second finding's citation pointed at the
 * first block. Duplicate ids therefore keep the FIRST occurrence here, and callers that might see duplicates
 * should use the positional form.
 */
export function findingAnchorMap(findings: Finding[]): Map<string, string> {
  findings = findings.filter(findingHasResolvableEvidence);
  const ids = findingAnchorIds(findings);
  const out = new Map<string, string>();
  findings.forEach((f, i) => { if (f.id && !out.has(String(f.id))) out.set(String(f.id), ids[i]); });
  return out;
}

/** One citation the leadership brief can render: a finding, and where its detail lives. */
export interface ReportRef {
  findingId: string;
  anchor: string;
  title: string;
  /** Deep link, when the caller knows the engineering report's URL. Absent ⇒ render as a plain reference. */
  href?: string;
  /** Display id ("F-01"), the SAME one the engineering report's card and the Combined findings index show. */
  displayId?: string;
  /** Grouping key: the owning area (bundle), or absent ⇒ "Other findings". */
  area?: { key: string; label: string };
}

/**
 * Build the citation list for a run.
 *
 * `engineeringUrl` is the path the console serves the engineering report at. When it is absent (a CLI render, a
 * downloaded file) the refs still carry anchor + title so the brief can name where the detail lives WITHOUT
 * emitting a dead link — a citation that 404s is worse than a citation that reads as text.
 */
// The evidence gate, applied to the citation input BEFORE anchors are computed.
//
// finishRun() drops any finding without resolvable evidence just before it renders the engineering report.
// Citations built from the ungated array therefore pointed at anchors that never existed — and worse, the
// dedupe suffix is order-sensitive, so removing an EARLIER identical-content finding renumbers the survivors
// and invalidates a link to a finding that is still in the report. Gating here means the refs are computed
// from exactly the array the report renders.
export function buildReportRefs(findingsIn: Finding[], engineeringUrl?: string): ReportRef[] {
  // The SAME gate finishRun applies before rendering, so the refs describe exactly the array the report
  // renders — including the dedupe order, which shifts when an earlier identical finding is removed.
  const findings = findingsIn.filter(findingHasResolvableEvidence);
  // Anchors are computed over the FULL gated array (ruled-out rows included) because that is what the
  // engineering report renders; skipping a ruled-out row BEFORE this would shift the dedupe suffixes of the
  // confirmed rows after it and dangle their links. The ruled-out rows are dropped only when EMITTING (below).
  const ids = findingAnchorIds(findings);   // POSITIONAL: duplicate finding ids must each get their own citation
  // Display ids over the SAME gated array the engineering report renders, so "F-03" here is "F-03" on its card.
  const dids = assignDisplayIds(findings);
  const refs: ReportRef[] = [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const anchor = ids[i];
    if (!anchor) continue;
    // CONFIRMED findings only. "Where the detail lives" sits in the leadership brief, where a checked-and-
    // healthy hypothesis listed alongside real defects reads as one more problem — one brief listed
    // 5 ruled-out rows as if they were findings.
    if (isRuledOutFinding(f)) continue;
    refs.push({
      findingId: f.id as string,
      anchor,
      title: plainFindingLabel(refSourceText(f)),
      ...(engineeringUrl ? { href: `${engineeringUrl}#${anchor}` } : {}),
      ...(dids[i] ? { displayId: dids[i] } : {}),
      ...(() => { const a = findingArea(f); return a ? { area: a } : {}; })(),
    });
  }
  // Listed in F-id order (severity, then confidence), the order a reader should work in. A ref without an id (a
  // caller that built refs by hand) keeps its relative position at the end — the sort is stable.
  return refs.sort((a, b) => displayIdRank(a.displayId) - displayIdRank(b.displayId));
}

/**
 * Is this a RULED-OUT (refuted — checked and healthy) row rather than a confirmed finding?
 *
 * The recommendation-audit converter (deep.ts hypothesesToFindings) ships refuted hypotheses as Findings and
 * encodes the disposition in severity: `info` = refuted, anything else = confirmed. deep.ts answerBackRows reads
 * the SAME encoding; this is the predicate for surfaces that must show confirmed findings only. Every other
 * source (baseline / research / GCP / deterministic miners) emits only confirmed defects.
 */
export function isRuledOutFinding(f: Pick<Finding, 'source' | 'severity'>): boolean {
  return f.source === 'recommendation-audit' && f.severity === 'info';
}

// The text a citation is labelled with. `title` is the headline, but deep.ts hypTitle() falls back to a raw
// `claim.slice(0, 96)` when the first clause is long, which cut one brief's label mid-token
// ("…THERESA_ALLOWED_E"). When the title is a strict PREFIX of the claim that stops inside a word, the title
// was truncated for us — label from the claim instead and let plainFindingLabel cut on a word boundary.
// Exported so the Combined report's findings index (reportIndex.ts) labels its rows exactly as the leadership list does.
export function refSourceText(f: Finding): string {
  const title = String((f as { title?: string }).title ?? '').trim();
  const claim = String((f as { claim?: string }).claim ?? '').trim();
  if (!title) return claim || String(f.id);
  if (claim.length > title.length && claim.startsWith(title) && /\w/.test(claim[title.length] ?? '') && /\w$/.test(title)) return claim;
  return title;
}

// The default length a citation label is cut to. Long enough for one plain sentence, short enough that the
// list stays scannable — the full wording is one click away in the engineering report.
const LABEL_MAX = 110;

/**
 * A finding headline rewritten for the LEADERSHIP tier: no file:line refs, env names, snake_case codenames,
 * regexes or inline code, and truncated on a WORD boundary with an ellipsis.
 *
 * Deterministic, so it cannot translate jargon the way the LLM writer does — it REMOVES plumbing and names
 * what kind of thing was there ("a configuration setting", "the code"), which is the honest limit of a
 * post-authoring pass. The scrubbing vocabulary is the R7 rule set (reportRubric.ts), not a second list.
 */
// Plain phrase for a removed inline-code span, by what the span IS. Order matters: a command line carries a path.
const CREDENTIAL_NAME = /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)(?:_|$)/;
function codeSpanPhrase(inner: string): string {
  const t = inner.trim();
  if (/^(?:node|npm|npx|yarn|pnpm|bun|deno|python3?|pip|bash|sh|go|cargo|make|docker|git|java|ruby|php)\s/.test(t)) return 'a command';
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(t)) return CREDENTIAL_NAME.test(t) ? 'a credential setting' : 'a configuration setting';
  if (/\w\s*\(/.test(t)) return 'a function call';
  if (/\//.test(t) || /\.[a-z]{1,5}(?::\d+(?:[-–]\d+)?)?$/i.test(t)) return 'a source file';
  return 'a code identifier';
}

export function plainFindingLabel(text: string, max = LABEL_MAX): string {
  // A removed token is replaced by a NOUN PHRASE naming what kind of thing it was. When the token already had a
  // determiner in front ("no THERESA_X check", "the foo.ts helper") the phrase drops its own article, so the
  // label reads "no configuration setting check", never "no a configuration setting check".
  const DET = String.raw`(\b(?:no|the|a|an|its|this|that|any|each|every|their|our)\s+)?`;
  const noun = (withArticle: string, bare: string) => (_m: string, det?: string): string => (det ? `${det}${bare}` : withArticle);
  let s = String(text ?? '');
  s = s
    // Regex literals (/…/flags) — plumbing by definition. Require a regex-ish metachar inside so a plain
    // "and/or" or a path is not mistaken for one.
    .replace(/(^|[\s(])\/(?=[^/\s]*[\\^$*+?[\](){}|])[^/\n]{2,}\/[gimsuy]*(?=[\s),.;:]|$)/g, '$1a pattern')
    // Inline code spans: keep a plain-words span's words, drop anything that is itself plumbing.
    // A plumbing span becomes a phrase naming WHAT it is (a command / a source file / a function call / a setting),
    // not one generic "a code identifier" — two of those in a sentence left the leadership footer unreadable
    // ("executes a code identifier, but the repo ships only a code identifier").
    .replace(/`([^`]*)`/g, (_m, inner: string) => (/[_./:=<>()[\]{}]|\b[A-Z0-9]{2,}\b/.test(inner) ? codeSpanPhrase(inner) : inner))
    // file[:line[-line]] refs and bare file names (the R7 plumbing rule's extension set, widened to the other
    // source/config types a finding cites).
    .replace(new RegExp(DET + String.raw`(?:[\w.-]+\/)*[\w.-]+\.(?:ya?ml)(?::\d+(?:[-–]\d+)?)?\b`, 'gi'), noun('a CI/config file', 'CI/config file'))
    .replace(new RegExp(DET + String.raw`(?:[\w.-]+\/)*[\w.-]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|json|sql|sh|go|rs|java|kt|swift|rb|md|toml|ini|env|lock|html|css)(?::\d+(?:[-–]\d+)?)?\b`, 'gi'), noun('the code', 'source file'))
    // SCREAMING_SNAKE env / config names.
    .replace(new RegExp(DET + String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`, 'g'), (m: string, det?: string) => (CREDENTIAL_NAME.test(m.slice(det?.length ?? 0))
      ? noun('a credential setting', 'credential setting')(m, det) : noun('a configuration setting', 'configuration setting')(m, det)))
    // Remaining snake_case identifiers (R7_CODENAME_RE's shape) → spaced words; camelCase code names likewise
    // (the same split leadershipWriter.soften applies).
    // The split words are QUOTED: bare, "The has custom event/bounce predicate" and "the get website stats path" read
    // as broken prose; quoted, they read as the name of a thing (umami sample run).
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, (m) => `“${m.replace(/_/g, ' ')}”`)
    // (≥2 humps, so product words like iPhone / iOS / eBay are left alone)
    .replace(/\b[a-z]+(?:[A-Z][a-z0-9]+){2,}\b/g, (m) => `“${m.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()}”`)
    // Known source codenames R7 names explicitly (after the snake split, so swing_i2i → "swing item-to-item").
    .replace(/\bi2i\b/gi, 'item-to-item').replace(/\busercf\b/gi, 'user-based collaborative filtering')
    // Leftover punctuation from a removed token: empty parens, doubled placeholders, stray separators.
    .replace(/\(\s*(?:[,;:]\s*)*\)/g, '')
    .replace(/\b(a configuration setting|a credential setting|the code|a CI\/config file|a code identifier|a command|a source file|a function call)(?:\s*(?:[,/]|and|or)\s*\1)+/g, '$1')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[\s,;:—–-]+$/, '');
  // A label that now OPENS with an inserted placeholder phrase still starts a sentence. Only the inserted
  // phrase is capitalised — the author's own casing is never touched.
  if (/^(?:a configuration setting|a credential setting|the code|a CI\/config file|a code identifier|a command|a source file|a function call|a pattern)\b/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  // Defense in depth: if a codename survived the rewrites above, say so in words rather than leak it.
  if (R7_CODENAME_RE.test(s)) s = s.replace(new RegExp(R7_CODENAME_RE.source, 'gi'), 'an internal component');
  if (R7_PLUMBING_RE.test(s)) s = s.replace(new RegExp(R7_PLUMBING_RE.source, 'gi'), 'the code');
  if (s.length <= max) return s;
  // Word-boundary truncation: cut at the last whitespace within the budget (leaving room for the ellipsis),
  // strip trailing punctuation, then mark the cut. A single over-long token falls back to a hard cut.
  const budget = Math.max(1, max - 1);
  const cut = s.slice(0, budget + 1);
  const ws = cut.search(/\s\S*$/);
  const head = (ws > budget * 0.5 ? cut.slice(0, ws) : s.slice(0, budget)).replace(/[\s,;:—–-]+$/, '');
  return `${head}…`;
}

/**
 * The deterministic "Where the detail lives" block, injected into the leadership brief AFTER authoring.
 *
 * INJECTED, NOT AUTHORED — the same posture as the provenance banner, and for the same reason: a model asked
 * to cite its own sources invents plausible ones. Here that would be worse than a wrong number, because a
 * citation is a promise the reader can follow and be misled by.
 *
 * This also makes the v4 contract's claim true for the first time. It told the author "the engineering report
 * carries the full detail and this brief links to it, so you are NOT the system of record" — and then gave it
 * no URL, so the brief shipped with zero links while leaving detail out on the strength of a cross-reference
 * that did not exist.
 */
// ── Two-report model: "Area health" replaces "Where the detail lives" in the Full Scan's Leadership brief ──────────────
// One row per business theme (synthesis area): name · health verdict · one-line framing · the F-ids as links into the
// Execution report. Finding TITLES are not repeated — the brief names findings inside its own narrative and the
// Execution report owns the per-finding detail (no-overlap rule).
export interface AreaHealthTheme {
  key: string;
  name: string;
  verdict?: 'critical' | 'risk' | 'watch' | 'healthy';
  framing?: string;
  /** Finding ids (Finding.id) in this theme; resolved to F-ids through the refs. */
  findingIds: string[];
  /** Open questions in this theme (counted, not listed). */
  gapCount?: number;
}
// `since` (incremental re-scan, src/sinceLastScan.ts): the deterministic "Since last scan" row — rendered as its OWN
// marked block just ahead of the Area-health / citation block, so the same strip-then-reinject path (reinjectDetailIndex
// after the GCP append) replaces it idempotently.
// `across` (cross-project org memory, org-cross-project-memory.md §5): the deterministic "Across your projects" row —
// this run's cross-project inconsistency findings (linked by F-id) + the contradiction edges between this project's facts
// and other projects'. Rendered as its own marked block right after "Since last scan", same idempotent re-inject path.
export interface AcrossProjects { findingIds: string[]; projects: string[]; edges: number; keys: string[] }
// `lens` (report lens split, Leadership v5): when set it REPLACES the Area-health
// block (lensBriefHtml) — the capability map + the one-line Security / Engineering rows carry the same F-id links, so
// showing both would tell the reader the same thing twice. Same marker, same idempotent strip-then-reinject path.
// `answerBack` (Leadership v5 shape pass): the deterministic "What you asked us to check" block — one line per business
// answer-back row (status chip · one short clause · the capability it maps to · F-id links), built from the run's
// answer-back rows (leadershipWriter.lensAnswerBackFrom), never from LLM text. Its own marked block at the END of the
// brief's authored content (after the capability cards), same idempotent strip-then-reinject path.
export interface DetailIndexOpts { themes?: AreaHealthTheme[]; since?: SinceLastScan | null; across?: AcrossProjects | null; lens?: LensBrief | null; answerBack?: LensAnswerBack | null }

export type AnswerBackStatus = 'supported' | 'refuted' | 'unsettled';
/** One answer-back line: the row's status, one short de-jargoned clause, the capability names it maps to, and the
 *  finding ids its F-id links resolve from. */
export interface LensAnswerItem { status: AnswerBackStatus; clause: string; capabilities: string[]; findingIds: string[] }
/** `more`: rows past the line cap (counted, never listed); `skipped`: rows left unexamined by the run budget / cap. */
export interface LensAnswerBack { items: LensAnswerItem[]; more: number; skipped: number }

/** The "Across your projects" row. '' when there is nothing cross-project to say. */
export function acrossProjectsHtml(a: AcrossProjects | null | undefined, refs: ReportRef[]): string {
  if (!a || (!a.findingIds.length && !a.edges)) return '';
  const esc = (x: string): string => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const byId = new Map(refs.map((r) => [r.findingId, r]));
  const links = a.findingIds.map((id) => byId.get(id)).filter((r): r is ReportRef => !!r)
    .map((r) => (r.href ? `<a href="${esc(r.href)}" style="font-weight:600;white-space:nowrap">${esc(r.displayId ?? r.findingId)}</a>` : `<span style="font-weight:600">${esc(r.displayId ?? r.findingId)}</span>`)).join(' · ');
  const n = a.findingIds.length, e = a.edges;
  const projects = a.projects.slice(0, 4).map(esc).join(', ');
  const en = [n ? `${n} finding${n === 1 ? '' : 's'} where this project is inconsistent with another project of your org${links ? ` (${links})` : ''}` : '', e ? `${e} definition${e === 1 ? '' : 's'} recorded differently in another project${a.keys.length ? ` (${a.keys.slice(0, 4).map(esc).join(', ')})` : ''}` : ''].filter(Boolean).join(' · ');
  return `<div class="detail-index across-projects" ${DETAIL_INDEX_MARK} style="${DETAIL_INDEX_STYLE}">`
    + `<div style="font-weight:600;font-size:12px;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b6862)">Across your projects</div>`
    + `<div style="margin:6px 0 0;font-size:14px;line-height:1.6">${en}</div>`
    + (projects ? `<div style="margin:4px 0 0;font-size:12.5px;line-height:1.5;color:var(--muted,#6b6862)">Compared with: ${projects}. Each difference was checked on this project's side in this scan; the other side is that project's last recorded scan.</div>` : '')
    + `</div>`;
}

/** The "Since last scan" row: `N fixed · M new · K persisting · baseline <date> @ <sha>`. '' without a baseline. */
export function sinceLastScanHtml(s: SinceLastScan | null | undefined): string {
  if (!s) return '';
  const esc = (x: string): string => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const u = s.counts.unchecked;
  // E2E 2026-10-01 #3: one clause per REASON (a budget-skipped re-check is not "the review did not run").
  const by = uncheckedByWhy(s.unchecked);
  const parts = UNCHECKED_WHYS.filter((w) => by[w]).map((w) => [by[w]!, w] as const);
  const note = u ? `${u} earlier finding${u === 1 ? ' is' : 's are'} not counted as fixed: ${parts.map(([n, w]) => `${n} — ${uncheckedWhyText(w, n)}`).join('; ')}.` : '';
  return `<div class="detail-index since-last-scan" ${DETAIL_INDEX_MARK} style="${DETAIL_INDEX_STYLE}">`
    + `<div style="font-weight:600;font-size:12px;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b6862)">Since last scan</div>`
    + `<div style="margin:6px 0 0;font-size:14px;line-height:1.6">${esc(sinceLastScanLine(s))}</div>`
    + (note ? `<div style="margin:4px 0 0;font-size:12.5px;line-height:1.5;color:var(--muted,#6b6862)">${note}</div>` : '')
    + `</div>`;
}

const VERDICT_LABEL: Record<string, { label: string; fg: string; bg: string }> = {
  critical: { label: 'Critical', fg: '#B03A2E', bg: '#FBE9E7' },
  risk: { label: 'At risk', fg: '#8A5A00', bg: '#FDF1DC' },
  watch: { label: 'Watch', fg: '#5A4A3D', bg: '#F3EEE4' },
  healthy: { label: 'Healthy', fg: '#2F7D54', bg: '#E6F2EA' },
};

function areaHealthRows(refs: ReportRef[], themes: AreaHealthTheme[]): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const pool = new Map<string, ReportRef[]>();
  for (const r of refs) { const a = pool.get(r.findingId) ?? []; a.push(r); pool.set(r.findingId, a); }
  const link = (r: ReportRef): string => {
    const label = esc(r.displayId ?? r.findingId);
    return r.href ? `<a href="${esc(r.href)}" style="font-weight:600;white-space:nowrap">${label}</a>` : `<span style="font-weight:600">${label}</span>`;
  };
  const rows: string[] = [];
  for (const th of themes) {
    const mine = th.findingIds.map((id) => pool.get(id)?.shift()).filter((r): r is ReportRef => !!r)
      .sort((a, b) => displayIdRank(a.displayId) - displayIdRank(b.displayId));
    const gaps = th.gapCount ?? 0;
    if (!mine.length && !gaps && !th.verdict) continue;
    const v = th.verdict ? VERDICT_LABEL[th.verdict] : undefined;
    const chip = v ? ` <span style="font-size:11px;font-weight:600;border-radius:5px;padding:1px 7px;background:${v.bg};color:${v.fg}">${v.label}</span>` : '';
    const links = mine.length ? mine.map(link).join(' · ') : '';
    const open = gaps ? `<span style="color:var(--muted,#6b6862)">${gaps} open question${gaps === 1 ? '' : 's'}</span>` : '';
    rows.push(`<div class="ah-row" style="padding:10px 0;border-top:1px solid var(--line,#e5e1d9)">`
      + `<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px"><span style="font-weight:600;font-size:14px">${esc(th.name)}</span>${chip}`
      + `<span style="margin-left:auto;font-size:13px;display:flex;gap:10px;flex-wrap:wrap">${[links, open].filter(Boolean).join('<span style="opacity:.4">|</span>')}</span></div>`
      + (th.framing ? `<div style="font-size:13px;line-height:1.55;color:var(--ink2,#4a4540);margin-top:3px">${esc(th.framing)}</div>` : '')
      + `</div>`);
  }
  // A confirmed finding no theme claims (e.g. a GCP finding appended after synthesis) still gets its link.
  const left = [...pool.values()].flat().sort((a, b) => displayIdRank(a.displayId) - displayIdRank(b.displayId));
  if (left.length) rows.push(`<div class="ah-row" style="padding:10px 0;border-top:1px solid var(--line,#e5e1d9)"><div style="display:flex;flex-wrap:wrap;gap:8px"><span style="font-weight:600;font-size:14px">Other findings</span><span style="margin-left:auto;font-size:13px">${left.map(link).join(' · ')}</span></div></div>`);
  return rows.join('');
}

function areaHealthHtml(refs: ReportRef[], themes: AreaHealthTheme[]): string {
  const rows = areaHealthRows(refs, themes);
  if (!rows) return '';
  return `<div class="detail-index area-health" ${DETAIL_INDEX_MARK} style="${DETAIL_INDEX_STYLE}">`
    + `<div style="font-weight:600;font-size:12px;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b6862)">Area health</div>`
    + `<p style="margin:6px 0 8px;font-size:13px;line-height:1.6;color:var(--muted,#6b6862)">Each finding id opens its fix, the check that says it is done, and how to verify it in the Execution report.</p>`
    + rows + `</div>`;
}

// ── Leadership v5: the CAPABILITY MAP + one line per other lens (report lens split §2) ────────────────────────────────
// INJECTED, never authored, for the reason the Area-health block is: a figure the model draws can disagree with the
// findings; this one is computed from them (findingLens.ts lensBriefFor over the gated array Execution renders), so it
// always exists and always matches. One tile per business capability, coloured by its worst CONFIRMED finding (the rule
// is findingLens.capabilityHealth), naming the capability + its counts, with its F-ids as links into Execution. Then
// EXACTLY one line for Security and one for Engineering health: counts + "→ technical report" + the F-id links — the
// brief never gets more detail than that for those lenses. With NO business finding at all the map becomes a compact
// two-tile engineering-health overview and one line says so (a library / tooling repo has no business logic in scope).
// Inline SVG with role="img" + an aria-label; colours are inline fills (print-color-adjust:exact) so the console theme
// and print render the same picture.
const HEALTH_STYLE: Record<CapabilityHealth, { fg: string; bg: string; label: string }> = {
  red: { fg: '#B03A2E', bg: '#FBE9E7', label: 'confirmed high or critical issue' },
  amber: { fg: '#8A5A00', bg: '#FDF1DC', label: 'confirmed issue' },
  green: { fg: '#2F7D54', bg: '#E6F2EA', label: 'checked and healthy' },
  grey: { fg: '#5A4A3D', bg: '#F3EEE4', label: 'open questions only' },
};
// Phase 2 (a Comprehend capability map): every capability is drawn, so grey means NOT EXAMINED by this scan and green
// means examined with nothing confirmed — the legend says so. Critical capabilities carry a ◆ marker.
const MAPPED_HEALTH_LABEL: Partial<Record<CapabilityHealth, string>> = {
  green: 'examined, nothing confirmed',
  grey: 'not examined in this scan',
};
const healthLabel = (h: CapabilityHealth, mapped: boolean | undefined): string => (mapped && MAPPED_HEALTH_LABEL[h]) || HEALTH_STYLE[h].label;
const CRITICAL_MARK = '◆';
const TILE_W = 204, TILE_H = 88, TILE_GAP = 12, TILE_COLS = 3, IDS_PER_LINE = 3;

const escA = (s: string): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** The F-id refs for some finding ids, in F-id order (duplicate ids each consume their own ref). */
function refsFor(ids: string[], refs: ReportRef[]): ReportRef[] {
  const pool = new Map<string, ReportRef[]>();
  for (const r of refs) { const a = pool.get(r.findingId) ?? []; a.push(r); pool.set(r.findingId, a); }
  return ids.map((id) => pool.get(id)?.shift()).filter((r): r is ReportRef => !!r).sort((a, b) => displayIdRank(a.displayId) - displayIdRank(b.displayId));
}

interface MapTile { name: string; health: CapabilityHealth; counts: string; refs: ReportRef[]; aria: string; critical?: boolean }

// A tile NAME wraps onto at most 2 lines (umami E2E: "Website traffic dashb…" was cut at ~22 characters); only a name
// that still does not fit in 2 lines is cut, with an ellipsis. Width is estimated per character (a full-width CJK
// character is about twice a Latin one at the same size); a single word wider than a line is split. The ◆ critical marker reserves
// room on the FIRST line only.
const NAME_LINE_UNITS = 24, NAME_LINE_UNITS_CRITICAL = 22;
const charUnits = (ch: string): number => (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1.9 : /[A-Z@&%]/.test(ch) ? 1.15 : /[il.,'’:;|!]/.test(ch) ? 0.55 : 1);
const textUnits = (s: string): number => [...s].reduce((n, ch) => n + charUnits(ch), 0);
function cutToUnits(s: string, max: number): string {
  let out = '', n = 0;
  for (const ch of s) { if (n + charUnits(ch) > max) break; out += ch; n += charUnits(ch); }
  return out;
}
export function wrapTileName(name: string, critical?: boolean): string[] {
  const widths = [critical ? NAME_LINE_UNITS_CRITICAL : NAME_LINE_UNITS, NAME_LINE_UNITS];
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (textUnits(s) <= widths[0]) return [s];
  // Tokens: words, and each full-width CJK character on its own (CJK text has no spaces to break at).
  const toks = s.match(/[\u2E80-\u9FFF\uF900-\uFAFF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF]+/g) ?? [];
  const lines: string[] = [''];
  for (const t of toks) {
    const cur = lines[lines.length - 1];
    const cjk = /^[\u2E80-\u9FFF\uF900-\uFAFF]$/.test(t);
    const joined = cur ? (cjk || /[\u2E80-\u9FFF\uF900-\uFAFF]$/.test(cur) ? cur + t : `${cur} ${t}`) : t;
    if (textUnits(joined) <= widths[Math.min(lines.length - 1, 1)]) { lines[lines.length - 1] = joined; continue; }
    if (!cur) { lines[lines.length - 1] = cutToUnits(t, widths[Math.min(lines.length - 1, 1)]); lines.push(t.slice(lines[lines.length - 1].length)); continue; }
    lines.push(t);
  }
  const out = lines.filter(Boolean);
  if (out.length <= 2 && textUnits(out[out.length - 1] ?? '') <= widths[1]) return out;
  // More than 2 lines: keep line 1, fit the rest of the name into line 2 and cut it there.
  const rest = s.slice(out[0].length).trim();
  const second = textUnits(rest) <= widths[1] ? rest : `${cutToUnits(rest, widths[1] - 1).trimEnd()}…`;
  return [out[0], second];
}

function tileCounts(t: CapabilityTile, mapped?: boolean): string {
  const c = t.findingIds.length;
  const parts = [c ? `${c} confirmed` : '', t.highCrit ? `${t.highCrit} high+` : '', t.open ? `${t.open} open` : '', !c && t.ruledOut ? `${t.ruledOut} checked healthy` : ''];
  const out = parts.filter(Boolean).join(' · ');
  // A map tile with nothing to count still says what its colour means (a blank tile reads as a rendering bug).
  if (!out && mapped) return healthLabel(t.health, true);
  return out;
}

function lensTileCounts(l: LensLine): string {
  const n = l.findingIds.length;
  if (!n) return 'nothing confirmed';
  return `${n} confirmed · ${l.highCrit} high+`;
}
const lensHealth = (l: LensLine): CapabilityHealth => (l.highCrit ? 'red' : l.findingIds.length ? 'amber' : 'green');

function capabilityMapSvg(tiles: MapTile[], title: string): string {
  const cols = Math.min(TILE_COLS, Math.max(1, tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  // F-ids wrap at IDS_PER_LINE per line (at most 2 lines, then "+N"): five ids on one line overflowed the tile (p-limit
  // re-render). Every tile gets the height of the tallest one, so the grid stays even.
  const lineCount = (t: MapTile): number => Math.min(2, Math.ceil(t.refs.length / IDS_PER_LINE));
  const idLines = Math.max(1, ...tiles.map(lineCount));
  // A two-line name pushes the counts and the F-ids down one line — on EVERY tile, so the grid stays even.
  const names = tiles.map((t) => wrapTileName(t.name, t.critical));
  const nameShift = names.some((n) => n.length > 1) ? 18 : 0;
  const TH = TILE_H + (idLines - 1) * 18 + nameShift;
  const W = cols * TILE_W + (cols - 1) * TILE_GAP, H = rows * TH + (rows - 1) * TILE_GAP;
  const body = tiles.map((t, i) => {
    const x = (i % cols) * (TILE_W + TILE_GAP), y = Math.floor(i / cols) * (TH + TILE_GAP);
    const st = HEALTH_STYLE[t.health];
    const shown = t.refs.slice(0, IDS_PER_LINE * 2);
    const more = t.refs.length - shown.length;
    // Each F-id is its own link (an <a> inside <text>), into the finding's card in the Execution report.
    const link = (r: ReportRef): string => (r.href ? `<a href="${escA(r.href)}"><tspan fill="${st.fg}" font-weight="600" text-decoration="underline">${escA(r.displayId ?? r.findingId)}</tspan></a>` : `<tspan fill="${st.fg}" font-weight="600">${escA(r.displayId ?? r.findingId)}</tspan>`);
    const lines = [shown.slice(0, IDS_PER_LINE), shown.slice(IDS_PER_LINE)].filter((l) => l.length).map((l, li, all) =>
      `<text x="${x + 18}" y="${y + 72 + nameShift + li * 18}" font-size="12" style="font-family:ui-monospace,Menlo,monospace">${l.map(link).join('<tspan fill="#8A7E6E"> · </tspan>')}${li === all.length - 1 && more > 0 ? `<tspan fill="#8A7E6E"> +${more}</tspan>` : ''}</text>`).join('');
    return `<g class="cap-tile"><title>${escA(t.aria)}</title>`
      + `<rect x="${x + 1}" y="${y + 1}" width="${TILE_W - 2}" height="${TH - 2}" rx="10" fill="${st.bg}" stroke="${st.fg}" stroke-width="1.5"/>`
      + `<rect x="${x + 1}" y="${y + 1}" width="6" height="${TH - 2}" rx="3" fill="${st.fg}"/>`
      + (names[i].length > 1
        ? `<text x="${x + 18}" y="${y + 27}" font-size="14" font-weight="700" fill="#2B2420">${names[i].map((l, li) => `<tspan x="${x + 18}"${li ? ' dy="18"' : ''}>${escA(l)}</tspan>`).join('')}</text>`
        : `<text x="${x + 18}" y="${y + 27}" font-size="14" font-weight="700" fill="#2B2420">${escA(names[i][0] ?? '')}</text>`)
      + (t.critical ? `<text class="cap-critical" x="${x + TILE_W - 14}" y="${y + 27}" font-size="13" text-anchor="end" fill="${st.fg}">${CRITICAL_MARK}</text>` : '')
      + `<text x="${x + 18}" y="${y + 50 + nameShift}" font-size="12" fill="${st.fg}">${escA(t.counts)}</text>`
      + lines
      + `</g>`;
  }).join('');
  return `<svg class="capability-map" role="img" aria-label="${escA(title)}" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto;display:block;margin:8px 0 4px;font-family:inherit;print-color-adjust:exact;-webkit-print-color-adjust:exact" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export function lensBriefHtml(refs: ReportRef[], b: LensBrief): string {
  const empty = !b.capabilities.length;
  const tiles: MapTile[] = empty
    ? ([['Security', b.security], ['Engineering health', b.engineering]] as const).map(([name, l]) => {
      const counts = lensTileCounts(l);
      return { name, health: lensHealth(l), counts, refs: refsFor(l.findingIds, refs), aria: `${name}: ${counts}` };
    })
    : b.capabilities.map((t) => {
      const counts = tileCounts(t, b.mapped);
      const crit = t.critical ? ' (critical)' : '';
      return { name: t.name, health: t.health, counts, refs: refsFor(t.findingIds, refs), critical: Boolean(t.critical), aria: `${t.name}${crit}: ${healthLabel(t.health, b.mapped)}${counts && counts !== healthLabel(t.health, b.mapped) ? ` — ${counts}` : ''}` };
    });
  const title = (empty ? 'Engineering health overview: ' : 'Capability map: ') + tiles.map((t) => t.aria).join('; ');
  const figure = capabilityMapSvg(tiles, title);
  // The two lens rows — the ONLY place security / engineering appear in the brief. "→ technical report" links the
  // Execution report itself; the F-ids link each finding. Wording avoids "N findings" so FINDINGCOUNT never reads it.
  const reportHref = refs.find((r) => r.href)?.href?.replace(/#.*$/, '');
  const row = (name: string, l: LensLine): string => {
    const rs = refsFor(l.findingIds, refs);
    const ids = rs.map((r) => (r.href ? `<a href="${escA(r.href)}" style="font-weight:600;white-space:nowrap">${escA(r.displayId ?? r.findingId)}</a>` : `<span style="font-weight:600">${escA(r.displayId ?? r.findingId)}</span>`)).join(' · ');
    const trLink = reportHref ? `<a href="${escA(reportHref)}">technical report</a>` : 'technical report';
    const n = l.findingIds.length;
    const what = n ? `${n} confirmed, ${l.highCrit} high or critical` : 'nothing confirmed in this scan';
    return `<div class="lens-line" style="margin:6px 0 0;font-size:14px;line-height:1.6"><b>${name}</b> · ${what}${n ? ` → ${trLink}${ids ? `: ${ids}` : ''}` : ''}</div>`;
  };
  const lines = row('Security', b.security) + row('Engineering health', b.engineering);
  // Business open questions no capability of the map claims: one text line under the map, never a tile.
  const u = b.mapped ? b.untiedOpen ?? 0 : 0;
  const untied = u ? `<div class="lens-untied" style="margin:4px 0 0;font-size:13px;line-height:1.6;color:var(--muted,#6b6862)">${u} open question${u === 1 ? '' : 's'} not tied to a single feature.</div>` : '';
  const legend = (['red', 'amber', 'green', 'grey'] as const).map((h) => `<span style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${HEALTH_STYLE[h].fg};margin-right:5px;vertical-align:-1px"></span>${healthLabel(h, b.mapped)}</span>`).join('<span style="opacity:.4"> · </span>')
    + (b.capabilities.some((c) => c.critical) ? `<span style="opacity:.4"> · </span><span style="white-space:nowrap">${CRITICAL_MARK} critical capability</span>` : '');
  return `<div class="detail-index lens-brief" ${DETAIL_INDEX_MARK} style="${DETAIL_INDEX_STYLE}">`
    + `<div style="font-weight:600;font-size:12px;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b6862)">${empty ? 'Engineering health' : 'Capability map'}</div>`
    + `<p style="margin:6px 0 4px;font-size:13px;line-height:1.6;color:var(--muted,#6b6862)">${empty
      ? 'No business-logic issues were in scope or found in this scan — this is a compact engineering-health overview.'
      : b.mapped
        ? 'Each tile is one of the product’s capabilities, coloured by its worst confirmed issue; grey ones were not examined in this scan. Each finding id opens its fix in the Execution report.'
        : 'Each tile is a product capability, coloured by its worst confirmed issue. Each finding id opens its fix in the Execution report.'}</p>`
    + figure + untied
    + (empty ? '' : `<div style="margin:2px 0 8px;font-size:12px;line-height:1.7;color:var(--muted,#6b6862)">${legend}</div>`)
    + `<div style="padding-top:6px;border-top:1px solid var(--line,#e5e1d9)">${lines}</div>`
    + `</div>`;
}

// The v5 answer-back block. Chips: confirmed (red) · ruled out (green) · not settled (grey) — the same palette as the map.
// Wording never reads "N findings / issues", so FINDINGCOUNT never counts it (it runs over the stripped brief anyway).
const AB_CHIP: Record<AnswerBackStatus, { label: string; health: CapabilityHealth }> = {
  supported: { label: 'Confirmed', health: 'red' },
  refuted: { label: 'Ruled out', health: 'green' },
  unsettled: { label: 'Not settled', health: 'grey' },
};
export const ANSWER_BACK_HEADING = 'What you asked us to check';
export function answerBackHtml(refs: ReportRef[], ab: LensAnswerBack | null | undefined): string {
  if (!ab || (!ab.items.length && !ab.more && !ab.skipped)) return '';
  const lines = ab.items.map((it) => {
    const c = AB_CHIP[it.status]; const st = HEALTH_STYLE[c.health];
    const chip = `<span style="display:inline-block;min-width:74px;text-align:center;font-size:11.5px;font-weight:600;line-height:1.5;padding:1px 7px;margin-right:8px;border-radius:999px;color:${st.fg};background:${st.bg};border:1px solid ${st.fg}33">${c.label}</span>`;
    const clause = it.clause ? escA(it.clause) : '';
    const caps = it.capabilities.length ? it.capabilities.map((x) => escA(x)).join(', ') : '';
    const ids = refsFor(it.findingIds, refs).map((r) => (r.href ? `<a href="${escA(r.href)}" style="font-weight:600;white-space:nowrap">${escA(r.displayId ?? r.findingId)}</a>` : `<span style="font-weight:600">${escA(r.displayId ?? r.findingId)}</span>`)).join(' · ');
    const sep = '<span style="opacity:.45"> · </span>';
    const rest = [caps ? `<i>${caps}</i>` : '', ids].filter(Boolean).join(sep);
    const dash = clause && rest ? ' — ' : '';
    return `<li style="margin:4px 0">${chip}${clause}${dash}${rest}</li>`;
  }).join('');
  const tail = [
    ab.more ? `+${ab.more} more not settled — each is in the technical report.` : '',
    ab.skipped ? `${ab.skipped} more not examined within this run’s budget.` : '',
  ].filter(Boolean).join(' ');
  return `<div class="detail-index answer-back" ${DETAIL_INDEX_MARK} style="${DETAIL_INDEX_STYLE}">`
    + `<div style="font-weight:600;font-size:12px;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b6862)">${ANSWER_BACK_HEADING}</div>`
    + (lines ? `<ul style="list-style:none;margin:6px 0 0;padding:0;font-size:14px;line-height:1.6">${lines}</ul>` : '')
    + (tail ? `<div style="margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--muted,#6b6862)">${tail}</div>` : '')
    + `</div>`;
}

export function detailIndexHtml(refs: ReportRef[], opts: DetailIndexOpts = {}): string {
  // v5: the capability map is the brief's main picture — it leads, and the Since-last-scan / Across rows follow it.
  if (opts.lens) return detailIndexCoreHtml(refs, opts) + sinceLastScanHtml(opts.since) + acrossProjectsHtml(opts.across, refs);
  return sinceLastScanHtml(opts.since) + acrossProjectsHtml(opts.across, refs) + detailIndexCoreHtml(refs, opts);
}
function detailIndexCoreHtml(refs: ReportRef[], opts: DetailIndexOpts): string {
  if (opts.lens) return lensBriefHtml(refs, opts.lens);
  if (opts.themes?.length) return areaHealthHtml(refs, opts.themes);
  if (!refs.length) return '';
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const groups = groupRefs(refs).map((g) => {
    const items = g.items.map((r) => {
      const shown = esc(refLabel(r, refs.indexOf(r)));
      // A ref with no href renders as TEXT, never as a dead link: the citation still tells the reader where to
      // look, and a 404 would be worse than plain prose.
      return r.href
        ? `<li><a href="${esc(r.href)}">${shown}</a></li>`
        : `<li>${shown} <span style="opacity:.6">— engineering report</span></li>`;
    }).join('');
    return `<div class="di-group" style="margin:12px 0 0">`
      + `<div class="di-gh" style="font-weight:600;font-size:13px;line-height:1.5;color:var(--ink2,#4a4540)">${esc(g.label)} <span style="font-weight:400;color:var(--muted,#6b6862)">· ${g.items.length}</span></div>`
      + `<ul style="margin:2px 0 0;padding-left:18px;font-size:13.5px;line-height:1.7">${items}</ul></div>`;
  }).join('');
  return `<div class="detail-index" ${DETAIL_INDEX_MARK} style="${DETAIL_INDEX_STYLE}">`
    + `<div style="font-weight:600;font-size:12px;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b6862)">Where the detail lives</div>`
    + `<p style="margin:6px 0 4px;font-size:13px;line-height:1.6;color:var(--muted,#6b6862)">This brief carries only what a decision needs. The full evidence for each finding is in the engineering report. Grouped by the review that raised each finding.</p>`
    + `${groups}</div>`;
}

// The label of one citation: "F-03 · <title>". The F-id is what lets the reader match this line to the
// engineering report's card and the Combined findings index, which the old "1. / 2." numbering did not. A ref built
// without an id (a hand-made caller) falls back to that numbering.
function refLabel(r: ReportRef, n: number): string {
  return r.displayId ? `${r.displayId} · ${r.title}` : `${n + 1}. ${r.title}`;
}

// The citations grouped by AREA (the owning bundle — the same key the Combined report's tabs use), each group
// in F-id order, groups ordered by their most severe member, and findings with no owning area last under "Other".
function groupRefs(refs: ReportRef[]): { key: string; label: string; items: ReportRef[] }[] {
  const by = new Map<string, { key: string; label: string; items: ReportRef[] }>();
  for (const r of refs) {
    const key = r.area?.key ?? '';
    let g = by.get(key);
    // The key is the bundle whose review RAISED the finding, not the finding's topic — one brief can send every
    // bundle after the same concern (umami sample run: metric-definition findings sat under "Build / CI / release
    // engineering"). So the heading says so ("Found by: …") instead of reading as a topic label.
    if (!g) {
      g = r.area ? { key, label: `Found by: ${r.area.label}`, items: [] } : { key, label: 'Other findings', items: [] };
      by.set(key, g);
    }
    g.items.push(r);
  }
  const out = [...by.values()];
  const other = out.findIndex((g) => g.key === '');
  if (other >= 0) out.push(...out.splice(other, 1));
  return out;
}

/**
 * Inject the citation / capability-map / answer-back blocks into the brief's BODY.
 *
 * Placement: the capability map goes right after the lead card (lensInsertOffset — the `<!--capability-map-->` anchor
 * when there is one); every other block at the end of the authored content (inside a sole wrapper column, so it keeps
 * the column — soleWrapperInnerEnd); the answer-back at the renderer's `<!--answer-back-->` anchor when there is one,
 * else at the end of the authored content too. A document with no <body> is treated as one body.
 */
export function injectDetailIndex(html: string, refs: ReportRef[], opts: DetailIndexOpts = {}): string {
  if (!refs.length && !opts.themes?.length && !opts.since && !opts.across && !opts.lens && !opts.answerBack) return html;
  let out = html;
  const block = detailIndexHtml(refs, opts);
  if (block) {
    const { start, end } = bodyRangeOf(out);
    const body = out.slice(start, end);
    const at = start + (opts.lens ? lensInsertOffset(body) : soleWrapperInnerEnd(body));
    out = out.slice(0, at) + block + out.slice(at);
  }
  // v5 answer-back: re-measured, because the block above moved the body's end.
  const ab = answerBackHtml(refs, opts.answerBack);
  if (ab) {
    const a = ANSWER_BACK_ANCHOR_RE.exec(out);
    let at: number;
    if (a) at = a.index + a[0].length;
    else { const { start, end } = bodyRangeOf(out); at = start + soleWrapperInnerEnd(out.slice(start, end)); }
    out = out.slice(0, at) + ab + out.slice(at);
  }
  return out;
}

/** The <body> content of a document (the whole string when it has no <body>), as offsets. */
function bodyRangeOf(html: string): { start: number; end: number } {
  const open = /<body\b[^>]*>/i.exec(html);
  if (!open) return { start: 0, end: html.length };
  const start = open.index + open[0].length;
  const close = html.toLowerCase().lastIndexOf('</body');
  return { start, end: close >= start ? close : html.length };
}

// ── Where the v5 capability map goes (report lens split, Phase 2 fix) ─────────────────────────────────────────────────
// On the umami E2E the map sat at the very BOTTOM of the brief; on v5 it is the brief's main picture, so it goes right
// after the lead card (the verdict + decisions). In order:
//   1. the anchor comment `<!--capability-map-->` — the v5 contract asks the author to emit it right after the lead card
//      (the structured renderer emits it after its lead card too) — the block goes right after it;
//   2. else after the first element that follows the first </h1> — the lead-looking one (class lead / tldr / verdict /
//      card / summary / hero) when there is one before the next heading, else the very next element;
//   3. else after the </h1> itself; else the top of the body (inside a sole wrapper, so it keeps the column).
// Strip-then-reinject stays idempotent: stripping removes the block and nothing else, so the anchors are unchanged.
export const LENS_MAP_ANCHOR = '<!--capability-map-->';
export const LENS_MAP_ANCHOR_RE = /<!--\s*capability-map\s*-->/i;
// The structured renderer's v5 answer-back anchor (after its capability sections); the free-vibe brief needs none.
export const ANSWER_BACK_ANCHOR = '<!--answer-back-->';
const ANSWER_BACK_ANCHOR_RE = /<!--\s*answer-back\s*-->/i;
const BLOCK_TAG_RE = /<(div|section|article|aside|header|p|ul|ol|table|figure|blockquote)\b[^>]*>/gi;
const LEAD_CLASS_RE = /\bclass\s*=\s*(?:"[^"]*|'[^']*|[^\s>]*)\b(?:lead|tldr|tl-dr|verdict|card|summary|hero)\b/i;

/** End offset (exclusive) of the element whose open tag starts at `open`, by same-name depth; -1 when unbalanced. */
function elementEnd(body: string, open: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = open;
  let depth = 0;
  for (let t = re.exec(body); t; t = re.exec(body)) {
    if (t[2]) continue;
    depth += t[1] ? -1 : 1;
    if (depth === 0) return t.index + t[0].length;
  }
  return -1;
}
export function lensInsertOffset(body: string): number {
  const anchor = LENS_MAP_ANCHOR_RE.exec(body);
  if (anchor) return anchor.index + anchor[0].length;
  const h1 = /<\/h1\s*>/i.exec(body);
  if (h1) {
    const after = h1.index + h1[0].length;
    const nextHeading = (() => { const m = /<h[1-3]\b/i.exec(body.slice(after)); return m ? after + m.index : body.length; })();
    BLOCK_TAG_RE.lastIndex = after;
    let first: { at: number; tag: string } | null = null;
    for (let m = BLOCK_TAG_RE.exec(body); m && m.index < nextHeading; m = BLOCK_TAG_RE.exec(body)) {
      const end = elementEnd(body, m.index, m[1]);
      if (end < 0) break;
      if (!first) first = { at: end, tag: m[1] };
      if (LEAD_CLASS_RE.test(m[0])) return end;
      BLOCK_TAG_RE.lastIndex = end;   // siblings only — never descend into the element just measured
    }
    if (first) return first.at;
    return after;
  }
  const lead = body.length - body.trimStart().length;
  const wrap = /^<div\b[^>]*>/i.exec(body.slice(lead));
  return wrap && soleWrapperInnerEnd(body) < body.length ? lead + wrap[0].length : lead;
}

// Where to append inside the body. A body that is ONE wrapper element (`<div class="wrap">…</div>`, the usual
// centred content column) gets the block at the END OF THAT WRAPPER, so the block sits in the report's column with its
// width and gutters; appended after the wrapper it rendered full-bleed and unstyled under the brief (umami sample
// run). Any other shape (several top-level children, text, unbalanced markup) keeps the end-of-body position.
// Returns an offset into `body`.
export function soleWrapperInnerEnd(body: string): number {
  const lead = body.length - body.trimStart().length;
  const trimmedEnd = body.trimEnd().length;
  if (!/^<div\b/i.test(body.slice(lead))) return body.length;
  const tagRe = /<(\/?)div\b[^>]*?(\/?)>/gi;
  tagRe.lastIndex = lead;
  let depth = 0;
  for (let t = tagRe.exec(body); t; t = tagRe.exec(body)) {
    if (t[2]) continue;
    depth += t[1] ? -1 : 1;
    if (depth === 0) return t.index + t[0].length === trimmedEnd ? t.index : body.length;
  }
  return body.length;
}

// The marker that makes the citation block REPLACEABLE. Needed because the block is injected while the brief
// is authored, but the engineering report it cites is not final until later: executeOrgRun appends the GCP
// findings AFTER the expert lanes return, so a block built at authoring time omits findings that DO appear in
// its target report — contradicting its own claim to locate the evidence for each finding.
const DETAIL_INDEX_MARK = 'data-detail-index="1"';

// The block's box. It INHERITS the report's font and reads the report's palette tokens (--line / --card / --ink2 /
// --muted, the brand-guide names the writers use) with neutral fallbacks, so it looks like part of the brief rather
// than a system-ui panel bolted on (umami sample run). Links keep the report's own link colour.
const DETAIL_INDEX_STYLE = 'margin:28px 0 0;padding:14px 16px;border:1px solid var(--line,#e5e1d9);border-radius:10px;'
  + 'background:var(--card,transparent);font-family:inherit;color:inherit';

// Quote-flexible marker match. The normalizer may validly restyle the leadership markup — including changing
// data-detail-index="1" to a single-quoted or unquoted form — and its checks pass, because they do not preserve
// attribute quoting. An exact-string search then failed to find the pre-GCP block, so the stale index SURVIVED
// and a second one was appended: duplicate, conflicting citation lists in the tier most people open. The
// round-5 non-destructive guard does not catch this, because injection genuinely succeeds.
const DETAIL_INDEX_RE = /data-detail-index\s*=\s*(?:"1"|'1'|1)/i;

/** Remove any previously injected citation block, so a later, more complete one can replace it. */
/** Remove any previously injected citation block. `at` is where the FIRST one was, so a replacement can go back there. */
export function stripDetailIndexAt(html: string): { html: string; at: number | null } {
  let out = html;
  let first: number | null = null;
  for (;;) {
    const m = DETAIL_INDEX_RE.exec(out);
    if (!m) return { html: out, at: first };
    const open = out.lastIndexOf('<div', m.index);
    if (open < 0) return { html: out, at: first };
    let depth = 0;
    const tagRe = /<(\/?)div\b[^>]*?(\/?)>/gi;
    tagRe.lastIndex = open;
    let close = -1;
    for (let t = tagRe.exec(out); t; t = tagRe.exec(out)) {
      if (t[2]) continue;
      depth += t[1] ? -1 : 1;
      if (depth === 0) { close = t.index + t[0].length; break; }
    }
    if (close < 0) return { html: out, at: first };
    if (first === null) first = open;
    out = out.slice(0, open) + out.slice(close);
  }
}

export function stripDetailIndex(html: string): string { return stripDetailIndexAt(html).html; }

/** Replace the citation block(s) with one built from the FINAL findings. Idempotent. */
export function reinjectDetailIndex(html: string, refs: ReportRef[], opts: DetailIndexOpts = {}): string {
  const { html: stripped, at } = stripDetailIndexAt(html);
  // PUT IT BACK WHERE IT WAS. Injection otherwise appends at the end of the body, but the normalizer nests each report
  // inside its own data-report-tab panel — so a replacement appended at the end sits OUTSIDE every panel and stays
  // visible while the reader browses the area-report tabs, possibly outside the shared gutter too. When a previous
  // block was found, its position is the right home for the replacement.
  // Not for v5 (lens / answer-back): its blocks have their own homes (the map after the lead card, the answer-back after
  // the cards) — restoring every block at the first one's position would put the answer-back above the cards.
  if (at !== null && !opts.lens && !opts.answerBack) {
    const block = detailIndexHtml(refs, opts);
    if (block) return stripped.slice(0, at) + block + stripped.slice(at);
  }
  const out = injectDetailIndex(stripped, refs, opts);
  // NON-DESTRUCTIVE BY CONSTRUCTION. Strip-then-inject deletes the existing block first, so on any shape the
  // injector cannot write back into, the document would LOSE the citations it already had and gain nothing.
  // If nothing was injected, keep the original untouched, making a detection miss a no-op not a regression.
  return out === stripped ? html : out;
}

/**
 * Rebind run-specific citation URLs onto a new run id.
 *
 * A resume replays the parent's leadershipHtml VERBATIM into the child, so every `/api/runs/<parent>/report`
 * link kept pointing at the parent — stale immediately, and a 404 once that parent is trashed. The child's
 * engineering report is the one its brief should cite.
 */
export function rebindReportRefUrls(html: string, runId: string): string {
  return html.replace(/\/api\/runs\/[A-Za-z0-9_-]+\/report#/g, `/api/runs/${runId}/report#`);
}

/**
 * The engineering report's URL for a run — ABSOLUTE when BASE_URL is configured.
 *
 * A root-relative `/api/runs/…` works only while the reader is on the Waggle origin. It is not: a
 * leadership or combined report can be EXPORTED to a dashboard, where the same markup resolves
 * against the dashboard's origin and that route does not exist — so every citation in an exported artifact
 * was broken. The same applies to a downloaded or emailed file. An absolute URL resolves from any origin and
 * still requires the reader's own session, which is correct: these reports are tenant-scoped.
 *
 * Falls back to the relative form when BASE_URL is unset (a CLI render, a local harness), because an absolute
 * URL built on a guessed host would be worse than a relative one.
 */
export function engineeringReportUrl(runId: string): string {
  const base = (process.env.BASE_URL ?? '').trim().replace(/\/+$/, '');
  return `${base}/api/runs/${runId}/report`;
}
