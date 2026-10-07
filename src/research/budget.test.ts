import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetLedger, withRunBudget, withBudgetNode, recordLlmCost, currentLedger, BUDGET_ALLOC, GLOBAL_STOP_FRACTION, recordDegraded, llmFailureReason, liveCostDue, budgetOverrunReason, lateStageSkipReason, roundUsd, adjustLlmCost, normalizeCostEstimate, usageUnits, CostCalibration, QueryCostTracker, leadershipAuthorAdmit, V5_AUTHOR_EST_USD } from './budget.ts';

test('ledger attributes cost to the active node via AsyncLocalStorage', async () => {
  const led = new BudgetLedger(100);
  await withRunBudget(led, 'discovery', async () => {
    recordLlmCost(5);
    await withBudgetNode('bundle', async () => { recordLlmCost(20); });
    recordLlmCost(3);   // back in 'discovery' after the nested node returns
  });
  assert.equal(led.spentOn('discovery'), 8);
  assert.equal(led.spentOn('bundle'), 20);
  assert.equal(led.spent(), 28);
});

test('admit() stops new discovery/bundle work past the global stop; audit/reserve always admitted', () => {
  const led = new BudgetLedger(100);
  assert.equal(led.admit('bundle'), true);
  led.spend('bundle', 100 * GLOBAL_STOP_FRACTION);   // reach 0.80·B
  assert.equal(led.admit('bundle'), false);
  assert.equal(led.admit('discovery'), false);
  assert.equal(led.admit('audit'), true, 'audits must still run to finish the run');
  assert.equal(led.admit('reserve'), true, 'synthesis/report must still run');
});

test('nodeRemaining reflects the per-node allocation', () => {
  const led = new BudgetLedger(100);
  assert.equal(led.nodeRemaining('bundle'), 100 * BUDGET_ALLOC.bundle);
  led.spend('bundle', 10);
  assert.equal(led.nodeRemaining('bundle'), 100 * BUDGET_ALLOC.bundle - 10);
});

test('a zero/negative total means no enforcement (Infinity budget)', () => {
  const led = new BudgetLedger(0);
  assert.equal(led.remaining(), Infinity);
  assert.equal(led.admit('bundle'), true);
});

test('recordLlmCost / currentLedger outside a run context are no-ops', () => {
  assert.equal(currentLedger(), undefined);
  recordLlmCost(99); // must not throw
});

// ── ledger hooks + degradation sink ─────────────────────────────────────────────────────────────────────────

test('ledger hooks see the running total after every recorded cost; a throwing hook never breaks accounting', async () => {
  const seen: number[] = [];
  const led = new BudgetLedger(100, { onSpend: (s) => { seen.push(s); throw new Error('observer bug'); } });
  await withRunBudget(led, 'discovery', async () => { recordLlmCost(2); recordLlmCost(3); recordLlmCost(0); });
  assert.deepEqual(seen, [2, 5]);          // the zero-cost call is not a spend
  assert.equal(led.spent(), 5);
});

test('recordDegraded reaches the run ledger hook inside a run context and is a no-op outside one', async () => {
  const rows: string[] = [];
  const led = new BudgetLedger(100, { onDegraded: (stage, reason) => rows.push(`${stage}|${reason}`) });
  await withRunBudget(led, 'reserve', async () => { recordDegraded('reconcile', 'skipped (codex CLI unavailable)'); });
  assert.deepEqual(rows, ['reconcile|skipped (codex CLI unavailable)']);
  recordDegraded('html-qc', 'x');          // outside any run: must not throw, must not reach the ledger
  assert.equal(rows.length, 1);
});

test('llmFailureReason gives a short STABLE cause (the 401 case names the key)', () => {
  assert.match(llmFailureReason('OpenAI 401: {"error":{"message":"Incorrect API key provided"}}'), /auth failed \(401\).*OPENAI_API_KEY/);
  assert.match(llmFailureReason('codex QC produced no parseable JSON (exit 1): unexpected status 401 Unauthorized'), /401/);
  assert.equal(llmFailureReason('OPENAI_API_KEY not set'), 'OPENAI_API_KEY not set');
  assert.match(llmFailureReason('OpenAI 429: rate limit'), /429/);
  assert.equal(llmFailureReason('OpenAI 503: overloaded'), 'provider or network error');
  assert.equal(llmFailureReason(''), 'no output');
  assert.equal(llmFailureReason('weird thing'), 'unexpected error');
  // Numbers inside other tokens must not masquerade as a status code.
  assert.equal(llmFailureReason('wrote 14012 bytes'), 'unexpected error');
});

