// REPORT LENS SPLIT — which report tells each finding's story.
//
// Product feedback: the Leadership brief should say where the BUSINESS and application logic is wrong,
// in few words and many pictures, and never where the low-level implementation is wrong; the Execution report is the
// technical hand-off, security first. So every finding carries two labels (schema.ts Finding.lens / .capability):
//   • lens — business | security | engineering. DEFAULT by the bundle that raised the finding (below), REFINED by the
//     cross-bundle synthesis, which may override it per hypothesis with a reason (deep.ts `lensOverrides`, validated
//     strictly there): a mobile finding that breaks checkout is `business`.
//   • capability — the product capability a BUSINESS finding affects. Phase 1: the synthesis AREA it belongs to, read
//     from the SAME membership the Execution Work plan groups by (executionGroups), so the brief's capability map and
//     the Execution groups can never disagree. Security / engineering findings have none.
//     Phase 2: when Comprehend produced a CAPABILITY MAP (research/capabilities.ts), the finding's evidence paths /
//     cited tables / routes are matched against the capabilities' anchors first (longest path prefix wins), then the
//     capability the synthesis assigned to its hypothesis, then its synthesis area's name against the capability names;
//     a finding none of them reaches keeps the area as its label (Execution groups by it), and the brief draws it on
//     ONE "Not tied to a single feature" tile — a mapped brief never draws a synthesis-area tile.
//
// PURE: no I/O, no LLM. `labelFindings` is the ONE place labels are applied (the findings stage of an org run, fresh
// AND replayed — a checkpoint written before this existed simply has no labels, and they are computed at report time).
// An existing label is kept: the checkpoint is the record, and recomputing it could only ever agree or drift.
import type { CoverageGap, Finding, FindingLens, Severity } from './schema.ts';
import type { ExecutionGroup } from './executionModel.ts';
import { findingBundleId } from './findingKey.ts';
import { isRuledOutFinding } from './reportAnchors.ts';
import { type Capability, type CapabilityAssignment, assignmentMap, capabilityFor, capabilityForGap, normCapName } from './research/capabilities.ts';

export type { FindingLens };
export const FINDING_LENSES: readonly FindingLens[] = ['business', 'security', 'engineering'];
export function isFindingLens(x: unknown): x is FindingLens {
  return typeof x === 'string' && (FINDING_LENSES as readonly string[]).includes(x);
}

// The bundle → lens table. Anything not listed — the baseline data-trust floor, the data / analytics / recsys bundles,
// a user-derived dimension (u1..uN), a GCP or deterministic-miner finding, an unknown id — is BUSINESS: those are
// the findings about whether the product's numbers and behaviour are right, which is what a leader decides on.
const LENS_BY_BUNDLE: Record<string, FindingLens> = {
  appsec: 'security', 'saas-tenancy': 'security', 'trust-safety': 'security',
  'swe-arch': 'engineering', 'release-eng': 'engineering', 'api-stability': 'engineering', 'mobile-ios': 'engineering', 'mobile-android': 'engineering',
  baseline: 'business', 'data-eng': 'business', analytics: 'business', 'recsys-mle': 'business', 'product-logic': 'business',
};

/** The default lens of a bundle id (case-insensitive). Unknown / absent → business. */
export function defaultLens(bundleId: string | undefined): FindingLens {
  return LENS_BY_BUNDLE[String(bundleId ?? '').trim().toLowerCase()] ?? 'business';
}

/** One synthesis override (deep.ts validates it: a known hypothesis id, a real lens, a non-empty reason). */
export interface LensOverride { id: string; lens: FindingLens; reason: string }

/** Override list → map keyed by the lower-cased hypothesis id (= the finding id, case-insensitively). */
export function overrideMap(list: readonly LensOverride[] | undefined): Map<string, FindingLens> {
  const m = new Map<string, FindingLens>();
  for (const o of list ?? []) if (o && isFindingLens(o.lens) && !m.has(String(o.id).toLowerCase())) m.set(String(o.id).toLowerCase(), o.lens);
  return m;
}

