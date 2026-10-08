// accel-mini — Phase 1: the SCOPED INVESTIGATE agent. One read-only Claude agent with the SAME org context as a
// full scan (repo as cwd + mounted warehouse/key-value/Slack MCP + a GCP inventory digest), pointed at ONE
// freestyled, clean-scoped question (e.g. "how is the cold-start route defined?", "what is the MMoE baseline
// model?"). It investigates and emits a grounded JSON dossier the deterministic scoped template renders.
//
// It is NOT a full audit: it answers ONLY the question, stays scoped, and grounds every claim in a concrete
// reference (file:line, a warehouse query + result, a cache key). If the question asks for fixes/remediation
// (or the caller forces it), it also returns an engineering work-item list. Read-only throughout.
import { runAgent } from './agent.ts';
import { agentBudgetCap, currentLedger, withBudgetNode } from './budget.ts';
import { extractJson } from './json.ts';
import { isResolvableEvidence, parseFileRef } from '../schema.ts';
import { withPlaneManifest, planeHints, type PlaneInfo } from './planeManifest.ts';
import type { FlowSpec, FlowLane, FlowStep } from '../scopedTemplateHtml.ts';

export interface ScopedDataPoint { label: string; value: string; source: string }
export interface ScopedEvidence { ref: string; detail?: string }
export interface ScopedWorkItem { title: string; detail: string; files?: string[]; effort?: string }
// A MERGED "where it can tighten" item — a weakness paired with its concrete fix. Prefer this over workItems
// for the Quick Ask "story" report (it renders the Where-it-can-tighten cards). workItems stays for reading old dossiers.
export interface ScopedTightening { title?: string; weakness: string; fix: string; effort?: 'quick_win' | 'moderate' | 'project'; files?: string[] } // title = a SHORT imperative action headline (≤10 words); optional for back-compat with pre-title dossiers
// What the investigation actually inspected vs did not (feeds the Scope block).
export interface ScopedScope { covered: string[]; notCovered?: string[] }
export interface ScopedDossier {
  question: string;
  answer: string;                    // the direct narrative answer to the question
  execSummary?: string;              // NON-TECHNICAL plain-language executive summary (2–4 sentences, ZERO code identifiers) — renders as the top "In plain terms" lead callout. Optional (back-compat).
  bottomLine?: string[];             // 1–3 SHORT plain-language items (aim 2) — the core direct answer (the lead); falls back to answer
  mechanism?: string;                // how the thing actually works (for "how is X defined / how does X work")
  flow?: FlowSpec;                   // optional process/flow diagram spec — emitted ONLY when the answer is a process worth a diagram
  scope?: ScopedScope;               // what the investigation covered vs did not
  dataPoints: ScopedDataPoint[];     // measured/observed grounding (counts, shares, config values, …)
  evidence: ScopedEvidence[];        // concrete refs (file:line, query gist, key) backing the claims
  wantsFixes: boolean;               // did the question ask for fixes / what to change?
  tightening?: ScopedTightening[];   // MERGED weakness+fix items — the Quick Ask "where it can tighten" cards
  workItems: ScopedWorkItem[];       // engineering tasks (legacy back-compat; the report renders `tightening`)
  openQuestions: string[];           // what couldn't be settled read-only + the next step (renders under Not directly verified)
  truncated?: boolean;               // the investigate agent ran out of turns; this dossier was salvage-assembled
                                     // from the cut-short transcript → the report leads with a PARTIAL banner
  costUsd: number;
  turns: number;
  trace: string;
  toolTally: Record<string, number>;
}