test('live cost persists on the first spend, then on ≥$0.50 movement or ≥5s — never on no movement', () => {
  assert.equal(liveCostDue(undefined, 0.01, 0), true);
  assert.equal(liveCostDue(undefined, 0, 0), false);
  const last = { usd: 1, at: 1_000 };
  assert.equal(liveCostDue(last, 1.2, 2_000), false);   // small + recent
  assert.equal(liveCostDue(last, 1.5, 2_000), true);    // moved $0.50
  assert.equal(liveCostDue(last, 1.01, 6_000), true);   // 5s elapsed
  assert.equal(liveCostDue(last, 1, 60_000), false);    // no movement
});

test('a final cost past the cap is named as an overrun; within cap / unbounded is not', () => {
  assert.equal(budgetOverrunReason(108.18, 100), 'exceeded cap by 8.2% ($108.18 of a $100.00 cap)');
  assert.equal(budgetOverrunReason(250, 100), 'exceeded cap by 150% ($250.00 of a $100.00 cap)');
  assert.equal(budgetOverrunReason(99.99, 100), null);
  assert.equal(budgetOverrunReason(100, 100), null);
  assert.equal(budgetOverrunReason(500, 0), null);          // force-all → unbounded ledger
  assert.equal(budgetOverrunReason(null, 100), null);
});

// a normalize pass started at $7.92 of an $8 cap and ended at $10.56.
test('lateStageSkipReason skips optional late stages once the cap is reached or the reserve is used up', () => {
  assert.equal(lateStageSkipReason(undefined), null);
  assert.equal(lateStageSkipReason(new BudgetLedger(0)), null, 'unbounded');
  const fresh = new BudgetLedger(8); fresh.spend('bundle', 6.8);
  assert.equal(lateStageSkipReason(fresh), null, 'past 0.80·B but more than half the reserve left');
  const low = new BudgetLedger(8); low.spend('bundle', 7.92);
  assert.match(lateStageSkipReason(low) ?? '', /^run budget nearly spent \(\$7\.92 of a \$8\.00 cap\)/);
  const over = new BudgetLedger(8); over.spend('reserve', 8.5);
  assert.match(lateStageSkipReason(over) ?? '', /^run budget cap reached/);
});

test('roundUsd keeps float-sum noise out of the recorded cost', () => {
  assert.equal(roundUsd(10.560582499999999), 10.5606);
  assert.equal(roundUsd(null), null);
  assert.equal(roundUsd(Number.NaN), null);
});

// normalize was admitted at $6.71 of an $8 cap (84%, under the 0.90·B line), cost $2.25
// and ended the run at $8.96 (+12%).
test('a late stage whose expected cost does not fit in what is left of the cap is skipped up front', () => {
  const led = new BudgetLedger(8); led.spend('bundle', 6.71);
  assert.equal(lateStageSkipReason(led), null, 'without an estimate the 0.90·B line alone lets it start');
  assert.equal(normalizeCostEstimate(2), 2.5);
  assert.match(lateStageSkipReason(led, normalizeCostEstimate(2)) ?? '', /^not enough run budget left for it \(~\$2\.50 est\.; \$6\.71 of a \$8\.00 cap\)/);
  const roomy = new BudgetLedger(8); roomy.spend('bundle', 4);
  assert.equal(lateStageSkipReason(roomy, normalizeCostEstimate(2)), null, 'fits → go ahead');
  assert.equal(lateStageSkipReason(new BudgetLedger(0), 1e9), null, 'unbounded ledger never skips');
});

test('a provisional live estimate is trued up (up or down) so the ledger total stays exact', async () => {
  const led = new BudgetLedger(100);
  await withRunBudget(led, 'reserve', async () => {
    recordLlmCost(1.5);          // live estimate while the query runs
    adjustLlmCost(2.25 - 1.5);   // result: the real total was higher
  });
  assert.equal(led.spentOn('reserve'), 2.25);
  await withRunBudget(led, 'reserve', async () => {
    recordLlmCost(3);            // estimate ran high
    adjustLlmCost(1 - 3);        // refund the difference
  });
  assert.equal(led.spentOn('reserve'), 3.25);
  assert.equal(led.spent(), 3.25);
  led.refund('bundle', 5);       // never below zero
  assert.equal(led.spentOn('bundle'), 0);
  assert.equal(led.spent(), 3.25);
});

test('live cost calibration prices token usage from finished queries, per model, with no price table', () => {
  assert.equal(usageUnits({ input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 40, cache_read_input_tokens: 1000 }), 100 + 50 + 50 + 100);
  assert.equal(usageUnits(null), 0);
  const cal = new CostCalibration();
  assert.equal(cal.estimate('m-a', { input_tokens: 1000 }), 0, 'no finished query yet → no estimate');
  cal.observe('m-a', 1, 1_000_000);          // $1 per 1M units
  cal.observe('m-b', 6, 1_000_000);          // $6 per 1M units
  assert.equal(cal.estimate('m-a', { input_tokens: 500_000 }), 0.5);
  assert.equal(cal.estimate('m-b', { output_tokens: 100_000 }), 3);
  assert.equal(cal.estimate('m-new', { input_tokens: 1_000_000 }), 3.5, 'unseen model → the pooled rate');
  cal.observe('m-a', 0, 100); cal.observe('m-a', 1, 0);   // ignored
  assert.equal(cal.rate('m-a'), 1e-6);
});

