// sinceLastScan.ts — the deterministic "what changed since last scan" diff + its two renderings.
// PURE: no I/O, no LLM.
//
// Input: the new run's evidence-gated findings and the baseline run's findings, each with its keys (findingKey.ts).
// Matching, strictest first, each baseline finding claimed at most once:
//   1. same `key`          → persisting  (same defect, same title stem, same cited code)
//   2. same `evidenceKey`  → persisting  (same cited code; the LLM re-worded the title)
//   3. same `looseKey`     → changed     (same defect by bundle + invariant + title stem, but its cited code moved/edited)
//   4. FUZZY (fuzzyMatch.ts, one-to-one, highest similarity first; only rows carrying `fz` features): same bundle +
//      invariant and a similar re-worded title / the same metric / overlapping evidence → persisting, or changed when
//      the severity or the cited file set differs. Never across bundles / invariants.
//   5. unmatched new       → new
//   6. unmatched baseline  → fixed — ONLY when the new run actually re-checked that finding's bundle (`checkedBundles`);
//      a baseline finding whose lane failed / was budget-skipped / was not activated this time is `unchecked`, never
//      claimed fixed. A new ruled-out row does not count as present, so a confirmed → ruled-out defect reads as fixed.
//      ALSO never fixed when its code did not change (`canBeFixed` false — e.g. its repo is at the same SHA as the
//      baseline): the run merely did not re-raise it (LLM variance), so it is `unchecked` with reason 'code-unchanged'
//      (E2E 2026-09-29: a full rescan at the baseline SHA listed 3 "fixed" findings, one of them measured again).
// GCP findings (deterministic IAM / BigQuery scans appended after the agentic pipeline) are not in the findings
// checkpoint, so both sides drop them (`excludeFromDiff`) rather than reporting them "new" on every run.
import type { Finding } from './schema.ts';
import type { FindingKeys } from './findingKey.ts';
import { fuzzyChanged, fuzzyPairs, fuzzyThreshold, type FuzzyFeatures } from './fuzzyMatch.ts';

export type SinceStatus = 'new' | 'persisting' | 'changed';
// `ruledOut`: the caller's isRuledOutFinding (reportAnchors.ts) — passed in so this module imports no renderer (no cycle).
// `fz`: the fuzzy tier's features (fuzzyMatch.ts) — absent ⇒ the row takes part in the three hashed tiers only.
export interface KeyedFinding { f: Pick<Finding, 'id' | 'title' | 'severity' | 'source'>; k: Pick<FindingKeys, 'key' | 'evidenceKey' | 'looseKey' | 'bundleId'>; displayId?: string; ruledOut?: boolean; fz?: FuzzyFeatures; path?: string }
/**
 * Why a baseline finding is listed as not settled (E2E 2026-10-01 #3 — every row said "the review did not run" although
 * 4 of them were budget-skipped re-checks in lanes that DID run):
 *   not-run           — the lane that owns it did not run this time (Comprehend did not activate its bundle)
 *   incomplete        — that lane ran but did not complete (failed / cut short by the budget)
 *   recheck-budget    — its targeted re-check was skipped (the run budget, or the per-run re-check cap)
 *   recheck-unsettled — its targeted re-check ran but could not settle it
 *   code-unchanged    — not raised again, but its code did not change (so it cannot have been fixed)
 */