/** A finding's lens: the synthesis override, else its owning bundle's default (id prefix, else invariant owner). */
export function lensFor(f: Pick<Finding, 'id' | 'invariant' | 'source'>, overrides?: ReadonlyMap<string, FindingLens>): FindingLens {
  return overrides?.get(String(f.id ?? '').toLowerCase()) ?? defaultLens(findingBundleId(f));
}

/** A coverage gap's lens — same rule, keyed by its hypothesis id, owned by its bundle (or the id prefix). */
export function gapLens(g: Pick<CoverageGap, 'id' | 'hypothesisId' | 'bundleId'>, overrides?: ReadonlyMap<string, FindingLens>): FindingLens {
  const hid = String(g.hypothesisId ?? g.id ?? '').toLowerCase();
  const o = overrides?.get(hid) ?? overrides?.get(String(g.id ?? '').toLowerCase());
  if (o) return o;
  const colon = hid.indexOf(':');
  return defaultLens(g.bundleId ?? (colon > 0 ? hid.slice(0, colon) : undefined));
}

// Groups that are not a capability: the Execution-only buckets, and the Security group (security-first ordering).
const NOT_A_CAPABILITY = new Set(['other', 'not-examined', 'security']);

/** finding id → the capability (theme group name) it sits in, from the Execution grouping. */
export function capabilityIndex(groups: readonly ExecutionGroup[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups ?? []) {
    if (NOT_A_CAPABILITY.has(g.key)) continue;
    for (const id of g.findingIds) if (!m.has(id)) m.set(id, g.name);
  }
  return m;
}

/**
 * Apply both labels to every finding (a NEW array of NEW objects; the input is not mutated). An existing valid `lens`
 * is kept; a business finding's existing `capability` is kept; a non-business finding never carries one.
 * `groups` = executionGroups(findings, gaps, synthesis.areas) — the capability source (Phase 1).
 */
export function labelFindings(findings: readonly Finding[], opts: { overrides?: readonly LensOverride[]; groups?: readonly ExecutionGroup[]; capabilities?: readonly Capability[]; assignments?: readonly CapabilityAssignment[] } = {}): Finding[] {
  const ov = overrideMap(opts.overrides);
  const asg = assignmentMap(opts.assignments);
  const caps = capabilityIndex(opts.groups);
  const map = opts.capabilities ?? [];
  const mapNames = new Set(map.map((c) => normCapName(c.name)));
  return findings.map((f) => {
    const lens: FindingLens = isFindingLens(f.lens) ? f.lens : lensFor(f, ov);
    const { capability: had, ...rest } = f;
    const kept = typeof had === 'string' && had.trim() ? had : undefined;
    let capability: string | undefined;
    if (lens === 'business') {
      const area = caps.get(String(f.id));
      // With a map, an existing label is kept only when it IS a map capability (a Phase 1 area label written before the
      // map existed is re-derived); without one, any existing label is the record.
      capability = map.length
        ? (kept && mapNames.has(normCapName(kept)) ? kept : (capabilityFor(f, map, area, asg.get(String(f.id).toLowerCase()))?.name ?? kept ?? area))
        : (kept ?? area);
    }
    return { ...rest, lens, ...(capability ? { capability } : {}) };
  });
}

/** hypothesis id (lower-cased) → lens, for the leadership author's input filter (open hypotheses have no finding). */
export function hypothesisLensMap(hypothesisIds: readonly string[], findings: readonly Finding[], overrides?: readonly LensOverride[]): Record<string, FindingLens> {
  const ov = overrideMap(overrides);
  const byId = new Map(findings.map((f) => [String(f.id).toLowerCase(), f]));
  const out: Record<string, FindingLens> = {};
  for (const raw of hypothesisIds) {
    const id = String(raw).toLowerCase();
    const f = byId.get(id);
    out[id] = f && isFindingLens(f.lens) ? f.lens : gapLens({ id, hypothesisId: id }, ov);
  }
  return out;
}

// ── The Leadership brief's deterministic lens data (capability map + one line per other lens) ─────────────────────

