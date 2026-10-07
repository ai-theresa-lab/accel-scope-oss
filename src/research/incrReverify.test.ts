import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffChanges, fixedCitesChange, parseReverify, reverifyPrompt } from './incrReverify.ts';

const DIFF = [
  'diff --git a/src/pipeline.ts b/src/pipeline.ts',
  '--- a/src/pipeline.ts',
  '+++ b/src/pipeline.ts',
  '@@ -1,3 +1,3 @@',
  ' export function nightly() {',
  '-  db.overwrite("revenue");',
  '+  db.append("revenue");',
  ' }',
].join('\n');

test('diffChanges: touched paths + the added / removed line texts', () => {
  const d = diffChanges(DIFF);
  assert.deepEqual(d.paths, ['src/pipeline.ts']);
  assert.deepEqual(d.lines, ['db.overwrite("revenue");', 'db.append("revenue");']);
  assert.deepEqual(diffChanges(''), { paths: [], lines: [] });
});

test('"fixed" must cite the change — a touched file ref or a quoted changed line; a bare "fixed" does not count', () => {
  assert.equal(fixedCitesChange({ evidence: [], note: 'looks fixed' }, DIFF), false);
  assert.equal(fixedCitesChange({ evidence: [{ kind: 'file', ref: 'app/src/pipeline.ts:2' }], note: '' }, DIFF), true, 'workspace-dir prefixed path of a touched file');
  assert.equal(fixedCitesChange({ evidence: [{ kind: 'file', ref: 'src/other.ts:2' }], note: '' }, DIFF), false);
  assert.equal(fixedCitesChange({ evidence: [], note: 'now calls db.append("revenue"); instead' }, DIFF), true, 'quotes a changed line');
  assert.equal(fixedCitesChange({ evidence: [{ kind: 'file', ref: 'src/pipeline.ts:2' }], note: '' }, ''), false, 'no diff → nothing to cite → not provable');
});

test('reverifyPrompt asks "fixed" to cite the change; parseReverify keeps the cited evidence', () => {
  assert.match(reverifyPrompt({ title: 't', claim: 'c', evidence: [] }, DIFF), /for "fixed", evidence MUST cite\nthe change/);
  const p = parseReverify('```json\n{"status":"fixed","evidence":[{"kind":"file","ref":"src/pipeline.ts:2","detail":"append"}],"note":"append now"}\n```')!;
  assert.equal(p.status, 'fixed'); assert.equal(fixedCitesChange(p, DIFF), true);
  assert.equal(parseReverify('{"status":"fixed","evidence":[]}')?.status, 'fixed', 'the parser still parses; reverifyFinding applies the citation rule');
});
