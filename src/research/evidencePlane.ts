import { MEASURE_PLANE_CLASS, type MeasurePlane } from './investigation.ts';
// EVIDENCE PROVENANCE — was this claim MEASURED against the project's live systems, or READ off their code?
//
// WHY THIS EXISTS. Every finding the Critique→Expert machine produces was stamped `kind: 'computation'`,
// regardless of where its value came from. Measured across two real runs:
//
//   run A ($55.43, 11 findings) — 10 of 11 from READING FILES. Its own comprehend cut
//     recorded `repos: 0` and `codeintel: false`, so the deterministic spine contributed nothing either.
//   run B ($81.03, 19 findings) — 12 of 19 MEASURED (7 warehouse, 3 key-value, 2 analytics):
//     63%, and not reproducible by reading a repo at any price.
//
// Both rendered identically, because `Evidence.kind` was the same constant for a grep over a workflow file
// and a BigQuery query across 120,000 users. The schema has carried a `metric` kind the whole time and
// nothing ever set it. So the single property that separates this product from pointing a coding agent at
// the repo — "we measured this on YOUR data" — was invisible in the deliverable, and a report full of
// code-reading findings looked exactly as authoritative as one full of measured ones.
//
// The classifier is DETERMINISTIC: it scans the `<plane>:` tokens the measure step already writes into the
// ref, and never asks a model what it measured. See isLivePlaneRef for why an ANCHORED prefix test is not
// enough — real refs join planes (`repo+redis+acmedash:`) and chain them (`code:… ; redis:…`).

/** Planes that answer from the project's LIVE systems. Extended per-run by the mounted server names. */
export const BUILTIN_LIVE_PLANES = ['warehouse', 'redis', 'probe'];

/**
 * `^(<plane>|<plane>|…):` over the builtins plus this run's mounted measure-plane server names
 * (e.g. `acmedash`, `amplitude`), so a custom plane is recognised on the run that mounted it
 * and not on one that did not.
 *
 * Metacharacters are ESCAPED, never stripped: stripping would change the token, so a server name carrying
 * a `-` or `.` would stop matching its own `<serverName>:` prefix and silently be graded as unmeasured.
 */
/**
 * DEPRECATED — prefer isLivePlaneRef(). This anchored form only matches a ref whose FIRST token is a live
 * plane, so it misses every compound ref (`repo+redis+acmedash:…`, `code:… ; redis:…`). Its last consumer
 * (scoreClaimRisk) was migrated off it, because scoring a compound ref as not-live meant
 * the measured claims were the ones that escaped reverification. Kept only for a caller that genuinely
 * wants prefix semantics; if you are reaching for it to answer "is this measured?", you want isLivePlaneRef.
 */
