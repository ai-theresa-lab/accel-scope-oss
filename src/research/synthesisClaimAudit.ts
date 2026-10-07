// Narrow synthesis-claim audit. The per-bundle Claim Auditor rules HYPOTHESIS-level
// claims; the cross-bundle synthesis can INTRODUCE new assertions (a bottom-line bullet or a lead that infers
// something across bundles — an elimination, a causal/priority/quantitative leap — not reducible to a single
// measured verdict). This auditor is NARROW: it checks whether each synthesis claim FOLLOWS from the
// already-audited basis verdicts (it never re-audits evidence). A `covered_by_basis` claim (a restatement /
// aggregation of audited claims) is a no-op; a `synthesis_introduced` claim must be accept / downgrade / reject.
// A rejected/unsupported synthesis claim is DROPPED (it has no underlying accepted per-bundle claim to caveat)
// — unsafe prose, NOT a CoverageGap. Tiered like the other text-out steps: OpenAI gpt-5.5 → Claude → (on
// failure) fail-CLOSED drop. Runs at the always-admitted 'audit' budget node.
import { runAgent } from './agent.ts';
import { extractJson } from './json.ts';
import { openaiAvailable } from './openai.ts';
import { codexOrGpt } from './codexAgent.ts';
import { type Hypothesis } from './investigation.ts';
import { type Mitigation, type DeepSynthesis, type SynthesisLead, hypothesisDisposition } from './deep.ts';
import { type SynthesisClaim } from '../schema.ts';

export interface SynthesisAuditResult {
  synthesis?: DeepSynthesis;          // the GATED synthesis (claims dropped/replaced); undefined if fully gutted
  claims: SynthesisClaim[];           // the audited claims (for trace / debugging)
  costUsd: number;
  trace: string;
  toolTally: Record<string, number>;
}

// A pre-audit candidate (before the LLM rules on it). PURE-extracted from the synthesis.
export interface SynthesisCandidate { id: string; target: 'bottomLine' | 'lead'; index: number; text: string; basis: string[] }

