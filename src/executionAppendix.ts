// Two-report model — the Execution report's deterministic appendix fragments.
//
// Replaces two stand-alone surfaces with appendix sections of the Execution report:
//   • History — the deterministic git spine that used to open the "Design & Evolution" report (phases, dead-ends,
//     reverts, ownership). The LLM intent-mining pass is dropped: a spine is facts; a narrative is a separate product.
//   • Code intelligence — the cross-repo charts that used to be appended only to area reports (codeintelViz).
// Both are built while the run workspace still exists and are fail-open: any error ⇒ the section is simply absent.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSpine, type RepoSpine } from './research/docRecovery.ts';
import { codeintelVizFragment } from './codeintelViz.ts';
import { redactSecrets } from './research/reportEvidence.ts';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Repo clones under a workspace root (one per repo), or the root itself when it is a repo. */
export function workspaceRepoDirs(root: string): string[] {
  try {
    if (existsSync(join(root, '.git'))) return [root];
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, '.git'))).map((d) => join(root, d.name));
  } catch { return []; }
}

/** Render one or more repo spines as an appendix fragment. PURE (tested on fixtures). */
export function historyFragmentHtml(spines: RepoSpine[]): string {
  if (!spines.length) return '';
  const repo = (sp: RepoSpine): string => {
    const phases = sp.phases.map((p) => {
      const lead = Object.entries(p.authors).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a).join(', ');
      const dirs = p.topDirs.slice(0, 3).map(([d]) => d).join(', ');
      return `<tr><td class="numc">${p.n}</td><td class="mono" style="white-space:nowrap">${esc(p.start.slice(0, 10))} → ${esc(p.end.slice(0, 10))}</td><td class="numc">${p.commits}</td><td>${esc(dirs)}</td><td>${esc(lead)}</td></tr>`;
    }).join('');
    const dead = sp.deadEnds.slice(0, 8).map((d) => `<li><span class="mono">${esc(d.dir)}</span> — ${d.filesDeleted} file(s) added ${esc(d.firstAdded.slice(0, 10))}, later deleted${d.deleteSubjects[0] ? ` (“${esc(clip(redactSecrets(d.deleteSubjects[0]), 90))}”)` : ''}</li>`).join('');
    const reverts = sp.reverts.slice(0, 6).map((r) => `<li><span class="mono">${esc(r.sha.slice(0, 7))}</span> ${esc(r.date.slice(0, 10))} — ${esc(clip(redactSecrets(r.subject), 100))}</li>`).join('');
    const owners = sp.ownership.slice(0, 6).map((o) => `<li>${esc(o.author)} — ${o.commits} commit(s), ${esc(o.first.slice(0, 10))} → ${esc(o.last.slice(0, 10))}</li>`).join('');
    return `<h3 style="font-size:16px;margin:18px 0 8px">${esc(sp.repo)} <span class="mono" style="font-size:12px;color:var(--muted);font-weight:400">${sp.totalCommits} commits · ${esc(sp.span[0])} → ${esc(sp.span[1])}</span></h3>`
      + (phases ? `<div class="tbl-wrap"><table><thead><tr><th>Phase</th><th>Dates</th><th style="text-align:right">Commits</th><th>Most-changed areas</th><th>Main authors</th></tr></thead><tbody>${phases}</tbody></table></div>` : '')
      + (dead ? `<div class="deyebrow" style="margin-top:14px">Dead ends — added, then removed</div><ul class="exec-hist">${dead}</ul>` : '')
      + (reverts ? `<div class="deyebrow" style="margin-top:14px">Reverts</div><ul class="exec-hist">${reverts}</ul>` : '')
      + (owners ? `<div class="deyebrow" style="margin-top:14px">Ownership</div><ul class="exec-hist">${owners}</ul>` : '');
  };
  return `<p style="color:var(--ink2);font-size:14px;margin:0 0 6px">Facts read from git history (no interpretation). Useful before changing an area: who owned it, and what was tried and removed.</p>`
    + `<style>.exec-hist{margin:4px 0 0;padding-left:18px;font-size:13.5px;line-height:1.7;color:var(--ink2)}</style>`
    + spines.map(repo).join('');
}

/** Build the appendix sections for a run's workspace. Fail-open; order = code intelligence, then history. */
export async function buildExecutionAppendix(root: string, opts: { codeintel?: boolean; maxRepos?: number; log?: (m: string) => void } = {}): Promise<{ key: string; title: string; html: string }[]> {
  const out: { key: string; title: string; html: string }[] = [];
  if (opts.codeintel) {
    try {
      const frag = codeintelVizFragment(root, { tier: 'area' });
      if (frag) out.push({ key: 'codeintel', title: 'Code intelligence · cross-repo map', html: frag });
    } catch (e) { opts.log?.(`execution appendix: codeintel skipped (${e instanceof Error ? e.message : String(e)})`); }
  }
  try {
    const spines: RepoSpine[] = [];
    for (const dir of workspaceRepoDirs(root).slice(0, opts.maxRepos ?? 10)) {
      const sp = await buildSpine(dir).catch(() => null);
      if (sp) spines.push(sp);
    }
    spines.sort((a, b) => b.totalCommits - a.totalCommits);
    const html = historyFragmentHtml(spines);
    if (html) out.push({ key: 'history', title: 'History · from git', html });
  } catch (e) { opts.log?.(`execution appendix: history skipped (${e instanceof Error ? e.message : String(e)})`); }
  return out;
}