export interface ScopedInvestigateOpts {
  root: string;                              // repo/workspace path (agent cwd)
  question: string;                          // the freestyled scoped question
  scopeDesc?: string;                        // optional extra scope framing
  gcpInventory?: string;                     // optional GCP project/dataset/table digest folded into the prompt
  mcpServers?: Record<string, unknown>;      // mounted READ-ONLY data-plane MCPs (warehouse SELECT / Redis-read / Slack)
  planes?: PlaneInfo[];                       // per-plane {serverName,kind,exposes} for the mounted MCP planes — drives planeHints so the agent describes/picks each plane correctly (the box plane is added here). Built by the caller (cli-ask) from its sources.
  forceFixes?: boolean;                      // force the work-item list even if the question doesn't ask
  noCode?: boolean;                          // no repo selected: `root` is an empty scratch dir — answer from the data planes
  model?: string;
  authToken?: string;
  maxTurns?: number;
  log?: (m: string) => void;
  onFailTrace?: (text: string) => void;      // the agent emitted no dossier: its final text + trace, for the caller to save REDACTED (no raw dump to disk here)
}

function investigatePrompt(opts: ScopedInvestigateOpts, planes: string): string {
  return `ROLE: you are answering ONE specific, scoped question about the target system, read-only. Investigate
with the tools available, then answer — like a senior engineer asked to "dig into this one thing and report back".

THE QUESTION (answer EXACTLY this — do NOT widen it into a general audit):
"""
${opts.question.trim()}
"""
${opts.scopeDesc ? `SCOPE HINT: ${opts.scopeDesc}\n` : ''}${opts.gcpInventory ? `\nCLOUD INVENTORY (names only — explore via the mounted tools):\n${opts.gcpInventory.slice(0, 2000)}\n` : ''}
CONTEXT AVAILABLE TO YOU:
${opts.noCode ? '- NO code is mounted for this question (your working directory is empty) — answer from the data planes below; if the question needs code, say so in openQuestions.' : "- The project's code is your working directory — read it (Read/Grep/Glob)."}
${planes || '- (no warehouse / cache / Slack plane mounted — answer from code + cloud inventory)'}

HOW TO WORK:
1. SCOPE TIGHT. Answer only the question. Don't enumerate unrelated problems; don't audit the whole system.
2. GROUND EVERYTHING. Every claim must rest on a concrete reference you actually inspected — a file:line, a
   config key + value, a warehouse query + its result, a cache key + its size. Never assert from a name alone;
   read the thing. Treat any number you're told (in the question or a doc) as a CLAIM to verify, not a given.
3. RECONSTRUCT THE MECHANISM where the question is "how is X defined / how does X work" — trace the actual code
   path / config / data, and state what is CONFIRMED from source vs INFERRED from behavior (be honest about the gap).
   Write \`mechanism\` as 3–5 SHORT paragraphs separated by a BLANK LINE — each paragraph one idea (a stage / a
   component / a decision point), and each MAY open with a \`**bold lead-in**\` naming that idea. Do NOT write it as
   one giant block of text.
4. FIXES / WHERE IT CAN TIGHTEN (only if the question asks for a fix / what to change / what's broken / what to improve${opts.forceFixes ? ', and it DOES here (forced)' : ''}): emit \`tightening\` — a MERGED list where each item leads with a SHORT imperative action \`title\` (≤10 words — the one-line headline of WHAT TO DO, e.g. "Add a per-active-user like/share guardrail"), then pairs the specific WEAKNESS (the background — WHY it matters) with its concrete FIX (the detailed HOW), plus a rough \`effort\` (quick_win | moderate | project) and the file(s) it touches. Keep the three DISTINCT — \`title\` = the one-line action, \`fix\` = how to do it, \`weakness\` = why it matters — never repeat one verbatim in another. Otherwise leave \`tightening\` empty.
5. READ-ONLY. Never mutate code or any source. If something can't be settled from read-only artifacts, say so in
   openQuestions with the next step that would settle it — do NOT guess.
6. STANDARD TERMINOLOGY, NO METAPHORS / NICKNAMES. Write the answer/mechanism/tightening in standard, widely-
   understood technical terms; never a metaphor or coined nickname. Say "too many responsibilities and dependencies"
   not "god file"; "single-owner risk / bus factor" not "the hero"; "tightly coupled, hard to change independently"
   not "spaghetti code". Name the actual property, not a label.
7. WRITE FOR THE "STORY" REPORT. The answer is rendered as a structured brief, so also emit:
   • \`execSummary\`: a NON-TECHNICAL executive summary rendered at the very TOP of the report — 2–4 plain-language
     sentences a non-technical stakeholder (a founder, a PM) grasps in ONE read. Cover exactly three things: what
     the system does in business / plain terms, whether it is basically healthy, and the single key risk / takeaway.
     ZERO code identifiers — no function names, no env-var names, no file:line, and avoid jargon (see IDENTIFIER
     BUDGET below). This is the plain-terms layer; everything technical lives below it.
   • \`bottomLine\`: the SHORT, PLAIN-LANGUAGE lead — **1–3 items, aim for 2**, ONLY the most CORE direct answer. For a
     "how X works + where to fix" question the ideal is ONE item on how it works + ONE on what most needs changing.
     LOAD-BEARING ONLY: each item must be a point WITHOUT WHICH the answer collapses — do NOT put reassurance /
     secondary / nice-to-have notes here (e.g. a generic "it is mature and well-guarded", which changes nothing if
     removed, does NOT belong in bottomLine). Sink those details DOWN into \`mechanism\` and \`tightening\`. Few
     identifiers — plain language a non-technical reader gets in one pass; \`mechanism\` is the technical-detail layer.
   • \`scope\`: what you ACTUALLY inspected (\`covered\`) vs what you did NOT and only inferred (\`notCovered\`) —
     be explicit (e.g. covered: "Waggle (source read directly)"; notCovered: "the backend — inferred from
     the API contract"). This is not optional honesty theater; state the real boundary of the investigation.
   • \`flow\`: an OPTIONAL process diagram — emit it ONLY when the answer describes a PROCESS / DATA-FLOW worth a
     picture (a pipeline, a read/write path, a request lifecycle). If the answer is not a process, OMIT \`flow\`.
     Keep it small and layout-able: 1–3 \`lanes\`, each ≤4 \`steps\`; an optional shared \`hub\` node on the right
     that lanes flow into (\`dir:"in"\`, default) or out of (\`dir:"out"\`). Mark a decision/guard step \`kind:"gate"\`.
   In \`bottomLine\` / \`mechanism\` / \`tightening\`, you MAY use inline markdown: \`backticks\` for identifiers/paths
   and \`**bold**\` for the one or two phrases worth emphasizing. Keep it sparing. In \`execSummary\` you MAY use
   \`**bold**\` for the one or two phrases worth emphasizing, but NEVER \`backticks\` — it carries no identifiers.

IDENTIFIER BUDGET (how many technical identifiers — function names, env-var names, file:line — each layer may
carry; FOLLOW THIS EXACTLY — it is what keeps each layer readable at its own altitude, and stops the bottomLine
from turning into method-name soup):
1. execSummary — ZERO identifiers. No function names, no env-var names, no file:line; avoid even jargon where a
   plainer phrase works (say "the shared team memory" not "org_memory"; "reads are on by default" not
   "memoryEnabled()"). Pure plain language a non-technical reader understands in one pass.
2. bottomLine (the answer) — state the BEHAVIOR / CONCLUSION in readable terms. Do NOT include function names,
   env-var names, or file:line. Write "reads are on by default; writes are off and need two approvals" — NOT
   "memoryEnabled() && memoryPushEnabled() (THERESA_MEMORY_PUSH) … server.ts:2588". Push those specifics DOWN to
   mechanism / evidence.
3. mechanism (how it works) — MAY name key identifiers, but SPARINGLY and INLINE — readable prose first, one or two
   identifiers per paragraph, never a long string of function / flag names.
4. tightening — \`title\` (short action) + \`weakness\` + \`fix\` in readable terms; a single key identifier inline is
   fine; put file PATHS in the \`files\` field, NOT in the prose.
5. evidence — file:line refs belong HERE. This is the layer that carries the concrete references, so be precise.

CALIBRATION — NO OVERSTATEMENT (the summaries must never claim MORE than the details below them support; FOLLOW
THIS EXACTLY — it is what stops a punchy headline from contradicting your own calibrated findings):
1. BOTTOM-UP, GROUNDED. Write the DETAILED layers FIRST — evidence, tightening, mechanism — grounded in code you
   actually read. THEN derive \`bottomLine\` from those, THEN derive \`execSummary\` from those. Each summary is a
   faithful DOWN-SAMPLE of the verified details below it — NEVER write the punchy headline first and then shape the
   details to fit it.
2. ANTI-AMPLIFICATION (hard rule). No layer may be MORE absolute or MORE confident than the layer below it. The
   ordering of absoluteness is: execSummary ≤ bottomLine ≤ tightening / evidence. If \`tightening\` says caching is
   "inconsistent," \`bottomLine\` and \`execSummary\` may NOT say "no caching." If a summary would CONTRADICT your own
   detailed findings, the summary is wrong — fix the summary, not the details.
3. NO UNVERIFIED ABSOLUTES. Do NOT use universal / absence words — "no … anywhere", "none", "every", "all",
   "nothing", "always", "never", "everything", "completely" — UNLESS you actually traced ALL the relevant paths and
   verified it. An absence / universal claim cannot be proven from one local signal. Default to calibrated wording:
   "caching is inconsistent — X reuses for 30s, Y uses ad-hoc caches, Z has none" rather than "no caching anywhere."
4. SHORT + PLAIN, SELECTIVE BOLD — keep each \`bottomLine\` item SHORT and plain-language; SINK detail / hedges /
   qualifiers into \`mechanism\` / \`tightening\` rather than packing them into the lead. Concise ≠ overstated: a
   trimmed item still may NOT be MORE absolute than the mechanism/tightening below it (rules 2–3 anti-amplification
   STAY), and it must stay accurate — cut WORDS, never inflate the CLAIM. Use \`**bold**\` on the 1–2 genuinely key
   CONCEPTS per item for scannability (bold the accurate key concept, NEVER an overstatement; ≤ ~2 bolded spans/item).
5. SELF-REFUTE BEFORE FINALIZING. Take your 2–3 strongest / most-absolute claims and actively try to find code that
   would DISPROVE each (e.g. "I'm about to say 'no caching' — is there a React-Query / staleTime or an in-memory
   cache anywhere that contradicts this?"). Keep a claim only if you could NOT disprove it; otherwise soften it to
   what you can defend. Do this within your turn budget before emitting the dossier.

REMEMBERING (only if the memory_write tool is mounted for this run): If this run establishes a durable, verified
fact about the org — or the user explicitly asks you to remember something — you may record it with the
\`memory_write\` tool, but ONLY after confirming it against the actual assets (repos/warehouse/docs) in this run.
Never record a claim you have not verified. Use \`memory_recall\` first to avoid duplicating or contradicting
existing knowledge.

LANGUAGE: write every text field of the dossier in English, whatever language the question is asked in.
OUTPUT: after investigating, emit EXACTLY ONE fenced \`\`\`json block (and nothing after it). The fields are ordered
DETAILS-FIRST, SUMMARIES-LAST on purpose (see CALIBRATION): write the grounded/detailed layers first, then
down-sample them into \`bottomLine\` and \`execSummary\` last — never the reverse.
\`\`\`json
{"question":"<echo the question>",
 "answer":"<the direct answer, 2–6 sentences, with the key numbers/specifics in plain words>",
 "mechanism":"<optional: how it actually works, the traced path — write as 3–5 SHORT paragraphs separated by blank lines, each optionally opening with a **bold lead-in**; NOT one big block. Omit if N/A>",
 "dataPoints":[{"label":"<what>","value":"<the measured/observed value>","source":"<file:line | query gist | key>"}],
 "evidence":[{"ref":"<file:line | table | key | query>","detail":"<what it shows>"}],
 "tightening":[{"title":"<short imperative action headline, ≤10 words>","weakness":"<the specific weakness — why it matters>","fix":"<the concrete fix — how to do it>","effort":"<quick_win|moderate|project>","files":["path"]}],
 "scope":{"covered":["<what you inspected directly>"],"notCovered":["<what you did NOT inspect / only inferred>"]},
 "flow":{"lanes":[{"title":"<lane name>","dir":"<in|out>","edgeLabel":"<optional label on the hub connector>","steps":[{"label":"<step>","sub":"<optional detail>","kind":"<box|gate>"}]}],"hub":{"label":"<shared node>","sub":["<optional lines>"]}},
 "bottomLine":["<1–3 SHORT plain-language items (aim for 2) — ONLY the core direct answer; load-bearing points only, NO reassurance/secondary notes (those go in mechanism/tightening). A faithful DOWN-SAMPLE, never MORE absolute than the details. See CALIBRATION.>"],
 "execSummary":"<2–4 plain-language sentences for a NON-TECHNICAL reader — what it does, is it healthy, the one key risk. ZERO code identifiers; never MORE absolute than bottomLine. See CALIBRATION.>",
 "openQuestions":["<what couldn't be settled read-only + the next step>"],
 "wantsFixes":<true|false — does the question ask for fixes?>}
\`\`\`
Cite ONLY references you actually inspected. Empty tightening is correct when no fix was asked for; OMIT flow entirely unless the answer is a process worth a diagram.`;
}

