// One pure function mints the "F-01…" display ids every deterministic surface prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDisplayIds, findingArea, formatDisplayId } from './findingIds.ts';
import { REMEDIATION_MD_JS } from './remediationMd.ts';

const row = (severity: string, confidence: string, extra: Record<string, unknown> = {}) => ({ severity, confidence, source: 'research', ...extra });

test('ids are ordered by severity, then confidence, then the original order', () => {
  const ids = assignDisplayIds([
    row('medium', 'high'),    // 3rd
    row('critical', 'low'),   // 1st (severity beats confidence)
    row('high', 'medium'),    // 2nd
    row('medium', 'high'),    // 4th (same as #0 → original order)
    row('low', 'high'),       // 5th
  ]);
  assert.deepEqual(ids, ['F-03', 'F-01', 'F-02', 'F-04', 'F-05']);
});

test('stable — the same findings give the same ids on every call', () => {
  const fs = [row('high', 'low'), row('high', 'high'), row('info', 'high'), row('critical', 'medium')];
  assert.deepEqual(assignDisplayIds(fs), assignDisplayIds(fs.map((f) => ({ ...f }))));
});

test('ruled-out rows get no id and do not consume a number', () => {
  const ids = assignDisplayIds([
    row('high', 'high'),
    row('info', 'high', { source: 'recommendation-audit' }),  // the refuted-hypothesis encoding (isRuledOutFinding)
    row('medium', 'high', { ruledOut: true }),               // a view-model row that already knows
    row('low', 'high', { status: 'ruled-out' }),             // a display-id-era __ACCEL_DATA__ row
    row('info', 'high', { source: 'baseline:i1' }),          // an info defect from another source is still confirmed
  ]);
  assert.deepEqual(ids, ['F-01', undefined, undefined, undefined, 'F-02']);
});

test('two digits, widening past 99', () => {
  assert.equal(formatDisplayId(1), 'F-01');
  assert.equal(formatDisplayId(42), 'F-42');
  assert.equal(formatDisplayId(100), 'F-100');
});

test('the REMEDIATION.md fallback (remediationMd.ts, for reports stored before display ids) numbers the same way', () => {
  // The two implementations must agree, or a legacy export's "F-03" names a different finding than the report card.
  const R = new Function(`${REMEDIATION_MD_JS}; return { remediationDisplayIds };`)() as { remediationDisplayIds: (a: unknown[]) => string[] };
  const fs = [row('medium', 'low'), row('high', 'high'), row('medium', 'high'), row('critical', 'low'), row('high', 'high')];
  assert.deepEqual(R.remediationDisplayIds(fs), assignDisplayIds(fs));
});

test('a finding\'s area comes from its bundle-prefixed id or its invariant owner', () => {
  assert.deepEqual(findingArea({ id: 'SWE-ARCH:H3', invariant: undefined }), { key: 'swe-arch', label: 'Software architecture & code health' });
  assert.equal(findingArea({ id: 'RE2-01', invariant: 're2' })?.key, 'release-eng');
  assert.equal(findingArea({ id: 'U1-02', invariant: 'u1' }), null, 'a user-derived dimension has no owning area');
  assert.equal(findingArea({ id: 'GCP-1', invariant: undefined }), null);
});
