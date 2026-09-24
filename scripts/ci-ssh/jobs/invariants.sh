#!/usr/bin/env bash
# invariants-<provider>: migration upgrade, backup/restore, drift and transaction/mail invariants (sqlite | postgresql)
set -euo pipefail
provider="$1"
cd /work
export CI=true DOCURAMA_VERIFICATION_DATABASE=1 NEXT_PUBLIC_DEMO_MODE=false DOCURAMA_WORKER=off REKOR_WITNESS=off
export DOCURAMA_ALLOW_PRIVATE_WEBHOOKS=1 E2E_BASE_URL=http://127.0.0.1:3000
export RUNNER_TEMP=/tmp/runner && mkdir -p "$RUNNER_TEMP"
if [ "$provider" = sqlite ]; then
  export DATABASE_URL="file:$RUNNER_TEMP/quality-verification.db"
else
  export DATABASE_URL="postgresql://docurama:fixture-only@${PG_HOST}:5432/docurama_verification"
fi
echo "::step generate"; node scripts/schema-for.mjs "$provider"; bunx prisma generate --schema "prisma/$provider/schema.prisma"
echo "::step upgrade"; node scripts/verify-migration-upgrade.mjs "$provider"
echo "::step migrate"; bunx prisma migrate deploy --schema "prisma/$provider/schema.prisma"
echo "::step tsc"; bunx tsc --noEmit
echo "::step lint"; bun run lint
echo "::step boot"
bun run dev > "$RUNNER_TEMP/verification-server.log" 2>&1 &
for _ in $(seq 1 90); do curl -fsS "$E2E_BASE_URL/api/health" > /dev/null 2>&1 && break; sleep 2; done
curl -fsS "$E2E_BASE_URL/api/health" > /dev/null || { tail -n 200 "$RUNNER_TEMP/verification-server.log"; exit 1; }
echo "::step tests"
bun test --timeout 60000 e2e/quality-verification.test.ts e2e/transaction-gate.test.ts
bun test --timeout 60000 e2e/mail-invariants.test.ts
echo "::done invariants-$provider"
