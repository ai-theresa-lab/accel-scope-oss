// fuzzyMatch.ts — the FUZZY match tier of the incremental re-scan.
// PURE: no I/O, no LLM.
//
// WHY. The three hashed keys (findingKey.ts: key / evidenceKey / looseKey) all need either the same title STEM or the
// same cited snippet. A re-run lane re-derives its findings from scratch, so the LLM re-words the title ("Release
// workflow lacks provenance attestation" → "No provenance attestation in the release workflow") and a code-native
// measurement cites no file at all — on the 2026-09-29 end-to-end (sindresorhus/p-limit, 4 lanes, 1 file changed) every
// re-found defect missed all three keys and was reported "new" while its baseline twin read "not re-checked".
//
// THE TIER (run AFTER the three keys, in both sinceLastScan.diffSinceLastScan and carryForward.planCarry, and in the
// delta-lane duplicate check deltaLane.mergeDeltaLane): a baseline finding and a current one are the same defect when
// they have the SAME bundle AND the SAME invariant AND at least one of
//   • normalized-title token Jaccard ≥ THERESA_INCR_FUZZY (default 0.5; stopwords + numbers removed, plural `s` folded);
//   • the same hypothesis / measurement METRIC name, when both know it;
//   • overlapping evidence refs AND a title Jaccard ≥ half the threshold. Overlap is only a BONUS: two different defects
//     routinely cite the same file (`ci.yml`) or the same probe, so overlap alone never pairs.
//     Overlap = the same file path (suffix-tolerant: `app/src/a.ts` = `src/a.ts`), the same `kind:ref` stem (whitespace
//     collapsed, digits dropped — a re-measured value moves) or the same concrete path mentioned in a measurement ref
//     (a token with a `/`, findingKey.evidenceInputTokens). A `kind:ref` stem carried by > 1 finding on either side of
//     one fuzzyPairs call is NON-DISTINCTIVE and ignored.
// Two findings with NO invariant on either side (deep-audit lane findings carry none) pair only on a metric match — the
// invariant is otherwise the tier's main guard against pairing unrelated rows of one bundle.
// ONE-TO-ONE, highest similarity first (score = Jaccard + 1 for a metric match + 0.5 for an evidence overlap; ties keep
// input order). Never across bundles or invariants. A fuzzy match is reported `persisting`, or `changed` when the
// severity or the cited file set differs (the caller decides with fuzzyChanged).
import type { Finding } from './schema.ts';
import { evidenceInputTokens, findingBundleId, parseCitedRange, titleWords } from './findingKey.ts';

export interface FuzzyFeatures {
  bundleId: string;
  invariant: string;           // lowercased ('' when none — two invariant-less findings of one bundle compare)
  words: string[];             // titleWords, plural `s` folded
  metric?: string;             // the hypothesis's decisive / agent-named metric, lowercased
  stems: string[];             // `f:<path>` file stems + `<kind>:<normalized ref>` stems
  severity?: string;
}

export function fuzzyThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.THERESA_INCR_FUZZY);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.5;
}

// A few more function words than findingKey's identity STOP list (which must stay stable — it shapes the keys).
const EXTRA_STOP = new Set(['but', 'than', 'which', 'when', 'into', 'only', 'all', 'any', 'there', 'their', 'so', 'been', 'being', 'also', 'does', 'do', 'has', 'have', 'had', 'via', 'per', 'across', 'without']);
const fold = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export function fuzzyWords(title: string | undefined): string[] {
  return [...new Set(titleWords(title).filter((w) => !EXTRA_STOP.has(w)).map(fold))];
}

const normRef = (r: string): string => String(r ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '').trim().slice(0, 120);
const normPath = (p: string): string => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();

/** The evidence stems of a finding (see the header). */
export function evidenceStems(f: Pick<Finding, 'evidence'>): string[] {
  const out = new Set<string>();
  for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
    if (!e || !String(e.ref ?? '').trim()) continue;
    if (e.kind === 'file') { const p = normPath(parseCitedRange(String(e.ref)).path); if (p) out.add(`f:${p}`); }
    else out.add(`${e.kind}:${normRef(String(e.ref))}`);
  }
  for (const t of evidenceInputTokens(f)) if (t.includes('/') && !/[*?{]/.test(t)) out.add(`f:${normPath(t)}`);
  return [...out];
}

