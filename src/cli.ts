// accel-scope CLI: run the git-history miner on a target repo and emit both
// the structured evidence layer (evidence.json) and the v0 markdown report.
//
// Usage:  npm run analyze -- <path-to-repo> [--out <dir>]

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isGitRepo } from './git.ts';
import { mineGitHistory } from './miners/gitHistory.ts';
import { renderReport } from './report.ts';
import { renderFindingsHtml } from './reportHtml.ts';

function parseArgs(argv: string[]): { target: string; out: string | null } {
  const positional: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else positional.push(argv[i]);
  }
  return { target: positional[0] ?? '.', out };
}

const { target: rawTarget, out: outFlag } = parseArgs(process.argv.slice(2));
const target = resolve(rawTarget);

if (!(await isGitRepo(target))) {
  console.error(`✗ Not a git repository: ${target}`);
  process.exit(1);
}

const stamp = new Date().toISOString();
console.log(`▶ accel-scope: mining git history of ${target} …`);
const result = await mineGitHistory(target);

const outDir = resolve(outFlag ?? join(process.cwd(), 'out', basename(target)));
mkdirSync(outDir, { recursive: true });

const evidencePath = join(outDir, 'evidence.json');
const reportPath = join(outDir, 'report.md');
const htmlPath = join(outDir, 'report.html');
writeFileSync(evidencePath, JSON.stringify({ generated: stamp, miner: result.miner, target: result.target, metrics: result.metrics, findings: result.findings }, null, 2));
writeFileSync(reportPath, renderReport(result, stamp));
writeFileSync(htmlPath, renderFindingsHtml(result, stamp));

const s = result.metrics.summary as any;
const bySev: Record<string, number> = {};
for (const f of result.findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;

console.log('');
console.log(`  commits=${s.commits}  people=${s.people} (from ${s.rawIdentities} raw ids)  busFactor=${s.busFactor}  tests=${(s.testRatio * 100).toFixed(1)}%`);
console.log(`  findings: ${Object.entries(bySev).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.log('');
for (const f of [...result.findings].sort((a, b) => a.severity.localeCompare(b.severity))) {
  console.log(`  • [${f.severity}] ${f.title}`);
}
console.log('');
console.log(`✓ evidence → ${evidencePath}`);
console.log(`✓ report   → ${reportPath}`);
console.log(`✓ findings → ${htmlPath}`);
