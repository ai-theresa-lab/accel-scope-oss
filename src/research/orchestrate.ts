// The agentic research pipeline (Scout → Investigate → Verify → Loop → Synthesize),
// codified. Call research() and the tool plans investigations, runs the invariant
// agents, adversarially verifies each finding, optionally loops a completeness critic
// until dry, value-ranks the survivors, and synthesizes the agent-actionable
// remediation doc — automatically.
//
// Detection backbone = general data-trust INVARIANTS (src/research/invariants.ts):
// each agent applies ONE invariant's general playbook against whatever DataSources
// are connected (code/git always; a read-only warehouse SQL tool via MCP when
// available), so the same principles surface this CLASS of pain at ANY company.
//
// Context engineering: every agent gets the deterministic ORG MAP as shared ground
// truth. Robustness: a single agent erroring never kills the pipeline (fail-open).

import { runAgent, isBudgetSkip } from './agent.ts';
import { extractJson } from './json.ts';
import { planeHints } from './planeManifest.ts';
import { scout } from './scout.ts';
import { deriveDimensions, type DerivedDimension, type CoverageNote } from './deriveDimensions.ts';
import { type Invariant } from './invariants.ts';
import type { CoverageGap } from '../schema.ts';

export interface ResearchFinding {
  invariant: string; // i1..i11
  title: string;
  claim: string;
  evidence: { ref: string; detail?: string }[];
  businessImpact: string;
  recommendation: string;
  severity: string;
  confidence: string;
  effort: string;
  impact?: string; // trust | cost | velocity | business_metric | security
  focus?: string; // the scouted target this came from
  valueScore?: number; // impact × severity × effort rank (for ordering)
  verifyReason?: string;
  concernHigh?: boolean; // came from a high-priority (user-concern) investigation — boosts valueScore (concern→depth)
}

// Persisted progress so an interrupted run (kill / session limit / crash) resumes
// without re-doing work. Saved after the brief, after planning, and after EACH
// verified task — so at worst one in-flight task is lost, never the whole run.
export interface Checkpoint {
  brief: string;
  plannedTasks: { invKey: string; focus: string; priority?: 'high' | 'normal' }[];
  doneKeys: string[];
  confirmed: ResearchFinding[];
  candidates: ResearchFinding[];
  cost: number;
  derivedDimensions?: DerivedDimension[]; // user-derived dimensions for this run, so a resume keeps their playbooks (not re-derived)
  coverage?: CoverageNote[];              // how each stated concern mapped (covered by a built-in vs minted)
}

export interface ResearchOpts {
  root: string;
  scopeDesc: string;
  invariants: Invariant[];
  orgContext?: string; // shared deterministic org map (context engineering)
  mcpServers?: Record<string, unknown>; // data-source tools (e.g. read-only warehouse SQL) mounted into agents
  scout?: boolean; // run the lead-agent planner to pick per-org investigations
  loopRounds?: number; // completeness-critic rounds (loop-until-dry); 0 = off
  understand?: boolean; // run the business-understanding stage first (default true) — frames everything by business impact
  businessBrief?: string; // pre-computed brief (skip the understanding agent if provided)
  userBrief?: string; // USER-STATED run brief from the console (distinct from the auto-inferred businessBrief) — injected as leads/priorities into scout + investigate + critic + synthesize; verify stays blind
  deriveDimensions?: boolean; // mint new dimensions (u1..uN) from userBrief for concerns the 11 invariants miss (default true when userBrief present); explicit off-switch
  resume?: Checkpoint | null; // resume an interrupted run: skip done tasks, reuse brief + confirmed findings
  onCheckpoint?: (cp: Checkpoint) => void; // called to persist progress (after brief, plan, and each verified task)
  authToken?: string; // BYO Claude credential — a subscription OAuth token (sk-ant-oat…) or metered API key (sk-ant-api…); every agent in this run runs on it. Omitted → instance default. See src/server.ts.
  model?: string;
  maxTurns?: number;
  topN?: number;
  verify?: boolean;
  budgetUsd?: number; // hard cost ceiling; the run auto-converges within it
  log?: (m: string) => void;
}

export interface ResearchResult {
  candidates: ResearchFinding[];
  confirmed: ResearchFinding[];
  remediation: string;
  businessBrief: string; // the inferred business understanding (generic; reusable across runs)
  costUsd: number;
  derivedDimensions?: DerivedDimension[]; // dimensions minted from the run brief (for surfacing / archival)
  coverage?: CoverageNote[];              // how each stated concern mapped (covered by a built-in vs minted)
  coverageGaps?: CoverageGap[];           // STRUCTURED unsettled concerns (e.g. candidates left unverified when the budget was hit) — the answer-back's "could not settle X".
}

interface Task { inv: Invariant; focus: string; priority?: 'high' | 'normal'; }

