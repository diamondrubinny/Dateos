#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh. This REPLACES the current data.
#   ./scripts/restore.sh backups/nexaheart-db-<stamp>.dump[.enc] [backups/nexaheart-files-<stamp>.tar[.enc]]
#   RESTORE_DATABASE  database to restore into (default: POSTGRES_DB). Restore into a new name first
#                     to test a backup without touching the live data.
#   BACKUP_PASSPHRASE_FILE  needed for .enc files.
#   YES=1             skip the confirmation prompt.
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f infra/docker-compose.yml --env-file .env)
set -a
# shellcheck disable=SC1091
. ./.env
set +a

db_file="${1:?usage: restore.sh <db dump> [files tar]}"
files_file="${2:-}"
target="${RESTORE_DATABASE:-$POSTGRES_DB}"

decrypt() {
  case "$1" in
    *.enc) openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}" < "$1" ;;
    *) cat "$1" ;;
  esac
}

echo "This replaces the data in database '$target'${files_file:+ and ALL stored files}."
if [ "${YES:-}" != "1" ]; then
  read -r -p "Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
fi

"${compose[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$target\"" 2>/dev/null || true
decrypt "$db_file" | "${compose[@]}" exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$target" \
  --clean --if-exists --no-owner --exit-on-error
echo "Database restored into '$target'."

if [ -n "$files_file" ]; then
  "${compose[@]}" stop seaweedfs
  "${compose[@]}" run --rm --no-deps -T --entrypoint sh seaweedfs -c 'rm -rf /data/* && tar -C /data -xf -' \
    < <(decrypt "$files_file")
  "${compose[@]}" start seaweedfs
  echo "Files restored."
fi
