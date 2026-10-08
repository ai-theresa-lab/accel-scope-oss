# Waggle telemetry collector

A tiny, separately deployed HTTP service that receives the anonymous usage events sent by Waggle
(`src/telemetry.ts`) and stores them in BigQuery. It is **not** part of the main app build.

- `POST /v1/events`: one JSON event per request, answered `202` when accepted.
- `GET /health`: liveness. (Cloud Run reserves paths ending in `z`, so `/healthz` only works on other hosts.)

## What the client sends (and what it never sends)

Telemetry is on by default in Waggle. On first run the app shows a notice, and users turn it off with
`THERESA_TELEMETRY=0` (also `off` / `false` / `no`, or `DO_NOT_TRACK=1`) or in Settings. Running with
`--print-telemetry` (or `THERESA_TELEMETRY_PRINT=1`) prints every payload to stderr exactly as sent.

Example payload:

```json
{
  "installId": "3f8b2c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b",
  "version": "0.0.1",
  "os": "linux",
  "arch": "x64",
  "node": 22,
  "event": "full-scan",
  "ts": "2026-10-05T14:00:00.000Z",
  "bundles": ["appsec", "swe-arch", "product-logic"],
  "connectorKinds": ["github", "warehouse"],
  "durationSec": 1834,
  "costBucket": "5-10",
  "findings": { "critical": 0, "high": 2, "medium": 5, "low": 3, "info": 1, "business": 4, "security": 3, "engineering": 4 },
  "degradedStages": ["html-qc"],
  "failedStages": [],
  "keyProvider": "anthropic",
  "outcome": "complete"
}
```

Never sent: repository names or URLs, code, file paths, questions, finding text, reports, keys or tokens, emails,
IP addresses, hostnames, usernames. The client builds every payload with a strict whitelist builder, and this
collector validates the same whitelist again.

## Schema

The validator lives in `schema.mjs`. It is kept identical to the client's schema by
`src/telemetry.schema.test.ts` in the main repo (field lists, enums and limits must match, and every
client payload must pass the collector validator unchanged).

| Field | Type | Rule |
|---|---|---|
| `installId` | string | UUID v4 (random, generated once per install; reset when the user opts out) |
| `version` | string | `^[0-9A-Za-z.+-]{1,40}$` |
| `os` / `arch` | string | `^[a-z0-9_]{1,20}$` (`process.platform` / `process.arch`) |
| `node` | int | Node.js major, 0..999 |
| `event` | string | `start` \| `quick-ask` \| `full-scan` \| `incremental` |
| `bundles` | string[] | each `^[a-z0-9-]{1,40}$`, at most 20 |
| `connectorKinds` | string[] | subset of `github, giturl, local, warehouse, keyvalue, analytics, bi, custom` |
| `durationSec` | int | 0..2592000 |
| `costBucket` | string | `0` \| `<1` \| `1-5` \| `5-10` \| `10-30` \| `30-100` \| `100+` (USD) |
| `findings` | object | ints 0..100000 keyed by `critical, high, medium, low, info, business, security, engineering` |
| `degradedStages` / `failedStages` | string[] | each `^[a-z0-9-]{1,40}$`, at most 20 |
| `keyProvider` | string | `anthropic` \| `anthropic+openai` \| `claude-subscription` \| `claude-subscription+openai` \| `unknown` |
| `outcome` | string | `complete` \| `error` \| `stopped` (optional) |
| `ts` | string | ISO timestamp on the hour (`YYYY-MM-DDTHH:00:00.000Z`) |

Required: `installId, version, os, arch, node, event, ts`. Unknown top-level fields and unknown `findings` keys are
dropped. A known field with an invalid value rejects the event with `400` (the error message never echoes the value).

Stored row (`bq-schema.json`): the fields above plus `receivedDate` (DATE, server-side UTC date of receipt). The table
is partitioned by `receivedDate` with a 400-day partition expiration, so rows age out automatically.

## Privacy guarantees

- **No IP addresses.** The code never reads the client address (`req.socket`, `x-forwarded-for`, ...) and reads no
  request header other than `content-type` and `content-length`; a test in `server.test.mjs` enforces this on the
  source. Cloud Run's own request logs do record client IPs, so `deploy.sh` adds a Cloud Logging **exclusion** on the
  `_Default` sink for this service's request logs
  (`resource.type="cloud_run_revision" AND resource.labels.service_name="<svc>" AND log_name:"run.googleapis.com%2Frequests"`)
  before the first deploy. Excluded entries are not stored.
- **No bodies in logs.** The service logs counts and error names only.
- **Whitelisted storage.** Only the fields in the table above reach BigQuery.
- **Least privilege.** The service runs as a dedicated service account with only `roles/bigquery.dataEditor` on the
  telemetry dataset (no project-level roles).
