// shared.ts — run-cluster shared dependencies, extracted VERBATIM from server.ts (run-extraction
// refactor, Phase A). This is the leaf that BOTH server.ts and the soon-to-be-extracted executor
// cluster depend on: env-config consts (budgets / bundle caps)
// and small pure helpers (escapeHtml, envMcpSources, osvPublicOnly, measurePlaneIdentities).
//
// IMPORTANT: this module may read `process.env` at load (that's what these consts do) but must NEVER
// import a VALUE from ../server.ts — only `import type`. A value import would create a runtime cycle
// (server.ts imports values FROM here). The `Source` import below is type-only (fully erased).
import type { Source } from '../server.ts';
import { PLANE_EXPOSES } from '../research/planeManifest.ts';
import { inputsFingerprint } from '../checkpoints.ts';

// Per-run spend cap in USD (default $20). Settings → Spending changes it for this process and persists it
// (src/appSettings.ts); THERESA_RUN_BUDGET sets the boot value.
let runBudgetUsd = Number(process.env.THERESA_RUN_BUDGET) || 20;
export function runBudget(): number { return runBudgetUsd; }
export function setRunBudget(usd: number): void { if (Number.isFinite(usd) && usd > 0) runBudgetUsd = Math.round(usd * 100) / 100; }
// Domain-bundle count cap. DEFAULT = no cap: trust Comprehend's relevance selection and run every bundle
// it activated; spend is bounded by the per-run BUDGET's admission gate (0.80·B stops STARTING new work — with the
// already-accepted bounded in-flight overshoot at concurrency >2), not by an arbitrary count truncation.
// THERESA_MAX_DOMAIN_BUNDLES is an OPTIONAL clamp, parsed EXPLICITLY so it behaves predictably:
//   unset/empty ⇒ Infinity (no cap) · a non-negative integer N ⇒ clamp to the top-N DOMAIN bundles (0 ⇒ no domain bundles) · else ⇒ warn + no cap.
// NB: baseline is NOT a domain bundle — it rides per its OWN selection (alwaysOn floor / Comprehend / keyword), independent of this
// clamp; so `=0` leaves only whatever non-domain bundles were already selected, and an otherwise-empty set degrades to the invariant floor.
export const rawMaxDomainBundles = process.env.THERESA_MAX_DOMAIN_BUNDLES;
export const parsedMaxDomainBundles = rawMaxDomainBundles == null || rawMaxDomainBundles.trim() === '' ? Infinity : Number(rawMaxDomainBundles);
export const MAX_DOMAIN_BUNDLES = Number.isInteger(parsedMaxDomainBundles) && parsedMaxDomainBundles >= 0 ? parsedMaxDomainBundles : Infinity;
if (rawMaxDomainBundles != null && rawMaxDomainBundles.trim() !== '' && MAX_DOMAIN_BUNDLES === Infinity && parsedMaxDomainBundles !== Infinity) {
  console.warn(`[config] THERESA_MAX_DOMAIN_BUNDLES="${rawMaxDomainBundles}" is not a non-negative integer — ignoring (no domain-bundle cap).`);
}
// Force EVERY registered expert bundle to run, bypassing Comprehend's selection AND the operating-envelope cap
// (the console equivalent of the CLI's `--all-bundles`). Local / cost-uncapped — for a full sweep. Off by default.
export const FORCE_ALL_BUNDLES = process.env.THERESA_FORCE_ALL_BUNDLES === '1';
// Force-all is a genuine UNCAPPED full sweep: it must not be silently throttled by the per-run budget gate (the 0.80·B
// admission stop / per-bundle split would budget-skip later bundles → partial area reports, defeating the point).
// So in force-all the run ledger is unbounded (BudgetLedger(0) → Infinity) UNLESS the user pins an
// EXPLICIT THERESA_RUN_BUDGET (then honor it — a deliberate cost clamp). Normal runs keep the RUN_BUDGET envelope.
export const RUN_BUDGET_EXPLICIT = process.env.THERESA_RUN_BUDGET != null && process.env.THERESA_RUN_BUDGET !== '';
export function effectiveRunBudget(): number { return (FORCE_ALL_BUNDLES && !RUN_BUDGET_EXPLICIT) ? 0 : runBudgetUsd; }   // 0 → ledger treats as Infinity

