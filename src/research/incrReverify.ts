// incrReverify.ts — the TARGETED RE-VERIFY of one prior finding whose cited code changed (incremental re-scan §4).
//
// One small, scoped, read-only agent turn per finding: it gets the previous scan's finding (title, claim, evidence
// refs) and the diff hunks of its changed evidence files, may Read/Grep the current workspace, and must return ONE of
//   fixed · persisting · changed · unverifiable
// plus, for persisting / changed, the evidence as it stands NOW (file:line in the current code). A HARD per-finding
// budget (the SDK's maxBudgetUsd, THERESA_INCR_REVERIFY_USD, default $0.40) and a small turn cap bound it; the caller
// caps how many run (THERESA_INCR_REVERIFY_MAX, default 6). Why not claimAudit.reverifyClaims: that re-verifies a
// HYPOTHESIS's measured verdict and only runs with a mounted data plane; this re-checks a FINDING against a code diff and
// must work on a code-only run. Fail-open: any error / unparseable reply ⇒ `unverifiable` (the finding becomes an open
// question, never silently "fixed"). A "fixed" verdict must CITE THE CHANGE — evidence naming a file the
// diff touches, or quoting a line the diff added / removed; a bare "fixed" is treated as unverifiable, since "fixed"
// removes the finding from the report and the diff calls it fixed.
import { runAgent } from './agent.ts';
import type { Evidence, Finding } from '../schema.ts';

export type ReverifyStatus = 'fixed' | 'persisting' | 'changed' | 'unverifiable';
export interface ReverifyResult { status: ReverifyStatus; evidence: Evidence[]; note: string; costUsd: number }

export function reverifyLimits(env: NodeJS.ProcessEnv = process.env): { max: number; usd: number } {
  const max = Math.floor(Number(env.THERESA_INCR_REVERIFY_MAX));
  const usd = Number(env.THERESA_INCR_REVERIFY_USD);
  return { max: Number.isFinite(max) && max >= 0 ? max : 6, usd: Number.isFinite(usd) && usd > 0 ? usd : 0.4 };
}

export function reverifyPrompt(f: Pick<Finding, 'title' | 'claim' | 'evidence'>, diff: string): string {
  const ev = (f.evidence ?? []).map((e) => `- ${e.kind}: ${e.ref}${e.detail ? ` — ${String(e.detail).slice(0, 200)}` : ''}`).join('\n');
  return `You are re-checking ONE finding from the PREVIOUS read-only scan of this code. Its cited code has changed since.
Decide, from the CURRENT code in this directory (Read / Grep only — read-only), which is true now:
  "fixed"        — the defect is gone (the change removed or corrected it);
  "persisting"   — the same defect is still present (possibly moved);
  "changed"      — still a defect, but its shape or location changed materially;
  "unverifiable" — you cannot settle it from the code.
Do not look for other problems. Be quick: a few tool calls.

PREVIOUS FINDING
Title: ${String(f.title ?? '').slice(0, 300)}
Claim: ${String(f.claim ?? '').slice(0, 1200)}
Evidence then:
${ev || '- (none)'}

DIFF OF THE CHANGED EVIDENCE FILES (previous scan → now):
${diff.trim() ? diff.slice(0, 6000) : '(no textual diff available)'}

Reply with ONLY this JSON (evidence = where the defect is NOW, for persisting / changed; for "fixed", evidence MUST cite
the change that removed it — the changed file:line from the diff above, with the changed line quoted in "detail" — a
"fixed" without that is not accepted):
\`\`\`json
{"status":"fixed|persisting|changed|unverifiable","evidence":[{"kind":"file","ref":"<path>:<line>","detail":"<what the line shows>"}],"note":"<one sentence>"}
\`\`\``;
}

