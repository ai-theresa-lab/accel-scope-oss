// Doc-recovery — the DETERMINISTIC git-history spine of a codebase (zero-LLM, pure git): phases (quiet-gap
// sessionization + monthly-bucket fallback for continuously-active repos), dead-end clusters (files added-then-
// deleted, absent from HEAD), reverts, ownership/departure. Every fact is a real commit sha/subject/date or the
// segmentation itself. The Execution report's appendix renders it (executionAppendix.ts).
//
// docRecoveryEnabled() reports whether the THERESA_DOC_RECOVERY=1 opt-in is set (the console shows it as available).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export function docRecoveryEnabled(): boolean {
  return process.env.THERESA_DOC_RECOVERY === '1';
}

const GAP_DAYS = 21;          // a quiet gap this long starts a new phase
const MIN_PHASE_COMMITS = 5;  // a smaller phase merges into the previous one
const MIN_REPO_COMMITS = 8;   // below this a repo has no story worth recovering

// ── deterministic spine types ────────────────────────────────────────────────────────────────────
interface FileDelta { path: string; add: number; del: number }
interface Commit { sha: string; author: string; date: string; subject: string; files: FileDelta[] }
export interface Phase {
  n: number; start: string; end: string; commits: number;
  authors: Record<string, number>;
  topDirs: [string, number][];
  sampleSubjects: string[];
  anchorShas: string[];
}
export interface DeadEnd {
  dir: string; filesDeleted: number; firstAdded: string;
  deletedAround: [string, number][]; deleteCommits: string[]; deleteSubjects: string[]; sampleFiles: string[];
}
export interface Revert { sha: string; date: string; subject: string }
export interface OwnerRec { author: string; commits: number; first: string; last: string }
export interface RepoSpine {
  repo: string; totalCommits: number; span: [string, string];
  phases: Phase[]; deadEnds: DeadEnd[]; reverts: Revert[]; ownership: OwnerRec[];
}

// ── git plumbing (deterministic; the ONLY place we shell out to git) ─────────────────────────────
// The repo's display name = its workspace dir name. Split on BOTH separators: on Windows the old '/'-only split kept
// the whole temp path ("C:\Users\…\Temp\theresa-org-…\ky") as the report title (ky test run).
export function repoNameOf(dir: string): string {
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const US = '\x1f';   // unit-separator field delimiter — cannot appear in an author name / date / subject, so a
                     // user-controlled `|` in a name can't shift the parse.
async function parseLog(repo: string): Promise<Commit[]> {
  const out = await git(repo, ['log', '--no-merges', '--date=iso-strict', '-M',
    `--pretty=format:__C__%H${US}%an${US}%ad${US}%s`, '--numstat']);
  const commits: Commit[] = [];
  let cur: Commit | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('__C__')) {
      const parts = line.slice(5).split(US);
      if (parts.length < 4) continue;
      cur = { sha: parts[0], author: parts[1], date: parts[2], subject: parts.slice(3).join(US), files: [] };
      commits.push(cur);
    } else if (line.trim() && cur) {
      const parts = line.split('\t');
      if (parts.length === 3) {
        cur.files.push({ path: parts[2], add: parts[0] === '-' ? 0 : Number(parts[0]) || 0, del: parts[1] === '-' ? 0 : Number(parts[1]) || 0 });
      }
    }
  }
  commits.reverse();   // oldest first
  return commits;
}

