# Contributing

Thanks for helping improve Waggle.

## Development

```bash
npm ci
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm start                 # http://localhost:4317
```

The server runs the TypeScript sources directly with `node --experimental-strip-types` — there is no build step. That
means **erasable TypeScript only**: no `enum`, no parameter properties, no `namespace`; relative imports include the
`.ts` extension.

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run check:english
```

CI runs the same three commands on Linux. On Windows a few tests are skipped (they need a POSIX shell or permission to
create symlinks); everything else runs the same, and CI on Linux is the reference.

## Where things live

| Path | |
|---|---|
| `src/server.ts` | HTTP server, run lifecycle, connectors, settings API |
| `src/serverUi.ts` | The console (one self-contained HTML page) |
| `src/run/` | Full Scan executor, incremental re-scan, checkpoints, plane selection |
| `src/research/` | The agentic pipeline: comprehension, expert bundles, critique → expert measurement, claim audit, synthesis, report writers |
| `src/sources/` | Read-only data planes (BigQuery, MCP, repo grep, GitHub metadata, OSV, code intelligence, memory) |
| `src/orgMemory.ts`, `src/memory/` | Local memory store, recall and write tools |
| `src/telemetry.ts`, `telemetry-collector/` | Anonymous usage telemetry client and collector |
| `docs/ARCHITECTURE.md` | How the pipeline fits together |

## Guidelines

- **Read-only.** Nothing may write to a scanned repo or a connected data source.
- **Evidence or it did not happen.** A finding needs a resolvable evidence pointer; anything unsettled is an open
  question, not a finding.
- **No secrets at rest** outside the opt-in key / credential files, and never in logs, reports or telemetry.
- **Fail open.** One agent or connector failing must not sink the run; record a degraded stage instead.
- **English only.** UI, prompts, reports, tests and docs (`npm run check:english` enforces it).
- **Value-free prompts.** Expert bundles and seed patterns describe methods, never a particular company's numbers,
  names or conclusions.
- Keep comments short and about *why*.

## Telemetry changes

The telemetry payload is a public contract. Adding a field needs a change to `src/telemetry.ts`,
`telemetry-collector/schema.mjs` (the schema test checks they agree), the README table and a note in the release notes.
