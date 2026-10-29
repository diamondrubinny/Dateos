#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
#
# Installs an update an admin approved in the dashboard (phase 53, docs/phases/PHASE-53.md).
# Runs every minute from /etc/cron.d/nexaheart-update (set up by scripts/bootstrap.sh), as root,
# from the repository root. Does nothing unless an approval is waiting. By hand:
#   cd /opt/nexaheart && ./scripts/update.sh
#
# For an approved commit it: checks the commit belongs to the update branch, backs up, fast-forwards
# the code, rebuilds and restarts, waits for /ready, and goes back to the previous commit if the new
# one doesn't come up. Every step is recorded for the dashboard.
#
#   UPDATE_READY_MINUTES  how long to wait for /ready (default 15)
#   UPDATE_DRY_RUN=1      say what would happen, change nothing (no backup, no git, no restart)
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="$(pwd)"
compose=(docker compose -f infra/docker-compose.yml --env-file .env)
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# One run at a time (cron starts one every minute; an update takes longer).
exec 9>"${TMPDIR:-/tmp}/nexaheart-update.lock"
flock -n 9 || exit 0

# Read .env as text (it isn't shell code; see scripts/backup.sh).
env_value() { sed -n "s/^$1=//p" .env | tail -n 1 | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }
POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
BRANCH="$(env_value UPDATE_BRANCH)"
BRANCH="${BRANCH:-main}"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]{1,100}$ ]] || {
  log "UPDATE_BRANCH in .env isn't a valid branch name."
  exit 1
}

# SQL through the database container. Every value placed in a statement here is either a constant,
# a validated commit (40 hex characters) or a validated UUID; the message is passed as a psql
# variable and quoted by psql itself (:'msg'), never pasted into the SQL text.
sql() { "${compose[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt -v ON_ERROR_STOP=1 "$@"; }
finish() { # id status message
  local msg="${3:0:480}"
  sql -v id="$1" -v st="$2" -v msg="$msg" <<'SQL' >/dev/null
UPDATE update_requests SET status = :'st', finished_at = now(), message = :'msg' WHERE id = :'id';
SQL
}

# The oldest waiting approval, if any. A database from before phase 53 has no table: nothing to do.
row="$(sql -c "SELECT id || ' ' || target_commit FROM update_requests WHERE status = 'pending' ORDER BY requested_at LIMIT 1" 2>/dev/null || true)"
[[ -n "$row" ]] || exit 0
id="${row%% *}"
target="${row##* }"
[[ "$id" =~ ^[0-9a-f-]{36}$ && "$target" =~ ^[0-9a-f]{40}$ ]] || {
  log "Ignoring a request that doesn't look valid."
  exit 1
}

if [[ "${UPDATE_DRY_RUN:-0}" == 1 ]]; then
  log "Dry run: would install $target (request $id) from branch $BRANCH. Nothing changed."
  exit 0
fi

claimed="$(sql -v id="$id" <<'SQL'
UPDATE update_requests SET status = 'running', started_at = now()
WHERE id = :'id' AND status = 'pending' RETURNING id;
SQL
)"
[[ -n "$claimed" ]] || exit 0 # withdrawn in the meantime
log "Installing $target (request $id)."

# 1. The commit must be on the update branch: nothing else from the database reaches git.
if ! git fetch --quiet origin "$BRANCH" 2>/dev/null; then
  finish "$id" failed "Couldn't download from GitHub. Nothing was changed."
  exit 1
fi
if ! git cat-file -e "${target}^{commit}" 2>/dev/null ||
  ! git merge-base --is-ancestor "$target" "origin/$BRANCH"; then
  finish "$id" failed "That version isn't on the $BRANCH branch. Nothing was changed."
  exit 1
fi
previous="$(git rev-parse HEAD)"
if git merge-base --is-ancestor "$target" "$previous"; then
  finish "$id" "done" "Already installed."
  exit 0
fi

# 2. A backup first. If it fails, nothing changes.
# Encrypted with the daily backup's key when the install command created one.
key="${BACKUP_PASSPHRASE_FILE:-/root/.nexaheart-backup-key}"
backup_env=()
[[ -f "$key" ]] && backup_env=(BACKUP_PASSPHRASE_FILE="$key")
if ! env "${backup_env[@]}" ./scripts/backup.sh; then
  finish "$id" failed "The backup before the update failed, so nothing was changed. See the server's backup log."
  exit 1
fi

# 3. The new code. Fast-forward only: local changes are never discarded.
if ! git merge --ff-only --quiet "$target"; then
  finish "$id" failed "The code on the server has local changes that conflict with the update. Nothing was changed."
  exit 1
fi

start() { GIT_COMMIT="$1" "${compose[@]}" "${profiles[@]}" up -d --build --remove-orphans; }
profiles=(--profile app --profile full)
grep -qE '^RTC_DOMAIN=.+' .env && profiles+=(--profile video)
"${compose[@]}" ps --services --status running 2>/dev/null | grep -qx ollama && profiles+=(--profile ai)

ready() {
  local minutes="${UPDATE_READY_MINUTES:-15}"
  for _ in $(seq 1 $((minutes * 6))); do
    curl -fsS http://127.0.0.1:4000/ready >/dev/null 2>&1 && return 0
    sleep 10
  done
  return 1
}

# 4. Build and start; 5. wait for /ready; otherwise back to the previous version.
if start "$target" && ready; then
  docker image prune -f >/dev/null 2>&1 || true
  finish "$id" "done" "Installed ${target:0:7} (was ${previous:0:7})."
  log "Done."
  exit 0
fi

log "The new version didn't become ready; going back to ${previous:0:7}."
# --keep moves the branch back without touching anything the update didn't change.
git reset --quiet --keep "$previous"
if start "$previous" && ready; then
  finish "$id" failed "The new version didn't start, so the server went back to ${previous:0:7}. The backup taken before the update is in $DIR/backups."
else
  finish "$id" failed "The new version didn't start, and the previous one didn't come back either. Check the server: docker compose -f $DIR/infra/docker-compose.yml logs api. A backup from before the update is in $DIR/backups."
fi
exit 1
