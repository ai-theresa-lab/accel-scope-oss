import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  memoryRecallStatusLine, memoryEnabled, memoryOrgSegment, orgMemoryVersion, listOrgMemory, orgMemorySummary,
  getOrgMemoryHistory, getOrgMemoryCard, saveOrgMemoryCard, deleteOrgMemoryCard, revertMemoryEvent, intakeCandidates,
  draftFreeformMemory, extractMemoryFromReport, recallOrgMemory, execMemoryBrief, parseExtractedCards, setMemoryExtractor,
  LocalMemoryStore, DbMemoryStore, type MemoryCard,
} from './orgMemory.ts';

// The data dir is resolved at call time, so each test gets a fresh THERESA_DATA_DIR.
let root = '';
let dir = '';
let n = 0;
before(() => { root = mkdtempSync(join(tmpdir(), 'orgmem-')); });
after(() => { delete process.env.THERESA_DATA_DIR; delete process.env.THERESA_MEMORY; setMemoryExtractor(null); rmSync(root, { recursive: true, force: true }); });
beforeEach(() => { dir = join(root, `d${n++}`); process.env.THERESA_DATA_DIR = dir; delete process.env.THERESA_MEMORY; });

const ORG = 'local';
const card = (id: string, short_desc: string, extra: Partial<MemoryCard> = {}): MemoryCard => ({ id, type: 'metric-def', short_desc, ...extra });

test('memoryRecallStatusLine: why recall found nothing, and how many cards it recalled', () => {
  assert.equal(memoryRecallStatusLine({ requested: false, configured: false, pushEnabled: true }), null);
  assert.equal(memoryRecallStatusLine({ requested: true, configured: false, pushEnabled: true }), 'memory recall: disabled (THERESA_MEMORY=off) — 0 cards recalled');
  assert.match(memoryRecallStatusLine({ requested: true, configured: true, pushEnabled: false }) ?? '', /push disabled .* 0 cards recalled/);
  assert.match(memoryRecallStatusLine({ requested: true, configured: true, pushEnabled: true, noOrg: true }) ?? '', /no org scope/);
  assert.equal(memoryRecallStatusLine({ requested: true, configured: true, pushEnabled: true, count: 0, version: 7 }), 'memory recall: 0 cards recalled @ memory v7');
  assert.equal(memoryRecallStatusLine({ requested: true, configured: true, pushEnabled: true, count: 1, version: 7 }), 'memory recall: 1 card recalled @ memory v7');
  assert.equal(memoryRecallStatusLine({ requested: true, suppressed: true, configured: true, pushEnabled: true }), null);
});

test('memoryEnabled: on by default, off with THERESA_MEMORY=off (reads empty, writes refused)', async () => {
  assert.equal(memoryEnabled(), true);
  process.env.THERESA_MEMORY = 'off';
  assert.equal(memoryEnabled(), false);
  assert.deepEqual(await listOrgMemory(ORG), []);
  assert.equal((await saveOrgMemoryCard(ORG, card('a', 'x'))).ok, false);
  assert.match(String((await intakeCandidates(ORG, {}, [], { dryRun: false })).error), /disabled/);
});

test('memoryOrgSegment: safe ids pass through; anything else maps to a distinct traversal-free segment', () => {
  assert.equal(memoryOrgSegment('local'), 'local');
  assert.equal(memoryOrgSegment('org_abc-1'), 'org_abc-1');
  for (const bad of ['', '..', '../x', 'a/b', 'a b']) assert.match(memoryOrgSegment(bad), /^~[A-Za-z0-9_.-]*-[0-9a-f]{12}$/);
  assert.notEqual(memoryOrgSegment('a/b'), memoryOrgSegment('a_b'));
});

test('save / list / version bump; files land under memory/<org>/', async () => {
  assert.equal(await orgMemoryVersion(ORG), 0);
  const r1 = await saveOrgMemoryCard(ORG, card('metric/dau', 'DAU counts distinct users per UTC day', { key_entities: ['dau'] }), 'me@x');
  assert.deepEqual(r1, { ok: true, version: 1 });
  const r2 = await saveOrgMemoryCard(ORG, card('metric/wau', 'WAU is a rolling 7 day window'));
  assert.equal(r2.version, 2);
  const list = await listOrgMemory(ORG);
  assert.equal(list.length, 2);
  assert.equal(list.find((c) => c.id === 'metric/dau')?.version, 1);
  const sum = await orgMemorySummary(ORG);
  assert.equal(sum.version, 2); assert.equal(sum.total, 2);
  for (const f of ['cards.json', 'events.json', 'meta.json']) assert.ok(existsSync(join(dir, 'memory', 'local', f)), f);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'memory', 'local', 'meta.json'), 'utf8')), { version: 2 });
  // Edit keeps unspecified fields and bumps the card version.
  const r3 = await saveOrgMemoryCard(ORG, card('metric/dau', 'DAU = distinct users per UTC day'));
  assert.equal(r3.version, 3);
  const dau = await getOrgMemoryCard(ORG, 'metric/dau');
  assert.equal(dau?.short_desc, 'DAU = distinct users per UTC day');
  assert.deepEqual(dau?.key_entities, ['dau']);
  assert.equal(dau?.version, 3);
  assert.equal((await saveOrgMemoryCard(ORG, card('', 'x'))).ok, false);
});

