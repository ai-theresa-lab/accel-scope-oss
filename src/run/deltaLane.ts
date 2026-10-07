// deltaLane.ts — the DELTA LANE of the incremental re-scan.
//
// WHY. On the 2026-09-29 end-to-end (sindresorhus/p-limit, 4 code-native lanes, 1 file changed: .github/security.md)
// every lane had READ that one file, so the whole-lane reuse rule ("nothing it read changed") failed for all four and
// every lane re-ran from scratch: $13.65 against $14.17 for the full scan. A lane whose read set changed in only a few
// files (≤ THERESA_INCR_DELTA_MAX_FILES, planner: incremental.ts) is instead
//   1. REVIVED from its baseline snapshot at $0 (the same path as a reused lane);
//   2. given a DELTA CRITIQUE over just those files (runCritique({ focusPaths, priorKnown, maxProblems })), whose ≤ N NEW
//      problems go through the lane's normal Preflight → Expert (deepAudit, maxHypotheses ≤ N);
//   3. its revived findings that cite (or, for a measurement, NAME) a changed file leave the revived output and go to a
//      targeted re-verify at the findings stage (carryForward.deltaLaneSplit / runCarryForward `delta.recheck`); the rest
//      stay, marked persisting (code / inputs unchanged) or measured <date> (not re-measured); a revived hypothesis that
//      backs NO finding (ruled out / healthy / unsettled) but whose measurement read a changed file leaves the revived
//      set too (staleRevivedHypotheses) — its verdict + claim audit are not carried; the revived area report is dropped;
//   4. MERGED here: the new hypotheses are renumbered past every id the lane ever used (a new `h2` must never collide
//      with a revived / carried `h2` — carried ids are `…:PREV-H2`, derived from the id), a new hypothesis that is the
//      same defect as a kept revived finding (findingKey tiers + the fuzzy tier) is dropped as a duplicate, and the merged
//      lane is what the barrier snapshot saves — so the NEXT generation revives the merged lane (two-generation safe);
//   5. its read set = the baseline read set ∪ what the delta critique / expert read.
// PURE (no I/O, no LLM) apart from the value imports below; unit-tested.
import type { CoverageGap, Finding } from '../schema.ts';
import type { Hypothesis } from '../research/investigation.ts';
import { hypTitle, type Mitigation } from '../research/deep.ts';
import type { ReadSetSnapshot } from '../research/readSet.ts';
import { findingKeys } from '../findingKey.ts';
import { fuzzyFeatures, fuzzyPairs, fuzzyThreshold } from '../fuzzyMatch.ts';
import { measurementInputState, type InputIndex } from './carryForward.ts';

export interface DeltaLaneParts { hypotheses: Hypothesis[]; mitigations: Mitigation[]; gaps: CoverageGap[]; findings: Finding[]; trace: string; toolTally: Record<string, number> }

/** The workspace paths (`<dir>/<rel>`) of repo-normalized changed files (`owner/name/<rel>`) — the Critic's focus list. */
export function deltaFocusPaths(files: string[], repos: { fullName: string; dir: string }[]): string[] {
  return files.map((p) => { const r = repos.find((x) => p.toLowerCase().startsWith(x.fullName.toLowerCase() + '/')); return r ? `${r.dir}${p.slice(r.fullName.length)}` : p; });
}

/** The highest `h<N>` number any of these ids carries (`swe-arch:h3`, `SWE-ARCH:PREV-H7`, `SWE-ARCH:H2-RECHECK` …). */
export function maxHypNumber(ids: string[]): number {
  let n = 0;
  for (const id of ids) for (const m of String(id ?? '').matchAll(/(?:^|[:\-])h(\d+)(?=$|[^0-9])/gi)) n = Math.max(n, Number(m[1]));
  return n;
}