/**
 * Tile colour — from the WORST CONFIRMED business finding of the capability:
 *   red   — at least one confirmed high / critical finding;
 *   amber — at least one confirmed finding (any lower severity);
 *   green — nothing confirmed, and at least one concern was checked and ruled out (healthy);
 *   grey  — nothing confirmed or ruled out: open questions only (never green — unmeasured is not healthy).
 */
export type CapabilityHealth = 'red' | 'amber' | 'green' | 'grey';
export function capabilityHealth(t: { confirmed: number; highCrit: number; ruledOut: number; examined?: boolean }): CapabilityHealth {
  if (t.highCrit > 0) return 'red';
  if (t.confirmed > 0) return 'amber';
  // Phase 2 (a capability map exists): green = EXAMINED and nothing confirmed, grey = NOT examined — "examined" is a lane's
  // read set or a finding's evidence touching the capability's anchors (capabilities.examinedCapabilityIds).
  if (t.examined !== undefined) return t.examined || t.ruledOut > 0 ? 'green' : 'grey';
  return t.ruledOut > 0 ? 'green' : 'grey';
}

export interface CapabilityTile {
  name: string;
  health: CapabilityHealth;
  /** Confirmed finding ids (Finding.id), resolved to F-ids through the refs at render time. */
  findingIds: string[];
  highCrit: number;
  ruledOut: number;
  open: number;
  /** Phase 2 map tiles only: the capability's id, one-sentence summary, critical flag, and whether the scan examined it.
   *  `untied`: the one "Not tied to a single feature" tile (business findings no capability of the map claims). */
  id?: string;
  summary?: string;
  critical?: boolean;
  examined?: boolean;
  untied?: boolean;
}
export interface LensLine { findingIds: string[]; highCrit: number }
/** `mapped`: the tiles are Comprehend's capability map (every capability drawn; grey = not examined), not Phase 1 areas.
 *  `untiedOpen` (mapped only): business open questions no capability claims — one text line under the map, never a tile. */
export interface LensBrief { capabilities: CapabilityTile[]; security: LensLine; engineering: LensLine; mapped?: boolean; untiedOpen?: number }
/** The capability map + which of its capabilities the scan examined (ids) + the synthesis' per-hypothesis capability
 *  assignments (validated, deep.ts), for the Phase 2 brief. */
export interface CapabilityMapInput { capabilities: readonly Capability[]; examined: readonly string[]; assignments?: readonly CapabilityAssignment[] }

const HIGH = new Set<Severity>(['high', 'critical']);
const HEALTH_RANK: Record<CapabilityHealth, number> = { red: 0, amber: 1, grey: 2, green: 3 };
// Map order (Phase 2): the problems, then what was examined and is healthy, then what the scan never looked at.
const MAP_HEALTH_RANK: Record<CapabilityHealth, number> = { red: 0, amber: 1, green: 2, grey: 3 };
const OTHER = 'Other';
// A mapped brief's one tile for the business findings no capability of the map claims (never a synthesis-area tile: on
// the umami E2E "Analytics metric trust" and "Cross-backend reporting parity" sat next to the product's capabilities).
export const UNTIED = 'Not tied to a single feature';

/** The map capability (by name) a business open question belongs to, else undefined (mapped briefs only). */
function gapCapabilityName(g: CoverageGap, map: CapabilityMapInput, areaName: string | undefined, asg: ReadonlyMap<string, string>): string | undefined {
  const hid = String(g.hypothesisId ?? g.id ?? '').toLowerCase();
  return capabilityForGap(g, map.capabilities, areaName, asg.get(hid) ?? asg.get(String(g.id ?? '').toLowerCase()))?.name;
}

/**
 * The lens data the Leadership brief renders DETERMINISTICALLY: one tile per business capability (confirmed + ruled-out
 * findings and open questions), and the confirmed security / engineering finding ids. Callers pass the same gated array
 * the Execution report renders, so every count and link matches it. Unlabelled findings are labelled by default here.
 */
