import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyRedisCommand, makeRedisSource, REDIS_READONLY_COMMANDS } from './redis.ts';

test('read commands are allowed (incl. the pool-size / membership ones the recall analysis needs)', () => {
  for (const ok of ['ZCARD TOP_UGC_GAMES', 'scard s', 'SMEMBERS k', 'scan 0 COUNT 100', 'zrange z 0 -1', 'dbsize', 'TYPE k', 'EXISTS k', 'info memory', 'hgetall h']) {
    assert.equal(isReadOnlyRedisCommand(ok), true, ok);
  }
});

test('writes / scripting / config / admin / pubsub / txn are denied (the security contract)', () => {
  for (const bad of ['SET k v', 'del k', 'unlink k', 'ZADD z 1 a', 'sadd s a', 'hset h f v', 'expire k 1',
    'rename a b', 'flushall', 'flushdb', 'eval "x" 0', 'evalsha h 0', 'script load x', 'function list',
    'config get maxmemory', 'config set x y', 'client kill', 'shutdown', 'save', 'bgsave', 'debug sleep 1',
    'subscribe ch', 'multi', 'exec', 'copy a b', 'restore k 0 x', 'migrate h p k 0 1', 'keys *',
    'memory purge', 'memory usage k']) {   // MEMORY excluded: PURGE mutates + first-token gating can't tell the subcommand
    assert.equal(isReadOnlyRedisCommand(bad), false, bad);
  }
});

test('empty / malformed lines are denied', () => {
  for (const x of ['', '   ', '\n']) assert.equal(isReadOnlyRedisCommand(x), false);
});

test('KEYS is intentionally excluded (use SCAN; KEYS blocks prod)', () => {
  assert.equal(REDIS_READONLY_COMMANDS.has('keys'), false);
  assert.equal(REDIS_READONLY_COMMANDS.has('scan'), true);
});

test('makeRedisSource is a read-only keyvalue DataSource mounting the MCP under its server name', () => {
  const s = makeRedisSource({ mcpUrl: 'http://127.0.0.1:8772/mcp', mcpToken: 't' });
  assert.equal(s.kind, 'keyvalue');
  assert.deepEqual(s.capabilities, { discover: false, query: true, metadata: true });
  const tools = s.agentTools!();
  const srv = (tools.mcpServers as Record<string, { url: string; headers: Record<string, string> }>).redis;
  assert.equal(srv.url, 'http://127.0.0.1:8772/mcp');
  assert.equal(srv.headers.Authorization, 'Bearer t');
});
