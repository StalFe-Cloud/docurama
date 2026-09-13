#!/usr/bin/env bash
# Deploy a specific git tag to the VPS and gate on the public health endpoint.
# Run from a clean checkout on the operator's machine.
set -euo pipefail

TAG="${1:?usage: ./deploy/upgrade.sh <git-tag>}"
READY_URL="${DOCURAMA_HEALTH_URL:-https://docurama.stalfe.com/readyz}"

# The deploy helper resolves paths relative to the repository root.
cd "$(dirname "$0")/.."

git fetch --tags
CURRENT="$(git rev-parse HEAD)"
PREVIOUS_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "$CURRENT")"
git checkout "$TAG"
trap 'git checkout -' EXIT

# Recorded so deploy/rollback.sh can redeploy it without being told.
if [ -w . ]; then echo "$PREVIOUS_TAG" > .previous-tag; fi

echo "[upgrade] deploying $TAG (previous: $PREVIOUS_TAG)"
python3 deploy/deploy_to_vps.py

echo "[upgrade] waiting for readiness"
for i in $(seq 1 30); do
  if curl -fsS "$READY_URL" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    echo "[upgrade] ready at $READY_URL"
    exit 0
  fi
  sleep 10
done

echo "[upgrade] readiness gate failed after deploy of $TAG (previous: $PREVIOUS_TAG)" >&2
echo "[upgrade] roll back with: ./deploy/rollback.sh $PREVIOUS_TAG" >&2
echo "[upgrade] if the data itself is damaged, restore a backup: deploy/restore.sh <stamp>" >&2
exit 1
