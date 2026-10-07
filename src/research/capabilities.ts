// CAPABILITY MAP — what the PRODUCT does for its users, as Comprehend
// read it from the repository: at most 12 features / journeys / platform capabilities, each in plain product language
// ("Sharing a dashboard", "Billing & plans") with the code anchors that implement it (repo-relative paths, optionally
// tables and routes). It is NOT a module list: a pure library / tooling repo has no user-facing capabilities and gets an
// empty map (the Leadership brief then keeps its Phase 1 engineering-health fallback).
//
// Three consumers, all deterministic here:
//   • parseCapabilities — the STRICT validation of Comprehend's `capabilities` field (zod, per item; a malformed item is
//     dropped, a malformed field is "no map" — fail-open, never a crash, never a guess);
//   • capabilityFor — which capability a finding belongs to: the finding's evidence paths against the anchors (longest
//     path prefix wins), else a cited table / route that is an anchor (exact), else the capability the SYNTHESIS
//     assigned to its hypothesis (validated against the map, deep.ts), else the synthesis area's name matched to a
//     capability name; else none (the brief draws it on the one "Not tied to a single feature" tile);
//   • examinedCapabilityIds — which capabilities the scan LOOKED AT: some lane OPENED a file under one of its anchors
//     (a Read — not a path a Glob / Grep result merely listed, readSet.ts `opened`), or a finding / hypothesis cites it.
//     A capability no lane examined renders GREY, never green.
// Plus capabilityContextBlock, the Critic's "the product's capabilities" context (prompt text — this module is listed in
// scanLineage.PROMPT_MODULES so the incremental codeHash covers it).
//
// Value-free: nothing here names a product, a feature or a path; the map is the project's own system described back.
import { z } from 'zod';
import type { Finding } from '../schema.ts';

export type CapabilityKind = 'feature' | 'journey' | 'platform';
export interface CapabilityAnchors { paths: string[]; tables?: string[]; routes?: string[] }
export interface Capability {
  /** kebab-case, unique within the map. */
  id: string;
  /** Plain product language — what a user or buyer would call it. */
  name: string;
  kind: CapabilityKind;
  /** At most one sentence. */
  summary: string;
  anchors: CapabilityAnchors;
  /** A capability the business cannot run without (revenue, access, the core promise). */
  critical?: boolean;
}