export type UncheckedWhy = 'not-run' | 'incomplete' | 'recheck-budget' | 'recheck-unsettled' | 'code-unchanged';
export const UNCHECKED_WHYS: UncheckedWhy[] = ['recheck-budget', 'recheck-unsettled', 'not-run', 'incomplete', 'code-unchanged'];
/** The reason clause (singular "it" / plural "them" by `n`). */
export function uncheckedWhyText(why: UncheckedWhy | undefined, n = 1): string {
  const one = n === 1;
  const it = one ? 'it' : 'them', its = one ? 'its' : 'their', was = one ? 'was' : 'were', has = one ? 'has' : 'have', s = one ? '' : 's';
  const t: Record<UncheckedWhy, string> = {
    'not-run': `the review that raised ${it} did not run in this scan`,
    incomplete: `the review that raised ${it} did not complete in this scan (cut short by the run budget, or failed)`,
    'recheck-budget': `${its} targeted re-check${s} ${was} skipped — the run budget (or the per-run re-check cap) ran out`,
    'recheck-unsettled': `${its} targeted re-check${s} ran but could not settle ${it}`,
    'code-unchanged': `not raised again this time, but ${its} code ${has} not changed since the last scan`,
  };
  return t[why ?? 'not-run'];
}
/** Per-reason counts of the unchecked rows (only reasons that occur). */
export function uncheckedByWhy(rows: { why?: UncheckedWhy }[]): Partial<Record<UncheckedWhy, number>> {
  const out: Partial<Record<UncheckedWhy, number>> = {};
  for (const r of rows) { const w = r.why ?? 'not-run'; out[w] = (out[w] ?? 0) + 1; }
  return out;
}
/** `4 re-check skipped (budget) · 3 not run · 2 code unchanged` — the compact run-log / run-page form. */
export function uncheckedBreakdown(by: Partial<Record<UncheckedWhy, number>>): string {
  const short: Record<UncheckedWhy, string> = { 'recheck-budget': 're-check skipped (budget)', 'recheck-unsettled': 're-check unsettled', 'not-run': 'review not run', incomplete: 'review incomplete', 'code-unchanged': 'code unchanged' };
  return UNCHECKED_WHYS.filter((w) => by[w]).map((w) => `${by[w]} ${short[w]}`).join(' · ');
}
export interface SinceBaseline { runId: string; date: string; sha?: string; by?: string }
export interface SinceLastScan {
  baseline: SinceBaseline;
  counts: { fixed: number; new: number; persisting: number; changed: number; unchecked: number };
  /** Per current finding id (Finding.id) — first occurrence wins for a duplicated id. */
  tags: Record<string, { status: SinceStatus; since?: string; key: string }>;
  /** Baseline findings not found again in a re-checked bundle. */
  fixed: { title: string; severity: string; displayId?: string; key: string }[];
  unchecked: { title: string; severity: string; key: string; bundleId: string; why: UncheckedWhy }[];
  /** Positional status of every current finding (aligned with the input array; undefined for excluded/ruled-out rows). */
  statuses: (SinceStatus | undefined)[];
}

export function excludeFromDiff(f: Pick<Finding, 'source'>): boolean { return /^gcp[-_]/i.test(String(f.source ?? '')); }

