# Architecture

accel-scope is one Node process: an HTTP server (`src/server.ts`) that serves the console (`src/serverUi.ts`) and runs
the analysis pipeline in-process. State lives under the data dir (`THERESA_DATA_DIR`, default `./.data`):
`state.json` (connections without credentials, run history), `reports/` (report HTML and per-run sidecars),
`lineage/` and `org-findings/` (incremental re-scan), `org-projects/` and `org-facts/` (cross-project memory),
`memory/` (memory cards), plus the opt-in `keys.json`, `settings.json` and `telemetry.json`.

## Two layers

1. **Deterministic evidence** (no LLM): git history mining, repository structure, committed-secret scan, org-level
   aggregation (`src/miners/`, `src/org.ts`).
2. **Agentic research** (Claude Agent SDK, read-only tools): agents investigate the cloned workspace and the
   connected data planes and pose / measure / verify hypotheses (`src/research/`).

## Full Scan pipeline

```text
workspace (clone repos @ pinned SHAs, copy folders)
  → Comprehend      classify the system, choose expert bundles, map the product's capabilities
  → per bundle, in parallel:
        Critique    pose evidence-seeded, falsifiable problems through the bundle's lens
        Preflight   lint the plan (what to measure, on which plane)
        Expert      measure each problem against code and data planes → verdicts + mitigations
  → Claim audit     adversarially re-check every claim against the workspace
  → Synthesis       group verdicts into themes and a bottom line
  → Findings        deterministic Finding contract (evidence-gated)
  → Reports         Leadership brief (LLM-written, QC-checked) + Execution report (deterministic)
```

- **Expert bundles** (`src/research/experts.ts`, `domainBundles.ts`) pair a critique lens and seed patterns with a
  measurement library. Built-in bundles cover application security and supply chain, architecture and code health,
  release engineering, API stability, business logic, data trust, analytics, mobile apps, multi-tenancy and
  recommendation systems. Bundles are value-free: they describe methods, never one company's answers.
- **Measure planes** are read-only MCP servers mounted into the agents: the workspace itself, BigQuery / SQL warehouse,
  key-value (Redis), any read-only MCP server, GitHub metadata (`repometa`), OSV advisories (public-only scans by
  default), code intelligence (optional repowise index) and memory recall.
- **Budget**: a per-run ledger (`src/research/budget.ts`) attributes every LLM call's cost; past 80% of the cap it
  stops starting new work. Optional late stages skip themselves when the remaining budget cannot cover them.
- **Fail open**: a failed agent or connector records a *degraded stage* on the run and the pipeline continues.
- **Checkpoints** (`src/checkpoints.ts`): every stage boundary writes a self-consistent checkpoint, so a failed or
  stopped run can be resumed as a new child run that replays the cached stages.

## Incremental re-scan

After the clone, a Full Scan looks up the previous scan of the same target set (`src/scanLineage.ts`) and plans
(`src/run/incremental.ts`): unchanged code replays the previous findings at no cost; a changed lane whose recorded read
set touched only a few changed files runs a focused *delta* critique; everything else re-runs. Baseline findings are
carried forward as fixed / persisting / changed with deterministic rules (`src/run/carryForward.ts`,
`src/sinceLastScan.ts`), and a finding is only called fixed when its code actually changed.

## Quick Ask

One investigate agent over exactly the selected repos, folders and data planes (`src/research/scopedInvestigate.ts`),
with a tool-free salvage pass when it runs out of turns or budget, an evidence gate against the workspace, and a
deterministic report template.

## Memory

A local card store (`src/orgMemory.ts`): typed cards (metric definitions, known mistakes, playbooks, …) with a version
history and revert. Runs recall relevant cards as *prior context to re-verify*, never as evidence; a run writes cards
only when its "save learnings" box is ticked. Cross-project facts (`src/orgFacts.ts`, `src/factExtract.ts`) are derived
from every completed Full Scan and power the Memory tab's comparison view and the optional sibling-contrast recall.

## Reports

- **Execution** (`src/reportHtml.ts`, `src/executionModel.ts`): every finding with its evidence, fix, expected effect,
  "done when" and "how to verify"; ruled-out checks and open questions in the appendix; `REMEDIATION.md` export for a
  coding agent.
- **Leadership** (`src/research/leadershipWriter.ts`, `leadershipVibe.ts`): a short brief written by a model under a
  rubric-checked contract; a capability map and citations into the Execution report are injected deterministically.
- Reports are served under a strict CSP in a sandboxed frame (`sendReportHtml` in `src/server.ts`).

## Keys and providers

`src/apiKeys.ts` resolves the Anthropic and OpenAI keys (environment / `.env` / Settings). Every agent runs on Claude.
With an OpenAI key, report writers and QC judges try OpenAI first (`src/research/htmlWriter.ts`, `codexAgent.ts`,
`openai.ts`) and fall back to Claude on any failure; without one they use Claude directly.
