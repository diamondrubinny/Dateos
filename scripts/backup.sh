#!/usr/bin/env bash
# Backup of a NexaHeart instance: the database (pg_dump, custom format) and the object storage
# (photos, voice messages, evidence). Run from the repository root, e.g. daily from cron:
#   0 3 * * * cd /opt/nexaheart && BACKUP_PASSPHRASE_FILE=/root/.nexaheart-backup-key ./scripts/backup.sh
#
#   BACKUP_DIR              where to write (default ./backups)
#   BACKUP_KEEP_DAYS        delete local backups older than this (default 14). Backups contain
#                           personal data: keep them only as long as you need (docs/PRIVACY.md).
#   BACKUP_PASSPHRASE_FILE  if set, both files are encrypted with AES-256 (openssl, PBKDF2).
#                           Strongly recommended, and required before copying backups off the server.
set -euo pipefail

cd "$(dirname "$0")/.."
compose=(docker compose -f infra/docker-compose.yml --env-file .env)
set -a
# shellcheck disable=SC1091
. ./.env
set +a

dir="${BACKUP_DIR:-./backups}"
keep="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$dir"

encrypt() {
  if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${BACKUP_PASSPHRASE_FILE}"
  else
    cat
  fi
}
suffix=""
[ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && suffix=".enc"

db_file="$dir/nexaheart-db-$stamp.dump$suffix"
files_file="$dir/nexaheart-files-$stamp.tar$suffix"

echo "Database → $db_file"
"${compose[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner | encrypt > "$db_file"

echo "Object storage → $files_file"
"${compose[@]}" exec -T seaweedfs tar -C /data -cf - . | encrypt > "$files_file"

# A dump that is empty or truncated is worse than none: fail loudly.
for f in "$db_file" "$files_file"; do
  [ -s "$f" ] || { echo "Backup file $f is empty" >&2; exit 1; }
done
if [ -z "$suffix" ]; then
  "${compose[@]}" exec -T postgres pg_restore --list < "$db_file" > /dev/null
  echo "Warning: backups are not encrypted (set BACKUP_PASSPHRASE_FILE)." >&2
fi

find "$dir" -name 'nexaheart-*' -type f -mtime "+$keep" -print -delete
echo "Done."