/** Parse the reply (a fenced or bare JSON object). null when no usable verdict. */
export function parseReverify(text: string): Omit<ReverifyResult, 'costUsd'> | null {
  const s = String(text ?? '');
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const cands = [m?.[1], s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)].filter((x): x is string => !!x && x.includes('{'));
  for (const c of cands) {
    try {
      const j = JSON.parse(c) as { status?: string; evidence?: { kind?: string; ref?: string; detail?: string }[]; note?: string };
      const st = String(j.status ?? '').toLowerCase() as ReverifyStatus;
      if (!['fixed', 'persisting', 'changed', 'unverifiable'].includes(st)) continue;
      const evidence: Evidence[] = (Array.isArray(j.evidence) ? j.evidence : []).filter((e) => e && typeof e.ref === 'string' && e.ref.trim())
        .slice(0, 5).map((e) => ({ kind: (['file', 'commit', 'pr', 'metric', 'doc', 'computation'].includes(String(e.kind)) ? e.kind : 'file') as Evidence['kind'], ref: String(e.ref).trim(), ...(e.detail ? { detail: String(e.detail).slice(0, 300) } : {}) }));
      return { status: st, evidence, note: String(j.note ?? '').slice(0, 300) };
    } catch { /* next candidate */ }
  }
  return null;
}

/** The files a unified diff touches (repo-relative) and the text of the lines it adds / removes (trimmed, non-trivial). */
export function diffChanges(diff: string): { paths: string[]; lines: string[] } {
  const paths = new Set<string>(), lines: string[] = [];
  for (const l of String(diff ?? '').split('\n')) {
    const h = /^(?:\+\+\+|---) (?:[ab]\/)?(.+?)\s*$/.exec(l);
    if (h) { if (h[1] !== '/dev/null') paths.add(h[1].replace(/\\/g, '/')); continue; }
    const g = /^diff --git a\/(.+?) b\/(.+)$/.exec(l);
    if (g) { paths.add(g[1]); paths.add(g[2]); continue; }
    if (/^[+-]/.test(l)) { const t = l.slice(1).replace(/\s+/g, ' ').trim(); if (t.length >= 6) lines.push(t); }
  }
  return { paths: [...paths], lines };
}
/** Does a "fixed" verdict cite the change? An evidence ref naming a touched file, or evidence / note quoting a changed line. */
export function fixedCitesChange(p: Pick<ReverifyResult, 'evidence' | 'note'>, diff: string): boolean {
  const { paths, lines } = diffChanges(diff);
  if (!paths.length && !lines.length) return false;
  const norm = (x: string): string => String(x ?? '').replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
  for (const e of p.evidence ?? []) {
    const ref = norm(e.ref).split(/[\s#]/)[0].replace(/:\d+(?:[-:]\d+)?$/, '');
    if (ref && paths.some((q) => ref === q || ref.endsWith('/' + q))) return true;
  }
  const text = [p.note, ...(p.evidence ?? []).map((e) => `${e.ref} ${e.detail ?? ''}`)].map(norm).join(' \n ');
  return lines.some((l) => text.includes(l));
}

export async function reverifyFinding(f: Finding, opts: { root: string; diff: string; authToken?: string; maxUsd: number; log?: (m: string) => void }): Promise<ReverifyResult> {
  try {
    const r = await runAgent({ cwd: opts.root, prompt: reverifyPrompt(f, opts.diff), maxTurns: 6, maxBudgetUsd: opts.maxUsd, authToken: opts.authToken, label: `incr-reverify:${f.id}` });
    const p = parseReverify(r.text) ?? parseReverify(r.allText);
    if (!p) return { status: 'unverifiable', evidence: [], note: 'the re-check returned no verdict', costUsd: r.costUsd };
    if (p.status === 'fixed' && !fixedCitesChange(p, opts.diff)) return { status: 'unverifiable', evidence: [], note: 'the re-check said "fixed" without citing the change that fixed it', costUsd: r.costUsd };
    return { ...p, costUsd: r.costUsd };
  } catch (e) {
    if (/run stopped by user|authentication failed/i.test(e instanceof Error ? e.message : String(e))) throw e;   // a stop / bad credential still unwinds the run
    return { status: 'unverifiable', evidence: [], note: `the re-check failed (${e instanceof Error ? e.message.slice(0, 80) : String(e)})`, costUsd: 0 };
  }
}
