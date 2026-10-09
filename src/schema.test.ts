import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertFinding, isResolvableEvidence, findingHasResolvableEvidence, parseFileRef, fileEvidenceResolves, findingResolvesInWorkspace, type Finding } from './schema.ts';

const base: Omit<Finding, 'evidence'> = {
  id: 'X-01', dimension: 'product_metrics', title: 't', claim: 'c',
  businessImpact: 'b', recommendation: 'r', severity: 'high', confidence: 'high', effort: 'moderate', source: 's',
};
const f = (evidence: Finding['evidence']): Finding => ({ ...base, evidence });

test('isResolvableEvidence rejects future-work / synthesis refs, accepts concrete ones', () => {
  // future-work / synthesis / self-referential → NOT resolvable (these belong in coverageGaps). Note
  // `measurement:*` is the audit's OWN pointer, never a concrete SOURCE, so it must not satisfy the gate.
  for (const ref of ['eval:h1', 'synthesis', 'synthesis · grounded in h1, h2', 'proposed', 'measurement:h1', 'unknown', 'n/a', 'tbd', 'pending', '']) {
    assert.equal(isResolvableEvidence({ kind: 'computation', ref }), false, `"${ref}" should be non-resolvable`);
  }
  // a future-work DETAIL also disqualifies, even with a computation ref
  assert.equal(isResolvableEvidence({ kind: 'computation', ref: 'warehouse:q1', detail: 'decisive eval proposed — run it to settle this hypothesis' }), false);
  // concrete computation refs (real sources) → resolvable
  for (const ref of ['warehouse:q_abc', 'redis:ZCARD pool', 'cluster:c3', 'history:commit', 'src/foo.ts:42', 'abc123', 'https://x/pr/1']) {
    assert.equal(isResolvableEvidence({ kind: 'computation', ref, detail: 'value=0.3 vs floor=0.1' }), true, `"${ref}" should be resolvable`);
  }
  // KIND-AWARE: concrete-artifact kinds reference real things — a FILE literally named
  // synthesis.ts / none.md must resolve (the placeholder guard is only for `computation` refs).
  assert.equal(isResolvableEvidence({ kind: 'file', ref: 'synthesis.ts:10' }), true);
  assert.equal(isResolvableEvidence({ kind: 'file', ref: 'none.md:1' }), true);
  assert.equal(isResolvableEvidence({ kind: 'commit', ref: 'abc123' }), true);
  assert.equal(isResolvableEvidence({ kind: 'doc', ref: 'unknown-design.md' }), true);
  // but the same placeholder text as a COMPUTATION ref is still rejected
  assert.equal(isResolvableEvidence({ kind: 'computation', ref: 'synthesis · grounded in h1' }), false);
});

test('assertFinding requires at least one RESOLVABLE evidence pointer', () => {
  assert.throws(() => assertFinding(f([])), /no evidence/);
  assert.throws(() => assertFinding(f([{ kind: 'computation', ref: 'eval:h1', detail: 'needs an eval' }])), /no RESOLVABLE evidence/);
  // a finding with a real measured ref passes
  assert.doesNotThrow(() => assertFinding(f([{ kind: 'computation', ref: 'warehouse:q1', detail: '0.42 vs 0.1' }])));
  // mixed: one bad + one good ref → passes (some resolvable)
  assert.doesNotThrow(() => assertFinding(f([{ kind: 'computation', ref: 'eval:h1' }, { kind: 'file', ref: 'src/a.ts:10' }])));
});

test('findingHasResolvableEvidence mirrors the gate', () => {
  assert.equal(findingHasResolvableEvidence(f([{ kind: 'computation', ref: 'warehouse:q2', detail: '12 vs 4' }])), true);
  assert.equal(findingHasResolvableEvidence(f([{ kind: 'computation', ref: 'eval:h2' }])), false);
  assert.equal(findingHasResolvableEvidence(f([{ kind: 'computation', ref: 'measurement:h2' }])), false); // self-referential pointer, not a source
});

// ── optional workspace existence check for file/line evidence ────────────────────────────────────────────────

test('parseFileRef handles the path:line shapes agents and miners emit', () => {
  assert.deepEqual(parseFileRef('src/a.ts'), { path: 'src/a.ts' });
  assert.deepEqual(parseFileRef('src/a.ts:42'), { path: 'src/a.ts', line: 42 });
  assert.deepEqual(parseFileRef('src/a.ts:42-60'), { path: 'src/a.ts', line: 42 });
  assert.deepEqual(parseFileRef('src/a.ts:42:7'), { path: 'src/a.ts', line: 42 });
  assert.deepEqual(parseFileRef('src/a.ts#L42-L60'), { path: 'src/a.ts', line: 42 });
  assert.deepEqual(parseFileRef('./src/a.ts:3 (function foo)'), { path: 'src/a.ts', line: 3 });
  assert.deepEqual(parseFileRef('src/a.ts:3, src/b.ts:9'), { path: 'src/a.ts', line: 3 });
});

