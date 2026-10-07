// Evidence-aware Claim Auditor — an INDEPENDENT, tool-free second opinion that sits between the
// Expert's measured disposition and the Finding contract. For each would-be finding (a measured + disposed
// hypothesis whose evidence is reproducible) it reads the EvidencePayload (value / source / query / nulls /
// grain / counterfactual) and decides accept | downgrade | reject — it can catch a measured-but-overclaimed
// finding (a metric that doesn't actually isolate the claimed cause, a missing counterfactual, an
// under-powered sample) WITHOUT re-running the measurement. The deterministic fail-CLOSED gate lives in
// hypothesesToFindings: only accept/downgrade ship; reject / a missing verdict / an auditor failure → a
// claim_rejected CoverageGap.
//
// Tiering mirrors the other tool-free text-out steps: OpenAI gpt-5.5 → Claude agent (tool-free, NO mcpServers
// — it audits payloads, it does not re-measure). The Claude tier is FINAL and FAIL-CLOSED for claims: an
// unparseable reply rejects per-claim, and an agent error makes every claim an `llm_failed` reject. There is
// NO accept-all fallback (an auditor that ran but couldn't settle a claim must never silently accept it —
// that would be a reward-hack hole). Fail-open is at the RUN level only (the run continues, baseline + other
// bundles still ship); a run can't reach the auditor without Claude creds, so "no LLM at all" is not a real state.
import { runAgent } from './agent.ts';
import { extractJson } from './json.ts';
import { openaiAvailable } from './openai.ts';
import { codexOrGpt } from './codexAgent.ts';
import { type Hypothesis, type Measurement } from './investigation.ts';
import { hypothesisDisposition, type Mitigation } from './deep.ts';
import { type AuditedClaim, type Severity, type Confidence, isResolvableEvidence, caveatedClaim } from '../schema.ts';
import { type PlaneInfo } from './planeManifest.ts';
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
// The live-plane detector moved to ./evidencePlane.ts so the CLAIM AUDIT and the FINDING's Evidence.kind
// cannot drift apart — they must agree on what "measured" means or a finding can be stamped `metric`
// while the auditor scores it as reproducibility-risk.
import { isLivePlaneRef } from './evidencePlane.ts';

// The evidence-source prefixes that denote a LIVE QUERY plane (a value re-derivable by re-running a query, vs a
// static datapoint id). warehouse/redis/probe are the built-ins; a run adds its mounted measure-plane server
// names (e.g. amplitude / acmedash) so an analytics/BI value with no stored query is scored as reproducibility-risk.
export interface ClaimAuditResult {
  audits: AuditedClaim[];
  costUsd: number;
  trace: string;
  toolTally: Record<string, number>;
}

export interface ClaimAuditOpts {
  bundleId: string;
  hypotheses: Hypothesis[];           // the bundle's measured hypotheses (the auditor selects the would-be findings)
  mitigations: Mitigation[];
  scopeDesc?: string;
  model?: string;
  authToken?: string;
  root?: string;
  log?: (m: string) => void;
}

const SEV = new Set<Severity>(['info', 'low', 'medium', 'high', 'critical']);
const CONF = new Set<Confidence>(['low', 'medium', 'high']);

// The would-be findings the auditor must rule on: measured + disposed (confirmed/refuted) AND carrying
// reproducible evidence (the same set hypothesesToFindings would ship as findings — deferred / non-resolvable
// ones are gaps regardless of the audit, so auditing them is wasted). Deterministic + pure (unit-testable).
export function auditableHypotheses(hypotheses: Hypothesis[], mitigations: Mitigation[]): Hypothesis[] {
  const mits = new Map(mitigations.map((m) => [m.hypothesisId, m]));
  return hypotheses.filter((h) => {
    const disp = hypothesisDisposition(h, mits.get(h.id));
    if (disp === 'deferred') return false;
    const m = h.measurement;
    if (!m || m.value == null) return false;
    const ref = m.evidence?.source ?? m.source ?? '';
    return Boolean(ref) && isResolvableEvidence({ kind: 'computation', ref });
  });
}

