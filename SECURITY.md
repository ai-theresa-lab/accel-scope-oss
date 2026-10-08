# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repository) and include steps to reproduce. We aim to acknowledge reports
within 3 working days and to ship a fix or mitigation for confirmed issues as quickly as their severity requires.

## Scope and threat model

Waggle is a **single-user, self-hosted** app:

- The console has no login. It binds to `127.0.0.1` by default; exposing it to a network without your own
  authentication in front of it gives anyone who can reach the port your API keys' spending power and your reports.
  Reports of "unauthenticated access" to an instance deliberately exposed that way are out of scope.
- Agents are read-only by construction: the Agent SDK tool policy allows reading and searching files inside the
  scanned workspace and read-only queries against connected data planes (`SELECT`-only BigQuery, read-only MCP tool
  allowlists). An agent writing outside its workspace, reaching a data plane the run did not select, or escaping the
  read-only policy is in scope.
- Scanned code is untrusted input. Reports are model-authored HTML from that input and are served under a strict
  Content-Security-Policy in a sandboxed frame; a report that can run script with access to the console, make network
  requests, or navigate the top-level page is in scope.
- API keys and connection credentials must never be written to `state.json`, logs, reports or telemetry. Keys saved on
  purpose go to `<data dir>/keys.json` / connection credentials to their own file, both with mode 0600.
- Telemetry must never contain anything beyond the documented fields (see README → Privacy and telemetry).

## Supported versions

Security fixes are made on the latest release.
