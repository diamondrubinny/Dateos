#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
#
# One-command install (and update) of a NexaHeart instance on a fresh Linux server, as root:
#
#   curl -fsSL https://raw.githubusercontent.com/diamondrubinny/NexaHeart/main/scripts/bootstrap.sh \
#     | DOMAIN=example.org SMTP_HOST=smtp.example.net SMTP_USER=... SMTP_PASSWORD=... bash
#
# It installs what's missing (git, openssl, curl, Docker with Compose), clones or updates the code
# in /opt/nexaheart, generates every secret on the first run (./install.sh), writes the SMTP
# settings, opens ports 80/443 when ufw is on, builds and starts everything, waits until the API is
# ready, and sets up an encrypted daily backup. Running it again updates the code and restarts;
# secrets and data are kept.
#
# Settings (environment variables):
#   DOMAIN         required. The app on DOMAIN, the dashboard on admin.DOMAIN, the API on
#                  api.DOMAIN: all three must point at this server (A/AAAA records).
#   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_SECURE (false)
#                  where sign-in links are sent from. Needed to sign in; without them the instance
#                  starts and the settings can be added later in .env (or the dashboard's
#                  Integrations page, once someone can sign in).
#   VIDEO=1        also set up video dates (LiveKit on rtc.DOMAIN; first run only).
#   AI=1           also start the local AI (Ollama; needs about 4 GB more memory).
#   NEXAHEART_DIR  where the code lives (default /opt/nexaheart).
#   NEXAHEART_REPO (default https://github.com/diamondrubinny/NexaHeart.git)
#   NEXAHEART_REF  branch or tag to run (default main).
#   BACKUP=0       don't set up the daily backup.
#   UPDATES=0      don't set up the updater that installs updates approved in the dashboard.
#   MIN_FREE_GB    free disk space needed to build (default 10).
#   START=0        prepare only (code, secrets, settings): don't build or start, e.g. to edit .env
#                  first. Run again without it to start.
set -euo pipefail

DIR="${NEXAHEART_DIR:-/opt/nexaheart}"
REPO="${NEXAHEART_REPO:-https://github.com/diamondrubinny/NexaHeart.git}"
REF="${NEXAHEART_REF:-main}"
DOMAIN="${DOMAIN:-}"

say() { printf '\n==> %s\n' "$1"; }
warn() { printf 'Warning: %s\n' "$1" >&2; }
fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail "run as root (for example: sudo -E bash, or ssh root@server)."
[[ -n "$DOMAIN" ]] || fail "set DOMAIN, for example: DOMAIN=example.org"
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] ||
  fail "DOMAIN must be a lowercase host name like example.org (no https://, no path)."
[[ "$(uname -m)" == x86_64 || "$(uname -m)" == aarch64 ]] || warn "untested CPU: $(uname -m)."

