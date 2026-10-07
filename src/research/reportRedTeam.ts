// Report red-team. One independent GPT-5.5 pass over the STRUCTURED leadership report input
// (RecallReportInput, NOT rendered HTML) looking for overclaims / missing caveats / weak fixes. It returns an
// ALLOWLISTED PATCH LIST — never a rewritten report (a full rewrite would invent or erase structure). The
// patches are applied DETERMINISTICALLY to a known set of fields; the deterministic answer-back band is
// off-limits (it is the run's audited artifact, not the writer's prose). Tiered OpenAI gpt-5.5 → Claude; on
// any failure the report ships UNCHANGED (fail-open — the writer's report is already audited-artifact-backed).
// Leadership only (external delivery); runs at the 'reserve' node and is skipped when the reserve is invaded.
import { runAgent } from './agent.ts';
import { extractJson } from './json.ts';
import { openaiAvailable } from './openai.ts';
import { codexOrGpt } from './codexAgent.ts';
import { llmFailureReason, recordDegraded } from './budget.ts';
import type { RecallReportInput } from '../recallReportHtml.ts';

export type RedTeamAction = 'replace' | 'append_caveat' | 'drop';
export interface RedTeamPatch { path: string; action: RedTeamAction; value?: string; reason?: string }

export interface ReportRedTeamResult { report: RecallReportInput; patches: RedTeamPatch[]; applied: number; costUsd: number; trace: string; toolTally: Record<string, number> }

// The ALLOWLIST of editable paths. Anything else (company / title / question / meta / cards / answerBack) is
// REJECTED — answerBack especially is the deterministic audited band, never red-team prose. `drop` is allowed
// only on a recommendation or a whole section (removable list items), never on a singleton field.
const SINGLETON = new Set(['bottomLine', 'decisive', 'caveats']);            // top-level text fields, replace/append_caveat
const okText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const append = (base: string, add: string): string => `${base} ${add}`.trim();

// PURE: validate + apply one patch to a COPY of the report. Returns the new report + whether it applied (an
// invalid path / shape is a no-op, never a throw — a malformed patch can't corrupt the report).
export function applyOnePatch(input: RecallReportInput, p: RedTeamPatch): { report: RecallReportInput; applied: boolean } {
  const r: RecallReportInput = { ...input, cards: [...input.cards], sections: input.sections.map((s) => ({ ...s })), recommendations: [...input.recommendations] };
  const path = (p.path ?? '').trim();
  const needsValue = p.action === 'replace' || p.action === 'append_caveat';
  if (needsValue && !okText(p.value)) return { report: input, applied: false };

  // top-level singleton text: bottomLine / decisive / caveats
  if (SINGLETON.has(path)) {
    if (p.action === 'drop') return { report: input, applied: false };          // never drop a singleton field
    const cur = (r as unknown as Record<string, string>)[path];
    (r as unknown as Record<string, string>)[path] = p.action === 'replace' ? p.value! : append(cur, p.value!);
    return { report: r, applied: true };
  }
  // recommendations[N]: replace / append_caveat / drop
  const recM = path.match(/^recommendations\[(\d+)\]$/);
  if (recM) {
    const i = Number(recM[1]);
    if (i < 0 || i >= r.recommendations.length) return { report: input, applied: false };
    if (p.action === 'drop') { r.recommendations.splice(i, 1); return { report: r, applied: true }; }
    r.recommendations[i] = p.action === 'replace' ? p.value! : append(r.recommendations[i], p.value!);
    return { report: r, applied: true };
  }
  // sections[N].body | sections[N].heading: replace / append_caveat ; sections[N]: drop
  const secField = path.match(/^sections\[(\d+)\]\.(body|heading)$/);
  if (secField) {
    const i = Number(secField[1]); const field = secField[2] as 'body' | 'heading';
    if (i < 0 || i >= r.sections.length) return { report: input, applied: false };
    if (p.action === 'drop') return { report: input, applied: false };          // drop a whole section via `sections[N]`, not a field
    r.sections[i] = { ...r.sections[i], [field]: p.action === 'replace' ? p.value! : append(r.sections[i][field], p.value!) };
    return { report: r, applied: true };
  }
  const secM = path.match(/^sections\[(\d+)\]$/);
  if (secM && p.action === 'drop') {
    const i = Number(secM[1]);
    if (i < 0 || i >= r.sections.length) return { report: input, applied: false };
    r.sections.splice(i, 1); return { report: r, applied: true };
  }
  return { report: input, applied: false };   // unknown / disallowed path (answerBack, cards, title, …)
}