// SAFEKEEP salvage — when the investigate agent runs out of turns WITHOUT emitting a dossier, a toolFree pass
// assembles what its transcript already CONCLUDED into the dossier (never inventing), and flags what remains
// uninvestigated with a recommended DEDICATED follow-up scan. Turns a hard failure into a partial-but-useful answer.
export function salvagePrompt(question: string, transcript: string): string {
  return `A read-only investigation into the question below RAN OUT OF TURNS before it could finish and emit its
dossier. Below is its full working transcript (its own reasoning + what it observed). You have NO tools — do NOT
investigate further. Your ONLY job: HONESTLY assemble what the investigation had ALREADY CONCLUDED into the
dossier JSON, and flag what still needs work.

QUESTION:
"""
${question.trim()}
"""

INVESTIGATION TRANSCRIPT (cut short):
"""
${transcript.slice(0, 24000)}
"""

RULES:
- answer: START with "⚠ PARTIAL — this investigation was cut short before it finished; the findings below are what
  was established so far." Then summarize ONLY what the transcript actually concluded (the numbers/claims it states).
  NEVER invent a finding or a number the transcript does not contain.
- dataPoints / evidence: include ONLY those the transcript actually measured/observed, with their source.
- tightening: ONLY weaknesses + fixes the transcript itself concluded (title · weakness · fix · effort · files); else [].
- bottomLine (1–3 short plain-language items) and execSummary (2–4 plain sentences, no code identifiers): a faithful
  down-sample of the partial answer — never more confident than what the transcript established.
- Write every text field in English.
- openQuestions: list what remains UNINVESTIGATED, and for EACH recommend a DEDICATED follow-up scan with a concrete
  next step — e.g. "Recommend a dedicated scan: <what to run/measure> to settle <the specific gap>".
- Emit EXACTLY ONE fenced \`\`\`json block (and nothing after it):
\`\`\`json
{"question":"<echo>","answer":"⚠ PARTIAL — …","mechanism":"<optional>","dataPoints":[{"label":"…","value":"…","source":"…"}],"evidence":[{"ref":"…","detail":"…"}],"tightening":[{"title":"…","weakness":"…","fix":"…","effort":"<quick_win|moderate|project>","files":["path"]}],"openQuestions":["Recommend a dedicated scan: …"],"bottomLine":["…"],"execSummary":"…","wantsFixes":false}
\`\`\``;
}