// --- value model: rank by impact × severity × effort, not raw severity ---
const IMPACT_RANK: Record<string, number> = { business_metric: 5, trust: 5, cost: 4, security: 4, velocity: 3 };
const SEV_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const EFFORT_RANK: Record<string, number> = { quick_win: 3, moderate: 2, project: 1 };
function valueScore(f: ResearchFinding): number {
  // True product impact × severity × effort (effort rank is inverse-cost: quick_win=3 >
  // project=1), so a high-impact quick win outranks a same-impact project — "lead with
  // high-impact quick wins" as the synthesis advertises.
  const base = (IMPACT_RANK[String(f.impact)] ?? 2) * (SEV_RANK[String(f.severity)] ?? 1) * (EFFORT_RANK[String(f.effort)] ?? 1);
  return f.concernHigh ? base * 1.5 : base; // concern→depth: surface user-flagged findings first (×1.5 can outrank a normal finding worth up to 50% more)
}
function keyOf(f: { invariant: string; title?: string }): string {
  return `${f.invariant}::${(f.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 48)}`;
}

function mapBlock(orgContext?: string): string {
  if (!orgContext) return '';
  return `SHARED ORG MAP (deterministic evidence — treat the inventory/flags as ground truth for WHAT EXISTS; verify specific claims yourself before citing):
${orgContext}

`;
}

function sourcesNote(hasWarehouse: boolean): string {
  // planeHints() returns the run's mounted-plane descriptions when set (a console org-run with warehouse /
  // Amplitude / dashboard mounted), else the legacy warehouse-or-nothing text (CLI paths).
  const planes = planeHints(hasWarehouse ? 'a READ-ONLY warehouse SQL tool is mounted (an MCP server — run SELECT / INFORMATION_SCHEMA / JOBS to compute metric values, reconcile sources, profile distributions, inspect cost & freshness)' : '');
  return planes
    ? `DATA SOURCES available to you: the code/repos (Read, Grep, Glob).\n${planes}\nPrefer real queries/tool calls over guessing from code.`
    : `DATA SOURCES available to you: the code/repos (Read, Grep, Glob) plus the org map's git-history signals injected above. No live data plane is mounted — work from the code, SQL files, configs, dashboards-as-code, and those history signals; where you would need to run a query or git command, say so explicitly and cite the defining SQL/code instead.`;
}

// The inferred business understanding, injected so every agent frames findings by
// impact on THIS company's actual flows/metrics — not generic severity.
function engagementBlock(brief?: string): string {
  if (!brief) return '';
  return `USER-STATED RUN BRIEF (the user's OWN words on goals / known risks / where to focus — treat as PRIORITIES and LEADS to investigate, NOT as evidence: confirm each against the artifacts before citing, and a stated concern you cannot evidence is itself worth reporting as "stated but unconfirmed"):
${brief}

`;
}
function briefBlock(brief?: string): string {
  if (!brief) return '';
  return `BUSINESS BRIEF (inferred from THIS company's own artifacts — use it to frame and PRIORITIZE: a finding that hits a core flow / metric / business-critical component below is high priority; one that touches none of them is low, no matter how "severe" in the abstract):
${brief}

`;
}

// Generic business-understanding agent. Knows nothing about the company; infers the
// product, value flows, metrics, critical paths, and instrumentation blind spots
// from whatever artifacts are connected. Works for ANY company — no hardcoding.
function businessPrompt(scopeDesc: string, hasWarehouse: boolean, orgContext?: string): string {
  return `ROLE: principal analyst doing a READ-ONLY first pass to UNDERSTAND THIS COMPANY before any audit. Assume you know NOTHING about them — infer everything from their actual artifacts. Do not modify anything.

${sourcesNote(hasWarehouse)}

${mapBlock(orgContext)}SCOPE: ${scopeDesc}

TASK: from the repos, READMEs, package/config files, schemas, SQL & dashboards-as-code, and git history, produce a concise BUSINESS BRIEF a downstream auditor will use to judge what actually matters. This is discovery from evidence, not assumption. Cover:
1. What this company/product does and who its users/customers are.
2. The 3-6 CORE value-delivery flows (how value is produced end to end) and which repos/services/tables implement each.
3. The METRICS that matter (the numbers leadership and customers watch) and where each is computed.
4. The BUSINESS-CRITICAL components & data — the few places where a bug or a wrong number directly costs revenue, customer trust, or churns a customer.
5. INSTRUMENTATION REALITY — for each core flow, can they actually tell whether it works (is success / usage / quality measured)? Where are they flying blind?

Reply with EXACTLY ONE fenced \`\`\`json block and nothing after:
\`\`\`json
{"business":"1-2 sentences","coreFlows":[{"flow":"...","where":"repos/services/tables"}],"metrics":[{"metric":"...","where":"where computed"}],"critical":["..."],"blindSpots":["where they likely cannot tell if it works"]}
\`\`\``;
}

