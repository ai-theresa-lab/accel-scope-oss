# CLAUDE.md

Notes for coding agents working on this repository. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Runtime**: `node --experimental-strip-types`, no build step. Erasable TypeScript only (no `enum`, parameter
  properties or `namespace`); relative imports end in `.ts`.
- **Checks before you finish**: `npm run typecheck`, `npm test`, `npm run check:english`.
- **Single-user app**: there is no login, tenant or org model. `src/localOrg.ts` holds the one workspace key; do not
  reintroduce per-user state.
- **Read-only**: agents and connectors must never write to a scanned repo or a data source. New MCP planes need a
  read-only tool allowlist.
- **Secrets**: API keys come from `src/apiKeys.ts`; connection credentials are stripped by `persistableSource` and
  only written to the opt-in 0600 files. Never log, persist into `state.json`, render into a report or send in telemetry
  any key, token or credential.
- **Telemetry** is a public contract: the payload fields are listed in `src/telemetry.ts`,
  `telemetry-collector/schema.mjs` and the README; change all three together.
- **English only** in code, prompts, UI, reports, tests and docs.
- **Prompts and expert bundles are value-free**: describe methods and checks, never a particular company's names,
  numbers or conclusions. Unit tests guard several bundle specs against client-shaped literals.
- **Fail open** inside a run (record a degraded stage with `noteDegraded` / `recordDegraded`), but an auth error stops
  the run.
- `src/serverUi.ts` is one large template with escape-heavy inline scripts — edit it with exact string replacements,
  not regex rewrites.