// ── defensive coercion of the LLM-emitted "story" fields (never trust shape; keep only well-formed data) ───
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

function coerceTightening(v: unknown): ScopedTightening[] {
  const efforts = new Set(['quick_win', 'moderate', 'project']);
  return (Array.isArray(v) ? v : [])
    .map((t): ScopedTightening | null => {
      if (!t || typeof t !== 'object') return null;
      const o = t as Record<string, unknown>;
      const weakness = typeof o.weakness === 'string' ? o.weakness.trim() : '';
      const fix = typeof o.fix === 'string' ? o.fix.trim() : '';
      if (!weakness && !fix) return null;
      const item: ScopedTightening = { weakness, fix };
      // SHORT action headline (defensive slice — the renderer uses it as the card title; falls back to `fix` when
      // absent, so a pre-title dossier stays back-compat). Kept only when the model actually emitted one.
      const title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : '';
      if (title) item.title = title;
      if (typeof o.effort === 'string' && efforts.has(o.effort)) item.effort = o.effort as ScopedTightening['effort'];
      const files = strList(o.files);
      if (files.length) item.files = files;
      return item;
    })
    .filter((t): t is ScopedTightening => t !== null);
}

function coerceScope(v: unknown): ScopedScope | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const covered = strList(o.covered);
  const notCovered = strList(o.notCovered);
  if (!covered.length && !notCovered.length) return undefined;
  const scope: ScopedScope = { covered };
  if (notCovered.length) scope.notCovered = notCovered;
  return scope;
}

