// The product-logic bundle (Phase 2): business rules & application logic. These
// tests pin its registration, its default report lens, when it activates, and the GENERALIZATION-FIRST mandate — the
// shipped spec is methods + the product's own declared rule as the null, never one product's features, paths or tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPERT_BUNDLES, bundlesFor, mergedPatterns, resolveBundles } from './experts.ts';
import { productLogic } from './domainBundles.ts';
import { BL_INVARIANTS, invariantByKey } from './invariants.ts';
import { PRODUCT_LOGIC_PATTERNS, PROBLEM_PATTERNS, patternsFor } from './patterns.ts';
import { defaultLens, lensFor } from '../findingLens.ts';
import { comprehendPrompt } from './comprehend.ts';
import { findingArea } from '../findingIds.ts';

// Every string the bundle ships into a prompt or a verdict.
function specText(): string {
  const inv = BL_INVARIANTS.map((i) => `${i.title} ${i.aim} ${i.playbook}`).join('\n');
  const metrics = productLogic.metricLibrary.map((m) => `${m.title} ${m.question} ${m.definition}`).join('\n');
  const pats = PRODUCT_LOGIC_PATTERNS.map((p) => `${p.title} ${p.smell} ${p.question} ${p.decisiveTest} ${p.why}`).join('\n');
  return [productLogic.title, productLogic.lens, metrics, pats, inv].join('\n');
}

test('product-logic registers like the code-native bundles: 7 patterns, bl1–bl4 owner-tagged, ≥ 10 metrics, triage', () => {
  assert.ok(EXPERT_BUNDLES.some((b) => b.id === 'product-logic'), 'in the registry');
  assert.equal(productLogic.title, 'Business rules & application logic');
  assert.equal(productLogic.patterns, PRODUCT_LOGIC_PATTERNS);
  assert.equal(PRODUCT_LOGIC_PATTERNS.length, 7);
  for (const p of PRODUCT_LOGIC_PATTERNS) assert.ok(PROBLEM_PATTERNS.includes(p), `${p.id} is in the seed bank`);
  assert.deepEqual(productLogic.structuralChecks.map((i) => i.key), ['bl1', 'bl2', 'bl3', 'bl4']);
  for (const i of BL_INVARIANTS) { assert.equal(i.owner, 'product-logic'); assert.equal(i.mount, 'bundle'); assert.equal(invariantByKey(i.key), i, `${i.key} resolves`); }
  assert.ok(productLogic.metricLibrary.length >= 10);
  assert.equal(new Set(productLogic.metricLibrary.map((m) => m.id)).size, productLogic.metricLibrary.length, 'unique metric ids');
  assert.equal(productLogic.triage('a customer-facing number computed differently from its label'), 'displayed_metric_label_parity');
  assert.ok(!productLogic.alwaysOn, 'selectable, never forced');
  // Composes with the other bundles: its Critique also carries the cross-cutting trust patterns, de-duped.
  const ids = mergedPatterns([productLogic]).map((p) => p.id);
  assert.ok(ids.includes('business-rule-parity') && ids.includes('cross-source-metric-disagreement'));
  assert.equal(ids.length, new Set(ids).size);
});

