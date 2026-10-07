// accel-scope org CLI: aggregate diagnosis across all git repos under a root.
//
// Usage:  npm run analyze:org -- <root-dir> [--out <dir>]
//                                [--fork-cutoff <name=ISO,name=ISO,...>]
//
// --fork-cutoff: fork-aware contributor counting for forked repos. Comma-separated
//   `basename=ISO` pairs (basename = the repo's directory name); for each, only commits
//   AFTER that fork date are counted (a fork carries its full upstream history, which
//   would otherwise credit every upstream author to the org). Lets the user pass fork
//   dates the CLI can't get from the GitHub API. Non-listed repos count all history.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeOrg } from './org.ts';
import { renderOrgReport } from './reportOrg.ts';

// Parse "name=ISO,name=ISO,…" into a basename→ISO-fork-date map. Split each pair on the
// FIRST '=' only (an ISO timestamp contains no '='); blank/malformed pairs are skipped.
export function parseForkCutoffs(spec: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!spec) return map;
  for (const raw of spec.split(',')) {
    const pair = raw.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const iso = pair.slice(eq + 1).trim();
    if (name && iso) map[name] = iso;
  }
  return map;
}

function parseArgs(argv: string[]): { root: string; out: string | null; forkCutoff: string | null } {
  const positional: string[] = [];
  let out: string | null = null;
  let forkCutoff: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--fork-cutoff') forkCutoff = argv[++i];
    else positional.push(argv[i]);
  }
  return { root: positional[0] ?? '.', out, forkCutoff };
}

async function main(): Promise<void> {
  const { root: rawRoot, out: outFlag, forkCutoff } = parseArgs(process.argv.slice(2));
  const root = resolve(rawRoot);
  const stamp = new Date().toISOString();
  const forkCutoffs = parseForkCutoffs(forkCutoff);

  console.log(`▶ accel-scope: org-wide analysis of ${root} …`);
  if (Object.keys(forkCutoffs).length) console.log(`  fork cutoffs: ${Object.entries(forkCutoffs).map(([k, v]) => `${k}@${v}`).join(', ')}`);
  const result = await analyzeOrg(root, undefined, forkCutoffs);

  const outDir = resolve(outFlag ?? join(process.cwd(), 'out', `${basename(root)}-org`));
  mkdirSync(outDir, { recursive: true });
  const evidencePath = join(outDir, 'org-evidence.json');
  const reportPath = join(outDir, 'org-report.md');
  writeFileSync(evidencePath, JSON.stringify({ generated: stamp, ...result }, null, 2));
  writeFileSync(reportPath, renderOrgReport(result, stamp));

  const s = result.metrics.summary as any;
  const bySev: Record<string, number> = {};
  for (const f of result.findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;

  console.log('');
  console.log(`  repos=${s.repos} (history=${s.reposWithHistory})  people=${s.people}  orgBusFactor=${s.orgBusFactor}  noCI=${s.reposWithoutCI}  secrets=${s.reposWithSecrets}`);
  console.log(`  findings: ${Object.entries(bySev).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  for (const f of [...result.findings].sort((a, b) => a.severity.localeCompare(b.severity))) console.log(`  • [${f.severity}] ${f.title}`);
  console.log('');
  console.log(`✓ evidence → ${evidencePath}`);
  console.log(`✓ report   → ${reportPath}`);
}

// Only run the CLI when this file is the entrypoint — so importing parseForkCutoffs from a
// test does NOT trigger a real org analysis (side-effect-free import).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
