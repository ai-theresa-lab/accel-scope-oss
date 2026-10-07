#!/usr/bin/env bash
# Deploy the telemetry collector to Cloud Run + BigQuery. Idempotent: every resource is described before it is
# created, so re-running only updates what changed.
#
# Required env:  PROJECT_ID, REGION
# Optional env:  SERVICE (accel-scope-telemetry), BQ_DATASET (accel_scope_telemetry), BQ_TABLE (events),
#                BQ_LOCATION (US), SA_NAME (telemetry-collector)
#
# Usage:  PROJECT_ID=my-project REGION=us-central1 bash telemetry-collector/deploy.sh
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required (no default on purpose)}"
: "${REGION:?REGION is required (no default on purpose)}"
SERVICE="${SERVICE:-accel-scope-telemetry}"
BQ_DATASET="${BQ_DATASET:-accel_scope_telemetry}"
BQ_TABLE="${BQ_TABLE:-events}"
BQ_LOCATION="${BQ_LOCATION:-US}"
SA_NAME="${SA_NAME:-telemetry-collector}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
EXCLUSION_NAME="${SERVICE}-request-logs"
PARTITION_EXPIRATION_SEC=$((400 * 24 * 3600))
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On Windows, bq may need CLOUDSDK_PYTHON pointing at a Python interpreter.
for bin in gcloud bq node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: $bin not found on PATH" >&2; exit 1; }
done

say() { printf '\n==> %s\n' "$*"; }

say "Enabling APIs"
gcloud services enable run.googleapis.com bigquery.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com logging.googleapis.com iam.googleapis.com --project "$PROJECT_ID"

say "BigQuery dataset ${PROJECT_ID}:${BQ_DATASET}"
if bq --project_id="$PROJECT_ID" show --dataset "${PROJECT_ID}:${BQ_DATASET}" >/dev/null 2>&1; then
  echo "exists"
else
  bq --project_id="$PROJECT_ID" --location="$BQ_LOCATION" mk --dataset \
    --description "Anonymous accel-scope usage telemetry" "${PROJECT_ID}:${BQ_DATASET}"
fi

say "BigQuery table ${BQ_DATASET}.${BQ_TABLE} (partitioned by receivedDate, ${PARTITION_EXPIRATION_SEC}s expiration)"
if bq --project_id="$PROJECT_ID" show "${PROJECT_ID}:${BQ_DATASET}.${BQ_TABLE}" >/dev/null 2>&1; then
  echo "exists; applying partition expiration and any additive schema changes"
  bq --project_id="$PROJECT_ID" update --time_partitioning_expiration "$PARTITION_EXPIRATION_SEC" \
    "${PROJECT_ID}:${BQ_DATASET}.${BQ_TABLE}"
  bq --project_id="$PROJECT_ID" update "${PROJECT_ID}:${BQ_DATASET}.${BQ_TABLE}" "$HERE/bq-schema.json"
else
  bq --project_id="$PROJECT_ID" mk --table \
    --schema "$HERE/bq-schema.json" \
    --time_partitioning_field receivedDate \
    --time_partitioning_type DAY \
    --time_partitioning_expiration "$PARTITION_EXPIRATION_SEC" \
    --description "accel-scope telemetry events (one row per accepted event)" \
    "${PROJECT_ID}:${BQ_DATASET}.${BQ_TABLE}"
fi

say "Service account ${SA_EMAIL}"
if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "exists"
else
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" \
    --display-name "accel-scope telemetry collector (BigQuery insert only)"
fi

say "Granting roles/bigquery.dataEditor on the dataset only (dataset ACL entry WRITER)"
TMP_ACL="$(mktemp)"
trap 'rm -f "$TMP_ACL"' EXIT
bq --project_id="$PROJECT_ID" show --format=prettyjson --dataset "${PROJECT_ID}:${BQ_DATASET}" > "$TMP_ACL"
CHANGED="$(node -e '
  const fs = require("fs");
  const [file, email] = process.argv.slice(1);
  const ds = JSON.parse(fs.readFileSync(file, "utf8"));
  ds.access = ds.access || [];
  const has = ds.access.some((a) => (a.userByEmail || "").toLowerCase() === email.toLowerCase()
    && (a.role === "WRITER" || a.role === "roles/bigquery.dataEditor"));
  if (!has) { ds.access.push({ role: "WRITER", userByEmail: email }); fs.writeFileSync(file, JSON.stringify(ds)); }
  process.stdout.write(has ? "no" : "yes");
' "$TMP_ACL" "$SA_EMAIL")"
if [ "$CHANGED" = "yes" ]; then
  bq --project_id="$PROJECT_ID" update --source "$TMP_ACL" "${PROJECT_ID}:${BQ_DATASET}"
else
  echo "already granted"
fi

# Cloud Run request logs record the client IP. Exclude this service's request logs from the _Default sink BEFORE the
# first deploy so no IP is ever written to Cloud Logging. (The collector code itself never reads the IP.)
say "Cloud Logging exclusion ${EXCLUSION_NAME} on the _Default sink"
EXCLUSION_FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND log_name:\"run.googleapis.com%2Frequests\""
EXISTING="$(gcloud logging sinks describe _Default --project "$PROJECT_ID" --format='value(exclusions[].name)' 2>/dev/null || true)"
if printf '%s' "$EXISTING" | tr ';,' '\n\n' | grep -qx "$EXCLUSION_NAME"; then
  gcloud logging sinks update _Default --project "$PROJECT_ID" \
    --update-exclusion="name=${EXCLUSION_NAME},filter=${EXCLUSION_FILTER}"
else
  gcloud logging sinks update _Default --project "$PROJECT_ID" \
    --add-exclusion="name=${EXCLUSION_NAME},description=Drop collector request logs (they contain client IPs),filter=${EXCLUSION_FILTER}"
fi

# Projects created since 2024 no longer grant the default compute service account (which `gcloud run deploy --source`
# builds with) access to the uploaded source; give it the Cloud Build builder role so the source build can run.
say "Build service account permissions"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition=None --quiet --format=none   --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role roles/cloudbuild.builds.builder

say "Deploying Cloud Run service ${SERVICE} (${REGION})"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "$HERE" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --memory 256Mi \
  --cpu 1 \
  --concurrency 80 \
  --set-env-vars "BQ_DATASET=${BQ_DATASET},BQ_TABLE=${BQ_TABLE}" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
say "Done"
echo "Collector URL: ${URL}/v1/events"
echo "Health check:  curl -s ${URL}/health"
echo "Point clients at it with THERESA_TELEMETRY_URL=${URL}/v1/events (or map a custom domain to the service)."