// ── DEFAULT SWEEP (no question supplied) ────────────────────────────────────────────────────────
//
// WHY. A run with no question is not a neutral run — it is a run whose priorities are decided by
// whichever bundles happened to activate. Measured on run A, whose entire brief was the
// 11 characters "jordan test": 6 of its 15 hypotheses audited the tool's OWN eval machinery (the two
// scorers, the anti-cheat token list, the disposition logic, the block regex), 3 more were posed and
// never settled, and the single live-measured finding came from an UNRELATED project's dashboard. The engine
// did not reason badly; nothing told it what mattered, so it investigated what its lenses own.
//
// The SHAPE is borrowed from an established security-audit methodology rather than invented here:
// census-first (enumerate and count the surfaces before judging any of them), the six STRIDE threat
// classes as the per-component lens, and a verify-before-you-report gate — plus two rules from
// root-cause debugging practice that a security taxonomy does not carry: prefer the CAUSE to the
// symptom (several findings sharing one mechanism are one finding about that mechanism), and read the
// CHANGE HISTORY, because a defect a recent commit introduced localises its own cause. Standard taxonomies are worth
// more than a private one — they are recognised, they have known coverage, and they cannot be quietly
// shaped around a project whose answers we already know.
//
// This brief is the standing instruction for that case. It is a value-free TAXONOMY — four general
// properties any multi-user system has — not a list of answers, and it names no product, vendor or
// company. It feeds the INVESTIGATION (classification, bundle choice, critique, preflight, measurement),
// which is the only place it can change the outcome; it is deliberately NOT passed as the reader's
// question, because nobody asked it and a report must not claim they did.
export const DEFAULT_SWEEP_BRIEF = `No question was supplied for this run. Run a general defect sweep over the systems in scope and report what a decision-maker would act on.

START WITH A CENSUS, NOT AN IMPRESSION. Before judging anything, ENUMERATE AND COUNT the surfaces: the code paths that mint an authenticated session; endpoints by privilege (public / authenticated / admin); external integrations and webhook receivers; background jobs; build and deploy pipelines; and where secrets come from at run time. A gap found by ARITHMETIC — "N paths create a session, M enforce the admission check" — is evidence a reader can check. A gap found by impression is not.

Then work these in order of priority, and only where the connected sources can evidence it:

1. ACCESS AND ISOLATION. For each component, work the six standard threat classes — spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege — and for each boundary, establish who is refused, on what evidence, and what an unresolved principal gets instead.
2. CORRECTNESS AND DATA TRUST. Whether the numbers the business depends on are defined once and computed the same way end to end; whether independent sources of the same quantity agree, and what happens when they do not; and whether a value that is inferred, estimated or defaulted is distinguishable downstream from one that was measured.
3. CHANGE SAFETY AND PROVENANCE. Whether code can reach production without being tested or reviewed; whether what shipped can be reconstructed from what is committed; whether dependencies are pinned and integrity-covered; and whether any credential is recoverable from history or from a build artifact.
4. OPERABILITY AND COST. How the system behaves when a dependency is slow or absent rather than merely down; whether concurrency and capacity limits are enforced or only documented; whether anything unbounded is driven by untrusted input; and whether spend is capped above the level of a single request.

PREFER THE CAUSE TO THE SYMPTOM. If several findings share one mechanism, report the MECHANISM once and name what it causes — four separate control failures on a single path are one finding about that path, not four. When each thing you find reveals another beside it, you are one layer too high; go down a layer before writing any of it up.

USE THE CHANGE HISTORY. A defect introduced by a recent change is both more actionable and easier to evidence than a longstanding one, because the change that introduced it localises the cause. Check whether the behaviour was ever different, and say so when it was.

VERIFY BEFORE YOU REPORT. Every finding must name the artifact that proves it and survive one deliberate attempt to refute it. If three attempts to evidence a suspicion all fail, drop it and say what you could not settle rather than shipping the suspicion. Prefer a defect that is evidenced and that somebody must DECIDE about over an observation that is merely true. Do not spend the sweep on the tool's own internals unless they affect what a user receives. State plainly what the connected sources cannot settle — an honest gap is worth more than a confident guess.`;

