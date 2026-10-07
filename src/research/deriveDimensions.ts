// Derive NEW investigation dimensions from the user's run brief. The 11
// built-in invariants (research/invariants.ts) are the standard backbone; this
// stage reads the user's OWN stated concerns and, for the ones the backbone does
// NOT already cover, mints additional dimensions ISOMORPHIC to a built-in Invariant
// ({key, title, aim, playbook}, keyed u1..uN). Merged into the invariant set by
// orchestrate.ts, they travel the same scout → investigate → (blind) verify →
// synthesize path as the built-ins — so a residual concern outside i1..i11 still
// gets a real, evidence-backed investigation instead of being force-fit or dropped.
//
// Non-negotiable: a minted dimension MUST carry a concrete, NEUTRAL, EVIDENCEABLE
// playbook (evidence to gather + violation patterns + how to confirm) — never a
// free-form "go check whatever the user said" prompt. The playbook is a METHOD, not
// a conclusion: a stated concern that cannot be evidenced is itself a reportable
// result, and downstream blind verification still applies.
//
// Robustness: fail-open. A parse/agent failure yields zero derived dimensions and
// the run proceeds on the built-in backbone alone (mirrors scout.ts).

import { runAgent } from './agent.ts';
import { extractJson } from './json.ts';
import { planeHints } from './planeManifest.ts';
import type { Invariant } from './invariants.ts';

// A dimension derived from the user brief. Extends Invariant so it is a first-class
// member of the invariant set; origin is pinned to 'user' for surfacing/archival.
export interface DerivedDimension extends Invariant {
  origin: 'user';
  seedFocus?: string;      // a concrete first target for scout/investigate when none is assigned
  evidenceable?: boolean;  // false ⇒ no connected source can currently evidence this concern
  neededSource?: string;   // (only when evidenceable === false) what to connect to investigate it
}

// How one stated concern mapped: already covered by a built-in invariant, or a
// residue that warranted a minted dimension. Archived with the run for provenance.
export interface CoverageNote {
  concern: string;
  status: 'covered' | 'residue';
  invariant?: string; // the i1..i11 that covers it (when status === 'covered')
  note?: string;
}

export interface DeriveOpts {
  root: string;
  scopeDesc: string;
  invariants: Invariant[];   // the built-in backbone — rendered as the "already covered" catalog
  userBrief: string;         // the user's OWN words; the concerns are extracted from this
  orgContext?: string;       // deterministic org map (judge evidenceability against what exists)
  businessBrief?: string;    // inferred business understanding (judge what actually matters)
  mcpServers?: Record<string, unknown>;
  model?: string;
  authToken?: string;
  maxTurns?: number;
  log?: (m: string) => void;
}

function derivePrompt(opts: DeriveOpts, hasWarehouse: boolean): string {
  const catalog = opts.invariants.map((i) => `- ${i.key} ${i.title}: ${i.aim}`).join('\n');
  const mapBlock = opts.orgContext
    ? `ORG MAP (deterministic evidence — what actually exists):\n${opts.orgContext}\n\n`
    : '';
  const briefBlock = opts.businessBrief
    ? `BUSINESS BRIEF (inferred from this company's artifacts — what matters and where):\n${opts.businessBrief}\n\n`
    : '';
  return `ROLE: framing agent for a READ-ONLY diagnosis. Turn the USER'S OWN STATED CONCERNS into new investigative DIMENSIONS — but ONLY for concerns the standard backbone does not already cover. READ-ONLY: do not modify anything; you are not auditing yet, only deciding WHAT should be investigated.

You can scan the code/repos (Read, Grep, Glob).
${planeHints(hasWarehouse ? 'You also have a READ-ONLY warehouse (SQL via a mounted MCP).' : '')}

${mapBlock}${briefBlock}USER-STATED RUN BRIEF (the user's OWN words — extract concerns from THIS; treat as PRIORITIES and LEADS, not as evidence):
${opts.userBrief}

SCOPE: ${opts.scopeDesc}

STANDARD BACKBONE — the dimensions ALREADY COVERED (do NOT recreate these):
${catalog}

TASK:
1. Extract the distinct CONCERNS / GOALS / RISKS the user states (explicit or clearly implied) in the run brief above.
2. For EACH concern decide coverage:
   - COVERED: it is already an instance of one of the backbone invariants. Do NOT mint a dimension; record which invariant covers it (scout will prioritize it there).
   - RESIDUE: it is NOT well covered by any backbone invariant. Mint a NEW DIMENSION for it.
3. The task boundary is OPEN: a dimension may concern ANYTHING the user cares about — product, security, reliability, compliance, ops, cost, anything. It does NOT have to be about data/metric trust. The ONLY bar is that it must be INVESTIGABLE from read-only artifacts that are (or could be) connected.
4. Write each minted dimension in the SAME SHAPE as the backbone, with a GENERAL, NEUTRAL investigative playbook: concrete evidence to gather + what a violation looks like + how to confirm it with a resolvable pointer (file:line / a query+result / commit / job-id). The playbook is a METHOD, not a conclusion — do NOT assume the client is right; a stated concern you cannot evidence is itself a reportable result ("stated but unconfirmed").
5. If a concern is investigable in principle but NO connected source can currently evidence it, still mint the dimension, set evidenceable=false, and name the source that would be needed — do not fabricate a playbook that will flail against artifacts that are not there.

When done, reply with EXACTLY ONE fenced \`\`\`json block and nothing after it:
\`\`\`json
{"coverage":[{"concern":"...","status":"covered|residue","invariant":"iX or null","note":"one line why"}],"dimensions":[{"title":"short title","aim":"the property the org should hold (one sentence)","playbook":"general method: evidence to gather + violation patterns + how to confirm","seedFocus":"a concrete first target to examine (optional)","evidenceable":true,"neededSource":"(only when evidenceable=false) what to connect"}]}
\`\`\`
If every concern is already covered by the backbone, output {"coverage":[...],"dimensions":[]}.`;
}

