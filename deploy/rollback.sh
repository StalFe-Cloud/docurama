#!/usr/bin/env bash
# Redeploy the previously running release. Run on the VPS or from the operator
# machine with the same env as upgrade.sh.
#
# upgrade.sh prints the tag it fell back from; pass it here, or let the script
# read DOCURAMA_PREVIOUS_TAG from the environment / .previous-tag file that
# upgrade.sh records before every deploy.
#
# Usage:
#   ./deploy/rollback.sh                # uses recorded previous tag
#   ./deploy/rollback.sh v1.2.3         # explicit tag
set -euo pipefail

APP_DIR="${DOCURAMA_APP_DIR:-/opt/docurama}"
PREVIOUS_TAG_FILE="$APP_DIR/.previous-tag"

TAG="${1:-${DOCURAMA_PREVIOUS_TAG:-}}"
if [ -z "$TAG" ] && [ -f "$PREVIOUS_TAG_FILE" ]; then
  TAG="$(head -n1 "$PREVIOUS_TAG_FILE")"
fi
if [ -z "$TAG" ]; then
  echo "No previous tag known. Pass one explicitly: ./deploy/rollback.sh <git-tag>" >&2
  echo "(upgrade.sh records the tag it deployed from into $PREVIOUS_TAG_FILE)" >&2
  exit 1
fi

echo "[rollback] redeploying $TAG"
cd "$APP_DIR" 2>/dev/null || cd "$(dirname "$0")/.."
git fetch --tags 2>/dev/null || true
git checkout "$TAG"

python3 deploy/deploy_to_vps.py

echo "[rollback] waiting for readiness"
HEALTH_URL="${DOCURAMA_HEALTH_URL:-https://docurama.stalfe.com/readyz}"
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
    echo "[rollback] $TAG is live and ready"
    exit 0
  fi
  sleep 10
done

echo "[rollback] readiness gate failed after redeploying $TAG; a data restore may be needed:" >&2
echo "[rollback]   deploy/restore.sh <stamp>   (see docs/GO_LIVE.md, section Restore drill)" >&2
exit 1
