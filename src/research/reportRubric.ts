// Report QC vocabulary shared by the report writers and checks:
//   • the EVIDENCE LEDGER (buildLedger) — the certified numbers of a run's measurements: the top-line value PLUS its
//     `sampleRows` + `counterfactual.baseline` + `subMeasurements` (the derived numbers live there, not only the
//     top-line). A number that is not ledger-backed and not labelled analyst-computed is untraceable.
//   • QcFinding / ReportTier — the shape of a QC finding (htmlQc.ts).
//   • the R7 plain-language rules — the leadership-tier plumbing / codename vocabulary every deterministic leadership
//     surface scrubs against (reportAnchors.ts).
// Pure: no I/O.

import type { Hypothesis, Measurement } from './investigation.ts';

export interface LedgerEntry { artifactId: string; value: number | string; source?: string; query?: string }
export interface Ledger { entries: LedgerEntry[]; text: string; numbers: Set<string> }

const baselineOf = (cf: unknown): string | undefined => {
  if (!cf) return undefined;
  if (typeof cf === 'string') return cf;
  if (typeof cf === 'object' && cf !== null && 'baseline' in cf) return String((cf as { baseline?: unknown }).baseline ?? '');
  return undefined;
};
const sampleRowsText = (m: Measurement): string => {
  const sr = (m.evidence as { sampleRows?: unknown } | undefined)?.sampleRows ?? (m as { sampleRows?: unknown }).sampleRows;
  const arr = Array.isArray(sr) ? sr : sr ? [sr] : [];
  const base = baselineOf(m.counterfactual);
  return [...arr.map(String), base ? `baseline: ${base}` : ''].filter(Boolean).join(' | ');
};

// Pull every numeric token out of a string (for the "is this number certified?" membership set). Keeps both raw and
// comma-stripped forms (998,165 and 998165) so a report can format with separators and still match.
const NUM_RE = /-?\d[\d,]*\.?\d*/g;
function harvestNumbers(s: string, into: Set<string>): void {
  for (const m of s.match(NUM_RE) ?? []) {
    const raw = m.trim();
    if (!raw || raw === '-') continue;
    into.add(raw);
    const noc = raw.replace(/,/g, '');
    into.add(noc);
    // Certify percent-equivalents BOTH ways: R9 lets a rate stored as 0.804 render as 80.4% — so a
    // measured fraction also certifies its percent form, and a measured percent also certifies its fraction.
    const n = Number(noc);
    if (Number.isFinite(n)) {
      // Certify ROUNDED-FOR-READABILITY forms too. R9 REQUIRES rounding measured values (no raw 0.0418 floats), so a
      // measured 0.9164 must ALSO certify 0.916 / 0.92 / 91.6% — otherwise R3 (byte-exact traceability) and R9 directly
      // contradict and the writer can never clear both (the observed 2↔5 HARD oscillation). Add fixed-decimal + percent
      // roundings, in both trailing-zero ("0.020") and trimmed ("0.02") string forms.
      const add = (x: number) => { into.add(x.toString()); };
      if (!Number.isInteger(n)) for (const dp of [2, 3, 4]) { into.add(n.toFixed(dp)); add(Number(n.toFixed(dp))); }
      // percent aliases: DECIMAL forms only (91.6 / 91.64) — NEVER a bare whole-number percent like "92", which is
      // indistinguishable from an unrelated count and would let a fabricated bare number pass R3/R9.
      if (n > 0 && n < 1) { const p = n * 100; for (const dp of [1, 2]) into.add(p.toFixed(dp)); }
      // percent→fraction alias only for a NON-integer percent (e.g. 91.64 → 0.9164). A bare integer in 1..100 is far more
      // likely a COUNT than a percent, and 53 → "0.53" would let a fabricated rate pass — symmetric to the bare-integer
      // percent guard above. So gate on !Number.isInteger.
      if (n > 1 && n <= 100 && !Number.isInteger(n)) { const fr = n / 100; for (const dp of [2, 3, 4]) { into.add(fr.toFixed(dp)); add(Number(fr.toFixed(dp))); } }
    }
  }
}

