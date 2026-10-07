import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findingKey, findingKeys, normalizedTitleStem, parseCitedRange, evidenceFilePaths } from './findingKey.ts';
import type { Finding } from './schema.ts';

const F = (over: Partial<Finding> = {}): Finding => ({
  id: 'DATA-ENG:H1', dimension: 'architecture', title: 'Nightly job overwrites the revenue table', claim: 'c', evidence: [{ kind: 'file', ref: 'repo/src/job.ts:3-4' }],
  businessImpact: '', recommendation: '', severity: 'high', confidence: 'high', effort: 'moderate', source: 'deep', ...over,
});

function ws(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fkey-'));
  for (const [p, body] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), body); }
  return root;
}

test('findingKey: moving the cited code keeps the key (the text, not the line numbers, is hashed)', () => {
  const a = ws({ 'repo/src/job.ts': 'import x\n\nfunction run() {\n  db.overwrite("revenue")\n}\n' });
  // The same code three lines lower and re-indented — a fresh agent cites the new lines.
  const b = ws({ 'repo/src/job.ts': 'import x\n// added\n// comments\n\n   function run() {\n      db.overwrite("revenue")\n}\n' });
  try {
    const ka = findingKey(F(), { root: a });
    const kb = findingKey(F({ evidence: [{ kind: 'file', ref: 'repo/src/job.ts:5-6' }] }), { root: b });
    assert.equal(ka, kb);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('findingKey: editing the cited code changes the key; the evidence-free looseKey stays', () => {
  const a = ws({ 'repo/src/job.ts': 'a\nb\nfunction run() {\n  db.overwrite("revenue")\n}\n' });
  const b = ws({ 'repo/src/job.ts': 'a\nb\nfunction run() {\n  db.append("revenue")\n}\n' });
  try {
    const ka = findingKeys(F(), { root: a }); const kb = findingKeys(F(), { root: b });
    assert.notEqual(ka.key, kb.key);
    assert.notEqual(ka.evidenceKey, kb.evidenceKey);
    assert.equal(ka.looseKey, kb.looseKey);
    assert.ok(ka.snippetHash && kb.snippetHash);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('findingKey: an unreadable file falls back to the path alone (stable, no snippet)', () => {
  const k1 = findingKeys(F());                                  // no workspace
  const k2 = findingKeys(F({ evidence: [{ kind: 'file', ref: 'repo/src/job.ts:90' }] }));
  assert.equal(k1.snippetHash, undefined);
  assert.equal(k1.path, 'repo/src/job.ts');
  assert.equal(k1.key, k2.key, 'without a readable snippet the line number never enters the key');
});

test('findingKey: a repo-relative cite resolves under its repo dir; a paraphrased title keeps the evidenceKey', () => {
  const a = ws({ 'repo/src/job.ts': 'x\ny\nz\nw\n' });
  try {
    const ka = findingKeys(F({ evidence: [{ kind: 'file', ref: 'src/job.ts:3' }] }), { root: a });
    assert.equal(ka.path, 'repo/src/job.ts');
    const kb = findingKeys(F({ title: 'The nightly job overwrites revenue table (37% rows)', evidence: [{ kind: 'file', ref: 'repo/src/job.ts:3' }] }), { root: a });
    assert.equal(ka.evidenceKey, kb.evidenceKey);
  } finally { rmSync(a, { recursive: true, force: true }); }
});

test('normalizedTitleStem / parseCitedRange', () => {
  assert.equal(normalizedTitleStem('Ruled out: The SSH allow-list is a regex (3 hosts)'), 'ssh allowlist regex hosts');
  assert.equal(normalizedTitleStem('SSH allowlist is a regex'), 'ssh allowlist regex');
  assert.deepEqual(parseCitedRange('a/b.ts#L4-L9'), { path: 'a/b.ts', start: 4, end: 9 });
  assert.deepEqual(parseCitedRange('./a/b.ts:4:2 (fn)'), { path: 'a/b.ts', start: 4, end: 4 });
  assert.deepEqual(parseCitedRange('a/b.ts'), { path: 'a/b.ts' });
  assert.deepEqual(evidenceFilePaths(F({ evidence: [{ kind: 'file', ref: 'x/a.ts:1' }, { kind: 'metric', ref: 'q1' }, { kind: 'file', ref: 'x/a.ts:9' }] })), ['x/a.ts']);
});

test('findingKey: a bundle / invariant difference separates otherwise-identical findings', () => {
  assert.notEqual(findingKey(F()), findingKey(F({ id: 'APPSEC:H1' })));
  assert.notEqual(findingKey(F({ id: 'I3-01', invariant: 'i3' })), findingKey(F({ id: 'I3-01', invariant: 'i4' })));
});

test('findingBundleId: the bundle prefix for every registered bundle (incl. recsys-mle), else the invariant owner, else the source', async () => {
  const { findingBundleId } = await import('./findingKey.ts');
  assert.equal(findingBundleId({ id: 'RECSYS-MLE:H2', source: 'recommendation-audit' }), 'recsys-mle');
  assert.equal(findingBundleId({ id: 'DATA-ENG:H1', source: 'x' }), 'data-eng');
  assert.equal(findingBundleId({ id: 'GCP-1', source: 'gcp-iam' }), 'gcp-iam');
});

test('without a readable snippet the evidenceKey includes the title stem (no collision on path-only / no evidence)', () => {
  const a = findingKeys(F({ title: 'Token logged in plain text', evidence: [] }));
  const b = findingKeys(F({ title: 'Retry storm on 5xx', evidence: [] }));
  assert.notEqual(a.evidenceKey, b.evidenceKey, 'two evidence-free findings of one bundle no longer share an evidenceKey');
  const c = findingKeys(F({ title: 'Token logged in plain text' }));            // path-only (no workspace to read)
  const d = findingKeys(F({ title: 'Retry storm on 5xx' }));
  assert.notEqual(c.evidenceKey, d.evidenceKey, 'two path-only cites of the same file are different defects');
});