// A brief is REAL when a human actually stated a concern. Placeholders and smoke-test
// strings ("test", "jordan test", "asdf") must not be treated as a question - reading one as the
// user's priority is how a $55 run came to be steered by 11 characters.
//
// THE TEST IS THE SHAPE, NOT THE LENGTH. This used to reject anything under 24 characters, and review was
// right that the cure was worse than the disease: "Audit OAuth callbacks" (21) and "Check tenant isolation"
// (22) are precise, expensive-to-get-wrong requests, and a length gate threw them away. Worse, this gate
// became load-bearing in a SECOND place once the report's inquiry and answer-back were gated on it too -
// so a short precise ask was not merely unused for steering, it was erased from the report as well. The
// floor is now only what a length test can honestly catch (a single token, or nothing); everything else is
// decided by whether the text LOOKS like a placeholder.
// PLACEHOLDER SHAPE, NOT PLACEHOLDER WORDS. Three rounds of review rejected three different sets of real
// requests here, and every time the cause was the same: testing whether a placeholder WORD appears anywhere,
// rather than whether the PHRASE has placeholder shape. "Audit TODO handling", "Review null handling",
// "Check demo configuration", "Audit 404 errors", "Test payment retries" and "Audit test coverage" all
// contain a marker word and are all real requests.
//
// The shape is positional, and it is the LAST token that carries it. A real request ends with its OBJECT
// ("...handling", "...retries", "...coverage"). A smoke test ends with the MARKER, because the marker is the
// entire content and anything before it is just a name: "jordan test", "sam test", "testing 123". So:
//
//   - one token          -> a label, not a stated concern
//   - every token filler -> a placeholder at any length ("test test test", "asdf asdf")
//   - LAST token filler  -> a marker with a name in front of it
//   - otherwise          -> a real request, whatever words it happens to contain
//
// That rule needs no exception list for verbs, and it is why "check" / "audit" / "review" no longer need
// special-casing: they are never last.
const FILLER_TOKEN = /^(?:test|testing|tests|demo|sample|asdf|qwerty|foo|bar|baz|x+|tbd|todo|n\/?a|none|null|nil|trial|hello|hi|abc|\d+|[-_.]+)$/i;

// Scripts that do NOT delimit words with whitespace (Chinese, Japanese, Korean). The rule above is built on tokens,
// and `\w` is ASCII-only, so a brief written in such a script tokenized to NOTHING and was discarded as a
// placeholder, and one mixing a few CJK words with a single English term fell under the two-token floor. A
// whitespace-token count is simply not a measure of content in these scripts, so character count is.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const UNSPACED_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
// Four characters: a four-character phrase is a stated concern; the two-character word for "test" is the placeholder
// this guards.
const MIN_UNSPACED_CHARS = 4;

export function hasRealBrief(brief: string | undefined): boolean {
  const b = (brief ?? '').trim();
  if (!b) return false;
  // Unicode-aware trimming: strip leading/trailing punctuation without deleting non-ASCII letters.
  const tokens = b.split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}/]+|[^\p{L}\p{N}/]+$/gu, '')).filter(Boolean);
  if (UNSPACED_SCRIPT.test(b)) {
    // Enough script characters to be a sentence, OR it also carries a normal multi-token phrase.
    const chars = (b.match(UNSPACED_CHARS) ?? []).length;
    return chars >= MIN_UNSPACED_CHARS || tokens.length >= 2;
  }
  if (tokens.length < 2) return false;                                   // a label, not a concern
  if (tokens.every((t) => FILLER_TOKEN.test(t))) return false;           // all filler, at any length
  if (FILLER_TOKEN.test(tokens[tokens.length - 1])) return false;        // a marker with a name in front
  return true;
}

