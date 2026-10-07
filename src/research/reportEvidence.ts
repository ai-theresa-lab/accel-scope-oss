// Report-surface evidence formatting (cross-cutting X1 — the area-report audience split). The per-bundle
// AREA report is TECHNICAL + REPRODUCIBLE (it cites the concrete source/table names, the decisive query gist,
// probe ids, the grain, result snippets — like the senior-practitioner exemplar) — UNLIKE the de-jargoned
// leadership brief. To write that, the area writer needs the reproducible material the measurement already
// carries (EvidencePayload.source/query/grain/nulls, dataContract, counterfactual). This module turns a
// measured hypothesis into a compact EVIDENCE CARD for the prompt — through a deterministic SECRET/PII
// SANITIZER first (Non-Negotiable #3: no secrets, ever — defense-in-depth even though the measure agent's
// query/sampleRows are "no secrets/PII" by construction). PURE + unit-testable; no I/O, no LLM.
import type { Hypothesis, Measurement } from './investigation.ts';
import type { RecallReportInput, Viz, Cell } from '../recallReportHtml.ts';

// STRICT secret-bearing keys — the VALUE is always a secret, so redact it in bare (`k=v`) AND JSON (`"k":"v"`)
// form regardless of its shape. SOFT keys (token / api_key / auth) also name a credential, but their value is
// redacted bare ONLY when it LOOKS like one (≥16 credential-chars, not a SQL keyword/number) — so `WHERE auth =
// false` and `token IS NULL` are NOT over-redacted, while `auth=ab12…long` is. In JSON form a soft key's value
// is always redacted (a structured `"token":"…"` is almost certainly a real secret).
// Three key families, by how the key name is matched + how the value is treated:
//  STRICT_SUBSTR — the secret word anywhere in the key (`DATABASE_PASSWORD`, `aws_secret_access_key`); value
//                  always redacted (modulo a bare boolean/null keyword).
//  STRICT_END    — token-family always-secret keys, but ANCHORED to END the key so a metric like
//                  `refresh_tokens_issued` / `access_token_count` is NOT mistaken for the credential.
//  SOFT_END      — token/auth, ANCHORED to end the key; bare value redacted only when credential-shaped
//                  (`token IS NULL`, `WHERE auth = false`, `author`, `token_count` all kept).
const STRICT_SUBSTR = 'password|passwd|pwd|secret|client[_-]?secret|private[_-]?key|api[_-]?key|apikey|x-api-key';
const STRICT_END = 'access[_-]?token|refresh[_-]?token';
const SOFT_END = 'token|auth';
// A bare value that is a SQL/JSON keyword is never a credential — don't redact it even for a strict key
// (`WHERE has_secret = true` keeps `true`).
const KEYWORD_VAL = /^(?:true|false|null|none|n\/?a)$/i;
const unquote = (v: string): string => v.replace(/^["']|["']$/g, '');

// A `svg` viz emits RAW markup, so sanitizeReportInput drops it by default — a prompt-injected
// MODEL report could otherwise smuggle `<script>`. codeintelViz produces DETERMINISTIC, already-escaped
// svg and marks the viz object trusted here; rViz then redact-and-KEEPS a trusted svg (dropping any
// unmarked one). Provenance, not content-scrubbing: a model can't add its object to this WeakSet, and
// the mark can't survive JSON round-trips (so a serialized/replayed report can't forge trust).
const TRUSTED_SVG = new WeakSet<object>();
export function markTrustedSvgViz<T extends object>(v: T): T {
  if (v && typeof v === 'object') TRUSTED_SVG.add(v);
  return v;
}

// Redact credentials + PII from any text that may reach a report surface (Non-Negotiable #3 defense-in-depth).
// Conservative + deterministic — over-redacts a suspicious token rather than risk a leak — but deliberately
// NARROW on the ambiguous classes so it keeps the reproducible technical detail the area report needs (table
// names, query fragments, metric ids, dates, counts, hashes). Order matters; bounded quantifiers (no ReDoS).
export function redactSecrets(input: string): string {
  let s = String(input ?? '');
  s = s
    .replace(/-----BEGIN[\s\S]{0,4000}?END[^-]{0,40}-----/gi, '[redacted-key-block]')             // PEM key blocks (bounded)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]') // JWTs
    .replace(/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/gi, '[redacted-key]')           // sk-/sk-ant- secret keys (NOT pk-/rk-, which are public/legit ids)
    .replace(/\bAIzaSy[A-Za-z0-9_-]{20,}\b/g, '[redacted-key]')                                    // Google API key
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[redacted-token]')      // GitHub tokens
    .replace(/\bglpat-[A-Za-z0-9_-]{16,}\b/g, '[redacted-token]')                                  // GitLab PAT
    .replace(/\b(?:xox[baprse]|xapp)-[A-Za-z0-9-]{10,}\b/g, '[redacted-token]')                    // Slack tokens (incl. xoxe-/xapp-)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-aws-key]')                                        // AWS access key ids
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]')                              // Authorization: Bearer …
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{16,}/gi, 'Basic [redacted]')                                // Authorization: Basic <base64> (scheme is case-insensitive)
    // STRICT_SUBSTR (`DATABASE_PASSWORD`, `OPENAI_API_KEY`, `aws_secret_access_key`): value always redacted —
    // UNLESS it's a bare keyword (`has_secret = true` keeps `true`).
    .replace(new RegExp(`\\b([\\w-]*(?:${STRICT_SUBSTR})[\\w-]*)\\s*[:=]\\s*("[^"]*"|'[^']*'|\\S+)`, 'gi'), (m: string, k: string, v: string) => KEYWORD_VAL.test(unquote(v)) ? m : `${k}=[redacted]`)
    .replace(new RegExp(`"([\\w-]*(?:${STRICT_SUBSTR})[\\w-]*)"\\s*:\\s*"[^"]*"`, 'gi'), '"$1":"[redacted]"')                    // JSON strict-substr key
    // STRICT_END (access_token / refresh_token) — anchored to END the key (so `refresh_tokens_issued` is KEPT);
    // value always redacted (a token value is a secret at any length) modulo a bare keyword.
    .replace(new RegExp(`\\b([\\w-]*(?:${STRICT_END}))\\s*[:=]\\s*("[^"]*"|'[^']*'|\\S+)`, 'gi'), (m: string, k: string, v: string) => KEYWORD_VAL.test(unquote(v)) ? m : `${k}=[redacted]`)
    .replace(new RegExp(`"([\\w-]*(?:${STRICT_END})s?)"\\s*:\\s*"[^"]*"`, 'gi'), '"$1":"[redacted]"')
    // SOFT_END (token/auth) — the key must END with token/auth(s), NOT merely contain it: JSON form always
    // redacts (`"token"`/`"api_token"`), but KEEPS `"author"` / `"token_count"` / `"oauth_provider"`.
    .replace(new RegExp(`"([\\w-]*(?:${SOFT_END})s?)"\\s*:\\s*"[^"]*"`, 'gi'), '"$1":"[redacted]"')
    // bare SOFT_END k=v — key ENDS with token/auth AND value is credential-shaped (so `WHERE auth = false`,
    // `author = alice`, `token IS NULL` are all kept).
    .replace(new RegExp(`\\b([\\w-]*(?:${SOFT_END}))\\s*[:=]\\s*("[^"]{16,}"|'[^']{16,}'|[A-Za-z0-9_\\-./+=]{16,})`, 'gi'), '$1=[redacted]')
    .replace(/\b([a-z][a-z0-9+.-]*):\/\/[^/\s:@]*:[^/\s@]+@/gi, '$1://[redacted]@')                 // creds in a connection URL (user OPTIONAL: scheme://[user]:pass@)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')                 // emails (also common PII)
    // PHONE-SHAPED numbers only (optional +CC, then 3-3-4 with separators) — deliberately NARROW so it does NOT
    // eat a legit date `2024-01-01`, a metric `recall@100=0.12`, a count, or a partition value.
    .replace(/(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[redacted-number]');
  // NOTE (deliberate): we do NOT redact bare hex/base64 blobs or UUID-like ids with no key context —
  // they are indistinguishable from legit reproducible detail the area report needs (git SHAs, content hashes,
  // queryHash, item ids). The primary no-secrets boundary is the measure agent's contract (query/sampleRows are
  // "no secrets/PII" by construction); this is keyed/contextual defense-in-depth, not a blanket high-entropy sweep.
  return s;
}

// Serialize a value to JSON with every STRING LEAF redacted — never redact the serialized text. redactSecrets' k=v
// rules (`API_KEY=\S+`) run across JSON string boundaries on serialized text and swallow `"},{"` structure, so a scanned
// repo quoting `API_KEY=` in a sampleRow made checkpoints / dossiers invalid JSON. A leaf under a credential-named key
// (the JSON-key rules above: STRICT_SUBSTR anywhere, STRICT_END / SOFT_END at the end) is replaced whole.
const JSON_SECRET_KEY = new RegExp(`^(?:[\\w-]*(?:${STRICT_SUBSTR})[\\w-]*|[\\w-]*(?:${STRICT_END}|${SOFT_END})s?)$`, 'i');
export function redactJson(value: unknown, space?: number): string {
  return JSON.stringify(value, (k: string, v: unknown) => {
    if (typeof v !== 'string') return v;
    return k && JSON_SECRET_KEY.test(k) ? '[redacted]' : redactSecrets(v);
  }, space);
}

// Belt-and-suspenders: redact every rendered field of a finished report (the LLM could echo a secret that was
// in its prompt into its output). Applied to BOTH report writers' accepted output AND their fallbacks, before
// render. Pure; preserves shape.
function rText(s: string): string;
function rText(s: string | undefined): string | undefined;
function rText(s: string | undefined): string | undefined { return typeof s === 'string' ? redactSecrets(s) : s; }
// A viz cell is a string / number; redact the text form, pass numbers through.
function rCell(c: Cell): Cell { return typeof c === 'string' ? redactSecrets(c) : c; }
// Redact every text field of a per-section chart (replaces the old `table` redaction) — table cells AND the
// labels/sub-notes of bars/coverage/gauge, so a raw value from the evidence can't leak through a chart.
function rViz(v: Viz | undefined): Viz | undefined {
  if (!v) return v;
  switch (v.kind) {
    // viz is MODEL-AUTHORED and passed through unvalidated (viz: s.viz), so guard the arrays — a malformed
    // chart (e.g. {kind:'bars'} with no bars, or a table row that isn't an array) must not throw here, or the
    // catch in writeLeadershipReport would discard the whole good LLM report. Mirrors vizHtml's guards.
    case 'bars': return { ...v, bars: Array.isArray(v.bars) ? v.bars.map((b) => ({ ...b, label: rText(b.label), sub: b.sub ? redactSecrets(b.sub) : b.sub })) : [] };
    case 'coverage': return { ...v, coveredLabel: rText(v.coveredLabel), gapLabel: rText(v.gapLabel) };
    case 'gauge': return { ...v, label: rText(v.label) };
    case 'table': return { ...v, head: Array.isArray(v.head) ? v.head.map(rCell) : [], rows: Array.isArray(v.rows) ? v.rows.map((row) => Array.isArray(row) ? row.map(rCell) : row) : [] };
    // PR3 — a `svg` viz emits raw markup. DROP an untrusted (model-authored) one — a prompt-injected
    // report could smuggle `<script>`. A TRUSTED codeintel svg (marked via markTrustedSvgViz) is
    // redact-and-KEPT: redactSecrets rewrites only secret-shaped substrings (never tag syntax), so the
    // sidecar goes through this ONE sanitize pass like everything else. The output object is re-marked
    // so trust survives a repeated sanitize.
    case 'svg': {
      if (!TRUSTED_SVG.has(v)) return undefined;
      const out = { ...v, svg: typeof v.svg === 'string' ? redactSecrets(v.svg) : '' };
      return markTrustedSvgViz(out);
    }
  }
}
export function sanitizeReportInput(input: RecallReportInput): RecallReportInput {
  return {
    ...input,
    company: redactSecrets(input.company), meta: redactSecrets(input.meta),   // both are rendered
    title: rText(input.title), question: rText(input.question), bottomLine: rText(input.bottomLine),
    decisive: rText(input.decisive), caveats: rText(input.caveats),
    answerBack: rText(input.answerBack),
    cards: input.cards.map((c) => ({ v: redactSecrets(c.v), label: rText(c.label) })),
    recommendations: input.recommendations.map((r) => rText(r)),
    ...(input.decisions ? { decisions: input.decisions.map((d) => rText(d)) } : {}),
    sections: input.sections.map((sec) => ({
      ...sec, heading: rText(sec.heading), body: rText(sec.body),
      viz: rViz(sec.viz),
    })),
  };
}

// Cap a string to `n` chars (collapsing whitespace), with an ellipsis marker — for a query gist / snippet so
// the report cites a reproducible fragment without dumping a SQL wall.
export function capGist(s: string | undefined, n: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

// One reproducible EVIDENCE CARD for a measured hypothesis — the concrete material the area writer cites.
// Returns '' when there's no usable measurement. Everything user-derived (query, snippets, note, source) is
// redacted + capped. Identifiers (table/source names, query fragments) are kept verbatim — they're the point.
export function evidenceCard(h: Hypothesis): string {
  const m = h.measurement as Measurement | undefined;
  if (!m) return '';
  const ev = m.evidence;
  const dc = m.dataContract;
  const nulls = (m.nulls ?? []).map((nn) => `${nn.name}=${nn.value ?? '?'}`).join(', ');
  const lines: string[] = [];
  if (m.value != null) lines.push(`measured: ${m.value}${nulls ? ` vs [${nulls}]` : ''}${m.parent?.value != null ? ` (parent ${m.parent.id}=${m.parent.value})` : ''}`);
  const src = ev?.source ?? m.source;
  if (src) lines.push(`source: ${redactSecrets(capGist(src, 120))}${ev?.queryHash ? ` (queryHash ${ev.queryHash})` : ''}`);
  if (ev?.query) lines.push(`query: ${redactSecrets(capGist(ev.query, 500))}`);
  if (dc) {
    const dcParts = [dc.grain && dc.grain !== 'unknown' && `grain=${dc.grain}`, dc.window && `window=${dc.window}`, dc.dedupRule && `dedup=${dc.dedupRule}`, dc.joinKeys?.length && `joinKeys=${dc.joinKeys.join('+')}`, dc.biases?.length && `biases=${dc.biases.join('; ')}`].filter(Boolean);
    if (dcParts.length) lines.push(`data contract: ${redactSecrets(dcParts.join(' · '))}`);
  }
  if (m.counterfactual && (m.counterfactual.state === 'run' || m.counterfactual.delta)) lines.push(`counterfactual: ${m.counterfactual.state}${m.counterfactual.delta ? ` (Δ ${redactSecrets(capGist(m.counterfactual.delta, 80))} vs ${redactSecrets(capGist(m.counterfactual.baseline ?? 'baseline', 60))})` : ''}`);
  if (Array.isArray(ev?.sampleRows) && ev.sampleRows.length) lines.push(`sample: ${ev.sampleRows.slice(0, 2).map((r) => redactSecrets(capGist(r, 120))).join(' | ')}`);
  if (m.claimBoundaries) lines.push(`bounds: ${redactSecrets(capGist(m.claimBoundaries, 200))}`);
  if (m.note) lines.push(`note: ${redactSecrets(capGist(m.note, 200))}`);
  if (m.nextDecisiveTest) lines.push(`next test: ${redactSecrets(capGist(m.nextDecisiveTest, 200))}`);
  // the per-move DECOMPOSITION (the exemplar's multi-angle reading). Render every move so the
  // writer must describe the full picture (overlap / sole / reach / …) and the table can't be faked.
  if (m.subMeasurements?.length) {
    if (m.decompositionDisposition) lines.push(`decomposition disposition: ${m.decompositionDisposition}`);
    for (const s of m.subMeasurements) {
      const mark = s.state === 'evidence_ref' ? '✓' : s.state === 'not_applicable' ? '–' : '○';
      const val = s.value != null ? ` = ${redactSecrets(capGist(String(s.value), 80))}` : '';
      const why = s.reason ? ` · ${redactSecrets(capGist(s.reason, 120))}` : '';
      const src = s.source ? ` [${redactSecrets(capGist(s.source, 90))}]` : '';
      lines.push(`  move ${mark} ${s.kind}${val}${why}${src}`);
    }
  }
  return lines.map((l) => `    ${l}`).join('\n');
}

// a DETERMINISTIC decomposition table (move · state · value · read) for an area-report sidecar, so
// the multi-angle depth is rendered from the artifact, never invented by the writer. Returns '' when absent.
export function decompositionTable(h: Hypothesis): { claim: string; rows: string[][] } | null {
  const m = h.measurement as Measurement | undefined;
  if (!m?.subMeasurements?.length) return null;
  const rows = m.subMeasurements.map((s) => [
    String(s.kind),
    s.state === 'evidence_ref' ? 'measured' : s.state === 'not_applicable' ? 'N/A' : 'gap',
    s.value != null ? redactSecrets(capGist(String(s.value), 60)) : '—',
    redactSecrets(capGist(s.reason || s.intent, 140)),
  ]);
  return { claim: redactSecrets(capGist(h.claim, 200)), rows };
}

// ── Deterministic SQL-drawer escaping. Lives HERE (not in a writer module) because all THREE HTML writers
// post-process their authored file through it, right next to redactSecrets above, and a writer module importing it
// from another writer module would cycle (areaReportInSession already imports the dossier builders from analystReport). The single-session Expert authors RAW HTML, and despite the prompt telling
// it to escape operators, it reliably leaves bare `<` / `>=` inside <pre> SQL drawers — the browser then parses
// `< TIMESTAMP(...)` as a tag and SWALLOWS the predicate, so the RENDERED SQL is invalid. The QC judge reads the
// rendered result and HARD-fails "SQL not re-runnable" on EVERY round → the loop never converges, burns all maxRounds,
// and ships broken SQL anyway (17 SQL fails across 16 rounds on one real run — unwinnable by retrying, because the
// model keeps writing correct SQL and the un-escaped `<` keeps eating it). So normalize it here, deterministically:
// escape bare &,<,> inside every <pre> block. Idempotent — an already-escaped entity is left intact (the & is not
// re-encoded because it heads a well-formed entity), so it never double-escapes SQL the model DID happen to escape,
// and it preserves ANY valid named/numeric entity (&nbsp;/&eacute;/&#39;) rather than only amp/lt/gt.
// ASSUMPTION: a <pre> SQL drawer is LITERAL text — the Expert authors bare SQL, not nested markup. If it ever emits
// real tags inside a drawer (e.g. <pre><code>… or syntax-highlight <span>s) they'd be escaped to visible text; that
// premise holds today (bare SQL), so this is a documented latent risk, not a live bug.
export function escapePreBlocks(html: string): string {
  return html.replace(/(<pre\b[^>]*>)([\s\S]*?)(<\/pre>)/gi, (_m, open: string, inner: string, close: string) =>
    open + inner
      .replace(/&(?![a-zA-Z][a-zA-Z0-9]{0,30};|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    + close);
}
