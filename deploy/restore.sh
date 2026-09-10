#!/usr/bin/env bash
# Restore from a backup stamp produced by backup.sh. Run on the VPS.
# Stops the API before touching data, and refuses to run without a stamp.
set -euo pipefail

STAMP="${1:?usage: ./restore.sh <stamp, e.g. 20260910T120000Z>}"
BACKUP_DIR="${DOCURAMA_BACKUP_DIR:-/opt/docurama/backups}"
APP_DIR="${DOCURAMA_APP_DIR:-/opt/docurama}"
PG_CONTAINER="${DOCURAMA_PG_CONTAINER:-docurama-postgres}"
PG_USER="${POSTGRES_USER:-docurama}"
PG_DB="${POSTGRES_DB:-docurama}"

DB_DUMP="$BACKUP_DIR/db-$STAMP.sql.gz"
STORAGE_TAR="$BACKUP_DIR/storage-$STAMP.tar.gz"
[ -f "$DB_DUMP" ] || { echo "missing $DB_DUMP" >&2; exit 1; }
[ -f "$STORAGE_TAR" ] || { echo "missing $STORAGE_TAR" >&2; exit 1; }

echo "[restore] stopping the API so nothing writes mid-restore"
docker compose -f "$APP_DIR/docker-compose.yml" stop docurama-api

echo "[restore] restoring database"
gunzip -c "$DB_DUMP" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"

echo "[restore] restoring storage"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -xzf "$STORAGE_TAR" -C "$APP_DIR/data/storage"
else
  docker run --rm \
    -v docurama_docurama_storage:/data \
    -v "$BACKUP_DIR":/backup:ro \
    alpine sh -c "tar xzf /backup/storage-$STAMP.tar.gz -C /data"
fi

echo "[restore] starting the API"
docker compose -f "$APP_DIR/docker-compose.yml" up -d docurama-api

echo "[restore] verifying health"
sleep 10
curl -fsS "http://127.0.0.1:8000/api/health" | grep '"status": "healthy"' || {
  echo "health check failed after restore; investigate before touching anything else" >&2
  exit 1
}
echo "[restore] complete"
