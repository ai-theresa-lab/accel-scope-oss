// Code-structure miner. Works on ANY git repo including single-commit snapshots
// (where history mining is meaningless but the code is real). Pure `git ls-files`
// — no file reads, so it's cheap across many repos.

import { listTrackedFiles } from '../git.ts';
import { CODE_EXTS, ext, isNoise, isSecretFile, isTest } from '../classify.ts';

export interface StructureSummary {
  trackedFiles: number;
  codeFiles: number;
  testFiles: number;
  testRatio: number;
  languages: { ext: string; count: number }[];
  primaryLanguage: string;
  hasReadme: boolean;
  hasCI: boolean;
  hasDockerfile: boolean;
  hasInfra: boolean;
  hasManifest: boolean;
  committedSecretFiles: string[];
  topDirs: { dir: string; files: number }[];
}

export async function mineCodeStructure(repo: string): Promise<StructureSummary> {
  const tracked = await listTrackedFiles(repo);
  const lower = tracked.map((p) => p.toLowerCase());
  const has = (re: RegExp): boolean => lower.some((p) => re.test(p));

  const codeFiles = tracked.filter((p) => !isNoise(p) && CODE_EXTS.has(ext(p)));
  const testFiles = codeFiles.filter(isTest);

  const langMap = new Map<string, number>();
  const dirMap = new Map<string, number>();
  for (const p of tracked) {
    if (isNoise(p)) continue;
    langMap.set(ext(p), (langMap.get(ext(p)) ?? 0) + 1);
    const seg = p.split('/');
    const top = seg.length > 1 ? seg[0] : '(root)';
    dirMap.set(top, (dirMap.get(top) ?? 0) + 1);
  }

  const languages = [...langMap.entries()]
    .map(([e, count]) => ({ ext: e, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const codeLang = languages.find((l) => CODE_EXTS.has(l.ext));

  return {
    trackedFiles: tracked.length,
    codeFiles: codeFiles.length,
    testFiles: testFiles.length,
    testRatio: codeFiles.length ? testFiles.length / codeFiles.length : 0,
    languages,
    primaryLanguage: codeLang?.ext ?? '(none)',
    hasReadme: has(/(^|\/)readme(\.md|\.rst)?$/),
    hasCI: has(/\.github\/workflows\//) || has(/(^|\/)\.gitlab-ci\.ya?ml$/) || has(/(^|\/)cloudbuild[^/]*\.ya?ml$/),
    hasDockerfile: has(/(^|\/)dockerfile/) || has(/(^|\/)docker-compose[^/]*\.ya?ml$/),
    hasInfra: has(/\.tf$/) || has(/(^|\/)(k8s|kustomize|helm|charts)\//) || has(/(^|\/)skaffold\.ya?ml$/),
    hasManifest:
      has(/(^|\/)package\.json$/) || has(/(^|\/)pyproject\.toml$/) || has(/(^|\/)go\.mod$/) ||
      has(/(^|\/)requirements[^/]*\.txt$/) || has(/(^|\/)cargo\.toml$/) || has(/(^|\/)pom\.xml$/) ||
      has(/(^|\/)build\.gradle/) || has(/(^|\/)setup\.py$/),
    committedSecretFiles: tracked.filter((p) => !isNoise(p) && isSecretFile(p)),
    topDirs: [...dirMap.entries()].map(([dir, files]) => ({ dir, files })).sort((a, b) => b.files - a.files).slice(0, 6),
  };
}
