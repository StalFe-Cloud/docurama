#!/bin/sh
# Actions-free deploy for the VPS Docurama stacks (GitHub Actions billing is
# exhausted; CI validation happens locally per the e2e recipe, deploys happen
# over SSH with this script).
#
# Usage: deploy-vps.sh <workdir> <compose-project> <health-port> <git-ref>
#   deploy-vps.sh /opt/docurama-cloud docurama-cloud 3002 origin/quality
#   deploy-vps.sh /opt/docurama-enterprise docurama-enterprise 3003 d106c71
#
# CRITICAL: db/custom.db is a TRACKED file in these repos, but on the VPS it
# is the LIVE production database. A bare `git checkout -f` overwrites it with
# the committed seed and destroys production data (this happened 2026-09-21 —
# recovered from backup, ~1h of writes lost). This script always snapshots the
# db, restores it after checkout, and health-gates the rollout.
set -eu

WORKDIR=$1; PROJECT=$2; PORT=$3; REF=$4
TS=$(date +%Y%m%d-%H%M%S)

cd "$WORKDIR"
[ -f db/custom.db ] || { echo "FATAL: $WORKDIR/db/custom.db not found"; exit 1; }

BRANCH=$(git branch --show-current)
[ -n "$BRANCH" ] || BRANCH=deploy
OLD_REF=$(git rev-parse --short HEAD)

echo "[deploy] $PROJECT: $OLD_REF -> $REF (branch $BRANCH)"
mkdir -p backups
cp db/custom.db "backups/pre-deploy-$TS.db"
cp db/custom.db /tmp/custom.db.deploy-protect

git fetch origin
git checkout -f -B "$BRANCH" "$REF"

# Restore the live db over whatever the checkout wrote, and drop any stale
# WAL/SHM sidecars from the previous database instance.
rm -f db/custom.db-wal db/custom.db-shm
cp /tmp/custom.db.deploy-protect db/custom.db
rm -f /tmp/custom.db.deploy-protect
chown 10001:10001 db/custom.db

echo "[deploy] building image..."
docker compose -p "$PROJECT" build 2>&1 | tail -2
docker compose -p "$PROJECT" up -d 2>&1 | tail -1

echo "[deploy] health gate on :$PORT"
OK=0
i=0
while [ $i -lt 30 ]; do
  if curl -sf -m 5 "http://127.0.0.1:$PORT/api/health" | grep -q '"status":"ok"'; then
    OK=1; break
  fi
  i=$((i + 1)); sleep 3
done

if [ "$OK" = 1 ]; then
  echo "[deploy] OK at $(git rev-parse --short HEAD) (db backup: backups/pre-deploy-$TS.db)"
else
  echo "[deploy] FAILED health gate. Logs:"
  docker logs --tail 20 "$PROJECT-docurama" 2>&1 || true
  echo "[deploy] rollback manually with:"
  echo "  cd $WORKDIR"
  echo "  docker compose -p $PROJECT stop"
  echo "  cp backups/pre-deploy-$TS.db db/custom.db && chown 10001:10001 db/custom.db"
  echo "  git checkout -f -B $BRANCH $OLD_REF"
  echo "  docker compose -p $PROJECT up -d"
  exit 1
fi