function formatBrief(b: any): string {
  if (!b || typeof b !== 'object') return '';
  const L: string[] = [];
  if (b.business) L.push(`Business: ${b.business}`);
  if (Array.isArray(b.coreFlows) && b.coreFlows.length) L.push('Core value flows:\n' + b.coreFlows.map((f: any) => `  - ${f.flow}${f.where ? ` [${f.where}]` : ''}`).join('\n'));
  if (Array.isArray(b.metrics) && b.metrics.length) L.push('Metrics that matter:\n' + b.metrics.map((m: any) => `  - ${m.metric}${m.where ? ` [${m.where}]` : ''}`).join('\n'));
  if (Array.isArray(b.critical) && b.critical.length) L.push('Business-critical components/data:\n' + b.critical.map((c: any) => `  - ${c}`).join('\n'));
  if (Array.isArray(b.blindSpots) && b.blindSpots.length) L.push('Likely blind spots (unmeasured):\n' + b.blindSpots.map((c: any) => `  - ${c}`).join('\n'));
  return L.join('\n');
}

async function understandBusiness(opts: ResearchOpts): Promise<{ brief: string; costUsd: number }> {
  const log = opts.log ?? (() => {});
  const hasWarehouse = Boolean(opts.mcpServers && Object.keys(opts.mcpServers).length);
  log('▶ understand · inferring the business from artifacts (frames the whole diagnosis)');
  const r = await runAgent({
    cwd: opts.root,
    prompt: businessPrompt(opts.scopeDesc, hasWarehouse, opts.orgContext),
    model: opts.model,
    authToken: opts.authToken,
    maxTurns: opts.maxTurns ?? 16,
    mcpServers: opts.mcpServers,
    label: 'understand',
    onTool: (n, a) => log(`    ${n} ${a}`),
  });
  const brief = formatBrief(extractJson<any>(r.text)) || r.text.slice(0, 1500);
  log(`  ↳ business brief ready ($${r.costUsd.toFixed(2)})`);
  return { brief, costUsd: r.costUsd };
}

function investigationPrompt(inv: Invariant, scopeDesc: string, topN: number, hasWarehouse: boolean, focus: string, orgContext?: string, brief?: string, userBrief?: string): string {
  const focusBlock = focus ? `FOCUS TARGET for this investigation (from the planner — start here, but follow the evidence): ${focus}\n\n` : '';
  return `ROLE: senior data & engineering auditor performing a READ-ONLY diagnosis. You are checking ONE invariant the org should hold. DO NOT modify any file.

INVARIANT (${inv.key}) — ${inv.title}: ${inv.aim}

INVESTIGATIVE PLAYBOOK (a GENERAL method — apply it to THIS org's actual artifacts; do not assume any specific company's known issues, discover them):
${inv.playbook}

${focusBlock}${sourcesNote(hasWarehouse)}

${mapBlock(orgContext)}${briefBlock(brief)}${engagementBlock(userBrief)}SCOPE: ${scopeDesc}

TASK: apply the playbook and find up to the top ${topN} most ACTIONABLE, HIGH-IMPACT violations of this invariant. Prioritize issues that hit a CORE FLOW / METRIC / business-critical component from the business brief — those are what matter; ignore abstractly-severe issues that touch nothing the business depends on. Prefer cross-repo / cross-source issues where the org map suggests them. Where it sharpens a finding, use GIT-HISTORY behavioral evidence (a file one person rewrites again and again = fragile/critical; the same area "fixed" repeatedly = an unstable definition/design; files that always change together = hidden coupling) and INSTRUMENTATION gaps (a core flow whose success/quality is not measured — they can't tell if it works). Every finding MUST be backed by something you opened or ran — a file:line, a SQL query + its result, a command/git log, or a job-id. Skip anything you cannot evidence. Use concrete numbers (counts, sizes, $, %).

TURN BUDGET (important): you have a LIMITED number of tool turns. Investigate efficiently and emit your findings EARLY — the moment you have 1-3 well-evidenced findings, STOP exploring and output the JSON. A few evidenced findings shipped beat exhaustive exploration that runs out of turns and emits nothing. If you sense you are running low on turns, immediately emit what you already have.

When done investigating, reply with EXACTLY ONE fenced \`\`\`json code block and nothing after it:
\`\`\`json
{"findings":[{"title":"short title","claim":"the assertion, with concrete numbers","evidence":[{"ref":"path:line OR a query/command you ran","detail":"what it shows"}],"businessImpact":"why it hurts trust / cost / velocity / a business metric","recommendation":"a concrete fix a coding agent can execute","severity":"critical|high|medium|low|info","confidence":"low|medium|high","effort":"quick_win|moderate|project","impact":"trust|cost|velocity|business_metric|security"}]}
\`\`\`
If you find nothing material and evidenced, output {"findings":[]}.`;
}

