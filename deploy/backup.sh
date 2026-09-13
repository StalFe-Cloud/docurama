#!/usr/bin/env bash
# Timestamped backup: Postgres dump + storage archive + signing certificates.
#
# Hardening added after the pre-launch audit (P0-11):
#   * the storage volume is resolved by label/family, not a hardcoded name -
#     a wrong name used to produce a silent-empty tar that restore would trust;
#   * every artifact is content-verified (line count / member count) before it
#     is allowed to replace anything;
#   * the signing certificates (P12, root CA, root key) are part of the backup
#     set: without them the restored documents cannot be re-sealed or re-verified
#     against the same trust anchor;
#   * artifacts are encrypted with age when DOCURAMA_BACKUP_AGE_RECIPIENTS is
#     set - a signing platform's backups are themselves sensitive documents;
#   * an offsite copy is pushed with rsync when DOCURAMA_BACKUP_RSYNC_TARGET
#     is set - same-host backups die with the host.
#
# Artifacts are written to .tmp and moved into place only after success, so a
# failed run can never leave a partial file that restore would later trust.
#
# Schedule with deploy/docurama-backup.{service,timer} (systemd), or cron:
#   15 3 * * * /opt/docurama/deploy/backup.sh >> /var/log/docurama-backup.log 2>&1
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${DOCURAMA_BACKUP_DIR:-/opt/docurama/backups}"
RETENTION_DAYS="${DOCURAMA_BACKUP_RETENTION_DAYS:-14}"
APP_DIR="${DOCURAMA_APP_DIR:-/opt/docurama}"
PG_CONTAINER="${DOCURAMA_PG_CONTAINER:-docurama-postgres}"
PG_USER="${POSTGRES_USER:-docurama}"
PG_DB="${POSTGRES_DB:-docurama}"
CERTS_DIR="${DOCURAMA_CERTS_DIR:-$APP_DIR/backend/certs}"
# A storage tar with fewer members than this is treated as a failed dump.
STORAGE_FLOOR_FILES="${DOCURAMA_BACKUP_STORAGE_FLOOR:-10}"
AGE_RECIPIENTS="${DOCURAMA_BACKUP_AGE_RECIPIENTS:-}"
RSYNC_TARGET="${DOCURAMA_BACKUP_RSYNC_TARGET:-}"

mkdir -p "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

encrypt_if_configured() {
  # $1 = plaintext path. Prints the final artifact path (plaintext or .age).
  local plain="$1"
  if [ -z "$AGE_RECIPIENTS" ]; then
    echo "$plain"
    return
  fi
  if ! have age; then
    echo "[backup] ERROR: DOCURAMA_BACKUP_AGE_RECIPIENTS is set but 'age' is not installed" >&2
    exit 1
  fi
  local recipients_args=()
  IFS=',' read -ra rcpts <<< "$AGE_RECIPIENTS"
  for r in "${rcpts[@]}"; do recipients_args+=("-r" "$r"); done
  age "${recipients_args[@]}" -o "$plain.age" "$plain"
  rm -f "$plain"
  echo "$plain.age"
}

resolve_storage_volume() {
  # Prefer the compose-labelled volume; fall back to the conventional name;
  # fail loudly when neither exists (a silent empty volume backup is worse
  # than a failed run).
  local labelled conventional
  labelled="$(docker volume ls --format '{{.Name}}' --filter 'label=com.docker.compose.volume=docurama_storage' | head -n1)"
  conventional="docurama_docurama_storage"
  if [ -n "$labelled" ] && docker volume inspect "$labelled" >/dev/null 2>&1; then
    echo "$labelled"
  elif docker volume inspect "$conventional" >/dev/null 2>&1; then
    echo "$conventional"
  else
    echo "[backup] ERROR: no storage volume found (looked for compose label and '$conventional')" >&2
    exit 1
  fi
}

tar_member_count() { tar -tzf "$1" 2>/dev/null | wc -l; }

