import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetLedger, withRunBudget } from './budget.ts';
import { vibePolishPasses } from './vibeHtml.ts';
import { setClaudeTextRunnerForTest } from './codexAgent.ts';
import { synthesizeAudit } from './deep.ts';
import type { Hypothesis } from './investigation.ts';

// Gaps found in an end-to-end run with no OPENAI_API_KEY: the free-vibe leadership
// report skipped its reword + red-team and the synthesis fell back to its template, all with NO run.degraded row.
const collect = () => {
  const rows: string[] = [];
  return { rows, led: new BudgetLedger(100, { onDegraded: (stage, reason) => rows.push(`${stage}: ${reason}`) }) };
};

test('without OPENAI_API_KEY the reword + red-team run on Claude; no degraded row when they succeed', async () => {
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const { rows, led } = collect();
  const html = '<!doctype html><html><head></head><body><h1>Brief</h1><p>Retries cost 12% of spend.</p></body></html>';
  const labels: string[] = [];
  setClaudeTextRunnerForTest(async (o) => { labels.push(o.label ?? ''); return { text: html, costUsd: 0.01 }; });
  try {
    const r = await withRunBudget(led, 'reserve', () => vibePolishPasses(html, { label: 'leadership-vibe', degradeStage: 'leadership-writer' }, () => {}));
    assert.equal(r.reworded, true);
    assert.equal(r.redTeamed, true);
    assert.deepEqual(labels, ['leadership-reword', 'leadership-redteam']);
    assert.deepEqual(rows, [], 'a missing OpenAI key is a configuration choice, not a degradation');
  } finally { setClaudeTextRunnerForTest(undefined); if (saved !== undefined) process.env.OPENAI_API_KEY = saved; }
});

test('a failed Claude reword / red-team (no OpenAI key) still records degraded rows', async () => {
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const { rows, led } = collect();
  setClaudeTextRunnerForTest(async () => ({ text: '', costUsd: 0, error: 'boom' }));
  try {
    const r = await withRunBudget(led, 'reserve', () => vibePolishPasses('<html><body>x</body></html>', { label: 'leadership-vibe', degradeStage: 'leadership-writer' }, () => {}));
    assert.equal(r.reworded, false);
    assert.equal(r.redTeamed, false);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^leadership-writer: leadership-vibe: prose reword failed/);
    assert.match(rows[1], /^report-redteam: leadership-vibe: red-team failed/);
  } finally { setClaudeTextRunnerForTest(undefined); if (saved !== undefined) process.env.OPENAI_API_KEY = saved; }
});

test('a deterministic synthesis fallback records a synthesis degradation', async () => {
  const { rows, led } = collect();
  const h = { id: 'swe-arch:h1', claim: 'eval on config input', symptom: 's', status: 'confirmed', measurement: { value: 1, source: 'code', query: 'grep' } } as unknown as Hypothesis;
  const r = await withRunBudget(led, 'reserve', () => synthesizeAudit([h], [], { scopeDesc: 'x', budgetReached: true }));
  assert.ok(r.synthesis?.bottomLine, 'the synthesis is never left empty');
  assert.equal(rows.length, 1);
  assert.match(rows[0], /^synthesis: skipped \(run budget envelope reached\)/);
});
