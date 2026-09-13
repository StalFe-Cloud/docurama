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
AGE_IDENTITY="${DOCURAMA_BACKUP_AGE_IDENTITY_FILE:-}"

have() { command -v "$1" >/dev/null 2>&1; }

# resolve_input: return a decrypted copy of $1 when it is an age artifact.
resolve_input() {
  local f="$1"
  if [ -f "$f.age" ]; then
    if [ -z "$AGE_IDENTITY" ]; then
      echo "$f.age exists but DOCURAMA_BACKUP_AGE_IDENTITY_FILE is not set" >&2
      exit 1
    fi
    have age || { echo "'age' is required to decrypt $f.age" >&2; exit 1; }
    f="$f.age"
    local out="/tmp/$(basename "${f%.age}")"
    age -d -i "$AGE_IDENTITY" -o "$out" "$f"
    echo "$out"
  else
    echo "$f"
  fi
}

DB_ARTIFACT="$(resolve_input "$BACKUP_DIR/db-$STAMP.sql.gz")"
STORAGE_ARTIFACT="$(resolve_input "$BACKUP_DIR/storage-$STAMP.tar.gz")"
[ -f "$DB_ARTIFACT" ] || { echo "missing $BACKUP_DIR/db-$STAMP.sql.gz(.age)" >&2; exit 1; }
[ -f "$STORAGE_ARTIFACT" ] || { echo "missing $BACKUP_DIR/storage-$STAMP.tar.gz(.age)" >&2; exit 1; }

echo "[restore] stopping the API so nothing writes mid-restore"
docker compose -f "$APP_DIR/docker-compose.yml" stop docurama-api

echo "[restore] resetting database schema"
# A restore replaces the database rather than merging into it; psql without
# ON_ERROR_STOP would carry on after errors and report success on a partial load.
docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "[restore] restoring database"
gunzip -c "$DB_ARTIFACT" | docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"

echo "[restore] restoring storage"
STORAGE_BASENAME="$(basename "$STORAGE_ARTIFACT")"
STORAGE_DIR_HOST="$(dirname "$STORAGE_ARTIFACT")"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -xzf "$STORAGE_ARTIFACT" -C "$APP_DIR/data/storage"
else
  docker run --rm \
    -v docurama_docurama_storage:/data \
    -v "$STORAGE_DIR_HOST":/backup:ro \
    alpine sh -c "tar xzf /backup/$STORAGE_BASENAME -C /data"
fi

echo "[restore] starting the API"
docker compose -f "$APP_DIR/docker-compose.yml" up -d docurama-api

echo "[restore] verifying readiness"
sleep 10
# The published entrypoint is the frontend proxy on host port 3002; the API's own
# port 8000 is internal to the compose network. Gated on /readyz, which answers
# 503 while the signing certificate is missing or expired - a restore that
# brought back a broken certificate must not be declared a success.
HEALTH_URL="${DOCURAMA_HEALTH_URL:-http://127.0.0.1:3002/readyz}"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    echo "[restore] healthy at $HEALTH_URL"
    echo "[restore] complete"
    exit 0
  fi
  sleep 10
done
echo "health check failed after restore; investigate before touching anything else" >&2
exit 1
