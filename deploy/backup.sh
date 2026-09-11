#!/usr/bin/env bash
# Timestamped Postgres dump plus storage archive, with retention. Run on the VPS.
# Artifacts are written to .tmp and moved into place only after success, so a
# failed run can never leave a partial file that restore would later trust.
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
TMP_DUMP="$BACKUP_DIR/db-$STAMP.sql.gz.tmp"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$TMP_DUMP"
mv "$TMP_DUMP" "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[backup] archiving storage"
TMP_TAR="$BACKUP_DIR/storage-$STAMP.tar.gz.tmp"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -czf "$TMP_TAR" -C "$APP_DIR/data/storage" .
else
  docker run --rm \
    -v docurama_docurama_storage:/data:ro \
    -v "$BACKUP_DIR":/backup \
    alpine tar czf "/backup/storage-$STAMP.tar.gz.tmp" -C /data .
fi
mv "$TMP_TAR" "$BACKUP_DIR/storage-$STAMP.tar.gz"

echo "[backup] pruning older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.tmp' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] complete: $BACKUP_DIR ($STAMP)"