function topDirs(files: FileDelta[], n = 8, depth = 2): [string, number][] {
  const c = new Map<string, number>();
  for (const f of files) {
    const parts = f.path.split('/');
    const d = parts.length > 1 ? parts.slice(0, depth).join('/') : parts[0];
    c.set(d, (c.get(d) ?? 0) + f.add + f.del);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function fingerprint(bucket: Commit[]): Set<string> {
  return new Set(topDirs(bucket.flatMap((c) => c.files), 5).map(([d]) => d));
}

function mergeSmall(phases: Commit[][]): Commit[][] {
  const out: Commit[][] = [];
  for (const p of phases) {
    if (out.length && p.length < MIN_PHASE_COMMITS) out[out.length - 1].push(...p);
    else out.push(p);
  }
  return out;
}

function phasesOf(commits: Commit[]): Commit[][] {
  let phases: Commit[][] = [];
  let cur: Commit[] = [];
  let prev: number | null = null;
  const DAY = 86_400_000;
  for (const c of commits) {
    const t = Date.parse(c.date);
    if (prev !== null && !Number.isNaN(t) && (t - prev) > GAP_DAYS * DAY && cur.length) { phases.push(cur); cur = []; }
    cur.push(c); if (!Number.isNaN(t)) prev = t;
  }
  if (cur.length) phases.push(cur);
  let merged = mergeSmall(phases);
  // Continuously-active repo (no quiet gaps): fall back to monthly buckets, merging adjacent months whose
  // top-dir fingerprints overlap strongly (Jaccard > 0.6).
  if (merged.length === 1 && commits.length > 100) {
    const months = new Map<string, Commit[]>();
    for (const c of commits) { const m = c.date.slice(0, 7); (months.get(m) ?? months.set(m, []).get(m)!).push(c); }
    const buckets = [...months.keys()].sort().map((m) => months.get(m)!);
    const grouped: Commit[][] = [];
    for (const b of buckets) {
      if (grouped.length) {
        const a = fingerprint(grouped[grouped.length - 1]), bb = fingerprint(b);
        const uni = new Set([...a, ...bb]).size;
        const inter = [...a].filter((x) => bb.has(x)).length;
        if (a.size && bb.size && uni && inter / uni > 0.6) { grouped[grouped.length - 1].push(...b); continue; }
      }
      grouped.push(b);
    }
    merged = mergeSmall(grouped.filter((p) => p.length));
  }
  return merged;
}

function summarizePhase(i: number, p: Commit[]): Phase {
  const authors = new Map<string, number>();
  for (const c of p) authors.set(c.author, (authors.get(c.author) ?? 0) + 1);
  const byChurn = [...p].sort((a, b) => churn(b) - churn(a));
  const rawSamples = [p[0], ...byChurn.slice(0, 4), p[p.length - 1]].map((c) => c.subject);
  const samples: string[] = [];
  for (const s of rawSamples) if (!samples.includes(s)) samples.push(s);
  const dates = p.map((c) => c.date.slice(0, 10)).sort();   // min/max — author dates are non-monotone under rebase
  return {
    n: i + 1, start: dates[0], end: dates[dates.length - 1], commits: p.length,
    authors: Object.fromEntries([...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)),
    topDirs: topDirs(p.flatMap((c) => c.files)),
    sampleSubjects: samples.slice(0, 6),
    anchorShas: [p[0].sha.slice(0, 10), byChurn[0].sha.slice(0, 10), p[p.length - 1].sha.slice(0, 10)],
  };
}
const churn = (c: Commit): number => c.files.reduce((s, f) => s + f.add + f.del, 0);

async function deadEnds(repo: string, commits: Commit[]): Promise<{ clusters: DeadEnd[]; reverts: Revert[] }> {
  const headFiles = new Set((await git(repo, ['ls-files'])).split('\n').filter(Boolean));
  const added = new Map<string, string>();
  for (const c of commits) for (const f of c.files) {
    if (f.path.includes('=>')) continue;   // rename notation from -M
    if (!added.has(f.path) && f.add > 0 && f.del === 0) added.set(f.path, c.date.slice(0, 10));
  }
  const delOut = await git(repo, ['log', '--no-merges', '--diff-filter=D', '-M',
    `--pretty=format:__C__%H${US}%ad${US}%s`, '--date=iso-strict', '--name-only']);
  const deleted = new Map<string, [string, string, string]>();   // path -> [sha10, date10, subject]
  let meta: [string, string, string] | null = null;
  for (const line of delOut.split('\n')) {
    if (line.startsWith('__C__')) {
      const parts = line.slice(5).split(US);
      if (parts.length < 3) { meta = null; continue; }
      meta = [parts[0].slice(0, 10), parts[1].slice(0, 10), parts.slice(2).join(US)];
    } else if (line.trim() && meta && !headFiles.has(line) && !deleted.has(line) && added.has(line)) {
      // require an OBSERVED add (added-then-deleted, not just deleted) — else a large deletion in a
      // shallow/partial history is mislabeled a "dead end" with firstAdded unknown.
      deleted.set(line, meta);
    }
  }
  const clusters = new Map<string, { path: string; added: string; meta: [string, string, string] }[]>();
  for (const [path, m] of deleted) {
    const parts = path.split('/');
    const d = parts.length > 1 ? parts.slice(0, 2).join('/') : '(root)';
    (clusters.get(d) ?? clusters.set(d, []).get(d)!).push({ path, added: added.get(path) ?? '?', meta: m });
  }
  const out: DeadEnd[] = [];
  for (const [dir, items] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (items.length < 3) continue;
    const months = new Map<string, number>();
    for (const it of items) { const mo = it.meta[1].slice(0, 7); months.set(mo, (months.get(mo) ?? 0) + 1); }
    const firstAddedVals = items.map((it) => it.added).filter((a) => a !== '?').sort();
    out.push({
      dir, filesDeleted: items.length,
      firstAdded: firstAddedVals[0] ?? '?',
      deletedAround: [...months.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2),
      deleteCommits: [...new Set(items.map((it) => it.meta[0]))].slice(0, 3),
      deleteSubjects: [...new Set(items.map((it) => it.meta[2]))].slice(0, 3),
      sampleFiles: items.slice(0, 4).map((it) => it.path),
    });
  }
  const reverts: Revert[] = commits.filter((c) => c.subject.toLowerCase().startsWith('revert'))
    .map((c) => ({ sha: c.sha.slice(0, 10), date: c.date.slice(0, 10), subject: c.subject }));
  return { clusters: out.slice(0, 15), reverts };
}

function ownershipOf(commits: Commit[]): OwnerRec[] {
  const a = new Map<string, OwnerRec>();
  for (const c of commits) {
    const d = c.date.slice(0, 10);
    const rec = a.get(c.author);
    if (rec) { rec.commits++; if (d > rec.last) rec.last = d; if (d < rec.first) rec.first = d; }
    else a.set(c.author, { author: c.author, commits: 1, first: d, last: d });
  }
  return [...a.values()].sort((x, y) => y.commits - x.commits);
}

export async function buildSpine(repoDir: string): Promise<RepoSpine | null> {
  let commits: Commit[];
  try { commits = await parseLog(repoDir); } catch { return null; }
  if (commits.length < MIN_REPO_COMMITS) return null;
  const phases = phasesOf(commits).map((p, i) => summarizePhase(i, p));
  const { clusters, reverts } = await deadEnds(repoDir, commits);
  const repo = repoNameOf(repoDir);
  return {
    repo, totalCommits: commits.length,
    span: [commits[0].date.slice(0, 10), commits[commits.length - 1].date.slice(0, 10)],
    phases, deadEnds: clusters, reverts, ownership: ownershipOf(commits),
  };
}
