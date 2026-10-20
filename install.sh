#!/usr/bin/env bash
# Dateos installer: creates .env with strong random secrets and the object-storage credentials file.
# Usage:
#   ./install.sh                          first-time setup
#   ./install.sh --force                  regenerate secrets (only when no data exists yet)
#   ./install.sh --force --reset-data     regenerate secrets AND delete all local data volumes
set -euo pipefail

cd "$(dirname "$0")"

FORCE=false
RESET_DATA=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --reset-data) RESET_DATA=true ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not installed."; }

need openssl
need docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required ('docker compose')."

if [[ -f .env && "$FORCE" != true ]]; then
  fail ".env already exists. Re-run with --force to regenerate it (this rotates all secrets)."
fi

COMPOSE=(docker compose -f infra/docker-compose.yml)
# Postgres and Redis keep the password they were initialised with, so rotating secrets
# over existing volumes would silently lock the API out of its own data.
if [[ "$FORCE" == true ]] && docker volume inspect dateos_postgres-data >/dev/null 2>&1; then
  if [[ "$RESET_DATA" != true ]]; then
    fail "existing data volumes found. New secrets would not match them. Either keep your current .env, or run './install.sh --force --reset-data' to DELETE all local data and start fresh."
  fi
  printf 'Deleting local data volumes (--reset-data)...\n'
  env_file=.env
  [[ -f "$env_file" ]] || env_file=.env.example
  "${COMPOSE[@]}" --env-file "$env_file" down -v --remove-orphans
fi

# URL-safe secrets so they can be embedded in connection strings unescaped.
secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }

POSTGRES_PASSWORD="$(secret 40)"
REDIS_PASSWORD="$(secret 40)"
S3_ACCESS_KEY_ID="$(secret 20)"
S3_SECRET_ACCESS_KEY="$(secret 40)"
AUTH_SECRET="$(secret 64)"

umask 077
# Write to a temp file first so a failed run never leaves a half-configured .env behind.
TMP_ENV="$(mktemp .env.tmp.XXXXXX)"
trap 'rm -f "$TMP_ENV"' EXIT
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://dateos:${POSTGRES_PASSWORD}@localhost:5432/dateos|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" \
  -e "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379|" \
  -e "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}|" \
  -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=${AUTH_SECRET}|" \
  .env.example > "$TMP_ENV"

if grep -qE '^[A-Z0-9_]+=.*CHANGE_ME' "$TMP_ENV"; then
  fail "internal error: generated .env still contains CHANGE_ME placeholders."
fi
mv "$TMP_ENV" .env

mkdir -p infra/data/seaweedfs
cat > infra/data/seaweedfs/s3.json <<JSON
{
  "identities": [
    {
      "name": "dateos-api",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY_ID}", "secretKey": "${S3_SECRET_ACCESS_KEY}" }],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
JSON
# The directory stays owner-only on the host; the file itself must be readable by the
# unprivileged 'seaweed' user inside the container, which sees it through the bind mount.
chmod 700 infra/data infra/data/seaweedfs
chmod 644 infra/data/seaweedfs/s3.json

printf '\nDateos is configured.\n'
printf '  Secrets written to .env and infra/data/seaweedfs/s3.json (owner-only, git-ignored).\n\n'
printf 'Next steps:\n'
printf '  pnpm install\n'
printf '  pnpm infra:up        # postgres, redis, object storage\n'
printf '  pnpm dev             # API on http://localhost:4000 (try /health and /ready)\n'
