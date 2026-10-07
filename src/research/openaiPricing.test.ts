import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openaiPrice, openaiCostUsd, chatUsage, codexStreamUsage } from './openaiPricing.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('openaiPrice: dated ids match their family by longest prefix; unknown ids are priced as gpt-5.5, flagged unknown', () => {
  assert.deepEqual(openaiPrice('gpt-5.5-2026-04-23'), { price: { input: 5, cachedInput: 0.5, output: 30 }, known: true });
  assert.equal(openaiPrice('gpt-5.4-mini').price.output, 4.5);       // not the gpt-5.4 row
  assert.equal(openaiPrice('gpt-5-mini-2025-08-07').price.input, 0.25); // not the gpt-5 row
  assert.equal(openaiPrice('gpt-5.6-sol').price.output, 20);
  assert.equal(openaiPrice('GPT-5').price.input, 1.25);
  const u = openaiPrice('gpt-5.6');   // the codex default id has no plain row (only sol / terra / luna)
  assert.equal(u.known, false); assert.equal(u.price.input, 5);
  assert.equal(openaiPrice('gpt-5.55').known, false, 'a prefix only matches at a "-" boundary');
  assert.equal(openaiPrice('gpt-5.5-pro-2026-04-23').price.output, 180, 'the pro row wins over the gpt-5.5 prefix');
});

test('openaiCostUsd: cached input at the cached rate, the rest at full rate; cached is capped at input', () => {
  // A 2026-10-04 gpt-5.5 call: 2162 in + 2771 out on gpt-5.5 — logged as ≈$0.030 at the old gpt-5 rate.
  near(openaiCostUsd('gpt-5.5-2026-04-23', { input: 2162, cached: 0, output: 2771 }), (2162 * 5 + 2771 * 30) / 1e6);
  near(openaiCostUsd('gpt-5.5', { input: 1_000_000, cached: 400_000, output: 0 }), 600_000 * 5 / 1e6 + 400_000 * 0.5 / 1e6);
  near(openaiCostUsd('gpt-5.5', { input: 10, cached: 50, output: 0 }), 10 * 0.5 / 1e6);
  assert.equal(openaiCostUsd('gpt-5.5', { input: -5, cached: NaN as unknown as number, output: 0 }), 0);
});

test('chatUsage / codexStreamUsage read the cached subset from each wire format', () => {
  assert.deepEqual(chatUsage({ prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 60 } }), { input: 100, cached: 60, output: 7 });
  assert.deepEqual(chatUsage(undefined), { input: 0, cached: 0, output: 0 });
  const stream = [
    '{"type":"thread.started"}',
    '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":800,"output_tokens":50}}',
    'not json',
    '{"type":"turn.completed","usage":{"input_tokens":200,"output_tokens":5}}',
  ].join('\n');
  assert.deepEqual(codexStreamUsage(stream), { input: 1200, cached: 800, output: 55 });
});