export function buildLedger(hypotheses: Hypothesis[]): Ledger {
  const entries: LedgerEntry[] = [];
  const numbers = new Set<string>();
  const lines: string[] = [];
  for (const h of hypotheses) {
    const m = h.measurement as Measurement | undefined;
    if (!m) continue;
    const src = (m.evidence as { source?: string } | undefined)?.source ?? (m as { source?: string }).source;
    const dq = (m.evidence as { query?: string } | undefined)?.query ?? (m as { query?: string }).query;
    if (m.value != null) { entries.push({ artifactId: h.id, value: m.value, source: src, query: dq }); harvestNumbers(String(m.value), numbers); }
    const subParts: string[] = [];
    for (const s of m.subMeasurements ?? []) {
      const sv = (s as { value?: number | string }).value;
      if (sv != null) {
        const sm = s as { moveId?: string; kind?: string; move?: string; id?: string };
        const move = sm.moveId ?? sm.kind ?? sm.move ?? sm.id ?? 'move';   // real SubMeasurement uses moveId/kind
        entries.push({ artifactId: `${h.id}.${move}`, value: sv, source: (s as { source?: string }).source, query: (s as { query?: string }).query });
        harvestNumbers(String(sv), numbers);
        subParts.push(`${move}=${sv}`);
      }
    }
    // Must-beat baselines / floors (Measurement.nulls) are the comparison context for every measured value — a report
    // that states "X beat its null of Y" needs Y certified, else R3/R9 flags it as untraceable.
    const nullParts: string[] = [];
    for (const n of m.nulls ?? []) {
      const nv = (n as { value?: number | string }).value;
      const nm = (n as { name?: string }).name ?? 'null';
      if (nv != null) {
        entries.push({ artifactId: `${h.id}.null:${nm}`, value: nv, source: src });
        harvestNumbers(String(nv), numbers);
        nullParts.push(`${nm}=${nv}`);
      }
    }
    // The judge only sees `text` — so the per-hyp evidence blob MUST include the decomposition values + the must-beat
    // baselines, not just the top-line + sampleRows, else valid overlap/sole/reach/null numbers read as untraceable.
    const blob = [sampleRowsText(m), subParts.join(', '), nullParts.length ? `must-beat baselines: ${nullParts.join(', ')}` : ''].filter(Boolean).join(' | ');
    harvestNumbers(blob, numbers);
    lines.push(`[${h.id}] top-line=${m.value} · source=${(src ?? '').slice(0, 80)}\n   measured evidence (ALL numbers here are CERTIFIED): ${blob}`);
  }
  return { entries, numbers, text: lines.join('\n') };
}

// ── QC findings ─────────────────────────────────────────────────────────────────────────────────────────────────
export type Severity = 'HARD' | 'SOFT';
// A QC finding. `line`/`before`/`after` are the LINE-ANCHORED edit the codex read-only judge emits: the 1-based
// line in the report file, the exact current text, and the exact replacement — so the writer applies it surgically. The
// tool-free gpt-5.5 judge leaves them undefined and carries only `reason`/`fix` (prose).
export interface QcFinding { id: string; severity: Severity; reason: string; fix: string; line?: number; before?: string; after?: string }
// The R7 leadership-tier plumbing / codename rules, EXPORTED so every deterministic leadership surface (e.g. the
// injected "Where the detail lives" footer in reportAnchors.ts) scrubs against the SAME vocabulary this QC gate
// enforces — one rule set, not a second list that drifts. Non-global on purpose (match/test only, no lastIndex).
// SELECT must be UPPERCASE and paired with a following FROM so the ordinary English verb "select … from" in a
// recommendation isn't a false HARD; ZCARD/ZRANGE/file refs stay case-insensitive.
export const R7_SQL_RE = /\bSELECT\b[\s\S]{0,200}?\bFROM\b/;
export const R7_PLUMBING_RE = /\bZCARD\b|\bZRANGE\b|\b\w+\.(py|ts|json|sql)\b/i;
// Any snake_case identifier (swing_i2i, two_tower, dwd_*, *_table) or a bare i2i/usercf abbreviation.
export const R7_CODENAME_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b(?:i2i|usercf)\b/i;
export type ReportTier = 'area' | 'leadership';