test('isResolvableEvidence with a workspace root checks that file/line refs actually resolve', () => {
  const root = mkdtempSync(join(tmpdir(), 'theresa-ev-'));
  try {
    mkdirSync(join(root, 'repo', 'src'), { recursive: true });
    writeFileSync(join(root, 'repo', 'src', 'a.ts'), 'one\ntwo\nthree\n');
    const ev = (ref: string) => isResolvableEvidence({ kind: 'file', ref }, { root });
    // workspace-relative (how miners + agents cite) and repo-relative (prefix omitted) both resolve
    assert.equal(ev('repo/src/a.ts:2'), true);
    assert.equal(ev('src/a.ts:3'), true);
    assert.equal(ev('repo/src'), true);                         // a directory, no line
    // non-existent file, out-of-range line, a line on a directory, a path escaping the root → unresolvable
    assert.equal(ev('repo/src/missing.ts:1'), false);
    assert.equal(ev('repo/src/a.ts:99'), false);
    assert.equal(ev('repo/src:3'), false);
    assert.equal(ev('../../etc/passwd'), false);
    assert.equal(ev(join(root, 'repo', 'src', 'a.ts') + ':1'), true);   // absolute, inside root
    assert.equal(ev(join(tmpdir(), 'elsewhere.ts')), false);             // absolute, outside root
    // uncheckable on disk (URL / glob) stays trusted, as without a root
    assert.equal(ev('https://github.com/o/r/blob/main/x.ts#L3'), true);
    assert.equal(ev('src/**/*.ts'), true);
    // non-file kinds are unaffected by the root
    assert.equal(isResolvableEvidence({ kind: 'commit', ref: 'abc123' }, { root }), true);
    // WITHOUT a root the old kind-aware behaviour is unchanged: a non-empty file ref is trusted
    assert.equal(isResolvableEvidence({ kind: 'file', ref: 'repo/src/missing.ts:1' }), true);
    assert.equal(fileEvidenceResolves('repo/src/a.ts:1', root), true);
    // finding-level: one resolving pointer is enough; none → dropped; root undefined ⇒ legacy gate
    assert.equal(findingResolvesInWorkspace(f([{ kind: 'file', ref: 'nope.ts:1' }, { kind: 'file', ref: 'src/a.ts:1' }]), root), true);
    assert.equal(findingResolvesInWorkspace(f([{ kind: 'file', ref: 'nope.ts:1' }]), root), false);
    assert.equal(findingResolvesInWorkspace(f([{ kind: 'file', ref: 'nope.ts:1' }]), undefined), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a cite that leaves out leading directories resolves when exactly one workspace file matches, and is rewritten', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { canonicalFileRef, fileEvidenceResolves } = await import('./schema.ts');
  const root = mkdtempSync(join(tmpdir(), 'suffix-ref-'));
  try {
    mkdirSync(join(root, 'repo', 'src', 'lib'), { recursive: true });
    mkdirSync(join(root, 'repo', 'test'), { recursive: true });
    writeFileSync(join(root, 'repo', 'src', 'cache.js'), 'a\nb\nc\n');
    writeFileSync(join(root, 'repo', 'src', 'lib', 'index.js'), 'x\n');
    writeFileSync(join(root, 'repo', 'test', 'index.js'), 'y\n');
    assert.equal(fileEvidenceResolves('cache.js:2', root), true, 'unique basename');
    assert.equal(canonicalFileRef('cache.js:2 (get)', root), 'repo/src/cache.js:2 (get)');
    assert.equal(canonicalFileRef('src/cache.js:3', root), 'src/cache.js:3', 'a repo-relative cite already resolves: kept as cited');
    assert.equal(fileEvidenceResolves('cache.js:99', root), false, 'line past the end');
    assert.equal(fileEvidenceResolves('index.js:1', root), false, 'ambiguous: two files');
    assert.equal(canonicalFileRef('lib/index.js:1', root), 'repo/src/lib/index.js:1', 'a longer suffix disambiguates');
    assert.equal(fileEvidenceResolves('../cache.js', root), false);
    assert.equal(canonicalFileRef('nope.js', root), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
