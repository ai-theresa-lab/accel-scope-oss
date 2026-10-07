// Shared fixture for the report-lens-split tests (findingLens / executionLens / leadershipLens .test.ts): a run with
// business, security and engineering findings, two synthesis areas and one open question per lens.
import { labelFindings } from './findingLens.ts';
import { executionGroups } from './executionModel.ts';
import type { SynthesisArea } from './research/deep.ts';
import type { CoverageGap, Finding } from './schema.ts';

export const F = (id: string, title: string, o: Partial<Finding> = {}): Finding => ({
  id, dimension: 'product_metrics', title, claim: `${title} — claim`, evidence: [{ kind: 'computation', ref: `code:src/${id.toLowerCase().replace(/[^a-z0-9]/g, '')}.ts:10`, detail: 'd' }],
  businessImpact: 'impact', recommendation: 'fix it', severity: 'medium', confidence: 'high', effort: 'moderate', source: 'recommendation-audit', ...o,
});
export const findings: Finding[] = [
  F('DATA-ENG:H1', 'checkout totals double count', { severity: 'high' }),
  F('ANALYTICS:H2', 'retention metric defined two ways'),
  F('APPSEC:H1', 'tenant token readable by any tenant', { severity: 'low', effort: 'quick_win' }),
  F('APPSEC:H2', 'secret in CI logs', { severity: 'critical', evidence: [{ kind: 'metric', ref: 'warehouse:audit.logs', detail: '3 rows' }] }),
  F('SAAS-TENANCY:H1', 'cross-tenant cache key', { severity: 'low', effort: 'project' }),
  F('RELEASE-ENG:H1', 'release build not pinned'),
  F('SWE-ARCH:H3', 'Ruled-out state machine race', { severity: 'info' }),
  F('I1-0', 'events arrive late', { source: 'baseline', invariant: 'i1' }),
];
export const areas: SynthesisArea[] = [
  { key: 'checkout', name: 'Checkout & billing', verdict: 'critical', framing: 'x', owner: 'o', basis: ['data-eng:h1', 'appsec:h1'] },
  { key: 'metrics', name: 'Retention reporting', verdict: 'risk', framing: 'y', owner: 'o', basis: ['analytics:h2', 'analytics:h9'] },
];
export const gaps: CoverageGap[] = [
  { id: 'ANALYTICS:H9', concern: 'cohort window unclear', whyUnsettled: 'u', nextDecisiveTest: 'n', source: 'recommendation-audit', status: 'unmeasured', hypothesisId: 'analytics:h9' },
  { id: 'APPSEC:H4', concern: 'SBOM missing', whyUnsettled: 'u', nextDecisiveTest: 'n', source: 'recommendation-audit', status: 'budget_skipped', hypothesisId: 'appsec:h4', bundleId: 'appsec' },
];
export const labelled = (): Finding[] => labelFindings(findings, { groups: executionGroups(findings, gaps, areas) });
