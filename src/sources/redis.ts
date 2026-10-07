// KeyValueSource (Redis / Memcached / any serving cache) — a generic, READ-ONLY adapter exposed to
// the investigate / measure agents via a mounted MCP. Its purpose in a recsys audit: measure things
// that live in the serving cache and NOT in the warehouse — catalog / candidate-pool SIZES (ZCARD),
// set membership, key existence, freshness (TTL) — e.g. "how big is a candidate pool actually?",
// the way a recall-source incremental-value analysis needs (the agent discovers the keys itself via SCAN).
//
// Company-agnostic: point it at ANY read-only key-value MCP endpoint. It runs NO Redis command from
// TS — the agent does, through the mounted MCP — so no Redis-client dependency lives here. The MCP
// server enforces read-only at the protocol boundary; the allowlist below is the shared source of
// truth for "what counts as a read", and a local redis-mcp imports the same set.
import type { DataSource, SourceAgentTools } from './types.ts';

// Read-only Redis command allowlist (lowercase). Anything NOT here — every write, scripting, config,
// admin, pub/sub, or transaction command — is denied. KEYS is excluded (it blocks prod; use SCAN);
// MEMORY is excluded because USAGE reads but PURGE mutates and this gates only the first token. This
// is the security contract: a mounted key-value plane can never mutate the store.
export const REDIS_READONLY_COMMANDS: ReadonlySet<string> = new Set([
  // strings / generic
  'get', 'mget', 'strlen', 'getrange', 'substr', 'exists', 'type', 'ttl', 'pttl', 'dbsize',
  'randomkey', 'scan', 'object', 'bitcount', 'bitpos', 'dump', 'ping', 'echo',
  // hashes
  'hget', 'hmget', 'hgetall', 'hlen', 'hkeys', 'hvals', 'hexists', 'hstrlen', 'hscan', 'hrandfield',
  // lists
  'llen', 'lrange', 'lindex', 'lpos',
  // sets
  'scard', 'smembers', 'sismember', 'smismember', 'srandmember', 'sscan', 'sinter', 'sunion', 'sdiff',
  // sorted sets
  'zcard', 'zscore', 'zmscore', 'zrange', 'zrangebyscore', 'zrangebylex', 'zrevrange', 'zrevrangebyscore',
  'zrank', 'zrevrank', 'zcount', 'zlexcount', 'zscan',
  // geo / streams (read) / server info
  'geopos', 'geodist', 'geosearch', 'xlen', 'xrange', 'xrevrange', 'info',
]);

// Is this command line a single read-only Redis command? The first whitespace-delimited token (the
// command name) must be in the allowlist. Run as separate argv to redis-cli (no shell), so there is
// no injection vector; a multi-word value is fine — only the command verb is gated.
export function isReadOnlyRedisCommand(line: string): boolean {
  const cmd = (line || '').trim().split(/\s+/)[0]?.toLowerCase();
  return Boolean(cmd) && REDIS_READONLY_COMMANDS.has(cmd);
}

export interface RedisSourceOpts {
  name?: string;
  mcpUrl: string;    // HTTP MCP endpoint exposing a read-only Redis command tool
  mcpToken?: string; // bearer token, if the endpoint requires auth
  mcpName?: string;  // server name the agent sees (default 'redis')
}

export function makeRedisSource(opts: RedisSourceOpts): DataSource {
  const serverName = opts.mcpName ?? 'redis';
  return {
    kind: 'keyvalue',
    name: opts.name ?? serverName,
    capabilities: { discover: false, query: true, metadata: true },
    agentTools: (): SourceAgentTools => ({
      mcpServers: {
        [serverName]: {
          type: 'http',
          url: opts.mcpUrl,
          headers: opts.mcpToken ? { Authorization: `Bearer ${opts.mcpToken}` } : {},
        },
      },
    }),
  };
}