export const MAX_CAPABILITIES = 12;
const MAX_ANCHORS = 24;

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
/** One sentence: everything up to the first sentence end (. ! ?) that is followed by more text. */
function firstSentence(s: string): string {
  const m = /^(.+?[.!?])(\s+|$)/.exec(s);
  return (m ? m[1] : s).trim();
}
/** A repo-relative anchor path, posix, no leading ./ or /, no trailing /. Absolute or parent-escaping paths → ''. */
export function normAnchorPath(p: string): string {
  let s = clean(String(p ?? '')).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (/^[a-z]:\//i.test(s) || s.split('/').includes('..')) return '';
  s = s.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return s;
}

const anchorList = (max: number) => z.array(z.string()).max(max * 4).transform((a) => [...new Set(a.map((x) => clean(x)).filter(Boolean))].slice(0, max));
const CapabilitySchema = z.object({
  id: z.string().transform((s) => clean(s).toLowerCase()).pipe(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48)),
  // Product language, not a code identifier: no path separators, no snake_case, no file extension.
  name: z.string().transform(clean).pipe(z.string().min(2).max(60).refine((s) => !/[\\/_]|\.[a-z]{1,4}$|[<>`{}]/i.test(s), 'not a product name')),
  kind: z.enum(['feature', 'journey', 'platform']),
  summary: z.string().transform((s) => firstSentence(clean(s)).slice(0, 240)),
  anchors: z.object({
    paths: anchorList(MAX_ANCHORS).transform((a) => [...new Set(a.map(normAnchorPath).filter(Boolean))]),
    tables: anchorList(MAX_ANCHORS).optional(),
    routes: anchorList(MAX_ANCHORS).optional(),
  }).strict(),
  critical: z.boolean().optional(),
}).strict();

/**
 * Comprehend's `capabilities` field → the validated map. Not an array → []. Each item is validated STRICTLY (unknown
 * keys, a non-kebab id, a code-like name, an unknown kind → the item is dropped); an item with no anchor at all is
 * dropped (it could never be examined or matched). Ids and names are de-duplicated (first wins); at most 12.
 */
export function parseCapabilities(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return [];
  const out: Capability[] = [];
  const ids = new Set<string>(); const names = new Set<string>();
  for (const item of raw) {
    const r = CapabilitySchema.safeParse(item);
    if (!r.success) continue;
    const c = r.data;
    const tables = c.anchors.tables?.filter(Boolean) ?? [];
    const routes = c.anchors.routes?.filter(Boolean) ?? [];
    if (!c.anchors.paths.length && !tables.length && !routes.length) continue;
    if (ids.has(c.id) || names.has(c.name.toLowerCase())) continue;
    ids.add(c.id); names.add(c.name.toLowerCase());
    out.push({
      id: c.id, name: c.name, kind: c.kind, summary: c.summary,
      anchors: { paths: c.anchors.paths, ...(tables.length ? { tables } : {}), ...(routes.length ? { routes } : {}) },
      ...(c.critical ? { critical: true } : {}),
    });
    if (out.length >= MAX_CAPABILITIES) break;
  }
  return out;
}

// ── Matching ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every suffix of a path (dropping up to 4 leading segments): a workspace path `<repoDir>/src/x.ts`, a repo-normalized
 *  read-set path `owner/name/src/x.ts` and a repo-relative citation `src/x.ts` all reach the anchor `src`. */
function pathForms(p: string): string[] {
  const segs = normAnchorPath(p).toLowerCase().split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < Math.min(segs.length, 5); i++) out.push(segs.slice(i).join('/'));
  return out;
}
/** An anchor's comparable forms: itself, and — when it is deep enough to stay specific — without a leading repo dir. */
function anchorForms(a: string): string[] {
  const n = normAnchorPath(a).toLowerCase();
  const segs = n.split('/').filter(Boolean);
  return segs.length >= 3 ? [n, segs.slice(1).join('/')] : n ? [n] : [];
}
/** Length of the longest anchor form `path` sits under (0 = no match). */
function pathMatchLen(path: string, anchor: string): number {
  let best = 0;
  const forms = pathForms(path);
  for (const af of anchorForms(anchor)) for (const pf of forms) if ((pf === af || pf.startsWith(af + '/')) && af.length > best) best = af.length;
  return best;
}

/** The capability whose anchor path is the LONGEST prefix of any of `paths` (ties: map order). */
export function capabilityForPaths(paths: readonly string[], caps: readonly Capability[]): Capability | undefined {
  let best: Capability | undefined; let bestLen = 0;
  for (const c of caps) for (const a of c.anchors.paths) for (const p of paths) {
    const n = pathMatchLen(p, a);
    if (n > bestLen) { bestLen = n; best = c; }
  }
  return best;
}

// A path-like token inside an evidence ref / detail: `src/app/x.ts:12`, `code:src/x.ts:10`, `db/schema.sql#L4`.
const PATH_TOKEN = /[A-Za-z0-9_@.\-\[\]()]+(?:\/[A-Za-z0-9_@.\-\[\]()]+)+|[A-Za-z0-9_\-]+\.[A-Za-z]{1,5}\b/g;
/** The file / directory paths a finding's evidence cites (refs first, then details), line suffixes stripped. */
export function findingEvidencePaths(f: Pick<Finding, 'evidence'>): string[] {
  const out: string[] = [];
  for (const e of f.evidence ?? []) {
    for (const s of [e?.ref, e?.detail]) {
      for (const m of String(s ?? '').matchAll(PATH_TOKEN)) {
        const p = m[0].replace(/#L\d+(-L?\d+)?$/i, '').replace(/[:.,)\]]+$/, '');
        if (p && (p.includes('/') || /\.[A-Za-z]{1,5}$/.test(p))) out.push(p);
      }
    }
  }
  return [...new Set(out)];
}

const findingText = (f: Pick<Finding, 'evidence' | 'title' | 'claim'>): string =>
  [f.title, f.claim, ...(f.evidence ?? []).flatMap((e) => [e?.ref, e?.detail])].map((s) => String(s ?? '')).join('\n');
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A table anchor cited as a whole identifier (optionally schema-qualified); a route anchor cited as a whole path. */
function citesTable(text: string, table: string): boolean {
  const t = table.trim(); if (!t) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])${escRe(t)}($|[^A-Za-z0-9_])`, 'i').test(text);
}
function citesRoute(text: string, route: string): boolean {
  const r = route.trim().replace(/\/+$/, ''); if (!r || r === '/') return false;
  return new RegExp(`(^|[^A-Za-z0-9_\\-/])${escRe(r)}($|[^A-Za-z0-9_\\-])`, 'i').test(text);
}

/** Capability names compare case- and punctuation-insensitively ("Billing & plans" = "billing and plans"). */
export function normCapName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
const STOP = new Set(['and', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'with']);
const nameTokens = (s: string): Set<string> => new Set(normCapName(s).split(' ').filter((w) => w && !STOP.has(w)));
/** The capability a synthesis AREA name refers to: equal names, else a token overlap (Jaccard) of at least one half. */
export function capabilityForName(name: string | undefined, caps: readonly Capability[]): Capability | undefined {
  const n = normCapName(name ?? '');
  if (!n) return undefined;
  const exact = caps.find((c) => normCapName(c.name) === n);
  if (exact) return exact;
  const a = nameTokens(n);
  let best: Capability | undefined; let bestJ = 0;
  for (const c of caps) {
    const b = nameTokens(c.name);
    const inter = [...a].filter((w) => b.has(w)).length;
    const j = inter / (a.size + b.size - inter || 1);
    if (j > bestJ) { bestJ = j; best = c; }
  }
  return bestJ >= 0.5 ? best : undefined;
}

/** The capability whose table / route anchors the text cites most (exact; ties: map order). */
function capabilityForCitations(text: string, caps: readonly Capability[]): Capability | undefined {
  let best: Capability | undefined; let bestN = 0;
  for (const c of caps) {
    const n = (c.anchors.tables ?? []).filter((t) => citesTable(text, t)).length + (c.anchors.routes ?? []).filter((r) => citesRoute(text, r)).length;
    if (n > bestN) { bestN = n; best = c; }
  }
  return best;
}
const textPaths = (text: string): string[] => findingEvidencePaths({ evidence: [{ kind: 'computation', ref: text }] as Finding['evidence'] });

/**
 * The capability a finding belongs to (Phase 2 rule), or undefined:
 *   1. its evidence paths against the anchor paths — the longest path prefix wins;
 *   2. a table / route anchor the finding cites exactly (the capability with the most such citations; ties: map order);
 *   3. the capability the synthesis assigned to its hypothesis (`assignedId`, validated against the map in deep.ts);
 *   4. the synthesis area name matched to a capability name.
 */
export function capabilityFor(f: Pick<Finding, 'evidence' | 'title' | 'claim'>, caps: readonly Capability[], areaName?: string, assignedId?: string): Capability | undefined {
  if (!caps.length) return undefined;
  const byPath = capabilityForPaths(findingEvidencePaths(f), caps);
  if (byPath) return byPath;
  const cited = capabilityForCitations(findingText(f), caps);
  if (cited) return cited;
  const assigned = assignedId ? caps.find((c) => c.id === assignedId) : undefined;
  if (assigned) return assigned;
  return capabilityForName(areaName, caps);
}

/**
 * The capability an OPEN QUESTION (a coverage gap) belongs to — the same rule over its text (it has no evidence): an
 * anchor path or a table / route it cites, else the synthesis assignment of its hypothesis, else its theme's name.
 */
export function capabilityForGap(g: { concern?: string; whyUnsettled?: string }, caps: readonly Capability[], areaName?: string, assignedId?: string): Capability | undefined {
  if (!caps.length) return undefined;
  const text = [g.concern, g.whyUnsettled].map((s) => String(s ?? '')).join('\n');
  const byPath = capabilityForPaths(textPaths(text), caps);
  if (byPath) return byPath;
  const cited = capabilityForCitations(text, caps);
  if (cited) return cited;
  const assigned = assignedId ? caps.find((c) => c.id === assignedId) : undefined;
  return assigned ?? capabilityForName(areaName, caps);
}

/** A synthesis capability assignment: hypothesis id → capability id (deep.ts validCapabilityAssignments). */
export interface CapabilityAssignment { id: string; capabilityId: string }
/** Assignment list → map keyed by the lower-cased hypothesis id (= the finding id, case-insensitively). First wins. */
export function assignmentMap(list: readonly CapabilityAssignment[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of list ?? []) { const k = String(a?.id ?? '').toLowerCase(); if (k && a.capabilityId && !m.has(k)) m.set(k, a.capabilityId); }
  return m;
}

/**
 * The ids of the capabilities the scan EXAMINED (map order):
 *   • a lane OPENED a file under one of its anchor paths (`openedPaths` — Read tool inputs, readSet.ts `opened`). A path a
 *     Glob / Grep RESULT merely listed is not an examination: on the umami E2E a wide listing marked 11 of 12 green;
 *   • a finding's EVIDENCE (refs + details) — any lens, ruled-out rows included — cites it: an anchor path (prefix), a
 *     route, or a table only ONE capability anchors (a table several capabilities share does not say which was looked at);
 *   • a hypothesis' claim / measurement note cites it: an anchor path (prefix) or a route.
 */
export function examinedCapabilityIds(caps: readonly Capability[], opts: { openedPaths?: readonly string[]; findings?: readonly Pick<Finding, 'evidence' | 'title' | 'claim'>[]; hypotheses?: readonly { claim?: string; note?: string }[] }): string[] {
  const hit = new Set<string>();
  const opened = [...new Set(opts.openedPaths ?? [])];
  for (const c of caps) {
    if (c.anchors.paths.some((a) => opened.some((p) => pathMatchLen(p, a) > 0))) hit.add(c.id);
  }
  const owners = new Map<string, number>();
  for (const c of caps) for (const t of new Set((c.anchors.tables ?? []).map((x) => x.toLowerCase()))) owners.set(t, (owners.get(t) ?? 0) + 1);
  const cites = (paths: string[], text: string, tables: boolean): void => {
    for (const c of caps) {
      if (hit.has(c.id)) continue;
      if (c.anchors.paths.some((a) => paths.some((p) => pathMatchLen(p, a) > 0))
        || (c.anchors.routes ?? []).some((r) => citesRoute(text, r))
        || (tables && (c.anchors.tables ?? []).some((t) => owners.get(t.toLowerCase()) === 1 && citesTable(text, t)))) hit.add(c.id);
    }
  };
  // Evidence only (refs + details), never the title / claim prose: a table named like a common word ("link") is cited
  // by a sentence about something else.
  for (const f of opts.findings ?? []) cites(findingEvidencePaths(f), (f.evidence ?? []).flatMap((e) => [e?.ref, e?.detail]).map((x) => String(x ?? '')).join('\n'), true);
  for (const h of opts.hypotheses ?? []) {
    const text = [h.claim, h.note].map((s) => String(s ?? '')).join('\n');
    cites(textPaths(text), text, false);
  }
  return caps.filter((c) => hit.has(c.id)).map((c) => c.id);
}

// ── Prompt context ────────────────────────────────────────────────────────────────────────────────────────────────

const promptSafe = (s: string, n: number): string => clean(s).replace(/`+/g, "'").replace(/[<>]/g, '_').replace(/"{3,}/g, '""').slice(0, n);
/**
 * The Critic's context block: the product's capabilities (name, kind, summary, anchor paths). Comprehend's own reading of
 * THIS repository — context to frame problems in product terms and to find where each capability lives, never evidence.
 * '' for an empty map, so callers interpolate unconditionally.
 */
export function capabilityContextBlock(caps: readonly Capability[] | undefined): string {
  if (!caps?.length) return '';
  const rows = caps.map((c) => {
    const where = [...c.anchors.paths.slice(0, 4), ...(c.anchors.routes ?? []).slice(0, 2).map((r) => `route ${r}`), ...(c.anchors.tables ?? []).slice(0, 2).map((t) => `table ${t}`)].map((x) => promptSafe(x, 120)).join(', ');
    return `- ${promptSafe(c.name, 60)} (${c.kind}${c.critical ? ', critical' : ''}): ${promptSafe(c.summary, 200)}${where ? ` — code: ${where}` : ''}`;
  }).join('\n');
  return `THE PRODUCT'S CAPABILITIES (what this product does for its users, as a first agent read it from the repository —
CONTEXT for framing and for finding where each capability lives, NOT evidence; a capability name is never a finding):
${rows}
When a problem you pose affects one of these, say which one in its "why" in the product's terms (what its users would experience).
`;
}

/**
 * The synthesis' view of the map: one row per capability (id: name — summary), so it can say which capability each
 * hypothesis affects (deep.ts synthesisPrompt `capabilityIds`, validated against this list). '' for an empty map.
 */
export function capabilitySynthesisBlock(caps: readonly Capability[] | undefined): string {
  if (!caps?.length) return '';
  const rows = caps.map((c) => `- ${promptSafe(c.id, 48)}: ${promptSafe(c.name, 60)} — ${promptSafe(c.summary, 200)}`).join('\n');
  return `THE PRODUCT'S CAPABILITIES (id: name — what its users get), as a first agent read them from the repository:
${rows}
`;
}
