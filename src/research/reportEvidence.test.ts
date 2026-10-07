import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactJson, capGist, evidenceCard, sanitizeReportInput } from './reportEvidence.ts';
import type { Hypothesis } from './investigation.ts';
import type { RecallReportInput } from '../recallReportHtml.ts';

// ── redactSecrets: credentials + PII are removed; technical identifiers are KEPT ──────────────────
test('redactSecrets: strips API keys / tokens / JWTs / PEM / bearer / key=value / URL creds / email / phone', () => {
  const cases: Array<[string, RegExp]> = [
    ['use sk-ant\x2dapi03-AbCdEf0123456789xyz to auth', /\[redacted-key\]/],
    ['key sk-proj-ABCDEF0123456789GHIJ here', /\[redacted-key\]/],
    ['token ghp\x5fABCDEFGHIJKLMNOP0123456789 ok', /\[redacted-token\]/],
    ['Authorization: Bearer abcdef.ghijkl.mnopqr', /Bearer \[redacted\]/],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpM', /\[redacted-jwt\]/],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', /\[redacted-key-block\]/],
    ['password = "hunter2longenough"', /password=\[redacted\]/i],
    ['x-api-key: zzzsecretvalue', /x-api-key=\[redacted\]/i],
    ['postgres://user:p4ssw0rd@host:5432/db', /postgres:\/\/\[redacted\]@/],
    ['contact alice@example.com about it', /\[redacted-email\]/],
    ['call +1 (415) 555-2671 now', /\[redacted-number\]/],
    ['aws AKI\x41IOSFODNN7EXAMPLE key', /\[redacted-aws-key\]/],
  ];
  for (const [input, expect] of cases) { assert.match(redactSecrets(input), expect, input); assert.ok(!/hunter2longenough|p4ssw0rd|alice@example/.test(redactSecrets(input)), `leaked: ${input}`); }
});

test('redactSecrets: a technical identifier / query / metric is KEPT verbatim (it is the point of the area report)', () => {
  for (const ok of ['SELECT count(*) FROM acme_rec_data.app_events', 'ZCARD candidate_pool:{user}', 'recall@100 = 0.12 vs random_chance', 'recall_step.py:42', 'two_tower_recall source']) {
    assert.equal(redactSecrets(ok), ok, ok);   // unchanged — no secret/PII in it
  }
});

test('capGist: collapses whitespace + caps with an ellipsis', () => {
  assert.equal(capGist('a   b\n c', 100), 'a b c');
  assert.equal(capGist('x'.repeat(50), 10), `${'x'.repeat(10)}…`);
  assert.equal(capGist(undefined, 10), '');
});

// ── evidenceCard: surfaces reproducible material; '' when no measurement ──────────────────────────
const hyp = (over: Partial<Hypothesis>): Hypothesis => ({ id: 'recsys-mle:h1', claim: 'recall starves diversity', symptom: 's', status: 'supported', decisiveMetric: 'm', ...over });

test('evidenceCard: cites source + query gist + grain + nulls + counterfactual', () => {
  const h = hyp({ measurement: {
    metricId: 'full_catalog_recall', value: 0.12, direction: 'higher', nulls: [{ name: 'random_chance', value: 0.001 }], source: 'warehouse:q_recall', supportsClaim: true,
    dataContract: { grain: 'request', window: '31d', dedupRule: undefined, joinKeys: ['user_id'], biases: ['logged-only'] },
    counterfactual: { state: 'run', baseline: 'popularity list', delta: '-8pp' },
    evidence: { ref: 'measurement:recsys-mle:h1', value: 0.12, source: 'warehouse:q_recall', queryHash: 'abc123def456', query: 'SELECT recall_at_100 FROM acme_rec_data.eval_runs WHERE ds >= "2024-01-01"', nulls: [{ name: 'random_chance', value: 0.001 }] },
  } });
  const card = evidenceCard(h);
  assert.match(card, /measured: 0\.12 vs \[random_chance=0\.001\]/);
  assert.match(card, /source: warehouse:q_recall \(queryHash abc123def456\)/);
  assert.match(card, /FROM acme_rec_data\.eval_runs/);   // table kept verbatim
  assert.match(card, /grain=request/);
  assert.match(card, /joinKeys=user_id/);
  assert.match(card, /counterfactual: run \(Δ -8pp vs popularity list\)/);
});

