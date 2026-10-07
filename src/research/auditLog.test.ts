import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditRecorder, withAuditRun, withAuditContext, currentAuditRecorder, readAuditLeaves, calledMcpServers, type AuditLeaf } from './auditLog.ts';
import { renderAuditHtml } from '../auditReportHtml.ts';

const tmpJsonl = () => join(mkdtempSync(join(tmpdir(), 'audit-')), 'audit.jsonl');

// ── recorder + round-trip ────────────────────────────────────────────────────────────────────────
test('AuditRecorder: appends leaves with monotonic seq; readAuditLeaves round-trips', () => {
  const p = tmpJsonl();
  const r = new AuditRecorder(p);
  r.record({ kind: 'agent', label: 'a', prompt: 'in-a', response: 'out-a', costUsd: 0.1 });
  r.record({ kind: 'openai', label: 'b', prompt: 'in-b', response: 'out-b' });
  const leaves = readAuditLeaves(p);
  assert.equal(leaves.length, 2);
  assert.deepEqual(leaves.map((l) => l.seq), [0, 1]);
  assert.equal(leaves[0].label, 'a'); assert.equal(leaves[0].prompt, 'in-a'); assert.equal(leaves[0].response, 'out-a');
  assert.equal(leaves[1].kind, 'openai');
  assert.ok(leaves.every((l) => typeof l.ts === 'number'));
});

test('AuditRecorder: caps a huge field and marks the dropped byte count', () => {
  const p = tmpJsonl();
  const big = 'x'.repeat(300_000);   // > the 256KB default field cap
  new AuditRecorder(p).record({ kind: 'agent', label: 'big', prompt: big });
  const [l] = readAuditLeaves(p);
  assert.ok(l.prompt!.length < big.length, 'prompt was capped');
  assert.equal(l.prompt!.length, 262_144);
  assert.equal(l.promptTruncated, 300_000 - 262_144);
});

test('AuditRecorder: noteMountedServers writes a meta leaf (deduped)', () => {
  const p = tmpJsonl();
  const r = new AuditRecorder(p);
  r.noteMountedServers(['warehouse', 'amplitude', 'warehouse']);
  r.noteMountedServers([]);   // empty → no leaf
  const leaves = readAuditLeaves(p);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].kind, 'meta');
  assert.deepEqual([...leaves[0].mountedServers!].sort(), ['amplitude', 'warehouse']);
});

// ── ALS context ──────────────────────────────────────────────────────────────────────────────────
test('currentAuditRecorder is a no-op outside a run; set inside withAuditRun', async () => {
  assert.equal(currentAuditRecorder(), undefined);
  const r = new AuditRecorder(tmpJsonl());
  await withAuditRun(r, async () => { assert.equal(currentAuditRecorder(), r); });
  assert.equal(currentAuditRecorder(), undefined);   // restored after
});

test('withAuditContext MERGES stage/bundleId onto the leaf and KEEPS the recorder', async () => {
  const p = tmpJsonl();
  const r = new AuditRecorder(p);
  await withAuditRun(r, () => withAuditContext({ stage: 'bundle', bundleId: 'recsys-mle' }, async () => {
    assert.equal(currentAuditRecorder(), r, 'recorder preserved through the nested context');
    currentAuditRecorder()!.record({ kind: 'agent', label: 'critique' });
  }));
  const [l] = readAuditLeaves(p);
  assert.equal(l.stage, 'bundle');
  assert.equal(l.bundleId, 'recsys-mle');
});

// ── MCP server attribution ─────────────────────────────────────────────────────────────────────
test('calledMcpServers parses mcp__<server>__<tool> (incl. hyphen/underscore server names), ignores built-ins', () => {
  const leaf = { toolCalls: [
    { name: 'mcp__warehouse__run_sql', args: '' },
    { name: 'mcp__acme-dashboard__query_dau', args: '' },
    { name: 'mcp__acme_code__ask', args: '' },
    { name: 'Read', args: '' },
    { name: 'Grep', args: '' },
  ] } as AuditLeaf;
  assert.deepEqual([...calledMcpServers(leaf)].sort(), ['acme-dashboard', 'acme_code', 'warehouse']);
});

// ── render aggregation + the "mounted but 0 calls" acceptance flag ─────────────────────────────
test('renderAuditHtml: flags a mounted-but-uncalled plane and counts a called one', () => {
  const leaves: AuditLeaf[] = [
    { seq: 0, ts: 1, kind: 'meta', mountedServers: ['amplitude', 'warehouse'] },
    { seq: 1, ts: 2, kind: 'agent', label: 'critique', bundleId: 'recsys-mle', toolCalls: [{ name: 'mcp__warehouse__run_sql', args: 'SELECT 1' }, { name: 'mcp__warehouse__run_sql', args: 'SELECT 2' }], costUsd: 0.2 },
  ];
  const html = renderAuditHtml(leaves, { runId: 'r1', target: 'Acme' });
  assert.match(html, /MOUNTED · 0 CALLS/);          // amplitude was mounted but never called → flagged
  assert.match(html, /amplitude/);
  assert.match(html, /2 call\(s\)/);                 // warehouse called twice
  assert.match(html, /critique/);                    // the node that called it
  assert.match(html, /SELECT 1/);                    // full tool arg rendered
});

test('renderAuditHtml: escapes HTML in prompts/responses (no raw injection)', () => {
  const leaves: AuditLeaf[] = [{ seq: 0, ts: 1, kind: 'agent', label: 'x', prompt: '<script>alert(1)</script>', response: 'a & b' }];
  const html = renderAuditHtml(leaves);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /a &amp; b/);
});

test('AuditRecorder: secret-shaped values never reach the audit file (prompt, response, tool args)', () => {
  const p = tmpJsonl();
  const tok = 'ghp' + '_' + 'A'.repeat(36);   // assembled so the source holds no token-shaped literal
  new AuditRecorder(p).record({ kind: 'agent', label: 'leak', prompt: `export GITHUB_TOKEN=${tok}`, response: `found ${tok}`, toolCalls: [{ name: 'Read', args: `{"q":"${tok}"}` }] });
  const raw = readFileSync(p, 'utf8');
  assert.ok(!raw.includes(tok), 'the raw JSONL carries no token');
  const [l] = readAuditLeaves(p);
  assert.match(l.prompt!, /redacted/);
  assert.doesNotMatch(renderAuditHtml([l], { runId: 'r' }), new RegExp(tok));
});