test('runAgent live spend moves during a long query and lands exactly on the SDK total', async () => {
  const cal = new CostCalibration();
  const led = new BudgetLedger(8);
  const seen: number[] = [];
  const hooked = new BudgetLedger(8, { onSpend: (v) => seen.push(Number(v.toFixed(4))) });
  // A first query finishes: nothing is estimated live (no calibration yet), its result calibrates $1 per 1M units.
  await withRunBudget(led, 'bundle', async () => {
    const t = new QueryCostTracker(cal);
    t.assistant({ type: 'assistant', message: { id: 'a1', model: 'claude-x', usage: { input_tokens: 500_000 } } });
    assert.equal(led.spent(), 0);
    t.result({ type: 'result', total_cost_usd: 1, modelUsage: { 'claude-x': { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1 } } });
    assert.equal(t.finish(), 1);
  });
  assert.equal(led.spent(), 1);
  // A long normalize-like query: every turn moves the live spend; a duplicated message id is counted once.
  await withRunBudget(hooked, 'reserve', async () => {
    const t = new QueryCostTracker(cal);
    t.assistant({ type: 'assistant', message: { id: 'b1', model: 'claude-x', usage: { input_tokens: 400_000, output_tokens: 20_000 } } });   // 0.5
    t.assistant({ type: 'assistant', message: { id: 'b1', model: 'claude-x', usage: { input_tokens: 400_000, output_tokens: 20_000 } } });   // same response
    t.assistant({ type: 'assistant', message: { id: 'b2', model: 'claude-x', usage: { input_tokens: 1_000_000 } } });                      // 1.0
    assert.equal(hooked.spent(), 1.5, 'live spend is visible before the query returns');
    t.result({ type: 'result', total_cost_usd: 2.25 });
    assert.equal(t.finish(), 2.25);
  });
  assert.equal(hooked.spent(), 2.25, 'trued up to the authoritative total');
  assert.deepEqual(seen, [0.5, 1.5, 2.25]);
  // No result (the stream threw): the recorded estimate stands as the query's cost.
  await withRunBudget(led, 'reserve', async () => {
    const t = new QueryCostTracker(cal);
    t.assistant({ type: 'assistant', message: { id: 'c1', model: 'claude-x', usage: { input_tokens: 250_000 } } });
    assert.equal(t.finish(), 0.25);
  });
  assert.equal(led.spent(), 1.25);
});

// Incremental re-scan (proposal §7): per-lane spend is attributed through the ambient context, nested node switches keep
// the lane, refunds come back off the lane, and lane spend never exceeds (it breaks down) the node totals.
test('per-lane spend: withBudgetLane attributes leaf cost to the lane; nested withBudgetNode keeps it; refunds apply', async () => {
  const { BudgetLedger, withRunBudget, withBudgetNode, withBudgetLane, recordLlmCost, adjustLlmCost } = await import('./budget.ts');
  const L = new BudgetLedger(100);
  await withRunBudget(L, 'discovery', async () => {
    recordLlmCost(1);                                               // comprehend — no lane
    await withBudgetNode('bundle', () => Promise.all([
      withBudgetLane('data-eng', async () => { recordLlmCost(2); await withBudgetNode('bundle', async () => { recordLlmCost(0.5); }); adjustLlmCost(-0.25); }),
      withBudgetLane('appsec', async () => { recordLlmCost(3); }),
    ]));
  });
  assert.equal(L.spentOnLane('data-eng'), 2.25);
  assert.equal(L.spentOnLane('appsec'), 3);
  assert.equal(L.spentOnLane('none'), 0);
  assert.equal(L.spentOn('bundle'), 5.25);
  assert.equal(L.spent(), 6.25);
  assert.deepEqual(L.nodeSpend(), { discovery: 1, bundle: 5.25, audit: 0, reserve: 0 });
});

