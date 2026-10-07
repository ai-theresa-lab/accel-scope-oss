// Run-scoped MANIFEST of the read-only data planes mounted for this run (server name + kind + a one-line
// "what it exposes"). Carried via AsyncLocalStorage — like mcpPolicy.ts (the security allowlist) and the budget/
// audit recorders — so the prompt-builders scattered across the pipeline (comprehend / critique / orchestrate /
// derive / scout) can DESCRIBE each plane correctly WITHOUT threading a param through every signature.
//
// Why this exists: several broad-scan prompts historically hardcoded "a read-only WAREHOUSE SQL plane is
// mounted (mcp__warehouse__*)" gated on `Boolean(mcpServers)`. Once we also mount Amplitude (analytics) or a
// BI dashboard (bi), that is WRONG — the agent would treat a product-analytics plane as warehouse SQL and
// mis-use it. `planeHints()` replaces those lines with an accurate per-plane description.
//
// This is DESCRIPTION only — NOT a security boundary (that's mcpPolicy.ts) and NOT routing (that is the Expert's
// MeasurePlane registry). Empty outside a run context → callers fall back to their legacy hint string.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface PlaneInfo {
  serverName: string;   // the mounted MCP server name → tools are mcp__<serverName>__<tool>
  kind: string;         // warehouse | keyvalue | analytics | bi | custom | box | …
  exposes: string;      // one-line, human: "product analytics: event taxonomy, funnels, retention, DAU"
}

// Canonical one-line "what it exposes" descriptions for the standard read-only planes — shared by the console
// org-run (server.ts) and the accel-mini CLI so both describe a plane identically. Custom MCPs (Amplitude, a
// product dashboard) supply their own `exposes` inline at mount.
export const PLANE_EXPOSES = {
  warehouse: 'BigQuery / warehouse SQL — list datasets/tables, run read-only SELECT / INFORMATION_SCHEMA / JOBS to compute metrics, reconcile sources, profile distributions, inspect cost & freshness',
  keyvalue: 'serving cache / key-value — candidate-pool sizes (ZCARD), set membership, key freshness (read-only)',
  slack: 'Slack — list channels, search messages (read-only)',
  box: 'read-only box queries (run_on_box) — prod Redis READS only (ZCARD/ZRANGE/SCAN/TTL/HGETALL/GET/SMEMBERS; never write/del/expire), BigQuery `bq query` read-only SELECT (never DML/DDL), and box-local file reads',
  repogrep: 'GitHub repo-grep (on-demand, read-only) — list/grep/read files in an org repo NOT in the mounted clone (e.g. acme/mobile-app) via the GitHub REST API: repo_list to discover repos, repo_grep (code-search, default branch) to find content, repo_read to fetch one file (any branch/sha)',
  orgmemory: "org durable knowledge (read + write) — memory_recall to search this org's existing facts (hybrid keyword+semantic; call before writing to avoid duplicating/contradicting), memory_write to record a VERIFIED durable fact (new facts added directly, reinforcements append-merged; every write logged + revertable in the Memory tab)",
  codeintel: 'codebase intelligence over the cloned workspace (repowise index — pre-computed, deterministic, read-only) — get_overview (architecture map + entry points; the cheap first call), get_context (per-file/module/symbol triage: summary, callers/callees, ownership, hotspot bit), get_symbol (exact source of one symbol), get_risk (hotspots, dependents, co-change partners, test gaps), get_health (defect-calibrated 1-10 per file + worst files), get_dead_code, list_repos; workspace mode adds get_blast_radius / get_architecture / get_conformance (cross-repo impact + service graph + cycles). Its STATIC signals (structure, complexity, god-class, dead-code, dependency/call graph) are reliable on any repo; its GIT-BEHAVIORAL signals (hotspot score, churn, co-change) are only trustworthy on an actively-developed repo with conventional-commit history — treat them as low-confidence otherwise, never as proof of health. Do NOT call get_answer / search_codebase / get_why — the LLM wiki was not built (index-only), they return nothing',
  repometa: 'GitHub repo METADATA (read-only REST; works tokenless on public repos at a tight rate budget) — meta_workflows (discover CI workflows), meta_runs (workflow-run history: conclusion, run_attempt, timing → pass rate / retry-to-green / duration trend), meta_checks (check conclusions on one ref → was a merge green at merge time), meta_releases (releases + tags with dates → cadence / version discipline), meta_commits (commit log: author, date, headline → reverts, hotfix clusters, ownership), meta_compare (files changed between two tags/refs, optional clipped patches → public-API churn / breaking-change classification between releases), meta_pulls (PR merge metadata → lead time). The code-native measurement plane for CI/release-engineering + API-stability metrics',
  osv: 'OSV.dev known-vulnerability advisory lookup (public, read-only, defensive) — osv_querybatch (locked {ecosystem,name,version} packages → advisory ids per package; resolve the versions from the clone\'s lockfiles FIRST), osv_vuln (one advisory\'s detail: severity, affected ranges, FIXED versions → security-fix adoption lag). Inventory only — never exploitation',
} as const;

const als = new AsyncLocalStorage<PlaneInfo[]>();

// undefined → no-op (inherit whatever manifest is already in scope; the CLI paths never set one → empty).
// ANY array — including [] — ENTERS that exact manifest, so a nested call (e.g. the fail-open invariant-floor
// fallback that rebuilds a DIFFERENT mcpServers set) can OVERRIDE an outer manifest instead of inheriting planes
// it does not actually mount. [] therefore means "this scope mounts no planes" (→ planeHints falls back to legacy).
export function withPlaneManifest<T>(planes: PlaneInfo[] | undefined, fn: () => Promise<T>): Promise<T> {
  return planes ? als.run(planes, fn) : fn();
}

export function currentPlaneManifest(): PlaneInfo[] { return als.getStore() ?? []; }

// A prompt block describing the mounted read-only data planes. When the manifest is set (a console org-run),
// it lists every plane by `mcp__<server>__*` + what it exposes. When NOT set (a CLI path that builds mcpServers
// without the run ALS), returns the caller's `legacy` string so existing single-plane prompts keep working.
export function planeHints(legacy = ''): string {
  const planes = currentPlaneManifest();
  if (!planes.length) return legacy;
  const lines = planes.map((p) => `  • mcp__${p.serverName}__* — ${p.exposes}`).join('\n');
  return `READ-ONLY DATA PLANES mounted for this run (all read-only; pick the right one per question):\n${lines}`;
}
