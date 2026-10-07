// Org-level aggregator: treat all repos under a root as ONE system.
// Cross-repo identity / bus factor, per-repo vitals, CI/test/secret gaps, and
// duplication clusters (forked services). History mining runs only where it's
// meaningful (>1 commit); code-structure runs everywhere (incl. snapshots).

import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { commitCount, git, logAuthors, remoteUrl } from './git.ts';
import { resolveIdentities, type Identity } from './identity.ts';
import { mineGitHistory } from './miners/gitHistory.ts';
import { mineCodeStructure, type StructureSummary } from './miners/codeStructure.ts';
import { assertFinding, type CoverageGap, type Evidence, type Finding } from './schema.ts';
import { plural } from './plural.ts';

export interface RepoSummary {
  name: string;
  commits: number;
  hasHistory: boolean;
  remote: string;
  firstCommit: string;
  lastCommit: string;
  structure: StructureSummary;
  history: { busFactor: number; topOwner: string; topOwnerShare: number; hotspots: { path: string; commits: number }[] } | null;
  // True when a fork-date cutoff was applied to this repo's history (see analyzeOrg's
  // forkCutoffs) — so every history-derived metric counts only post-fork commits and the
  // report can note "counted from fork date". Optional/backward-compatible.
  forkScoped?: boolean;
}

// Generic, company-agnostic stop-words for repo-name token clustering. Deliberately
// contains NO company/product proper noun — an org-specific stop-word baked into the
// pipeline is reward hacking (it tunes the detector to one codebase). See eval/anti-cheat.ts.
const REPO_NAME_STOPWORDS = ['the', 'app', 'api', 'svc', 'service', 'core', 'lib'];

function repoTokens(name: string): string[] {
  return name.toLowerCase().split(/[-_]+/).filter((t) => t.length >= 3 && !REPO_NAME_STOPWORDS.includes(t));
}