export function diffSinceLastScan(
  current: KeyedFinding[], baseline: KeyedFinding[], meta: SinceBaseline,
  opts: { checkedBundles?: Set<string>; ranBundles?: Set<string>; uncheckedLoose?: Set<string>; uncheckedWhy?: Map<string, UncheckedWhy>; firstSeen?: (key: string) => string | undefined; fuzzyThreshold?: number; canBeFixed?: (b: KeyedFinding) => boolean } = {},
): SinceLastScan {
  const live = (x: KeyedFinding): boolean => !excludeFromDiff(x.f) && x.ruledOut !== true;
  const base = baseline.filter(live);
  const claimed = new Set<number>();
  const statuses: (SinceStatus | undefined)[] = current.map(() => undefined);
  const matchedBase: (number | undefined)[] = current.map(() => undefined);   // which baseline row each current row matched
  const matchBy = (field: 'key' | 'evidenceKey' | 'looseKey', status: SinceStatus): void => {
    const idx = new Map<string, number[]>();
    base.forEach((b, i) => { if (claimed.has(i)) return; const a = idx.get(b.k[field]) ?? []; a.push(i); idx.set(b.k[field], a); });
    current.forEach((c, i) => {
      if (statuses[i] || !live(c)) return;
      const pool = idx.get(c.k[field]);
      const j = pool?.find((x) => !claimed.has(x));
      if (j == null) return;
      claimed.add(j); statuses[i] = status; matchedBase[i] = j;
    });
  };
  matchBy('key', 'persisting');
  matchBy('evidenceKey', 'persisting');
  matchBy('looseKey', 'changed');
  // 4. The fuzzy tier over what is still unmatched on both sides (live rows with features only).
  const thr = opts.fuzzyThreshold ?? fuzzyThreshold();
  const curFz = current.map((c, i) => (statuses[i] || !live(c) ? undefined : c.fz));
  const baseFz = base.map((b, i) => (claimed.has(i) ? undefined : b.fz));
  for (const [i, j] of fuzzyPairs(curFz, baseFz, thr)) { claimed.add(j); matchedBase[i] = j; statuses[i] = fuzzyChanged(curFz[i]!, baseFz[j]!) ? 'changed' : 'persisting'; }
  current.forEach((c, i) => { if (!statuses[i] && live(c)) statuses[i] = 'new'; });
  const fixed: SinceLastScan['fixed'] = [];
  const unchecked: SinceLastScan['unchecked'] = [];
  base.forEach((b, i) => {
    if (claimed.has(i)) return;
    const row = { title: String(b.f.title ?? ''), severity: String(b.f.severity ?? ''), key: b.k.key, bundleId: b.k.bundleId };
    // The precise reason first (a parked re-check says why), then the lane's own state (not run / not completed).
    if (opts.uncheckedLoose?.has(b.k.looseKey)) unchecked.push({ ...row, why: opts.uncheckedWhy?.get(b.k.looseKey) ?? 'not-run' });
    else if (opts.checkedBundles && !opts.checkedBundles.has(b.k.bundleId)) unchecked.push({ ...row, why: opts.ranBundles?.has(b.k.bundleId) ? 'incomplete' : 'not-run' });
    else if (opts.canBeFixed && !opts.canBeFixed(b)) unchecked.push({ ...row, why: 'code-unchanged' });
    else fixed.push({ title: String(b.f.title ?? ''), severity: String(b.f.severity ?? ''), ...(b.displayId ? { displayId: b.displayId } : {}), key: b.k.key });
  });
  const tags: SinceLastScan['tags'] = {};
  current.forEach((c, i) => {
    const s = statuses[i]; if (!s) return;
    const id = String(c.f.id ?? ''); if (tags[id]) return;
    // First seen: the MATCHED baseline row's key (a re-worded / moved finding has a new key of its own), else its own.
    const bk = matchedBase[i] != null ? base[matchedBase[i]!].k.key : undefined;
    const since = s === 'new' ? undefined : ((bk ? opts.firstSeen?.(bk) : undefined) ?? opts.firstSeen?.(c.k.key) ?? meta.date);
    tags[id] = { status: s, ...(since ? { since } : {}), key: c.k.key };
  });
  const n = (s: SinceStatus): number => statuses.filter((x) => x === s).length;
  return { baseline: meta, counts: { fixed: fixed.length, new: n('new'), persisting: n('persisting'), changed: n('changed'), unchecked: unchecked.length }, tags, fixed, unchecked, statuses };
}

// ── Text of the Leadership brief's "Since last scan" row (rendered by reportAnchors.ts inside the Area-health block,
// so it rides the same idempotent inject / re-inject path). ────────────────────────────────────────────────────────────
export function sinceLastScanLine(s: SinceLastScan): string {
  const c = s.counts;
  const sha = s.baseline.sha ? s.baseline.sha.slice(0, 7) : '';
  return `${c.fixed} fixed · ${c.new} new · ${c.persisting} persisting${c.changed ? ` · ${c.changed} changed` : ''} · baseline ${s.baseline.date}${sha ? ` @ ${sha}` : ''}`;
}