// ── LEADERSHIP AUTHORING VARIANT ────────────────────────────────────────────────────────────────
// Which contract the leadership brief is written under (research/leadershipContracts.ts).
// DEFAULT 'v5' (2026-09-30) — the lens-split business brief: verdict + decisions,
// one card per affected capability, the injected capability map, one line each for security / engineering. It needs
// the Full Scan's lens data; a caller without it (the rec audit) runs v4 (leadershipWriter.effectiveVariant).
// 'v4' — the decision brief, the previous default — and 'v0' (main's own contract byte-for-byte) stay selectable as
// one-env-var rollbacks.
//
// The default moved on evidence, not preference. v4 was first measured on FROZEN CHECKPOINTS, where it
// replicated on what matters (an ask present 3/3, zero chained blocks, bottom-line bullets = sections on
// both corpora) while volume stayed noise (A/A spread 137-144 words). The bar for moving the default was
// a live console run someone actually read: that run exists, end-to-end, and it is what changed the
// headline from "Audit scoring is fragmented" to "One shared key can read any tenant's private data".
//
// An unrecognised value falls back to v0 with a warning instead of throwing: a typo in a deploy env must
// not take the report stage down. v0 (not v4) is the fallback on purpose — an unreadable env var should
// land on the arm that matches main, not on the arm this branch is arguing for.
const RAW_LEADERSHIP_VARIANT = (process.env.THERESA_LEADERSHIP_VARIANT || 'v5').trim().toLowerCase();
const KNOWN_LEADERSHIP_VARIANTS = ['v0', 'v4', 'v5'];
export const LEADERSHIP_VARIANT = KNOWN_LEADERSHIP_VARIANTS.includes(RAW_LEADERSHIP_VARIANT) ? RAW_LEADERSHIP_VARIANT : 'v0';
if (RAW_LEADERSHIP_VARIANT !== LEADERSHIP_VARIANT) {
  console.warn(`[config] THERESA_LEADERSHIP_VARIANT="${RAW_LEADERSHIP_VARIANT}" is not one of ${KNOWN_LEADERSHIP_VARIANTS.join('/')} — using v0.`);
}

// LIVE EXEC from the dashboard (opt-in, LOCAL MACHINE ONLY): when THERESA_AUDIT_EXEC=1 and an
// exec-env intake is configured, a dashboard audit runs the FULL audit→exec→resume on a box over SSH
// (real measurement) instead of binding a static store. Requires the SSH keys + box config on THIS
// machine — must NEVER be set on a shared instance (it would SSH into boxes with this machine's keys).
export const AUDIT_EXEC = process.env.THERESA_AUDIT_EXEC === '1';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

