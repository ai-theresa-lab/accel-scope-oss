import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeOrg, orgCoverageGaps } from './org.ts';
import { renderFindingsHtml } from './reportHtml.ts';

// A deterministic scan of an uploaded .git-less folder counted "Org bus factor
// unavailable — no usable commit history" as a confirmed finding, and the headline read "0 of 1 confirmed findings are
// critical or high, concentrated in knowledge risk". Missing data is an open question, never a finding.
test('a folder with no git history yields no bus-factor finding, only an open question', async () => {
  const root = mkdtempSync(join(tmpdir(), 'new3-'));
  try {
    mkdirSync(join(root, 'mini'));
    writeFileSync(join(root, 'mini', 'a.py'), 'print(1)\n');
    writeFileSync(join(root, 'mini', 'README.md'), '# mini\n');
    const org = await analyzeOrg(join(root, 'mini'));
    assert.equal(org.findings.some((f) => f.id === 'org-bus-factor'), false);
    assert.equal(org.findings.some((f) => /bus factor unavailable/i.test(f.title)), false);
    assert.deepEqual(org.coverageGaps.map((g) => [g.id, g.status, g.source]), [['org-bus-factor', 'blocked', 'org-aggregate']]);
    // The internal report: no "confirmed findings … knowledge risk" headline, and the open question is listed.
    const html = renderFindingsHtml({ miner: 'org-aggregate', target: 'organization · mini', metrics: org.metrics, findings: org.findings, coverageGaps: org.coverageGaps }, '2026-09-25', true);
    assert.doesNotMatch(html, /confirmed findings are critical or high/);
    assert.doesNotMatch(html, /ran clean/, 'an assessment that could not run is not a clean run');
    assert.match(html, /1 question could not be settled/);
    assert.match(html, /Ownership concentration \(org bus factor\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orgCoverageGaps is empty when there is history, and names the repo count when there is none', () => {
  assert.deepEqual(orgCoverageGaps([{ name: 'a' }], 3), []);
  assert.match(orgCoverageGaps([{ name: 'a' }], 0)[0].whyUnsettled, /^The scanned repo has no usable multi-commit history/);
  assert.match(orgCoverageGaps([{ name: 'a' }, { name: 'b' }], 0)[0].whyUnsettled, /^None of the 2 scanned repos has usable/);
  assert.match(orgCoverageGaps([], 0)[0].whyUnsettled, /no git history \(for example an uploaded folder\)/);
});
