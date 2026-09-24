#!/usr/bin/env bash
# e2e.yml › postgres: the HTTP, MCP and browser suites against PostgreSQL 16
set -euo pipefail
cd /work
export PGURL="postgresql://docurama:docurama@${PG_HOST}:5432/docurama_test" DOCURAMA_ALLOW_PRIVATE_WEBHOOKS=1
echo "::step schema"
DATABASE_URL="$PGURL" node scripts/schema-for.mjs postgresql
DATABASE_URL="$PGURL" bunx prisma generate --schema prisma/schema.postgresql.prisma
DATABASE_URL="$PGURL" bunx prisma db push --schema prisma/schema.postgresql.prisma --skip-generate
echo "::step smoke"
PGPASSWORD=docurama psql -h "$PG_HOST" -U docurama -d docurama_test -c '\dt' | grep -q Envelope
PGPASSWORD=docurama psql -h "$PG_HOST" -U docurama -d docurama_test -c '\dt' | grep -q TransparencyEntry
echo "::step seed"
DATABASE_URL="$PGURL" bun e2e/seed.ts
echo "::step boot"
cp .env.example .env
REKOR_WITNESS=off NEXT_PUBLIC_DEMO_MODE=true DOCURAMA_WORKER=off DOCURAMA_ALLOW_PRIVATE_WEBHOOKS=1 DATABASE_URL="$PGURL" bun run dev > /tmp/pg-dev.log 2>&1 &
for _ in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:3000/login && break; sleep 2; done
curl -sf -o /dev/null http://127.0.0.1:3000/login || { tail -n 200 /tmp/pg-dev.log; exit 1; }
echo "::step tests"
for r in / /login /welcome /marketing /blog /docs /developers /status /verify /enterprise /modeles-de-contrats; do
  curl -s -o /dev/null --max-time 180 "http://127.0.0.1:3000$r" || true
done
export DATABASE_URL="$PGURL" E2E_BASE_URL=http://127.0.0.1:3000
bun test e2e/api.test.ts e2e/evidence.test.ts e2e/transparency.test.ts e2e/rekor.test.ts e2e/plans.test.ts e2e/webhooks.test.ts
bun test e2e/mcp.test.ts
bun test e2e/browser/
echo "::done postgres"