// One audit card the auditor reasons over — the claim + the reproducible evidence behind it (no re-measuring).
function auditCard(h: Hypothesis, disp: 'confirmed' | 'refuted'): string {
  const m = h.measurement as Measurement;
  const nulls = (m.nulls ?? []).map((n) => `${n.name}=${n.value ?? '?'}`).join(', ') || 'none';
  const ev = m.evidence;
  const parts = [
    `- id: ${h.id}`,
    `  claim: ${h.claim}`,
    `  disposition (Expert): ${disp === 'confirmed' ? 'CONFIRMED defect' : 'REFUTED (healthy)'}`,
    `  measured: ${m.metricId} = ${m.value} vs [${nulls}]${m.parent?.value != null ? ` (parent ${m.parent.id}=${m.parent.value})` : ''}`,
    `  source: ${ev?.source ?? m.source ?? '(none)'}${ev?.queryHash ? ` (queryHash ${ev.queryHash})` : ''}`,
    ev?.query ? `  query: ${ev.query.slice(0, 300)}` : '',
    `  grain: ${m.dataContract?.grain ?? 'unknown'}`,
    `  counterfactual: ${m.counterfactual?.state ?? 'not_run'}${m.counterfactual?.delta ? ` (Δ ${m.counterfactual.delta} vs ${m.counterfactual.baseline ?? 'baseline'})` : ''}`,
    m.claimBoundaries ? `  claim_boundaries: ${m.claimBoundaries}` : '',
    m.note ? `  note: ${m.note}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

export function auditPrompt(bundleId: string, cards: string, scopeDesc?: string): string {
  return `ROLE: an INDEPENDENT, skeptical claim auditor for a read-only data/recsys audit. The Expert measured each
claim below and assigned a disposition; you are a SECOND opinion. You CANNOT run new measurements — judge ONLY
from the evidence shown (value vs null, source, query, grain, counterfactual). Your job is to stop OVERCLAIMING:
a measured number is NOT automatically a sound finding.
${scopeDesc ? `SCOPE: ${scopeDesc}\n` : ''}BUNDLE: ${bundleId}

For each claim, decide a verdict:
- "accept"   — the evidence soundly supports the disposition as stated; ships as-is.
- "downgrade" — the direction is defensible but the claim OVERREACHES the evidence (e.g. a metric that doesn't
   isolate the claimed cause, no counterfactual for an attribution claim, an under-powered / wrong-grain sample,
   a proxy treated as a decision). Ships only with caveated wording + lower confidence. Provide "allowedWording":
   the strongest claim the evidence actually licenses (one sentence, no new numbers).
- "reject"   — the evidence does NOT support the claim (wrong denominator, the measurement answers a different
   question, the null is not actually beaten, the source can't bear the claim). Does NOT ship — it becomes an
   open question with your reason as the next step.

Be strict: when in doubt between accept and downgrade, downgrade; between downgrade and reject, prefer the one
your evidence justifies. Do NOT invent numbers. Do NOT reward a confident-sounding claim that the shown evidence
can't carry.

CLAIMS:
${cards}

Reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"audits":[
  {"hypothesisId":"<exact id from above>",
   "verdict":"accept|downgrade|reject",
   "reason":"<one or two sentences grounded in the shown evidence>",
   "allowedWording":"<for downgrade: the caveated claim the report MAY make; omit otherwise>",
   "severity":"<optional: info|low|medium|high|critical>",
   "confidence":"<optional: low|medium|high>"}
]}
\`\`\``;
}

// Parse + VALIDATE the auditor reply into AuditedClaim[] keyed to the audited ids (PURE — unit-testable). Any
// audited id MISSING from the reply, or with an unknown verdict, is marked unparseable → the converter
// fail-closes it. Ids not in the audited set are ignored (the auditor can't invent claims).
export function parseAudits(text: string | undefined, auditedIds: string[]): AuditedClaim[] {
  const want = new Set(auditedIds);
  const parsed = extractJson<{ audits: Array<Partial<AuditedClaim>> }>(text ?? '');
  const rows = Array.isArray(parsed?.audits) ? parsed.audits : [];   // a non-array `audits` → treat as empty
  const byId = new Map<string, AuditedClaim>();
  for (const a of rows) {
    const id = String(a?.hypothesisId ?? '').trim();
    if (!id || !want.has(id) || byId.has(id)) continue;
    const verdict = a?.verdict === 'accept' || a?.verdict === 'downgrade' || a?.verdict === 'reject' ? a.verdict : undefined;
    if (!verdict) { byId.set(id, { hypothesisId: id, verdict: 'reject', reason: 'auditor returned an unrecognized verdict', auditStatus: 'unparseable' }); continue; }
    byId.set(id, {
      hypothesisId: id, verdict,
      reason: String(a?.reason ?? '').trim() || '(no reason given)',
      allowedWording: a?.allowedWording ? String(a.allowedWording).trim() : undefined,
      severity: a?.severity && SEV.has(a.severity as Severity) ? a.severity as Severity : undefined,
      confidence: a?.confidence && CONF.has(a.confidence as Confidence) ? a.confidence as Confidence : undefined,
      auditStatus: 'audited',
    });
  }
  // Fail-CLOSED: any audited claim the reply did NOT cover → unparseable (the converter routes it to a gap).
  return auditedIds.map((id) => byId.get(id) ?? { hypothesisId: id, verdict: 'reject', reason: 'the claim audit produced no verdict for this claim', auditStatus: 'unparseable' as const });
}

export async function runClaimAudit(opts: ClaimAuditOpts): Promise<ClaimAuditResult> {
  const log = opts.log ?? (() => {});
  const mits = new Map(opts.mitigations.map((m) => [m.hypothesisId, m]));
  const auditable = auditableHypotheses(opts.hypotheses, opts.mitigations);
  const trace: string[] = [];
  const toolTally: Record<string, number> = {};
  if (!auditable.length) return { audits: [], costUsd: 0, trace: '', toolTally };

  const cards = auditable.map((h) => auditCard(h, hypothesisDisposition(h, mits.get(h.id)) === 'confirmed' ? 'confirmed' : 'refuted')).join('\n');
  const prompt = auditPrompt(opts.bundleId, cards, opts.scopeDesc);
  const auditedIds = auditable.map((h) => h.id);
  log(`▶ claim-audit · [${opts.bundleId}] auditing ${auditedIds.length} would-be finding(s) (tool-free, independent)`);
  let cost = 0;

  // TIER 1 — OpenAI gpt-5.5 (tool-free).
  if (openaiAvailable()) {
    try {
      const or = await codexOrGpt({ files: { 'task.md': prompt }, codexPrompt: 'Read task.md — full instructions + the would-be findings to audit. Do the independent audit, then WRITE the result as JSON (matching task.md, no prose/fences) to audit.json.', outputFile: 'audit.json', fallbackPrompt: prompt, label: `claim-audit:${opts.bundleId}`, log }); cost += or.costUsd;
      const audits = parseAudits(or.text, auditedIds);
      if (audits.some((a) => a.auditStatus === 'audited')) {
        logAudits(log, opts.bundleId, audits);
        return { audits, costUsd: cost, trace: '', toolTally };
      }
      log(`  ⚠ [${opts.bundleId}] OpenAI claim-audit reply not parseable — falling back to Claude`);
    } catch (e) { log(`  ⚠ [${opts.bundleId}] OpenAI claim-audit failed (${e instanceof Error ? e.message : String(e)}) — falling back to Claude`); }
  }

  // TIER 2 — Claude agent (tool-free: NO mcpServers — it audits the payloads, it does not re-measure). This
  // tier is FINAL and FAIL-CLOSED for claims: its parse result stands even if every claim is
  // unparseable (→ reject), and if the agent THROWS, every audited claim becomes an `llm_failed` reject. There
  // is NO accept-all fallback — an auditor that RAN but couldn't settle a claim must not silently accept it
  // (that would be a reward-hack hole). A run never reaches here without Claude creds, so "no LLM at all" is
  // not a real state; fail-open is at the RUN level (the run continues, baseline + other bundles still ship),
  // never at the claim level.
  try {
    const r = await runAgent({
      cwd: opts.root ?? process.cwd(), model: opts.model, authToken: opts.authToken, maxTurns: 4, label: `claim-audit:${opts.bundleId}`, fallbackFrom: openaiAvailable() ? 'openai' : undefined, toolFree: true,   // judge ONLY from the EvidencePayloads in the prompt — never re-inspect the repo
      prompt, onTrace: (e) => { if (e.type === 'tool') { trace.push(`🔧 ${e.name}  ${e.args}`); toolTally[e.name] = (toolTally[e.name] ?? 0) + 1; } },
    });
    cost += r.costUsd;
    const audits = parseAudits(r.text, auditedIds);   // unparseable claims fail-close to reject inside parseAudits
    logAudits(log, opts.bundleId, audits);
    return { audits, costUsd: cost, trace: trace.join('\n'), toolTally };
  } catch (e) {
    log(`  ⚠ [${opts.bundleId}] claim-audit unavailable (${e instanceof Error ? e.message : String(e)}) — fail-CLOSED: all ${auditedIds.length} claim(s) → claim_rejected gaps`);
    return { audits: auditedIds.map((id) => ({ hypothesisId: id, verdict: 'reject' as const, reason: `the claim auditor was unavailable (${e instanceof Error ? e.message : String(e)})`, auditStatus: 'llm_failed' as const })), costUsd: cost, trace: trace.join('\n'), toolTally };
  }
}

function logAudits(log: (m: string) => void, bundleId: string, audits: AuditedClaim[]): void {
  const n = (v: AuditedClaim['verdict']) => audits.filter((a) => a.verdict === v && a.auditStatus === 'audited').length;
  const failed = audits.filter((a) => a.auditStatus !== 'audited').length;
  log(`  ↳ [${bundleId}] claim-audit: ${n('accept')} accept · ${n('downgrade')} downgrade · ${n('reject')} reject${failed ? ` · ${failed} unparseable→gap` : ''}`);
}

// ── GLOBAL risky-subset tool-backed re-verify ────────────────────────────────────────
// The tool-free audit can't catch a reproducibility failure (the number doesn't actually come back when you
// re-run the query). So the few RISKIEST surviving claims get a tool-backed re-verify (an agent re-runs the
// decisive query against the read-only plane). It's bounded to ≤4 PER RUN (global), chosen AFTER the per-bundle
// barrier so the cap is deterministic (not first-come across parallel branches). Scoring is a pure function of
// the claim's stakes + reproducibility-risk signals available on the Measurement (the design's richer
// evidence/metric/decision statuses are the cross-cutting track; here we use what the evidence payload actually carries).
const REVERIFY_MAX = Number(process.env.THERESA_REVERIFY_MAX) || 4;   // env-tunable; raise for a max-power run (re-verify every risky claim)
export function scoreClaimRisk(h: Hypothesis, audit: AuditedClaim, mit?: Mitigation, livePlaneServerNames: string[] = []): number {
  if (audit.auditStatus !== 'audited' || audit.verdict === 'reject') return 0;   // only surviving would-be findings
  const m = h.measurement;
  if (!m || m.value == null) return 0;
  let score = 0;
  const disp = hypothesisDisposition(h, mit);
  const sev = audit.severity ?? (disp === 'confirmed' ? 'high' : 'info');
  if (disp === 'confirmed' && (sev === 'high' || sev === 'critical')) score += 100;   // high-stakes confirmed defect
  if (audit.verdict === 'downgrade') score += 80;                                      // the auditor already flagged it shaky
  const src = m.evidence?.source ?? m.source ?? '';
  // isLivePlaneRef, NOT the anchored regex. Refs are COMPOUND (`repo+redis+acmedash:…`, `code:… ; redis:…`),
  // and an anchored `^plane:` test misses those — so a claim that evidenceKindFor() stamps as MEASURED could
  // score 0 here for "live-plane value with no reproducible query" and, with the reverify set capped, rank
  // below unrelated claims and reach the report without a rerun. The stamp and the reverify risk must read
  // the ref the same way or the measured claims are exactly the ones that escape verification.
  const livePlane = isLivePlaneRef(src, livePlaneServerNames);
  if (livePlane && (!m.evidence?.queryHash || !m.evidence?.query)) score += 60;        // live-plane value with no reproducible query
  const grainUnknown = !m.dataContract || m.dataContract.grain === 'unknown' || !m.dataContract.grain;
  const nullsWeak = !m.nulls || m.nulls.length === 0 || m.nulls.some((n) => n.value == null);
  const noCounterfactual = !m.counterfactual || m.counterfactual.state === 'not_run';
  if (grainUnknown || nullsWeak || noCounterfactual) score += 40;                      // a weak data contract / ungated comparison
  return score;
}

// Pure: the ≤max hypothesis ids to re-verify, deterministically ordered (score desc → bundle prefix → id).
export function selectRiskySubset(hypotheses: Hypothesis[], audits: AuditedClaim[], mitigations: Mitigation[], max: number = REVERIFY_MAX, livePlaneServerNames: string[] = []): string[] {
  const mits = new Map(mitigations.map((m) => [m.hypothesisId, m]));
  const auditById = new Map(audits.map((a) => [a.hypothesisId, a]));
  const scored = hypotheses
    .map((h) => { const a = auditById.get(h.id); return a ? { id: h.id, score: scoreClaimRisk(h, a, mits.get(h.id), livePlaneServerNames) } : { id: h.id, score: 0 }; })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));   // bytewise id tiebreak (spec-deterministic, ICU-independent); folds in bundle prefix then index
  return scored.slice(0, max).map((x) => x.id);
}