// coerceFlow(): structurally normalize the LLM's flow JSON into a FlowSpec (or undefined). It does NOT decide
// renderability — the report adapter (scopedTemplateModel) applies isRenderableFlow() and drops+logs a spec it
// can't lay out. Here we only keep well-typed lanes/steps so a malformed blob never reaches the renderer.
function coerceFlow(v: unknown): FlowSpec | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const lanes = (Array.isArray(o.lanes) ? o.lanes : [])
    .map((l): FlowLane | null => {
      if (!l || typeof l !== 'object') return null;
      const lo = l as Record<string, unknown>;
      const steps = (Array.isArray(lo.steps) ? lo.steps : [])
        .map((s): FlowStep | null => {
          if (!s || typeof s !== 'object') return null;
          const so = s as Record<string, unknown>;
          if (typeof so.label !== 'string' || !so.label.trim()) return null;
          const step: FlowStep = { label: so.label.trim() };
          if (typeof so.sub === 'string' && so.sub.trim()) step.sub = so.sub.trim();
          if (so.kind === 'gate' || so.kind === 'box') step.kind = so.kind;
          return step;
        })
        .filter((s): s is FlowStep => s !== null);
      if (!steps.length) return null;
      const lane: FlowLane = { title: typeof lo.title === 'string' ? lo.title : '', steps };
      if (lo.dir === 'in' || lo.dir === 'out') lane.dir = lo.dir;
      if (typeof lo.edgeLabel === 'string' && lo.edgeLabel.trim()) lane.edgeLabel = lo.edgeLabel.trim();
      return lane;
    })
    .filter((l): l is FlowLane => l !== null);
  if (!lanes.length) return undefined;
  const flow: FlowSpec = { lanes };
  if (o.hub && typeof o.hub === 'object') {
    const ho = o.hub as Record<string, unknown>;
    if (typeof ho.label === 'string' && ho.label.trim()) {
      flow.hub = { label: ho.label.trim() };
      const sub = strList(ho.sub);
      if (sub.length) flow.hub.sub = sub;
    }
  }
  return flow;
}