test('reverifyAdmit (incremental re-checks): admitted past 0.80·B while cap − report reserve covers the check; unbounded always', async () => {
  const { reverifyAdmit, REPORT_STAGE_EST_USD } = await import('./budget.ts');
  const led = new BudgetLedger(20);
  led.spend('bundle', 17);                                   // 0.85·B spent by the re-run lanes (the 2026-09-29 E2E shape)
  assert.equal(led.reserveInvaded(), true, 'the OLD gate (!reserveInvaded) would have skipped every re-check here');
  assert.equal(reverifyAdmit(led, 0.4), true, '17 + 0.40 ≤ 20 − 1.50');
  led.spend('audit', 1.2);                                   // 18.2 spent
  assert.equal(reverifyAdmit(led, 0.4), false, '18.6 > 18.5 — the reports keep their reserve');
  assert.equal(reverifyAdmit(led, 0.4, 0.5), true, 'a smaller report estimate leaves room');
  // The report reserve never exceeds the 0.20·B slice (tiny caps).
  const small = new BudgetLedger(5); small.spend('bundle', 3.5);
  assert.equal(reverifyAdmit(small, 0.4, 10), true, '3.9 ≤ 5 − min(1.0, 10)');
  assert.equal(reverifyAdmit(new BudgetLedger(0), 1e9), true, 'unbounded cap: only the count cap applies');
  assert.equal(reverifyAdmit(undefined, 1), true);
  assert.equal(REPORT_STAGE_EST_USD, 1.5);
});

test('a re-check never CROSSES the reserveInvaded line the leadership / red-team gates use (B = $15)', async () => {
  const { reverifyAdmit } = await import('./budget.ts');
  const line = 15 * 0.8;                                     // $12.00 — reserveInvaded() when non-reserve spend reaches it
  const at = (usd: number): BudgetLedger => { const l = new BudgetLedger(15); l.spend('bundle', usd); return l; };
  assert.equal(reverifyAdmit(at(11.5), 0.4), true, '11.9 ≤ 12.00: inside the audit slice');
  const edge = at(11.7);
  assert.equal(reverifyAdmit(edge, 0.4), false, '12.1 would invade the reserve (the old cap − $1.50 rule admitted up to $13.50)');
  edge.spend('reserve', 2);                                  // reserve-node spend does not count toward the line
  assert.equal(edge.reserveInvaded(), false);
  assert.equal(reverifyAdmit(edge, 0.2), true, '11.7 + 0.2 non-reserve ≤ 12.00');
  // Every admitted check leaves the line uncrossed.
  const l = at(10); let n = 0;
  while (reverifyAdmit(l, 0.4) && n < 50) { l.spend('audit', 0.4); n++; }
  assert.equal(l.reserveInvaded(), false, `after ${n} checks`); assert.ok(l.spent() <= line);
  // Already invaded by the lanes: the optional report steps skip anyway — admit while the structured writer keeps $1.50.
  assert.equal(reverifyAdmit(at(12.5), 0.4), true, '12.9 ≤ 15 − 1.50');
  assert.equal(reverifyAdmit(at(13.2), 0.4), false, '13.6 > 13.50');
});

test('leadershipAuthorAdmit: a v5 author still runs on an invaded reserve when what is left covers its estimate', () => {
  const at = (spent: number): BudgetLedger => { const l = new BudgetLedger(30); l.spend('bundle', spent); return l; };
  assert.deepEqual(leadershipAuthorAdmit(at(10), true), { run: true, why: '' }, 'reserve intact');
  assert.deepEqual(leadershipAuthorAdmit(undefined, false), { run: true, why: '' }, 'no ledger');
  // umami E2E: the reserve was invaded with about $5 left of a $30 cap.
  const e2e = leadershipAuthorAdmit(at(25), true);
  assert.equal(e2e.run, true);
  assert.match(e2e.why, /reserve budget invaded \(\$25\.00 of a \$30\.00 cap spent, \$5\.00 left\) — running the v5 author anyway/);
  assert.equal(leadershipAuthorAdmit(at(25), false).run, false, 'a v0 / v4 author (~3 passes) is still skipped');
  const tight = leadershipAuthorAdmit(at(30 - V5_AUTHOR_EST_USD + 0.01), true);
  assert.equal(tight.run, false);
  assert.match(tight.why, /skipping the free-vibe leadership author \(under the v5 estimate \$1\.20\)/);
});

// Quick Ask alignment: the ask's investigate agent got only START admission (0.80·B) — one long query could run far
// past the cap. agentBudgetCap is the SDK maxBudgetUsd it now passes (and its salvage pass, at the whole cap).
test('agentBudgetCap: what is left below fraction·B, floored at $0.01; no cap without a bounded ledger', async () => {
  const { agentBudgetCap } = await import('./budget.ts');
  const led = new BudgetLedger(10);
  assert.equal(agentBudgetCap(led, 0.8), 8);
  led.spend('discovery', 0.5);
  assert.equal(agentBudgetCap(led, 0.8), 7.5);
  assert.equal(agentBudgetCap(led, 1), 9.5);
  led.spend('bundle', 9);
  assert.equal(agentBudgetCap(led, 0.8), 0.01);
  assert.equal(agentBudgetCap(new BudgetLedger(0), 0.8), undefined);
  assert.equal(agentBudgetCap(undefined, 0.8), undefined);
});
