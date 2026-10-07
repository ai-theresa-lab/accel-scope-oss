// STABLE FINDING DISPLAY IDS ("F-01", "F-02", …) and the finding → area mapping the grouped surfaces share.
//
// WHY ONE PURE FUNCTION. The same finding used to appear in five or six reports under five or six different titles,
// so a reader could not tell that "the SSH allow-list is a regex" in the leadership brief, "U2-03" in the engineering
// report and "exec guard bypass" in an area tab were one defect. A short display id, minted ONCE from the run's own
// findings array and printed on every deterministic surface (engineering-report cards, the leadership "Where the
// detail lives" list, the Combined report's findings index, REMEDIATION.md section ids), is what lets the reader
// match them up. Every caller asks THIS function, over the SAME gated array, so the ids cannot disagree — the
// "two lists that disagreed" failure this codebase keeps producing is avoided by construction.
//
// ORDER: severity (critical → info), then confidence (high → low), then the existing array order. That is the order a
// reader should work in, and it is a pure function of the findings (no Date, no randomness), so the same run renders
// the same ids on every serve. remediationMd.ts re-implements the SAME order in ES5 for reports stored before
// display ids existed; findingIds.test.ts pins the two together.
//
// RULED-OUT rows (a refuted recommendation-audit hypothesis — checked and healthy) get NO F-id: they are not
// findings, and numbering them would make "F-07" read as a seventh defect. They are listed as "Ruled out".
import { isRuledOutFinding } from './reportAnchors.ts';
import { DOMAIN_BUNDLES } from './research/domainBundles.ts';
import { invariantByKey } from './research/invariants.ts';
import type { Finding } from './schema.ts';

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const CONF_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** The shape assignDisplayIds needs: a Finding, or a report view-model row that carries the same fields. */
export interface IdInput {
  severity?: string;
  confidence?: string;
  source?: string;
  /** A view-model row may already carry its disposition (reportHtml FindingVM / __ACCEL_DATA__). */
  ruledOut?: boolean;
  status?: string;
}

/** Is this row ruled out? The explicit view-model flags win; otherwise the Finding encoding (isRuledOutFinding). */
export function isRuledOutRow(f: IdInput): boolean {
  if (f.status === 'ruled-out') return true;
  if (f.status === 'confirmed') return false;
  if (f.ruledOut === true) return true;
  if (f.ruledOut === false) return false;
  return isRuledOutFinding({ source: String(f.source ?? ''), severity: f.severity as Finding['severity'] });
}

/** "F-01" … "F-99", then "F-100" — two digits keep a short list aligned, and a long one still stays unique. */
export function formatDisplayId(n: number): string {
  return `F-${n < 10 ? '0' : ''}${n}`;
}

/**
 * The display id of every row, POSITIONALLY aligned with the input: a string for a confirmed finding, `undefined` for
 * a ruled-out row. Pure and deterministic. Callers must pass the array the engineering report renders (the evidence-
 * gated findings), in its order, so every surface numbers the same finding the same way.
 */
export function assignDisplayIds(findings: readonly IdInput[]): (string | undefined)[] {
  const idx: number[] = [];
  findings.forEach((f, i) => { if (!isRuledOutRow(f)) idx.push(i); });
  const rank = (m: Record<string, number>, v: string | undefined, dflt: number): number => {
    const r = m[String(v ?? '').toLowerCase()];
    return r == null ? dflt : r;
  };
  // Array#sort is stable, but the index tiebreak is written out so the order never depends on the engine.
  idx.sort((a, b) => (rank(SEV_RANK, findings[a].severity, 5) - rank(SEV_RANK, findings[b].severity, 5))
    || (rank(CONF_RANK, findings[a].confidence, 3) - rank(CONF_RANK, findings[b].confidence, 3))
    || (a - b));
  const out: (string | undefined)[] = findings.map(() => undefined);
  idx.forEach((i, n) => { out[i] = formatDisplayId(n + 1); });
  return out;
}

/** Sort key for an F-id ("F-07" → 7); a row without one sorts last. */
export function displayIdRank(id: string | undefined): number {
  const m = /^F-(\d+)$/.exec(String(id ?? ''));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** The area (expert bundle) a finding belongs to — what the Combined report's tabs and the grouped lists key on. */
export interface FindingArea { key: string; label: string }

const BUNDLE_TITLE = new Map(DOMAIN_BUNDLES.map((b) => [b.id, b.title]));
const area = (key: string): FindingArea => ({ key, label: BUNDLE_TITLE.get(key)! });

/**
 * Which area owns this finding, or null when none can be named.
 *
 * Two encodings exist, and both are read here rather than guessed from text:
 *   • a recommendation-audit finding carries its bundle in the id (`<BUNDLE>:<hyp>`, uppercased by deep.ts);
 *   • a research finding carries its invariant (`re2`, `sw1`, …), and every built-in invariant is owner-tagged
 *     with its bundle.
 * A user-derived dimension (u1..uN), a GCP or a deterministic-miner finding has no owning bundle → null, and the
 * grouped lists put it under "Other findings".
 */
export function findingArea(f: Pick<Finding, 'id' | 'invariant'>): FindingArea | null {
  const id = String(f.id ?? '');
  const colon = id.indexOf(':');
  if (colon > 0) {
    const key = id.slice(0, colon).toLowerCase();
    if (BUNDLE_TITLE.has(key)) return area(key);
  }
  const owner = f.invariant ? invariantByKey(String(f.invariant).toLowerCase())?.owner : undefined;
  if (owner && BUNDLE_TITLE.has(owner)) return area(owner);
  return null;
}