// Split a bottom-line string into its bullet lines (the synthesis writes "2–4 bullets, one line each, '• '").
function bottomLineBullets(bottomLine: string): string[] {
  return (bottomLine ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
const stripBullet = (s: string): string => s.replace(/^[•\-*]\s*/, '').trim();

// PURE: extract the candidate synthesis claims (bottom-line bullets + leads) the auditor must rule on.
export function extractSynthesisClaims(synth: DeepSynthesis | undefined): SynthesisCandidate[] {
  if (!synth) return [];
  const out: SynthesisCandidate[] = [];
  bottomLineBullets(synth.bottomLine).forEach((b, i) => out.push({ id: `synth:bottomLine:${i}`, target: 'bottomLine', index: i, text: stripBullet(b), basis: [] }));
  // Audit the FULL rendered lead line (title + detail) — synthesisOverview renders BOTH, so a downgraded title
  // with an un-audited overclaiming detail would still leak.
  (synth.leads ?? []).forEach((l, i) => out.push({ id: `synth:lead:${i}`, target: 'lead', index: i, text: `${l.title}${l.detail ? ` — ${l.detail}` : ''}`, basis: Array.isArray(l.basis) ? l.basis : [] }));
  return out;
}

// PURE: the audit-surviving basis verdicts the auditor reasons against (what synthesis prose must follow from).
function basisBlock(hyps: Hypothesis[], mits: Mitigation[]): string {
  const mitMap = new Map(mits.map((m) => [m.hypothesisId, m]));
  const lines = hyps.map((h) => {
    const disp = hypothesisDisposition(h, mitMap.get(h.id));
    const m = h.measurement;
    return `- ${h.id} [${disp.toUpperCase()}]: ${h.claim}${m && m.value != null ? ` (measured ${m.value})` : ''}`;
  });
  return lines.join('\n') || '(no surviving verdicts)';
}

export function synthesisAuditPrompt(candidates: SynthesisCandidate[], hyps: Hypothesis[], mits: Mitigation[]): string {
  const claims = candidates.map((c) => `- ${c.id} [${c.target}]: ${c.text}${c.basis.length ? `  (cites: ${c.basis.join(', ')})` : '  (cites: none)'}`).join('\n');
  return `ROLE: an INDEPENDENT auditor of CROSS-BUNDLE SYNTHESIS prose for a read-only audit. The synthesis below
distilled a set of already-audited per-bundle verdicts into a bottom line + leads. You are NOT re-auditing the
evidence — the verdicts are settled. Your ONLY job: does each synthesis statement FOLLOW from those verdicts?

THE SETTLED VERDICTS (the only ground truth — every synthesis claim must follow from THESE):
${basisBlock(hyps, mits)}

For each synthesis claim, classify + rule:
- scope "covered_by_basis": the claim is a faithful restatement or aggregation of the verdicts above (or a clearly
  safe summary). → verdict "accept" (ships unchanged).
- scope "synthesis_introduced": the claim asserts something BEYOND a direct restatement — a cross-bundle
  elimination, a causal/priority ranking, a quantitative leap, a recommendation — that the verdicts do not by
  themselves establish. Then rule:
    • "accept" — the inference is sound and fully supported by the verdicts;
    • "downgrade" — the direction is defensible but OVERREACHES; provide "allowedWording": the strongest claim the
      verdicts license (one line, no NEW numbers);
    • "reject" — the claim is NOT supported by the verdicts (a leap, an unsupported cause, a number not measured).
Be strict: a confident cross-bundle narrative that the settled verdicts don't carry is exactly what to catch. Do
NOT invent new claims or numbers.

SYNTHESIS CLAIMS:
${claims}

Reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"claims":[
  {"id":"<exact id from above>",
   "scope":"covered_by_basis|synthesis_introduced",
   "verdict":"accept|downgrade|reject",
   "reason":"<one or two sentences grounded in the verdicts>",
   "allowedWording":"<for downgrade: the caveated claim the report MAY make; omit otherwise>"}
]}
\`\`\``;
}

// PURE + fail-CLOSED: parse the auditor reply, keyed to the candidate ids. A candidate MISSING from the reply,
// or with an unknown verdict, is marked unparseable → the gate DROPS it (synthesis prose must be supported).
export function parseSynthesisAudits(text: string | undefined, candidates: SynthesisCandidate[]): SynthesisClaim[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const parsed = extractJson<{ claims: Array<Partial<SynthesisClaim>> }>(text ?? '');
  const rows = Array.isArray(parsed?.claims) ? parsed.claims : [];
  const seen = new Map<string, SynthesisClaim>();
  for (const r of rows) {
    const id = String(r?.id ?? '').trim();
    const c = byId.get(id);
    if (!c || seen.has(id)) continue;
    const verdict = r?.verdict === 'accept' || r?.verdict === 'downgrade' || r?.verdict === 'reject' ? r.verdict : undefined;
    const scope = r?.scope === 'covered_by_basis' || r?.scope === 'synthesis_introduced' ? r.scope : 'synthesis_introduced';
    if (!verdict) { seen.set(id, { ...c, scope, verdict: 'reject', reason: 'unrecognized verdict', auditStatus: 'unparseable' }); continue; }
    seen.set(id, { ...c, scope, verdict, reason: String(r?.reason ?? '').trim() || '(no reason)', allowedWording: r?.allowedWording ? String(r.allowedWording).trim() : undefined, auditStatus: 'audited' });
  }
  // fail-CLOSED: any candidate the reply didn't cover → unparseable reject (the gate drops it).
  return candidates.map((c) => seen.get(c.id) ?? { ...c, scope: 'synthesis_introduced' as const, verdict: 'reject' as const, reason: 'no audit verdict for this synthesis claim', auditStatus: 'unparseable' as const });
}

// Decide the kept text for a plain-string bullet: covered_by_basis or accept → original; downgrade WITH
// wording → wording; everything else (downgrade w/o wording, reject, NON-AUDITED, MISSING) → DROP (undefined).
// fail-CLOSED: a missing/non-audited audit row drops the prose (un-audited synthesis must not ship).
function keptText(original: string, a: SynthesisClaim | undefined): string | undefined {
  if (!a || a.auditStatus !== 'audited') return undefined;              // fail-closed (incl. no audit row at all)
  if (a.scope === 'covered_by_basis' || a.verdict === 'accept') return original;
  if (a.verdict === 'downgrade') return a.allowedWording?.trim() || undefined;   // no caveat fallback for synthesis prose — drop if no wording
  return undefined;                                                     // reject
}

// PURE: apply the audit to the synthesis → a gated DeepSynthesis (claims dropped/replaced). Returns undefined
// if the synthesis is fully gutted (no bottom-line bullets AND no leads survive) so the caller omits it.
export function applySynthesisAudit(synth: DeepSynthesis, claims: SynthesisClaim[]): DeepSynthesis | undefined {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const bullets = bottomLineBullets(synth.bottomLine)
    .map((b, i) => keptText(stripBullet(b), byId.get(`synth:bottomLine:${i}`)))
    .filter((t): t is string => Boolean(t));
  const leads: SynthesisLead[] = (synth.leads ?? [])
    .map((l, i): SynthesisLead | undefined => {
      const a = byId.get(`synth:lead:${i}`);
      if (!a || a.auditStatus !== 'audited') return undefined;          // fail-closed
      if (a.scope === 'covered_by_basis' || a.verdict === 'accept') return l;   // keep title + detail
      // downgrade: replace the title with the caveated wording AND CLEAR the original (overclaiming) detail —
      // synthesisOverview renders detail too, so a stale detail would leak past the caveat.
      if (a.verdict === 'downgrade' && a.allowedWording?.trim()) return { ...l, title: a.allowedWording.trim(), detail: '' };
      return undefined;                                                 // downgrade w/o wording, reject, non-audited
    })
    .filter((l): l is SynthesisLead => Boolean(l));
  const bottomLine = bullets.map((b) => `• ${b}`).join('\n');
  if (!bottomLine && !leads.length) return undefined;
  // areas, lensOverrides and capabilityAssignments are basis-linked LABELS (a grouping / a report-lens call / a capability
  // per hypothesis id), not synthesis-introduced prose — carried unchanged.
  return { bottomLine, leads, areas: synth.areas, ...(synth.lensOverrides?.length ? { lensOverrides: synth.lensOverrides } : {}), ...(synth.capabilityAssignments?.length ? { capabilityAssignments: synth.capabilityAssignments } : {}) };
}

export interface SynthesisAuditOpts {
  synthesis?: DeepSynthesis;
  hypotheses: Hypothesis[];           // the audit-SURVIVING hypotheses (the basis)
  mitigations: Mitigation[];
  model?: string;
  authToken?: string;
  root?: string;
  log?: (m: string) => void;
}

export async function runSynthesisClaimAudit(opts: SynthesisAuditOpts): Promise<SynthesisAuditResult> {
  const log = opts.log ?? (() => {});
  const trace: string[] = []; const toolTally: Record<string, number> = {};
  const candidates = extractSynthesisClaims(opts.synthesis);
  if (!opts.synthesis || !candidates.length) return { synthesis: opts.synthesis, claims: [], costUsd: 0, trace: '', toolTally };
  const prompt = synthesisAuditPrompt(candidates, opts.hypotheses, opts.mitigations);
  log(`▶ synthesis-claim-audit · auditing ${candidates.length} synthesis claim(s) against ${opts.hypotheses.length} surviving verdict(s)`);
  let cost = 0;
  let parsed: SynthesisClaim[] | undefined;

  if (openaiAvailable()) {
    try {
      const or = await codexOrGpt({ files: { 'task.md': prompt }, codexPrompt: 'Read task.md — it has your full instructions plus the synthesis claims and the surviving verdicts. Do the audit, then WRITE the result as JSON (matching the schema in task.md, no prose/fences) to audit.json.', outputFile: 'audit.json', fallbackPrompt: prompt, label: 'synthesis-claim-audit', log }); cost += or.costUsd;
      const c = parseSynthesisAudits(or.text, candidates);
      // Accept the OpenAI reply ONLY if it covered EVERY candidate — a partial/truncated reply falls through
      // to Claude rather than silently fail-closed-dropping the un-covered prose. Fail-closed still applies if Claude also can't cover them.
      if (c.length && c.every((x) => x.auditStatus === 'audited')) parsed = c;
      else log('  ⚠ OpenAI synthesis-claim-audit reply incomplete/unparseable — falling back to Claude');
    } catch (e) { log(`  ⚠ OpenAI synthesis-claim-audit failed (${e instanceof Error ? e.message : String(e)}) — falling back to Claude`); }
  }
  if (!parsed) {
    try {
      const r = await runAgent({ cwd: opts.root ?? process.cwd(), model: opts.model, authToken: opts.authToken, maxTurns: 4, label: 'synthesis-claim-audit', fallbackFrom: openaiAvailable() ? 'openai' : undefined, prompt, toolFree: true,
        onTrace: (e) => { if (e.type === 'tool') { trace.push(`🔧 ${e.name}  ${e.args}`); toolTally[e.name] = (toolTally[e.name] ?? 0) + 1; } } });
      cost += r.costUsd;
      parsed = parseSynthesisAudits(r.text, candidates);   // unparseable → fail-closed drop inside parse
    } catch (e) {
      // FAIL-CLOSED: the auditor is unavailable → drop ALL synthesis claims (don't ship un-audited cross-bundle
      // prose). The leadership writer + synthesisOverview write from the audited verdicts regardless.
      log(`  ⚠ synthesis-claim-audit unavailable (${e instanceof Error ? e.message : String(e)}) — fail-closed: dropping synthesis prose, writers use the verdicts`);
      parsed = candidates.map((c) => ({ ...c, scope: 'synthesis_introduced' as const, verdict: 'reject' as const, reason: `auditor unavailable (${e instanceof Error ? e.message : String(e)})`, auditStatus: 'llm_failed' as const }));
    }
  }
  const gated = applySynthesisAudit(opts.synthesis, parsed);
  const dropped = parsed.filter((c) => !(c.auditStatus === 'audited' && (c.scope === 'covered_by_basis' || c.verdict === 'accept' || (c.verdict === 'downgrade' && c.allowedWording?.trim())))).length;
  const downgraded = parsed.filter((c) => c.auditStatus === 'audited' && c.verdict === 'downgrade' && c.allowedWording?.trim()).length;
  log(`  ↳ synthesis-claim-audit: ${parsed.length - dropped} kept · ${downgraded} downgraded · ${dropped} dropped${gated ? '' : ' (synthesis fully gutted — omitted)'}`);
  return { synthesis: gated, claims: parsed, costUsd: cost, trace: trace.join('\n'), toolTally };
}
