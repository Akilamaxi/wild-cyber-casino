#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${SQL_INSTANCE_NAME:?Set SQL_INSTANCE_NAME (the Cloud SQL instance name, not connection string)}"

POLICY_NAME="${CLOUD_ARMOR_POLICY:-casino-edge-security}"
gcloud config set project "$PROJECT_ID" >/dev/null

# Encrypted automated backups, PITR, and a 30-backup retention window.
gcloud sql instances patch "$SQL_INSTANCE_NAME" --quiet \
  --backup-start-time="${BACKUP_START_TIME:-02:00}" \
  --enable-point-in-time-recovery \
  --retained-backups-count=30 \
  --retained-transaction-log-days=7

if ! gcloud compute security-policies describe "$POLICY_NAME" >/dev/null 2>&1; then
  gcloud compute security-policies create "$POLICY_NAME" --description="Casino edge bot and abuse controls"
fi

# General abuse limit plus stricter authentication endpoint protection.
gcloud compute security-policies rules update 2147483647 --security-policy="$POLICY_NAME" --action=allow
gcloud compute security-policies rules create 1000 --security-policy="$POLICY_NAME" \
  --expression="request.path.matches('/api/(v1/)?auth/.*')" \
  --action=throttle --rate-limit-threshold-count=20 --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP
gcloud compute security-policies rules create 2000 --security-policy="$POLICY_NAME" \
  --expression="request.path.startsWith('/api/')" \
  --action=throttle --rate-limit-threshold-count=300 --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP

printf 'Security policy %s is ready. Attach it to the external HTTPS load balancer backend service.\n' "$POLICY_NAME"
printf 'Disable the default Cloud Run URL after the load balancer is verified to prevent bypass.\n'