function verifyPrompt(f: ResearchFinding, scopeDesc: string, hasWarehouse: boolean): string {
  const cited = (f.evidence ?? []).map((e) => `${e.ref}${e.detail ? ` (${e.detail})` : ''}`).join(' ; ') || '(none cited)';
  return `ROLE: adversarial verifier. Your DEFAULT is to REFUTE. Read-only — verify independently; do not modify anything.
SCOPE: ${scopeDesc}
${planeHints(hasWarehouse ? 'A read-only warehouse SQL tool (MCP) is mounted — re-run the cited query to check the number yourself.' : '')}

A prior agent made this claim (invariant: ${f.invariant}):
CLAIM: ${f.claim}
EVIDENCE CITED: ${cited}

BE EFFICIENT: open only the cited files / re-run only the cited query needed to judge this one claim, then emit your verdict immediately. Do NOT broadly explore. Refute if the evidence does not support the claim, it is overstated, or the issue is already handled.

Reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"verdict":"confirmed|refuted","reason":"one sentence","confidence":"low|medium|high"}
\`\`\``;
}

function criticPrompt(confirmed: ResearchFinding[], invariants: Invariant[], scopeDesc: string, orgContext?: string, brief?: string, userBrief?: string): string {
  const found = confirmed.map((f) => `- ${f.invariant}: ${f.title}`).join('\n') || '(none yet)';
  const catalog = invariants.map((i) => `- ${i.key} ${i.title}: ${i.aim}`).join('\n');
  return `ROLE: completeness critic for a READ-ONLY data audit. Decide what is STILL UNCHECKED — do not audit yet.

${mapBlock(orgContext)}${briefBlock(brief)}${engagementBlock(userBrief)}SCOPE: ${scopeDesc}

INVARIANT CATALOG:
${catalog}

ALREADY CONFIRMED (do NOT repeat these):
${found}

TASK: identify the highest-yield investigations NOT yet covered — invariants or specific targets (metrics/tables/pipelines/repos/events) that the findings so far have missed and that this org's artifacts can evidence. Propose only genuinely new angles.

Reply with EXACTLY ONE fenced \`\`\`json block:
\`\`\`json
{"investigations":[{"invariant":"i1","focus":"specific new target","rationale":"why it is likely unchecked and high-yield"}]}
\`\`\`
If nothing material is left unchecked, output {"investigations":[]}.`;
}

// Derived dimensions (u1..uN) come from the user's OWN stated concerns. Tell synthesis to
// badge the findings from evidenceable dims (interleave by root cause, not a separate section),
// and — for dims with no connected source — surface them explicitly as "stated but not yet
// evidenced" so a residual concern never silently vanishes from the deliverable.
function derivedBlock(derived?: DerivedDimension[]): string {
  if (!derived || !derived.length) return '';
  const evidenceable = derived.filter((d) => d.evidenceable !== false);
  const unevidenceable = derived.filter((d) => d.evidenceable === false);
  const parts: string[] = [];
  if (evidenceable.length) {
    const list = evidenceable.map((d) => `- ${d.key} ${d.title}: ${d.aim}`).join('\n');
    parts.push(`USER-DERIVED DIMENSIONS (minted from the user's run brief — findings whose invariant is one of these keys came from the user's OWN stated concerns):
${list}
When a finding's invariant is one of the above (${evidenceable.map((d) => d.key).join('/')}), mark it in the doc with a \`UserDerived\` badge (append " \`UserDerived\`" to that task's title) and INTERLEAVE it with the standard findings under the root cause it belongs to — do NOT give derived findings their own separate section. Order everything by business impact as usual.`);
  }
  if (unevidenceable.length) {
    const list = unevidenceable.map((d) => `- ${d.title}: ${d.aim}${d.neededSource ? ` — connect: ${d.neededSource}` : ''}`).join('\n');
    parts.push(`STATED BUT NOT YET EVIDENCEABLE (the user raised these, but no connected source can confirm them yet — do NOT fabricate findings): add a short final section titled "Stated but not yet evidenced" listing each concern and what to connect to investigate it:
${list}`);
  }
  return parts.length ? parts.join('\n\n') + '\n\n' : '';
}

