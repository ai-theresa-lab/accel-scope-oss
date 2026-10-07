// Comprehend agent — the FIRST node of the read-only diagnostic pipeline. A single fresh agent that
// EXPLORES the project's artifacts (code + GCP inventory + a mounted warehouse / Slack it can probe live)
// and CLASSIFIES the system: company type, systems, value chains, the KPIs it runs on, and WHICH expert
// bundles to activate (baseline always on + the domain ones that actually fit). Its structured output is
// consumed by the next, freshly-activated nodes; this agent then ends (node-per-agent). Read-only.
//
// Value-free: it describes the PROJECT'S OWN system and picks bundles — it never invents metrics, numbers,
// or conclusions (that is the experts' job downstream). This is reading the project's artifacts to
// understand them, not baking one project's answer into a reusable pattern/metric.
import { runAgent } from './agent.ts';
import { extractJson } from './json.ts';
import { currentPlaneManifest, planeHints } from './planeManifest.ts';
import { EXPERT_BUNDLES } from './experts.ts';
import { type Capability, MAX_CAPABILITIES, parseCapabilities } from './capabilities.ts';

export interface ComprehendResult {
  companyType: string;
  systems: string[];
  valueChains: string[];
  kpis: string[];
  activatedBundles: { id: string; why: string }[];
  rationale: string;
  // The product's CAPABILITY MAP (report lens split Phase 2, research/capabilities.ts): what the product does for its
  // users, ≤ 12 items with code anchors. Validated strictly by parseCapabilities; [] for a library / tooling repo, and
  // [] when the field is missing or malformed (fail-open: the reports keep the Phase 1 area-based capabilities).
  capabilities: Capability[];
  costUsd?: number;   // this agent's spend, so the caller can fold it into the run total
}

export interface ComprehendOpts {
  root: string;
  scopeDesc: string;
  orgContext?: string;       // deterministic code/org map digest
  gcpInventory?: string;     // GCP project/dataset/table/IAM name digest (names only)
  brief?: string;            // run brief, if any
  mcpServers?: Record<string, unknown>; // warehouse + Slack tools the agent can probe live
  model?: string;
  authToken?: string;
  maxTurns?: number;
  log?: (m: string) => void;
}

