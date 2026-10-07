import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryRecall, currentMemoryRecall, makeMemoryRecallServer, MEMORY_RECALL_SERVER } from './recall-tool.ts';

test('withMemoryRecall scopes the ctx; outside scope is undefined', () => {
  assert.equal(currentMemoryRecall(), undefined);
  withMemoryRecall({ orgId: 'org_x', actor: 'a@b.c', repos: ['o/r'] }, () => {
    const c = currentMemoryRecall();
    assert.equal(c?.orgId, 'org_x');
    assert.equal(c?.actor, 'a@b.c');
    assert.deepEqual(c?.repos, ['o/r']);
  });
  assert.equal(currentMemoryRecall(), undefined);
});

test('a blank / no-org ctx is a no-op (never masks an outer scope)', () => {
  withMemoryRecall({ orgId: 'org_outer' }, () => {
    withMemoryRecall(undefined, () => assert.equal(currentMemoryRecall()?.orgId, 'org_outer'));
    withMemoryRecall({ orgId: '' }, () => assert.equal(currentMemoryRecall()?.orgId, 'org_outer'));
  });
});

test('makeMemoryRecallServer builds an orgmemory MCP server (read-only memory_recall)', () => {
  const server = makeMemoryRecallServer({ orgId: 'org_x' });
  assert.ok(server);
  assert.equal(MEMORY_RECALL_SERVER, 'orgmemory');
});
