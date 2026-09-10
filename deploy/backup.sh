#!/usr/bin/env bash
# Timestamped Postgres dump plus storage archive, with retention. Run on the VPS.
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${DOCURAMA_BACKUP_DIR:-/opt/docurama/backups}"
RETENTION_DAYS="${DOCURAMA_BACKUP_RETENTION_DAYS:-14}"
APP_DIR="${DOCURAMA_APP_DIR:-/opt/docurama}"
PG_CONTAINER="${DOCURAMA_PG_CONTAINER:-docurama-postgres}"
PG_USER="${POSTGRES_USER:-docurama}"
PG_DB="${POSTGRES_DB:-docurama}"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping database"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[backup] archiving storage"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$APP_DIR/data/storage" .
else
  docker run --rm \
    -v docurama_docurama_storage:/data:ro \
    -v "$BACKUP_DIR":/backup \
    alpine tar czf "/backup/storage-$STAMP.tar.gz" -C /data .
fi

echo "[backup] pruning older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] complete: $BACKUP_DIR ($STAMP)"