const dropIndex = (p: RedTeamPatch): number => { const m = p.path.match(/\[(\d+)\]/); return m ? Number(m[1]) : -1; };
// PURE: apply all patches. NON-structural patches (replace / append_caveat — no length change) go FIRST against
// the original indexing; then `drop` patches in DESCENDING index order, so removing one element never shifts a
// later drop's target (a batch of `drop recommendations[0]` + `drop recommendations[2]` both hit the right
// elements). Each patch is validated independently against the live report; a bad/out-of-bounds one is skipped.
// (sequential drops were index-shifting.)
export function applyReportPatches(input: RecallReportInput, patches: RedTeamPatch[]): { report: RecallReportInput; applied: number } {
  const ordered = [...patches.filter((p) => p.action !== 'drop'), ...patches.filter((p) => p.action === 'drop').sort((a, b) => dropIndex(b) - dropIndex(a))];
  let report = input; let applied = 0;
  for (const p of ordered) { const r = applyOnePatch(report, p); if (r.applied) { report = r.report; applied++; } }
  return { report, applied };
}

const q = (s: string): string => JSON.stringify(s ?? '');
export function redTeamPrompt(input: RecallReportInput): string {
  const recs = input.recommendations.map((rr, i) => `  recommendations[${i}]: ${q(rr)}`).join('\n');
  const secs = input.sections.map((s, i) => `  sections[${i}].heading: ${q(s.heading)}\n  sections[${i}].body: ${q(s.body)}`).join('\n');
  return `ROLE: a skeptical RED-TEAM reviewer of a finished LEADERSHIP report for a read-only audit. The report
already renders AUDITED findings — you do NOT add findings or numbers. Your ONLY job: catch where the PROSE
OVERCLAIMS beyond the evidence, MISSES a caveat a careful reader needs, or proposes a WEAK / hand-wavy fix.
Propose minimal, surgical edits as PATCHES — never rewrite the report.

EDITABLE FIELDS (you may patch ONLY these paths; anything else is ignored):
  bottomLine: ${q(input.bottomLine)}
  decisive: ${q(input.decisive)}
  caveats: ${q(input.caveats)}
${recs || '  (no recommendations)'}
${secs || '  (no sections)'}

Each patch: "replace" (provide an English value that says the SAME thing more carefully — no new numbers),
"append_caveat" (provide an English caveat to append), or "drop" (only a recommendations[N] or a whole
sections[N] that is unsupported / redundant). Be conservative — propose a patch ONLY where
the report genuinely overclaims, misses a load-bearing caveat, or ships a weak fix. An empty patch list is a
perfectly good answer.

Reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"patches":[
  {"path":"bottomLine|decisive|caveats|recommendations[N]|sections[N].body|sections[N].heading|sections[N]",
   "action":"replace|append_caveat|drop",
   "value":"…",
   "reason":"<why — one line>"}
]}
\`\`\``;
}