// `forkCutoffs` (optional): maps a repo BASENAME (its directory name, i.e.
// `fullName.split('/').pop()`) → ISO fork date. For a repo with a cutoff, every
// history-derived metric (people aggregation, org bus factor, per-repo owner/hotspots,
// first/last commit, hasHistory) reflects only commits AFTER the fork date — because a
// forked repo carries its full upstream history and would otherwise credit every upstream
// author to the org. Non-fork repos (no cutoff) are unchanged. A missing/empty map = today's
// behavior (all history counted). Generic mechanism: any fork with a known fork date works.
export async function analyzeOrg(root: string, only?: string[], forkCutoffs?: Record<string, string>) {
  // When the caller scopes to specific repos (e.g. cli --repos a,b), analyze ONLY
  // those — so the org map, aggregate findings, and agent context never leak
  // sibling-repo metadata that is out of scope for the scan.
  const onlySet = only && only.length ? new Set(only) : null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name))
    .filter((d) => existsSync(join(d, '.git')))
    .filter((d) => !onlySet || onlySet.has(basename(d)))
    .sort();

  const repos: RepoSummary[] = [];
  const orgAuthorRecords: { authorName: string; authorEmail: string }[] = [];
  const perRepoAuthors: { repo: string; keys: string[] }[] = [];

  for (const dir of dirs) {
    const name = dir.split('/').pop() ?? dir;
    // Fork-date cutoff for this repo, if the caller supplied one (keyed by basename).
    // Own-property lookup: a repo dir named like an Object.prototype key (`constructor`,
    // `toString`, …) would otherwise read an INHERITED function as the cutoff — a truthy bogus `--since`.
    const sinceIso = forkCutoffs && Object.hasOwn(forkCutoffs, name) ? forkCutoffs[name] : undefined;
    const commits = await commitCount(dir, sinceIso);
    const hasHistory = commits > 1;
    const structure = await mineCodeStructure(dir);
    const remote = await remoteUrl(dir);
    let firstCommit = '';
    let lastCommit = '';
    let history: RepoSummary['history'] = null;

    if (hasHistory) {
      const authors = await logAuthors(dir, sinceIso);
      const keys = authors.map((a) => `${a.name} <${a.email}>`);
      perRepoAuthors.push({ repo: name, keys });
      for (const a of authors) orgAuthorRecords.push({ authorName: a.name, authorEmail: a.email });
      try {
        const mr = await mineGitHistory(dir, { sinceIso });
        const sm = mr.metrics.summary as Record<string, unknown>;
        firstCommit = String(sm.firstCommit ?? '');
        lastCommit = String(sm.lastCommit ?? '');
        const contribs = (mr.metrics.contributors as Array<Record<string, unknown>>).filter((c) => !c.isBot);
        const hotspots = (mr.metrics.hotspots as Array<Record<string, unknown>>)
          .filter((h) => !h.isTest)
          .slice(0, 3)
          .map((h) => ({ path: String(h.path), commits: Number(h.commits) }));
        history = {
          busFactor: Number(sm.busFactor ?? 0),
          topOwner: String(contribs[0]?.id ?? ''),
          topOwnerShare: Number(contribs[0]?.share ?? 0),
          hotspots,
        };
      } catch {
        /* leave history null */
      }
    } else {
      try {
        // Honor the fork cutoff here too: without --since, a forkScoped repo with zero post-fork
        // commits would still surface an INHERITED upstream commit date, contradicting its (post-fork) count.
        // With the cutoff and no post-fork commit, `git log -1 --since` returns empty → dates stay ''.
        const args = ['log', '-1', '--format=%ad', '--date=short'];
        if (sinceIso) args.push(`--since=${sinceIso}`);
        const d = (await git(dir, args)).trim();
        firstCommit = d;
        lastCommit = d;
      } catch {
        /* ignore */
      }
    }
    repos.push({ name, commits, hasHistory, remote, firstCommit, lastCommit, structure, history, forkScoped: Boolean(sinceIso) });
  }

  // Cross-repo identity (people, org bus factor).
  const pseudo = orgAuthorRecords.map((a) => ({ hash: '', authorName: a.authorName, authorEmail: a.authorEmail, date: '', files: [] }));
  const orgIdent = resolveIdentities(pseudo);
  const humans = orgIdent.identities.filter((i) => !i.isBot);
  const totalHuman = humans.reduce((s, i) => s + i.commits, 0);
  let cum = 0;
  let busFactor = 0;
  for (const i of humans) {
    cum += i.commits;
    busFactor++;
    if (totalHuman && cum / totalHuman > 0.5) break;
  }

  const personRepos = new Map<string, Set<string>>();
  for (const pr of perRepoAuthors) {
    for (const k of pr.keys) {
      const id = orgIdent.keyToId.get(k);
      if (!id) continue;
      if (!personRepos.has(id)) personRepos.set(id, new Set());
      personRepos.get(id)!.add(pr.repo);
    }
  }

  const findings = buildOrgFindings(repos, humans, totalHuman, busFactor, personRepos);

  // Aggregate languages across the org.
  const langMap = new Map<string, number>();
  for (const r of repos) for (const l of r.structure.languages) langMap.set(l.ext, (langMap.get(l.ext) ?? 0) + l.count);
  const languages = [...langMap.entries()].map(([e, c]) => ({ ext: e, count: c })).sort((a, b) => b.count - a.count).slice(0, 10);

  const metrics = {
    summary: {
      repos: repos.length,
      reposWithHistory: repos.filter((r) => r.hasHistory).length,
      snapshotRepos: repos.filter((r) => !r.hasHistory).length,
      people: humans.length,
      orgBusFactor: busFactor,
      totalCommits: totalHuman,
      reposWithoutCI: repos.filter((r) => !r.structure.hasCI).length,
      reposWithSecrets: repos.filter((r) => r.structure.committedSecretFiles.length > 0).length,
    },
    languages,
    repos: repos.map((r) => ({
      name: r.name,
      commits: r.commits,
      hasHistory: r.hasHistory,
      remote: r.remote,
      lastCommit: r.lastCommit,
      trackedFiles: r.structure.trackedFiles,
      codeFiles: r.structure.codeFiles,
      testRatio: Number(r.structure.testRatio.toFixed(3)),
      primaryLanguage: r.structure.primaryLanguage,
      hasCI: r.structure.hasCI,
      hasTests: r.structure.testFiles > 0,
      secretFiles: r.structure.committedSecretFiles,
      busFactor: r.history?.busFactor ?? null,
      topOwner: r.history?.topOwner ?? null,
      topOwnerShare: r.history ? Number(r.history.topOwnerShare.toFixed(3)) : null,
      hotspots: r.history?.hotspots ?? [],
      forkScoped: Boolean(r.forkScoped),
    })),
    people: humans.map((i) => ({ id: i.id, commits: i.commits, repos: [...(personRepos.get(i.id) ?? [])] })),
  };

  return { miner: 'org-aggregate', target: root, metrics, findings, coverageGaps: orgCoverageGaps(repos, humans.length) };
}

