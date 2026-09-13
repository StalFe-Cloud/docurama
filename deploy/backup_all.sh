#!/usr/bin/env bash
# Docurama Unified Nightly Backup for both Cloud SaaS and StalFe Enterprise
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RETENTION_DAYS=14

echo "=========================================================="
echo "Docurama Unified Nightly Backup: $STAMP"
echo "=========================================================="

# 1. Cloud SaaS Backup (/opt/docurama-cloud)
CLOUD_DIR="/opt/docurama-cloud/backups"
mkdir -p "$CLOUD_DIR"
echo "[Cloud] Dumping docurama_cloud database..."
docker exec docurama-cloud-postgres pg_dump -U docurama docurama_cloud | gzip > "$CLOUD_DIR/db-$STAMP.sql.gz"
echo "[Cloud] Archiving storage volume..."
docker run --rm -v docurama-cloud_docurama_cloud_storage:/data:ro -v "$CLOUD_DIR":/backup alpine tar czf "/backup/storage-$STAMP.tar.gz" -C /data .

# 2. StalFe Enterprise Backup (/opt/docurama-enterprise)
ENT_DIR="/opt/docurama-enterprise/backups"
mkdir -p "$ENT_DIR"
echo "[Enterprise] Dumping docurama database..."
docker exec docurama-enterprise-postgres pg_dump -U docurama docurama | gzip > "$ENT_DIR/db-$STAMP.sql.gz"
echo "[Enterprise] Archiving storage volume..."
docker run --rm -v docurama-enterprise_docurama_enterprise_storage:/data:ro -v "$ENT_DIR":/backup alpine tar czf "/backup/storage-$STAMP.tar.gz" -C /data .
echo "[Enterprise] Archiving signing certificates..."
tar -czf "$ENT_DIR/certs-$STAMP.tar.gz" -C /opt/docurama-enterprise/backend/certs .

# 3. Retention Cleanup (> 14 days)
echo "[Retention] Pruning backups older than $RETENTION_DAYS days..."
find "$CLOUD_DIR" -name '*.gz' -mtime +"$RETENTION_DAYS" -delete
find "$ENT_DIR" -name '*.gz' -mtime +"$RETENTION_DAYS" -delete

echo "=========================================================="
echo "[SUCCESS] Backup complete for both environments."
echo "Cloud artifacts:      $CLOUD_DIR/*-$STAMP.*"
echo "Enterprise artifacts: $ENT_DIR/*-$STAMP.*"
echo "=========================================================="
