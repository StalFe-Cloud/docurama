#!/usr/bin/env bash
# Deploy a specific git tag to the VPS and gate on the public health endpoint.
# Run from a clean checkout on the operator's machine.
set -euo pipefail

TAG="${1:?usage: ./deploy/upgrade.sh <git-tag>}"
HEALTH_URL="${DOCURAMA_HEALTH_URL:-https://docurama.stalfe.com/api/health}"

git fetch --tags
CURRENT="$(git rev-parse HEAD)"
git checkout "$TAG"
trap 'git checkout -' EXIT

echo "[upgrade] deploying $TAG"
python deploy/deploy_to_vps.py

echo "[upgrade] waiting for healthy"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" | grep -q '"status": "healthy"'; then
    echo "[upgrade] healthy at $HEALTH_URL"
    exit 0
  fi
  sleep 10
done

echo "[upgrade] health gate failed after deploy of $TAG (previous: $CURRENT)" >&2
echo "[upgrade] rollback: git checkout <previous-tag> && python deploy/deploy_to_vps.py" >&2
exit 1