test('the seven checks the lens owns: rule parity · states · access vs product rules · numbers · boundaries · apply-once · switches', () => {
  const lens = productLogic.lens;
  for (const k of ['RULE PARITY', 'STATE COMPLETENESS', 'ACCESS vs PRODUCT RULES', 'CUSTOMER-FACING NUMBERS', 'TIME & MONEY BOUNDARIES', 'APPLY-ONCE', 'SWITCHES', 'DATA LIFECYCLE']) assert.ok(lens.includes(k), k);
  assert.match(lens, /NULL is ALWAYS the product's OWN declared rule/);
  assert.match(lens, /READ-ONLY reconciliation of code against code; never probe a live endpoint/, 'defensive: no live probing');
  assert.match(lens, /leave authentication \/ isolation hardening to the security bundles/, 'security lens stays with appsec / saas-tenancy');
  assert.match(lens, /Import no number from this text/);
});

test('default report lens is BUSINESS (a product-logic finding is the Leadership brief\'s subject)', () => {
  assert.equal(defaultLens('product-logic'), 'business');
  assert.equal(lensFor({ id: 'PRODUCT-LOGIC:H1', source: 'recommendation-audit' }), 'business');
  assert.equal(findingArea({ id: 'PRODUCT-LOGIC:H2', invariant: undefined })?.key, 'product-logic', 'its own group heading');
});

test('activation: a product with user-facing features, not a library — keyword fallback + Comprehend guidance', () => {
  const has = (t: string): boolean => bundlesFor(t).some((b) => b.id === 'product-logic');
  assert.ok(has('Where does the business logic behave wrong — sharing links, data retention, the numbers customers see?'));
  assert.ok(has('subscription billing with plan limits and invoices'));
  assert.ok(!has('a generic crud backend with a postgres db'), 'no product signal, no activation');
  assert.ok(!has('a tiny promise concurrency limiter library published to npm'), 'a pure library never activates it');
  assert.deepEqual(patternsFor('a generic crud backend with a postgres db'), [], 'its patterns keep the seed bank quiet on non-product text');
  assert.ok(resolveBundles(['product-logic']).some((b) => b.id === 'product-logic'));
  const p = comprehendPrompt({ root: '.', scopeDesc: 's' }, EXPERT_BUNDLES.map((b) => `- ${b.id}: ${b.title}`).join('\n'));
  assert.match(p, /- product-logic: Business rules & application logic/, 'on the bundle menu');
  assert.match(p, /product-logic when the org's\nPRODUCT has USER-FACING FEATURES/);
  assert.match(p, /do NOT activate it for a pure library \/ SDK \/ CLI \/ tooling repo/);
});

// GENERALIZATION-FIRST (the mobile bundles' generalization mandate, applied here). A per-product blacklist would
// itself have to commit the names it bans; instead the spec is barred, mechanically, from every SHAPE a project-specific literal
// takes: a file path, a route, a snake_case / camelCase code identifier, a quoted table name, a URL, a version number.
// Metric ids and null names are snake_case by design and are not scanned (they are keys, not prose).
test('the spec carries no project-specific literal: no path, route, code identifier, URL, number or secret shape', () => {
  const hay = specText();
  const banned: [RegExp, string][] = [
    [/\b[\w-]+\/[\w-]+\.(ts|tsx|js|jsx|py|rb|go|java|kt|swift|sql|prisma|php|cs)\b/i, 'a file path'],
    [/(^|\s)\/(api|v\d|app|admin|share|auth)\//i, 'a route'],
    [/\b[a-z]+_[a-z0-9_]+\b/, 'a snake_case identifier'],
    [/\b[a-z]+[A-Z][a-zA-Z]+\b/, 'a camelCase identifier'],
    [/https?:\/\//i, 'a URL'],
    [/\b\d{2,}\b/, 'a number (a threshold is the product\'s own, never ours)'],
    [/\b(sk|pk)_(live|test)_|\bgh[opsu]_|AIza[0-9A-Za-z_-]{10,}/, 'a secret shape'],
  ];
  for (const [re, what] of banned) {
    const m = hay.match(re);
    assert.equal(m, null, `product-logic spec must embed no ${what}; matched: ${m?.[0]}`);
  }
});

test('every product-logic metric reconciles two surfaces (an overlay), never a naked count', () => {
  const cues = ['vs', '×', 'reconcil', 'diff', 'declared', 'intersection', 'never a count', 'not a count', 'overlay'];
  for (const m of productLogic.metricLibrary) {
    const d = m.definition.toLowerCase();
    assert.ok(cues.some((c) => d.includes(c)), `${m.id} must state its overlay: ${m.definition.slice(0, 80)}…`);
  }
  for (const p of PRODUCT_LOGIC_PATTERNS) assert.match(p.decisiveTest, /Null = /, `${p.id} names its null`);
});
