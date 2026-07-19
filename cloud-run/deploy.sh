#!/usr/bin/env bash
set -euo pipefail

required=(PROJECT_ID REGION SERVICE_NAME ARTIFACT_REPOSITORY RUNTIME_SERVICE_ACCOUNT CLOUD_SQL_INSTANCE PGUSER PGDATABASE JWT_SECRET_NAME PGPASSWORD_SECRET_NAME REDIS_URL_SECRET_NAME PAYMENT_WEBHOOK_SECRET_NAME ADMIN_MFA_SECRET_NAME AUDIT_HMAC_SECRET_NAME)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "Missing required environment variable: ${name}" >&2; exit 1; }
done

command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI is required." >&2; exit 1; }
gcloud auth print-access-token >/dev/null 2>&1 || { echo "Run: gcloud auth login" >&2; exit 1; }

image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:$(date -u +%Y%m%d-%H%M%S)"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Building ${image}..."
gcloud builds submit --tag "${image}" .

deploy_args=(
  run deploy "${SERVICE_NAME}"
  --image "${image}"
  --region "${REGION}"
  --platform managed
  --allow-unauthenticated
  --service-account "${RUNTIME_SERVICE_ACCOUNT}"
  --port 8080
  --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}"
  --cpu 2
  --memory 2Gi
  --concurrency 40
  --timeout 300
  --min-instances 1
  --max-instances 1
  --no-cpu-throttling
  --set-env-vars "NODE_ENV=production,PGHOST=/cloudsql/${CLOUD_SQL_INSTANCE},PGUSER=${PGUSER},PGDATABASE=${PGDATABASE},PGPORT=5432,PG_POOL_MAX=4,RUN_WORKER_CONCURRENTLY=false,BACKOFFICE_URL=http://127.0.0.1:5001,LOYALTY_URL=http://127.0.0.1:5002"
  --set-secrets "JWT_SECRET=${JWT_SECRET_NAME}:latest,PGPASSWORD=${PGPASSWORD_SECRET_NAME}:latest,REDIS_URL=${REDIS_URL_SECRET_NAME}:latest,PAYMENT_WEBHOOK_SECRET=${PAYMENT_WEBHOOK_SECRET_NAME}:latest,ADMIN_MFA_SECRET=${ADMIN_MFA_SECRET_NAME}:latest,AUDIT_HMAC_SECRET=${AUDIT_HMAC_SECRET_NAME}:latest" \
  --set-env-vars "ADMIN_MFA_REQUIRED=true,ALLOW_MOCK_PAYMENTS=false"
)

if [[ -n "${VPC_NETWORK:-}" && -n "${VPC_SUBNET:-}" ]]; then
  deploy_args+=(--network "${VPC_NETWORK}" --subnet "${VPC_SUBNET}" --vpc-egress private-ranges-only)
fi

gcloud "${deploy_args[@]}"

service_url="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
gcloud run services update "${SERVICE_NAME}" \
  --region "${REGION}" \
  --update-env-vars "CORS_ORIGINS=${service_url},ADMIN_CORS_ORIGINS=${service_url}"

echo "Deployment complete: ${service_url}"
echo "Player app: ${service_url}/"
echo "Admin app:  ${service_url}/admin/"
