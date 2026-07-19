#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed or is not on PATH."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

if [ ! -f .env ] || grep -q 'replace-with-\|GENERATE_ON_FIRST_START' .env; then
  printf 'Generating unique local secrets in .env...\n'
  umask 077
  {
    printf 'JWT_SECRET=%s\n' "$(random_hex)"
    printf 'POSTGRES_PASSWORD=%s\n' "$(random_hex)"
    printf 'REDIS_PASSWORD=%s\n' "$(random_hex)"
    printf 'PAYMENT_WEBHOOK_SECRET=%s\n' "$(random_hex)"
    printf 'AUDIT_HMAC_SECRET=%s\n' "$(random_hex)"
    printf 'ADMIN_MFA_SECRET=\n'
    printf 'ADMIN_MFA_REQUIRED=false\n'
    printf 'ALLOW_MOCK_PAYMENTS=true\n'
    printf 'ENABLE_LOCAL_BOOTSTRAP=true\n'
    printf 'BOOTSTRAP_ADMIN_EMAIL=admin@casino.com\n'
    printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$(random_hex)"
    printf 'CORS_ORIGINS=http://localhost:8080\n'
    printf 'ADMIN_CORS_ORIGINS=http://localhost:8080\n'
  } > .env
  printf 'Created .env with unique local credentials. Do not commit this file.\n'
fi

if ! grep -q '^ENABLE_LOCAL_BOOTSTRAP=' .env; then printf 'ENABLE_LOCAL_BOOTSTRAP=true\n' >> .env; fi
if ! grep -q '^BOOTSTRAP_ADMIN_EMAIL=' .env; then printf 'BOOTSTRAP_ADMIN_EMAIL=admin@casino.com\n' >> .env; fi
if ! grep -q '^BOOTSTRAP_ADMIN_PASSWORD=' .env; then printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$(random_hex)" >> .env; fi

printf 'Validating configuration...\n'
docker compose --env-file .env config --quiet

printf 'Building and starting all services...\n'
if ! docker compose --env-file .env up --build --detach --wait --wait-timeout 180; then
  printf '\nStartup failed. Current service status:\n' >&2
  docker compose --env-file .env ps >&2 || true
  printf '\nRecent logs:\n' >&2
  docker compose --env-file .env logs --tail 100 >&2 || true
  exit 1
fi

printf '\nCyber Casino is ready.\n'
printf 'Player application: http://localhost:8080/\n'
printf 'Admin portal:      http://localhost:8080/admin/\n'
printf 'Local admin email: admin@casino.com\n'
printf 'Local admin password: see BOOTSTRAP_ADMIN_PASSWORD in .env\n'
printf '\nUse "docker compose --env-file .env logs -f" to follow logs.\n'
printf 'Use "docker compose --env-file .env down" to stop the stack.\n'