test('evidenceCard: redacts a secret that somehow appears in the query/source', () => {
  const h = hyp({ measurement: { metricId: 'm', value: 1, direction: 'higher', nulls: [], source: 'warehouse:q', supportsClaim: true,
    evidence: { ref: 'measurement:recsys-mle:h1', value: 1, source: 'warehouse:q', query: "SELECT * FROM t WHERE token = 'sk-ant\x2dapi03-LEAKEDsecret0123456789'", nulls: [] } } });
  const card = evidenceCard(h);
  assert.match(card, /\[redacted/);             // some redaction marker (the key= rule may subsume the sk- one)
  assert.ok(!/LEAKEDsecret/.test(card), 'the secret must not survive into the report surface');
});

test('redactSecrets: a legit DATE / metric / count is NOT mistaken for a phone (no over-redaction)', () => {
  for (const ok of ['ds >= "2024-01-01" and ds < "2024-02-01"', 'recall@100 = 0.12', 'count = 12345', 'window 31d']) {
    assert.equal(redactSecrets(ok), ok, ok);
  }
});

test('redactSecrets: JSON-quoted secrets + password-only connection URLs are redacted', () => {
  for (const [input, leak] of [
    ['{"token":"0123456789abcdef0123456789abcdef"}', '0123456789abcdef'],
    ['{"api_key":"AbCd1234EfGh5678IjKl"}', 'AbCd1234EfGh5678'],
    ['{"password":"hunter2longenough"}', 'hunter2longenough'],
    ['redis://:p4ssw0rdLong@localhost:6379/0', 'p4ssw0rdLong'],
  ] as const) {
    const out = redactSecrets(input);
    assert.match(out, /\[redacted/, input);
    assert.ok(!out.includes(leak), `leaked: ${input}`);
  }
});

test('redactSecrets: PREFIXED env-var/column secret names + Basic auth are redacted', () => {
  for (const [input, leak] of [
    ['DATABASE_PASSWORD=hunter2longenough', 'hunter2longenough'],
    ['OPENAI_API_KEY=AbCd1234EfGh5678IjKl', 'AbCd1234EfGh5678'],
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY', 'wJalrXUtnFEMI'],
    ['{"database_password":"hunter2longenough"}', 'hunter2longenough'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZGxvbmc=', 'dXNlcjpwYXNzd29yZGxvbmc'],
  ] as const) {
    const out = redactSecrets(input);
    assert.match(out, /\[redacted\]|redacted/, input);
    assert.ok(!out.includes(leak), `leaked: ${input}`);
  }
});

test('redactSecrets: JSON soft-key over-redaction fixed — author/token_count KEPT, token redacted', () => {
  // these merely CONTAIN token/auth as a substring → must be KEPT (they're the reproducible detail)
  for (const ok of ['{"author":"alice"}', '{"token_count":"512"}', '{"authority":"high"}', '{"oauth_provider":"google"}', '{"refresh_tokens_issued":"1234"}']) {
    assert.equal(redactSecrets(ok), ok, ok);
  }
  // a key that IS / ENDS WITH token/auth → still redacted
  assert.match(redactSecrets('{"token":"abc123secret"}'), /"token":"\[redacted\]"/);
  assert.match(redactSecrets('{"api_token":"abc123secret"}'), /"api_token":"\[redacted\]"/);
  // a token-family STRICT key anchored to END (so a metric `refresh_tokens_issued` / `access_token_count` is KEPT)
  assert.equal(redactSecrets('{"access_token_count":"5"}'), '{"access_token_count":"5"}');
  assert.match(redactSecrets('{"access_token":"abc"}'), /"access_token":"\[redacted\]"/);   // the real credential field still redacts
});

test('redactSecrets: a strict key with a BOOLEAN value is kept (`has_secret = true`)', () => {
  assert.equal(redactSecrets('WHERE has_secret = true'), 'WHERE has_secret = true');
  assert.equal(redactSecrets('is_secret = false'), 'is_secret = false');
  assert.match(redactSecrets('password = hunter2longvalue'), /password=\[redacted\]/);   // a real value still redacts
});

test('redactSecrets: Google / GitLab / Slack-app prefixed creds are redacted', () => {
  assert.match(redactSecrets('AIza' + 'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q'), /\[redacted-key\]/);
  assert.match(redactSecrets('glp' + 'at-AbCdEf0123456789XyZw'), /\[redacted-token\]/);
  assert.match(redactSecrets('xapp-1-A0123456789-abcDEF'), /\[redacted-token\]/);
  assert.match(redactSecrets('xoxe\x2d1-AbCdEf0123456789'), /\[redacted-token\]/);
});

test('redactSecrets: legit reproducible detail is KEPT (no over-redaction)', () => {
  for (const ok of [
    'pk-user-recommendation-candidates',          // a Redis/ranking key (pk- is not a secret)
    'WHERE auth = false',                          // a boolean predicate, not a credential
    'token IS NULL',                               // a column predicate
    'queryHash abc123def456',                      // a 12-hex hash
    'JOIN auth_events ON user_id',                 // an `auth`-prefixed table
  ]) assert.equal(redactSecrets(ok), ok, ok);
  // but a credential-SHAPED soft value IS redacted
  assert.match(redactSecrets('auth = abcdef0123456789xyz'), /auth=\[redacted\]/);
});

// ── sanitizeReportInput: redacts every rendered field, keeps technical identifiers ────────────────
test('sanitizeReportInput: redacts a secret echoed into a section body / table, keeps the table name', () => {
  const inp: RecallReportInput = {
    company: 'Acme', title: 't', question: 'q', meta: 'm',
    bottomLine: 'token=sk-ant\x2dapi03-LEAKED0123456789abc found',
    cards: [{ v: 'sk-ant\x2dapi03-LEAKED0123456789abc', label: 'l' }],
    sections: [{ n: '01', heading: 'h', body: 'see contact bob@corp.com', viz: { kind: 'table', head: ['source'], rows: [['acme_rec_data.events']] } }],
    decisive: 'd', recommendations: ['r'], caveats: 'c',
    answerBack: 'ab',
  };
  const out = sanitizeReportInput(inp);
  assert.ok(!/LEAKED0123456789/.test(JSON.stringify(out)), 'no secret survives anywhere');
  assert.ok(!/bob@corp\.com/.test(out.sections[0].body), 'email redacted in a body');
  assert.equal((out.sections[0].viz as { kind: 'table'; rows: string[][] }).rows[0][0], 'acme_rec_data.events', 'a table name is kept');
});

test('sanitizeReportInput: a MALFORMED model-authored viz (missing arrays) does not throw — never discards the report', () => {
  const base = { company: 'A', title: 't', question: 'q', meta: 'm', bottomLine: 'b', cards: [], decisive: 'd', recommendations: [], caveats: 'c' };
  // the LLM can emit a chart kind without its arrays (or a non-array row) — the renderer guards these, so the
  // sanitizer (which runs first, inside the writer's try) must too, or one bad chart drops the whole report.
  const bad: RecallReportInput = { ...base, sections: [
    { n: '01', heading: 'h', body: 'b', viz: { kind: 'bars' } as never },
    { n: '02', heading: 'h', body: 'b', viz: { kind: 'table', head: ['x'], rows: ['notanarray'] } as never },
  ] };
  const out = sanitizeReportInput(bad);   // must not throw
  assert.equal(out.sections.length, 2, 'both sections survive a malformed viz');
});

test('sanitizeReportInput: redacts a secret in the rendered company / meta fields', () => {
  const inp: RecallReportInput = {
    company: 'Acme token=sk-ant\x2dapi03-LEAKED0123456789abc', meta: 'contact ops@acme.com · 2024-06',
    title: 't', question: 'q', bottomLine: 'b',
    cards: [], sections: [], decisive: 'd', recommendations: [], caveats: 'c',
  };
  const out = sanitizeReportInput(inp);
  assert.ok(!/LEAKED0123456789/.test(out.company), 'secret redacted in company');
  assert.ok(!/ops@acme\.com/.test(out.meta), 'email redacted in meta');
  assert.match(out.meta, /2024-06/, 'the date in meta is kept');
});

test('evidenceCard: no measurement → empty string', () => {
  assert.equal(evidenceCard(hyp({ status: 'blocked-need-eval' })), '');
});

// ── redactJson: redact STRING LEAVES, never the serialized text (it once corrupted checkpoints) ─────────────
test('redactJson: a quoted `API_KEY=` inside a string leaf stays valid JSON (redactSecrets on the text broke it)', () => {
  const v = { h: [{ sampleRows: ['(no rows) runtime resolution of API_KEY='] }, { claim: 'The published start script', symptom: 'x' }] };
  assert.throws(() => JSON.parse(redactSecrets(JSON.stringify(v))), 'the old serialized-text path is the bug');
  const back = JSON.parse(redactJson(v));
  assert.equal(back.h.length, 2, 'structure survives');
  assert.equal(back.h[1].claim, 'The published start script');
  assert.equal(back.h[0].sampleRows[0], '(no rows) runtime resolution of API_KEY=', 'an empty value has nothing to redact');
});

test('redactJson: secrets in leaves and under credential-named keys are redacted; neutral keys are kept', () => {
  const out = redactJson({ password: 'hunter2longenough', api_token: 'abc', author: 'alice', token_count: 5, note: 'Bearer abcdefghijklmnop1234 from ops@example.com' }, 1);
  const back = JSON.parse(out);
  assert.equal(back.password, '[redacted]');
  assert.equal(back.api_token, '[redacted]');
  assert.equal(back.author, 'alice');
  assert.equal(back.token_count, 5);
  assert.ok(!/hunter2|abcdefghijklmnop1234|ops@example/.test(out), out);
});