// True iff the reply parsed to a `{patches: [...]}` object — distinguishes "the LLM said no patches" (a valid
// clean result) from "unparseable" (no JSON), so the OpenAI tier only short-circuits on a REAL answer and
// otherwise falls through to Claude.
export function hasPatchesArray(text: string | undefined): boolean {
  const parsed = extractJson<{ patches?: unknown }>(text ?? '');
  return Array.isArray(parsed?.patches);
}
export function parseRedTeamPatches(text: string | undefined): RedTeamPatch[] {
  const parsed = extractJson<{ patches: Array<Partial<RedTeamPatch>> }>(text ?? '');
  const rows = Array.isArray(parsed?.patches) ? parsed.patches : [];
  const out: RedTeamPatch[] = [];
  for (const p of rows) {
    const path = String(p?.path ?? '').trim();
    const action = p?.action === 'replace' || p?.action === 'append_caveat' || p?.action === 'drop' ? p.action : undefined;
    if (!path || !action) continue;
    out.push({ path, action, value: okText(p?.value) ? p!.value : undefined, reason: p?.reason ? String(p.reason) : undefined });
  }
  return out;
}

export interface ReportRedTeamOpts { report: RecallReportInput; model?: string; authToken?: string; root?: string; log?: (m: string) => void }

export async function reportRedTeam(opts: ReportRedTeamOpts): Promise<ReportRedTeamResult> {
  const log = opts.log ?? (() => {});
  const trace: string[] = []; const toolTally: Record<string, number> = {};
  const prompt = redTeamPrompt(opts.report);
  log('▶ report-redteam · scanning the leadership report for overclaims / missing caveats / weak fixes');
  let cost = 0; let patches: RedTeamPatch[] | undefined;
  if (openaiAvailable()) {
    try {
      const or = await codexOrGpt({ files: { 'task.md': prompt }, codexPrompt: 'Read task.md — full instructions + the leadership report to red-team. Find overclaims / missing caveats / weak fixes, then WRITE the patches as JSON (matching task.md, no prose/fences) to patches.json.', outputFile: 'patches.json', fallbackPrompt: prompt, label: 'report-redteam', log }); cost += or.costUsd;
      // Accept ONLY a real `{patches:[…]}` reply (an empty list is a valid "no overclaims"); an UNPARSEABLE
      // reply falls through to Claude rather than being mistaken for a clean empty result.
      if (hasPatchesArray(or.text)) patches = parseRedTeamPatches(or.text);
      else log('  ⚠ OpenAI report-redteam reply not parseable — falling back to Claude');
    } catch (e) {
      log(`  ⚠ OpenAI report-redteam failed (${e instanceof Error ? e.message : String(e)}) — falling back to Claude`);
      recordDegraded('report-redteam', `OpenAI red-team failed: ${llmFailureReason(e instanceof Error ? e.message : String(e))} — fell back to Claude`);
    }
  }
  if (!patches) {
    try {
      const r = await runAgent({ cwd: opts.root ?? process.cwd(), model: opts.model, authToken: opts.authToken, maxTurns: 3, label: 'report-redteam', fallbackFrom: openaiAvailable() ? 'openai' : undefined, prompt, toolFree: true,
        onTrace: (e) => { if (e.type === 'tool') { trace.push(`🔧 ${e.name}  ${e.args}`); toolTally[e.name] = (toolTally[e.name] ?? 0) + 1; } } });
      cost += r.costUsd; patches = parseRedTeamPatches(r.text);
    } catch (e) {
      // FAIL-OPEN: the report is already audited-artifact-backed — a red-team failure ships it UNCHANGED.
      log(`  ⚠ report-redteam unavailable (${e instanceof Error ? e.message : String(e)}) — shipping the report unchanged`);
      recordDegraded('report-redteam', `red-team unavailable: ${llmFailureReason(e instanceof Error ? e.message : String(e))} — leadership report shipped un-reviewed`);
      return { report: opts.report, patches: [], applied: 0, costUsd: cost, trace: trace.join('\n'), toolTally };
    }
  }
  const { report, applied } = applyReportPatches(opts.report, patches);
  log(`  ↳ report-redteam: ${patches.length} patch(es) proposed · ${applied} applied`);
  return { report, patches, applied, costUsd: cost, trace: trace.join('\n'), toolTally };
}
