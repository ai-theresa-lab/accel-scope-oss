import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeOpenAiAuth } from './openaiAuthProbe.ts';

const respond = (status: number): typeof fetch => (async () => new Response('{}', { status })) as unknown as typeof fetch;

// a 401'd OPENAI_API_KEY was invisible; the boot probe must name it, and ONLY it, as a bad key.
test('the boot probe classifies 200 as ok, 401/403 as a rejected key, anything else as inconclusive', async () => {
  assert.deepEqual(await probeOpenAiAuth({ key: 'k', fetchImpl: respond(200) }), { ok: true, status: 200 });
  assert.deepEqual(await probeOpenAiAuth({ key: 'k', fetchImpl: respond(401) }), { ok: false, status: 401 });
  assert.deepEqual(await probeOpenAiAuth({ key: 'k', fetchImpl: respond(403) }), { ok: false, status: 403 });
  assert.equal((await probeOpenAiAuth({ key: 'k', fetchImpl: respond(503) })).ok, undefined);
  const netErr = (async () => { throw new Error('ENOTFOUND api.openai.com'); }) as unknown as typeof fetch;
  assert.equal((await probeOpenAiAuth({ key: 'k', fetchImpl: netErr })).ok, undefined);
});

test('no key → no request, inconclusive', async () => {
  let called = false;
  const spy = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try { assert.equal((await probeOpenAiAuth({ fetchImpl: spy })).ok, undefined); } finally { if (saved !== undefined) process.env.OPENAI_API_KEY = saved; }
  assert.equal(called, false);
});

test('the key travels only in the Authorization header', async () => {
  let seen: { url: string; auth?: string } | undefined;
  const spy = (async (url: string, init: RequestInit) => { seen = { url: String(url), auth: (init.headers as Record<string, string>).authorization }; return new Response('{}'); }) as unknown as typeof fetch;
  await probeOpenAiAuth({ key: 'sk-test', fetchImpl: spy });
  assert.equal(seen?.url, 'https://api.openai.com/v1/models');
  assert.equal(seen?.auth, 'Bearer sk-test');
});
