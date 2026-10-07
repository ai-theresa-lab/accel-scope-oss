// The Scout: a lead agent that turns the org/data map + capability manifest + the
// invariant catalog into a PRIORITIZED list of concrete investigations tailored to
// THIS org. This is the generalization knob — it decides, per stack, which invariants
// matter most and what SPECIFIC target (metric / table / pipeline / repo / event) each
// should focus on — instead of running all invariants uniformly and blind. It never
// encodes a company's known answers; it discovers targets from the org's own artifacts.

import { runAgent } from './agent.ts';
import { extractJson } from './json.ts';
import { planeHints } from './planeManifest.ts';
import type { Invariant } from './invariants.ts';

export interface Investigation {
  invariant: string; // i1..i11
  focus: string;     // the specific target to examine
  rationale: string; // why it is high-yield here
  priority?: 'high' | 'normal'; // 'high' = directly addresses a user-stated concern → gets more investigative depth downstream
}

export interface ScoutOpts {
  root: string;
  scopeDesc: string;
  invariants: Invariant[];
  orgContext?: string;
  briefContext?: string; // rendered brief blocks (business + user brief), appended AFTER the ORG MAP so user-stated input is NOT nested under the "deterministic evidence" header
  mcpServers?: Record<string, unknown>;
  model?: string;
  authToken?: string; // BYO Claude credential (subscription OAuth token or API key); passed through to the agent
  maxTurns?: number;
  log?: (m: string) => void;
}

function scoutPrompt(invariants: Invariant[], scopeDesc: string, hasWarehouse: boolean, orgContext?: string, briefContext?: string): string {
  const catalog = invariants.map((i) => `- ${i.key} ${i.title}: ${i.aim}`).join('\n');
  return `ROLE: lead data-audit planner. READ-ONLY. Decide WHERE to look — do NOT perform the audit yet, and do not modify anything.

You can scan the code/repos (Read, Grep, Glob).
${planeHints(hasWarehouse ? 'You also have a READ-ONLY warehouse (SQL via a mounted MCP).' : '')}

${orgContext ? `ORG MAP (deterministic evidence):\n${orgContext}\n\n` : ''}${briefContext ?? ''}SCOPE: ${scopeDesc}

INVARIANT CATALOG (general checks every data-driven org should hold):
${catalog}

TASK: quickly survey what THIS org actually has — named metrics, transform/analytics SQL, dashboards-as-code, event-firing sites, pipelines, experiment configs, data tables — then propose the HIGHEST-YIELD investigations: which invariants to run and, for each, the SPECIFIC target to focus on (a named metric, table, pipeline, repo, or event), with a one-line rationale grounded in something you actually saw. Prefer targets where the evidence already hints at a real violation. Only propose investigations this org's artifacts can actually evidence. Aim for 6-12 investigations; you may propose more than one target for the same invariant. If a USER-STATED RUN BRIEF appears above, mark investigations that DIRECTLY address those stated concerns as priority "high" (and feel free to propose extra targets in those areas); mark everything else "normal".

When done surveying, reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"investigations":[{"invariant":"i1","focus":"the specific metric/table/pipeline/repo/event to examine","rationale":"what you saw that makes this high-yield","priority":"high|normal"}]}
\`\`\``;
}

export async function scout(opts: ScoutOpts): Promise<{ investigations: Investigation[]; costUsd: number; error?: string }> {
  const hasWarehouse = Boolean(opts.mcpServers && Object.keys(opts.mcpServers).length);
  const r = await runAgent({
    cwd: opts.root,
    prompt: scoutPrompt(opts.invariants, opts.scopeDesc, hasWarehouse, opts.orgContext, opts.briefContext),
    model: opts.model,
    authToken: opts.authToken,
    maxTurns: opts.maxTurns ?? 12,
    mcpServers: opts.mcpServers,
    label: 'scout',
    onTool: opts.log ? (n, a) => opts.log!(`    ${n} ${a}`) : undefined,
  });
  const parsed = extractJson<{ investigations: Investigation[] }>(r.text);
  const investigations = (parsed?.investigations ?? []).filter((x) => x && typeof x.invariant === 'string').map((x): Investigation => ({ ...x, priority: x.priority === 'high' ? 'high' : 'normal' }));
  return { investigations, costUsd: r.costUsd, error: r.error };
}
