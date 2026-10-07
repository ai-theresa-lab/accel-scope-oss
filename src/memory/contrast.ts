// Node-scoped sibling CONTRAST push (cross-project org memory).
//
// A run that ticked "Compare with other projects in this org" (run.siblingRecall) executes its discovery inside
// withContrastScope(holder, …). The holder starts EMPTY: the block can only be built after Comprehend, when the current
// project's entity keys are known, so orgCritiqueExpert fills holder.block (src/siblingRecall.ts) and every later
// runAgent call reads it through currentContrastFor(label). Mirrors the memory push (./push.ts) but with its OWN
// node-eligibility list — CONTRAST is a hypothesis seed for the Critic and a measurement target for the Expert, so it
// reaches ONLY those nodes:
//   critique (the per-bundle Critic) · critic (the floor lane's critic) · intake / measure:<id> (the Expert's intake +
//   measure turns, NOT the :reparse repair turn) · investigate:<inv> (the baseline floor lane's Expert investigation).
//   NOT `verify` — the floor lane's ADVERSARIAL verifier must judge a candidate on its own evidence.
// DELIVERY: the block goes into the node's USER turn as fenced, clearly labelled UNTRUSTED DATA
// (promptWithContrast; the fence + neutralization are built in siblingRecall.contrastBlock) — never the system prompt.
// Everything else — Comprehend, Preflight, mitigate, claim audit, re-verify, synthesis, leadership, area / HTML writers,
// QC — gets NOTHING (synthesis sees only the resulting verdicts, never raw contrast). An unlabeled node is NOT eligible
// (the opposite of the memory push's default), so a new node never receives contrast by accident.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ContrastFact { id: string; key: string; kind: string; projectId: string; projectName: string; repoFullName?: string; sha?: string; evidence: { path: string; line?: number; sha?: string }[]; restricted: boolean; public?: boolean; repo: string }
/** The per-run contrast state: the block (filled after Comprehend) + the facts it cites (for the cross-project finding check). */
// `publicOnly`: a PUBLIC-ONLY OSV scope run (2026-09-29 E2E) — the block holds only facts of PUBLIC sibling repos (no
// value-free lines); the auto OSV mount (orgCritiqueExpert) refuses to mount next to a holder that is NOT public-only.
export interface ContrastHolder { block: string; facts: ContrastFact[]; publicOnly?: boolean }

const als = new AsyncLocalStorage<ContrastHolder>();

/** Run `fn` with a (possibly still empty) contrast holder in scope. No holder ⇒ no-op. */
export function withContrastScope<T>(holder: ContrastHolder | undefined, fn: () => T): T {
  return holder ? als.run(holder, fn) : fn();
}
/** The holder in scope (orgCritiqueExpert fills it), or undefined when the run did not opt in. */
export function currentContrastHolder(): ContrastHolder | undefined { return als.getStore(); }

/** Is a node (by its runAgent label) a Critic / Expert node that may receive CONTRAST? */
export function nodeIsContrastEligible(label?: string): boolean {
  const l = String(label ?? '');
  if (!l) return false;
  if (l === 'critique' || l === 'critic' || l === 'intake') return true;
  if (l.startsWith('investigate:')) return true;
  return l.startsWith('measure:') && !l.endsWith(':reparse');
}

/** The CONTRAST block for the current node, or undefined (not opted in, not filled yet, or an ineligible node). */
export function currentContrastFor(label?: string): string | undefined {
  const h = als.getStore();
  return h && h.block && nodeIsContrastEligible(label) ? h.block : undefined;
}
/** The node's user-turn prompt with the (already fenced) CONTRAST data section appended — unchanged when ineligible. */
export function promptWithContrast(prompt: string, label?: string): string {
  const c = currentContrastFor(label);
  return c ? `${prompt}\n\n${c}` : prompt;
}
/**
 * What the AUDIT LOG records for a node's prompt: the prompt WITHOUT the CONTRAST data section, which
 * is replaced by `[CONTRAST data: n fact line(s) — keys: k1, k2, …]`. The audit artifact is visible to anyone who can
 * view the run, regardless of their access to the sibling repos the block quotes, so it never carries the values — and
 * a fact the run could not show values for (`restricted`, a value-free line) contributes to the count only, never its
 * key. Unchanged when the node got no CONTRAST.
 */
export function auditedContrastPrompt(prompt: string, label?: string): string {
  const h = als.getStore();
  if (!h || !currentContrastFor(label)) return prompt;
  const keys = [...new Set(h.facts.filter((f) => !f.restricted).map((f) => String(f.key ?? '').replace(/[^A-Za-z0-9_.:\/@-]/g, '_').slice(0, 80)).filter(Boolean))];
  const shown = keys.slice(0, 20);
  return `${prompt}\n\n[CONTRAST data: ${h.facts.length} fact line(s)${shown.length ? ` — keys: ${shown.join(', ')}${keys.length > shown.length ? ', …' : ''}` : ''}]`;
}