/** Renumber a delta's hypotheses `<bundle>:h<k>` → `<bundle>:h<start+k'>` (ids, measurement payload refs, mitigations, gaps). */
export function renumberDelta(bundleId: string, d: Pick<DeltaLaneParts, 'hypotheses' | 'mitigations' | 'gaps'>, start: number): { hypotheses: Hypothesis[]; mitigations: Mitigation[]; gaps: CoverageGap[]; map: Map<string, string> } {
  const map = new Map<string, string>();
  d.hypotheses.forEach((h, i) => map.set(String(h.id).toLowerCase(), `${bundleId}:h${start + i + 1}`));
  const re = (id: string | undefined): string | undefined => (id == null ? id : map.get(String(id).toLowerCase()) ?? id);
  const hypotheses = d.hypotheses.map((h) => {
    const nid = re(h.id)!;
    const ev = h.measurement?.evidence;
    const measurement = h.measurement && ev && ev.ref === `measurement:${h.id}` ? { ...h.measurement, evidence: { ...ev, ref: `measurement:${nid}` } } : h.measurement;
    return { ...h, id: nid, ...(measurement ? { measurement } : {}) };
  });
  const mitigations = d.mitigations.map((m) => ({ ...m, hypothesisId: re(m.hypothesisId)! }));
  const gaps = d.gaps.map((g) => {
    const hid = g.hypothesisId ? re(g.hypothesisId) : undefined;
    const gid = map.get(String(g.id ?? '').toLowerCase());
    return { ...g, ...(hid ? { hypothesisId: hid } : {}), ...(gid ? { id: gid.toUpperCase() } : {}) };
  });
  return { hypotheses, mitigations, gaps, map };
}

/** A hypothesis seen as the Finding it would become (title + its measurement source) — for the duplicate check. */
export function hypAsFinding(h: Hypothesis): Finding {
  const ref = String(h.measurement?.evidence?.source ?? h.measurement?.source ?? '');
  return { id: String(h.id).toUpperCase(), dimension: 'product_metrics', title: hypTitle(String(h.claim ?? '')), claim: String(h.claim ?? ''), evidence: ref ? [{ kind: 'computation', ref }] : [], businessImpact: '', recommendation: '', severity: 'medium', confidence: 'medium', effort: 'moderate', source: 'recommendation-audit' };
}

/**
 * The revived hypotheses that back NO baseline finding (ruled-out / healthy / unsettled verdicts) but whose measurement
 * READ a changed file — its source ref, query or note names one (carryForward.measurementInputState, repo-scoped).
 * deltaLaneSplit only judges findings, so these stayed in a delta lane with their claim audits carried at $0 even though
 * what they measured moved; the caller drops them from the revived set so the delta critique / Expert
 * over the changed files can re-derive them. Returns their ids, lowercased.
 */
export function staleRevivedHypotheses(hyps: Hypothesis[], backed: Set<string>, changed: Set<string>, repos: { fullName: string; dir: string }[], inputs?: InputIndex): string[] {
  const out: string[] = [];
  for (const h of hyps) {
    const id = String(h.id).toLowerCase();
    if (backed.has(id)) continue;
    const m = h.measurement;
    const ref = String(m?.evidence?.source ?? m?.source ?? '');
    const detail = [m?.evidence?.query, m?.note, h.plannedMeasurement?.decisiveQuery].filter(Boolean).join(' ').slice(0, 2000);
    if (!ref && !detail) continue;
    const f = { evidence: [{ kind: 'computation', ref: ref || 'measurement', ...(detail ? { detail } : {}) }] } as Finding;
    if (measurementInputState(f, changed, inputs ?? { files: [], repos }).state === 'changed') out.push(id);
  }
  return out;
}

/**
 * Merge a delta's output into the revived lane. `base` = the revived lane MINUS the hypotheses that left it for a
 * re-check; `kept` = the baseline findings those remaining hypotheses reproduce (the duplicate check compares against
 * them); `usedIds` = every id the lane ever carried (revived / re-check / carried / pending) so renumbering never
 * collides. Returns the merged parts + which delta hypotheses were ADDED and which were dropped as DUPLICATES.
 */