export function lensBriefFor(findings: readonly Finding[], gaps: readonly CoverageGap[], groups: readonly ExecutionGroup[] | undefined, overrides?: readonly LensOverride[], map?: CapabilityMapInput | null): LensBrief {
  const ov = overrideMap(overrides);
  const caps = capabilityIndex(groups);
  const gapCap = new Map<string, string>();
  for (const g of groups ?? []) {
    if (!NOT_A_CAPABILITY.has(g.key)) for (const id of g.gapIds) if (!gapCap.has(id)) gapCap.set(id, g.name);
  }
  const tiles = new Map<string, CapabilityTile>();
  const tile = (name: string): CapabilityTile => {
    let t = tiles.get(name);
    if (!t) { t = { name, health: 'grey', findingIds: [], highCrit: 0, ruledOut: 0, open: 0 }; tiles.set(name, t); }
    return t;
  };
  // Phase 2: EVERY capability of the map is a tile, in map order, examined or not (a finding's label names it exactly).
  const mapped = Boolean(map?.capabilities.length);
  const examined = new Set(map?.examined ?? []);
  const byName = new Map<string, string>();
  for (const c of map?.capabilities ?? []) {
    const t = tile(c.name);
    t.id = c.id; if (c.summary) t.summary = c.summary; if (c.critical) t.critical = true; t.examined = examined.has(c.id);
    byName.set(normCapName(c.name), c.name);
  }
  // Mapped: a name the map does not carry (a Phase 1 area label, "Other") goes to the ONE untied tile.
  const tileName = (n: string): string => (mapped ? byName.get(normCapName(n)) ?? UNTIED : n);
  const asg = assignmentMap(map?.assignments);
  const security: LensLine = { findingIds: [], highCrit: 0 };
  const engineering: LensLine = { findingIds: [], highCrit: 0 };
  for (const f of findings) {
    const lens = isFindingLens(f.lens) ? f.lens : lensFor(f, ov);
    const ruledOut = isRuledOutFinding(f);
    if (lens !== 'business') {
      if (ruledOut) continue;
      const line = lens === 'security' ? security : engineering;
      line.findingIds.push(String(f.id));
      if (HIGH.has(f.severity)) line.highCrit++;
      continue;
    }
    const t = tile(tileName((typeof f.capability === 'string' && f.capability.trim()) || caps.get(String(f.id)) || OTHER));
    if (ruledOut) { t.ruledOut++; continue; }
    t.findingIds.push(String(f.id));
    if (HIGH.has(f.severity)) t.highCrit++;
  }
  // A mapped brief does not count a budget-skipped check (planned, never examined — e.g. the per-bundle hypothesis-cap
  // overflow) as an open question: on the umami E2E those 14 rows drew an "Other · 14 open" tile that said nothing. They
  // stay in Execution's "Planned, not examined" group.
  // A mapped brief resolves each open question to a capability like a finding (capabilityForGap); one no capability
  // claims is COUNTED in a line under the map, never drawn as a tile.
  let untiedOpen = 0;
  for (const g of gaps) {
    if (gapLens(g, ov) !== 'business' || (mapped && g.status === 'budget_skipped')) continue;
    if (!mapped) { tile(gapCap.get(String(g.id)) ?? OTHER).open++; continue; }
    const name = gapCapabilityName(g, map!, gapCap.get(String(g.id)), asg);
    if (name) tile(name).open++; else untiedOpen++;
  }
  if (tiles.has(UNTIED)) tiles.get(UNTIED)!.untied = true;
  const order = [...tiles.keys()];
  // A tile the map does not name (a Phase 1 area fallback, "Other") in a mapped brief: examined when a finding or a
  // ruled-out check sits in it — an open question alone is not an examination.
  const exam = (t: CapabilityTile): boolean | undefined => (!mapped ? undefined : t.id ? Boolean(t.examined) : t.findingIds.length + t.ruledOut > 0);
  const rank = mapped ? MAP_HEALTH_RANK : HEALTH_RANK;
  const capabilities = [...tiles.values()]
    .map((t) => ({ ...t, ...(mapped ? { examined: exam(t) } : {}), health: capabilityHealth({ confirmed: t.findingIds.length, highCrit: t.highCrit, ruledOut: t.ruledOut, examined: exam(t) }) }))
    // Worst first; within a colour (mapped: the critical ones first) the larger one first; then the synthesis' / the
    // map's own order. "Other" always last.
    .sort((a, b) => Number(a.name === OTHER || Boolean(a.untied)) - Number(b.name === OTHER || Boolean(b.untied)) || rank[a.health] - rank[b.health]
      || (mapped ? Number(Boolean(b.critical)) - Number(Boolean(a.critical)) : 0)
      || (b.findingIds.length + b.open) - (a.findingIds.length + a.open) || order.indexOf(a.name) - order.indexOf(b.name));
  return { capabilities, security, engineering, ...(mapped ? { mapped: true, ...(untiedOpen ? { untiedOpen } : {}) } : {}) };
}

