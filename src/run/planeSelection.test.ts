import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Source } from '../server.ts';
import { ASK_PLANE_KINDS, DATA_PLANE_KINDS, parseAskPlaneSelection, parsePlaneSelection, parseSiblingRecall, scopeSourcesToSelection, selectionSummary } from './planeSelection.ts';

// A run mounts only the data planes ticked for it — never every connected plane.

const src = (id: string, kind: Source['kind'], extra: Partial<Source> = {}): Source => ({ id, kind, name: `${kind}-${id}`, status: 'ready', detail: '', ...extra });
const SOURCES: Source[] = [
  src('gh', 'github', { repos: [] }),
  src('wh', 'warehouse', { mcpUrl: 'https://wh' }),
  src('kv', 'keyvalue', { mcpUrl: 'https://kv' }),
  src('amp', 'analytics', { mcpUrl: 'https://amp', mcpName: 'amplitude' }),
  src('loc', 'local', { localRepos: [] }),
];

test('every data-plane kind the run can mount is governed by the gate', () => {
  for (const k of ['warehouse', 'analytics', 'bi', 'custom', 'keyvalue'] as const) assert.ok(DATA_PLANE_KINDS.has(k), k);
  for (const k of ['github', 'local', 'giturl'] as const) assert.ok(!DATA_PLANE_KINDS.has(k), `${k} is a code target, not a data plane`);
});

test('ABSENT fields ⇒ nothing mounted (the safe default) and a note is emitted for the log', () => {
  const p = parsePlaneSelection({}, SOURCES);
  assert.ok(p.ok);
  assert.deepEqual(p.planeFilter, []);
  assert.equal(p.memoryRecall, false);
  assert.equal(p.notes.length, 2);
  assert.deepEqual(scopeSourcesToSelection(SOURCES, p).map((s) => s.id), ['gh', 'loc']);
});

test('explicit selection mounts exactly the ticked planes', () => {
  const p = parsePlaneSelection({ planeFilter: ['wh', 'amp'], memoryRecall: true }, SOURCES);
  assert.ok(p.ok);
  assert.equal(p.memoryRecall, true);
  assert.deepEqual(p.notes, []);
  assert.deepEqual(scopeSourcesToSelection(SOURCES, p).map((s) => s.id), ['gh', 'wh', 'amp', 'loc']);
  assert.equal(SOURCES.length, 5, 'never mutates the input list');
  assert.match(selectionSummary(SOURCES, p, true), /data planes warehouse-wh \(warehouse\), analytics-amp \(analytics\) · memory recall on/);
});

test('validation: unknown / wrong-kind ids and malformed fields are rejected, never silently widened', () => {
  assert.equal(parsePlaneSelection({ planeFilter: ['nope'] }, SOURCES).ok, false);
  assert.equal(parsePlaneSelection({ planeFilter: ['gh'] }, SOURCES).ok, false, 'a github source id is not a data plane');
  assert.equal(parsePlaneSelection({ planeFilter: 'wh' }, SOURCES).ok, false);
  assert.equal(parsePlaneSelection({ memoryRecall: 'yes' }, SOURCES).ok, false);
  const bad = parsePlaneSelection({ planeFilter: ['nope'] }, SOURCES);
  assert.ok(!bad.ok && /not a connected data plane/.test(bad.error));
});

test('legacy memory toggle: only an explicit useMemory:true keeps recall when memoryRecall is absent', () => {
  const on = parsePlaneSelection({ useMemory: true }, SOURCES);
  const off = parsePlaneSelection({ useMemory: false }, SOURCES);
  assert.ok(on.ok && on.memoryRecall === true);
  assert.ok(off.ok && off.memoryRecall === false);
  const explicit = parsePlaneSelection({ useMemory: true, memoryRecall: false }, SOURCES);
  assert.ok(explicit.ok && explicit.memoryRecall === false, 'memoryRecall wins over the legacy field');
});

test('a legacy run record (null filter) keeps its all-planes snapshot', () => {
  assert.deepEqual(scopeSourcesToSelection(SOURCES, { planeFilter: null }).map((s) => s.id), SOURCES.map((s) => s.id));
  assert.match(selectionSummary(SOURCES, { planeFilter: null }, false), /legacy run record/);
});

test('Quick Ask: ABSENT planeFilter ⇒ none (logged); explicit ids scope the mount; unknown id ⇒ rejected', () => {
  const none = parseAskPlaneSelection({ question: 'q' }, SOURCES);
  assert.ok(none.ok);
  assert.deepEqual(none.planeFilter, []);
  assert.equal(none.notes.length, 1, 'no memoryRecall note — an ask has its own memory tick');
  const picked = parseAskPlaneSelection({ planeFilter: ['kv'] }, SOURCES);
  assert.ok(picked.ok);
  assert.deepEqual(scopeSourcesToSelection(SOURCES, picked).map((s) => s.id), ['gh', 'kv', 'loc']);
  assert.equal(parseAskPlaneSelection({ planeFilter: ['nope'] }, SOURCES).ok, false);
});

test('Quick Ask: memory recall follows the ask’s own memory tick (default ON)', () => {
  const dflt = parseAskPlaneSelection({}, SOURCES);
  const off = parseAskPlaneSelection({ useMemory: false }, SOURCES);
  assert.ok(dflt.ok && dflt.memoryRecall === true);
  assert.ok(off.ok && off.memoryRecall === false);
});

test('Quick Ask: only warehouse / keyvalue planes are selectable', () => {
  assert.deepEqual([...ASK_PLANE_KINDS].sort(), ['keyvalue', 'warehouse']);
  assert.ok(parseAskPlaneSelection({ planeFilter: ['wh', 'kv'] }, SOURCES).ok);
  assert.equal(parseAskPlaneSelection({ planeFilter: ['amp'] }, SOURCES).ok, false);
  assert.ok(parsePlaneSelection({ planeFilter: ['amp'] }, SOURCES).ok, 'the Full Scan still takes every data-plane kind');
});

test('siblingRecall: default off, booleans only', () => {
  assert.deepEqual(parseSiblingRecall({}), { ok: true, siblingRecall: false });
  assert.deepEqual(parseSiblingRecall({ siblingRecall: true }), { ok: true, siblingRecall: true });
  assert.equal(parseSiblingRecall({ siblingRecall: 'yes' }).ok, false);
});
