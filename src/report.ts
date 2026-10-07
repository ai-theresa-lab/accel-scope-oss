// Renders a MinerResult into a human-readable markdown report (the v0 deliverable
// shape). Reads only from serializable metrics + findings so the report and the
// evidence.json never diverge.

import type { Finding, MinerResult } from './schema.ts';

const SEV_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const DIM_LABEL: Record<string, string> = {
  delivery_flow: 'Delivery flow',
  code_health: 'Code health',
  architecture: 'Architecture',
  knowledge_risk: 'Knowledge risk',
  product_metrics: 'Product metrics',
  security_supply: 'Security & supply chain',
};

const DIM_ORDER = ['knowledge_risk', 'code_health', 'architecture', 'delivery_flow', 'security_supply', 'product_metrics'];

function renderFinding(f: Finding): string {
  const lines: string[] = [];
  lines.push(`#### ${SEV_EMOJI[f.severity] ?? ''} ${f.title}`);
  lines.push('');
  lines.push(`*Severity:* \`${f.severity}\` · *Confidence:* \`${f.confidence}\` · *Effort:* \`${f.effort}\` · *Source:* \`${f.source}\``);
  lines.push('');
  lines.push(f.claim);
  lines.push('');
  lines.push('**Evidence**');
  for (const e of f.evidence) {
    lines.push(`- \`${e.ref}\`${e.detail ? ` — ${e.detail}` : ''}`);
  }
  lines.push('');
  lines.push(`**Business impact.** ${f.businessImpact}`);
  lines.push('');
  lines.push(`**Recommendation.** ${f.recommendation}`);
  lines.push('');
  return lines.join('\n');
}

export function renderReport(result: MinerResult, stamp: string): string {
  const m = result.metrics as any;
  const s = m.summary;
  const findings = [...result.findings].sort(
    (a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.dimension.localeCompare(b.dimension),
  );

  const sevCounts: Record<string, number> = {};
  for (const f of findings) sevCounts[f.severity] = (sevCounts[f.severity] ?? 0) + 1;

  const out: string[] = [];
  out.push(`# accel-scope · diagnostic report`);
  out.push('');
  out.push(`**Target:** \`${result.target}\`  `);
  out.push(`**Generated:** ${stamp}  `);
  out.push(`**Miner:** ${result.miner} (deterministic, zero-auth, 100% history coverage)`);
  out.push('');
  out.push('> v0 evidence-layer report. Every finding below is grounded in version-control facts and cites resolvable evidence. LLM dimension-analysis and adversarial verification are layered on top in later phases.');
  out.push('');

  // scorecard
  out.push('## Scorecard');
  out.push('');
  out.push('| Severity | Count |');
  out.push('| --- | --- |');
  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    if (sevCounts[sev]) out.push(`| ${SEV_EMOJI[sev]} ${sev} | ${sevCounts[sev]} |`);
  }
  out.push('');

  // vitals
  out.push('## Repository vitals');
  out.push('');
  out.push('| Metric | Value |');
  out.push('| --- | --- |');
  out.push(`| Commits (non-merge) | ${s.commits} |`);
  out.push(`| History span | ${s.firstCommit} → ${s.lastCommit} (~${s.spanWeeks} weeks) |`);
  out.push(`| Velocity | ~${s.commitsPerWeek} commits/week, avg ${s.avgFilesPerCommit} files/commit |`);
  out.push(`| Large-batch commits (>30 files) | ${s.bigCommits} |`);
  out.push(`| People (after identity resolution) | ${s.people} (from ${s.rawIdentities} raw identities) |`);
  out.push(`| Bus factor | ${s.busFactor} (top contributor ${(s.topContributorShare * 100).toFixed(0)}%) |`);
  out.push(`| Tracked code files | ${s.codeFiles} |`);
  out.push(`| Test files | ${s.testFiles} (${(s.testRatio * 100).toFixed(1)}%) |`);
  out.push(`| Top languages | ${m.languages.slice(0, 6).map((l: any) => `${l.ext} (${l.count})`).join(', ')} |`);
  out.push('');

  // findings
  out.push('## Findings');
  out.push('');
  for (const dim of DIM_ORDER) {
    const group = findings.filter((f) => f.dimension === dim);
    if (!group.length) continue;
    out.push(`### ${DIM_LABEL[dim]}`);
    out.push('');
    for (const f of group) out.push(renderFinding(f));
  }

  // appendix
  out.push('## Appendix — evidence tables');
  out.push('');
  out.push('### Top hotspots (by change frequency)');
  out.push('');
  out.push('| File | Commits | Churn | Top owner | Owner share |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const h of m.hotspots.slice(0, 10)) {
    out.push(`| \`${h.path}\` | ${h.commits} | ${h.churn} | ${h.topAuthor} | ${(h.topShare * 100).toFixed(0)}% |`);
  }
  out.push('');

  if (m.coupling.length) {
    out.push('### Top change-coupling pairs');
    out.push('');
    out.push('| File A | File B | Co-changes | Degree | Cross-module |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const c of m.coupling.slice(0, 10)) {
      out.push(`| \`${c.a}\` | \`${c.b}\` | ${c.coChanges} | ${(c.degree * 100).toFixed(0)}% | ${c.crossModule ? 'yes' : 'no'} |`);
    }
    out.push('');
  }

  out.push('### Contributors (after identity resolution)');
  out.push('');
  out.push('| Identity | Commits | Share | Aliases | Bot |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const c of m.contributors.slice(0, 12)) {
    out.push(`| ${c.id} | ${c.commits} | ${(c.share * 100).toFixed(0)}% | ${c.aliasCount} | ${c.isBot ? 'yes' : ''} |`);
  }
  out.push('');

  return out.join('\n');
}