export function synthesisPrompt(findings: ResearchFinding[], scopeDesc: string, orgContext?: string, brief?: string, userBrief?: string, derived?: DerivedDimension[]): string {
  return `ROLE: you are producing the FINAL deliverable — an agent-actionable remediation plan the team's own coding agent (Claude Code) will read and execute against their repos and data stack. Diagnosis and remediation are ONE artifact: the report IS the implementation plan.

${mapBlock(orgContext)}${briefBlock(brief)}${engagementBlock(userBrief)}${derivedBlock(derived)}SCOPE: ${scopeDesc}

Below are CONFIRMED, evidence-backed findings (JSON; each tagged with the invariant it violates, an impact axis, and a valueScore). Do NOT just list them. Write a single Markdown document:

1. One "How to use this doc" line (a coding agent opens it at the repo root and works top to bottom).
2. **ROOT CAUSES** (the most important section): connect the findings into the 2-4 SYSTEMIC root causes behind them, framed by the BUSINESS BRIEF. The deepest value is cross-cutting — several symptoms in different repos/sources that are really ONE problem (e.g. the same business metric computed many divergent ways; a core flow that is unmeasured so failures are invisible). For each root cause: a one-line name, the business consequence (which core flow / metric / customer it hurts and how), and the list of symptom findings it explains.
3. **TASK BACKLOG** — self-contained, copy-pasteable tasks for a coding agent, grouped under the root cause they serve, ordered by business impact (high-impact quick wins first). Each task MUST stand alone (a coding agent executes it with no extra context) and include: **Title** (imperative) · **Problem** (1-2 sentences, business-framed) · **Evidence** (repo file:line / SQL query / git pattern / job-id, from the findings) · **Change** (concrete steps, e.g. define the metric once in a transform/semantic model, capture the cost/latency the runner already returns, add a freshness/volume assertion, instrument the missing event, add a pre-publish accuracy gate) · **Acceptance** (how it knows it's done) · **Touch points** (files/services).

Be specific and faithful to the evidence; do NOT invent findings beyond those given. Frame everything by business impact. Output ONLY the Markdown — no preamble, no JSON, no outer fence.

CONFIRMED FINDINGS:
${JSON.stringify(findings, null, 2)}`;
}

