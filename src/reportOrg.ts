// Renders the org-aggregate result into a markdown report (repo inventory +
// org-level findings + people-across-repos). Reads only serializable metrics.

import type { Finding } from './schema.ts';

const SEV_EMOJI: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' };
const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

interface OrgResult {
  miner: string;
  target: string;
  metrics: Record<string, any>;
  findings: Finding[];
}

export function renderOrgReport(result: OrgResult, stamp: string): string {
  const m = result.metrics;
  const s = m.summary;
  const findings = [...result.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const out: string[] = [];
  out.push('# accel-scope · org-wide diagnostic');
  out.push('');
  out.push(`**Org root:** \`${result.target}\`  `);
  out.push(`**Generated:** ${stamp}  `);
  out.push(`**Scope:** ${s.repos} repos (${s.reposWithHistory} with real history, ${s.snapshotRepos} snapshots) · ${s.people} people · org bus factor ${s.orgBusFactor}`);
  out.push('');

  out.push('## Org scorecard');
  out.push('');
  out.push('| Metric | Value |');
  out.push('| --- | --- |');
  out.push(`| Repos | ${s.repos} (${s.reposWithHistory} with history) |`);
  out.push(`| People (cross-repo identity-resolved) | ${s.people} |`);
  out.push(`| Org bus factor | ${s.orgBusFactor} |`);
  out.push(`| Repos without CI | ${s.reposWithoutCI}/${s.repos} |`);
  out.push(`| Repos with committed secrets | ${s.reposWithSecrets}/${s.repos} |`);
  out.push(`| Languages (file counts) | ${m.languages.slice(0, 6).map((l: any) => `${l.ext} (${l.count})`).join(', ')} |`);
  out.push('');

  out.push('## Findings');
  out.push('');
  for (const f of findings) {
    out.push(`### ${SEV_EMOJI[f.severity] ?? ''} ${f.title}`);
    out.push('');
    out.push(`*${f.dimension}* · *severity:* \`${f.severity}\` · *confidence:* \`${f.confidence}\` · *effort:* \`${f.effort}\``);
    out.push('');
    out.push(f.claim);
    out.push('');
    out.push('**Evidence**');
    for (const e of f.evidence) out.push(`- \`${e.ref}\`${e.detail ? ` — ${e.detail}` : ''}`);
    out.push('');
    out.push(`**Business impact.** ${f.businessImpact}`);
    out.push('');
    out.push(`**Recommendation.** ${f.recommendation}`);
    out.push('');
  }

  out.push('## Repo inventory');
  out.push('');
  out.push('| Repo | Commits | Files | Lang | CI | Tests | Secrets | Bus | Top owner |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of m.repos) {
    out.push(
      `| \`${r.name}\` | ${r.commits} | ${r.trackedFiles} | ${r.primaryLanguage} | ${r.hasCI ? '✅' : '❌'} | ${r.hasTests ? `${(r.testRatio * 100).toFixed(0)}%` : '❌'} | ${r.secretFiles.length ? `🔴 ${r.secretFiles.length}` : '—'} | ${r.busFactor ?? '—'} | ${r.topOwner ? r.topOwner.replace(/ <.*/, '') : '—'} |`,
    );
  }
  out.push('');

  out.push('## People across repos');
  out.push('');
  out.push('| Person | Commits | Repos touched |');
  out.push('| --- | --- | --- |');
  for (const p of m.people.slice(0, 12)) {
    out.push(`| ${p.id.replace(/ <.*/, '')} | ${p.commits} | ${p.repos.length} (${p.repos.join(', ')}) |`);
  }
  out.push('');

  return out.join('\n');
}