export async function investigateQuestion(opts: ScopedInvestigateOpts): Promise<ScopedDossier | null> {
  const log = opts.log ?? (() => {});
  const trace: string[] = [];
  const toolTally: Record<string, number> = {};

  // accel-mini's data access: the agent QUERIES the mounted read-only MCP planes (if any). Build the run's PLANE
  // MANIFEST so the prompt DESCRIBES each plane by what it exposes (planeHints) and the agent picks the right one.
  const mcpServers: Record<string, unknown> = { ...(opts.mcpServers ?? {}) };
  const planes: PlaneInfo[] = [...(opts.planes ?? [])];
  // Legacy fallback hint, used only when no manifest is built (planeHints returns this verbatim then).
  const legacy = Object.keys(mcpServers).length ? `- Read-only data planes mounted (query via their tools, never write): ${Object.keys(mcpServers).join(', ')}.` : '';
  log(`▶ accel-mini · investigate · "${opts.question.trim().slice(0, 80)}"${planes.length ? ` · planes: ${planes.map((p) => p.serverName).join(',')}` : ''}`);

  // withPlaneManifest sets the run-scoped manifest so planeHints (built INSIDE the callback) emits the per-plane
  // description; investigatePrompt receives that block as its `planes` arg.
  const r = await withPlaneManifest(planes.length ? planes : undefined, () => runAgent({
    cwd: opts.root,
    prompt: investigatePrompt(opts, planeHints(legacy)),
    model: opts.model, authToken: opts.authToken, maxTurns: opts.maxTurns ?? 24,
    // The run budget is a HARD cap here, not just admission: the SDK stops this query between turns once it has
    // spent up to 0.80·B (what is already spent counts) — no ledger / an unbounded budget ⇒ no cap.
    maxBudgetUsd: agentBudgetCap(currentLedger(), 0.8),
    mcpServers, label: 'accel-mini-investigate',
    onTrace: (e) => {
      if (e.type === 'text' && e.text.trim()) trace.push(`💭 ${e.text.trim()}`);
      else if (e.type === 'tool') { trace.push(`🔧 ${e.name} ${e.args}`); toolTally[e.name] = (toolTally[e.name] ?? 0) + 1; }
    },
  }));

  let d = extractJson<Partial<ScopedDossier>>(r.text) ?? extractJson<Partial<ScopedDossier>>(r.allText);
  let truncated = false;
  let salvageCost = 0;
  if (!d || typeof d.answer !== 'string' || !d.answer.trim()) {
    log(`  ⚠ investigate produced no parseable dossier (${(r.text || '').length} chars)${r.error ? ` · ${r.error}` : ''}`);
    // The failure path used to dump the RAW (unredacted) output to /tmp (Cloud Run tmpfs). Now it hands the text to
    // the caller, which saves a REDACTED copy as the run's own trace artifact (opts.onFailTrace) — nothing on disk here.
    try {
      opts.onFailTrace?.([
        `# accel-mini investigate — no dossier emitted`,
        `error: ${r.error || 'none'}   turns: ${r.turns}   costUsd: ${r.costUsd}`,
        ``,
        `## final text (${(r.text || '').length} chars)`, r.text || '(empty)',
        ``,
        `## TRACE (${trace.length} events)`, trace.join('\n\n'),
      ].join('\n'));
    } catch { /* best-effort */ }
    // SAFEKEEP: rather than lose a cut-short investigation entirely, run a toolFree pass that assembles what it
    // CONCLUDED into the dossier + flags what remains (with a recommended dedicated scan). Marks it `truncated`.
    const transcript = (r.allText || r.text || '').trim();
    if (transcript.length > 200) {
      log(`  ↳ safekeep: assembling a partial dossier from the cut-short investigation (${transcript.length} chars)…`);
      // 'reserve' node: the salvage must still start when the investigate agent stopped AT the 0.80·B line (bundle
      // admission would refuse it); capped at what is left of the whole run budget.
      const s = await withBudgetNode('reserve', () => runAgent({ cwd: opts.root, prompt: salvagePrompt(opts.question, transcript), model: opts.model, authToken: opts.authToken, maxTurns: 4, toolFree: true, maxBudgetUsd: agentBudgetCap(currentLedger(), 1), label: 'accel-mini-salvage-synthesis' }));
      salvageCost = s.costUsd || 0;
      d = extractJson<Partial<ScopedDossier>>(s.text) ?? extractJson<Partial<ScopedDossier>>(s.allText);
      if (d && typeof d.answer === 'string' && d.answer.trim()) { truncated = true; log(`  ↳ safekeep: partial dossier assembled — flagged truncated (recommends a dedicated follow-up scan)`); }
    }
    if (!d || typeof d.answer !== 'string' || !d.answer.trim()) return null;
  }
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const bottomLine = strList(d.bottomLine);
  const tightening = coerceTightening(d.tightening);
  // Legacy `workItems` are kept only if a model still emits them (the template maps them when `tightening` is empty);
  // they are no longer back-filled from `tightening` — the report renders `tightening` directly.
  const workItems = arr<ScopedWorkItem>(d.workItems).filter((w) => w && w.title);
  const dossier: ScopedDossier = {
    question: typeof d.question === 'string' && d.question.trim() ? d.question : opts.question,
    answer: d.answer,
    execSummary: typeof d.execSummary === 'string' && d.execSummary.trim() ? d.execSummary.trim() : undefined,
    bottomLine: bottomLine.length ? bottomLine : undefined,
    mechanism: typeof d.mechanism === 'string' && d.mechanism.trim() ? d.mechanism : undefined,
    flow: coerceFlow(d.flow),
    scope: coerceScope(d.scope),
    dataPoints: arr<ScopedDataPoint>(d.dataPoints).filter((p) => p && p.label && p.value),
    evidence: arr<ScopedEvidence>(d.evidence).filter((e) => e && e.ref),
    wantsFixes: Boolean(d.wantsFixes) || Boolean(opts.forceFixes),
    tightening: tightening.length ? tightening : undefined,
    workItems,
    openQuestions: arr<string>(d.openQuestions).filter((q) => typeof q === 'string' && q.trim()),
    truncated: truncated || undefined,
    costUsd: r.costUsd + salvageCost, turns: r.turns, trace: trace.join('\n\n'), toolTally,
  };
  log(`  ↳ dossier: ${dossier.dataPoints.length} datapoint(s) · ${dossier.evidence.length} evidence ref(s) · ${(dossier.tightening?.length ?? 0) || dossier.workItems.length} tighten/work item(s)${dossier.flow ? ' · +flow' : ''} · cost≈$${(r.costUsd + salvageCost).toFixed(2)}${truncated ? ' · ⚠ TRUNCATED (partial — recommends a dedicated follow-up scan)' : ''}`);
  return dossier;
}