interface RawDim {
  key?: unknown; title?: unknown; aim?: unknown; playbook?: unknown;
  seedFocus?: unknown; evidenceable?: unknown; neededSource?: unknown;
}

// Pure parse of the agent's reply → validated dimensions + coverage. Exported so the
// two invariants this stage rests on are unit-testable without invoking an LLM:
//   1. keys are reassigned u1..uN in code — the agent's own numbering is never trusted
//      (it can collide with i*, repeat, or skip);
//   2. a dimension missing the isomorphic core (title/aim/playbook) is DROPPED — without
//      a real playbook it is exactly the unconstrained prompt this stage exists to avoid.
export function parseDerivedResponse(text: string): { dimensions: DerivedDimension[]; coverage: CoverageNote[] } {
  const parsed = extractJson<{ dimensions?: RawDim[]; coverage?: CoverageNote[] }>(text);
  const dimensions: DerivedDimension[] = (parsed?.dimensions ?? [])
    .filter((d): d is RawDim => Boolean(d) && typeof d.title === 'string' && typeof d.aim === 'string' && typeof d.playbook === 'string'
      && String(d.title).trim() !== '' && String(d.aim).trim() !== '' && String(d.playbook).trim() !== '')
    .map((d, i): DerivedDimension => ({
      key: `u${i + 1}`,
      title: String(d.title).trim(),
      aim: String(d.aim).trim(),
      playbook: String(d.playbook).trim(),
      origin: 'user',
      seedFocus: typeof d.seedFocus === 'string' && d.seedFocus.trim() ? d.seedFocus.trim() : undefined,
      evidenceable: d.evidenceable === false ? false : true, // default true unless explicitly false
      neededSource: typeof d.neededSource === 'string' && d.neededSource.trim() ? d.neededSource.trim() : undefined,
    }));
  const coverage: CoverageNote[] = (parsed?.coverage ?? [])
    .filter((c): c is CoverageNote => Boolean(c) && typeof c.concern === 'string' && (c.status === 'covered' || c.status === 'residue'));
  return { dimensions, coverage };
}

export async function deriveDimensions(
  opts: DeriveOpts,
): Promise<{ dimensions: DerivedDimension[]; coverage: CoverageNote[]; costUsd: number; error?: string }> {
  const hasWarehouse = Boolean(opts.mcpServers && Object.keys(opts.mcpServers).length);
  const r = await runAgent({
    cwd: opts.root,
    prompt: derivePrompt(opts, hasWarehouse),
    model: opts.model,
    authToken: opts.authToken,
    maxTurns: opts.maxTurns ?? 12,
    mcpServers: opts.mcpServers,
    label: 'derive-dimensions',
    onTool: opts.log ? (n, a) => opts.log!(`    ${n} ${a}`) : undefined,
  });
  const { dimensions, coverage } = parseDerivedResponse(r.text); // fail-open: bad/absent JSON → empty
  return { dimensions, coverage, costUsd: r.costUsd, error: r.error };
}