# Writes KEY='value' into .env, replacing an existing line. Single quotes keep the value literal for
# both Docker Compose and the shell (scripts/backup.sh sources .env), so a quote can't be allowed.
set_env() {
  local key="$1" value="$2" file="$DIR/.env"
  [[ "$value" != *"'"* && "$value" != *$'\n'* ]] || fail "$key can't contain a single quote or a line break."
  local tmp
  tmp="$(mktemp "$DIR/.env.XXXXXX")"
  grep -v "^${key}=" "$file" >"$tmp" || true
  printf "%s='%s'\n" "$key" "$value" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

# ---------------------------------------------------------------- 1. packages
say "Checking packages"
install_pkgs() {
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then
    dnf install -y -q "$@"
  elif command -v yum >/dev/null; then
    yum install -y -q "$@"
  else
    fail "install $* yourself (no apt, dnf or yum here)."
  fi
}
missing=()
for tool in git openssl curl; do command -v "$tool" >/dev/null || missing+=("$tool"); done
((${#missing[@]} == 0)) || install_pkgs "${missing[@]}" ca-certificates

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker (Docker's official install script)"
  # 📘 https://docs.docker.com/engine/install/ — the convenience script installs Engine + Compose v2.
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing after installing Docker."

# Building the images needs room: stop now with a clear message rather than halfway through a build.
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
free_gb="$(df -BG --output=avail "$docker_root" 2>/dev/null | tail -n 1 | tr -dc '0-9')"
if [[ -n "$free_gb" ]] && ((free_gb < ${MIN_FREE_GB:-10})); then
  fail "only ${free_gb} GB free for Docker (${docker_root}); building needs about ${MIN_FREE_GB:-10} GB. Free some space (for example: docker builder prune -af), then run this again."
fi

# Building the images needs memory: add a swap file on small servers that have none.
mem_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if ((mem_mb < 3800)) && ! swapon --show | grep -q .; then
  say "Adding a 4 GB swap file (this server has ${mem_mb} MB of memory)"
  fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# ---------------------------------------------------------------- 2. code
if [[ -d "$DIR/.git" ]]; then
  say "Updating the code in $DIR ($REF)"
  git -C "$DIR" fetch --quiet origin "$REF"
  git -C "$DIR" checkout --quiet "$REF"
  git -C "$DIR" merge --ff-only --quiet "origin/$REF" ||
    fail "local changes in $DIR conflict with the update; resolve them, then run this again."
else
  say "Downloading NexaHeart into $DIR"
  git clone --quiet --branch "$REF" "$REPO" "$DIR"
fi
cd "$DIR"

# ---------------------------------------------------------------- 3. configuration
first_run=false
if [[ ! -f .env ]]; then
  first_run=true
  say "Generating secrets (.env, readable only by root)"
  args=(--domain "$DOMAIN")
  [[ "${VIDEO:-0}" == 1 ]] && args+=(--video)
  ./install.sh "${args[@]}" >/dev/null
else
  grep -q "^DOMAIN=${DOMAIN}$" .env || grep -q "^DOMAIN='${DOMAIN}'$" .env ||
    fail ".env is set up for another domain. Moving a running instance needs care: see docs/SELF_HOSTING.md."
fi

if [[ -n "${SMTP_HOST:-}" ]]; then
  say "Saving the email (SMTP) settings"
  set_env SMTP_HOST "$SMTP_HOST"
  set_env SMTP_PORT "${SMTP_PORT:-587}"
  set_env SMTP_SECURE "${SMTP_SECURE:-false}"
  set_env SMTP_USER "${SMTP_USER:-}"
  set_env SMTP_PASSWORD "${SMTP_PASSWORD:-}"
  set_env SMTP_FROM "${SMTP_FROM:-${DOMAIN} <no-reply@${DOMAIN}>}"
elif grep -qE "^SMTP_HOST=('?)localhost" .env; then
  warn "no SMTP settings: sign-in emails can't be sent yet. Run this again with SMTP_HOST, SMTP_USER and SMTP_PASSWORD."
fi

# ---------------------------------------------------------------- 4. network
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  say "Opening ports 80 and 443 in ufw"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi
for host in "$DOMAIN" "admin.$DOMAIN" "api.$DOMAIN"; do
  getent ahosts "$host" >/dev/null ||
    warn "$host doesn't resolve yet. Point it at this server; HTTPS certificates are issued once it does."
done

if [[ "${START:-1}" == 0 ]]; then
  printf '\nPrepared in %s (not started). Run this again without START=0 to start.\n' "$DIR"
  exit 0
fi

# ---------------------------------------------------------------- 5. start
profiles=(--profile app --profile full)
[[ "${VIDEO:-0}" == 1 || -n "$(grep -E '^RTC_DOMAIN=.+' .env || true)" ]] && profiles+=(--profile video)
[[ "${AI:-0}" == 1 ]] && profiles+=(--profile ai)
say "Building and starting (the first time takes 10 to 20 minutes)"
# The commit goes into the images, so the dashboard can tell what's new (phase 53).
GIT_COMMIT="$(git rev-parse HEAD)" \
  docker compose -f infra/docker-compose.yml --env-file .env "${profiles[@]}" up -d --build --remove-orphans

say "Waiting for the API to be ready"
ready=false
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:4000/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 10
done
if [[ "$ready" != true ]]; then
  docker compose -f infra/docker-compose.yml --env-file .env ps
  fail "the API isn't ready after 20 minutes. See: docker compose -f $DIR/infra/docker-compose.yml logs api"
fi

# Images left over from the previous version (after an update) only take space.
docker image prune -f >/dev/null 2>&1 || true

# ---------------------------------------------------------------- 6. backups
if [[ "${BACKUP:-1}" != 0 ]]; then
  key=/root/.nexaheart-backup-key
  if [[ ! -f "$key" ]]; then
    umask 077
    head -c 32 /dev/urandom | base64 >"$key"
  fi
  cat >/etc/cron.d/nexaheart-backup <<CRON
# NexaHeart: encrypted daily backup (scripts/backup.sh). Keep a copy of $key and $DIR/.env elsewhere.
17 3 * * * root cd $DIR && BACKUP_PASSPHRASE_FILE=$key ./scripts/backup.sh >>/var/log/nexaheart-backup.log 2>&1
CRON
  chmod 644 /etc/cron.d/nexaheart-backup
fi

# ---------------------------------------------------------------- 7. updates from the dashboard
# Installs updates an admin approves in the dashboard (phase 53). Does nothing until one is approved.
if [[ "${UPDATES:-1}" != 0 ]]; then
  cat >/etc/cron.d/nexaheart-update <<CRON
# NexaHeart: installs updates approved in the dashboard (scripts/update.sh). Idle otherwise.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root cd $DIR && ./scripts/update.sh >>/var/log/nexaheart-update.log 2>&1
CRON
  chmod 644 /etc/cron.d/nexaheart-update
fi

# ---------------------------------------------------------------- done
token="$(grep -E '^SETUP_TOKEN=' .env | cut -d= -f2- | tr -d "'\"")"
printf '\nNexaHeart is running.\n'
printf '  App:        https://%s\n' "$DOMAIN"
printf '  Dashboard:  https://admin.%s\n' "$DOMAIN"
printf '  API status: https://api.%s/ready\n' "$DOMAIN"
if [[ "$first_run" == true ]]; then
  printf '\nNext: open the dashboard, sign in with your email, and enter this one-time setup token\n'
  printf 'to become the first admin (it stops working once an admin exists):\n  %s\n' "$token"
fi
if [[ "${BACKUP:-1}" != 0 ]]; then
  printf '\nBackups: daily at 03:17 into %s/backups, encrypted with %s.\n' "$DIR" "$key"
  printf 'Copy that key and %s/.env somewhere safe, off this server.\n' "$DIR"
fi
printf '\nTo update later, run the same command again.\n'
printf '⚖️  Before opening to the public: docs/SELF_HOSTING.md, section 5 (legal review, retention, accessibility).\n'
