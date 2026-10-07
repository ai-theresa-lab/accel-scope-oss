// findingCounts.ts — the ONE finding count every surface shows.
//
// The recommendation-audit converter ships REFUTED hypotheses as Finding rows (severity `info`, see
// reportAnchors.ts isRuledOutFinding) so the engineering report can show what was checked and ruled out.
// Counting `result.findings.length` therefore reported "53 confirmed findings" for 48 confirmed + 5 ruled
// out. The run record (run.findings / run.ruledOut), the SSE `done` payload, the complete log
// line and the internal report header all read THIS split, so they can never disagree again. PURE.
import { isRuledOutFinding } from '../reportAnchors.ts';
import type { Finding } from '../schema.ts';

// One ruled-out (refuted) hypothesis as the run record carries it — a separate LIST beside the confirmed count, so the
// run page can name what was checked and found healthy. Non-secret (a finding id + its headline).
export interface RuledOutItem { id: string; title: string }

type CountableFinding = Pick<Finding, 'source' | 'severity'> & Partial<Pick<Finding, 'id' | 'title'>>;

export function findingCounts(findings: readonly CountableFinding[]): { confirmed: number; ruledOut: number; ruledOutItems: RuledOutItem[] } {
  const ruledOutItems: RuledOutItem[] = [];
  for (const f of findings) if (isRuledOutFinding(f)) ruledOutItems.push({ id: String(f.id ?? ''), title: String(f.title ?? '') });
  return { confirmed: findings.length - ruledOutItems.length, ruledOut: ruledOutItems.length, ruledOutItems };
}