- **Bounded retention.** 400-day partition expiration.

## Abuse limits

- Request body at most 4 KB (`413`), `content-type: application/json` only (`415`), JSON object only (`400`).
- In-memory rate limit: 60 events per install id per hour and 1200 events per minute per instance (`429`);
  tune with `RATE_PER_INSTALL_HOUR` / `RATE_GLOBAL_MINUTE`. Limits are per instance (max 3 instances).
- Rows are batched to BigQuery every 5 s or 200 rows, with one retry using the same `insertId` (BigQuery
  best-effort dedupe). Pending rows are flushed on `SIGTERM`. Because Cloud Run throttles CPU between requests,
  the 5-second check also runs on every incoming request.

## Deploy

Prerequisites: `gcloud`, `bq` and `node` on PATH, authenticated as someone who can create Cloud Run services,
service accounts, BigQuery datasets and logging exclusions in the target project.

```bash
PROJECT_ID=<your-project> REGION=<region> bash telemetry-collector/deploy.sh
```

Optional: `SERVICE` (default `accel-scope-telemetry`), `BQ_DATASET` (`accel_scope_telemetry`), `BQ_TABLE`
(`events`), `BQ_LOCATION` (`US`), `SA_NAME` (`telemetry-collector`).

The script is idempotent (describe before create) and, in order:

1. enables the needed APIs;
2. creates the dataset and the `receivedDate`-partitioned table (400-day expiration), or updates expiration and
   applies additive schema changes;
3. creates the service account and grants it `WRITER` (= `roles/bigquery.dataEditor`) on the dataset only;
4. adds (or updates) the `_Default` sink exclusion for the service's request logs;
5. deploys to Cloud Run from source: `--allow-unauthenticated --min-instances 0 --max-instances 3 --memory 256Mi
   --concurrency 80`.

Then point clients at it: either map your domain to the service so the client's `DEFAULT_TELEMETRY_URL` resolves,
or set `THERESA_TELEMETRY_URL=https://<service-url>/v1/events`.

Run locally (writes to BigQuery through Application Default Credentials):

```bash
cd telemetry-collector && npm install && BQ_DATASET=accel_scope_telemetry PORT=8080 npm start
```

## Tests

No network or BigQuery needed (a fake writer is injected):

```bash
cd telemetry-collector && node --test
# or from the repo root:
node --test "telemetry-collector/**/*.test.mjs"
```

Note: on Node 22, `node --test telemetry-collector/` treats the directory as a module entry rather than a test
folder, so use one of the forms above.

## Example queries

Replace `PROJECT.accel_scope_telemetry.events` with your table. These work as custom queries in Looker Studio too
(add a date-range parameter on `receivedDate` to keep scans partition-pruned).

Weekly active installs:

```sql
SELECT DATE_TRUNC(receivedDate, WEEK(MONDAY)) AS week,
       COUNT(DISTINCT installId)              AS active_installs
FROM `PROJECT.accel_scope_telemetry.events`
WHERE receivedDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 26 WEEK)
GROUP BY week
ORDER BY week;
```

Events by type per day:

```sql
SELECT receivedDate, event, COUNT(*) AS events, COUNT(DISTINCT installId) AS installs
FROM `PROJECT.accel_scope_telemetry.events`
WHERE receivedDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY receivedDate, event
ORDER BY receivedDate, event;
```

Cost bucket distribution for finished scans:

```sql
SELECT event, costBucket, COUNT(*) AS runs,
       ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY event), 1) AS pct
FROM `PROJECT.accel_scope_telemetry.events`
WHERE receivedDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  AND event IN ('quick-ask', 'full-scan', 'incremental')
  AND costBucket IS NOT NULL
GROUP BY event, costBucket
ORDER BY event,
  CASE costBucket WHEN '0' THEN 0 WHEN '<1' THEN 1 WHEN '1-5' THEN 2 WHEN '5-10' THEN 3
                  WHEN '10-30' THEN 4 WHEN '30-100' THEN 5 ELSE 6 END;
```

Most-used bundles and most frequently degraded stages:

```sql
SELECT b AS bundle, COUNT(*) AS runs
FROM `PROJECT.accel_scope_telemetry.events`, UNNEST(bundles) AS b
WHERE receivedDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY bundle ORDER BY runs DESC;

SELECT s AS stage, COUNT(*) AS runs
FROM `PROJECT.accel_scope_telemetry.events`, UNNEST(degradedStages) AS s
WHERE receivedDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY stage ORDER BY runs DESC;
```