test('concurrent writes are serialized (no lost updates)', async () => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => saveOrgMemoryCard(ORG, card(`c${i}`, `card number ${i}`))));
  assert.equal((await listOrgMemory(ORG)).length, 12);
  assert.equal(await orgMemoryVersion(ORG), 12);
  assert.equal((await getOrgMemoryHistory(ORG, { limit: 100 })).length, 12);
});

test('delete retires a card; history is newest-first with a runId filter; revert of insert / edit / delete', async () => {
  await saveOrgMemoryCard(ORG, card('k1', 'first statement'));
  await saveOrgMemoryCard(ORG, card('k1', 'edited statement'));
  const del = await deleteOrgMemoryCard(ORG, 'k1');
  assert.deepEqual(del, { ok: true });
  assert.equal((await listOrgMemory(ORG)).length, 0);
  assert.equal((await getOrgMemoryCard(ORG, 'k1'))?.state, 'retired');
  assert.equal((await deleteOrgMemoryCard(ORG, 'nope')).ok, false);

  const h = await getOrgMemoryHistory(ORG);
  assert.deepEqual(h.map((e) => e.action), ['delete', 'edit', 'insert']);
  assert.equal(h[0].entrypoint, 'manual-delete');
  assert.ok(!('before' in h[0]), 'internal snapshots are not served');

  // Revert the delete → active again with the edited text.
  const rv = await revertMemoryEvent(ORG, h[0].id);
  assert.equal(rv.ok, true);
  assert.equal((await getOrgMemoryCard(ORG, 'k1'))?.state, 'active');
  assert.equal((await getOrgMemoryCard(ORG, 'k1'))?.short_desc, 'edited statement');
  assert.match(String((await revertMemoryEvent(ORG, h[0].id)).error), /already reverted/);
  // Revert the edit → the first text.
  await revertMemoryEvent(ORG, h[1].id);
  assert.equal((await getOrgMemoryCard(ORG, 'k1'))?.short_desc, 'first statement');
  // Revert the insert → retired.
  await revertMemoryEvent(ORG, h[2].id);
  assert.equal((await listOrgMemory(ORG)).length, 0);
  const h2 = await getOrgMemoryHistory(ORG);
  assert.equal(h2[0].action, 'revert');
  assert.match(String((await revertMemoryEvent(ORG, h2[0].id)).error), /cannot itself be reverted/);
  assert.match(String((await revertMemoryEvent(ORG, 'ev_missing')).error), /not found/);
});