// LOCAL-MACHINE ONLY: mount extra read-only MCP data planes from env so a local run can
// reach Amplitude / a BI dashboard without persisting any token. Gated behind THERESA_OPERATOR_MCP_PLANES=1
// (mirrors THERESA_LOCAL_AUDIT / _AUDIT_EXEC — the boot WARN lists it) so it is off
// unless explicitly enabled. Returns RUN-LOCAL Source entries: the run merges them into its own source list; they are
// never written to workspace state, so tokens stay env-only and are never persisted.
export function envMcpSources(): Source[] {
  if (process.env.THERESA_OPERATOR_MCP_PLANES !== '1') return [];
  const out: Source[] = [];
  // Amplitude (analytics) → the local read-only amplitude-mcp.mjs. Ours + read-only by construction → trust the
  // whole server (allowedTools undefined). Requires BOTH the port and the MCP's own bearer token.
  const ampPort = process.env.AMPLITUDE_MCP_PORT, ampTok = process.env.AMPLITUDE_MCP_TOKEN;
  if (ampPort && ampTok) {
    out.push({
      id: 'env-amplitude', kind: 'analytics', name: 'Amplitude (env)', status: 'ready',
      detail: 'env-mounted read-only Amplitude MCP',
      mcpUrl: `http://127.0.0.1:${ampPort}/`, mcpToken: ampTok, mcpName: 'amplitude',
      exposes: 'product analytics: event taxonomy, annotations, segmentation/DAU, funnels, retention',
    });
  }
  // BI dashboard (bi) → a deployed dashboard MCP. Point it only at a dashboard MCP that is read-only BY CONSTRUCTION
  // (all tools read-only over aggregate no-PII data; any raw-SQL tool enforces SELECT/WITH/EXPLAIN only — no
  // DDL/DML/scripts, dry-run first). So allowedTools is left undefined (trust the whole server — the mcp.ts contract
  // for a trusted read-only MCP), which is also robust to tool-name drift between revisions
  // (e.g. a catalog tool named get_catalog vs ln) that a hardcoded host-side allowlist would silently deny → 0 calls.
  // Require BOTH the URL and the bearer token (the deployed endpoint authenticates) — mounting on URL alone would
  // advertise a plane the agent can't actually call → the "mounted but 0 calls" failure the audit log exists to flag.
  const dashUrl = process.env.BI_DASHBOARD_MCP_URL, dashTok = process.env.BI_DASHBOARD_MCP_TOKEN;
  if (dashUrl && dashTok) {
    out.push({
      id: 'env-bidash', kind: 'bi', name: 'BI dashboard (env)', status: 'ready',
      detail: 'env-mounted read-only BI dashboard MCP',
      mcpUrl: dashUrl, mcpToken: dashTok, mcpName: 'bidash',
      exposes: 'BI data dashboard: metric catalog/definitions, experiment readouts + assignment health, funnels, DAU, retention, DQ notes, read-only BigQuery SQL',
    });
  }
  // BigQuery warehouse (our bq-mcp.mjs, read-only SA: dataViewer+jobUser). Mounted as `warehouse` so deep.ts's
  // measure step computes warehouse-derivable metrics LIVE (hasWarehouse). Read-only BY CONSTRUCTION — run_sql is
  // SELECT/WITH-only + a dry-run byte cap + maximum_bytes_billed, and the SA can't write — so allowedTools undefined.
  const bqUrl = process.env.BQ_MCP_URL, bqTok = process.env.BQ_MCP_TOKEN;
  if (bqUrl && bqTok) {
    out.push({
      id: 'env-bq', kind: 'warehouse', name: 'BigQuery (env)', status: 'ready',
      detail: 'env-mounted read-only BigQuery MCP (bq-mcp.mjs)',
      mcpUrl: bqUrl, mcpToken: bqTok, mcpName: 'warehouse',
      exposes: PLANE_EXPOSES.warehouse,
    });
  }
  return out;
}

// PUBLIC-ONLY OSV auto-mount predicate — ONE function shared by the mount site (orgCritiqueExpert) and the
// resume fail-closed gate (POST /api/runs resumeFrom) so the two can never drift. True only when the run
// scans public giturl targets AND the workspace has NO other source of ANY kind: any credentialed/private
// plane (github → repogrep, local folders, warehouse/analytics/bi/custom/slack/gcp/box) coexisting in the
// same agent session could hand private dependency inventory to the OSV tools. Anything
// less than giturl-only needs the explicit THERESA_OSV=1 opt-in.
export function osvPublicOnly(run: { giturlFilter?: string[] | null; repoFilter?: string[] | null; localFilter?: string[] | null }, sources: Source[]): boolean {
  return Boolean(run.giturlFilter && run.giturlFilter.length)
    && !(run.repoFilter && run.repoFilter.length)
    && !(run.localFilter && run.localFilter.length)
    && sources.every((s) => s.kind === 'giturl');
}