export function livePlaneRe(extraServerNames: string[] = []): RegExp {
  const names = [...new Set([...BUILTIN_LIVE_PLANES, ...extraServerNames])].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(${names.join('|')}):`, 'i');
}

/**
 * Did this evidence ref come from a live plane on this run?
 *
 * REFS ARE COMPOUND, so an anchored `^plane:` test is wrong. Measured on the real corpus, the measure
 * step writes all of these, and every one names a live query:
 *   `acmedash:analytics_dwd.app_event_detail_hourly`          — plain prefix
 *   `repo+redis+acmedash:analytics_dwd.app_event_detail_hourly` — planes JOINED into one prefix token
 *   `repo:config/strategy/default.json + redis:scan(...)`   — a second plane after a `+`
 *   `code:...service.py:19-22 ; acmedash:app_recommend...`  — a second plane after a `;`
 * An anchored test scored only 7 of run B's 19 findings as measured; scanning every `token:` and
 * splitting compound tokens on `+` scores 12, and each of those twelve names a warehouse, analytics or
 * key-value query in its own text.
 *
 * It stays CONSERVATIVE in the other direction: a plane name has to appear as a `<name>:` token, so prose
 * merely mentioning a plane never earns the stamp, and a derived result with no plane token at all
 * (`feed_holdout.marginal_grouped_auc + univariate_auc`) is correctly NOT a live measurement.
 */
export function isLivePlaneRef(ref: string | undefined, extraServerNames: string[] = []): boolean {
  const t = (ref ?? '').trim();
  if (!t) return false;
  const live = new Set([...BUILTIN_LIVE_PLANES, ...extraServerNames].map((s) => s.toLowerCase()).filter(Boolean));
  for (const m of t.matchAll(/([A-Za-z0-9_.+-]+)\s*:/g)) {
    // `repo+redis+acmedash:` is three planes joined — split before testing, else the whole token misses.
    if (m[1].split('+').some((part) => live.has(part.trim().toLowerCase()))) return true;
  }
  return false;
}

/**
 * The `Evidence.kind` a ref has EARNED.
 *
 * `metric` is reserved for a value pulled from a live plane — it is the credibility claim, so it is granted
 * only on the prefix the measure step itself wrote, never inferred from prose. Everything else stays
 * `computation` (the honest default: a derived or read value), which is exactly what every finding was
 * before this existed, so an unrecognised ref degrades to today's behaviour rather than over-claiming.
 */
export function evidenceKindFor(ref: string | undefined, extraServerNames: string[] = []): 'metric' | 'computation' {
  // FUTURE WORK FIRST. A compound ref like `needs-eval:h1 ; warehouse:q` used to earn `metric` on the
  // warehouse token alone — and `metric` is the ONE kind whose resolvability check trusts any non-empty ref
  // (schema.ts), so the promise was excluded from claim audit as a `computation` and then survived as a
  // Finding once it had been promoted. The guard belongs here, not only in provenanceClassOf.
  if (hasFutureWorkToken(ref)) return 'computation';
  return isLivePlaneRef(ref, extraServerNames) ? 'metric' : 'computation';
}

/**
 * The plane that produced a ref, for report display ("Measured · warehouse"). Returns undefined for a
 * non-live ref so a caller can render nothing rather than a misleading label.
 */
export function planeOf(ref: string | undefined, extraServerNames: string[] = []): string | undefined {
  const t = (ref ?? '').trim();
  if (!t) return undefined;
  const live = new Set([...BUILTIN_LIVE_PLANES, ...extraServerNames].map((s) => s.toLowerCase()).filter(Boolean));
  for (const m of t.matchAll(/([A-Za-z0-9_.+-]+)\s*:/g)) {
    for (const part of m[1].split('+')) {
      const p = part.trim().toLowerCase();
      if (live.has(p)) return p;   // the FIRST live plane named — refs list them in the order queried
    }
  }
  return undefined;
}

/** How many of a finding set were measured vs read — the number a run should report about ITSELF. */
export function measuredShare(
  findings: { evidence?: { kind?: string }[] }[],
): { measured: number; total: number; share: number } {
  let measured = 0; let total = 0;
  for (const f of findings) {
    const ev = f.evidence ?? [];
    if (!ev.length) continue;
    total++;
    if (ev.some((e) => e.kind === 'metric')) measured++;
  }
  return { measured, total, share: total ? measured / total : 0 };
}

// ── WHICH mounted planes can confer the MEASURED stamp ──────────────────────────────────────────
//
// The v4 contract makes a SPECIFIC promise about this stamp: a MEASURED verdict "was computed against the
// reader's OWN running systems and could not have been produced by reading the repository". Only planes
// that actually satisfy that sentence may confer it.
//
// This is an ALLOWLIST, not a denylist, and it got there the hard way — two rounds of review, each finding
// another plane the denylist had let through:
//   • round 2 found `repogrep` (kind 'repo'): a read-only REFERENCE reader that execute-org-run mounts so
//     the measure session can read repos outside the mounted clone. deepAudit reads CODE through it, and
//     `repogrep:owner/repo/file.ts` was being stamped "[MEASURED · repogrep]".
//   • round 5 found `codeintel`, `repometa` and `osv`. These ARE real deterministic measurement sources —
//     they are in MEASURE_KIND, and they belong in a findings pipeline — but they are computed from a
//     PRECOMPUTED INDEX OF THE CLONED REPOSITORY (codeintel), from repository metadata (repometa), or by
//     matching the repo's dependency list against a public advisory database (osv). Every one of them
//     could have been produced by reading the repository, which is exactly what the promise excludes.
// A denylist would have needed a third round for the next plane kind. An allowlist means an unfamiliar kind
// earns nothing until someone decides it should, so the failure direction is UNDER-selling a finding rather
// than inflating a credibility claim — the same posture deep.ts already documents for this stamp.
//
// Both consumers (the Finding's Evidence.kind in deep.ts, and the report banner in leadershipVibe.ts) must
// read the SAME list, or the per-finding stamps and the headline count disagree. Hence one function.
// Derived from MEASURE_PLANE_CLASS (research/investigation.ts), NOT maintained here. A second list is
// what went wrong three times: this filter let `repogrep` claim live measurement, then
// `codeintel`/`repometa`/`osv`, and then `slack` — which is mounted as a readable plane but is NOT a
// MeasurePlane, so the measurement router already excluded it while this list did not. The canonical
// Record is exhaustive over MeasurePlane, so a new plane kind is a compile error until classified.
export function measurePlaneNames(planes: { kind?: string; serverName?: string }[]): string[] {
  return planes
    .filter((p) => p.serverName && MEASURE_PLANE_CLASS[(p.kind ?? '').toLowerCase() as Exclude<MeasurePlane, 'none'>] === 'live')
    .map((p) => p.serverName as string);
}

// The external-measurement plane kinds, from the same canonical Record.
export function externalPlaneNames(planes: { kind?: string; serverName?: string }[]): string[] {
  return planes
    .filter((p) => p.serverName && MEASURE_PLANE_CLASS[(p.kind ?? '').toLowerCase() as Exclude<MeasurePlane, 'none'>] === 'external')
    .map((p) => p.serverName as string);
}

// ── THREE PROVENANCE CLASSES, NOT TWO ───────────────────────────────────────────────────────────
//
// The allowlist above fixed a real over-claim (code reads wearing a live measurement's credibility) and
// then over-corrected: with only two states, everything that is not a live plane became "READ FROM CODE",
// which is false for a `datapoint:` (a recorded measurement from an eval run that actually executed) and
// for an `osv:` advisory lookup. Neither is a live-system measurement, and neither could have been
// produced by reading the repository. Collapsing them into "read from code" UNDER-sells real work with
// the same confidence the old code OVER-sold it. Both directions are the report lying about provenance.
//
//   'live'     — queried against the reader's own running systems, now.
//   'external' — a measurement that really happened, but not against a live system in this run: a
//                recorded eval datapoint, a public advisory database, repository metadata from an API.
//   'code'     — read out of the source, including anything derived from an index OF the source
//                (codeintel, repogrep) and anything unrecognised. The conservative default.
//
// KNOWN LIMIT: a bare datapoint id with no `datapoint:` prefix (Measurement.source documents that shape)
// classifies as 'code'. That is the safe direction and it is not guessed at here — an unprefixed opaque
// id is not distinguishable from any other string.
// NOT 'eval' (nor 'proposed' / 'measurement' / 'tbd'): schema.ts's FUTURE_WORK_REF classifies those as
// PROPOSED work, and a value-bearing hypothesis with `source: 'eval:h1'` is excluded from claim audit as
// non-resolvable, so it survives claimAuditSurvivors and would have reached the writer stamped as a
// measurement that happened. Presenting proposed work as done evidence is the worst version of this bug.
const EXTERNAL_MEASUREMENT_TOKENS = new Set(['datapoint', 'datapoints', 'osv', 'repometa', 'advisory']);

// Refs schema.ts's FUTURE_WORK_REF treats as PROPOSED work rather than evidence. Kept in step with that
// vocabulary, and NORMALISED for separator spelling: the schema matches `needs[_-]?eval`, `future[_-]?work`
// and `synthesis[_-]?ref`, so a token set of literal strings missed `needs-eval` while catching
// `needs_eval` — which is exactly the spelling that slipped through.
const FUTURE_WORK_TOKEN = /^(?:evals?|needseval|futurework|proposed|synthesis|synthesisref|measurement|tbd|todo|pending|unknown|none|n\/?a)$/i;

function normalizeToken(tok: string): string { return tok.replace(/[_-]/g, ''); }

export function hasFutureWorkToken(ref: string | undefined): boolean {
  const t = (ref ?? '').toLowerCase();
  if (!t) return false;
  for (const m of t.matchAll(/([A-Za-z0-9_.+-]+)\s*:/g)) {
    for (const part of m[1].split('+')) if (FUTURE_WORK_TOKEN.test(normalizeToken(part.trim()))) return true;
  }
  return false;
}

export type ProvenanceClass = 'live' | 'external' | 'code';

export function provenanceClassOf(ref: string | undefined, extraServerNames: string[] = []): ProvenanceClass {
  const t = (ref ?? '').toLowerCase();
  if (!t) return 'code';
  const tokens: string[] = [];
  // Same compound-aware scan as isLivePlaneRef: every `token:`, split on '+'.
  for (const m of t.matchAll(/([A-Za-z0-9_.+-]+)\s*:/g)) for (const part of m[1].split('+')) tokens.push(part.trim());
  // A future-work ref is a PROMISE, never evidence — checked before either measured state can be granted.
  if (hasFutureWorkToken(ref)) return 'code';
  if (isLivePlaneRef(ref, extraServerNames)) return 'live';
  if (tokens.some((tok) => EXTERNAL_MEASUREMENT_TOKENS.has(tok))) return 'external';
  return 'code';
}

// WHICH external source it was. The single "an eval result or external advisory" label was wrong for
// `repometa:` (CI pass rates and PR history through the GitHub metadata API are neither), and the raw source
// is not otherwise in the verdict material — so the writer was told to say what produced the evidence while
// being given no way to know. Returns the recognised token so the tag can name it.
export function externalSourceOf(ref: string | undefined): string | undefined {
  const t = (ref ?? '').toLowerCase();
  for (const m of t.matchAll(/([A-Za-z0-9_.+-]+)\s*:/g)) {
    for (const part of m[1].split('+')) {
      const tok = part.trim();
      if (EXTERNAL_MEASUREMENT_TOKENS.has(tok)) return tok;
    }
  }
  return undefined;
}
