#!/usr/bin/env bash
# Docurama E2E runner — one command to a green (or red) Maestro suite.
#
#   bash e2e/run.sh                          # full suite against a local dev server
#   bash e2e/run.sh <flow.yaml> [more.yaml…] # one or more specific flows
#
# Environment:
#   MAESTRO_BASE_URL   target origin (default http://127.0.0.1:3000)
#   MAESTRO_SCREEN     headless viewport (default 1440x1000 — tall enough for
#                      the send-envelope dialog; smaller viewports put the
#                      recipient row at the screen edge and taps misfire)
#   E2E_SKIP_SEED=1    skip the seed step (flows need it for fixtures)
#   E2E_START_SERVER=0 don't boot/stop a dev server (CI or remote targets)
#
# Exit code: 0 iff every flow passed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_URL="${MAESTRO_BASE_URL:-http://127.0.0.1:3000}"
SCREEN="${MAESTRO_SCREEN:-1440x1000}"
FLOWS_DIR="$ROOT/e2e/flows"

# ── 0. Sanity: DATABASE_URL must point at the repo db. ────────────────────────
# A globally exported DATABASE_URL silently overrides .env and every DB route
# 500s (found the hard way). Pin it unless the caller overrode E2E_DATABASE_URL.
if [[ -n "${E2E_DATABASE_URL:-}" ]]; then
  export DATABASE_URL="$E2E_DATABASE_URL"
else
  export DATABASE_URL="file:$ROOT/db/custom.db"
fi
echo "── e2e: DATABASE_URL=$DATABASE_URL"

# ── 1. Dev server: reuse a running one, or boot a fresh instance ─────────────
SERVER_PID=""
if [[ "${E2E_START_SERVER:-1}" == "1" ]]; then
  if curl -sf -o /dev/null "$BASE_URL/login"; then
    echo "── e2e: dev server already answering at $BASE_URL — reusing it"
  else
    echo "── e2e: no server at $BASE_URL — starting one"
    (bun run dev > /tmp/docurama-e2e-dev.log 2>&1) &
    SERVER_PID=$!
    for i in $(seq 1 60); do
      if curl -sf -o /dev/null "$BASE_URL/login"; then break; fi
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "!! dev server died — see /tmp/docurama-e2e-dev.log"; exit 1
      fi
      sleep 2
    done
    curl -sf -o /dev/null "$BASE_URL/login" || { echo "!! dev server never came up"; exit 1; }
    echo "── e2e: dev server ready at $BASE_URL"
  fi
fi

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "── e2e: stopping dev server"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── 1b. Warm the public routes ────────────────────────────────────────────────
# In dev mode every route compiles on first hit; a flow that navigates
# straight after a cold boot can race the compiler (seen on the marketing
# CTA → /welcome). Touching the public surfaces once here removes that race
# for every flow. Non-fatal: warming only triggers compilation.
for route in / /login /welcome /modeles-de-contrats /verify /docs /sign; do
  curl -s -o /dev/null --max-time 180 "$BASE_URL$route" || true
done
echo "── e2e: public routes warmed"

# ── 2. Seed the deterministic fixtures ────────────────────────────────────────
if [[ "${E2E_SKIP_SEED:-0}" != "1" ]]; then
  echo "── e2e: seeding fixtures"
  bun e2e/seed.ts
fi

# ── 2b. Type gate (F3: the build must never ignore type errors again) ─────────
if [[ "${E2E_SKIP_TSC:-0}" != "1" ]]; then
  echo "── e2e: type-checking (tsc --noEmit)"
  bunx tsc --noEmit || { echo "!! tsc failed — fix type errors first"; exit 1; }
fi

# ── 2c. API-layer + evidence-layer + transparency-layer suites ──────────────
if [[ "${E2E_SKIP_API:-0}" != "1" ]]; then
  echo "── e2e: API-layer + evidence-layer + transparency-layer + MCP + quota tests"
  MAESTRO_BASE_URL="$BASE_URL" bun test e2e/api.test.ts e2e/evidence.test.ts e2e/transparency.test.ts e2e/mcp.test.ts e2e/quota.test.ts || { echo "!! API/evidence/transparency/MCP/quota tests failed"; exit 1; }
fi

# ── 3. Discover flows and run them ────────────────────────────────────────────
export MAESTRO_BASE_URL="$BASE_URL"
export MAESTRO_CLI_NO_ANALYTICS=1
export PATH="$HOME/.maestro/bin:$PATH"

if ! command -v maestro >/dev/null 2>&1; then
  if [[ "${E2E_SKIP_MAESTRO:-0}" == "1" ]]; then
    echo "── e2e: maestro skipped (E2E_SKIP_MAESTRO=1)"
    exit 0
  fi
  echo "!! maestro not found — install with: curl -Ls 'https://get.maestro.mobile.dev' | bash"
  exit 1
fi

if [[ $# -gt 0 ]]; then
  FLOWS=("$@")
else
  mapfile -t FLOWS < <(find "$FLOWS_DIR" -name '*.yaml' | sort)
fi

echo "── e2e: running ${#FLOWS[@]} flow(s) at ${SCREEN} against $MAESTRO_BASE_URL"
FAILED=()
i=0
for flow in "${FLOWS[@]}"; do
  i=$((i + 1))
  name="$(basename "$flow" .yaml)"
  echo ""
  echo "══ [$i/${#FLOWS[@]}] $name ══"
  if maestro test --headless --screen-size "$SCREEN" "$flow"; then
    echo "   ✔ $name"
  else
    echo "   ✘ $name"
    FAILED+=("$name")
  fi
done

echo ""
echo "────────────────────────────────────────────"
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "E2E: all ${#FLOWS[@]} flows passed"
else
  echo "E2E: ${#FAILED[@]}/${#FLOWS[@]} flows FAILED:"
  for f in "${FAILED[@]}"; do echo "   ✘ $f"; done
  exit 1
fi