/**
 * Everything the v5 Leadership writer needs (leadershipWriter.LeadershipLens): each hypothesis' lens (a finding's label,
 * else its bundle default + override), the capability of each BUSINESS hypothesis (its finding's, else the theme group
 * holding its open question), and the injected brief data.
 */
export function leadershipLensFor(hypothesisIds: readonly string[], findings: readonly Finding[], gaps: readonly CoverageGap[], groups: readonly ExecutionGroup[] | undefined, overrides?: readonly LensOverride[], map?: CapabilityMapInput | null): { of: Record<string, FindingLens>; capabilityOf: Record<string, string>; brief: LensBrief } {
  const of = hypothesisLensMap(hypothesisIds, findings, overrides);
  const capabilityOf: Record<string, string> = {};
  const caps = capabilityIndex(groups);
  // Mapped: every business hypothesis is named by a MAP capability or the untied tile — the same names the map draws.
  const mapNames = new Map((map?.capabilities ?? []).map((c) => [normCapName(c.name), c.name]));
  const mapped = mapNames.size > 0;
  for (const f of findings) {
    const id = String(f.id).toLowerCase();
    const cap = (typeof f.capability === 'string' && f.capability) || caps.get(String(f.id));
    if (of[id] !== 'business') continue;
    if (mapped) capabilityOf[id] = (cap && mapNames.get(normCapName(cap))) || UNTIED;
    else if (cap) capabilityOf[id] = cap;
  }
  if (mapped) {
    const asg = assignmentMap(map!.assignments);
    const gapTheme = new Map<string, string>();
    for (const g of groups ?? []) if (!NOT_A_CAPABILITY.has(g.key)) for (const gid of g.gapIds) if (!gapTheme.has(gid)) gapTheme.set(gid, g.name);
    for (const g of gaps) {
      const hid = String(g.hypothesisId ?? g.id).toLowerCase();
      if (capabilityOf[hid] || of[hid] !== 'business') continue;
      const name = gapCapabilityName(g, map!, gapTheme.get(String(g.id)), asg);
      if (name) capabilityOf[hid] = name;
    }
  }
  for (const g of mapped ? [] : groups ?? []) {
    if (NOT_A_CAPABILITY.has(g.key)) continue;
    for (const gid of g.gapIds) {
      const hid = String(gaps.find((x) => String(x.id) === gid)?.hypothesisId ?? gid).toLowerCase();
      if (!capabilityOf[hid] && of[hid] === 'business') capabilityOf[hid] = g.name;
    }
  }
  return { of, capabilityOf, brief: lensBriefFor(findings, gaps, groups, overrides, map) };
}

/** The confirmed count per lens the brief shows — what a lens-qualified count in its prose is checked against (FINDINGCOUNT). */
export function lensCountsOf(b: LensBrief): { business: number; security: number; engineering: number } {
  return { business: b.capabilities.reduce((n, t) => n + t.findingIds.length, 0), security: b.security.findingIds.length, engineering: b.engineering.findingIds.length };
}

/** True when the scan produced nothing for the business lens at all (no finding, ruled-out row or open question). */
export function noBusinessFindings(b: LensBrief): boolean {
  return !b.capabilities.length;
}
