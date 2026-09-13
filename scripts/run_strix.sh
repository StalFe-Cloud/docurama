#!/usr/bin/env bash
# Sprint 3 research R1 — strix agent-based dynamic security testing runner.
#
# strix is the agent-driven pentest harness from github.com/usestrix/strix.
# It requires an operator-managed model key and Docker; neither ships with the
# repository. TARGET must be a deployment the operator is authorised to test.
#
# Usage:
#   STRIX_API_KEY=... ./scripts/run_strix.sh [target-url]
set -euo pipefail

TARGET="${1:-http://localhost:3000}"
KEY="${STRIX_API_KEY:-}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required to run strix." >&2; exit 1; }
[ -n "$KEY" ] || { echo "STRIX_API_KEY is not set (operator-managed)." >&2; exit 1; }

echo "Running strix against ${TARGET}"
docker run --rm --network host \
  -e STRIX_API_KEY="${KEY}" \
  strix/strix:latest --target "${TARGET}" \
  --report-format sarif --report-name docurama-strix