export function mergeDeltaLane(bundleId: string, base: DeltaLaneParts, kept: Finding[], usedIds: string[], delta: DeltaLaneParts, o: { metricOf?: (h: Hypothesis) => string | undefined; keptMetricOf?: (f: Finding) => string | undefined; fuzzyThreshold?: number } = {}): { out: DeltaLaneParts; added: string[]; duplicates: string[] } {
  const start = maxHypNumber([...usedIds, ...base.hypotheses.map((h) => h.id), ...base.gaps.map((g) => g.hypothesisId ?? g.id)]);
  const rn = renumberDelta(bundleId, delta, start);
  // Duplicates: the same defect as a KEPT revived finding (key / evidenceKey / looseKey, then the fuzzy tier).
  const keptKeys = kept.map((f) => findingKeys(f));
  const cand = rn.hypotheses.map((h) => hypAsFinding(h));
  const dup = new Set<number>();
  cand.forEach((f, i) => { const k = findingKeys(f); if (keptKeys.some((x) => x.key === k.key || x.evidenceKey === k.evidenceKey || x.looseKey === k.looseKey)) dup.add(i); });
  const thr = o.fuzzyThreshold ?? fuzzyThreshold();
  for (const [i] of fuzzyPairs(cand.map((f, i) => (dup.has(i) ? undefined : fuzzyFeatures(f, { bundleId, metric: o.metricOf?.(rn.hypotheses[i]) }))), kept.map((f) => fuzzyFeatures(f, { bundleId, metric: o.keptMetricOf?.(f) })), thr)) dup.add(i);
  const dupIds = new Set([...dup].map((i) => String(rn.hypotheses[i].id).toLowerCase()));
  const keepH = rn.hypotheses.filter((h) => !dupIds.has(String(h.id).toLowerCase()));
  const tally: Record<string, number> = { ...base.toolTally };
  for (const [k, v] of Object.entries(delta.toolTally ?? {})) tally[k] = (tally[k] ?? 0) + v;
  return {
    out: {
      hypotheses: [...base.hypotheses, ...keepH],
      mitigations: [...base.mitigations, ...rn.mitigations.filter((m) => !dupIds.has(String(m.hypothesisId).toLowerCase()))],
      gaps: [...base.gaps, ...rn.gaps.filter((g) => !g.hypothesisId || !dupIds.has(String(g.hypothesisId).toLowerCase()))],
      findings: [...base.findings, ...delta.findings],
      trace: [base.trace, delta.trace ? `── delta critique (incremental re-scan) ──\n${delta.trace}` : ''].filter(Boolean).join('\n\n'),
      toolTally: tally,
    },
    added: keepH.map((h) => h.id),
    duplicates: [...dupIds],
  };
}

/** The read set of a delta lane: the baseline's ∪ what the delta critique / expert read (sorted, deduped). */
export function unionReadSets(a: Partial<ReadSetSnapshot>, b: Partial<ReadSetSnapshot>): Pick<ReadSetSnapshot, 'readSet' | 'globs' | 'greps' | 'opaque' | 'measured' | 'opened'> {
  const u = (x?: string[], y?: string[]): string[] => [...new Set([...(x ?? []), ...(y ?? [])])].sort();
  const greps = [...(a.greps ?? []), ...(b.greps ?? [])];
  const seen = new Set<string>();
  return {
    readSet: u(a.readSet, b.readSet), globs: u(a.globs, b.globs),
    greps: greps.filter((g) => { const k = JSON.stringify(g); if (seen.has(k)) return false; seen.add(k); return true; }),
    opaque: u(a.opaque, b.opaque), measured: u(a.measured, b.measured),
    // The files actually opened (the capability map's "examined" signal) — carried only when either side recorded them.
    ...(a.opened || b.opened ? { opened: u(a.opened, b.opened) } : {}),
  };
}

/** The claim-audit carry line, reused and DELTA lanes counted apart (an end-to-end run: "8 verdict(s) of 3 reused lane(s)"
 *  hid that 2 of the 3 were delta lanes, whose NEW verdicts are audited fresh). */
export function claimAuditCarryLine(verdicts: number, reused: number, delta: number, parentLabel: string): string {
  const parts = [reused ? `${reused} reused lane(s)` : '', delta ? `${delta} Change lane(s) (their new verdicts are audited fresh)` : ''].filter(Boolean).join(' + ');
  return `stage:claim-audit · ⟳ ${verdicts} verdict(s) of ${parts} carried from ${parentLabel} · $0`;
}