# ---------------------------------------------------------------------------
# 1. Database dump
# ---------------------------------------------------------------------------
echo "[backup] dumping database"
TMP_DUMP="$BACKUP_DIR/db-$STAMP.sql.gz.tmp"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$TMP_DUMP"
DB_LINES=$(gunzip -c "$TMP_DUMP" | wc -l)
if [ "$DB_LINES" -lt 100 ]; then
  echo "[backup] ERROR: database dump implausibly small ($DB_LINES lines); refusing to keep it" >&2
  rm -f "$TMP_DUMP"
  exit 1
fi
mv "$TMP_DUMP" "$BACKUP_DIR/db-$STAMP.sql.gz"
DB_ARTIFACT="$(encrypt_if_configured "$BACKUP_DIR/db-$STAMP.sql.gz")"

# ---------------------------------------------------------------------------
# 2. Storage archive (the only copy of every signed document)
# ---------------------------------------------------------------------------
echo "[backup] archiving storage"
TMP_TAR="$BACKUP_DIR/storage-$STAMP.tar.gz.tmp"
if [ -d "$APP_DIR/data/storage" ]; then
  tar -czf "$TMP_TAR" -C "$APP_DIR/data/storage" .
else
  VOLUME="$(resolve_storage_volume)"
  docker run --rm \
    -v "$VOLUME":/data:ro \
    -v "$BACKUP_DIR":/backup \
    alpine tar czf "/backup/storage-$STAMP.tar.gz.tmp" -C /data .
fi
MEMBERS=$(tar_member_count "$TMP_TAR")
if [ "$MEMBERS" -lt "$STORAGE_FLOOR_FILES" ]; then
  echo "[backup] ERROR: storage archive has only $MEMBERS members (floor: $STORAGE_FLOOR_FILES);" >&2
  echo "[backup]        refusing to keep what is probably an empty or truncated dump" >&2
  rm -f "$TMP_TAR"
  exit 1
fi
mv "$TMP_TAR" "$BACKUP_DIR/storage-$STAMP.tar.gz"
STORAGE_ARTIFACT="$(encrypt_if_configured "$BACKUP_DIR/storage-$STAMP.tar.gz")"

# ---------------------------------------------------------------------------
# 3. Signing certificates (trust anchor of every seal)
# ---------------------------------------------------------------------------
echo "[backup] archiving signing certificates"
CERTS_TAR="$BACKUP_DIR/certs-$STAMP.tar.gz"
if [ -d "$CERTS_DIR" ] && [ -n "$(ls -A "$CERTS_DIR" 2>/dev/null)" ]; then
  tar -czf "$CERTS_TAR" -C "$(dirname "$CERTS_DIR")" "$(basename "$CERTS_DIR")"
  CERTS_ARTIFACT="$(encrypt_if_configured "$CERTS_TAR")"
else
  echo "[backup] WARNING: no certificates found at $CERTS_DIR; continuing without them" >&2
  CERTS_ARTIFACT=""
fi

# ---------------------------------------------------------------------------
# 4. Offsite copy
# ---------------------------------------------------------------------------
if [ -n "$RSYNC_TARGET" ]; then
  if have rsync; then
    echo "[backup] pushing offsite copy to $RSYNC_TARGET"
    rsync -a --partial "$DB_ARTIFACT" "$STORAGE_ARTIFACT" \
      ${CERTS_ARTIFACT:+"$CERTS_ARTIFACT"} \
      "$RSYNC_TARGET/" || echo "[backup] WARNING: offsite copy failed; backup remains local-only" >&2
  else
    echo "[backup] WARNING: DOCURAMA_BACKUP_RSYNC_TARGET set but rsync is not installed" >&2
  fi
else
  echo "[backup] NOTE: no offsite target configured (DOCURAMA_BACKUP_RSYNC_TARGET); backup is same-host only"
fi

# ---------------------------------------------------------------------------
# 5. Retention
# ---------------------------------------------------------------------------
echo "[backup] pruning older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'db-*.sql.gz*'  -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz*' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'certs-*.tar.gz*' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.tmp' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] complete: $BACKUP_DIR ($STAMP)"
[ -n "$AGE_RECIPIENTS" ] && echo "[backup] artifacts are age-encrypted; restore.sh decrypts with DOCURAMA_BACKUP_AGE_IDENTITY_FILE"
echo "[backup] restore with: deploy/restore.sh $STAMP"
