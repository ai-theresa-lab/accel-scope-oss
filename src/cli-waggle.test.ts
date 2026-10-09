import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError, currentStage, findingsSummary, openQuestions, parseArgs, remediationMarkdown, reportData, repoFullName, sseLogLines, untrusted } from './cli-waggle.ts';

test('parseArgs: command, positionals, repeated flags, = form and boolean flags', () => {
  const a = parseArgs(['scan', '--repo', 'a/b', '--repo=https://github.com/c/d', '--path', '.', '--full-rescan', 'extra']);
  assert.equal(a.command, 'scan');
  assert.deepEqual(a.flags.repo, ['a/b', 'https://github.com/c/d']);
  assert.deepEqual(a.flags.path, ['.']);
  assert.ok(a.bools.has('full-rescan'));
  assert.deepEqual(a.positional, ['extra']);
  assert.throws(() => parseArgs(['scan', '--brief']), CliError);
});

test('repoFullName accepts GitHub URLs and owner/repo, nothing else', () => {
  assert.equal(repoFullName('https://github.com/ai-theresa-lab/ai-theresa-waggle'), 'ai-theresa-lab/ai-theresa-waggle');
  assert.equal(repoFullName('https://github.com/a/b.git/'), 'a/b');
  assert.equal(repoFullName('a.b/c-d'), 'a.b/c-d');
  for (const bad of ['https://gitlab.com/a/b', 'a/b/c', '../x', 'https://github.com/a']) assert.equal(repoFullName(bad), null, bad);
});

test('untrusted strips control and bidi characters and bounds the length', () => {
  assert.equal(untrusted('a\u0000b‮c\td', 100), 'a b c d');
  assert.equal(untrusted('x'.repeat(50), 10), 'x'.repeat(9) + '…');
  assert.equal(untrusted(undefined, 5), '');
  assert.equal(untrusted('line1\nline2', 100), 'line1\nline2');
});

test('currentStage reads the latest stage marker; sseLogLines keeps only log events', () => {
  assert.equal(currentStage(['stage:comprehend · x', 'other', '▶ stage:report · y']), 'report');
  assert.equal(currentStage(['nothing']), null);
  const sse = 'id: 1\nevent: log\ndata: first\n\nevent: log\ndata: second\n\nevent: done\ndata: {}\n\n';
  assert.deepEqual(sseLogLines(sse), ['first', 'second']);
});

test('reportData + findingsSummary: fixed fields, bounded text, ruled-out rows separated', () => {
  const data = { target: 't', findings: [
    { displayId: 'F-01', severity: 'high', reportLens: 'security', confidence: 'high', claim: 'Title\u0007', detail: 'd'.repeat(2000),
      evidence: [{ ref: 'src/a.ts:1' }, { ref: 'src/b.ts:2' }], remediation: [{ k: 'Recommended fix', v: 'Do X.' }], acceptance: 'ok', verify: 'run y' },
    { displayId: 'F-02', severity: 'info', claim: 'Not a problem', status: 'ruled-out' },
  ] };
  const html = `<html><script>window.__ACCEL_DATA__ = ${JSON.stringify(data)};</script></html>`;
  const d = reportData(html);
  assert.ok(d);
  const s = findingsSummary(d!.findings as never[]);
  assert.equal(s.findings.length, 1);
  assert.equal(s.ruledOut.length, 1);
  const f = s.findings[0] as Record<string, unknown>;
  assert.equal(f.id, 'F-01');
  assert.equal(f.title, 'Title');
  assert.equal(String(f.detail).length, 900);
  assert.deepEqual(f.evidence, ['src/a.ts:1', 'src/b.ts:2']);
  assert.equal(f.fix, 'Do X.');
  assert.equal(reportData('<html>no data</html>'), null);
  const md = remediationMarkdown('t', d!.findings as unknown[]);
  assert.match(md, /^# Remediation — t/);
  assert.match(md, /F-01/);
});

test('openQuestions lists the coverage gaps of every area, bounded', () => {
  const data = { execution: { groups: [
    { name: 'Software architecture', gaps: [{ concern: 'get() never deletes expired entries', why: 'needs an eval' }] },
    { name: 'Security', gaps: [] },
  ] } };
  assert.deepEqual(openQuestions(data), [{ area: 'Software architecture', concern: 'get() never deletes expired entries', why: 'needs an eval' }]);
  assert.deepEqual(openQuestions(null), []);
});
