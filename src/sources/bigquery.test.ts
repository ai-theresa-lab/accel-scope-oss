import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bqSelectOnly } from './bigquery.ts';

// Locks down the read-only guarantee of the in-process BigQuery MCP: run_sql must accept a single SELECT/WITH
// and reject every write / DDL / multi-statement / scripting form. The read-only SA is the hard guarantee; this
// is the syntactic fail-closed gate on top of it. (Mirrors the standalone bq-mcp.mjs guard.)
test('bqSelectOnly: a single SELECT / WITH passes (normalized)', () => {
  assert.equal(bqSelectOnly('SELECT 1'), 'SELECT 1');
  assert.equal(bqSelectOnly('  select a from ds.t where x=1 '), 'select a from ds.t where x=1');
  assert.equal(bqSelectOnly('WITH x AS (SELECT 1) SELECT * FROM x'), 'WITH x AS (SELECT 1) SELECT * FROM x');
  assert.equal(bqSelectOnly('SELECT 1;'), 'SELECT 1');                       // trailing semicolon stripped
  assert.equal(bqSelectOnly('-- c\nSELECT 1 /* x */'), 'SELECT 1');          // comments stripped
});

test('bqSelectOnly: writes / DML / DDL are rejected', () => {
  for (const q of ['DROP TABLE ds.t', 'DELETE FROM ds.t', 'UPDATE ds.t SET a=1', 'INSERT INTO ds.t VALUES(1)',
    'MERGE ds.t USING ds.s ON a=b WHEN MATCHED THEN DELETE', 'CREATE TABLE ds.t AS SELECT 1', 'TRUNCATE TABLE ds.t',
    'ALTER TABLE ds.t ADD COLUMN c INT64', 'CALL ds.proc()']) {
    assert.throws(() => bqSelectOnly(q), /read-only|SELECT \/ WITH/i, q);
  }
});

test('bqSelectOnly: multi-statement / a write hidden after a SELECT is rejected', () => {
  assert.throws(() => bqSelectOnly('SELECT 1; DROP TABLE ds.t'), /single statement/i);
  assert.throws(() => bqSelectOnly('SELECT 1; DELETE FROM ds.t;'), /single statement/i);
});

test('bqSelectOnly: a write disguised behind a comment, and empty input, are rejected', () => {
  assert.throws(() => bqSelectOnly('/* SELECT */ DROP TABLE ds.t'), /read-only/i);
  assert.throws(() => bqSelectOnly('   '), /empty/i);
  assert.throws(() => bqSelectOnly('-- only a comment'), /empty/i);
});