export async function research(opts: ResearchOpts): Promise<ResearchResult> {
  const log = opts.log ?? (() => {});
  const maxTurns = opts.maxTurns ?? 16;
  const topN = opts.topN ?? 5;
  const budget = opts.budgetUsd ?? Infinity;
  const mcpServers = opts.mcpServers;
  const hasWarehouse = Boolean(mcpServers && Object.keys(mcpServers).length);
  const state = { cost: opts.resume?.cost ?? 0 }; // carry prior spend so --resume respects the same hard budget ceiling
  // user-derived dimensions + how each concern mapped; resumed runs keep them (playbooks aren't re-derived)
  let derived: DerivedDimension[] = [...(opts.resume?.derivedDimensions ?? [])];
  let coverage: CoverageNote[] = [...(opts.resume?.coverage ?? [])];

  const allCandidates: ResearchFinding[] = [...(opts.resume?.candidates ?? [])];
  let brief = opts.resume?.brief || opts.businessBrief || ''; // business understanding — set below, injected into every agent
  let confirmed: ResearchFinding[] = [...(opts.resume?.confirmed ?? [])]; // seeded from a resumed checkpoint
  const coverageGaps: CoverageGap[] = []; // STRUCTURED gaps (e.g. candidates dropped unverified when the budget ran out) — so a baseline-floor caller reports honest gaps, not parsed logs
  const done = new Set<string>(opts.resume?.doneKeys ?? []); // task keys already investigated + verified
  const taskKey = (t: Task) => `${t.inv.key}::${t.focus}`;

  // --- Investigate a list of tasks → candidate findings ---
  async function investigate(tasks: Task[]): Promise<ResearchFinding[]> {
    const out: ResearchFinding[] = [];
    for (const t of tasks) {
      if (state.cost >= budget) {
        log(`⚠ budget $${budget.toFixed(0)} reached — skipping ${t.inv.key} ${t.inv.title} → coverage gap`);
        // A task never investigated (budget) is an UNSETTLED concern, not silently dropped — emit a
        // structured gap (concern = the invariant; next test = re-run this investigation).
        coverageGaps.push({
          id: `${t.inv.key.toUpperCase()}-GAP-${coverageGaps.length + 1}`,
          concern: `${t.inv.title}${t.focus ? ` · ${t.focus}` : ''}`,
          whyUnsettled: 'not investigated — the run hit its budget before this invariant could be checked',
          nextDecisiveTest: `Re-run the ${t.inv.key} investigation${t.focus ? ` on ${t.focus}` : ''} with budget / source access.`,
          source: 'invariant-floor:investigate',
          status: 'budget_skipped',
          invariant: t.inv.key,
        });
        continue;
      }
      log(`▶ investigate · ${t.inv.key} ${t.inv.title}${t.focus ? ` · ${t.focus.slice(0, 50)}` : ''}  (spent $${state.cost.toFixed(2)}${budget === Infinity ? '' : ` / $${budget}`})`);
      const r = await runAgent({
        cwd: opts.root,
        prompt: investigationPrompt(t.inv, opts.scopeDesc, t.priority === 'high' ? topN + 3 : topN, hasWarehouse, t.focus, opts.orgContext, brief, opts.userBrief),
        model: opts.model,
        authToken: opts.authToken,
        maxTurns,
        mcpServers,
        label: `investigate:${t.inv.key}`,
        onTool: (n, a) => log(`    ${n} ${a}`),
      });
      state.cost += r.costUsd;
      const parsed = extractJson<{ findings: ResearchFinding[] }>(r.text);
      const found = (parsed?.findings ?? [])
        .filter((f) => f && f.claim)
        .map((f) => ({ ...f, invariant: t.inv.key, focus: t.focus || undefined, evidence: f.evidence ?? [], concernHigh: t.priority === 'high' }));
      log(`  ↳ ${found.length} candidate finding(s)  ($${r.costUsd.toFixed(2)}, ${r.turns} turns${r.error ? `, note: ${r.error.slice(0, 40)}` : ''})`);
      out.push(...found);
    }
    allCandidates.push(...out);
    return out;
  }

  // --- Adversarially verify candidates → confirmed (fail-open) ---
  async function verify(cands: ResearchFinding[]): Promise<ResearchFinding[]> {
    if (opts.verify === false) return cands;
    const kept: ResearchFinding[] = [];
    let skipped = 0;
    // FAIL-CLOSED FOR CLAIMS (design): a candidate the verifier did not affirmatively CONFIRM never ships
    // as a Finding. Budget-skipped (verifier never ran) and no-parseable-verdict (verifier ran but gave
    // no verdict) are UNSETTLED → a structured CoverageGap, so a baseline-floor caller reports them
    // honestly instead of fail-open-keeping them. A REFUTED verdict is settled-healthy → dropped (not a
    // gap, not a finding).
    let unsettled = 0;
    const gapFor = (f: ResearchFinding, status: CoverageGap['status'], why: string): CoverageGap => ({
      id: `${(f.invariant || 'inv').toUpperCase()}-GAP-${coverageGaps.length + 1}`,
      concern: f.title,
      whyUnsettled: why,
      nextDecisiveTest: `Re-run the adversarial verification of "${f.title}" (within budget / with the needed access), or measure it directly against its null.`,
      source: 'invariant-floor:verify',
      status,
      invariant: f.invariant,
    });
    for (const f of cands) {
      if (state.cost >= budget) { coverageGaps.push(gapFor(f, 'budget_skipped', 'left UNVERIFIED — the run hit its budget before adversarial verification could run')); skipped++; continue; }
      const v = await runAgent({
        cwd: opts.root,
        prompt: verifyPrompt(f, opts.scopeDesc, hasWarehouse),
        model: opts.model,
        authToken: opts.authToken,
        maxTurns: Math.min(12, maxTurns),
        mcpServers,
        label: 'verify',
      });
      state.cost += v.costUsd;
      // The global budget envelope declined to START this verifier (no verdict) → unsettled, fail closed.
      if (isBudgetSkip(v)) { coverageGaps.push(gapFor(f, 'budget_skipped', 'left UNVERIFIED — the run hit the global budget envelope before this verifier could run')); skipped++; continue; }
      const verdict = extractJson<{ verdict: string; reason: string; confidence: string }>(v.text);
      if (!verdict) {
        // verifier RAN but returned no parseable verdict → UNSETTLED. Fail CLOSED: a coverage gap, NOT a
        // kept (confirmed) finding. (Was the fail-open `keep = ok || !verdict` bug.)
        coverageGaps.push(gapFor(f, 'not_evidenceable', 'the adversarial verifier returned no parseable verdict — the claim could not be confirmed'));
        unsettled++;
        log(`  ⚠ verify · ${f.title} (no parseable verdict → coverage gap, not a finding)`);
        continue;
      }
      const ok = verdict.verdict === 'confirmed';
      log(`  ${ok ? '✓' : '✗'} verify · ${f.title} (${verdict.verdict})`);
      if (ok) kept.push({ ...f, confidence: verdict.confidence ?? f.confidence, verifyReason: verdict.reason ?? '' });
      // a non-confirmed verdict (refuted/rejected) → settled-healthy: dropped, neither finding nor gap.
    }
    if (skipped) log(`⚠ budget $${budget.toFixed(0)} reached — ${skipped} candidate(s) left unverified → coverage gaps (logged, not silently truncated)`);
    if (unsettled) log(`⚠ ${unsettled} candidate(s) had no parseable verdict → coverage gaps (fail-closed; not shipped as findings)`);
    return kept;
  }

  // --- Understand the business FIRST — frames the whole diagnosis; generic, any company ---
  if (!brief && opts.understand !== false && state.cost < budget) {
    const b = await understandBusiness(opts);
    state.cost += b.costUsd;
    brief = b.brief;
  }
  const scoutBriefContext = [brief ? briefBlock(brief) : '', opts.userBrief ? engagementBlock(opts.userBrief) : ''].filter(Boolean).join('');

  // --- Derive extra dimensions from the run brief (after Brief, before Scout) ---
  // The 11 built-ins are the standard backbone; a user concern OUTSIDE them would otherwise be
  // force-fit or dropped at the enabled-key gates below. Mint isomorphic u1..uN dimensions for
  // the residue (covered concerns stay on the existing re-weighting path). Skipped on resume:
  // a resumed run reuses the persisted dimensions and its fixed plan rather than re-deriving —
  // even if the prior run minted zero — so we never re-pay or mutate the plan mid-resume.
  if (!opts.resume && opts.userBrief && opts.deriveDimensions !== false && state.cost < budget) {
    log('▶ derive · minting dimensions from your run brief (residue the 11 invariants miss)');
    const d = await deriveDimensions({ root: opts.root, scopeDesc: opts.scopeDesc, invariants: opts.invariants, userBrief: opts.userBrief, orgContext: opts.orgContext, businessBrief: brief, mcpServers, model: opts.model, authToken: opts.authToken, maxTurns, log });
    state.cost += d.costUsd;
    derived = d.dimensions;
    coverage = d.coverage;
    const nCovered = d.coverage.filter((c) => c.status === 'covered').length;
    log(`  ↳ ${derived.length} user-derived dimension(s)${derived.length ? ` (${derived.map((x) => x.key).join(', ')})` : ''}; ${nCovered} concern(s) already covered by the backbone ($${d.costUsd.toFixed(2)})`);
  }
  // Merge derived dims into the invariant set — first-class for the rest of the run. enabled/byKey
  // MUST include u* or scout/critic u* tasks die at the gates below.
  const invariants = [...opts.invariants, ...derived];
  const enabled = new Set(invariants.map((i) => i.key));
  const byKey = new Map<string, Invariant>(invariants.map((i) => [i.key, i]));

  // --- Plan investigations: a resumed plan, else Scout (per-org), else one-per-invariant ---
  let tasks: Task[] = [];
  if (opts.resume?.plannedTasks?.length) {
    for (const p of opts.resume.plannedTasks) { const iv = byKey.get(p.invKey); if (iv) tasks.push({ inv: iv, focus: p.focus || '', priority: p.priority ?? 'normal' }); }
    log(`▶ resume · ${tasks.length} planned task(s), ${done.size} already done, ${confirmed.length} confirmed carried over`);
  } else if (opts.scout && state.cost < budget) {
    log('▶ scout · planning investigations for this org');
    const s = await scout({ root: opts.root, scopeDesc: opts.scopeDesc, invariants, orgContext: opts.orgContext, briefContext: scoutBriefContext, mcpServers, model: opts.model, authToken: opts.authToken, maxTurns, log });
    state.cost += s.costUsd;
    for (const inv of s.investigations) {
      if (!enabled.has(inv.invariant)) continue; // only invariants the caller enabled (built-ins + derived u*)
      const iv = byKey.get(inv.invariant);
      if (iv) tasks.push({ inv: iv, focus: inv.focus || '', priority: inv.priority === 'high' ? 'high' : 'normal' });
    }
    log(`  ↳ ${tasks.length} scouted investigation(s) ($${s.costUsd.toFixed(2)})`);
  }
  if (!tasks.length) tasks = opts.invariants.map((inv) => ({ inv, focus: '' }));
  // concern→depth: every EVIDENCEABLE user-derived dimension MUST run (user input is paramount). If
  // scout didn't target one, seed it. Skip evidenceable:false dims — no connected source to investigate,
  // so they're surfaced via coverage/archival rather than burning budget on a flailing investigation.
  for (const dd of derived) {
    if (dd.evidenceable === false) continue;
    if (!tasks.some((t) => t.inv.key === dd.key)) tasks.push({ inv: dd, focus: dd.seedFocus || '', priority: 'high' });
  }
  // evidenceable:false dims are NOT investigated (no source) but must NOT silently vanish: log them
  // here (non-silent) and surface them in synthesis as "stated but not yet evidenced" (derivedBlock).
  const unevidenceable = derived.filter((d) => d.evidenceable === false);
  if (unevidenceable.length) log(`▶ derive · ${unevidenceable.length} concern(s) stated but not yet evidenceable (no connected source) — surfaced, not investigated: ${unevidenceable.map((d) => `${d.key} → connect ${d.neededSource ?? 'source unknown'}`).join('; ')}`);
  // any derived-dim task runs high-priority (and seed its focus if scout left it blank)
  tasks = tasks.map((t) => (t.inv.origin === 'user' ? { ...t, priority: 'high' as const, focus: t.focus || (t.inv as DerivedDimension).seedFocus || '' } : t));
  // concern→depth: investigate high-priority (user-concern) areas FIRST, so a tight budget covers them before it runs out
  tasks = [...tasks].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));
  // surface the focus + log any enabled invariant the (brief-driven) plan didn't target this run — never silently truncate
  const nHigh = tasks.filter((t) => t.priority === 'high').length;
  const skippedInv = opts.invariants.filter((iv) => !tasks.some((t) => t.inv.key === iv.key)).map((iv) => iv.key);
  if (nHigh || skippedInv.length) log(`▶ focus · ${nHigh} concern-priority of ${tasks.length} investigation(s)${skippedInv.length ? ` · not targeted this run (focused by your brief): ${skippedInv.join(', ')}` : ''}`);

  // checkpoint the brief + the plan up front, so a resume has the full task list
  const plannedRecord = tasks.map((t) => ({ invKey: t.inv.key, focus: t.focus, priority: t.priority }));
  const save = () => opts.onCheckpoint?.({ brief, plannedTasks: plannedRecord, doneKeys: [...done], confirmed, candidates: allCandidates, cost: state.cost, derivedDimensions: derived, coverage });
  save();

  // --- Investigate → Verify, INTERLEAVED per task ---
  // Verify each invariant's candidates immediately after investigating it, rather than
  // investigating ALL then verifying ALL. Otherwise a few expensive investigates exhaust
  // the budget before any verify runs, and every real finding is dropped unverified.
  for (const t of tasks) {
    if (done.has(taskKey(t))) continue; // resumed — already investigated + verified
    if (state.cost >= budget) {
      log(`⚠ budget $${budget.toFixed(0)} reached — skipping ${t.inv.key} ${t.inv.title} (and remaining tasks)`);
      continue;
    }
    const cands = await investigate([t]);
    confirmed.push(...(await verify(cands)));
    done.add(taskKey(t));
    save(); // checkpoint after every verified task — at worst one in-flight task is lost on interrupt
  }

  // --- Loop-until-dry: completeness critic re-spawns, budget-bounded ---
  const seen = new Set(confirmed.map(keyOf));
  let round = 0;
  while ((opts.loopRounds ?? 0) > round && state.cost < budget) {
    round++;
    log(`▶ loop · completeness critic (round ${round})`);
    const c = await runAgent({ cwd: opts.root, prompt: criticPrompt(confirmed, invariants, opts.scopeDesc, opts.orgContext, brief, opts.userBrief), model: opts.model, authToken: opts.authToken, maxTurns: Math.min(12, maxTurns), mcpServers, label: 'critic' });
    state.cost += c.costUsd;
    const proposed = extractJson<{ investigations: { invariant: string; focus: string }[] }>(c.text)?.investigations ?? [];
    const moreTasks: Task[] = [];
    for (const p of proposed) {
      if (!enabled.has(p.invariant)) continue;
      const iv = byKey.get(p.invariant);
      if (iv) moreTasks.push({ inv: iv, focus: p.focus || '' }); // loop-round tasks stay 'normal' by design — depth is allocated up front; the critic still sees the brief. The loop DEEPENS existing dims (built-in or u*); it never mints new ones (decision: minting stays in deriveDimensions).
    }
    if (!moreTasks.length) {
      log('  ↳ critic found nothing new — dry, stopping loop');
      break;
    }
    const c2 = await investigate(moreTasks);
    const v2 = await verify(c2);
    const fresh = v2.filter((f) => !seen.has(keyOf(f)));
    fresh.forEach((f) => seen.add(keyOf(f)));
    confirmed.push(...fresh);
    moreTasks.forEach((mt) => done.add(taskKey(mt)));
    save();
    log(`  ↳ round ${round}: +${fresh.length} new confirmed finding(s)`);
    if (!fresh.length) break; // dry
  }

  // --- Value-rank survivors ---
  confirmed = confirmed.map((f) => ({ ...f, valueScore: valueScore(f) })).sort((a, b) => (b.valueScore ?? 0) - (a.valueScore ?? 0));

  // --- Synthesize: the agent-actionable remediation doc ---
  log(`▶ synthesize · remediation doc from ${confirmed.length} confirmed finding(s)`);
  let remediation = '';
  if (confirmed.length) {
    const s = await runAgent({
      cwd: opts.root,
      prompt: synthesisPrompt(confirmed, opts.scopeDesc, opts.orgContext, brief, opts.userBrief, derived),
      model: opts.model,
      authToken: opts.authToken,
      maxTurns: 3,
      mcpServers,
      label: 'synthesize',
    });
    state.cost += s.costUsd;
    remediation = s.text;
  } else {
    remediation = '# Remediation\n\nNo findings survived verification for this scope/invariant set.';
  }

  return { candidates: allCandidates, confirmed, remediation, businessBrief: brief, costUsd: state.cost, derivedDimensions: derived, coverage, coverageGaps };
}