// ── Evidence gate (Quick Ask ↔ Full Scan parity) ──────────────────────────────────────────────────
// The Full Scan drops a finding whose cited file/line does not exist in the run workspace (isResolvableEvidence with
// a root). The ask now applies the same check to its dossier BEFORE rendering: an evidence ref that is FILE-shaped
// (a path with an extension AND a directory or a cited line — `src/a.ts:42`, `lib/x.py`, `index.js#L9`) and does not
// resolve under `root` is dropped, and so is a `tightening.files` path that does not. Non-file refs (a warehouse
// table, a query, a cache key, a URL, a glob) are kept untouched — they are not checkable on disk.
export function isFileShapedRef(ref: string): boolean {
  const head = (ref ?? '').trim().split(/[\s,;]+/)[0] ?? '';
  if (!head || /^[a-z][a-z0-9+.-]*:\/\//i.test(head) || /[*?[\]{}]/.test(head)) return false;
  const { path, line } = parseFileRef(head);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(path)) return false;
  return path.includes('/') || line !== undefined;
}

export function gateScopedEvidence(d: ScopedDossier, root: string): { dossier: ScopedDossier; dropped: string[] } {
  const dropped: string[] = [];
  const resolves = (ref: string) => isResolvableEvidence({ kind: 'file', ref }, { root });
  const evidence = d.evidence.filter((e) => {
    if (!isFileShapedRef(e.ref) || resolves(e.ref)) return true;
    dropped.push(e.ref); return false;
  });
  const tightening = d.tightening?.map((t) => {
    if (!t.files?.length) return t;
    const files = t.files.filter((f) => { if (resolves(f)) return true; dropped.push(f); return false; });
    const out: ScopedTightening = { ...t };
    if (files.length) out.files = files; else delete out.files;
    return out;
  });
  return { dossier: { ...d, evidence, ...(tightening ? { tightening } : {}) }, dropped };
}