// What the org aggregate could NOT assess is a coverage gap, not a finding. A folder with no git
// history (an uploaded snapshot, or single-commit repos) used to emit "Org bus factor unavailable" as an info FINDING, so
// the report counted it among its confirmed findings and the synthesis headline named "knowledge risk" as the concern.
export function orgCoverageGaps(repos: Pick<RepoSummary, 'name'>[], humanCount: number): CoverageGap[] {
  if (humanCount > 0) return [];
  return [{
    id: 'org-bus-factor',
    concern: 'Ownership concentration (org bus factor)',
    whyUnsettled: repos.length === 1
      ? 'The scanned repo has no usable multi-commit history, so who carries the code cannot be measured.'
      : repos.length
      ? `None of the ${repos.length} scanned repos has usable multi-commit history, so who carries the code cannot be measured.`
      : 'The scanned code has no git history (for example an uploaded folder), so who carries the code cannot be measured.',
    nextDecisiveTest: 'Scan the live repositories with their full git history (not a snapshot or an uploaded folder).',
    source: 'org-aggregate',
    status: 'blocked',
  }];
}

function buildOrgFindings(
  repos: RepoSummary[],
  humans: Identity[],
  totalHuman: number,
  busFactor: number,
  personRepos: Map<string, Set<string>>,
): Finding[] {
  const findings: Finding[] = [];

  // 0. committed secrets (critical) — deterministic corroboration.
  const secretRepos = repos.filter((r) => r.structure.committedSecretFiles.length > 0);
  if (secretRepos.length) {
    const all = secretRepos.flatMap((r) => r.structure.committedSecretFiles.map((f) => `${r.name}/${f}`));
    findings.push(
      assertFinding({
        id: 'org-committed-secrets',
        dimension: 'security_supply',
        title: `Secret-bearing files committed in ${secretRepos.length}/${plural(repos.length, 'repo')}`,
        claim: `${all.length} tracked file(s) match secret patterns (.env, *.pem, config.prod.*, service-account *.json) across: ${secretRepos.map((r) => r.name).join(', ')}.`,
        evidence: all.slice(0, 15).map((f) => ({ kind: 'file' as const, ref: f, detail: 'tracked secret-bearing file' })),
        businessImpact: 'Anyone with repo read access can obtain live credentials → full data-plane / cloud-account compromise. Highest severity, time-sensitive.',
        recommendation: 'Rotate ALL exposed credentials now; purge from history (git filter-repo); move to a secrets manager; add gitleaks pre-commit + CI secret scanning.',
        severity: 'critical',
        confidence: 'high',
        effort: 'moderate',
        source: 'org-aggregate',
      }),
    );
  }

  // 1. duplication clusters (forked services).
  const tokenMap = new Map<string, Set<string>>();
  for (const r of repos) for (const t of repoTokens(r.name)) {
    if (!tokenMap.has(t)) tokenMap.set(t, new Set());
    tokenMap.get(t)!.add(r.name);
  }
  const clusters = [...tokenMap.entries()]
    .filter(([, rs]) => rs.size >= 2)
    .map(([t, rs]) => ({ t, rs: [...rs] }))
    .sort((a, b) => b.rs.length - a.rs.length);
  if (clusters.length) {
    findings.push(
      assertFinding({
        id: 'org-fragmentation',
        dimension: 'architecture',
        title: `${clusters.length} repo cluster(s) suggest parallel / duplicated services`,
        claim: `Repos share a domain token — a signal of forked generations or split responsibility that must share contracts: ${clusters.slice(0, 5).map((c) => `${c.t} → {${c.rs.join(', ')}}`).join('; ')}.`,
        evidence: clusters.slice(0, 6).map((c) => ({ kind: 'computation' as const, ref: `cluster:${c.t}`, detail: c.rs.join(' , ') })),
        businessImpact: 'Parallel-maintained services double change cost and invite drift across boundaries; duplicated "generations" of a service alongside the original are a classic migration-debt smell.',
        recommendation: 'Confirm active vs deprecated; define one source of truth per shared domain; codify or document the cross-repo contracts.',
        severity: 'medium',
        confidence: 'medium',
        effort: 'project',
        source: 'org-aggregate',
      }),
    );
  }

  // 2. org bus factor.
  if (humans.length) {
    findings.push(
      assertFinding({
        id: 'org-bus-factor',
        dimension: 'knowledge_risk',
        title: `Org bus factor = ${busFactor}`,
        claim: `Across repos with real history, ${busFactor} ${busFactor === 1 ? 'person accounts' : 'people account'} for >50% of all ${totalHuman} commits.`,
        evidence: humans.slice(0, 6).map((i) => ({
          kind: 'computation' as const,
          ref: i.id,
          detail: `${plural(i.commits, 'commit')} across ${plural(personRepos.get(i.id)?.size ?? 0, 'repo')} (${totalHuman ? ((i.commits / totalHuman) * 100).toFixed(0) : 0}%)`,
        })),
        businessImpact: 'A few people carry most of the system, so reviews bottleneck and departures are high-risk.',
        recommendation: 'Spread ownership of the busiest repos; require cross-repo review; document the rec & data contracts held in a few heads.',
        severity: busFactor <= 2 ? 'high' : busFactor <= 3 ? 'medium' : 'low',
        confidence: 'high',
        effort: 'moderate',
        source: 'org-aggregate',
      }),
    );
  }
  // No usable history ⇒ no bus-factor finding; analyzeOrg reports it as a coverage gap instead (orgCoverageGaps).

  // 3. CI gaps.
  const noCI = repos.filter((r) => !r.structure.hasCI).map((r) => r.name);
  if (noCI.length) {
    findings.push(
      assertFinding({
        id: 'org-ci-gaps',
        dimension: 'delivery_flow',
        title: `${noCI.length}/${plural(repos.length, 'repo')} ${repos.length === 1 ? 'has' : 'have'} no detectable CI`,
        claim: `No CI config (.github/workflows, cloudbuild, gitlab-ci) found in: ${noCI.join(', ')}.`,
        evidence: noCI.slice(0, 12).map((n) => ({ kind: 'computation' as const, ref: n, detail: 'no CI workflow detected' })),
        businessImpact: 'Without automated checks, regressions and broken deploys depend on manual diligence — a direct drag on safe velocity.',
        recommendation: 'Add a baseline CI (build + test + lint) to each active repo and gate merges on it.',
        severity: noCI.length > repos.length / 2 ? 'high' : 'medium',
        confidence: 'medium',
        effort: 'moderate',
        source: 'org-aggregate',
      }),
    );
  }

  // 4. test gaps on substantial repos.
  const noTests = repos.filter((r) => r.structure.codeFiles >= 10 && r.structure.testRatio < 0.02).map((r) => r.name);
  if (noTests.length) {
    findings.push(
      assertFinding({
        id: 'org-test-gaps',
        dimension: 'code_health',
        title: `${plural(noTests.length, 'repo')} ${noTests.length === 1 ? 'has' : 'have'} ~no automated tests`,
        claim: `Test-file ratio < 2% in substantial repos: ${noTests.join(', ')}.`,
        evidence: noTests.slice(0, 12).map((n) => {
          const r = repos.find((x) => x.name === n)!;
          return { kind: 'computation' as const, ref: n, detail: `${r.structure.testFiles}/${r.structure.codeFiles} test/code files` };
        }),
        businessImpact: 'Thin tests on core services make every change risky and slow, and block confident refactoring of the rec/data pipeline.',
        recommendation: 'Add characterization tests on the highest-traffic services first; add a coverage gate in CI.',
        severity: 'high',
        confidence: 'high',
        effort: 'project',
        source: 'org-aggregate',
      }),
    );
  }

  // 5. snapshot repos (no usable local history).
  const snaps = repos.filter((r) => !r.hasHistory && r.structure.trackedFiles > 20).map((r) => r.name);
  if (snaps.length) {
    findings.push(
      assertFinding({
        id: 'org-snapshot-repos',
        dimension: 'knowledge_risk',
        title: `${plural(snaps.length, 'repo')} ${snaps.length === 1 ? 'is a local snapshot' : 'are local snapshots'} (no usable history)`,
        claim: `Single-commit local clones (code is real, but churn/ownership unknowable locally): ${snaps.join(', ')}.`,
        evidence: snaps.slice(0, 12).map((n) => {
          const r = repos.find((x) => x.name === n)!;
          return { kind: 'computation' as const, ref: n, detail: `${plural(r.structure.trackedFiles, 'file')}, ${plural(r.commits, 'commit')}` };
        }),
        businessImpact: 'History-based risk (hotspots, bus factor) is invisible for these without the live upstream repos; diagnosis here relies on code structure only.',
        recommendation: 'For a full audit, point the miner at the live upstream repos with full history (not local single-commit snapshots).',
        severity: 'info',
        confidence: 'high',
        effort: 'quick_win',
        source: 'org-aggregate',
      }),
    );
  }

  return findings;
}