// `unverifiable`: the re-verifier could not PERFORM the check (a remote plane cannot see the repo/file, access
// denied, the plane is down) — distinct from "checked, and it did not reproduce". It leaves the claim unchanged.
interface ReverifyJson { reproduced?: boolean; supportsClaim?: boolean; unverifiable?: boolean; note?: string }

// ── WORKSPACE-FIRST file evidence ─────────────────────────────────────────────────────────────────
// In one real run, re-verify checked a code-native claim against the GitHub REST plane (repogrep, on an org PAT that
// cannot see the scanned repo) instead of the run's own clone, got "claude-review.yml does not exist in the live
// read-only plane", and REJECTED a true finding. File/code evidence is now resolved against the run WORKSPACE first:
// the clone IS the ground truth for "does this file exist", and a remote plane that can't see a repo is evidence of
// nothing about the claim. fs reads only (unit-tested over a temp dir).
//
// Path-shaped tokens in an evidence ref (`code:.github/workflows/x.yml:20-49`, `repo:src/a.ts + redis:…`): a run of
// path segments ending in `name.ext`, with an optional `:line[-line]` suffix. Prose never matches (needs a `.ext`).
export function evidencePathTokens(ref: string | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(ref ?? '').matchAll(/(?:^|[\s:;+,(=`'"])((?:[\w.@-]+\/)*[\w@-][\w.@-]*\.[A-Za-z0-9]{1,10})(?=$|[\s;,)`'"#:])/g)) {
    const p = m[1].replace(/^\.\//, '');
    if (!p || isAbsolute(p) || p.split('/').some((s) => s === '..')) continue;   // never probe outside the workspace
    out.add(p);
  }
  return [...out];
}

// Which of those paths EXIST in the run workspace. The workspace holds one dir per scanned repo (`<root>/<repo>/…`),
// and refs cite paths repo-relative (`src/a.ts`), workspace-relative (`repo/src/a.ts`) or owner-qualified
// (`owner/repo/src/a.ts`) — so each token is tried at the root and under every top-level repo dir, with zero, one or
// two leading segments dropped. Bounded: a handful of existsSync calls per token.
export function resolveEvidenceInWorkspace(ref: string | undefined, root: string | undefined): string[] {
  if (!root) return [];
  let dirs: string[] = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const found: string[] = [];
  for (const p of evidencePathTokens(ref)) {
    const seg = p.split('/');
    const variants = [p, seg.slice(1).join('/'), seg.slice(2).join('/')].filter(Boolean);
    if (variants.some((v) => existsSync(join(root, v)) || dirs.some((d) => existsSync(join(root, d, v))))) found.push(p);
  }
  return found;
}

// The cited files the workspace settles for this claim: [] when its ref is a live-plane query (re-derived by re-running
// the query, not by reading a file) or when no cited path exists in the clone.
export function workspaceSettlesEvidence(h: Hypothesis, root: string | undefined, livePlaneServerNames: string[] = []): string[] {
  const src = h.measurement?.evidence?.source ?? h.measurement?.source ?? '';
  if (!src || isLivePlaneRef(src, livePlaneServerNames)) return [];
  return resolveEvidenceInWorkspace(src, root);
}
function planesLine(planes: PlaneInfo[]): string {
  // Describe the live read-only planes the re-verifier can re-run against (not just warehouse/keyvalue).
  if (!planes.length) return 'no live data plane is mounted — re-derive from code if you can, else report not-reproduced.';
  return planes.map((p) => `a read-only ${p.kind.toUpperCase()} plane (e.g. mcp__${p.serverName}__*${p.exposes ? ` — ${p.exposes}` : ''})`).join('; ');
}
function reverifyPrompt(h: Hypothesis, planes: PlaneInfo[], workspaceFiles: string[] = []): string {
  const m = h.measurement as Measurement;
  const ev = m.evidence;
  // the run's cloned workspace is the agent's cwd — file/code evidence is checked THERE first, never inferred from
  // a remote plane's view (which may run on a credential that cannot see this repo).
  const ws = `WORKSPACE: your current directory is this run's read-only clone of the scanned code (one folder per repo). Resolve any FILE / CODE evidence here FIRST (Read / Grep / Glob)${workspaceFiles.length ? ` — these cited paths exist in it: ${workspaceFiles.slice(0, 8).join(', ')}` : ''}. A remote plane (e.g. a GitHub REST reader) that cannot see a repo or file is NOT evidence the claim is false: if you cannot actually perform the check, reply "unverifiable": true instead of "reproduced": false.`;
  return `ROLE: independent RE-VERIFIER for one already-measured claim in a READ-ONLY audit. Do NOT modify anything.
A prior measure step reported a value; your job is to RE-RUN the decisive query against the live read-only plane
and check whether the number REPRODUCES and still SUPPORTS the claim. This catches a value that doesn't actually
come back (a stale/cherry-picked/typo'd query).

CLAIM (${h.id}): ${h.claim}
PRIOR MEASUREMENT: ${m.metricId} = ${m.value} vs [${(m.nulls ?? []).map((n) => `${n.name}=${n.value ?? '?'}`).join(', ') || 'none'}]
PRIOR SOURCE: ${ev?.source ?? m.source ?? '(none)'}
${ev?.query ? `PRIOR QUERY (re-run it; correct it minimally only if it errors against the real schema):\n${ev.query}` : 'No query text was stored — reconstruct the most faithful decisive query for the metric above.'}
PLANES: ${planesLine(planes)} — enumerate the relevant plane's tools first.
${ws}

Re-run it, then reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"reproduced": <true if the re-run value is materially the same as the prior value, false if it differs or you cannot reproduce it>,
 "supportsClaim": <true if the re-run still supports the claim's disposition, false if it does not>,
 "unverifiable": <true ONLY if you could not perform the check at all (a plane cannot see the repo/file, access denied); omit otherwise>,
 "note": "<one sentence: the re-run value vs the prior, and what it means>"}
\`\`\``;
}

// Does a "did not reproduce" note mean the re-verifier could not REACH the cited file (a plane-visibility failure),
// rather than that it read the file and found the claim false? (PURE.) Access wording (cannot see/access, private,
// 401/403/404, …) always counts; an EMPTY note counts (no stated contradiction — keep the verdict rather than reject
// on nothing). "Missing" wording (does not exist / not found / no such file) counts ONLY when it names one of the
// cited workspace files — "the guard X is not found in src/a.ts" is a CONTENT contradiction about a file that WAS
// read, and must keep the normal reject/downgrade path.
const REVERIFY_ACCESS_RE = /\b(cannot (see|access|read)|can'?t (see|access|read)|not (visible|accessible|reachable)|unreachable|inaccessible|access denied|permission denied|forbidden|unauthori[sz]ed|private|40[134])\b/i;
// The FILE must be the subject of the missing phrase: "<file> does not exist / was not found" or "cannot find / no
// such file <file>". "X not found in <file>" (file is the object of "in") is a content contradiction, not a miss.
export function reverifyCouldNotReach(note: string | undefined, workspaceFiles: string[]): boolean {
  if (!note) return true;
  if (REVERIFY_ACCESS_RE.test(note)) return true;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return workspaceFiles.some((f) => {
    const p = f.replace(/\\/g, '/');
    const base = p.split('/').pop() || p;
    return [p, base].filter((t) => t.length >= 4).some((t) => {
      const ft = esc(t);
      return new RegExp(`${ft}\\S*[^.;]{0,40}?\\b(does not exist|doesn'?t exist|not exist|(is|was) not found|not found in the (repo|repository|workspace|plane)|is missing)\\b`, 'i').test(note)
        || new RegExp(`\\b(no such file|cannot find|can'?t find|could not find)\\b[^.;]{0,20}?${ft}`, 'i').test(note);
    });
  });
}

// Apply a re-verify outcome to an AuditedClaim (PURE): a reproduced + supporting re-run CONFIRMS (mark
// reverified); a non-reproduced OR non-supporting re-run flips an `accept` to `downgrade` (or, if it outright
// contradicts, to `reject`) — fail toward caution. A re-verify that didn't run leaves the claim unchanged.
// UNVERIFIABLE is not REJECT: an explicit `unverifiable` reply, or a "did not reproduce" on a claim whose FILE
// evidence the workspace clone itself resolves (`opts.workspaceFiles` non-empty — the re-verifier looked somewhere that
// could not see the file, because the file is right there), leaves the verdict UNCHANGED and records the outcome as
// reverifyNote `unverifiable — …` (reverified stays false: no check actually settled it). A re-run that DID read the
// file and found it does not support the claim (reproduced=true, supportsClaim=false) still downgrades below.
export function applyReverify(audit: AuditedClaim, r: ReverifyJson | undefined, opts: { workspaceFiles?: string[] } = {}): AuditedClaim {
  if (!r) return audit;   // skipped (budget / error / unparseable) — unchanged, reverified stays falsy (NOT a reject)
  const note = (r.note ?? '').trim() || undefined;
  const wsFiles = opts.workspaceFiles ?? [];
  // "did not reproduce BECAUSE it could not find / reach the file" on a file the clone HAS — a plane-visibility
  // failure, not evidence. A re-run that read the file and found its CONTENT contradicts the claim keeps the normal
  // reject/downgrade path below (its note does not say the file was missing / unreachable).
  // An EMPTY note is "no stated reason", which counts as could-not-reach ONLY when the re-run did not explicitly
  // contradict the claim: reproduced=false + supportsClaim=false with no note is still an outright contradiction.
  const explicitContradiction = r.reproduced === false && r.supportsClaim === false;
  const couldNotReach = note ? reverifyCouldNotReach(note, wsFiles) : !explicitContradiction;
  if (r.unverifiable === true || (wsFiles.length > 0 && r.reproduced !== true && couldNotReach)) {
    const why = r.unverifiable === true
      ? (note ?? 'the re-verifier could not perform the check')
      : `the re-verifier did not reproduce it, but the cited file(s) exist in the run workspace (${wsFiles.slice(0, 3).join(', ')})${note ? ` — its note: ${note}` : ''}`;
    return { ...audit, reverified: false, reverifyNote: `unverifiable — ${why}` };
  }
  // CONFIRM only on an UNAMBIGUOUS reproduced + supporting re-run (both explicitly true) — a missing/non-boolean
  // field is NOT treated as supporting.
  if (r.reproduced === true && r.supportsClaim === true) return { ...audit, reverified: true, reverifyNote: note };
  // outright contradiction (reproduced=false AND supportsClaim=false) → reject; any other non-confirm → downgrade.
  if (r.reproduced === false && r.supportsClaim === false) {
    return { ...audit, verdict: 'reject', reverified: true, reverifyNote: note ?? 'the measurement did not reproduce and did not support the claim on re-verify', reason: note ?? audit.reason };
  }
  return { ...audit, verdict: 'downgrade', reverified: true, reverifyNote: note ?? 'the measurement did not cleanly reproduce on re-verify', confidence: 'low' };
}

export interface ReverifyOpts {
  hypotheses: Hypothesis[];
  audits: AuditedClaim[];
  mitigations: Mitigation[];
  mcpServers?: Record<string, unknown>;
  planes?: PlaneInfo[];   // the measure-capable plane registry — drives both the live-plane risk score (server names) and the re-verify prompt's plane menu. Replaces the old hasWarehouse/hasKeyValue booleans.
  max?: number;
  model?: string;
  authToken?: string;
  root?: string;
  log?: (m: string) => void;
}

// Tool-backed re-verify of the ≤max riskiest surviving claims. Returns a PATCHED audit list (same order/ids).
// Budget/availability: each re-verify is a Claude agent call (the warehouse plane); under withBudgetNode('audit')
// it's always-admitted, but a hard agent error just leaves that claim unchanged (reverified:false — NOT a
// reject; a skipped re-verify must not punish the claim).
export async function reverifyClaims(opts: ReverifyOpts): Promise<{ audits: AuditedClaim[]; costUsd: number; trace: string; toolTally: Record<string, number> }> {
  const log = opts.log ?? (() => {});
  const trace: string[] = []; const toolTally: Record<string, number> = {};
  const byId = new Map(opts.hypotheses.map((h) => [h.id, h]));
  const auditById = new Map(opts.audits.map((a) => [a.hypothesisId, a]));
  const planes = opts.planes ?? [];
  const picks = selectRiskySubset(opts.hypotheses, opts.audits, opts.mitigations, opts.max ?? REVERIFY_MAX, planes.map((p) => p.serverName));
  if (!picks.length || !opts.mcpServers) {
    if (picks.length && !opts.mcpServers) log(`▶ claim-reverify · ${picks.length} risky claim(s) selected but no read-only plane mounted — skipping re-verify`);
    return { audits: opts.audits, costUsd: 0, trace: '', toolTally };
  }
  log(`▶ claim-reverify · tool-backed re-verify of ${picks.length} riskiest claim(s): ${picks.join(', ')}`);
  let cost = 0;
  for (const id of picks) {
    const h = byId.get(id); const a = auditById.get(id);
    if (!h || !a) continue;
    const wsFiles = workspaceSettlesEvidence(h, opts.root, planes.map((p) => p.serverName));   // workspace-first
    try {
      const r = await runAgent({
        cwd: opts.root ?? process.cwd(), model: opts.model, authToken: opts.authToken, maxTurns: 8, mcpServers: opts.mcpServers, label: `claim-reverify:${id}`,
        prompt: reverifyPrompt(h, planes, wsFiles),
        onTrace: (e) => { if (e.type === 'tool') { trace.push(`🔧 ${e.name}  ${e.args}`); toolTally[e.name] = (toolTally[e.name] ?? 0) + 1; } },
      });
      cost += r.costUsd;
      const rj = extractJson<ReverifyJson>(r.text) ?? extractJson<ReverifyJson>(r.allText);
      const patched = applyReverify(a, rj ?? undefined, { workspaceFiles: wsFiles });
      auditById.set(id, patched);
      const unverifiable = !patched.reverified && patched.reverifyNote?.startsWith('unverifiable');
      log(`  ↳ ${id}: ${patched.reverified ? `re-verified → ${patched.verdict}${patched.reverifyNote ? ` (${patched.reverifyNote.slice(0, 80)})` : ''}` : unverifiable ? `${patched.reverifyNote!.slice(0, 120)} — left unchanged` : 'reply unparseable — left unchanged'}`);
    } catch (e) { log(`  ↳ ${id}: re-verify failed (${e instanceof Error ? e.message : String(e)}) — left unchanged`); }
  }
  return { audits: opts.audits.map((a) => auditById.get(a.hypothesisId) ?? a), costUsd: cost, trace: trace.join('\n'), toolTally };
}

// ── THE CLAIM-AUDIT SURVIVOR TRANSFORM, IN ONE PLACE ────────────────────────────────────────────
//
// What may appear in synthesis and in the user-facing reports: the audit SURVIVORS (accept/downgrade),
// with a downgraded claim carrying its caveated wording. A rejected or audit-failed claim is a
// CoverageGap, never authoritative report prose.
//
// Extracted because it had been hand-copied into executeOrgRun, cli-deepdive, AND (by omission) the
// report-tiers harness — which is how code review found it: the harness rebuilt writer input from the `barrier`
// checkpoint, and `barrier` is saved BEFORE claim audit. So every experiment arm was handed claims
// production would have withheld, and downgraded claims at full strength. The arms were comparable to
// each other (identical inputs) but they were not replays of production, which is what the harness
// claims to be. A transform that decides what a reader may see should exist once.
export function claimAuditSurvivors(
  hypotheses: Hypothesis[],
  mitigations: Mitigation[],
  audits: AuditedClaim[],
): { hypotheses: Hypothesis[]; mitigations: Mitigation[]; rejectedIds: Set<string> } {
  const auditById = new Map(audits.map((a) => [a.hypothesisId, a]));
  // 'reject' AND any non-'audited' status: a claim the auditor could not settle is not a claim we ship.
  const rejectedIds = new Set(
    audits.filter((a) => a.verdict === 'reject' || a.auditStatus !== 'audited').map((a) => a.hypothesisId),
  );
  // caveatedClaim handles a downgrade WITH or WITHOUT allowedWording — a wording-less downgrade (one
  // created by re-verify) still gets a deterministic caveat, never the bare original.
  const applyAuditWording = (h: Hypothesis): Hypothesis => {
    const a = auditById.get(h.id);
    return a && a.verdict === 'downgrade' ? { ...h, claim: caveatedClaim(h.claim, a) } : h;
  };
  return {
    hypotheses: hypotheses.filter((h) => !rejectedIds.has(h.id)).map(applyAuditWording),
    mitigations: rejectedIds.size ? mitigations.filter((m) => !rejectedIds.has(m.hypothesisId)) : mitigations,
    rejectedIds,
  };
}