export function comprehendPrompt(opts: ComprehendOpts, bundleMenu: string): string {
  return `ROLE: you are the COMPREHEND agent — the FIRST node of a read-only diagnostic pipeline. EXPLORE the
project's artifacts and CLASSIFY the system, then choose which expert bundles to activate. Output JSON only;
a fresh downstream agent consumes it. READ-ONLY: only read/search/list/query — never modify anything.

SCOPE: ${opts.scopeDesc}

CODE / ORG MAP (deterministic):
${opts.orgContext || '(org map unavailable)'}
${opts.gcpInventory ? `\nGCP INVENTORY (projects + BigQuery dataset/table names + IAM roles — the NAMES strongly signal what this company does):\n${opts.gcpInventory}\n` : ''}${opts.brief ? `\nENGAGEMENT BRIEF (operator's stated focus):\n${opts.brief}\n` : ''}
TOOLS: read-only access to the code (Read / Grep / Glob).
${planeHints('Where mounted, you also have a warehouse (list datasets / tables, run read-only SQL) and/or Slack (list channels, search).')}
Use whatever is mounted to CONFIRM what the system IS — peek at table/dataset names, key configs, event
taxonomy, channel names. Don't audit yet; just understand.

EXPERT BUNDLES you may activate (pick the ones that FIT this company):
${bundleMenu}

TASK: reconstruct the system(s), value chain(s), and the KPIs this org runs on; classify the company type;
and choose the bundles to activate, one short reason each. Activate a DOMAIN bundle only when the artifacts
show that domain is REAL here — e.g. recsys-mle when there is ranking/recall/embedding/training code;
data-eng when there are scheduled pipelines / dbt / dataform / warehouse loaders; analytics when there are
dashboards / experiments / KPI definitions; trust-safety when there is moderation / content-policy /
age-gating; swe-arch when the org's PRODUCT is primarily a codebase (a game engine, SDK, library, framework,
or large app) and the artifacts show an architectural risk surface (multi-module coupling, declared layering,
hotspots, a big legacy core); release-eng when there is real CI/build/release machinery (workflows, a build
matrix, release tags/trains, a versioned public artifact); api-stability when EXTERNAL users program against
the org's public API surface (an SDK/engine/library with releases, public headers / d.ts, a changelog);
appsec when the supply-chain / untrusted-input surface is load-bearing (dependency manifests + lockfiles,
vendored binaries, parsers of user-supplied files, or the brief raises security). product-logic when the org's
PRODUCT has USER-FACING FEATURES — routes / pages / API handlers users act through, persisted domain models (a schema /
migrations / ORM models), accounts, roles or sharing, plans or billing, customer-facing numbers — so its business rules
and application logic (limits, lifecycle states, who may see what, the numbers users are shown, retention) can be wrong
for its users; do NOT activate it for a pure library / SDK / CLI / tooling repo with no user-facing product of its own. mobile-ios when the org's PRODUCT is
a shippable iOS APP (an Xcode project / Swift app target / Info.plist / an iOS deployment target); mobile-android when
it is a shippable Android APP (a Gradle app module / AndroidManifest / applicationId / min-target SDK); activate BOTH
when both platforms are present. A mobile app is ALSO eligible for swe-arch / release-eng / appsec — compose them (the
mobile bundle owns only the platform physics: main-thread, lifecycle/memory, the store contract, permissions/exported
surface, the native↔web/foreign bridge, in-binary secrets, input-boundary crashes). A pure mobile SDK/library (no app
target / manifest / store presence) is NOT a mobile-bundle client — route it to api-stability / swe-arch. \`baseline\` is the general DATA-TRUST FLOOR (single
metric definition, cross-source agreement, explainable change, freshness, instrumentation coverage) — it is a
SELECTABLE bundle, not automatic: every domain Critique already raises data-trust issues locally, so activate
\`baseline\` ONLY when the org warrants a DEDICATED data-trust pass the domain bundles won't cover (e.g. no
domain bundle fits, or the metric-trust surface is the actual concern) — OMIT it when the activated domain
bundles already own the trust surface. A CODE-ONLY org (no warehouse / analytics / event data — e.g. an
engine or SDK vendor connected as a bare repo) must NOT be shoehorned into a data-trust narrative: prefer the
code-native bundles (swe-arch / release-eng) whose measurements come from the code index, git history, and CI/
release metadata, and omit \`baseline\` when there is no data plane for it to trust-check.
CAPABILITY MAP: also list what the PRODUCT does for its USERS — at most ${MAX_CAPABILITIES} capabilities, each a feature,
a user journey, or a platform capability users depend on. Name each in PLAIN PRODUCT LANGUAGE, the way a customer or
buyer would say it (e.g. "Sharing a dashboard", "Billing & plans") — NEVER a module, package, directory or class name.
Give each a one-sentence summary of what users get, and its ANCHORS: the repo-relative directories / files that
implement it (as seen from your working directory), plus the database tables and the routes it owns when you saw them.
Mark \`critical: true\` only for the few capabilities the business cannot run without (revenue, access, the core promise).
It describes the product, not the code's layout: several modules can serve one capability, and shared infrastructure is
not a capability unless users experience it (e.g. sign-in). For a pure library / SDK / tooling repo with no user-facing
product, return an EMPTY list — do not invent one.
VALUE-FREE: describe the project's OWN system; do NOT invent metrics, numbers, or conclusions — that is the
experts' job downstream.

Reply with EXACTLY ONE \`\`\`json block and nothing after it:
\`\`\`json
{"companyType":"<one line>",
 "systems":["<system / service>"],
 "valueChains":["<value chain step>"],
 "kpis":["<a KPI this org actually runs on>"],
 "activatedBundles":[{"id":"<bundle id you're activating>","why":"<reason>"}],
 "capabilities":[{"id":"<kebab-case-id>","name":"<plain product name>","kind":"feature|journey|platform","summary":"<one sentence: what users get>","anchors":{"paths":["<repo-relative dir or file>"],"tables":["<table>"],"routes":["<route>"]},"critical":false}],
 "rationale":"<2–3 sentences: why this classification + this bundle selection>"}
\`\`\``;
}

