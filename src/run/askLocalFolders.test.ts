import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Source } from '../server.ts';
import { askLocalFolderId, askLocalFolderList, parseAskLocalFolders, resolveAskLocalFolders } from './askLocalFolders.ts';

// Quick Ask scope is explicit: a connected local / uploaded folder is mounted only when the ask names it by its opaque id.

const src = (id: string, kind: Source['kind'], extra: Partial<Source> = {}): Source => ({ id, kind, name: `${kind}-${id}`, status: 'ready', detail: '', ...extra });
const SOURCES: Source[] = [
  src('gh', 'github', { repos: [] }),
  src('loc', 'local', { localRepos: [{ path: '/srv/uploads/a1/notes', name: 'notes', uploadedAt: '2026-10-03T01:02:03Z', count: 2 }, { path: '/srv/uploads/b2/notes', name: 'notes' }] }),
];
const ID_A = askLocalFolderId('loc', '/srv/uploads/a1/notes');
const ID_B = askLocalFolderId('loc', '/srv/uploads/b2/notes');

test('askLocalFolderList: one stable opaque id per folder, never the filesystem path', () => {
  const list = askLocalFolderList(SOURCES);
  assert.deepEqual(list.map((f) => f.id), [ID_A, ID_B]);
  assert.match(ID_A, /^loc:[0-9a-f]{10}$/);
  assert.notEqual(ID_A, ID_B, 'two uploads of the same name stay distinct');
  assert.equal(askLocalFolderId('loc', '/srv/uploads/a1/notes'), ID_A, 'stable across calls');
  assert.ok(!JSON.stringify(list).includes('/srv/'), 'no path reaches the client');
  assert.deepEqual(list[0], { id: ID_A, name: 'notes', uploadedAt: '2026-10-03T01:02:03Z', count: 2 });
  assert.deepEqual(askLocalFolderList([src('gh', 'github')]), []);
});

test('parseAskLocalFolders: absent ⇒ none; non-array or unknown id ⇒ 400; dedupes', () => {
  assert.deepEqual(parseAskLocalFolders({}, SOURCES), { ok: true, ids: [] });
  assert.deepEqual(parseAskLocalFolders({ localFolders: null }, SOURCES), { ok: true, ids: [] });
  assert.deepEqual(parseAskLocalFolders({ localFolders: [ID_A, ID_A] }, SOURCES), { ok: true, ids: [ID_A] });
  const notArr = parseAskLocalFolders({ localFolders: ID_A }, SOURCES);
  assert.equal(notArr.ok, false);
  const unknown = parseAskLocalFolders({ localFolders: [ID_A, '/srv/uploads/a1/notes'] }, SOURCES);
  assert.ok(!unknown.ok && /not a connected folder/.test(unknown.error));
  assert.equal(parseAskLocalFolders({ localFolders: [ID_A] }, [src('gh', 'github')]).ok, false, 'no local source ⇒ every id unknown');
});

test('resolveAskLocalFolders: ids → paths in selection order; a disconnected folder is reported missing', () => {
  const r = resolveAskLocalFolders([ID_B, 'loc:deadbeef00', ID_A], SOURCES);
  assert.deepEqual(r.folders, [{ path: '/srv/uploads/b2/notes', name: 'notes' }, { path: '/srv/uploads/a1/notes', name: 'notes' }]);
  assert.deepEqual(r.missing, ['loc:deadbeef00']);
});