test('intake: insert vs append (dedup), revert of append, dryRun, discards, runId history filter', async () => {
  const src = { run_id: 'rs_1', run_type: 'accel-mini', scope: 'agent-write' };
  const r1 = await intakeCandidates(ORG, src, [
    { type: 'metric-def', short_desc: 'Revenue is booked net of refunds in the orders table', key_entities: ['orders', 'revenue'], confidence: 0.6 },
    { type: 'router', short_desc: 'Use the events_v2 table for click data', key_entities: ['events_v2'] },
    { type: 'bogus', short_desc: 'nope' },
    { type: 'mistake', short_desc: '' },
  ], { dryRun: false, actor: 'agent' });
  assert.equal(r1.dry_run, false);
  assert.equal(r1.extracted, 4);
  assert.equal(r1.candidates, 2);
  assert.deepEqual((r1.committed as any[]).map((c) => c.action), ['insert', 'insert']);
  assert.equal((r1.discarded as any[]).length, 2);
  assert.deepEqual(r1.queued, []);
  const revId = (r1.committed as any[])[0].id as string;
  const h1 = await getOrgMemoryHistory(ORG, { runId: 'rs_1' });
  assert.equal(h1.length, 2);
  assert.equal(h1[0].entrypoint, 'accel-mini-ask');

  // Near-duplicate (Jaccard ≥ 0.6 over short_desc + entities) → append to the existing card.
  const r2 = await intakeCandidates(ORG, { run_id: 'rs_2', entrypoint: 'report-extract' }, [
    { type: 'metric-def', short_desc: 'Revenue is booked net of refunds in orders table', key_entities: ['orders', 'revenue', 'refunds'], body: 'Seen in billing/sql.', confidence: 0.6, repos: ['acme/billing'] },
  ], { dryRun: false });
  assert.deepEqual((r2.committed as any[]).map((c) => [c.action, c.id]), [['append', revId]]);
  const merged = await getOrgMemoryCard(ORG, revId);
  assert.ok((merged?.confidence ?? 0) > 0.6);
  assert.deepEqual(merged?.key_entities, ['orders', 'revenue', 'refunds']);
  assert.equal(merged?.body, 'Seen in billing/sql.');
  assert.equal(merged?.repos, undefined, 'a company-wide card stays company-wide');
  assert.equal((await listOrgMemory(ORG)).length, 2);

  // Revert the append → the pre-append snapshot.
  const appendEv = (await getOrgMemoryHistory(ORG, { runId: 'rs_2' }))[0];
  assert.equal(appendEv.action, 'append');
  await revertMemoryEvent(ORG, appendEv.id);
  const back = await getOrgMemoryCard(ORG, revId);
  assert.deepEqual(back?.key_entities, ['orders', 'revenue']);
  assert.equal(back?.body, undefined);
  assert.equal(back?.confidence, 0.6);

  // A different fact → insert. dryRun changes nothing.
  const v = await orgMemoryVersion(ORG);
  const r3 = await intakeCandidates(ORG, src, [{ type: 'mistake', short_desc: 'The nightly export skipped Sundays because of a cron typo' }], { dryRun: true });
  assert.equal(r3.dry_run, true);
  assert.deepEqual((r3.committed as any[]).map((c) => c.action), ['insert']);
  assert.equal(await orgMemoryVersion(ORG), v);
  assert.equal((await listOrgMemory(ORG)).length, 2);
});

test('recall: keyword ranking, type filter, asOfVersion pin, repos filter, k', async () => {
  await saveOrgMemoryCard(ORG, card('a', 'Churn is measured over 30 days', { key_entities: ['churn'], confidence: 0.9 }));            // v1, company-wide
  await saveOrgMemoryCard(ORG, card('b', 'Signup funnel lives in the growth repo', { body: 'churn dashboards too', repos: ['acme/growth'], type: 'router' })); // v2
  await saveOrgMemoryCard(ORG, card('c', 'Payments retries use exponential backoff', { repos: ['acme/payments'], type: 'playbook' }));                   // v3
  await saveOrgMemoryCard(ORG, card('d', 'Churn alerts page the data team', { repos: ['acme/payments'] }));                                             // v4

  const all = await recallOrgMemory(ORG, { q: 'churn' });
  assert.deepEqual(all.map((c) => c.id), ['a', 'd', 'b'], 'entity+desc hit beats desc-only beats body-only');
  assert.equal(all[0].rank, 1);
  assert.deepEqual((await recallOrgMemory(ORG, { q: 'churn', type: 'router' })).map((c) => c.id), ['b']);
  assert.deepEqual((await recallOrgMemory(ORG, { q: 'churn', asOfVersion: 2 })).map((c) => c.id), ['a', 'b']);
  assert.deepEqual((await recallOrgMemory(ORG, { q: 'churn', repos: ['Acme/Growth@main'] })).map((c) => c.id), ['a', 'b'], 'company-wide + this repo only');
  assert.deepEqual((await recallOrgMemory(ORG, { q: 'churn', k: 1 })).map((c) => c.id), ['a']);
  assert.deepEqual((await recallOrgMemory(ORG, { entities: ['churn'] })).map((c) => c.id)[0], 'a');
  assert.deepEqual(await recallOrgMemory(ORG, { q: 'kubernetes' }), []);
  assert.equal((await recallOrgMemory(ORG, {})).length, 4, 'no query ⇒ every eligible card');
  await deleteOrgMemoryCard(ORG, 'a');
  assert.ok(!(await recallOrgMemory(ORG, { q: 'churn' })).some((c) => c.id === 'a'), 'retired cards are never recalled');

  const brief = await execMemoryBrief(ORG, 'churn', 'why did churn move');
  assert.equal(brief.version, 5);
  assert.ok(brief.count >= 1);
  assert.match(brief.block, /Org memory — prior knowledge/);

  const store = new LocalMemoryStore(ORG);
  assert.equal((await store.list()).length, 3);
  assert.equal((await store.list({ includeNonActive: true })).length, 4);
  assert.equal((await store.get('a'))?.state, 'retired');
  assert.equal(await store.version(), 5);
  assert.equal(DbMemoryStore, LocalMemoryStore);
});