// CONCRETE identity of each connectable measure plane (checkpoint/resume): `fp` hashes the mount COORDINATES **and the
// credential identity** (the service-account identity / the pasted token value — hashed, never stored raw): kind-level
// matching would accept a staging warehouse swapped in for the prod one, and coordinate-only matching would accept the
// SAME MCP url re-authenticated as a different account. `srcId` lets the mount loop filter to the parent's exact set.
// Mirrors the mount conditions in orgCritiqueExpert.
export type PlaneIdent = { kind: string; serverName: string; fp: string; srcId: string };
// The identity of a BigQuery service-account key without its secret: project + service account (the fingerprint must
// change when the warehouse is swapped for a different project or account).
function saIdentity(saJson: string): string {
  try { const sa = JSON.parse(saJson) as { project_id?: string; client_email?: string }; return `${sa.project_id ?? ''}|${sa.client_email ?? ''}`; } catch { return 'invalid'; }
}
export function measurePlaneIdentities(sources: Source[]): PlaneIdent[] {
  const out: PlaneIdent[] = [];
  for (const s of sources) {
    if (s.status === 'error') continue;
    if (s.kind === 'warehouse' && (s.saJson || s.mcpUrl)) out.push({ kind: 'warehouse', serverName: 'warehouse', srcId: s.id, fp: inputsFingerprint(['wh', s.saJson ? saIdentity(s.saJson) : null, s.saJson ? null : (s.mcpUrl ?? null), s.saJson ? null : (s.mcpToken ?? null)]) });
    if (s.kind === 'keyvalue' && s.mcpUrl) out.push({ kind: 'keyvalue', serverName: 'redis', srcId: s.id, fp: inputsFingerprint(['kv', s.mcpUrl, s.mcpToken ?? null]) });
    if ((s.kind === 'analytics' || s.kind === 'bi' || s.kind === 'custom') && s.mcpUrl && s.mcpName) out.push({ kind: s.kind, serverName: s.mcpName, srcId: s.id, fp: inputsFingerprint([s.kind, s.mcpName, s.mcpUrl, s.mcpToken ?? null]) });
  }
  // repometa (the code-native GitHub-metadata measure plane) is DERIVED, not connectable: it mounts whenever a
  // github or giturl source exists (org credential only when github repos are actually scanned; tokenless for a
  // public-URL-only run). Give it a real identity anyway — fp over the credential identity AVAILABLE to the run —
  // so the checkpoint records it, the resume exact-set guard detects "parent measured with the org PAT, child
  // would run tokenless" (different reach + rate = non-comparable CI/release measurements), and resumeSkipsPlane
  // can drop it from a child whose parent never mounted it (pre-repometa checkpoints stay resumable). The fp is
  // deliberately CONSERVATIVE (keyed to the credential a run of these sources COULD use, not the per-run token
  // decision — this function has no run context): connecting/disconnecting GitHub between parent and child
  // fail-closes the resume even for a tokenless giturl-only lane; over-strict is the safe direction here.
  // codeintel — the other code-native measure plane — deliberately stays OUT of this identity set: it is derived
  // data recomputed deterministically from the pinned repos@SHA manifest (same inputs ⇒ same index), and its
  // availability mismatch is already LOUD-warned via the rzComp.codeintel compare in orgCritiqueExpert.
  const ghSrc = sources.find((s) => s.kind === 'github' && s.status !== 'error');
  const guSrc = sources.find((s) => s.kind === 'giturl' && s.status !== 'error' && (s.giturlRepos ?? []).length);
  if (ghSrc || guSrc) {
    out.push({
      kind: 'repometa', serverName: 'repometa', srcId: (ghSrc ?? guSrc)!.id,
      fp: inputsFingerprint(['rm', ghSrc ? (ghSrc.token ?? 'gh') : null, ghSrc ? null : 'public']),
    });
  }
  return out;
}