export function fuzzyFeatures(f: Pick<Finding, 'id' | 'title' | 'invariant' | 'source' | 'evidence' | 'severity'>, o: { metric?: string; bundleId?: string } = {}): FuzzyFeatures {
  return {
    bundleId: o.bundleId ?? findingBundleId(f), invariant: String(f.invariant ?? '').toLowerCase(), words: fuzzyWords(f.title),
    ...(o.metric && o.metric.trim() ? { metric: o.metric.trim().toLowerCase() } : {}), stems: evidenceStems(f),
    ...(f.severity ? { severity: String(f.severity) } : {}),
  };
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function stemsOverlap(a: string[], b: string[]): boolean {
  for (const x of a) for (const y of b) {
    if (x === y) return true;
    if (x.startsWith('f:') && y.startsWith('f:')) { const p = x.slice(2), q = y.slice(2); if (p.endsWith('/' + q) || q.endsWith('/' + p)) return true; }
  }
  return false;
}

/** The similarity of two findings, or null when the tier does not consider them the same defect. */
export function fuzzySimilarity(a: FuzzyFeatures, b: FuzzyFeatures, threshold = fuzzyThreshold()): number | null {
  if (a.bundleId !== b.bundleId || a.invariant !== b.invariant) return null;
  const j = jaccard(a.words, b.words);
  const metric = Boolean(a.metric && b.metric && a.metric === b.metric);
  if (!a.invariant && !b.invariant && !metric) return null;
  const overlap = stemsOverlap(a.stems, b.stems);
  if (!(j >= threshold || metric || (overlap && j >= threshold / 2))) return null;
  return j + (metric ? 1 : 0) + (overlap ? 0.5 : 0);
}

/** `kind:ref` stems (not `f:` paths) carried by more than one entry of one side — non-distinctive, ignored for overlap. */
function commonRefStems(side: (FuzzyFeatures | undefined)[]): Set<string> {
  const n = new Map<string, number>();
  for (const x of side) for (const s of new Set(x?.stems ?? [])) if (!s.startsWith('f:')) n.set(s, (n.get(s) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c > 1).map(([s]) => s));
}

/**
 * Greedy one-to-one pairing, highest similarity first. `left` / `right` entries that are undefined (already matched by
 * a stricter key, excluded, no features) never pair. Returns [leftIndex, rightIndex] pairs.
 */
export function fuzzyPairs(left: (FuzzyFeatures | undefined)[], right: (FuzzyFeatures | undefined)[], threshold = fuzzyThreshold()): [number, number][] {
  const common = new Set([...commonRefStems(left), ...commonRefStems(right)]);
  const strip = (x: FuzzyFeatures | undefined): FuzzyFeatures | undefined => (x && common.size ? { ...x, stems: x.stems.filter((s) => !common.has(s)) } : x);
  const L0 = left.map(strip), R0 = right.map(strip);
  const cands: { i: number; j: number; s: number }[] = [];
  L0.forEach((a, i) => { if (!a) return; R0.forEach((b, j) => { if (!b) return; const s = fuzzySimilarity(a, b, threshold); if (s != null) cands.push({ i, j, s }); }); });
  cands.sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j);
  const L = new Set<number>(), R = new Set<number>(), out: [number, number][] = [];
  for (const c of cands) { if (L.has(c.i) || R.has(c.j)) continue; L.add(c.i); R.add(c.j); out.push([c.i, c.j]); }
  return out;
}

/** A fuzzy match is `changed` (not `persisting`) when the severity or the cited FILE set differs. */
export function fuzzyChanged(a: FuzzyFeatures, b: FuzzyFeatures): boolean {
  if (a.severity && b.severity && a.severity !== b.severity) return true;
  const fa = a.stems.filter((s) => s.startsWith('f:')).sort(), fb = b.stems.filter((s) => s.startsWith('f:')).sort();
  if (fa.length !== fb.length) return true;
  return fa.some((x, i) => !(x === fb[i] || x.endsWith('/' + fb[i].slice(2)) || fb[i].endsWith('/' + x.slice(2))));
}