test('parseExtractedCards: tolerant JSON parsing', () => {
  assert.deepEqual(parseExtractedCards('[]'), []);
  assert.equal(parseExtractedCards('```json\n[{"type":"router","short_desc":"x"}]\n```')?.length, 1);
  assert.equal(parseExtractedCards('Here you go: [{"type":"router","short_desc":"x"}] hope it helps')?.length, 1);
  assert.equal(parseExtractedCards('{"cards":[{"type":"router","short_desc":"x"},1]}')?.length, 1);
  assert.equal(parseExtractedCards(JSON.stringify(Array.from({ length: 12 }, () => ({ type: 'router', short_desc: 'x' }))))?.length, 8);
  assert.equal(parseExtractedCards('no json here'), null);
});

test('draftFreeformMemory / extractMemoryFromReport: stubbed LLM, confidence caps, provenance, errors', async () => {
  const prompts: string[] = [];
  setMemoryExtractor(async (p) => {
    prompts.push(p);
    return { text: JSON.stringify([
      { type: 'metric-def', short_desc: 'Active user means one session over 10 seconds', key_entities: ['active_user'], confidence: 0.95 },
      { type: 'nonsense', short_desc: 'dropped' },
    ]) };
  });
  const d = await draftFreeformMemory(ORG, 'active user = a session longer than 10s', 'me@x');
  assert.equal(d.extracted, 2);
  assert.deepEqual((d.committed as any[]).map((c) => c.action), ['insert']);
  assert.equal((d.discarded as any[]).length, 1);
  assert.match(prompts[0], /JSON array/);
  assert.match(prompts[0], /active user = a session longer than 10s/);
  const id = (d.committed as any[])[0].id as string;
  assert.equal((await getOrgMemoryCard(ORG, id))?.confidence, 0.5, 'freeform input is capped at 0.5');
  assert.equal((await getOrgMemoryHistory(ORG))[0].entrypoint, 'freeform');

  setMemoryExtractor(async () => ({ text: '[{"type":"router","short_desc":"Click data lives in events_v2","key_entities":["events_v2"],"confidence":0.8}]' }));
  const e = await extractMemoryFromReport(ORG, { runId: 'rs_9', text: 'report text', entrypoint: 'full-scan-draft', runType: 'full-scan', repos: ['acme/web'] });
  assert.deepEqual((e.committed as any[]).map((c) => c.action), ['insert']);
  const c2 = await getOrgMemoryCard(ORG, (e.committed as any[])[0].id);
  assert.equal(c2?.confidence, 0.8);
  assert.deepEqual(c2?.repos, ['acme/web']);
  assert.equal(c2?.provenance?.run_id, 'rs_9');
  const ev = (await getOrgMemoryHistory(ORG, { runId: 'rs_9' }))[0];
  assert.equal(ev.entrypoint, 'full-scan-draft');

  setMemoryExtractor(async () => ({ text: '', error: 'auth failed' }));
  assert.match(String((await draftFreeformMemory(ORG, 'x')).error), /auth failed/);
  setMemoryExtractor(async () => { throw new Error('boom'); });
  assert.match(String((await extractMemoryFromReport(ORG, { runId: 'r', text: 'x' })).error), /boom/);
  setMemoryExtractor(async () => ({ text: 'I cannot help' }));
  assert.match(String((await draftFreeformMemory(ORG, 'x')).error), /no valid JSON/);
  setMemoryExtractor(async () => ({ text: '[]' }));
  const empty = await draftFreeformMemory(ORG, 'x');
  assert.equal(empty.error, undefined);
  assert.equal(empty.extracted, 0);
  setMemoryExtractor(null);
});

test('a corrupt cards.json is never overwritten by a write', async () => {
  await saveOrgMemoryCard(ORG, card('x', 'something'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'memory', 'local', 'cards.json'), '{not json');
  const r = await saveOrgMemoryCard(ORG, card('y', 'other'));
  assert.equal(r.ok, false);
  assert.equal(readFileSync(join(dir, 'memory', 'local', 'cards.json'), 'utf8'), '{not json');
  assert.deepEqual(await listOrgMemory(ORG), []);
});
