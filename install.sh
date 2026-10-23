#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
# NexaHeart installer: creates .env with strong random secrets and the object-storage credentials file.
# Usage:
#   ./install.sh                          first-time setup (local development)
#   ./install.sh --domain example.org     production: app on example.org, dashboard on
#                                         admin.example.org, API on api.example.org
#   ./install.sh --domain example.org --video
#                                         also set up video dates (LiveKit on rtc.example.org)
#   ./install.sh --force                  regenerate secrets (only when no data exists yet)
#   ./install.sh --force --reset-data     regenerate secrets AND delete all local data volumes
set -euo pipefail

cd "$(dirname "$0")"

FORCE=false
RESET_DATA=false
VIDEO=false
DOMAIN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true ;;
    --reset-data) RESET_DATA=true ;;
    --video) VIDEO=true ;;
    --domain)
      [[ $# -ge 2 ]] || { printf 'Missing value for --domain\n' >&2; exit 2; }
      DOMAIN="$2"; shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
# A plain host name only: it ends up in URLs, CORS rules and the web server configuration.
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  printf 'Invalid --domain: use a host name like example.org (lowercase, no scheme or path).\n' >&2
  exit 2
fi

fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
if [[ "$VIDEO" == true && -z "$DOMAIN" ]]; then
  printf 'Use --video together with --domain (video needs HTTPS and a public address).\n' >&2
  exit 2
fi
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
if [[ "$FORCE" == true ]] && docker volume inspect nexaheart_postgres-data >/dev/null 2>&1; then
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
SETUP_TOKEN="$(secret 32)"
LIVEKIT_API_KEY="API$(secret 12)"
LIVEKIT_API_SECRET="$(secret 48)"
# Encrypts secrets saved in the dashboard's Integrations page (phase 24).
INTEGRATIONS_KEY="$(openssl rand -hex 32)"

umask 077
# Write to a temp file first so a failed run never leaves a half-configured .env behind.
TMP_ENV="$(mktemp .env.tmp.XXXXXX)"
trap 'rm -f "$TMP_ENV"' EXIT
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://nexaheart:${POSTGRES_PASSWORD}@localhost:5432/nexaheart|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" \
  -e "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379|" \
  -e "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}|" \
  -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=${AUTH_SECRET}|" \
  -e "s|^SETUP_TOKEN=.*|SETUP_TOKEN=${SETUP_TOKEN}|" \
  -e "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=${LIVEKIT_API_KEY}|" \
  -e "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}|" \
  -e "s|^INTEGRATIONS_KEY=.*|INTEGRATIONS_KEY=${INTEGRATIONS_KEY}|" \
  .env.example > "$TMP_ENV"

if [[ -n "$DOMAIN" ]]; then
  sed -i.bak \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    -e "s|^TRUST_PROXY=.*|TRUST_PROXY=true|" \
    -e "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" \
    -e "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://api.${DOMAIN}|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://${DOMAIN},https://admin.${DOMAIN}|" \
    -e "s|^SMTP_FROM=.*|SMTP_FROM=\"${DOMAIN} <no-reply@${DOMAIN}>\"|" \
    "$TMP_ENV"
  rm -f "$TMP_ENV.bak"
fi
if [[ "$VIDEO" == true ]]; then
  sed -i.bak \
    -e "s|^LIVEKIT_URL=.*|LIVEKIT_URL=wss://rtc.${DOMAIN}|" \
    -e "s|^RTC_DOMAIN=.*|RTC_DOMAIN=rtc.${DOMAIN}|" \
    "$TMP_ENV"
  rm -f "$TMP_ENV.bak"
fi

if grep -qE '^[A-Z0-9_]+=.*CHANGE_ME' "$TMP_ENV"; then
  fail "internal error: generated .env still contains CHANGE_ME placeholders."
fi
mv "$TMP_ENV" .env

mkdir -p infra/data/seaweedfs
cat > infra/data/seaweedfs/s3.json <<JSON
{
  "identities": [
    {
      "name": "nexaheart-api",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY_ID}", "secretKey": "${S3_SECRET_ACCESS_KEY}" }],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
JSON
# LiveKit (docker compose --profile video). Rooms are created only by the API (auto_create off),
# so a join token can't reopen a call that was ended; one room holds two people.
mkdir -p infra/data/livekit
cat > infra/data/livekit/livekit.yaml <<YAML
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
room:
  auto_create: false
  max_participants: 2
  empty_timeout: 60
  departure_timeout: 20
webhook:
  api_key: ${LIVEKIT_API_KEY}
  urls:
    - http://api:4000/v1/livekit/webhook
logging:
  level: warn
YAML
chmod 700 infra/data/livekit
chmod 644 infra/data/livekit/livekit.yaml

# The directory stays owner-only on the host; the file itself must be readable by the
# unprivileged 'seaweed' user inside the container, which sees it through the bind mount.
chmod 700 infra/data infra/data/seaweedfs
chmod 644 infra/data/seaweedfs/s3.json

printf '\nNexaHeart is configured.\n'
printf '  Powered by NexaHeart · Open source · https://nexaheart.com (AGPL-3.0-or-later, see NOTICE).\n'
printf '  Secrets written to .env and infra/data/seaweedfs/s3.json (owner-only, git-ignored).\n\n'
printf 'Next steps:\n'
if [[ -n "$DOMAIN" ]]; then
  printf '  1. Point DNS for %s, admin.%s and api.%s at this server (ports 80 and 443 open).\n' "$DOMAIN" "$DOMAIN" "$DOMAIN"
  printf '  2. Set SMTP_HOST / SMTP_USER / SMTP_PASSWORD in .env (sign-in links are sent by email).\n'
  printf '  3. docker compose -f infra/docker-compose.yml --env-file .env --profile app --profile full up -d --build\n'
  printf '  4. Open https://admin.%s, sign in, and claim the instance with the token below.\n' "$DOMAIN"
  if [[ "$VIDEO" == true ]]; then
    printf '  Video dates: also point DNS for rtc.%s here, open TCP 7881 and UDP 7882, add\n' "$DOMAIN"
    printf '     --profile video to the command in step 3, then turn them on in the dashboard.\n'
  fi
  printf '  Full guide: docs/SELF_HOSTING.md\n'
else
  printf '  pnpm install\n'
  printf '  pnpm infra:up        # postgres, redis, object storage\n'
  printf '  pnpm dev             # API on http://localhost:4000 (try /health and /ready)\n'
fi
printf '\nClaim your instance: sign in to the moderation dashboard and enter this one-time setup token:\n'
printf '  %s\n' "$SETUP_TOKEN"
printf '(It is also in .env as SETUP_TOKEN. It stops working once the first admin exists.)\n'