export async function comprehendNode(opts: ComprehendOpts): Promise<ComprehendResult | null> {
  const log = opts.log ?? (() => {});
  const bundleMenu = EXPERT_BUNDLES.map((b) => `- ${b.id}: ${b.title}`).join('\n');
  // Reflect the planes ACTUALLY mounted (not a hardcoded string) — don't claim Slack when none is
  // connected. mcpServers keys are the mounted MCP server names (warehouse / slack / redis).
  const has = (re: RegExp) => Boolean(opts.mcpServers && Object.keys(opts.mcpServers).some((k) => re.test(k)));
  // Prefer the run manifest (lists every mounted plane by name — warehouse / amplitude / acmedash / …); fall
  // back to keyword detection on the mcpServers keys for CLI paths that don't set the manifest.
  const manifest = currentPlaneManifest();
  const planes = (manifest.length
    ? ['code', opts.gcpInventory && 'GCP', ...manifest.map((p) => p.serverName)]
    : ['code', opts.gcpInventory && 'GCP', has(/warehouse|bq|sql/i) && 'warehouse', has(/slack/i) && 'Slack', has(/redis|cache|keyval/i) && 'key-value']
  ).filter(Boolean).join(' + ');
  log(`▶ comprehend · exploring ${planes} to classify the system …`);
  // Auditability: record every tool/MCP call (esp. Slack/warehouse reads) so we can SEE what it read,
  // instead of losing track of whether Slack was actually consulted.
  const toolTally: Record<string, number> = {};
  const reads: string[] = [];
  const tracer = (e: { type: 'text'; text: string } | { type: 'tool'; name: string; args: string }) => {
    if (e.type !== 'tool') return;
    toolTally[e.name] = (toolTally[e.name] ?? 0) + 1;
    if (/slack|warehouse|redis|bq|sql|query|mcp__/i.test(e.name)) reads.push(`${e.name} ${String(e.args).replace(/\s+/g, ' ').slice(0, 90)}`);
  };
  let r;
  try {
    r = await runAgent({
      cwd: opts.root, model: opts.model, authToken: opts.authToken,
      maxTurns: opts.maxTurns ?? 14, mcpServers: opts.mcpServers, label: 'comprehend',
      prompt: comprehendPrompt(opts, bundleMenu), onTrace: tracer,
    });
  } catch (e) {
    log(`  ⚠ comprehend agent failed (${e instanceof Error ? e.message : String(e)}) — caller falls back to keyword bundle match`);
    return null;
  }
  // Auditable read trace — what comprehend ACTUALLY pulled (incl. Slack/warehouse), so we never lose track.
  const tally = Object.entries(toolTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · ');
  log(`  ↳ comprehend read: ${tally || '(no tools — classified from the digest alone)'}`);
  reads.slice(0, 8).forEach((rd) => log(`     ↳ ${rd}`));
  const p = extractJson<Partial<ComprehendResult>>(r.text) ?? extractJson<Partial<ComprehendResult>>(r.allText);
  if (!p || typeof p.companyType !== 'string' || !p.companyType.trim()) {
    log('  ⚠ comprehend returned no parseable classification — caller falls back to keyword bundle match');
    return null;
  }
  const valid = new Set(EXPERT_BUNDLES.map((b) => b.id));
  const activatedBundles = (Array.isArray(p.activatedBundles) ? p.activatedBundles : [])
    .filter((b): b is { id: string; why: string } => Boolean(b) && typeof b.id === 'string' && valid.has(b.id))
    .map((b) => ({ id: b.id, why: String(b.why ?? '').trim() }));
  const res: ComprehendResult = {
    companyType: String(p.companyType).trim(),
    systems: Array.isArray(p.systems) ? p.systems.map(String) : [],
    valueChains: Array.isArray(p.valueChains) ? p.valueChains.map(String) : [],
    kpis: Array.isArray(p.kpis) ? p.kpis.map(String) : [],
    activatedBundles,
    rationale: String(p.rationale ?? '').trim(),
    capabilities: parseCapabilities((p as { capabilities?: unknown }).capabilities),
    costUsd: r.costUsd,
  };
  log(`  ↳ company type: ${res.companyType}`);
  if (res.valueChains.length) log(`  ↳ value chains: ${res.valueChains.slice(0, 6).join(' · ')}`);
  if (res.kpis.length) log(`  ↳ KPIs: ${res.kpis.slice(0, 6).join(' · ')}`);
  for (const b of res.activatedBundles) log(`  ↳ activated bundle ${b.id}: ${b.why}`);
  // The capability map, one line per capability (name · kind · critical · anchors), so the log shows what was mapped.
  const rawCaps = (p as { capabilities?: unknown }).capabilities;
  if (!res.capabilities.length) log(`  ↳ capability map: none${Array.isArray(rawCaps) && rawCaps.length ? ` (${rawCaps.length} item(s) failed validation)` : ' (no user-facing product capabilities listed)'}`);
  else {
    log(`  ↳ capability map: ${res.capabilities.length} capabilit${res.capabilities.length === 1 ? 'y' : 'ies'}${Array.isArray(rawCaps) && rawCaps.length > res.capabilities.length ? ` (${rawCaps.length - res.capabilities.length} dropped by validation)` : ''}`);
    for (const c of res.capabilities) log(`     ↳ ${c.name} · ${c.kind}${c.critical ? ' · critical' : ''} · ${[...c.anchors.paths, ...(c.anchors.routes ?? []), ...(c.anchors.tables ?? [])].slice(0, 4).join(', ')}`);
  }
  return res;
}
