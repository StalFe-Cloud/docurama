#!/usr/bin/env bash
# Smoke test for the pricing/onboarding/enterprise stack.
# Usage: DATABASE_URL="file:../db/custom.db" bash scripts/smoke-pricing.sh [BASE_URL]
# Starts `next start` itself when BASE_URL is not provided.
set -u
cd "$(dirname "$0")/.."

BASE="${1:-http://127.0.0.1:3111}"
SELF_STARTED=0
JAR=$(mktemp)

cleanup() {
  [ "$SELF_STARTED" = "1" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$JAR"
}
trap cleanup EXIT

if [ "$#" -eq 0 ]; then
  echo "· starting next start on :3111"
  DATABASE_URL="file:../db/custom.db" ./node_modules/.bin/next start -p 3111 >/tmp/docurama-smoke.log 2>&1 &
  SERVER_PID=$!
  SELF_STARTED=1
  for i in $(seq 1 40); do
    curl -sf "$BASE/api/status" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

pass=0; fail=0
check() { # name, expected-substring, actual
  if echo "$3" | grep -q "$2"; then pass=$((pass+1)); echo "  ✓ $1"; else fail=$((fail+1)); echo "  ✗ $1 — wanted '$2' got: $(echo "$3" | head -c 300)"; fi
}

echo "· marketing + enterprise surfaces"
M=$(curl -s "$BASE/marketing"); check "marketing renders Smart Team" "Smart Team" "$M"
check "marketing no 'Most popular'" "" "$(echo "$M" | grep -c 'Most popular' || true)"
check "marketing differentiators" "35-day billing months" "$M"
E=$(curl -s "$BASE/enterprise"); check "enterprise page" "custom price\|Custom seats" "$E"

echo "· enterprise lead intake"
R=$(curl -s -X POST "$BASE/api/enterprise" -H 'content-type: application/json' \
  -d '{"contactName":"Smoke Tester","workEmail":"smoke@test.example","companyName":"Smoke Test GmbH","companySize":"51-200","country":"Germany","monthlyVolume":"500","needs":"SSO","honey":""}')
check "lead created" '"ok":true' "$R"
R2=$(curl -s -X POST "$BASE/api/enterprise" -H 'content-type: application/json' \
  -d '{"contactName":"Bot","workEmail":"bot@test.example","companyName":"Bot Co","honey":"spam"}')
check "honeypot silently dropped" '"ok":true' "$R2"
BAD=$(curl -s -X POST "$BASE/api/enterprise" -H 'content-type: application/json' -d '{"contactName":"X","workEmail":"nope","companyName":""}')
check "invalid lead rejected" 'error' "$BAD"

echo "· workspace quota (Business tenant owner)"
L=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"klaus@nordwind-logistics.example","password":"demo1234"}')
check "login ok" '"ok":true' "$L"
O=$(curl -s -b "$JAR" "$BASE/api/workspace/overview")
check "overview plan BUSINESS" 'BUSINESS' "$O"
check "overview seatLimit 50" '"seatLimit":50' "$O"
check "overview envelopeLimit 1000" '"envelopeLimit":1000' "$O"
check "overview has rollover" 'rollover' "$O"
check "overview has teams" '"teams"' "$O"

echo "· seat enforcement (Solo tenant)"
L2=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"camille@camille-notaire.example","password":"demo1234"}')
check "solo login ok" '"ok":true' "$L2"
I=$(curl -s -b "$JAR" -X POST "$BASE/api/workspace/settings" -H 'content-type: application/json' \
  -d '{"op":"invite-member","data":{"email":"friend@example.com","role":"MEMBER"}}')
check "solo invite blocked (1 seat)" 'seat' "$I"
K=$(curl -s -b "$JAR" -X POST "$BASE/api/workspace/settings" -H 'content-type: application/json' \
  -d '{"op":"create-key","data":{"name":"smoke","scope":"READONLY"}}')
check "solo API key blocked (no API tier)" 'Smart Team' "$K"

echo "· api access allowed on Smart Team"
L3=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"pietro@aurora-legal.example","password":"demo1234"}')
check "smart team login" '"ok":true' "$L3"
K2=$(curl -s -b "$JAR" -X POST "$BASE/api/workspace/settings" -H 'content-type: application/json' \
  -d '{"op":"create-key","data":{"name":"smoke","scope":"READONLY"}}')
check "smart team key created" 'dk_live_' "$K2"

echo "· suspended tenant blocked"
L4=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"greta@corvus-mfg.example","password":"demo1234"}')
S=$(curl -s -b "$JAR" -X POST "$BASE/api/workspace/envelopes" -H 'content-type: application/json' \
  -d '{"op":"send","data":{"title":"Suspended test","recipients":[{"email":"x@y.example","name":"X"}]}}')
check "suspended send blocked" 'suspended' "$S"

echo "· team creation gated to Business+"
L5=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"pietro@aurora-legal.example","password":"demo1234"}')
check "smart team re-login" '"ok":true' "$L5"
T=$(curl -s -b "$JAR" -X POST "$BASE/api/workspace/settings" -H 'content-type: application/json' \
  -d '{"op":"team.create","data":{"name":"Legal Ops"}}')
check "smart team plan cannot create teams" 'Business plan' "$T"

echo "· team creation works on Business"
L6=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"klaus@nordwind-logistics.example","password":"demo1234"}')
check "business re-login" '"ok":true' "$L6"
T2=$(curl -s -b "$JAR" -X POST "$BASE/api/workspace/settings" -H 'content-type: application/json' \
  -d '{"op":"team.create","data":{"name":"Smoke Team"}}')
check "business team created" 'created' "$T2"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
