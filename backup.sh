#!/usr/bin/env bash
# backup.sh — dump PostgreSQL, gzip, upload to S3, prune old local copies.
# Cron: see docs/deploy.md

set -euo pipefail

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://localhost/autoscore}"
S3_BUCKET_NAME="${S3_BUCKET_NAME:?S3_BUCKET_NAME is not set — add it to .env}"
S3_PREFIX="${S3_PREFIX:-backups/db}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups}"
KEEP_LOCAL=7

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILENAME="autoscore_${TIMESTAMP}.sql.gz"
DEST="${BACKUP_DIR}/${FILENAME}"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Dumping database…"
pg_dump "$DATABASE_URL" | gzip > "$DEST"
SIZE="$(du -sh "$DEST" | cut -f1)"
log "Dump complete: ${DEST} (${SIZE})"

S3_PATH="s3://${S3_BUCKET_NAME}/${S3_PREFIX}/${FILENAME}"
log "Uploading to ${S3_PATH}…"
aws s3 cp "$DEST" "$S3_PATH"
log "Upload complete."

OLDER="$(ls -tp "${BACKUP_DIR}"/autoscore_*.sql.gz 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))")"
if [[ -n "$OLDER" ]]; then
  echo "$OLDER" | xargs rm --
  log "Pruned old local backups."
fi

log "Done. ${S3_PATH}"
