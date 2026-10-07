// Thin, read-only git access layer. Shells out to `git` via execFile (no shell,
// no injection surface). All functions are read-only; this tool never mutates a
// target repo.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 512; // 512MB — numstat over large histories

export const US = ''; // unit separator (between fields)
export const RS = ''; // record separator (between commits)

export async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await pexec('git', ['-C', repo, ...args], { maxBuffer: MAX_BUFFER });
  return stdout;
}

export async function isGitRepo(repo: string): Promise<boolean> {
  try {
    const out = await git(repo, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

export interface CommitFile {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface Commit {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string; // YYYY-MM-DD
  files: CommitFile[];
}

// One pass over history with per-file line stats. --no-merges so authorship and
// churn reflect real authored work, not merge bubbles.
// `sinceIso` (optional): when set and non-empty, only commits on/after that date are
// read (`--since`). Used for fork-aware counting — a forked repo carries its full
// upstream history, so counting only commits after the fork date attributes the org's
// own work, not the upstream authors'.
export async function logWithNumstat(repo: string, sinceIso?: string): Promise<Commit[]> {
  const fmt = `${RS}%H${US}%an${US}%ae${US}%ad`;
  const args = ['log', '--no-merges', '--numstat', '--date=short', `--format=${fmt}`];
  if (sinceIso) args.push(`--since=${sinceIso}`);
  const out = await git(repo, args);
  const commits: Commit[] = [];
  const records = out.split(RS);
  for (const rec of records) {
    if (!rec.trim()) continue;
    const lines = rec.split('\n');
    const [hash, authorName, authorEmail, date] = lines[0].split(US);
    if (!hash) continue;
    const files: CommitFile[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const tab = line.split('\t');
      if (tab.length < 3) continue;
      const a = tab[0];
      const d = tab[1];
      const path = tab.slice(2).join('\t');
      const binary = a === '-' || d === '-';
      files.push({
        path,
        added: binary ? 0 : Number(a) || 0,
        deleted: binary ? 0 : Number(d) || 0,
        binary,
      });
    }
    commits.push({ hash, authorName, authorEmail, date, files });
  }
  return commits;
}

export async function listTrackedFiles(repo: string): Promise<string[]> {
  const out = await git(repo, ['ls-files']);
  return out.split('\n').filter(Boolean);
}

// Lightweight author-only log (no numstat) for cross-repo identity aggregation.
// `sinceIso` (optional): fork-date cutoff — see logWithNumstat.
export async function logAuthors(repo: string, sinceIso?: string): Promise<{ name: string; email: string }[]> {
  const args = ['log', '--no-merges', `--format=%an${US}%ae`];
  if (sinceIso) args.push(`--since=${sinceIso}`);
  const out = await git(repo, args);
  const res: { name: string; email: string }[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [name, email] = line.split(US);
    res.push({ name: name ?? '', email: email ?? '' });
  }
  return res;
}

// `sinceIso` (optional): fork-date cutoff — so a fork's commit count (and thus
// `hasHistory`) reflects POST-fork commits, not inherited upstream history.
export async function commitCount(repo: string, sinceIso?: string): Promise<number> {
  try {
    const args = ['rev-list', '--count', 'HEAD'];
    if (sinceIso) args.push(`--since=${sinceIso}`);
    return Number((await git(repo, args)).trim()) || 0;
  } catch {
    return 0;
  }
}

export async function remoteUrl(repo: string): Promise<string> {
  try {
    return (await git(repo, ['config', '--get', 'remote.origin.url'])).trim();
  } catch {
    return '';
  }
}
